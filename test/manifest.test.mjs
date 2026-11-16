/** Package identity, the bundle patch row, and Host/browser route parity. */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

test('the manifest describes the renamed bundle', () => {
  assert.equal(packageJson.name, '@msnex/dsh-project-workspace')
  assert.equal(packageJson.private, true)
  assert.equal(packageJson.type, 'module')
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(packageJson.dsh.client.platform, 'web')
  assert.equal(packageJson.dsh.client.immediately, true)
  assert.ok(packageJson.exports['./client'] === './client.js')
  assert.ok(packageJson.exports['./locale/*.json'] === './locale/*.json')
  assert.ok(packageJson.exports['./icon'] === './icon.svg')
  for (const file of ['index.js', 'lib', 'client.js', 'cordis.patch.yml', 'locale', 'icon.svg', 'README.md']) {
    assert.ok(packageJson.files.includes(file), `files is missing ${file}`)
  }
})

test('the browser factory registers under the package name', () => {
  const match = client.match(/__ModuleLoader__\.load\(\{\s*id: '([^']+)'/)
  assert.ok(match !== null, 'missing the Client loader id')
  assert.equal(match[1], packageJson.name)
})

test('the bundle patch mounts this package under the renamed row', () => {
  assert.match(patch, /id: project-workspace/)
  assert.ok(patch.includes(`name: '${packageJson.name}'`))
})

test('every Host route has a browser call site under the renamed prefix', () => {
  const hostRoutes = new Set([...host.matchAll(/'\/api\/project-workspace\.([a-z]+)'/g)].map(match => match[1]))
  const clientRoutes = new Set([...client.matchAll(/'api\/project-workspace\.([a-z]+)'/g)].map(match => match[1]))
  assert.deepEqual([...hostRoutes].sort(), ['browse', 'dir', 'list', 'open', 'references', 'search'])
  assert.deepEqual([...clientRoutes].sort(), [...hostRoutes].sort())
})

test('the browser half registers the project workspace @ source first', () => {
  assert.match(client, /trigger: '@'/)
  assert.match(client, /name: MENTION_SOURCE_NAME/)
  assert.match(client, /order: MENTION_SOURCE_ORDER/)
  assert.match(client, /showGroupTitle: false/)
  assert.match(client, /inputTriggers\.registerSource/)
  assert.match(client, /const MENTION_SOURCE_ORDER = -10/)
  assert.match(client, /drill: true/)
  assert.match(client, /action === 'drill'/)
  assert.match(client, /appearance: 'folder'/)
  assert.match(client, /appearance: 'file'/)
  assert.match(client, /scheduleMentionFocus/)
  assert.match(client, /CORE_REFERENCE_SOURCE/)
  assert.match(client, /controller\.hover\(MENTION_SOURCE_NAME, 0\)/)
})

test('no shipped file mentions the previous package name', () => {
  const sources = {
    'index.js': host,
    'client.js': client,
    'cordis.patch.yml': patch,
    'package.json': JSON.stringify(packageJson),
    'README.md': readFileSync(new URL('../README.md', import.meta.url), 'utf8'),
    ...Object.fromEntries(readdirSync(new URL('../lib/', import.meta.url)).map(name => [
      `lib/${name}`,
      readFileSync(new URL(`../lib/${name}`, import.meta.url), 'utf8'),
    ])),
    ...Object.fromEntries(readdirSync(new URL('../locale/', import.meta.url)).map(name => [
      `locale/${name}`,
      readFileSync(new URL(`../locale/${name}`, import.meta.url), 'utf8'),
    ])),
  }
  for (const [name, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, /codespace/i, `${name} still mentions the previous package name`)
  }
})
