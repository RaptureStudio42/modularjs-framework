// réglage `proxy: false` au navigateur réel : l'objet rangé dans `$o` l'est tel quel, aucun piège de Proxy ne tourne, même pour
// 1 000 lectures de `$o.a.b` ; l'écriture que le compilateur voit (`$o.a.b = 2`) redessine ; un changement fait hors de MJS (une
// fonction de la page qui reçoit l'objet) ne redessine rien, jusqu'à `µrefresh($o)` — en production comme en développement, qui
// se comporte comme elle. Le paquet de production ne porte plus l'enveloppe. Sans le réglage, rien ne change : l'enveloppe voit le
// changement fait dehors et redessine seule. Une valeur dérivée que le compilateur prouve précise et qui lit un objet repasse, sans
// enveloppe, à la règle de l'horloge : elle se refait après une écriture vue par le compilateur, après `µrefresh($o)`, et après toute
// écriture du composant (un changement fait dehors y paraît alors, comme à l'horloge) — jamais un dernier calcul périmé. Un objet
// atteint par une autre variable (`$sel = $items[0]`) : l'écriture par `$sel` redessine ce qui affiche `$sel`, la liste attend
// `µrefresh($items)` ; avec l'enveloppe, la liste suit seule. Chromium, Firefox et WebKit réels

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'
import { playTogether } from './helpers/engines-together.js'

const SOURCES: Record<string, string> = {
  'sp-objet.mjs': `<script lang="js">
  $o = { a: { b: 1 } };
  @ecrire = function() { $o.a.b = 2; };
  @dehors = function() { window.changer($o); };
  @signaler = function() { µrefresh($o); };
  @lire = function(n) { let s = 0; for (let i = 0; i < n; i++) s += $o.a.b; return s; };
  @brut = function() { return µ._mjs_toRaw($o) === $o; };
</script>
<p class="v">{$o.a.b}</p>
<p class="pret">prêt</p>
`,
  'sp-derivee.mjs': `<script>
  $o = { taux: 1, prix: [10, 20] }
  $vues = 0
  # précise par défaut : elle appelle des méthodes de liste
  $lignes = $o.prix.map((p) -> p * $o.taux).join(' · ')
  @ecrire = -> $o.taux = 2
  @dehors = -> window.changerTaux($o)
  @compter = -> $vues += 1
  @signaler = -> µrefresh($o)
</script>
<p class="v">{$o.taux + ' | ' + $lignes + ' | ' + $vues}</p>
<p class="pret">prêt</p>
`,
  'sp-liste.mjs': `<script lang="js">
  $items = [{ n: 'a' }, { n: 'b' }];
  $sel = null;
  @choisir = function() { $sel = $items[0]; };
  @renommer = function() { $sel.n = 'Z'; };
  @signaler = function() { µrefresh($items); };
</script>
<p class="l">{$items[0].n + ',' + $items[1].n}</p>
<p class="s">{$sel ? $sel.n : '-'}</p>
<p class="pret">prêt</p>
`
}

// avant le paquet : chaque piège de chaque Proxy fait par la page se compte, et la fonction « venue d'ailleurs » qui change l'objet reçu
const SONDE = `<script>
window.__pieges = 0
const P = window.Proxy
window.Proxy = new P(P, { construct(t, [cible, h]) {
  const compte = {}
  // les pièges d'un gestionnaire peuvent lui venir de son prototype (pièges communs à toutes les enveloppes) : il est suivi lui aussi
  for (let o = h; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (const k of Reflect.ownKeys(o)) {
    if (Object.hasOwn(compte, k) || k === 'constructor') continue
    const f = h[k]
    compte[k] = typeof f === 'function' ? function () { window.__pieges++; return f.apply(h, arguments) } : f
  }
  return new P(cible, compte)
} })
window.changer = (x) => { x.a.b = 3 }
window.changerTaux = (x) => { x.taux += 1 }
</script>`

