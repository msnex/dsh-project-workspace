/**
 * Authenticated Host routes behind the Project workspaces page and its file tab.
 *
 * Six exact POST routes live inside Connection's browser-authentication
 * fence: browse the filesystem for `.code-workspace` files, list one directory
 * level for the workspace tree, search every workspace folder, list the
 * workspaces this plugin opened, resolve one workspace file into a DSH
 * workspace, and supply `@` references across the project workspace's roots.
 *
 * @module @msnex/dsh-project-workspace/lib/routes
 */

import { readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  MAX_WORKSPACE_FILE_BYTES, WorkspaceFileError, browseDirectory, isFullyQualifiedPath,
  parseWorkspaceFile, readDirectoryEntries, resolveExistingRoots, titleForWorkspaceFile,
} from './workspace-file.js'
import { MAX_SEARCH_QUERY_LENGTH, MAX_SEARCH_ROOTS, searchWorkspaceRoots } from './search.js'
import { expandHomePath } from './dsh-home.js'
import {
  MAX_REFERENCE_RESULTS, MAX_REFERENCE_ROOT_RESULTS, formatReferenceMention, parentRelative,
  pathKey, rankCandidates, relativeDrillPath, rootDisplayNames, toPosix,
} from './references.js'

/** Directory basenames that never contribute to `@` references. */
const REFERENCE_EXCLUDED_DIRECTORIES = new Set([
  '.git', '.svn', '.hg', '.bzr', '.jj', '.sl', 'node_modules',
])

/**
 * Build a JSON response.
 * @param value - JSON value.
 * @param status - HTTP status.
 * @returns the response.
 */
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/**
 * Build a business-failure response.
 * @param code - stable code the client maps to a localized message.
 * @param message - diagnostic text.
 * @param status - HTTP status.
 * @returns the response.
 */
function failure(code, message, status = 200) {
  return json({ ok: false, code, message }, status)
}

/**
 * Read one JSON request body.
 * @param request - incoming request.
 * @returns the decoded object, or undefined when the body is not a JSON object.
 */
