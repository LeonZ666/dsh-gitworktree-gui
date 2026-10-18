/**
 * git-worktree-gui — Claude plugin.
 *
 * A resident pane that shows the repository the session runs in: the commit
 * topology drawn bottom-up (one SVG drawing on the desktop, text rails on the
 * terminal), the worktrees grouped by whether
 * they are safe to delete, the dirty entries of the selected tree and its
 * file structure. A one-line summary stays in the status line while the pane
 * is closed. The git work is `../lib/core.js`, shared with the DSH plugin.
 *
 * Open or close the pane with `/git-worktrees`; it also opens by itself when
 * the session starts, wherever the surface has room for it.
 *
 * Read-only: git is spawned by argument vector through `$.process.run`.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { collectState } from '../lib/core.js'
import { ago, agoIso, changeBadge, clip, fileRows, graphSvgs, isDirty, paneWidthPx, railRows } from '../lib/glyphs.js'

const PANE = 'git-worktree'
const COMMAND = 'git-worktrees'
const POLL_MS = 5000
/** Tool calls change the tree; refresh after them, at most this often. */
const TOOL_REFRESH_MS = 3000
const GRAPH_STEP = 24
const GIT_TIMEOUT_MS = 8000

const snapshot = atom({ plugin: 'git-worktree-gui', key: 'snapshot' } as const, null)
const selected = atom({ plugin: 'git-worktree-gui', key: 'selected' } as const, '')
const failure = atom({ plugin: 'git-worktree-gui', key: 'error' } as const, '')
const folded = atom({ plugin: 'git-worktree-gui', key: 'folded' } as const, [])
const openDirs = atom({ plugin: 'git-worktree-gui', key: 'openDirs' } as const, [])
const graphRows = atom({ plugin: 'git-worktree-gui', key: 'graphRows' } as const, GRAPH_STEP)

/** What `lib/core.js` runs against, on top of the engine's own process and fs nouns. */
function gitEnv($: EngineInterface) {
  return {
    git: async (cwd: string, args: string[]) => {
      try {
        const done = await $.process.run(['git', '-C', cwd, '--no-optional-locks', ...args], {
          cwd,
          timeoutMs: GIT_TIMEOUT_MS,
        })
        return { ok: done.exitCode === 0, stdout: done.stdout, stderr: done.stderr }
      } catch (error) {
        return { ok: false, stdout: '', stderr: String(error) }
      }
    },
    real: (path: string) => path.replace(/\/+$/, '') || '/',
    exists: async (path: string) => {
      try {
        return await $.fs.exists(path)
      } catch {
        return false
      }
    },
  }
}

const TONE: Record<string, string | undefined> = {
  trunk: 'claude',
  branch: 'warning',
  current: 'success',
  none: undefined,
}

const GROUPS: { key: string; label: string; tone?: string }[] = [
  { key: 'uncommitted', label: '有未提交改动', tone: 'warning' },
  { key: 'unmerged', label: '未合并到主干', tone: 'warning' },
  { key: 'unknown', label: '状态未知（先别删）', tone: 'error' },
  { key: 'locked', label: '已锁定' },
  { key: 'safe', label: '可安全删除', tone: 'success' },
  { key: 'missing', label: '目录已不在', tone: 'inactive' },
  { key: 'other', label: '其他' },
]

/** The Git mark of the header (the plugin's icon). */
const GIT_MARK =
  '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#F05032" d="M23.546 10.93L13.067.452c-.604-.603-1.582-.603-2.188 0L8.708 2.627l2.76 2.76c.645-.215 1.379-.07 1.889.441.516.515.658 1.258.438 1.9l2.658 2.66c.645-.223 1.387-.078 1.9.435.721.72.721 1.884 0 2.604-.719.719-1.881.719-2.6 0-.539-.541-.674-1.337-.404-1.996L12.86 8.955v6.525c.176.086.342.203.488.348.713.721.713 1.883 0 2.6-.719.721-1.889.721-2.609 0-.719-.719-.719-1.879 0-2.598.182-.18.387-.316.605-.406V8.835c-.217-.091-.424-.222-.6-.401-.545-.545-.676-1.342-.396-2.009L7.636 3.7.45 10.881c-.6.605-.6 1.584 0 2.189l10.48 10.477c.604.604 1.582.604 2.186 0l10.43-10.43c.605-.603.605-1.582 0-2.187"/></svg>'

