import { CliError, EXIT } from './errors.js'

/** The database id behind a name the user typed. */
async function lookup(api, path, field, value, what) {
  const items = await api.collect(path, { query: { fields: `id,${field}` } })
  const found = items.find((item) => item[field] === value)
  if (!found) throw new CliError(`No such ${what}: ${value}`, EXIT.NOT_FOUND)
  return found.id
}

export const projectId = (api, shortName) => lookup(api, '/api/admin/projects', 'shortName', shortName, 'project')
export const userId = (api, login) => lookup(api, '/api/users', 'login', login, 'user')
export const organizationId = (api, name) =>
  lookup(api, '/api/admin/organizations', 'name', name, 'organization')

// Every bundle type's url segment is its `$type` without the suffix, except this one.
const BUNDLE_PATHS = { OwnedBundle: 'ownedField' }

/** A named field of a project, the bundle behind it and the values already in it. */
export async function fieldBundle(api, shortName, fieldName) {
  const id = await projectId(api, shortName)
  const fields = await api.collect(`/api/admin/projects/${id}/customFields`, {
    query: { fields: 'field(id,name),bundle($type,id,values(id,name,ordinal,archived,isResolved))' },
  })
  const found = fields.find((candidate) => candidate.field?.name === fieldName)
  if (!found?.bundle) {
    const withValues = fields.filter((candidate) => candidate.bundle).map((candidate) => candidate.field.name)
    throw new CliError(
      `Project ${shortName} has no ${fieldName} field.` +
        (withValues.length > 0 ? ` Fields with a value set: ${withValues.join(', ')}.` : ''),
      EXIT.NOT_FOUND,
    )
  }
  const type = found.bundle.$type || 'Bundle'
  return {
    projectId: id,
    fieldId: found.field.id,
    bundleId: found.bundle.id,
    bundlePath: BUNDLE_PATHS[type] || type.replace('Bundle', '').toLowerCase(),
    values: found.bundle.values || [],
  }
}

export const stateBundle = (api, shortName) => fieldBundle(api, shortName, 'State')

/** Which projects share a bundle — a value added here shows up in all of them. */
export async function bundleProjects(api, fieldId, bundleId) {
  const field = await api.request(`/api/admin/customFieldSettings/customFields/${fieldId}`, {
    query: { fields: 'instances(project(shortName),bundle(id))' },
  })
  return (field?.instances || [])
    .filter((instance) => instance.bundle?.id === bundleId)
    .map((instance) => instance.project?.shortName)
    .filter(Boolean)
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
