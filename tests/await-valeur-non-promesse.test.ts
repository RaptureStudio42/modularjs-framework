// {await $v} sur une valeur qui n'est pas une promesse (nombre, objet, donnée déjà en cache) : comme `await` en
// JavaScript, la valeur est le résultat — la branche {success} l'affiche dès la première image, avant que le
// navigateur peigne : l'attente n'est jamais vue. Avant, le bloc appelait `.then` sur la valeur et le composant entier
// tombait sur le panneau « Fatal Error: promise.then is not a function ». Une promesse résolue plus tard montre,
// elle, son attente.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const NOMBRE = [
  '<script>',
  '$v = 42',
  '</script>',
  '<div class="w">{await $v}<i class="att">attente</i>{success d}<p class="ok">{d}</p>{end}</div>',
].join('\n')

const LITTERAL = '<div class="w">{await 42}<i class="att">attente</i>{success d}<p class="ok">{d}</p>{end}</div>\n'

const OBJET = [
  '<script>',
  "$fiche = {nom: 'Ada'}",
  '</script>',
  '<div class="w">{await $fiche}<i class="att">attente</i>{success f}<p class="ok">{f.nom}</p>{end}</div>',
  "<button class=\"autre\" @click={$fiche = {nom: 'Grace'}}>autre</button>",
].join('\n')

// témoin : une vraie promesse, résolue bien après la première image
const PROMESSE = [
  '<script>',
  '$p = new Promise (r) -> setTimeout((-> r(7)), 200)',
  '</script>',
  '<div class="w">{await $p}<i class="att">attente</i>{success d}<p class="ok">{d}</p>{end}</div>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('await-valeur-non-promesse')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'tst-awv-nombre.mjs'), NOMBRE)
  writeFileSync(join(srcDir, 'tst-awv-litteral.mjs'), LITTERAL)
  writeFileSync(join(srcDir, 'tst-awv-objet.mjs'), OBJET)
  writeFileSync(join(srcDir, 'tst-awv-promesse.mjs'), PROMESSE)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('{await} — une valeur qui n\'est pas une promesse s\'affiche dans {success}', function () {
  this.timeout(60000)

  let app: any

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  // ce que montre `racine` à la prochaine image (rappel de requestAnimationFrame) : ce que le navigateur peindrait
  const aLaPremiereImage = (racine: any) => new Promise<{ ok: string, attente: boolean }>((r) => {
    app.window.requestAnimationFrame(() => r({ ok: (racine.querySelector('.ok')?.textContent ?? '').trim(), attente: racine.querySelector('.att') !== null }))
  })

  // monte la balise à la main et lit son ombre à la première image après l'insertion
  async function monterPremiereImage(nom: string): Promise<{ el: any, racine: any, ok: string, attente: boolean }> {
    const el     = app.document.createElement(`mjs-${nom}`)
    const racine = el._shadow ?? el
    app.document.body.appendChild(el)
    return { el, racine, ...(await aLaPremiereImage(racine)) }
  }

  it('{await $v} avec $v = 42 : {success} affiche 42 dès la première image, l\'attente n\'est jamais vue', async () => {
    const { el, ok, attente } = await monterPremiereImage('tst-awv-nombre')
    assert.equal(ok, '42')
    assert.equal(attente, false, 'à la première image, l\'attente n\'est pas affichée : la valeur est déjà là')
    el.remove()
  })

  it('témoin : une promesse résolue plus tard montre l\'attente à la première image, puis {success}', async () => {
    const { el, racine, ok, attente } = await monterPremiereImage('tst-awv-promesse')
    assert.equal(attente, true, 'l\'attente est affichée le temps de la promesse')
    assert.equal(ok, '')
    await pause(400)
    assert.equal((racine.querySelector('.ok')?.textContent ?? '').trim(), '7')
    el.remove()
  })

  it('{await $v} avec $v = 42 : {success} affiche 42, sans planter', async () => {
    const c = await app.mount('tst-awv-nombre')
    await c.tick()
    assert.equal(c.el._mjs_has_crashed === true, false, 'le composant ne plante pas')
    assertAbsent(c.find('.mjs-fatal-error'), 'aucun panneau d\'erreur')
    assert.equal(c.text('.ok'), '42')
    assertAbsent(c.find('.att'), 'pas d\'attente : la valeur est déjà là')
    c.destroy()
  })

  it('{await 42} écrit en dur : {success} affiche 42', async () => {
    const c = await app.mount('tst-awv-litteral')
    await c.tick()
    assert.equal(c.el._mjs_has_crashed === true, false)
    assert.equal(c.text('.ok'), '42')
    c.destroy()
  })

  it('{await $fiche} sur un objet, puis un autre objet : {success} suit la valeur, dès la première image', async () => {
    const c = await app.mount('tst-awv-objet')
    await c.tick()
    assert.equal(c.el._mjs_has_crashed === true, false)
    assert.equal(c.text('.ok'), 'Ada')
    c.find('.autre').click()
    const vu = await aLaPremiereImage(c.shadow)
    assert.equal(vu.ok, 'Grace')
    assert.equal(vu.attente, false, 'la nouvelle valeur s\'affiche sans que l\'attente soit vue')
    c.destroy()
  })
})
