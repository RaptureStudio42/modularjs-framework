// node --import tsx script/compare-lecteur.ts [options] : le lecteur unique (src/reader) contre le compilateur
// d'aujourd'hui, sur tout un corpus. Chaque fichier est lu par les deux ; une passe compare ce qu'ils y voient et
// chaque écart est listé avec son fichier et sa raison : un défaut d'aujourd'hui corrigé (sa raison le dit), ou à
// corriger avant de continuer.
//
// Mode d'emploi (depuis ModularJS/) :
//   node --import tsx script/compare-lecteur.ts
//       le corpus par défaut : les modules du cœur (src/core-modules) et les composants des tests (tests/**/*.mjs)
//   node --import tsx script/compare-lecteur.ts --corpus <appli>/app/assets/modularJS [--corpus <autre dossier>…]
//       ajoute les composants d'une appli (tout le dossier, `vendor/` excepté) ; --sans-coeur, --sans-tests retirent
//       le corpus par défaut
//   --json <fichier>          le détail par fichier (balises vues par chacun, fautes, écarts)
//   --limite <n>              les n premiers fichiers seulement (essai rapide)
//   --mesure <ModularJS>      mesure de temps au lieu de la comparaison : la compilation complète (transpile) du
//                             ModularJS témoin donné (par exemple une copie figée de la version publiée) contre la
//                             lecture par l'arbre, sur les mêmes fichiers, en quatre tours A B B A (le cache du
//                             lecteur vidé avant chaque tour B) ; sur une machine chargée, seuls ces chiffres côte à
//                             côte valent
//   --bundler                 la passe du bundler au lieu de la passe du gabarit : sur chaque source que la construction
//                             lit (composants, partiels, modules .civet, .coffee, .js, .ts), le doute « cette source peut
//                             fabriquer une balise du cœur hors du relevé des balises » (coreTagDoubt) pour chaque attribut
//                             que la construction tranche ainsi, et pour chaque module du cœur sa citation par un autre module
//                             du catalogue (citedByCatalog) : l'ancienne lecture du texte brut (gardée dans cet outil) contre
//                             les requêtes du bundler sur l'arbre, dans les deux sens ; chaque écart est listé avec les
//                             citations que l'arbre range dans un commentaire (le bundler les ignore, c'est voulu), ou,
//                             pour un doute de l'arbre seul, avec la règle du doute qui l'explique (le code du gabarit d'un
//                             composant qui nomme la balise, la valeur texte d'un attribut qui l'écrit sous forme de balise)
//   --lints <ModularJS>       les contrôles du gabarit (a11y, <form> sans action) et les relevés d'images (<@@img>, réglages
//                             d'image des effets) : le ModularJS témoin donné (d'avant leur passage sur l'arbre) contre
//                             celui-ci, chaque composant compilé par les deux (sortie et messages au caractère près), chaque
//                             source relevée par les deux (script/compare-lecteur-lints.ts)
//   --scripts                 le texte que les passes du script donnent au langage (sucre du dialecte, runes, raccourcis :
//                             applyMjsSugarToScript puis tokenize), par le lexeur seul (tokenize) puis par l'arbre
//                             (tokenizeDuScript), pour chaque bloc <script> des composants (même ceux que le compilateur refuse
//                             pour une autre raison) et chaque module .civet ou *.server.mjs : texte ou message d'erreur comparé
//                             au caractère près
//   --dev                     les composants compilés avec les réglages du développement (devWarnings, typesText : ceux de
//                             mjs dev) au lieu de ceux de la production
//   --temoin <ModularJS>      le code compilé de chaque composant par le compilateur témoin donné (une copie de ModularJS
//                             d'avant la passe : ses partiels, ses macros, sa préparation du HTML) puis par celui de cet
//                             arbre : sortie, données, carte, erreur et messages de console comparés au caractère près,
//                             après une compilation à blanc par chacun ; chaque écart est listé avec son premier caractère
//                             différent (sert à toute passe qui remplace un lecteur fait main : l'ancien n'est plus là)
// Sortie : le résumé, puis chaque écart « fichier : raison » ; code 0 sans écart ni faute de lecture de l'arbre, 1
// sinon, 2 pour une erreur d'usage. Passe du bundler : code 0 quand chaque écart a sa raison (des citations en
// commentaire seulement, un doute de l'arbre seul qu'une règle du doute explique), 1 sinon.
// Le corpus : les composants `.mjs` (ceux des sous-dossiers de tests/, sans les partiels `_x.mjs`, que leurs `<@include>` lisent, ni les fichiers
// `*.types.mjs`, `*.effects.mjs`, de leur propre grammaire) ; les modules `.civet` et `*.server.mjs` sont lus par
// l'arbre seul (aucune passe ne les compare encore).
// Passe comparée : les balises du cœur (`<@@x>`, `<mjs-core-x>`) que le gabarit emploie, partiels compris, hors
// commentaires et chaînes — arbre contre `tagRefs` de transpile().

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { freemem, loadavg } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { comparerLints } from './compare-lecteur-lints.js'
import * as acorn from 'acorn'
import ts from 'typescript'
import { scriptReadCounters, tokenizeScript } from '../src/reader/script.js'
import { tokenize, type TokenizeOpts } from '../src/lexer/index.js'
import { withEffectLines } from '../src/bundler/transpile-msg.js'
import { cleanJsExpr } from '../src/generator/utils.js'
import { codeCounters, lineStarts, formatPosition, readFile, traverse, locate, clearCodeCache, type Tag, type File } from '../src/reader/index.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------- arguments

