// Un enfant qui tient un objet de l'état de son parent (`<@fiche item={$o.a}>`) se redessine quand le parent écrit dans cet objet, ou plus
// bas, sans passer par le chemin de sa variable : par un nom qui en garde une partie (`t = $o.a.b.c; t.d = v`, `t = $o.a; t.b.c.d = v`),
// par une fonction qui la reçoit (`poser($o.a.b.c, v)`), par une méthode d'une liste gardée par un nom (`l = $o.a.b.l; l.push(v)`), par
// `Object.assign(t, …)`. Avec l'enveloppe (défaut), l'écriture passe par elle et l'enfant suit sans rien écrire d'autre ; avec le réglage
// `proxy: false`, MJS ne la voit pas et `µrefresh($o)` la signale. `µrefresh($o)` prévient aussi l'enfant après une écriture faite hors de
// MJS (objet gardé dans une variable sans `$` avant son entrée dans l'état), dans les quatre réglages. L'enfant tient la racine, un objet
// du milieu, l'objet écrit lui-même, la liste modifiée ; deux enfants à deux niveaux du même chemin ; la ligne d'un `{for}` ; un enfant
// lié à deux sens. Un enfant qui tient un objet sans lien avec l'écriture n'est pas prévenu ; après `µrefresh($o)`, tout enfant qui tient
// une partie de `$o` l'est, celui qui tient un objet d'une autre variable non. Quatre réglages : développement et production, chacun avec
// et sans enveloppe. Cœur construit, monté dans happy-dom
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')

// l'état du parent, gardé aussi dans une variable sans `$` (`garde`), et ses écritures par un nom, une fonction, une méthode de liste,
// `Object.assign` ; `w0` écrit hors de MJS, même avec l'enveloppe
const OBJET = [
  'const garde = { a: { b: { c: { d: 0 }, l: [] } }, z: { y: 0 } };',
  '$o = garde;',
  '$p = { q: 0 };',
  'function poser(x, v) { x.d = v; }',
  '@w1 = function(v) { const t = $o.a.b.c; t.d = v; };',
  '@w2 = function(v) { const t = $o.a; t.b.c.d = v; };',
  '@w3 = function(v) { poser($o.a.b.c, v); };',
  '@w4 = function(v) { const l = $o.a.b.l; l.push(v); };',
  '@w5 = function(v) { const t = $o.a.b.c; Object.assign(t, { d: v }); };',
  '@w0 = function(v) { garde.a.b.c.d = v; };',
  '@rafraichir = function() { µrefresh($o); };',
]
// les mêmes écritures dans la ligne d'une liste
const LISTE = [
  'const garde = [{ id: 1, x: { c: { d: 0 }, l: [] } }, { id: 2, x: { c: { d: 0 }, l: [] } }];',
  '$o = garde;',
  'function poser(x, v) { x.d = v; }',
  '@w1 = function(v) { const t = $o[0].x.c; t.d = v; };',
  '@w2 = function(v) { const t = $o[0]; t.x.c.d = v; };',
  '@w3 = function(v) { poser($o[0].x.c, v); };',
  '@w4 = function(v) { const l = $o[0].x.l; l.push(v); };',
  '@w5 = function(v) { const t = $o[0].x.c; Object.assign(t, { d: v }); };',
  '@w0 = function(v) { garde[0].x.c.d = v; };',
  '@rafraichir = function() { µrefresh($o); };',
]

const SOURCES: Record<string, string> = {
  'vi-json.mjs':   js(['$item = null;'], '<em>{JSON.stringify($item)}</em>'),
  'ip-racine.mjs': js(OBJET, '<@vi-json item={$o}></@vi-json>'),
  'ip-a.mjs':      js(OBJET, '<@vi-json item={$o.a}></@vi-json>'),
  'ip-b.mjs':      js(OBJET, '<@vi-json item={$o.a.b}></@vi-json>'),
  'ip-c.mjs':      js(OBJET, '<@vi-json item={$o.a.b.c}></@vi-json>'),
  'ip-l.mjs':      js(OBJET, '<@vi-json item={$o.a.b.l}></@vi-json>'),
  'ip-deux.mjs':   js(OBJET, '<@vi-json item={$o.a}></@vi-json><@vi-json item={$o.a.b}></@vi-json>'),
  'ip-lie.mjs':    js(OBJET, '<@vi-json item=!{$o.a}></@vi-json>'),
  'ip-autre.mjs':  js(OBJET, '<@vi-json item={$o.z}></@vi-json><@vi-json item={$p}></@vi-json>'),
  'ip-ligne.mjs':  js(LISTE, '{for r in $o by id}<@vi-json item={r.x}></@vi-json>{end}'),
}

// l'objet que chaque écriture modifie, lu dans l'état brut du parent
const ECRIT: Record<string, (o: any) => any> = { c: (o) => Array.isArray(o) ? o[0].x.c : o.a.b.c, l: (o) => Array.isArray(o) ? o[0].x.l : o.a.b.l }
const ECRITURES: Array<[string, string]> = [['w1', 'c'], ['w2', 'c'], ['w3', 'c'], ['w4', 'l'], ['w5', 'c']]

