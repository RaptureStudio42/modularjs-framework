// monter un grand groupe radio, ou beaucoup de cases, demande au module un travail en proportion du nombre de modules : deux mille en
// demandent deux fois mille, jamais quatre fois — un groupe se résout une fois, pas une fois par bouton (une seule recherche de ses boutons,
// un passage de validité par bouton), et une case valide ne dit rien au formulaire à son montage
// - le travail se compte (recherches du groupe, validités calculées, validités écrites au navigateur), jamais au chronomètre : le temps
//   dépend aussi du navigateur et de la charge de la machine ; il est donné dans le message, pour lecture
// - le groupe obligatoire est bien validé à la fin du montage (tous ses boutons manquent), chaque case est montée
// Chromium réel

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { assembler } from './helpers/editeur-riche.js'

const PAGE = `<script>
  $radios = []
  $cases  = []

  µmount ->
    window.__monter = (sorte, n)->
      liste = Array.from({ length: n }, (_, i)-> i)
      if sorte is 'radios' then $radios = liste else $cases = liste
</script>

<form class="f" method="get" action="/envoi" @noUJS>
  {for i in $radios}<@@radio name="g" value={i} required={i is 0}>{i}</@@radio>{end}
  {for i in $cases}<@@checkbox name={'c' + i}>{i}</@@checkbox>{end}
</form>
`

// le travail du montage de n modules, dans une page neuve, jusqu'à ce que tous soient montés et, pour le groupe, validé (son dernier
// bouton manque) : les recherches des boutons du groupe, les validités calculées (µ._mjs_formValid), celles écrites au navigateur
// (setValidity), et le temps
const MESURE = `async ([sorte, n]) => {
  const h   = document.querySelector('mjs-hote')
  const sel = sorte === 'radios' ? 'mjs-core-radio' : 'mjs-core-checkbox'
  const c   = { groupe: 0, validite: 0, ecrite: 0 }
  const fv  = µ._mjs_formValid
  const sv  = ElementInternals.prototype.setValidity
  const qe  = Element.prototype.querySelectorAll
  const qf  = DocumentFragment.prototype.querySelectorAll
  µ._mjs_formValid = function () { c.validite++; return fv.apply(this, arguments) }
  ElementInternals.prototype.setValidity = function () { c.ecrite++; return sv.apply(this, arguments) }
  Element.prototype.querySelectorAll = function (s) { if (String(s).includes('mjs-core-radio[')) c.groupe++; return qe.call(this, s) }
  DocumentFragment.prototype.querySelectorAll = function (s) { if (String(s).includes('mjs-core-radio[')) c.groupe++; return qf.call(this, s) }
  const t0  = performance.now()
  window.__monter(sorte, n)
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 0))
    const m = h._shadow.querySelectorAll(sel)
    if (m.length !== n || !m[n - 1]._mjs_is_mounted || !m[0]._mjs_is_mounted) continue
    if (sorte === 'radios' && !m[n - 1].matches(':invalid')) continue
    c.ms = Math.round(performance.now() - t0)
    return c
  }
}`

let construit: Promise<string> | null = null

function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('formulaire-montage-lineaire')
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

describe('monter mille ou deux mille modules du formulaire demande un travail en proportion (chromium réel)', function () {
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
      await page.addInitScript('window.__name = (f) => f;')
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
      const contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`
      await page.route('http://formulaire.test/**', (route: any) => route.fulfill({ status: 200, contentType: 'text/html', body: contenu }))
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // le travail de chaque taille, chacune dans une page neuve
  async function compter(sorte: string) {
    const vu: Record<number, any> = {}
    for (const n of [1000, 2000]) {
      await page.goto('http://formulaire.test/page', { waitUntil: 'load' })
      await page.waitForFunction(`typeof window.__monter === 'function'`, null, { timeout: 30000 })
      vu[n] = await page.evaluate(`(${MESURE})(${JSON.stringify([sorte, n])})`)
    }
    return vu
  }

  it('un groupe radio obligatoire de 2 000 boutons : le groupe se cherche autant de fois que pour 1 000, la validité deux fois plus, pas quatre', async function () {
    if (!present) { this.skip(); return }
    const vu = await compter('radios')
    const dit = JSON.stringify(vu)
    assert.ok(vu[2000].groupe <= vu[1000].groupe + 2, `recherches du groupe : ${dit} — une par bouton, le coût redevient quadratique`)
    assert.ok(vu[2000].validite / vu[1000].validite < 3, `validités calculées, rapport 2 000 / 1 000 : ${dit}`)
    assert.ok(vu[2000].ecrite / vu[1000].ecrite < 3, `validités écrites, rapport 2 000 / 1 000 : ${dit}`)
    assert.deepEqual(erreurs, [])
  })

  it('2 000 cases facultatives : aucune validité écrite au navigateur, les validités calculées deux fois plus que pour 1 000', async function () {
    if (!present) { this.skip(); return }
    const vu = await compter('cases')
    const dit = JSON.stringify(vu)
    assert.equal(vu[2000].ecrite, 0, `une case valide ne dit rien au formulaire à son montage : ${dit}`)
    assert.ok(vu[2000].validite / vu[1000].validite < 3, `validités calculées, rapport 2 000 / 1 000 : ${dit}`)
    assert.deepEqual(erreurs, [])
  })
})
