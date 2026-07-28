import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { CliError, EXIT } from './errors.js'

const base64url = (buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function pkce() {
  const verifier = base64url(randomBytes(32))
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) }
}

export function canOpenBrowser() {
  if (process.platform === 'darwin' || process.platform === 'win32') return true
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
}

function openBrowser(url) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
}

/** Serves exactly one request on 127.0.0.1, then shuts down. */
function loopback(port) {
  let settle
  const received = new Promise((resolve) => (settle = resolve))
  const server = createServer((request, response) => {
    const query = new URL(request.url, 'http://127.0.0.1').searchParams
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end('<html><body><p>Login complete. You can close this tab.</p></body></html>')
    settle(query)
    server.close()
  })
  const listening = new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server.address().port))
  })
  return { listening, received, stop: () => server.close() }
}

export async function exchange(url, params) {
  const response = await fetch(`${url}/hub/api/rest/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new CliError(
      `Token exchange failed (${response.status}): ${body.error_description || body.error || 'unknown error'}`,
      EXIT.AUTH,
    )
  }
  return body
}

export function refreshTokens({ url, clientId, refreshToken }) {
  return exchange(url, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId })
}

/**
 * Authorization code + PKCE S256 against the instance's own Hub.
 * @returns {Promise<{access_token: string, refresh_token?: string, expires_in?: number}>}
 */
export async function authorize({ url, clientId, scope, port = 0, timeoutMs = 120_000, open = openBrowser }) {
  if (!canOpenBrowser()) {
    throw new CliError(
      'No browser is available here (no DISPLAY). Run `yt login --token` or export YT_TOKEN instead.',
      EXIT.AUTH,
    )
  }

  const server = loopback(port)
  const boundPort = await server.listening
  const redirectUri = `http://127.0.0.1:${boundPort}/callback`
  const { verifier, challenge } = pkce()
  const state = base64url(randomBytes(16))

  const authUrl = `${url}/hub/api/rest/oauth2/auth?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    request_credentials: 'default',
  })}`

  process.stderr.write(`Opening the browser to approve access…\nIf it does not open: ${authUrl}\n`)
  open(authUrl)

  let timer
  const query = await Promise.race([
    server.received,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new CliError('Timed out waiting for the browser. Run `yt login` again.', EXIT.AUTH)),
        timeoutMs,
      )
    }),
  ]).finally(() => {
    clearTimeout(timer)
    server.stop()
  })

  if (query.get('error')) {
    throw new CliError(`Authorization refused: ${query.get('error_description') || query.get('error')}`, EXIT.AUTH)
  }
  if (query.get('state') !== state) {
    throw new CliError('OAuth state mismatch — the response did not come from this login. Aborted.', EXIT.AUTH)
  }

  return exchange(url, {
    grant_type: 'authorization_code',
    code: query.get('code'),
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  })
}

/**
 * One authenticated call is the only way in: Hub has no dynamic client
 * registration (ADR-0003). Registers a public PKCE client and finds the
 * YouTrack service id used as the OAuth scope.
 */
export async function bootstrap({ url, token, redirectPort }) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }

  const services = await fetch(
    `${url}/hub/api/rest/services?fields=id,name,applicationName&$top=1000`,
    { headers },
  ).then(async (response) => {
    if (response.status === 401 || response.status === 403) {
      throw new CliError('That token was rejected by Hub. Check it and try again.', EXIT.AUTH)
    }
    if (!response.ok) throw new CliError(`Hub ${response.status} while listing services.`, EXIT.AUTH)
    return response.json()
  })

  const youtrack = (services.services || services).find?.(
    (service) => service.applicationName === 'YouTrack' || service.name === 'YouTrack',
  )
  if (!youtrack) {
    throw new CliError('Could not find the YouTrack service on this Hub — export YT_TOKEN instead.', EXIT.AUTH)
  }

  const registration = await fetch(`${url}/hub/api/rest/services?fields=id,name,redirectUris`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `yt-cli (${process.env.USER || process.env.USERNAME || 'cli'})`,
      applicationName: 'yt-cli',
      homeUrl: 'https://github.com/apytel/youtrack-cli',
      redirectUris: [`http://127.0.0.1:${redirectPort}/callback`],
    }),
  })

  if (registration.status === 403) {
    throw new CliError(
      'This account may not register an OAuth client in Hub (403). ' +
        'Ask an administrator, or export YT_TOKEN=<permanent token> and use that instead.',
      EXIT.AUTH,
    )
  }
  if (!registration.ok) {
    throw new CliError(
      `Could not register the OAuth client (Hub ${registration.status}). Export YT_TOKEN to continue.`,
      EXIT.AUTH,
    )
  }

  const client = await registration.json()
  return { clientId: client.id, scope: youtrack.id, redirectPort }
}
