#!/usr/bin/env node
// Opt-in. Runs against a real instance. Everything it creates is removed again,
// except the account — a user cannot be deleted through REST, only banned.
//   YT_URL=… YT_TOKEN=… YT_PROJECT=DEMO npm run test:live
import { randomBytes } from 'node:crypto'
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
// Short names have to be unique on the instance and survive a half-cleaned run.
const stamp = Date.now().toString(36).toUpperCase().slice(-5)
let created
let newProject
let newOrganization
let newUser

try {
  const me = await api.request('/api/users/me', { query: { fields: 'id,login' } })
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

  newOrganization = await api.request('/api/admin/organizations', {
    method: 'POST',
    query: { fields: 'id,name' },
    body: { name: `yt live smoke ${stamp}` },
  })
  step('org new', newOrganization.name)

  newProject = await api.request('/api/admin/projects', {
    method: 'POST',
    query: { fields: 'id,shortName,organization(name)' },
    body: {
      name: `yt live smoke ${stamp}`,
      shortName: `YTLS${stamp}`,
      leader: { id: me.id },
      organization: { id: newOrganization.id },
    },
  })
  step('project new', `${newProject.shortName} in ${newProject.organization?.name}`)

  newUser = await api.request('/api/users', {
    method: 'POST',
    query: { fields: 'id,login' },
    body: { login: `ytls${stamp}`, password: randomBytes(18).toString('base64url') },
  })
  step('user new', newUser.login)
} finally {
  if (created) {
    await api.request(`/api/issues/${created.idReadable}`, { method: 'DELETE' })
    step('cleanup', `deleted ${created.idReadable}`)
  }
  if (newProject) {
    await api.request(`/api/admin/projects/${newProject.id}`, { method: 'DELETE' })
    step('cleanup', `deleted ${newProject.shortName}`)
  }
  if (newOrganization) {
    await api.request(`/api/admin/organizations/${newOrganization.id}`, { method: 'DELETE' })
    step('cleanup', `deleted ${newOrganization.name}`)
  }
  // A user cannot be deleted through the REST API — banning is the only cleanup.
  if (newUser) {
    await api.request(`/api/users/${newUser.id}`, { method: 'POST', query: { fields: 'id' }, body: { banned: true } })
    step('cleanup', `banned ${newUser.login}`)
  }
}
