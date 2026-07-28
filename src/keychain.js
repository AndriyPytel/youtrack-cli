import { normalizeUrl } from './config.js'
import { CliError, EXIT } from './errors.js'

const SERVICE = 'youtrack-cli'

const NO_KEYCHAIN =
  'No OS keychain is available here. Export YT_TOKEN=<permanent token> instead.'

async function entry(url) {
  try {
    const { Entry } = await import('@napi-rs/keyring')
    return new Entry(SERVICE, normalizeUrl(url))
  } catch {
    throw new CliError(NO_KEYCHAIN, EXIT.AUTH)
  }
}

/** @returns {Promise<{token?: string, refreshToken?: string} | null>} */
export async function readCredential(url) {
  try {
    const raw = (await entry(url)).getPassword()
    return raw ? JSON.parse(raw) : null
  } catch (error) {
    if (error instanceof CliError) throw error
    return null
  }
}

export async function writeCredential(url, credential) {
  try {
    ;(await entry(url)).setPassword(JSON.stringify(credential))
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(NO_KEYCHAIN, EXIT.AUTH)
  }
}

export async function deleteCredential(url) {
  try {
    return (await entry(url)).deletePassword()
  } catch {
    return false
  }
}
