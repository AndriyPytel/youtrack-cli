import { openSession } from '../session.js'
import { parse, jsonFlag } from '../args.js'
import { table, print, printJson, listStyle } from '../render.js'
import { stateBundle } from '../resolve.js'
import { CliError } from '../errors.js'

async function stateLs(argv) {
  const { values, positionals } = parse(argv, jsonFlag)
  const project = positionals[0]
  if (!project) throw new CliError('Usage: yt state ls <project>')
  const { api } = await openSession()
  const { values: states } = await stateBundle(api, project)
  if (values.json) return printJson(states)
  print(states.map((state) => state.name).join('\n'))
}

async function stateAdd(argv) {
  const { values, positionals } = parse(argv, jsonFlag)
  const [project, ...name] = positionals
  if (!project || name.length === 0) throw new CliError('Usage: yt state add <project> <name>')

  const { api } = await openSession()
  const { bundleId } = await stateBundle(api, project)
  const added = await api.request(`/api/admin/customFieldSettings/bundles/state/${bundleId}/values`, {
    method: 'POST',
    query: { fields: 'name' },
    body: { name: name.join(' ') },
  })
  if (values.json) return printJson(added)
  print(`${project} state added: ${added.name ?? name.join(' ')}`)
}

async function boardLs(argv) {
  const { values } = parse(argv, jsonFlag)
  const { api } = await openSession()
  const boards = await api.request('/api/agiles', {
    query: { fields: 'id,name,projects(shortName),columnSettings(field(name),columns(presentation))', $top: 200 },
  })
  if (values.json) return printJson(boards)
  print(
    table(
      boards.map((board) => [
        board.name ?? '',
        (board.projects || []).map((project) => project.shortName).join(','),
        (board.columnSettings?.columns || []).map((column) => column.presentation).join(' | '),
      ]),
      listStyle,
    ),
  )
}

async function boardNew(argv) {
  const { values, positionals } = parse(argv, { ...jsonFlag, columns: { type: 'string' } })
  const [project, ...name] = positionals
  if (!project || name.length === 0) {
    throw new CliError('Usage: yt board new <project> <name> [--columns "A,B,C"]')
  }

  const { api } = await openSession()
  const { projectId, fieldId, values: states } = await stateBundle(api, project)
  const wanted = values.columns ? values.columns.split(',').map((column) => column.trim()) : states.map((s) => s.name)

  // A column can only reference a state that already exists — fail before creating anything.
  const missing = wanted.filter((column) => !states.some((state) => state.name === column))
  if (missing.length > 0) {
    throw new CliError(
      `Project ${project} has no state ${missing.map((state) => `"${state}"`).join(', ')}. ` +
        `Add it with \`yt state add ${project} "${missing[0]}"\` first.`,
    )
  }

  const board = await api.request('/api/agiles', {
    method: 'POST',
    query: { fields: 'id,name,columnSettings(columns(presentation,fieldValues(name)))' },
    body: {
      name: name.join(' '),
      projects: [{ id: projectId }],
      columnSettings: {
        field: { id: fieldId },
        // A column is defined by the field values it holds; `presentation` is
        // derived from them and read-only. Sending it alone makes a dead board.
        columns: wanted.map((name) => ({ fieldValues: [{ name }] })),
      },
    },
  })
  if (values.json) return printJson(board)
  print(`${board.name ?? name.join(' ')} created with columns: ${wanted.join(', ')}`)
}

const stateCommands = { ls: stateLs, add: stateAdd }
const boardCommands = { ls: boardLs, new: boardNew }

export async function state(argv) {
  const run = stateCommands[argv[0]]
  if (!run) throw new CliError('Usage: yt state ls|add <project> [name]')
  return run(argv.slice(1))
}

export async function board(argv) {
  const run = boardCommands[argv[0]]
  if (!run) throw new CliError('Usage: yt board ls|new <project> <name> [--columns "A,B,C"]')
  return run(argv.slice(1))
}
