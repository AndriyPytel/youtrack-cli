import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'

export function parse(argv, options = {}) {
  return parseArgs({ args: argv, options, allowPositionals: true, strict: true })
}

export const jsonFlag = { json: { type: 'boolean' } }
export const fieldsFlag = { fields: { type: 'string' } }
export const fileFlag = { file: { type: 'string', short: 'f' } }

/** A required body of text: `-f <file>`, the inline flag, or stdin. */
export function textArg(file, inline) {
  if (file) return readFileSync(file, 'utf8')
  if (inline !== undefined) return inline
  return readFileSync(0, 'utf8')
}

/** The same, optional: a terminal has nothing to pipe, so don't block waiting on it. */
export const optionalText = (file, inline) =>
  (file === undefined && inline === undefined && process.stdin.isTTY ? '' : textArg(file, inline)) || undefined