let flight: Promise<void> | undefined
let lastKey = ''
let lastToolRefresh = 0

/** The status-line entry: where HEAD is, how many trees, how many dirty. */
function summary(body: Record<string, any>): string | undefined {
  if (body.ok !== true) return undefined
  const trees: any[] = body.worktrees ?? []
  const dirty = trees.reduce((sum, tree) => sum + (tree.dirtyTotal ?? 0), 0)
  const head = body.currentBranch !== '' ? body.currentBranch : 'detached'
  return `⎇ ${head} · ${trees.length} wt${dirty > 0 ? ` · ${dirty} dirty` : ''}`
}

/** Read the repository again; shared by every caller in flight, quiet when nothing changed. */
function refresh($: EngineInterface, isForced = false): Promise<void> {
  if (flight !== undefined) return flight
  flight = (async () => {
    try {
      const env = gitEnv($)
      const home = await $.session.cwd()
      const picked = await read($, selected)
      let body = await collectState(env, picked !== '' ? picked : home)
      // A remembered worktree that is gone is not "no repository": fall back.
      if (body.ok !== true && body.code === 'not-a-git-repo' && picked !== '') {
        await update($, selected, () => '')
        body = await collectState(env, home)
      }
      const key = JSON.stringify({ ...body, generatedAt: '' })
      if (isForced || key !== lastKey) {
        lastKey = key
        await update($, snapshot, () => body)
      }
      await update($, failure, () =>
        body.ok === true || body.code === 'not-a-git-repo' ? '' : String(body.error ?? 'read failed'),
      )
      $.ui.status(summary(body))
    } catch (error) {
      await update($, failure, () => (error instanceof Error ? error.message : String(error)))
    } finally {
      flight = undefined
    }
  })()
  return flight
}

