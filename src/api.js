import { CliError, EXIT } from './errors.js'

const PAGE = 200

/**
 * `customFields` and friends are repeated query parameters. Comma-joining them
 * returns HTTP 200 with an empty array — silently wrong. Arrays repeat here.
 */
export function buildQuery(params = {}) {
  const search = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) =>
      [value].flat().filter((item) => item !== undefined && item !== null).map((item) => [key, String(item)]),
    ),
  ).toString()
  return search ? `?${search}` : ''
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

  async function request(path, options = {}) {
    let bearer = await token()
    let response = await send(path, { ...options, bearer })

    if (response.status === 401 && refresh) {
      const renewed = await refresh()
      if (renewed) {
        bearer = renewed
        response = await send(path, { ...options, bearer })
      }
    }

    if (response.status === 401) {
      throw new CliError('Authentication failed (401). Run `yt login` or set YT_TOKEN.', EXIT.AUTH)
    }
    // 403 is a valid credential without the permission — saying "run yt login" sends people the wrong way.
    if (response.status === 403) {
      throw new CliError(`Permission denied (403): ${await describe(response)}`.trim(), EXIT.AUTH)
    }
    if (response.status === 404) {
      throw new CliError(options.notFound || `Not found: ${path}`, EXIT.NOT_FOUND)
    }
    if (!response.ok) {
      throw new CliError(`YouTrack ${response.status}: ${await describe(response)}`, EXIT.USAGE)
    }

    const text = await response.text()
    return text ? JSON.parse(text) : null
  }

  /**
   * Every page of a collection, stitched. A list read past its window is not a
   * shorter list — `find` over it answers "no such thing" about something that
   * exists — so anything a decision is made from comes through here.
   *
   * The loop ends on a short page. That is only sound while the server honours
   * `$skip`; one that does not sends the same page forever, so an identical
   * first row aborts instead of looping.
   */
  async function collect(path, options = {}, page = PAGE) {
    const items = []
    let previous
    for (let skip = 0; ; skip += page) {
      const batch = await request(path, { ...options, query: { ...options.query, $top: page, $skip: skip } })
      // An object-shaped endpoint has no pages to walk, and looping on one never ends.
      if (!Array.isArray(batch)) return batch
      if (batch.length === 0) break
      const signature = JSON.stringify(batch[0])
      if (signature === previous) {
        throw new CliError(
          `${path} ignored $skip: page ${skip / page + 1} repeats page ${skip / page}. ` +
            'Paging is not possible against this endpoint.',
          EXIT.USAGE,
        )
      }
      previous = signature
      items.push(...batch)
      if (batch.length < page) break
    }
    return items
  }

  return { url, request, collect }
}