const args = { corpus: [] as string[], json: null as string | null, limite: Infinity, mesure: null as string | null, temoin: null as string | null, coeur: true, tests: true, bundler: false, scripts: false, lints: null as string | null, dev: false }
for (let k = 2; k < process.argv.length; k++) {
  const a = process.argv[k]
  const suivant = (): string => {
    const v = process.argv[++k]
    if (v === undefined) usage(`${a} attend une valeur`)
    return v
  }
  if (a === '--corpus' || a === '--site') args.corpus.push(resolve(suivant()))
  else if (a === '--json') args.json = resolve(suivant())
  else if (a === '--limite') args.limite = Number(suivant())
  else if (a === '--mesure') args.mesure = resolve(suivant())
  else if (a === '--temoin') args.temoin = resolve(suivant())
  else if (a === '--sans-coeur') args.coeur = false
  else if (a === '--sans-tests') args.tests = false
  else if (a === '--bundler') args.bundler = true
  else if (a === '--scripts') args.scripts = true
  else if (a === '--lints') args.lints = resolve(suivant())
  else if (a === '--dev') args.dev = true
  else usage(`option inconnue : ${a}`)
}

function usage(message: string): never {
  console.error(`compare-lecteur : ${message} (mode d'emploi en tête de script/compare-lecteur.ts)`)
  process.exit(2)
}

// ---------------------------------------------------------------- le corpus

interface Source { fichier: string, racine: string, nom: string, coeur: boolean, module: boolean }

const IGNORES = new Set(['node_modules', 'vendor', 'sortie', 'dist', '.git'])

// `sansRacine` : les fichiers posés à la racine du dossier n'en sont pas (les `.mjs` de tests/ y sont des scripts Node)
function sources(racine: string, nom: string, coeur: boolean, sansRacine = false): Source[] {
  const out: Source[] = []
  const descendre = (dossier: string): void => {
    for (const n of readdirSync(dossier).sort()) {
      const p = join(dossier, n)
      if (statSync(p).isDirectory()) {
        if (!IGNORES.has(n)) descendre(p)
      }
      else if (n.startsWith('_') || /\.(types|effects)\.mjs$/.test(n) || (sansRacine && dossier === racine)) continue
      else if (n.endsWith('.civet') || n.endsWith('.server.mjs')) out.push({ fichier: p, racine, nom, coeur, module: true })
      else if (n.endsWith('.mjs')) out.push({ fichier: p, racine, nom, coeur, module: false })
    }
  }
  descendre(racine)
  return out
}

const corpus: Source[] = []
if (args.coeur) corpus.push(...sources(join(ROOT, 'src', 'core-modules'), 'coeur', true))
if (args.tests) corpus.push(...sources(join(ROOT, 'tests'), 'tests', false, true))
for (const c of args.corpus) {
  if (!existsSync(c)) usage(`dossier introuvable : ${c}`)
  const appli = /([^/]+)\/app\/assets\/modularJS\/?$/.exec(c)
  corpus.push(...sources(c, appli ? appli[1] : basename(c), false))
}
const liste = corpus.slice(0, args.limite)
if (liste.length === 0) usage('corpus vide')
const nomCourt = (s: Source): string => `${s.nom}/${relative(s.racine, s.fichier)}`

// ---------------------------------------------------------------- compilateur d'aujourd'hui

type Transpile = (src: string, opts: Record<string, unknown>) => Promise<{ data: { tagRefs: { name: string, kind: string }[] }, output?: string, sourceMap?: string }>

// les réglages de compilation d'un composant du corpus
const optionsDe = (s: Source): Record<string, unknown> => ({ moduleName: basename(s.fichier, '.mjs'), baseDir: dirname(s.fichier), sourceDir: s.racine, defaultScriptLang: 'civet', templateLang: 'civet', maxStateVars: s.coeur ? 0 : 40, devWarnings: args.dev, typesText: args.dev })

async function chargerTranspile(modularjs: string): Promise<Transpile> {
  return (await import(join(modularjs, 'src', 'transpiler', 'index.ts'))).transpile
}

// la compilation d'un composant, ses messages de console retenus (un partiel introuvable s'y imprime)
async function compiler(transpile: Transpile, s: Source, src: string): Promise<{ balises?: Set<string>, erreur?: string, console: number }> {
  const garde = { log: console.log, warn: console.warn, error: console.error }
  let messages = 0
  console.log = console.warn = console.error = () => { messages++ }
  try {
    const r = await transpile(src, optionsDe(s))
    return { balises: new Set(r.data.tagRefs.filter((x) => x.kind === 'shortcut-core' || x.kind === 'literal-core').map((x) => x.name.toLowerCase())), console: messages }
  }
  catch (e) {
    return { erreur: String((e as Error).message ?? e).split('\n')[0].slice(0, 240), console: messages }
  }
  finally {
    Object.assign(console, garde)
  }
}

