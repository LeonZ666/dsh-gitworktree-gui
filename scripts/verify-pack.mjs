#!/usr/bin/env node
/**
 * `npm pack --dry-run` with a writable cache, so `npm run verify` works on
 * machines whose default npm cache contains root-owned entries.
 */
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

execFileSync('npm', ['pack', '--dry-run', '--cache', join(tmpdir(), 'dsh-plugin-pack-cache')], {
  stdio: 'inherit',
  env: process.env,
})
