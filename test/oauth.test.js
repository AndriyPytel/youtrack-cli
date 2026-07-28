import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { startFakeYouTrack } from './fake-youtrack.js'
import { authorize, discoverScope } from '../src/oauth.js'
import { EXIT } from '../src/errors.js'

let server

before(async () => {
  server = await startFakeYouTrack({ accessTokens: ['no-admin'] })
  process.env.DISPLAY ||= ':0' // canOpenBrowser() must be true on a headless runner
})

after(() => server.stop())

const tokenRequests = () => server.requests.filter((entry) => entry.path === '/hub/api/rest/oauth2/token')

/** Stands in for the browser: follows the authorization URL back to the loopback server. */
const browser = (mutate = (parameters) => parameters) => async (authUrl) => {
  const url = new URL(authUrl)
  const parameters = mutate({
    code: 'auth-code',
    state: url.searchParams.get('state'),
  })
  const redirect = new URL(url.searchParams.get('redirect_uri'))
  for (const [key, value] of Object.entries(parameters)) redirect.searchParams.set(key, value)
  await fetch(redirect)
}

test('authorization code with PKCE S256 on an ephemeral loopback port', async () => {
  server.requests.length = 0
  let seen
  const tokens = await authorize({
    url: server.url,
    clientId: 'client-1',
    scope: 'svc-yt',
    open: (authUrl) => {
      seen = new URL(authUrl)
      return browser()(authUrl)
    },
  })

  assert.equal(seen.pathname, '/hub/api/rest/oauth2/auth')
  assert.equal(seen.searchParams.get('response_type'), 'code')
  assert.equal(seen.searchParams.get('code_challenge_method'), 'S256')
  assert.match(seen.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  assert.notEqual(Number(new URL(seen.searchParams.get('redirect_uri')).port), 0)

  const exchange = tokenRequests().at(-1).body
  assert.equal(exchange.grant_type, 'authorization_code')
  assert.equal(exchange.code, 'auth-code')
  assert.equal(
    createHash('sha256').update(exchange.code_verifier).digest('base64url'),
    seen.searchParams.get('code_challenge'),
    'the verifier must hash to the challenge that was sent',
  )
  assert.ok(tokens.access_token && tokens.refresh_token)
})

test('a state mismatch aborts without exchanging the code', async () => {
  server.requests.length = 0
  const error = await authorize({
    url: server.url,
    clientId: 'client-1',
    scope: 'svc-yt',
    open: browser((parameters) => ({ ...parameters, state: 'forged' })),
  }).catch((failure) => failure)

  assert.equal(error.code, EXIT.AUTH)
  assert.match(error.message, /state mismatch/)
  assert.equal(tokenRequests().length, 0)
})

test('the flow times out on its own and says what to do next', async () => {
  const error = await authorize({
    url: server.url,
    clientId: 'client-1',
    scope: 'svc-yt',
    timeoutMs: 100,
    open: () => {},
  }).catch((failure) => failure)

  assert.equal(error.code, EXIT.AUTH)
  assert.match(error.message, /Timed out.*yt login/s)
})

test('a refusal in the browser is reported, not swallowed', async () => {
  const error = await authorize({
    url: server.url,
    clientId: 'client-1',
    scope: 'svc-yt',
    open: browser(() => ({ error: 'access_denied', error_description: 'user said no' })),
  }).catch((failure) => failure)

  assert.equal(error.code, EXIT.AUTH)
  assert.match(error.message, /user said no/)
})

test('the scope is discovered anonymously, with no credential of any kind', async () => {
  server.requests.length = 0
  assert.equal(await discoverScope(server.url), 'svc-yt')
  assert.ok(
    server.requests.every((entry) => !entry.authorization),
    'discovery must not depend on being logged in',
  )
})

test('an instance with CIMD disabled points at the token fallback, not a stack trace', async () => {
  server.state.cimd = false
  const error = await discoverScope(server.url).catch((failure) => failure)
  server.state.cimd = true
  assert.equal(error.code, EXIT.AUTH)
  assert.match(error.message, /CIMD/)
  assert.match(error.message, /YT_TOKEN/)
})
