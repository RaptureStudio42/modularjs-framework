// un `{key expr}` construit TOUJOURS son contenu, quelle que soit la valeur de sa clé (`undefined`, `null`, `0`, `''`, `false` compris), puis le remonte quand la valeur change
// en tous lieux : à la racine, dans un `{if}`, dans une ligne de `{for}`, dans un `{for}` imbriqué, dans l'attente et dans `{success}` d'un `{await}`, dans un slot
// ici sous happy-dom, en développement et en production ; la version en navigateur réel est dans key-valeur-indefinie-browser.test.ts

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const VALEURS: Record<string, string> = { indef: 'undefined', nul: 'null', zero: '0', vide: "''", faux: 'false', texte: "'a'" }

const source = (init: string) => `<script>
  $v  = ${init}
  $on = true
  $l  = [1, 2]

  fin = null
  armer = (res) -> fin = res
  $p = new Promise(armer)

  @finir = -> fin({ t: 'T' })
  @poser = (x) -> $v = x
  @poserInit = -> $v = ${init}
</script>
<u class="hors">h</u>
{key $v}<s class="r">r</s>{end}
{if $on}{key $v}<s class="i">i</s>{end}{end}
{for x in $l}{key $v}<s class="f">f</s>{end}{end}
{for x in $l}{for y in $l}{key $v}<s class="n">n</s>{end}{end}{end}
{for x in $l}{if $on}{key $v}<s class="fi">fi</s>{end}{end}{end}
{await $p}
  {key $v}<s class="aw">a</s>{end}
{success w}
  {key $v}<s class="as">s</s>{end}
{end}
<mjs-kivh-coque>{key $v}<s class="sl">sl</s>{end}</mjs-kivh-coque>
`

const LIEUX = ['r', 'i', 'f', 'n', 'fi', 'aw', 'as', 'sl']
const ATTENDU_ATTENTE = 'r=1 i=1 f=2 n=4 fi=2 aw=1 as=0 sl=1'
const ATTENDU_ARRIVEE = 'r=1 i=1 f=2 n=4 fi=2 aw=0 as=1 sl=1'
const TOUT_REFAIT     = 'r=0 i=0 f=0 n=0 fi=0 aw=0 as=0 sl=0'

const lire   = (hote: any) => LIEUX.map((c) => c + '=' + hote._shadow.querySelectorAll('.' + c).length).join(' ')
const gardes = (hote: any) => LIEUX.map((c) => c + '=' + Array.from(hote._shadow.querySelectorAll('.' + c)).filter((e: any) => e._vieux).length).join(' ')
const marquer = (hote: any) => LIEUX.forEach((c) => hote._shadow.querySelectorAll('.' + c).forEach((e: any) => { e._vieux = 1 }))
const pause   = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function construire(prod: boolean) {
  const root   = mjsTmp('key-valeur-indefinie-' + (prod ? 'prod' : 'dev'))
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'kivh-coque.mjs'), '<div class="coque"><slot></slot></div>\n')
  for (const nom of Object.keys(VALEURS)) writeFileSync(join(srcDir, `kivh-${nom}.mjs`), source(VALEURS[nom]))
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(prod ? outDir : root, 'bundle.js') }
  if (prod) Object.assign(opts, { env: 'prod', js: 'bundle', urlPrefix: '/out' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js') && (prod ? true : true))
  const rang     = (f: string) => /^mjs_core-/.test(f) ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code     = [...fichiers].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  return code
}

for (const prod of [false, true]) describe(`{key} de valeur quelconque (happy-dom, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(120000)
  let code = ''
  before(async () => { code = await construire(prod) })
  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of Object.keys(VALEURS)) it(`valeur initiale ${VALEURS[nom]} : tout se construit, puis se remonte à chaque changement`, async () => {
    const window: any = new Window({ url: 'http://localhost/' })
    try {
      window.eval(code + '\nglobalThis.µ = µ;')
      window.document.body.innerHTML = `<mjs-kivh-${nom}></mjs-kivh-${nom}>`
      await pause(150)
      const hote = window.document.body.querySelector(`mjs-kivh-${nom}`)
      const vu: string[] = []
      vu.push('attente   ' + lire(hote))
      hote.finir()
      await pause(100)
      vu.push('arrivée   ' + lire(hote))
      marquer(hote)
      hote.poser('z')
      await pause(100)
      vu.push('clé z     ' + lire(hote))
      vu.push('gardés    ' + gardes(hote))
      marquer(hote)
      hote.poserInit()
      await pause(100)
      vu.push('retour    ' + lire(hote))
      vu.push('gardés    ' + gardes(hote))
      assert.deepEqual(vu, ['attente   ' + ATTENDU_ATTENTE, 'arrivée   ' + ATTENDU_ARRIVEE, 'clé z     ' + ATTENDU_ARRIVEE, 'gardés    ' + TOUT_REFAIT, 'retour    ' + ATTENDU_ARRIVEE, 'gardés    ' + TOUT_REFAIT])
    } finally {
      window.close?.()
    }
  })
})