async function readBody(request) {
  try {
    const value = await request.json()
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Create the request handlers.
 * @param options - registry reader, history store, roots sink, session-root resolver, and logger.
 * @returns the handlers keyed by route name.
 */
export function createWorkspaceRoutes({
  getRegistry, history, onRoots = () => {}, resolveSessionRoots = async () => undefined, logger = () => {},
}) {
  /**
   * List one directory level for the picker.
   * @param request - POST body `{ path?, includeHidden? }`.
   * @returns the browse response.
   */
  async function browse(request) {
    try {
      const body = await readBody(request)
      if (body === undefined) return failure('bad-request', 'request body must be a JSON object', 400)
      const requested = typeof body.path === 'string' && body.path.trim() !== ''
        ? expandHomePath(body.path.trim())
        : homedir()
      if (!isFullyQualifiedPath(requested)) return failure('not-absolute', 'the directory must be an absolute path')
      let physical
      try {
        physical = await realpath(requested)
      } catch (error) {
        return failure('browse-failed', `cannot read the directory: ${String(error?.message ?? error)}`)
      }
      let info
      try {
        info = await stat(physical)
      } catch (error) {
        return failure('browse-failed', `cannot read the directory: ${String(error?.message ?? error)}`)
      }
      if (!info.isDirectory()) return failure('not-a-directory', 'the selected path is not a directory')
      const listing = await browseDirectory(physical, { includeHidden: body.includeHidden === true })
      return json({ ok: true, ...listing })
    } catch (error) {
      logger('browse failed', error)
      return failure('browse-failed', String(error?.message ?? error))
    }
  }

  /**
   * List the workspaces recorded for this plugin.
   * @returns the history rows joined with the live workspace registry.
   */
  async function list() {
    try {
      const entries = await history.load()
      const registry = getRegistry()
      const rows = []
      const liveIds = []
      for (const entry of entries) {
        const workspace = registry.get(entry.workspaceId)
        if (workspace === undefined) continue
        const workspaceId = String(workspace.id)
        liveIds.push(workspaceId)
        onRoots(workspace.path, entry.roots, workspaceId)
        rows.push({
          workspaceId,
          title: workspace.title,
          path: workspace.path,
          file: entry.file,
          roots: entry.roots,
          folderCount: entry.roots.length,
          openedAt: entry.openedAt,
        })
      }
      if (liveIds.length !== entries.length) await history.prune(liveIds)
      return json({ ok: true, entries: rows })
    } catch (error) {
      logger('list failed', error)
      return failure('internal', String(error?.message ?? error))
    }
  }

  /**
   * Resolve one workspace file to a DSH workspace and record it.
   * @param request - POST body `{ file }`.
   * @returns the resolved workspace, its folders, and an optional notice.
   */
  async function open(request) {
    try {
      const body = await readBody(request)
      if (body === undefined) return failure('bad-request', 'request body must be a JSON object', 400)
      await history.load()
      const requested = typeof body.file === 'string' ? body.file.trim() : ''
      if (requested === '') return failure('file-required', 'a workspace file is required')
      const expanded = expandHomePath(requested)
      if (!isFullyQualifiedPath(expanded)) return failure('not-absolute', 'the workspace file must be an absolute path')
      let file
      try {
        file = await realpath(expanded)
      } catch (error) {
        return failure('file-not-found', `cannot read the workspace file: ${String(error?.message ?? error)}`)
      }
      let info
      try {
        info = await stat(file)
      } catch (error) {
        return failure('file-not-found', `cannot read the workspace file: ${String(error?.message ?? error)}`)
      }
      if (!info.isFile()) return failure('not-a-file', 'the selected path is not a file')
      if (!/\.code-workspace$/i.test(file)) return failure('not-workspace-file', 'the selected file is not a .code-workspace file')
      if (info.size > MAX_WORKSPACE_FILE_BYTES) return failure('file-too-large', 'the workspace file is too large')
      let text
      try {
        text = await readFile(file, 'utf8')
      } catch (error) {
        return failure('file-unreadable', `cannot read the workspace file: ${String(error?.message ?? error)}`)
      }
      let parsed
      try {
        parsed = parseWorkspaceFile(text)
      } catch (error) {
        if (error instanceof WorkspaceFileError) return failure(error.code, error.message)
        throw error
      }
      const roots = await resolveExistingRoots(parsed.folders, dirname(file))
      if (roots.length === 0) return failure('no-existing-folders', 'none of the declared folders exists on disk')
      const directory = roots[0]
      const title = titleForWorkspaceFile(file)
      const registry = getRegistry()
      const workspaceAtTitle = registry.list().find(workspace => workspace.title === title)
      const previous = history.snapshot().find(entry => entry.workspaceId === String(workspaceAtTitle?.id ?? ''))
      let workspace = workspaceAtTitle
      let created = false
      let directoryTaken = false
      let titleFailed = false
      if (workspace === undefined) {
        let existing
        try {
          existing = await registry.resolveByPath(directory)
        } catch (error) {
          return failure('workspace-dir-missing', `cannot resolve the workspace directory: ${String(error?.message ?? error)}`)
        }
        if (existing !== undefined) {
          workspace = existing
          directoryTaken = existing.title !== title
        } else {
          // `create` is idempotent and returns an existing record for the same
          // path. Snapshot the ids so a concurrent writer's workspace is reused
          // instead of being renamed by this request.
          const before = new Set(registry.list().map(value => String(value.id)))
          try {
            workspace = await registry.create(directory)
          } catch (error) {
            return failure('workspace-create-failed', `cannot create the workspace: ${String(error?.message ?? error)}`)
          }
          if (before.has(String(workspace.id))) {
            directoryTaken = workspace.title !== title
          } else {
            created = true
            try {
              await workspace.setTitle(title)
            } catch (error) {
              // The workspace exists with its directory name; open it and
              // explain the naming failure instead of orphaning it.
              titleFailed = true
              logger('workspace title failed', error)
            }
          }
        }
      }
      const workspaceId = String(workspace.id)
      let notice = null
      if (titleFailed) {
        notice = { code: 'title-failed', title, current: workspace.title }
      } else if (workspaceAtTitle !== undefined && previous?.file !== file) {
        notice = { code: 'title-exists', title: workspace.title }
      } else if (directoryTaken) {
        notice = { code: 'dir-in-use', title: workspace.title }
      }
      let historySaved = true
      try {
        await history.upsert({ workspaceId, file, roots })
      } catch (error) {
        historySaved = false
        logger('history write failed', error)
      }
      onRoots(workspace.path, roots, workspaceId)
      if (!historySaved) notice = { code: 'history-unavailable' }
      return json({
        ok: true,
        workspaceId,
        title: workspace.title,
        path: workspace.path,
        file,
        roots,
        created,
        notice,
      })
    } catch (error) {
      logger('open failed', error)
      return failure('internal', String(error?.message ?? error))
    }
  }

  /**
   * List one directory level for the workspace files tree.
   * @param request - POST body `{ path }`.
   * @returns the directory listing.
   */
  async function dir(request) {
    try {
      const body = await readBody(request)
      if (body === undefined) return failure('bad-request', 'request body must be a JSON object', 400)
      const requested = typeof body.path === 'string' ? expandHomePath(body.path.trim()) : ''
      if (requested === '') return failure('bad-request', 'a directory path is required', 400)
      if (!isFullyQualifiedPath(requested)) return failure('not-absolute', 'the directory must be an absolute path')
      let physical
      try {
        physical = await realpath(requested)
      } catch (error) {
        return failure('not-found', `cannot read the directory: ${String(error?.message ?? error)}`)
      }
      let info
      try {
        info = await stat(physical)
      } catch (error) {
        return failure('not-found', `cannot read the directory: ${String(error?.message ?? error)}`)
      }
      if (!info.isDirectory()) return failure('not-a-directory', 'the selected path is not a directory')
      let listing
      try {
        listing = await readDirectoryEntries(physical)
      } catch (error) {
        return failure('unreadable', `cannot list the directory: ${String(error?.message ?? error)}`)
      }
      return json({ ok: true, path: physical, ...listing })
    } catch (error) {
      logger('dir failed', error)
      return failure('internal', String(error?.message ?? error))
    }
  }

  /**
   * Search every workspace folder by name or relative path.
   * @param request - POST body `{ roots, query, includeHidden? }`.
   * @returns grouped matches with truncation and incompleteness flags.
   */
  async function search(request) {
    try {
      const body = await readBody(request)
      if (body === undefined) return failure('bad-request', 'request body must be a JSON object', 400)
      const query = typeof body.query === 'string' ? body.query.trim() : ''
      if (query === '') return failure('bad-request', 'a query is required', 400)
      if (query.length > MAX_SEARCH_QUERY_LENGTH) return failure('bad-request', 'the query is too long', 400)
      const requestedRoots = Array.isArray(body.roots) ? body.roots : []
      if (requestedRoots.length === 0) return failure('bad-request', 'at least one root is required', 400)
      if (requestedRoots.length > MAX_SEARCH_ROOTS) return failure('bad-request', 'too many roots', 400)
      const roots = []
      let missingRoot = false
      for (const value of requestedRoots) {
        if (typeof value !== 'string' || value.trim() === '') {
          missingRoot = true
          continue
        }
        const expanded = expandHomePath(value.trim())
        if (!isFullyQualifiedPath(expanded)) return failure('not-absolute', 'roots must be absolute paths')
        try {
          const physical = await realpath(expanded)
          if ((await stat(physical)).isDirectory()) roots.push(physical)
          else missingRoot = true
        } catch {
          missingRoot = true
        }
      }
      if (roots.length === 0) return failure('not-found', 'none of the roots is a directory')
      const result = await searchWorkspaceRoots(roots, query, {
        includeHidden: body.includeHidden === true,
        signal: request.signal,
      })
      return json({ ok: true, ...result, incomplete: result.incomplete || missingRoot })
    } catch (error) {
      logger('search failed', error)
      return failure('search-failed', String(error?.message ?? error))
    }
  }

  /**
   * Whether one path is the root itself or lies inside it.
   * @param root - root directory.
   * @param target - target path.
   * @returns whether the target is confined to the root.
   */
  function insideRoot(root, target) {
    return relativeInside(root, target) !== undefined
  }

  /**
   * Whether one path lies strictly inside a directory.
   * @param root - root directory.
   * @param target - target path.
   * @returns whether the target is inside the root and not equal to it.
   */
  function outsideRoot(root, target) {
    const rel = relativeInside(root, target)
    return rel === undefined
  }

  /**
   * Relative path of a target below a root, with `..`-escapes rejected.
   * @param root - root directory.
   * @param target - target path.
   * @returns the relative path, or undefined when the target is outside.
   */
  function relativeInside(root, target) {
    let rel
    try {
      rel = relative(resolve(root), resolve(target))
    } catch {
      return undefined
    }
    if (rel === '') return ''
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined
    return rel
  }

  /**
   * Whether a directory's path below a root contains an excluded basename.
   * @param root - root directory.
   * @param directory - directory below the root.
   * @returns whether the directory must not contribute references.
   */
  function excludedWithinRoot(root, directory) {
    const rel = relativeInside(root, directory)
    if (rel === undefined) return true
    return toPosix(rel).split('/').filter(Boolean).some(name => REFERENCE_EXCLUDED_DIRECTORIES.has(name))
  }

  /**
   * Confirm one directory is a real directory whose physical path stays in root.
   * @param root - root directory.
   * @param directory - directory to inspect.
   * @returns the physical directory, or undefined when missing, non-directory, or escaping.
   */
  async function realDirectoryWithin(root, directory) {
    try {
      const [physicalRoot, physicalDirectory] = await Promise.all([realpath(root), realpath(directory)])
      if (relativeInside(physicalRoot, physicalDirectory) === undefined) return undefined
      if (!(await stat(physicalDirectory)).isDirectory()) return undefined
      return physicalDirectory
    } catch {
      return undefined
    }
  }

  /**
   * Split one directory query into its directory prefix and fragment.
   * @param query - `/`-separated query path.
   * @returns the directory (with trailing slash) and final fragment.
   */
  function splitReferenceDirectory(query) {
    const slash = query.lastIndexOf('/')
    if (slash < 0) return { directory: '', fragment: query }
    return { directory: query.slice(0, slash + 1), fragment: query.slice(slash + 1) }
  }

  /**
   * Roots that supplement the core provider: not the primary root, and not
   * below it (the core provider already indexes those).
   * @param roots - every declared root.
   * @param primaryPath - primary workspace path.
   * @returns the roots the plugin searches itself.
   */
  function supplementalRoots(roots, primaryPath) {
    return roots.filter(root => pathKey(root) !== pathKey(primaryPath) && outsideRoot(primaryPath, root))
  }

  /**
   * Build the root rows and their absolute mention / relative drill forms.
   * @param roots - declared roots in order.
   * @param workspacePath - workspace / session root.
   * @param quoted - whether the active token is quoted.
   * @returns one entry per root.
   */
  function rootEntriesFor(roots, workspacePath, quoted) {
    const names = rootDisplayNames(roots)
    const primaryKey = pathKey(workspacePath)
    return roots.map((root, index) => {
      const path = toPosix(root)
      const mention = formatReferenceMention(path, 'directory', quoted)
      const drillPath = relativeDrillPath(workspacePath, root)
      const drillMention = drillPath === undefined ? undefined : formatReferenceMention(drillPath, 'directory', quoted)
      return {
        path,
        name: names[index],
        primary: pathKey(root) === primaryKey,
        ...(mention === undefined ? {} : { mention }),
        ...(drillMention === undefined ? {} : { drillMention }),
      }
    })
  }

  /**
   * Convert one root entry into a candidate row for the workspace recovery group.
   * @param entry - root metadata.
   * @returns the directory candidate, or undefined when it cannot be represented.
   */
  function rootCandidate(entry) {
    if (typeof entry.mention !== 'string') return undefined
    return {
      path: entry.path,
      name: entry.name,
      kind: 'directory',
      description: entry.path,
      mention: entry.mention,
      ...(entry.drillMention === undefined ? {} : { drillMention: entry.drillMention }),
    }
  }

  /**
   * Build one file or directory candidate.
   * @param input - root, absolute path, kind, quote state, workspace path, and display override.
   * @returns the candidate, or undefined for a path the mention grammar cannot carry.
   */
  function referenceCandidate({ root, path, kind, quoted, workspacePath, description }) {
    const posixPath = toPosix(path)
    const mention = formatReferenceMention(posixPath, kind, quoted)
    if (mention === undefined) return undefined
    const name = basename(posixPath)
    if (name === '') return undefined
    const candidate = { path: posixPath, name, kind, mention }
    if (kind === 'directory') {
      const drillPath = relativeDrillPath(workspacePath, path)
      if (drillPath !== undefined) {
        const drillMention = formatReferenceMention(drillPath, 'directory', quoted)
        if (drillMention !== undefined) candidate.drillMention = drillMention
      }
    }
    const parent = description ?? parentRelative(root, posixPath)
    if (parent !== '') {
      candidate.parent = parent
      if (description !== undefined) candidate.description = description
    }
    return candidate
  }

  /**
   * List one directory as ranked reference candidates.
   * @param input - root, directory, fragment, quote state, display base, suppression path, and limit.
   * @returns the candidates and whether the listing was cut.
   */
  async function listReferenceGroup({
    root, directory, fragment, quoted, workspacePath, suppressInside, limit,
  }) {
    if (excludedWithinRoot(root, directory)) return { candidates: [], truncated: false }
    if (await realDirectoryWithin(root, directory) === undefined) return { candidates: [], truncated: false }
    let listing
    try {
      listing = await readDirectoryEntries(directory)
    } catch {
      return { candidates: [], truncated: false }
    }
    const candidates = []
    for (const entry of listing.entries) {
      if (REFERENCE_EXCLUDED_DIRECTORIES.has(entry.name)) continue
      if (entry.kind !== 'file' && entry.kind !== 'directory') continue
      if (entry.hidden && !fragment.startsWith('.')) continue
      const candidatePath = join(directory, entry.name)
      if (suppressInside !== undefined && insideRoot(suppressInside, candidatePath)) continue
      const candidate = referenceCandidate({
        root,
        path: candidatePath,
        kind: entry.kind,
        quoted,
        workspacePath,
      })
      if (candidate !== undefined) candidates.push(candidate)
    }
    const ranked = rankCandidates(candidates, fragment, limit)
    return {
      candidates: ranked,
      truncated: listing.truncated || ranked.length < candidates.length,
    }
  }

  /**
   * Absolute-path browse: the plugin owns `@/…` because the core provider only
   * resolves workspace-relative paths.
   * @param input - query, roots, metadata, quote state, workspace path, and signal.
   * @returns groups, truncation, and incompleteness.
   */
  async function absoluteReferenceGroups({
    query, roots, rootEntries, quoted, workspacePath, signal,
  }) {
    const { directory, fragment } = splitReferenceDirectory(query)
    if (directory === '') return { groups: [], truncated: false, incomplete: false }
    let match
    let matchLength = -1
    for (const root of roots) {
      if (!insideRoot(root, directory)) continue
      const length = pathKey(root).length
      if (length > matchLength) {
        match = root
        matchLength = length
      }
    }
    if (match === undefined) return { groups: [], truncated: false, incomplete: false }
    if (signal?.aborted) return { groups: [], truncated: false, incomplete: false }
    const name = rootEntries.find(entry => pathKey(entry.path) === pathKey(match))?.name ?? basename(toPosix(match))
    const listed = await listReferenceGroup({
      root: match,
      directory,
      fragment,
      quoted,
      workspacePath,
      limit: MAX_REFERENCE_ROOT_RESULTS,
    })
    if (listed.candidates.length === 0) {
      return { groups: [], truncated: listed.truncated, incomplete: false }
    }
    return {
      groups: [{ root: toPosix(match), name, candidates: listed.candidates }],
      truncated: listed.truncated,
      incomplete: false,
    }
  }

  /**
   * Workspace-relative browse (`./…` and `../…`): keep the root inside the
   * primary directory for the core provider, browse a supplemental root here,
   * and recover to a project-workspace root group above the roots.
   * @param input - query, roots, metadata, quote state, workspace path, primary entry, and signal.
   * @returns groups, truncation, and incompleteness.
   */
  async function workspaceRelativeReferenceGroups({
    query, roots, rootEntries, quoted, workspacePath, primaryEntry, signal,
  }) {
    const { directory, fragment } = splitReferenceDirectory(query)
    if (directory === '') return { groups: [], truncated: false, incomplete: false }
    let absoluteDirectory
    try {
      absoluteDirectory = resolve(workspacePath, directory)
    } catch {
      return { groups: [], truncated: false, incomplete: false }
    }
    // Paths inside the primary root stay with the core provider, so the two
    // sources never show the same relative entry.
    if (insideRoot(primaryEntry.path, absoluteDirectory)) {
      return { groups: [], truncated: false, incomplete: false }
    }
    let info
    try {
      info = await stat(absoluteDirectory)
    } catch {
      return { groups: [], truncated: false, incomplete: false }
    }
    if (!info.isDirectory()) return { groups: [], truncated: false, incomplete: false }
    if (signal?.aborted) return { groups: [], truncated: false, incomplete: false }
    let match
    let matchLength = -1
    for (const root of roots) {
      if (pathKey(root) === pathKey(primaryEntry.path)) continue
      if (!insideRoot(root, absoluteDirectory)) continue
      const length = pathKey(root).length
      if (length > matchLength) {
        match = root
        matchLength = length
      }
    }
    if (match !== undefined) {
      const name = rootEntries.find(entry => pathKey(entry.path) === pathKey(match))?.name ?? basename(toPosix(match))
      const listed = await listReferenceGroup({
        root: match,
        directory: absoluteDirectory,
        fragment,
        quoted,
        workspacePath,
        suppressInside: primaryEntry.path,
        limit: MAX_REFERENCE_ROOT_RESULTS,
      })
      if (listed.candidates.length === 0) {
        return { groups: [], truncated: listed.truncated, incomplete: false }
      }
      return {
        groups: [{ root: toPosix(match), name, candidates: listed.candidates }],
        truncated: listed.truncated,
        incomplete: false,
      }
    }
    // The directory is outside every declared root: offer every root again.
    // This makes the `..` breadcrumb a way back rather than a dead end.
    const candidates = rootEntries.map(rootCandidate).filter(candidate => candidate !== undefined)
    const ranked = rankCandidates(candidates, fragment, MAX_REFERENCE_RESULTS)
    if (ranked.length === 0) return { groups: [], truncated: false, incomplete: false }
    return {
      groups: [{
        root: toPosix(workspacePath),
        name: '',
        workspace: true,
        candidates: ranked,
      }],
      truncated: candidates.length > ranked.length,
      incomplete: false,
    }
  }

  /**
   * Type-ahead directory query (`sub/`): list that directory below every
   * supplemental root.
   * @param input - query, roots, metadata, quote state, workspace path, primary entry, and signal.
   * @returns groups, truncation, and incompleteness.
   */
  async function relativeDirectoryReferenceGroups({
    query, roots, rootEntries, quoted, workspacePath, primaryEntry, signal,
  }) {
    const { directory, fragment } = splitReferenceDirectory(query)
    if (directory === '') return { groups: [], truncated: false, incomplete: false }
    if (signal?.aborted) return { groups: [], truncated: false, incomplete: false }
    const searchRoots = supplementalRoots(roots, primaryEntry.path)
    if (searchRoots.length === 0) return { groups: [], truncated: false, incomplete: false }
    const groups = []
    let truncated = false
    let total = 0
    const listings = await Promise.all(searchRoots.map(async (root) => {
      let target
      try {
        target = resolve(root, directory)
      } catch {
        return undefined
      }
      if (outsideRoot(root, target)) return undefined
      const name = rootEntries.find(entry => pathKey(entry.path) === pathKey(root))?.name ?? basename(toPosix(root))
      const listed = await listReferenceGroup({
        root,
        directory: target,
        fragment,
        quoted,
        workspacePath,
        suppressInside: primaryEntry.path,
        limit: MAX_REFERENCE_ROOT_RESULTS,
      })
      return { root: toPosix(root), name, listed }
    }))
    for (const listing of listings) {
      if (listing === undefined || listing.listed.candidates.length === 0) continue
      const remaining = MAX_REFERENCE_RESULTS - total
      if (remaining <= 0) {
        truncated = true
        break
      }
      const candidates = listing.listed.candidates.slice(0, remaining)
      groups.push({ root: listing.root, name: listing.name, candidates })
      total += candidates.length
      truncated = truncated || listing.listed.truncated || candidates.length < listing.listed.candidates.length
    }
    return { groups, truncated, incomplete: false }
  }

  /**
   * Bare fuzzy query: search every supplemental root for names or relative
   * paths, ranking each root's matches.
   * @param input - query, roots, metadata, quote state, workspace path, primary entry, and signal.
   * @returns groups, truncation, and incompleteness.
   */
  async function fuzzyReferenceGroups({
    query, roots, rootEntries, quoted, workspacePath, primaryEntry, signal,
  }) {
    if (signal?.aborted) return { groups: [], truncated: false, incomplete: false }
    const searchRoots = supplementalRoots(roots, primaryEntry.path)
    if (searchRoots.length === 0) return { groups: [], truncated: false, incomplete: false }
    let result
    try {
      result = await searchWorkspaceRoots(searchRoots, query, {
        includeHidden: query.startsWith('.'),
        signal,
        limits: { maxResults: MAX_REFERENCE_RESULTS * 2 },
      })
    } catch (error) {
      if (signal?.aborted) return { groups: [], truncated: false, incomplete: false }
      throw error
    }
    if (signal?.aborted) return { groups: [], truncated: false, incomplete: false }
    const groups = []
    let truncated = result.truncated
    let total = 0
    for (const matched of result.groups) {
      if (matched.matches.length === 0) continue
      const name = rootEntries.find(entry => pathKey(entry.path) === pathKey(matched.root))?.name ?? basename(toPosix(matched.root))
      const candidates = []
      for (const match of matched.matches) {
        // A supplemental root may contain the primary root; leave those paths
        // to the core provider.
        if (insideRoot(primaryEntry.path, match.path)) continue
        const candidate = referenceCandidate({
          root: matched.root,
          path: match.path,
          kind: match.kind,
          quoted,
          workspacePath,
        })
        if (candidate !== undefined) candidates.push(candidate)
      }
      const ranked = rankCandidates(candidates, query, MAX_REFERENCE_ROOT_RESULTS)
      if (ranked.length === 0) continue
      const remaining = MAX_REFERENCE_RESULTS - total
      if (remaining <= 0) {
        truncated = true
        break
      }
      const take = ranked.slice(0, remaining)
      groups.push({ root: toPosix(matched.root), name, candidates: take })
      total += take.length
      if (take.length < ranked.length) truncated = true
    }
    return { groups, truncated, incomplete: result.incomplete }
  }

  /**
   * Build the `@` reference payload for one session.
   * @param input - session, query, quote state, and cancellation.
   * @returns roots plus grouped candidates, truncation, and incompleteness.
   */
  async function referencePayload({ sessionId, query, quoted, signal }) {
    let resolved
    try {
      resolved = await resolveSessionRoots(sessionId)
    } catch (error) {
      logger('session root resolution failed', error)
      return { roots: [], groups: [], truncated: false, incomplete: false }
    }
    if (resolved === undefined || resolved === null || !Array.isArray(resolved.roots)) {
      return { roots: [], groups: [], truncated: false, incomplete: false }
    }
    const roots = [...new Set(resolved.roots.map(String).filter(root => root !== ''))]
    if (roots.length === 0) return { roots: [], groups: [], truncated: false, incomplete: false }
    const workspacePath = typeof resolved.workspacePath === 'string' && resolved.workspacePath !== ''
      ? resolved.workspacePath
      : roots[0]
    const rootEntries = rootEntriesFor(roots, workspacePath, quoted)
    if (rootEntries.length === 0) return { roots: [], groups: [], truncated: false, incomplete: false }
    if (!rootEntries.some(entry => entry.primary)) rootEntries[0].primary = true
    const primaryEntry = rootEntries.find(entry => entry.primary) ?? rootEntries[0]
    const normalized = String(query).replaceAll('\\', '/')
    const trimmed = normalized.trim()
    if (trimmed === '') {
      return { roots: rootEntries, groups: [], truncated: false, incomplete: false }
    }
    if (signal?.aborted) return { roots: rootEntries, groups: [], truncated: false, incomplete: false }
    const common = {
      query: normalized,
      roots,
      rootEntries,
      quoted,
      workspacePath,
      primaryEntry,
      signal,
    }
    if (isFullyQualifiedPath(normalized)) {
      return { roots: rootEntries, ...await absoluteReferenceGroups(common) }
    }
    if (normalized.startsWith('./') || normalized.startsWith('../')) {
      return { roots: rootEntries, ...await workspaceRelativeReferenceGroups(common) }
    }
    if (trimmed.includes('/')) {
      return { roots: rootEntries, ...await relativeDirectoryReferenceGroups(common) }
    }
    return { roots: rootEntries, ...await fuzzyReferenceGroups(common) }
  }

  /**
   * Supply `@` file and folder candidates across a project workspace's roots.
   * @param request - POST body `{ sessionId, query?, quoted? }`.
   * @returns the reference payload, or a stable failure.
   */
  async function references(request) {
    try {
      const body = await readBody(request)
      if (body === undefined) return failure('bad-request', 'request body must be a JSON object', 400)
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
      if (sessionId === '') return failure('bad-request', 'a session id is required', 400)
      const query = typeof body.query === 'string' ? body.query : ''
      if (query.length > MAX_SEARCH_QUERY_LENGTH) return failure('bad-request', 'the query is too long', 400)
      const payload = await referencePayload({
        sessionId,
        query,
        quoted: body.quoted === true,
        signal: request.signal,
      })
      return json({ ok: true, ...payload })
    } catch (error) {
      logger('references failed', error)
      return json({ ok: true, roots: [], groups: [], truncated: false, incomplete: false })
    }
  }

  return { browse, dir, list, open, references, search }
}
