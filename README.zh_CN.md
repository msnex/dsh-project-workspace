# dsh-project-workspace

[English](README.md) | **简体中文**

`dsh-project-workspace` 插件用于将`VS Code` 的`.code-workspace` 文件加载为项目工作空间。

## 测试版本

- 0.2.2-rc.3

## code-workspace 文件

- 仅解析`name` 与`path` 两个字段，其他字段会被忽略

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

## DSH 行为

- `code-workspace` 文件中的第一个存在于磁盘上的`folders` 条目会被注册为工作区根目录，其它条目会被注册为附加根，工作区拥有附加根的读写权限
- `code-workspace` 的文件名即为`dsh` 工作区的名称，不包含文件扩展名
- 左侧边栏新增`项目工作空间` 选项，其中包括：文件加载，历史记录列表；删除工作区会同步从列表中删除其记录
- 右侧边栏新增`项目工作空间文件` 标签项，用于浏览项目工作空间中的所有目录和文件，支持搜索和刷新
