import { build } from 'esbuild'
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises'
await mkdir('codex/dist', { recursive: true })
await Promise.all([
  build({ entryPoints: ['codex/frontend.js'], outfile: 'codex/dist/app.js', bundle: true, tsconfigRaw: {}, minify: true, platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } }),
  build({ entryPoints: ['codex/server.mjs'], outfile: 'codex/dist/server.mjs', bundle: true, tsconfigRaw: {}, platform: 'node', format: 'esm' }),
  ...['index.html', 'theme.css'].map(file => copyFile(`codex/${file}`, `codex/dist/${file}`)),
  copyFile('icon.svg', 'codex/dist/icon.svg'),
])

const licenses = await Promise.all(['react', 'react-dom', 'esbuild'].map(async name => `${name}\n${await readFile(`node_modules/${name}/${name === 'esbuild' ? 'LICENSE.md' : 'LICENSE'}`, 'utf8')}`))
await writeFile('codex/dist/THIRD_PARTY_NOTICES.txt', licenses.join('\n\n'))
