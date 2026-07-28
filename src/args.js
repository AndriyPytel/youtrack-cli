import { parseArgs } from 'node:util'

export function parse(argv, options = {}) {
  return parseArgs({ args: argv, options, allowPositionals: true, strict: true })
}

export const jsonFlag = { json: { type: 'boolean' } }
export const fieldsFlag = { fields: { type: 'string' } }
