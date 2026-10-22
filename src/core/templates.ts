/**
 * Minimal template renderer for config files.
 * Supports {{key}}, {{#if key}}...{{/if}}, {{#unless key}}...{{/unless}} and
 * {{#each key}}...{{/each}} (items are objects; {{.}} is the item itself).
 * Missing keys throw so a typo never ships a half-rendered config.
 */
export type TemplateValue = string | number | boolean | null | undefined | TemplateValue[] | { [key: string]: TemplateValue }
export type TemplateVars = Record<string, TemplateValue>

export class TemplateError extends Error {}

const OPEN = /\{\{#(if|unless|each)\s+([\w.]+)\}\}/g

interface Section {
  readonly start: number
  readonly end: number
  readonly kind: string
  readonly key: string
  readonly body: string
}

/** Locate the first section and its matching close tag, honouring nesting of the same kind. */
function findSection(text: string): Section | null {
  OPEN.lastIndex = 0
  const open = OPEN.exec(text)
  if (!open) return null
  const kind = open[1] as string
  const key = open[2] as string
  const bodyStart = open.index + open[0].length
  const tags = new RegExp(`\\{\\{(#${kind}\\s+[\\w.]+|\\/${kind})\\}\\}`, 'g')
  tags.lastIndex = bodyStart
  let depth = 1
  for (let tag = tags.exec(text); tag !== null; tag = tags.exec(text)) {
    depth += (tag[1] as string).startsWith('#') ? 1 : -1
    if (depth === 0) return { start: open.index, end: tag.index + tag[0].length, kind, key, body: text.slice(bodyStart, tag.index) }
  }
  throw new TemplateError(`Unclosed {{#${kind} ${key}}} section`)
}

function lookup(vars: TemplateVars, path: string): TemplateValue {
  if (path === '.') return vars['.']
  let current: TemplateValue = vars
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current) || !(part in current)) {
      throw new TemplateError(`Template variable "${path}" is not defined`)
    }
    current = current[part]
  }
  return current
}

function truthy(value: TemplateValue): boolean {
  if (Array.isArray(value)) return value.length > 0
  return Boolean(value)
}

export function render(template: string, vars: TemplateVars): string {
  let out = template
  for (let section = findSection(out); section !== null; section = findSection(out)) {
    const { kind, key, body } = section
    const value = lookup(vars, key)
    let replacement = ''
    if (kind === 'if' && truthy(value)) replacement = render(body, vars)
    if (kind === 'unless' && !truthy(value)) replacement = render(body, vars)
    if (kind === 'each' && Array.isArray(value)) {
      replacement = value
        .map((item) => {
          const scope: TemplateVars =
            item !== null && typeof item === 'object' && !Array.isArray(item) ? { ...vars, ...item, '.': item } : { ...vars, '.': item }
          return render(body, scope)
        })
        .join('')
    }
    out = out.slice(0, section.start) + replacement + out.slice(section.end)
  }
  return out.replace(/\{\{([\w.]+)\}\}/g, (_, key: string) => {
    const value = lookup(vars, key)
    if (value === null || value === undefined) throw new TemplateError(`Template variable "${key}" is null`)
    if (typeof value === 'object') throw new TemplateError(`Template variable "${key}" is not a scalar`)
    return String(value)
  })
}
