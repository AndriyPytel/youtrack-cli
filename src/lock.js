import { mkdirSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { CliError, EXIT } from './errors.js'

const STALE_MS = 30_000
const WAIT_MS = 15_000

/**
 * Cross-process lock. A directory is the atomic primitive available everywhere;
 * one left behind by a killed process expires rather than deadlocking.
 */
export async function withLock(key, fn, { staleMs = STALE_MS } = {}) {
  const path = join(tmpdir(), `youtrack-cli-${createHash('sha256').update(key).digest('hex').slice(0, 16)}.lock`)
  const deadline = Date.now() + WAIT_MS
  let held = false

  while (!held) {
    try {
      mkdirSync(path)
      held = true
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const age = Date.now() - (statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0)
      // Only a stale lock is broken. Breaking a live one on timeout would let
      // two holders run, and the loser's cleanup would free the winner's lock.
      if (age > staleMs) {
        rmSync(path, { recursive: true, force: true })
      } else if (Date.now() > deadline) {
        throw new CliError('Timed out waiting for another `yt` process to finish refreshing.', EXIT.AUTH)
      } else {
        await sleep(50)
      }
    }
  }

  try {
    return await fn()
  } finally {
    rmSync(path, { recursive: true, force: true })
  }
}
