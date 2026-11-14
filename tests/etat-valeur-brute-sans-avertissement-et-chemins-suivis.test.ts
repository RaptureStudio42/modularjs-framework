// valeur de `pop`, `shift`, `splice` & co. sur l'état local (brute, cf. etat-valeur-des-methodes-qui-modifient-brute-et-gardee) : la
// construction n'en dit rien, avec l'enveloppe comme avec le réglage `proxy: false` — ni du code courant qui la range dans l'état
// (`$redo.push($undo.pop())`, `$o.sel = $l.pop()`), en lit un champ par un nom ou un motif (`const { id } = $l.pop()`, `t.nom ?? ''`),
// la compare, la cherche (`Object.is`, `ids.includes(t)`), la trie par ses champs ou tient une chaîne déclarée (`$urls string[]`), ni de
// celle qui sort de l'état (passée à une fonction, lancée par `throw`, rangée dans `window`, comparateur reçu en paramètre). Une écriture
// qui part d'une copie de cette valeur (`Object.values`, `Object.entries`, `Array.from`, `Object.assign({}, …)`), d'un objet ou d'une
// liste écrits qui la tiennent, du paramètre d'une fonction appelée en place ou d'un comparateur CoffeeScript déclaré dans le script
// passe par l'aide gardée : une clé venue de l'extérieur (`constructor`, `__proto__`) n'atteint aucun prototype ; une forme hors de la
// garde (passée à une fonction, rendue par `return`, lancée par `throw`, comparateur reçu en paramètre) n'en atteint un que si les
// limites de docs/11-etat-brut.md la nomment. Réglage `proxy: false` : la clé calculée d'un motif survit à l'erreur d'un motif intérieur
// rattrapée dans un accesseur. Construction seule (deux modes, trois langues), puis happy-dom, Chromium, Firefox et WebKit (production,
// les deux modes)

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { mjsTmp } from './helpers/tmp.js'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { charger } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const MODES: [string, string, Record<string, unknown>][] = [['enveloppe', 'avec', {}], ['proxy: false', 'sans', { proxy: false }]]

// ── construction seule : aucun avertissement sur la valeur, ligne par ligne ───────────────────────────────────────────────────────
// code courant : la valeur reste dans l'état, ou le composant en lit une partie, la compare, la cherche, la trie
const COURANT: Record<string, string> = {
  annulerRefaire:  '$redo.push($undo.pop())',
  carrousel:       '$slides.push($slides.shift())',
  carrouselInv:    '$slides.unshift($slides.pop())',
  glisserDeposer:  '$l.splice(j, 0, $l.splice(i, 1)[0])',
  champEtat:       '$o.sel = $l.pop()',
  listeNeuve:      '$l2 = [...$l2, $l.pop()]',
  concatEtat:      '$l2 = $l2.concat($l.pop())',
  nomEtat:         'const t = $l.pop(); $redo.push(t); $o.sel = t',
  methodeValeur:   'const t = $l.pop(); t.a.toString()',
  // méthode d'une copie locale qui range un élément de l'état (le module `sortable` du cœur)
  copieRange:      'const c = Array.from($l); const t = c[0]; c.splice(1, 0, t); $l = c',
  triLocale:       '$l.sort((a, b) => a.nom.localeCompare(b.nom))',
  triDate:         '$l.sort((a, b) => new Date(a.d) - new Date(b.d))',
  triChamps:       '$l.sort((a, b) => comparer(a.d, b.d))',
  triChampsMotif:  '$l.sort(({ nom: a }, { nom: b }) => collator.compare(a, b))',
  partieNom:       'const t = $l.pop(); const titre = t.nom; sauver(titre)',
  boucleChamp:     'for (const t of $l.splice(0, 2)) sauver(t.nom)',
  champParMotif:   'const { id } = $l.pop(); sauver(id)',
  champMotifListe: 'const [{ id }] = $l.splice(i, 1); sauver(id)',
  boucleMotif:     'for (const { id } of $l.splice(0, 2)) sauver(id)',
  champDefaut:     'const t = $l.pop(); const nom = t.nom ?? ""; sauver(nom)',
  comparaison:     'j = Object.is($l.pop(), $sel)',
  dansListe:       'const t = $l.pop(); j = ids.includes(t) || vus.has(t)',
}
// valeur qui sort de l'état, hors de la garde (limites écrites dans docs/11) : aucun avertissement non plus
const SORTIES: Record<string, string> = {
  fonctionScript: 'sauver($l.splice(i, 1)[0])',
  nomFonction:    'const t = $l.pop(); ecrire(t, i)',
  nomMethode:     'const t = $l.splice(0, 1)[0]; this.garder(t)',
  objetFonction:  'sauver({ t: $l.pop() })',
  lancer:         'throw $erreurs.pop()',
  triEntier:      '$l.sort((a, b) => comparer(a, b))',
  boucleEntier:   'for (const t of $l.splice(0, 2)) sauver(t)',
  rangeAilleurs:  'window.t = $l.pop()',
}
const SOURCE_AVIS = `<script lang="js">
  $redo = []; $undo = [{ n: 1 }]; $slides = [{ n: 1 }]; $l = [{ n: 1, id: 1, nom: 'a', a: { b: 1 } }]; $l2 = []; $o = { sel: null }; $sel = null; $erreurs = [];
  const ids = []; const vus = new Set(); const collator = new Intl.Collator(); let j;
  function sauver(o) { return o; }
  function ecrire(o, k) { o.a[k].x = 1; }
  function comparer(a, b) { return 0; }
${Object.entries({ ...COURANT, ...SORTIES }).map(([n, c]) => `  @${n} = function(i, j) { ${c}; };`).join('\n')}
  @signale = function(cmp2) { $l.sort(cmp2); };
</script>
<p>{$l.length} {$redo.length} {$slides.length} {$l2.length} {$o.sel} {$sel}</p>
`
// liste déclarée `string[]` dans le <vars>
const SOURCE_TYPEE = `<vars>
  $urls string[]
</vars>
<script lang="js">
  @retour = function() { location.assign($urls.pop()); };
</script>
<p>{$urls.length}</p>
`
const SOURCE_AVIS_COFFEE = `<script lang="coffee">
  $taches = [{ n: 1 }, { n: 2 }]
  cle = null
  cmp = (a, b) -> a[cle].x = 1; 0
  ecrireC = (o, k, v) -> o[k].x = v
  @tourner = -> $taches.push $taches.shift()
  @trier = (k) -> cle = k; $taches.sort cmp; null
  @nomFonction = (k, v) ->
    t = $taches.pop(); ecrireC t, k, v
  @boucle = ->
    for t in $taches.splice(0, 2)
      ecrireC t, 'n', 1
</script>
<p>{$taches.length}</p>
`
const SOURCE_AVIS_CIVET = `<script>
  $taches = [{ n: 1 }, { n: 2 }]
  ecrireV := (o, k, v) => o[k].x = v
  @tourner = -> $taches.push $taches.shift()
  @nomFonction = (k, v) ->
    t := $taches.pop()
    ecrireV t, k, v
</script>
<p>{$taches.length}</p>
`

