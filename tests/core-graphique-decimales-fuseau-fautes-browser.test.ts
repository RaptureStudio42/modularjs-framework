// module cœur <@@chart> : la précision (`decimals`, un entier de 0 à 10), dans Chromium, Firefox et WebKit réels, en développement et en
// production. Chaque mesure que le graphique écrit a exactement ce nombre de chiffres après la virgule : graduations, bulle, tableau des
// valeurs, bornes de l'histogramme, valeurs et total de l'anneau ; les graduations s'espacent d'au moins 10^-N (jamais deux graduations
// écrites pareil) ; les effectifs (un nombre de valeurs) et les parts en pour cent gardent leur écriture ; sans l'option, rien ne change.
// Venue d'une variable, une précision hors de 0 à 10 ou non entière, une zone qui n'est ni local ni connue d'Intl écrivent une µ.error,
// une fois, puis la valeur par défaut. Un anneau par série dont une série n'a pas de total positif le dit en développement, sauf quand
// la barre d'outils a choisi l'anneau.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { construire, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const PAGE = `<script>
  $poids     = [{ id: 'a', x: '2026-09-01', poids: 72 }, { id: 'b', x: '2026-09-03', poids: 73.25 }, { id: 'c', x: '2026-09-05', poids: 71.5 }]
  $kg        = [{ key: 'poids', name: 'Poids', unit: 'kg' }]
  $petit     = [{ x: 'a', v: 0.2 }, { x: 'b', v: 1.4 }, { x: 'c', v: 0.9 }]
  $v         = [{ key: 'v', name: 'Valeur' }]
  $mesures   = [${[1.02, 1.07, 1.31, 1.48, 1.52, 1.9, 2.05, 2.4].map((n, i) => `{ x: 'm${i}', poids: ${n} }`).join(', ')}]
  $trois     = [{ x: '2026-09-01', lecture: 2, sport: 4 }, { x: '2026-09-02', lecture: 3, sport: 4 }, { x: '2026-09-03', lecture: 5, sport: 4 }]
  $deuxH     = [{ key: 'lecture', name: 'Lecture', unit: 'h' }, { key: 'sport', name: 'Sport', unit: 'h' }]
  $instants  = [{ x: '2026-10-19T08:15:00Z', v: 2 }, { x: '2026-10-19T23:30:00+02:00', v: 5 }]
  $signes    = [{ key: 'plus', name: 'Plus', unit: 'h' }, { key: 'moins', name: 'Moins', unit: 'h' }]
  $negatifs  = [{ x: 'a', plus: 3, moins: -2 }, { x: 'b', plus: 4, moins: 0 }]
  $comptes   = [{ key: 'gain', name: 'Gain', unit: '€' }, { key: 'perte', name: 'Perte', unit: '€' }]
  $soldes    = [{ x: 'a', gain: 3, perte: -2 }, { x: 'b', gain: 4, perte: -1 }]
  $deux      = 2
  $onze      = 11
  $demi      = '2.5'
  $mauvaise  = 'Europe/Pariss'
</script>

<@@chart class="d1" rows={$poids} series={$kg} decimals="2"></@@chart>
<@@chart class="d2" rows={$petit} series={$v} decimals="0"></@@chart>
<@@chart class="d3" rows={$mesures} series={$kg} shape="histogram" decimals="1"></@@chart>
<@@chart class="d4" rows={$trois} series={$deuxH} shape="pie" decimals="2"></@@chart>
<@@chart class="d5" rows={$poids} series={$kg} decimals={$deux}></@@chart>
<@@chart class="d6" rows={$poids} series={$kg}></@@chart>
<@@chart class="f1" rows={$instants} series={$v} timezone={$mauvaise}></@@chart>
<@@chart class="f2" rows={$poids} series={$kg} decimals={$onze}></@@chart>
<@@chart class="f3" rows={$poids} series={$kg} decimals={$demi}></@@chart>
<@@chart class="n1" rows={$negatifs} series={$signes} shape="pie"></@@chart>
<@@chart class="o1" rows={$soldes} series={$comptes} toolbar="shapes"></@@chart>

<style>
  :host
    display: block
