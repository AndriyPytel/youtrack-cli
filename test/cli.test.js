import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFakeYouTrack } from './fake-youtrack.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const bin = join(root, 'bin', 'yt.js')

let server
let configDir

before(async () => {
  server = await startFakeYouTrack()
  configDir = mkdtempSync(join(tmpdir(), 'yt-config-'))
})

after(async () => {
  await server.stop()
  rmSync(configDir, { recursive: true, force: true })
})

/** Async on purpose: the fake server shares this process, so spawnSync would deadlock. */
function yt(args, { token = 'test-token', input = '' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      env: { ...process.env, YT_URL: server.url, YT_TOKEN: token, YT_CONFIG_DIR: configDir },
    })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => (out += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk) => (err += chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out, err }))
    child.stdin.end(input)
  })
}

test('yt ls prints id, state and summary in aligned columns', async () => {
  const { code, out } = await yt(['ls'])
  assert.equal(code, 0)
  assert.equal(out, 'DEMO-1  Done         Launch YouTrack\nDEMO-4  In Progress  Create a demo project\n')
})

test('yt ls sends customFields as a repeated query parameter', async () => {
  server.requests.length = 0
  await yt(['ls'])
  const request = server.requests.find((entry) => entry.path === '/api/issues')
  const parameters = new URL(request.url, 'http://x').searchParams.getAll('customFields')
  assert.deepEqual(parameters, ['State'])
  assert.ok(!request.url.includes('customFields=State%2C'), 'must never comma-join customFields')
  assert.ok(request.url.includes('fields='), 'every request carries an explicit projection')
})

test('yt ls --json returns the raw response and --fields passes through', async () => {
  const { out } = await yt(['ls', '--json'])
  assert.equal(JSON.parse(out).length, 2)

  server.requests.length = 0
  await yt(['ls', '--fields', 'idReadable'])
  const request = server.requests.find((entry) => entry.path === '/api/issues')
  assert.equal(new URL(request.url, 'http://x').searchParams.get('fields'), 'idReadable')
})

test('piped output carries no colour', async () => {
  const { out } = await yt(['ls'])
  assert.ok(!out.includes('['), 'no escape codes when stdout is not a TTY')
})

test('a bad token exits 1 with one line', async () => {
  const { code, err, out } = await yt(['ls'], { token: 'wrong' })
  assert.equal(code, 1)
  assert.equal(out, '')
  assert.equal(err.trim().split('\n').length, 1)
  assert.match(err, /Authentication failed/)
})

test('an unknown issue exits 2 with one sentence', async () => {
  const { code, err } = await yt(['view', 'DEMO-999'])
  assert.equal(code, 2)
  assert.equal(err, 'No such issue: DEMO-999\n')
})

test('yt view prints fields and, with --comments, the thread', async () => {
  const plain = await yt(['view', 'DEMO-1'])
  assert.equal(plain.code, 0)
  assert.match(plain.out, /DEMO-1 {2}Launch YouTrack/)
  assert.match(plain.out, /State\s+Done/)
  assert.match(plain.out, /Assignee\s+Root/)
  assert.match(plain.out, /The first issue\./)
  assert.ok(!plain.out.includes('first\n'), 'comments are not fetched without --comments')

  const withComments = await yt(['view', 'DEMO-1', '--comments'])
  assert.match(withComments.out, /first/)
  const raw = await yt(['view', 'DEMO-1', '--comments', '--json'])
  assert.equal(JSON.parse(raw.out).comments.length, 1)
})

test('yt comment adds a comment and confirms in one line', async () => {
  const { code, out } = await yt(['comment', 'DEMO-4', 'looks', 'good'])
  assert.equal(code, 0)
  assert.equal(out, 'DEMO-4 commented\n')
  assert.equal(server.state.comments['DEMO-4'].at(-1).text, 'looks good')
})

test('yt new prints the readable id and nothing else', async () => {
  const { code, out } = await yt(['new', 'DEMO', 'A new issue', '-d', 'body'])
  assert.equal(code, 0)
  assert.match(out, /^DEMO-\d+\n$/)
})

test('yt new on an unknown project exits 2 naming the project', async () => {
  const { code, err } = await yt(['new', 'NOPE', 'x'])
  assert.equal(code, 2)
  assert.equal(err, 'No such project: NOPE\n')
})