async function avis(src: string, opts: Record<string, unknown>): Promise<string[]> {
  const r: any = await transpile(src, { moduleName: 'sz-avis', ...opts } as any)
  return (r.data?.sectionWarnings ?? []).map((w: any) => String(w.message ?? w))
}
const ligneDe  = (src: string, nom: string) => src.split('\n').findIndex((l) => l.includes(`@${nom} =`)) + 1
const aLaLigne = (tous: string[], l: number) => tous.filter((a) => a.includes(`sz-avis, ligne ${l} :`))
// aucun avertissement sur la valeur elle-même (« reçoit un objet brut », « éléments bruts », « sort par ») ; avec le réglage, seul est
// permis celui d'une écriture que MJS ne voit pas (`$l` passé à une fonction, cf. docs/11)
const surLaValeur = (a: string) => /objet brut|éléments bruts|sort par `/.test(a)
const permis      = (a: string, opts: Record<string, unknown>) => opts.proxy === false && a.includes('MJS ne voit pas ce changement') && !surLaValeur(a)

describe('valeur de `pop` & co. : la construction n\'en dit rien, ni sur le code courant ni sur ce qui sort de l\'état', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  for (const [mode, , opts] of MODES) {
    it(`${mode} : code courant, valeur sortie de l'état, comparateur reçu en paramètre — aucun avertissement sur la valeur`, async () => {
      const tous   = await avis(SOURCE_AVIS, opts)
      const fautes = [...Object.keys(COURANT), ...Object.keys(SORTIES), 'signale'].flatMap((n) => aLaLigne(tous, ligneDe(SOURCE_AVIS, n)).filter((a) => !permis(a, opts)).map((a) => `${n} : ${a.slice(0, 160)}`))
      assert.deepEqual(fautes, [])
    })

    it(`${mode} : liste déclarée \`string[]\`, CoffeeScript (comparateur du script, boucle en dernière ligne), Civet — aucun avertissement sur la valeur`, async () => {
      const fautes = (await Promise.all([SOURCE_TYPEE, SOURCE_AVIS_COFFEE, SOURCE_AVIS_CIVET].map((s) => avis(s, opts)))).flat().filter((a) => !permis(a, opts)).map((a) => a.slice(0, 160))
      assert.deepEqual(fautes, [])
    })
  }
})

