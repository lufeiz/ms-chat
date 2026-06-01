# Changesets

本目录由 [changesets](https://github.com/changesets/changesets) 管理版本与变更日志。

- 新增变更说明：`pnpm changeset`（交互式选择受影响的包与 semver 级别）
- 应用版本号：`pnpm version`（消费 changeset，bump 版本 + 更新 CHANGELOG）
- 发布：`pnpm release`（构建全部子包后 `changeset publish`）

详见 [changesets 文档](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md)。
