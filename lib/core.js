/**
 * dsh-gitworktree-gui — shared core.
 *
 * Everything that turns a repository into the panel payload, with no Node
 * import and no I/O of its own: the host half (`index.js`, execFile) and the
 * Claude plugin (`hooks/register.tsx`, `$.process.run`) both hand in an `env`:
 *
 *   env.git(cwd, args)  -> Promise<{ ok, stdout, stderr }>   one git spawn
 *   env.exists(path)    -> Promise<boolean>                  does the directory exist
 *   env.real(path)      -> string                            canonical path (identity is fine)
 *
 * The functions here never write and never run a shell.
 */

/** Commits included in the topology (the newest N of every branch). */
export const MAX_COMMITS = 120
/** Files included in the file tree (keeps the payload bounded). */
export const MAX_FILES = 700
/** Dirty entries included in the CHANGES list. */
export const MAX_CHANGES = 500
/** Concurrent git spawns for one payload. */
const CONCURRENCY = 6

/** Directories that are never part of the product tree, at any depth. */
const NOISE_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.local', '.dsh', '.git'])

/** Process-local rail memory, bounded: lanes survive new commits and new branch names. */
const laneRegistries = new Map()
const MAX_REMEMBERED_REPOS = 64
const MAX_REMEMBERED_RAILS = 2048
/** Running graph reads, shared by every worktree of one repository. */
const pendingGraphs = new Map()

function registryFor(key) {
  let registry = laneRegistries.get(key)
  if (!registry) registry = new Map()
  laneRegistries.delete(key)
  laneRegistries.set(key, registry)
  if (laneRegistries.size > MAX_REMEMBERED_REPOS) laneRegistries.delete(laneRegistries.keys().next().value)
  return registry
}

/** Share only work that is running; failures and finished results are never cached. */
export async function singleFlight(pending, key, task) {
  if (pending.has(key)) return pending.get(key)
  const promise = task()
  pending.set(key, promise)
  try {
    return await promise
  } finally {
    pending.delete(key)
  }
}

/** Map `items` through `fn` with at most `limit` in flight; keeps order. */
export async function pmap(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next
      next += 1
      out[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** Branch name from a ref (`refs/heads/x` -> `x`). */
export function shortRef(ref) {
  if (typeof ref !== 'string') return undefined
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
}

/**
 * Parse `git worktree list --porcelain` into records.
 * @param text - porcelain output.
 * @returns one record per registered tree.
 */
export function parseWorktrees(text) {
  const trees = []
  let current
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line === '') {
      if (current !== undefined) trees.push(current)
      current = undefined
      continue
    }
    if (line.startsWith('worktree ')) {
      if (current !== undefined) trees.push(current)
      current = { path: line.slice('worktree '.length).trim() }
      continue
    }
    if (current === undefined) continue
    if (line.startsWith('HEAD ')) current.head = line.slice(5).trim()
    else if (line.startsWith('branch ')) current.ref = line.slice(7).trim()
    else if (line === 'bare') current.bare = true
    else if (line === 'detached') current.detached = true
    else if (line.startsWith('prunable')) current.prunable = line.slice(8).trim() || 'prunable'
    else if (line.startsWith('locked')) current.locked = line.slice(6).trim() || 'locked'
  }
  if (current !== undefined) trees.push(current)
  return trees
}

/**
 * Parse `git status --porcelain=v2 --branch` counts.
 * @param text - status output.
 * @returns branch facts and the dirty counts.
 */
export function parseStatus(text) {
  const out = {
    branch: undefined,
    head: undefined,
    detached: false,
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicted: 0,
  }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line === '') continue
    if (line.startsWith('# branch.head ')) {
      const value = line.slice('# branch.head '.length).trim()
      out.branch = value === '(detached)' ? undefined : value
      out.detached = value === '(detached)'
      continue
    }
    if (line.startsWith('# branch.oid ')) {
      const value = line.slice('# branch.oid '.length).trim()
      out.head = value === '(initial)' ? undefined : value
      continue
    }
    if (line.startsWith('# branch.ab ')) {
      const match = /\+(\d+)\s+-(\d+)/.exec(line)
      if (match !== null) {
        out.ahead = Number(match[1])
        out.behind = Number(match[2])
      }
      continue
    }
    const kind = line[0]
    if (kind === '1' || kind === '2') {
      const xy = line.slice(2, 4)
      if (xy[0] !== '.' && xy[0] !== ' ') out.staged += 1
      if (xy[1] !== '.' && xy[1] !== ' ') out.modified += 1
    } else if (kind === 'u') {
      out.conflicted += 1
    } else if (kind === '?') {
      out.untracked += 1
    }
  }
  return out
}

