import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { openSession } from '../session.js'
import { parse, jsonFlag, fieldsFlag, fileFlag, optionalText } from '../args.js'
import { table, print, printJson, listStyle, cyan, dim } from '../render.js'
import { fieldValue, namedField, projectId } from '../resolve.js'
import { CliError, EXIT } from '../errors.js'

const LIST_FIELDS = 'idReadable,summary,customFields(name,value(name,login,fullName,presentation))'
const VIEW_FIELDS =
  'idReadable,summary,description,created,reporter(login,fullName),' +
  'customFields(name,value(name,login,fullName,presentation,text))'
const COMMENT_FIELDS = 'id,text,created,author(login,fullName)'

const when = (millis) => (millis ? new Date(millis).toISOString().slice(0, 16).replace('T', ' ') : '')

export async function ls(argv) {
  const { values, positionals } = parse(argv, {
    ...jsonFlag,
    ...fieldsFlag,
    top: { type: 'string' },
  })
  const { api } = await openSession()
  const issues = await api.request('/api/issues', {
    query: {
      query: positionals.join(' ') || undefined,
      fields: values.fields || LIST_FIELDS,
      // Repeated parameter — a comma-joined value returns an empty array.
      customFields: values.fields ? undefined : ['State'],
      $top: values.top || 50,
    },
  })

  if (values.json) return printJson(issues)
  print(
    table(
      issues.map((issue) => [issue.idReadable, namedField(issue, 'State'), issue.summary ?? '']),
      listStyle,
    ),
  )
}

export async function view(argv) {
  const { values, positionals } = parse(argv, {
    ...jsonFlag,
    ...fieldsFlag,
    comments: { type: 'boolean' },
  })
  const id = positionals[0]
  if (!id) throw new CliError('Usage: yt view <id> [--comments]')

  const { api } = await openSession()
  const issue = await api.request(`/api/issues/${id}`, {
    query: { fields: values.fields || VIEW_FIELDS },
    notFound: `No such issue: ${id}`,
  })
  const comments = values.comments
    ? await api.request(`/api/issues/${id}/comments`, {
        query: { fields: COMMENT_FIELDS, $top: 200 },
        notFound: `No such issue: ${id}`,
      })
    : null

  if (values.json) return printJson(comments ? { ...issue, comments } : issue)

  print(`${cyan(issue.idReadable)}  ${issue.summary ?? ''}`)
  const rows = (issue.customFields || [])
    .map((field) => [field.name, fieldValue(field.value)])
    .filter(([, value]) => value !== '')
  if (issue.reporter) rows.unshift(['Reporter', fieldValue(issue.reporter)])
  print(table(rows, (cell, column) => (column === 0 ? dim(cell) : cell)))
  if (issue.description) print(`\n${issue.description}`)

  for (const comment of comments || []) {
    print(`\n${dim(`${fieldValue(comment.author)}  ${when(comment.created)}`)}\n${comment.text ?? ''}`)
  }
}

export async function comment(argv) {
  const { values, positionals } = parse(argv, jsonFlag)
  const [id, ...rest] = positionals
  const text = rest.join(' ')
  if (!id || !text) throw new CliError('Usage: yt comment <id> <text>')

  const { api } = await openSession()
  const created = await api.request(`/api/issues/${id}/comments`, {
    method: 'POST',
    query: { fields: COMMENT_FIELDS },
    body: { text },
    notFound: `No such issue: ${id}`,
  })
  if (values.json) return printJson(created)
  print(`${id} commented`)
}

export async function create(argv) {
  const { values, positionals } = parse(argv, {
    ...jsonFlag,
    ...fileFlag,
    description: { type: 'string', short: 'd' },
  })
  const [project, ...summary] = positionals
  if (!project || summary.length === 0) {
    throw new CliError('Usage: yt new <project> <summary> [-d description | -f file]')
  }

  const description = optionalText(values.file, values.description)
  const { api } = await openSession()
  const issue = await api.request('/api/issues', {
    method: 'POST',
    query: { fields: 'idReadable' },
    body: {
      project: { id: await projectId(api, project) },
      summary: summary.join(' '),
      description,
    },
  })
  if (values.json) return printJson(issue)
  print(issue.idReadable)
}

