/** `@` reference discovery: mentions, drill paths, session roots, and the Host route. */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, win32 } from 'node:path'
import { after, before, describe, test } from 'node:test'
import {
  formatReferenceMention, relativeDrillPath, rootDisplayNames, toPosix,
} from '../lib/references.js'
import { createSessionRootResolver } from '../lib/session-roots.js'
import { createWorkspaceRoutes } from '../lib/routes.js'

/** @type {string} */
let base
/** @type {string} */
let primary
/** @type {string} */
let extra
/** @type {string} */
let outside
/** @type {ReturnType<typeof createWorkspaceRoutes>} */
let routes
/** @type {boolean} */
let symlinkCreated = false

before(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'dsh-project-workspace-refs-')))
  primary = join(base, 'primary')
  extra = join(base, 'extra')
  outside = join(base, 'outside')
  await mkdir(join(primary, 'src'), { recursive: true })
  await mkdir(join(extra, 'src'), { recursive: true })
  await mkdir(join(extra, 'space dir'), { recursive: true })
  await mkdir(join(extra, 'node_modules', 'pkg'), { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(primary, 'README.md'), 'primary readme\n')
  await writeFile(join(primary, 'src', 'main.ts'), 'primary main\n')
  await writeFile(join(extra, 'src', 'a.ts'), 'extra a\n')
  await writeFile(join(extra, 'note.txt'), 'extra note\n')
  await writeFile(join(extra, 'space dir', 'file name.txt'), 'space file\n')
  await writeFile(join(extra, '.hidden.ts'), 'hidden\n')
  await writeFile(join(extra, 'node_modules', 'pkg', 'skip.js'), 'skip\n')
  await writeFile(join(outside, 'secret.txt'), 'secret\n')
  try {
    await symlink(outside, join(extra, 'escape'), 'dir')
    symlinkCreated = true
  } catch {
    // Windows without symlink privilege: the escape test is skipped.
  }
  routes = createWorkspaceRoutes({
    getRegistry: () => ({ list: () => [], get: () => undefined }),
    history: { load: async () => [], snapshot: () => [] },
    resolveSessionRoots: async sessionId => sessionId === 'session-1'
      ? { workspacePath: primary, workspaceId: 'workspace-1', roots: [primary, extra] }
      : undefined,
  })
})

after(async () => {
  await rm(base, { recursive: true, force: true })
})

/**
 * Build one POST request carrying a JSON body.
 * @param body - JSON value.
 * @returns the request.
 */
