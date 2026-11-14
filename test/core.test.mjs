/** Workspace-file parsing, browsing, search, history, and the Host handlers. */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import {
  browseDirectory, isFullyQualifiedPath, parseWorkspaceFile, readDirectoryEntries,
  resolveExistingRoots, stripJsonc, titleForWorkspaceFile, WorkspaceFileError,
} from '../lib/workspace-file.js'
import { searchWorkspaceRoots } from '../lib/search.js'
import { createHistory } from '../lib/history.js'
import { createWorkspaceRoutes } from '../lib/routes.js'

/** @type {string} */
let base

before(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'dsh-project-workspace-test-')))
})

after(async () => {
  await rm(base, { recursive: true, force: true })
})

/**
 * Build a POST request carrying one JSON body.
 * @param body - JSON value.
 * @returns the request.
 */
function post(body) {
  return new Request('http://127.0.0.1/api/project-workspace', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * One fake workspace entity.
 * @param id - workspace id.
 * @param path - canonical directory.
 * @param title - initial display title.
 * @param calls - mutation log.
 * @returns the entity.
 */
function workspaceEntity(id, path, title, calls, failSetTitle = false) {
  const entity = {
    id,
    path,
    title,
    async setTitle(next) {
      calls.push(['setTitle', id, next])
      if (failSetTitle) throw new Error('title write failed')
      entity.title = next
    },
  }
  return entity
}

/**
 * A fake workspace registry with the surface the routes use.
 * @param calls - mutation log.
 * @returns the fake registry.
 */
function fakeRegistry(calls = [], options = {}) {
  const workspaces = new Map()
  let counter = 0
  return {
    list: () => [...workspaces.values()],
    get: (id) => workspaces.get(String(id)),
    async resolveByPath(path) {
      for (const workspace of workspaces.values()) {
        if (workspace.path === path) return workspace
      }
      return undefined
    },
    async create(path) {
      calls.push(['create', path])
      for (const workspace of workspaces.values()) {
        if (workspace.path === path) return workspace
      }
      counter += 1
      const entity = workspaceEntity(`workspace-${counter}`, path, `default-${counter}`, calls, options.failSetTitle === true)
      workspaces.set(entity.id, entity)
      return entity
    },
    /** Test helper: register one workspace directly. */
    seed(path, title) {
      const entity = workspaceEntity(`seeded-${workspaces.size}`, path, title, calls)
      workspaces.set(entity.id, entity)
      return entity
    },
    /** Test helper: forget one workspace. */
    remove(id) {
      return workspaces.delete(String(id))
    },
  }
}

/**
 * Create the routes under test.
 * @param options - registry and history overrides.
 * @returns the routes with their history.
 */
async function createHarness(options = {}) {
  const directory = await realpath(await mkdtemp(join(base, 'case-')))
  const state = join(directory, 'state', 'workspaces.json')
  const history = options.history ?? createHistory({ file: state })
  const calls = []
  const registry = options.registry ?? fakeRegistry(calls, options.registryOptions)
  const routes = createWorkspaceRoutes({
    getRegistry: () => registry,
    history,
    onRoots: () => {},
  })
  return { directory, state, history, registry, routes, calls }
}

describe('workspace file parsing', () => {
  test('accepts comments and trailing commas without touching strings', () => {
    const text = `{
      // a line comment
      "folders": [
        { "path": "/one", "name": "one // not a comment" }, /* block */
        { "path": "/two" },
      ],
    }`
    const parsed = parseWorkspaceFile(text)
    assert.deepEqual(parsed.folders, [
      { path: '/one', name: 'one // not a comment' },
      { path: '/two' },
    ])
    assert.match(stripJsonc(text), /"one \/\/ not a comment"/)
    assert.ok(!stripJsonc(text).includes('line comment'))
  })

  test('reports invalid JSON and missing folders with stable codes', () => {
    assert.throws(() => parseWorkspaceFile('{oops}'), (error) => error instanceof WorkspaceFileError && error.code === 'invalid-json')
    assert.throws(() => parseWorkspaceFile('{"folders":[]}'), (error) => error instanceof WorkspaceFileError && error.code === 'no-folders')
    assert.throws(() => parseWorkspaceFile('{"folders":[{"name":"x"}]}'), (error) => error.code === 'no-folders')
  })

  test('derives the workspace title from the file name', () => {
    assert.match(titleForWorkspaceFile('/x/workspace.code-workspace'), /^workspace \(workspace\)$/i)
    assert.match(titleForWorkspaceFile('/x/a.b.code-workspace'), /^a\.b \(workspace\)$/i)
    assert.match(titleForWorkspaceFile('/x/CASE.Code-Workspace'), /^CASE \(workspace\)$/i)
  })

  test('resolves existing folders in declared order and skips missing ones', async () => {
    const root = await realpath(await mkdtemp(join(base, 'roots-')))
    const first = join(root, 'first')
    const second = join(root, 'second')
    await mkdir(first)
    await mkdir(second)
    await writeFile(join(root, 'a-file'), 'x')
    const parsed = parseWorkspaceFile(JSON.stringify({
      folders: [
        { path: join(root, 'missing') },
        { path: 'second' },
        { path: join(root, 'a-file') },
        { path: first },
        { path: first },
      ],
    }))
    const roots = await resolveExistingRoots(parsed.folders, root)
    assert.deepEqual(roots, [second, first])
  })

  test('requires a fully qualified path', () => {
    assert.equal(isFullyQualifiedPath('/tmp/x'), true)
    assert.equal(isFullyQualifiedPath('tmp/x'), false)
    assert.equal(isFullyQualifiedPath(''), false)
    assert.equal(isFullyQualifiedPath('/tmp/\u0000x'), false)
  })
})

describe('directory browsing', () => {
  test('lists child directories and workspace files only', async () => {
    const directory = await realpath(await mkdtemp(join(base, 'browse-')))
    await mkdir(join(directory, 'alpha'))
    await mkdir(join(directory, '.hidden'))
    await writeFile(join(directory, 'beta.code-workspace'), '{}')
    await writeFile(join(directory, 'gamma.txt'), 'x')
    await writeFile(join(directory, '.secret.code-workspace'), '{}')

    const visible = await browseDirectory(directory)
    assert.deepEqual(visible.directories.map(entry => entry.name), ['alpha'])
    assert.deepEqual(visible.files.map(entry => entry.name), ['beta.code-workspace'])
    assert.equal(visible.path, directory)
    assert.equal(visible.parent, await realpath(join(directory, '..')))
    assert.equal(visible.truncated, false)

    const all = await browseDirectory(directory, { includeHidden: true })
    assert.deepEqual(all.directories.map(entry => entry.name), ['.hidden', 'alpha'])
    assert.deepEqual(all.files.map(entry => entry.name), ['.secret.code-workspace', 'beta.code-workspace'])
  })
})

describe('history', () => {
  test('persists entries in most-recent-first order and prunes', async () => {
    const directory = await realpath(await mkdtemp(join(base, 'history-')))
    const file = join(directory, 'state', 'workspaces.json')
    const history = createHistory({ file })
    await history.upsert({ workspaceId: 'a', file: '/x/a.code-workspace', roots: ['/a'] })
    await history.upsert({ workspaceId: 'b', file: '/x/b.code-workspace', roots: ['/b'] })
    await history.upsert({ workspaceId: 'a', file: '/x/a2.code-workspace', roots: ['/a', '/a2'] })

    const reloaded = createHistory({ file })
    const entries = await reloaded.load()
    assert.deepEqual(entries.map(entry => entry.workspaceId), ['a', 'b'])
    assert.deepEqual(entries[0].roots, ['/a', '/a2'])
    assert.equal(typeof entries[0].openedAt, 'string')

    assert.equal(await reloaded.prune(['a']), true)
    assert.deepEqual(reloaded.snapshot().map(entry => entry.workspaceId), ['a'])
    const document = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(document.version, 1)
    assert.deepEqual(document.entries.map(entry => entry.workspaceId), ['a'])
  })
})

describe('routes', () => {
  test('open creates a workspace, names it, and records the folders', async () => {
    const harness = await createHarness()
    const first = join(harness.directory, 'root-a')
    const second = join(harness.directory, 'root-b')
    await mkdir(first)
    await mkdir(second)
    const file = join(harness.directory, 'workspace.code-workspace')
    await writeFile(file, JSON.stringify({ folders: [{ path: first }, { path: second }] }))

    const result = await (await harness.routes.open(post({ file }))).json()
    assert.equal(result.ok, true)
    assert.equal(result.title, titleForWorkspaceFile(file))
    assert.equal(result.created, true)
    assert.equal(result.path, await realpath(first))
    assert.deepEqual(result.roots, [await realpath(first), await realpath(second)])
    assert.equal(result.notice, null)
    assert.equal(harness.registry.list().length, 1)
    assert.equal(harness.registry.list()[0].title, titleForWorkspaceFile(file))
    assert.deepEqual(harness.calls.filter(call => call[0] === 'setTitle').length, 1)

    const listed = await (await harness.routes.list(post({}))).json()
    assert.equal(listed.ok, true)
    assert.equal(listed.entries.length, 1)
    assert.equal(listed.entries[0].workspaceId, result.workspaceId)
    assert.equal(listed.entries[0].file, await realpath(file))
    assert.equal(listed.entries[0].folderCount, 2)
  })

  test('opening the same file again reuses its workspace without a notice', async () => {
    const harness = await createHarness()
    const root = join(harness.directory, 'root')
    await mkdir(root)
    const file = join(harness.directory, 'same.code-workspace')
    await writeFile(file, JSON.stringify({ folders: [{ path: root }] }))

    const first = await (await harness.routes.open(post({ file }))).json()
    const second = await (await harness.routes.open(post({ file }))).json()
    assert.equal(second.ok, true)
    assert.equal(second.workspaceId, first.workspaceId)
    assert.equal(second.created, false)
    assert.equal(second.notice, null)
    assert.equal(harness.registry.list().length, 1)
    assert.equal(harness.calls.filter(call => call[0] === 'create').length, 1)
  })

  test('a directory already owned by another workspace is reused and never renamed', async () => {
    const harness = await createHarness()
    const root = join(harness.directory, 'owned')
    await mkdir(root)
    const existing = harness.registry.seed(await realpath(root), 'evelens')
    const file = join(harness.directory, 'multi.code-workspace')
    await writeFile(file, JSON.stringify({ folders: [{ path: root }] }))

    const result = await (await harness.routes.open(post({ file }))).json()
    assert.equal(result.ok, true)
    assert.equal(result.workspaceId, existing.id)
    assert.equal(result.title, 'evelens')
    assert.equal(result.created, false)
    assert.deepEqual(result.notice, { code: 'dir-in-use', title: 'evelens' })
    assert.equal(harness.calls.filter(call => call[0] === 'setTitle').length, 0)
    assert.equal(harness.registry.list().length, 1)
  })

  test('a matching title wins over a free directory and reports the reuse', async () => {
    const harness = await createHarness()
    const rootA = join(harness.directory, 'root-a')
    const rootB = join(harness.directory, 'root-b')
    await mkdir(rootA)
    await mkdir(rootB)
    const fileA = join(harness.directory, 'a', 'shared.code-workspace')
    const fileB = join(harness.directory, 'b', 'shared.code-workspace')
    await mkdir(join(harness.directory, 'a'))
    await mkdir(join(harness.directory, 'b'))
    await writeFile(fileA, JSON.stringify({ folders: [{ path: rootA }] }))
    await writeFile(fileB, JSON.stringify({ folders: [{ path: rootB }] }))

    const first = await (await harness.routes.open(post({ file: fileA }))).json()
    const second = await (await harness.routes.open(post({ file: fileB }))).json()
    assert.equal(second.ok, true)
    assert.equal(second.workspaceId, first.workspaceId)
    assert.equal(second.created, false)
    assert.deepEqual(second.notice, { code: 'title-exists', title: titleForWorkspaceFile(fileB) })
    assert.equal(harness.registry.list().length, 1)
    assert.equal(harness.calls.filter(call => call[0] === 'create').length, 1)
  })

  test('reports missing folders instead of creating a workspace', async () => {
    const harness = await createHarness()
    const file = join(harness.directory, 'empty.code-workspace')
    await writeFile(file, JSON.stringify({ folders: [{ path: join(harness.directory, 'nope') }] }))
    const result = await (await harness.routes.open(post({ file }))).json()
    assert.equal(result.ok, false)
    assert.equal(result.code, 'no-existing-folders')
    assert.equal(harness.registry.list().length, 0)
  })

  test('a naming failure still opens the created workspace and explains it', async () => {
    const harness = await createHarness({ registryOptions: { failSetTitle: true } })
    const root = join(harness.directory, 'root')
    await mkdir(root)
    const file = join(harness.directory, 'unnameable.code-workspace')
    await writeFile(file, JSON.stringify({ folders: [{ path: root }] }))
    const result = await (await harness.routes.open(post({ file }))).json()
    assert.equal(result.ok, true)
    assert.equal(result.created, true)
    assert.equal(result.title, 'default-1')
    assert.deepEqual(result.notice, { code: 'title-failed', title: titleForWorkspaceFile(file), current: 'default-1' })
    assert.equal(harness.registry.list().length, 1)
    assert.equal(harness.history.snapshot().length, 1)
  })

  test('rejects relative and non-workspace paths', async () => {
    const harness = await createHarness()
    const relative = await (await harness.routes.open(post({ file: 'workspace.code-workspace' }))).json()
    assert.equal(relative.code, 'not-absolute')
    const plain = join(harness.directory, 'plain.txt')
    await writeFile(plain, 'x')
    const notWorkspace = await (await harness.routes.open(post({ file: plain }))).json()
    assert.equal(notWorkspace.code, 'not-workspace-file')
  })

  test('list drops records whose workspace was deleted', async () => {
    const harness = await createHarness()
    const root = join(harness.directory, 'root')
    await mkdir(root)
    const file = join(harness.directory, 'gone.code-workspace')
    await writeFile(file, JSON.stringify({ folders: [{ path: root }] }))
    const opened = await (await harness.routes.open(post({ file }))).json()
    assert.equal(opened.ok, true)
    harness.registry.remove(opened.workspaceId)
    const listed = await (await harness.routes.list(post({}))).json()
    assert.equal(listed.ok, true)
    assert.equal(listed.entries.length, 0)
    assert.equal(harness.history.snapshot().length, 0)
  })

  test('browse lists a directory and rejects files and relative paths', async () => {
    const harness = await createHarness()
    const child = join(harness.directory, 'child')
    await mkdir(child)
    await writeFile(join(harness.directory, 'a.code-workspace'), '{}')

    const listed = await (await harness.routes.browse(post({ path: harness.directory }))).json()
    assert.equal(listed.ok, true)
    assert.deepEqual(listed.directories.map(entry => entry.name), ['child'])
    assert.deepEqual(listed.files.map(entry => entry.name), ['a.code-workspace'])

    const relative = await (await harness.routes.browse(post({ path: 'nope' }))).json()
    assert.equal(relative.code, 'not-absolute')

    const file = await (await harness.routes.browse(post({ path: join(harness.directory, 'a.code-workspace') }))).json()
    assert.equal(file.code, 'not-a-directory')
  })

  test('dir lists every child kind and search finds entries across roots', async () => {
    const harness = await createHarness()
    const first = join(harness.directory, 'first')
    const second = join(harness.directory, 'second')
    await mkdir(first)
    await mkdir(second)
    await mkdir(join(first, 'src'))
    await writeFile(join(first, 'src', 'Alpha.ts'), 'x')
    await writeFile(join(first, 'notes.md'), 'x')
    await mkdir(join(first, '.hidden'))
    await writeFile(join(first, '.env'), 'x')
    await mkdir(join(first, 'node_modules'))
    await writeFile(join(first, 'node_modules', 'pkg.js'), 'x')
    await writeFile(join(second, 'alpha.txt'), 'x')
    await symlink(join(first, 'notes.md'), join(first, 'alias.md'))

    const listing = await (await harness.routes.dir(post({ path: first }))).json()
    assert.equal(listing.ok, true)
    const kinds = Object.fromEntries(listing.entries.map(entry => [entry.name, entry.kind]))
    assert.equal(kinds.src, 'directory')
    assert.equal(kinds['notes.md'], 'file')
    assert.equal(kinds['alias.md'], 'file')
    assert.equal(kinds['.env'], 'file')
    assert.equal(kinds.node_modules, 'directory')

    const relative = await (await harness.routes.dir(post({ path: 'first' }))).json()
    assert.equal(relative.code, 'not-absolute')
    const missing = await (await harness.routes.dir(post({ path: join(harness.directory, 'nope') }))).json()
    assert.equal(missing.code, 'not-found')
    const notDirectory = await (await harness.routes.dir(post({ path: join(first, 'notes.md') }))).json()
    assert.equal(notDirectory.code, 'not-a-directory')

    const found = await (await harness.routes.search(post({ roots: [first, second], query: 'alpha' }))).json()
    assert.equal(found.ok, true)
    assert.deepEqual(found.groups.map(group => group.root), [first, second])
    assert.equal(found.groups[0].matches.length, 1)
    assert.match(found.groups[0].matches[0].path, /src\/Alpha\.ts$/)
    assert.equal(found.groups[1].matches[0].kind, 'file')
    assert.equal(found.truncated, false)

    const empty = await (await harness.routes.search(post({ roots: [first], query: '' }))).json()
    assert.equal(empty.code, 'bad-request')
    const noRoots = await (await harness.routes.search(post({ roots: [], query: 'x' }))).json()
    assert.equal(noRoots.code, 'bad-request')
    const relativeRoot = await (await harness.routes.search(post({ roots: ['first'], query: 'x' }))).json()
    assert.equal(relativeRoot.code, 'not-absolute')
    const missingRoot = await (await harness.routes.search(post({ roots: [join(harness.directory, 'nope')], query: 'x' }))).json()
    assert.equal(missingRoot.code, 'not-found')
  })
})

describe('directory listing and search helpers', () => {
  /**
   * Build one small tree with directories, files, hidden entries, skips, and
   * symbolic links.
   * @returns the physical root.
   */
  async function fixture() {
    const root = await realpath(await mkdtemp(join(base, 'roots-')))
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'Alpha.ts'), 'x')
    await writeFile(join(root, 'readme.md'), 'x')
    await mkdir(join(root, '.hidden'))
    await writeFile(join(root, '.env'), 'x')
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'node_modules', 'pkg.js'), 'x')
    await mkdir(join(root, '.git'))
    await writeFile(join(root, '.git', 'HEAD'), 'x')
    await symlink(join(root, 'src'), join(root, 'linked'))
    await symlink(join(root, 'missing-target'), join(root, 'broken'))
    return root
  }

  test('readDirectoryEntries reports kinds and truncation', async () => {
    const root = await fixture()
    const all = await readDirectoryEntries(root)
    const byName = Object.fromEntries(all.entries.map(entry => [entry.name, entry]))
    assert.equal(byName.readme, undefined)
    assert.equal(byName['readme.md'].kind, 'file')
    assert.equal(byName.src.kind, 'directory')
    assert.equal(byName.linked.kind, 'directory')
    assert.equal(byName.broken.kind, 'other')
    assert.equal(byName['.env'].hidden, true)
    assert.equal(all.truncated, false)

    const cut = await readDirectoryEntries(root, { limit: 2 })
    assert.equal(cut.entries.length, 2)
    assert.equal(cut.truncated, true)
  })

  test('search matches names, paths, visibility, and skips dependency trees', async () => {
    const root = await fixture()
    const alpha = await searchWorkspaceRoots([root], 'alpha')
    assert.deepEqual(alpha.groups.map(group => group.root), [root])
    assert.deepEqual(alpha.groups[0].matches.map(match => match.kind), ['file'])
    assert.match(alpha.groups[0].matches[0].path, /src\/Alpha\.ts$/)

    const pathQuery = await searchWorkspaceRoots([root], 'src/alpha')
    assert.equal(pathQuery.groups[0].matches.length, 1)

    const directoryQuery = await searchWorkspaceRoots([root], 's')
    assert.ok(directoryQuery.groups[0].matches.some(match => match.path.endsWith('/src') && match.kind === 'directory'))

    assert.equal((await searchWorkspaceRoots([root], 'env')).groups.length, 0)
    assert.equal((await searchWorkspaceRoots([root], 'env', { includeHidden: true })).groups[0].matches.length, 1)
    assert.equal((await searchWorkspaceRoots([root], 'pkg', { includeHidden: true })).groups.length, 0)
    assert.equal((await searchWorkspaceRoots([root], 'HEAD', { includeHidden: true })).groups.length, 0)
    assert.equal((await searchWorkspaceRoots([root], 'linked')).groups.length, 0)
  })

  test('search groups roots, caps results, and reports an incomplete scan', async () => {
    const first = await fixture()
    const second = await realpath(await mkdtemp(join(base, 'roots-')))
    await writeFile(join(second, 'alpha-2.txt'), 'x')

    const grouped = await searchWorkspaceRoots([first, second], 'alpha')
    assert.deepEqual(grouped.groups.map(group => group.root), [first, second])

    const capped = await searchWorkspaceRoots([first, second], 'a', { limits: { maxResults: 1 } })
    assert.equal(capped.groups.flatMap(group => group.matches).length, 1)
    assert.equal(capped.truncated, true)

    const partial = await searchWorkspaceRoots([first], 'a', { limits: { maxScanned: 1 } })
    assert.equal(partial.incomplete, true)
  })
})
