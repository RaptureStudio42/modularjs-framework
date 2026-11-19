// Deux feuilles partagées du même nom — pourquoi ce test existe.
//
// Une feuille partagée (`stylesheetsDir`) est posée sous son nom sans extension (`µ.CSS["a"]`). `a.css` et `a.sass` donnaient deux
// feuilles sous la même clé : seule la première était posée, la seconde jamais, et la construction ne disait rien.
//
// Ce que le test garde : dans chaque mode des feuilles (`css`), la construction avertit en nommant les deux fichiers ; des noms
// distincts n'avertissent pas.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const comp = ['<script>', '  $x = 1', '</script>', '<p class="ok">{$x}</p>'].join('\n')

async function construire(css: string, feuilles: Record<string, string>): Promise<string[]> {
  const root = mjsTmp(`feuilles-meme-nom-${css}`)
  const src  = join(root, 'src'), out = join(root, 'out'), dir = join(root, 'css')
  mkdirSync(src, { recursive: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(src, 'a.mjs'), comp)
  for (const [nom, texte] of Object.entries(feuilles)) writeFileSync(join(dir, nom), texte)
  const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', js: 'split', env: 'dev', stylesheetsDir: dir, css } as any)
  const stats = await b.compile()
  await b.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return stats.warnings.map((w: any) => typeof w === 'string' ? w : (w?.message ?? String(w)))
}

describe('feuilles partagées du même nom — la construction avertit', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const css of ['bundle', 'split', 'lazy']) {
    it(`css: '${css}' — a.css et a.sass : un avertissement nomme les deux fichiers`, async () => {
      const textes = (await construire(css, { 'a.css': '.depuis-css{color:red}', 'a.sass': '.depuis-sass\n  color: blue\n' })).filter(w => w.includes('a.css') && w.includes('a.sass'))
      assert.equal(textes.length, 1, 'deux feuilles sous la même clé, la seconde jamais posée, sans un mot')
    })
  }

  it('noms distincts : aucun avertissement de ce genre', async () => {
    const textes = (await construire('bundle', { 'a.css': '.a{color:red}', 'b.sass': '.b\n  color: blue\n' })).filter(w => w.includes('a.css') && w.includes('b.sass'))
    assert.deepEqual(textes, [])
  })
})
