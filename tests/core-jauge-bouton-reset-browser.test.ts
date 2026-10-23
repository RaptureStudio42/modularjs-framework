// `form.reset()` sur la jauge et le bouton rotatif du cœur (<@@gauge>, <@@knob>) : ils reviennent à la valeur de départ de leur
// formulaire, comme la case, l'interrupteur, le radio, le nombre et la liste. Ils gardaient la dernière valeur de l'utilisateur :
// le formulaire soumis après un « réinitialiser » envoyait encore la valeur cliquée ou tournée.
// - la valeur de départ est celle que la page pose (en dur, par expression, lue dans la variable liée, ou celle du module quand la page n'en dit rien) ;
// - la remise n'annonce aucun `change` (un champ natif n'en annonce pas non plus : c'est le formulaire qui dit son `reset`), et la
//   variable liée revient avec la valeur ;
// - une remise annulée (`preventDefault`), sur le formulaire ou après coup par un écouteur de remontée posé plus haut, ne change rien ;
// - le geste en cours (flèche tenue, molette) s'arrête avec la remise : son relâchement n'annonce rien, le geste suivant annonce son `change` ;
// - la remise suit le formulaire où le module EST : déplacé vers un autre formulaire, retiré puis remis, né hors de tout formulaire
//   puis rangé dans l'un.
// Chromium et Firefox réels, en développement (un script) et avec un vrai build de production (minifié, un morceau par module) :
// un vrai bouton « reset », une vraie touche, les données du formulaire lues par FormData.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const PAGE = `<script>
  $g   = 4
  $k   = 30
  $log = ''
</script>

<form class="f" @noUJS>
  <@@gauge class="g" name="g" value="4" @change={$log = $log + '[g' + e.data + ']'}></@@gauge>
  <@@gauge class="gl" name="gl" value=!{$g} @change={$log = $log + '[gl' + e.data + ']'}></@@gauge>
  <@@gauge class="g0" name="g0" @change={$log = $log + '[g0' + e.data + ']'}></@@gauge>
  <@@gauge class="gw" name="gw" value="4" wheel @change={$log = $log + '[gw' + e.data + ']'}></@@gauge>
  <@@gauge class="ge" name="ge" value={5} @change={$log = $log + '[ge' + e.data + ']'}></@@gauge>
  <@@knob class="k" name="k" value="30" @change={$log = $log + '[k' + e.data + ']'}></@@knob>
  <@@knob class="kl" name="kl" value=!{$k} @change={$log = $log + '[kl' + e.data + ']'}></@@knob>
  <@@knob class="k0" name="k0" @change={$log = $log + '[k0' + e.data + ']'}></@@knob>
  <@@knob class="ke" name="ke" value={35} @change={$log = $log + '[ke' + e.data + ']'}></@@knob>
  <button type="reset" class="rz">Remise à zéro</button>
</form>
<form class="f2" @noUJS>
  <button type="reset" class="rz2">Remise à zéro</button>
