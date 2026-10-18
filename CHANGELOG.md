# Changelog

## 0.7.0 — 2026-10-19

### Added

- Three-band panel layout: a top band for the worktree being viewed (path, branch or `detached @ <sha>`, main badge, ahead/behind, clean / dirty / conflict with the dirty breakdown, and the `local · remote · worktrees` counts), the topology in the middle, and a detail pane plus the other worktrees, changes and file sections below. The viewed worktree is not repeated in the bottom list, and a single-worktree repository shows no WORKTREES section.
- Clicking a commit, a branch rail/ref, or a linked worktree opens its details in the bottom pane; worktree and branch details report path, HEAD commit, upstream, tracking counts, dirty count and merge state, with shortcuts to switch worktree or open the tip commit.
- Clicking a file in CHANGES or FILES opens it in a new Sidebar tab through the built-in document preview (`dsh-resource://file/session/<sessionId>/<absolute path>`), with keyboard activation and a pointer affordance; the adapters without that registry keep the rows passive.
- `lib/core.js` reports branch upstream tracking (`upstream`, `ahead`, `behind`), each worktree's `upstream`, and `remoteBranchCount` for the top band counts.

## 0.6.0 — 2026-10-18

First public release.

- DSH: standard bundle package (`dsh.bundle.patch`, `dsh.client`, `engines.dsh`); right-Sidebar tab opened from the conversation header.
- Codex: local marketplace plugin with a right-side browser panel (`codex/`).
- Claude: native Pane provider for Claude Code / Claude desktop (`hooks/`, `.claude-plugin/`).
- Read-only branch/merge topology: straight trunk, one lane per branch, merges reconnect to the trunk, merged refs keep only a label.
- Worktrees, uncommitted changes and the file tree in one pane; commit details with per-file diffs.
- Path highlight with a flowing selection animation; keyboard selection.
- Plugin market index (format 1) built by CI and deployed to GitHub Pages (not committed).

## 0.5.x — internal iterations

Not released to npm. Earlier work covered the right-Sidebar reshape, 1:1 SVG rendering, branch labels, stacked rails and the shared `lib/core.js` data layer.
