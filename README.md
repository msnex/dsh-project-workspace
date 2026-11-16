# dsh-project-workspace

**English** | [简体中文](README.zh_CN.md)

Loads a VS Code `.code-workspace` file as a DSH project workspace.

## Tested with

- 0.2.2-rc.3

## code-workspace file

Only `name` and `path` are read; every other field is ignored.

```json
{
  "folders": [
    {
      "name": "project-01",
      "path": "/path/to/project-01"
    },
    {
      "name": "project-02",
      "path": "/path/to/project-02"
    }
  ]
}
```

## DSH behavior

- The first `folders` entry that exists on disk becomes the workspace root; the remaining entries become additional roots the workspace can read and write.
- The workspace is named after the file, without its `.code-workspace` extension.
- A **Project workspaces** entry in the left sidebar loads `.code-workspace` files and lists the workspaces you have opened; deleting a workspace also removes it from that list.
- A **Project workspace files** tab in the right sidebar browses every directory and file in the project workspace, with search and reload.
- Typing `@` in the composer opens a **Project workspace** group that lists every root of the project workspace while the query is empty. Choosing a folder inserts a folder reference; Tab or the row's chevron drills into it. After you type, matching files and folders are grouped by root instead.
- Files and folders from additional roots are grouped by root and inserted as absolute `@` paths, matching the native convention for paths outside the project workspace root. Drill text stays relative to the project workspace root, so the shipped folder breadcrumbs keep working.
- A root on another volume still supports folder references, but its row does not drill because no relative breadcrumb path exists.
