// `@attach.once={f(_node)}` et `@attach.once={f(el)}` font tourner l'attache avec la balise, comme `@attach={f(_node)}` et
// `@attach={f(el)}` : à la racine comme dans une ligne de `{for}`, en Civet comme en CoffeeScript, en développement comme en
// production. Le défaut, vu dans une appli réelle : `_node` compilé comme un nom libre dans `@attach.once`, l'attache ne tournait
// jamais, sans erreur ni avertissement. Avec `.once`, un redessin ne la rejoue pas ; le composant retiré, son nettoyage joue

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const BALISE = 'mjs-attache-une-fois'
const source = (lang: string) => `<script${lang === 'coffee' ? ' lang="coffee"' : ''}>
  $rows = [{ key: 'a' }, { key: 'b' }]
  $tick = 0
  @bump = -> $tick++
  watch = (node, tag) ->
    window.__poses.push(tag + ':' + node.localName + '.' + node.className)
    -> window.__nettoyages.push(tag)
</script>
<div class="racine-once" @attach.once={watch(_node, 'r1')}>{$tick}</div>
<div class="racine-el-once" @attach.once={watch(el, 'r2')}>{$tick}</div>
<div class="racine" @attach={watch(_node, 'r3')}></div>
<div class="racine-el" @attach={watch(el, 'r4')}></div>
<ul>{for p in $rows by key}<li class="ligne" @attach.once={watch(_node, 'f1-' + p.key)}>{p.key}{$tick}</li><li class="ligne-el" @attach.once={watch(el, 'f2-' + p.key)}>{p.key}{$tick}</li><li class="ligne-simple" @attach={watch(_node, 'f3-' + p.key)}>{p.key}</li>{end}</ul>
`

const UNE_FOIS = ['f1-a', 'f1-b', 'f2-a', 'f2-b', 'r1', 'r2']
const POSES    = ['f1-a:li.ligne', 'f1-b:li.ligne', 'f2-a:li.ligne-el', 'f2-b:li.ligne-el', 'f3-a:li.ligne-simple', 'f3-b:li.ligne-simple', 'r1:div.racine-once', 'r2:div.racine-el-once', 'r3:div.racine', 'r4:div.racine-el']

async function construire(prefixe: string, src: string, prod: boolean): Promise<string> {
  const root = mjsTmp(prefixe), srcDir = join(root, 'src'), outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'attache-une-fois.mjs'), src)
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

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('@attach.once avec `_node` ou `el` : l\'attache tourne avec la balise', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const lang of ['civet', 'coffee']) {
    for (const mode of ['dev', 'prod']) {
      it(`${lang === 'civet' ? 'Civet' : 'CoffeeScript'}, ${mode === 'dev' ? 'développement' : 'production'} : posée une fois avec sa balise, nettoyée au retrait`, async () => {
        const code = await construire(`attache-une-fois-${lang}-${mode}`, source(lang), mode === 'prod')
        const window: any = new Window({ url: 'http://localhost/' })
        try {
          window.__poses = []
          window.__nettoyages = []
          const erreurs: string[] = []
          window.addEventListener('error', (e: any) => erreurs.push(String(e.message ?? e.error)))
          window.eval(code)
          window.document.body.innerHTML = `<${BALISE}></${BALISE}>`
          const c = window.document.querySelector(BALISE)
          await attendre(() => window.__poses.length >= POSES.length)
          assert.deepEqual([...window.__poses].sort(), POSES, 'chaque attache tourne une fois, avec sa balise')
          c.bump()
          await attendre(() => c._shadow.querySelector('.racine-once').textContent === '1')
          await new Promise((r) => setTimeout(r, 30))
          const fois = (tag: string) => window.__poses.filter((p: string) => p.startsWith(tag + ':')).length
          assert.deepEqual(UNE_FOIS.map(fois), UNE_FOIS.map(() => 1), '.once : le redessin ne rejoue pas l\'attache')
          c.remove()
          await attendre(() => UNE_FOIS.every((t) => window.__nettoyages.includes(t)))
          assert.deepEqual(UNE_FOIS.filter((t) => !window.__nettoyages.includes(t)), [], 'retiré : le nettoyage de chaque attache joue')
          assert.deepEqual(erreurs, [], 'aucune erreur')
        }
        finally { await window.happyDOM.close() }
      })
    }
  }
})
