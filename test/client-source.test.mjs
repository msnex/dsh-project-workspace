/** Browser `@` source: rows, native folder/file picks, and default highlight focus. */

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

/** The captured Client loader descriptor and its factory exports. */
let loaded
/** @type {{ apply: (ctx: unknown) => void }} */
let exported

before(async () => {
  globalThis.window = { __ModuleLoader__: { load(value) { loaded = value } } }
  await import('../client.js')
  const React = {
    createElement(type, props, ...children) {
      return { type, props, children }
    },
    Fragment: 'Fragment',
  }
  exported = loaded.factory(() => React)
})

after(() => {
  delete globalThis.window
})

/** Roots and candidates returned by the Host references route. */
const payload = {
  ok: true,
  roots: [
    {
      path: '/ws/primary',
      name: 'primary',
      primary: true,
      mention: '@/ws/primary/',
      drillMention: '@./',
    },
    {
      path: '/ws/extra',
      name: 'extra',
      primary: false,
      mention: '@/ws/extra/',
      drillMention: '@../extra/',
    },
  ],
  groups: [{
    root: '/ws/extra',
    name: 'extra',
    candidates: [
      {
        path: '/ws/extra/src',
        name: 'src',
        kind: 'directory',
        parent: '',
        mention: '@/ws/extra/src/',
        drillMention: '@../extra/src/',
      },
      {
        path: '/ws/extra/a.ts',
        name: 'a.ts',
        kind: 'file',
        parent: '',
        mention: '@/ws/extra/a.ts',
      },
    ],
  }],
}

/** The menu snapshot the fake controller reports. */
function menuState(overrides = {}) {
  return {
    open: true,
    hit: { query: 'a' },
    groups: [{ source: 'project-workspace', status: 'ready', items: [{}] }],
    highlight: { source: 'reference', index: 0 },
    ...overrides,
  }
}

/**
 * Mount the browser plugin against a fake Client context.
 * @param options - initial menu and service overrides.
 * @returns the captured source, focus calls, mutable state, and controller.
 */
function createHarness(options = {}) {
  const state = { menu: options.menu ?? menuState() }
  const hoverCalls = []
  const controller = {
    menu: { getSnapshot: () => state.menu },
    hover(source, index) {
      hoverCalls.push([source, index])
    },
  }
  const inputTriggers = options.inputTriggers ?? {
    registerSource() {
      return () => {}
    },
    sessionOf() {
      return controller
    },
  }
  const sessions = options.sessions ?? {
    binding(sessionId) {
      return sessionId === 's1' ? { ctx: {} } : undefined
    },
  }
  let source
  const registered = {
    ...inputTriggers,
    registerSource(value) {
      source = value
      return inputTriggers.registerSource(value)
    },
  }
  const ctx = {
    effect(callback) {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    on() {
      return () => {}
    },
    get(name) {
      return name === 'sessions' ? sessions : undefined
    },
    locale: {
      register() {
        return () => {}
      },
      bind() {
        return key => key
      },
    },
    slots: {
      inject() {
        return () => {}
      },
      register() {
        return () => {}
      },
    },
    workspaces: {},
    uiWorkspace: {},
    inject(services, callback) {
      if (services.includes('inputTriggers')) {
        callback({
          effect(inner) {
            const disposer = inner()
            return typeof disposer === 'function' ? disposer : () => {}
          },
          inputTriggers: registered,
        })
      }
      return () => {}
    },
  }
  exported.apply(ctx)
  return { source, hoverCalls, state, controller, inputTriggers, sessions }
}

/**
 * Run one operation with a stubbed Host payload.
 * @param body - response body.
 * @param operation - operation to run.
 * @returns the operation result.
 */
async function withPayload(body, operation) {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => body })
  try {
    return await operation()
  } finally {
    globalThis.fetch = original
  }
}

/** Let the 150ms candidate debounce and the 0ms focus timer run. */
async function settleFocus() {
  await new Promise(resolve => setTimeout(resolve, 20))
}

/**
 * Request candidates from the captured source.
 * @param source - source under test.
 * @param query - query text.
 * @param signal - optional request signal.
 * @returns the candidate rows.
 */
async function requestCandidates(source, query, signal = new AbortController().signal) {
  return source.candidates({ sessionId: 's1' }, { query, quoted: false, signal })
}

test('registers the project workspace source before the shipped reference source', () => {
  const { source } = createHarness()
  assert.equal(source.trigger, '@')
  assert.equal(source.name, 'project-workspace')
  assert.equal(source.order, -10)
  assert.equal(source.showGroupTitle, false)
})

test('lists roots on an empty query without stealing the empty-menu highlight', async () => {
  const { source, hoverCalls } = createHarness({ menu: menuState({ hit: { query: '' } }) })
  const rows = await withPayload(payload, () => requestCandidates(source, ''))
  assert.equal(rows.length, 2)
  assert.equal(rows[0].section, 'mention.workspace')
  assert.equal(rows[0].name, 'primary/')
  await settleFocus()
  assert.deepEqual(hoverCalls, [])
})

