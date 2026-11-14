// écritures par un objet du magasin ou de l'état que le compilateur ne suit pas, quand une clé venue de l'extérieur vaut `'constructor'`
// ou `'__proto__'` : magasin, avec et sans le réglage `proxy: false` — `[t] = [$$l.find(f)]` seul dans son composant (JavaScript,
// CoffeeScript, Civet), `$$l.values().next().value`, `__defineGetter__`, `Array.prototype.push.call`, `Object.assign(...[x], …)`, clé
// calculée de la chaîne vers une classe de l'appli ; avec le réglage, `Object.assign(...[x], …)`, `Object.assign.apply`,
// `Reflect.apply(Object.assign, …)` gardés et signalés, la clé propre d'un motif lue (`const { [k]: c } = $d[0]`) dans une
// déclaration, une affectation, une boucle et un rappel ; avec l'enveloppe, une liste typée défaite après un `pop` ou un `splice`
// refusé garde ses objets bruts, la valeur rendue par `pop` est l'objet brut ; `Object.assign($$prefs, d)` n'emporte pas le module
// des écritures profondes. Joué dans happy-dom (production ; développement pour les types), puis dans Chromium, Firefox et WebKit
// (production, les deux modes)

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { charger } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const TACHES = '[{ id: 1, n: 0 }, { id: 2, n: 0 }]'
const F1     = '((x) => x.id == 1)'

// composant du magasin, une forme par méthode `(k, v)` ; `lang` : `''` (Civet), `' lang="js"'`, `' lang="coffee"'`
function magasin(lang: string, formes: Record<string, string>): string {
  const js   = lang === ' lang="js"'
  const fn   = (corps: string) => js ? `function(k, v) { ${corps}; }` : `(k, v) -> ${corps}`
  const init = `$$tm = ${TACHES}${js ? ';' : ''}\n  $$tl = [[1], [2]]${js ? ';' : ''}`
  return `<script${lang}>\n  ${init}\n  @remettre = ${js ? `function() { $$tm = ${TACHES}; $$tl = [[1], [2]]; }` : `-> $$tm = ${TACHES}; $$tl = [[1], [2]]`}\n  @lire = ${js ? 'function() { return JSON.stringify([$$tm, $$tl]); }' : '-> JSON.stringify([$$tm, $$tl])'}\n${Object.entries(formes).map(([n, f]) => `  @${n} = ${fn(f)}`).join('\n')}\n</script>\n<p class="etat">{$$tm.length}</p>\n`
}

const FORMES_MAGASIN: Record<string, string> = {
  mValeursSuivant: '$$tm.values().next().value[k].polluK = v',
  mAccesseur:      `$$tm.find${F1}[k].__defineGetter__('polluK', () => v)`,
  mPousseAppel:    `Array.prototype.push.call($$tm.find${F1}[k], v)`,
  mPousseAppelL:   `[].push.call($$tl.find((l) => l.length)[k], v)`,
  mAssignEtale:    `Object.assign(...[$$tm.find${F1}[k]], { polluK: v })`,
}
// avec le réglage : fonctions qui modifient ce qu'elles reçoivent, appelées autrement que par leur nom
const FORMES_PORTES: Record<string, string> = {
  assignEtale: `Object.assign(...[$taches.find${F1}[k]], { polluK: v })`,
  assignApply: `Object.assign.apply(null, [$taches.find${F1}[k], { polluK: v }])`,
  assignCall:  `Object.assign.call(null, $taches.find${F1}[k], { polluK: v })`,
  reflApply:   `Reflect.apply(Object.assign, null, [$taches.find${F1}[k], { polluK: v }])`,
}