// ---------------------------------------------------------------- lectures de l'arbre

const lus = new Map<string, File>()
function lire(fichier: string, module = false): File {
  let f = lus.get(fichier)
  if (!f) {
    f = readFile(readFileSync(fichier, 'utf-8'), { file: fichier, module })
    lus.set(fichier, f)
  }
  return f
}

type Resoudre = (nom: string, baseDir: string, sourceDir: string) => { path: string } | null
let resoudrePartiel: Resoudre | null = null

// balises du cœur du gabarit, partiels compris (le compilateur d'aujourd'hui les verse avant de lire)
function balisesDuCoeur(f: File, s: Source, vus = new Set<string>([f.path])): Set<string> {
  const noms = new Set<string>()
  traverse(f, (n) => {
    if (n.kind !== 'balise') return
    const b = n as Tag
    if (b.shape === 'coeur') noms.add(b.name.slice(2).toLowerCase())
    else if (b.shape === 'coeur-litteral') noms.add(b.name.slice('mjs-core-'.length).toLowerCase())
    else if (b.name.toLowerCase() === '@include') {
      const m = /^<@include\s+([./\w-]+?)\s*\/?>/i.exec(f.source.slice(b.start, b.end))
      const p = m && resoudrePartiel(m[1], dirname(f.path), s.racine)
      if (p && !vus.has(p.path)) {
        vus.add(p.path)
        for (const x of balisesDuCoeur(lire(p.path), s, vus)) noms.add(x)
      }
    }
  })
  return noms
}

// où l'arbre voit-il une balise du cœur que seul le compilateur d'aujourd'hui compte ? (la raison d'un écart)
function raison(f: File, nom: string, seul: 'actuel' | 'arbre'): string {
  if (seul === 'arbre') {
    let ou = ''
    traverse(f, (n) => {
      if (!ou && n.kind === 'balise' && [`@@${nom}`, `mjs-core-${nom}`].includes((n as Tag).name.toLowerCase())) ou = formatPosition(f, n.start)
    })
    return `balise lue par l'arbre seul${ou ? ' (' + ou + ')' : ''} : inexpliqué`
  }
  const re = new RegExp(`(?:@@|mjs-core-)${nom}(?![\\w-])`, 'i')
  const dans: string[] = []
  const textesDuCode = f.codes.flatMap((c) => c.texts)
  if (textesDuCode.some((t) => t.kind === 'commentaire' && re.test(t.value))) dans.push('un commentaire du code')
  if (textesDuCode.some((t) => t.kind !== 'commentaire' && t.kind !== 'regex' && re.test(t.value))) dans.push('une chaîne du code')
  traverse(f, (n) => {
    const texte = f.source.slice(n.start, n.end)
    if (n.kind === 'commentaireHtml' && re.test(texte) && !dans.includes('un commentaire HTML')) dans.push('un commentaire HTML')
    if (n.kind === 'commentaireHtml' && /<@include\b/i.test(texte) && !dans.includes('un partiel cité en commentaire HTML')) dans.push('un partiel cité en commentaire HTML')
    if (n.kind === 'texte' && re.test(texte) && !dans.includes('le texte du gabarit')) dans.push('le texte du gabarit')
  })
  return dans.length ? `citée seulement dans ${dans.join(', ')} : le compilateur d'aujourd'hui la compte, l'arbre non` : 'inexpliqué'
}

// positions de l'arbre vérifiées contre le texte : le caractère du fichier sous chaque position ouvre bien la
// chaîne, la regex ou le commentaire, et chaque nom de code s'y lit tel quel
function verifierPositions(f: File, bilan: { justes: number, fausses: string[], sansPosition: number }): void {
  for (const c of f.codes) {
    for (const t of c.texts) {
      if (t.kind === 'gabarit') continue
      if (t.start === null) {
        bilan.sansPosition++
        continue
      }
      const ouvre = t.kind === 'chaine' ? '\'"' : t.kind === 'regex' ? '/' : '#/'
      if (ouvre.includes(f.source[t.start])) bilan.justes++
      else bilan.fausses.push(`${formatPosition(f, t.start)} ${t.kind} ${JSON.stringify(t.value.slice(0, 30))}`)
    }
    for (const n of c.names) {
      if (n.start === null) bilan.sansPosition++
      else if (f.source.startsWith(n.name, n.start)) bilan.justes++
      else bilan.fausses.push(`${formatPosition(f, n.start)} nom ${n.name}`)
    }
  }
}

// ---------------------------------------------------------------- mesure ABBA

