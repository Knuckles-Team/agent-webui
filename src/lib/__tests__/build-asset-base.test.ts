import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { build } from 'vite'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

it.each([undefined, '/arbora/'])(
  'builds cold-entry assets with base %s',
  async (base) => {
    const root = await mkdtemp(join(tmpdir(), 'webui-asset-base-'))
    directories.push(root)
    await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/entry.js"></script>')
    await writeFile(
      join(root, 'entry.js'),
      'import "./style.css"; document.querySelector("#root").textContent = "Ready"',
    )
    await writeFile(join(root, 'style.css'), 'body { color: #123456; }')
    await build({
      configFile: resolve('vite.config.ts'),
      root,
      publicDir: false,
      logLevel: 'silent',
      ...(base ? { base } : {}),
      build: { outDir: join(root, 'output') },
    })
    const html = await readFile(join(root, 'output/index.html'), 'utf8')
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1])
    expect(assets).toHaveLength(2)
    for (const asset of assets) {
      expect(new URL(asset, 'https://example.test/workspace/operate?server=synthetic').pathname).toMatch(
        new RegExp(`^${base ?? '/'}assets/`),
      )
    }
  },
  30_000,
)
