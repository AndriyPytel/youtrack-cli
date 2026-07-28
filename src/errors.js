export const EXIT = { OK: 0, AUTH: 1, NOT_FOUND: 2, REJECTED: 3, USAGE: 4 }

export class CliError extends Error {
  constructor(message, code = EXIT.USAGE) {
    super(message)
    this.code = code
  }
}
