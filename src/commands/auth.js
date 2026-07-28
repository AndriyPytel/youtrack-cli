import { createInterface } from 'node:readline/promises'
import { parse } from '../args.js'
import { print, dim } from '../render.js'
import { normalizeUrl, readConfig, writeConfig } from '../config.js'
import { deleteCredential, writeCredential } from '../keychain.js'
import { resolveCredential } from '../session.js'
import { authorize, canOpenBrowser, CLIENT_ID, discoverScope, openBrowser, REDIRECT_PORT } from '../oauth.js'
import { CliError, EXIT } from '../errors.js'

async function ask(question, { secret = false } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY === true })
  const answer = rl.question(question)
  if (secret && process.stdin.isTTY) rl._writeToOutput = () => {}
  const value = (await answer).trim()
  rl.close()
  if (secret) process.stderr.write('\n')
  return value
}

async function askToken(url) {
  const page = `${url}/users/me?tab=account-security`
  if (canOpenBrowser()) {
    process.stderr.write(`Opening ${page} — create a token there with the YouTrack scope.\n`)
    openBrowser(page)
  } else {
    process.stderr.write(`Create a token at ${page}\n`)
  }
  const token = await ask('Permanent token: ', { secret: true })
  if (!token) throw new CliError('No token entered.')
  return token
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

  if (values.token || !canOpenBrowser()) {
    const token = await askToken(url)
    const user = await whoami(url, token)
    await writeCredential(url, { token })
    return print(`Logged in to ${url} as ${user.login} ${dim('(token in the OS keychain)')}`)
  }

  const scope = await discoverScope(url)
  const tokens = await authorize({ url, clientId: CLIENT_ID, scope, port: REDIRECT_PORT })
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
