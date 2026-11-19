// liaison de mesure (`clientWidth=!{…}`) : l'observateur de taille posé sur la balise part avec elle. Cent montages puis retraits n'en
// laissent aucun en vie après le ramasse-miettes (forcé, Chromium) ; il reste branché tant que la balise vit, d'où un composant
// déplacé d'un conteneur à l'autre qui garde sa mesure. Et le premier rendu : une valeur mesurée pendant ce rendu, qui ouvre un bloc à
// transition d'entrée : avec une seule liaison de mesure, aucune entrée ne joue ; avec deux, sur une balise ou sur deux, la seconde
// valeur arrive après µmount et son bloc joue son entrée (la limite écrite au chapitre du cycle de vie)
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { charger, construire, graves } from './helpers/liaison-navigateur.js'

const STYLE   = '<style>\n  .boite\n    height: 40px\n</style>\n'
const ENTREE  = (c: string) => `{if ${c}}<p class="in" :in=*fade @introstart={window.__intro++}>i</p>{end}`
const SOURCES: Record<string, string> = {
  'rk-hote.mjs': '<p class="pret">prêt</p>\n',
  'rk-mesure.mjs': `<script>\n  $l ?= 0\n</script>\n${STYLE}<div class="boite" clientWidth=!{$l}></div><p class="vu">{$l}</p>\n`,
  'rk-entree-une.mjs': `<script>\n  $l ?= 0\n</script>\n${STYLE}<div class="boite" clientWidth=!{$l}></div><p class="vu">{$l}</p>${ENTREE('$l > 0')}\n`,
  'rk-entree-meme.mjs': `<script>\n  $w ?= 0\n  $h ?= 0\n</script>\n${STYLE}<div class="boite" clientWidth=!{$w} clientHeight=!{$h}></div><p class="vu">{$w}</p>${ENTREE('$h > 0')}\n`,
  'rk-entree-deux.mjs': `<script>\n  $l ?= 0\n  $h ?= 0\n</script>\n${STYLE}<div class="boite" clientWidth=!{$l}></div><p class="vu">{$l}</p><div class="boite" clientHeight=!{$h}></div>${ENTREE('$h > 0')}\n`
}

// joué dans la page : `n` montages puis retraits, observateurs comptés (faits, déconnectés, ramassés)
async function fuite(n: number): Promise<{ faits: number, coupes: number, partis: number, gc: boolean, mesures: number }> {
  const image  = () => new Promise((r) => requestAnimationFrame(() => r(null)))
  const N      = { faits: 0, coupes: 0, partis: 0 }
  const P      = (window as any).ResizeObserver.prototype
  const obs    = P.observe
  const dis    = P.disconnect
  const reg    = new FinalizationRegistry(() => { N.partis++ })
  P.observe    = function(this: any, t: any, o: any) { if (!this.__seenMark) { this.__seenMark = true; N.faits++; reg.register(this, 0) } return obs.call(this, t, o) }
  P.disconnect = function(this: any) { if (this.__seenMark && !this.__coupe) { this.__coupe = true; N.coupes++ } return dis.call(this) }
  // un montage dans sa propre fonction : aucune référence à la balise ne survit à son retrait
  const monter = async (): Promise<boolean> => {
    const el: any = document.createElement('mjs-rk-mesure')
    document.body.appendChild(el)
    let vu = false
    for (let k = 0; k < 40 && !vu; k++) {
      const p = el._shadow && el._shadow.querySelector('.vu')
      vu      = !!p && Number(p.textContent) > 0
      if (!vu) await image()
    }
    el.remove()
    return vu
  }
  let mesures = 0
  for (let i = 0; i < n; i++) if (await monter()) mesures++
  for (let k = 0; k < 12; k++) {
    await image()
    if ((window as any).gc) (window as any).gc()
    await new Promise((r) => setTimeout(r, 30))
  }
  P.observe    = obs
  P.disconnect = dis
  return { ...N, gc: !!(window as any).gc, mesures }
}