async function mesurer(temoin: string): Promise<void> {
  const transpile = await chargerTranspile(temoin)
  const composants = liste.filter((s) => !s.module)
  const textes = composants.map((s) => readFileSync(s.fichier, 'utf-8'))
  const charge = (): string => `charge ${loadavg().map((x) => x.toFixed(1)).join(' / ')}, mémoire libre ${(freemem() / 1024 ** 3).toFixed(1)} Go`
  console.log(`mesure : ${composants.length} composants ; A = transpile() de ${temoin}, B = lecture par l'arbre (cache vidé avant chaque tour B)`)
  for (const tour of ['A', 'B', 'B', 'A']) {
    const avant = charge()
    const t0 = performance.now()
    let echecs = 0
    if (tour === 'A') {
      for (let k = 0; k < composants.length; k++) if ((await compiler(transpile, composants[k], textes[k])).erreur) echecs++
    }
    else {
      clearCodeCache()
      for (let k = 0; k < composants.length; k++) if (readFile(textes[k], { file: composants[k].fichier }).diagnostics.length) echecs++
    }
    const ms = performance.now() - t0
    const detail = tour === 'B' ? ` ; Civet ${Math.round(codeCounters.civetMs)} ms (${codeCounters.compilations} compilations, ${codeCounters.retries} reprises du cache), acorn ${Math.round(codeCounters.acornMs)} ms` : ''
    console.log(`tour ${tour} : ${Math.round(ms)} ms, ${echecs} en échec${detail} — avant : ${avant} ; après : ${charge()}`)
  }
}

// ---------------------------------------------------------------- comparaison

async function comparer(): Promise<number> {
  const transpile = await chargerTranspile(ROOT)
  resoudrePartiel = (await import(join(ROOT, 'src', 'transpiler', 'macros.ts'))).resolvePartial
  const ecarts: string[] = []
  const fautes: string[] = []
  const nonCompares: string[] = []
  const detail: Record<string, unknown>[] = []
  const bilan = { justes: 0, fausses: [] as string[], sansPosition: 0 }
  const compte = { composants: 0, modules: 0, identiques: 0, messagesConsole: 0 }
  for (const s of liste) {
    const src = readFileSync(s.fichier, 'utf-8')
    const f   = lire(s.fichier, s.module)
    const nom = nomCourt(s)
    for (const d of f.diagnostics) fautes.push(`${nom} : ${d.position.slice(s.fichier.length + 1)} ${d.message}`)
    verifierPositions(f, bilan)
    if (s.module) {
      compte.modules++
      detail.push({ fichier: nom, module: true, fautes: f.diagnostics.length })
      continue
    }
    compte.composants++
    const actuel = await compiler(transpile, s, src)
    compte.messagesConsole += actuel.console
    if (actuel.erreur) {
      nonCompares.push(`${nom} : ${actuel.erreur}`)
      detail.push({ fichier: nom, erreurActuel: actuel.erreur, fautes: f.diagnostics.length })
      continue
    }
    const arbre   = balisesDuCoeur(f, s)
    const actuelSeul = [...actuel.balises].filter((x) => !arbre.has(x)).sort()
    const arbreSeul  = [...arbre].filter((x) => !actuel.balises.has(x)).sort()
    for (const x of actuelSeul) ecarts.push(`${nom} : <@@${x}> — ${raison(f, x, 'actuel')}`)
    for (const x of arbreSeul) ecarts.push(`${nom} : <@@${x}> — ${raison(f, x, 'arbre')}`)
    if (!actuelSeul.length && !arbreSeul.length) compte.identiques++
    detail.push({ fichier: nom, balises: [...arbre].sort(), actuelSeul, arbreSeul, fautes: f.diagnostics.length })
  }
  const parCorpus = [...new Set(liste.map((s) => s.nom))].map((n) => `${n} ${liste.filter((s) => s.nom === n).length}`).join(', ')
  console.log(`corpus : ${liste.length} fichiers (${parCorpus}) — ${compte.composants} composants comparés, ${compte.modules} modules lus par l'arbre seul`)
  console.log(`arbre : ${liste.length - new Set(fautes.map((x) => x.split(' : ')[0])).size} fichiers lus sans faute sur ${liste.length} ; ${codeCounters.compilations} compilations de Civet, ${codeCounters.retries} reprises du cache`)
  console.log(`positions vérifiées contre le texte : ${bilan.justes} justes, ${bilan.fausses.length} fausses, ${bilan.sansPosition} sans position`)
  for (const x of bilan.fausses.slice(0, 20)) console.log(`  position fausse : ${x}`)
  console.log(`compilateur d'aujourd'hui en échec (non comparés) : ${nonCompares.length} ; messages de console pendant ses compilations : ${compte.messagesConsole}`)
  for (const x of nonCompares) console.log(`  ${x}`)
  console.log(`passe « balises du cœur du gabarit » : ${compte.identiques} composants identiques, ${ecarts.length} écarts`)
  for (const x of ecarts) console.log(`  ${x}`)
  console.log(`fautes de lecture de l'arbre : ${fautes.length}`)
  for (const x of fautes) console.log(`  ${x}`)
  if (args.json) writeFileSync(args.json, JSON.stringify({ date: new Date().toISOString(), compte, bilan, nonCompares, ecarts, fautes, detail }, null, 1) + '\n')
  return ecarts.length || fautes.length || bilan.fausses.length ? 1 : 0
}

// ---------------------------------------------------------------- passe du bundler

