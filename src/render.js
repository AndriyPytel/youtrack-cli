const tty = () => process.stdout.isTTY === true

const paint = (code) => (text) => (tty() ? `[${code}m${text}[0m` : text)

export const cyan = paint(36)
export const dim = paint(2)

/**
 * Aligned columns, no box drawing. Colour is applied after padding so that
 * escape codes never affect the widths.
 * @param {string[][]} rows
 * @param {((cell: string, column: number) => string)} [style]
 */
export function table(rows, style = (cell) => cell) {
  if (rows.length === 0) return ''
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => (row[column] ?? '').length)))
  return rows
    .map((row) =>
      row
        .map((cell, column) =>
          style(column === row.length - 1 ? (cell ?? '') : (cell ?? '').padEnd(widths[column]), column),
        )
        .join('  ')
        .trimEnd(),
    )
    .join('\n')
}

/** The listing look: identifier, then a secondary column, then plain text. */
export const listStyle = (cell, column) => (column === 0 ? cyan(cell) : column === 1 ? dim(cell) : cell)

export function print(text) {
  if (text !== '') process.stdout.write(text + '\n')
}

export function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, tty() ? 2 : 0) + '\n')
}
