// un `{key expr}` construit TOUJOURS son contenu, quelle que soit la valeur de sa clé (`undefined`, `null`, `0`, `''`, `false` compris), puis le remonte quand la valeur change
// en tous lieux : à la racine, dans un `{if}`, dans une ligne de `{for}`, dans un `{for}` imbriqué, dans l'attente et dans `{success}` d'un `{await}`, dans un slot
// les trois modes de la production et du développement, et le rendu serveur repris par ses quatre variantes, en navigateur réel (Chromium puis Firefox quand il est installé)

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves, variantes } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

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
<mjs-kiv-coque>{key $v}<s class="sl">sl</s>{end}</mjs-kiv-coque>
`

const SOURCES: Record<string, string> = { 'kiv-coque.mjs': '<div class="coque"><slot></slot></div>\n' }
for (const nom of Object.keys(VALEURS)) SOURCES[`kiv-${nom}.mjs`] = source(VALEURS[nom])
const BALISES = Object.keys(VALEURS).map((n) => `mjs-kiv-${n}`)

const LIEUX = ['r', 'i', 'f', 'n', 'fi', 'aw', 'as', 'sl']
const ATTENDU_ATTENTE = 'r=1 i=1 f=2 n=4 fi=2 aw=1 as=0 sl=1'
const ATTENDU_ARRIVEE = 'r=1 i=1 f=2 n=4 fi=2 aw=0 as=1 sl=1'

// le nombre de balises de chaque lieu, et combien d'entre elles portent encore la marque posée avant le geste (une balise reconstruite l'a perdue)
const lire = (page: any, balise: string): Promise<string> => page.evaluate(`(() => {
  const sh = document.querySelector('${balise}')._shadow
  const q  = (c) => Array.from(sh.querySelectorAll('.' + c))
  return ${JSON.stringify(LIEUX)}.map((c) => c + '=' + q(c).length).join(' ')
})()`)

const marquer = (page: any, balise: string) => page.evaluate(`(() => {
  const sh = document.querySelector('${balise}')._shadow;
  ${JSON.stringify(LIEUX)}.forEach((c) => sh.querySelectorAll('.' + c).forEach((e) => { e._vieux = 1 }));
})()`)

const gardes = (page: any, balise: string): Promise<string> => page.evaluate(`(() => {
  const sh = document.querySelector('${balise}')._shadow
  return ${JSON.stringify(LIEUX)}.map((c) => c + '=' + Array.from(sh.querySelectorAll('.' + c)).filter((e) => e._vieux).length).join(' ')
})()`)

const TOUT_REFAIT = 'r=0 i=0 f=0 n=0 fi=0 aw=0 as=0 sl=0'

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

for (const moteur of ['chromium', 'firefox'] as const) for (const mode of ['dev-parents-avant', 'split', 'bundle', 'ssr'] as const) for (const variante of variantes(mode)) describe(`{key} de valeur quelconque (${mode}${variante ? ' ' + variante : ''}, ${moteur} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[moteur].executablePath())
    if (!present) { console.log(`  ℹ️  ${moteur} non installé, test sauté. Activer : \`npx playwright install ${moteur}\``); return }
    browser = await playwright[moteur].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const nom of Object.keys(VALEURS)) it(`valeur initiale ${VALEURS[nom]} : tout se construit, puis se remonte à chaque changement`, async function () {
    if (!present) { this.skip(); return }
    const balise = `mjs-kiv-${nom}`
    const o = await charger(browser, await cible(mode), balise, variante)
    const geste = async (appel: string) => {
      await o.page.evaluate(`(() => { document.querySelector('${balise}').${appel}; return null })()`)
      await o.page.waitForTimeout(250)
    }
    try {
      await o.page.waitForFunction(`!!document.querySelector('${balise}')?._shadow?.querySelector('.hors')`, null, { timeout: 10000 })
      await o.page.waitForTimeout(200)
      const vu: string[] = []
      vu.push('attente   ' + await lire(o.page, balise))
      await geste('finir()')
      vu.push('arrivée   ' + await lire(o.page, balise))
      await marquer(o.page, balise)
      await geste('poser(\'z\')')
      vu.push('clé z     ' + await lire(o.page, balise))
      vu.push('gardés    ' + await gardes(o.page, balise))
      await marquer(o.page, balise)
      await geste('poserInit()')
      vu.push('retour    ' + await lire(o.page, balise))
      vu.push('gardés    ' + await gardes(o.page, balise))
      assert.deepEqual(vu, [
        'attente   ' + ATTENDU_ATTENTE,
        'arrivée   ' + ATTENDU_ARRIVEE,
        'clé z     ' + ATTENDU_ARRIVEE,
        'gardés    ' + TOUT_REFAIT,
        'retour    ' + ATTENDU_ARRIVEE,
        'gardés    ' + TOUT_REFAIT
      ])
      assert.deepEqual(graves(o), [])
    } finally {
      await o.fermer()
    }
  })
})