// toutes les sources que la construction lit pour son doute (cf. coreTagDoubted : .mjs, .civet, .coffee, .js, .ts, sans les .d.ts), partiels compris
function sourcesDuBundler(racine: string, sansRacine: boolean): string[] {
  const out: string[] = []
  const descendre = (dossier: string): void => {
    for (const n of readdirSync(dossier).sort()) {
      const p = join(dossier, n)
      if (statSync(p).isDirectory()) {
        if (n !== 'node_modules' && !n.startsWith('.')) descendre(p)
      }
      else if (/\.(?:mjs|civet|coffee|js|ts)$/.test(n) && !n.endsWith('.d.ts') && !(sansRacine && dossier === racine)) out.push(p)
    }
  }
  descendre(racine)
  return out
}

// l'ancienne lecture du bundler, sur le texte brut, gardée ici pour la comparaison : les places qui font douter que la source puisse fabriquer
// la balise du cœur `module` avec l'attribut `attr` — le nom dans un module ou dans les blocs <script> d'un composant, une balise dynamique
// qui écrit l'attribut ou un étalement, ou qui ne se referme pas ; aucune place : pas de doute
function placesBrutes(src: string, module: string, attr: string, script: boolean): number[] {
  const nomme = new RegExp(`(?:mjs-core-|@@)${module}(?![\\w-])`, 'gi')
  if (script) return [...src.matchAll(nomme)].map((x) => x.index)
  const places: number[] = []
  for (const m of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const de = m.index + m[0].length - '</script>'.length - m[1].length
    for (const x of m[1].matchAll(nomme)) places.push(de + x.index)
  }
  const ecrit = new RegExp(`\\s${attr}(?![\\w-])`, 'i')
  for (const m of src.matchAll(/<?@(?:element|module)(?![\w-])/gi)) {
    const fin = finDeBalise(src, m.index + m[0].length)
    if (fin < 0 || /\{\s*\.\.\./.test(src.slice(m.index, fin)) || ecrit.test(src.slice(m.index, fin))) places.push(m.index)
  }
  return places
}

// la fin d'une balise ouverte avant `de` (l'indice qui suit son `>`), valeurs entre guillemets et entre accolades sautées ; -1 sans fin
function finDeBalise(src: string, de: number): number {
  let profondeur = 0
  let guillemet  = ''
  for (let i = de; i < src.length; i++) {
    const c = src[i]
    if (guillemet) {
      if (c === guillemet) guillemet = ''
    }
    else if (c === '"' || c === '\'') guillemet = c
    else if (c === '{') profondeur++
    else if (c === '}') profondeur--
    else if (c === '>' && profondeur <= 0) return i + 1
  }
  return -1
}

// ce que l'arbre range dans un commentaire, du HTML ou du code, en étendues [début, fin[ de la source (un module .js : les commentaires que lit
// acorn ; un module .ts : ceux de l'analyseur lexical de TypeScript) ; null pour une source illisible, ou dont le lecteur change le texte : sert à
// dire la raison d'un écart, jamais à le décider
function etenduesDesCommentaires(src: string, file: string): [number, number][] | null {
  if (/\.js$/i.test(file)) {
    const etendues: [number, number][] = []
    const options = { ecmaVersion: 'latest', allowHashBang: true, allowReturnOutsideFunction: true, onComment: (_bloc: boolean, _texte: string, de: number, a: number) => etendues.push([de, a]) } as const
    try {
      acorn.parse(src, { ...options, sourceType: 'module', allowAwaitOutsideFunction: true })
    }
    catch {
      etendues.length = 0
      try {
        acorn.parse(src, { ...options, sourceType: 'script' })
      }
      catch {
        return null
      }
    }
    return etendues
  }
  if (/\.ts$/i.test(file)) {
    const lex      = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, src)
    const etendues: [number, number][] = []
    for (let k = lex.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = lex.scan()) {
      if (k === ts.SyntaxKind.SingleLineCommentTrivia || k === ts.SyntaxKind.MultiLineCommentTrivia) etendues.push([lex.getTokenStart(), lex.getTokenEnd()])
    }
    return etendues
  }
  if (!/\.(?:mjs|civet|coffee)$/i.test(file)) return null
  const arbre = readFile(src, { file: file, ...(estComposant(file) ? {} : { module: true }) })
  if (arbre.diagnostics.length > 0 || arbre.source !== src) return null
  const etendues: [number, number][] = []
  traverse(arbre, (n) => {
    if (n.kind === 'commentaireHtml') etendues.push([n.start, n.fin])
  })
  for (const code of arbre.codes) {
    for (const t of code.texts) {
      if (t.kind !== 'commentaire' || t.start === null) continue
      const marque = src.startsWith('###', t.start) ? '###' : src.startsWith('/*', t.start) ? '*/' : ''
      const fin    = marque ? src.indexOf(marque, t.start + marque.length) : src.indexOf('\n', t.start)
      etendues.push([t.start, fin < 0 ? code.end : fin + marque.length])
    }
  }
  return etendues
}

