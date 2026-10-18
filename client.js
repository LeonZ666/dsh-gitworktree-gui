/**
 * dsh-gitworktree-gui — browser half.
 *
 * A git icon resident in the conversation header's right-hand utilities. It
 * opens a right-Sidebar tab stacked in three bands:
 *
 *   - top: the worktree being viewed — path, branch (or detached HEAD),
 *     ahead/behind, clean / dirty / conflict, and the repository-wide counts;
 *   - middle: the commit topology of the repository, drawn bottom-up (the
 *     oldest commit sits at the bottom and history grows upward), trunk and
 *     branches in two colors, the current branch highlighted;
 *   - bottom: the detail pane for the clicked commit / branch / worktree,
 *     then the other worktrees grouped the way teebe groups them (the viewed
 *     one lives in the top band), the dirty entries of the selected tree, and
 *     its file structure.
 *
 * Everything rides public seats only (`conversation.session.header.utilities`
 * for the trigger, `sidebarRightTabs` + `sidebar.right.pane.tab` for the pane).
 * The pane fills the right column with square corners and a transparent
 * background, so it inherits the Sidebar fill instead of drawing its own
 * floating card. No host package is imported, styling uses theme tokens only,
 * and every registration is failure-isolated so a broken seat can never blank
 * the GUI.
 */