test('yt edit updates summary and description', async () => {
  await yt(['edit', 'DEMO-4', '-s', 'Renamed', '-d', 'New body'])
  assert.equal(server.state.issues['DEMO-4'].summary, 'Renamed')
  assert.equal(server.state.issues['DEMO-4'].description, 'New body')
  assert.equal((await yt(['edit', 'DEMO-4'])).code, 4)
})

test('yt attach refuses a missing file before sending anything', async () => {
  server.requests.length = 0
  const { code, err } = await yt(['attach', 'DEMO-1', join(tmpdir(), 'does-not-exist-xyz')])
  assert.equal(code, 2)
  assert.match(err, /Cannot read file/)
  assert.equal(server.requests.length, 0)
})

test('yt attach uploads each file', async () => {
  const file = join(configDir, 'note.txt')
  writeFileSync(file, 'hello')
  const { code, out } = await yt(['attach', 'DEMO-1', file])
  assert.equal(code, 0)
  assert.match(out, /DEMO-1 attached/)
})

test('yt cmd applies a command to several issues in one request', async () => {
  server.requests.length = 0
  const { code } = await yt(['cmd', 'DEMO-1', 'DEMO-4', 'state Done'])
  assert.equal(code, 0)
  assert.equal(server.requests.filter((entry) => entry.path === '/api/commands').length, 1)
  assert.deepEqual(server.state.applied.issues, [{ idReadable: 'DEMO-1' }, { idReadable: 'DEMO-4' }])
  assert.equal(server.state.applied.query, 'state Done')
})

test('yt cmd --as sets runAs', async () => {
  await yt(['cmd', 'DEMO-1', 'state Done', '--as', 'agent-bot'])
  assert.equal(server.state.applied.runAs, 'agent-bot')
})

test('a 403 reports the missing permission, not a failed login', async () => {
  const { code, err } = await yt(['cmd', 'DEMO-1', 'state Done', '--as', 'stranger'])
  assert.equal(code, 1)
  assert.match(err, /Permission denied \(403\): No permission to run as another user/)
})

test('yt cmd with a blank id is a usage error, not a request', async () => {
  server.requests.length = 0
  const { code, err } = await yt(['cmd', '', 'state Done'])
  assert.equal(code, 4)
  assert.match(err, /^Usage: yt cmd/)
  assert.equal(server.requests.length, 0)
})

test('yt cmd --dry-run describes without applying', async () => {
  server.requests.length = 0
  const { code, out } = await yt(['cmd', 'DEMO-1', 'state Done', '--dry-run'])
  assert.equal(code, 0)
  assert.equal(out, 'applies state Done\n')
  assert.equal(server.requests.filter((entry) => entry.path === '/api/commands').length, 0)
})

test('a rejected command exits 3 with the markup stripped', async () => {
  const dry = await yt(['cmd', 'DEMO-1', 'nonsense here', '--dry-run'])
  assert.equal(dry.code, 3)
  assert.equal(dry.err, 'no such field\n')
  assert.equal((await yt(['cmd', 'DEMO-1', 'nonsense here'])).code, 3)
})

test('a rejected dry run exits 3 in JSON mode too, with the payload still printed', async () => {
  const dry = await yt(['cmd', 'DEMO-1', 'nonsense here', '--dry-run', '--json'])
  assert.equal(dry.code, 3)
  assert.equal(JSON.parse(dry.out).commands[0].error, true)

  const accepted = await yt(['cmd', 'DEMO-1', 'state Done', '--dry-run', '--json'])
  assert.equal(accepted.code, 0)
  assert.equal(JSON.parse(accepted.out).commands[0].error, false)
})

