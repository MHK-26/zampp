import { test } from 'node:test'
import assert from 'node:assert/strict'
import { render, TemplateError } from '../../src/core/templates.ts'

test('renders scalar variables', () => {
  assert.equal(render('Listen {{host}}:{{port}}', { host: '127.0.0.1', port: 80 }), 'Listen 127.0.0.1:80')
})

test('throws on an undefined variable instead of rendering an empty string', () => {
  assert.throws(() => render('Listen {{port}}', {}), TemplateError)
})

test('if and unless sections', () => {
  const tpl = '{{#if tls}}SSLEngine on{{/if}}{{#unless tls}}# no tls{{/unless}}'
  assert.equal(render(tpl, { tls: true }), 'SSLEngine on')
  assert.equal(render(tpl, { tls: false }), '# no tls')
})

test('each section exposes item fields and the outer scope', () => {
  const tpl = '{{#each sites}}{{name}}.{{tld}}\n{{/each}}'
  const out = render(tpl, { tld: 'test', sites: [{ name: 'a' }, { name: 'b' }] })
  assert.equal(out, 'a.test\nb.test\n')
})

test('each over scalars with {{.}}', () => {
  assert.equal(render('{{#each ports}}Listen {{.}}\n{{/each}}', { ports: [80, 443] }), 'Listen 80\nListen 443\n')
})

test('nested dotted lookups', () => {
  assert.equal(render('{{web.httpPort}}', { web: { httpPort: 8080 } }), '8080')
})
