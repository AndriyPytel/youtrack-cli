import { openSession } from '../session.js'
import { parse, jsonFlag, fileFlag, textArg } from '../args.js'
import { table, print, printJson, cyan } from '../render.js'
import { projectId } from '../resolve.js'
import { CliError } from '../errors.js'

const LIST_FIELDS = 'idReadable,summary,ordinal,parentArticle(idReadable),project(shortName)'
const VIEW_FIELDS = 'idReadable,summary,content,project(shortName)'

/** An article whose parent is not in the set — filtered out, or elsewhere — renders as a root. */
function tree(articles) {
  const children = new Map()
  const present = new Set(articles.map((article) => article.idReadable))
  for (const article of articles) {
    const parent = article.parentArticle?.idReadable
    const key = present.has(parent) ? parent : null
    children.set(key, [...(children.get(key) ?? []), article])
  }

  const rows = []
  const walk = (parent, depth) => {
    for (const article of (children.get(parent) ?? []).sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))) {
      rows.push([article.idReadable, '  '.repeat(depth) + (article.summary ?? '')])
      walk(article.idReadable, depth + 1)
    }
  }
  walk(null, 0)
  return table(rows, (cell, column) => (column === 0 ? cyan(cell) : cell))
}

async function ls(argv) {
  const { values } = parse(argv, { ...jsonFlag, project: { type: 'string' }, grep: { type: 'string' } })
  const { api } = await openSession()
  const path = values.project
    ? `/api/admin/projects/${await projectId(api, values.project)}/articles`
    : '/api/articles'
  const articles = await api.request(path, { query: { fields: LIST_FIELDS, $top: 200 } })

  const needle = values.grep?.toLowerCase()
  const found = needle ? articles.filter((article) => (article.summary ?? '').toLowerCase().includes(needle)) : articles

  if (values.json) return printJson(found)
  print(tree(found))
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
    ...fileFlag,
    content: { type: 'string', short: 'c' },
    parent: { type: 'string' },
  })
  const [project, ...title] = positionals
  if (!project || title.length === 0) {
    throw new CliError('Usage: yt art new <project> <title> [-f file | -c text] [--parent <id>]')
  }

  const body = { summary: title.join(' '), content: textArg(values.file, values.content) }
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
    ...fileFlag,
    content: { type: 'string', short: 'c' },
  })
  const id = positionals[0]
  if (!id) throw new CliError('Usage: yt art edit <id> [-f file]')

  const { api } = await openSession()
  const article = await api.request(`/api/articles/${id}`, {
    method: 'POST',
    query: { fields: 'idReadable' },
    body: { content: textArg(values.file, values.content) },
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
