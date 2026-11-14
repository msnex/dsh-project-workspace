/**
 * Host half of the code-workspace bundle.
 *
 * It serves the WorkSpaces page over Connection's authenticated fetch fence,
 * records the workspaces opened from `.code-workspace` files, and grants every
 * declared folder beyond the session root as an additional writable directory
 * for the sessions that run in that workspace.
 *
 * @module @local/dsh-codespace
 */

import { realpathSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { workspaceHistoryFile } from './lib/dsh-home.js'
import { createWorkspaceGrants } from './lib/grants.js'
import { createHistory } from './lib/history.js'
import { createWorkspaceRoutes } from './lib/routes.js'

/** Services the Host half cannot work without. */
export const inject = ['agents', 'connection', 'sandboxPolicy', 'timer', 'workspaceRegistry']

/** Exact routes and the handler each one serves. */
const ROUTES = [
  ['/api/codespace.browse', 'browse'],
  ['/api/codespace.dir', 'dir'],
  ['/api/codespace.list', 'list'],
  ['/api/codespace.open', 'open'],
  ['/api/codespace.search', 'search'],
]

/** Revalidation interval for registered writable roots. */
const REVALIDATE_MS = 60_000

/**
 * Mount the Host half.
 * @param ctx - Host context carrying the injected services.
 * @returns nothing.
 */
export function apply(ctx) {
  const log = (...args) => {
    try {
      ctx.logger?.warn?.('[codespace]', ...args)
    } catch {
      // Logging must never affect the feature.
    }
  }

  const history = createHistory({ file: workspaceHistoryFile(), logger: log })
  let reconcileScheduled = false
  const grants = createWorkspaceGrants({
    registerWritableRoot: (session, directory) => ctx.sandboxPolicy.registerWritableRoot(session, directory),
    listAgents: () => ctx.agents.list(),
    workspaceIdForPath: (path) => {
      const workspace = ctx.workspaceRegistry.list().find(value => value.path === path)
      return workspace === undefined ? undefined : String(workspace.id)
    },
    statDirectory: async (path) => (await stat(path)).isDirectory(),
    // Grants are compared against the sandbox's native real path, so resolve
    // with the same implementation; a non-physical spelling would be refused.
    realpathPath: async path => realpathSync.native(path),
    logger: log,
  })

  const routes = createWorkspaceRoutes({
    getRegistry: () => ctx.workspaceRegistry,
    history,
    onRoots: (workspacePath, roots, workspaceId) => {
      grants.setRoots(workspacePath, roots, workspaceId)
      // A page read or an open can publish many workspace folders in one
      // request; coalesce the follow-up reconciliation into one pass.
      if (reconcileScheduled) return
      reconcileScheduled = true
      void Promise.resolve()
        .then(() => {
          reconcileScheduled = false
          return grants.reconcileAll()
        })
        .catch((error) => { log('reconciliation failed', error) })
    },
    logger: log,
  })

  ctx.effect(() => {
    const disposers = ROUTES.map(([path, name]) => ctx.connection.fetch.register({
      path,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: routes[name],
    }))
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch (error) {
          log('route disposal failed', error)
        }
      }
    }
  }, 'codespace: routes')

  // Load the association between workspace directories and declared folders,
  // then reconcile every agent that is already live.
  const ready = history.load()
    .then((entries) => {
      for (const entry of entries) {
        const workspace = ctx.workspaceRegistry.get(entry.workspaceId)
        if (workspace !== undefined) grants.setRoots(workspace.path, entry.roots, String(workspace.id))
      }
      return grants.reconcileAll()
    })
    .catch((error) => { log('initialization failed', error) })

  // The listener runs inside the serial `agent/created` dispatch, where a throw
  // would fail the whole session creation. Everything is contained here.
  ctx.on('agent/created', async (payload) => {
    try {
      await ready
      await grants.reconcile(payload?.agent)
    } catch (error) {
      log('agent/created grant failed', error)
    }
  })

  ctx.on('agent/disposed', (payload) => {
    try {
      grants.disposeAgent(payload?.agent)
    } catch (error) {
      log('agent/disposed grant cleanup failed', error)
    }
  })

  ctx.effect(() => {
    const stop = ctx.timer.interval(() => {
      void grants.revalidateAll()
    }, REVALIDATE_MS)
    return () => {
      try {
        stop()
      } finally {
        grants.dispose()
      }
    }
  }, 'codespace: writable roots')
}
