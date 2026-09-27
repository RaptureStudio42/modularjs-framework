// µminmax $x, 0, 10 (sucre Civet, sans parenthèses) — même règle que la forme parenthésée
// (mu-minmax-suffixe-chemin-imbrique.test.ts). Avant, `µminmax $o.cle, 0, 10` ne capturait que `$o`
// et laissait `.cle` hors quotes (`µ.minmax _mjsThis, 'o'.cle, 0, 10`) : accès de propriété sur
// une chaîne, `undefined`, jamais borné, sans la moindre erreur. Un chemin FIXE borne désormais la
// propriété ; la forme documentée, sur une variable simple, reste inchangée. Refus, avec un message
// clair, pour un espace autour du point, un appel en suffixe ou un index entre crochets : un `.`
// COLLÉ n'était pas la seule façon d'écrire un chemin, et chacune de ces formes échappait
// pareillement à la détection. Une
// énumération de suffixes interdits ratait encore la variante suivante — parenthèse ou crochet
// IMBRIQUÉS (`$o(bar())`, `$o[a[0]]`) — d'où la bascule vers une liste blanche (seule une virgule
// termine légitimement le premier argument), comme la forme parenthésée (sigils.ts).

import assert from 'node:assert/strict'
import { applyMjsSugarToScript, transpile } from '../src/transpiler/index.js'

describe('µminmax $x, 0, 10 (sans parenthèses) — forme documentée, inchangée', () => {
  it("µminmax \$x, 0, 10 → µ.minmax _mjsThis, 'x', 0, 10", () => {
    assert.equal(
      applyMjsSugarToScript('µminmax $x, 0, 10', 'civet'),
      "µ.minmax _mjsThis, 'x', 0, 10"
    )
  })
})

describe('µminmax $o.cle, 0, 10 (sans parenthèses) — un chemin fixe borne la propriété', () => {
  it("applyMjsSugarToScript : clé en tableau, jamais la forme cassée 'o'.cle", () => {
    assert.equal(
      applyMjsSugarToScript('µminmax $o.cle, 0, 10', 'civet'),
      "µ.minmax _mjsThis, ['o', 'cle'], 0, 10"
    )
  })

  it('dans le <script> d\'un composant (forme sans parenthèses) : compile', async () => {
    const src = '<script>\n$o = {cle: 50}\nµminmax $o.cle, 0, 10\n</script>\n<p>{$o.cle}</p>'
    await assert.doesNotReject(transpile(src, { moduleName: 'minmax-sans-parentheses-chemin' }))
  })
})

describe('µminmax $o . cle, 0, 10 (sans parenthèses) — espace autour du point, refusé pareil', () => {
  it("applyMjsSugarToScript : erreur claire, jamais la forme cassée 'o' . cle", () => {
    assert.throws(
      () => applyMjsSugarToScript('µminmax $o . cle, 0, 10', 'civet'),
      /µminmax/
    )
  })

  it('dans le <script> d\'un composant : la compilation échoue avec ce message', async () => {
    const src = '<script>\n$o = {cle: 50}\nµminmax $o . cle, 0, 10\n</script>\n<p>{$o.cle}</p>'
    await assert.rejects(transpile(src, { moduleName: 'minmax-sans-parentheses-espace' }), /µminmax/)
  })
})

describe('µminmax $o.f(), 0, 10 (sans parenthèses) — appel en suffixe, refusé pareil', () => {
  it('applyMjsSugarToScript : erreur claire, jamais un appel sur la chaîne recopiée', () => {
    assert.throws(
      () => applyMjsSugarToScript('µminmax $o.f(), 0, 10', 'civet'),
      /µminmax/
    )
  })
})

describe('µminmax $o[cle], 0, 10 (sans parenthèses) — index entre crochets, refusé pareil', () => {
  it("applyMjsSugarToScript : erreur claire, jamais l'index recopié sur la chaîne ('o'[cle])", () => {
    assert.throws(
      () => applyMjsSugarToScript('µminmax $o[cle], 0, 10', 'civet'),
      /µminmax/
    )
  })

  it('dans le <script> d\'un composant : la compilation échoue avec ce message', async () => {
    const src = '<script>\n$o = [1, 2, 3]\ncle = 0\nµminmax $o[cle], 0, 10\n</script>\n<p>{$o}</p>'
    await assert.rejects(transpile(src, { moduleName: 'minmax-sans-parentheses-index' }), /µminmax/)
  })
})

describe('µminmax $o(bar()), 0, 10 (sans parenthèses) — parenthèse IMBRIQUÉE, refusée pareil', () => {
  it("applyMjsSugarToScript : erreur claire qui cite le chemin entier, jamais un appel sur la chaîne recopiée", () => {
    assert.throws(
      () => applyMjsSugarToScript('µminmax $o(bar()), 0, 10', 'civet'),
      /µminmax[\s\S]*\$o\(bar\(\)\)/
    )
  })

  it('dans le <script> d\'un composant : la compilation échoue avec ce message', async () => {
    const src = '<script>\n$o = (x) => x\nbar = -> 0\nµminmax $o(bar()), 0, 10\n</script>\n<p>{$o}</p>'
    await assert.rejects(transpile(src, { moduleName: 'minmax-sans-parentheses-appel-imbrique' }), /µminmax[\s\S]*\$o\(bar\(\)\)/)
  })
})

describe('µminmax $o[a[0]], 0, 10 (sans parenthèses) — crochet IMBRIQUÉ, refusé pareil', () => {
  it("applyMjsSugarToScript : erreur claire qui cite le chemin entier, jamais l'index recopié sur la chaîne", () => {
    assert.throws(
      () => applyMjsSugarToScript('µminmax $o[a[0]], 0, 10', 'civet'),
      /µminmax[\s\S]*\$o\[a\[0\]\]/
    )
  })

  it('dans le <script> d\'un composant : la compilation échoue avec ce message', async () => {
    const src = '<script>\n$o = [[1, 2], [3, 4]]\na = [0]\nµminmax $o[a[0]], 0, 10\n</script>\n<p>{$o}</p>'
    await assert.rejects(transpile(src, { moduleName: 'minmax-sans-parentheses-crochet-imbrique' }), /µminmax[\s\S]*\$o\[a\[0\]\]/)
  })
})

describe('µminmax cité dans une chaîne ou un commentaire — jamais de faux positif', () => {
  it('chaîne littérale : ne lève pas, le texte ressort intact', () => {
    const src = "texte = 'appelle µminmax \$o.cle, 0, 10 pour borner'"
    assert.doesNotThrow(() => applyMjsSugarToScript(src, 'civet'))
  })

  it('commentaire // : ne lève pas, le code voisin reste intact', () => {
    const src = '// µminmax $o.cle, 0, 10 est refuse ici\ndoStuff()'
    assert.doesNotThrow(() => applyMjsSugarToScript(src, 'civet'))
  })
})
