/**
 * dsh-gitworktree-gui — text rails.
 *
 * Turns the laid-out commit nodes (newest first, `lane` + `parentLanes`) into
 * monospace rail rows for surfaces that draw text, so the Claude pane shows
 * the same topology as the browser SVG: the trunk is one straight `│` on
 * lane 0, every branch grows on a lane to its right, a fork closes with `╯`
 * and a merge opens with `╮`.
 *
 * Pure: no imports, no I/O.
 */

/** Characters per lane: the glyph and one filler. */
const CELL = 2

/**
 * @param nodes - graph nodes, newest first.
 * @param laneCount - number of lanes.
 * @returns one row per node: `{ text, tone }` runs, `tone` one of
 *   `trunk`, `branch`, `current` or `none`.
 */
export function railRows(nodes, laneCount) {
  const rowOf = new Map(nodes.map((node, index) => [node.sha, index]))
  const width = Math.max(1, laneCount)
  // Per row, per lane: what is drawn there.
  const grid = nodes.map(() =>
    Array.from({ length: width }, () => ({ ch: ' ', tone: 'none', fill: false })),
  )
  const toneOf = (lane, isCurrent) => (isCurrent ? 'current' : lane === 0 ? 'trunk' : 'branch')
  const put = (row, lane, ch, tone) => {
    if (row < 0 || row >= grid.length || lane < 0 || lane >= width) return
    const cell = grid[row][lane]
    // A horizontal run crossing a vertical one is a cross, never the other way round.
    if ((cell.ch === '│' && ch === '─') || (cell.ch === '─' && ch === '│')) {
      cell.ch = '┼'
    } else if (cell.ch === ' ' || cell.ch === '│' || cell.ch === '─') {
      cell.ch = ch
    } else return
    cell.tone = tone
  }
  const run = (row, from, to, tone) => {
    for (let lane = from; lane < to; lane += 1) {
      put(row, lane, '─', tone)
      grid[row][lane].fill = true // the filler after this cell is a dash too
    }
  }

  for (const node of nodes) {
    for (const parent of node.parentLanes ?? []) {
      const to = rowOf.get(parent.sha)
      if (to === undefined || to <= node.row) continue
      const tone = toneOf(Math.max(node.lane, parent.lane), node.isCurrent)
      const side = Math.max(node.lane, parent.lane)
      if (node.lane < parent.lane) {
        // merge: the trunk-side commit reaches out to the branch's lane
        run(node.row, node.lane + 1, side, tone)
        put(node.row, side, '╮', tone)
      }
      for (let row = node.row + 1; row < to; row += 1) put(row, side, '│', tone)
      if (node.lane > parent.lane) {
        // fork: the branch lane folds back into its parent
        run(to, parent.lane + 1, side, tone)
        put(to, side, '╯', tone)
      } else if (node.lane === parent.lane) {
        // straight edge: the rows between were filled above
      }
    }
  }
  // Nodes win over everything drawn under them.
  for (const node of nodes) {
    const cell = grid[node.row][node.lane]
    cell.ch = node.parents.length > 1 ? '◆' : '●'
    cell.tone = toneOf(node.lane, node.isCurrent)
  }

  return grid.map((cells) => {
    const runs = []
    const push = (text, tone) => {
      const last = runs[runs.length - 1]
      if (last !== undefined && last.tone === tone) last.text += text
      else runs.push({ text, tone })
    }
    for (const cell of cells) {
      push(cell.ch, cell.tone)
      push(cell.fill ? '─' : ' '.repeat(CELL - 1), cell.fill ? cell.tone : 'none')
    }
    return runs
  })
}

/** Characters one rail row occupies. */
export function railWidth(laneCount) {
  return Math.max(1, laneCount) * CELL
}

