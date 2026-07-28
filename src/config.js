import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CliError } from './errors.js'

function configDir() {
  return process.env.YT_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'youtrack-cli')
}

const configFile = () => join(configDir(), 'config.json')

export function readConfig() {
  try {
    return JSON.parse(readFileSync(configFile(), 'utf8'))
  } catch {
    return {}
  }
}

export function writeConfig(config) {
  mkdirSync(configDir(), { recursive: true })
  writeFileSync(configFile(), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
}

export function normalizeUrl(url) {
  return url.replace(/\/+$/, '')
}

export function resolveUrl() {
  const url = process.env.YT_URL || readConfig().url
  if (!url) throw new CliError('No YouTrack instance configured. Set YT_URL or run `yt login`.')
  return normalizeUrl(url)
}
