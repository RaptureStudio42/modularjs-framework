// Un objet d'un état partagé (`µ.state`) ou d'un magasin (`µ.Store`) rangé dans une variable du composant (`$courant = st.rows[1]`), puis
// écrit par elle (`$courant.label = v`, `$courant.x.c = v`), prévient ceux qui lisent l'état comme l'écriture `st.rows[1].label = v` : la
// liste affichée par des enfants, la fiche tenue par la variable, le texte de l'hôte, un autre composant qui affiche l'état ou tient la même
// ligne, une valeur dérivée et un `µeffect`. L'écrivain n'est pas redessiné plus que par l'écriture directe ; une variable qui tient un
// objet hors de l'état, une valeur égale réécrite ne redessinent aucun lecteur de l'état ; une ligne sortie de l'état puis écrite ne lève
// pas. L'écrivain qui affiche lui-même ce qu'il écrit (liaison simple ou calculée, champ lié, liste) prévient aussi le lecteur de l'état, en un seul rendu de chacun, comme l'écriture par l'état. Quatre réglages : développement et production, chacun avec et sans enveloppe. Cœur construit, monté dans happy-dom
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
const L   = (id: number, lab: string) => `{ id: ${id}, label: '${lab}', x: { c: 0 }, tags: [] }`
const D   = `{ rows: [${L(1, 'a')}, ${L(2, 'b')}, ${L(3, 'c')}] }`
// l'état partagé par deux composants de la page : le premier construit le crée, l'autre le reprend
const FAMILLES: Record<string, (d: string) => string> = {
  etat:    (d) => `const st = (window.__ze ||= µ.state(${d}));`,
  magasin: (d) => `const st = (window.__ze ||= new µ.Store(${d}).data);`,
}
const GESTES = [
  "$courant = { label: '-', x: { c: 0 }, tags: [] };",
  '@choisir = function(v) { $courant = st.rows[1]; };',
  "@parCourant = function(v) { $courant.label = 'C' + v; };",
  '@parCourantBas = function(v) { $courant.x.c = v; };',
  "@champ = function(v) { st.rows[1].label = 'L' + v; };",
  '@chemin = function(v) { st.rows[1].x.c = v; };',
  "@etranger = function(v) { $courant = { label: 'e', x: { c: 0 }, tags: [] }; };",
  '@nul = function(v) { $courant = null; };',
  '@sortir = function(v) { st.rows.splice(1, 1); };',
  '@egal = function(v) { $courant.label = $courant.label; };',
  "@attendu = function() { return st.rows.map((r) => r.label + '|' + r.x.c).join(' '); };",
  "@attenduCourant = function() { return $courant ? $courant.label + '|' + $courant.x.c : 'nul'; };",
]
const AUTRE = [
  '$sel = st.rows[1];',
  "$vu = '';",
  "µeffect(() => { $vu = st.rows[1] ? st.rows[1].label : '-'; });",
  "$d = $sel.label + '!';",
  "@attendu = function() { return st.rows.map((r) => r.label).join(' '); };",
]
const LIGNE = js(['$item = null;'], "<em>{$item ? $item.label + '|' + $item.x.c : 'nul'}</em>")
const SOURCES: Record<string, string> = {
  'ze-ligne.mjs': LIGNE,
  'ze-fiche.mjs': LIGNE,
  'ze-ec.mjs':    js(['$item = null;', "@ecrire = function(v) { $item.label = 'K' + v; };"], "<em>{$item ? $item.label + '|' + $item.x.c : 'nul'}</em>"),
}
for (const [nom, decl] of Object.entries(FAMILLES)) {
  SOURCES[`ze-p-${nom}.mjs`] = js([decl(D), ...GESTES], '{for r in st.rows by id}<@ze-ligne item={r}></@ze-ligne>{end}<@ze-fiche item={$courant}></@ze-fiche>')
  SOURCES[`ze-q-${nom}.mjs`] = js([decl(D), ...GESTES], "{for r in st.rows by id}<@ze-ligne item={r}></@ze-ligne>{end}<@ze-fiche item={$courant}></@ze-fiche><b>{$courant ? $courant.label + '|' + $courant.x.c : 'nul'}</b>")
  SOURCES[`ze-a-${nom}.mjs`] = js([decl(D), ...AUTRE], '{for r in st.rows by id}<i>{r.label}</i>{end}<s>{$sel.label}</s><u>{$vu}</u><tt>{$d}</tt>')
  SOURCES[`ze-k-${nom}.mjs`] = js([decl(D), "@attendu = function() { return st.rows.map((r) => r.label + '|' + r.x.c).join(' '); };"], '{for r in st.rows by id}<@ze-ec item={r}></@ze-ec>{end}')
}
// l'écrivain qui affiche lui-même ce qu'il écrit, sans enfant ; le lecteur de l'état
const PAR_ETAT = "@parEtat = function(v) { st.rows[1].label = 'E' + v; };"
const ECRIT    = "@direct = function(v) { $courant.label = 'C' + v; };"
const VRAI     = '@vrai = function() { return String($courant.label); };'
const AFFICHE: Record<string, [string[], string]> = {
  simple:  [['$courant = st.rows[1];', ECRIT, PAR_ETAT, VRAI], '<b>{$courant.label}</b>'],
  calcule: [['$courant = st.rows[1];', ECRIT, PAR_ETAT, VRAI], "<b>{$courant.label + ''}</b>"],
  champ:   [['$courant = st.rows[1];', ECRIT, PAR_ETAT, VRAI], '<input value=!{$courant.label}><b>{$courant.label}</b>'],
  liste:   [['$liste = st.rows;', "@direct = function(v) { $liste[1].label = 'C' + v; };", PAR_ETAT, "@vrai = function() { return $liste.map((r) => r.label).join(' '); };"], '{for r in $liste by id}<li>{r.label}</li>{end}'],
}
for (const [nom, decl] of Object.entries(FAMILLES)) {
  for (const [g, [script, gabarit]] of Object.entries(AFFICHE)) SOURCES[`ze-w${g}-${nom}.mjs`] = js([decl(D), ...script], gabarit)
  SOURCES[`ze-r-${nom}.mjs`] = js([decl(D), "@vrai = function() { return st.rows[1].label + ' ' + st.rows.map((r) => r.label).join(' '); };"], '<u>{st.rows[1].label}</u>{for r in st.rows by id}<i>{r.label}</i>{end}')
}
const REGLAGES: Array<[string, any]> = [['développement', {}], ['production', { env: 'prod' }], ['production sans enveloppe', { env: 'prod', proxy: false }], ['développement sans enveloppe', { proxy: false }]]
const ombre   = (el: any) => el._shadow || el.shadowRoot || el
const enfants = (el: any, tag: string) => (Array.from(ombre(el).querySelectorAll('*')) as any[]).filter((c) => c.tagName === tag)
const textes  = (el: any, tag: string, sel: string) => enfants(el, tag).map((k) => { const n = ombre(k).querySelector(sel); return n ? n.textContent : 'absent' })
const texte   = (el: any, sel: string) => { const n = ombre(el).querySelector(sel); return n ? n.textContent : 'absent' }
type Lu = Array<[string, string, string]>
// l'écrivain : la liste de ses enfants, la fiche tenue par `$courant`, son propre texte
const lireEcrivain = (el: any): Lu => {
  const lu: Lu = [['liste', textes(el, 'MJS-ZE-LIGNE', 'em').join(' '), el.attendu()], ['fiche', textes(el, 'MJS-ZE-FICHE', 'em').join(' '), el.attenduCourant()]]
  if (ombre(el).querySelector('b')) lu.push(['hôte', texte(el, 'b'), el.attenduCourant()])
  return lu
}
// l'autre composant : la liste sans enfant, la ligne tenue par `$sel`, le `µeffect`, la valeur dérivée
const lireAutre = (a: any): Lu => {
  const l = a.attendu().split(' ')[1]
  return [['autre liste', Array.from(ombre(a).querySelectorAll('i')).map((n: any) => n.textContent).join(' '), a.attendu()], ['autre $sel', texte(a, 's'), l], ['autre µeffect', texte(a, 'u'), l], ['autre dérivée', texte(a, 'tt'), l + '!']]
}
// guet des mutations du DOM sur une ombre et celles de ses enfants
const guet = (win: any, els: any[]) => {
  const g = { n: 0, ms: [] as any[] }
  for (const e of els) {
    const m = new win.MutationObserver((l: any[]) => { g.n += l.length })
    m.observe(ombre(e), { childList: true, characterData: true, subtree: true })
    g.ms.push(m)
  }
  return () => { let n = g.n; for (const m of g.ms) { n += m.takeRecords().length; m.disconnect() } return n }
}
const SEQP = ['choisir', 'parCourant', 'parCourantBas', 'champ', 'chemin', 'parCourant', 'parCourantBas']

