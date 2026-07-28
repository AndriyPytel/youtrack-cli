import { createServer } from 'node:http'

const ISSUES = {
  'DEMO-1': {
    idReadable: 'DEMO-1',
    summary: 'Launch YouTrack',
    description: 'The first issue.',
    reporter: { login: 'root', fullName: 'Root' },
    customFields: [
      { name: 'State', value: { name: 'Done' } },
      { name: 'Assignee', value: { login: 'root', fullName: 'Root' } },
    ],
  },
  'DEMO-4': {
    idReadable: 'DEMO-4',
    summary: 'Create a demo project',
    description: '',
    reporter: { login: 'root', fullName: 'Root' },
    customFields: [{ name: 'State', value: { name: 'In Progress' } }],
  },
}

const json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks)
  const type = request.headers['content-type'] || ''
  if (type.includes('application/json')) return JSON.parse(raw.toString() || '{}')
  if (type.includes('x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw.toString()))
  return raw
}

/**
 * A YouTrack that is wrong in the same ways the real one is: rejects the wrong
 * token with 401, 404s unknown ids, and records every raw URL so tests can
 * assert on the query string that was actually sent.
 */
export async function startFakeYouTrack({ token = 'test-token', accessTokens = [] } = {}) {
  const requests = []
  const state = {
    issues: structuredClone(ISSUES),
    comments: { 'DEMO-1': [{ id: '1-1', text: 'first', created: 1_700_000_000_000, author: { login: 'root' } }] },
    articles: {
      'DEMO-A-1': {
        id: '3-1',
        idReadable: 'DEMO-A-1',
        summary: 'Runbook',
        content: '# Runbook\nhow to ship',
        ordinal: 0,
        project: { shortName: 'DEMO' },
      },
      'DEMO-A-2': {
        id: '3-2',
        idReadable: 'DEMO-A-2',
        summary: 'Deploying',
        content: 'steps',
        ordinal: 1,
        parentArticle: { idReadable: 'DEMO-A-1' },
        project: { shortName: 'DEMO' },
      },
      'OPS-A-1': {
        id: '3-3',
        idReadable: 'OPS-A-1',
        summary: 'Export pipeline',
        content: 'ops',
        ordinal: 0,
        project: { shortName: 'OPS' },
      },
    },
    states: [
      { id: 's-1', name: 'Open', ordinal: 0 },
      { id: 's-2', name: 'In Progress', ordinal: 1 },
      { id: 's-3', name: 'Done', ordinal: 2, isResolved: true },
    ],
    // Shared with OPS, like the stock Type field on a real instance.
    types: [
      { id: 't-1', name: 'Bug', ordinal: 0 },
      { id: 't-2', name: 'Task', ordinal: 1 },
      { id: 't-3', name: 'Epic', ordinal: 2, archived: true },
    ],
    agiles: [],
    counter: 100,
    refreshCount: 0,
    accepted: new Set([token, ...accessTokens]),
    cimd: true,
    scopes: ['svc-yt'],
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const path = url.pathname
    const body = await readBody(request)
    requests.push({ method: request.method, url: request.url, path, body, authorization: request.headers.authorization })

    if (path === '/.well-known/oauth-protected-resource/mcp') {
      return json(response, 200, { resource: `${url.origin}/mcp`, scopes_supported: state.scopes })
    }

    if (path === '/hub/api/rest/oauth2/.well-known/openid-configuration') {
      return json(response, 200, { client_id_metadata_document_supported: state.cimd })
    }

    if (path === '/hub/api/rest/oauth2/token') {
      state.refreshCount += 1
      if (body.refresh_token === 'revoked') {
        return json(response, 400, { error: 'invalid_grant', error_description: 'refresh token revoked' })
      }
      const access = `access-${state.refreshCount}`
      state.accepted.add(access)
      return json(response, 200, {
        access_token: access,
        refresh_token: `rotated-${state.refreshCount}`,
        expires_in: 3600,
      })
    }

    const bearer = (request.headers.authorization || '').replace('Bearer ', '')
    if (state.rejectAll || !state.accepted.has(bearer)) return json(response, 401, { error: 'Unauthorized' })

    if (path === '/api/users/me') return json(response, 200, { login: 'root', fullName: 'Root' })

    if (path === '/hub/api/rest/services') {
      if (request.method === 'GET') {
        return json(response, 200, {
          services: [
            { id: 'svc-hub', name: 'Hub', applicationName: 'Hub' },
            { id: 'svc-yt', name: 'YouTrack', applicationName: 'YouTrack' },
          ],
        })
      }
      if (bearer === 'no-admin') return json(response, 403, { error: 'Forbidden' })
      state.registered = body
      return json(response, 200, { id: 'client-1', name: body.name, redirectUris: body.redirectUris })
    }

    if (path === '/api/issues' && request.method === 'GET') {
      const query = url.searchParams.get('query')
      const issues = Object.values(state.issues).filter((issue) => !query || issue.summary.includes(query))
      return json(response, 200, issues)
    }
    if (path === '/api/issues' && request.method === 'POST') {
      const id = `DEMO-${(state.counter += 1)}`
      state.issues[id] = { idReadable: id, summary: body.summary, description: body.description, customFields: [] }
      return json(response, 200, { idReadable: id })
    }

    const issueMatch = path.match(/^\/api\/issues\/([^/]+)(\/(comments|attachments))?$/)
    if (issueMatch) {
      const [, id, , sub] = issueMatch
      const issue = state.issues[id]
      if (!issue) return json(response, 404, { error: 'Not Found' })
      if (!sub && request.method === 'GET') return json(response, 200, issue)
      if (!sub && request.method === 'POST') {
        if (body.summary !== undefined) issue.summary = body.summary
        if (body.description !== undefined) issue.description = body.description
        return json(response, 200, { idReadable: id })
      }
      if (sub === 'comments' && request.method === 'GET') return json(response, 200, state.comments[id] || [])
      if (sub === 'comments' && request.method === 'POST') {
        const comment = { id: `${id}-c`, text: body.text, created: 1_700_000_100_000, author: { login: 'root' } }
        ;(state.comments[id] ??= []).push(comment)
        return json(response, 200, comment)
      }
      if (sub === 'attachments' && request.method === 'POST') {
        return json(response, 200, [{ id: 'a-1', name: 'uploaded', size: body.length }])
      }
    }

    if (path === '/api/commands/assist') {
      if (body.query.includes('nonsense')) {
        return json(response, 200, { commands: [{ description: '{color:red}no such field{color}', error: true }] })
      }
      return json(response, 200, { commands: [{ description: `applies <b>${body.query}</b>`, error: false }] })
    }
    if (path === '/api/commands') {
      if (body.query.includes('nonsense')) return json(response, 400, { error_description: 'Command not parsed' })
      state.applied = body
      return json(response, 200, {})
    }

    if (path === '/api/admin/projects') {
      return json(response, 200, [
        { id: '0-0', shortName: 'DEMO' },
        { id: '0-1', shortName: 'OPS' },
      ])
    }

    const stateField = () => ({ field: { id: 'f-1', name: 'State' }, bundle: { $type: 'StateBundle', id: 'b-1', values: state.states } })
    const typeField = () => ({ field: { id: 'f-2', name: 'Type' }, bundle: { $type: 'EnumBundle', id: 'b-2', values: state.types } })
    const projectFields = { '0-0': () => [stateField(), typeField()], '0-1': () => [typeField()] }

    const projectShortNames = { '0-0': 'DEMO', '0-1': 'OPS' }
    const projectArticles = path.match(/^\/api\/admin\/projects\/([^/]+)\/articles$/)
    if (projectArticles) {
      const shortName = projectShortNames[projectArticles[1]]
      if (!shortName) return json(response, 404, { error: 'Not Found' })
      return json(
        response,
        200,
        Object.values(state.articles).filter((article) => article.project?.shortName === shortName),
      )
    }

    const fieldsMatch = path.match(/^\/api\/admin\/projects\/([^/]+)\/customFields$/)
    if (fieldsMatch) {
      const fields = projectFields[fieldsMatch[1]]
      if (!fields) return json(response, 404, { error: 'Not Found' })
      return json(response, 200, fields())
    }

    // A bundle belongs to every project whose field instance points at it.
    if (path === '/api/admin/customFieldSettings/customFields/f-1') {
      return json(response, 200, { instances: [{ project: { shortName: 'DEMO' }, bundle: { id: 'b-1' } }] })
    }
    if (path === '/api/admin/customFieldSettings/customFields/f-2') {
      return json(response, 200, {
        instances: [
          { project: { shortName: 'DEMO' }, bundle: { id: 'b-2' } },
          { project: { shortName: 'OPS' }, bundle: { id: 'b-2' } },
        ],
      })
    }

    const bundles = { 'b-1': state.states, 'b-2': state.types }
    const valueMatch = path.match(/^\/api\/admin\/customFieldSettings\/bundles\/\w+\/([^/]+)\/values(?:\/([^/]+))?$/)
    if (valueMatch && request.method === 'POST') {
      const [, bundleId, valueId] = valueMatch
      const list = bundles[bundleId]
      if (!list) return json(response, 404, { error: 'Not Found' })
      if (!valueId) {
        const added = { id: `v-${(state.counter += 1)}`, ordinal: list.length, ...body }
        list.push(added)
        return json(response, 200, added)
      }
      const value = list.find((candidate) => candidate.id === valueId)
      if (!value) return json(response, 404, { error: 'Not Found' })
      Object.assign(value, body)
      list.sort((left, right) => left.ordinal - right.ordinal)
      return json(response, 200, value)
    }

    if (path === '/api/agiles' && request.method === 'GET') return json(response, 200, state.agiles)
    if (path === '/api/agiles' && request.method === 'POST') {
      // Like the real API: `presentation` is derived from the field values a
      // column holds. A column sent without them produces an unusable board.
      const columns = (body.columnSettings?.columns || []).map((column) => ({
        fieldValues: column.fieldValues || [],
        presentation: (column.fieldValues || []).map((value) => value.name).join(', '),
      }))
      if (columns.some((column) => column.fieldValues.length === 0)) {
        return json(response, 400, { error_description: 'A column must reference at least one field value' })
      }
      const board = {
        id: `a-${state.agiles.length + 1}`,
        ...body,
        columnSettings: { ...body.columnSettings, columns },
        projects: (body.projects || []).map((project) => ({ ...project, shortName: 'DEMO' })),
      }
      state.agiles.push(board)
      return json(response, 200, board)
    }

    if (path === '/api/articles' && request.method === 'GET') return json(response, 200, Object.values(state.articles))
    if (path === '/api/articles' && request.method === 'POST') {
      const id = `DEMO-A-${(state.counter += 1)}`
      state.articles[id] = { id: `3-${state.counter}`, idReadable: id, ...body }
      return json(response, 200, { idReadable: id })
    }
    const articleMatch = path.match(/^\/api\/articles\/([^/]+)$/)
    if (articleMatch) {
      const article = state.articles[articleMatch[1]]
      if (!article) return json(response, 404, { error: 'Not Found' })
      if (request.method === 'POST') article.content = body.content
      return json(response, 200, article)
    }

    return json(response, 404, { error: 'Not Found' })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    state,
    stop: () => new Promise((resolve) => server.close(resolve)),
  }
}