/**
 * Parse `git status --porcelain -z` into dirty entries for the CHANGES list.
 * @param text - NUL-separated porcelain output.
 * @param limit - keep at most this many entries.
 * @returns the entries and whether the list was cut.
 */
export function parseChanges(text, limit = MAX_CHANGES) {
  const parts = text.split('\0')
  const entries = []
  let truncated = false
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index]
    if (typeof entry !== 'string' || entry.length < 4) continue
    const x = entry[0]
    const y = entry[1]
    const path = entry.slice(3)
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') index += 1 // the original path follows as its own field
    if (entries.length >= limit) {
      truncated = true
      break
    }
    entries.push({ x, y, path })
  }
  return { entries, truncated }
}

/**
 * Parse decorated `git log` output.
 * @param text - one record per line, US-separated fields.
 * @param localBranches - names of local branches, for decoration kinds.
 * @returns commits in the emitted (newest-first) order.
 */
export function parseLog(text, localBranches) {
  const commits = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line === '') continue
    const fields = line.split('\x1f')
    const sha = fields[0]
    if (typeof sha !== 'string' || sha === '') continue
    const parents = typeof fields[1] === 'string' && fields[1] !== '' ? fields[1].split(' ') : []
    const refs = []
    for (const decoration of (fields[5] ?? '').split(',')) {
      const item = decoration.trim()
      if (item === '' || item === 'refs/stash') continue
      if (item.startsWith('HEAD -> ')) {
        const name = item.slice(8)
        refs.push({ kind: 'head', name })
        if (localBranches.has(name)) refs.push({ kind: 'branch', name })
      } else if (item === 'HEAD') refs.push({ kind: 'head', name: 'HEAD' })
      else if (item.startsWith('tag: ')) refs.push({ kind: 'tag', name: item.slice(5) })
      else if (localBranches.has(item)) refs.push({ kind: 'branch', name: item })
      else refs.push({ kind: 'remote', name: item })
    }
    const seen = new Set()
    const uniqueRefs = refs.filter((ref) => {
      const key = `${ref.kind}:${ref.name}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    commits.push({
      sha,
      parents,
      author: (fields[2] ?? '').slice(0, 60),
      time: Number(fields[3]) || 0,
      subject: (fields[4] ?? '').slice(0, 160),
      refs: uniqueRefs,
    })
  }
  return commits
}

/**
 * Branch-rail layout: lane 0 is the trunk (a straight vertical line), every
 * other lane is one branch growing to its right. A parent keeps its branch's
 * lane, so trunk-to-trunk edges stay vertical.
 *
 * @param commits - newest-first records with `sha` and `parents`.
 * @param laneOf - sha -> lane.
 * @returns rows carrying `lane` + `parentLanes`, and the lane count.
 */
export function layoutGraph(commits, laneOf) {
  const rows = commits.map((commit, row) => {
    const lane = laneOf.get(commit.sha) ?? 0
    const parentLanes = commit.parents.map((sha) => ({ sha, lane: laneOf.get(sha) ?? lane }))
    return { row, lane, sha: commit.sha, parentLanes }
  })
  let laneCount = 1
  for (const row of rows) {
    laneCount = Math.max(laneCount, row.lane + 1)
    for (const parent of row.parentLanes) laneCount = Math.max(laneCount, parent.lane + 1)
  }
  return { rows, laneCount }
}

/** First-parent chain (newest first) of a revision, bounded like the graph window. */
async function firstParentChain(env, cwd, revision) {
  if (typeof revision !== 'string' || revision === '') return []
  const result = await env.git(cwd, ['rev-list', '--first-parent', '-n', String(MAX_COMMITS), revision])
  if (!result.ok) return []
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/**
 * Assign the trunk rail and one rail per branch.
 *
 * A branch with no commit of its own still gets a rail (`sharedTip`), so a
 * moving reference is visible before it has history; a branch whose tip is
 * older than the window is flagged `outOfWindow`. Rail numbers are remembered
 * per repository (`registry`), so existing rails do not shuffle.
 *
 * @param env - git environment.
 * @param cwd - repository directory.
 * @param commits - parsed log rows, newest first.
 * @param branches - local branches `{ name, sha }`.
 * @param trunkBranch - branch whose first-parent chain is the trunk, if any.
 * @param trunkRev - revision to walk for the trunk (a branch ref or a sha).
 * @param registry - remembered `name -> lane` for this repository.
 * @returns lane map, rail metadata, and the lane count.
 */
/** Compact historical rails and reduce crossings near forks/merges.
 * Commit rows remain Git topological order. The score estimates intersections
 * between a lane-changing edge and a third rail at its turn; it is not a
 * guarantee of a globally planar drawing. Keep the previous order on ties.
 */
export function orderRails(commits, laneOf, rails) {
  const rowOf = new Map(commits.map((commit, row) => [commit.sha, row]))
  const history = rails.filter(rail => !rail.sharedTip && !rail.outOfWindow)
  const references = rails.filter(rail => rail.sharedTip || rail.outOfWindow).sort((a, b) => a.lane - b.lane)
  const spans = new Map(history.map(rail => [rail.lane, { first: Infinity, last: -Infinity }]))
  const edges = []
  const extend = (lane, row) => {
    const span = spans.get(lane)
    if (span) { span.first = Math.min(span.first, row); span.last = Math.max(span.last, row) }
  }
  for (let row = 0; row < commits.length; row++) {
    const lane = laneOf.get(commits[row].sha) ?? 0
    extend(lane, row)
    for (const parent of commits[row].parents) {
      if (!rowOf.has(parent)) continue
      const parentRow = rowOf.get(parent)
      const parentLane = laneOf.get(parent) ?? 0
      extend(lane, parentRow)
      extend(parentLane, row)
      if (lane !== parentLane) edges.push({ from: lane, to: parentLane, turn: lane === 0 ? row + 0.25 : parentRow - 0.25, boundary: lane === 0 ? row : parentRow, atStart: lane === 0 })
    }
  }
  const score = order => {
    const position = new Map([[0, 0], ...order.map((rail, index) => [rail.lane, index + 1])])
    let crossings = 0
    for (const edge of edges) {
      const a = position.get(edge.from), b = position.get(edge.to)
      if (a === undefined || b === undefined) continue
      for (const rail of order) {
        const p = position.get(rail.lane), span = spans.get(rail.lane)
        // Curves meeting the same fork/merge are a junction, not a crossing.
        if (span[edge.atStart ? 'first' : 'last'] === edge.boundary) continue
        if (p > Math.min(a, b) && p < Math.max(a, b) && span.first < edge.turn && edge.turn < span.last) crossings++
      }
    }
    return crossings
  }
  const previous = [...history].sort((a, b) => a.lane - b.lane)
  let order = [...previous].sort((a, b) => spans.get(b.lane).first - spans.get(a.lane).first || a.lane - b.lane)
  const before = score(previous)
  if (score(order) >= before) order = previous
  let best = score(order)
  // Bounded work: visible commits cap historical rail count; no random search.
  for (let pass = 0; pass < 6; pass++) {
    let improved = false
    for (let i = 0; i + 1 < order.length; i++) {
      [order[i], order[i + 1]] = [order[i + 1], order[i]]
      const candidate = score(order)
      if (candidate < best) { best = candidate; improved = true }
      else [order[i], order[i + 1]] = [order[i + 1], order[i]]
    }
    if (!improved) break
  }
  const all = [...order, ...references]
  const remap = new Map([[0, 0], ...all.map((rail, index) => [rail.lane, index + 1])])
  for (const [sha, lane] of laneOf) laneOf.set(sha, remap.get(lane) ?? 0)
  return {
    rails: all.map(rail => ({ ...rail, lane: remap.get(rail.lane) })),
    laneOf, laneCount: all.length + 1, crossings: best, previousCrossings: before,
  }
}

export async function assignLanes(env, cwd, commits, branches, trunkBranch, trunkRev, registry = new Map()) {
  const rowOf = new Map(commits.map((commit, index) => [commit.sha, index]))
  const laneOf = new Map()
  const others = branches.filter((branch) => branch.name !== trunkBranch)
  // Every first-parent walk is independent: run them side by side.
  const [trunkChain, ...otherChains] = await pmap(
    [trunkRev, ...others.map((branch) => `refs/heads/${branch.name}`)],
    CONCURRENCY,
    (revision) => firstParentChain(env, cwd, revision),
  )
  for (const sha of trunkChain) if (rowOf.has(sha)) laneOf.set(sha, 0)

  const plans = others.map((branch, index) => {
    const unique = otherChains[index].filter((sha) => rowOf.has(sha) && !laneOf.has(sha))
    let lastRow = unique.length === 0 ? (rowOf.get(branch.sha) ?? -1) : 0
    for (const sha of unique) lastRow = Math.max(lastRow, rowOf.get(sha) ?? 0)
    return { name: branch.name, unique, lastRow, tip: branch.sha }
  })
  // Older forks keep the rails closest to the trunk; newer branches grow further right.
  plans.sort((left, right) => right.lastRow - left.lastRow)

  // Forget stale names only once the memory reaches its budget.
  if (registry.size >= MAX_REMEMBERED_RAILS) {
    const active = new Set([
      ...plans.map((plan) => plan.name),
      ...commits.flatMap((commit) => commit.parents.slice(1).map((parent) => `merged:${parent.slice(0, 7)}`)),
    ])
    for (const name of registry.keys()) if (!active.has(name)) registry.delete(name)
  }
  const used = new Set(registry.values())
  const allocate = (name) => {
    if (registry.has(name)) return registry.get(name)
    let lane = 1
    while (used.has(lane)) lane += 1
    used.add(lane)
    if (registry.size < MAX_REMEMBERED_RAILS) registry.set(name, lane)
    return lane
  }

  // A stale ref already contained in the trunk is a label, not a new fork.
  // Keep refs at the current trunk tip: Git alone cannot distinguish a fresh
  // branch from one just fast-forwarded into the trunk at that exact commit.
  const trunkTip = trunkChain[0]
  const contained = new Set(await pmap(plans, CONCURRENCY, async plan => {
    if (!trunkTip || plan.tip === trunkTip) return undefined
    if (trunkChain.includes(plan.tip)) return plan.name
    const result = await env.git(cwd, ['merge-base', '--is-ancestor', plan.tip, trunkRev])
    return result.ok ? plan.name : undefined
  }))
  const rails = []
  for (const plan of plans) {
    const placed = plan.unique.filter((sha) => !laneOf.has(sha))
    if (placed.length === 0 && contained.has(plan.name)) continue
    const lane = allocate(plan.name)
    for (const sha of placed) laneOf.set(sha, lane)
    rails.push({
      name: plan.name,
      lane,
      tip: plan.tip,
      sharedTip: placed.length === 0,
      outOfWindow: !rowOf.has(plan.tip),
    })
  }

  // A merged branch whose ref is gone still needs a rail: walk each merge's
  // non-first parent until it joins something already placed.
  for (const commit of commits) {
    for (let index = 1; index < commit.parents.length; index += 1) {
      const parent = commit.parents[index]
      if (!rowOf.has(parent) || laneOf.has(parent)) continue
      const unique = (await firstParentChain(env, cwd, parent)).filter(
        (sha) => rowOf.has(sha) && !laneOf.has(sha),
      )
      if (unique.length === 0) continue
      const name = `merged:${parent.slice(0, 7)}`
      const lane = allocate(name)
      for (const sha of unique) laneOf.set(sha, lane)
      rails.push({ name, lane })
    }
  }

  // Whatever no branch owns (a detached HEAD's history, tags) shares one rail
  // of its own instead of being painted as trunk.
  const orphans = commits.filter((commit) => !laneOf.has(commit.sha))
  if (orphans.length > 0) {
    const lane = allocate('other')
    for (const commit of orphans) laneOf.set(commit.sha, lane)
    rails.push({ name: 'other', lane })
  }
  const ordered = orderRails(commits, laneOf, rails)
  const active = new Set(ordered.rails.map(rail => rail.name))
  for (const name of registry.keys()) if (!active.has(name)) registry.delete(name)
  for (const rail of ordered.rails) {
    if (registry.has(rail.name) || registry.size < MAX_REMEMBERED_RAILS) registry.set(rail.name, rail.lane)
  }
  return ordered
}

/** The repository trunk: `origin/HEAD`, then main/master; undefined when neither exists. */
export async function detectTrunk(env, cwd) {
  const head = await env.git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (head.ok) {
    const name = head.stdout.trim().replace(/^origin\//, '')
    if (name !== '') {
      const local = await env.git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])
      if (local.ok) return name
    }
  }
  for (const candidate of ['main', 'master']) {
    const ref = await env.git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`])
    if (ref.ok) return candidate
  }
  return undefined
}