/** Relative time from a unix-seconds stamp, in the compact form the panel uses. */
export function ago(seconds, now = Date.now()) {
  if (typeof seconds !== 'number' || seconds <= 0) return ''
  const delta = now - seconds * 1000
  if (delta < 60e3) return 'now'
  if (delta < 3600e3) return `${Math.floor(delta / 60e3)}m`
  if (delta < 864e5) return `${Math.floor(delta / 3600e3)}h`
  if (delta < 864e5 * 30) return `${Math.floor(delta / 864e5)}d`
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/** Cut `text` to `max` columns, counting CJK and full-width characters as two. */
export function clip(text, max) {
  if (typeof text !== 'string') return ''
  const clean = text.replace(/\s+/g, ' ').trim()
  let out = ''
  let used = 0
  for (const ch of clean) {
    const step = /[⺀-鿿가-힯＀-￯]/.test(ch) ? 2 : 1
    if (used + step > max - 1) return `${out}…`
    out += ch
    used += step
  }
  return out
}

/**
 * Flatten a path list into the visible rows of a collapsible tree.
 * @param files - repo-relative file paths.
 * @param open - directory paths that are expanded; everything else is folded.
 * @param forceOpen - show every directory (a search is active).
 * @returns `{ depth, name, path, isDir }` rows, directories first at each level.
 */
export function fileRows(files, open, forceOpen = false) {
  const root = { dirs: new Map(), files: [] }
  for (const path of files) {
    const parts = path.split('/')
    let node = root
    for (let index = 0; index < parts.length - 1; index += 1) {
      const dir = parts.slice(0, index + 1).join('/')
      if (!node.dirs.has(parts[index])) node.dirs.set(parts[index], { path: dir, dirs: new Map(), files: [] })
      node = node.dirs.get(parts[index])
    }
    node.files.push({ name: parts[parts.length - 1], path })
  }
  const rows = []
  const walk = (node, depth) => {
    const names = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b))
    for (const name of names) {
      const child = node.dirs.get(name)
      const isOpen = forceOpen || open.has(child.path)
      rows.push({ depth, name, path: child.path, isDir: true, isOpen })
      if (isOpen) walk(child, depth + 1)
    }
    for (const file of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
      rows.push({ depth, name: file.name, path: file.path, isDir: false, isOpen: false })
    }
  }
  walk(root, 0)
  return rows
}

/** True when a path, or a directory above it, is in the dirty set (`dir/` entries cover their files). */
export function isDirty(dirty, path) {
  if (dirty.has(path)) return true
  for (let cut = path.lastIndexOf('/'); cut > 0; cut = path.lastIndexOf('/', cut - 1)) {
    if (dirty.has(path.slice(0, cut))) return true
  }
  return false
}


/** Relative time in the panel's Chinese long form (`10 小时前`), from unix seconds. */
export function agoLong(seconds, now = Date.now()) {
  if (typeof seconds !== 'number' || seconds <= 0) return ''
  const delta = now - seconds * 1000
  if (delta < 60e3) return '刚刚'
  if (delta < 3600e3) return `${Math.floor(delta / 60e3)} 分钟前`
  if (delta < 864e5) return `${Math.floor(delta / 3600e3)} 小时前`
  if (delta < 864e5 * 30) return `${Math.floor(delta / 864e5)} 天前`
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/** The same, from an ISO date string (a worktree's last commit). */
export function agoIso(iso, now = Date.now()) {
  const then = typeof iso === 'string' ? Date.parse(iso) : NaN
  return Number.isNaN(then) ? '' : agoLong(then / 1000, now)
}

/** Status letter and theme tone of one `git status` entry, as the DSH panel badges it. */
export function changeBadge(change) {
  const x = typeof change?.x === 'string' ? change.x : ' '
  const y = typeof change?.y === 'string' ? change.y : ' '
  if (y === '?') return { label: '?', tone: 'inactive' }
  const pair = `${x}${y}`.replace(/ /g, '')
  if (pair.includes('U') || pair.includes('D')) return { label: pair || 'D', tone: 'error' }
  if (pair.includes('A')) return { label: pair || 'A', tone: 'success' }
  if (pair.includes('R') || pair.includes('C')) return { label: pair || 'R', tone: 'claude' }
  return { label: pair || '·', tone: 'warning' }
}

// ---- the commit graph as SVG (desktop) ---------------------------------------
//
// The desktop draws an `Svg` as an isolated image and its text in a
// proportional font whose metrics the plugin cannot read, so the whole graph
// block (rails, subject, ref chips, meta line, HEAD halo) is one drawing at
// fixed pixel geometry, the way the DSH panel draws it: nothing outside the
// image has to line up with it.

/**
 * Colors of the graph. The image cannot read the host's theme, so the markup
 * carries mid tones as attributes (legible on light and dark) and a `<style>`
 * that picks the exact tone per `prefers-color-scheme` where the image is
 * given the scheme.
 */
export const GRAPH_COLORS = {
  mid: { trunk: '#c96a45', branch: '#c58a2c', current: '#3aae63', tag: '#8f8a83', text: '#8a857e', dim: '#8f8a83' },
  light: { trunk: '#c15f3c', branch: '#b7791f', current: '#2f9e55', tag: '#77726c', text: '#1f1e1d', dim: '#77726c' },
  dark: { trunk: '#e0835e', branch: '#e3a64a', current: '#4fc27a', tag: '#a29d95', text: '#ecebe8', dim: '#a39e97' },
}

/** Kept for callers of the old rail colors. */
export const RAIL_COLORS = { trunk: GRAPH_COLORS.light.trunk, branch: GRAPH_COLORS.light.branch, current: GRAPH_COLORS.light.current }

const G = {
  row: 58, // px per commit
  lane: 24, // px between lanes
  left: 14, // x of lane 0
  legend: 22, // px of the legend strip above the first commit
  top: 38, // y of the first commit
  bottom: 46, // px below the last commit
  subject: 12, // font px
  meta: 10.5,
  chip: 10,
}
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif"
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'PingFang SC', monospace"

/** Escape text for SVG markup. */
export function xml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
}

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/

