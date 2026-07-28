import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { CliError, EXIT } from './errors.js'

const base64url = (buffer) => buffer.toString('base64url')

/**
 * CIMD (ADR-0004): the client id is the URL of our own metadata document, so
 * there is nothing to register and nothing to configure per instance.
 */
export const CLIENT_ID = 'https://andriypytel.github.io/youtrack-cli/client.json'

/** Fixed because the CIMD document declares this exact redirect URI. */
export const REDIRECT_PORT = 8637

export function pkce() {
  const verifier = base64url(randomBytes(32))
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) }
}

export function canOpenBrowser() {
  if (process.platform === 'darwin' || process.platform === 'win32') return true
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
}

export function openBrowser(url) {
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

const fetchJson = (target) =>
  fetch(target, { headers: { Accept: 'application/json' } })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null)

/**
 * The OAuth scope is the instance's YouTrack service id, published anonymously
 * in the protected resource metadata. Both documents are unauthenticated.
 */
export async function discoverScope(url) {
  const [resource, configuration] = await Promise.all([
    fetchJson(`${url}/.well-known/oauth-protected-resource/mcp`),
    fetchJson(`${url}/hub/api/rest/oauth2/.well-known/openid-configuration`),
  ])

  if (!configuration?.client_id_metadata_document_supported || !resource?.scopes_supported?.length) {
    throw new CliError(
      `${url} does not allow automatic OAuth client registration via CIMD.\n` +
        'An administrator can enable it under Access Management > OAuth Clients.\n' +
        'Until then, run `yt login --token` or export YT_TOKEN=<permanent token>.',
      EXIT.AUTH,
    )
  }

  return resource.scopes_supported.join(' ')
}