const ombre   = (el: any) => el._shadow || el.shadowRoot || el
const enfants = (el: any) => (Array.from(ombre(el).querySelectorAll('*')) as any[]).filter((c) => c.tagName === 'MJS-VI-JSON')
// `x` atteint depuis `de` (objets bruts)
const atteint = (de: any, x: any, vu = new Set()): boolean => {
  if (de === x) return true
  if (de === null || typeof de !== 'object' || vu.has(de)) return false
  vu.add(de)
  return Object.keys(de).some((k) => atteint(de[k], x, vu))
}

const REGLAGES: Array<[string, any]> = [['développement', {}], ['production', { env: 'prod' }], ['production sans enveloppe', { env: 'prod', proxy: false }], ['développement sans enveloppe', { proxy: false }]]

for (const [nom, opts] of REGLAGES) describe(`objet tenu par un enfant, écrit par le parent hors du chemin de sa variable, ou rafraîchi (${nom})`, function () {
  this.timeout(120000)
  const sans = opts.proxy === false
  let code = ''
  const fenetres: any[] = []

  before(async () => {
    const root   = mjsTmp('prop-objet-tenu-nom')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...opts } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
    code = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  // une appli dans sa fenêtre : avertissements relevés, notifications de chaque composant comptées par variable, sur l'élément
  async function appli(balise: string) {
    const win: any = new Window({ url: 'http://localhost/' })
    fenetres.push(win)
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.__avis = []
    win.µ.warn = (...a: any[]) => { win.__avis.push(a.join(' ')) }
    win.eval(`(() => {
      const P = µ.Element.prototype, n = P._mjs_notifyMutation
      P._mjs_notifyMutation = function (k, ...a) { (this.__n ||= {})[k] = (this.__n[k] || 0) + 1; return n.call(this, k, ...a) }
    })()`)
    win.document.body.innerHTML = `<mjs-${balise}></mjs-${balise}>`
    await tic()
    return { win, el: win.document.querySelector('mjs-' + balise) }
  }

  // chaque écriture, puis `µrefresh($o)` sans l'enveloppe ; enfin l'écriture faite hors de MJS et `µrefresh($o)`. Après chaque pas, ce
  // que montre chaque enfant est comparé à l'objet qu'il tient ; l'enfant sans lien avec l'objet écrit n'est pas prévenu. Rend les écarts
  async function ecarts(balise: string) {
    const { win, el } = await appli(balise)
    const brut        = (x: any) => win.µ._mjs_toRaw(x)
    const ecart       = [] as string[]
    const pas         = [...ECRITURES.map(([w, x]) => [w, x, sans]), ['w0', 'c', true]] as Array<[string, string, boolean]>
    let v = 0
    for (const [w, x, rafraichir] of pas) {
      const kids     = enfants(el)
      const avant    = kids.map((k: any) => (k.__n && k.__n.item) || 0)
      // mutations du DOM de chaque enfant pendant le pas : ses rendus
      const guets    = kids.map((k: any) => { const g = { n: 0, m: new win.MutationObserver((l: any[]) => { g.n += l.length }) }; g.m.observe(ombre(k).querySelector('em'), { childList: true, characterData: true, subtree: true }); return g })
      const vuParent = (el.__n && el.__n.o) || 0
      el[w](++v)
      if (rafraichir) el.rafraichir()
      await tic()
      const ecrit = ECRIT[x](brut(el._state.o))
      const quoi  = w + (rafraichir ? ' + µrefresh($o)' : '')
      if (((el.__n && el.__n.o) || 0) === vuParent) ecart.push(`${quoi} : le parent n'est pas prévenu`)
      kids.forEach((k: any, i: number) => {
        const tenu   = brut(k._state.item)
        const montre = ombre(k).querySelector('em').textContent
        if (montre !== JSON.stringify(tenu)) ecart.push(`${quoi} : l'enfant ${i} montre ${montre}, il tient ${JSON.stringify(tenu)}`)
        // sans lien : ni l'objet écrit sous ce qu'il tient, ni (après µrefresh) une partie de `$o`
        const lie = rafraichir ? atteint(brut(el._state.o), tenu) : atteint(tenu, ecrit)
        const n   = ((k.__n && k.__n.item) || 0) - avant[i]
        if (!lie && n !== 0) ecart.push(`${quoi} : l'enfant ${i}, sans lien avec l'écriture, est prévenu ${n} fois`)
        const rendus = guets[i].n + guets[i].m.takeRecords().length
        guets[i].m.disconnect()
        // `w1`, `w2`, `w4` : écriture par un nom pris sur un chemin fixe, émise comme l'écriture directe, déjà vue ; `µrefresh` redit ensuite — deux
        // avis, un seul rendu
        if (['w1', 'w2', 'w4'].includes(w) && rafraichir) {
          if (lie && n === 0) ecart.push(`${quoi} : l'enfant ${i} n'est pas prévenu`)
          if (n > 2) ecart.push(`${quoi} : l'enfant ${i} est prévenu ${n} fois`)
          if (rendus > 1) ecart.push(`${quoi} : l'enfant ${i} est rendu ${rendus} fois`)
        }
        else if (n > 1) ecart.push(`${quoi} : l'enfant ${i} est prévenu ${n} fois`)
      })
    }
    if (win.__avis.length) ecart.push('avertissements : ' + win.__avis.join(' / '))
    return ecart
  }

  for (const f of Object.keys(SOURCES).filter((f) => f.startsWith('ip-'))) {
    const balise = f.slice(0, -4)
    it(`${balise} : ${SOURCES[f].split('\n').pop()}`, async () => {
      assert.deepEqual(await ecarts(balise), [])
    })
  }
})
