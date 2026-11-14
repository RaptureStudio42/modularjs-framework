// une donnée garde ses propres nœuds : les nœuds de la ligne d'une donnée (ses éléments, ses nœuds texte) ne servent jamais à une autre
// donnée — remplacement complet d'une liste à clé par des clés neuves, vidage puis remplissage, retrait puis ajout, bloc remplacé au milieu,
// liste sans clé (un objet neuf a une ligne neuve), nœuds texte des branches `{await}` (succès et erreur alternés : chaque branche est
// refaite, aucune ne reçoit un nœud de celle d'avant). Une donnée qui reste (même clé, ou même objet sans clé) garde ses nœuds, déplacée ou
// non. Chaque nœud vu reçoit à la main la marque de sa donnée ; une marque d'une autre donnée sur une ligne est une reprise. Après un vidage, aucune ligne retirée n'est retenue : le ramasse-miettes de Chromium
// (le seul des trois qui s'appelle de la page) les emporte toutes. Enveloppe et `proxy: false`, développement et production ; Chromium,
// Firefox et WebKit réels

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  'gn-liste.mjs': `<script>
  $cles = []
  $objs = []
  $mem  = []

  @poserCles = (l) -> $cles = l
  @poserObjs = (l) -> $objs = l
  @poserMem  = (l) -> $mem = l
</script>
<ul class="k">{for r in $cles by id}<li><b>{r.id}</b> <i>{r.label}</i></li>{end}</ul>
<ol class="k2"><li class="tete">tête</li>{for r in $cles by id}<li><b>{r.id}</b> <i>{r.label}</i></li>{end}</ol>
<ul class="u">{for o in $objs}<li><b>{o.uid}</b> <i>{o.label}</i></li>{end}</ul>
<ul class="m">{for r in $mem by id}<li><b>{r.id}</b> <i>{r.label}</i></li>{end}</ul>
<p class="pret">prêt</p>
`,
  'gn-attente.mjs': `<script>
  $n = 1
  $p = Promise.resolve({ label: 'A', on: true })

  @reussir = (v) -> $p = Promise.resolve(v)
  @echouer = (m) ->
    p = Promise.reject(new Error(m))
    p.catch(-> null)
    $p = p
</script>
<div class="a">{await $p}<i class="att">attente {$n}</i>{success v}<b class="t">{v.label} {$n}</b>{if v.on}<s>{v.label}</s>{end}{error err}<u class="t">{err.message} {$n}</u>{end}</div>
<p class="pret">prêt</p>
`
}

