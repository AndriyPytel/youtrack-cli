import { parseArgs } from 'node:util'
import { CliError } from './errors.js'

export function parse(argv, options = {}) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: true, strict: true })
  } catch (error) {
    throw new CliError(error.message)
  }
}

export const jsonFlag = { json: { type: 'boolean' } }
export const fieldsFlag = { fields: { type: 'string' } }