// la règle du doute qui explique un doute de l'arbre seul, que l'ancienne lecture du texte brut n'a pas : la valeur texte d'un attribut qui écrit
// la balise sous forme de balise (`<mjs-core-…`, `<@@…`), le code du gabarit d'un composant (gestionnaire, expression, tête de bloc, `:html=!{…}`)
// qui la nomme ; null sans règle
function regleDuDoute(lu: { code: string[], html: string[], values: string[] } | null, module: string): string | null {
  if (lu === null) return null
  const nomme  = new RegExp(`(?:mjs-core-|@@)${module}(?![\\w-])`, 'i')
  const balise = new RegExp('<' + nomme.source, 'i')
  if (lu.values.some((v) => balise.test(v))) return 'la valeur texte d\'un attribut écrit la balise (règle du doute : un enfant peut la poser en HTML brut)'
  if ([...lu.code, ...lu.html].some((t) => nomme.test(t))) return 'le code du gabarit nomme la balise (règle du doute : tout le code d\'un composant compte)'
  return null
}

// un composant .mjs (gabarit et blocs <script>), comme le bundler le range ; tout autre fichier est un module, lu comme un script
let estComposant: (file: string) => boolean = () => false

async function comparerBundler(): Promise<number> {
  const bundler = await import(join(ROOT, 'src', 'bundler', 'index.ts'))
  estComposant  = (await import(join(ROOT, 'src', 'bundler', 'class-files.ts'))).isComponentFile
  const { STRICT_ATTRS } = await import(join(ROOT, 'src', 'bundler', 'core-sections.ts'))
  // les attributs tranchés sur ce doute : ceux de STRICT_ATTRS (coreAttrWrittenStrict) et les listes d'outils des barres (coreToolShown)
  const paires: [string, string][] = [...Object.entries(STRICT_ATTRS as Record<string, string[]>).flatMap(([m, attrs]) => attrs.map((a): [string, string] => [m, a])), ['editor', 'toolbar'], ['toolbar', 'tools']]
  const racines: { nom: string, dossier: string, sansRacine: boolean }[] = []
  if (args.coeur) racines.push({ nom: 'coeur', dossier: join(ROOT, 'src', 'core-modules'), sansRacine: false })
  if (args.tests) racines.push({ nom: 'tests', dossier: join(ROOT, 'tests'), sansRacine: true })
  for (const c of args.corpus) {
    const appli = /([^/]+)\/app\/assets\/modularJS\/?$/.exec(c)
    racines.push({ nom: appli ? appli[1] : basename(c), dossier: c, sansRacine: false })
  }
  const ecarts: string[]      = []
  const inexpliques: string[] = []
  const compte = { sources: 0, questions: 0, doutesBruts: 0, doutesArbre: 0, arbresLus: 0, illisibles: 0, citationsBrutes: 0, citationsArbre: 0 }
  // les commentaires de l'arbre où tombent des places de la source (null : une place hors de tout commentaire)
  const raisons = (src: string, file: string, places: number[]): string[] => {
    const etendues = etenduesDesCommentaires(src, file)
    return places.map((at) => {
      const e = etendues?.find(([de, a]) => at >= de && at < a)
      const { line, column } = locate(lineStarts(src), at)
      if (!e) return `${line}:${column} ${JSON.stringify(src.slice(at, at + 40))}`
      return `${src.startsWith('<!--', e[0]) ? 'commentaire HTML' : 'commentaire du code'} ${line}:${column}`
    })
  }
  const horsCommentaire = (vue: string): boolean => !vue.startsWith('commentaire')
  const t0 = performance.now()
  for (const r of racines) {
    for (const file of sourcesDuBundler(r.dossier, r.sansRacine).slice(0, args.limite)) {
      const src    = readFileSync(file, 'utf-8')
      const nom    = `${r.nom}/${relative(r.dossier, file)}`
      const script = !estComposant(file)
      compte.sources++
      for (const [m, a] of paires) {
        compte.questions++
        const places = placesBrutes(src, m, a, script)
        const brut   = places.length > 0
        const arbre = bundler.coreTagDoubt(src, file, m, a)
        if (brut) compte.doutesBruts++
        if (arbre) compte.doutesArbre++
        if (brut === arbre) continue
        if (!brut) {
          const lu    = bundler.coreTagReadingOf(src, file)
          const regle = regleDuDoute(lu, m)
          ecarts.push(`${nom} : doute <@@${m}> ${a} de l'arbre seul — ${lu === null ? 'source illisible pour l\'arbre (dans le doute, oui)' : regle ?? 'INEXPLIQUÉ'}`)
          if (regle === null) inexpliques.push(nom)
          continue
        }
        const vues = raisons(src, file, places)
        ecarts.push(`${nom} : doute <@@${m}> ${a} du texte brut seul — places : ${vues.map((x) => horsCommentaire(x) ? 'HORS COMMENTAIRE ' + x : x).join(', ')}`)
        if (vues.some(horsCommentaire)) inexpliques.push(nom)
      }
      if (/(?:mjs-core-|@@)[a-z]|@(?:element|module)(?![\w-])/i.test(src) && bundler.coreTagReadingOf(src, file) === null) compte.illisibles++
    }
  }
  const dossierCoeur = join(ROOT, 'src', 'core-modules')
  const catalogue    = readdirSync(dossierCoeur).filter((f) => f.endsWith('.mjs')).sort().map((f) => join(dossierCoeur, f))
  for (const cite of catalogue) {
    const stem = basename(cite, '.mjs')
    const tag  = (): RegExp => new RegExp(`<@@${stem}\\b|<mjs-core-${stem}\\b`, 'gi')
    for (const autre of catalogue) {
      if (autre === cite) continue
      const src   = readFileSync(autre, 'utf-8')
      const brut  = tag().test(src)
      const arbre = bundler.citesCoreTag(src, autre, stem)
      if (brut) compte.citationsBrutes++
      if (arbre) compte.citationsArbre++
      if (brut === arbre) continue
      if (!brut) {
        ecarts.push(`coeur/${stem}.mjs cité par ${basename(autre)} selon l'arbre seul — INEXPLIQUÉ`)
        inexpliques.push(`${stem} par ${basename(autre)}`)
        continue
      }
      const vues = raisons(src, autre, [...src.matchAll(tag())].map((x) => x.index))
      ecarts.push(`coeur/${stem}.mjs cité par ${basename(autre)} selon le texte brut seul — citations : ${vues.map((x) => horsCommentaire(x) ? 'HORS COMMENTAIRE ' + x : x).join(', ')}`)
      if (vues.some(horsCommentaire)) inexpliques.push(`${stem} par ${basename(autre)}`)
    }
  }
  console.log(`passe du bundler : ${compte.sources} sources (${racines.map((r) => r.nom).join(', ')}), ${compte.questions} questions (source, attribut), ${Math.round(performance.now() - t0)} ms`)
  console.log(`doute « une source peut fabriquer une balise du cœur » : ${compte.doutesBruts} au texte brut, ${compte.doutesArbre} avec l'arbre ; sources qui nomment une balise du cœur mais que l'arbre ne lit pas (dans le doute, oui) : ${compte.illisibles}`)
  console.log(`citations entre modules du cœur (module cité, module qui cite) : ${compte.citationsBrutes} au texte brut, ${compte.citationsArbre} avec l'arbre`)
  console.log(`écarts : ${ecarts.length}, dont ${inexpliques.length} inexpliqués (une citation hors commentaire, ou un doute de l'arbre seul qu'aucune règle du doute n'explique)`)
  for (const x of ecarts) console.log(`  ${x}`)
  return inexpliques.length ? 1 : 0
}