function post(body) {
  return new Request('http://127.0.0.1/api/project-workspace.references', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * Call the references route and decode its JSON response.
 * @param body - request body.
 * @returns the decoded response and HTTP status.
 */
async function callReferences(body) {
  const response = await routes.references(post(body))
  return { status: response.status, data: await response.json() }
}

/**
 * The references payload for one successful request.
 * @param body - request body.
 * @returns the decoded successful payload.
 */
async function references(body) {
  const { status, data } = await callReferences(body)
  assert.equal(status, 200)
  assert.equal(data.ok, true)
  return data
}

/**
 * Absolute path of one root candidate in a workspace recovery group.
 * @param data - references payload.
 * @returns the candidate paths.
 */
function candidatePaths(data) {
  return data.groups.flatMap(group => group.candidates.map(candidate => candidate.path))
}

describe('reference helpers', () => {
  test('formats file and folder mentions for both grammars', () => {
    assert.equal(formatReferenceMention('/a/b', 'file', false), '@/a/b')
    assert.equal(formatReferenceMention('/a/b c', 'file', false), '@"/a/b c"')
    assert.equal(formatReferenceMention('/a/b', 'directory', false), '@/a/b/')
    assert.equal(formatReferenceMention('/a/b c', 'directory', false), '@"/a/b c/')
    assert.equal(formatReferenceMention('/a/b', 'file', true), '@"/a/b"')
    assert.equal(formatReferenceMention('./', 'directory', false), '@./')
    assert.equal(formatReferenceMention('../extra', 'directory', false), '@../extra/')
    assert.equal(formatReferenceMention('C:\\a\\b', 'file', false), '@C:/a/b')
    assert.equal(formatReferenceMention('/a/"b', 'file', false), undefined)
    assert.equal(formatReferenceMention('/a/\u0001b', 'file', false), undefined)
    assert.equal(formatReferenceMention('', 'file', false), undefined)
  })

  test('derives workspace-relative drill paths and rejects cross-volume targets', () => {
    assert.equal(relativeDrillPath('/ws', '/ws'), '.')
    assert.equal(relativeDrillPath('/ws', '/ws/src'), './src')
    assert.equal(relativeDrillPath('/ws', '/other'), '../other')
    assert.equal(relativeDrillPath('C:\\ws', 'C:\\ws\\src', win32), './src')
    assert.equal(relativeDrillPath('C:\\ws', 'D:\\other', win32), undefined)
    assert.equal(relativeDrillPath('', '/ws'), undefined)
  })

  test('disambiguates duplicate root basenames', () => {
    assert.deepEqual(rootDisplayNames(['/a/src', '/b/src', '/c/lib']), ['src (1)', 'src (2)', 'lib'])
    assert.deepEqual(rootDisplayNames(['/']), ['/'])
  })
})

describe('session roots', () => {
  test('resolves a workspace through its live agent and history entry', async () => {
    const resolver = createSessionRootResolver({
      getAgent: sessionId => sessionId === 's1' ? { session: { header: { cwd: '/ws/' } } } : undefined,
      getWorkspace: workspaceId => workspaceId === 'w1' ? { path: '/ws' } : undefined,
      loadHistory: async () => [{ workspaceId: 'w1', roots: ['/ws', '/extra', '/extra'] }],
    })
    assert.deepEqual(await resolver('s1'), {
      workspacePath: '/ws/',
      workspaceId: 'w1',
      roots: ['/ws', '/extra'],
    })
  })

  test('returns undefined without a matching project workspace', async () => {
    const resolver = createSessionRootResolver({
      getAgent: () => undefined,
      getWorkspace: () => undefined,
      loadHistory: async () => [],
    })
    assert.equal(await resolver('s1'), undefined)
    assert.equal(await resolver(''), undefined)
  })
})

describe('references route', () => {
  test('returns every root for an empty query', async () => {
    const data = await references({ sessionId: 'session-1' })
    assert.equal(data.roots.length, 2)
    assert.equal(data.roots[0].primary, true)
    assert.equal(data.roots[1].primary, false)
    assert.equal(data.roots[0].path, toPosix(primary))
    assert.equal(data.roots[0].drillMention, '@./')
    assert.match(data.roots[0].mention, /^@\//)
    assert.match(data.roots[1].drillMention, /^@\.\.\//)
    assert.deepEqual(data.groups, [])
  })

  test('searches only supplemental roots for a bare query', async () => {
    const data = await references({ sessionId: 'session-1', query: 'a.ts' })
    assert.equal(data.groups.length, 1)
    assert.equal(data.groups[0].root, toPosix(extra))
    assert.deepEqual(data.groups[0].candidates.map(candidate => candidate.name), ['a.ts'])
    const [candidate] = data.groups[0].candidates
    assert.equal(candidate.kind, 'file')
    assert.equal(candidate.drillMention, undefined)
    assert.equal(candidate.mention, `@${toPosix(join(extra, 'src', 'a.ts'))}`)

    const primaryOnly = await references({ sessionId: 'session-1', query: 'main' })
    assert.deepEqual(primaryOnly.groups, [])
  })

  test('ranks directories and carries a relative drill mention', async () => {
    const data = await references({ sessionId: 'session-1', query: 'src' })
    const groups = data.groups.filter(group => group.root === toPosix(extra))
    assert.equal(groups.length, 1)
    const directory = groups[0].candidates.find(candidate => candidate.name === 'src')
    assert.ok(directory !== undefined)
    assert.equal(directory.kind, 'directory')
    assert.equal(directory.mention, `@${toPosix(join(extra, 'src'))}/`)
    assert.match(directory.drillMention, /^@\.\.\/[^/]+\/src\/$/)
  })

  test('lists directory-scoped queries below supplemental roots', async () => {
    const data = await references({ sessionId: 'session-1', query: 'src/' })
    assert.equal(data.groups.length, 1)
    assert.equal(data.groups[0].root, toPosix(extra))
    assert.deepEqual(data.groups[0].candidates.map(candidate => candidate.name), ['a.ts'])

    const spaced = await references({ sessionId: 'session-1', query: 'space dir/' })
    const file = spaced.groups[0].candidates.find(candidate => candidate.name === 'file name.txt')
    assert.ok(file !== undefined)
    assert.match(file.mention, /^@".*file name\.txt"$/)
  })

  test('ignores excluded and hidden directories', async () => {
    const excluded = await references({ sessionId: 'session-1', query: 'node_modules/' })
    assert.deepEqual(excluded.groups, [])
    const absoluteExcluded = await references({ sessionId: 'session-1', query: `${toPosix(extra)}/node_modules/` })
    assert.deepEqual(absoluteExcluded.groups, [])
  })

  test('applies hidden rules to fuzzy and absolute queries', async () => {
    const hidden = await references({ sessionId: 'session-1', query: '.hidden' })
    assert.equal(hidden.groups.length, 1)
    assert.deepEqual(hidden.groups[0].candidates.map(candidate => candidate.name), ['.hidden.ts'])

    const plain = await references({ sessionId: 'session-1', query: 'hidden' })
    assert.deepEqual(plain.groups, [])

    const absolute = await references({ sessionId: 'session-1', query: `${toPosix(extra)}/` })
    assert.ok(!candidatePaths(absolute).some(path => path.endsWith('.hidden.ts')))
  })

  test('lets the core provider own workspace-relative primary paths', async () => {
    const root = await references({ sessionId: 'session-1', query: './' })
    assert.deepEqual(root.groups, [])
    const subdirectory = await references({ sessionId: 'session-1', query: './src/' })
    assert.deepEqual(subdirectory.groups, [])
  })

  test('browses a supplemental root with its relative drill path', async () => {
    const drill = relative(primary, extra).replaceAll('\\', '/')
    const data = await references({ sessionId: 'session-1', query: `${drill}/` })
    assert.equal(data.groups.length, 1)
    assert.equal(data.groups[0].root, toPosix(extra))
    assert.ok(data.groups[0].candidates.some(candidate => candidate.name === 'note.txt'))

    const nested = await references({ sessionId: 'session-1', query: `${drill}/src/` })
    assert.equal(nested.groups.length, 1)
    assert.deepEqual(nested.groups[0].candidates.map(candidate => candidate.name), ['a.ts'])
  })

  test('recovers to the project workspace roots above the primary root', async () => {
    const data = await references({ sessionId: 'session-1', query: '../' })
    assert.equal(data.groups.length, 1)
    assert.equal(data.groups[0].workspace, true)
    assert.deepEqual(
      data.groups[0].candidates.map(candidate => candidate.path).sort(),
      [toPosix(primary), toPosix(extra)].sort(),
    )
    assert.ok(data.groups[0].candidates.every(candidate => candidate.kind === 'directory'))
  })

  test('browses absolute paths inside any root and rejects paths outside them', async () => {
    const data = await references({ sessionId: 'session-1', query: `${toPosix(extra)}/` })
    assert.equal(data.groups.length, 1)
    assert.equal(data.groups[0].root, toPosix(extra))
    assert.ok(candidatePaths(data).includes(toPosix(join(extra, 'note.txt'))))

    const primaryData = await references({ sessionId: 'session-1', query: `${toPosix(primary)}/` })
    assert.equal(primaryData.groups.length, 1)
    assert.equal(primaryData.groups[0].root, toPosix(primary))

    const outsideData = await references({ sessionId: 'session-1', query: `${toPosix(outside)}/` })
    assert.deepEqual(outsideData.groups, [])
  })

  test('rejects a symlinked directory that escapes its root', async (t) => {
    if (!symlinkCreated) {
      t.skip('symlinks are unavailable')
      return
    }
    const data = await references({ sessionId: 'session-1', query: `${toPosix(extra)}/escape/` })
    assert.deepEqual(data.groups, [])
  })

  test('honors the quote state in mentions', async () => {
    const roots = await references({ sessionId: 'session-1', quoted: true })
    assert.match(roots.roots[0].mention, /^@"/)
    assert.match(roots.roots[0].drillMention, /^@"/)

    const data = await references({ sessionId: 'session-1', query: 'file name', quoted: true })
    const [candidate] = data.groups[0].candidates
    assert.match(candidate.mention, /^@".*"$/)
  })

  test('returns an empty payload for an unknown session', async () => {
    const data = await references({ sessionId: 'missing' })
    assert.deepEqual(data.roots, [])
    assert.deepEqual(data.groups, [])
  })

  test('rejects malformed and oversized requests', async () => {
    const missing = await callReferences({})
    assert.equal(missing.status, 400)
    assert.equal(missing.data.code, 'bad-request')

    const tooLong = await callReferences({ sessionId: 'session-1', query: 'x'.repeat(201) })
    assert.equal(tooLong.status, 400)
    assert.equal(tooLong.data.code, 'bad-request')

    const malformed = await routes.references(post([]))
    assert.equal(malformed.status, 400)
  })
})
