/** Workspace-file revalidation, root updates, and the refresh route. */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { createHistory } from '../lib/history.js'
import { createWorkspaceRefresher } from '../lib/workspace-refresh.js'
import { createWorkspaceRoutes } from '../lib/routes.js'
import { createSessionRootResolver } from '../lib/session-roots.js'

/** @type {string} */
let base

before(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'dsh-project-workspace-refresh-')))
})

after(async () => {
  await rm(base, { recursive: true, force: true })
})

/**
 * Write one JSONC workspace document with relative folder paths.
 * @param file - workspace file.
 * @param folders - directory names or paths.
 * @returns resolution after the write.
 */
async function writeWorkspaceFile(file, folders) {
  await writeFile(file, `${JSON.stringify({ folders: folders.map(path => ({ path })) }, null, 2)}\n`)
}

/**
 * Create one workspace case with a real history store and temporary roots.
 * @param options - initial file folders and stored roots.
 * @returns the case.
 */
async function createWorkspaceCase(options = {}) {
  const directory = await realpath(await mkdtemp(join(base, 'case-')))
  const one = join(directory, 'one')
  const two = join(directory, 'two')
  const three = join(directory, 'three')
  await mkdir(one)
  await mkdir(two)
  await mkdir(three)
  const file = join(directory, 'demo.code-workspace')
  await writeWorkspaceFile(file, options.folders ?? ['one'])
  const history = createHistory({ file: join(directory, 'state', 'history.json') })
  const storedRoots = options.roots ?? [one]
  await history.upsert({ workspaceId: 'w1', file, roots: storedRoots })
  const workspace = { id: 'w1', path: storedRoots[0], title: 'demo' }
  const registry = {
    get: workspaceId => workspaceId === 'w1' ? workspace : undefined,
    list: () => [workspace],
  }
  const rootsCalls = []
  const loggerCalls = []
  const refresher = createWorkspaceRefresher({
    history,
    getWorkspace: workspaceId => registry.get(workspaceId),
    onRoots: (...args) => rootsCalls.push(args),
    logger: (...args) => loggerCalls.push(args),
  })
  return {
    directory, file, one, two, three, history, workspace, registry, rootsCalls, loggerCalls, refresher,
  }
}

/**
 * Build one POST request carrying a JSON body.
 * @param body - JSON value.
 * @returns the request.
 */
function post(body) {
  return new Request('http://127.0.0.1/api/project-workspace.refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('history update', () => {
  test('updates roots without moving the entry or changing openedAt', async () => {
    const dir = await realpath(await mkdtemp(join(base, 'history-')))
    const file = join(dir, 'demo.code-workspace')
    const history = createHistory({ file: join(dir, 'state', 'history.json') })
    await history.upsert({ workspaceId: 'w1', file, roots: ['/one'] })
    await history.upsert({ workspaceId: 'w2', file, roots: ['/two'] })
    await history.upsert({ workspaceId: 'w1', file, roots: ['/one'] })
    const before = history.snapshot()
    const opener = before.find(entry => entry.workspaceId === 'w1')
    const updated = await history.update({ workspaceId: 'w1', roots: ['/one', '/extra'] })
    assert.deepEqual(updated.roots, ['/one', '/extra'])
    assert.equal(updated.openedAt, opener.openedAt)
    assert.deepEqual(history.snapshot().map(entry => entry.workspaceId), before.map(entry => entry.workspaceId))
    assert.deepEqual(history.snapshot().find(entry => entry.workspaceId === 'w1').roots, ['/one', '/extra'])
  })

  test('returns undefined for an unknown entry and avoids a no-op write', async () => {
    const dir = await realpath(await mkdtemp(join(base, 'history-')))
    const history = createHistory({ file: join(dir, 'state', 'history.json') })
    await history.upsert({ workspaceId: 'w1', file: join(dir, 'demo.code-workspace'), roots: ['/one'] })
    assert.equal(await history.update({ workspaceId: 'missing', roots: ['/two'] }), undefined)
    const before = history.snapshot()[0]
    const same = await history.update({ workspaceId: 'w1', roots: ['/one'] })
    assert.equal(same, before)
  })
})

