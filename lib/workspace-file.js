/**
 * `.code-workspace` parsing, folder resolution, and directory browsing.
 *
 * The workspace file is the source of truth for a workspace's folders. VS Code
 * accepts JSON-with-comments there, so the parser tolerates comments and
 * trailing commas while keeping string contents untouched.
 *
 * @module @local/dsh-codespace/lib/workspace-file
 */

import { realpathSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { expandHomePath } from './dsh-home.js'

/** Largest workspace file the plugin reads. */
export const MAX_WORKSPACE_FILE_BYTES = 2 * 1024 * 1024

/** Largest number of directory or file rows one browse response lists. */
export const MAX_BROWSE_ROWS = 500

/** Largest number of rows one workspace files tree level lists. */
export const MAX_DIRECTORY_ENTRIES = 1000

/** A structured workspace-file failure with a stable code. */
export class WorkspaceFileError extends Error {
  /**
   * @param code - stable client-facing code.
   * @param message - diagnostic text.
   */
  constructor(code, message) {
    super(message)
    this.name = 'WorkspaceFileError'
    this.code = code
  }
}

/**
 * Remove `//` and block comments outside string literals.
 * @param text - JSONC source.
 * @returns JSON source without comments.
 */
function stripComments(text) {
  let out = ''
  let inString = false
  let escaped = false
  let lineComment = false
  let blockComment = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const next = text[index + 1]
    if (lineComment) {
      if (character === '\n' || character === '\r') {
        lineComment = false
        out += character
      }
      continue
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (inString) {
      out += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      out += character
      continue
    }
    if (character === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (character === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
    out += character
  }
  return out
}

/**
 * Remove commas that only precede a closing brace or bracket.
 * @param text - JSON source without comments.
 * @returns JSON source without trailing commas.
 */
function stripTrailingCommas(text) {
  let out = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      out += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      out += character
      continue
    }
    if (character === ',') {
      let scan = index + 1
      while (scan < text.length && /\s/.test(text[scan])) scan += 1
      if (text[scan] === '}' || text[scan] === ']') continue
    }
    out += character
  }
  return out
}

/**
 * Convert JSONC workspace text into JSON text.
 * @param text - workspace file contents.
 * @returns strict JSON text.
 */
export function stripJsonc(text) {
  const withoutBom = text.replace(/^\uFEFF/, '')
  return stripTrailingCommas(stripComments(withoutBom))
}

/**
 * Parse a `.code-workspace` document.
 * @param text - workspace file contents.
 * @returns the declared folders in file order.
 * @throws {WorkspaceFileError} `invalid-json` or `no-folders`.
 */
export function parseWorkspaceFile(text) {
  if (typeof text !== 'string') throw new WorkspaceFileError('invalid-json', 'workspace file is not text')
  let value
  try {
    value = JSON.parse(stripJsonc(text))
  } catch (error) {
    throw new WorkspaceFileError('invalid-json', `workspace file is not valid JSON: ${String(error?.message ?? error)}`)
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkspaceFileError('invalid-json', 'workspace file must contain a JSON object')
  }
  const folders = value.folders
  if (!Array.isArray(folders) || folders.length === 0) {
    throw new WorkspaceFileError('no-folders', 'workspace file declares no folders')
  }
  const parsed = []
  for (const entry of folders) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    if (typeof entry.path !== 'string' || entry.path.trim() === '') continue
    parsed.push({
      ...(typeof entry.name === 'string' && entry.name !== '' ? { name: entry.name } : {}),
      path: entry.path,
    })
  }
  if (parsed.length === 0) throw new WorkspaceFileError('no-folders', 'workspace file declares no usable folders')
  return { folders: parsed }
}

/**
 * Resolve the declared folders to existing physical directories.
 *
 * Relative folder paths follow VS Code: they resolve against the workspace
 * file's own directory. A folder that is missing or is not a directory is
 * skipped, so a stale entry cannot fail the whole workspace. The native
 * resolver supplies the spelling the sandbox's writable-root validation
 * compares against.
 *
 * @param folders - parsed folder entries.
 * @param fileDirectory - directory holding the workspace file.
 * @returns physical absolute directories in declared order.
 */
