/**
 * Plugin-owned paths under the DeepSeek Harness home.
 *
 * Mirrors the accepted home resolution order (explicit `$DSH_HOME`, then
 * `~/.dsh`) without importing a dsh package, so the bundle stays installable
 * from a plain local directory.
 *
 * @module @msnex/dsh-project-workspace/lib/dsh-home
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Expand a leading `~`, `~/`, or `~\` against the operating-system home.
 * @param path - a path that may begin with a supported tilde form.
 * @returns the expanded path, or the original value.
 */
export function expandHomePath(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the DeepSeek Harness home directory.
 * @param env - environment mapping, defaulting to the process environment.
 * @returns the absolute harness home.
 */
export function resolveDshHome(env = process.env) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  const base = configured === '' ? join(homedir(), '.dsh') : expandHomePath(configured)
  return resolve(base)
}

/**
 * The plugin's durable history document under the harness home.
 * @param env - environment mapping, defaulting to the process environment.
 * @returns the absolute history file path.
 */
export function workspaceHistoryFile(env = process.env) {
  return join(resolveDshHome(env), 'project-workspace', 'workspaces.json')
}
