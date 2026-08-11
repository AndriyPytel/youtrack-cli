import { openSession } from '../session.js'
import { parse, jsonFlag } from '../args.js'
import { table, print, printJson, listStyle } from '../render.js'
import { fieldBundle, bundleProjects, stateBundle, projectId } from '../resolve.js'
import { CliError, EXIT } from '../errors.js'

const fieldFlag = { field: { type: 'string' } }
// parseArgs has no `--no-x` negation, so the off switches are their own flags.
const editFlags = {
  resolved: { type: 'boolean' },
  'no-resolved': { type: 'boolean' },
  archived: { type: 'boolean' },
  'no-archived': { type: 'boolean' },
}

const valuesUrl = (bundle) => `/api/admin/customFieldSettings/bundles/${bundle.bundlePath}/${bundle.bundleId}/values`

const marks = (value) => [value.isResolved && 'resolved', value.archived && 'archived'].filter(Boolean).join(' ')

const quote = (names) => names.map((name) => `"${name}"`).join(', ')

/** Which other projects a value written here also lands in. */
async function sharedNote(api, bundle, project) {
  const others = (await bundleProjects(api, bundle.fieldId, bundle.bundleId)).filter((name) => name !== project)
  return others.length > 0 ? ` — bundle shared with ${others.join(', ')}` : ''
}

/** `isResolved` exists on state values and nowhere else. */
function resolvedFlag(flags, bundle, field) {
  if (flags.resolved === undefined && flags['no-resolved'] === undefined) return undefined
  if (bundle.bundlePath !== 'state') {
    throw new CliError(`--resolved applies to State values only; ${field} is a ${bundle.bundlePath} field.`)
  }
  return flags.resolved ? true : false
}

/** Writes ordinals so the bundle reads in the given order, skipping values already in place. */
async function applyOrder(api, bundle, sequence) {
  for (const [ordinal, value] of sequence.entries()) {
    if (value.ordinal === ordinal) continue
    await api.request(`${valuesUrl(bundle)}/${value.id}`, {
      method: 'POST',
      query: { fields: 'id' },
      body: { ordinal },
    })
  }
}

/**
 * One implementation, two names: `yt state` and `yt type` differ only in which
 * field they default to. `--field` covers instances that name it something else.
 */
