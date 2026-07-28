#!/usr/bin/env node
// Opt-in. Runs against a real instance, creates one issue, and deletes it again.
//   YT_URL=… YT_TOKEN=… YT_PROJECT=DEMO npm run test:live
import { openSession } from '../src/session.js'
import { projectId } from '../src/resolve.js'

if (!process.env.YT_URL || !process.env.YT_TOKEN) {
  console.log('live smoke skipped — set YT_URL and YT_TOKEN to run it')
  process.exit(0)
}

const project = process.env.YT_PROJECT
if (!project) {
  console.log('live smoke skipped — set YT_PROJECT to the project to write into')
  process.exit(0)
}

const { api, url } = await openSession()
const step = (name, value) => console.log(`ok   ${name}${value ? `  ${value}` : ''}`)
let created

try {
  const me = await api.request('/api/users/me', { query: { fields: 'login' } })
  step('auth', `${url} as ${me.login}`)

  const issues = await api.request('/api/issues', {
    query: { fields: 'idReadable,summary,customFields(name,value(name))', customFields: ['State'], $top: 3 },
  })
  step('ls', `${issues.length} issues`)

  created = await api.request('/api/issues', {
    method: 'POST',
    query: { fields: 'idReadable' },
    body: { project: { id: await projectId(api, project) }, summary: 'yt live smoke', description: 'delete me' },
  })
  step('new', created.idReadable)

  await api.request(`/api/issues/${created.idReadable}/comments`, {
    method: 'POST',
    query: { fields: 'id' },
    body: { text: 'live smoke' },
  })
  step('comment')

  const assist = await api.request('/api/commands/assist', {
    method: 'POST',
    query: { fields: 'commands(description,error)' },
    body: { query: 'state Open', issues: [{ idReadable: created.idReadable }] },
  })
  step('cmd --dry-run', JSON.stringify(assist.commands))
} finally {
  if (created) {
    await api.request(`/api/issues/${created.idReadable}`, { method: 'DELETE' })
    step('cleanup', `deleted ${created.idReadable}`)
  }
}