window.__ModuleLoader__.load({
  id: 'dsh-gitworktree-gui',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace. */
    const NS = 'gitWorktreeGui'
    /** Identity in the right-Sidebar tab system; also the body/title seat key. */
    const PLUGIN_ID = 'dsh-gitworktree-gui'
    /** Page kind opened by `ctx.sidebarRight.openTab`. */
    const KIND = 'gitworktree-gui'
    /** Route mirrored from the host half (document-relative on purpose). */
    const STATE_URL = 'api/dsh-gitworktree-gui/state'
    /** Poll cadence while the pane is mounted. */
    const POLL_MS = 5000
    // Shared graph geometry: fixed pitch, readable text, and bounded turns.
    const GRAPH_SPACING = Object.freeze({
      lane: 32, left: 20, labelGutter: 24, labelMin: 200, right: 20,
      row: 60, compactRow: 44, referenceRow: 48,
      top: 26, bottom: 20, referenceTop: 22, selectionBar: 28, bend: 32, bendPerLane: 8,
    })
    /** The git mark from simple-icons (CC0). */
    const GIT_PATH =
      'M23.546 10.93L13.067.452c-.604-.603-1.582-.603-2.188 0L8.708 2.627l2.76 2.76c.645-.215 1.379-.07 1.889.441.516.515.658 1.258.438 1.9l2.658 2.66c.645-.223 1.387-.078 1.9.435.721.72.721 1.884 0 2.604-.719.719-1.881.719-2.6 0-.539-.541-.674-1.337-.404-1.996L12.86 8.955v6.525c.176.086.342.203.488.348.713.721.713 1.883 0 2.6-.719.721-1.889.721-2.609 0-.719-.719-.719-1.879 0-2.598.182-.18.387-.316.605-.406V8.835c-.217-.091-.424-.222-.6-.401-.545-.545-.676-1.342-.396-2.009L7.636 3.7.45 10.881c-.6.605-.6 1.584 0 2.189l10.48 10.477c.604.604 1.582.604 2.186 0l10.43-10.43c.605-.603.605-1.582 0-2.187'

    const zh = {
      'hover.latest': '最新提交',
      'hover.merged': '已合入主干',
      'hover.unmerged': '尚未合入主干',
      'hover.unknown': '合并状态未知',
      'hover.clean': '工作区干净',
      'hover.dirty': '有 {n} 项改动',
      'hover.noTree': '未关联工作树',
      'hover.outside': '提交不在当前历史窗口',
      'detail.open': '查看提交 {sha}',
      'detail.title': '提交详情',
      'detail.close': '关闭提交详情',
      'detail.files': '修改文件',
      'detail.empty': '此提交没有文件变化',
      'detail.loading': '正在读取提交…',
      'detail.diffLoading': '正在读取差异…',
      'detail.retry': '重新读取',
      'detail.diff': '代码差异',
      'detail.binary': '二进制文件，不显示内容',
      'detail.noPatch': '此文件没有可显示的文本差异',
      'detail.truncated': '内容较大，仅显示前一部分',
      'detail.firstParent': '合并提交：与第一个父提交比较',
      'detail.fileLimit': '显示 {shown} / {total} 个文件',

      'meta.title': 'Git 工作树 GUI',
      'meta.description':
        '右侧边栏的 Git 工作树面板：上方为自下而上的分支 / 合并拓扑图，下方为工作树结构、改动记录与文件结构。',
      'fab.title': '工作树拓扑',
      'panel.title': 'Git 工作树',
      'panel.live': '实时 · {s}s',
      'panel.updated': '更新于 {when}',
      'panel.loading': '读取中…',
      'panel.error': '读取失败',
      'panel.empty': '这个仓库没有可显示的分支历史',
      'init.title': '当前工作区还不是 Git 仓库',
      'init.body': '在终端进入该目录后运行：',
      'init.note': '初始化完成后点击下方按钮，或面板右上角的 ⟳ 重新读取。',
      'init.retry': '已初始化，重新读取',
      'action.refresh': '刷新',
      'action.session': '返回会话工作区',
      'graph.outside': '分支顶点在历史窗口之外',
      'graph.limit': '仅显示最近 {n} 个提交',
      'files.limited': '显示 {shown} / {total} 个文件；搜索仅覆盖已加载文件',
      'bar.title': '当前工作树',
      'bar.detached': 'detached @ {sha}',
      'bar.aheadBehind': '↑{ahead} ↓{behind}',
      'bar.clean': 'clean',
      'bar.dirty': 'dirty',
      'bar.conflict': 'conflict',
      'bar.counts': '本地分支 {local} · 远程分支 {remote} · Worktree {worktrees}',
      'detail.worktree': '工作树详情',
      'detail.branch': '分支详情',
      'detail.path': '路径',
      'detail.head': 'HEAD',
      'detail.branchName': '分支',
      'detail.upstream': '上游分支',
      'detail.upstreamNone': '未设置上游分支',
      'detail.track': '领先 / 落后',
      'detail.status': '状态',
      'detail.dirtyTotal': '未提交改动',
      'detail.merged': '已合入主干',
      'detail.unmerged': '未合入主干',
      'detail.unknown': '合并状态未知',
      'detail.currentBranch': '当前分支',
      'detail.trunkBranch': '主干',
      'detail.openWorktree': '查看此工作树',
      'detail.viewCommit': '查看提交',
      'detail.none': '—',
      'detail.missing': '该工作树已不在 worktree 列表中',
      'section.worktrees': 'WORKTREES',
      'section.changes': 'CHANGES',
      'section.files': 'FILES',
      'group.uncommitted': '有未提交改动',
      'group.unmerged': '未合并到主干',
      'group.safe': '工作区干净，已合入主干',
      'group.locked': '已锁定',
      'group.unknown': '状态未知（先别删）',
      'group.other': '其他',
      'panel.stale': '刷新失败 · 数据已过期',
      'graph.sharedTip': '尚无独立提交',
      'graph.select': '选择路径：{name}',
      'graph.selected': '已选中 {name}',
      'graph.clickLine': '点击线条高亮分支路径并查看详情',
      'graph.clear': '清除高亮',
      'graph.merged': '已合并分支 {sha}',
      'group.missing': '目录已不在',
      'badge.main': '主树',
      'badge.current': '当前',
      'badge.detached': '游离 HEAD',
      'badge.bare': 'bare',
      'badge.locked': '已锁定',
      'badge.prunable': '可 prune',
      'dirty.staged': '待提交',
      'dirty.modified': '已修改',
      'dirty.untracked': '未跟踪',
      'dirty.conflicted': '冲突',
      'tree.ahead': '领先',
      'tree.behind': '落后',
      'graph.trunk': '主干',
      'graph.branch': '分支',
      'graph.current': '当前分支',
      'graph.summary': '{commits} 个提交 · {branches} 个分支',
      'graph.hint': '点击提交、分支或工作树节点查看详情',
      'changes.empty': '没有未提交改动',
      'files.empty': '没有可显示的文件',
      'files.search': '搜索文件',
      'file.open': '在侧边栏打开 {path}',
      'files.more': '仅显示前 {n} 个文件，其余未列出',
      'changes.more': '仅显示前 {n} 条改动，其余未列出',
      'banner.stale': '连接中断，显示的是上一次的数据：{message}',
      'banner.error': '读取失败：{message}',
      'divider.title': '拖动调整上下比例',
      'note.statusFailed': '状态读取失败',
      'note.sharedGit': '共享 .git',
      'note.worktrees': '{n} 棵工作树',
      'time.now': '刚刚',
      'time.minutes': '{n} 分钟前',
      'time.hours': '{n} 小时前',
      'time.days': '{n} 天前',
    }

    const en = {
      'hover.latest': 'Latest commit',
      'hover.merged': 'Merged into trunk',
      'hover.unmerged': 'Not merged into trunk',
      'hover.unknown': 'Merge status unknown',
      'hover.clean': 'Clean worktree',
      'hover.dirty': '{n} changes',
      'hover.noTree': 'No linked worktree',
      'hover.outside': 'Commit outside the history window',
      'detail.open': 'View commit {sha}',
      'detail.title': 'Commit details',
      'detail.close': 'Close commit details',
      'detail.files': 'Changed files',
      'detail.empty': 'This commit has no file changes',
      'detail.loading': 'Reading commit…',
      'detail.diffLoading': 'Reading diff…',
      'detail.retry': 'Retry',
      'detail.diff': 'Code diff',
      'detail.binary': 'Binary file; contents are not displayed',
      'detail.noPatch': 'No text diff to display',
      'detail.truncated': 'Large content; showing the first part',
      'detail.firstParent': 'Merge commit: compared with the first parent',
      'detail.fileLimit': 'Showing {shown} / {total} files',

      'meta.title': 'Git Worktree GUI',
      'meta.description':
        'A right-Sidebar git worktree panel: a bottom-up branch and merge topology above, worktree state, changes and file structure below.',
      'fab.title': 'Worktree topology',
      'panel.title': 'Git worktrees',
      'panel.live': 'live · {s}s',
      'panel.updated': 'updated {when}',
      'panel.loading': 'Reading…',
      'panel.error': 'Read failed',
      'panel.empty': 'This repository has no visible history',
      'init.title': 'This workspace is not a Git repository yet',
      'init.body': 'Open a terminal in this directory and run:',
      'init.note': 'When it is done, press the button below or ⟳ in the pane header.',
      'init.retry': 'Initialized — read again',
      'action.refresh': 'Refresh',
      'action.session': 'Return to session workspace',
      'graph.outside': 'Branch tip outside history window',
      'graph.limit': 'Showing the latest {n} commits',
      'files.limited': 'Showing {shown} / {total} files; search covers loaded files only',
      'bar.title': 'Current worktree',
      'bar.detached': 'detached @ {sha}',
      'bar.aheadBehind': '↑{ahead} ↓{behind}',
      'bar.clean': 'clean',
      'bar.dirty': 'dirty',
      'bar.conflict': 'conflict',
      'bar.counts': '{local} local · {remote} remote · {worktrees} worktrees',
      'detail.worktree': 'Worktree details',
      'detail.branch': 'Branch details',
      'detail.path': 'Path',
      'detail.head': 'HEAD',
      'detail.branchName': 'Branch',
      'detail.upstream': 'Upstream',
      'detail.upstreamNone': 'No upstream',
      'detail.track': 'Ahead / behind',
      'detail.status': 'State',
      'detail.dirtyTotal': 'Uncommitted changes',
      'detail.merged': 'Merged into trunk',
      'detail.unmerged': 'Not merged into trunk',
      'detail.unknown': 'Merge state unknown',
      'detail.currentBranch': 'Current branch',
      'detail.trunkBranch': 'Trunk',
      'detail.openWorktree': 'View this worktree',
      'detail.viewCommit': 'View commit',
      'detail.none': '—',
      'detail.missing': 'This worktree is no longer listed',
      'section.worktrees': 'WORKTREES',
      'section.changes': 'CHANGES',
      'section.files': 'FILES',
      'group.uncommitted': 'Uncommitted changes',
      'group.unmerged': 'Not merged',
      'group.safe': 'Clean, merged into trunk',
      'group.locked': 'Locked',
      'group.unknown': 'Unknown state (do not delete yet)',
      'group.other': 'Other',
      'panel.stale': 'Refresh failed · stale data',
      'graph.sharedTip': 'No independent commits',
      'graph.select': 'Select path: {name}',
      'graph.selected': 'Selected {name}',
      'graph.clickLine': 'Click a line to highlight and inspect its branch path',
      'graph.clear': 'Clear highlight',
      'graph.merged': 'Merged branch {sha}',
      'group.missing': 'Directory gone',
      'badge.main': 'main tree',
      'badge.current': 'current',
      'badge.detached': 'detached HEAD',
      'badge.bare': 'bare',
      'badge.locked': 'locked',
      'badge.prunable': 'prunable',
      'dirty.staged': 'staged',
      'dirty.modified': 'modified',
      'dirty.untracked': 'untracked',
      'dirty.conflicted': 'conflicted',
      'tree.ahead': 'ahead',
      'tree.behind': 'behind',
      'graph.trunk': 'trunk',
      'graph.branch': 'branch',
      'graph.current': 'current branch',
      'graph.summary': '{commits} commits · {branches} branches',
      'graph.hint': 'Click a commit, branch or worktree node for details',
      'changes.empty': 'No uncommitted changes',
      'files.empty': 'No files to show',
      'files.search': 'Search files',
      'file.open': 'Open {path} in the sidebar',
      'files.more': 'Showing the first {n} files; the rest are not listed',
      'changes.more': 'Showing the first {n} changes; the rest are not listed',
      'banner.stale': 'Connection lost, showing the last data: {message}',
      'banner.error': 'Read failed: {message}',
      'divider.title': 'Drag to resize',
      'note.statusFailed': 'status unreadable',
      'note.sharedGit': 'shared .git',
      'note.worktrees': '{n} worktrees',
      'time.now': 'just now',
      'time.minutes': '{n}m ago',
      'time.hours': '{n}h ago',
      'time.days': '{n}d ago',
    }

    const CSS = `
:root { --gw-branch:var(--dsw-alias-state-warn-primary, #d98a2b); }
.gw-trigger { appearance:none; border:0; background:transparent; cursor:pointer;
  width:28px; height:28px; border-radius:6px; display:inline-flex; align-items:center;
  justify-content:center; color:var(--dsw-alias-label-secondary); padding:0; }
.gw-trigger:hover { background:transparent; color:var(--dsw-alias-label-primary); }
/* Nothing may paint a tile behind the mark, whatever the header's button skin does. */
.gw-trigger, .gw-trigger:hover, .gw-trigger:focus, .gw-trigger:active { background:transparent !important; }
.gw-trigger.is-open { color:var(--dsw-alias-brand-primary); }
.gw-trigger svg { display:block; }

/* Right-Sidebar tab chip: the git mark plus the pane name, no own fill. */
.gw-tabtitle { display:inline-flex; align-items:center; gap:6px; background:transparent;
  white-space:nowrap; }
.gw-tabtitle svg { display:block; }

.gw-root { position:relative; width:100%; height:100%; min-height:0; display:flex;
  flex-direction:column; background:transparent; color:var(--dsw-alias-label-primary);
  border:0; border-radius:0; box-shadow:none; overflow:hidden; container-type:inline-size;
  font-size:12px; line-height:1.45; }
.gw-head { flex:0 0 auto; display:flex; align-items:center; gap:8px; padding:8px 12px 6px;
  background:transparent; }
.gw-title { min-width:0; max-width:45%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:13px; font-weight:600; letter-spacing:.01em; }
.gw-sub { color:var(--dsw-alias-label-secondary); font-size:11px; opacity:.8;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; flex:1 1 auto; }
.gw-spacer { flex:1 1 auto; }
.gw-head > svg, .gw-head > button { flex-shrink:0; }
/* Top band: the current worktree, always visible above the graph. */
.gw-wtbar { flex:0 0 auto; display:flex; flex-direction:column; gap:3px; padding:0 12px 7px;
  min-width:0; border-bottom:1px solid var(--dsw-alias-border-l2); }
.gw-wtbar-row { display:flex; align-items:center; gap:6px; min-width:0; flex-wrap:wrap; }
.gw-wtbar-label { flex:0 0 auto; font-size:10px; color:var(--dsw-alias-label-secondary); opacity:.75;
  letter-spacing:.04em; }
.gw-wtbar-path { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:10px;
  color:var(--dsw-alias-label-secondary); direction:rtl; text-align:left; }
.gw-wtbar .gw-btn { flex-shrink:0; }
.gw-branchchip { min-width:0; max-width:100%; font-family:ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size:11px; color:var(--dsw-alias-label-primary); border:1px solid var(--dsw-alias-border-l2);
  border-radius:5px; padding:0 6px; line-height:18px; overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; }
.gw-wtstate { flex:0 0 auto; font-size:10px; line-height:18px; padding:0 6px; border-radius:5px;
  border:1px solid currentColor; }
.gw-wtstate.is-clean { color:var(--dsw-alias-state-success-primary); }
.gw-wtstate.is-dirty { color:var(--dsw-alias-state-warn-primary); }
.gw-wtstate.is-conflict { color:var(--dsw-alias-state-error-primary); }
.gw-track { flex:0 0 auto; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:10px;
  color:var(--dsw-alias-label-secondary); white-space:nowrap; }
.gw-wtbar-counts { font-size:10px; color:var(--dsw-alias-label-secondary); opacity:.8; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.gw-limit { padding:5px 12px; font-size:10px; color:var(--dsw-alias-label-secondary); border-bottom:1px solid var(--dsw-alias-border-l2); }
@container (max-width: 420px) {
  .gw-head { flex-wrap:wrap; gap:6px; }
  .gw-title { max-width:calc(100% - 24px); flex:1; }
  .gw-sub { order:5; flex-basis:100%; }
  .gw-spacer { display:none; }
  .gw-live { max-width:36%; overflow:hidden; text-overflow:ellipsis; }
  .gw-legend { right:12px; gap:8px; }
  .gw-legend span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .gw-legend span:last-child { flex:1; }
  .gw-wtbar-row { flex-wrap:wrap; }
  .gw-wtbar-path { flex-basis:100%; order:9; }
}
.gw-live { display:inline-flex; align-items:center; gap:4px; color:var(--dsw-alias-label-secondary);
  font-size:10px; opacity:.85; white-space:nowrap; }
.gw-live-dot { width:5px; height:5px; border-radius:50%; background:var(--dsw-alias-state-success-primary);
  box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-success-primary) 22%, transparent); }
.gw-btn { appearance:none; border:1px solid var(--dsw-alias-border-l2); background:transparent;
  color:var(--dsw-alias-label-secondary); border-radius:6px; padding:2px 8px; font-size:11px;
  cursor:pointer; line-height:18px; white-space:nowrap; }
.gw-btn:hover { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }
.gw-iconbtn { appearance:none; border:0; background:transparent; color:var(--dsw-alias-label-secondary);
  cursor:pointer; width:22px; height:22px; border-radius:5px; font-size:14px; line-height:1;
  display:inline-flex; align-items:center; justify-content:center; padding:0; }
.gw-iconbtn:hover { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }

.gw-body { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; }
.gw-top { flex:0 0 auto; min-height:110px; position:relative; overflow:hidden;
  background:transparent; }
.gw-scroll { position:absolute; inset:0; overflow:auto; padding-top:22px; }
.gw-graph { position:relative; width:100%; min-height:100%; display:flex; align-items:flex-end; }
.gw-graph svg { display:block; max-width:none; flex:none; }
.gw-legend { position:absolute; left:12px; top:7px; z-index:2; display:flex; gap:10px; align-items:center;
  font-size:10px; color:var(--dsw-alias-label-secondary); pointer-events:none; }
.gw-legend span { display:inline-flex; align-items:center; gap:4px; }
.gw-legend i { flex-shrink:0; width:7px; height:2px; border-radius:1px; display:inline-block; }
.gw-legend .is-trunk { background:var(--dsw-alias-brand-primary); }
.gw-legend .is-branch { background:var(--gw-branch); }
.gw-legend .is-current { background:var(--dsw-alias-state-success-primary); }

.gw-edge { fill:none; stroke-linecap:round; pointer-events:none; }
.gw-edge.is-dim { opacity:.2; }
.gw-edge.is-selected { stroke-width:2.8; opacity:.65; }
.gw-segment { cursor:pointer; -webkit-tap-highlight-color:transparent; }
/* SVG focus outlines use the entire path bounds, producing a large rectangle.
   Show keyboard focus on the actual rail instead of the native bounds ring. */
.gw-segment:focus, .gw-segment:focus-visible, .gw-segment:active { outline:none !important; }
.gw-segment:focus-visible .gw-edge, .gw-segment:hover .gw-edge { stroke-width:3; opacity:1; }
.gw-edge-hit { fill:none; stroke:transparent; stroke-width:14; pointer-events:stroke; }
.gw-flow { fill:none; stroke:var(--dsw-alias-label-primary); stroke-width:2.6;
  stroke-linecap:round; stroke-dasharray:3 13; pointer-events:none;
  animation:gw-grow 1.4s linear infinite; }
@keyframes gw-grow { to { stroke-dashoffset:var(--gw-flow-shift,32); } }
@media (prefers-reduced-motion:reduce) { .gw-flow { animation:none; stroke-dasharray:none; opacity:.35; } }
.gw-graph-toolbar { position:absolute; top:0; left:12px; right:12px; display:flex; align-items:center;
  gap:8px; font-size:10px; color:var(--dsw-alias-label-secondary); z-index:1; }
.gw-graph-toolbar span { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gw-selected-node { fill:none; stroke:var(--dsw-alias-label-primary); stroke-width:1.2; }
.gw-node.is-muted-path > circle { opacity:.3; }
.gw-edge.is-trunk { stroke:var(--dsw-alias-brand-primary); stroke-width:1.7; }
.gw-edge.is-branch { stroke:var(--gw-branch); stroke-width:1.7; }
.gw-edge.is-current { stroke:var(--dsw-alias-state-success-primary); stroke-width:1.9; }
.gw-ref-tip { color:var(--gw-branch); }
.gw-ref-tip.is-current { color:var(--dsw-alias-state-success-primary); }
.gw-ref-tip[role="button"] { cursor:pointer; }
.gw-ref-tip:focus-visible { outline:none; }
.gw-ref-tip:focus-visible .gw-refchip rect, .gw-ref-tip:hover .gw-refchip rect {
  stroke:currentColor; fill:color-mix(in srgb, currentColor 20%, transparent); }
.gw-ref-end { fill:var(--dsw-alias-bg-layer-1, Canvas); stroke:currentColor; stroke-width:1.7; }
.gw-node { cursor:default; }
.gw-node.is-pickable { cursor:pointer; }
.gw-commit-hit:focus { outline:none !important; }
.gw-commit-hit:focus-visible { stroke:var(--dsw-alias-brand-primary); stroke-width:1.5; }
.gw-branch-card { position:absolute; z-index:4; pointer-events:none; padding:12px;
  background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l2); border-radius:8px;
  box-shadow:0 6px 24px rgb(0 0 0 / .18); font-size:11px; line-height:1.6; }
.gw-branch-card strong { display:block; overflow-wrap:anywhere; margin-bottom:6px; }
.gw-branch-card p { margin:3px 0; overflow-wrap:anywhere; }
.gw-branch-card small { color:var(--dsw-alias-label-secondary); }
.gw-detail { padding:10px 12px; }
.gw-detail-rows { display:grid; grid-template-columns:auto minmax(0, 1fr); gap:3px 10px; margin:8px 0;
  font-size:11px; }
.gw-detail-rows dt { color:var(--dsw-alias-label-secondary); white-space:nowrap; }
.gw-detail-rows dd { margin:0; overflow-wrap:anywhere; }
.gw-detail-rows dd .gw-chip { margin-right:4px; }
.gw-detail-actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.gw-detail-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px; }
.gw-detail-head strong { font-size:12px; }
.gw-detail-meta { color:var(--dsw-alias-label-secondary); font-size:10px; overflow-wrap:anywhere; }
.gw-detail-message { white-space:pre-wrap; overflow-wrap:anywhere; font:inherit; line-height:1.6; margin:10px 0; }
.gw-detail-files { display:flex; flex-direction:column; max-height:150px; overflow:auto; margin:8px 0 12px; gap:3px; }
.gw-detail-file { background:transparent; color:var(--dsw-alias-label-primary); border:1px solid transparent;
  border-radius:4px; text-align:left; cursor:pointer; padding:5px 6px; overflow-wrap:anywhere; font-size:11px; }
.gw-detail-file[aria-pressed="true"] { border-color:var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-2); }
.gw-detail-file:focus-visible { outline:1px solid var(--dsw-alias-brand-primary); }
.gw-diff { overflow:auto; max-width:100%; margin:8px 0; padding:8px; background:var(--dsw-alias-bg-layer-2);
  border-radius:5px; font:10px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; tab-size:2; }
.gw-diff span { display:block; white-space:pre; min-height:1.6em; }
.gw-diff .is-add { color:var(--dsw-alias-state-success-primary); }
.gw-diff .is-remove { color:var(--dsw-alias-state-error-primary); }
.gw-diff .is-hunk { color:var(--dsw-alias-label-secondary); }

.gw-dot-trunk { fill:var(--dsw-alias-brand-primary); }
.gw-dot-branch { fill:var(--gw-branch); }
.gw-dot-branch.is-current { fill:var(--dsw-alias-state-success-primary); }
.gw-halo { fill:none; stroke:var(--dsw-alias-state-success-primary); stroke-width:1.6; }
.gw-subject { font-size:12px; fill:var(--dsw-alias-label-primary); }
.gw-meta { font-size:10px; fill:var(--dsw-alias-label-secondary); }
.gw-refchip rect { fill:color-mix(in srgb, currentColor 13%, transparent);
  stroke:color-mix(in srgb, currentColor 40%, transparent); stroke-width:1; }
.gw-refchip text { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:9.5px;
  fill:currentColor; }
.gw-refchip.is-branch { color:var(--gw-branch); }
.gw-refchip.is-trunk { color:var(--dsw-alias-brand-primary); }
.gw-refchip.is-current { color:var(--dsw-alias-state-success-primary); }
.gw-refchip.is-tag { color:var(--dsw-alias-label-secondary); }
.gw-headmark, .gw-refmore { fill:var(--dsw-alias-label-secondary); font-size:10px;
  font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }

.gw-divider { flex:0 0 9px; cursor:row-resize; display:flex; align-items:center;
  justify-content:center; border-top:1px solid var(--dsw-alias-border-l2);
  border-bottom:1px solid var(--dsw-alias-border-l2); background:transparent; }
.gw-divider:hover { background:var(--dsw-alias-bg-layer-1); }
.gw-divider i { width:36px; height:2px; border-radius:2px; background:var(--dsw-alias-border-l2);
  display:block; }

.gw-bottom { flex:1 1 auto; min-height:0; overflow:auto; padding:6px 0 14px; }
.gw-sec { border-bottom:1px solid var(--dsw-alias-border-l2); }
.gw-sec:last-child { border-bottom:0; }
.gw-sec-head { display:flex; align-items:center; gap:6px; width:100%; padding:7px 12px 6px;
  background:transparent; border:0; color:var(--dsw-alias-label-secondary); cursor:pointer;
  font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; }
.gw-sec-head:hover { background:var(--dsw-alias-bg-layer-1); }
.gw-sec-title { font-weight:600; }
.gw-count { margin-left:auto; min-width:16px; height:16px; padding:0 5px; border-radius:8px;
  background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary);
  display:inline-flex; align-items:center; justify-content:center; font-size:10px;
  letter-spacing:0; }
.gw-chevron { width:10px; display:inline-block; font-size:9px; opacity:.7; }

.gw-repo { padding:2px 12px 6px; }
.gw-repo-name { font-weight:600; font-size:12px; }
.gw-repo-note { color:var(--dsw-alias-label-secondary); font-size:10.5px; opacity:.8; }
.gw-group { padding:2px 0 4px; }
.gw-group-head { display:flex; align-items:center; gap:6px; padding:4px 12px 3px;
  font-size:11px; color:var(--dsw-alias-label-secondary); }
.gw-group-head .gw-count { margin-left:0; }
.gw-tree { display:flex; gap:8px; padding:6px 12px; cursor:pointer; border-left:2px solid transparent; }
.gw-tree:hover { background:var(--dsw-alias-bg-layer-1); }
.gw-tree.is-selected { background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
  border-left-color:var(--dsw-alias-brand-primary); }
.gw-dot { width:7px; height:7px; border-radius:50%; margin-top:5px; flex:0 0 auto;
  background:var(--dsw-alias-border-l2); }
.gw-dot.is-clean { background:var(--dsw-alias-state-success-primary); }
.gw-dot.is-dirty { background:var(--dsw-alias-state-warn-primary); }
.gw-dot.is-gone { background:var(--dsw-alias-label-secondary); opacity:.5; }
.gw-tree-main { min-width:0; flex:1 1 auto; }
.gw-tree-line { display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; }
.gw-branch { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px;
  word-break:break-all; }
.gw-tree.is-muted .gw-branch { opacity:.72; }
.gw-tree-meta { color:var(--dsw-alias-label-secondary); font-size:10.5px; margin-top:1px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gw-tree-path { color:var(--dsw-alias-label-secondary); opacity:.7; font-size:10px;
  font-family:ui-monospace, SFMono-Regular, Menlo, monospace; margin-top:1px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; direction:rtl; text-align:left; }
.gw-chip { border:1px solid var(--dsw-alias-border-l2); border-radius:5px; padding:0 5px;
  font-size:10px; line-height:15px; color:var(--dsw-alias-label-secondary); white-space:nowrap; }
.gw-chip.is-warn { border-color:var(--dsw-alias-state-warn-primary);
  color:var(--dsw-alias-state-warn-primary); }
.gw-chip.is-err { border-color:var(--dsw-alias-state-error-primary);
  color:var(--dsw-alias-state-error-primary); }
.gw-chip.is-brand { border-color:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-brand-primary); }
.gw-chips { display:flex; flex-wrap:wrap; gap:4px; margin-top:4px; }

.gw-change { display:flex; align-items:center; gap:8px; padding:3px 12px; }
.gw-change.is-openable { cursor:pointer; }
.gw-change:focus-visible { outline:1px solid var(--dsw-alias-brand-primary); outline-offset:-1px; }
.gw-change:hover { background:var(--dsw-alias-bg-layer-1); }
.gw-status { width:16px; flex:0 0 auto; text-align:center; font-family:ui-monospace, Menlo, monospace;
  font-size:10.5px; font-weight:600; border-radius:4px; line-height:15px; }
.gw-status.is-warn { color:var(--dsw-alias-state-warn-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent); }
.gw-status.is-ok { color:var(--dsw-alias-state-success-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent); }
.gw-status.is-err { color:var(--dsw-alias-state-error-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent); }
.gw-status.is-muted { color:var(--dsw-alias-label-secondary);
  background:var(--dsw-alias-bg-layer-2); }
.gw-status.is-brand { color:var(--dsw-alias-brand-primary);
  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); }
.gw-file { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; direction:rtl; text-align:left; }
.gw-empty { padding:8px 12px; color:var(--dsw-alias-label-secondary); font-size:11px; opacity:.75; }

.gw-search { padding:4px 12px 6px; }
.gw-input { width:100%; box-sizing:border-box; background:transparent;
  border:1px solid var(--dsw-alias-border-l2); border-radius:6px; padding:4px 8px;
  font-size:11px; color:var(--dsw-alias-label-primary); }
.gw-input:focus { outline:none; border-color:var(--dsw-alias-brand-primary); }
.gw-files { padding:0 6px 4px; }
.gw-file-row { display:flex; align-items:center; gap:6px; padding:1.5px 6px; border-radius:5px;
  font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11px; cursor:default; }
.gw-file-row:hover { background:var(--dsw-alias-bg-layer-1); }
.gw-file-row.is-openable { cursor:pointer; }
.gw-file-row.is-dir { cursor:pointer; color:var(--dsw-alias-label-secondary); }
.gw-file-row:focus-visible, .gw-tree:focus-visible, .gw-divider:focus-visible, .gw-node:focus-visible { outline:1px solid var(--dsw-alias-brand-primary); outline-offset:-1px; }
.gw-file-row .gw-twist { width:9px; font-size:8px; opacity:.65; flex:0 0 auto; }
.gw-file-row .gw-fname { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gw-file-row .gw-changed { width:5px; height:5px; border-radius:50%; margin-left:auto;
  background:var(--dsw-alias-state-warn-primary); flex:0 0 auto; }
.gw-more { padding:4px 12px; font-size:10px; color:var(--dsw-alias-label-secondary); opacity:.7; }
.gw-banner { padding:8px 12px; font-size:11px; color:var(--dsw-alias-state-warn-primary); }
.gw-banner.is-error { color:var(--dsw-alias-state-error-primary); }

.gw-init { display:flex; flex-direction:column; gap:8px; padding:18px 14px; }
.gw-init-title { font-size:13px; font-weight:600; }
.gw-init-path { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11px;
  color:var(--dsw-alias-label-secondary); word-break:break-all; }
.gw-init-text { font-size:11.5px; color:var(--dsw-alias-label-secondary); line-height:1.6; }
.gw-init-cmd { margin:0; padding:8px 10px; border:1px solid var(--dsw-alias-border-l2);
  border-radius:6px; background:transparent; color:var(--dsw-alias-label-primary);
  font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; }
.gw-init-btn { align-self:flex-start; appearance:none; border:1px solid var(--dsw-alias-border-l2);
  background:transparent; color:var(--dsw-alias-label-secondary); border-radius:6px;
  padding:3px 10px; font-size:11px; cursor:pointer; }
.gw-init-btn:hover { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }
`

    /** Failure-isolated seats must still leave a trace for whoever debugs them. */
    function warn(where, error) {
      try {
        console.warn(`[dsh-gitworktree-gui] ${where}`, error)
      } catch {}
    }

    /** The `dsh-resource://file/session/<id>/<absolute path>` address of a file. */
    function fileAddress(sessionId, absolutePath) {
      const segment = (part) => encodeURIComponent(part).replace(/%3A/gi, ':')
      const normalized = String(absolutePath).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
      return `dsh-resource://file/session/${segment(String(sessionId))}/${normalized.split('/').map(segment).join('/')}`
    }

    /** One repository-relative path resolved against the worktree it belongs to. */
    function absoluteFile(root, path) {
      if (typeof root !== 'string' || root === '') return ''
      if (typeof path !== 'string' || path === '') return ''
      if (path.startsWith('/')) return path
      return `${root.replace(/\\/g, '/').replace(/\/+$/, '')}/${path.replace(/^(?:\.\/)+/, '')}`
    }

    /** The files an untracked directory entry (`dir/`) or a plain path covers. */
    function isChanged(changed, path) {
      if (changed.has(path)) return true
      for (let cut = path.lastIndexOf('/'); cut > 0; cut = path.lastIndexOf('/', cut - 1)) {
        if (changed.has(path.slice(0, cut))) return true
      }
      return false
    }

    /** Translate with a tiny `{name}` interpolation. */
    function makeT(bind) {
      return (key, vars) => {
        let text
        try {
          text = bind(key)
        } catch {
          text = undefined
        }
        if (typeof text !== 'string' || text === '') text = zh[key] ?? key
        if (vars === undefined) return text
        return text.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all))
      }
    }

    /** Relative time; the panel is a Chinese-first surface. */
    function relative(iso, t) {
      if (typeof iso !== 'string' || iso === '') return ''
      const then = Date.parse(iso)
      if (Number.isNaN(then)) return ''
      const delta = Date.now() - then
      if (delta < 60e3) return t('time.now')
      if (delta < 3600e3) return t('time.minutes', { n: Math.floor(delta / 60e3) })
      if (delta < 864e5) return t('time.hours', { n: Math.floor(delta / 3600e3) })
      if (delta < 864e5 * 30) return t('time.days', { n: Math.floor(delta / 864e5) })
      return new Date(then).toLocaleDateString()
    }

    /** One shared empty list, so absent data keeps the memo inputs stable. */
    const NONE = []

    /** Total dirty entries of one tree. */
    function dirtyTotal(tree) {
      const dirty = tree?.dirty
      if (dirty === null || typeof dirty !== 'object') return 0
      return (dirty.staged ?? 0) + (dirty.modified ?? 0) + (dirty.untracked ?? 0) + (dirty.conflicted ?? 0)
    }

    /** The resident git icon in the header's right-hand utilities. */
    function Trigger(props) {
      const label = props.t('fab.title')
      const openTabs = props.openTabs
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      // Selected state: our tab is open in this Session, so the icon takes the
      // accent color. The background stays transparent in every state.
      const readActive = () => {
        try {
          const list = openTabs?.getSnapshot?.()
          if (!Array.isArray(list)) return false
          return list.some(
            (tab) => tab?.kind === KIND && (sessionId === '' || tab?.sessionId === sessionId),
          )
        } catch {
          return false
        }
      }
      const active = React.useSyncExternalStore(
        (notify) => {
          try {
            const off = openTabs?.subscribe?.(notify)
            return typeof off === 'function' ? off : () => {}
          } catch {
            return () => {}
          }
        },
        readActive,
        readActive,
      )
      return h(
        'button',
        {
          type: 'button',
          className: `gw-trigger${active ? ' is-open' : ''}`,
          'data-gw-trigger': 'true',
          title: label,
          'aria-label': label,
          'aria-pressed': active ? 'true' : 'false',
          onClick: () => {
            try {
              props.open()
            } catch {}
          },
        },
        h(
          'svg',
          { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': true, focusable: false },
          h('path', { d: GIT_PATH, fill: 'currentColor' }),
        ),
      )
    }

    /** The tab chip: the git mark plus the pane name, on the chip's own fill. */
    function TabTitle(props) {
      return h(
        'span',
        { className: 'gw-tabtitle' },
        h(
          'svg',
          { viewBox: '0 0 24 24', width: 13, height: 13, 'aria-hidden': true, focusable: false },
          h('path', { d: GIT_PATH, fill: 'currentColor' }),
        ),
        h('span', {}, props.t('panel.title')),
      )
    }

    /** One chip. */
    function chip(key, label, tone) {
      return h('span', { className: `gw-chip${tone ? ` is-${tone}` : ''}`, key }, label)
    }

    /** The dirty breakdown of one tree (no tracking counts). */
    function dirtyChips(t, tree) {
      const dirty = tree.dirty ?? {}
      const chips = []
      if (dirty.staged > 0) chips.push(chip('staged', `${t('dirty.staged')} ${dirty.staged}`, 'warn'))
      if (dirty.modified > 0) chips.push(chip('modified', `${t('dirty.modified')} ${dirty.modified}`, 'warn'))
      if (dirty.untracked > 0) chips.push(chip('untracked', `${t('dirty.untracked')} ${dirty.untracked}`, 'warn'))
      if (dirty.conflicted > 0) chips.push(chip('conflicted', `${t('dirty.conflicted')} ${dirty.conflicted}`, 'err'))
      return chips
    }

    /** The dirty breakdown + ahead/behind of one tree. */
    function treeChips(t, tree) {
      const chips = dirtyChips(t, tree)
      if (tree.ahead > 0) chips.push(chip('ahead', `${t('tree.ahead')} ${tree.ahead}`))
      if (tree.behind > 0) chips.push(chip('behind', `${t('tree.behind')} ${tree.behind}`))
      return chips
    }

    /** clean / dirty / conflict, the three states the top band reports. */
    function treeState(tree) {
      if (tree === undefined) return { label: 'bar.clean', tone: 'clean' }
      if ((tree.dirty?.conflicted ?? 0) > 0) return { label: 'bar.conflict', tone: 'conflict' }
      if (dirtyTotal(tree) > 0 || tree.statusNote === 'status failed') return { label: 'bar.dirty', tone: 'dirty' }
      return { label: 'bar.clean', tone: 'clean' }
    }

    /** One worktree row in the WORKTREES section. */
    function TreeRow(props) {
      const { t, tree, onPick } = props
      const total = dirtyTotal(tree)
      const gone = tree.exists === false || tree.group === 'missing'
      const dot = gone ? 'is-gone' : total > 0 ? 'is-dirty' : 'is-clean'
      const badges = []
      if (tree.isSelected) badges.push(chip('current', t('badge.current'), 'brand'))
      if (tree.isMain) badges.push(chip('main', t('badge.main')))
      if (tree.detached) badges.push(chip('detached', t('badge.detached'), 'warn'))
      if (tree.bare) badges.push(chip('bare', t('badge.bare')))
      if (tree.locked) badges.push(chip('locked', t('badge.locked')))
      if (tree.prunable) badges.push(chip('prunable', t('badge.prunable'), 'warn'))
      if (tree.statusNote === 'status failed') badges.push(chip('note', t('note.statusFailed'), 'err'))
      const activate = () => {
        if (gone) return
        try {
          onPick(tree.path)
        } catch (error) {
          warn('pick worktree', error)
        }
      }
      const when = tree.lastCommit?.date ?? ''
      const meta = [tree.short, relative(when, t), tree.lastCommit?.subject]
        .filter((part) => typeof part === 'string' && part !== '')
        .join(' · ')
      return h(
        'div',
        {
          className: `gw-tree${tree.isSelected ? ' is-selected' : ''}${gone ? ' is-muted' : ''}`,
          title: tree.path,
          role: 'button',
          tabIndex: gone ? -1 : 0,
          'aria-pressed': tree.isSelected ? 'true' : 'false',
          'aria-disabled': gone ? 'true' : undefined,
          onClick: activate,
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              activate()
            }
          },
        },
        h('span', { className: `gw-dot ${dot}` }),
        h(
          'div',
          { className: 'gw-tree-main' },
          h(
            'div',
            { className: 'gw-tree-line' },
            h('span', { className: 'gw-branch' }, tree.branch ?? (tree.detached ? '(detached)' : '(unknown)')),
            badges,
          ),
          h('div', { className: 'gw-tree-meta' }, meta),
          h('div', { className: 'gw-tree-chips' }, h('div', { className: 'gw-chips' }, treeChips(t, tree))),
          h('div', { className: 'gw-tree-path' }, tree.path),
        ),
      )
    }

    /** The bottom-up topology drawing (memoized: redrawn only for new data). */
    // `React.memo` where the host has it: the graph redraws only for new data.
    const memo = typeof React.memo === 'function' ? React.memo : (component) => component
    const Graph = memo(function Graph(props) {
      const { graph, worktrees, onPick, t } = props
      const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
      const wrapRef = React.useRef(null)
      const [room, setRoom] = React.useState(0)
      const [selectedRail, setSelectedRail] = React.useState(null)
      const [hovered, setHovered] = React.useState(null)
      React.useEffect(() => {
        const el = wrapRef.current
        if (el === null || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(() => setRoom(el.clientWidth))
        observer.observe(el)
        setRoom(el.clientWidth)
        return () => observer.disconnect()
      }, [])
      if (nodes.length === 0) {
        return h('div', { className: 'gw-empty', ref: wrapRef }, t('panel.empty'))
      }
      const laneCount = Math.max(1, graph.laneCount ?? 1)
      const rowGap = GRAPH_SPACING.row
      const laneGap = GRAPH_SPACING.lane
      const sharedRails = (graph.rails ?? []).filter(rail => rail.sharedTip || rail.outOfWindow)
      const sharedNames = new Set(sharedRails.map(rail => rail.name))
      const padTop = GRAPH_SPACING.top + GRAPH_SPACING.selectionBar + sharedRails.length * GRAPH_SPACING.referenceRow
      const padBottom = GRAPH_SPACING.bottom
      const labelX = GRAPH_SPACING.left + (laneCount - 1) * laneGap + GRAPH_SPACING.labelGutter
      const width = Math.max(room > 0 ? room : 480, labelX + GRAPH_SPACING.labelMin + GRAPH_SPACING.right)
      const labelRoom = width - labelX - GRAPH_SPACING.right
      const rowY = new Map()
      let nextY = padTop
      for (const node of nodes) {
        rowY.set(node.row, nextY)
        const hasLabels = (node.refs ?? []).some(ref => !sharedNames.has(ref.name))
        nextY += hasLabels ? rowGap : GRAPH_SPACING.compactRow
      }
      const height = Math.max(150, nextY + padBottom)
      const x = (lane) => GRAPH_SPACING.left + lane * laneGap
      const y = (row) => rowY.get(row) ?? padTop
      const connection = (x1, y1, x2, y2, turnAtStart = false) => {
        if (x1 === x2) return `M${x1} ${y1}L${x2} ${y2}`
        const direction = Math.sign(y2 - y1)
        const laneSpan = Math.abs(x2 - x1) / laneGap
        const bend = Math.min(Math.abs(y2 - y1), GRAPH_SPACING.bend + Math.max(0, laneSpan - 1) * GRAPH_SPACING.bendPerLane)
        if (turnAtStart) {
          const end = y1 + direction * bend
          const middle = (y1 + end) / 2
          return `M${x1} ${y1}C${x1} ${middle} ${x2} ${middle} ${x2} ${end}L${x2} ${y2}`
        }
        const start = y2 - direction * bend
        const middle = (start + y2) / 2
        return `M${x1} ${y1}L${x1} ${start}C${x1} ${middle} ${x2} ${middle} ${x2} ${y2}`
      }
      const isWide = (ch) => /[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch)
      const fit = (text, maxPx, unit) => {
        if (typeof text !== 'string') return ''
        const clean = text.replace(/\s+/g, ' ').trim()
        let out = ''
        let used = 0
        for (const ch of clean) {
          const step = isWide(ch) ? unit * 1.8 : unit
          if (used + step > maxPx - 10) return `${out}…`
          out += ch
          used += step
        }
        return out
      }
      const when = (node) => {
        const seconds = typeof node.time === 'number' ? node.time : 0
        return seconds > 0 ? relative(new Date(seconds * 1000).toISOString(), t) : ''
      }
      const bySha = new Map(nodes.map((node) => [node.sha, node]))
      const currentBranch = props.currentBranch ?? ''
      const currentLane = (graph.rails ?? []).find(rail => rail.name === currentBranch)?.lane
      const railByLane = new Map((graph.rails ?? []).map(rail => [rail.lane, rail]))
      const keyOf = lane => lane === 0 ? 'trunk' : `rail:${railByLane.get(lane)?.name ?? lane}`
      const nameOf = lane => {
        if (lane === 0) return `${t('graph.trunk')} ${props.trunkBranch ?? 'main'}`
        const name = railByLane.get(lane)?.name ?? String(lane)
        return name.startsWith('merged:') ? t('graph.merged', { sha: name.slice(7) }) : name
      }
      const inspectWorktree = (path) => {
        if (typeof props.onInspectWorktree === 'function') props.onInspectWorktree(path)
      }
      const inspectBranchName = (name) => {
        if (typeof props.onInspectBranch === 'function' && typeof name === 'string' && name !== '') {
          props.onInspectBranch(name)
        }
      }
      const inspectBranch = (lane) => {
        const name = lane === 0 ? props.trunkBranch : railByLane.get(lane)?.name
        if (typeof name === 'string' && !name.startsWith('merged:')) inspectBranchName(name)
      }
      const trunkTip = (props.branches ?? []).find(branch => branch.isTrunk)?.sha
      const trunkReachable = new Set()
      const queue = trunkTip ? [trunkTip] : []
      while (queue.length) {
        const sha = queue.pop()
        if (trunkReachable.has(sha)) continue
        trunkReachable.add(sha)
        for (const parent of bySha.get(sha)?.parents ?? []) queue.push(parent)
      }
      const branchInfo = lane => {
        const rail = railByLane.get(lane)
        const name = lane === 0 ? props.trunkBranch : rail?.name
        const branch = (props.branches ?? []).find(item => item.name === name)
        const tip = branch?.sha ?? rail?.tip ?? nodes.find(node => node.lane === lane)?.sha
        const latest = bySha.get(tip)
        const tree = (worktrees ?? []).find(tree => tree.branch === name)
        const merged = tree ? tree.merged : name?.startsWith('merged:') || lane === 0 ? true
          : bySha.has(trunkTip) && bySha.has(tip) ? trunkReachable.has(tip) : undefined
        return { name: nameOf(lane), latest, tree, merged }
      }
      const showBranch = (lane, event) => {
        const wrap = wrapRef.current
        if (!wrap) return
        const box = wrap.getBoundingClientRect()
        const visible = wrap.closest('.gw-scroll')?.getBoundingClientRect() ?? box
        const anchor = event.currentTarget.getBoundingClientRect()
        const width = Math.min(280, Math.max(180, visible.width - 24))
        const pointerX = Number.isFinite(event.clientX) ? event.clientX : anchor.right
        const pointerY = Number.isFinite(event.clientY) ? event.clientY : anchor.top
        const left = Math.max(visible.left + 12, Math.min(pointerX + 14, visible.right - width - 12))
        const top = Math.max(visible.top + 12, Math.min(pointerY + 16, visible.bottom - 220))
        setHovered({ lane, left: left - box.left, top: top - box.top, width })
      }
      const hideBranch = () => setHovered(null)
      const activeLanes = new Set([0, ...nodes.map(node => node.lane), ...(graph.rails ?? []).map(rail => rail.lane)])
      const selectedLane = [...activeLanes].find(lane => keyOf(lane) === selectedRail)
      const hasSelection = selectedLane !== undefined
      const edgeLane = (node, target) => node.lane === 0 ? target.lane : node.lane
      const touched = new Set()
      if (hasSelection) for (const node of nodes) {
        for (const parent of node.parentLanes ?? []) {
          const target = bySha.get(parent.sha)
          if (target && edgeLane(node, target) === selectedLane) {
            touched.add(node.sha); touched.add(target.sha)
          }
        }
      }
      const select = lane => setSelectedRail(previous => previous === keyOf(lane) ? null : keyOf(lane))
      const drawEdge = (key, d, lane, current, extra = {}, forward = false) => {
        const selected = lane === selectedLane
        const start = /^M(-?[\d.]+) (-?[\d.]+)/.exec(d)
        return h('g', {
          key: `segment-${key}`, className: 'gw-segment', role: 'button', tabIndex: 0,
          'aria-label': t('graph.select', { name: nameOf(lane) }), 'aria-pressed': selected,
          'data-rail': keyOf(lane), onClick: () => { select(lane); inspectBranch(lane) },
          onPointerEnter: event => showBranch(lane, event), onPointerLeave: hideBranch,
          onFocus: event => showBranch(lane, event), onBlur: hideBranch,
          onKeyDown: event => {
            if (event.key === 'Escape') { event.preventDefault(); setSelectedRail(null) }
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(lane) }
          },
        },
          h('title', {}, t('graph.select', { name: nameOf(lane) })),
          start ? h('rect', { x: Number(start[1]) - 7, y: Number(start[2]) - 7, width: 14, height: 14, fill: 'transparent', pointerEvents: 'none', 'aria-hidden': true }) : null,
          h('path', { key, d, className: `gw-edge ${lane === 0 ? 'is-trunk' : 'is-branch'}${current ? ' is-current' : ''}${selected ? ' is-selected' : hasSelection ? ' is-dim' : ''}`, ...extra }),
          h('path', { key: `hit-${key}`, d, className: 'gw-edge-hit', 'aria-hidden': true }),
          selected ? h('path', { key: `flow-${key}`, d, className: 'gw-flow', style: { '--gw-flow-shift': forward ? '-32' : '32' }, 'aria-hidden': true }) : null,
        )
      }
      const isTip = (node) =>
        (node.refs ?? []).some(
          (ref) => ref.kind === 'head' || (ref.kind === 'branch' && ref.name === currentBranch),
        )
      const refRank = (ref) => {
        if (ref.kind === 'head') return 0
        if (ref.kind === 'branch' && ref.name === currentBranch) return 1
        if (ref.kind === 'branch') return 2
        if (ref.kind === 'tag') return 3
        return 4
      }
      const worktreeByBranch = new Map()
      for (const tree of worktrees ?? []) {
        if (typeof tree.branch === 'string' && !worktreeByBranch.has(tree.branch)) {
          worktreeByBranch.set(tree.branch, tree)
        }
      }
      const parts = []
      // Edges first so nodes sit on top.
      for (const node of nodes) {
        for (const parent of node.parentLanes ?? []) {
          const target = bySha.get(parent.sha)
          if (target === undefined) continue
          const x1 = x(node.lane)
          const y1 = y(node.row)
          const x2 = x(target.lane)
          const y2 = y(target.row)
          // Forks turn at the parent; merges turn at the merge node.
          // The rest stays on its own rail, independent of history length.
          const d = connection(x1, y1, x2, y2, node.isTrunk === true)
          const trunk = node.isTrunk && target.isTrunk
          // Shared ancestry belongs to the trunk, not the current branch rail.
          const current = !trunk && currentLane !== undefined &&
            (node.lane === currentLane || target.lane === currentLane)
          parts.push(drawEdge(`e-${node.sha}-${target.sha}`, d, edgeLane(node, target), current))
        }
      }
      // A reference can move independently even before it has its own commit.
      // Draw an open endpoint above the history; never fabricate a commit node.
      sharedRails.forEach((rail, index) => {
        const anchor = bySha.get(rail.tip)
        if (!anchor && !rail.outOfWindow) return
        const cy = GRAPH_SPACING.referenceTop + GRAPH_SPACING.selectionBar + index * GRAPH_SPACING.referenceRow
        const tipLabel = fit(rail.name, labelRoom - 52, 5.8)
        const chipWidth = Math.max(20, Array.from(tipLabel).reduce((size, ch) => size + (isWide(ch) ? 10.4 : 5.8), 12))
        const note = t(rail.outOfWindow ? 'graph.outside' : 'graph.sharedTip')
        const current = rail.name === currentBranch
        const target = worktreeByBranch.get(rail.name)
        const knownBranch = (props.branches ?? []).some(branch => branch.name === rail.name)
        const inspectRef = target === undefined && knownBranch
        const activate = target
          ? () => { inspectWorktree(target.path); onPick(target.path) }
          : inspectRef ? () => inspectBranchName(rail.name)
            : undefined
        const refPath = anchor
          ? connection(x(anchor.lane), y(anchor.row), x(rail.lane), cy, true)
          : `M${x(rail.lane)} ${cy + 28}L${x(rail.lane)} ${cy}`
        parts.push(drawEdge(`ref-edge-${rail.name}`, refPath, rail.lane, current,
          { strokeDasharray: rail.outOfWindow ? '3 3' : undefined }, true))
        parts.push(h('g', {
          key: `ref-tip-${rail.name}`,
          onPointerEnter: event => showBranch(rail.lane, event), onPointerLeave: hideBranch,
          onFocus: event => showBranch(rail.lane, event), onBlur: hideBranch,
          className: `gw-ref-tip${current ? ' is-current' : ''}`,
          'aria-label': `${rail.name}${current ? ' HEAD' : ''} · ${note}`,
          role: activate === undefined ? 'group' : 'button',
          tabIndex: 0,
          onClick: activate,
          onKeyDown: activate === undefined ? undefined : event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              activate()
            }
          },
        },
        h('title', {}, `${rail.name} · ${note}`),
        h('circle', { className: 'gw-ref-end', cx: x(rail.lane), cy, r: 4 }),
        h('g', { className: `gw-refchip is-${current ? 'current' : 'branch'}` },
          h('rect', { x: labelX, y: cy - 9, width: chipWidth, height: 18, rx: 4 }),
          h('text', { x: labelX + 6, y: cy + 3 }, tipLabel),
        ),
        current ? h('text', { className: 'gw-headmark', x: labelX + chipWidth + 7, y: cy + 3 }, '← HEAD') : null,
        h('text', { className: 'gw-meta', x: labelX, y: cy + 25 }, note),
        ))
      })
      // Nodes, commit subjects and reference chips.
      for (const node of nodes) {
        const cx = x(node.lane)
        const cy = y(node.row)
        const inspectable = typeof props.onCommit === 'function'
        const refs = (node.refs ?? []).filter(ref => !sharedNames.has(ref.name)).sort((a, b) => refRank(a) - refRank(b))
        const subject = fit(node.subject, labelRoom, 6.6)
        const meta = fit(
          [node.short, when(node), node.author]
            .filter((part) => typeof part === 'string' && part !== '')
            .join(' · '),
          labelRoom,
          5.4,
        )
        const names = refs.map((ref) => (ref.kind === 'tag' ? `#${ref.name}` : ref.name))
        const onPickNode = () => { if (inspectable) props.onCommit(node.sha) }
        const children = [
          inspectable ? h('circle', { key: 'commit-hit', className: 'gw-commit-hit', cx, cy, r: 10, fill: 'transparent',
            role: 'button', tabIndex: 0, 'data-commit-sha': node.sha,
            'aria-label': t('detail.open', { sha: node.short ?? node.sha.slice(0, 7) }),
            onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPickNode() } },
          }) : null,
          h('title', { key: 'tip' }, `${node.short} ${node.subject ?? ''}${names.length === 0 ? '' : ` — ${names.join(' · ')}`}`),
          hasSelection && (node.lane === selectedLane || touched.has(node.sha)) ? h('circle', { key: 'selection-halo', className: 'gw-selected-node', cx, cy, r: 8 }) : null,
          isTip(node) ? h('circle', { key: 'halo', className: 'gw-halo', cx, cy, r: 7.5 }) : null,
          h('circle', {
            key: 'dot',
            className: node.isTrunk ? 'gw-dot-trunk' : `gw-dot-branch${node.lane === currentLane ? ' is-current' : ''}`,
            cx,
            cy,
            r: node.parents.length > 1 ? 5 : 4,
          }),
          subject === ''
            ? null
            : h('text', { key: 'subject', className: 'gw-subject', x: labelX, y: cy + 2 }, subject),
        ]
        let chipX = labelX
        let headShown = false
        refs.forEach((ref, index) => {
          if (ref.kind === 'head') {
            headShown = true
            return
          }
          if (index >= 3) return
          const text = ref.kind === 'tag' ? `#${ref.name}` : ref.name
          const tone =
            ref.kind === 'tag' ? 'tag' : ref.name === currentBranch ? 'current' : node.isTrunk ? 'trunk' : 'branch'
          const chipWidth = Math.max(20, text.length * 5.8 + 12)
          if (chipX + chipWidth > labelX + labelRoom) return
          children.push(
            h(
              'g',
              { key: `ref-${index}`, className: `gw-refchip is-${tone}`,
                role: worktreeByBranch.has(ref.name) ? 'button' : 'group', tabIndex: 0,
                'aria-label': ref.name,
                onPointerEnter: event => showBranch((graph.rails ?? []).find(rail => rail.name === ref.name)?.lane ?? node.lane, event),
                onPointerLeave: hideBranch,
                onFocus: event => showBranch((graph.rails ?? []).find(rail => rail.name === ref.name)?.lane ?? node.lane, event), onBlur: hideBranch,
                onClick: event => { event.stopPropagation(); const tree = worktreeByBranch.get(ref.name); if (tree) { inspectWorktree(tree.path); onPick(tree.path) } else inspectBranchName(ref.name) },
                onKeyDown: event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault(); event.stopPropagation()
                    const tree = worktreeByBranch.get(ref.name)
                    if (tree) { inspectWorktree(tree.path); onPick(tree.path) } else inspectBranchName(ref.name)
                  }
                },
              },
              h('rect', { x: chipX, y: cy + 8, width: chipWidth, height: 16, rx: 4 }),
              h('text', { x: chipX + 6, y: cy + 19 }, text),
            ),
          )
          chipX += chipWidth + 5
        })
        if (refs.length > 3) {
          children.push(h('text', { key: 'more', className: 'gw-refmore', x: chipX, y: cy + 19 }, `+${refs.length - 3}`))
          chipX += 22
        }
        if (headShown) {
          children.push(h('text', { key: 'head', className: 'gw-headmark', x: chipX, y: cy + 19 }, '← HEAD'))
        }
        if (meta !== '') {
          children.push(h('text', { key: 'meta', className: 'gw-meta', x: labelX, y: cy + (refs.length > 0 ? 38 : 22) }, meta))
        }
        parts.push(
          h(
            'g',
            {
              key: `n-${node.sha}`,
              className: `gw-node${inspectable ? ' is-pickable' : ''}${hasSelection && node.lane !== selectedLane && !touched.has(node.sha) ? ' is-muted-path' : ''}`,
              onClick: onPickNode,
            },
            children,
          ),
        )
      }
      const info = hovered ? branchInfo(hovered.lane) : null
      const card = info ? h('div', { className: 'gw-branch-card', role: 'tooltip',
        style: { left: hovered.left, top: hovered.top, width: hovered.width } },
        h('strong', {}, info.name),
        info.latest ? h(React.Fragment, {},
          h('p', {}, info.latest.subject),
          h('small', {}, `${info.latest.short} · ${info.latest.author ?? ''} · ${when(info.latest)}`),
        ) : h('p', {}, t('hover.outside')),
        h('p', {}, t(info.merged === true ? 'hover.merged' : info.merged === false ? 'hover.unmerged' : 'hover.unknown')),
        h('p', {}, info.tree ? dirtyTotal(info.tree) > 0 ? t('hover.dirty', { n: dirtyTotal(info.tree) }) : t('hover.clean') : t('hover.noTree')),
      ) : null
      return h(
        'div',
        { className: 'gw-graph', ref: wrapRef },
        card,
        h('div', { className: 'gw-graph-toolbar' },
          h('span', { role: 'status', title: hasSelection ? nameOf(selectedLane) : t('graph.clickLine') },
            hasSelection ? t('graph.selected', { name: nameOf(selectedLane) }) : t('graph.clickLine')),
          hasSelection ? h('button', { type: 'button', className: 'gw-btn', onClick: () => setSelectedRail(null) }, t('graph.clear')) : null,
        ),
        h(
          'svg',
          {
            viewBox: `0 0 ${width} ${height}`,
            width,
            height,
            preserveAspectRatio: 'xMidYMax meet',
            role: 'group',
            'aria-label': t('panel.title'),
          },
          parts,
        ),
      )
    })

    /** Status letter + tone for one dirty entry. */
    function changeBadge(change) {
      const x = typeof change?.x === 'string' ? change.x : ' '
      const y = typeof change?.y === 'string' ? change.y : ' '
      if (y === '?') return { label: '?', tone: 'muted' }
      const pair = `${x}${y}`.replace(/ /g, '')
      if (pair.includes('U') || pair.includes('D')) return { label: pair || 'D', tone: 'err' }
      if (pair.includes('A')) return { label: pair || 'A', tone: 'ok' }
      if (pair.includes('R') || pair.includes('C')) return { label: pair || 'R', tone: 'brand' }
      return { label: pair || '·', tone: 'warn' }
    }

    /** Build a nested tree out of flat paths. */
    function buildFileTree(paths) {
      const root = { name: '', type: 'dir', children: new Map() }
      for (const path of paths) {
        if (typeof path !== 'string' || path === '') continue
        const parts = path.split('/')
        let node = root
        for (let index = 0; index < parts.length; index += 1) {
          const name = parts[index]
          const last = index === parts.length - 1
          let child = node.children.get(name)
          if (child === undefined) {
            child = last
              ? { name, type: 'file', path }
              : { name, type: 'dir', path: parts.slice(0, index + 1).join('/'), children: new Map() }
            node.children.set(name, child)
          }
          node = child
        }
      }
      const sort = (node) => {
        if (node.type !== 'dir') return node
        const children = Array.from(node.children.values())
          .map((child) => sort(child))
          .sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
            return a.name.localeCompare(b.name)
          })
        return { ...node, children }
      }
      return sort(root)
    }

    /** One file/folder row, recursive. */
    function FileNode(props) {
      const { node, depth, collapsed, onToggle, changed, t, onOpen } = props
      if (node.type === 'file') {
        const openable = typeof onOpen === 'function'
        return h(
          'div',
          {
            className: `gw-file-row${openable ? ' is-openable' : ''}`,
            style: { paddingLeft: 6 + depth * 12 },
            title: node.path,
            role: openable ? 'button' : undefined,
            tabIndex: openable ? 0 : undefined,
            'aria-label': openable ? t('file.open', { path: node.path }) : undefined,
            onClick: openable ? () => onOpen(node.path) : undefined,
            onKeyDown: openable ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onOpen(node.path)
              }
            } : undefined,
          },
          h('span', { className: 'gw-twist' }),
          h('span', { className: 'gw-fname' }, node.name),
          isChanged(changed, node.path) ? h('span', { className: 'gw-changed' }) : null,
        )
      }
      const isCollapsed = !props.searching && collapsed.has(node.path)
      return h(
        'div',
        {},
        h(
          'div',
          {
            className: 'gw-file-row is-dir',
            style: { paddingLeft: 6 + depth * 12 },
            onClick: () => onToggle(node.path),
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onToggle(node.path)
              }
            },
            role: 'button',
            tabIndex: 0,
            'aria-expanded': isCollapsed ? 'false' : 'true',
            title: node.path,
          },
          h('span', { className: 'gw-twist' }, isCollapsed ? '▸' : '▾'),
          h('span', { className: 'gw-fname' }, `${node.name}/`),
        ),
        isCollapsed
          ? null
          : node.children.map((child) =>
              h(FileNode, {
                key: child.path,
                node: child,
                depth: depth + 1,
                collapsed,
                onToggle,
                changed,
                searching: props.searching,
                onOpen,
                t,
              }),
            ),
      )
    }

    /** Collapsible section shell. */
    function Section(props) {
      return h(
        'div',
        { className: 'gw-sec' },
        h(
          'button',
          {
            type: 'button',
            className: 'gw-sec-head',
            onClick: props.onToggle,
            'aria-expanded': props.collapsed ? 'false' : 'true',
          },
          h('span', { className: 'gw-chevron' }, props.collapsed ? '▸' : '▾'),
          h('span', { className: 'gw-sec-title' }, props.title),
          props.count === undefined ? null : h('span', { className: 'gw-count' }, String(props.count)),
        ),
        props.collapsed ? null : props.children,
      )
    }

    async function readCommit(query, sha, file, signal) {
      const params = new URLSearchParams(query)
      params.set('commit', sha)
      if (file !== null) params.set('file', file)
      const response = await fetch(`${STATE_URL}?${params}`, { signal, headers: { accept: 'application/json' } })
      const body = await response.json()
      if (!response.ok || body?.ok !== true) throw new Error(body?.error ?? `HTTP ${response.status}`)
      return body
    }

    function CommitDetails({ sha, query, t, onClose }) {
      const [result, setResult] = React.useState({ status: 'loading' })
      const [file, setFile] = React.useState(null)
      const [patch, setPatch] = React.useState({ status: 'idle' })
      const [retry, setRetry] = React.useState(0)
      React.useEffect(() => {
        const controller = new AbortController()
        let alive = true
        setResult({ status: 'loading' }); setFile(null); setPatch({ status: 'idle' })
        readCommit(query, sha, null, controller.signal).then(data => {
          if (!alive) return
          setResult({ status: 'ready', data }); setFile(data.files[0]?.path ?? null)
        }).catch(error => {
          if (alive && error.name !== 'AbortError') setResult({ status: 'error', message: error.message })
        })
        return () => { alive = false; controller.abort() }
      }, [query, sha, retry])
      React.useEffect(() => {
        if (file === null) return undefined
        const controller = new AbortController()
        let alive = true
        setPatch({ status: 'loading' })
        readCommit(query, sha, file, controller.signal).then(data => {
          if (alive) setPatch({ status: 'ready', data })
        }).catch(error => {
          if (alive && error.name !== 'AbortError') setPatch({ status: 'error', message: error.message })
        })
        return () => { alive = false; controller.abort() }
      }, [query, sha, file])
      const data = result.data
      return h('section', { className: 'gw-detail', 'aria-label': t('detail.title') },
        h('div', { className: 'gw-detail-head' }, h('strong', {}, t('detail.title')),
          h('button', { type: 'button', className: 'gw-btn', onClick: onClose }, t('detail.close'))),
        result.status === 'loading' ? h('p', { role: 'status' }, t('detail.loading')) : null,
        result.status === 'error' ? h('div', { role: 'alert' }, result.message,
          h('button', { type: 'button', className: 'gw-btn', onClick: () => setRetry(value => value + 1) }, t('detail.retry'))) : null,
        data ? h(React.Fragment, {},
          h('div', { className: 'gw-detail-meta' }, `${data.sha} · ${data.author} · ${data.date}`),
          h('pre', { className: 'gw-detail-message' }, data.message),
          data.messageTruncated ? h('p', { className: 'gw-detail-meta' }, t('detail.truncated')) : null,
          data.parents.length > 1 ? h('p', { className: 'gw-detail-meta' }, t('detail.firstParent')) : null,
          h('strong', {}, `${t('detail.files')} · ${data.fileCount}`),
          data.files.length === 0 ? h('p', {}, t('detail.empty')) : h('div', { className: 'gw-detail-files' },
            data.files.map(entry => h('button', { key: entry.path, type: 'button', className: 'gw-detail-file',
              'aria-pressed': file === entry.path, onClick: () => setFile(entry.path), title: entry.path }, `${entry.status}  ${entry.path}`))),
          data.filesTruncated ? h('p', { className: 'gw-detail-meta' }, t('detail.fileLimit', { shown: data.files.length, total: data.fileCount })) : null,
          patch.status === 'loading' ? h('p', { role: 'status' }, t('detail.diffLoading')) : null,
          patch.status === 'error' ? h('p', { role: 'alert' }, patch.message) : null,
          patch.data?.binary ? h('p', {}, t('detail.binary')) : null,
          patch.status === 'ready' && !patch.data.binary ? patch.data.patch === '' ? h('p', {}, t('detail.noPatch'))
            : h('pre', { className: 'gw-diff', tabIndex: 0, role: 'region', 'aria-label': t('detail.diff') },
              patch.data.patch.split('\n').map((line, index) => h('span', { key: index,
                className: line.startsWith('@@') ? 'is-hunk' : line.startsWith('+') ? 'is-add' : line.startsWith('-') ? 'is-remove' : undefined }, line || ' '))) : null,
          patch.data?.patchTruncated ? h('p', { className: 'gw-detail-meta' }, t('detail.truncated')) : null,
        ) : null,
      )
    }

    /** Flatten `[label, value]` pairs into `<dt>`/`<dd>` children. */
    function detailRows(entries) {
      const out = []
      entries.forEach(([label, value], index) => {
        out.push(h('dt', { key: `k${index}` }, label))
        out.push(h('dd', { key: `v${index}` }, value))
      })
      return out
    }

    /** Shared frame of the bottom detail pane. */
    function DetailShell(props) {
      return h(
        'section',
        { className: 'gw-detail', 'aria-label': props.title },
        h(
          'div',
          { className: 'gw-detail-head' },
          h('strong', {}, props.title),
          h('button', { type: 'button', className: 'gw-btn', onClick: props.onClose }, props.t('detail.close')),
        ),
        props.children,
      )
    }

    /** A linked worktree: path, branch/detached HEAD, upstream, tracking and dirt. */
    function WorktreeDetails(props) {
      const { t, tree, onClose, onSwitch, onInspectCommit } = props
      if (tree === undefined || tree === null) {
        return h(DetailShell, { t, title: t('detail.worktree'), onClose },
          h('p', { className: 'gw-empty' }, t('detail.missing')))
      }
      const total = dirtyTotal(tree)
      const state = treeState(tree)
      const branch = tree.detached
        ? t('bar.detached', { sha: tree.short ?? (typeof tree.head === 'string' ? tree.head.slice(0, 7) : '') })
        : tree.branch ?? t('detail.none')
      const head = [tree.short, tree.lastCommit?.subject]
        .filter((part) => typeof part === 'string' && part !== '')
        .join(' · ')
      const actions = []
      if (typeof onSwitch === 'function' && tree.isSelected !== true && tree.exists !== false) {
        actions.push(h('button', { key: 'switch', type: 'button', className: 'gw-btn', onClick: () => onSwitch(tree.path) }, t('detail.openWorktree')))
      }
      if (typeof onInspectCommit === 'function' && typeof tree.head === 'string' && tree.head !== '') {
        actions.push(h('button', { key: 'commit', type: 'button', className: 'gw-btn', onClick: () => onInspectCommit(tree.head) }, t('detail.viewCommit')))
      }
      return h(DetailShell, { t, title: t('detail.worktree'), onClose },
        h('dl', { className: 'gw-detail-rows' }, detailRows([
          [t('detail.path'), tree.path],
          [t('detail.branchName'), branch],
          [t('detail.head'), head === '' ? t('detail.none') : head],
          [t('detail.upstream'), tree.upstream ?? t('detail.upstreamNone')],
          [t('detail.track'), t('bar.aheadBehind', { ahead: tree.ahead ?? 0, behind: tree.behind ?? 0 })],
          [t('detail.dirtyTotal'), String(total)],
          [t('detail.status'), [
            h('span', { key: 'state', className: `gw-wtstate is-${state.tone}` }, t(state.label)),
            ...dirtyChips(t, tree),
          ]],
        ])),
        actions.length === 0 ? null : h('div', { className: 'gw-detail-actions' }, actions),
      )
    }

    /** One branch: tip commit, upstream, tracking, linked worktree and merge state. */
    function BranchDetails(props) {
      const { t, branch, tree, node, onClose, onSwitch, onInspectCommit } = props
      if (branch === undefined || branch === null) {
        return h(DetailShell, { t, title: t('detail.branch'), onClose },
          h('p', { className: 'gw-empty' }, t('detail.none')))
      }
      const tip = typeof branch.sha === 'string' ? branch.sha : ''
      const head = node
        ? [node.short, node.subject].filter((part) => typeof part === 'string' && part !== '').join(' · ')
        : tip.slice(0, 7)
      const chips = []
      if (branch.isCurrent) chips.push(h('span', { key: 'current', className: 'gw-chip is-brand' }, t('detail.currentBranch')))
      if (branch.isTrunk) chips.push(h('span', { key: 'trunk', className: 'gw-chip is-brand' }, t('detail.trunkBranch')))
      const merged = tree !== undefined && tree !== null ? tree.merged : branch.isTrunk ? true : undefined
      chips.push(h('span', { key: 'merged', className: `gw-chip${merged === false ? ' is-warn' : ''}` },
        t(merged === true ? 'detail.merged' : merged === false ? 'detail.unmerged' : 'detail.unknown')))
      const actions = []
      if (tree !== undefined && tree !== null && typeof onSwitch === 'function' && tree.isSelected !== true && tree.exists !== false) {
        actions.push(h('button', { key: 'switch', type: 'button', className: 'gw-btn', onClick: () => onSwitch(tree.path) }, t('detail.openWorktree')))
      }
      if (tip !== '' && typeof onInspectCommit === 'function') {
        actions.push(h('button', { key: 'commit', type: 'button', className: 'gw-btn', onClick: () => onInspectCommit(tip) }, t('detail.viewCommit')))
      }
      return h(DetailShell, { t, title: t('detail.branch'), onClose },
        h('dl', { className: 'gw-detail-rows' }, detailRows([
          [t('detail.branchName'), branch.name],
          [t('detail.head'), head === '' ? t('detail.none') : head],
          [t('detail.upstream'), branch.upstream ?? t('detail.upstreamNone')],
          [t('detail.track'), branch.upstream
            ? t('bar.aheadBehind', { ahead: branch.ahead ?? 0, behind: branch.behind ?? 0 })
            : t('detail.none')],
          [t('detail.path'), tree !== undefined && tree !== null ? tree.path : t('detail.none')],
          [t('detail.dirtyTotal'), tree !== undefined && tree !== null ? String(dirtyTotal(tree)) : t('detail.none')],
          [t('detail.status'), chips],
        ])),
        actions.length === 0 ? null : h('div', { className: 'gw-detail-actions' }, actions),
      )
    }

    /** The right-Sidebar pane. */
    function Panel(props) {
      const t = props.t
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      const storeKey = `dsh-gitworktree-gui:cwd:${sessionId === '' ? 'default' : sessionId}`
      const [selectedPath, setSelectedPath] = React.useState(() => {
        try {
          return localStorage.getItem(storeKey) ?? ''
        } catch {
          return ''
        }
      })
      const [state, setState] = React.useState({ status: 'loading' })
      const [nonce, setNonce] = React.useState(0)
      const [split, setSplit] = React.useState(0.42)
      const [collapsed, setCollapsed] = React.useState({ worktrees: false, changes: false, files: false })
      const [dirs, setDirs] = React.useState(() => new Set())
      const [search, setSearch] = React.useState('')
      const [inspection, setInspection] = React.useState(null)
      const detailScope = `${sessionId}:${selectedPath}`
      const bodyRef = React.useRef(null)
      const topRef = React.useRef(null)

      React.useEffect(() => {
        let controller
        let alive = true
        let timer
        let running = false
        let resumePending = false
        // The tag and text of the last payload: a poll that finds nothing new
        // costs a 304 and no render.
        let last = { etag: '', text: '' }
        const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
        const forget = () => {
          try {
            localStorage.removeItem(storeKey)
          } catch {}
          setSelectedPath('')
        }
        setState((previous) => (previous?.data === undefined ? { status: 'loading' } : previous))
        const load = async () => {
          if (!alive || running || !visible()) return
          running = true
          controller = new AbortController()
          try {
            const params = new URLSearchParams()
            if (selectedPath !== '') params.set('cwd', selectedPath)
            else if (sessionId !== '') params.set('session', sessionId)
            const query = params.toString()
            const headers = { accept: 'application/json' }
            if (last.etag !== '') headers['if-none-match'] = last.etag
            const response = await fetch(`${STATE_URL}${query === '' ? '' : `?${query}`}`, {
              signal: controller.signal,
              headers,
            })
            if (!alive) return
            if (response.status === 304) {
              setState((previous) => (previous.status === 'stale' ? { ...previous, status: 'ready' } : previous))
              return
            }
            const body = await response.json()
            if (!alive) return
            if (response.ok && body?.ok === true) {
              const text = JSON.stringify({ ...body, generatedAt: '' })
              last = { etag: response.headers?.get?.('etag') ?? '', text }
              setState((previous) =>
                previous.status === 'ready' && previous.text === text
                  ? previous
                  : { status: 'ready', data: body, text },
              )
              return
            }
            if (body?.code === 'not-a-git-repo') {
              // A remembered worktree that vanished is not "no repository":
              // fall back to the session's own directory first.
              if (selectedPath !== '') {
                forget()
                return
              }
              setState({ status: 'no-repo', data: body })
              return
            }
            // Only a path outside the allowed roots invalidates the remembered
            // selection; a fence refusal is an error to show, not to clear.
            if (response.status === 403 && body?.code === 'outside-roots') {
              forget()
              return
            }
            throw new Error(body?.error ?? `HTTP ${response.status}`)
          } catch (error) {
            if (!alive) return
            if (error?.name === 'AbortError') return
            setState((previous) => ({
              ...(previous.data?.ok === true ? previous : { status: 'error' }),
              status: previous.data?.ok === true ? 'stale' : 'error',
              message: error instanceof Error ? error.message : String(error),
            }))
          } finally {
            running = false
            if (alive && visible()) {
              timer = setTimeout(load, resumePending ? 0 : POLL_MS)
              resumePending = false
            }
          }
        }
        const onVisibility = () => {
          clearTimeout(timer)
          if (!visible()) {
            controller?.abort()
          } else if (running) {
            resumePending = true
          } else {
            load()
          }
        }
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
        load()
        return () => {
          alive = false
          controller?.abort()
          clearTimeout(timer)
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [selectedPath, sessionId, nonce, storeKey])

      const pick = React.useMemo(
        () => (path) => {
          if (typeof path !== 'string' || path === '') return
          try {
            localStorage.setItem(storeKey, path)
          } catch {}
          setSelectedPath(path)
          setNonce((value) => value + 1)
        },
        [storeKey],
      )

      // Inspection is the bottom detail pane; switching the viewer and showing
      // a detail are separate actions, so a graph tip can do both.
      const inspectWorktree = (path) => {
        if (typeof path !== 'string' || path === '') return
        setInspection({ kind: 'worktree', path, scope: `${sessionId}:${path}` })
      }
      const selectWorktree = (path) => {
        inspectWorktree(path)
        pick(path)
      }
      const inspectBranch = (name) => {
        if (typeof name === 'string' && name !== '') setInspection({ kind: 'branch', name, scope: detailScope })
      }
      const inspectCommit = (sha) => {
        if (typeof sha === 'string' && sha !== '') setInspection({ kind: 'commit', sha, scope: detailScope })
      }

      const returnToSession = () => {
        setInspection(null)
        try { localStorage.removeItem(storeKey) } catch {}
        setSelectedPath('')
        setNonce(value => value + 1)
      }

      const startDrag = (event) => {
        event.preventDefault()
        if (bodyRef.current === null) return
        const rect = bodyRef.current.getBoundingClientRect()
        const target = event.currentTarget
        let ratio = split
        // Move the pane's own style while dragging; React hears about it once.
        const move = (moveEvent) => {
          ratio = Math.min(0.75, Math.max(0.18, (moveEvent.clientY - rect.top) / rect.height))
          if (topRef.current !== null) topRef.current.style.flexBasis = `${Math.round(ratio * 100)}%`
        }
        const up = () => {
          target.removeEventListener('pointermove', move)
          target.removeEventListener('pointerup', up)
          target.removeEventListener('pointercancel', up)
          setSplit(ratio)
        }
        try {
          target.setPointerCapture(event.pointerId)
        } catch {}
        target.addEventListener('pointermove', move)
        target.addEventListener('pointerup', up)
        target.addEventListener('pointercancel', up)
      }

      const nudgeSplit = (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        setSplit((value) => Math.min(0.75, Math.max(0.18, value + (event.key === 'ArrowUp' ? -0.04 : 0.04))))
      }

      // Every hook above runs whether or not the panel is visible; the early
      // return must stay BELOW them or React sees a changing hook count.
      const data = state.data
      const worktrees = Array.isArray(data?.worktrees) ? data.worktrees : NONE
      const changes = Array.isArray(data?.changes) ? data.changes : NONE
      const files = Array.isArray(data?.files) ? data.files : NONE
      const branches = Array.isArray(data?.branches) ? data.branches : NONE
      const changedSet = React.useMemo(
        () => new Set(changes.map((change) => String(change.path).replace(/\/$/, ''))),
        [changes],
      )
      const fileTree = React.useMemo(() => buildFileTree(files), [files])
      const filteredTree = React.useMemo(() => {
        if (search.trim() === '') return fileTree
        const needle = search.trim().toLowerCase()
        return buildFileTree(files.filter((path) => path.toLowerCase().includes(needle)))
      }, [fileTree, files, search])

      // Clicking a file opens it in the Sidebar's document preview (one tab per file).
      const openFile = typeof props.openFile === 'function' ? props.openFile : undefined
      const rootPath = typeof data?.repoRoot === 'string' && data.repoRoot !== '' ? data.repoRoot : data?.cwd
      const openPath = openFile === undefined
        ? undefined
        : (path) => {
            const absolute = absoluteFile(rootPath, path)
            if (absolute !== '') openFile(absolute)
          }

      const repoName = (() => {
        const root = typeof data?.repoRoot === 'string' ? data.repoRoot : ''
        const parts = root.split('/').filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : ''
      })()
      const updated = relative(data?.generatedAt, t)
      const graphSummary = t('graph.summary', {
        commits: Array.isArray(data?.graph?.nodes) ? data.graph.nodes.length : 0,
        branches: branches.length,
      })

      // Top band: the worktree being viewed, its state, and the global counts.
      const currentTree = worktrees.find((tree) => tree.isSelected === true) ?? worktrees[0]
      // The viewed worktree lives in the top band, not in the bottom list.
      const otherTrees = worktrees.filter((tree) => tree.path !== currentTree?.path)
      const currentState = treeState(currentTree)
      const currentBranchLabel = currentTree === undefined
        ? (typeof data?.currentBranch === 'string' && data.currentBranch !== '' ? data.currentBranch : t('detail.none'))
        : currentTree.detached
          ? t('bar.detached', { sha: currentTree.short ?? (typeof currentTree.head === 'string' ? currentTree.head.slice(0, 7) : '') })
          : currentTree.branch ?? t('detail.none')
      const currentPath = currentTree?.path ?? data?.cwd ?? selectedPath
      const countsLabel = t('bar.counts', {
        local: branches.length,
        remote: typeof data?.remoteBranchCount === 'number' ? data.remoteBranchCount : 0,
        worktrees: worktrees.length,
      })
      const nodeOf = (sha) => (Array.isArray(data?.graph?.nodes) ? data.graph.nodes : NONE)
        .find((node) => node.sha === sha)
      const branchOf = (name) => branches.find((branch) => branch.name === name)
      const treeOfBranch = (name) => worktrees.find((tree) => tree.branch === name)

      const wtbar = h(
        'div',
        { className: 'gw-wtbar' },
        h(
          'div',
          { className: 'gw-wtbar-row' },
          h('span', { className: 'gw-wtbar-label' }, t('bar.title')),
          h('span', { className: 'gw-wtbar-path', title: currentPath }, currentPath === '' ? t('panel.loading') : currentPath),
          selectedPath !== '' ? h('button', {
            type: 'button', className: 'gw-btn', onClick: returnToSession,
            title: t('action.session'),
          }, t('action.session')) : null,
        ),
        data?.ok === true ? h(
          'div',
          { className: 'gw-wtbar-row' },
          h('span', { className: 'gw-branchchip', title: currentTree?.detached && typeof currentTree.head === 'string' ? currentTree.head : currentBranchLabel }, currentBranchLabel),
          currentTree?.isMain ? h('span', { className: 'gw-chip' }, t('badge.main')) : null,
          h('span', { className: `gw-wtstate is-${currentState.tone}`, title: currentTree?.statusNote ?? '' },
            t(currentState.label)),
          h('span', { className: 'gw-track', title: t('detail.track') },
            t('bar.aheadBehind', { ahead: currentTree?.ahead ?? 0, behind: currentTree?.behind ?? 0 })),
        ) : null,
        data?.ok === true ? h(
          'div',
          { className: 'gw-wtbar-row' },
          currentTree === undefined ? null : dirtyChips(t, currentTree),
          h('span', {
            className: 'gw-wtbar-counts',
            title: countsLabel,
            style: currentTree === undefined || dirtyTotal(currentTree) === 0 ? undefined : { marginLeft: 'auto' },
          }, countsLabel),
        ) : null,
      )

      const groups = [
        { key: 'uncommitted', label: t('group.uncommitted') },
        { key: 'unmerged', label: t('group.unmerged') },
        { key: 'unknown', label: t('group.unknown') },
        { key: 'locked', label: t('group.locked') },
        { key: 'safe', label: t('group.safe') },
        { key: 'missing', label: t('group.missing') },
        { key: 'other', label: t('group.other') },
      ]
      const mainTrees = otherTrees.filter((tree) => tree.group === 'root')
      const grouped = groups
        .map((group) => ({
          ...group,
          trees: otherTrees.filter((tree) => tree.group === group.key),
        }))
        .filter((group) => group.trees.length > 0)

      const refreshLabel = {
        stale: t('panel.stale'),
        error: t('panel.error'),
        loading: t('panel.loading'),
        ready: t('panel.live', { s: Math.round(POLL_MS / 1000) }),
      }[state.status] ?? ''

      const header = h(React.Fragment, {}, h(
        'div',
        { className: 'gw-head' },
        h(
          'svg',
          { viewBox: '0 0 24 24', width: 15, height: 15, 'aria-hidden': true, style: { color: 'var(--dsw-alias-brand-primary)' } },
          h('path', { d: GIT_PATH, fill: 'currentColor' }),
        ),
        h('span', { className: 'gw-title', title: repoName === '' ? t('panel.title') : repoName }, repoName === '' ? t('panel.title') : repoName),
        h('span', { className: 'gw-sub', title: graphSummary }, graphSummary),
        h('span', { className: 'gw-spacer' }),
        h(
          'span',
          { className: 'gw-live', title: state.status === 'stale' ? state.message : updated, role: 'status' },
          state.status === 'ready' ? h('span', { className: 'gw-live-dot' }) : null,
          refreshLabel,
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'gw-iconbtn',
            title: t('action.refresh'),
            'aria-label': t('action.refresh'),
            onClick: () => setNonce((value) => value + 1),
          },
          '⟳',
        ),
      ),
        data !== undefined || selectedPath !== '' ? wtbar : null,
        data?.graph?.truncated ? h('div', { className: 'gw-limit' }, t('graph.limit', { n: data.graph.limit })) : null,
      )

      if (state.status === 'no-repo') {
        const missingPath = typeof state.data?.cwd === 'string' ? state.data.cwd : ''
        return h(
          'div',
          { className: 'gw-root', role: 'region', 'aria-label': t('panel.title') },
          header,
          h(
            'div',
            { className: 'gw-init' },
            h('div', { className: 'gw-init-title' }, t('init.title')),
            missingPath === '' ? null : h('div', { className: 'gw-init-path' }, missingPath),
            h('div', { className: 'gw-init-text' }, t('init.body')),
            h('pre', { className: 'gw-init-cmd' }, 'git init'),
            h('div', { className: 'gw-init-text' }, t('init.note')),
            h(
              'button',
              {
                type: 'button',
                className: 'gw-init-btn',
                onClick: () => setNonce((value) => value + 1),
              },
              t('init.retry'),
            ),
          ),
        )
      }

      const top =
        state.status === 'loading' && data === undefined
          ? h('div', { className: 'gw-empty', style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' } }, t('panel.loading'))
          : state.status === 'error' && data === undefined
            ? h(
                'div',
                { className: 'gw-empty', style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
                `${t('panel.error')}：${state.message ?? ''}`,
              )
            : h(Graph, {
                key: data?.commonDir ?? data?.repoRoot,
                onCommit: inspectCommit,
                onInspectBranch: inspectBranch,
                onInspectWorktree: inspectWorktree,
                graph: data?.graph,
                branches: data?.branches,
                trunkBranch: data?.trunkBranch,
                currentBranch: data?.currentBranch,
                worktrees,
                onPick: pick,
                t,
              })

      const bottomParts = []
      if ((state.status === 'stale' || state.status === 'error') && data !== undefined) {
        bottomParts.push(
          h(
            'div',
            { className: `gw-banner${state.status === 'error' ? ' is-error' : ''}`, key: 'banner', role: 'status' },
            t(state.status === 'stale' ? 'banner.stale' : 'banner.error', { message: state.message ?? '' }),
          ),
        )
      }

      // The viewed worktree is the top band; only the others remain here.
      if (otherTrees.length > 0) {
        bottomParts.push(
          h(
            Section,
            {
              key: 'worktrees',
              title: t('section.worktrees'),
              count: otherTrees.length,
              collapsed: collapsed.worktrees,
              onToggle: () => setCollapsed((value) => ({ ...value, worktrees: !value.worktrees })),
            },
            h(
              'div',
              { className: 'gw-repo' },
              h('div', { className: 'gw-repo-name' }, repoName),
              h(
                'div',
                { className: 'gw-repo-note' },
                `${t('note.worktrees', { n: worktrees.length })} · ${t('note.sharedGit')}`,
              ),
            ),
            mainTrees.map((tree) => h(TreeRow, { key: tree.path, t, tree, onPick: selectWorktree })),
            grouped.map((group) =>
              h(
                'div',
                { className: 'gw-group', key: group.key },
                h(
                  'div',
                  { className: 'gw-group-head' },
                  h('span', {}, group.label),
                  h('span', { className: 'gw-count' }, String(group.trees.length)),
                ),
                group.trees.map((tree) => h(TreeRow, { key: tree.path, t, tree, onPick: selectWorktree })),
              ),
            ),
          ),
        )
      }

      bottomParts.push(
        h(
          Section,
          {
            key: 'changes',
            title: t('section.changes'),
            count: changes.length,
            collapsed: collapsed.changes,
            onToggle: () => setCollapsed((value) => ({ ...value, changes: !value.changes })),
          },
          changes.length === 0
            ? h('div', { className: 'gw-empty' }, t('changes.empty'))
            : changes.map((change, index) => {
                const badge = changeBadge(change)
                const openable = typeof openPath === 'function' && !change.path.endsWith('/')
                return h(
                  'div',
                  {
                    className: `gw-change${openable ? ' is-openable' : ''}`,
                    key: `${index}-${change.path}`,
                    role: openable ? 'button' : undefined,
                    tabIndex: openable ? 0 : undefined,
                    title: openable ? change.path : undefined,
                    'aria-label': openable ? t('file.open', { path: change.path }) : undefined,
                    onClick: openable ? () => openPath(change.path) : undefined,
                    onKeyDown: openable ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openPath(change.path)
                      }
                    } : undefined,
                  },
                  h('span', { className: `gw-status is-${badge.tone}` }, badge.label),
                  h('span', { className: 'gw-file', title: change.path }, change.path),
                )
              }),
          data?.changesTruncated === true
            ? h('div', { className: 'gw-more' }, t('changes.more', { n: changes.length }))
            : null,
        ),
      )

      bottomParts.push(
        h(
          Section,
          {
            key: 'files',
            title: t('section.files'),
            count: data?.fileCount ?? files.length,
            collapsed: collapsed.files,
            onToggle: () => setCollapsed((value) => ({ ...value, files: !value.files })),
          },
          h(
            'div',
            { className: 'gw-search' },
            h('input', {
              className: 'gw-input',
              value: search,
              spellCheck: false,
              placeholder: t('files.search'),
              onChange: (event) => setSearch(event.target.value),
            }),
          ),
          h(
            'div',
            { className: 'gw-files' },
            filteredTree.children.length === 0
              ? h('div', { className: 'gw-empty' }, t('files.empty'))
              : filteredTree.children.map((node) =>
                  h(FileNode, {
                    key: node.path,
                    node,
                    depth: 0,
                    collapsed: dirs,
                    onToggle: (path) =>
                      setDirs((previous) => {
                        const next = new Set(previous)
                        if (next.has(path)) next.delete(path)
                        else next.add(path)
                        return next
                      }),
                    changed: changedSet,
                    searching: search.trim() !== '',
                    onOpen: openPath,
                    t,
                  }),
                ),
          ),
          data?.filesTruncated
            ? h('div', { className: 'gw-more' }, t('files.limited', { shown: files.length, total: data.fileCount }))
            : null,
        ),
      )

      // Bottom detail pane: the clicked node, above the remaining sections.
      const detailQuery = new URLSearchParams(
        selectedPath !== '' ? { cwd: selectedPath } : sessionId !== '' ? { session: sessionId } : {},
      ).toString()
      let detail = null
      if (inspection !== null && inspection.scope === detailScope && data?.ok === true) {
        const close = () => setInspection(null)
        if (inspection.kind === 'commit') {
          detail = h(CommitDetails, {
            key: `${detailScope}:commit:${inspection.sha}`,
            sha: inspection.sha,
            query: detailQuery,
            t,
            onClose: close,
          })
        } else if (inspection.kind === 'worktree') {
          detail = h(WorktreeDetails, {
            key: `worktree:${inspection.path}`,
            t,
            tree: worktrees.find((tree) => tree.path === inspection.path),
            onSwitch: selectWorktree,
            onInspectCommit: inspectCommit,
            onClose: close,
          })
        } else if (inspection.kind === 'branch') {
          const branch = branchOf(inspection.name)
          detail = h(BranchDetails, {
            key: `branch:${inspection.name}`,
            t,
            branch,
            tree: treeOfBranch(inspection.name),
            node: branch === undefined ? undefined : nodeOf(branch.sha),
            onSwitch: selectWorktree,
            onInspectCommit: inspectCommit,
            onClose: close,
          })
        }
      }

      return h(
        'div',
        { className: 'gw-root', role: 'region', 'aria-label': t('panel.title') },
        header,
        h(
          'div',
          { className: 'gw-body', ref: bodyRef },
          h(
            'div',
            { className: 'gw-top', ref: topRef, style: { flexBasis: `${Math.round(split * 100)}%` } },
            h(
              'div',
              { className: 'gw-legend' },
              h('span', { title: `${t('graph.trunk')} ${data?.trunkBranch ?? ''}` }, h('i', { className: 'is-trunk' }), `${t('graph.trunk')} ${data?.trunkBranch ?? ''}`),
              h('span', {}, h('i', { className: 'is-branch' }), t('graph.branch')),
              data?.currentBranch
                ? h(
                    'span',
                    { title: `${t('graph.current')} ${data.currentBranch}` },
                    h('i', { className: 'is-current' }),
                    `${t('graph.current')} ${data.currentBranch}`,
                  )
                : null,
            ),
            h('div', { className: 'gw-scroll' }, top),
          ),
          h(
            'div',
            {
              className: 'gw-divider',
              onPointerDown: startDrag,
              onKeyDown: nudgeSplit,
              role: 'separator',
              'aria-orientation': 'horizontal',
              tabIndex: 0,
              title: t('divider.title'),
            },
            h('i', {}),
          ),
          h('div', { className: 'gw-bottom' }, detail, bottomParts),
        ),
      )
    }

    /** Required browser services. */
    const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs']

    /**
     * Mount the right-Sidebar tab type, its body/title seats, and the header trigger.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      let t = (key) => zh[key] ?? key
      try {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-gitworktree-gui: dictionaries')
        t = makeT(ctx.locale.bind(NS))
      } catch (error) {
        warn('locale', error)
      }

      // The header trigger exists while the pane is closed, so its skin must not
      // live inside the pane component: inject the sheet with the plugin itself.
      try {
        ctx.effect(() => {
          if (typeof document === 'undefined' || document.head === undefined) return () => {}
          const style = document.createElement('style')
          style.setAttribute('data-dsh-gitworktree-gui', 'styles')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => {
            if (typeof style.remove === 'function') style.remove()
          }
        }, 'dsh-gitworktree-gui: styles')
      } catch (error) {
        warn('register', error)
      }

      const open = () => {
        try {
          ctx.sidebarRight.openTab(KIND)
        } catch (error) {
          warn('open tab', error)
        }
      }

      /** Open one absolute file through the Sidebar's resource registry (document preview). */
      const openFile = (sessionId, absolutePath) => {
        if (typeof absolutePath !== 'string' || absolutePath === '') return
        if (typeof ctx.sidebarRight?.openResource !== 'function') return
        try {
          ctx.sidebarRight.openResource(fileAddress(sessionId, absolutePath))
        } catch (error) {
          warn('open file', error)
        }
      }

      try {
        ctx.effect(
          () =>
            ctx.sidebarRightTabs.register({
              id: PLUGIN_ID,
              kind: KIND,
              priority: 'extension',
              title: () => t('panel.title'),
            }),
          'dsh-gitworktree-gui: tab type',
        )
      } catch (error) {
        warn('register', error)
      }

      try {
        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.right.pane.tab', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.right.pane.tab',
                  key: PLUGIN_ID,
                  locale: NS,
                  inject: (sessionId) => ({
                    t,
                    sessionId,
                    openFile: typeof ctx.sidebarRight?.openResource === 'function'
                      ? (absolutePath) => openFile(sessionId, absolutePath)
                      : undefined,
                  }),
                },
                Panel,
              ),
            ),
          'dsh-gitworktree-gui: tab body',
        )
      } catch (error) {
        warn('register', error)
      }

      try {
        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.right.pane.tab.title', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.right.pane.tab.title',
                  key: PLUGIN_ID,
                  locale: NS,
                  inject: () => ({ t }),
                },
                TabTitle,
              ),
            ),
          'dsh-gitworktree-gui: tab title',
        )
      } catch (error) {
        warn('register', error)
      }

      try {
        ctx.effect(
          () =>
            ctx.slots.inject('conversation.session.header.utilities', () =>
              ctx.slots.register(
                {
                  name: 'conversation.session.header.utilities',
                  id: 'gitworktree-gui-open',
                  order: 9,
                  locale: NS,
                  inject: (sessionId) => ({
                    t,
                    sessionId,
                    open,
                    openTabs: ctx.sidebarRight.openTabs,
                  }),
                },
                Trigger,
              ),
            ),
          'dsh-gitworktree-gui: header trigger',
        )
      } catch (error) {
        warn('register', error)
      }
    }

    // `components` is exposed so the render smoke test can mount the pane without
    // going through the app shell; the loader ignores it.
    return { inject, apply, components: { Trigger, Panel, TabTitle, Graph, Section, TreeRow, FileNode, CommitDetails, WorktreeDetails, BranchDetails, DetailShell } }
  },
})
