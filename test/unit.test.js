import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { buildQuery } from '../src/api.js'
import { table } from '../src/render.js'
import { pkce } from '../src/oauth.js'
import { withLock } from '../src/lock.js'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('array query values repeat the parameter instead of comma-joining', () => {
  assert.equal(buildQuery({ customFields: ['State', 'Assignee'] }), '?customFields=State&customFields=Assignee')
  assert.equal(buildQuery({ fields: 'idReadable' }), '?fields=idReadable')
  assert.equal(buildQuery({ query: undefined, $top: 1 }), '?%24top=1')
  assert.equal(buildQuery({}), '')
})

test('table pads every column but the last and trims trailing space', () => {
  assert.equal(table([['a', 'long', 'x'], ['bbb', 'l', '']]), 'a    long  x\nbbb  l')
  assert.equal(table([]), '')
})

test('pkce produces a distinct verifier and its S256 challenge', () => {
  const { verifier, challenge } = pkce()
  const expected = createHash('sha256').update(verifier).digest('base64url')
  assert.equal(challenge, expected)
  assert.notEqual(pkce().verifier, verifier)
  assert.match(verifier, /^[A-Za-z0-9_-]+$/)
})

test('withLock serialises concurrent holders', async () => {
  let inside = 0
  let overlapped = false
  await Promise.all(
    Array.from({ length: 5 }, () =>
      withLock('serialise-test', async () => {
        inside += 1
        if (inside > 1) overlapped = true
        await new Promise((resolve) => setTimeout(resolve, 10))
        inside -= 1
      }),
    ),
  )
  assert.equal(overlapped, false)
})

test('a stale lock left by a killed process does not deadlock the next run', async () => {
  const path = join(tmpdir(), `youtrack-cli-${createHash('sha256').update('stale-test').digest('hex').slice(0, 16)}.lock`)
  rmSync(path, { recursive: true, force: true })
  mkdirSync(path)

  let ran = false
  await withLock('stale-test', async () => (ran = true), { staleMs: 0 })
  assert.equal(ran, true)
})

test('the lock excludes another process', async () => {
  const marker = join(tmpdir(), `yt-lock-order-${process.pid}.txt`)
  writeFileSync(marker, '')
  const script = `
    import { withLock } from '${join(process.cwd(), 'src/lock.js')}'
    import { appendFileSync } from 'node:fs'
    await withLock('cross-process-test', async () => {
      appendFileSync('${marker}', process.argv[2] + '-in\\n')
      await new Promise((r) => setTimeout(r, 150))
      appendFileSync('${marker}', process.argv[2] + '-out\\n')
    })
  `
  const child = (name) =>
    new Promise((resolve) => {
      const process_ = spawn(process.execPath, ['--input-type=module', '-e', script, name])
      process_.on('close', resolve)
    })

  await Promise.all([child('a'), child('b')])
  const order = readFileSync(marker, 'utf8').trim().split('\n')
  rmSync(marker, { force: true })
  assert.equal(order.length, 4)
  assert.equal(order[0].slice(0, 1), order[1].slice(0, 1), `interleaved: ${order}`)
})
