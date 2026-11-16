/**
 * Browser half of the project-workspace bundle.
 *
 * Adds a "Project workspaces" navigation row above Plugins, a full page that opens
 * `.code-workspace` files through the Host routes, and a frame-wide file
 * picker dialog. The module is authored directly in the Client loader's
 * factory format; only React comes from the shared module table.
 */

window.__ModuleLoader__.load({
  id: '@msnex/dsh-project-workspace',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'project-workspace'
    const PANEL_ID = 'project-workspace'
    const DIALOG_ID = 'project-workspace.picker'
    const NOTICE_ID = 'project-workspace.notice'
    const FILES_TYPE_ID = '@msnex/dsh-project-workspace/files'
    const FILES_KIND = 'project-workspace.files'
    const BUSY_TIMEOUT_MS = 6000
    const SEARCH_DEBOUNCE_MS = 250
    const MENTION_DEBOUNCE_MS = 150
    const MENTION_SOURCE_NAME = 'project-workspace'
    const MENTION_SOURCE_ORDER = -10
    const CORE_REFERENCE_SOURCE = 'reference'
    const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

    /** Bilingual copy for the panel, page, dialog, and structured failures. */
    const en = {
      panel: 'Project workspaces',
      'page.title': 'Project workspaces',
      'page.open': 'Open project workspace from a file',
      'list.loading': 'Loading project workspaces',
      'list.error': 'The project workspace list could not be read.',
      'list.retry': 'Retry',
      'list.empty': 'No project workspaces yet',
      'row.openLabel': 'Open a new session in {title}',
      'notice.titleExists': 'A project workspace named {title} already exists; a new session was opened there.',
      'notice.dirInUse': 'That folder already belongs to the project workspace {title}; a session was opened there and the name was left unchanged.',
      'notice.historyUnavailable': 'The project workspace was opened, but this plugin could not save it to the list.',
      'notice.titleFailed': 'The project workspace was created but could not be named {title}; its current name is {current}.',
      'notice.dismiss': 'Dismiss',
      'picker.title': 'Open a project workspace',
      'picker.pathLabel': 'Path',
      'picker.go': 'Go',
      'picker.up': 'Parent folder',
      'picker.home': 'Home',
      'picker.showHidden': 'Show hidden',
      'picker.hideHidden': 'Hide hidden',
      'picker.loading': 'Reading the folder…',
      'picker.empty': 'No .code-workspace file here.',
      'picker.truncated': 'Only the first 500 entries are listed.',
      'picker.cancel': 'Cancel',
      'picker.confirm': 'Open',
      'picker.opening': 'Opening…',
      'picker.close': 'Close',
      'picker.retry': 'Retry',
      'picker.browseError': 'This folder could not be read.',
      'open.waitFailed': 'The new project workspace did not appear in time. Try again.',
      'open.failed': 'The project workspace could not be opened.',
      'open.timeout': 'Opening the project workspace timed out. Try again.',
      'error.notAbsolute': 'Choose an absolute path.',
      'error.fileRequired': 'Choose a .code-workspace file first.',
      'error.fileNotFound': 'That file does not exist.',
      'error.notAFile': 'That path is not a file.',
      'error.notWorkspaceFile': 'Choose a .code-workspace file.',
      'error.fileTooLarge': 'That project workspace file is too large.',
      'error.fileUnreadable': 'That project workspace file could not be read.',
      'error.invalidJson': 'The project workspace file is not valid JSON (comments are allowed).',
      'error.noFolders': 'The project workspace file declares no folders.',
      'error.noExistingFolders': 'None of the folders declared by the project workspace file exists.',
      'error.workspaceDirMissing': 'The project workspace folder is not available.',
      'error.workspaceCreateFailed': 'The project workspace could not be created.',
      'error.workspaceNotFound': 'This project workspace is no longer available.',
      'error.titleFailed': 'The project workspace could not be named.',
      'error.browseFailed': 'That folder could not be read.',
      'error.notADirectory': 'That path is not a folder.',
      'error.internal': 'Something went wrong. Try again.',
      'files.title': 'Project workspace files',
      'files.searchPlaceholder': 'Search files',
      'files.searchClear': 'Clear search',
      'files.searchResults': '{count} results',
      'files.searchEmpty': 'No matches',
      'files.searchFailed': 'Search failed',
      'files.searchTruncated': 'Showing the first matches',
      'files.searchIncomplete': 'Results may be incomplete',
      'files.retry': 'Retry',
      'files.reload': 'Reload',
      'files.showHidden': 'Show hidden',
      'files.hideHidden': 'Hide hidden',
      'files.noWorkspace': 'This session has no project workspace directory.',
      'files.loading': 'Loading files',
      'files.failed': 'Could not read this folder.',
      'files.unavailable': 'The file tree is unavailable.',
      'mention.workspace': 'Project workspace',
    }

    /** Chinese copy mirroring {@link en}. */
    const zh = {
      panel: '项目工作空间',
      'page.title': '项目工作空间',
      'page.open': '从文件打开项目工作空间',
      'list.loading': '正在读取项目工作空间',
      'list.error': '无法读取项目工作空间列表。',
      'list.retry': '重试',
      'list.empty': '还没有项目工作空间',
      'row.openLabel': '在 {title} 中打开新会话',
      'notice.titleExists': '已存在同名项目工作空间「{title}」，已在其中打开新会话。',
      'notice.dirInUse': '该目录已属于项目工作空间「{title}」，已在其中打开新会话；名称保持不变。',
      'notice.historyUnavailable': '项目工作空间已打开，但插件未能把它保存到列表。',
      'notice.titleFailed': '项目工作空间已创建，但未能改名为「{title}」，当前名称为「{current}」。',
      'notice.dismiss': '关闭提示',
      'picker.title': '打开项目工作空间',
      'picker.pathLabel': '路径',
      'picker.go': '转到',
      'picker.up': '上级',
      'picker.home': '主目录',
      'picker.showHidden': '显示隐藏项',
      'picker.hideHidden': '隐藏隐藏项',
      'picker.loading': '正在读取目录…',
      'picker.empty': '没有 .code-workspace 文件',
      'picker.truncated': '仅显示前 500 项。',
      'picker.cancel': '取消',
      'picker.confirm': '打开',
      'picker.opening': '正在打开…',
      'picker.close': '关闭',
      'picker.retry': '重试',
      'picker.browseError': '无法读取该目录。',
      'open.waitFailed': '新的项目工作空间没有及时出现，请重试。',
      'open.failed': '无法打开项目工作空间。',
      'open.timeout': '打开项目工作空间超时，请重试。',
      'error.notAbsolute': '请选择绝对路径。',
      'error.fileRequired': '请先选择一个 .code-workspace 文件。',
      'error.fileNotFound': '文件不存在。',
      'error.notAFile': '所选路径不是文件。',
      'error.notWorkspaceFile': '请选择 .code-workspace 文件。',
      'error.fileTooLarge': '项目工作空间文件过大。',
      'error.fileUnreadable': '无法读取该项目工作空间文件。',
      'error.invalidJson': '项目工作空间文件不是有效的 JSON（允许注释）。',
      'error.noFolders': '项目工作空间文件中没有可用的文件夹。',
      'error.noExistingFolders': '项目工作空间文件中的文件夹都不存在。',
      'error.workspaceDirMissing': '项目工作空间目录不可用。',
      'error.workspaceCreateFailed': '无法创建项目工作空间。',
      'error.workspaceNotFound': '该项目工作空间已不可用。',
      'error.titleFailed': '无法命名项目工作空间。',
      'error.browseFailed': '无法读取该目录。',
      'error.notADirectory': '所选路径不是目录。',
      'error.internal': '操作失败，请重试。',
      'files.title': '项目工作空间文件',
      'files.searchPlaceholder': '搜索文件',
      'files.searchClear': '清空搜索',
      'files.searchResults': '{count} 个结果',
      'files.searchEmpty': '没有匹配项',
      'files.searchFailed': '搜索失败',
      'files.searchTruncated': '只显示部分匹配项',
      'files.searchIncomplete': '结果可能不完整',
      'files.retry': '重试',
      'files.reload': '重新读取',
      'files.showHidden': '显示隐藏项',
      'files.hideHidden': '隐藏隐藏项',
      'files.noWorkspace': '这个会话没有项目工作空间目录。',
      'files.loading': '正在读取文件',
      'files.failed': '无法读取该文件夹。',
      'files.unavailable': '文件树不可用。',
      'mention.workspace': '项目工作空间',
    }

    /** Host failure codes mapped to localized copy. */
    const ERROR_KEYS = {
      'not-absolute': 'error.notAbsolute',
      'file-required': 'error.fileRequired',
      'file-not-found': 'error.fileNotFound',
      'not-a-file': 'error.notAFile',
      'not-workspace-file': 'error.notWorkspaceFile',
      'file-too-large': 'error.fileTooLarge',
      'file-unreadable': 'error.fileUnreadable',
      'invalid-json': 'error.invalidJson',
      'no-folders': 'error.noFolders',
      'no-existing-folders': 'error.noExistingFolders',
      'workspace-dir-missing': 'error.workspaceDirMissing',
      'workspace-create-failed': 'error.workspaceCreateFailed',
      'workspace-not-found': 'error.workspaceNotFound',
      'title-failed': 'error.titleFailed',
      'browse-failed': 'error.browseFailed',
      'not-a-directory': 'error.notADirectory',
      'bad-request': 'error.internal',
      internal: 'error.internal',
    }

    /**
     * Localized text for one Host failure.
     * @param data - decoded Host response.
     * @param t - translate function.
     * @returns the message to show.
     */
    function failureText(data, t) {
      const key = ERROR_KEYS[data?.code]
      if (key !== undefined) return t(key)
      // Unknown codes fall back to localized copy rather than leaking the
      // Host's English diagnostic into a Chinese interface.
      return t('error.internal')
    }

    /**
     * Localized text for one open notice.
     * @param notice - Host notice `{ code, title }`.
     * @param t - translate function.
     * @returns the message to show, or null.
     */
    function noticeText(notice, t) {
      switch (notice?.code) {
        case 'title-exists':
          return t('notice.titleExists', { title: notice.title ?? '' })
        case 'dir-in-use':
          return t('notice.dirInUse', { title: notice.title ?? '' })
        case 'title-failed':
          return t('notice.titleFailed', { title: notice.title ?? '', current: notice.current ?? '' })
        case 'history-unavailable':
          return t('notice.historyUnavailable')
        default:
          return null
      }
    }

    /** Page, dialog, and control styles over host theme tokens. */
    const CSS = `
.pw-page {
  display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base);
  font-size: 14px; line-height: 1.6;
}
.pw-page-scroll { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; }
.pw-page-content { max-width: 960px; margin: 0 auto; padding: 0 clamp(24px, 4vw, 48px) 48px; }
.pw-page-heading {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 16px; padding-top: 28px; margin-bottom: 12px;
}
:root[data-platform='darwin'] .pw-page-heading { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
.pw-page-heading h1 { margin: 0; font-size: 20px; line-height: 28px; font-weight: 500; }
@media (max-width: 767px) { .pw-page-content { padding-inline: 20px; } }

.pw-primary {
  display: inline-flex; align-items: center; gap: 6px; flex: none;
  height: 32px; padding: 0 14px; border: 0; border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-foreground);
  font: inherit; font-size: 13px; line-height: 20px; white-space: nowrap; cursor: pointer;
}
@media (hover: hover) {
  .pw-primary:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 88%, var(--dsw-alias-label-primary)); }
}
.pw-primary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.pw-primary:disabled { opacity: 0.55; cursor: default; }

.pw-list { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.pw-row {
  display: flex; align-items: center; gap: 12px; width: 100%; padding: 9px 10px;
  border: 0.5px solid transparent; border-radius: var(--dsw-radius-sm); background: transparent;
  color: inherit; font: inherit; text-align: left; cursor: pointer;
}
@media (hover: hover) {
  .pw-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
}
.pw-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.pw-row:disabled { opacity: 0.7; cursor: default; }
.pw-row-glyph {
  display: flex; flex: none; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
}
.pw-row-main { display: flex; flex: 1; flex-direction: column; gap: 1px; min-width: 0; }
.pw-row-title { overflow: hidden; color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.pw-row-path {
  overflow: hidden; color: var(--dsw-alias-label-secondary); font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  text-overflow: ellipsis; white-space: nowrap;
}
.pw-row-chevron { flex: none; color: var(--dsw-alias-label-tertiary); }

.pw-empty { margin: 0; padding: 48px 0; color: var(--dsw-alias-label-secondary); font-size: 13px; text-align: center; }
.pw-loading { display: flex; justify-content: center; padding: 48px 0; }
.pw-error { display: flex; align-items: center; gap: 8px; padding: 12px 0; color: var(--dsw-alias-state-error-primary); font-size: 13px; }
.pw-icon-button {
  display: inline-flex; flex: none; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
@media (hover: hover) {
  .pw-icon-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
}
.pw-icon-button:disabled { opacity: 0.45; cursor: default; }
.pw-icon-button[data-active='true'] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.pw-icon-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }

.pw-spinner {
  width: 14px; height: 14px; border: 2px solid color-mix(in srgb, var(--dsw-alias-label-secondary) 35%, transparent);
  border-top-color: var(--dsw-alias-brand-primary); border-radius: 50%;
  animation: pw-spin 0.8s linear infinite;
}
@keyframes pw-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .pw-spinner { animation: none; } }

.pw-overlay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  padding: 24px; background: var(--dsw-alias-bg-mask-1);
}
.pw-dialog {
  display: flex; flex-direction: column; width: min(680px, 100%);
  max-height: min(560px, calc(100vh - 96px));
  max-height: min(560px, calc(100dvh - 96px));
  overflow: hidden; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
  box-shadow: 0 18px 48px var(--dsw-alias-bg-mask-3);
}
.pw-dialog-head { display: flex; align-items: center; gap: 12px; padding: 16px 16px 10px 20px; }
.pw-dialog-title { flex: 1; min-width: 0; margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; }
.pw-dialog-body { display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; padding: 4px 20px 12px; }
.pw-path-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.pw-path-input {
  flex: 1 1 200px; min-width: 0; height: 32px; padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px;
}
.pw-path-input:focus { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }
.pw-browse-wrap {
  flex: 1; min-height: 140px; overflow: auto;
  border: 0.5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-1);
}
.pw-browse { display: flex; flex-direction: column; gap: 1px; margin: 0; padding: 4px; list-style: none; }
.pw-browse-state { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px 16px; color: var(--dsw-alias-label-secondary); font-size: 13px; text-align: center; }
.pw-file-row {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 10px;
  border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: inherit;
  font: inherit; font-size: 13px; text-align: left; cursor: pointer;
}
@media (hover: hover) {
  .pw-file-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
}
.pw-file-row[data-selected='true'] { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 15%, transparent); }
.pw-file-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.pw-file-icon { flex: none; color: var(--dsw-alias-label-secondary); }
.pw-file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pw-file-check { flex: none; color: var(--dsw-alias-brand-primary); }
.pw-hint { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.pw-dialog-error { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 13px; }
.pw-dialog-foot { display: flex; align-items: center; gap: 12px; padding: 10px 20px 18px; }
.pw-selected {
  flex: 1; min-width: 0; overflow: hidden; color: var(--dsw-alias-label-secondary); font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  text-overflow: ellipsis; white-space: nowrap;
}
.pw-dialog-actions { display: flex; flex: none; gap: 8px; margin-left: auto; }
.pw-button {
  height: 32px; padding: 0 14px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-lg);
  background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer;
}
@media (hover: hover) {
  .pw-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
}
.pw-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.pw-button:disabled { opacity: 0.5; cursor: default; }
.pw-button[data-variant='primary'] { border-color: transparent; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-foreground); }
@media (hover: hover) {
  .pw-button[data-variant='primary']:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 88%, var(--dsw-alias-label-primary)); }
}
.pw-button-small { height: 28px; padding: 0 10px; font-size: 12px; }

@media (pointer: coarse) {
  .pw-path-input { font-size: 16px; height: 36px; }
}

.pw-toast {
  position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%);
  display: flex; align-items: flex-start; gap: 10px;
  width: max-content; max-width: min(560px, calc(100vw - 48px));
  padding: 10px 12px; border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5;
  box-shadow: 0 8px 24px var(--dsw-alias-bg-mask-2);
}
.pw-toast-mark { flex: none; margin-top: 2px; color: var(--dsw-alias-state-warn-primary); }
.pw-toast-text { flex: 1; min-width: 0; }

.pw-rfiles {
  display: flex; flex: 1 1 auto; flex-direction: column; height: 100%;
  min-width: 0; min-height: 0;
  color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5;
}
.pw-rfiles-head {
  display: flex; flex: 0 0 auto; align-items: center; gap: 4px;
  height: 38px; padding: 0 6px; border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}
.pw-rfiles-search {
  display: flex; flex: 1; align-items: center; gap: 6px; min-width: 0; height: 28px; padding: 0 8px;
  border: 0.5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary);
}
.pw-rfiles-search:focus-within { border-color: var(--dsw-alias-brand-primary); }
.pw-rfiles-search-input {
  flex: 1; min-width: 0; border: 0; outline: none; background: transparent;
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px;
}
.pw-rfiles-search-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.pw-rfiles-clear { width: 20px; height: 20px; }
.pw-rfiles-body {
  flex: 1; min-height: 0; margin-right: 2px; padding: 8px 0 8px 8px;
  overflow: auto; scrollbar-gutter: stable;
}
.pw-rfiles-section + .pw-rfiles-section { margin-top: 12px; }
.pw-rfiles-section[data-collapsed='true'] + .pw-rfiles-section[data-collapsed='true'] { margin-top: 2px; }
.pw-rfiles-root {
  box-sizing: border-box; display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 5px 10px; border: 0; border-radius: var(--dsw-radius-md);
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 13px; line-height: 1.5; text-align: left; cursor: pointer;
}
.pw-rfiles-root:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.pw-rfiles-root-chevron {
  display: inline-flex; flex: none; color: var(--dsw-alias-label-tertiary);
  transition: transform 120ms ease;
}
.pw-rfiles-root[aria-expanded='true'] .pw-rfiles-root-chevron { transform: rotate(90deg); }
.pw-rfiles-root-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (hover: hover) {
  .pw-rfiles-root:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
}
@media (prefers-reduced-motion: reduce) {
  .pw-rfiles-root-chevron { transition: none; }
}
.pw-rfiles-note {
  margin: 0; padding: 3px 10px; color: var(--dsw-alias-label-tertiary);
  font-size: 12px; line-height: 1.5;
}
.pw-rfiles-note[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
.pw-rfiles-note-actions { display: inline-flex; margin-left: 6px; }
.pw-rfiles-state { padding: 24px 12px; color: var(--dsw-alias-label-secondary); font-size: 13px; text-align: center; }
.pw-rfiles-state-actions { display: flex; justify-content: center; margin-top: 8px; }
.pw-rfiles-title-icon { display: inline-flex; margin-right: 6px; vertical-align: -3px; }
@media (hover: hover) {
  .pw-rfiles-search:hover { border-color: var(--dsw-alias-border-l2); }
}
`

    /**
     * The single style element for one mounted surface.
     * @returns the style element.
     */
    function Styles() {
      return h('style', null, CSS)
    }

    /**
     * The workspace glyph: a panel with four tiles.
     * @param props - requested square edge in pixels.
     * @returns the SVG glyph.
     */
    function IconWorkspace({ size = 16 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('rect', { x: 1.75, y: 2.75, width: 12.5, height: 10.5, rx: 2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }),
        h('rect', { x: 4.2, y: 5.2, width: 2.4, height: 2.4, rx: 0.6, fill: 'currentColor' }),
        h('rect', { x: 9.4, y: 5.2, width: 2.4, height: 2.4, rx: 0.6, fill: 'currentColor', opacity: 0.55 }),
        h('rect', { x: 4.2, y: 8.6, width: 2.4, height: 2.4, rx: 0.6, fill: 'currentColor', opacity: 0.55 }),
        h('rect', { x: 9.4, y: 8.6, width: 2.4, height: 2.4, rx: 0.6, fill: 'currentColor' }),
      )
    }

    /**
     * A folder outline glyph.
     * @param props - requested square edge in pixels.
     * @returns the SVG glyph.
     */
    function IconFolder({ size = 16 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('path', {
          d: 'M1.75 4.25c0-.69.56-1.25 1.25-1.25h2.9c.33 0 .65.13.88.37l1.05 1.04h4.42c.69 0 1.25.56 1.25 1.25v6.09c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25V4.25Z',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round',
        }),
      )
    }

    /**
     * A document outline glyph.
     * @param props - requested square edge in pixels.
     * @returns the SVG glyph.
     */
    function IconFile({ size = 16 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('path', {
          d: 'M4 1.75h5.1l3.15 3.15V14.25c0 .55-.45 1-1 1H4c-.55 0-1-.45-1-1V2.75c0-.55.45-1 1-1Z',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round',
        }),
        h('path', { d: 'M9 1.9v3.2h3.2', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }),
      )
    }

    /**
     * A right chevron glyph.
     * @param props - requested square edge in pixels.
     * @returns the SVG glyph.
     */
    function IconChevron({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('path', { d: 'M6 3.5 10.5 8 6 12.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /**
     * An upward arrow glyph.
     * @param props - requested square edge in pixels.
     * @returns the SVG glyph.
     */
    function IconUp({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('path', { d: 'M8 12.5V3.6M3.7 7.2 8 3l4.3 4.2', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /**
     * A home glyph.
     * @param props - requested square edge in pixels.
     * @returns the SVG glyph.
     */
    function IconHome({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('path', { d: 'M2.5 7.3 8 2.6l5.5 4.7M4 6.3v6.7h8V6.3', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /**
     * A close glyph.
     * @param props - requested square edge in pixels.
     * @returns the SVG glyph.
     */
    function IconClose({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('path', { d: 'M4 4l8 8M12 4l-8 8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      )
    }

    /**
     * An eye glyph for the hidden-entry toggle.
     * @param props - requested square edge in pixels.
     * @returns the SVG glyph.
     */
    function IconEye({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('path', {
          d: 'M1.6 8s2.3-4 6.4-4 6.4 4 6.4 4-2.3 4-6.4 4S1.6 8 1.6 8Z',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round',
        }),
        h('circle', { cx: 8, cy: 8, r: 2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }),
      )
    }

    /**
     * A refresh glyph.
     * @param props - requested square edge in pixels.
     * @returns the SVG glyph.
     */
    function IconRefresh({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('path', {
          d: 'M13 8a5 5 0 1 1-1.46-3.54M13 2.6V6H9.6',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
      )
    }

    /**
     * A search glyph.
     * @param props - requested square edge in pixels.
     * @returns the SVG glyph.
     */
    function IconSearch({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('circle', { cx: 7, cy: 7, r: 4.4, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', { d: 'M10.4 10.4 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
      )
    }

    /**
     * A check glyph.
     * @param props - requested square edge in pixels.
     * @returns the SVG glyph.
     */
    function IconCheck({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('path', { d: 'M3.5 8.4 6.6 11.5 12.5 5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /**
     * A warning glyph.
     * @param props - requested square edge in pixels.
     * @returns the SVG glyph.
     */
    function IconWarning({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, focusable: 'false' },
        h('circle', { cx: 8, cy: 8, r: 6.2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', { d: 'M8 4.8v3.7M8 10.8v.4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      )
    }

    /**
     * Create one tiny observable store.
     * @param initial - initial state.
     * @returns the store.
     */
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set(patch) {
          state = { ...state, ...patch }
          for (const listener of [...listeners]) {
            try {
              listener()
            } catch {
              // One broken subscriber must not block the rest.
            }
          }
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    }

    /**
     * Subscribe a component to a store.
     * @param store - store created by {@link createStore}.
     * @returns the current state.
     */
    function useStore(store) {
      const [value, setValue] = React.useState(store.get())
      React.useEffect(() => {
        const sync = () => setValue(store.get())
        const off = store.subscribe(sync)
        sync()
        return off
      }, [store])
      return value
    }

    /**
     * Resolve once the workspace appears in the Client workspace catalog.
     * @param list - `ctx.workspaces.list`.
     * @param workspaceId - awaited workspace id.
     * @param timeoutMs - bound on the wait.
     * @returns resolution once the workspace is known.
     */
    function waitForWorkspace(list, workspaceId, timeoutMs) {
      return new Promise((resolve, reject) => {
        let settled = false
        let unsubscribe
        const finish = (error) => {
          if (settled) return
          settled = true
          if (typeof unsubscribe === 'function') unsubscribe()
          clearTimeout(timer)
          if (error !== undefined) reject(error)
          else resolve()
        }
        const timer = setTimeout(() => finish(new Error('workspace wait timed out')), timeoutMs)
        const check = () => {
          try {
            const snapshot = list.getSnapshot()
            if (snapshot.items.some(item => item.workspaceId === workspaceId)) {
              finish()
              return
            }
            if (snapshot.phase === 'ready' && snapshot.state === 'error') finish(new Error('workspace list failed'))
          } catch (error) {
            finish(error)
          }
        }
        unsubscribe = list.subscribe(check)
        check()
      })
    }

    /** No row accessory in the workspace files tree. */
    function EmptyTreeAccessory() {
      return null
    }

    /** Stable Factory local slots for every workspace files tree. */
    const TREE_SLOTS = { accessory: EmptyTreeAccessory }

    /**
     * Normalize a path to the tree's `/` separators.
     * @param path - native or already-normalized path.
     * @returns the `/`-separated path.
     */
    function normalizeSlashes(path) {
      return String(path).replace(/\\/g, '/')
    }

    /**
     * Join one tree level's key and an entry name.
     * @param parent - parent directory key.
     * @param name - child name.
     * @returns the child's absolute key.
     */
    function joinTreePath(parent, name) {
      return `${String(parent).replace(/\/+$/, '')}/${name}`
    }

    /**
     * The label of one workspace folder.
     * @param root - absolute folder path.
     * @returns its final segment, or the path itself at a filesystem root.
     */
    function rootLabel(root) {
      if (root === '') return '/'
      const trimmed = String(root).replace(/\/+$/, '')
      if (trimmed === '') return '/'
      const index = trimmed.lastIndexOf('/')
      if (index < 0) return trimmed
      const name = trimmed.slice(index + 1)
      return name === '' ? trimmed : name
    }

    /**
     * The tree key of one absolute root, matching the shipped tree's own root
     * normalization: no trailing separators, and an empty key for `/`.
     * @param path - absolute path in either separator spelling.
     * @returns the tree key.
     */
    function treePathKey(path) {
      return normalizeSlashes(path).replace(/\/+$/, '')
    }

    /**
     * The absolute path the Host should read for one tree key.
     * @param key - tree key from {@link treePathKey}.
     * @returns the request path.
     */
    function requestPathOf(key) {
      if (key === '') return '/'
      if (/^[A-Za-z]:$/.test(key)) return `${key}/`
      return key
    }

    /**
     * Whether a tree key sits below a hidden segment relative to any root.
     * @param path - tree key.
     * @param rootKeys - the workspace folder keys.
     * @returns whether a segment below a root starts with a dot.
     */
    function underHiddenSegment(path, rootKeys) {
      // An explicitly declared folder stays visible even when its own name is
      // hidden, and the most specific containing folder decides.
      const ordered = [...rootKeys].sort((left, right) => right.length - left.length)
      for (const root of ordered) {
        if (root !== '' && path === root) return false
        if (root === '') {
          if (!path.startsWith('/')) continue
          return path.replace(/^\/+/, '').split('/').some(part => part.startsWith('.'))
        }
        if (!path.startsWith(`${root}/`)) continue
        return path.slice(root.length + 1).split('/').some(part => part.startsWith('.'))
      }
      return false
    }

    /**
     * Build the session file resource address for one absolute file path.
     * @param sessionId - Session whose Host workspace resolves the path.
     * @param absolutePath - file path in either separator spelling.
     * @returns the `dsh-resource://file/session/...` address.
     */
    function sessionFileAddress(sessionId, absolutePath) {
      const normalized = normalizeSlashes(absolutePath).replace(/^(?:\.\/)+/, '')
      const encoded = normalized.split('/').map(segment => encodeURIComponent(segment).replace(/%3A/gi, ':')).join('/')
      return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${encoded}`
    }

    /**
     * The directories strictly between one tree root and an entry.
     * @param root - tree root key.
     * @param path - entry key under that root.
     * @returns the ancestor directory keys, outermost first.
     */
    function ancestorsOf(root, path) {
      const normalizedRoot = normalizeSlashes(root)
      const normalizedPath = normalizeSlashes(path)
      const relative = normalizedPath.startsWith(`${normalizedRoot}/`)
        ? normalizedPath.slice(normalizedRoot.length + 1)
        : normalizedPath
      const parts = relative.split('/')
      parts.pop()
      const directories = []
      let current = normalizedRoot
      for (const part of parts) {
        current = joinTreePath(current, part)
        directories.push(current)
      }
      return directories
    }

    /**
     * The sidebar navigation glyph.
     * @param props - the sidebar's icon share.
     * @returns the glyph.
     */
    function WorkspacePanelIcon({ size = 16 }) {
      return h(IconWorkspace, { size })
    }

    /**
     * The Project workspaces page.
     * @param props - framework hooks, locale, and injected services.
     * @returns the page.
     */
    function WorkspacePage(props) {
      const { t, picker, useWorkspaces, workspaces, uiWorkspace } = props
      const store = useStore(picker)
      const workspaceKey = useWorkspaces(snapshot => snapshot.items.map(item => `${item.workspaceId}:${item.title}`).join('|'))
      const [refresh, setRefresh] = React.useState(0)
      const [list, setList] = React.useState({ phase: 'loading', entries: [], error: null })
      const [busyId, setBusyId] = React.useState(null)
      const [rowError, setRowError] = React.useState(null)

      React.useEffect(() => {
        let cancelled = false
        setList(current => ({ ...current, phase: 'loading', error: null }))
        void (async () => {
          try {
            const response = await fetch('api/project-workspace.list', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: '{}',
            })
            const data = await response.json().catch(() => null)
            if (!response.ok || data?.ok !== true) throw new Error(failureText(data, t))
            if (cancelled) return
            setList({ phase: 'ready', entries: Array.isArray(data.entries) ? data.entries : [], error: null })
          } catch {
            if (cancelled) return
            setList({ phase: 'error', entries: [], error: t('list.error') })
          }
        })()
        return () => { cancelled = true }
      }, [workspaceKey, store.revision, refresh, t])

      const openEntry = async (entry) => {
        if (busyId !== null) return
        setBusyId(entry.workspaceId)
        setRowError(null)
        try {
          // Clicking a project workspace is an explicit reload point: re-read
          // its `.code-workspace` before opening so roots and writable grants
          // follow the file on disk.
          const response = await fetch('api/project-workspace.refresh', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ workspaceId: entry.workspaceId }),
          })
          const data = await response.json().catch(() => null)
          if (!response.ok || data?.ok !== true) {
            setRowError(failureText(data, t))
            setRefresh(value => value + 1)
            return
          }
          if (Array.isArray(data.roots)) {
            setList(current => ({
              ...current,
              entries: current.entries.map(item => item.workspaceId === entry.workspaceId
                ? { ...item, roots: data.roots, folderCount: data.roots.length }
                : item),
            }))
          }
          await waitForWorkspace(workspaces.list, entry.workspaceId, BUSY_TIMEOUT_MS)
          await uiWorkspace.openWorkspace(entry.workspaceId)
        } catch (error) {
          setRowError(error instanceof Error && error.message === 'workspace wait timed out'
            ? t('open.waitFailed') : t('open.failed'))
          setRefresh(value => value + 1)
        } finally {
          setBusyId(null)
        }
      }

      return h('section', { className: 'pw-page', 'aria-label': t('page.title') },
        h(Styles),
        h('div', { className: 'pw-page-scroll' },
          h('div', { className: 'pw-page-content' },
            h('header', { className: 'pw-page-heading', 'data-window-drag': true },
              h('h1', null, t('page.title')),
              h('button', {
                className: 'pw-primary', type: 'button',
                onClick: () => picker.set({ open: true }),
              }, h(IconFolder, { size: 14 }), t('page.open')),
            ),
            rowError === null ? null : h('div', { className: 'pw-error', role: 'alert' },
              h(IconWarning, { size: 14 }), rowError,
            ),
            list.phase === 'loading'
              ? h('div', { className: 'pw-loading', role: 'status' },
                h('span', { className: 'pw-spinner', 'aria-label': t('list.loading') }))
              : list.phase === 'error'
                ? h('div', { className: 'pw-error', role: 'alert' },
                  h(IconWarning, { size: 14 }), list.error,
                  h('button', {
                    className: 'pw-button pw-button-small', type: 'button',
                    onClick: () => setRefresh(value => value + 1),
                  }, t('list.retry')),
                )
                : list.entries.length === 0
                  ? h('p', { className: 'pw-empty' }, t('list.empty'))
                  : h('ul', { className: 'pw-list' }, list.entries.map(entry =>
                    h('li', { key: entry.workspaceId },
                      h('button', {
                        className: 'pw-row', type: 'button',
                        onClick: () => { void openEntry(entry) },
                        disabled: busyId !== null,
                        title: entry.file,
                        'aria-description': t('row.openLabel', { title: entry.title }),
                      },
                        h('span', { className: 'pw-row-glyph' }, h(IconWorkspace, { size: 16 })),
                        h('span', { className: 'pw-row-main' },
                          h('span', { className: 'pw-row-title' }, entry.title),
                          h('span', { className: 'pw-row-path' }, entry.file),
                        ),
                        busyId === entry.workspaceId
                          ? h('span', { className: 'pw-spinner' })
                          : h('span', { className: 'pw-row-chevron' }, h(IconChevron, { size: 14 })),
                      ),
                    ),
                  )),
          ),
        ),
      )
    }

    /**
     * The frame-wide workspace file picker.
     * @param props - locale and injected services.
     * @returns the dialog, or null while closed.
     */
    function WorkspacePickerDialog(props) {
      const { t, picker, workspaces, uiWorkspace } = props
      const store = useStore(picker)
      const open = store.open === true
      const [phase, setPhase] = React.useState('idle')
      const [listing, setListing] = React.useState(null)
      const [pathDraft, setPathDraft] = React.useState('')
      const [selected, setSelected] = React.useState(null)
      const [includeHidden, setIncludeHidden] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [openError, setOpenError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const dialogRef = React.useRef(null)
      const inputRef = React.useRef(null)
      const restoreRef = React.useRef(null)
      const browseRef = React.useRef(null)
      const closeRef = React.useRef(null)
      const openAbortRef = React.useRef(null)
      const browseSeqRef = React.useRef(0)
      const lastTargetRef = React.useRef(null)

      /**
       * Read one directory level.
       * @param target - directory path; omitted lists the home directory.
       * @param hidden - whether to include dot-prefixed entries.
       * @returns resolution after the listing settles.
       */
      const browse = React.useCallback(async (target, hidden = includeHidden) => {
        if (busy) return
        const sequence = browseSeqRef.current + 1
        browseSeqRef.current = sequence
        lastTargetRef.current = typeof target === 'string' && target !== '' ? target : null
        setPhase('loading')
        setError(null)
        setSelected(null)
        try {
          const response = await fetch('api/project-workspace.browse', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              ...(lastTargetRef.current === null ? {} : { path: lastTargetRef.current }),
              includeHidden: hidden,
            }),
          })
          const data = await response.json().catch(() => null)
          if (sequence !== browseSeqRef.current) return
          if (!response.ok || data?.ok !== true) {
            setError(failureText(data, t))
            setPhase('error')
            return
          }
          setListing({
            path: data.path,
            parent: data.parent,
            home: data.home,
            directories: Array.isArray(data.directories) ? data.directories : [],
            files: Array.isArray(data.files) ? data.files : [],
            truncated: data.truncated === true,
          })
          setPhase('ready')
          picker.set({ lastDir: data.path })
        } catch (failure) {
          if (sequence !== browseSeqRef.current) return
          setError(t('picker.browseError'))
          setPhase('error')
        }
      }, [busy, includeHidden, picker, t])
      browseRef.current = browse

      React.useEffect(() => {
        if (!open) return undefined
        restoreRef.current = document.activeElement
        setPhase('loading')
        setListing(null)
        setSelected(null)
        setError(null)
        setOpenError(null)
        setBusy(false)
        setPathDraft('')
        void browseRef.current(picker.get().lastDir)
        const focus = setTimeout(() => { inputRef.current?.focus() }, 0)
        return () => {
          clearTimeout(focus)
          const target = restoreRef.current
          if (target !== null && typeof target?.focus === 'function' && target.isConnected !== false) target.focus()
        }
      }, [open, picker])

      React.useEffect(() => {
        // A listing that arrives while the reader is editing the path must not
        // overwrite the draft.
        if (listing !== null && document.activeElement !== inputRef.current) setPathDraft(listing.path)
      }, [listing])

      React.useEffect(() => {
        if (!open) return undefined
        const onEscape = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          closeRef.current?.()
        }
        document.addEventListener('keydown', onEscape, true)
        return () => document.removeEventListener('keydown', onEscape, true)
      }, [open])

      if (!open) return null

      const close = () => {
        // Closing always works: an in-flight open is aborted instead of
        // pinning the dialog open until an unresponsive Host answers.
        if (openAbortRef.current !== null) {
          openAbortRef.current.abort()
          openAbortRef.current = null
        }
        setBusy(false)
        picker.set({ open: false })
      }
      closeRef.current = close

      /**
       * Open one workspace file through the Host.
       * @param file - absolute `.code-workspace` path.
       * @returns resolution after the outcome settles.
       */
      const openFile = async (file) => {
        if (busy) return
        setBusy(true)
        setOpenError(null)
        picker.set({ notice: null })
        const controller = new AbortController()
        openAbortRef.current = controller
        let timedOut = false
        const deadline = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, 30_000)
        try {
          const response = await fetch('api/project-workspace.open', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ file }),
            signal: controller.signal,
          })
          const data = await response.json().catch(() => null)
          if (controller.signal.aborted) return
          if (!response.ok || data?.ok !== true) {
            setOpenError(failureText(data, t))
            return
          }
          picker.set({ revision: picker.get().revision + 1 })
          await waitForWorkspace(workspaces.list, data.workspaceId, BUSY_TIMEOUT_MS)
          if (controller.signal.aborted) return
          await uiWorkspace.openWorkspace(data.workspaceId)
          if (controller.signal.aborted) return
          // The notice is published only after the session actually opened, so
          // it can never describe a navigation that did not happen.
          if (data.notice != null) picker.set({ notice: data.notice })
          picker.set({ open: false })
        } catch (failure) {
          if (controller.signal.aborted) {
            if (timedOut) setOpenError(t('open.timeout'))
            return
          }
          setOpenError(failure instanceof Error && failure.message === 'workspace wait timed out'
            ? t('open.waitFailed') : t('open.failed'))
        } finally {
          clearTimeout(deadline)
          if (openAbortRef.current === controller) openAbortRef.current = null
          setBusy(false)
        }
      }

      const submitPath = () => {
        const value = pathDraft.trim()
        if (value === '' || busy) return
        if (/\.code-workspace$/i.test(value)) void openFile(value)
        else void browse(value)
      }

      const toggleHidden = () => {
        const next = !includeHidden
        setIncludeHidden(next)
        void browse(listing?.path, next)
      }

      const onTab = (event) => {
        if (event.key !== 'Tab' || dialogRef.current === null) return
        const nodes = [...dialogRef.current.querySelectorAll(FOCUSABLE)]
        if (nodes.length === 0) return
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }

      const directories = listing?.directories ?? []
      const files = listing?.files ?? []

      let body
      if (phase === 'idle' || phase === 'loading') {
        body = h('div', { className: 'pw-browse-state', role: 'status' },
          h('span', { className: 'pw-spinner', 'aria-label': t('picker.loading') }))
      } else if (phase === 'error') {
        body = h('div', { className: 'pw-browse-state' },
          h('span', null, error ?? t('picker.browseError')),
          h('button', {
            className: 'pw-button pw-button-small', type: 'button',
            onClick: () => { void browse((listing?.path ?? pathDraft.trim()) || undefined) },
          }, t('picker.retry')),
        )
      } else if (directories.length === 0 && files.length === 0) {
        body = h('div', { className: 'pw-browse-state' }, t('picker.empty'))
      } else {
        body = h('ul', { className: 'pw-browse' },
          directories.map(entry => h('li', { key: `d:${entry.path}` },
            h('button', { className: 'pw-file-row', type: 'button', title: entry.path, disabled: busy, onClick: () => { void browse(entry.path) } },
              h('span', { className: 'pw-file-icon' }, h(IconFolder, { size: 16 })),
              h('span', { className: 'pw-file-name' }, entry.name),
            ),
          )),
          files.map(entry => h('li', { key: `f:${entry.path}` },
            h('button', {
              className: 'pw-file-row', type: 'button', title: entry.path,
              'aria-pressed': selected === entry.path,
              'data-selected': selected === entry.path ? 'true' : undefined,
              disabled: busy,
              onClick: () => setSelected(entry.path),
              onDoubleClick: () => { setSelected(entry.path); void openFile(entry.path) },
            },
              h('span', { className: 'pw-file-icon' }, h(IconFile, { size: 16 })),
              h('span', { className: 'pw-file-name' }, entry.name),
              selected === entry.path ? h('span', { className: 'pw-file-check' }, h(IconCheck, { size: 14 })) : null,
            ),
          )),
        )
      }

      return h('div', {
        className: 'pw-overlay',
        onMouseDown: (event) => { if (event.target === event.currentTarget) close() },
        onKeyDown: (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          close()
        },
      },
        h('div', {
          className: 'pw-dialog', role: 'dialog', 'aria-modal': 'true',
          'aria-labelledby': 'project-workspace-dialog-title',
          ref: dialogRef, onKeyDown: onTab,
        },
          h(Styles),
          h('div', { className: 'pw-dialog-head' },
            h('h2', { className: 'pw-dialog-title', id: 'project-workspace-dialog-title' }, t('picker.title')),
            h('button', {
              className: 'pw-icon-button', type: 'button', 'aria-label': t('picker.close'),
              title: t('picker.close'), onClick: close,
            }, h(IconClose, { size: 14 })),
          ),
          h('div', { className: 'pw-dialog-body' },
            h('div', { className: 'pw-path-row' },
              h('button', {
                className: 'pw-icon-button', type: 'button', 'aria-label': t('picker.up'), title: t('picker.up'),
                disabled: busy || phase === 'loading' || listing?.parent == null,
                onClick: () => { void browse(listing?.parent ?? undefined) },
              }, h(IconUp, { size: 14 })),
              h('button', {
                className: 'pw-icon-button', type: 'button', 'aria-label': t('picker.home'), title: t('picker.home'),
                disabled: busy || phase === 'loading',
                onClick: () => { void browse(listing?.home ?? undefined) },
              }, h(IconHome, { size: 14 })),
              h('input', {
                className: 'pw-path-input', type: 'text', value: pathDraft, spellCheck: false,
                'aria-label': t('picker.pathLabel'),
                disabled: busy, ref: inputRef,
                onChange: event => setPathDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  submitPath()
                },
              }),
              h('button', { className: 'pw-button pw-button-small', type: 'button', disabled: busy, onClick: submitPath }, t('picker.go')),
              h('button', {
                className: 'pw-icon-button', type: 'button',
                'aria-label': includeHidden ? t('picker.hideHidden') : t('picker.showHidden'),
                title: includeHidden ? t('picker.hideHidden') : t('picker.showHidden'),
                'aria-pressed': includeHidden, 'data-active': includeHidden ? 'true' : undefined,
                disabled: busy, onClick: toggleHidden,
              }, h(IconEye, { size: 14 })),
            ),
            h('div', { className: 'pw-browse-wrap' }, body),
            listing?.truncated === true ? h('p', { className: 'pw-hint' }, t('picker.truncated')) : null,
            openError === null ? null : h('p', { className: 'pw-dialog-error', role: 'alert' },
              h(IconWarning, { size: 14 }), openError),
          ),
          h('div', { className: 'pw-dialog-foot' },
            selected === null ? null : h('span', { className: 'pw-selected', title: selected }, selected),
            h('div', { className: 'pw-dialog-actions' },
              h('button', { className: 'pw-button', type: 'button', onClick: close }, t('picker.cancel')),
              h('button', {
                className: 'pw-button', 'data-variant': 'primary', type: 'button',
                disabled: busy || selected === null,
                onClick: () => { if (selected !== null) void openFile(selected) },
              }, busy ? t('picker.opening') : t('picker.confirm')),
            ),
          ),
        ),
      )
    }

    /**
     * The workspace files tab: every declared folder of the session's
     * multi-root workspace with a searchable, reloadable tree.
     * @param props - session hooks, tab actions, Factory renderer, and locale.
     * @returns the files page.
     */
    function WorkspaceFilesPage(props) {
      const { t, sessionId, useSessions, useTabInfo, renderFactorySlot } = props
      const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
      const sessionsReady = useSessions(sessions => sessions.phase === 'ready')
      const { tab, panel } = useTabInfo()
      const [roots, setRoots] = React.useState([])
      const [rootsPhase, setRootsPhase] = React.useState('loading')
      const [levels, setLevels] = React.useState({})
      const [expanded, setExpanded] = React.useState([])
      const [includeHidden, setIncludeHidden] = React.useState(false)
      const [refreshKey, setRefreshKey] = React.useState(0)
      const [query, setQuery] = React.useState('')
      const [debounced, setDebounced] = React.useState('')
      const [search, setSearch] = React.useState({ phase: 'idle', groups: [], count: 0, truncated: false, incomplete: false })
      const [searchExpanded, setSearchExpanded] = React.useState([])
      const [collapsedRoots, setCollapsedRoots] = React.useState([])
      const [collapsedSearchRoots, setCollapsedSearchRoots] = React.useState([])
      const generationRef = React.useRef(0)
      const lastCwdRef = React.useRef(undefined)
      const expandedRef = React.useRef([])
      expandedRef.current = expanded
      const searchAbortRef = React.useRef(null)
      const wasVisibleRef = React.useRef(tab.visible === true)
      const retry = React.useCallback(() => setRefreshKey(value => value + 1), [])

      /**
       * Read one directory level.
       * @param path - absolute directory key.
       * @param generation - lifecycle generation; a stale response is dropped.
       * @returns resolution after the level settles.
       */
      const loadLevel = React.useCallback(async (path, generation) => {
        const key = treePathKey(path)
        setLevels(current => ({ ...current, [key]: { status: 'loading' } }))
        try {
          const response = await fetch('api/project-workspace.dir', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: requestPathOf(key) }),
          })
          const data = await response.json().catch(() => null)
          if (generation !== generationRef.current) return
          if (!response.ok || data?.ok !== true) {
            setLevels(current => ({ ...current, [key]: { status: 'error' } }))
            return
          }
          setLevels(current => ({
            ...current,
            [key]: {
              status: 'ready',
              entries: Array.isArray(data.entries) ? data.entries : [],
              truncated: data.truncated === true,
            },
          }))
        } catch (failure) {
          if (generation !== generationRef.current) return
          setLevels(current => ({ ...current, [key]: { status: 'error' } }))
        }
      }, [])

      // Resolve the workspace folders whenever the session directory or the
      // refresh token changes, then load the roots (and any kept expansion).
      React.useEffect(() => {
        const generation = generationRef.current + 1
        generationRef.current = generation
        if (typeof cwd !== 'string' || cwd === '') {
          if (!sessionsReady) {
            // The Session catalog has not arrived yet; do not claim there is no
            // workspace before it can answer.
            setRootsPhase('loading')
            return undefined
          }
          setRoots([])
          setRootsPhase('none')
          setLevels({})
          setExpanded([])
          setCollapsedRoots([])
          setCollapsedSearchRoots([])
          lastCwdRef.current = cwd
          return undefined
        }
        const cwdChanged = lastCwdRef.current !== cwd
        lastCwdRef.current = cwd
        if (cwdChanged) {
          setLevels({})
          setExpanded([])
          setCollapsedRoots([])
        }
        const previousExpanded = cwdChanged ? [] : expandedRef.current
        let cancelled = false
        setRootsPhase('loading')
        void (async () => {
          let nextRoots = [normalizeSlashes(cwd)]
          try {
            const response = await fetch('api/project-workspace.list', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: '{}',
            })
            const data = await response.json().catch(() => null)
            if (data?.ok === true && Array.isArray(data.entries)) {
              const target = normalizeSlashes(cwd)
              const entry = data.entries.find(item => normalizeSlashes(item.path) === target)
              if (entry !== undefined && Array.isArray(entry.roots) && entry.roots.length > 0) {
                nextRoots = entry.roots.map(normalizeSlashes)
              }
            }
          } catch (failure) {
            // The session directory remains the single fallback root.
          }
          if (cancelled || generation !== generationRef.current) return
          setRoots(nextRoots)
          setRootsPhase('ready')
          const nextKeys = nextRoots.map(treePathKey)
          setCollapsedRoots(current => current.filter(key => nextKeys.includes(key)))
          const wanted = new Set(nextKeys)
          for (const levelPath of previousExpanded) {
            if (typeof levelPath === 'string') wanted.add(treePathKey(levelPath))
          }
          for (const levelPath of wanted) void loadLevel(levelPath, generation)
        })()
        return () => { cancelled = true }
      }, [cwd, sessionsReady, refreshKey, loadLevel])

      // The tab stays mounted while hidden. Revalidate its workspace roots
      // whenever the user returns to the tab, matching an explicit reopen.
      React.useEffect(() => {
        if (tab.visible && !wasVisibleRef.current) setRefreshKey(value => value + 1)
        wasVisibleRef.current = tab.visible
      }, [tab.visible])

      // Debounce the search query.
      React.useEffect(() => {
        const timer = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS)
        return () => clearTimeout(timer)
      }, [query])

      // Search every declared folder while the query is non-empty.
      React.useEffect(() => {
        if (searchAbortRef.current !== null) {
          searchAbortRef.current.abort()
          searchAbortRef.current = null
        }
        if (debounced === '' || rootsPhase !== 'ready' || roots.length === 0) {
          setSearch({ phase: 'idle', groups: [], count: 0, truncated: false, incomplete: false })
          setSearchExpanded([])
          return undefined
        }
        // A new query starts with every folder open so no match is hidden
        // behind a section the user collapsed for the previous query.
        setCollapsedSearchRoots([])
        const controller = new AbortController()
        searchAbortRef.current = controller
        setSearch(current => ({ ...current, phase: 'loading' }))
        void (async () => {
          try {
            const response = await fetch('api/project-workspace.search', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ roots, query: debounced, includeHidden }),
              signal: controller.signal,
            })
            const data = await response.json().catch(() => null)
            if (controller.signal.aborted) return
            if (!response.ok || data?.ok !== true) {
              setSearch({ phase: 'error', groups: [], count: 0, truncated: false, incomplete: false })
              return
            }
            const groups = (Array.isArray(data.groups) ? data.groups : []).map((group) => {
              const root = normalizeSlashes(group.root)
              return {
                root,
                key: treePathKey(root),
                matches: (Array.isArray(group.matches) ? group.matches : []).map(match => ({
                  path: normalizeSlashes(match.path),
                  kind: match.kind,
                })),
              }
            })
            let count = 0
            const nextExpanded = new Set()
            for (const group of groups) {
              count += group.matches.length
              for (const match of group.matches) {
                for (const directory of ancestorsOf(group.key, match.path)) nextExpanded.add(directory)
                if (match.kind === 'directory') nextExpanded.add(match.path)
              }
            }
            setSearchExpanded([...nextExpanded])
            setSearch({
              phase: 'ready',
              groups,
              count,
              truncated: data.truncated === true,
              incomplete: data.incomplete === true,
            })
          } catch (failure) {
            if (controller.signal.aborted) return
            setSearch({ phase: 'error', groups: [], count: 0, truncated: false, incomplete: false })
          }
        })()
        return () => controller.abort()
      }, [debounced, roots, rootsPhase, includeHidden, refreshKey])

      const toggleTree = React.useCallback((entry, nextExpanded) => {
        const path = treePathKey(entry.path)
        setExpanded(current => {
          if (nextExpanded) return current.includes(path) ? current : [...current, path]
          return current.filter(value => value !== path)
        })
        if (nextExpanded) void loadLevel(path, generationRef.current)
      }, [loadLevel])

      const toggleSearch = React.useCallback((entry, nextExpanded) => {
        const path = treePathKey(entry.path)
        setSearchExpanded(current => {
          if (nextExpanded) return current.includes(path) ? current : [...current, path]
          return current.filter(value => value !== path)
        })
      }, [])

      const openFile = React.useCallback((entry) => {
        const address = sessionFileAddress(sessionId, entry.path)
        if (panel.isFloating) tab.actions.openResource(address)
        else tab.actions.openResource(address, { paneId: panel.id })
      }, [sessionId, tab, panel])

      React.useEffect(() => {
        if (typeof tab.actions.bindCommands !== 'function') return undefined
        return tab.actions.bindCommands({ refresh: retry })
      }, [tab, retry])

      const treeEntries = React.useMemo(() => {
        const list = []
        const rootKeys = roots.map(treePathKey)
        for (const [levelPath, level] of Object.entries(levels)) {
          if (level.status !== 'ready') continue
          // A hidden directory's descendants are not hidden themselves; without
          // this filter the tree would re-add the filtered parent as an implied row.
          if (!includeHidden && underHiddenSegment(levelPath, rootKeys)) continue
          for (const entry of level.entries) {
            if (entry.hidden && !includeHidden) continue
            list.push({
              path: joinTreePath(levelPath, entry.name),
              name: entry.name,
              meta: { kind: entry.kind, hidden: entry.hidden },
            })
          }
        }
        return list
      }, [levels, includeHidden, roots])

      const treeDirectories = React.useMemo(() => {
        const record = {}
        for (const [levelPath, level] of Object.entries(levels)) {
          if (level.status === 'loading') record[levelPath] = { loading: true }
          else if (level.status === 'error') record[levelPath] = { failure: t('files.failed') }
          else {
            const hasHidden = !includeHidden && level.entries.some(entry => entry.hidden)
            record[levelPath] = {
              ...(hasHidden ? { omitted: 'hidden' } : {}),
              ...(level.truncated ? { truncated: true } : {}),
            }
          }
        }
        return record
      }, [levels, includeHidden, t])

      const searchEntries = React.useMemo(() => {
        const map = new Map()
        for (const group of search.groups) {
          map.set(group.key, group.matches.map(match => ({
            path: match.path,
            name: rootLabel(match.path),
            meta: { kind: match.kind },
          })))
        }
        return map
      }, [search.groups])

      const searchDirectories = React.useMemo(() => {
        const record = {}
        for (const group of search.groups) {
          record[group.key] = { omitted: 'unmatched' }
          for (const match of group.matches) {
            for (const directory of ancestorsOf(group.key, match.path)) {
              record[directory] = { omitted: 'unmatched' }
            }
            if (match.kind === 'directory') record[match.path] = { omitted: 'unmatched' }
          }
        }
        return record
      }, [search.groups])

      const searching = debounced !== ''
      const clearSearch = () => setQuery('')
      const hiddenLabel = includeHidden ? t('files.hideHidden') : t('files.showHidden')
      const treeOptions = React.useMemo(() => ({
        slots: TREE_SLOTS,
        fallback: h('p', { className: 'pw-rfiles-note' }, t('files.unavailable')),
      }), [t])

      const toggleSection = (key, mode) => {
        const update = mode === 'search' ? setCollapsedSearchRoots : setCollapsedRoots
        update(current => current.includes(key)
          ? current.filter(value => value !== key)
          : [...current, key])
      }

      const renderTree = (key, title, input, mode) => {
        const collapsed = (mode === 'search' ? collapsedSearchRoots : collapsedRoots).includes(key)
        return h('section', {
          className: 'pw-rfiles-section',
          key,
          'data-collapsed': collapsed ? 'true' : undefined,
        },
          h('button', {
            className: 'pw-rfiles-root', type: 'button', title,
            'aria-expanded': !collapsed,
            onClick: () => toggleSection(key, mode),
          },
            h('span', { className: 'pw-rfiles-root-chevron' }, h(IconChevron, { size: 12 })),
            h('span', { className: 'pw-rfiles-root-label' }, rootLabel(key)),
          ),
          collapsed ? null : renderFactorySlot('sidebar.files.tree', input, treeOptions),
        )
      }

      let content = null
      if (rootsPhase === 'none') {
        content = h('div', { className: 'pw-rfiles-state' }, t('files.noWorkspace'))
      } else if (searching) {
        const notes = []
        if (search.phase === 'error') {
          notes.push(h('p', { className: 'pw-rfiles-note', 'data-tone': 'error', key: 'search-error' },
            t('files.searchFailed'),
            h('span', { className: 'pw-rfiles-note-actions' },
              h('button', { className: 'pw-button pw-button-small', type: 'button', onClick: retry }, t('files.retry'))),
          ))
        } else if (search.phase === 'ready') {
          if (search.count === 0) notes.push(h('p', { className: 'pw-rfiles-note', key: 'search-empty' }, t('files.searchEmpty')))
          else {
            notes.push(h('p', { className: 'pw-rfiles-note', key: 'search-count' }, t('files.searchResults', { count: String(search.count) })))
            if (search.truncated) notes.push(h('p', { className: 'pw-rfiles-note', key: 'search-truncated' }, t('files.searchTruncated')))
            if (search.incomplete) notes.push(h('p', { className: 'pw-rfiles-note', key: 'search-incomplete' }, t('files.searchIncomplete')))
          }
        }
        const groups = search.phase === 'ready' && search.count > 0 ? search.groups : []
        content = [
          ...notes,
          groups.length > 0
            ? groups.map(group => renderTree(group.key, group.root, {
              root: group.key,
              entries: searchEntries.get(group.key) ?? [],
              expanded: searchExpanded,
              directories: searchDirectories,
              highlight: debounced,
              onToggle: toggleSearch,
              onOpen: openFile,
            }, 'search'))
            : search.phase === 'loading' || search.phase === 'idle'
              ? h('div', { className: 'pw-rfiles-state', key: 'search-loading' }, h('span', { className: 'pw-spinner', 'aria-label': t('files.loading') }))
              : null,
        ]
      } else if (rootsPhase === 'loading' && roots.length === 0) {
        content = h('div', { className: 'pw-rfiles-state' }, h('span', { className: 'pw-spinner', 'aria-label': t('files.loading') }))
      } else {
        content = roots.map(root => renderTree(treePathKey(root), root, {
          root: treePathKey(root),
          entries: treeEntries,
          expanded,
          directories: treeDirectories,
          onToggle: toggleTree,
          onOpen: openFile,
        }, 'tree'))
      }

      return h('section', { className: 'pw-rfiles', 'aria-label': t('files.title') },
        h(Styles),
        h('header', { className: 'pw-rfiles-head' },
          h('div', { className: 'pw-rfiles-search' },
            h(IconSearch, { size: 13 }),
            h('input', {
              type: 'text',
              className: 'pw-rfiles-search-input',
              value: query,
              placeholder: t('files.searchPlaceholder'),
              'aria-label': t('files.searchPlaceholder'),
              spellCheck: false,
              onChange: event => setQuery(event.target.value),
              onKeyDown: (event) => {
                if (event.key !== 'Escape' || query === '') return
                event.preventDefault()
                event.stopPropagation()
                setQuery('')
              },
            }),
            search.phase === 'loading'
              ? h('span', { className: 'pw-spinner', 'aria-label': t('files.loading') })
              : null,
            query === ''
              ? null
              : h('button', {
                className: 'pw-icon-button pw-rfiles-clear',
                type: 'button',
                'aria-label': t('files.searchClear'),
                title: t('files.searchClear'),
                onClick: clearSearch,
              }, h(IconClose, { size: 12 })),
          ),
          h('button', {
            className: 'pw-icon-button', type: 'button',
            'aria-label': t('files.reload'), title: t('files.reload'), onClick: retry,
          }, h(IconRefresh, { size: 14 })),
          h('button', {
            className: 'pw-icon-button', type: 'button',
            'aria-label': hiddenLabel, title: hiddenLabel,
            'aria-pressed': includeHidden,
            'data-active': includeHidden ? 'true' : undefined,
            onClick: () => setIncludeHidden(value => !value),
          }, h(IconEye, { size: 14 })),
        ),
        h('div', { className: 'pw-rfiles-body' }, content),
      )
    }

    /**
     * The workspace files tab's chip title.
     * @param props - the tab information hook.
     * @returns the workspace glyph followed by the tab title.
     */
    function WorkspaceFilesTitle(props) {
      const { tab } = props.useTabInfo()
      return h(React.Fragment, null,
        h('span', { className: 'pw-rfiles-title-icon' }, h(IconWorkspace, { size: 16 })),
        tab.title,
      )
    }

    /**
     * The frame-wide notice toast. It lives outside the page so a notice about
     * the workspace that was just opened stays visible after the main panel
     * switches to the new session.
     * @param props - locale and the shared picker store.
     * @returns the toast, or null while no notice is pending.
     */
    function WorkspaceNoticeToast(props) {
      const { t, picker } = props
      const store = useStore(picker)
      const notice = store.notice
      React.useEffect(() => {
        if (notice == null) return undefined
        const timer = setTimeout(() => { picker.set({ notice: null }) }, 10_000)
        return () => clearTimeout(timer)
      }, [notice, picker])
      if (notice == null) return null
      const message = noticeText(notice, t)
      if (message === null) return null
      return h('div', { className: 'pw-toast', role: 'status' },
        h(Styles),
        h('span', { className: 'pw-toast-mark' }, h(IconWarning, { size: 14 })),
        h('span', { className: 'pw-toast-text' }, message),
        h('button', {
          className: 'pw-icon-button', type: 'button', 'aria-label': t('notice.dismiss'),
          onClick: () => picker.set({ notice: null }),
        }, h(IconClose, { size: 12 })),
      )
    }

    /**
     * Wait out the completion debounce, resolving false when the caller aborts.
     * @param signal - candidate request signal.
     * @returns whether the request may proceed.
     */
    function mentionDelay(signal) {
      if (signal?.aborted) return Promise.resolve(false)
      return new Promise((resolve) => {
        const onAbort = () => {
          clearTimeout(timer)
          resolve(false)
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort)
          resolve(true)
        }, MENTION_DEBOUNCE_MS)
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    }

    /**
     * Decode the opaque pick payload stored on one candidate row.
     * @param value - candidate value.
     * @returns the decoded value, or undefined when malformed.
     */
    function parseMentionValue(value) {
      if (typeof value !== 'string') return undefined
      try {
        const parsed = JSON.parse(value)
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined
      } catch {
        return undefined
      }
    }

    /**
     * Give the project-workspace group the menu's default highlight once its
     * candidates exist.
     *
     * The trigger pipeline highlights the first source group that settles. The
     * project source debounces and searches the Host, so the shipped reference
     * source usually settles first and keeps the highlight even after this
     * group appears above it. A zero-delay pass after this source settles moves
     * the default highlight to this group's first row, but never steals a
     * highlight the user has already moved to another row or group.
     *
     * @param input - client context, trigger service, session, and query.
     * @returns nothing.
     */
    function scheduleMentionFocus({ ctx, inputTriggers, sessionId, query }) {
      if (typeof sessionId !== 'string' || sessionId === '') return
      if (typeof query !== 'string' || query.trim() === '') return
      if (typeof ctx?.get !== 'function' || inputTriggers === undefined) return
      setTimeout(() => {
        try {
          const sessions = ctx.get('sessions')
          const binding = sessions?.binding?.(sessionId)
          if (binding === undefined || binding === null || binding.ctx === undefined) return
          const controller = inputTriggers.sessionOf(binding.ctx)
          const state = controller.menu.getSnapshot()
          if (state === null || typeof state !== 'object' || state.open !== true) return
          if (state.hit === null || typeof state.hit !== 'object' || state.hit.query !== query) return
          const group = Array.isArray(state.groups)
            ? state.groups.find(item => item.source === MENTION_SOURCE_NAME)
            : undefined
          if (group === undefined || group.status !== 'ready' || !Array.isArray(group.items) || group.items.length === 0) {
            return
          }
          const highlight = state.highlight
          const isDefault = highlight === null || highlight === undefined
            || (highlight.source === CORE_REFERENCE_SOURCE && highlight.index === 0)
          if (!isDefault) return
          controller.hover(MENTION_SOURCE_NAME, 0)
        } catch {
          // The menu or session generation may have been disposed; focus is
          // best-effort presentation and must never affect input.
        }
      }, 0)
    }

    /**
     * Project the Host reference payload into input-trigger rows.
     *
     * With an empty query the rows are the project workspace's roots. Once the
     * user types, the roots give way to candidates already grouped by root on
     * the Host, so the first highlighted row is a real file or directory.
     *
     * @param data - decoded Host payload.
     * @param query - live query text after `@`.
     * @param t - project-workspace translator.
     * @returns rows for the input-trigger menu.
     */
    function mentionRows(data, query, t) {
      const roots = Array.isArray(data.roots) ? data.roots : []
      const additional = roots.filter(root => root !== null && typeof root === 'object' && root.primary !== true)
      if (additional.length === 0) return []
      const rows = []
      if (query.trim() === '') {
        for (const root of roots) {
          if (root === null || typeof root !== 'object') continue
          if (typeof root.mention !== 'string' || typeof root.path !== 'string') continue
          const name = typeof root.name === 'string' && root.name !== '' ? root.name : root.path
          const drillMention = typeof root.drillMention === 'string' ? root.drillMention : undefined
          const value = { kind: 'directory', label: name, mention: root.mention }
          if (drillMention !== undefined) value.drillMention = drillMention
          rows.push({
            name: `${name}/`,
            description: root.path,
            icon: 'folder',
            section: t('mention.workspace'),
            value: JSON.stringify(value),
            ...(drillMention === undefined ? {} : { drill: true }),
          })
        }
        return rows
      }
      const groups = Array.isArray(data.groups) ? data.groups : []
      for (const group of groups) {
        if (group === null || typeof group !== 'object' || !Array.isArray(group.candidates)) continue
        const section = group.workspace === true
          ? t('mention.workspace')
          : typeof group.name === 'string' && group.name !== ''
            ? group.name
            : undefined
        for (const candidate of group.candidates) {
          if (candidate === null || typeof candidate !== 'object') continue
          if (typeof candidate.mention !== 'string' || typeof candidate.name !== 'string' || candidate.name === '') continue
          const directory = candidate.kind === 'directory'
          const drillMention = directory && typeof candidate.drillMention === 'string'
            ? candidate.drillMention
            : undefined
          const description = typeof candidate.description === 'string' && candidate.description !== ''
            ? candidate.description
            : typeof candidate.parent === 'string' && candidate.parent !== ''
              ? candidate.parent
              : undefined
          const value = { kind: directory ? 'directory' : 'file', label: candidate.name, mention: candidate.mention }
          if (drillMention !== undefined) value.drillMention = drillMention
          rows.push({
            name: directory ? `${candidate.name}/` : candidate.name,
            ...(description === undefined ? {} : { description }),
            icon: directory ? 'folder' : 'file',
            ...(section === undefined ? {} : { section }),
            value: JSON.stringify(value),
            ...(drillMention === undefined ? {} : { drill: true }),
          })
        }
      }
      return rows
    }

    /**
     * The `@` source that adds project-workspace roots and their files.
     * @param t - project-workspace translator.
     * @param focus - default-highlight callback receiving `(sessionId, query)`.
     * @returns the input-trigger source.
     */
    function createMentionSource(t, focus) {
      return {
        trigger: '@',
        name: MENTION_SOURCE_NAME,
        order: MENTION_SOURCE_ORDER,
        showGroupTitle: false,
        async candidates(session, { query, quoted, signal }) {
          const sessionId = typeof session?.sessionId === 'string' ? session.sessionId : ''
          if (sessionId === '') return []
          const queryText = typeof query === 'string' ? query : ''
          if (!await mentionDelay(signal)) return []
          if (signal?.aborted) return []
          let data
          try {
            const response = await fetch('api/project-workspace.references', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                sessionId,
                query: queryText,
                quoted: quoted === true,
              }),
              signal,
            })
            if (!response.ok) return []
            data = await response.json()
          } catch {
            return []
          }
          if (signal?.aborted) return []
          if (data === null || typeof data !== 'object' || data.ok !== true) return []
          const rows = mentionRows(data, queryText, t)
          if (rows.length > 0 && queryText.trim() !== '' && !signal?.aborted) {
            try {
              focus?.(sessionId, queryText)
            } catch {
              // Focus is best-effort presentation.
            }
          }
          return rows
        },
        onPick({ candidate, action }) {
          const value = parseMentionValue(candidate?.value)
          if (value === undefined || typeof value.mention !== 'string') return undefined
          const label = typeof value.label === 'string' && value.label !== ''
            ? value.label
            : typeof candidate?.name === 'string'
              ? candidate.name.replace(/\/+$/, '')
              : ''
          if (label === '') return undefined
          if (value.kind === 'directory') {
            if (action === 'drill' && typeof value.drillMention === 'string') {
              return { text: value.drillMention, continue: true }
            }
            return {
              insert: {
                source: 'reference',
                ref: value.mention,
                label: `${label}/`,
                appearance: 'folder',
                clipboardText: value.mention,
              },
            }
          }
          if (value.kind !== 'file') return undefined
          return {
            insert: {
              source: 'reference',
              ref: value.mention,
              label,
              appearance: 'file',
              clipboardText: value.mention,
            },
          }
        },
      }
    }

    return {
      inject: ['slots', 'locale', 'workspaces', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'project-workspace: dictionaries')
        const t = ctx.locale.bind(NS)
        const picker = createStore({ open: false, revision: 0, notice: null, lastDir: null })

        // Optional: without the trigger pipeline the rest of the plugin keeps
        // working; the source joins the @ menu as soon as the service exists.
        ctx.inject(['inputTriggers'], (child) => {
          const focusMention = (sessionId, query) => scheduleMentionFocus({
            ctx,
            inputTriggers: child.inputTriggers,
            sessionId,
            query,
          })
          child.effect(
            () => child.inputTriggers.registerSource(createMentionSource(t, focusMention)),
            'project-workspace: @ source',
          )
        })

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: -10,
          locale: NS,
          label: () => t('panel'),
        }, WorkspacePanelIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ picker, workspaces: ctx.workspaces, uiWorkspace: ctx.uiWorkspace }),
        }, WorkspacePage))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: DIALOG_ID,
          order: 10,
          locale: NS,
          inject: () => ({ picker, workspaces: ctx.workspaces, uiWorkspace: ctx.uiWorkspace }),
        }, WorkspacePickerDialog))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: NOTICE_ID,
          order: 20,
          locale: NS,
          inject: () => ({ picker }),
        }, WorkspaceNoticeToast))

        // The right-sidebar file tab is optional: without the right Sidebar the
        // rest of this plugin keeps working.
        ctx.inject(['sidebarRightTabs'], (child) => {
          child.effect(() => child.sidebarRightTabs.register({
            id: FILES_TYPE_ID,
            kind: FILES_KIND,
            priority: 'extension',
            keepMounted: true,
            title: () => t('files.title'),
            guide: [{
              id: 'workspace-files',
              order: 15,
              title: () => t('files.title'),
              icon: IconWorkspace,
            }],
          }), 'project-workspace: workspace files type')

          child.slots.inject('sidebar.right.pane.tab', () => child.slots.register({
            name: 'sidebar.right.pane.tab',
            key: FILES_TYPE_ID,
            locale: NS,
          }, WorkspaceFilesPage))

          child.slots.inject('sidebar.right.pane.tab.title', () => child.slots.register({
            name: 'sidebar.right.pane.tab.title',
            key: FILES_TYPE_ID,
            locale: NS,
          }, WorkspaceFilesTitle))
        })
      },
    }
  },
})