/** Estimated pixel width of `text` at `unit` px per narrow character (a wide one counts two). */
export function textWidth(text, unit) {
  let used = 0
  for (const ch of String(text)) used += WIDE.test(ch) ? unit * 2 : unit
  return used
}

/** Cut `text` to an estimated `maxPx`, ending in `…` when cut. */
export function fitPx(text, maxPx, unit) {
  if (typeof text !== 'string') return ''
  const clean = text.replace(/\s+/g, ' ').trim()
  if (textWidth(clean, unit) <= maxPx) return clean
  let out = ''
  let used = 0
  for (const ch of clean) {
    const step = WIDE.test(ch) ? unit * 2 : unit
    if (used + step > maxPx - unit) return `${out.trimEnd()}…`
    out += ch
    used += step
  }
  return out
}

/** Pixel width the pane offers, estimated from its width in cells. */
export function paneWidthPx(columns) {
  const cells = typeof columns === 'number' && columns > 0 ? columns : 60
  return Math.round(Math.min(960, Math.max(260, cells * 7.4)))
}

const tone = (node) => (node.isCurrent ? 'current' : node.isTrunk || node.lane === 0 ? 'trunk' : 'branch')

/**
 * The commit graph as SVG documents, newest commit on top, the history
 * growing upward from the oldest at the bottom.
 *
 * Long histories are cut into several documents of `chunk` commits each, to
 * stay under the element's markup limit; stacked with no gap they draw one
 * picture (each document views its own band of the same coordinates).
 *
 * @param nodes - graph nodes, newest first (`row`, `lane`, `parentLanes`, `refs`…).
 * @param laneCount - number of lanes.
 * @param options - `width` px, `currentBranch`, `now` (ms), `chunk` commits per
 *   document, `rows` how many of the newest commits are drawn (edges into the
 *   rest run off the bottom).
 * @returns `{ width, parts: [{ source, height }] }`.
 */