// ── à l'exécution : chemins suivis, pile des clés ─────────────────────────────────────────────────────────────────────────────────
const INIT = '$objs = [{ a: { n: 0 } }, { a: { n: 0 } }];'
const FORMES: Record<string, string> = {
  valeursPop:    'Object.values($objs.pop())[0][k].polluK = v',
  entreesPop:    'Object.entries($objs.pop())[0][1][k].polluK = v',
  depuisSplice:  'Array.from($objs.splice(0, 1))[0][k].polluK = v',
  assignVidePop: 'Object.assign({}, $objs.pop()).a[k].polluK = v',
  objetLit:      'const o = { t: $objs.pop() }; o.t.a[k].polluK = v',
  listeLit:      'const r = [0, $objs.pop()]; r[1].a[k].polluK = v',
  champObjet:    'const o = {}; o.t = $objs.pop(); o.t.a[k].polluK = v',
  enPlace:       'const t = $objs.pop(); ((o) => { o.a[k].polluK = v; })(t)',
}
// formes hors de la garde : chacune qui atteint un prototype doit être nommée par le paragraphe « Hors de la garde » de docs/11
const LIMITES: Record<string, [string, string]> = {
  limFonction: ['ecrire($objs.pop(), k, v)', 'passée à une fonction'],
  limNom:      ['const t = $objs.pop(); ecrire(t, k, v)', 'passée à une fonction'],
  limRetour:   ['const g = () => $objs.pop(); g().a[k].polluK = v', 'rendue par `return`'],
  limLancer:   ['try { throw $objs.pop(); } catch (e) { e.a[k].polluK = v; }', 'lancée par `throw`'],
  limTri:      ['cle = k; $objs.sort(this.cmpRecu)', 'fonction de comparaison venue d\'ailleurs'],
}
const DOC_11 = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', '11-etat-brut.md')
const SOURCE_JS = `<script lang="js">
  ${INIT}
  $h = [{ get constructor() { throw new Error('x'); } }];
  $g2 = [{ get a() { try { const { [kc]: z } = $h[0]; } catch (e) {} return function f() {}; } }];
  $g3 = [{ get a() { try { let z; ({ [kc]: z } = $h[0]); } catch (e) {} return function f() {}; } }];
  const kc = 'constructor';
  let cle;
  function ecrire(o, k, v) { o.a[k].polluK = v; }
  @cmpRecu = function(a, b) { a.a[cle].polluK = 1; return 0; };
  @remettre = function() { ${INIT} };
${Object.entries(FORMES).map(([n, f]) => `  @${n} = function(k, v) { ${f}; };`).join('\n')}
${Object.entries(LIMITES).map(([n, [f]]) => `  @${n} = function(k, v) { ${f}; };`).join('\n')}
  @valeurs = function() { const o = $objs.pop(); Object.assign({}, o).a.n = 5; Object.values(o)[0].m = 6; const r = [0, o]; r[1].a.p = 7; return JSON.stringify(o); };
  @pile = function(k) { const { [k]: x } = $g2[0]; let y; ({ [k]: y } = $g3[0]); return typeof x + ' ' + typeof y; };
</script>
<p class="etat">{$objs.length}</p>
`
const SOURCE_COFFEE = `<script lang="coffee">
  $taches = [{ n: 1 }, { n: 2 }]
  cle = null
  cmp = (a, b) -> a[cle].polluK = 1; 0
  @remettre = -> $taches = [{ n: 1 }, { n: 2 }]
  @trier = (k) -> cle = k; $taches.sort cmp; null
</script>
<p class="etat">{$taches.length}</p>
`

// pollution des prototypes et fonctions de la page par chaque forme, pour `constructor` puis `__proto__`
const TRACEUR = `globalThis.__parcours = async (balise, formes) => {
  const c = document.querySelector(balise)
  const T = [Object.prototype, Object, Array.prototype, Array, Function.prototype, Function]
  const N = ['Object.prototype', 'Object', 'Array.prototype', 'Array', 'Function.prototype', 'Function']
  const pollues = []
  for (const f of formes) for (const k of ['constructor', '__proto__']) {
    try { await c[f](k, 1) } catch (e) {}
    T.forEach((t, i) => { if (Object.prototype.hasOwnProperty.call(t, 'polluK')) pollues.push(balise + ' ' + f + ' ' + k + ' → ' + N[i]) })
    for (const t of T) delete t.polluK
    c.remettre()
  }
  return pollues
}`
const VALEURS_ATTENDUES = '{"a":{"n":5,"m":6,"p":7}}'
const PILE_ATTENDUE     = 'function function'

type Construit = { racine: string, code: string }

