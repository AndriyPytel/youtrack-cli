import { CliError, EXIT } from './errors.js'

/**
 * `customFields` and friends are repeated query parameters. Comma-joining them
 * returns HTTP 200 with an empty array — silently wrong. Arrays repeat here.
 */
export function buildQuery(params = {}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== null) search.append(key, String(item))
    }
  }
  const string = search.toString()
  return string ? `?${string}` : ''
}

async function describe(response) {
  const text = await response.text().catch(() => '')
  try {
    const body = JSON.parse(text)
    return body.error_description || body.error || body.message || text
  } catch {
    return text.slice(0, 200)
  }
}

/**
 * @param {object} options
 * @param {string} options.url instance base url
 * @param {() => Promise<string>} options.token current bearer token
 * @param {(() => Promise<string|null>)} [options.refresh] called once on 401
 */
export function createApi({ url, token, refresh }) {
  async function send(path, { method = 'GET', query, body, form, bearer }) {
    const headers = { Accept: 'application/json', Authorization: `Bearer ${bearer}` }
    let payload = form
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    return fetch(`${url}${path}${buildQuery(query)}`, { method, headers, body: payload })
  }

  return {
    url,
    async request(path, options = {}) {
      let bearer = await token()
      let response = await send(path, { ...options, bearer })

      if (response.status === 401 && refresh) {
        const renewed = await refresh()
        if (renewed) {
          bearer = renewed
          response = await send(path, { ...options, bearer })
        }
      }

      if (response.status === 401 || response.status === 403) {
        throw new CliError(
          `Authentication failed (${response.status}). Run \`yt login\` or set YT_TOKEN.`,
          EXIT.AUTH,
        )
      }
      if (response.status === 404) {
        throw new CliError(options.notFound || `Not found: ${path}`, EXIT.NOT_FOUND)
      }
      if (!response.ok) {
        throw new CliError(`YouTrack ${response.status}: ${await describe(response)}`, EXIT.USAGE)
      }

      const text = await response.text()
      return text ? JSON.parse(text) : null
    },
  }
}
