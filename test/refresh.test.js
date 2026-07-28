import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeYouTrack } from './fake-youtrack.js'
import { createApi } from '../src/api.js'
import { EXIT } from '../src/errors.js'

let server
let oauthTokens

before(async () => {
  server = await startFakeYouTrack()
  process.env.YT_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'yt-refresh-'))
  ;({ oauthTokens } = await import('../src/session.js'))
})

after(async () => {
  await server.stop()
  rmSync(process.env.YT_CONFIG_DIR, { recursive: true, force: true })
})

/** An in-memory stand-in for the keychain, shared the way the keychain is. */
function memoryStore(initial) {
  let credential = initial
  return {
    read: async () => credential,
    write: async (_url, next) => (credential = next),
    get current() {
      return credential
    },
  }
}

beforeEach(() => {
  server.state.refreshCount = 0
})

test('an expired access token is refreshed before the first request', async () => {
  const store = memoryStore({ refreshToken: 'r-1', accessToken: 'expired', expiresAt: 0 })
  const tokens = oauthTokens(server.url, store)
  const api = createApi({ url: server.url, token: tokens.token, refresh: tokens.refresh })

  const issues = await api.request('/api/issues', { query: { fields: 'idReadable' } })
  assert.equal(issues.length, 2)
  assert.equal(server.state.refreshCount, 1)
  assert.equal(store.current.accessToken, 'access-1')
  assert.equal(store.current.refreshToken, 'rotated-1', 'the rotated refresh token replaces the stored one')
})

test('a 401 triggers one refresh and one retry', async () => {
  const store = memoryStore({ refreshToken: 'r-1', accessToken: 'stale-but-unexpired', expiresAt: Date.now() + 3_600_000 })
  const tokens = oauthTokens(server.url, store)
  const api = createApi({ url: server.url, token: tokens.token, refresh: tokens.refresh })

  const issues = await api.request('/api/issues', { query: { fields: 'idReadable' } })
  assert.equal(issues.length, 2)
  assert.equal(server.state.refreshCount, 1, 'exactly one refresh')
})

test('concurrent invocations sharing a store perform one refresh between them', async () => {
  const store = memoryStore({ refreshToken: 'r-1', accessToken: 'expired', expiresAt: 0 })
  const results = await Promise.all(
    Array.from({ length: 4 }, () => {
      const tokens = oauthTokens(server.url, store)
      return createApi({ url: server.url, token: tokens.token, refresh: tokens.refresh }).request('/api/issues', {
        query: { fields: 'idReadable' },
      })
    }),
  )
  assert.ok(results.every((issues) => issues.length === 2))
  assert.equal(server.state.refreshCount, 1, 'the others use the first refresh, not their own')
})

test('a revoked refresh token says to log in again', async () => {
  const store = memoryStore({ refreshToken: 'revoked', expiresAt: 0 })
  const tokens = oauthTokens(server.url, store)
  const error = await tokens.token().catch((failure) => failure)
  assert.equal(error.code, EXIT.AUTH)
  assert.match(error.message, /Run `yt login` again/)
})

test('a second failure surfaces as an auth error', async () => {
  const store = memoryStore({ refreshToken: 'r-1', accessToken: 'expired', expiresAt: 0 })
  const tokens = oauthTokens(server.url, store)
  const api = createApi({ url: server.url, token: tokens.token, refresh: tokens.refresh })

  server.state.rejectAll = true
  const error = await api.request('/api/issues', { query: { fields: 'idReadable' } }).catch((failure) => failure)
  server.state.rejectAll = false
  assert.equal(error.code, EXIT.AUTH)
  assert.equal(server.state.refreshCount, 2, 'one refresh up front, one on the 401 — then it gives up')
})