describe('workspace refresher', () => {
  test('reads a changed file and updates roots, history, and the roots sink', async () => {
    const testCase = await createWorkspaceCase({ folders: ['one', 'two'] })
    const before = testCase.history.snapshot()[0]
    const updated = await testCase.refresher.refreshEntry(before)
    assert.deepEqual(updated.roots, [testCase.one, testCase.two])
    assert.deepEqual(testCase.rootsCalls, [[testCase.workspace.path, [testCase.one, testCase.two], 'w1']])
    assert.equal(testCase.history.snapshot()[0].openedAt, before.openedAt)
    assert.deepEqual(testCase.history.snapshot()[0].roots, [testCase.one, testCase.two])
    assert.deepEqual(testCase.loggerCalls, [])
  })

  test('does not rewrite unchanged roots or read unchanged files again', async () => {
    const testCase = await createWorkspaceCase({ folders: ['one'] })
    const entry = testCase.history.snapshot()[0]
    await testCase.refresher.refreshEntry(entry)
    assert.deepEqual(testCase.rootsCalls, [])
    await testCase.refresher.refreshEntry(entry)
    assert.deepEqual(testCase.rootsCalls, [])
    assert.deepEqual(testCase.history.snapshot()[0].roots, [testCase.one])
  })

  test('force refresh discovers a folder that appeared after the file was cached', async () => {
    const testCase = await createWorkspaceCase({ folders: ['one', 'later'] })
    const entry = testCase.history.snapshot()[0]
    await testCase.refresher.refreshEntry(entry)
    assert.deepEqual(testCase.history.snapshot()[0].roots, [testCase.one])
    await mkdir(join(testCase.directory, 'later'))
    await testCase.refresher.refreshEntry(entry)
    assert.deepEqual(testCase.history.snapshot()[0].roots, [testCase.one])
    await testCase.refresher.refreshEntry(entry, { force: true })
    assert.deepEqual(testCase.history.snapshot()[0].roots, [testCase.one, join(testCase.directory, 'later')])
    assert.deepEqual(testCase.rootsCalls.at(-1), [
      testCase.workspace.path,
      [testCase.one, join(testCase.directory, 'later')],
      'w1',
    ])
  })

  test('keeps the last good roots for invalid or missing workspace files', async () => {
    const testCase = await createWorkspaceCase({ folders: ['one', 'two'] })
    const entry = testCase.history.snapshot()[0]
    await writeFile(testCase.file, '{ invalid json\n')
    await testCase.refresher.refreshEntry(entry, { force: true })
    assert.deepEqual(testCase.history.snapshot()[0].roots, [testCase.one])
    assert.ok(testCase.loggerCalls.length > 0)
    const logs = testCase.loggerCalls.length
    await unlink(testCase.file)
    await testCase.refresher.refreshEntry(entry, { force: true })
    assert.deepEqual(testCase.history.snapshot()[0].roots, [testCase.one])
    assert.ok(testCase.loggerCalls.length > logs)
  })

  test('refreshAll preserves entries when one entry cannot refresh', async () => {
    const testCase = await createWorkspaceCase({ folders: ['one'] })
    const valid = testCase.history.snapshot()[0]
    const missing = { ...valid, workspaceId: 'w2', file: join(testCase.directory, 'missing.code-workspace') }
    const result = await testCase.refresher.refreshAll([missing, valid])
    assert.equal(result.length, 2)
    assert.equal(result[0], missing)
    assert.equal(result[1], valid)
  })
})

describe('refresh route and list revalidation', () => {
  /** @returns the shared fake route inputs. */
  function routeInputs() {
    const entries = [{
      workspaceId: 'w1',
      file: '/tmp/demo.code-workspace',
      roots: ['/old'],
      openedAt: '2026-01-01T00:00:00.000Z',
    }]
    const workspace = { id: 'w1', path: '/ws', title: 'demo' }
    const calls = []
    const options = []
    const history = {
      load: async () => entries,
      snapshot: () => entries,
      prune: async () => false,
    }
    const routes = createWorkspaceRoutes({
      getRegistry: () => ({ get: workspaceId => workspaceId === 'w1' ? workspace : undefined }),
      history,
      onRoots: (...args) => calls.push(args),
      refreshWorkspace: async (entry, refreshOptions) => {
        options.push(refreshOptions)
        return { ...entry, roots: ['/new'] }
      },
    })
    return { routes, calls, options, workspace }
  }

  test('list forces a re-read and returns refreshed roots', async () => {
    const { routes, calls, options } = routeInputs()
    const data = await (await routes.list()).json()
    assert.equal(data.ok, true)
    assert.deepEqual(data.entries[0].roots, ['/new'])
    assert.equal(data.entries[0].folderCount, 1)
    assert.deepEqual(options, [{ force: true }])
    assert.deepEqual(calls, [['/ws', ['/new'], 'w1']])
  })

  test('refresh returns the updated roots and changed flag', async () => {
    const { routes, calls, options } = routeInputs()
    const response = await routes.refresh(post({ workspaceId: 'w1' }))
    const data = await response.json()
    assert.equal(data.ok, true)
    assert.equal(data.workspaceId, 'w1')
    assert.deepEqual(data.roots, ['/new'])
    assert.equal(data.changed, true)
    assert.deepEqual(options, [{ force: true }])
    assert.deepEqual(calls, [['/ws', ['/new'], 'w1']])
  })

  test('refresh reports unknown workspaces and malformed requests', async () => {
    const { routes } = routeInputs()
    const missing = await (await routes.refresh(post({ workspaceId: 'missing' }))).json()
    assert.equal(missing.ok, false)
    assert.equal(missing.code, 'workspace-not-found')
    const malformed = await routes.refresh(post({}))
    assert.equal(malformed.status, 400)
    assert.equal((await malformed.json()).code, 'bad-request')
  })
})

describe('session roots refresh', () => {
  test('uses the refreshed roots from the optional refresher', async () => {
    const entry = { workspaceId: 'w1', file: '/tmp/demo.code-workspace', roots: ['/old'] }
    const resolver = createSessionRootResolver({
      getAgent: () => ({ session: { header: { cwd: '/ws' } } }),
      getWorkspace: () => ({ id: 'w1', path: '/ws' }),
      loadHistory: async () => [entry],
      refreshEntry: async () => ({ ...entry, roots: ['/ws', '/new'] }),
    })
    assert.deepEqual(await resolver('s1'), {
      workspacePath: '/ws',
      workspaceId: 'w1',
      roots: ['/ws', '/new'],
    })
  })
})
