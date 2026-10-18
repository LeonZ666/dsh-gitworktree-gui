---
name: new-iteration
description: 新增迭代：当用户说“新增迭代 / 开个迭代 / 新版本迭代”并给出需求时，为 dsh-gitworktree-gui 仓库创建 iter/vX.Y.Z-<slug> 分支、升级版本、写 CHANGELOG stub、创建 iterations/<version>.md 与忽略的 .artifacts/<version>/，并把需求写进迭代上下文。
---

# 新增迭代

只在当前工作目录是 `dsh-gitworktree-gui` 仓库（`package.json` 的 name 为该值）时执行。
完整发布规则见仓库根目录的 [RELEASING.md](../../../RELEASING.md)。

## 步骤

1. **确认起点**
   ```sh
   pwd
   git status --short
   ```
   - 工作区必须干净；有改动就停下来，列出文件让用户处理，不要 stash/commit。
   - 若不在 `main`，先 `git switch main && git pull --ff-only`；如果本地 main 落后，`iterate:start` 会自动 ff。

2. **确定版本**
   - 用户明确给了版本：照用。
   - 否则读当前版本，选择下一个：功能=`minor`、修复=`patch`、破坏性改动或收紧 `engines.dsh`=`major`。
   - 目标版本必须大于当前版本，否则 `iterate:start` 会拒绝。

3. **确定 slug**
   - 从需求提炼 2–4 个英文小写单词，kebab-case，例如 `graph-filters`、`sidebar-density`。
   - 只用于分支名；中文需求可直接意译。

4. **创建迭代**
   ```sh
   npm run iterate:start -- <version> <slug>
   ```
   该命令会：建 `iter/v<version>-<slug>`、同步升 `package.json`/`package-lock.json`、补 CHANGELOG stub、写 `iterations/v<version>.md`、建 `.artifacts/v<version>/`、启用 `.githooks`。

5. **填写上下文**
   编辑 `iterations/v<version>.md`：
   - `Requirements`：原样放入用户需求（可分段）。
   - `Goals / non-goals`：一句话重述目标；把明显不做的点写进 non-goals。
   - `Decisions`、`Verification`、`Leftovers` 留空，开发/验证过程中补。

6. **汇报**
   告诉用户：分支名、版本、`iterations/v<version>.md`、`.artifacts/v<version>/`，以及下一步（开发 → `npm run verify` → `npm run iterate:finish`）。
   除非用户明确要求，**不要** commit、push、开 PR、打 tag。

## 边界

- 已有 open 的 `iter/*` PR 时不要开新迭代；`iterate:start` 会拒绝。
- 不要从上一个迭代分支开新分支，始终从 `main`。
- 生成的产物只放 `.artifacts/`（已忽略）；不要 `git add` 它们。
- 不要直接推 `main`：分支保护要求 PR + `generated-files`/`test (20/22/24)` 检查。
- 命令失败时保留现场，把 stderr 的关键行告诉用户；不要用 `--no-verify` 绕钩子。