/** Every local branch tip. */
async function listBranches(env, cwd) {
  const result = await env.git(cwd, [
    'for-each-ref',
    '--format=%(refname:lstrip=2) %(objectname)',
    'refs/heads',
  ])
  if (!result.ok) return []
  const out = []
  for (const line of result.stdout.split('\n')) {
    if (line === '') continue
    const cut = line.lastIndexOf(' ')
    if (cut <= 0) continue
    out.push({ name: line.slice(0, cut), sha: line.slice(cut + 1) })
  }
  return out
}

/**
 * The history half of the topology: identical for every worktree of one
 * repository, so concurrent callers share one read. HEAD is per-worktree and
 * is attached afterwards by `collectGraph`.
 */
async function collectGraphHistory(env, cwd, repoKey, records) {
  const [branches, trunkName] = await Promise.all([listBranches(env, cwd), detectTrunk(env, cwd)])
  const first = records[0]
  const trunkBranch = trunkName ?? shortRef(first?.ref)
  const trunkRev =
    trunkBranch !== undefined && branches.some((branch) => branch.name === trunkBranch)
      ? `refs/heads/${trunkBranch}`
      : first?.head
  const localBranches = new Set(branches.map((branch) => branch.name))
  // Local branches, tags and the detached HEADs of the worktrees: `--all` would
  // drag in refs/stash (merge-shaped WIP commits) and remote-only history.
  const detached = [...new Set(records.filter((record) => record.detached === true && record.head).map((record) => record.head))]
  const log = await env.git(cwd, [
    'log',
    '--branches',
    '--tags',
    ...detached,
    '--topo-order',
    `--max-count=${MAX_COMMITS + 1}`,
    '--pretty=format:%H%x1f%P%x1f%an%x1f%at%x1f%s%x1f%D',
  ])
  if (!log.ok) throw new Error('git log failed')
  const parsed = parseLog(log.stdout, localBranches)
  const truncated = parsed.length > MAX_COMMITS
  const commits = parsed.slice(0, MAX_COMMITS)
  const { laneOf, rails, laneCount: railCount } = await assignLanes(
    env,
    cwd,
    commits,
    branches,
    trunkBranch,
    trunkRev ?? '',
    registryFor(repoKey),
  )
  const { rows, laneCount } = layoutGraph(commits, laneOf)
  const nodes = rows.map((layout) => {
    const commit = commits[layout.row]
    return {
      sha: commit.sha,
      short: commit.sha.slice(0, 7),
      parents: commit.parents,
      parentLanes: layout.parentLanes,
      row: layout.row,
      lane: layout.lane,
      subject: commit.subject,
      author: commit.author,
      time: commit.time,
      refs: commit.refs.filter((ref) => ref.kind !== 'head'),
      isTrunk: layout.lane === 0,
    }
  })
  return {
    nodes,
    laneCount: Math.max(laneCount, railCount),
    rails,
    truncated,
    limit: MAX_COMMITS,
    trunkBranch: trunkBranch ?? '',
    trunkRev,
    branches,
  }
}

