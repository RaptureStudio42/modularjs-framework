// les `{if}` et les `{key}` d'une branche {await} sont construits même quand leurs ancres sont des nœuds texte rendus au pool par la branche d'avant, qui portaient encore le choix de leur
// ancien bloc : l'attente porte un `{if}` et un `{key}` vrais sous des balises, la promesse arrive, et `{success}` pose cinq blocs `{if}` + `{key}` précédés de zéro à quatre textes — l'un
// d'eux reçoit, quel que soit le rang où le pool sert ses nœuds, l'ancre qui garde le choix du bloc de l'attente. Les cinq blocs doivent tous être là.
// Les trois modes (développement, production en fichiers séparés, production en un seul fichier) en navigateur réel, Chromium puis Firefox quand il est installé.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const BALISE = 'mjs-ancres-recyclees'

const SOURCES: Record<string, string> = {
  'ancres-recyclees.mjs': `<script>
  $m = 'x'

  fin = null
  armer = (res) -> fin = res
  $p = new Promise(armer)

  @finir = -> fin({ t: 'T', u: 'x' })
</script>
<u class="hors">h</u>
{await $p}
  <div class="pw">{if $m is 'x'}<b class="pwb">p</b>{end}</div><div class="pk">{key $m}<s class="pks">k</s>{end}</div>
{success v}
  <div class="s0">{if v.t is 'T'}<b class="br0">0</b>{end}{key v.u}<s class="kb0">0</s>{end}</div>
  <div class="s1"><p>{v.t}</p>{if v.t is 'T'}<b class="br1">1</b>{end}{key v.u}<s class="kb1">1</s>{end}</div>
  <div class="s2"><p>{v.t}</p><p>{v.t}</p>{if v.t is 'T'}<b class="br2">2</b>{end}{key v.u}<s class="kb2">2</s>{end}</div>
  <div class="s3"><p>{v.t}</p><p>{v.t}</p><p>{v.t}</p>{if v.t is 'T'}<b class="br3">3</b>{end}{key v.u}<s class="kb3">3</s>{end}</div>
  <div class="s4"><p>{v.t}</p><p>{v.t}</p><p>{v.t}</p><p>{v.t}</p>{if v.t is 'T'}<b class="br4">4</b>{end}{key v.u}<s class="kb4">4</s>{end}</div>
{end}
`
}

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, [BALISE]))
  return cibles.get(mode)!
}

// le nombre de balises de chaque bloc, pour l'attente puis pour {success}
const compter = (page: any): Promise<string> => page.evaluate(`(() => {
  const sh = document.querySelector('${BALISE}')._shadow
  const n  = (c) => sh.querySelectorAll('.' + c).length
  return ['br0', 'br1', 'br2', 'br3', 'br4', 'kb0', 'kb1', 'kb2', 'kb3', 'kb4'].map((c) => c + '=' + n(c)).join(' ') + ' | pwb=' + n('pwb') + ' pks=' + n('pks')
})()`)

const TOUT = 'br0=1 br1=1 br2=1 br3=1 br4=1 kb0=1 kb1=1 kb2=1 kb3=1 kb4=1'

for (const moteur of ['chromium', 'firefox'] as const) for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`les blocs d'une branche {await} sur des ancres recyclées (${mode}, ${moteur} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[moteur].executablePath())
    if (!present) { console.log(`  ℹ️  ${moteur} non installé, test des ancres recyclées sauté. Activer : \`npx playwright install ${moteur}\``); return }
    browser = await playwright[moteur].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('les cinq blocs {if} + {key} de {success} sont construits quand ceux de l\'attente ont laissé leurs ancres au pool', async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible(mode), BALISE)
    try {
      await o.page.waitForFunction(`!!document.querySelector('${BALISE}')?._shadow?.querySelector('.hors')`, null, { timeout: 10000 })
      await o.page.waitForTimeout(150)
      const attente = await compter(o.page)
      assert.ok(/pwb=1 pks=1$/.test(attente), `l'attente : ${attente}`)
      await o.page.evaluate(`(() => { document.querySelector('${BALISE}').finir(); return null })()`)
      await o.page.waitForTimeout(250)
      const arrivee = await compter(o.page)
      assert.ok(arrivee.startsWith(TOUT), `la branche {success} après l'attente : ${arrivee}`)
      assert.ok(/pwb=0 pks=0$/.test(arrivee), `l'attente après l'arrivée : ${arrivee}`)
      assert.deepEqual(graves(o), [])
    } finally {
      await o.fermer()
    }
  })
})
