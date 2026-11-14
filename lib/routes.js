/**
 * Authenticated Host routes behind the Project workspaces page and its file tab.
 *
 * Five exact POST routes live inside Connection's browser-authentication
 * fence: browse the filesystem for `.code-workspace` files, list one directory
 * level for the workspace tree, search every workspace folder, list the
 * workspaces this plugin opened, and resolve one workspace file into a DSH
 * workspace.
 *
 * @module @msnex/dsh-project-workspace/lib/routes
 */

import { readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import {
  MAX_WORKSPACE_FILE_BYTES, WorkspaceFileError, browseDirectory, isFullyQualifiedPath,
  parseWorkspaceFile, readDirectoryEntries, resolveExistingRoots, titleForWorkspaceFile,
} from './workspace-file.js'
import { MAX_SEARCH_QUERY_LENGTH, MAX_SEARCH_ROOTS, searchWorkspaceRoots } from './search.js'
import { expandHomePath } from './dsh-home.js'

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
 * @param options - registry reader, history store, roots sink, and logger.
 * @returns the handlers keyed by route name.
 */
export function createWorkspaceRoutes({ getRegistry, history, onRoots = () => {}, logger = () => {} }) {
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

  return { browse, dir, list, open, search }
}