function valueCommands(alias, defaultField) {
  const usage = (form) => new CliError(`Usage: yt ${alias} ${form}`)

  async function open(argv, options) {
    const { values: flags, positionals } = parse(argv, { ...jsonFlag, ...fieldFlag, ...options })
    const [project, ...rest] = positionals
    const field = flags.field || defaultField
    if (!project) throw usage('ls|add|edit|order <project> ...')
    const { api } = await openSession()
    return { api, flags, project, field, rest, bundle: await fieldBundle(api, project, field) }
  }

  async function ls(argv) {
    const { flags, bundle } = await open(argv, { all: { type: 'boolean' } })
    const shown = flags.all ? bundle.values : bundle.values.filter((value) => !value.archived)
    if (flags.json) return printJson(shown)
    print(table(shown.map((value) => [value.name ?? '', marks(value)]), listStyle))
  }

  async function add(argv) {
    const { api, flags, project, field, rest, bundle } = await open(argv, {
      ...editFlags,
      after: { type: 'string' },
    })
    const name = rest.join(' ')
    if (!name) throw usage(`add <project> <name> [--resolved] [--archived] [--after "Other"]`)

    const clash = bundle.values.find((value) => value.name === name)
    if (clash) {
      throw new CliError(
        clash.archived
          ? `${project} already has an archived ${field} "${name}". ` +
            `Bring it back with \`yt ${alias} edit ${project} "${name}" --no-archived\`.`
          : `${project} already has ${field} "${name}".`,
      )
    }
    if (flags.after && !bundle.values.some((value) => value.name === flags.after)) {
      throw new CliError(`Project ${project} has no ${field} "${flags.after}".`)
    }

    const resolved = resolvedFlag(flags, bundle, field)
    const added = await api.request(valuesUrl(bundle), {
      method: 'POST',
      query: { fields: 'id,name' },
      body: { name, ...(resolved === undefined ? {} : { isResolved: resolved }), ...(flags.archived && { archived: true }) },
    })

    if (flags.after) {
      const at = bundle.values.findIndex((value) => value.name === flags.after)
      await applyOrder(api, bundle, [...bundle.values.slice(0, at + 1), added, ...bundle.values.slice(at + 1)])
    }

    const note = await sharedNote(api, bundle, project)
    if (flags.json) return printJson(added)
    print(`${project} ${field} added: ${added.name ?? name}${note}`)
  }

  async function edit(argv) {
    const { api, flags, project, field, rest, bundle } = await open(argv, {
      ...editFlags,
      rename: { type: 'string' },
    })
    const name = rest.join(' ')
    if (!name) throw usage(`edit <project> <name> [--rename X] [--resolved|--no-resolved] [--archived|--no-archived]`)

    const value = bundle.values.find((candidate) => candidate.name === name)
    if (!value) throw new CliError(`Project ${project} has no ${field} "${name}".`, EXIT.NOT_FOUND)

    const resolved = resolvedFlag(flags, bundle, field)
    const body = {}
    if (flags.rename) body.name = flags.rename
    if (resolved !== undefined) body.isResolved = resolved
    if (flags.archived) body.archived = true
    if (flags['no-archived']) body.archived = false
    if (Object.keys(body).length === 0) {
      throw new CliError('Nothing to change: pass --rename, --resolved/--no-resolved or --archived/--no-archived.')
    }

    const updated = await api.request(`${valuesUrl(bundle)}/${value.id}`, {
      method: 'POST',
      query: { fields: 'id,name,archived,isResolved' },
      body,
    })
    const note = await sharedNote(api, bundle, project)
    if (flags.json) return printJson(updated)
    print(`${project} ${field} updated: ${name}${flags.rename ? ` → ${flags.rename}` : ''}${note}`)
  }

  async function order(argv) {
    const { api, project, field, rest, bundle, flags } = await open(argv, {})
    const wanted = rest
      .join(' ')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
    if (wanted.length === 0) throw usage('order <project> "First,Second,Third"')

    const missing = wanted.filter((name) => !bundle.values.some((value) => value.name === name))
    if (missing.length > 0) throw new CliError(`Project ${project} has no ${field} ${quote(missing)}.`)

    // Named values lead, in the given order; everything else keeps its relative place.
    const sequence = [
      ...wanted.map((name) => bundle.values.find((value) => value.name === name)),
      ...bundle.values.filter((value) => !wanted.includes(value.name)),
    ]
    await applyOrder(api, bundle, sequence)
    const note = await sharedNote(api, bundle, project)
    if (flags.json) return printJson(sequence)
    print(`${project} ${field} order: ${sequence.map((value) => value.name).join(', ')}${note}`)
  }

  const subcommands = { ls, add, edit, order }
  return async function run(argv) {
    const subcommand = subcommands[argv[0]]
    if (!subcommand) throw usage('ls|add|edit|order <project> ...')
    return subcommand(argv.slice(1))
  }
}

