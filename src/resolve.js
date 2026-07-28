import { CliError, EXIT } from './errors.js'

export async function projectId(api, shortName) {
  const projects = await api.request('/api/admin/projects', {
    query: { fields: 'id,shortName', $top: 1000 },
  })
  const project = projects.find((candidate) => candidate.shortName === shortName)
  if (!project) throw new CliError(`No such project: ${shortName}`, EXIT.NOT_FOUND)
  return project.id
}

export async function customFieldId(api, name) {
  const fields = await api.request('/api/admin/customFieldSettings/customFields', {
    query: { fields: 'id,name', $top: 1000 },
  })
  const field = fields.find((candidate) => candidate.name === name)
  if (!field) throw new CliError(`No such custom field: ${name}`, EXIT.NOT_FOUND)
  return field.id
}

/** The State field's bundle for a project, with the values already in it. */
export async function stateBundle(api, shortName) {
  const id = await projectId(api, shortName)
  const fields = await api.request(`/api/admin/projects/${id}/customFields`, {
    query: { fields: 'field(id,name),bundle(id,values(name))', $top: 200 },
  })
  const state = fields.find((candidate) => candidate.field?.name === 'State')
  if (!state?.bundle) throw new CliError(`Project ${shortName} has no State field.`, EXIT.NOT_FOUND)
  return { projectId: id, bundleId: state.bundle.id, values: state.bundle.values || [] }
}

export function fieldValue(value) {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(fieldValue).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    return value.name ?? value.fullName ?? value.login ?? value.presentation ?? value.text ?? ''
  }
  return String(value)
}

export function namedField(issue, name) {
  return fieldValue(issue.customFields?.find((field) => field.name === name)?.value)
}
