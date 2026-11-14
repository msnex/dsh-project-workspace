# Project workspaces（项目工作空间）

Open a VS Code **multi-root workspace** (`.code-workspace`) as a DSH **project workspace**, with every folder it declares writable inside that project workspace's sessions.

## What it adds

- A **项目工作空间 / Project workspaces** row in the left sidebar, directly above **Plugins**.
- A full page with two parts:
  - **Open a project workspace** — a button that opens an in-app file picker for `.code-workspace` files.
  - **Opened project workspaces** — every project workspace opened this way, with its name and the `.code-workspace` file's absolute path.
- On open, the plugin resolves the file into a DSH project workspace and starts a new session in it.
- A **项目工作空间文件 / Project workspace files** tab in the right Sidebar (guide card). It lists every folder the project workspace declares, not just the session directory, with a search box, reload, and a hidden-entry toggle. It is a separate page: the shipped **文件 / 文件浏览面板** page keeps its own single-root tree.
- Each folder section in that tab folds from its header; each new search starts with every section expanded.

## Rules

| Rule | Behavior |
|---|---|
| Project workspace name | `<filename without .code-workspace> (Workspace)` |
| Session working directory | The **first existing folder** declared in the file |
| Other folders | Registered as **additional writable directories** for that project workspace's sessions (runtime-only sandbox grants) |
| A project workspace with the same name exists | A new session is opened in **that** project workspace; no second project workspace is created |
| The chosen folder already belongs to another project workspace | That project workspace is reused **without renaming**, and the page explains it |
| The file is edited later | Open it from the picker again to refresh the folder list and the grants |
| The project workspace cannot be renamed | It still opens with the folder's name and a notice explains the failure |

The name suffix `(Workspace)` is part of the stored project workspace name; changing the app language does not rename existing project workspaces.

The grants are re-applied when a session starts, resumes, or forks, and are revalidated every minute so a removed folder cannot keep failing a live session's writes. They are ignored by `read-only` sessions. On Windows the extra folders are writable by the file tools only; sandboxed commands keep the session root and temporary areas.

## Languages

The interface and plugin metadata ship English and Chinese copy. Other app languages fall back to English; the plugin ships no other locale files.

## Where the data lives

`~/.dsh/codespace/workspaces.json` records the project workspace file association and the declared folders. It stores only paths; it never modifies a `.code-workspace` file or any project file. The plugin reads directories and project workspace files only when you browse or open them.

## Install

The bundle can be installed in both `desktop` and `web` profiles — it uses Node built-ins on the Host and plain React in the browser, with no desktop-only API.

- **Desktop**: *Plugins → Add plugin*, or install this directory with the plugin manager.
- **Web**: the same local directory (or the published package) through that profile's plugin manager.

## Limits

- DSH models a workspace as one directory, so a project workspace runs its sessions in the first existing folder. The other folders are granted as extra writable roots, so a command or file edit writes anywhere under the declared folders.
- VS Code variables such as `${workspaceFolder}` are not expanded; a folder with an unresolvable path is skipped.
- A project workspace file whose first existing folder is already a DSH workspace reuses it; the plugin never renames an existing DSH workspace.
- Folder changes made to the file while a session is open take effect after opening the file again (or starting a new session after re-opening).
- The list contains project workspaces opened through this plugin; DSH workspaces created manually elsewhere are not listed unless opened here once.
- The project workspace files tab searches names and root-relative paths over Node's filesystem, not ripgrep: it has no `.gitignore` or exclusion settings, always skips `.git`-family folders and `node_modules`, does not follow symbolic links, and caps results (200), scanned entries (30,000), and time (2.5 s). Its tree is manual-reload only.
- Sessions whose project workspace was not opened through this plugin, or that have a single folder, show that one folder in the tab.

## Disable / uninstall

Turning the bundle off releases every writable-root grant. Delete `~/.dsh/codespace/workspaces.json` to drop the history; the DSH workspaces themselves remain and can be removed from the sidebar.

## Development

```sh
node --check index.js client.js lib/*.js
node --test test/*.test.mjs
```

The Host half has no runtime dependency on any DSH package. The browser half is authored directly in the Client loader's factory format, so no build step is needed.