test('keeps native folder pick, drill, and file pick behavior', async () => {
  const { source } = createHarness()
  const rows = await withPayload(payload, () => requestCandidates(source, 'a'))
  const folder = rows.find(row => row.name === 'src/')
  const file = rows.find(row => row.name === 'a.ts')
  assert.ok(folder !== undefined)
  assert.ok(file !== undefined)
  assert.equal(folder.drill, true)
  assert.deepEqual(source.onPick({ candidate: folder, action: 'pick' }), {
    insert: {
      source: 'reference',
      ref: '@/ws/extra/src/',
      label: 'src/',
      appearance: 'folder',
      clipboardText: '@/ws/extra/src/',
    },
  })
  assert.deepEqual(source.onPick({ candidate: folder, action: 'drill' }), {
    text: '@../extra/src/',
    continue: true,
  })
  assert.deepEqual(source.onPick({ candidate: file, action: 'pick' }), {
    insert: {
      source: 'reference',
      ref: '@/ws/extra/a.ts',
      label: 'a.ts',
      appearance: 'file',
      clipboardText: '@/ws/extra/a.ts',
    },
  })
})

test('focuses the project workspace group when the core group owns the default highlight', async () => {
  const { source, hoverCalls } = createHarness({ menu: menuState() })
  await withPayload(payload, () => requestCandidates(source, 'a'))
  await settleFocus()
  assert.deepEqual(hoverCalls, [['project-workspace', 0]])
})

test('focuses when the menu has no highlight yet', async () => {
  const { source, hoverCalls } = createHarness({ menu: menuState({ highlight: null }) })
  await withPayload(payload, () => requestCandidates(source, 'a'))
  await settleFocus()
  assert.deepEqual(hoverCalls, [['project-workspace', 0]])
})

test('does not steal a highlight the user moved to another core row', async () => {
  const { source, hoverCalls } = createHarness({ menu: menuState({ highlight: { source: 'reference', index: 2 } }) })
  await withPayload(payload, () => requestCandidates(source, 'a'))
  await settleFocus()
  assert.deepEqual(hoverCalls, [])
})

test('does not touch a highlight already inside the project workspace group', async () => {
  const { source, hoverCalls } = createHarness({
    menu: menuState({ highlight: { source: 'project-workspace', index: 0 } }),
  })
  await withPayload(payload, () => requestCandidates(source, 'a'))
  await settleFocus()
  assert.deepEqual(hoverCalls, [])
})

test('does nothing when the menu is closed or the query changed', async () => {
  const closed = createHarness({ menu: menuState({ open: false }) })
  await withPayload(payload, () => requestCandidates(closed.source, 'a'))
  await settleFocus()
  assert.deepEqual(closed.hoverCalls, [])

  const changed = createHarness({ menu: menuState({ hit: { query: 'ab' } }) })
  await withPayload(payload, () => requestCandidates(changed.source, 'a'))
  await settleFocus()
  assert.deepEqual(changed.hoverCalls, [])
})

test('does nothing when the project group is not ready or empty', async () => {
  const pending = createHarness({ menu: menuState({ groups: [{ source: 'project-workspace', status: 'pending', items: [] }] }) })
  await withPayload(payload, () => requestCandidates(pending.source, 'a'))
  await settleFocus()
  assert.deepEqual(pending.hoverCalls, [])

  const empty = createHarness({ menu: menuState({ groups: [{ source: 'project-workspace', status: 'ready', items: [] }] }) })
  await withPayload(payload, () => requestCandidates(empty.source, 'a'))
  await settleFocus()
  assert.deepEqual(empty.hoverCalls, [])
})

test('does nothing for aborted requests or an empty result', async () => {
  const aborted = createHarness()
  const controller = new AbortController()
  controller.abort()
  const rows = await withPayload(payload, () => requestCandidates(aborted.source, 'a', controller.signal))
  assert.deepEqual(rows, [])
  await settleFocus()
  assert.deepEqual(aborted.hoverCalls, [])

  const noRows = createHarness()
  const emptyPayload = { ok: true, roots: payload.roots, groups: [] }
  const emptyRows = await withPayload(emptyPayload, () => requestCandidates(noRows.source, 'a'))
  assert.deepEqual(emptyRows, [])
  await settleFocus()
  assert.deepEqual(noRows.hoverCalls, [])
})

test('swallows missing services and disposed controller errors', async () => {
  const missing = createHarness({ sessions: {} })
  await withPayload(payload, () => requestCandidates(missing.source, 'a'))
  await settleFocus()
  assert.deepEqual(missing.hoverCalls, [])

  const throwing = createHarness({
    inputTriggers: {
      registerSource() {
        return () => {}
      },
      sessionOf() {
        throw new Error('session generation is gone')
      },
    },
  })
  await withPayload(payload, () => requestCandidates(throwing.source, 'a'))
  await settleFocus()
  assert.deepEqual(throwing.hoverCalls, [])
})
