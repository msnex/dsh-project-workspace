/**
 * Per-session writable-root grants for multi-root workspaces.
 *
 * DSH confines `workspace-write` mutations to the session's workspace root.
 * A VS Code multi-root workspace has several roots, so every folder beyond the
 * first one is registered as an additional writable directory for the sessions
 * that run in that workspace. Registrations are runtime-only, are re-applied
 * whenever an agent starts (resume and fork included), and are revalidated so a
 * folder that disappears cannot poison a session's later writes.
 *
 * @module @local/dsh-codespace/lib/grants
 */

/**
 * Create the grant manager.
 * @param options - sandbox registration, live-agent reader, filesystem probes, and a logger.
 * @returns the grant manager.
 */
export function createWorkspaceGrants({
  registerWritableRoot, listAgents, workspaceIdForPath, statDirectory, realpathPath, logger = () => {},
}) {
  /** @type {Map<string, {workspaceId: string, roots: string[]}>} */
  const rootsByPath = new Map()
  /** @type {Map<object, {dispose: () => void, dirs: string[]}>} */
  const grantsByAgent = new Map()
  /** @type {Map<object, Promise<void>>} */
  const pending = new Map()
  let disposed = false

  /**
   * The map key for one workspace directory.
   * @param path - workspace or session directory.
   * @returns a stable key without trailing separators.
   */
  function pathKey(path) {
    return String(path).replace(/[\\/]+$/, '')
  }

  /**
   * Remember the folders one workspace declared. The workspace identity is
   * kept beside the path so a later workspace that reuses the directory does
   * not inherit the previous file's writable roots.
   * @param workspacePath - the workspace's canonical directory.
   * @param roots - its declared folder directories.
   * @param workspaceId - the workspace that owns the folders.
   * @returns nothing.
   */
  function setRoots(workspacePath, roots, workspaceId) {
    if (typeof workspacePath !== 'string' || workspacePath === '') return
    if (typeof workspaceId !== 'string' || workspaceId === '') return
    const normalized = []
    for (const root of roots ?? []) {
      if (typeof root !== 'string' || root === '') continue
      if (!normalized.includes(root)) normalized.push(root)
    }
    rootsByPath.set(pathKey(workspacePath), { workspaceId, roots: normalized })
  }

  /**
   * The currently usable extra directories for one agent.
   * @param agent - live agent.
   * @returns physical directories to grant, excluding the session root.
   */
  async function desiredDirectories(agent) {
    const cwd = agent?.session?.header?.cwd
    if (typeof cwd !== 'string' || cwd === '') return []
    const key = pathKey(cwd)
    const entry = rootsByPath.get(key)
    if (entry === undefined) return []
    let liveId
    try {
      liveId = workspaceIdForPath(cwd)
    } catch (error) {
      logger('workspace lookup failed', error)
      return []
    }
    if (typeof liveId !== 'string' || liveId !== entry.workspaceId) {
      // The workspace was deleted or replaced; its file no longer grants roots here.
      rootsByPath.delete(key)
      return []
    }
    const desired = []
    for (const root of entry.roots) {
      let physical
      try {
        physical = await realpathPath(root)
      } catch {
        continue
      }
      // The enforcement layer rejects a grant whose spelling differs from its
      // real path, so a folder replaced by a symlink is dropped rather than
      // breaking every confined call in the session.
      if (physical !== root) continue
      if (pathKey(physical) === pathKey(cwd)) continue
      let isDirectory = false
      try {
        isDirectory = await statDirectory(physical)
      } catch {
        isDirectory = false
      }
      if (!isDirectory) continue
      if (!desired.includes(physical)) desired.push(physical)
    }
    return desired
  }

  /**
   * Whether two directory lists name the same set.
   * @param left - previous list.
   * @param right - next list.
   * @returns whether the sets match.
   */
  function sameDirectories(left, right) {
    if (left.length !== right.length) return false
    const sortedLeft = [...left].sort()
    const sortedRight = [...right].sort()
    return sortedLeft.every((value, index) => value === sortedRight[index])
  }

  /**
   * Drop one agent's grants.
   * @param agent - live agent.
   * @returns nothing.
   */
  function disposeAgent(agent) {
    const current = grantsByAgent.get(agent)
    if (current === undefined) return
    grantsByAgent.delete(agent)
    try {
      current.dispose()
    } catch (error) {
      logger('dispose writable roots failed', error)
    }
  }

  /**
   * Install grants on the agent's own context, so disposal unwinds them too.
   * @param agent - live agent.
   * @param directories - extra writable directories.
   * @returns nothing.
   */
  function install(agent, directories) {
    try {
      const dispose = agent.ctx.effect(() => {
        const disposers = []
        for (const directory of directories) {
          try {
            disposers.push(registerWritableRoot(agent.session, directory))
          } catch (error) {
            logger('register writable root failed', directory, error)
          }
        }
        return () => {
          for (const release of disposers) {
            try {
              release()
            } catch (error) {
              logger('release writable root failed', error)
            }
          }
        }
      }, 'codespace: writable roots')
      grantsByAgent.set(agent, { dispose, dirs: directories })
    } catch (error) {
      logger('grant effect failed', error)
    }
  }

  /**
   * Reconcile one agent's grants with the current folders.
   * @param agent - live agent.
   * @returns resolution after reconciliation.
   */
  async function reconcileNow(agent) {
    if (disposed || agent === undefined) return
    const directories = await desiredDirectories(agent)
    if (disposed) return
    const current = grantsByAgent.get(agent)
    if (current !== undefined && sameDirectories(current.dirs, directories)) return
    disposeAgent(agent)
    if (directories.length > 0) install(agent, directories)
  }

  /**
   * Reconcile one agent, serializing concurrent requests for the same agent.
   * @param agent - live agent.
   * @returns resolution after reconciliation.
   */
  function reconcile(agent) {
    if (disposed || agent === undefined) return Promise.resolve()
    const previous = pending.get(agent) ?? Promise.resolve()
    const task = previous
      .then(() => reconcileNow(agent))
      .catch((error) => { logger('reconcile writable roots failed', error) })
    pending.set(agent, task)
    void task.then(() => {
      if (pending.get(agent) === task) pending.delete(agent)
    })
    return task
  }

  /**
   * Reconcile every live agent, dropping grants for agents that lost their roots.
   * @returns resolution after all agents settle.
   */
  async function reconcileAll() {
    if (disposed) return
    let agents = []
    try {
      agents = listAgents()
    } catch (error) {
      logger('list agents failed', error)
      return
    }
    for (const agent of agents) await reconcile(agent)
  }

  /**
   * Release every grant and reject later work.
   * @returns nothing.
   */
  function dispose() {
    disposed = true
    for (const agent of [...grantsByAgent.keys()]) disposeAgent(agent)
    rootsByPath.clear()
    pending.clear()
  }

  return {
    setRoots,
    reconcile,
    reconcileAll,
    revalidateAll: reconcileAll,
    disposeAgent,
    dispose,
  }
}