const enveloppe = (corps: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${corps}</body></html>`

async function construire(prod: boolean, opts: Record<string, unknown>): Promise<Cible> {
  const root   = mjsTmp('donnee-noeuds-' + (prod ? 'prod' : 'dev'))
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), source)
  const base: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(prod ? outDir : root, 'bundle.js'), ...opts }
  if (prod) Object.assign(base, { env: 'prod', js: 'bundle', urlPrefix: '/out' })
  const bundler = new Bundler(base)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const corps = '<mjs-gn-liste></mjs-gn-liste><mjs-gn-attente></mjs-gn-attente>'
  if (prod) return { mode: 'bundle', racine: root, document: () => enveloppe(`${corps}<script type="module" src="/out/bundle.js"></script>`) }
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang   = (f: string) => /^mjs_core-/.test(f) ? 0 : f.startsWith('mjs_') ? 1 : 2
  const script = files.sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  return { mode: 'dev-parents-avant', racine: root, document: () => enveloppe(`${corps}<script>${script}</script>`) }
}

// le parcours, joué dans la page : rend la liste des reprises et des nœuds perdus, vide quand tout est juste
const PARCOURS = `(async () => {
  const pause = () => new Promise((r) => setTimeout(r, 40))
  const liste = document.querySelector('mjs-gn-liste')
  const ombre = liste._shadow
  const fautes = []
  const sous = (racine) => { const out = [racine]; const w = document.createTreeWalker(racine, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) out.push(n); return out }
  const ident = (li) => li.querySelector('b').textContent
  const avant = {}
  // chaque nœud d'une ligne porte la marque de sa donnée ; une ligne qui garde sa donnée garde son élément
  const relever = (sel, quoi, attendu) => {
    const lis = Array.from(ombre.querySelectorAll(sel + ' > li:not(.tete)'))
    const vus = lis.map(ident)
    if (vus.join() !== attendu.join()) fautes.push(sel + ' ' + quoi + ' : lignes ' + vus.join() + ' au lieu de ' + attendu.join())
    const neuf = new Map()
    for (const li of lis) {
      const id = ident(li)
      const repris = sous(li).find((n) => n.__donnee !== undefined && n.__donnee !== id)
      if (repris) fautes.push(sel + ' ' + quoi + ' : un nœud de la donnée ' + repris.__donnee + ' sert à la donnée ' + id)
      for (const n of sous(li)) n.__donnee = id
      if (avant[sel] && avant[sel].has(id) && avant[sel].get(id) !== li) fautes.push(sel + ' ' + quoi + ' : la donnée ' + id + ' a perdu ses nœuds')
      neuf.set(id, li)
    }
    avant[sel] = neuf
  }
  const cle  = (a, b, s) => { const r = []; for (let i = a; i <= b; i++) r.push({ id: i, label: 'L' + i + (s || '') }); return r }
  const cles = async (l, quoi) => { liste.poserCles(l); await pause(); relever('ul.k', quoi, l.map((d) => String(d.id))); relever('ol.k2', quoi, l.map((d) => String(d.id))) }
  let k = cle(1, 10)
  await cles(k, 'créer')
  await cles(cle(11, 20), 'tout remplacer par des clés neuves')
  await cles([], 'vider')
  k = cle(21, 30)
  await cles(k, 'remplir après le vidage')
  k = k.filter((d) => d.id !== 25)
  await cles(k, 'retirer une ligne')
  k = k.concat(cle(31, 31))
  await cles(k, 'ajouter une ligne')
  k = k.slice(); [k[0], k[k.length - 1]] = [k[k.length - 1], k[0]]
  await cles(k, 'échanger la première et la dernière')
  k = k.slice(); k.push(k.splice(2, 1)[0])
  await cles(k, 'déplacer une ligne')
  k = k.slice(0, 2).concat(cle(41, 43), k.slice(5))
  await cles(k, 'remplacer un bloc au milieu')
  k = k.map((d) => ({ id: d.id, label: d.label + ' !' }))
  await cles(k, 'mêmes clés, objets neufs')
  await cles(cle(51, 58), 'tout remplacer encore')
  await cles(cle(61, 64), 'tout remplacer par moins de lignes')
  // sans clé : la ligne suit l'objet
  let uid = 0
  const obj = (n) => { const r = []; for (let i = 0; i < n; i++) { uid++; r.push({ uid: 'u' + uid, label: 'o' + i }) } return r }
  const objs = async (l, quoi) => { liste.poserObjs(l); await pause(); relever('ul.u', quoi, l.map((o) => o.uid)) }
  let o = obj(6)
  await objs(o, 'créer')
  o = o.slice().reverse()
  await objs(o, 'mêmes objets, ordre inversé')
  o = o.filter((x, i) => i !== 2)
  await objs(o, 'retirer un objet')
  o = o.concat(obj(1))
  await objs(o, 'ajouter un objet neuf')
  o = obj(6)
  await objs(o, 'objets neufs, mêmes textes')
  o = obj(6)
  await objs(o, 'objets neufs encore')
  await objs([], 'vider')
  o = obj(5)
  await objs(o, 'remplir d\\'objets neufs après le vidage')
  // nœuds texte : succès et erreur alternés, chaque branche {await} est refaite et ne reçoit aucun nœud de celle d'avant ; les deux
  // repères du bloc (premier et dernier nœud de son conteneur) sont à lui, pas à une branche
  const attente = document.querySelector('mjs-gn-attente')
  const att     = attente._shadow.querySelector('.a')
  const branche = () => sous(att).filter((n) => n !== att && n !== att.firstChild && n !== att.lastChild)
  const usage   = async (faire, nom, texte) => {
    faire()
    await pause(); await pause()
    const t = att.querySelector('.t')
    if (!t || !t.textContent.startsWith(texte + ' ')) fautes.push('{await} ' + nom + ' : branche absente (' + att.textContent + ')')
    const repris = branche().find((n) => n.__usage !== undefined)
    if (repris) fautes.push('{await} : un nœud ' + (repris.nodeType === 3 ? 'texte' : 'élément') + ' de « ' + repris.__usage + ' » sert à « ' + nom + ' »')
    for (const n of branche()) n.__usage = nom
  }
  await pause()
  for (const n of branche()) n.__usage = 'succès A'
  await usage(() => attente.echouer('E1'), 'erreur E1', 'E1')
  await usage(() => attente.reussir({ label: 'B', on: true }), 'succès B', 'B')
  await usage(() => attente.echouer('E2'), 'erreur E2', 'E2')
  await usage(() => attente.reussir({ label: 'C', on: false }), 'succès C', 'C')
  await usage(() => attente.echouer('E3'), 'erreur E3', 'E3')
  await usage(() => attente.reussir({ label: 'D', on: true }), 'succès D', 'D')
  return fautes
})()`

// lignes retirées par un vidage, suivies par des références faibles ; `gc` n'existe qu'avec le drapeau de Chromium
const VIDAGE = `(async () => {
  const liste = document.querySelector('mjs-gn-liste')
  const l = []
  for (let i = 1; i <= 300; i++) l.push({ id: i, label: 'M' + i })
  liste.poserMem(l)
  await new Promise((r) => setTimeout(r, 40))
  window.__faibles = Array.from(liste._shadow.querySelectorAll('ul.m > li')).map((li) => new WeakRef(li))
  liste.poserMem([])
  await new Promise((r) => setTimeout(r, 40))
  return window.__faibles.length
})()`
const VIVANTES = `(async () => {
  for (let i = 0; i < 4; i++) { gc(); await new Promise((r) => setTimeout(r, 20)) }
  return window.__faibles.filter((w) => w.deref() !== undefined).length
})()`

const NAVIGATEURS = ['chromium', 'firefox', 'webkit'] as const
const cibles = new Map<string, Promise<Cible>>()
const cible  = (prod: boolean, nom: string, opts: Record<string, unknown>) => {
  const k = (prod ? 'prod-' : 'dev-') + nom
  if (!cibles.has(k)) cibles.set(k, construire(prod, opts))
  return cibles.get(k) as Promise<Cible>
}

for (const nav of NAVIGATEURS) describe(`{for} — une donnée garde ses nœuds, jamais repris pour une autre (${nav} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) { console.log(`  ℹ️  ${nav} non installé, test sauté. Activer : \`npx playwright install ${nav}\``); return }
    browser = await playwright[nav].launch(nav === 'chromium' ? { args: ['--js-flags=--expose-gc'] } : {})
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const prod of [false, true]) for (const [nom, opts] of [['enveloppe', {}], ['sans-enveloppe', { proxy: false }]] as const) {
    it(`${prod ? 'production' : 'développement'}, ${nom} : aucune ligne ni aucun nœud texte repris pour une autre donnée, une donnée qui reste garde les siens`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(prod, nom, opts), 'mjs-gn-liste')
      try {
        await o.page.waitForFunction(`!!document.querySelector('mjs-gn-liste')?._shadow?.querySelector('.pret') && !!document.querySelector('mjs-gn-attente')?._shadow?.querySelector('.t')`, null, { timeout: 10000 })
        assert.deepEqual(await o.page.evaluate(PARCOURS), [])
        assert.deepEqual(graves(o), [], 'aucune erreur')
      } finally {
        await o.fermer()
      }
    })

    if (nav === 'chromium') it(`${prod ? 'production' : 'développement'}, ${nom} : après un vidage, aucune ligne retirée n'est retenue`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(prod, nom, opts), 'mjs-gn-liste')
      try {
        await o.page.waitForFunction(`!!document.querySelector('mjs-gn-liste')?._shadow?.querySelector('.pret')`, null, { timeout: 10000 })
        assert.equal(await o.page.evaluate(VIDAGE), 300, 'trois cents lignes suivies')
        assert.equal(await o.page.evaluate(VIVANTES), 0, 'lignes retirées par le vidage encore retenues')
        assert.deepEqual(graves(o), [], 'aucune erreur')
      } finally {
        await o.fermer()
      }
    })
  }
})
