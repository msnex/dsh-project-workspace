/** Locale resources, bilingual key parity, and the project-workspace terminology. */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const localeDirectory = new URL('../locale/', import.meta.url)

/**
 * Parse one client dictionary object.
 * @param name - `en` or `zh`.
 * @returns the copy keyed by message id.
 */
function dictionary(name) {
  const start = source.indexOf(`    const ${name} = {`)
  assert.ok(start >= 0, `missing ${name} dictionary`)
  const end = source.indexOf('\n    }', start)
  assert.ok(end > start, `unterminated ${name} dictionary`)
  const entries = new Map()
  for (const line of source.slice(start, end).split('\n')) {
    const match = line.match(/^\s{6}(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*)):\s*'([^']*)',?\s*$/)
    if (match !== null) entries.set(match[1] ?? match[2], match[3])
  }
  assert.ok(entries.size > 0, `empty ${name} dictionary`)
  return entries
}

const en = dictionary('en')
const zh = dictionary('zh')

/**
 * Every message id the client asks for, including the mapped Host failures.
 * @returns the ids.
 */
function usedKeys() {
  const used = new Set([...source.matchAll(/\bt\('([^']+)'/g)].map(match => match[1]))
  const start = source.indexOf('    const ERROR_KEYS = {')
  const end = source.indexOf('\n    }', start)
  for (const match of source.slice(start, end).matchAll(/:\s*'([^']+)'/g)) {
    if (match[1].startsWith('error.')) used.add(match[1])
  }
  return used
}

test('ships exactly the English and Chinese locale resources', () => {
  const files = readdirSync(localeDirectory).filter(name => name.endsWith('.json')).sort()
  assert.deepEqual(files, ['en.json', 'zh.json'])
  const locales = Object.fromEntries(files.map(name => [name, JSON.parse(readFileSync(new URL(name, localeDirectory), 'utf8'))]))
  for (const [name, value] of Object.entries(locales)) {
    assert.equal(typeof value.meta?.title, 'string', `${name} meta.title`)
    assert.ok(value.meta.title !== '', `${name} meta.title is empty`)
    assert.equal(typeof value.meta?.description, 'string', `${name} meta.description`)
    assert.ok(value.meta.description !== '', `${name} meta.description is empty`)
  }
  assert.equal(locales['en.json'].meta.title, 'Project workspaces')
  assert.match(locales['en.json'].meta.description, /project workspace/i)
  assert.equal(locales['zh.json'].meta.title, '项目工作空间')
  assert.match(locales['zh.json'].meta.description, /项目工作空间/)
  assert.doesNotMatch(locales['zh.json'].meta.description, /工作区/)
})

test('keeps both dictionaries complete and aligned', () => {
  assert.deepEqual([...en.keys()].sort(), [...zh.keys()].sort())
  const used = usedKeys()
  assert.deepEqual([...used].filter(key => !en.has(key)), [])
  assert.deepEqual([...used].filter(key => !zh.has(key)), [])
  assert.deepEqual([...en.keys()].filter(key => !used.has(key)), [])
})

test('uses project-workspace terminology in both languages', () => {
  assert.equal(en.get('panel'), 'Project workspaces')
  assert.equal(en.get('page.title'), 'Project workspaces')
  assert.equal(en.get('files.title'), 'Project workspace files')
  assert.equal(en.get('picker.title'), 'Open a project workspace')
  assert.equal(zh.get('panel'), '项目工作空间')
  assert.equal(zh.get('page.title'), '项目工作空间')
  assert.equal(zh.get('files.title'), '项目工作空间文件')
  assert.equal(zh.get('picker.title'), '打开项目工作空间')

  for (const [key, value] of en) {
    const rest = value.replace(/\.code-workspace/gi, '').replace(/project workspace/gi, '')
    assert.doesNotMatch(rest, /workspace/i, `${key} still says workspace: ${value}`)
    assert.doesNotMatch(value, /Code workspaces/, `${key} still says Code workspaces`)
  }
  for (const [key, value] of zh) {
    const rest = value.replace(/\.code-workspace/g, '').replace(/项目工作空间/g, '')
    assert.doesNotMatch(rest, /工作区|工作空间/, `${key} still says 工作区/工作空间: ${value}`)
  }

  assert.equal(packageJson.description, 'Open code-workspace files as DSH project workspaces.')
  assert.match(readme, /项目工作空间/)
  assert.match(readme, /Project workspaces/)
  assert.match(readme, /项目工作空间文件/)
  assert.match(readme, /Project workspace files/)
  assert.match(readme, /English and Chinese/)
  assert.doesNotMatch(readme, /代码工作空间|Code workspaces|工作区/)
})
