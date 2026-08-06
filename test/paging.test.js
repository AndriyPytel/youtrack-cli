import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFakeYouTrack } from './fake-youtrack.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const bin = join(root, 'bin', 'yt.js')

// One page is 200 rows; every seeded collection is deliberately larger.
const BULK = 260

let server
let configDir

/** Async on purpose: the fake server shares this process, so spawnSync would deadlock. */
function against(instance, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      env: { ...process.env, YT_URL: instance.url, YT_TOKEN: 'test-token', YT_CONFIG_DIR: configDir },
    })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => (out += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk) => (err += chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out, err }))
    child.stdin.end('')
  })
}

const yt = (args) => against(server, args)

before(async () => {
  server = await startFakeYouTrack()
  configDir = mkdtempSync(join(tmpdir(), 'yt-paging-'))
  const { state } = server

  for (let n = 0; n < BULK; n += 1) {
    state.issues[`BULK-${n}`] = { idReadable: `BULK-${n}`, summary: `bulk ${n}`, customFields: [] }
    state.comments['DEMO-1'].push({ id: `c-${n}`, text: `bulk ${n}`, created: 1_700_000_000_000, author: { login: 'root' } })
    state.articles[`BULK-A-${n}`] = {
      id: `3-${n + 10}`,
      idReadable: `BULK-A-${n}`,
      summary: `bulk ${n}`,
      ordinal: n,
      project: { shortName: 'DEMO' },
    }
    state.agiles.push({ id: `a-${n}`, name: `Board ${n}`, projects: [{ id: '0-0', shortName: 'DEMO' }], columnSettings: { columns: [] } })
    state.projects.push({ id: `0-${n + 10}`, shortName: `BULK${n}` })
    state.users.push({ id: `2-${n + 10}`, login: `bulk-${n}`, fullName: `Bulk ${n}` })
    // Ahead of State and Type, so the field this pushes past the first page is the one `yt state ls` needs.
    state.extraFields.push({ field: { id: `f-${n + 10}`, name: `Filler ${n}` } })
  }
  // Last of their kind: found only by a lookup that reached the final page.
  state.projects.push({ id: '0-999', shortName: 'LAST' })
  state.users.push({ id: '2-999', login: 'zoe', fullName: 'Zoe' })
  state.teams['0-0'] = state.users.filter((user) => user.login !== 'zoe').map((user) => user.id)
})

after(async () => {
  await server.stop()
  rmSync(configDir, { recursive: true, force: true })
})

test('yt ls fills the window and says on stderr that it did not fit', async () => {
  const { code, out, err } = await yt(['ls'])
  assert.equal(code, 0)
  assert.equal(out.trimEnd().split('\n').length, 50)
  assert.doesNotMatch(out, /matched/, 'the tail never lands on stdout')
  assert.match(err, /50 shown.*--top N.*--all/)
  assert.doesNotMatch(err, /\d+ more|remaining/, 'the exact remaining count is never claimed')
})

test('yt ls --json truncates to a bare array and still warns on stderr', async () => {
  const { code, out, err } = await yt(['ls', '--json'])
  assert.equal(code, 0)
  const issues = JSON.parse(out)
  assert.ok(Array.isArray(issues))
  assert.equal(issues.length, 50)
  assert.match(err, /50 shown/)
})

test('a list that fits the window announces nothing', async () => {
  assert.equal((await yt(['ls', '--top', '500'])).err, '')
  assert.equal((await yt(['ls', '--top', '500', '--json'])).err, '')
})

test('yt ls --all returns every page, once, with no tail', async () => {
  const total = Object.keys(server.state.issues).length
  const { code, out, err } = await yt(['ls', '--all'])
  assert.equal(code, 0)
  assert.equal(err, '')
  const ids = out.trimEnd().split('\n').map((row) => row.split(' ')[0])
  assert.equal(ids.length, total)
  assert.equal(new Set(ids).size, total, 'no row is fetched twice')

  const json = await yt(['ls', '--all', '--json'])
  assert.equal(json.err, '')
  const issues = JSON.parse(json.out)
  assert.ok(Array.isArray(issues))
  assert.equal(issues.length, total)
  const single = JSON.parse((await yt(['ls', '--json'])).out)
  assert.deepEqual(Object.keys(issues[0]).sort(), Object.keys(single[0]).sort(), 'stitched rows keep their shape')
})

test('yt ls --all --top N is a usage error, and nothing is fetched', async () => {
  server.requests.length = 0
  const { code, out, err } = await yt(['ls', '--all', '--top', '100'])
  assert.equal(code, 4)
  assert.equal(out, '')
  assert.equal(err.trimEnd().split('\n').length, 1)
  assert.equal(server.requests.filter((entry) => entry.path === '/api/issues').length, 0)
})

test('yt help carries --top and --all on the ls line', async () => {
  const { out } = await yt(['help'])
  assert.match(out, /yt ls .*--top N.*--all/)
})

test('the lists that take no flags come back whole', async () => {
  const comments = JSON.parse((await yt(['view', 'DEMO-1', '--comments', '--json'])).out).comments
  assert.equal(comments.length, server.state.comments['DEMO-1'].length)

  const articles = await yt(['art', 'ls', '--json'])
  assert.equal(articles.err, '')
  assert.equal(JSON.parse(articles.out).length, Object.keys(server.state.articles).length)

  const boards = await yt(['board', 'ls', '--json'])
  assert.equal(boards.err, '')
  assert.equal(JSON.parse(boards.out).length, server.state.agiles.length)

  const team = await yt(['project', 'team', 'DEMO'])
  assert.equal(team.err, '')
  assert.equal(team.out.trimEnd().split('\n').length, server.state.teams['0-0'].length)
})

test('a name that sorts past the first page still resolves', async () => {
  const created = await yt(['new', 'LAST', 'past the window'])
  assert.equal(created.code, 0)
  assert.match(created.out, /^DEMO-\d+\n$/)

  const project = await yt(['project', 'new', `WIN${Date.now().toString(36).slice(-4)}`, 'Windowed', '--leader', 'zoe'])
  assert.equal(project.code, 0)
})

test('a project with more custom fields than one page still has its State field', async () => {
  const { code, out } = await yt(['state', 'ls', 'DEMO'])
  assert.equal(code, 0)
  assert.match(out, /Open/)
  assert.match(out, /Done\s+resolved/)
})

test('yt project assign keeps every member of a team larger than one page', async () => {
  const before = server.state.teams['0-0'].length
  const { code } = await yt(['project', 'assign', 'DEMO', 'zoe'])
  assert.equal(code, 0)
  assert.equal(server.state.teams['0-0'].length, before + 1)
  assert.equal((await yt(['project', 'team', 'DEMO'])).out.trimEnd().split('\n').length, before + 1)
})

test('a server that ignores $skip stops the loop instead of feeding it forever', async () => {
  const stubborn = await startFakeYouTrack({ ignoreSkip: true })
  for (let n = 0; n < BULK; n += 1) {
    stubborn.state.issues[`BULK-${n}`] = { idReadable: `BULK-${n}`, summary: `bulk ${n}`, customFields: [] }
  }
  try {
    const { code, err } = await against(stubborn, ['ls', '--all'])
    assert.notEqual(code, 0)
    assert.match(err, /\$skip/)
    assert.ok(
      stubborn.requests.filter((entry) => entry.path === '/api/issues').length <= 2,
      'the second identical page is enough to know',
    )
  } finally {
    await stubborn.stop()
  }
})