async function construire(nom: string, opts: Record<string, unknown>): Promise<Construit> {
  const root   = mjsTmp('valeur-brute-suivie-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'sz-suivi.mjs'), SOURCE_JS)
  writeFileSync(join(srcDir, 'sz-suivi-c.mjs'), SOURCE_COFFEE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env: 'prod', js: 'bundle', urlPrefix: '/out', ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  return { racine: root, code: readFileSync(join(outDir, 'bundle.js'), 'utf-8') }
}
const constructions = new Map<string, Promise<Construit>>()
const construction  = (nom: string, opts: Record<string, unknown>) => {
  if (!constructions.has(nom)) constructions.set(nom, construire(nom, opts))
  return constructions.get(nom)!
}

describe('valeur de `pop` & co. : copies, objets écrits, fonction en place, comparateur CoffeeScript gardés ; pile des clés sûre (happy-dom)', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  for (const [mode, nom, opts] of MODES) {
    it(`${mode} : aucune forme n'atteint un prototype, les écritures légitimes sont faites, la clé d'un motif survit à une erreur rattrapée`, async () => {
      const { code } = await construction(nom, opts)
      const w: any = new Window({ url: 'http://localhost/' })
      w.eval(code.replace(/import\.meta\.url/g, '\'http://localhost/\'').replace(/export\s*\{[^}]*\}\s*;?/g, ''))
      if (w.µ) w.µ.warn = () => {}
      w.document.body.innerHTML = '<mjs-sz-suivi></mjs-sz-suivi><mjs-sz-suivi-c></mjs-sz-suivi-c>'
      for (const b of ['mjs-sz-suivi', 'mjs-sz-suivi-c']) {
        const c = w.document.querySelector(b)
        for (let i = 0; i < 300 && !c._shadow?.querySelector('.etat')?.textContent; i++) await new Promise((r) => setTimeout(r, 10))
      }
      const c       = w.document.querySelector('mjs-sz-suivi')
      const valeurs = c.valeurs()
      c.remettre()
      const pile = c.pile('a')
      w.eval(TRACEUR)
      // tableaux de la page : recopiés dans ceux du test
      const pollues = [...await w.__parcours('mjs-sz-suivi', Object.keys(FORMES)), ...await w.__parcours('mjs-sz-suivi-c', ['trier'])]
      // hors de la garde : la limite écrite, ou rien d'atteint
      const doc     = readFileSync(DOC_11, 'utf-8').split('\n\n').find((p) => p.startsWith('**Hors de la garde.**')) ?? ''
      const limites = [...await w.__parcours('mjs-sz-suivi', Object.keys(LIMITES))].filter((p: string) => !doc.includes(LIMITES[p.split(' ')[1]][1]))
      await w.happyDOM.close()
      assert.deepEqual({ valeurs, pile, pollues, limites }, { valeurs: VALEURS_ATTENDUES, pile: PILE_ATTENDUE, pollues: [], limites: [] })
    })
  }
})

describe('valeur de `pop` & co. : copies, objets écrits, fonction en place, comparateur CoffeeScript gardés ; pile des clés sûre (navigateurs réels)', function () {
  this.timeout(180000)
  after(() => terminateSharedWorkerPool())

  for (const moteur of ['chromium', 'firefox', 'webkit']) for (const [mode, nom, opts] of MODES) {
    it(`${moteur}, production, ${mode} : aucune forme n'atteint un prototype, écritures légitimes faites, pile des clés sûre`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) { this.skip(); return }
      const browser = await playwright[moteur].launch()
      try {
        const { racine } = await construction(nom, opts)
        const page: Cible = { mode: 'bundle', racine, document: () => '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-sz-suivi></mjs-sz-suivi><mjs-sz-suivi-c></mjs-sz-suivi-c><script type="module" src="/out/bundle.js"></script></body></html>' }
        const o = await charger(browser, page, 'mjs-sz-suivi')
        try {
          await o.page.waitForFunction('!!document.querySelector(\'mjs-sz-suivi\')?._shadow?.querySelector(\'.etat\')?.textContent && !!document.querySelector(\'mjs-sz-suivi-c\')?._shadow?.querySelector(\'.etat\')?.textContent', null, { timeout: 10000 })
          const valeurs = await o.page.evaluate('(() => { const c = document.querySelector(\'mjs-sz-suivi\'); const v = c.valeurs(); c.remettre(); return v })()')
          const pile    = await o.page.evaluate('document.querySelector(\'mjs-sz-suivi\').pile(\'a\')')
          await o.page.evaluate(TRACEUR)
          const pollues = [...await o.page.evaluate(`globalThis.__parcours('mjs-sz-suivi', ${JSON.stringify(Object.keys(FORMES))})`), ...await o.page.evaluate('globalThis.__parcours(\'mjs-sz-suivi-c\', [\'trier\'])')]
          assert.deepEqual({ valeurs, pile, pollues }, { valeurs: VALEURS_ATTENDUES, pile: PILE_ATTENDUE, pollues: [] })
        }
        finally {
          await o.fermer()
        }
      }
      finally {
        await browser.close()
      }
    })
  }
})