// ---------------------------------------------------------------- sorties : compilateur témoin contre celui de cet arbre

// la compilation d'un composant par un compilateur : sortie, données et carte (ou l'erreur), puis chaque message de
// console dans l'ordre
async function compilerPar(transpile: Transpile, s: Source, src: string, options = optionsDe(s)): Promise<{ texte: string, erreur: string | null }> {
  const garde    = { log: console.log, warn: console.warn, error: console.error }
  const messages: string[] = []
  console.log = console.warn = console.error = (...x: unknown[]) => { messages.push(x.map(String).join(' ')) }
  let texte  = ''
  let erreur: string | null = null
  try {
    const r = await transpile(src, options)
    texte = JSON.stringify({ output: r.output ?? null, data: r.data, sourceMap: r.sourceMap ?? null })
  }
  catch (e) {
    // le message tel que le bundler l'écrit : la ligne de la balise d'un effet fautif y est posée (withEffectLines)
    erreur = String((withEffectLines(e, src) as Error).message ?? e)
  }
  finally {
    Object.assign(console, garde)
  }
  return { texte: `${texte}\n--- erreur\n${erreur ?? ''}\n--- console\n${messages.join('\n')}`, erreur }
}

function premierEcart(a: string, b: string, nomA = 'ancienne lecture'): string {
  let k = 0
  while (k < a.length && k < b.length && a[k] === b[k]) k++
  const extrait = (x: string): string => JSON.stringify(x.slice(Math.max(0, k - 50), k + 70))
  return `au caractère ${k} : ${nomA} ${extrait(a)} ; arbre ${extrait(b)}`
}

// le compilateur témoin (d'avant la passe) contre celui de cet arbre, composant par composant
async function comparerTemoin(temoin: string): Promise<number> {
  const avant      = await chargerTranspile(temoin)
  const apres      = await chargerTranspile(ROOT)
  const composants = liste.filter((s) => !s.module)
  // les réglages que le bundler passe à chaque composant (valeurs dérivées précises, page ou non, enveloppe de l'état) : sans eux, le
  // code comparé n'est pas celui d'une construction
  const { isPageFile } = await import(join(ROOT, 'src', 'bundler', 'index.ts'))
  const reglages       = (s: Source): Record<string, unknown> => ({ ...optionsDe(s), derivedPrecise: true, isPageModule: isPageFile(s.fichier), proxy: true })
  const ecarts: string[] = []
  const detail: Record<string, unknown>[] = []
  let identiques = 0
  let erreurs    = 0
  const debut    = Date.now()
  for (const s of composants) {
    const src = readFileSync(s.fichier, 'utf-8')
    await compilerPar(avant, s, src, reglages(s))
    await compilerPar(apres, s, src, reglages(s))
    const a      = await compilerPar(avant, s, src, reglages(s))
    const b      = await compilerPar(apres, s, src, reglages(s))
    const pareil = a.texte === b.texte
    if (pareil) {
      identiques++
      if (a.erreur !== null) erreurs++
    }
    else ecarts.push(`${nomCourt(s)} : ${premierEcart(a.texte, b.texte, 'témoin')}`)
    detail.push({ fichier: nomCourt(s), pareil, erreur: a.erreur, erreurArbre: b.erreur })
  }
  const par = (nom: string): number => composants.filter((s) => s.nom === nom).length
  console.log(`compare-lecteur --temoin ${temoin} : ${composants.length} composants (${[...new Set(composants.map((s) => s.nom))].map((n) => `${n} ${par(n)}`).join(', ')}), ${Math.round((Date.now() - debut) / 1000)} s`)
  console.log(`  sorties identiques au caractère près : ${identiques} (dont ${erreurs} refusés par les deux, même message)`)
  console.log(`  écarts : ${ecarts.length}`)
  for (const e of ecarts) console.log(`  ÉCART ${e}`)
  if (args.json) writeFileSync(args.json, JSON.stringify(detail, null, 1))
  return ecarts.length === 0 ? 0 : 1
}