export async function edit(argv) {
  const { values, positionals } = parse(argv, {
    ...jsonFlag,
    ...fileFlag,
    summary: { type: 'string', short: 's' },
    description: { type: 'string', short: 'd' },
  })
  const id = positionals[0]
  if (!id) throw new CliError('Usage: yt edit <id> [-s summary] [-d description | -f file]')

  // -s alone is already a complete change; don't reach for a description nobody asked to set.
  const wanted = values.description !== undefined || values.file !== undefined || values.summary === undefined
  const description = wanted ? optionalText(values.file, values.description) : undefined
  if (values.summary === undefined && description === undefined) {
    throw new CliError('Nothing to change: pass -s and/or -d.')
  }

  const { api } = await openSession()
  const issue = await api.request(`/api/issues/${id}`, {
    method: 'POST',
    query: { fields: 'idReadable' },
    body: { summary: values.summary, description },
    notFound: `No such issue: ${id}`,
  })
  if (values.json) return printJson(issue)
  print(`${id} updated`)
}

export async function attach(argv) {
  const { values, positionals } = parse(argv, jsonFlag)
  const [id, ...files] = positionals
  if (!id || files.length === 0) throw new CliError('Usage: yt attach <id> <file...>')

  for (const file of files) {
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
      throw new CliError(`Cannot read file: ${file}`, EXIT.NOT_FOUND)
    }
  }

  const { api } = await openSession()
  const uploaded = []
  for (const file of files) {
    const form = new FormData()
    form.append('file', new Blob([readFileSync(file)]), basename(file))
    uploaded.push(
      await api.request(`/api/issues/${id}/attachments`, {
        method: 'POST',
        query: { fields: 'id,name,size' },
        form,
        notFound: `No such issue: ${id}`,
      }),
    )
  }

  const attachments = uploaded.flat()
  if (values.json) return printJson(attachments)
  for (const attachment of attachments) print(`${id} attached ${attachment.name ?? ''}`)
}

const stripMarkup = (text = '') =>
  text
    .replace(/<[^>]*>/g, '')
    .replace(/\{[^{}]*\}/g, '')
    .replace(/\s+/g, ' ')
    .trim()

export const cmdHelp = `yt cmd <id...> "<command>" [--as <user>] [--dry-run]

Applies YouTrack's own command language, so every custom field works without
this tool knowing it exists.

  yt cmd DEMO-42 "state In Progress"
  yt cmd DEMO-42 "assignee me"
  yt cmd DEMO-1 DEMO-2 "tag urgent"
  yt cmd DEMO-42 "Fix versions 2026.1"                 milestone
  yt cmd DEMO-42 "relates to DEMO-7"                   link
  yt cmd DEMO-42 "subtask of DEMO-7"                   hierarchy
  yt cmd DEMO-42 "priority Critical state Fixed"       several at once
  yt cmd DEMO-42 "state Fixed" --as agent-bot          attribute to a user
  yt cmd DEMO-42 "state Frozen" --dry-run              validate, do not apply`

export async function cmd(argv) {
  const { values, positionals } = parse(argv, {
    ...jsonFlag,
    as: { type: 'string' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  })
  if (values.help) return print(cmdHelp)

  const command = positionals.at(-1)
  const ids = positionals.slice(0, -1)
  if (ids.length === 0 || !command || ids.some((id) => !id.trim())) {
    throw new CliError(`Usage: ${cmdHelp.split('\n')[0]}`)
  }

  const { api } = await openSession()
  const body = { query: command, issues: ids.map((id) => ({ idReadable: id })), runAs: values.as }

  if (values['dry-run']) {
    const assist = await api.request('/api/commands/assist', {
      method: 'POST',
      query: { fields: 'commands(description,error),suggestions(option)' },
      body,
    })
    if (values.json) return printJson(assist)
    const rejected = (assist.commands || []).filter((entry) => entry.error)
    if (rejected.length > 0) {
      throw new CliError(stripMarkup(rejected.map((entry) => entry.description).join('; ')), EXIT.REJECTED)
    }
    return print((assist.commands || []).map((entry) => stripMarkup(entry.description)).join('\n'))
  }

  const result = await api
    .request('/api/commands', { method: 'POST', query: { fields: 'issues(idReadable)' }, body })
    .catch((error) => {
      if (error.code === EXIT.USAGE) throw new CliError(stripMarkup(error.message), EXIT.REJECTED)
      throw error
    })
  if (values.json) return printJson(result ?? {})
  print(`${ids.join(' ')} ${command}`)
}
