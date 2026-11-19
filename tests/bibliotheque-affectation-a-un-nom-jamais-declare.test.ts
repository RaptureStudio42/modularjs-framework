// une bibliothèque `.civet` qui affecte un nom jamais déclaré (`r = new Date(…)` dans une fonction, sans `.=` ni `:=`) : Civet seul la
// compile telle quelle, et le navigateur l'arrête à l'exécution (`ReferenceError: r is not defined`, module strict). La construction
// la refuse, chaque nom à la ligne de sa première affectation, avec les autres motifs, même quand le texte cite µ dans un commentaire ;
// aucun refus pour un nom déclaré (paramètre, décomposition, boucle, `catch`, import, fonction englobante) ou un membre (`a.b = …`,
// `globalThis.x = …`) ; un global du navigateur affecté par son nom (`location = …`) n'est pas nommé : la comparaison au texte lu par
// MJS le refuse, sans son nom, que le texte cite µ ou non ; une bibliothèque `.coffee` n'est pas concernée : CoffeeScript
// déclare lui-même ses variables

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import * as acorn from 'acorn'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { freeAssignments } from '../src/transpiler/timers.js'
import { setMessagesLang } from '../src/messages/index.js'

// une construction d'un projet jetable (développement par défaut), console coupée : ses erreurs et ses fichiers .js publiés
async function construire(fichiers: Record<string, string>, options: Record<string, unknown> = {}): Promise<{ erreurs: string[], publies: Record<string, string> }> {
  const racine  = mkdtempSync(join(tmpdir(), 'biblio-affectation-'))
  const src     = join(racine, 'src')
  const out     = join(racine, 'out')
  const journal = [console.log, console.warn, console.error]
  for (const [nom, texte] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(src, nom)), { recursive: true })
    writeFileSync(join(src, nom), texte)
  }
  console.log = console.warn = console.error = () => {}
  try {
    const b: any  = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(racine, 'bundle.js'), minify: false, ...options } as any)
    const st: any = await b.compile()
    await b.close()
    const publies = {} as Record<string, string>
    for (const f of readdirSync(out)) if (f.endsWith('.js')) publies[f] = readFileSync(join(out, f), 'utf8')
    return { erreurs: (st.errors ?? []).map((e: any) => String(e?.message ?? e)), publies }
  }
  finally {
    [console.log, console.warn, console.error] = journal
    rmSync(racine, { recursive: true, force: true })
  }
}

const composant = (chemin: string) => `<script>\n@import { f } '${chemin}'\nload = -> $r = f()\n</script>\n<p>{$r}</p>\n`

// la seule erreur qui nomme ce fichier
function refusDe(liste: string[], fichier: string): string {
  const siennes = liste.filter(e => e.includes(fichier))
  assert.equal(siennes.length, 1, liste.join('\n') || 'aucune erreur')
  return siennes[0]
}

// quatre affectations sans déclaration (lignes 2, 9, 10, 15), comme la bibliothèque d'une appli qui cassait au navigateur ; la ligne
// 18 cite µ dans un commentaire, que Civet garde dans le code produit
const FAUTIVE = [
  'export pathAdd = (d, ans, months, days) ->',
  '  r = new Date(d.getTime())',
  '  r.setFullYear(r.getFullYear() + ans) if ans',
  '  r.setMonth(r.getMonth() + months) if months',
  '  r.setDate(r.getDate() + days) if days',
  '  r',
  '',
  'export pathGap = (sinceDate, untilDate) ->',
  '  ans    = 0',
  '  months = 0',
  '  while pathAdd(sinceDate, ans + 1, 0, 0) <= untilDate',
  '    ans++',
  '  while pathAdd(sinceDate, ans, months + 1, 0) <= untilDate',
  '    months++',
  '  base = pathAdd(sinceDate, ans, months, 0)',
  '  { ans: ans, month: months, days: Math.max(0, Math.floor((untilDate - base) / 86400000)) }',
  '',
  '// `t` = le traducteur de l\'écran (`(k, v) -> µt(k, v)`)',
  'export f = -> pathGap(new Date(2020, 0, 15), new Date(2026, 10, 16)).ans',
  '',
].join('\n')

// des noms déclarés de toutes les façons, des membres : rien à refuser
const JUSTE = [
  "import { g } from './autre.civet'",
  '',
  'export f := (n, { p, q } = {}) ->',
  '  n += 1',
  '  [a, b] := [n, p ?? q]',
  '  c .= 0',
  '  [c, n] = [n, c]',
  '  for x of [a, b]',
  '    c += x',
  '  try',
  "    JSON.parse('{')",
  '  catch e',
  '    c += String(e).length',
  '  total .= 0',
  '  inc := -> total += 1',
  '  inc()',
  '  o := { n: 0 }',
  '  o.n = c',
  '  globalThis.dernier = o',
  '  window.avant = total',
  "  document.title = 'x'",
  '  [c, total, g()]',
  '',
].join('\n')