for (const [nom, opts] of REGLAGES) describe(`objet d'un état partagé écrit par une variable du composant (${nom})`, function () {
  this.timeout(240000)
  let code = ''
  const fenetres: any[] = []
  before(async () => {
    const root = mjsTmp('etat-ecrit-par-variable'), srcDir = join(root, 'src'), outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...opts } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    code = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })
  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })
  const monter = async (balises: string[]) => {
    const win: any = new Window({ url: 'http://localhost/' })
    fenetres.push(win)
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.µ.warn = () => {}
    win.document.body.innerHTML = balises.map((b) => `<mjs-${b}></mjs-${b}>`).join('')
    await tic()
    return [win, ...balises.map((b) => win.document.querySelector('mjs-' + b))]
  }
  // joue les gestes un à un, relit après chacun ; rend les écarts
  const jouer = async (seq: string[], lire: () => Lu, el: any, v0 = 0) => {
    const ecarts = [] as string[]
    let v = v0
    for (const geste of seq) {
      v++
      try {
        el[geste](v)
        await tic()
        for (const [quoi, montre, attendu] of lire()) if (montre !== attendu) ecarts.push(`${geste}(${v}) ${quoi} montre «${montre}» attendu «${attendu}»`)
      }
      catch (e: any) { ecarts.push(`${geste}(${v}) lève ${String(e && e.message).slice(0, 200)}`) }
    }
    return ecarts
  }
  for (const fam of Object.keys(FAMILLES)) {
    for (const v of ['p', 'q']) it(`${fam} ${v} : enfants de la liste, fiche de la variable${v === 'q' ? ', texte de l\'hôte' : ''}, écriture plus bas`, async () => {
      const [, el] = await monter([`ze-${v}-${fam}`])
      assert.deepEqual(await jouer(SEQP, () => lireEcrivain(el), el), [])
    })
    it(`${fam} : un autre composant qui affiche l'état, tient la même ligne, en dérive une valeur et la lit dans un µeffect suit`, async () => {
      const [, el, a] = await monter([`ze-p-${fam}`, `ze-a-${fam}`])
      assert.deepEqual(await jouer(SEQP, () => [...lireEcrivain(el), ...lireAutre(a)], el), [])
    })
    it(`${fam} : l'écrivain n'est pas redessiné plus que par l'écriture directe`, async () => {
      const [win, el, a] = await monter([`ze-q-${fam}`, `ze-a-${fam}`])
      el.choisir(1)
      await tic()
      const tous = () => [el, ...enfants(el, 'MJS-ZE-LIGNE'), ...enfants(el, 'MJS-ZE-FICHE')]
      let fin = guet(win, tous())
      el.champ(2)
      await tic()
      const direct = fin()
      fin = guet(win, tous())
      el.parCourant(3)
      await tic()
      const parVariable = fin()
      assert.ok(direct > 0, 'l\'écriture directe redessine')
      assert.ok(parVariable <= direct, `par la variable : ${parVariable} mutations, écriture directe : ${direct}`)
      assert.deepEqual(lireAutre(a).filter(([, m, at]) => m !== at), [])
    })
    it(`${fam} : une variable qui tient un objet hors de l'état ne prévient aucun lecteur de l'état ; puis nul, puis une nouvelle ligne`, async () => {
      const [win, el, a] = await monter([`ze-q-${fam}`, `ze-a-${fam}`])
      el.choisir(1)
      el.etranger(1)
      await tic()
      const fin = guet(win, [a, ...enfants(el, 'MJS-ZE-LIGNE')])
      el.parCourant(2)
      await tic()
      assert.equal(fin(), 0)
      assert.deepEqual(await jouer(['nul', 'choisir', 'parCourant', 'parCourantBas'], () => [...lireEcrivain(el), ...lireAutre(a)], el, 10), [])
    })
    it(`${fam} : la ligne sortie de l'état puis écrite par la variable ne lève pas, la liste reste juste`, async () => {
      const [, el, a] = await monter([`ze-p-${fam}`, `ze-a-${fam}`])
      const ecarts = await jouer(['choisir', 'sortir', 'parCourant', 'parCourantBas'], () => [['liste', textes(el, 'MJS-ZE-LIGNE', 'em').join(' '), el.attendu()], ['fiche', textes(el, 'MJS-ZE-FICHE', 'em').join(' '), el.attenduCourant()]], el)
      assert.deepEqual(ecarts, [])
      assert.equal(Array.from(ombre(a).querySelectorAll('i')).map((n: any) => n.textContent).join(' '), a.attendu())
    })
    it(`${fam} : une valeur égale réécrite ne redessine personne`, async () => {
      const [win, el, a] = await monter([`ze-q-${fam}`, `ze-a-${fam}`])
      el.choisir(1)
      await tic()
      const fin = guet(win, [el, a, ...enfants(el, 'MJS-ZE-LIGNE'), ...enfants(el, 'MJS-ZE-FICHE')])
      el.egal(2)
      await tic()
      assert.equal(fin(), 0)
    })
    it(`${fam} : un enfant qui reçoit la ligne en prop et l'écrit (constat)`, async () => {
      const [, el, a] = await monter([`ze-k-${fam}`, `ze-a-${fam}`])
      enfants(el, 'MJS-ZE-EC')[1].ecrire(1)
      await tic()
      const freres = textes(el, 'MJS-ZE-EC', 'em').join(' '), autre = lireAutre(a).filter(([, m, at]) => m !== at)
      console.log(`      constat (k) : enfants ${freres === el.attendu() ? 'justes' : `«${freres}» attendu «${el.attendu()}»`} ; autre composant ${autre.length ? JSON.stringify(autre) : 'juste'}`)
    })
    for (const g of Object.keys(AFFICHE)) it(`${fam} : l'écrivain affiche lui-même ce qu'il écrit (${g}) ; le lecteur de l'état suit, un rendu chacun`, async () => {
      const win: any = new Window({ url: 'http://localhost/' })
      fenetres.push(win)
      win.eval(`${code}\nglobalThis.µ = µ;`)
      win.µ.warn = () => {}
      const r: Record<string, number> = {}, P = win.µ.Element.prototype, o = P._mjs_runEffectsV2
      P._mjs_runEffectsV2 = function (...a: any[]) { r[this.localName] = (r[this.localName] || 0) + 1; return o.apply(this, a) }
      win.document.body.innerHTML = `<mjs-ze-w${g}-${fam}></mjs-ze-w${g}-${fam}><mjs-ze-r-${fam}></mjs-ze-r-${fam}>`
      await tic()
      const w = win.document.querySelector(`mjs-ze-w${g}-${fam}`), l = win.document.querySelector(`mjs-ze-r-${fam}`)
      const vuL = () => Array.from(ombre(l).querySelectorAll('u,i')).map((n: any) => n.textContent).join(' ')
      const vuW = () => { const li = Array.from(ombre(w).querySelectorAll('li')); return li.length ? li.map((n: any) => n.textContent).join(' ') : texte(w, 'b') }
      const rendus: string[] = []
      for (const [i, geste] of ['variable', 'etat', 'variable'].entries()) {
        for (const k of Object.keys(r)) delete r[k]
        if (geste === 'etat') w.parEtat(i + 1)
        else if (g === 'champ') { const inp = ombre(w).querySelector('input'); inp.value = 'T' + (i + 1); inp.dispatchEvent(new win.Event('input', { bubbles: true })) }
        else w.direct(i + 1)
        await tic()
        assert.equal(vuL(), l.vrai(), `${geste} (${i + 1}) : lecteur`)
        assert.equal(vuW(), w.vrai(), `${geste} (${i + 1}) : écrivain`)
        rendus.push(JSON.stringify(r))
      }
      assert.equal(rendus[0], rendus[1], 'rendus par la variable et par l\'état')
      assert.equal(rendus[2], rendus[1], 'rendus par la variable et par l\'état')
    })
  }
})
