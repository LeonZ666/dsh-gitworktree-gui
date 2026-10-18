# Changelog

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
