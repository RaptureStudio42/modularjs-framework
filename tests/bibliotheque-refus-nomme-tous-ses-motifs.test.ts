// une bibliothèque `.civet` / `.coffee` qui se sert d'écritures de MJS est refusée en une seule construction, avec TOUS ses motifs —
// directive, µ, nom de rune, lignes du dialecte (commentaire `#`, `isnt`, `#{…}`, `for … in`, affectation sans déclaration) —, chacun
// à sa ligne quand elle est sûre, dix au plus, dans l'ordre du fichier ; une affectation sur deux lignes (`o =` puis sa valeur),
// qu'aucune ligne réécrite ne montre, est nommée à sa ligne, avec son nom ; une écriture que MJS lit autrement sans qu'une ligne
// réécrite la montre est nommée sans ligne

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'

// les erreurs d'une construction d'un projet jetable (développement par défaut), console coupée
async function erreurs(fichiers: Record<string, string>, options: Record<string, unknown> = {}): Promise<string[]> {
  const racine  = mkdtempSync(join(tmpdir(), 'biblio-motifs-'))
  const src     = join(racine, 'src')
  const journal = [console.log, console.warn, console.error]
  for (const [nom, texte] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(src, nom)), { recursive: true })
    writeFileSync(join(src, nom), texte)
  }
  console.log = console.warn = console.error = () => {}
  try {
    const b: any  = new Bundler({ sourceDir: src, outputDir: join(racine, 'out'), manifestPath: join(racine, 'bundle.js'), minify: false, ...options } as any)
    const st: any = await b.compile()
    return (st.errors ?? []).map((e: any) => String(e?.message ?? e))
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

const DIRECTIVE_ET_DIALECTE = [
  "@import { g } 'autre.civet'",
  '# un commentaire',
  'export f := (l) ->',
  '  s .= 0',
  '  for x in l',
  '    s += x',
  '  s',
  'compteur = 0',
  'export h := -> compteur += 1',
  'export k := (a, b) -> a isnt b',
  'export m := (n) -> "n = #{n}"',
  '',
].join('\n')

describe('bibliothèque .civet / .coffee refusée : tous ses motifs dans un seul message', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  for (const mode of ['dev', 'prod']) {
    it(`une directive et cinq lignes du dialecte : chacune à sa ligne, en une construction (${mode})`, async () => {
      const e = refusDe(await erreurs({ 'alpha.mjs': composant('lib.civet'), 'lib.civet': DIRECTIVE_ET_DIALECTE, 'autre.civet': 'export g := -> 1\n' }, mode === 'prod' ? { env: 'prod' } : {}), 'lib.civet')
      assert.match(e, /nommez-le lib\.civet\.mjs/, e)
      for (const motif of [
        "ligne 1 : la directive « @import { g } 'autre.civet' »",
        'ligne 2 : un commentaire « # »',
        'ligne 5 : la boucle « for … in »',
        'ligne 8 : une affectation sans déclaration',
        'ligne 10 : « isnt »',
        "ligne 11 : l'interpolation « #{…} »",
      ]) assert.ok(e.includes(motif), `${motif}\n---\n${e}`)
      assert.doesNotMatch(e, /ligne (?:3|4|6|7|9) :/, e)
    })
  }

  it('µ, un nom de rune et une ligne du dialecte, sans directive', async () => {
    const e = refusDe(await erreurs({ 'alpha.mjs': composant('lib.civet'), 'lib.civet': "export f := -> µ.log('x')\nexport µ$$compte := { n: 0 }\nexport k := (a, b) -> a isnt b\n" }), 'lib.civet')
    for (const motif of ['ligne 1 : µ', 'ligne 2 : le nom de rune « µ$$compte »', 'ligne 3 : « isnt »']) assert.ok(e.includes(motif), `${motif}\n---\n${e}`)
  })

  it('dix motifs au plus, dans l\'ordre du fichier : la suite est annoncée', async () => {
    const texte = Array.from({ length: 14 }, (_, i) => `export k${i} := (a, b) -> a isnt b`).join('\n') + '\n'
    const e     = refusDe(await erreurs({ 'alpha.mjs': composant('lib.civet'), 'lib.civet': texte + 'export f := -> 1\n' }), 'lib.civet')
    for (let n = 1; n <= 10; n++) assert.ok(e.includes(`ligne ${n} : « isnt »`), `ligne ${n}\n---\n${e}`)
    assert.ok(!e.includes('ligne 11 :'), e)
    assert.match(e, /et d'autres encore/, e)
  })

  it('une affectation sur deux lignes, sans ligne réécrite : nommée à sa ligne, avec son nom', async () => {
    const e = refusDe(await erreurs({ 'alpha.mjs': composant('lib.civet'), 'lib.civet': 'o =\n  a: 1\nexport f := -> o.a\n' }), 'lib.civet')
    assert.ok(e.includes('ligne 1 : une affectation sans déclaration (« o »)'), e)
    assert.doesNotMatch(e, /ligne (?:2|3) :|une écriture du dialecte de MJS/, e)
  })

  // MJS déclarerait `compte` dans `bump`, Civet seul y écrit la variable du module déclarée plus bas : les deux lectures diffèrent, et
  // aucune ligne réécrite seule ne le montre
  it('une écriture que MJS lit autrement, sans ligne réécrite qui la montre : nommée sans ligne', async () => {
    const e = refusDe(await erreurs({ 'alpha.mjs': composant('lib.civet'), 'lib.civet': 'export f := ->\n  bump()\n  compte\nfunction bump()\n  compte = compte + 1\ncompte .= 0\n' }), 'lib.civet')
    assert.match(e, /une écriture du dialecte de MJS, que Civet seul compilerait autrement/, e)
    assert.doesNotMatch(e, /ligne \d+ :/, e)
  })

  it('une bibliothèque .coffee : la directive et µ', async () => {
    const e = refusDe(await erreurs({ 'alpha.mjs': composant('lib.coffee'), 'lib.coffee': "@import { g } 'autre.civet'\nexport f = -> µ.log('x')\n", 'autre.civet': 'export g := -> 1\n' }), 'lib.coffee')
    assert.ok(e.includes("ligne 1 : la directive « @import { g } 'autre.civet' »"), e)
    assert.match(e, /(?:ligne 2 : )?µ/, e)
    assert.match(e, /nommez-le lib\.coffee\.mjs/, e)
  })

  it('en anglais : mêmes motifs, mêmes lignes', async () => {
    setMessagesLang('en')
    try {
      const e = refusDe(await erreurs({ 'alpha.mjs': composant('lib.civet'), 'lib.civet': DIRECTIVE_ET_DIALECTE, 'autre.civet': 'export g := -> 1\n' }), 'lib.civet')
      for (const motif of ['line 1: the directive "@import { g } \'autre.civet\'"', 'line 2: a "#" comment', 'line 5: the "for … in" loop', 'line 8: an assignment without a declaration', 'line 10: "isnt"', 'line 11: the "#{…}" interpolation', 'name it lib.civet.mjs']) assert.ok(e.includes(motif), `${motif}\n---\n${e}`)
    }
    finally {
      setMessagesLang('fr')
    }
  })
})
