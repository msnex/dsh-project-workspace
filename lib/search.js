/**
 * Bounded name and relative-path search across a workspace's folders.
 *
 * DSH's shipped workspace search is rooted at one Session directory, so a
 * multi-root workspace cannot use it for its other folders. This module walks
 * every declared folder over Node's filesystem with hard bounds on time,
 * scanned entries, and returned matches, and reports truncation and
 * incompleteness instead of failing the page.
 *
 * @module @msnex/dsh-project-workspace/lib/search
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Returned matches across every root. */
export const MAX_SEARCH_RESULTS = 200

/** Directory entries inspected across every root. */
export const MAX_SEARCH_SCANNED = 30000

/** Wall-clock budget of one search, in milliseconds. */
export const SEARCH_TIMEOUT_MS = 2500

/** Directories read in one parallel batch. */
export const SEARCH_CONCURRENCY = 16

/** Roots one search may name. */
export const MAX_SEARCH_ROOTS = 64

/** Characters one query may carry. */
export const MAX_SEARCH_QUERY_LENGTH = 200

/** Defaults callers may override in tests. */
export const SEARCH_LIMITS = Object.freeze({
  maxResults: MAX_SEARCH_RESULTS,
  maxScanned: MAX_SEARCH_SCANNED,
  timeoutMs: SEARCH_TIMEOUT_MS,
  concurrency: SEARCH_CONCURRENCY,
})

/** Version-control metadata never contributes matches. */
const VCS_NAMES = new Set(['.git', '.svn', '.hg', '.bzr', '.jj', '.sl'])

/** Dependency trees never contribute matches, whether hidden or not. */
const SKIP_NAMES = new Set(['node_modules'])

/**
 * Normalize a native path spelling to the tree's `/` separators.
 * @param path - native absolute path.
 * @returns the `/`-separated path.
 */
function toPosix(path) {
  return path.replace(/\\/g, '/')
}

/**
 * Search every root by name, or by root-relative path when the query carries
 * a `/`. Symbolic links are neither matched nor followed.
 * @param roots - existing absolute directories in display order.
 * @param query - non-empty query; surrounding whitespace is ignored.
 * @param options - hidden-entry switch, limit overrides, and cancellation.
 * @returns grouped matches plus truncation and incompleteness flags.
 */
export async function searchWorkspaceRoots(roots, query, options = {}) {
  const limits = { ...SEARCH_LIMITS, ...(options.limits ?? {}) }
  const needle = String(query).trim().toLowerCase()
  const includeHidden = options.includeHidden === true
  const signal = options.signal
  const byPath = needle.includes('/')
  const started = Date.now()
  let scanned = 0
  let results = 0
  let truncated = false
  let incomplete = false

  const groups = roots.map(root => ({
    root: toPosix(root),
    matches: [],
  }))
  const queue = roots.map((root, index) => ({ nativeDir: root, relDir: '', group: groups[index] }))

  let cursor = 0
  outer: while (cursor < queue.length) {
    if (signal?.aborted || Date.now() - started > limits.timeoutMs) {
      incomplete = true
      break
    }
    const batch = queue.slice(cursor, cursor + limits.concurrency)
    cursor += batch.length
    const listings = await Promise.all(batch.map(async (item) => {
      try {
        return { item, entries: await readdir(item.nativeDir, { withFileTypes: true }) }
      } catch {
        return { item, entries: null }
      }
    }))
    for (const { item, entries } of listings) {
      if (entries === null) {
        incomplete = true
        continue
      }
      for (const entry of entries) {
        if (signal?.aborted) {
          incomplete = true
          break outer
        }
        const name = entry.name
        if (VCS_NAMES.has(name) || SKIP_NAMES.has(name)) continue
        const hidden = name.startsWith('.')
        if (hidden && !includeHidden) continue
        const isDirectory = entry.isDirectory()
        if (!isDirectory && !entry.isFile()) continue
        scanned += 1
        if (scanned > limits.maxScanned) {
          incomplete = true
          break outer
        }
        const relative = item.relDir === '' ? name : `${item.relDir}/${name}`
        const haystack = byPath ? relative : name
        if (haystack.toLowerCase().includes(needle)) {
          const base = item.group.root.replace(/\/+$/, '')
          item.group.matches.push({
            path: `${base}/${relative}`,
            kind: isDirectory ? 'directory' : 'file',
          })
          results += 1
          if (results >= limits.maxResults) {
            truncated = true
            break outer
          }
        }
        if (isDirectory) {
          queue.push({ nativeDir: join(item.nativeDir, name), relDir: relative, group: item.group })
        }
      }
      if (Date.now() - started > limits.timeoutMs) {
        incomplete = true
        break outer
      }
    }
  }

  const ordered = groups
    .filter(group => group.matches.length > 0)
    .map(({ root, matches }) => ({
      root,
      matches: [...matches].sort((left, right) => {
        const depth = left.path.split('/').length - right.path.split('/').length
        return depth || (left.path < right.path ? -1 : 1)
      }),
    }))
  return { groups: ordered, truncated, incomplete }
}