test('yt cmd --help carries worked examples', async () => {
  const { out } = await yt(['cmd', '--help'])
  for (const example of ['state In Progress', 'assignee me', 'tag urgent', 'Fix versions', 'relates to', '--as']) {
    assert.match(out, new RegExp(example.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('yt art lists, views, creates and edits', async () => {
  assert.match((await yt(['art', 'ls'])).out, /DEMO-A-1\s+Runbook/)
  assert.equal((await yt(['art', 'view', 'DEMO-A-1'])).out, '# Runbook\nhow to ship\n')

  const created = await yt(['art', 'new', 'DEMO', 'Guide', '-c', 'text body'])
  assert.match(created.out, /^DEMO-A-\d+\n$/)

  await yt(['art', 'edit', 'DEMO-A-1', '-c', 'replaced'])
  assert.equal(server.state.articles['DEMO-A-1'].content, 'replaced')
  assert.equal((await yt(['art', 'ls', '--project', 'NOPE'])).code, 2)
})

test('yt art ls indents children under their parent', async () => {
  const { out } = await yt(['art', 'ls', '--project', 'DEMO'])
  assert.match(out, /DEMO-A-1\s+Runbook\nDEMO-A-2\s+ {2}Deploying/)
  assert.ok(!out.includes('OPS-A-1'))
})

test('yt art ls --project asks the per-project endpoint, not a global list', async () => {
  const before = server.requests.length
  await yt(['art', 'ls', '--project', 'OPS'])
  const paths = server.requests.slice(before).map((request) => request.path)
  assert.ok(paths.includes('/api/admin/projects/0-1/articles'))
  assert.ok(!paths.includes('/api/articles'))
})

test('yt art ls --grep matches titles case-insensitively, and misses quietly', async () => {
  const hit = await yt(['art', 'ls', '--grep', 'EXPORT'])
  assert.equal(hit.code, 0)
  assert.match(hit.out, /OPS-A-1\s+Export pipeline/)
  assert.ok(!hit.out.includes('Runbook'))

  const miss = await yt(['art', 'ls', '--grep', 'nothing matches this'])
  assert.equal(miss.code, 0)
  assert.equal(miss.out, '')
})

test('yt new and yt edit read the description from a file or stdin', async () => {
  const draft = join(configDir, 'draft.md')
  writeFileSync(draft, '# Draft\ntwo lines\n')

  const fromFile = await yt(['new', 'DEMO', 'From file', '-f', draft])
  assert.equal(server.state.issues[fromFile.out.trim()].description, '# Draft\ntwo lines\n')

  const fromStdin = await yt(['new', 'DEMO', 'From stdin'], { input: 'piped body' })
  assert.equal(server.state.issues[fromStdin.out.trim()].description, 'piped body')

  await yt(['edit', 'DEMO-4', '-f', draft])
  assert.equal(server.state.issues['DEMO-4'].description, '# Draft\ntwo lines\n')

  await yt(['edit', 'DEMO-4'], { input: 'edited body' })
  assert.equal(server.state.issues['DEMO-4'].description, 'edited body')
})

test('yt edit -s alone does not consume stdin, and an empty edit still fails', async () => {
  const untouched = server.state.issues['DEMO-4'].description
  const { code } = await yt(['edit', 'DEMO-4', '-s', 'Renamed'], { input: 'must be ignored' })
  assert.equal(code, 0)
  assert.equal(server.state.issues['DEMO-4'].summary, 'Renamed')
  assert.equal(server.state.issues['DEMO-4'].description, untouched)

  const empty = await yt(['edit', 'DEMO-4'])
  assert.equal(empty.code, 4)
  assert.match(empty.err, /Nothing to change/)
})

test('yt art new --parent resolves the readable id to the internal one', async () => {
  const { code, out } = await yt(['art', 'new', 'DEMO', 'Child', '-c', 'x', '--parent', 'DEMO-A-1'])
  assert.equal(code, 0)
  assert.deepEqual(server.state.articles[out.trim()].parentArticle, { id: '3-1' })
})

test('yt art new reads content from stdin when neither -f nor -c is given', async () => {
  const { code, out } = await yt(['art', 'new', 'DEMO', 'From stdin'], { input: 'piped content' })
  assert.equal(code, 0)
  assert.equal(server.state.articles[out.trim()].content, 'piped content')
})

test('yt project new defaults the leader to the authenticated user', async () => {
  const { code, out } = await yt(['project', 'new', 'NEW', 'A new project', '-d', 'made by a test'])
  assert.equal(code, 0)
  assert.equal(out, 'NEW\n')
  const created = server.state.projects.find((project) => project.shortName === 'NEW')
  assert.deepEqual(created.leader, { id: '2-1' })
  assert.equal(created.name, 'A new project')
  assert.equal(created.description, 'made by a test')
  assert.equal(created.organization, undefined)
})

test('yt project new resolves --leader and --org to database ids', async () => {
  const { code } = await yt(['project', 'new', 'WITHORG', 'Owned', '--leader', 'alice', '--org', 'Acme'])
  assert.equal(code, 0)
  const created = server.state.projects.find((project) => project.shortName === 'WITHORG')
  assert.deepEqual(created.leader, { id: '2-3' })
  assert.deepEqual(created.organization, { id: '1-0' })

  const unknown = await yt(['project', 'new', 'NOPE', 'x', '--org', 'Missing Inc'])
  assert.equal(unknown.code, 2)
  assert.match(unknown.err, /No such organization: Missing Inc/)
})

test('yt project assign keeps the members already on the team', async () => {
  assert.equal((await yt(['project', 'team', 'DEMO'])).out, 'root  Root\n')

  const { code, out } = await yt(['project', 'assign', 'DEMO', 'alice'])
  assert.equal(code, 0)
  assert.equal(out, 'root\nalice\n')
  assert.deepEqual(server.state.teams['0-0'], ['2-1', '2-3'])

  await yt(['project', 'assign', 'DEMO', 'alice'])
  assert.deepEqual(server.state.teams['0-0'], ['2-1', '2-3'])

  const unknown = await yt(['project', 'assign', 'DEMO', 'nobody'])
  assert.equal(unknown.code, 2)
  assert.match(unknown.err, /No such user: nobody/)
})

test('yt org new creates an organization', async () => {
  assert.equal((await yt(['org', 'new', 'Globex', '-d', 'new one'])).out, 'Globex\n')
  assert.ok(server.state.organizations.some((organization) => organization.name === 'Globex'))
})

test('yt user new generates the password instead of taking it as a flag', async () => {
  const { code, out, err } = await yt(['user', 'new', 'bob', '--name', 'Bob', '--email', 'bob@example.com'])
  assert.equal(code, 0)
  assert.equal(out, 'bob\n')
  assert.match(err, /^password: \S{20,}\n$/)

  const created = server.state.users.find((user) => user.login === 'bob')
  assert.equal(created.fullName, 'Bob')
  assert.equal(created.email, 'bob@example.com')
  assert.ok(created.password.length >= 20)

  // A password flag would put the secret in `ps` output and in shell history.
  assert.equal((await yt(['user', 'new', 'eve', '--password', 'hunter2'])).code, 4)
})

test('yt state lists and adds, marking only the values that carry a flag', async () => {
  assert.equal((await yt(['state', 'ls', 'DEMO'])).out, 'Open\nIn Progress\nDone         resolved\n')
  assert.equal((await yt(['state', 'add', 'DEMO', 'Frozen'])).out, 'DEMO State added: Frozen\n')
  assert.ok(server.state.states.some((state) => state.name === 'Frozen'))
})

test('yt type ls hides archived values until --all', async () => {
  assert.equal((await yt(['type', 'ls', 'DEMO'])).out, 'Bug\nTask\n')
  assert.equal((await yt(['type', 'ls', 'DEMO', '--all'])).out, 'Bug\nTask\nEpic  archived\n')
})

test('yt type add names the other projects that share the bundle', async () => {
  const { code, out } = await yt(['type', 'add', 'DEMO', 'my custom bug'])
  assert.equal(code, 0)
  assert.equal(out, 'DEMO Type added: my custom bug — bundle shared with OPS\n')
  assert.ok(server.state.types.some((value) => value.name === 'my custom bug'))
  // The same value is now visible from OPS, which is the point of saying so.
  assert.equal((await yt(['type', 'ls', 'OPS'])).out, 'Bug\nTask\nmy custom bug\n')
})

test('yt type add points at --no-archived when the value exists but is hidden', async () => {
  const { code, err } = await yt(['type', 'add', 'DEMO', 'Epic'])
  assert.equal(code, 4)
  assert.match(err, /archived Type "Epic".*--no-archived/s)
})

test('yt state edit renames and resolves in one call', async () => {
  const { code, out } = await yt(['state', 'edit', 'DEMO', 'Frozen', '--rename', 'Paused', '--resolved'])
  assert.equal(code, 0)
  assert.equal(out, 'DEMO State updated: Frozen → Paused\n')
  const paused = server.state.states.find((value) => value.name === 'Paused')
  assert.equal(paused.isResolved, true)
})

test('yt state edit --no-resolved turns the flag off rather than dropping it', async () => {
  await yt(['state', 'edit', 'DEMO', 'Paused', '--no-resolved'])
  assert.equal(server.state.states.find((value) => value.name === 'Paused').isResolved, false)
})

test('--resolved is rejected on a field that has no such attribute', async () => {
  const { code, err } = await yt(['type', 'edit', 'DEMO', 'Bug', '--resolved'])
  assert.equal(code, 4)
  assert.match(err, /State values only/)
  assert.equal(server.state.types.find((value) => value.name === 'Bug').isResolved, undefined)
})

test('yt type order writes an ordinal only where it changed', async () => {
  server.requests.length = 0
  const { code, out } = await yt(['type', 'order', 'DEMO', 'Task,Bug'])
  assert.equal(code, 0)
  assert.equal(out, 'DEMO Type order: Task, Bug, Epic, my custom bug — bundle shared with OPS\n')
  assert.deepEqual(
    server.state.types.map((value) => value.name),
    ['Task', 'Bug', 'Epic', 'my custom bug'],
  )
  const writes = server.requests.filter((entry) => /\/bundles\/enum\/b-2\/values\/./.test(entry.path))
  assert.equal(writes.length, 2, 'values already in place must not be rewritten')
})

test('yt state add --after places the new value without a second call', async () => {
  await yt(['state', 'add', 'DEMO', 'Blocked', '--after', 'Open'])
  assert.deepEqual(
    server.state.states.map((value) => value.name),
    ['Open', 'Blocked', 'In Progress', 'Done', 'Paused'],
  )
})

test('yt state order refuses a name the project does not have', async () => {
  const { code, err } = await yt(['state', 'order', 'DEMO', 'Open,Nowhere'])
  assert.equal(code, 4)
  assert.match(err, /no State "Nowhere"/)
})

test('yt board new refuses a column with no matching state, before creating anything', async () => {
  const before = server.state.agiles.length
  const { code, err } = await yt(['board', 'new', 'DEMO', 'Sprint', '--columns', 'Open,Nowhere'])
  assert.equal(code, 4)
  assert.match(err, /no state "Nowhere"/)
  assert.equal(server.state.agiles.length, before)
})

test('yt board new creates a board with columns in one call', async () => {
  server.requests.length = 0
  const { code, out } = await yt(['board', 'new', 'DEMO', 'Sprint', '--columns', 'Open,Done'])
  assert.equal(code, 0)
  assert.match(out, /Sprint created with columns: Open, Done/)
  assert.equal(server.requests.filter((entry) => entry.path === '/api/agiles').length, 1)

  const board = server.state.agiles.at(-1)
  assert.deepEqual(
    board.columnSettings.columns.map((column) => column.fieldValues),
    [[{ name: 'Open' }], [{ name: 'Done' }]],
    'columns must reference field values by name, not a read-only presentation',
  )
  assert.equal(board.columnSettings.field.id, 'f-1')
  assert.deepEqual(
    board.projects.map((project) => project.id),
    ['0-0'],
  )

  assert.match((await yt(['board', 'ls'])).out, /Sprint\s+DEMO\s+Open \| Done/)
})

test('yt board new leaves archived states out of the default columns', async () => {
  await yt(['state', 'edit', 'DEMO', 'Paused', '--archived'])
  const { code } = await yt(['board', 'new', 'DEMO', 'Everything'])
  assert.equal(code, 0)
  assert.deepEqual(
    server.state.agiles.at(-1).columnSettings.columns.map((column) => column.fieldValues[0].name),
    ['Open', 'Blocked', 'In Progress', 'Done'],
  )
})

test('yt board new refuses an archived state named explicitly, before creating anything', async () => {
  const before = server.state.agiles.length
  const { code, err } = await yt(['board', 'new', 'DEMO', 'Stale', '--columns', 'Open,Paused'])
  assert.equal(code, 4)
  assert.match(err, /"Paused" archived.*--no-archived/s)
  assert.equal(server.state.agiles.length, before)
})

test('yt help and an unknown command', async () => {
  assert.match((await yt(['help'])).out, /yt cmd <id\.\.\.>/)
  assert.equal((await yt(['nope'])).code, 4)
})

test('yt login --status reports the credential source', async () => {
  const { code, out } = await yt(['login', '--status'])
  assert.equal(code, 0)
  assert.match(out, /credential: (YT_TOKEN|keychain)/)
})
