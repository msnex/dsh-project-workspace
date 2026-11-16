/**
 * Shared helpers for the browser `@` reference source: mention formatting,
 * workspace-relative drill paths, root display names, and deterministic
 * candidate ranking.
 *
 * The module is filesystem-free so it can be unit-tested directly. The Host
 * route owns confinement, directory reads, and search limits.
 *
 * @module @msnex/dsh-project-workspace/lib/references
 */

import * as nodePath from 'node:path'

/** Ranked candidates returned for one `@` query. */
export const MAX_REFERENCE_RESULTS = 30

/** Ranked candidates returned for one root directory. */
export const MAX_REFERENCE_ROOT_RESULTS = 10

/**
 * Normalize a native path spelling to the `/` separators used by the client.
 * @param path - native path.
 * @returns the `/`-separated path.
 */
export function toPosix(path) {
  return String(path).replace(/\\/g, '/')
}

/**
 * A stable key for comparing workspace and root directories.
 * @param path - absolute path in either separator spelling.
 * @returns the path without trailing separators (the filesystem root keeps `/`).
 */
export function pathKey(path) {
  const normalized = toPosix(path).replace(/\/+$/, '')
  return normalized === '' ? '/' : normalized
}

/**
 * Format one selected path as `@` prompt text.
 *
 * Directory mentions keep the trailing slash. A quoted token, or a path that
 * contains whitespace, uses the quoted grammar. A directory keeps its quote
 * open so completion can continue below it, matching the shipped grammar.
 *
 * @param path - absolute or workspace-relative path.
 * @param kind - `file` or `directory`.
 * @param quoted - whether the active token is already quoted.
 * @returns the insertion text, or undefined for a path the grammar cannot represent.
 */
export function formatReferenceMention(path, kind, quoted) {
  const raw = toPosix(path)
  if (raw === '') return undefined
  const value = kind === 'directory' ? `${raw.replace(/\/+$/, '')}/` : raw
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(value)) return undefined
  const needsQuote = quoted === true || /\s/u.test(value)
  if (kind === 'directory') return needsQuote ? `@"${value}` : `@${value}`
  return needsQuote ? `@"${value}"` : `@${value}`
}

/**
 * Express one directory as a path relative to the workspace root.
 *
 * Drill text is workspace-relative so the shipped `@` breadcrumbs stay
 * meaningful while browsing a root outside the primary directory. A relative
 * spelling is prefixed with `./` to mark a workspace-relative browse; paths
 * outside the primary root keep their `../` prefix. Cross-volume targets on
 * Windows cannot be represented and return undefined.
 *
 * @param workspacePath - the workspace root / session cwd.
 * @param target - the absolute target directory.
 * @param pathApi - path implementation, injectable for cross-platform tests.
 * @returns the relative path, or undefined when no relative spelling exists.
 */
export function relativeDrillPath(workspacePath, target, pathApi = nodePath) {
  if (typeof workspacePath !== 'string' || workspacePath === '') return undefined
  if (typeof target !== 'string' || target === '') return undefined
  let relative
  try {
    relative = pathApi.relative(workspacePath, target)
  } catch {
    return undefined
  }
  if (typeof relative !== 'string') return undefined
  if (relative === '') return '.'
  if (pathApi.isAbsolute(relative)) return undefined
  const posix = toPosix(relative)
  if (posix === '..' || posix.startsWith('../')) return posix
  if (posix.startsWith('./')) return posix
  return `./${posix}`
}

/**
 * Display names for a workspace's roots: the basename, disambiguated with an
 * order suffix when two roots share one.
 * @param roots - root directories in declared order.
 * @returns one display name per root.
 */
export function rootDisplayNames(roots) {
  const bases = roots.map((root) => {
    const posix = toPosix(root).replace(/\/+$/, '')
    const slash = posix.lastIndexOf('/')
    const base = slash < 0 ? posix : posix.slice(slash + 1)
    return base === '' ? toPosix(root) : base
  })
  const counts = new Map()
  for (const base of bases) counts.set(base, (counts.get(base) ?? 0) + 1)
  const used = new Map()
  return roots.map((root, index) => {
    const base = bases[index]
    if (counts.get(base) === 1) return base
    const next = (used.get(base) ?? 0) + 1
    used.set(base, next)
    return `${base} (${next})`
  })
}

/**
 * The parent directory of one candidate, relative to its root.
 * @param root - root directory.
 * @param candidatePath - absolute candidate path.
 * @returns the relative parent path, or the empty string at the root level.
 */
export function parentRelative(root, candidatePath) {
  const rootPrefix = toPosix(root).replace(/\/+$/, '')
  const path = toPosix(candidatePath)
  if (path === rootPrefix) return ''
  const prefix = rootPrefix === '' ? '/' : `${rootPrefix}/`
  if (!path.startsWith(prefix)) return ''
  const rest = path.slice(prefix.length)
  const slash = rest.lastIndexOf('/')
  return slash < 0 ? '' : rest.slice(0, slash)
}

/**
 * Score one candidate name against a fragment.
 * @param name - entry name.
 * @param needle - lower-cased query fragment.
 * @param kind - candidate kind.
 * @returns the score, or undefined when the name does not match.
 */
function scoreName(name, needle, kind) {
  if (needle === '') return kind === 'directory' ? 1 : 0
  const lower = name.toLowerCase()
  const bonus = kind === 'directory' ? 25 : 0
  if (lower === needle) return 1000 + bonus
  if (lower.startsWith(needle)) return 900 + bonus
  if (lower.includes(needle)) return 700 + bonus
  const subsequence = subsequenceScore(lower, needle)
  return subsequence === undefined ? undefined : 300 + subsequence + bonus
}

/**
 * Score a query as a subsequence of a name, preferring tight matches.
 * @param target - lower-cased target.
 * @param query - lower-cased needle.
 * @returns the score, or undefined when the query is not a subsequence.
 */
function subsequenceScore(target, query) {
  let targetIndex = 0
  let gap = 0
  for (const character of query) {
    const found = target.indexOf(character, targetIndex)
    if (found < 0) return undefined
    gap += found - targetIndex
    targetIndex = found + 1
  }
  return Math.max(0, 100 - gap)
}

/**
 * Deterministically rank candidates by name fragment, directories first for
 * equal scores, then by name.
 * @param candidates - candidates carrying `name` and `kind`.
 * @param query - fragment following the last `/` of the query.
 * @param limit - maximum results.
 * @returns the ranked candidates.
 */
export function rankCandidates(candidates, query, limit = Number.POSITIVE_INFINITY) {
  const needle = String(query).toLowerCase()
  const scored = []
  for (const candidate of candidates) {
    const score = scoreName(candidate.name, needle, candidate.kind)
    if (score === undefined) continue
    scored.push({ candidate, score })
  }
  scored.sort((left, right) => right.score - left.score
    || (left.candidate.kind === right.candidate.kind ? 0 : left.candidate.kind === 'directory' ? -1 : 1)
    || compareText(left.candidate.name, right.candidate.name))
  return scored.slice(0, limit).map(entry => entry.candidate)
}

/**
 * Stable case-sensitive text comparison used for deterministic ordering.
 * @param left - left value.
 * @param right - right value.
 * @returns comparison result.
 */
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}