// ---------------------------------------------------------------- scripts : texte donné au langage, lexeur seul contre arbre

type PassesDuScript = { applyMjsSugarToScript: (src: string, lang?: string) => string }

// les blocs <script> d'un composant, en tête de ligne, fermés par la première `</script>` (un module : tout le fichier)
function blocsDeScript(s: Source, src: string): { lang: string, texte: string }[] {
  if (s.module) return [{ lang: 'civet', texte: src }]
  return [...src.matchAll(/^<script\b([^>\n]*)>\n?([\s\S]*?)^<\/script>/gm)].map((m) => ({ lang: /\blang="(\w+)"/.exec(m[1])?.[1] ?? 'civet', texte: m[2] }))
}

// le texte d'un bloc donné au langage, ses raccourcis posés par `poser` : le lexeur seul (tokenize) ou l'arbre (tokenizeDuScript)
function texteDuScript(p: PassesDuScript, bloc: { lang: string, texte: string }, poser: (texte: string, opts: TokenizeOpts) => string): string {
  const garde = { log: console.log, warn: console.warn, error: console.error }
  console.log = console.warn = console.error = () => {}
  try {
    return poser(p.applyMjsSugarToScript(bloc.texte, bloc.lang), { lang: bloc.lang as 'civet' })
  }
  catch (e) {
    return `--- erreur\n${String((e as Error).message ?? e)}`
  }
  finally {
    Object.assign(console, garde)
  }
}

async function comparerScripts(): Promise<number> {
  const p: PassesDuScript = await import(join(ROOT, 'src', 'transpiler', 'sugar.ts'))
  const ecarts: string[] = []
  const relus  = new Map<string, string[]>()
  let blocs     = 0
  let pareils   = 0
  let erreurs   = 0
  let parArbre  = 0
  const debut   = Date.now()
  for (const s of liste) {
    for (const bloc of blocsDeScript(s, readFileSync(s.fichier, 'utf-8'))) {
      blocs++
      const a     = texteDuScript(p, bloc, tokenize)
      const lus   = scriptReadCounters.tree
      const relu0 = scriptReadCounters.reread
      const b     = texteDuScript(p, bloc, tokenizeScript)
      if (scriptReadCounters.reread > relu0) relus.set(scriptReadCounters.last ?? '?', [...(relus.get(scriptReadCounters.last ?? '?') ?? []), nomCourt(s)])
      else if (scriptReadCounters.tree > lus) parArbre++
      if (a === b) {
        pareils++
        if (a.startsWith('--- erreur')) erreurs++
      }
      else ecarts.push(`${nomCourt(s)} (${bloc.lang}) : ${premierEcart(a, b)}`)
    }
  }
  console.log(`compare-lecteur --scripts : ${liste.length} sources, ${blocs} scripts, ${Math.round((Date.now() - debut) / 1000)} s`)
  console.log(`  textes identiques au caractère près : ${pareils} (dont ${erreurs} refusés par les deux lectures, même message)`)
  console.log(`  écarts : ${ecarts.length}`)
  console.log(`  lus par l'arbre sans relecture : ${parArbre} scripts ; rendus à l'ancienne lecture : ${[...relus.values()].reduce((n, l) => n + l.length, 0)}`)
  for (const [raison, fichiers] of [...relus].sort((x, y) => y[1].length - x[1].length)) console.log(`    ${fichiers.length} × ${raison} — ${fichiers.slice(0, 4).join(', ')}${fichiers.length > 4 ? ', …' : ''}`)
  for (const e of ecarts) console.log(`  ÉCART ${e}`)
  return ecarts.length === 0 ? 0 : 1
}

const code = args.lints ? await comparerLints(liste, ROOT, args.lints, optionsDe, nomCourt) : args.mesure ? (await mesurer(args.mesure), 0) : args.temoin ? await comparerTemoin(args.temoin) : args.scripts ? await comparerScripts() : args.bundler ? await comparerBundler() : await comparer()
process.exit(code)
