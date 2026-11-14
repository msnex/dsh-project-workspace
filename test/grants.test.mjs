/** Additional writable-root reconciliation. */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createWorkspaceGrants } from '../lib/grants.js'

/**
 * One fake agent whose context owns an effect.
 * @param id - session id.
 * @param cwd - session working directory.
 * @param calls - shared registration log.
 * @returns the fake agent plus lifecycle controls.
 */
function fakeAgent(id, cwd, calls) {
  const cleanups = []
  const agent = {
    session: { id, header: { cwd } },
    ctx: {
      effect(callback) {
        const cleanup = callback()
        cleanups.push(cleanup)
        return () => {
          for (const entry of cleanups.splice(0)) entry()
        }
      },
    },
  }
  let live = true
  return {
    agent,
    calls,
    /** Simulate agent disposal. */
    dispose() {
      live = false
      agent.ctx.dispose?.()
    },
    get live() { return live },
  }
}

/**
 * Build a grant manager with recording fakes.
 * @param options - per-path realpath/stat overrides.
 * @returns the manager and its recordings.
 */
function harness(options = {}) {
  const registered = new Map()
  const calls = []
  const agents = []
  const grants = createWorkspaceGrants({
    registerWritableRoot(session, directory) {
      calls.push(['register', session.id, directory])
      if (options.throwOnRegister === true) throw new Error('sandbox refused')
      const token = `${session.id}:${directory}:${Math.random()}`
      registered.set(token, directory)
      return () => {
        calls.push(['release', session.id, directory])
        registered.delete(token)
      }
    },
    listAgents: () => agents.map(entry => entry.agent),
    workspaceIdForPath: options.workspaceIdForPath ?? (() => 'workspace-1'),
    statDirectory: async (path) => (options.statDirectory ?? (async candidate => !candidate.includes('missing')))(path),
    realpathPath: async (path) => (options.realpathPath ?? (async candidate => candidate))(path),
    logger: () => {},
  })
  return { grants, calls, agents, registered }
}

describe('workspace writable roots', () => {
  test('grants every folder except the session root', async () => {
    const h = harness()
    h.grants.setRoots('/work', ['/work', '/work/a', '/work/b'], 'workspace-1')
    const { agent } = fakeAgent('s1', '/work', h.calls)
    await h.grants.reconcile(agent)
    assert.deepEqual(h.calls, [
      ['register', 's1', '/work/a'],
      ['register', 's1', '/work/b'],
    ])
    assert.equal(h.registered.size, 2)
  })

  test('skips missing folders and symlinked spellings', async () => {
    const h = harness({
      realpathPath: async path => (path === '/work/link' ? '/work/elsewhere' : path),
    })
    h.grants.setRoots('/work', ['/work', '/work/missing', '/work/link', '/work/ok'], 'workspace-1')
    const { agent } = fakeAgent('s1', '/work', h.calls)
    await h.grants.reconcile(agent)
    assert.deepEqual(h.calls, [['register', 's1', '/work/ok']])
  })

  test('re-registers when the folder set changes and releases the old grants', async () => {
    const h = harness()
    h.grants.setRoots('/work', ['/work', '/work/a'], 'workspace-1')
    const { agent } = fakeAgent('s1', '/work', h.calls)
    await h.grants.reconcile(agent)
    h.grants.setRoots('/work', ['/work', '/work/b'], 'workspace-1')
    await h.grants.reconcile(agent)
    assert.deepEqual(h.calls, [
      ['register', 's1', '/work/a'],
      ['release', 's1', '/work/a'],
      ['register', 's1', '/work/b'],
    ])
    assert.deepEqual([...h.registered.values()], ['/work/b'])
  })

  test('revalidates newly available and newly missing folders', async () => {
    let allow = false
    const h = harness({
      statDirectory: async path => (path === '/work/toggle' ? allow : true),
    })
    h.grants.setRoots('/work', ['/work', '/work/toggle'], 'workspace-1')
    const { agent } = fakeAgent('s1', '/work', h.calls)
    h.agents.push({ agent })
    await h.grants.reconcile(agent)
    assert.deepEqual(h.calls, [])

    allow = true
    await h.grants.revalidateAll()
    assert.deepEqual(h.calls, [['register', 's1', '/work/toggle']])

    allow = false
    await h.grants.revalidateAll()
    assert.deepEqual(h.calls.at(-1), ['release', 's1', '/work/toggle'])
    assert.equal(h.registered.size, 0)
  })

  test('leaves unrelated sessions alone', async () => {
    const h = harness()
    h.grants.setRoots('/work', ['/work/a'], 'workspace-1')
    const { agent } = fakeAgent('s1', '/elsewhere', h.calls)
    await h.grants.reconcile(agent)
    assert.deepEqual(h.calls, [])
  })

  test('disposes every grant with the manager', async () => {
    const h = harness()
    h.grants.setRoots('/work', ['/work/a'], 'workspace-1')
    const first = fakeAgent('s1', '/work', h.calls)
    const second = fakeAgent('s2', '/work', h.calls)
    await h.grants.reconcile(first.agent)
    await h.grants.reconcile(second.agent)
    h.grants.dispose()
    assert.equal(h.registered.size, 0)
    assert.deepEqual(h.calls.filter(call => call[0] === 'release').map(call => call[1]).sort(), ['s1', 's2'])
  })

  test('a refused sandbox registration never fails the agent', async () => {
    const h = harness({ throwOnRegister: true })
    h.grants.setRoots('/work', ['/work/a'], 'workspace-1')
    const { agent } = fakeAgent('s1', '/work', h.calls)
    await assert.doesNotReject(h.grants.reconcile(agent))
    assert.deepEqual(h.calls, [['register', 's1', '/work/a']])
  })

  test('a folder that now belongs to a different workspace grants nothing', async () => {
    let liveId = 'workspace-1'
    const h = harness({ workspaceIdForPath: () => liveId })
    h.grants.setRoots('/work', ['/work/a'], 'workspace-1')
    const { agent } = fakeAgent('s1', '/work', h.calls)
    await h.grants.reconcile(agent)
    assert.equal(h.registered.size, 1)

    liveId = 'workspace-2'
    await h.grants.reconcile(agent)
    assert.equal(h.registered.size, 0)
    assert.deepEqual(h.calls.at(-1), ['release', 's1', '/work/a'])

    // The stale mapping was dropped: restoring the original id does not revive it.
    liveId = 'workspace-1'
    await h.grants.reconcile(agent)
    assert.equal(h.registered.size, 0)
  })
})
