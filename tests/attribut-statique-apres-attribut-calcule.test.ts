// Un attribut statique écrit après un attribut calculé reste sur la balise : `<ol class="row" data-shelf={s.number} data-swipe="off">`
// dans une ligne de `{for}` (signalé par une appli réelle : `data-swipe` disparu), plusieurs statiques à la suite, un statique entre
// deux calculés, des noms `data-*` et d'autres (`title`, `role`, `id`), dans une boucle et hors boucle. Vérifié sur le DOM monté, en
// développement comme en production, en Civet comme en CoffeeScript, et sur le HTML du rendu serveur

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm, createSSRRenderer } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const BALISE = 'mjs-etagere-statique'
const source = (lang: string) => `<script${lang === 'coffee' ? ' lang="coffee"' : ''}>
  $shelves = [{ number: 1, books: [{ code: 'x' }] }, { number: 2, books: [] }]
  $n = 3
  @track = (e) -> 1
</script>
<div class="case">
  {for s in $shelves by number}
    <ol class="row" data-shelf={s.number} data-swipe="off" @scroll={@track(e)}>
      {for a in s.books by code}<li class="book" data-code={a.code} data-tone="t" title="livre">{a.code}</li>{end}
    </ol>
    <p class="entre" data-a={s.number} data-swipe="off" title="t" data-b={s.number} role="note"></p>
  {end}
</div>
<ol class="hors" data-shelf={$n} data-swipe="off" title="t" role="list"><li>y</li></ol>
<p class="autres" aria-label={$n} id="p1" title="t"></p>
`

// les attributs attendus de chaque balise, dans l'ordre du DOM
const ATTENDU: Array<[string, string[]]> = [
  ['row',    ['class=row', 'data-shelf=1', 'data-swipe=off']],
  ['book',   ['class=book', 'data-code=x', 'data-tone=t', 'title=livre']],
  ['entre',  ['class=entre', 'data-a=1', 'data-b=1', 'data-swipe=off', 'role=note', 'title=t']],
  ['row',    ['class=row', 'data-shelf=2', 'data-swipe=off']],
  ['entre',  ['class=entre', 'data-a=2', 'data-b=2', 'data-swipe=off', 'role=note', 'title=t']],
  ['hors',   ['class=hors', 'data-shelf=3', 'data-swipe=off', 'role=list', 'title=t']],
  ['autres', ['aria-label=3', 'class=autres', 'id=p1', 'title=t']]
]
const CLASSES = ['row', 'book', 'entre', 'hors', 'autres']

async function construire(prefixe: string, src: string, prod: boolean): Promise<string> {
  const root = mjsTmp(prefixe), srcDir = join(root, 'src'), outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'etagere-statique.mjs'), src)
  const opts: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(opts)
  const stats = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [], 'la construction passe')
  if (prod) return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

describe('attribut statique après un attribut calculé : il reste sur la balise', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const lang of ['civet', 'coffee']) {
    for (const mode of ['dev', 'prod']) {
      it(`${lang === 'civet' ? 'Civet' : 'CoffeeScript'}, ${mode === 'dev' ? 'développement' : 'production'} : le DOM monté garde chaque statique`, async () => {
        const code = await construire(`statique-apres-calcule-${lang}-${mode}`, source(lang), mode === 'prod')
        const window: any = new Window({ url: 'http://localhost/' })
        try {
          window.eval(code)
          window.document.body.innerHTML = `<${BALISE}></${BALISE}>`
          const c = window.document.querySelector(BALISE)
          const fin = Date.now() + 3000
          const rendu = () => c._shadow?.querySelectorAll('.row').length === 2 && c._shadow.querySelector('.autres')?.getAttribute('aria-label') === '3'
          while (!rendu() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
          const vus = [...c._shadow.querySelectorAll(CLASSES.map((k) => '.' + k).join(', '))].map((n: any) => [n.className, [...n.attributes].map((a: any) => `${a.name}=${a.value}`).sort()])
          assert.deepEqual(vus, ATTENDU)
        }
        finally { await window.happyDOM.close() }
      })
    }
  }

  it('rendu serveur : le HTML garde chaque statique', async () => {
    const root = mjsTmp('statique-apres-calcule-serveur'), srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'etagere-statique.mjs'), source('civet'))
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: join(root, 'out') } as any)
    try {
      const r = await renderer.renderToString(BALISE, {} as any)
      const vus = [...r.html.matchAll(/<[a-z]+ ([^>]*\bclass="(row|book|entre|hors|autres)"[^>]*)>/g)].map((m: RegExpMatchArray) => [m[2], [...m[1].matchAll(/([a-z-]+)="([^"]*)"/g)].map((a) => `${a[1]}=${a[2]}`).sort()])
      assert.deepEqual(vus, ATTENDU)
    }
    finally { await renderer.close() }
  })
})
