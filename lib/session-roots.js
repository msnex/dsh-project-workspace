/**
 * Resolve one live session's project-workspace roots.
 *
 * The plugin records the association between a DSH workspace and the folders
 * a `.code-workspace` file declared. The `@` reference source needs that
 * association for the current session: an agent cwd identifies the workspace,
 * the workspace id identifies the durable history entry, and the entry carries
 * every declared root in order.
 *
 * @module @msnex/dsh-project-workspace/lib/session-roots
 */

import { pathKey } from './references.js'

/**
 * Create the session-to-roots resolver used by the references route.
 * @param options - live-agent lookup, workspace lookup, history reader, and logger.
 * @returns a resolver returning `{ workspacePath, workspaceId, roots }` or undefined.
 */
export function createSessionRootResolver({ getAgent, getWorkspace, loadHistory, logger = () => {} }) {
  /**
   * @param sessionId - session whose project workspace should be resolved.
   * @returns the matching project-workspace roots, or undefined without one.
   */
  return async function resolveSessionRoots(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    let agent
    try {
      agent = getAgent(sessionId)
    } catch (error) {
      logger('session roots: agent lookup failed', error)
      return undefined
    }
    const cwd = agent?.session?.header?.cwd
    if (typeof cwd !== 'string' || cwd === '') return undefined
    let entries
    try {
      entries = await loadHistory()
    } catch (error) {
      logger('session roots: history lookup failed', error)
      return undefined
    }
    if (!Array.isArray(entries)) return undefined
    const key = pathKey(cwd)
    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object') continue
      let workspace
      try {
        workspace = getWorkspace(entry.workspaceId)
      } catch (error) {
        logger('session roots: workspace lookup failed', error)
        continue
      }
      if (workspace === undefined || workspace === null) continue
      if (pathKey(workspace.path) !== key) continue
      const roots = Array.isArray(entry.roots)
        ? [...new Set(entry.roots.filter(root => typeof root === 'string' && root !== ''))]
        : []
      if (roots.length === 0) return undefined
      return {
        workspacePath: cwd,
        workspaceId: String(entry.workspaceId),
        roots,
      }
    }
    return undefined
  }
}