export async function resolveExistingRoots(folders, fileDirectory) {
  const roots = []
  for (const folder of folders) {
    const expanded = expandHomePath(folder.path)
    const absolute = isAbsolute(expanded) ? expanded : resolve(fileDirectory, expanded)
    let physical
    try {
      physical = realpathSync.native(absolute)
      if (!(await stat(physical)).isDirectory()) continue
    } catch {
      continue
    }
    if (!roots.includes(physical)) roots.push(physical)
  }
  return roots
}

/**
 * The default workspace title for one workspace file: the file name without
 * its `.code-workspace` suffix, followed by ` (Workspace)`.
 * @param file - absolute workspace file path.
 * @returns the default title.
 */
export function titleForWorkspaceFile(file) {
  const name = basename(file)
  const stem = name.replace(/\.code-workspace$/i, '')
  return `${stem === '' ? name : stem} (Workspace)`
}

/**
 * Whether a path is fully qualified on this platform (a filesystem root or an
 * ordinary absolute path; on Windows a drive-qualified or complete UNC path).
 * @param path - candidate path.
 * @returns whether the path names one fixed filesystem location.
 */
export function isFullyQualifiedPath(path) {
  if (typeof path !== 'string' || path === '' || path.includes('\0')) return false
  if (process.platform === 'win32') {
    return /^[A-Za-z]:[\\/]/.test(path)
      || /^\\\\[^\\]+\\[^\\]+/.test(path)
      || /^\/\/[^/]+\/[^/]+/.test(path)
  }
  return isAbsolute(path)
}

/**
 * A filesystem-order-independent name comparison for browse rows.
 * @param left - left row.
 * @param right - right row.
 * @returns comparison result.
 */
function compareRows(left, right) {
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * List one directory level for the picker: child directories and
 * `.code-workspace` files only.
 * @param directory - physical absolute directory to list.
 * @param options - include dot-prefixed entries and hidden files.
 * @returns one browse response (without the outer `ok` envelope).
 */
export async function browseDirectory(directory, options = {}) {
  const includeHidden = options.includeHidden === true
  const entries = await readdir(directory, { withFileTypes: true })
  const directories = []
  const files = []
  let truncated = false
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue
    const hidden = entry.name.startsWith('.')
    if (hidden && !includeHidden) continue
    const path = join(directory, entry.name)
    let isDirectory = entry.isDirectory()
    let isFile = entry.isFile()
    if (entry.isSymbolicLink()) {
      try {
        const info = await stat(path)
        isDirectory = info.isDirectory()
        isFile = info.isFile()
      } catch {
        continue
      }
    }
    if (isDirectory) directories.push({ name: entry.name, path, hidden })
    else if (isFile && /\.code-workspace$/i.test(entry.name)) files.push({ name: entry.name, path, hidden })
  }
  directories.sort(compareRows)
  files.sort(compareRows)
  if (directories.length > MAX_BROWSE_ROWS) {
    directories.length = MAX_BROWSE_ROWS
    truncated = true
  }
  if (files.length > MAX_BROWSE_ROWS) {
    files.length = MAX_BROWSE_ROWS
    truncated = true
  }
  const parent = dirname(directory)
  return {
    path: directory,
    parent: parent === directory ? null : parent,
    home: homedir(),
    directories,
    files,
    truncated,
  }
}

/**
 * List one directory level for the workspace files tree: every direct child,
 * with the kind the tree rows need.
 * @param directory - physical absolute directory to list.
 * @param options - row bound; defaults to {@link MAX_DIRECTORY_ENTRIES}.
 * @returns the children in name order, and whether the bound cut the level.
 */
export async function readDirectoryEntries(directory, options = {}) {
  const limit = options.limit ?? MAX_DIRECTORY_ENTRIES
  const entries = await readdir(directory, { withFileTypes: true })
  const rows = []
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue
    let kind
    if (entry.isSymbolicLink()) {
      try {
        const info = await stat(join(directory, entry.name))
        kind = info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other'
      } catch {
        // A dangling link is listed so the level stays whole.
        kind = 'other'
      }
    } else {
      kind = entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'
    }
    rows.push({ name: entry.name, kind, hidden: entry.name.startsWith('.') })
  }
  rows.sort(compareRows)
  const truncated = rows.length > limit
  return { entries: truncated ? rows.slice(0, limit) : rows, truncated }
}