</style>
`

const SOURCES: Record<string, string> = { 'gd-page.mjs': PAGE }
const GRAPHIQUES = 11
const P = '[ModularJS] <@@chart> : '
const ERREURS = [
  P + '« Europe/Pariss » n\'est pas un fuseau connu, il est ignoré — écrivez local ou le nom d\'une zone IANA (Europe/Paris, UTC…) ; sans fuseau, les heures s\'affichent telles qu\'elles sont écrites.',
  P + 'decimals « 11 » est ignoré — écrivez un nombre entier de 0 à 10 ; sans decimals, les nombres gardent leur écriture automatique.',
  P + 'decimals « 2.5 » est ignoré — écrivez un nombre entier de 0 à 10 ; sans decimals, les nombres gardent leur écriture automatique.',
]
const AVERTISSEMENT = P + 'la série « moins » n\'a pas de total positif, l\'anneau ne lui donne aucune part.'

const construits: Record<string, Promise<{ root: string, script: string }>> = {}
const bati = (prod: boolean) => (construits[prod ? 'prod' : 'dev'] ??= construire('graphique-decimales', SOURCES, prod))

const lire = (page: any, corps: string) => page.evaluate(`(() => { const h = document.querySelector('mjs-gd-page')._shadow; const g = (c) => h.querySelector('mjs-core-chart.' + c)._shadow; ${corps} })()`)
const textes = (page: any, c: string, sel: string) => lire(page, `return [...g('${c}').querySelectorAll('${sel}')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim())`)

for (const nom of NAVIGATEURS) for (const prod of [false, true]) describe(`<@@chart> decimals, fautes de timezone et de decimals, anneau sans total positif (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
  this.timeout(240000)
  let present = false
  let browser: any = null
  let built: { root: string, script: string } = { root: '', script: '' }

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    built   = await bati(prod)
    browser = await (await import('playwright'))[nom].launch()
  })

  after(async () => {
    await browser?.close()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () { if (!present) this.skip() })

  async function ouvrir() {
    const ctx = await browser.newContext({ viewport: { width: 800, height: 900 } })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    const plantages: string[] = []
    const fautes: string[] = []
    const avis: string[] = []
    page.on('pageerror', (e: any) => plantages.push(String(e)))
    page.on('console', (m: any) => { if (m.type() === 'error') fautes.push(m.text()); else if (m.type() === 'warning') avis.push(m.text()) })
    await page.addInitScript('window.__name = function (f) { return f };')
    const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${built.script}</script>`
    await page.route('http://d.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0;padding:0 8px;font:14px sans-serif"><mjs-gd-page></mjs-gd-page>${charge}</body></html>` })
      const fichier = join(built.root, normalize(chemin))
      if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto('http://d.test/', { waitUntil: 'load' })
    try {
      await page.waitForFunction((n: number) => { const c = (document.querySelector('mjs-gd-page') as any)?._shadow?.querySelectorAll('mjs-core-chart'); return !!c && c.length === n && [...c].every((x: any) => x._shadow?.querySelector('.chart')) }, GRAPHIQUES, { timeout: 15000 })
    } catch {
      throw new Error(`la page ne démarre pas : ${plantages.join(' | ') || 'aucune erreur de page'} / console : ${fautes.concat(avis).join(' | ')}`)
    }
    await page.waitForTimeout(300)
    return { ctx, page, plantages, fautes, avis }
  }

  it('decimals : graduations, bulle, tableau, bornes de l\'histogramme, valeurs de l\'anneau avec exactement N chiffres ; effectifs et parts inchangés ; sans l\'option, rien ne change', async () => {
    const { ctx, page, plantages } = await ouvrir()
    const graduations = await textes(page, 'd1', 'text.ylabel')
    assert.deepEqual(graduations, ['71,50', '72,00', '72,50', '73,00', '73,50'])
    assert.deepEqual(await textes(page, 'd1', 'tbody td'), ['72,00 kg', '73,25 kg', '71,50 kg'])
    assert.deepEqual(await textes(page, 'd5', 'tbody td'), ['72,00 kg', '73,25 kg', '71,50 kg'], 'decimals venu d\'une variable')
    assert.deepEqual(await textes(page, 'd6', 'tbody td'), ['72 kg', '73,25 kg', '71,5 kg'], 'sans decimals')
    assert.deepEqual(await textes(page, 'd2', 'text.ylabel'), ['0', '1', '2'], 'decimals="0" : des graduations entières, jamais deux fois la même')
    assert.deepEqual(await textes(page, 'd2', 'tbody td'), ['0', '1', '1'])
    // l'histogramme : ses bornes au dixième, ses effectifs entiers
    assert.deepEqual(await textes(page, 'd3', 'text.xlabel'), ['1,0', '1,5', '2,0', '2,5'])
    assert.deepEqual(await textes(page, 'd3', 'tbody th'), ['De 1,0 à 1,5 kg', 'De 1,5 à 2,0 kg', 'De 2,0 à 2,5 kg'])
    assert.deepEqual(await textes(page, 'd3', 'tbody td'), ['4', '2', '2'])
    assert.ok((await textes(page, 'd3', 'text.ylabel')).every((t: string) => /^\d+$/.test(t)), 'les effectifs restent entiers')
    // l'anneau : le total et les valeurs à deux chiffres, les parts telles quelles
    assert.equal((await textes(page, 'd4', '.center b'))[0], '22,00 h')
    assert.deepEqual(await textes(page, 'd4', '.legend strong'), ['12,00 h', '10,00 h'])
    assert.deepEqual(await textes(page, 'd4', '.legend small'), ['54,5 %', '45,5 %'])
    // la bulle d'un point
    const z = await lire(page, `const r = g('d1').querySelector('.hit').getBoundingClientRect(); return { x: r.x, y: r.y, h: r.height }`)
    await page.mouse.move(z.x + 2, z.y + z.h / 2)
    await page.waitForTimeout(120)
    assert.deepEqual(await textes(page, 'd1', '.tip .row'), ['Poids 72,00 kg'])
    assert.deepEqual(plantages, [])
    await ctx.close()
  })

  it('une zone ou une précision fausse venue d\'une variable : une µ.error, une fois, puis la valeur par défaut ; l\'anneau sans total positif le dit en développement, pas quand la barre l\'a choisi', async () => {
    const { ctx, page, plantages, fautes, avis } = await ouvrir()
    const attente = Date.now() + 8000
    while (Date.now() < attente && !ERREURS.every((e) => fautes.includes(e))) await page.waitForTimeout(100)
    await page.waitForTimeout(300)
    // (en production, la console réécrit chaque erreur à l'arrivée du fichier des messages : l'ordre peut changer)
    assert.deepEqual(fautes.filter((f) => f.startsWith(P)).sort(), [...ERREURS].sort(), 'chaque faute, une seule fois')
    assert.match((await textes(page, 'f1', 'tbody th'))[0], /19.*08:15/, 'la zone fausse : les heures telles qu\'écrites')
    assert.deepEqual(await textes(page, 'f2', 'tbody td'), ['72 kg', '73,25 kg', '71,5 kg'], 'la précision fausse : l\'écriture automatique')
    assert.deepEqual(await textes(page, 'f3', 'tbody td'), ['72 kg', '73,25 kg', '71,5 kg'])
    assert.equal(await lire(page, `return g('n1').querySelectorAll('path.slice').length`), 1, 'la série sans total positif n\'a pas de part')
    // la barre choisit l'anneau : rien de plus en console
    await lire(page, `g('o1').querySelector('button.pick').click()`)
    await page.waitForTimeout(150)
    await lire(page, `[...g('o1').querySelectorAll('[role="menuitemradio"]')].find((n) => n.textContent.trim() === 'Anneau').click()`)
    await page.waitForTimeout(200)
    assert.equal(await lire(page, `return g('o1').querySelectorAll('path.slice').length`), 1, 'l\'anneau choisi par la barre')
    assert.deepEqual(avis.filter((a) => a.startsWith(P)), prod ? [] : [AVERTISSEMENT], 'un avertissement du développement, une fois, rien pour le choix de la barre')
    assert.equal(fautes.filter((f) => f.startsWith(P)).length, ERREURS.length, 'aucune erreur de plus')
    assert.deepEqual(plantages, [])
    await ctx.close()
  })
})