const SOURCES: Record<string, string> = {
  // `[t] = [$$tm.find(f)]` seul dans son composant : aucun autre `t` ne le fait suivre par son nom
  'sz-motif.mjs':  magasin(' lang="js"', { mMotif: `let t; [t] = [$$tm.find${F1}]; t[k].polluK = v` }),
  'sz-motifd.mjs': magasin(' lang="js"', { mMotifDecl: `const [t] = [$$tm.find${F1}]; t[k].polluK = v` }),
  'sz-motifc.mjs': magasin(' lang="coffee"', { cMotif: '[t] = [$$tm.find((x) -> x.id == 1)]; t[k].polluK = v' }),
  'sz-motifv.mjs': magasin('', { vMotif: '\n    [t] := [$$tm.find((x) => x.id == 1)]\n    t[k].polluK = v' }),
  'sz-mag.mjs':    magasin(' lang="js"', FORMES_MAGASIN),
  'sz-portes.mjs': `<script lang="js">\n  $taches = ${TACHES};\n  @remettre = function() { $taches = ${TACHES}; };\n  @lire = function() { return JSON.stringify($taches); };\n${Object.entries(FORMES_PORTES).map(([n, f]) => `  @${n} = function(k, v) { ${f}; };`).join('\n')}\n</script>\n<p class="etat">{$taches.length}</p>\n`,
  // clé d'un motif : propre à l'objet (lue), ou héritée vers une classe de l'appli (refusée) ; magasin : clé calculée de la chaîne
  'sz-noms.mjs': `<script lang="js">
  class Tache { constructor(id) { this.id = id; } }
  $d = [{ constructor: 'Renault', prototype: 'P1', __proto__: { n: 1 } }];
  $classes = [new Tache(1)];
  $$cl = [new Tache(2)];
  const lu = (k) => { const r = Tache[k] === true; delete Tache[k]; return r; };
  @declare = function(k) { const { [k]: c } = $d[0]; return c; };
  @affecte = function(k) { let c; ({ [k]: c } = $d[0]); return c; };
  @boucle = function(k) { for (const { [k]: c } of $d) return c; };
  @rappel = function(k) { let r; $d.forEach(({ [k]: c }) => { r = c; }); return r; };
  @imbrique = function(k) { const [{ [k]: c }] = $d; return c; };
  @classe = function(k) { try { const { [k]: c } = $classes[0]; c.isAdmin = true; } catch (e) { } return lu('isAdmin'); };
  @magasinCle = function(k) { try { $$cl.find((t) => t.id == 2)[k].isAdmin = true; } catch (e) { } return lu('isAdmin'); };
  @magasinPousse = function(k) { Tache.liste = []; try { $$cl.find((t) => t.id == 2)[k].liste.push(1); } catch (e) { } const r = Tache.liste.length; delete Tache.liste; return r; };
  @magasinClair = function() { $$cl.find((t) => t.id == 2).constructor.isAdminClair = true; return lu('isAdminClair'); };
  @magasinDonnee = function(k, v) { $$cl.find((t) => t.id == 2)[k] = { n: 0 }; $$cl.find((t) => t.id == 2)[k].n = v; return $$cl[0][k].n; };
</script>
<p class="etat">{$d.length}</p>
`,
}

// chaque forme jouée avec `k` réservé ; une trace posée sur les objets de la page, `polluD` à garder, `polluK` à ne jamais voir
const TRACEUR = `globalThis.__parcours = async (balise, formes) => {
  const c = document.querySelector(balise)
  const T = [Object.prototype, Object, Array.prototype, Array, Function.prototype, Function]
  const N = ['Object.prototype', 'Object', 'Array.prototype', 'Array', 'Function.prototype', 'Function']
  const own = (t, p) => Object.prototype.hasOwnProperty.call(t, p)
  const r = {}
  for (const f of formes) for (const k of ['constructor', '__proto__']) {
    for (const t of T) Object.defineProperty(t, 'polluD', { value: 1, configurable: true, writable: true })
    try { await c[f](k, 1) } catch (e) { }
    const pollue = []
    T.forEach((t, i) => { for (const p of ['polluK', '0', '1']) if (own(t, p)) pollue.push(N[i] + '.' + p); if (!own(t, 'polluD')) pollue.push(N[i] + '.polluD retiré') })
    if (own(Object.prototype, 'length')) pollue.push('Object.prototype.length')
    if (Array.prototype.length) pollue.push('Array.prototype.length')
    for (const t of T) { delete t.polluK; delete t.polluD; delete t[0]; delete t[1] }
    delete Object.prototype.length
    Array.prototype.length = 0
    r[f + ' ' + k] = pollue
    try { c.remettre() } catch (e) {}
  }
  return r
}`

type Construit = { racine: string, code: string, avis: string[] }

