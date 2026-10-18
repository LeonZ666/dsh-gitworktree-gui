/** One payload of `lib/core.js` `collectState`, as the pane reads it. */
export type Snapshot = { [key: string]: any }

declare module 'claude-code' {
  interface PluginState {
    'git-worktree-gui': {
      /** The latest payload; null until the first read. */
      snapshot: Snapshot | null
      /** The worktree the person picked; empty follows the session directory. */
      selected: string
      /** The last read error; empty when the last read worked. */
      error: string
      /** Section ids the person folded. */
      folded: string[]
      /** Expanded directories of the FILES tree. */
      openDirs: string[]
      /** How many commits of the graph are listed. */
      graphRows: number
    }
  }
}
