// Une `@attach` qui ÉCRIT un état (un suivi de souris qui pose `$light`, lu par la balise et par ses voisines)
// n'est pas relancée par cette écriture : à la racine comme dans une ligne de `{for}` dont le gabarit ne lit pas
// l'état écrit, elle se pose une fois par balise et n'est jamais retirée

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await pause(10)
}

async function monter(prefixe: string, fichiers: Record<string, string>) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${code}\nglobalThis.µ = µ;`)
  return window
}

// la carte suit la souris : son attache branche un écouteur dont le rappel écrit `$light`, que la carte lit
const CARTES = `<script>
  $light = null
  $tiers = [{ key: 'a' }, { key: 'b' }]
  log = (what) -> (globalThis.__journal ||= []).push(what)
  suivre = (key) -> (node) ->
    log('pose ' + key)
    $light = key
    -> log('retrait ' + key)
  suivreRacine = (node) ->
    log('pose racine')
    $light = 'racine'
    -> log('retrait racine')
</script>

<div class="racine" @attach={suivreRacine(_node)}>{$light}</div>
{for p in $tiers by key}<div class="carte" @class{$light is p.key}="on" @attach={suivre(p.key)}>{p.key}</div>{end}
`

describe('@attach dont le rappel écrit un état : pas de relance par ses propres écritures', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('racine et lignes de {for} : une pose par balise, aucun retrait', async () => {
    const window = await monter('attache-ecrit-etat', { 'demo-cartes.mjs': CARTES })
    try {
      window.document.body.innerHTML = '<mjs-demo-cartes></mjs-demo-cartes>'
      const c = window.document.querySelector('mjs-demo-cartes')
      await attendre(() => c._shadow?.querySelectorAll('.carte').length === 2)
      await pause(200)
      const j = [...(window.__journal ?? [])]
      assert.ok(j.length < 12, `pas de boucle (${j.length} entrées) : ${JSON.stringify(j.slice(0, 20))}`)
      assert.deepEqual(j.filter((e) => e.startsWith('pose')).sort(), ['pose a', 'pose b', 'pose racine'], `une pose par balise (${JSON.stringify(j)})`)
      assert.deepEqual(j.filter((e) => e.startsWith('retrait')), [], `aucun retrait (${JSON.stringify(j)})`)
    }
    finally {
      window.close()
    }
  })
})
