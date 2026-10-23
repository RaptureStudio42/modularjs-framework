// lire un contexte (`§clé`, `§§clé`) remonte les ancêtres du lecteur jusqu'au composant qui l'a posé. Lire une propriété d'un <form> (son
// parent, une donnée posée sur lui) passe d'abord par la recherche d'un champ de ce nom parmi les siens, liste que le navigateur refait
// après l'arrivée de chaque champ associé : des lecteurs placés entre les cases d'un grand formulaire la faisaient refaire une fois par case,
// en un temps qui croissait comme le carré de leur nombre. La remontée ne lit plus rien SUR les ancêtres :
// - aucune lecture faite sur le formulaire traversé (son parent, son hôte, une donnée de contexte), quel que soit le nombre de lecteurs
// - chaque lecteur trouve la valeur posée par le composant au-dessus du formulaire, à travers son ombre ; un contexte que personne n'a posé
//   reste indéfini
// Chromium, Firefox et WebKit réels

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { assembler } from './helpers/editeur-riche.js'

const HOTE = `<script>
  §theme    = 'sombre'
  §§reglage = { ton: 'doux' }
  $liste    = []

  µmount ->
    window.__monter = (n)-> $liste = Array.from({ length: n }, (_, i)-> i)
</script>

<form class="f" method="get" action="/envoi" @noUJS>
  {for i in $liste}<@@checkbox name={'c' + i}>{i}</@@checkbox><@lecteur></@lecteur><@lecteur-reactif></@lecteur-reactif>{end}
</form>
`

const LECTEUR = `<script>
  $t = §theme
  $a = §absent
</script>

<span class="t">{$t}</span><span class="a">{$a ?? 'indéfini'}</span>
`

const LECTEUR_REACTIF = `<script>
  $t = §§reglage.ton
</script>

<span class="t">{$t}</span>
`

// posé sur le formulaire même, avant le montage : chaque propriété que la remontée lisait sur lui (son parent, son hôte, sa racine, ses
// données de contexte) devient un accesseur propre qui compte ses lectures. L'accesseur du prototype appelé avec le formulaire pour cible
// (`parentNode` lu par `Object.getOwnPropertyDescriptor(Node.prototype, …).get`) ne passe pas par lui et ne compte pas
const COMPTER = `(() => {
  const f = document.querySelector('mjs-hote')._shadow.querySelector('form')
  window.__lu = {}
  const note = (k) => { __lu[k] = (__lu[k] || 0) + 1 }
  for (const k of ['parentNode', 'parentElement', 'host', 'getRootNode']) {
    let P = f, d
    while (P && !(d = Object.getOwnPropertyDescriptor(P, k))) P = Object.getPrototypeOf(P)
    Object.defineProperty(f, k, { configurable: true, get() { note(k); return d.get ? d.get.call(this) : d.value } })
  }
  for (const k of ['_mjs_contexts', '_mjs_rctx']) Object.defineProperty(f, k, { configurable: true, get() { note(k); return undefined } })
})()`

let construit: Promise<string> | null = null

function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('contexte-lecteurs-formulaire')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
    writeFileSync(join(srcDir, 'lecteur.mjs'), LECTEUR)
    writeFileSync(join(srcDir, 'lecteur-reactif.mjs'), LECTEUR_REACTIF)
    const manifeste = join(root, 'bundle.js')
    const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste })
    const stats     = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    return assembler(outDir, manifeste)
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`lire un contexte depuis un grand formulaire ne lit rien sur lui (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any
  const erreurs: string[] = []

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      const script = await construire()
      browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
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

  it('300 cases et 600 lecteurs (§ et §§) montés entre elles : chacun lit sa valeur, aucune lecture faite sur le formulaire', async function () {
    if (!present) { this.skip(); return }
    await page.goto('http://formulaire.test/page', { waitUntil: 'load' })
    await page.waitForFunction(`typeof window.__monter === 'function'`, null, { timeout: 30000 })
    await page.evaluate(COMPTER)
    await page.evaluate(`window.__monter(300)`)
    await page.waitForFunction(`(() => {
      const h = document.querySelector('mjs-hote')._shadow
      const l = Array.from(h.querySelectorAll('mjs-lecteur, mjs-lecteur-reactif'))
      return h.querySelectorAll('mjs-core-checkbox').length === 300 && l.length === 600 && l.every((x) => x._mjs_is_mounted && x._shadow && x._shadow.querySelector('.t') && x._shadow.querySelector('.t').textContent)
    })()`, null, { timeout: 60000 })
    const vu = await page.evaluate(`(() => {
      const h = document.querySelector('mjs-hote')._shadow
      const textes = (sel, c) => Array.from(new Set(Array.from(h.querySelectorAll(sel)).map((x) => x._shadow.querySelector(c).textContent)))
      return { lu: __lu, theme: textes('mjs-lecteur', '.t'), absent: textes('mjs-lecteur', '.a'), reglage: textes('mjs-lecteur-reactif', '.t') }
    })()`)
    assert.deepEqual(vu.theme, ['sombre'], JSON.stringify(vu))
    assert.deepEqual(vu.reglage, ['doux'], JSON.stringify(vu))
    assert.deepEqual(vu.absent, ['indéfini'], JSON.stringify(vu))
    assert.deepEqual(vu.lu, {}, `lectures faites sur le formulaire par la remontée des lecteurs : ${JSON.stringify(vu.lu)} — une par lecteur, le montage redevient quadratique`)
    assert.deepEqual(erreurs, [])
  })
})
