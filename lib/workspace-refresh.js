/**
 * Re-read `.code-workspace` files and refresh the plugin's recorded roots.
 *
 * The plugin stores roots at open time. This refresher keeps the durable
 * history, the additional writable roots, and the browser collaborators in
 * step with on-disk edits: callers force a read when a workspace is opened from
 * the project list or the file tab reloads, while `@` completion performs a
 * cheap mtime/size signature check before deciding to read the whole file.
 *
 * @module @msnex/dsh-project-workspace/lib/workspace-refresh
 */

import { readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { MAX_WORKSPACE_FILE_BYTES, parseWorkspaceFile, resolveExistingRoots } from './workspace-file.js'

/**
 * Create the workspace file refresher.
 * @param options - history store, live workspace lookup, roots sink, and logger.
 * @returns the refresh face.
 */
export function createWorkspaceRefresher({ history, getWorkspace, onRoots = () => {}, logger = () => {} }) {
  /** File signatures keyed by workspace id and file path. */
  const signatures = new Map()
  /** Shared non-forced refreshes, so repeated completion queries do not read the same file. */
  const pending = new Map()

  /**
   * Stable cache key for one history entry.
   * @param entry - history entry.
   * @returns the key.
   */
  function keyOf(entry) {
    return `${String(entry.workspaceId)}\u0000${String(entry.file)}`
  }

  /**
   * Read one entry's file signature without reading its contents.
   * @param file - absolute `.code-workspace` file.
   * @returns the signature, or undefined when the file is missing or not a file.
   */
  async function fileState(file) {
    try {
      const info = await stat(file)
      if (!info.isFile()) return undefined
      return {
        signature: `${info.mtimeMs}:${info.ctimeMs}:${info.size}`,
        size: info.size,
      }
    } catch {
      return undefined
    }
  }

  /**
   * Read a workspace file and resolve its existing roots.
   * @param file - absolute `.code-workspace` file.
   * @param size - known file size.
   * @returns the resolved roots in declared order.
   */
  async function rootsForFile(file, size) {
    if (size > MAX_WORKSPACE_FILE_BYTES) throw new Error('the workspace file is too large')
    const text = await readFile(file, 'utf8')
    const parsed = parseWorkspaceFile(text)
    return resolveExistingRoots(parsed.folders, dirname(file))
  }

  /**
   * Whether two root lists are identical in order.
   * @param left - current roots.
   * @param right - next roots.
   * @returns whether they match.
   */
  function sameRoots(left, right) {
    return left.length === right.length && left.every((root, index) => root === right[index])
  }

  /**
   * Refresh one entry.
   * @param entry - history entry.
   * @param options - whether to bypass the signature cache.
   * @returns the refreshed entry, or the original entry on failure/no change.
   */
  async function refreshNow(entry, { force }) {
    let workspace
    try {
      workspace = getWorkspace(entry.workspaceId)
    } catch (error) {
      logger('workspace refresh: registry lookup failed', error)
      return entry
    }
    if (workspace === undefined || workspace === null) return entry
    const state = await fileState(entry.file)
    if (state === undefined) {
      logger('workspace refresh: file unavailable', entry.file)
      return entry
    }
    const key = keyOf(entry)
    if (!force && signatures.get(key) === state.signature) return entry
    let roots
    try {
      roots = await rootsForFile(entry.file, state.size)
    } catch (error) {
      logger('workspace refresh: file read/parse failed', entry.file, error)
      signatures.set(key, state.signature)
      return entry
    }
    if (roots.length === 0) {
      logger('workspace refresh: no declared folder exists', entry.file)
      signatures.set(key, state.signature)
      return entry
    }
    if (sameRoots(entry.roots, roots)) {
      signatures.set(key, state.signature)
      return entry
    }
    let updated
    try {
      updated = await history.update({ workspaceId: String(entry.workspaceId), roots })
    } catch (error) {
      logger('workspace refresh: history update failed', error)
      return entry
    }
    if (updated === undefined) {
      signatures.set(key, state.signature)
      return entry
    }
    signatures.set(key, state.signature)
    try {
      onRoots(workspace.path, updated.roots, String(entry.workspaceId))
    } catch (error) {
      logger('workspace refresh: roots sink failed', error)
    }
    return updated
  }

  /**
   * Refresh one entry, sharing non-forced reads for the same workspace file.
   * @param entry - history entry.
   * @param options - `{ force }`; force bypasses the signature cache.
   * @returns the refreshed entry, or the original entry on failure/no change.
   */
  function refreshEntry(entry, options = {}) {
    if (entry === null || typeof entry !== 'object') return Promise.resolve(entry)
    if (typeof entry.file !== 'string' || entry.file === '') return Promise.resolve(entry)
    const force = options.force === true
    const key = keyOf(entry)
    const previous = pending.get(key)
    if (previous !== undefined && !force) return previous
    const task = refreshNow(entry, { force })
      .catch((error) => {
        logger('workspace refresh failed', error)
        return entry
      })
      .finally(() => {
        if (pending.get(key) === task) pending.delete(key)
      })
    if (!force) pending.set(key, task)
    return task
  }

  /**
   * Refresh every entry, preserving order and falling back per entry.
   * @param entries - history entries.
   * @returns the effective entries.
   */
  async function refreshAll(entries) {
    if (!Array.isArray(entries)) return []
    const refreshed = []
    for (const entry of entries) {
      try {
        refreshed.push(await refreshEntry(entry))
      } catch (error) {
        logger('workspace refresh failed', error)
        refreshed.push(entry)
      }
    }
    return refreshed
  }

  return { refreshEntry, refreshAll }
}
