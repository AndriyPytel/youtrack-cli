import { createInterface } from 'node:readline/promises'
import { parse } from '../args.js'
import { print, dim } from '../render.js'
import { instanceConfig, normalizeUrl, readConfig, saveInstanceConfig, writeConfig } from '../config.js'
import { deleteCredential, writeCredential } from '../keychain.js'
import { resolveCredential } from '../session.js'
import { authorize, bootstrap, canOpenBrowser } from '../oauth.js'
import { CliError, EXIT } from '../errors.js'

const DEFAULT_REDIRECT_PORT = 8637

async function ask(question, { secret = false } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY === true })
  const answer = rl.question(question)
  if (secret && process.stdin.isTTY) rl._writeToOutput = () => {}
  const value = (await answer).trim()
  rl.close()
  if (secret) process.stderr.write('\n')
  return value
}

async function whoami(url, token) {
  const response = await fetch(`${url}/api/users/me?fields=login,fullName`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new CliError(`That token was rejected by ${url} (${response.status}).`, EXIT.AUTH)
  }
  return response.json()
}

export async function login(argv) {
  const { values } = parse(argv, {
    url: { type: 'string' },
    token: { type: 'boolean' },
    'client-id': { type: 'string' },
    scope: { type: 'string' },
    port: { type: 'string' },
    status: { type: 'boolean' },
  })

  const configured = process.env.YT_URL || readConfig().url
  const url = normalizeUrl(values.url || configured || (await ask('YouTrack URL: ')))
  if (!url) throw new CliError('A YouTrack instance URL is required.')

  if (values.status) {
    const { source } = await resolveCredential(url)
    print(`${url}\ncredential: ${source}`)
    return
  }

  if (!values.url && !configured) {
    const config = readConfig()
    config.url = url
    writeConfig(config)
  }

  const stored = instanceConfig(url)
  const port = Number(values.port ?? stored.redirectPort ?? 0)

  if (values.token || (!canOpenBrowser() && !values['client-id'] && !stored.clientId)) {
    const token = await ask('Permanent token: ', { secret: true })
    if (!token) throw new CliError('No token entered.')
    const user = await whoami(url, token)
    await writeCredential(url, { token })
    saveInstanceConfig(url, {})
    return print(`Logged in to ${url} as ${user.login} ${dim('(token in the OS keychain)')}`)
  }

  let clientId = values['client-id'] || stored.clientId
  let scope = values.scope || stored.scope
  let redirectPort = port

  if (!clientId) {
    process.stderr.write(
      `First login to ${url}. A permanent token is needed once, to register this CLI as an OAuth client.\n` +
        'It is used for that single call and never stored.\n',
    )
    const token = await ask('Permanent token: ', { secret: true })
    if (!token) throw new CliError('No token entered.')
    redirectPort = port || DEFAULT_REDIRECT_PORT
    const registered = await bootstrap({ url, token, redirectPort })
    clientId = registered.clientId
    scope = registered.scope
    saveInstanceConfig(url, { clientId, scope, redirectPort })
  } else if (!scope) {
    throw new CliError(
      'No OAuth scope recorded for this instance. Pass --scope <YouTrack service id>, ' +
        'or run `yt login` without --client-id to bootstrap one.',
    )
  } else if (values['client-id']) {
    saveInstanceConfig(url, { clientId, scope, redirectPort })
  }

  const tokens = await authorize({ url, clientId, scope, port: redirectPort })
  if (!tokens.refresh_token) {
    throw new CliError('YouTrack returned no refresh token. Register the client with offline access.', EXIT.AUTH)
  }
  await writeCredential(url, {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  })

  const user = await whoami(url, tokens.access_token)
  print(`Logged in to ${url} as ${user.login} ${dim('(refresh token in the OS keychain)')}`)
}

export async function logout(argv) {
  const { values } = parse(argv, { url: { type: 'string' } })
  const url = normalizeUrl(values.url || process.env.YT_URL || readConfig().url || '')
  if (!url) throw new CliError('No instance configured; nothing to log out of.')
  const removed = await deleteCredential(url)
  print(removed ? `Logged out of ${url}` : `No stored credential for ${url}`)
}