</form>
<div class="hors"><@@gauge class="gh" name="gh" value="2"></@@gauge><@@knob class="kh" name="kh" value="40"></@@knob></div>
`

const DEPART = [['g', '4'], ['gl', '4'], ['g0', '0'], ['gw', '4'], ['ge', '5'], ['k', '30'], ['kl', '30'], ['k0', '50'], ['ke', '35']]
const CHANGE = [['g', '6'], ['gl', '6'], ['g0', '2'], ['gw', '4'], ['ge', '7'], ['k', '33'], ['kl', '33'], ['k0', '53'], ['ke', '38']]
const VUES    = { g: '4', gl: '4', g0: '0', gw: '4', ge: '5', k: '30', kl: '30', k0: '50', ke: '35' }

type Construit = { dev: string; fichiers: Map<string, Buffer> }
let construit: Promise<Construit> | null = null

// le script de développement (cœur, modules, hôte) et le build de production en mémoire, une seule fois pour les deux navigateurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('jauge-bouton-reset')
    const srcDir = join(root, 'src')
    const devDir = join(root, 'dev')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), PAGE)
    const dev = new Bundler({ sourceDir: srcDir, outputDir: devDir, manifestPath: join(devDir, 'bundle.js') })
    const statsDev = await dev.compile()
    await dev.close()
    assert.equal(statsDev.errors.length, 0, statsDev.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(devDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    const script = ordre.map((f) => stripEsm(readFileSync(join(devDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const prod = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), js: 'split', env: 'prod' } as any)
    const statsProd = await prod.compile()
    await prod.close()
    assert.equal(statsProd.errors.length, 0, statsProd.errors.map((e: any) => e.message).join('\n'))
    const fichiers = new Map<string, Buffer>()
    for (const f of readdirSync(outDir)) if (/\.(js|json)$/.test(f)) fichiers.set(f, readFileSync(join(outDir, f)))
    assert.ok(fichiers.has('bundle.js') && [...fichiers.keys()].some((f) => /^core-gauge-/.test(f)) && [...fichiers.keys()].some((f) => /^core-knob-/.test(f)), 'le build de production sépare un morceau par module')
    return { dev: script, fichiers }
  })()
  return construit
}

for (const build of ['développement', 'production'] as const) for (const nom of ['chromium', 'firefox'] as const) describe(`form.reset() : la jauge et le bouton rotatif reviennent à leur valeur de départ (${build}, ${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any
  let fait: Construit

  const attendre = (ms = 250) => page.waitForTimeout(ms)
  const donnees  = async (f = '.f') => JSON.parse(await page.evaluate(`JSON.stringify([...new FormData(__q('${f}')).entries()])`))
  const etat     = (nomVar: string) => page.evaluate(`document.querySelector('mjs-hote')._state.${nomVar}`)
  // sous charge, la remise peut tarder : on attend l'état voulu (jusqu'à 8 s) avant de comparer
  const jusqua   = async (attendu: string[][], f = '.f') => {
    const fin = Date.now() + 8000
    while (Date.now() < fin && JSON.stringify(await donnees(f)) !== JSON.stringify(attendu)) await page.waitForTimeout(100)
  }

  // ce que montrent les modules : le nombre de la jauge, la valeur du cadran
  const vu = () => page.evaluate(`(() => {
    const r = {}
    for (const c of ['g', 'gl', 'g0', 'gw', 'ge']) r[c] = __q('.' + c)._shadow.querySelector('output').textContent.trim()
    for (const c of ['k', 'kl', 'k0', 'ke']) r[c] = __q('.' + c)._shadow.querySelector('.knob').getAttribute('aria-valuenow')
    return r
  })()`)

  // les gestes d'un utilisateur : « + » deux fois sur chaque jauge (hors molette), flèche haute trois fois sur chaque bouton rotatif
  const plus = (cls: string) => page.evaluate(`__q('.${cls}')._shadow.querySelectorAll('button.btn')[0].click()`)
  const haut = async (cls: string) => {
    await page.evaluate(`__q('.${cls}')._shadow.querySelector('.knob').focus()`)
    await page.keyboard.press('ArrowUp')
  }
  async function modifier() {
    for (const cls of ['g', 'gl', 'g0', 'ge']) { await plus(cls); await plus(cls) }
    for (const cls of ['k', 'kl', 'k0', 'ke']) { await haut(cls); await haut(cls); await haut(cls) }
    await attendre()
  }

  async function charger() {
    await page.goto('http://jauge-bouton.test/page', { waitUntil: 'load' })
    await page.waitForFunction(`(() => {
      const h = document.querySelector('mjs-hote')
      const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('mjs-core-gauge, mjs-core-knob')) : []
      return m.length === 11 && m.every((x) => x.matches(':defined') && !x.hasAttribute('mjs-loading') && x._shadow && x._shadow.firstElementChild)
    })()`, undefined, { timeout: 60000 })
    await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)`)
    await page.waitForTimeout(500)
  }

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      fait    = await construire()
      browser = await playwright[nom].launch()
      page    = await browser.newPage({ viewport: { width: 1100, height: 900 } })
      await page.addInitScript('window.__name = (f) => f')
      await page.route('http://jauge-bouton.test/**', async (route: any) => {
        const url = new URL(route.request().url())
        if (url.pathname.startsWith('/out/')) {
          const corps = fait.fichiers.get(url.pathname.slice(5))
          if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
          await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
          return
        }
        const script = build === 'développement' ? `<script>${fait.dev}</script>` : '<script type="module" src="/out/bundle.js"></script>'
        await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote>${script}</body></html>` })
      })
    } catch (e) { present = false; throw e }
  })

  beforeEach(async function () {
    if (!present) { this.skip(); return }
    await charger()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('au départ : le formulaire envoie les valeurs posées par la page ou celles du module', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await donnees(), DEPART)
    assert.deepEqual(await vu(), VUES)
  })

  it('le bouton « reset » rend chaque jauge et chaque bouton rotatif à sa valeur de départ, les variables liées avec, sans aucun change', async function () {
    if (!present) { this.skip(); return }
    await modifier()
    assert.deepEqual(await donnees(), CHANGE, 'préalable : les gestes ont changé le formulaire')
    assert.deepEqual([await etat('g'), await etat('k')], [6, 33], 'préalable : les variables liées ont suivi')
    const journal = await etat('log')
    assert.ok(journal.includes('[g6]') && journal.includes('[k33]'), `préalable : les gestes ont annoncé leurs change — ${journal}`)
    await page.evaluate(`__q('.rz').click()`)
    await jusqua(DEPART)
    assert.deepEqual(await donnees(), DEPART, 'les données envoyées')
    assert.deepEqual(await vu(), VUES, 'ce que montrent les modules')
    assert.deepEqual([await etat('g'), await etat('k')], [4, 30], 'les variables liées')
    await attendre(600)
    assert.equal(await etat('log'), journal, 'aucun change annoncé par la remise')
  })

  it('form.reset() par le script : même retour, et un geste refait ensuite marche, change compris', async function () {
    if (!present) { this.skip(); return }
    await modifier()
    assert.deepEqual(await donnees(), CHANGE, 'préalable')
    await page.evaluate(`__q('.f').reset()`)
    await jusqua(DEPART)
    assert.deepEqual(await donnees(), DEPART)
    await attendre(300)
    const journal = await etat('log')
    await plus('g')
    await haut('k')
    await attendre()
    assert.deepEqual((await donnees()).filter((p: string[]) => ['g', 'k'].includes(p[0])), [['g', '5'], ['k', '31']], 'les gestes d\'après la remise changent les valeurs')
    assert.equal(await etat('log'), journal + '[g5][k31]', 'et annoncent chacun leur change')
  })

  it('une remise annulée par le formulaire (preventDefault) ne change rien ; sans l\'annulation, la remise a lieu', async function () {
    if (!present) { this.skip(); return }
    await modifier()
    await page.evaluate(`window.__annule = (e) => e.preventDefault(); __q('.f').addEventListener('reset', window.__annule, true)`)
    await page.evaluate(`__q('.rz').click()`)
    await attendre(600)
    assert.deepEqual(await donnees(), CHANGE, 'le formulaire reste tel que l\'utilisateur l\'a laissé')
    await page.evaluate(`__q('.f').removeEventListener('reset', window.__annule, true)`)
    await page.evaluate(`__q('.rz').click()`)
    await jusqua(DEPART)
    assert.deepEqual(await donnees(), DEPART, 'sans l\'annulation, la remise a lieu')
  })

  it('un écouteur de remontée posé après le montage, sur le formulaire ou plus haut, annule la remise : la jauge et le bouton rotatif ne se remettent pas à moitié', async function () {
    if (!present) { this.skip(); return }
    for (const cible of [`__q('.f')`, `document.querySelector('mjs-hote')._shadow`]) {
      await modifier()
      const avant = await donnees()
      await page.evaluate(`window.__annule = (e) => e.preventDefault(); ${cible}.addEventListener('reset', window.__annule)`)
      await page.evaluate(`__q('.rz').click()`)
      await attendre(600)
      assert.deepEqual(await donnees(), avant, `${cible} : rien ne bouge`)
      await page.evaluate(`${cible}.removeEventListener('reset', window.__annule)`)
      await page.evaluate(`__q('.f').reset()`)
      await jusqua(DEPART)
      assert.deepEqual(await donnees(), DEPART, `${cible} : sans l'annulation, tout revient`)
    }
  })

  it('une flèche tenue pendant la remise : son relâchement n\'annonce rien, et le geste suivant annonce son change', async function () {
    if (!present) { this.skip(); return }
    await page.evaluate(`__q('.g')._shadow.querySelector('.spinner').focus()`)
    await page.keyboard.press('ArrowUp')
    await attendre()
    assert.equal(await etat('log'), '[g5]', 'préalable : un geste complet, un change')
    await page.keyboard.down('ArrowUp')
    await attendre()
    assert.equal((await donnees())[0][1], '6', 'préalable : la flèche tenue a fait un pas')
    await page.evaluate(`__q('.f').reset()`)
    await jusqua(DEPART)
    assert.equal((await donnees())[0][1], '4', 'la remise rend la valeur de départ')
    await page.keyboard.up('ArrowUp')
    await attendre(400)
    assert.equal(await etat('log'), '[g5]', 'le relâchement après la remise n\'annonce rien')
    await page.keyboard.press('ArrowUp')
    await attendre()
    assert.equal(await etat('log'), '[g5][g5]', 'de 4 à 5 après la remise : un change, comme la première fois')
  })

  it('un geste de molette en cours est coupé par la remise : son change ne part pas en retard au milieu du geste suivant', async function () {
    if (!present) { this.skip(); return }
    // tout dans une seule évaluation : la molette, la remise, puis la flèche tenue 40 ms après, bien avant la fin du délai de la molette (200 ms)
    await page.evaluate(`(async () => {
      const gw    = __q('.gw')._shadow
      window.__touche = (type) => gw.querySelector('.spinner').dispatchEvent(new KeyboardEvent(type, { key: 'ArrowUp', bubbles: true, cancelable: true }))
      gw.querySelector('.box').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, deltaMode: 0, bubbles: true, cancelable: true }))
      __q('.f').reset()
      await new Promise((r) => setTimeout(r, 40))
      window.__touche('keydown')
    })()`)
    await attendre(500)
    assert.equal(await etat('log'), '', 'la flèche est encore tenue : aucun change ne part avant son relâchement')
    await page.evaluate(`window.__touche('keyup')`)
    await attendre(300)
    assert.equal(await etat('log'), '[gw5]', 'au relâchement, un seul change')
  })

  it('un module déplacé vers un autre formulaire, retiré puis remis, ou né hors de tout formulaire : la remise du formulaire où il est le rend à sa valeur de départ', async function () {
    if (!present) { this.skip(); return }
    const lire       = async (f: string) => JSON.parse(await page.evaluate(`JSON.stringify([...new FormData(__q('${f}')).entries()].filter((p) => p[0] === 'gh' || p[0] === 'kh'))`))
    const jusquaLire = async (f: string, attendu: string[][]) => {
      const fin = Date.now() + 8000
      while (Date.now() < fin && JSON.stringify(await lire(f)) !== JSON.stringify(attendu)) await page.waitForTimeout(100)
    }
    const geste  = async () => { await plus('gh'); await haut('kh'); await attendre() }
    const ranger = (f: string) => page.evaluate(`(() => { const f = __q('${f}'); f.appendChild(__q('.gh')); f.appendChild(__q('.kh')) })()`)
    const DEPART_HORS = [['gh', '2'], ['kh', '40']]
    const CHANGE_HORS = [['gh', '3'], ['kh', '41']]
    // nés hors de tout formulaire (leur départ est pris là), puis rangés dans l'un : la remise de ce formulaire les rend
    await ranger('.f')
    await attendre()
    await geste()
    assert.deepEqual(await lire('.f'), CHANGE_HORS, 'préalable : les gestes ont changé les valeurs')
    await page.evaluate(`__q('.rz').click()`)
    await jusquaLire('.f', DEPART_HORS)
    assert.deepEqual(await lire('.f'), DEPART_HORS, 'nés hors formulaire, rangés dans l\'un : la remise les rend')
    // déplacés vers un autre formulaire : la remise de l'ancien ne les touche plus, celle du nouveau les rend
    await ranger('.f2')
    await attendre()
    await geste()
    assert.deepEqual(await lire('.f2'), CHANGE_HORS, 'préalable')
    await page.evaluate(`__q('.rz').click()`)
    await attendre(600)
    assert.deepEqual(await lire('.f2'), CHANGE_HORS, 'la remise de l\'ancien formulaire ne les concerne plus')
    await page.evaluate(`__q('.rz2').click()`)
    await jusquaLire('.f2', DEPART_HORS)
    assert.deepEqual(await lire('.f2'), DEPART_HORS, 'la remise du nouveau formulaire les rend')
    // retirés de la page puis remis plus tard dans un formulaire : la remise les rend encore
    await page.evaluate(`(() => { window.__sortis = [__q('.gh'), __q('.kh')]; window.__sortis.forEach((e) => e.remove()) })()`)
    await attendre(500)
    await page.evaluate(`(() => { const f = __q('.f'); window.__sortis.forEach((e) => f.appendChild(e)) })()`)
    await attendre()
    await geste()
    assert.deepEqual(await lire('.f'), CHANGE_HORS, 'préalable')
    await page.evaluate(`__q('.rz').click()`)
    await jusquaLire('.f', DEPART_HORS)
    assert.deepEqual(await lire('.f'), DEPART_HORS, 'après le retour, la remise les rend')
  })
})
