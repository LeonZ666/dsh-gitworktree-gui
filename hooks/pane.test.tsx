import { describe, expect, test } from 'claude-code/testing'

const PANE = {
  title: 'Git worktrees',
  isFocused: false,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

const SHA = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)

/** A tiny repository answered by argv, in the place of git. */
function fakeGit(argv: readonly string[]): { exitCode: number; stdout: string } {
  const line = argv.slice(4).join(' ')
  const ok = (stdout: string) => ({ exitCode: 0, stdout })
  if (line === 'rev-parse --show-toplevel') return ok('/work/repo\n')
  if (line === 'rev-parse --path-format=absolute --git-common-dir') return ok('/work/repo/.git\n')
  if (line === 'worktree list --porcelain') return ok(`worktree /work/repo\nHEAD ${SHA2}\nbranch refs/heads/main\n`)
  if (line.startsWith('for-each-ref')) return ok(`main ${SHA2}\n`)
  if (line.startsWith('rev-parse --verify --quiet refs/heads/main')) return ok(`${SHA2}\n`)
  if (line === 'rev-parse --abbrev-ref HEAD') return ok('main\n')
  if (line.startsWith('log --branches')) {
    return ok(
      [`${SHA2}\x1f${SHA}\x1fme\x1f1\x1fsecond\x1fHEAD -> main`, `${SHA}\x1f\x1fme\x1f1\x1ffirst\x1f`].join('\n'),
    )
  }
  if (line.startsWith('rev-list --first-parent')) return ok(`${SHA2}\n${SHA}\n`)
  if (line === 'status --porcelain=v2 --branch') return ok(`# branch.oid ${SHA2}\n# branch.head main\n1 .M N... 1 1 1 a b src/a.ts\n`)
  if (line === 'status --porcelain -z') return ok(' M src/a.ts\0')
  if (line.startsWith('log -1')) return ok('bbbbbbb\x1f2026-01-01T00:00:00Z\x1fsecond\n')
  if (line === 'ls-files -z --deleted') return ok('')
  if (line.startsWith('ls-files')) return ok('src/a.ts\0README.md\0')
  return { exitCode: 1, stdout: '' }
}

describe('git-worktree-gui pane', () => {
  test('draws a repository on every surface that takes a Pane', async ($, on) => {
    on('process.run', (_$, e: any) => ({ value: { ...fakeGit(e.argv), stderr: '' } }) as any)
    on('session.cwd', () => ({ value: '/work/repo' }))
    on('fs.exists', () => ({ value: true }))
    on('ui.open', () => ({ value: { isPlaced: true } }) as any)
    on('ui.panes', () => ({ value: [] }))
    on('ui.status', () => ({ value: undefined }))
    await $.command.run({ command: 'git-worktrees', args: '' } as any)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'git-worktree-gui',
        surface,
        component: 'Pane',
        requestId: 'git-worktree',
        props: PANE,
        viewport: { columns: 80, rows: 40 },
      })
      expect(await ui.find({ type: 'Text', text: /second/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /src\/a.ts/ })).toBeDefined()
      if (surface === 'desktop') {
        // the graph is drawn as one picture, plus the header's Git mark
        const svgs = await ui.findAll({ type: 'Svg' })
        expect(svgs.length).toBe(2)
      } else {
        expect(await ui.find({ type: 'Svg' })).toBeUndefined()
        expect(await ui.find({ type: 'Text', text: /second/ })).toBeDefined() // terminal rails keep the subject as text
      }
      expect(await ui.find({ type: 'Text', text: /M/ })).toBeDefined() // the status badge of src/a.ts
      expect(await ui.find({ type: 'Text', text: /已修改 1/ })).toBeDefined() // dirty count chip
      expect(await ui.find({ type: 'Text', text: /1 棵工作树/ })).toBeDefined()
      await ui.press({ key: 'section-graph' }) // fold...
      await ui.press({ key: 'section-graph' }) // ...and open again, so the next surface sees the graph
      await ui.unmount()
    }
  })

  test('says Reading… before the first read', async ($, on) => {
    const ui = await $.ui.mount({
      plugin: 'git-worktree-gui',
      surface: 'desktop',
      component: 'Pane',
      requestId: 'git-worktree',
      props: PANE,
    })
    expect(await ui.find({ type: 'Text', text: /Reading/ })).toBeDefined()
    await ui.unmount()
  })
})