async function boardLs(argv) {
  const { values } = parse(argv, jsonFlag)
  const { api } = await openSession()
  const boards = await api.collect('/api/agiles', {
    query: { fields: 'id,name,projects(shortName),columnSettings(field(name),columns(presentation))' },
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
  const live = states.filter((state) => !state.archived)
  const wanted = values.columns ? values.columns.split(',').map((column) => column.trim()) : live.map((s) => s.name)

  // A column can only reference a state that already exists — fail before creating anything.
  const missing = wanted.filter((column) => !states.some((state) => state.name === column))
  if (missing.length > 0) {
    throw new CliError(
      `Project ${project} has no state ${quote(missing)}. ` +
        `Add it with \`yt state add ${project} "${missing[0]}"\` first.`,
    )
  }

  // An archived state accepts no issues, so a column on one is dead on arrival.
  const hidden = wanted.filter((column) => !live.some((state) => state.name === column))
  if (hidden.length > 0) {
    throw new CliError(
      `Project ${project} has state ${quote(hidden)} archived, and an archived state can hold no issues. ` +
        `Bring it back with \`yt state edit ${project} "${hidden[0]}" --no-archived\`, or leave it out.`,
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

/** Columns reference state values by name, so a project without them gets dead columns. */
async function warnColumns(api, board, shortName) {
  const columns = (board.columnSettings?.columns || []).flatMap((column) =>
    (column.fieldValues || []).map((value) => value.name),
  )
  const states = await stateBundle(api, shortName).then(
    (bundle) => bundle.values.map((value) => value.name),
    (error) => {
      if (error.code === EXIT.NOT_FOUND) return []
      throw error
    },
  )
  const missing = [...new Set(columns.filter((column) => !states.includes(column)))]
  if (missing.length > 0) {
    process.stderr.write(`${shortName} has no state ${quote(missing)} — those board columns stay empty for it\n`)
  }
}

/** Board names are not unique in YouTrack, and `yt board ls` prints no id to copy. */
async function boardByName(api, name, fields) {
  const boards = await api.collect('/api/agiles', { query: { fields } })
  const matches = boards.filter((board) => board.name === name)
  if (matches.length === 0) throw new CliError(`No such board: ${name}`, EXIT.NOT_FOUND)
  if (matches.length > 1) {
    throw new CliError(
      `${matches.length} boards are named "${name}":\n` +
        matches.map((board) => `  projects: ${(board.projects || []).map((p) => p.shortName).join(', ')}`).join('\n') +
        '\nRename one of them so the name points at a single board.',
      EXIT.REJECTED,
    )
  }
  return { board: matches[0], boards }
}

/** `add` and `rm` are one read-modify-write of the board's project list. */
function boardEdit(mode) {
  return async function run(argv) {
    const { values, positionals } = parse(argv, jsonFlag)
    const name = positionals.at(-1)
    const shortNames = positionals.slice(0, -1)
    if (shortNames.length === 0) throw new CliError(`Usage: yt board ${mode} <project...> <board>`)

    const { api } = await openSession()
    const { board } = await boardByName(
      api,
      name,
      'id,name,projects(id,shortName),columnSettings(columns(fieldValues(name)))',
    )
    const current = board.projects || []
    const wanted = []
    for (const shortName of shortNames) wanted.push({ shortName, id: await projectId(api, shortName) })

    const on = (project) => current.some((existing) => existing.id === project.id)
    const changed = wanted.filter((project) => (mode === 'add' ? !on(project) : on(project)))
    const after =
      mode === 'add'
        ? [...current, ...changed]
        : current.filter((existing) => !changed.some((project) => project.id === existing.id))
    // An empty board is either a 400 or a dead board `yt` cannot delete, so the refusal is ours.
    if (after.length === 0) throw new CliError('a board must keep at least one project', EXIT.REJECTED)

    if (mode === 'add') for (const project of wanted) await warnColumns(api, board, project.shortName)

    const updated = await api.request(`/api/agiles/${board.id}`, {
      method: 'POST',
      query: { fields: 'id,name,projects(shortName)' },
      body: { projects: after.map((project) => ({ id: project.id })) },
    })

    if (values.json) return printJson(updated)
    const done = changed.length > 0
    const verb = mode === 'add' ? (done ? 'added to' : 'already on') : done ? 'removed from' : 'not on'
    const subject = (done ? changed : wanted).map((project) => project.shortName).join(', ')
    const projects = (updated.projects || after).map((project) => project.shortName).join(', ')
    print(`${subject} ${verb} "${board.name}" — projects: ${projects}`)
  }
}

const SPRINT_FIELDS = 'id,name,archived,start,finish'
const BOARD_SPRINT_FIELDS = 'id,name,projects(shortName),sprintsSettings(disableSprints,sprintSyncField(id))'

const day = (millis) => (millis ? new Date(millis).toISOString().slice(0, 10) : '')
const schedule = (sprint) => [day(sprint.start), day(sprint.finish)].filter(Boolean).join(' → ')

const sprintUsage = () => new CliError('Usage: yt sprint ls|new|close|current <board> [name]')

/**
 * The board a sprint command works on, its sprints, and every board alongside it.
 * A board with sprints switched off still answers with one permanent active
 * sprint, so the refusal is ours — passing that on would present a fiction as data.
 */
async function openSprints(argv, options = {}) {
  const { values: flags, positionals } = parse(argv, { ...jsonFlag, ...options })
  const [name, ...rest] = positionals
  if (!name) throw sprintUsage()

  const { api } = await openSession()
  const { board, boards } = await boardByName(api, name, BOARD_SPRINT_FIELDS)
  if (board.sprintsSettings?.disableSprints) {
    throw new CliError(`Board "${name}" has sprints switched off; it has no sprints to manage.`, EXIT.REJECTED)
  }
  const sprints = await api.collect(`/api/agiles/${board.id}/sprints`, { query: { fields: SPRINT_FIELDS } })
  return { api, flags, name, rest, board, boards, sprints }
}

/** The last unarchived one, not the one today falls into: a sprint is closed by hand, so its dates are decoration. */
function currentSprint(sprints, name) {
  const sprint = sprints.filter((sprint) => !sprint.archived).at(-1)
  if (!sprint) throw new CliError(`Board ${name} has no open sprint; the last one is closed.`, EXIT.NOT_FOUND)
  return sprint
}

async function sprintLs(argv) {
  const { flags, sprints } = await openSprints(argv, { all: { type: 'boolean' } })
  const shown = flags.all ? sprints : sprints.filter((sprint) => !sprint.archived)
  if (flags.json) return printJson(shown)
  print(
    table(
      shown.map((sprint) => [sprint.name ?? '', sprint.archived ? 'archived' : '', schedule(sprint)]),
      listStyle,
    ),
  )
}

async function sprintNew(argv) {
  const { api, flags, name, rest, board, boards, sprints } = await openSprints(argv)
  const wanted = rest.join(' ')
  if (!wanted) throw new CliError('Usage: yt sprint new <board> <name>')
  // Sprints are shared through a field, so a duplicate would land on every board sharing it.
  if (sprints.some((sprint) => sprint.name === wanted)) {
    throw new CliError(`Board ${name} already has a sprint "${wanted}".`, EXIT.REJECTED)
  }

  const created = await api.request(`/api/agiles/${board.id}/sprints`, {
    method: 'POST',
    query: { fields: SPRINT_FIELDS },
    body: { name: wanted },
  })
  if (flags.json) return printJson(created)

  const field = board.sprintsSettings?.sprintSyncField?.id
  const also = boards
    .filter((other) => other.id !== board.id && other.sprintsSettings?.sprintSyncField?.id === field)
    .map((other) => other.name)
    .filter(Boolean)
  print(
    `${created.name ?? wanted} created on "${name}"` +
      (schedule(created) ? ` — ${schedule(created)}` : '') +
      (also.length > 0 ? `; also on ${also.join(', ')}` : ''),
  )
}

async function sprintClose(argv) {
  const { api, flags, name, board, sprints } = await openSprints(argv)
  const sprint = currentSprint(sprints, name)
  const archived = await api.request(`/api/agiles/${board.id}/sprints/${sprint.id}`, {
    method: 'POST',
    query: { fields: SPRINT_FIELDS },
    body: { archived: true },
  })
  if (flags.json) return printJson(archived)
  print(`${sprint.name} closed on "${name}" — \`yt sprint ls ${name} --all\` still lists it`)
}

async function sprintCurrent(argv) {
  const { flags, name, sprints } = await openSprints(argv)
  const sprint = currentSprint(sprints, name)
  if (flags.json) return printJson(sprint)
  // The name alone, so it feeds straight back into `yt cmd <id> "add Board <board> <sprint>"`.
  print(sprint.name ?? '')
}

const sprintCommands = { ls: sprintLs, new: sprintNew, close: sprintClose, current: sprintCurrent }

export async function sprint(argv) {
  const run = sprintCommands[argv[0]]
  if (!run) throw sprintUsage()
  return run(argv.slice(1))
}

const boardCommands = { ls: boardLs, new: boardNew, add: boardEdit('add'), rm: boardEdit('rm') }

export const state = valueCommands('state', 'State')
export const type = valueCommands('type', 'Type')

export async function board(argv) {
  const run = boardCommands[argv[0]]
  if (!run) throw new CliError('Usage: yt board ls|new|add|rm <project...> <name> [--columns "A,B,C"]')
  return run(argv.slice(1))
}