// une construction : production en un seul fichier, ou développement (tout le JavaScript dans la page, le cœur d'abord)
async function construire(nom: string, opts: Record<string, unknown>, dev: boolean): Promise<Cible> {
  const root   = mjsTmp('sans-proxy-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(dev ? root : outDir, 'bundle.js'), ...(dev ? {} : { env: 'prod', js: 'bundle', urlPrefix: '/out' }), ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const page = (corps: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${SONDE}<mjs-sp-objet></mjs-sp-objet><mjs-sp-derivee></mjs-sp-derivee><mjs-sp-liste></mjs-sp-liste>${corps}</body></html>`
  if (!dev) return { mode: 'bundle', racine: root, document: () => page('<script type="module" src="/out/bundle.js"></script>') }
  const rang   = (f: string) => /^mjs_core-/.test(f) ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
  const script = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  return { mode: 'dev-parents-avant', racine: root, document: () => page(`<script>${script}</script>`) }
}

const cibles = new Map<string, Promise<Cible>>()
const cible  = (nom: string, opts: Record<string, unknown>, dev = false) => {
  if (!cibles.has(nom)) cibles.set(nom, construire(nom, opts, dev))
  return cibles.get(nom) as Promise<Cible>
}

// tout le JavaScript que la production a écrit
const paquet = (c: Cible): string => readdirSync(join(c.racine, 'out')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(c.racine, 'out', f), 'utf-8')).join('\n')

const B     = 'document.querySelector(\'mjs-sp-objet\')'
const vu    = (page: any): Promise<string> => page.evaluate(`${B}._shadow.querySelector('p.v').textContent`)
const appel = async (page: any, quoi: string) => {
  const r = await page.evaluate(`(() => ${B}.${quoi})()`)
  await page.waitForTimeout(150)
  return r
}

// le parcours de la démo : premier rendu, écriture compilée, changement fait dehors, µrefresh, 1 000 lectures de `$o.a.b`
async function parcours(browser: any, c: Cible) {
  const o = await charger(browser, c, 'mjs-sp-objet')
  try {
    await o.page.waitForFunction(`!!${B}?._shadow?.querySelector('.pret')`, null, { timeout: 10000 })
    await o.page.waitForTimeout(100)
    const r: Record<string, unknown> = { depart: await vu(o.page) }
    await appel(o.page, 'ecrire()')
    r.ecrit = await vu(o.page)
    await appel(o.page, 'dehors()')
    r.dehors = await vu(o.page)
    await appel(o.page, 'signaler()')
    r.signale = await vu(o.page)
    r.somme = await appel(o.page, 'lire(1000)')
    r.brut = await appel(o.page, 'brut()')
    r.pieges = await o.page.evaluate('window.__pieges')
    assert.deepEqual(graves(o), [], 'aucune erreur')
    return r
  } finally {
    await o.fermer()
  }
}

// la scène de la valeur dérivée : écriture compilée, changement fait dehors, écriture d'une autre variable, changement fait dehors puis µrefresh
async function parcoursDerivee(browser: any, c: Cible) {
  const D = 'document.querySelector(\'mjs-sp-derivee\')'
  const o = await charger(browser, c, 'mjs-sp-objet')
  try {
    await o.page.waitForFunction(`!!${D}?._shadow?.querySelector('.pret')`, null, { timeout: 10000 })
    await o.page.waitForTimeout(100)
    const ecran = (): Promise<string> => o.page.evaluate(`${D}._shadow.querySelector('p.v').textContent`)
    const faire = async (quoi: string) => {
      await o.page.evaluate(`(() => { ${D}.${quoi}; return null })()`)
      await o.page.waitForTimeout(150)
    }
    const r: string[] = [await ecran()]
    for (const quoi of ['ecrire()', 'dehors()', 'compter()']) {
      await faire(quoi)
      r.push(await ecran())
    }
    await faire('dehors()')
    await faire('signaler()')
    r.push(await ecran())
    assert.deepEqual(graves(o), [], 'aucune erreur')
    return r
  } finally {
    await o.fermer()
  }
}

