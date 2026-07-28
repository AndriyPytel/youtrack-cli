import { instanceConfig, resolveUrl } from './config.js'
import { readCredential, writeCredential } from './keychain.js'
import { refreshTokens } from './oauth.js'
import { withLock } from './lock.js'
import { createApi } from './api.js'
import { CliError, EXIT } from './errors.js'

const SKEW_MS = 30_000

/**
 * Credential resolution: keychain first, then YT_TOKEN.
 * @returns {Promise<{source: string, credential: object|null}>}
 */
export async function resolveCredential(url) {
  let credential = null
  try {
    credential = await readCredential(url)
  } catch (error) {
    if (!process.env.YT_TOKEN) throw error
  }
  if (credential?.refreshToken) return { source: 'keychain (OAuth)', credential }
  if (credential?.token) return { source: 'keychain (token)', credential }
  if (process.env.YT_TOKEN) return { source: 'YT_TOKEN', credential: { token: process.env.YT_TOKEN } }
  return { source: 'none', credential: null }
}

/**
 * @param {string} url
 * @param {{read: Function, write: Function}} [store] credential store — swapped in tests
 */
export function oauthTokens(url, store = { read: readCredential, write: writeCredential }) {
  const { clientId } = instanceConfig(url)
  let inMemory = null

  // The access token is kept in the keychain, not in memory only: concurrent
  // agent invocations must be able to reuse one refresh rather than each
  // rotating the refresh token (issue #7). It still never touches disk.
  async function renew(failedToken) {
    return withLock(`youtrack-cli:refresh:${url}`, async () => {
      const stored = await store.read(url)
      if (!stored?.refreshToken) {
        throw new CliError('Not logged in on this instance. Run `yt login`.', EXIT.AUTH)
      }
      // Another process may have refreshed while we waited for the lock.
      const usable =
        stored.accessToken &&
        stored.accessToken !== failedToken &&
        (stored.expiresAt ?? 0) > Date.now() + SKEW_MS
      if (usable) {
        inMemory = stored.accessToken
        return inMemory
      }

      let tokens
      try {
        tokens = await refreshTokens({ url, clientId, refreshToken: stored.refreshToken })
      } catch (error) {
        throw new CliError(
          `Your session is no longer valid (${error.message}). Run \`yt login\` again.`,
          EXIT.AUTH,
        )
      }
      await store.write(url, {
        refreshToken: tokens.refresh_token || stored.refreshToken,
        accessToken: tokens.access_token,
        expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      })
      inMemory = tokens.access_token
      return inMemory
    })
  }

  return {
    async token() {
      if (inMemory) return inMemory
      const stored = await store.read(url)
      if (stored?.accessToken && (stored.expiresAt ?? 0) > Date.now() + SKEW_MS) {
        inMemory = stored.accessToken
        return inMemory
      }
      return renew(null)
    },
    async refresh() {
      return renew(inMemory)
    },
  }
}

/** Builds the API client for the resolved instance and credential. */
export async function openSession(options = {}) {
  const url = options.url || resolveUrl()
  const { credential, source } = await resolveCredential(url)

  if (!credential) {
    throw new CliError('Not authenticated. Run `yt login`, or export YT_TOKEN.', EXIT.AUTH)
  }
  if (credential.token) {
    return { url, source, api: createApi({ url, token: async () => credential.token }) }
  }

  const tokens = oauthTokens(url)
  return { url, source, api: createApi({ url, token: tokens.token, refresh: tokens.refresh }) }
}