export function graphSvgs(nodes, laneCount, options = {}) {
  const width = Math.round(options.width ?? 420)
  const now = options.now ?? Date.now()
  const chunk = Math.max(1, options.chunk ?? 30)
  const currentBranch = options.currentBranch ?? ''
  const lanes = Math.max(1, laneCount)
  const x = (lane) => G.left + lane * G.lane
  const y = (row) => G.top + row * G.row
  const labelX = x(lanes - 1) + 18
  const room = Math.max(80, width - labelX - 8)
  const rowOf = new Map(nodes.map((node, index) => [node.sha, index]))
  const C = GRAPH_COLORS

  const style =
    `<style>${scheme(C.light)}@media (prefers-color-scheme: dark){${scheme(C.dark)}}</style>`

  // Edges: [yTop, yBottom, markup].
  const edges = []
  for (const node of nodes) {
    for (const parent of node.parentLanes ?? []) {
      const to = rowOf.get(parent.sha)
      if (to === undefined || to <= node.row) continue
      const target = nodes[to]
      const x1 = x(node.lane)
      const y1 = y(node.row)
      const x2 = x(target.lane)
      const y2 = y(to)
      const bend = Math.min(G.row * 0.7, y2 - y1)
      let d
      if (x1 === x2) d = `M${x1} ${y1}V${y2}`
      else if (node.lane > target.lane) {
        // fork: down the branch lane, then a smooth bend into the parent
        d = `M${x1} ${y1}V${y2 - bend}C${x1} ${y2 - bend / 2} ${x2} ${y2 - bend / 2} ${x2} ${y2}`
      } else {
        // merge: a smooth bend out of the merge commit, then down the branch lane
        d = `M${x1} ${y1}C${x1} ${y1 + bend / 2} ${x2} ${y1 + bend / 2} ${x2} ${y1 + bend}V${y2}`
      }
      const t = node.isCurrent ? 'current' : node.isTrunk && target.isTrunk ? 'trunk' : node.lane > target.lane ? tone(node) : tone(target)
      const w = t === 'current' ? 2.4 : 1.7
      edges.push([y1, y2, `<path class="s-${t}" d="${d}" fill="none" stroke="${C.mid[t]}" stroke-width="${w}" stroke-linecap="round"/>`])
    }
  }

  const refRank = (ref) =>
    ref.kind === 'head' ? 0 : ref.kind === 'branch' && ref.name === currentBranch ? 1 : ref.kind === 'branch' ? 2 : ref.kind === 'tag' ? 3 : 4

  const nodeMarkup = (node) => {
    const out = []
    const cx = x(node.lane)
    const cy = y(node.row)
    const t = tone(node)
    // A remote that only mirrors a local branch on the same commit (`origin/main`
    // beside `main`) and `origin/HEAD` add nothing a reader needs here.
    const local = new Set((node.refs ?? []).filter((ref) => ref.kind === 'branch').map((ref) => ref.name))
    const refs = (node.refs ?? [])
      .filter((ref) => ref.kind !== 'remote' || !(/\/HEAD$/.test(ref.name) || local.has(ref.name.replace(/^[^/]+\//, ''))))
      .sort((a, b) => refRank(a) - refRank(b))
    const hasHead = refs.some((ref) => ref.kind === 'head')
    const isTip = hasHead || refs.some((ref) => ref.kind === 'branch' && ref.name === currentBranch)
    if (isTip) {
      out.push(`<circle class="s-current" cx="${cx}" cy="${cy}" r="8" fill="none" stroke="${C.mid.current}" stroke-width="1.6"/>`)
    }
    const r = (node.parents ?? []).length > 1 ? 5 : 4
    out.push(`<circle class="f-${t}" cx="${cx}" cy="${cy}" r="${r}" fill="${C.mid[t]}"/>`)
    const subject = fitPx(String(node.subject ?? ''), room, G.subject * 0.5)
    if (subject !== '') {
      out.push(
        `<text class="tx" x="${labelX}" y="${cy + 4}" font-family="${xml(SANS)}" font-size="${G.subject}" fill="${C.mid.text}">${xml(subject)}</text>`,
      )
    }
    // Ref chips under the subject.
    let chipX = labelX
    const chipUnit = G.chip * 0.61
    const end = labelX + room
    const shown = refs.filter((ref) => ref.kind !== 'head')
    let drawn = 0
    for (const ref of shown) {
      const name = ref.kind === 'tag' ? `#${ref.name}` : ref.name
      const k =
        ref.kind === 'tag' || ref.kind === 'remote'
          ? 'tag'
          : ref.name === currentBranch
            ? 'current'
            : node.isTrunk
              ? 'trunk'
              : 'branch'
      const reserve = (hasHead ? 50 : 0) + (drawn + 1 < shown.length ? 26 : 0)
      const maxText = end - chipX - 12 - reserve
      if (drawn >= 3 || maxText < chipUnit * 4) break
      const label = fitPx(name, maxText, chipUnit)
      const w = Math.round(textWidth(label, chipUnit) + 12)
      out.push(
        `<rect class="f-${k} s-${k}" x="${chipX}" y="${cy + 9}" width="${w}" height="16" rx="4" fill="${C.mid[k]}" fill-opacity="0.12" stroke="${C.mid[k]}" stroke-opacity="0.5"/>`,
        `<text class="f-${k}" x="${chipX + 6}" y="${cy + 21}" font-family="${xml(MONO)}" font-size="${G.chip}" fill="${C.mid[k]}">${xml(label)}</text>`,
      )
      chipX += w + 5
      drawn += 1
    }
    const lineY = cy + 21
    if (drawn < shown.length) {
      out.push(`<text class="dm" x="${chipX}" y="${lineY}" font-family="${xml(MONO)}" font-size="${G.chip}" fill="${C.mid.dim}">+${shown.length - drawn}</text>`)
      chipX += 22
    }
    if (hasHead) {
      const k = node.isCurrent || shown.some((ref) => ref.name === currentBranch) ? 'current' : 'dm'
      const cls = k === 'current' ? 'f-current' : 'dm'
      out.push(
        `<text class="${cls}" x="${chipX + (drawn > 0 ? 1 : 0)}" y="${lineY}" font-family="${xml(MONO)}" font-size="${G.chip}" fill="${k === 'current' ? C.mid.current : C.mid.dim}">← HEAD</text>`,
      )
    }
    const metaY = drawn > 0 || hasHead ? cy + 39 : cy + 22
    const meta = fitPx(
      [node.short, agoLong(node.time, now), node.author].filter((part) => typeof part === 'string' && part !== '').join(' · '),
      room,
      G.meta * 0.5,
    )
    if (meta !== '') {
      out.push(
        `<text class="dm" x="${labelX}" y="${metaY}" font-family="${xml(SANS)}" font-size="${G.meta}" fill="${C.mid.dim}">${xml(meta)}</text>`,
      )
    }
    return out.join('')
  }

  const legend = () => {
    const items = [
      ['trunk', '主干'],
      ['branch', '分支'],
      ['current', '当前分支'],
    ]
    let lx = G.left - 4
    const out = []
    for (const [k, label] of items) {
      out.push(`<rect class="f-${k}" x="${lx}" y="10" width="9" height="2.4" rx="1.2" fill="${C.mid[k]}"/>`)
      out.push(
        `<text class="dm" x="${lx + 13}" y="14.5" font-family="${xml(SANS)}" font-size="10" fill="${C.mid.dim}">${label}</text>`,
      )
      lx += 13 + textWidth(label, 5) + 14
    }
    return out.join('')
  }

  const count = Math.max(0, Math.min(nodes.length, options.rows ?? nodes.length))
  const parts = []
  for (let first = 0; first < Math.max(1, count); first += chunk) {
    const last = Math.min(count, first + chunk) - 1
    const y0 = first === 0 ? 0 : y(first) - 16
    const y1 = last >= count - 1 ? y(Math.max(0, count - 1)) + G.bottom : y(last + 1) - 16
    const height = Math.max(1, Math.round(y1 - y0))
    const body = []
    if (first === 0) body.push(legend())
    for (const [top, bottom, markup] of edges) if (bottom >= y0 && top <= y1) body.push(markup)
    for (let row = first; row <= last; row += 1) body.push(nodeMarkup(nodes[row]))
    parts.push({
      height,
      source:
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 ${y0} ${width} ${height}">` +
        `${style}${body.join('')}</svg>`,
    })
  }
  return { width, parts }
}

/** The per-scheme class rules of the graph's `<style>`. */
function scheme(c) {
  const rules = [`.tx{fill:${c.text}}`, `.dm{fill:${c.dim}}`]
  for (const k of ['trunk', 'branch', 'current', 'tag']) rules.push(`.f-${k}{fill:${c[k]}}`, `.s-${k}{stroke:${c[k]}}`)
  return rules.join('')
}
