/**
 * Minimal template renderer for config files.
 * Supports {{key}}, {{#if key}}...{{/if}}, {{#unless key}}...{{/unless}} and
 * {{#each key}}...{{/each}} (items are objects; {{.}} is the item itself).
 * Missing keys throw so a typo never ships a half-rendered config.
 */
export type TemplateValue = string | number | boolean | null | undefined | TemplateValue[] | { [key: string]: TemplateValue }
export type TemplateVars = Record<string, TemplateValue>

export class TemplateError extends Error {}

const SECTION = /\{\{#(if|unless|each)\s+([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/

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
  for (let match = SECTION.exec(out); match !== null; match = SECTION.exec(out)) {
    const [whole, kind, key, body] = match as unknown as [string, string, string, string]
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
    out = out.slice(0, match.index) + replacement + out.slice(match.index + whole.length)
  }
  return out.replace(/\{\{([\w.]+)\}\}/g, (_, key: string) => {
    const value = lookup(vars, key)
    if (value === null || value === undefined) throw new TemplateError(`Template variable "${key}" is null`)
    if (typeof value === 'object') throw new TemplateError(`Template variable "${key}" is not a scalar`)
    return String(value)
  })
}