describe('bibliothèque .civet : une affectation à un nom jamais déclaré est nommée avec les autres motifs', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  it('la règle, sur le code produit : premier nom affecté par fonction, rien pour un nom déclaré, un membre ou un global connu', () => {
    const js = [
      "import { g } from './autre.js'",
      "import * as tout from './tout.js'",
      'export function f(n, { p, q } = {}, ...reste) {',
      '  n = 1; p = q; reste = []; g = 2; tout = 3',
      '  let [a, b] = [n, p]; [a, b] = [b, a]; ({ a, b } = { a: b, b: a })',
      '  for (const x of [a]) a = x',
      '  try { a = 0 } catch (e) { e = 1 }',
      '  globalThis.x = 1; window.y = 2; o.a.b = 3; location = 4',
      '  v = 5; var v; h = 6; function h() {}',
      '  let total = 0; const inc = () => { total += 1 }',
      '}',
      'export function g2() { r = 1; r = 2; s++; [t] = [1]; ({ u } = {}); for (w of []) {} z += 1 }',
      'function g3() { r = 3 }',
      'compteur = 0',
      'function g4() { compteur += 1 }',
      'function g5() { inner = 1; function g6() { inner = 2 } }',
      'const o = {}',
    ].join('\n')
    const ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module' })
    assert.deepEqual(freeAssignments(ast, nom => ['window', 'location'].includes(nom)).map(a => a.name), ['r', 's', 't', 'u', 'w', 'z', 'r', 'compteur', 'inner'])
  })

  for (const mode of ['dev', 'prod']) {
    it(`quatre affectations sans déclaration, µ cité dans un commentaire : chacune à sa ligne, avec son nom (${mode})`, async () => {
      const e = refusDe((await construire({ 'alpha.mjs': composant('path-time.civet'), 'path-time.civet': FAUTIVE }, mode === 'prod' ? { env: 'prod' } : {})).erreurs, 'path-time.civet')
      assert.match(e, /nommez-le path-time\.civet\.mjs/, e)
      for (const motif of ['ligne 2 : une affectation sans déclaration (« r »)', 'ligne 9 : une affectation sans déclaration (« ans »)', 'ligne 10 : une affectation sans déclaration (« months »)', 'ligne 15 : une affectation sans déclaration (« base »)']) assert.ok(e.includes(motif), `${motif}\n---\n${e}`)
      assert.doesNotMatch(e, /ligne (?:3|4|5|6|12|14|16|18|19) :/, e)
    })
  }

  it('sans µ dans le texte : les mêmes lignes, avec leur nom', async () => {
    const e = refusDe((await construire({ 'alpha.mjs': composant('path-time.civet'), 'path-time.civet': FAUTIVE.replace(/^\/\/.*$/m, '') })).erreurs, 'path-time.civet')
    for (const motif of ['ligne 2 : une affectation sans déclaration (« r »)', 'ligne 9 : une affectation sans déclaration (« ans »)', 'ligne 10 : une affectation sans déclaration (« months »)', 'ligne 15 : une affectation sans déclaration (« base »)']) assert.ok(e.includes(motif), `${motif}\n---\n${e}`)
  })

  it('aucun refus : paramètres, décomposition, boucle, catch, import, fonction englobante, membres', async () => {
    const { erreurs } = await construire({ 'alpha.mjs': composant('lib.civet'), 'lib.civet': JUSTE, 'autre.civet': 'export g := -> 1\n' })
    assert.deepEqual(erreurs, [])
  })

  // un global du navigateur affecté par son nom n'est pas un nom jamais déclaré : cette règle ne le nomme pas ; MJS le déclarerait, Civet
  // seul écrit le global — la comparaison au texte lu par MJS le refuse, sans son nom, que le texte cite µ ou non
  for (const [cas, entete] of [['µ cité', '// la page, sans µ.go\n'], ['sans µ', '']]) {
    it(`un global du navigateur affecté par son nom : refusé sans son nom (${cas})`, async () => {
      const e = refusDe((await construire({ 'alpha.mjs': composant('lib.civet'), 'lib.civet': entete + "export f := -> 1\nexport goHome := -> location = '/'\nexport onTop := -> onscroll = null\n" })).erreurs, 'lib.civet')
      assert.match(e, /une écriture du dialecte de MJS, que Civet seul compilerait autrement/, e)
      assert.doesNotMatch(e, /« (?:location|onscroll) »/, e)
    })
  }

  it('une bibliothèque .coffee : CoffeeScript déclare lui-même la variable, rien à refuser', async () => {
    const { erreurs, publies } = await construire({ 'alpha.mjs': composant('lib.coffee'), 'lib.coffee': 'export f = ->\n  r = new Date(2020, 0, 15)\n  r.getFullYear()\n' })
    assert.deepEqual(erreurs, [])
    const lib = Object.entries(publies).find(([nom]) => nom.startsWith('lib'))?.[1] ?? ''
    assert.match(lib, /var r\b/, lib)
  })

  it('en anglais : mêmes lignes, mêmes noms', async () => {
    setMessagesLang('en')
    try {
      const e = refusDe((await construire({ 'alpha.mjs': composant('path-time.civet'), 'path-time.civet': FAUTIVE })).erreurs, 'path-time.civet')
      for (const motif of ['line 2: an assignment without a declaration ("r")', 'line 9: an assignment without a declaration ("ans")', 'line 10: an assignment without a declaration ("months")', 'line 15: an assignment without a declaration ("base")', 'name it path-time.civet.mjs']) assert.ok(e.includes(motif), `${motif}\n---\n${e}`)
    }
    finally {
      setMessagesLang('fr')
    }
  })
})
