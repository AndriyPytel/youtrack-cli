import { readFileSync } from 'node:fs'
import { openSession } from '../session.js'
import { parse, jsonFlag } from '../args.js'
import { table, print, printJson, listStyle } from '../render.js'
import { projectId } from '../resolve.js'
import { CliError } from '../errors.js'

const LIST_FIELDS = 'idReadable,summary,parentArticle(idReadable),project(shortName)'
const VIEW_FIELDS = 'idReadable,summary,content,project(shortName)'

function content(values) {
  if (values.file) return readFileSync(values.file, 'utf8')
  if (values.content !== undefined) return values.content
  return readFileSync(0, 'utf8')
}

async function ls(argv) {
  const { values } = parse(argv, { ...jsonFlag, project: { type: 'string' } })
  const { api } = await openSession()
  const articles = await api.request('/api/articles', { query: { fields: LIST_FIELDS, $top: 200 } })
  const visible = values.project
    ? articles.filter((article) => article.project?.shortName === values.project)
    : articles

  if (values.json) return printJson(visible)
  print(
    table(
      visible.map((article) => [article.idReadable, article.parentArticle?.idReadable ?? '-', article.summary ?? '']),
      listStyle,
    ),
  )
}

async function view(argv) {
  const { values, positionals } = parse(argv, jsonFlag)
  const id = positionals[0]
  if (!id) throw new CliError('Usage: yt art view <id>')
  const { api } = await openSession()
  const article = await api.request(`/api/articles/${id}`, {
    query: { fields: VIEW_FIELDS },
    notFound: `No such article: ${id}`,
  })
  if (values.json) return printJson(article)
  print(article.content ?? '')
}

async function create(argv) {
  const { values, positionals } = parse(argv, {
    ...jsonFlag,
    file: { type: 'string', short: 'f' },
    content: { type: 'string', short: 'c' },
    parent: { type: 'string' },
  })
  const [project, ...title] = positionals
  if (!project || title.length === 0) {
    throw new CliError('Usage: yt art new <project> <title> [-f file | -c text] [--parent <id>]')
  }

  const body = { summary: title.join(' '), content: await content(values) }
  const { api } = await openSession()
  body.project = { id: await projectId(api, project) }
  if (values.parent) {
    // --parent takes a readable id; the API wants the internal one.
    const parent = await api.request(`/api/articles/${values.parent}`, {
      query: { fields: 'id' },
      notFound: `No such article: ${values.parent}`,
    })
    body.parentArticle = { id: parent.id }
  }

  const article = await api.request('/api/articles', {
    method: 'POST',
    query: { fields: 'idReadable' },
    body,
  })
  if (values.json) return printJson(article)
  print(article.idReadable)
}

async function edit(argv) {
  const { values, positionals } = parse(argv, {
    ...jsonFlag,
    file: { type: 'string', short: 'f' },
    content: { type: 'string', short: 'c' },
  })
  const id = positionals[0]
  if (!id) throw new CliError('Usage: yt art edit <id> [-f file]')

  const { api } = await openSession()
  const article = await api.request(`/api/articles/${id}`, {
    method: 'POST',
    query: { fields: 'idReadable' },
    body: { content: await content(values) },
    notFound: `No such article: ${id}`,
  })
  if (values.json) return printJson(article)
  print(`${id} updated`)
}

const subcommands = { ls, view, new: create, edit }

export async function art(argv) {
  const run = subcommands[argv[0]]
  if (!run) throw new CliError('Usage: yt art ls|view|new|edit')
  return run(argv.slice(1))
}