// l'objet atteint par deux variables : choisi dans la liste, renommé par `$sel`, puis µrefresh($items) ; l'écran, liste | choix
async function parcoursListe(browser: any, c: Cible) {
  const L = 'document.querySelector(\'mjs-sp-liste\')'
  const o = await charger(browser, c, 'mjs-sp-objet')
  try {
    await o.page.waitForFunction(`!!${L}?._shadow?.querySelector('.pret')`, null, { timeout: 10000 })
    await o.page.waitForTimeout(100)
    const ecran = (): Promise<string> => o.page.evaluate(`${L}._shadow.querySelector('p.l').textContent + '|' + ${L}._shadow.querySelector('p.s').textContent`)
    const r: string[] = [await ecran()]
    for (const quoi of ['choisir()', 'renommer()', 'signaler()']) {
      await o.page.evaluate(`(() => { ${L}.${quoi}; return null })()`)
      await o.page.waitForTimeout(150)
      r.push(await ecran())
    }
    assert.deepEqual(graves(o), [], 'aucune erreur')
    return r
  } finally {
    await o.fermer()
  }
}

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) playTogether(describe(`état sans Proxy, réglage proxy: false (${moteur} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[moteur].executablePath())
    if (!present) { console.log(`  ℹ️  ${moteur} non installé, test de l'état sans Proxy sauté. Activer : \`npx playwright install ${moteur}\``); return }
    browser = await playwright[moteur].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('production : aucun piège, l\'écriture compilée redessine, le changement fait dehors attend µrefresh, le paquet n\'a plus l\'enveloppe', async function () {
    if (!present) { this.skip(); return }
    const c = await cible('sans-prod', { proxy: false })
    assert.ok(!paquet(c).includes('setUTCMilliseconds'), 'l\'enveloppe de l\'état (ses méthodes de Date qui modifient) est encore dans le paquet')
    const r = await parcours(browser, c)
    console.log(`  ℹ️  ${moteur}, production sans Proxy : ${r.pieges} piège(s) de Proxy`)
    assert.deepEqual(r, { depart: '1', ecrit: '2', dehors: '2', signale: '3', somme: 3000, brut: true, pieges: 0 })
  })

  it('développement : le même comportement que la production, sans enveloppe', async function () {
    if (!present) { this.skip(); return }
    const r = await parcours(browser, await cible('sans-dev', { proxy: false }, true))
    assert.deepEqual(r, { depart: '1', ecrit: '2', dehors: '2', signale: '3', somme: 3000, brut: true, pieges: 0 })
  })

  it('une valeur dérivée précise qui lit un objet repasse à l\'horloge : refaite après l\'écriture compilée, après toute écriture du composant et après µrefresh, en production comme en développement', async function () {
    if (!present) { this.skip(); return }
    // à l'horloge, l'écriture de $vues refait $lignes au taux changé dehors (3) ; restée précise, elle aurait servi « 20 · 40 »
    const attendu = ['1 | 10 · 20 | 0', '2 | 20 · 40 | 0', '2 | 20 · 40 | 0', '3 | 30 · 60 | 1', '4 | 40 · 80 | 1']
    assert.deepEqual(await parcoursDerivee(browser, await cible('sans-prod', { proxy: false })), attendu, 'production')
    assert.deepEqual(await parcoursDerivee(browser, await cible('sans-dev', { proxy: false }, true)), attendu, 'développement')
  })

  it('un objet atteint par une autre variable : l\'écriture par `$sel` redessine ce qui affiche `$sel`, la liste attend µrefresh($items)', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await parcoursListe(browser, await cible('sans-prod', { proxy: false })), ['a,b|-', 'a,b|a', 'a,b|Z', 'Z,b|Z'])
  })

  it('sans le réglage, rien ne change : l\'enveloppe voit le changement fait dehors et redessine seule', async function () {
    if (!present) { this.skip(); return }
    const c = await cible('avec-prod', {})
    assert.ok(paquet(c).includes('setUTCMilliseconds'), 'l\'enveloppe de l\'état manque au paquet par défaut')
    const r = await parcours(browser, c)
    console.log(`  ℹ️  ${moteur}, production avec Proxy (défaut) : ${r.pieges} piège(s) de Proxy`)
    assert.ok((r.pieges as number) >= 2000, `1 000 lectures de $o.a.b passent chacune par deux pièges (a, puis b) : ${r.pieges} compté(s)`)
    assert.deepEqual({ ...r, pieges: 0 }, { depart: '1', ecrit: '2', dehors: '3', signale: '3', somme: 3000, brut: false, pieges: 0 })
    // la valeur dérivée : l'enveloppe voit chaque changement fait dehors, qui la refait aussitôt
    assert.deepEqual(await parcoursDerivee(browser, c), ['1 | 10 · 20 | 0', '2 | 20 · 40 | 0', '3 | 30 · 60 | 0', '3 | 30 · 60 | 1', '4 | 40 · 80 | 1'])
    // l'objet atteint par deux variables : la liste suit l'écriture faite par `$sel`
    assert.deepEqual(await parcoursListe(browser, c), ['a,b|-', 'a,b|a', 'Z,b|Z', 'Z,b|Z'])
  })
}))
