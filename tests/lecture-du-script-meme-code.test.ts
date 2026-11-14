// lecture du script par l'arbre, par défaut : les raccourcis écrits en membres (`$.n`) avant Civet, le code produit est
// celui d'un membre là où Civet choisit sa sortie selon le genre du nœud (nom ou membre) : borne d'une plage lue une fois,
// référence d'une comparaison chaînée, d'un motif, d'un choix d'objet ; un `&x` qui n'est pas un paramètre de route (après
// `...`, `!`, `+`) refusé, dans le <script module> aussi, au lieu d'un JavaScript illisible rendu sans erreur ; un `#` d'un
// gabarit à backticks imbriqué dans `${…}` reste un `#`

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { attendre, monterModule, textes } from './helpers/module-dynamique.js'

async function sortie(src: string): Promise<string> {
  try {
    const r = await transpile(src, { moduleName: 'meme-code', defaultScriptLang: 'civet', templateLang: 'civet', devWarnings: false })
    return `${r.output}\n--- carte\n${r.sourceMap ?? ''}`
  }
  catch (e) {
    return `--- erreur\n${String((e as Error).message ?? e)}`
  }
}

const composant = (script: string): string => `<script>\n${script}\n</script>\n<p>{$n}</p>\n`

// la sortie (ou l'erreur) contient chaque ligne attendue, blancs des bords ôtés
async function contient(src: string, attendues: string[]): Promise<void> {
  const out    = await sortie(src)
  const lignes = out.split('\n').map((l) => l.trim())
  for (const l of attendues) assert.ok(lignes.includes(l), `${l}\n${out}`)
}

describe('lecture du script par l\'arbre — le code d\'un membre', function () {
  this.timeout(60000)

  it('rend le code d\'un membre là où Civet le choisit selon le genre du nœud', async () => {
    // chaque ligne attendue : celle que rendait aussi l'ancienne lecture (sorties égales au caractère près, carte comprise)
    const cas: [string, string][] = [
      ['$n = 3\nfor i of [0...$n]\n  $n++', 'µ._mjs_lq++;try{for (let end = $.n, i1 = 0; i1 < end; ++i1) {const i = i1;'],
      ['$n = 6\nfor i of [0...$n] by 2\n  console.log i', 'for (let end = $.n, i1 = 0; i1 < end; i1 += 2) {const i = i1;'],
      ['$n = 1\nok = 0 < $n < 10', 'let ref;let ok = 0 < (ref = $.n) && ref < 10'],
      ['$n = 1\nok = $a is $b is $c', 'let ref;let ok = $.a === (ref = $.b) && ref === $.c'],
      ['$n = 1\np = $o{a, b}', 'let ref;let p = {a:(ref = $.o).a, b:ref.b}'],
      ['$n = 1\nswitch $x\n  [a, b]\n    r = a\n  else\n    r = 0', 'let m;if(m = $.x,Array.isArray(m) && len(m, 2)) {const [a, b] = m;'],
      ['$n = 1\nok = 0 < &page < 10', 'let ref;let ok = 0 < (ref = µ.url.params.page) && ref < 10'],
      ['$n = 1\np = &o{a, b}', 'let ref;let p = {a:(ref = µ.url.params.o).a, b:ref.b}']
    ]
    for (const [script, ligne] of cas) await contient(composant(script), [ligne])
  })

  it('refuse un `&x` ou un `$x` que Civet ne lit pas comme un raccourci, à sa position dans le fichier', async () => {
    // chaque erreur attendue : celle que rendait aussi l'ancienne lecture (même message, même position)
    const cas: [string, string][] = [
      ['$n = 1\nfor i of [0...&max]\n  console.log i', "'meme-code' : meme-code.mjs:3:19 Failed to parse"],
      ['$n = 1\nx = !&id', "'meme-code' : meme-code.mjs:3:9 Failed to parse"],
      ['$n = 1\nfunction $f() { return 1 }', "'meme-code' : meme-code.mjs:3:24 Failed to parse"]
    ]
    for (const [script, erreur] of cas) await contient(composant(script), ['--- erreur', erreur])
  })

  it('refuse un `&x` après `...` dans le <script module>, au lieu d\'un JavaScript illisible', async () => {
    const src = '<script module>\nexport f = ->\n  for i of [0...&max]\n    console.log i\n</script>\n<script>\n$n = 1\n</script>\n<p>{$n}</p>\n'
    // l'erreur que rendait aussi l'ancienne lecture
    await contient(src, ['--- erreur', "'meme-code' : meme-code.mjs:3:21 Failed to parse"])
  })

  it('lit la borne d\'une plage une seule fois dans un composant construit et monté', async () => {
    const m = await monterModule({ hote: '<script>\n$n = 3\n$tours = 0\nfor i of [0...$n]\n  $n++ if $n < 6\n  $tours++\n</script>\n<p>{$tours}</p>\n' }, { prefixe: 'meme-code' })
    await attendre(() => (textes(m.hote, 'p')[0] ?? '') !== '')
    assert.deepEqual(textes(m.hote, 'p'), ['3'])
    assert.deepEqual(m.erreurs(), [])
  })

  it('garde le `#` d\'un gabarit à backticks écrit dans `${…}`', async () => {
    assert.match(await sortie(composant('$n = 1\nt = `a${ `x # y` }c`')), /`a\$\{ `x # y` \}c`/)
  })

  it('relit les commentaires d\'un script qui cite aussi un raccourci dans une chaîne sur plusieurs lignes', async () => {
    const out = await sortie(composant("$n = 1\ns = 'un\n$x &id\nfin'\nt = `a${1 # note\n}b`"))
    assert.match(out, /let s = 'un\\n\$x &id\\nfin'/)
    assert.match(out, /`a\$\{1 \/\/ note\n\}b`/)
  })
})
