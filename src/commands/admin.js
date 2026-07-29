import { randomBytes } from 'node:crypto'
import { openSession } from '../session.js'
import { parse, jsonFlag } from '../args.js'
import { print, printJson, table, listStyle } from '../render.js'
import { organizationId, projectId, userId } from '../resolve.js'
import { CliError } from '../errors.js'

async function projectNew(argv) {
  const { values, positionals } = parse(argv, {
    ...jsonFlag,
    description: { type: 'string', short: 'd' },
    leader: { type: 'string' },
    org: { type: 'string' },
  })
  const [shortName, ...name] = positionals
  if (!shortName || name.length === 0) {
    throw new CliError('Usage: yt project new <shortName> <name> [-d description] [--leader login] [--org name]')
  }

  const { api } = await openSession()
  const leader = values.leader
    ? await userId(api, values.leader)
    : (await api.request('/api/users/me', { query: { fields: 'id' } })).id

  const project = await api.request('/api/admin/projects', {
    method: 'POST',
    query: { fields: 'id,shortName' },
    body: {
      shortName,
      name: name.join(' '),
      description: values.description,
      leader: { id: leader },
      organization: values.org ? { id: await organizationId(api, values.org) } : undefined,
    },
  })
  if (values.json) return printJson(project)
  print(project.shortName)
}

const teamUrl = (id) => `/api/admin/projects/${id}/team`

async function projectTeam(argv) {
  const { values, positionals } = parse(argv, jsonFlag)
  const [shortName] = positionals
  if (!shortName) throw new CliError('Usage: yt project team <shortName>')

  const { api } = await openSession()
  const id = await projectId(api, shortName)
  const team = await api.request(teamUrl(id), { query: { fields: 'users(login,fullName)', $top: 1000 } })
  if (values.json) return printJson(team)
  print(table((team.users || []).map((user) => [user.login, user.fullName || '']), listStyle))
}

async function projectAssign(argv) {
  const { values, positionals } = parse(argv, jsonFlag)
  const [shortName, ...logins] = positionals
  if (!shortName || logins.length === 0) throw new CliError('Usage: yt project assign <shortName> <login...>')

  const { api } = await openSession()
  const id = await projectId(api, shortName)
  const added = []
  for (const login of logins) added.push(await userId(api, login))

  // `ownUsers` is replaced wholesale, so the current members go back with the new ones.
  const team = await api.request(teamUrl(id), { query: { fields: 'ownUsers(id)', $top: 1000 } })
  const members = [...new Set([...(team.ownUsers || []).map((user) => user.id), ...added])]
  const updated = await api.request(teamUrl(id), {
    method: 'POST',
    query: { fields: 'ownUsers(login)' },
    body: { ownUsers: members.map((memberId) => ({ id: memberId })) },
  })

  if (values.json) return printJson(updated)
  print((updated.ownUsers || []).map((user) => user.login).join('\n'))
}

async function orgNew(argv) {
  const { values, positionals } = parse(argv, { ...jsonFlag, description: { type: 'string', short: 'd' } })
  const name = positionals.join(' ')
  if (!name) throw new CliError('Usage: yt org new <name> [-d description]')

  const { api } = await openSession()
  const organization = await api.request('/api/admin/organizations', {
    method: 'POST',
    query: { fields: 'id,name' },
    body: { name, description: values.description },
  })
  if (values.json) return printJson(organization)
  print(organization.name)
}

async function userNew(argv) {
  const { values, positionals } = parse(argv, {
    ...jsonFlag,
    name: { type: 'string' },
    email: { type: 'string' },
  })
  const login = positionals[0]
  if (!login) throw new CliError('Usage: yt user new <login> [--name "Full Name"] [--email a@b.c]')

  // Generated, never a flag: a password in argv lands in `ps` and shell history.
  const password = randomBytes(18).toString('base64url')
  const { api } = await openSession()
  const user = await api.request('/api/users', {
    method: 'POST',
    query: { fields: 'id,login' },
    body: { login, password, fullName: values.name, email: values.email },
  })

  process.stderr.write(`password: ${password}\n`)
  if (values.json) return printJson(user)
  print(user.login)
}

const dispatch = (name, subcommands) => async (argv) => {
  const run = subcommands[argv[0]]
  if (!run) throw new CliError(`Usage: yt ${name} ${Object.keys(subcommands).join('|')}`)
  return run(argv.slice(1))
}

export const project = dispatch('project', { new: projectNew, team: projectTeam, assign: projectAssign })
export const org = dispatch('org', { new: orgNew })
export const user = dispatch('user', { new: userNew })