async function isOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show or hide the Git worktree pane',
    })
    $.clock.every(POLL_MS, async () => {
      if (await isOpen($)) await refresh($)
    })
    void refresh($, true)
    void $.ui.open({ id: PANE, title: 'Git worktrees' })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    if (await isOpen($)) {
      await $.ui.close({ id: PANE })

      return { text: 'Git worktree pane closed.' }
    }
    await $.ui.open({ id: PANE, title: 'Git worktrees' })
    await refresh($, true)

    return { text: 'Git worktree pane opened.' }
  }).catch(() => ({ text: 'Could not toggle the Git worktree pane.' }))

  // Tools edit files, commit and switch branches: keep the status line honest
  // even while the pane is closed.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const now = await $.clock.now()
    if (now - lastToolRefresh > TOOL_REFRESH_MS) {
      lastToolRefresh = now
      void refresh($)
    }

    return ran
  }).catch(($, e, next) => next(e))


  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // The surfaces that draw vector images (the desktop) get the graph as one
    // drawing at fixed pixel geometry, like the DSH panel; the terminal keeps
    // text rails.
    // (The resolved table is completed with every element name, a missing one
    // drawing a fragment, so the surface decides, not the presence of `Svg`.)
    const Svg = e.surface === 'terminal' ? undefined : ($.ui.resolve(e) as { Svg?: any }).Svg
    const isGraphic = Svg !== undefined
    const gap = isGraphic ? 'xs' : 1
    const snap = await read($, snapshot)
    const problem = await read($, failure)
    const hidden = new Set(await read($, folded))
    const open = new Set(await read($, openDirs))
    const shown = await read($, graphRows)

    const toggle = (id: string) => () =>
      update($, folded, list => (list.includes(id) ? list.filter(one => one !== id) : [...list, id]))

    /** A bordered tag on a graphical surface, `[label]` on the terminal. */
    const Chip = (label: string, tone?: string) =>
      isGraphic ? (
        <Box borderStyle="round" borderColor={tone ?? 'inactive'} paddingX="xs">
          <Text color={tone} dimColor={tone === undefined} size="caption">
            {label}
          </Text>
        </Box>
      ) : (
        <Text color={tone} dimColor={tone === undefined}>{`[${label}]`}</Text>
      )

    const Section = (id: string, title: string, count: number | undefined, body: unknown) => (
      <Box flexDirection="column" marginTop={1}>
        <Button key={`section-${id}`} plain label={`${title}${count === undefined ? '' : ` ${count}`}`} onPress={toggle(id)}>
          <Text dimColor>{hidden.has(id) ? '▸ ' : '▾ '}</Text>
          <Text weight="semibold" size="footnote">
            {title}
          </Text>
          {count === undefined ? null : <Text dimColor size="footnote">{`  ${count}`}</Text>}
        </Button>
        {hidden.has(id) ? null : body}
      </Box>
    )

    const repoName = snap?.repoRoot ? String(snap.repoRoot).split('/').filter(Boolean).pop() : 'Git worktrees'
    const head = (
      <Box flexDirection="row" alignItems="center" columnGap={gap}>
        {isGraphic ? <Svg source={GIT_MARK} alt="Git" width={16} height={16} /> : <Text color="claude">⎇</Text>}
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          <Text weight="semibold" wrap="truncate-end">
            {repoName}
          </Text>
          {snap?.ok === true ? (
            <Text dimColor size="caption" wrap="wrap">
              {`${snap.graph.nodes.length} 个提交 · ${snap.branches.length} 个分支 · 主干 ${snap.trunkBranch || '?'}`}
            </Text>
          ) : null}
        </Box>
        <Button key="refresh" plain label="↻" onPress={() => refresh($, true)} />
      </Box>
    )

    if (snap === null) {
      return (
        <Box flexDirection="column">
          {head}
          <Text dimColor>{problem === '' ? 'Reading…' : `Read failed: ${problem}`}</Text>
        </Box>
      )
    }

    if (snap.ok !== true) {
      return (
        <Box flexDirection="column">
          {head}
          <Text bold>当前工作区还不是 Git 仓库</Text>
          <Text dimColor>{String(snap.cwd ?? '')}</Text>
          <Text>在这个目录运行：git init，然后点 ↻ refresh。</Text>
        </Box>
      )
    }

    const nodes: any[] = snap.graph.nodes
    const lanes: number = snap.graph.laneCount
    const currentBranch: string = snap.currentBranch ?? ''
    const pick = (path: string) => async () => {
      await update($, selected, () => path)
      await refresh($, true)
    }

    // ---- topology (newest on top; history grows upward from the oldest at the bottom)
    const legend = (
      <Text size="caption">
        <Text color={TONE.trunk}>━ </Text>
        <Text dimColor>主干  </Text>
        <Text color={TONE.branch}>━ </Text>
        <Text dimColor>分支  </Text>
        <Text color={TONE.current}>━ </Text>
        <Text dimColor>当前分支</Text>
      </Text>
    )
    const limited =
      snap.graph.truncated === true ? (
        <Text dimColor>{`仅显示最近 ${snap.graph.limit} 个提交`}</Text>
      ) : null
    const more =
      nodes.length > shown ? (
        <Button
          key="more-graph"
          plain
          label={`… ${nodes.length - shown} older commits`}
          onPress={() => update($, graphRows, count => count + GRAPH_STEP)}
        />
      ) : null
    let graphBody: unknown
    if (nodes.length === 0) {
      graphBody = <Text dimColor>这个仓库没有可显示的分支历史</Text>
    } else if (isGraphic) {
      const drawing = graphSvgs(nodes, lanes, {
        width: paneWidthPx(e.props.bodyColumns ?? e.viewport?.columns),
        currentBranch,
        rows: shown,
      })
      const newest = nodes[0]
      const alt = `提交图：${nodes.length} 个提交，最新 ${newest.short} ${newest.subject}`
      graphBody = (
        <Box flexDirection="column">
          {drawing.parts.map((part, index) => (
            <Svg source={part.source} alt={index === 0 ? alt : '提交图（续）'} />
          ))}
          {more}
          {limited}
        </Box>
      )
    } else {
      const rails = railRows(nodes, lanes)
      graphBody = (
        <Box flexDirection="column">
          {legend}
          {nodes.slice(0, shown).map((node, index) => {
            const marks = (node.refs as any[]).filter(ref => ref.kind !== 'head')
            const isHead = (node.refs as any[]).some(ref => ref.kind === 'head')
            const label = marks.map(ref => (ref.kind === 'tag' ? `#${ref.name}` : ref.name)).join(' ')
            const when = ago(node.time)
            return (
              <Box height={1} overflow="hidden">
                <Text>
                  {rails[index].map(run => (
                    <Text color={TONE[run.tone]}>{run.text}</Text>
                  ))}
                </Text>
                {label === '' ? null : <Text color="warning" wrap="truncate-end">{` ${clip(label, 16)}`}</Text>}
                <Box flexGrow={1} flexShrink={1} minWidth={0}>
                  <Text color={node.isCurrent ? 'success' : undefined} wrap="truncate-end">{` ${node.subject}`}</Text>
                </Box>
                {isHead ? <Text dimColor>{' ←'}</Text> : null}
                <Text dimColor wrap="truncate-end">{` ${when === '' ? node.short : when}`}</Text>
              </Box>
            )
          })}
          {more}
          {limited}
        </Box>
      )
    }

    // ---- worktrees
    const treeRow = (tree: any) => {
      const gone = tree.exists === false || tree.group === 'missing'
      const total = tree.dirtyTotal ?? 0
      const badges: [string, string | undefined][] = []
      if (tree.isSelected) badges.push(['当前', 'claude'])
      if (tree.isMain) badges.push(['主树', undefined])
      if (tree.detached) badges.push(['游离 HEAD', 'warning'])
      if (tree.bare) badges.push(['bare', undefined])
      if (tree.locked) badges.push(['已锁定', undefined])
      if (tree.prunable) badges.push(['可 prune', 'warning'])
      if (tree.statusNote === 'status failed') badges.push(['状态读取失败', 'error'])
      const counts: [string, string | undefined][] = []
      if (tree.dirty.staged > 0) counts.push([`待提交 ${tree.dirty.staged}`, 'warning'])
      if (tree.dirty.modified > 0) counts.push([`已修改 ${tree.dirty.modified}`, 'warning'])
      if (tree.dirty.untracked > 0) counts.push([`未跟踪 ${tree.dirty.untracked}`, 'warning'])
      if (tree.dirty.conflicted > 0) counts.push([`冲突 ${tree.dirty.conflicted}`, 'error'])
      if (tree.ahead > 0) counts.push([`领先 ${tree.ahead}`, undefined])
      if (tree.behind > 0) counts.push([`落后 ${tree.behind}`, undefined])
      const meta = [tree.short, agoIso(tree.lastCommit?.date), tree.lastCommit?.subject]
        .filter(part => typeof part === 'string' && part !== '')
        .join(' · ')
      const name = tree.branch ?? (tree.detached ? '(detached)' : '(unknown)')
      return (
        <Box flexDirection="column" marginTop={1} paddingLeft={1}>
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={gap}>
            <Button key={`tree-${tree.path}`} plain label={name} onPress={gone ? () => undefined : pick(tree.path)}>
              <Text color={gone ? 'inactive' : total > 0 ? 'warning' : 'success'}>{'● '}</Text>
              <Text mono weight="semibold" color={tree.isSelected ? 'claude' : undefined} dimColor={gone}>
                {name}
              </Text>
            </Button>
            {badges.map(([label, tone]) => Chip(label, tone))}
          </Box>
          {meta === '' ? null : (
            <Text dimColor size="footnote" wrap="wrap">
              {meta}
            </Text>
          )}
          {counts.length > 0 ? (
            <Box flexDirection="row" flexWrap="wrap" columnGap={gap}>
              {counts.map(([label, tone]) => Chip(label, tone))}
            </Box>
          ) : null}
          <Text dimColor mono size="caption" wrap="truncate-start">
            {tree.path}
          </Text>
        </Box>
      )
    }

    const trees: any[] = snap.worktrees
    const worktreeBody = (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={gap}>
          <Text weight="semibold">{repoName}</Text>
          <Text dimColor size="caption">{`${trees.length} 棵工作树 · 共享 .git`}</Text>
        </Box>
        {trees.filter(tree => tree.group === 'root').map(treeRow)}
        {GROUPS.map(group => {
          const list = trees.filter(tree => tree.group === group.key)
          if (list.length === 0) return null
          return (
            <Box flexDirection="column" marginTop={1}>
              <Box flexDirection="row" alignItems="center" columnGap={gap}>
                <Text color={group.tone} size="footnote" weight="medium">
                  {group.label}
                </Text>
                {Chip(String(list.length))}
              </Box>
              {list.map(treeRow)}
            </Box>
          )
        })}
      </Box>
    )

    // ---- changes
    const changes: any[] = snap.changes
    const changesBody =
      changes.length === 0 ? (
        <Text dimColor>没有未提交改动</Text>
      ) : (
        <Box flexDirection="column">
          {changes.map(change => {
            const badge = changeBadge(change)
            const letters = badge.label.length === 1 ? ` ${badge.label} ` : badge.label.slice(0, 3).padEnd(3)
            return (
              <Box flexDirection="row" alignItems="center" columnGap={gap}>
                {isGraphic ? (
                  // A filled badge: a Box carries the padding, which a graphical
                  // surface would trim off a Text's own spaces.
                  <Box backgroundColor={badge.tone} paddingX="xs">
                    <Text color="inverseText" mono weight="semibold" size="caption">
                      {badge.label}
                    </Text>
                  </Box>
                ) : (
                  <Text backgroundColor={badge.tone} color="inverseText" bold>
                    {letters}
                  </Text>
                )}
                <Box flexGrow={1} flexShrink={1} minWidth={0}>
                  <Text mono size="footnote" wrap="truncate-start">
                    {String(change.path)}
                  </Text>
                </Box>
              </Box>
            )
          })}
          {snap.changesTruncated === true ? <Text dimColor>{`仅显示前 ${changes.length} 条改动，其余未列出`}</Text> : null}
        </Box>
      )

    // ---- files
    const dirty = new Set<string>(changes.map(change => String(change.path).replace(/\/$/, '')))
    const rows = fileRows(snap.files as string[], open)
    const filesBody = (
      <Box flexDirection="column">
        {rows.length === 0 ? <Text dimColor>没有可显示的文件</Text> : null}
        {rows.map(row =>
          row.isDir ? (
            <Box paddingLeft={row.depth * 2}>
              <Button
                key={`dir-${row.path}`}
                plain
                label={`${row.name}/`}
                onPress={() =>
                  update($, openDirs, list => (list.includes(row.path) ? list.filter(one => one !== row.path) : [...list, row.path]))
                }
              >
                <Text dimColor>{row.isOpen ? '▾ ' : '▸ '}</Text>
                <Text mono size="footnote" dimColor>{`${row.name}/`}</Text>
              </Button>
            </Box>
          ) : (
            <Box paddingLeft={row.depth * 2 + 2} flexDirection="row" columnGap={gap}>
              <Text mono size="footnote" color={isDirty(dirty, row.path) ? 'warning' : undefined} wrap="truncate-end">
                {row.name}
              </Text>
              {isDirty(dirty, row.path) ? <Text color="warning">●</Text> : null}
            </Box>
          ),
        )}
        {snap.filesTruncated === true ? <Text dimColor>{`仅显示前 ${snap.maxFiles} 个文件，其余未列出`}</Text> : null}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {head}
        {problem === '' ? null : <Text color="error">{`连接异常，显示的是上一次的数据：${problem}`}</Text>}
        {Section('graph', 'GRAPH', nodes.length, graphBody)}
        {Section('worktrees', 'WORKTREES', trees.length, worktreeBody)}
        {Section('changes', 'CHANGES', changes.length, changesBody)}
        {Section('files', 'FILES', snap.fileCount, filesBody)}
      </Box>
    )
  })
}