// joué dans la page : le composant mesuré, posé dans un conteneur large puis déplacé dans un étroit ; la largeur lue après chaque pose
async function deplacement(): Promise<string[]> {
  const image   = () => new Promise((r) => requestAnimationFrame(() => r(null)))
  const feuille = document.createElement('style')
  feuille.textContent = '.large { width: 400px } .etroit { width: 200px }'
  document.head.appendChild(feuille)
  const large  = document.createElement('section')
  const etroit = document.createElement('section')
  large.className  = 'large'
  etroit.className = 'etroit'
  document.body.append(large, etroit)
  const el: any = document.createElement('mjs-rk-mesure')
  large.appendChild(el)
  const lus: string[] = []
  const lire = async (attendu: string) => {
    for (let k = 0; k < 40; k++) {
      const vu = el._shadow && el._shadow.querySelector('.vu')
      if (vu && vu.textContent === attendu) break
      await image()
    }
    lus.push(el._shadow.querySelector('.vu').textContent)
  }
  await lire('400')
  etroit.appendChild(el)
  await lire('200')
  large.appendChild(el)
  await lire('400')
  return lus
}

// joué dans la page : le composant monté, les entrées jouées comptées après quelques images
async function entrees(balise: string): Promise<{ intro: number, bloc: boolean }> {
  const image = () => new Promise((r) => requestAnimationFrame(() => r(null)))
  ;(window as any).__intro = 0
  const el: any = document.createElement(balise)
  document.body.appendChild(el)
  for (let k = 0; k < 30; k++) await image()
  return { intro: (window as any).__intro, bloc: !!(el._shadow && el._shadow.querySelector('.in')) }
}

for (const nav of ['chromium', 'firefox']) for (const mode of ['dev-parents-avant', 'bundle'] as const) describe(`liaison de mesure : l'observateur de taille suit la vie du composant (${nav}, ${mode})`, function () {
  this.timeout(120000)
  let browser: any = null
  let present      = false
  let cible: any   = null
  before(async function () {
    const playwright: any = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) return
    browser = await playwright[nav].launch(nav === 'chromium' ? { args: ['--js-flags=--expose-gc'] } : {})
    cible   = await construire(mode, SOURCES, [])
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  const ouvrir = async () => {
    const o = await charger(browser, cible, 'mjs-rk-hote')
    await o.page.waitForFunction(`!!(document.querySelector('mjs-rk-hote')._shadow && document.querySelector('mjs-rk-hote')._shadow.querySelector('.pret'))`, null, { timeout: 30000 })
    return o
  }

  it('cent montages puis retraits : aucun observateur ne reste en vie après le ramasse-miettes', async function () {
    if (!present) { this.skip(); return }
    // seul Chromium force le ramasse-miettes (`--js-flags=--expose-gc`) : ailleurs, rien ne prouverait qu'un observateur est parti
    if (nav !== 'chromium') { console.log(`      ${nav} : ramasse-miettes non forçable, la fuite ne se vérifie pas ici`); this.skip(); return }
    const o = await ouvrir()
    try {
      const r = await o.page.evaluate(fuite, 100)
      console.log(`      observateurs : ${JSON.stringify(r)}`)
      assert.equal(r.mesures, 100, 'chaque montage mesure sa balise')
      assert.equal(r.faits, 100, 'un observateur par balise mesurée')
      assert.equal(r.gc, true, 'ramasse-miettes forcé')
      assert.equal(r.faits - r.partis, 0, 'observateurs encore en vie après le ramasse-miettes')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally { await o.fermer() }
  })

  it('un composant déplacé d\'un conteneur à l\'autre garde sa mesure', async function () {
    if (!present) { this.skip(); return }
    const o = await ouvrir()
    try {
      assert.deepEqual(await o.page.evaluate(deplacement), ['400', '200', '400'])
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally { await o.fermer() }
  })

  it('premier rendu : une liaison de mesure, le bloc s\'ouvre sans entrée ; deux, sur une balise ou sur deux, la seconde valeur ouvre le sien après µmount, avec son entrée', async function () {
    if (!present) { this.skip(); return }
    const o = await ouvrir()
    try {
      const une  = await o.page.evaluate(entrees, 'mjs-rk-entree-une')
      const deux = await o.page.evaluate(entrees, 'mjs-rk-entree-deux')
      const meme = await o.page.evaluate(entrees, 'mjs-rk-entree-meme')
      console.log(`      une mesure : ${JSON.stringify(une)} | deux balises mesurées : ${JSON.stringify(deux)} | deux mesures sur une balise : ${JSON.stringify(meme)}`)
      assert.equal(une.bloc && deux.bloc && meme.bloc, true, 'les trois blocs sont ouverts')
      assert.deepEqual([une.intro, deux.intro, meme.intro], [0, 1, 1], 'entrées jouées : une liaison de mesure, deux sur deux balises, deux sur une balise (limite du chapitre 16)')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally { await o.fermer() }
  })
})
