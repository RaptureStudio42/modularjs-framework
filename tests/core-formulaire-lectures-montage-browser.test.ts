// lire une propriété d'un <form> (son parent, son nom de balise, une méthode, une donnée posée sur lui) passe d'abord par la recherche d'un
// champ de ce nom parmi les siens : le navigateur refait alors la liste de ses champs si elle a changé, et chaque module du formulaire qui
// arrive la change. Une lecture par module montait donc mille cases en un temps qui croît comme le carré de leur nombre. Le montage des
// modules ne lit rien sur le formulaire où ils arrivent (un nombre fixe de lectures, quel que soit le nombre de modules) et ne pose rien sur
// lui ; la remise à zéro d'un grand groupe radio cherche ses boutons une fois, pas une fois par bouton
// - le travail se compte (lectures faites sur le formulaire, données posées sur lui, recherches du groupe), jamais au chronomètre : le temps
//   dépend aussi du navigateur et de la charge de la machine ; il est donné dans le message, pour lecture
// - chaque module est monté, le groupe obligatoire est validé, la remise à zéro rend le groupe à son état de départ
// Chromium réel

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { assembler } from './helpers/editeur-riche.js'

const PAGE = `<script>
  $cases   = []
  $inters  = []
  $radios  = []
  $nombres = []

  µmount ->
    window.__monter = (sorte, n)->
      liste = Array.from({ length: n }, (_, i)-> i)
      $cases   = liste if sorte is 'cases'
      $inters  = liste if sorte is 'inters'
      $radios  = liste if sorte is 'radios'
      $nombres = liste if sorte is 'nombres'
</script>

<form class="f" method="get" action="/envoi" @noUJS>
  {for i in $cases}<@@checkbox name={'c' + i}>{i}</@@checkbox>{end}
  {for i in $inters}<@@switch name={'s' + i}>{i}</@@switch>{end}
  {for i in $radios}<@@radio name="g" value={i} required={i is 0}>{i}</@@radio>{end}
  {for i in $nombres}<@@number name={'n' + i} value={i}></@@number>{end}
</form>
`

const BALISE: Record<string, string> = { cases: 'mjs-core-checkbox', inters: 'mjs-core-switch', radios: 'mjs-core-radio', nombres: 'mjs-core-number' }

// posé avant le cœur : chaque propriété du DOM qu'un <form> hérite compte ses lectures faites SUR le formulaire suivi (`window.__suivi`) —
// `form.parentNode`, `form.closest` ; une méthode devient un accesseur qui rend la même fonction, pour que sa lecture se voie : l'appel de
// la fonction du prototype avec le formulaire pour cible (`closest.call(form, …)`) ne lit rien sur lui et ne compte pas. Les recherches
// des boutons d'un groupe radio se comptent aussi
const COMPTEURS = `(() => {
  window.__c = { lectures: 0, groupe: 0, noms: {} }
  for (const P of [HTMLFormElement.prototype, HTMLElement.prototype, Element.prototype, Node.prototype, EventTarget.prototype]) {
    for (const k of Object.getOwnPropertyNames(P)) {
      if (k === 'constructor') continue
      const d = Object.getOwnPropertyDescriptor(P, k)
      if (!d || !d.configurable) continue
      const note = (self) => { if (self === window.__suivi) { __c.lectures++; __c.noms[k] = (__c.noms[k] || 0) + 1 } }
      if (d.get) {
        const g = d.get
        Object.defineProperty(P, k, { ...d, get() { note(this); return g.call(this) } })
      }
      else if (typeof d.value === 'function') {
        let f = d.value
        if (k === 'querySelectorAll') { const q = f; f = function (s) { if (String(s).includes('mjs-core-radio[')) __c.groupe++; return q.apply(this, arguments) } }
        Object.defineProperty(P, k, {
          configurable: true,
          enumerable: d.enumerable,
          get() { note(this); return f },
          set(v) { if (this === P) f = v; else Object.defineProperty(this, k, { value: v, writable: true, configurable: true, enumerable: true }) }
        })
      }
    }
  }
  const qf = DocumentFragment.prototype.querySelectorAll
  DocumentFragment.prototype.querySelectorAll = function (s) { if (String(s).includes('mjs-core-radio[')) __c.groupe++; return qf.call(this, s) }
})()`