/**
 * Build the topology payload for one worktree of a repository.
 * @param env - git environment.
 * @param cwd - a directory inside the repository.
 * @param repoKey - the repository's common git dir, the key history is shared under.
 * @param records - the worktree records.
 * @returns the nodes, rails and the worktree's own HEAD / current-branch marks.
 */
export async function collectGraph(env, cwd, repoKey, records) {
  const history = await singleFlight(pendingGraphs, repoKey, () =>
    collectGraphHistory(env, cwd, repoKey, records),
  )
  const currentResult = await env.git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const currentBranch =
    currentResult.ok && currentResult.stdout.trim() !== 'HEAD' ? currentResult.stdout.trim() : ''

  // "Current" is the current branch's own work: what it has that the trunk
  // does not, plus its tip. On the trunk itself only the tip stands out.
  let currentTip = history.branches.find((branch) => branch.name === currentBranch)?.sha
  if (currentTip === undefined) {
    const head = await env.git(cwd, ['rev-parse', '--verify', 'HEAD'])
    if (head.ok) currentTip = head.stdout.trim()
  }
  let currentSet = new Set()
  if (currentBranch !== '' && currentBranch !== history.trunkBranch) {
    const args = ['rev-list', '-n', String(MAX_COMMITS * 2), `refs/heads/${currentBranch}`]
    if (history.trunkRev !== undefined) args.push('--not', history.trunkRev)
    const result = await env.git(cwd, args)
    if (result.ok) currentSet = new Set(result.stdout.split('\n').filter((line) => line !== ''))
  }
  return {
    ...history,
    currentBranch,
    nodes: history.nodes.map((node) => ({
      ...node,
      isCurrent: currentSet.has(node.sha) || node.sha === currentTip,
      refs:
        node.sha === currentTip
          ? [...node.refs, { kind: 'head', name: currentBranch || 'HEAD' }]
          : node.refs,
    })),
    branches: history.branches.map((branch) => ({
      ...branch,
      isCurrent: branch.name === currentBranch,
      isTrunk: branch.name === history.trunkBranch,
    })),
  }
}

