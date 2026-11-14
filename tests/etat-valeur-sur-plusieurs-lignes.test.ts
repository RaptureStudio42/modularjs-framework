// `µ$x =` dont la valeur continue sous sa ligne (écrite dessous en retrait, liste ou objet sur plusieurs lignes, suite en `.`) :
// la valeur est celle que Civet lit pour `x =`, entourée une seule fois de `µ.state(…)`, lue dans l'arbre de Civet et jamais
// sur le texte (un crochet seul dans une expression régulière ne trompe rien) ; une chaîne `"""` qui cite `µ$x =` garde son texte

import assert from 'node:assert/strict'
import { compile } from '@danielx/civet'
import { transpile } from '../src/transpiler/index.js'
import { applyMjsSugarToScript, singletonsDeclares } from '../src/transpiler/sugar.js'
import { tokenize } from '../src/lexer/index.js'
import { getAdapter } from '../src/languages/index.js'
import { declarationsDeLaPasse } from '../src/languages/civet-declarations.js'

const enLigne = (js: string) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
const message = (e: any) => 'erreur : ' + String(e?.message ?? e).split('\n')[0]
let numero    = 0

// valeur rendue par `f()` d'un module compilé par ModularJS ; le faux `µ.state` enveloppe ce qu'il reçoit, pour le voir
const valeurModule = async (src: string): Promise<string> => {
  try {
    const passe    = declarationsDeLaPasse()
    const texte    = tokenize(applyMjsSugarToScript(src, 'civet', undefined, '<script module>', 1, undefined, passe), { moduleMode: true, singletons: singletonsDeclares(src), fileName: 'essai.civet', firstLine: 1 })
    const { code } = await getAdapter('civet').compileToJs(texte, { fileName: 'essai.civet', bare: true, declarerAffectations: true, declarationsDeLaPasse: passe })
    const mod      = await import(enLigne('const µ = {state: (o) => ({etat: o})}\n' + code) + '#' + numero++)
    return JSON.stringify(await mod.f())
  }
  catch (e: any) {
    return message(e)
  }
}

// même chose, compilé par Civet seul avec `"civet autoVar"`
const valeurCivet = async (src: string): Promise<string> => {
  try {
    const js  = await compile('"civet autoVar"\n' + src, { js: true }) as unknown as string
    const mod = await import(enLigne(js) + '#' + numero++)
    return JSON.stringify(await mod.f())
  }
  catch (e: any) {
    return message(e)
  }
}

const CAS: [string, string, string][] = [
  ['la valeur écrite dessous, en retrait', 'µ$x =\n  [1, 2]\nexport f = -> µ$x\n', '{"etat":[1,2]}'],
  ['un objet écrit dessous, sur plusieurs niveaux', 'µ$x =\n  a: 1\n  b:\n    c: 2\nexport f = -> µ$x\n', '{"etat":{"a":1,"b":{"c":2}}}'],
  ['une liste ouverte en fin de ligne', 'µ$x = [\n  1\n  2\n]\nexport f = -> µ$x\n', '{"etat":[1,2]}'],
  ['une liste ouverte au milieu, refermée dessous', 'µ$x = [1,\n  2]\nexport f = -> µ$x\n', '{"etat":[1,2]}'],
  ['un opérateur en fin de ligne', 'µ$x = 1 +\n  2\nexport f = -> µ$x\n', '{"etat":3}'],
  ['la valeur dessous, puis une suite en `.` au retrait de la tête', 'µ$x =\n  [1, 2]\n.map (v) -> v * 10\nexport f = -> µ$x\n', '{"etat":[10,20]}'],
  ['une instruction après le crochet fermant', 'µ$x = [\n  1\n]; y = 2\nexport f = -> [µ$x, y]\n', '[{"etat":[1]},2]'],
  ['un crochet seul dans une expression régulière', 'µ$motifs = [\n  /\\(/\n]\nexport f = -> µ$motifs.etat.map (m) -> m.source\n', '["\\\\("]'],
  ['une suite en retrait', 'µ$x = [1, 2]\n  .map (v) -> v + 1\nexport f = -> µ$x\n', '{"etat":[2,3]}'],
  ['la forme sur une ligne, commentaire compris', 'µ$n = 5  # compteur\nexport f = -> µ$n\n', '{"etat":5}'],
  ['un singleton exporté, objet écrit dessous', 'export µ$$reglages =\n  theme: "sombre"\n  taille: 2\nexport f = -> µ$$reglages\n', '{"etat":{"theme":"sombre","taille":2}}'],
  ['un singleton exporté, liste ouverte et crochet de regex', 'export µ$$regles = [\n  /[(]/\n]\nexport f = -> µ$$regles.etat.length\n', '1']
]

describe('µ$x = : une valeur sur plusieurs lignes, lue dans l\'arbre de Civet', () => {
  for (const [titre, src, attendu] of CAS) {
    it(titre, async () => {
      assert.equal(await valeurModule(src), attendu)
    })
  }

  it('une chaîne """ qui cite `µ$x =` sur plusieurs lignes garde son texte', async () => {
    const src = 'doc = """\n  µ$x = [1, 2]\n    .map (v) -> v\n"""\nexport f = -> doc\n'
    assert.equal(await valeurModule(src), await valeurCivet(src))
  })

  it('une chaîne """ qui cite `µ$x = 5` garde son texte', async () => {
    const src = 'doc = """\n  µ$x = 5\n"""\nexport f = -> doc\n'
    assert.equal(await valeurModule(src), await valeurCivet(src))
  })

  it('composant : un objet écrit sous `µ$x =` entre entier dans `µ.state(…)`', async () => {
    const { output } = await transpile('<script>\nµ$x =\n  a: 1\n  b: 2\n</script>\n<p>a</p>\n', { moduleName: 'essai' })
    assert.match(output, /µ\.state\(\s*\{\s*a: 1,\s*b: 2,?\s*\}\s*\)/)
  })

  it('composant : une chaîne """ qui cite `µ$x =` garde son texte', async () => {
    const { output } = await transpile('<script>\ndoc = """\n  µ$x = [1, 2]\n"""\n</script>\n<p>{doc}</p>\n', { moduleName: 'essai' })
    assert.ok(output.includes('µ$x = [1, 2]'), 'le texte cité reste tel quel')
  })
})