// le montage de n modules d'une sorte, dans une page neuve : les lectures faites sur le formulaire jusqu'à ce que tous soient montés (et,
// pour le groupe, validé : son dernier bouton manque), les données que le montage a posées sur lui, le temps
const MONTER = `async ([sorte, n]) => {
  const h   = document.querySelector('mjs-hote')
  const f   = h._shadow.querySelector('form')
  const sel = ${JSON.stringify(BALISE)}[sorte]
  const avant = Object.keys(f)
  window.__suivi = f
  __c.lectures = 0; __c.groupe = 0; __c.noms = {}
  const t0 = performance.now()
  window.__monter(sorte, n)
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 0))
    const m = h._shadow.querySelectorAll(sel)
    if (m.length !== n || !m[n - 1]._mjs_is_mounted || !m[0]._mjs_is_mounted) continue
    if (sorte === 'radios' && !m[n - 1].matches(':invalid')) continue
    const ms = Math.round(performance.now() - t0)
    window.__suivi = null
    await new Promise((ok) => setTimeout(ok, 50))
    const poses = Object.keys(f).filter((k) => !/^\\d+$/.test(k) && !avant.includes(k))
    return { lectures: __c.lectures, noms: __c.noms, poses, ms }
  }
}`

// la remise à zéro du groupe de n boutons montés : un bouton coché par l'utilisateur, puis `form.reset()` ; les recherches du groupe
// jusqu'à ce que le groupe soit revenu à son départ (aucun bouton coché, le groupe obligatoire manque de nouveau), le temps
const REMETTRE = `async (n) => {
  const h = document.querySelector('mjs-hote')
  const f = h._shadow.querySelector('form')
  const m = Array.from(h._shadow.querySelectorAll('mjs-core-radio'))
  m[7]._shadow.querySelector('input').click()
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 0))
    if (m[7]._state.checked && !m[n - 1].matches(':invalid')) break
  }
  __c.groupe = 0
  const t0 = performance.now()
  f.reset()
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 0))
    if (m.some((x) => x._state.checked) || !m[n - 1].matches(':invalid') || !m[0].matches(':invalid')) continue
    return { groupe: __c.groupe, ms: Math.round(performance.now() - t0) }
  }
}`

let construit: Promise<string> | null = null

function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('formulaire-lectures-montage')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), PAGE)
    const manifeste = join(root, 'bundle.js')
    const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste })
    const stats     = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    return assembler(outDir, manifeste)
  })()
  return construit
}

describe('monter les modules d\'un formulaire ne lit rien sur lui, module après module (chromium réel)', function () {
  this.timeout(300000)
  let present = false
  let browser: any
  let page: any
  const erreurs: string[] = []

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright.chromium.executablePath())
      if (!present) return
      const script  = await construire()
      browser = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
      page    = await browser.newPage()
      await page.addInitScript('window.__name = (f) => f;' + COMPTEURS)
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
      const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`
      await page.route('http://formulaire.test/**', (route: any) => route.fulfill({ status: 200, contentType: 'text/html', body: contenu }))
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  async function nouvellePage() {
    await page.goto('http://formulaire.test/page', { waitUntil: 'load' })
    await page.waitForFunction(`typeof window.__monter === 'function'`, null, { timeout: 30000 })
  }

  // le montage de chaque taille, chacune dans une page neuve
  async function monter(sorte: string) {
    const vu: Record<number, any> = {}
    for (const n of [1000, 2000]) {
      await nouvellePage()
      vu[n] = await page.evaluate(`(${MONTER})(${JSON.stringify([sorte, n])})`)
    }
    return vu
  }

  for (const [sorte, libelle] of [['cases', '2 000 cases'], ['inters', '2 000 interrupteurs'], ['radios', 'un groupe radio obligatoire de 2 000 boutons'], ['nombres', '2 000 champs nombre']]) {
    it(`${libelle} : autant de lectures sur le formulaire que pour 1 000, un petit nombre fixe, et rien de posé sur lui`, async function () {
      if (!present) { this.skip(); return }
      const vu  = await monter(sorte)
      const dit = JSON.stringify(vu)
      assert.ok(vu[1000].lectures <= 10, `lectures sur le formulaire, pour 1 000 modules : ${dit} — une par module, le montage redevient quadratique`)
      assert.ok(vu[2000].lectures <= vu[1000].lectures, `lectures sur le formulaire, 2 000 contre 1 000 : ${dit}`)
      assert.deepEqual(vu[2000].poses, [], `données posées sur le formulaire par le montage : ${dit}`)
      assert.deepEqual(erreurs, [])
    })
  }

  it('remettre à zéro un groupe radio de 2 000 boutons cherche le groupe autant de fois que pour 1 000, pas une fois par bouton', async function () {
    if (!present) { this.skip(); return }
    const vu: Record<number, any> = {}
    for (const n of [1000, 2000]) {
      await nouvellePage()
      await page.evaluate(`(${MONTER})(${JSON.stringify(['radios', n])})`)
      vu[n] = await page.evaluate(`(${REMETTRE})(${n})`)
    }
    const dit = JSON.stringify(vu)
    assert.ok(vu[1000].groupe <= 5, `recherches du groupe pendant la remise à zéro de 1 000 boutons : ${dit} — une par bouton, la remise redevient quadratique`)
    assert.ok(vu[2000].groupe <= vu[1000].groupe + 1, `recherches du groupe, 2 000 contre 1 000 : ${dit}`)
    assert.deepEqual(erreurs, [])
  })
})
