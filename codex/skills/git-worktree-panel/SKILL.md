---
name: git-worktree-panel
description: Open a local read-only Git branch graph, worktrees, changes and files in a Codex browser panel when the user asks to view a project's Git worktree panel.
---

Resolve the requested project's absolute working directory from the current chat or the user's explicit path. Run the bundled launcher using an absolute path resolved relative to this skill:

```sh
node <plugin-root>/scripts/start.mjs --repo <absolute-project-directory>
```

The plugin root is two directories above this skill's directory. Quote paths properly. The launcher prints JSON containing `url`, `repo`, and `pid`; it reuses an existing healthy panel for that repository. Only report startup success after receiving that result.

Use `mcp__codex_app__open_in_codex` with a browser target set to the returned URL and `placement: "right"` when available. This opens an independent browser panel beside the chat; it does not inject DSH UI or create a permanent global sidebar entry. If the panel-opening tool is unavailable, give the local URL to the user.

The panel reads only Git state and serves assets on loopback. Switching its worktree selection changes only the displayed data. It does not change the chat's directory or Git checkout. The server exits after 30 minutes without requests; rerun the launcher to reopen it. Do not restart the desktop app or modify Codex settings to open a panel.

If `dist/server.mjs` is absent, report an incomplete plugin package. For the source checkout, `npm ci` and `npm run build:codex` in the repository root prepare the bundle; an installed package should already include it.
