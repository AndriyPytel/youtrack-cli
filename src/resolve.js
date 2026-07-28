import { CliError, EXIT } from './errors.js'

export async function projectId(api, shortName) {
  const projects = await api.request('/api/admin/projects', {
    query: { fields: 'id,shortName', $top: 1000 },
  })
  const project = projects.find((candidate) => candidate.shortName === shortName)
  if (!project) throw new CliError(`No such project: ${shortName}`, EXIT.NOT_FOUND)
  return project.id
}

// Every bundle type's url segment is its `$type` without the suffix, except this one.
const BUNDLE_PATHS = { OwnedBundle: 'ownedField' }

/** A named field of a project, the bundle behind it and the values already in it. */
export async function fieldBundle(api, shortName, fieldName) {
  const id = await projectId(api, shortName)
  const fields = await api.request(`/api/admin/projects/${id}/customFields`, {
    query: { fields: 'field(id,name),bundle($type,id,values(id,name,ordinal,archived,isResolved))', $top: 200 },
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