// production en un seul fichier, ou développement (tout le JavaScript, le cœur d'abord)
async function construire(nom: string, opts: Record<string, unknown>, dev: boolean, sources: Record<string, string>): Promise<Construit> {
  const root   = mjsTmp('sans-proxy-magasin-motifs-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(sources)) writeFileSync(join(srcDir, f), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(dev ? root : outDir, 'bundle.js'), ...(dev ? {} : { env: 'prod', js: 'bundle', urlPrefix: '/out' }), ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  const avis = (stats.warnings ?? []).map((w: any) => String(w.message ?? w))
  if (!dev) return { racine: root, code: readFileSync(join(outDir, 'bundle.js'), 'utf-8'), avis }
  const rang  = (f: string) => /^mjs_core/.test(f) ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
  return { racine: root, code: files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n', avis }
}

const constructions = new Map<string, Promise<Construit>>()
const construction  = (nom: string, opts: Record<string, unknown>) => {
  if (!constructions.has(nom)) constructions.set(nom, construire(nom, opts, false, SOURCES))
  return constructions.get(nom)!
}

// happy-dom : le code dans la page, les composants montés
async function page(code: string, dev = false): Promise<any> {
  const w: any = new Window({ url: 'http://localhost/' })
  w.eval(dev ? code : code.replace(/import\.meta\.url/g, '\'http://localhost/\'').replace(/export\s*\{[^}]*\}\s*;?/g, ''))
  return w
}
async function monter(w: any, balises: string[]): Promise<void> {
  w.document.body.innerHTML = balises.map((b) => `<${b}></${b}>`).join('')
  const fin = Date.now() + 5000
  while (!balises.every((b) => w.document.querySelector(b)?._shadow?.querySelector('.etat')?.textContent) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}
// `avis` : développement, les avertissements de `µ.warn` relevés
async function pollutions(code: string, balises: Record<string, string[]>, avis: string[] | null = null): Promise<string[]> {
  const w = await page(code, avis !== null)
  if (avis !== null) w.µ.warn = (m: string) => avis.push(String(m))
  await monter(w, Object.keys(balises))
  w.eval(TRACEUR)
  const pollues: string[] = []
  for (const [b, formes] of Object.entries(balises)) for (const [f, p] of Object.entries(await w.__parcours(b, formes))) if ((p as string[]).length) pollues.push(`${b} ${f} → ${(p as string[]).join(', ')}`)
  await w.happyDOM.close()
  return pollues
}

const BALISES_MAGASIN = { 'mjs-sz-motif': ['mMotif'], 'mjs-sz-motifd': ['mMotifDecl'], 'mjs-sz-motifc': ['cMotif'], 'mjs-sz-motifv': ['vMotif'], 'mjs-sz-mag': Object.keys(FORMES_MAGASIN) }

// lectures et écritures de `mjs-sz-noms`, jouées dans la page : magasin (deux modes), clés de motif (réglage `proxy: false`)
const NOMS = `globalThis.__noms = (sans) => {
  const c = document.querySelector('mjs-sz-noms')
  const r = { cle: c.magasinCle('constructor'), pousse: c.magasinPousse('constructor'), clair: c.magasinClair(), donnee: c.magasinDonnee('fiche', 3) }
  if (sans) {
    for (const m of ['declare', 'affecte', 'boucle', 'rappel', 'imbrique']) r[m] = [c[m]('constructor'), c[m]('prototype')].join(' ')
    r.classe = c.classe('constructor')
  }
  return r
}`
const NOMS_ATTENDUS = { cle: false, pousse: 0, clair: true, donnee: 3 }
const MOTIFS_ATTENDUS = { declare: 'Renault P1', affecte: 'Renault P1', boucle: 'Renault P1', rappel: 'Renault P1', imbrique: 'Renault P1', classe: false }

describe('magasin et état sans Proxy : motifs, appels par `call` et `apply`, clés de motif, classes de l\'appli (happy-dom)', function () {
  this.timeout(180000)
  after(() => terminateSharedWorkerPool())

  for (const [mode, nom, opts] of [['enveloppe', 'avec', {}], ['proxy: false', 'sans', { proxy: false }]] as [string, string, Record<string, unknown>][]) {
    it(`magasin, ${mode} : aucune forme n'atteint un prototype ni une fonction de la page`, async () => {
      assert.deepEqual(await pollutions((await construction(nom, opts)).code, BALISES_MAGASIN), [])
    })

    it(`magasin, ${mode} : une clé calculée de la chaîne ne mène pas à une classe de l'appli ; \`constructor\` écrit dans le code y écrit, un champ de données s'écrit`, async () => {
      const w = await page((await construction(nom, opts)).code)
      await monter(w, ['mjs-sz-noms'])
      const c = w.document.querySelector('mjs-sz-noms')
      assert.deepEqual({ cle: c.magasinCle('constructor'), pousse: c.magasinPousse('constructor'), clair: c.magasinClair(), donnee: c.magasinDonnee('fiche', 3) }, { cle: false, pousse: 0, clair: true, donnee: 3 })
      await w.happyDOM.close()
    })
  }

  it('développement, deux modes : aucune forme du magasin n\'atteint un prototype ni une fonction de la page, le refus est dit', async () => {
    for (const [nom, opts] of [['avec-dev', {}], ['sans-dev', { proxy: false }]] as [string, Record<string, unknown>][]) {
      const b    = await construire(nom, opts, true, SOURCES)
      const avis: string[] = []
      assert.deepEqual(await pollutions(b.code, { ...BALISES_MAGASIN, 'mjs-sz-portes': Object.keys(FORMES_PORTES) }, avis), [], nom)
      const w = await page(b.code, true)
      w.µ.warn = (m: string) => avis.push(String(m))
      await monter(w, ['mjs-sz-noms'])
      const c = w.document.querySelector('mjs-sz-noms')
      assert.deepEqual({ cle: c.magasinCle('constructor'), pousse: c.magasinPousse('constructor'), clair: c.magasinClair() }, { cle: false, pousse: 0, clair: true }, nom)
      await w.happyDOM.close()
      for (const seg of ['« constructor »', '« __proto__ »']) assert.ok(avis.some((a) => a.includes(seg)), `${nom} : segment ${seg} dit — ${JSON.stringify(avis.slice(0, 4))}`)
    }
  })

  it('proxy: false : `Object.assign(...[x], …)`, `Object.assign.apply`, `Object.assign.call`, `Reflect.apply(Object.assign, …)` gardés et signalés à leur ligne', async () => {
    const b = await construction('sans', { proxy: false })
    assert.deepEqual(await pollutions(b.code, { 'mjs-sz-portes': Object.keys(FORMES_PORTES) }), [])
    const lignes = new Set(b.avis.filter((a) => a.includes('sz-portes')).map((a) => Number((a.match(/ligne (\d+)/) ?? [])[1])))
    assert.deepEqual(Object.keys(FORMES_PORTES).filter((n, i) => !lignes.has(5 + i)), [], `signalées : ${JSON.stringify(b.avis.filter((a) => a.includes('sz-portes')))}`)
  })

  it('proxy: false : la clé propre d\'un motif est lue (déclaration, affectation, boucle, rappel, motif imbriqué) ; héritée vers une classe de l\'appli, refusée', async () => {
    const w = await page((await construction('sans', { proxy: false })).code)
    await monter(w, ['mjs-sz-noms'])
    const c = w.document.querySelector('mjs-sz-noms')
    const lus: Record<string, unknown> = {}
    for (const m of ['declare', 'affecte', 'boucle', 'rappel', 'imbrique']) lus[m] = [c[m]('constructor'), c[m]('prototype')].join(' ')
    lus.classe = c.classe('constructor')
    await w.happyDOM.close()
    assert.deepEqual(lus, { declare: 'Renault P1', affecte: 'Renault P1', boucle: 'Renault P1', rappel: 'Renault P1', imbrique: 'Renault P1', classe: false })
  })

  it('enveloppe, liste typée : un `pop` ou un `splice` refusé remet l\'objet brut dans la liste (structuredClone de µraw marche), la valeur rendue est l\'objet brut', async () => {
    const b = await construire('types', {}, true, { 'sz-types.mjs': '<vars>\n  $msgs  Message[] 1..3\n</vars>\n<script>\n$msgs = [{ id: 1, t: \'a\' }]\n@retirer = -> $msgs.pop()\n@couper = -> $msgs.splice(0, 5)\n@remettre = -> $msgs = [{ id: 1, t: \'a\' }, { id: 2, t: \'b\' }]\n</script>\n<p class="etat">{$msgs.length}</p>\n', 'app.types.mjs': '<types>\nMessage\n  id  int\n  t  string\n</types>\n' })
    const w = await page(b.code + '\nµ._typesMode = "warn"; µ.warn = () => {};', true)
    await monter(w, ['mjs-sz-types'])
    const c     = w.document.querySelector('mjs-sz-types')
    const bilan: string[] = []
    // copie structurée de la liste brute : un objet enveloppé l'arrête (DataCloneError)
    const copie = (l: unknown) => { try { structuredClone(l); return 'copie' } catch (e: any) { return e.name } }
    for (const m of ['retirer', 'couper']) {
      c[m]()
      const l = w.µ._mjs_toRaw(c._state.msgs)
      bilan.push(`${m} : ${l[0] === w.µ._mjs_toRaw(l[0]) ? 'brut' : 'ENVELOPPE'}, ${copie(l)}`)
    }
    c.remettre()
    const brut = w.µ._mjs_toRaw(c._state.msgs)[1]
    const rendu = c.retirer()
    bilan.push(`rendu : ${rendu === brut ? 'brut' : w.µ._mjs_toRaw(rendu) === brut ? 'enveloppé' : 'autre'}`)
    await w.happyDOM.close()
    assert.deepEqual(bilan, ['retirer : brut, copie', 'couper : brut, copie', 'rendu : brut'])
  })

  it('magasin, mode par défaut : `Object.assign($$prefs, d)` n\'emporte pas le module des écritures profondes', async () => {
    const app = (corps: string) => ({ 'app-x.mjs': `<script lang="js">\n  $$prefs = { theme: 'a' };\n  @f = function(d) { ${corps}; };\n</script>\n<p>{$$prefs.theme}</p>\n` })
    const avec = await construire('assign', {}, false, app('Object.assign($$prefs, d)'))
    const sans = await construire('champ', {}, false, app('$$prefs.theme = d.theme'))
    const ecart = Buffer.byteLength(avec.code) - Buffer.byteLength(sans.code)
    assert.ok(ecart < 1000, `écart ${ecart} o : le module des écritures profondes pèse plus de 3 000 o`)
  })
})

describe('magasin et état sans Proxy : motifs, appels par `call` et `apply`, clés de motif, classes de l\'appli (navigateurs réels)', function () {
  this.timeout(180000)
  after(() => terminateSharedWorkerPool())

  for (const moteur of ['chromium', 'firefox', 'webkit']) for (const [mode, nom, opts] of [['enveloppe', 'avec', {}], ['proxy: false', 'sans', { proxy: false }]] as [string, string, Record<string, unknown>][]) {
    it(`${moteur}, production, ${mode} : aucune forme n'atteint un prototype ni une fonction de la page, les clés justes sont lues`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) { this.skip(); return }
      const browser = await playwright[moteur].launch()
      try {
        const { racine } = await construction(nom, opts)
        const balises    = { ...BALISES_MAGASIN, ...(nom === 'sans' ? { 'mjs-sz-portes': Object.keys(FORMES_PORTES) } : {}) }
        const toutes     = [...Object.keys(balises), 'mjs-sz-noms']
        const page: Cible = { mode: 'bundle', racine, document: () => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${toutes.map((b) => `<${b}></${b}>`).join('')}<script type="module" src="/out/bundle.js"></script></body></html>` }
        const o = await charger(browser, page, 'mjs-sz-noms')
        try {
          await o.page.waitForFunction(`${JSON.stringify(toutes)}.every((b) => !!document.querySelector(b)?._shadow?.querySelector('.etat'))`, null, { timeout: 10000 })
          await o.page.evaluate(TRACEUR)
          await o.page.evaluate(NOMS)
          const pollues: string[] = []
          for (const [b, formes] of Object.entries(balises)) for (const [f, p] of Object.entries(await o.page.evaluate(([x, y]: any) => (globalThis as any).__parcours(x, y), [b, formes]) as any)) if ((p as string[]).length) pollues.push(`${b} ${f} → ${(p as string[]).join(', ')}`)
          assert.deepEqual(pollues, [], 'écritures qui ont atteint un prototype ou une fonction de la page')
          assert.deepEqual(await o.page.evaluate((s: boolean) => (globalThis as any).__noms(s), nom === 'sans'), nom === 'sans' ? { ...NOMS_ATTENDUS, ...MOTIFS_ATTENDUS } : NOMS_ATTENDUS)
          assert.deepEqual(o.erreurs, [], 'aucune erreur de page')
        } finally {
          await o.fermer()
        }
      } finally {
        await browser.close()
      }
    })
  }
})
