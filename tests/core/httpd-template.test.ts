import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from '../../src/core/templates.ts'
import { TEMPLATES_DIR } from '../../src/core/context.ts'

test('httpd.conf declares the localhost vhost before site includes so unknown hosts never hit a site', async () => {
  const tpl = await readFile(join(TEMPLATES_DIR, 'httpd.conf.tpl'), 'utf8')
  const conf = render(tpl, {
    serverRoot: '/h', run: '/h/run', logs: '/h/logs', www: '/h/www', sitesEtc: '/h/etc/sites', mimeTypes: '/etc/mime.types',
    httpPort: 8080, httpsPort: 8443, tls: false, modules: [{ name: 'dir_module', path: '/m/mod_dir.so' }], phpSocket: '/h/run/php.sock',
    localhostCert: '', localhostKey: '',
  })
  const vhost = conf.indexOf('<VirtualHost 127.0.0.1:8080>')
  const include = conf.indexOf('IncludeOptional')
  assert.ok(vhost > -1 && include > vhost, 'localhost vhost must precede IncludeOptional')
  assert.ok(conf.includes('ServerName localhost'))
  assert.ok(conf.includes('Listen 127.0.0.1:8080'))
  assert.ok(!conf.includes('Listen 127.0.0.1:8443'), 'no https listener without tls')
  assert.ok(conf.includes('LoadModule dir_module "/m/mod_dir.so"'))
})