/** The dirty file list of one tree. */
export async function collectChanges(env, cwd) {
  const result = await env.git(cwd, ['status', '--porcelain', '-z'])
  if (!result.ok) throw new Error('git status failed while reading changes')
  return parseChanges(result.stdout)
}

/** Tracked + untracked (not ignored) files that still exist, minus build noise. */
export async function collectFiles(env, cwd) {
  const [listed, deleted] = await Promise.all([
    env.git(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
    env.git(cwd, ['ls-files', '-z', '--deleted']),
  ])
  if (!listed.ok) throw new Error('git ls-files failed')
  const gone = new Set(deleted.ok ? deleted.stdout.split('\0') : [])
  const seen = new Set()
  const files = []
  let total = 0
  for (const path of listed.stdout.split('\0')) {
    if (path === '' || seen.has(path) || gone.has(path)) continue
    seen.add(path)
    const dirs = path.split('/').slice(0, -1)
    if (dirs.some((segment) => NOISE_DIRS.has(segment))) continue
    total += 1
    if (files.length < MAX_FILES) files.push(path)
  }
  return { files, total, truncated: total > MAX_FILES }
}

/**
 * Commits of `target` that the trunk does not have, patch-equivalent ones
 * (a rebase merge) not counted. `null` when git could not answer.
 */
export async function unmergedCount(env, cwd, trunkRef, target) {
  if (typeof target !== 'string' || target === '' || typeof trunkRef !== 'string') return null
  const result = await env.git(cwd, ['cherry', trunkRef, target])
  if (!result.ok) return null
  return result.stdout.split('\n').filter((line) => line.startsWith('+')).length
}

/**
 * Resolve the repository that contains `cwd`.
 * @returns the toplevel and common dir, or undefined outside a work tree.
 */
export async function resolveRepo(env, cwd) {
  const [top, common] = await Promise.all([
    env.git(cwd, ['rev-parse', '--show-toplevel']),
    env.git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
  ])
  const commonDir = common.ok && common.stdout.trim() !== '' ? common.stdout.trim() : undefined
  if (top.ok && top.stdout.trim() !== '') {
    return { repoRoot: env.real(top.stdout.trim()), commonDir }
  }
  // A linked worktree whose toplevel is gone still answers through its .git file.
  if (commonDir === undefined) return undefined
  return { repoRoot: env.real(cwd), commonDir }
}

/** Fill one worktree record with status, history and its group. */
async function describeTree(env, record, repo, trunkBranch) {
  const path = env.real(record.path)
  const exists = await env.exists(record.path)
  const tree = {
    path,
    exists,
    branch: shortRef(record.ref),
    head: record.head,
    short: typeof record.head === 'string' ? record.head.slice(0, 7) : '',
    detached: record.detached === true,
    bare: record.bare === true,
    prunable: record.prunable,
    locked: record.locked,
    // Compare with the toplevel, not the raw cwd: a session in a subdirectory
    // still belongs to the tree that contains it.
    isSelected: path === repo.repoRoot,
    isMain: false,
    dirty: { staged: 0, modified: 0, untracked: 0, conflicted: 0 },
    dirtyTotal: 0,
    ahead: 0,
    behind: 0,
    lastCommit: undefined,
    group: 'other',
    unmerged: 0,
    merged: true,
    statusNote: undefined,
  }
  if (record.bare === true) {
    tree.statusNote = 'bare'
    return tree
  }
  if (!exists) {
    tree.statusNote = 'missing'
    tree.group = 'missing'
    return tree
  }
  const [status, last] = await Promise.all([
    env.git(record.path, ['status', '--porcelain=v2', '--branch']),
    env.git(record.path, ['log', '-1', '--format=%h%x1f%cI%x1f%s']),
  ])
  if (status.ok) {
    const parsed = parseStatus(status.stdout)
    tree.branch = parsed.branch ?? tree.branch
    tree.head = parsed.head ?? tree.head
    tree.detached = parsed.detached === true
    tree.ahead = parsed.ahead
    tree.behind = parsed.behind
    tree.dirty = {
      staged: parsed.staged,
      modified: parsed.modified,
      untracked: parsed.untracked,
      conflicted: parsed.conflicted,
    }
  } else {
    // The tree on screen must not be reported as clean when git cannot say.
    if (tree.isSelected) throw new Error('git status failed')
    tree.statusNote = 'status failed'
  }
  if (last.ok) {
    const parts = (last.stdout.split('\n')[0] ?? '').split('\x1f')
    if (parts.length >= 3) {
      tree.lastCommit = { hash: parts[0], date: parts[1], subject: parts[2].slice(0, 200) }
    }
  }
  tree.dirtyTotal =
    tree.dirty.staged + tree.dirty.modified + tree.dirty.untracked + tree.dirty.conflicted

  // Grouping answers "is it safe to delete?", so every doubt lands in
  // `unknown`, never in `safe`.
  if (tree.prunable !== undefined) {
    tree.group = 'missing'
    return tree
  }
  if (trunkBranch !== '' && tree.branch === trunkBranch) {
    tree.group = 'root'
    return tree
  }
  if (!status.ok) {
    tree.group = 'unknown'
    return tree
  }
  if (tree.dirtyTotal > 0) {
    tree.group = 'uncommitted'
    return tree
  }
  const target = tree.branch !== undefined ? `refs/heads/${tree.branch}` : tree.head
  const count =
    trunkBranch === ''
      ? null
      : await unmergedCount(env, record.path, `refs/heads/${trunkBranch}`, target)
  if (count === null) {
    tree.group = 'unknown'
    return tree
  }
  tree.unmerged = count
  tree.merged = count === 0
  if (count > 0) tree.group = 'unmerged'
  else if (tree.locked !== undefined) tree.group = 'locked'
  else tree.group = 'safe'
  return tree
}

/**
 * Collect the whole panel payload for one directory.
 * @param env - git environment.
 * @param cwd - absolute directory, already vetted by the caller.
 * @returns the response body (`ok: false` for a non-repository).
 */
export async function collectState(env, cwd) {
  const repo = await resolveRepo(env, cwd)
  if (repo === undefined) {
    return { ok: false, code: 'not-a-git-repo', cwd, error: 'not a git repository', hint: 'git init' }
  }
  const listing = await env.git(cwd, ['worktree', 'list', '--porcelain'])
  if (!listing.ok) return { ok: false, cwd, error: 'git worktree list failed' }
  const records = parseWorktrees(listing.stdout)
  const repoKey = repo.commonDir ?? repo.repoRoot
  const graph = await collectGraph(env, cwd, repoKey, records)
  const trees = await pmap(records, CONCURRENCY, (record) =>
    describeTree(env, record, repo, graph.trunkBranch),
  )
  if (trees.length > 0) trees[0].isMain = true
  const selected = trees.find((tree) => tree.isSelected) ?? trees[0]
  const usable = selected !== undefined && selected.exists && selected.group !== 'other'
  const [changes, listed] = usable
    ? await Promise.all([collectChanges(env, selected.path), collectFiles(env, selected.path)])
    : [{ entries: [], truncated: false }, { files: [], total: 0, truncated: false }]
  return {
    ok: true,
    cwd,
    repoRoot: repo.repoRoot,
    commonDir: repo.commonDir,
    generatedAt: new Date().toISOString(),
    trunkBranch: graph.trunkBranch,
    currentBranch: graph.currentBranch,
    worktrees: trees,
    graph: {
      nodes: graph.nodes,
      laneCount: graph.laneCount,
      rails: graph.rails,
      truncated: graph.truncated,
      limit: graph.limit,
    },
    branches: graph.branches,
    changes: changes.entries,
    changesTruncated: changes.truncated,
    files: listed.files,
    filesTruncated: listed.truncated,
    fileCount: listed.total,
    maxFiles: MAX_FILES,
  }
}
