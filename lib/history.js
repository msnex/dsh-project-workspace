/**
 * Durable record of the workspaces opened from `.code-workspace` files.
 *
 * The record stores the association the DSH registry cannot: which workspace
 * file produced one workspace, and which folders that file declared. Writes
 * serialize through one chain and commit with a same-directory atomic rename.
 *
 * @module @msnex/dsh-project-workspace/lib/history
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Current on-disk document version. */
const VERSION = 1

/** Retained entries, most recently opened first. */
const MAX_ENTRIES = 100

/**
 * Whether one stored entry has the required shape.
 * @param value - decoded entry.
 * @returns whether the entry can be used.
 */
function isValidEntry(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.workspaceId === 'string'
    && value.workspaceId !== ''
    && typeof value.file === 'string'
    && value.file !== ''
    && Array.isArray(value.roots)
    && value.roots.every(root => typeof root === 'string' && root !== '')
    && typeof value.openedAt === 'string'
}

/**
 * Create the plugin's history store.
 * @param options - storage file and diagnostic logger.
 * @returns the history face used by the routes.
 */
export function createHistory({ file, logger = () => {} }) {
  /** @type {Array<{workspaceId: string, file: string, roots: string[], openedAt: string}> | null} */
  let entries = null
  /** @type {Promise<unknown> | null} */
  let loading = null
  /** @type {Promise<unknown>} */
  let writeChain = Promise.resolve()

  /**
   * Move an unreadable document aside so the next write starts clean.
   * @returns resolution after the best-effort backup.
   */
  async function backup() {
    try {
      await rename(file, `${file}.bak`)
    } catch (error) {
      logger('history backup failed', error)
    }
  }

  /**
   * Read the document once into memory.
   * @returns resolution after initialization.
   */
  async function initialize() {
    try {
      const text = await readFile(file, 'utf8')
      const document = JSON.parse(text)
      if (document === null || typeof document !== 'object' || document.version !== VERSION
        || !Array.isArray(document.entries)) {
        logger('history document has an unsupported shape; starting empty')
        await backup()
        entries = []
        return
      }
      entries = document.entries.filter(isValidEntry).slice(0, MAX_ENTRIES).map(entry => ({
        workspaceId: entry.workspaceId,
        file: entry.file,
        roots: [...new Set(entry.roots)],
        openedAt: entry.openedAt,
      }))
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        logger('history load failed', error)
        await backup()
      }
      entries = []
    }
  }

  /**
   * Load the document once and return the current entries.
   * @returns the retained entries.
   */
  async function load() {
    if (loading === null) loading = initialize()
    await loading
    return entries ?? []
  }

  /** @returns the loaded entries, or an empty list before the first load. */
  function snapshot() {
    return entries ?? []
  }

  /**
   * Atomically replace the durable document.
   * @returns resolution after the rename.
   */
  async function persist() {
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporary, `${JSON.stringify({ version: VERSION, entries }, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, file)
  }

  /**
   * Queue one write on the shared chain.
   * @param task - write body.
   * @returns the task's result.
   */
  function enqueue(task) {
    const next = writeChain.then(task, task)
    writeChain = next.then(() => undefined, () => undefined)
    return next
  }

  /**
   * Record one opened workspace, moving it to the front.
   * @param input - workspace identity, source file, and declared folders.
   * @returns the stored entry.
   */
  async function upsert(input) {
    await load()
    return enqueue(async () => {
      const entry = {
        workspaceId: String(input.workspaceId),
        file: String(input.file),
        roots: [...new Set((input.roots ?? []).map(String))],
        openedAt: new Date().toISOString(),
      }
      entries = [entry, ...(entries ?? []).filter(value => value.workspaceId !== entry.workspaceId)]
        .slice(0, MAX_ENTRIES)
      await persist()
      return entry
    })
  }

  /**
   * Replace one entry's roots (and optionally its file) without changing its
   * position or open time.
   * @param input - workspace identity, replacement roots, and optional file.
   * @returns the updated entry, the unchanged entry, or undefined when absent.
   */
  async function update(input) {
    await load()
    return enqueue(async () => {
      const workspaceId = String(input.workspaceId ?? '')
      const index = (entries ?? []).findIndex(entry => entry.workspaceId === workspaceId)
      if (index < 0) return undefined
      const current = entries[index]
      const roots = Array.isArray(input.roots)
        ? [...new Set(input.roots.filter(root => typeof root === 'string' && root !== ''))]
        : current.roots
      const file = typeof input.file === 'string' && input.file !== '' ? input.file : current.file
      const unchanged = file === current.file
        && roots.length === current.roots.length
        && roots.every((root, rootIndex) => root === current.roots[rootIndex])
      if (unchanged) return current
      const entry = { ...current, file, roots }
      entries = [...entries.slice(0, index), entry, ...entries.slice(index + 1)]
      await persist()
      return entry
    })
  }

  /**
   * Drop entries whose workspace no longer exists.
   * @param liveIds - workspace ids the registry currently reports.
   * @returns whether the document changed.
   */
  async function prune(liveIds) {
    await load()
    return enqueue(async () => {
      const live = new Set(liveIds.map(String))
      const next = (entries ?? []).filter(entry => live.has(entry.workspaceId))
      if (next.length === (entries ?? []).length) return false
      entries = next
      await persist()
      return true
    })
  }

  return { file, load, snapshot, upsert, update, prune }
}
