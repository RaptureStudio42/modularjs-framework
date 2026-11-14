// le script d'un partiel inclus (`<@include x>`) est versé au script de l'hôte après le retrait des commentaires, sous une
// ligne d'en-tête qui nomme le partiel : la lecture du script par l'arbre le compile sans erreur (code, avertissements,
// erreur et sa position dans le partiel), en une seule compilation de Civet par script ; un en-tête écrit `#` y était lu
// comme du code (`.length`) et la compilation de l'hôte échouait (« Failed to parse »)

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { adapters } from '../src/languages/index.js'
import { mjsTmp } from './helpers/tmp.js'

const dir = mjsTmp('partiel-script-arbre')
writeFileSync(join(dir, '_id.mjs'), '<script>\n@id = \'depuis le partiel\'\n</script>\n<p>id</p>\n')
writeFileSync(join(dir, '_etat.mjs'), '<script>\n# le compteur du partiel\n$compte = 2\nplus = -> $compte++\n</script>\n<p>{$compte}</p>\n')
writeFileSync(join(dir, '_relais.mjs'), '<script>\n$relais = \'relais\'\n</script>\n<@include etat>\n')
writeFileSync(join(dir, '_cafe.mjs'), '<script lang="coffee">\n# commentaire du partiel\n$tasse = \'cafe\'\n</script>\n<p>cafe</p>\n')
writeFileSync(join(dir, '_brut.mjs'), '<script lang="js">\n// commentaire du partiel\n$brut = \'brut\'\n</script>\n<p>brut</p>\n')
writeFileSync(join(dir, '_partage.mjs'), '<script module>\npartage = \'module du partiel\'\n</script>\n<p>module</p>\n')
writeFileSync(join(dir, '_faute.mjs'), '<script>\n$ok = 1\nx = (\n</script>\n<p>faute</p>\n')

// la compilation : sortie, carte et messages de la console (ou l'erreur), et les compilations de Civet faites par
// l'adaptateur
async function compile(src: string): Promise<{ texte: string, compilations: number }> {
  const civet    = adapters.civet
  const compiler = civet.compileToJs
  const console0 = { warn: console.warn, error: console.error }
  const messages: string[] = []
  let compilations = 0
  civet.compileToJs = (...a: Parameters<typeof compiler>) => {
    compilations++
    return compiler.apply(civet, a)
  }
  console.warn = console.error = (...a: unknown[]) => { messages.push(a.map(String).join(' ')) }
  try {
    const r = await transpile(src, { moduleName: 'hote', baseDir: dir })
    return { texte: `${r.output}\n--- carte\n${r.sourceMap ?? ''}\n--- messages\n${messages.join('\n')}`, compilations }
  }
  catch (e) {
    return { texte: `--- erreur\n${String((e as Error).message ?? e)}\n--- messages\n${messages.join('\n')}`, compilations }
  }
  finally {
    civet.compileToJs = compiler
    Object.assign(console, console0)
  }
}

// la compilation sans erreur, chaque ligne attendue (celle que rendait aussi l'ancienne lecture : sorties, cartes et
// messages égaux au caractère près) et le nombre de compilations de Civet
async function sortieAttendue(src: string, lignes: string[], compilations: number): Promise<string> {
  const r = await compile(src)
  assert.ok(!r.texte.startsWith('--- erreur'), r.texte)
  const lues = r.texte.split('\n').map((l) => l.trim())
  for (const l of lignes) assert.ok(lues.includes(l), `${l}\n${r.texte}`)
  assert.equal(r.compilations, compilations, src)
  return r.texte
}

describe('le script d\'un partiel inclus, lu par l\'arbre', () => {
  it('un hôte sans <script> : le script du partiel, son `@id =` et son avertissement', async () => {
    const texte = await sortieAttendue('<@include id>\n<p>x</p>\n', ['// --- Partial: id ---', "this.id = 'depuis le partiel'"], 1)
    assert.match(texte, /--- messages\n.*@id/)
  })

  it('un partiel qui écrit `$x`, avec un commentaire `#`, et deux partiels dans un même hôte', async () => {
    await sortieAttendue('<script>\n$n = 1\n</script>\n<@include etat>\n<@include id>\n', ['// --- Partial: etat ---', "µ._set(_mjsThis, 'compte', 2)", "let plus = function() { return ((_mjs_n, _mjs_v = _mjs_n++) => (µ._set(_mjsThis, 'compte', _mjs_n), _mjs_v))($.compte) }", '// --- Partial: id ---', "this.id = 'depuis le partiel'"], 1)
  })

  it('un partiel inclus par un partiel', async () => {
    await sortieAttendue('<script>\n$n = 1\n</script>\n<@include relais>\n', ['// --- Partial: relais ---', "µ._set(_mjsThis, 'relais', 'relais')", '// --- Partial: etat ---', "µ._set(_mjsThis, 'compte', 2)"], 1)
  })

  it('le script d\'un partiel écrit en lang="coffee" et en lang="js"', async () => {
    await sortieAttendue('<script>\n$n = 1\n</script>\n<@include cafe>\n<@include brut>\n', ['// --- Partial: cafe ---', "µ._set(_mjsThis, 'tasse', 'cafe')", '// --- Partial: brut ---', "µ._set(_mjsThis, 'brut', 'brut')"], 1)
  })

  it('le <script module> d\'un partiel', async () => {
    await sortieAttendue('<script>\n$n = 1\n</script>\n<@include partage>\n', ['// --- Partial Module: partage ---', "let partage = 'module du partiel'"], 2)
  })

  it('un hôte écrit en lang="coffee" ou en lang="js" : aucune compilation de Civet', async () => {
    await sortieAttendue('<script lang="coffee">\n$n = 1\n</script>\n<@include etat>\n', ['var plus;', "µ._set(_mjsThis, 'n', 1);", '// --- Partial: etat ---', "µ._set(_mjsThis, 'compte', 2);", 'plus = function() {'], 0)
    await sortieAttendue('<script lang="js">\nlet n = 1\n</script>\n<@include brut>\n', ['let n = 1', '// --- Partial: brut ---', "µ._set(_mjsThis, 'brut', 'brut')"], 0)
  })

  it('une faute dans le script d\'un partiel : l\'erreur, à sa position dans le partiel', async () => {
    const r = await compile('<script>\n$n = 1\n</script>\n<@include faute>\n')
    // l'erreur que rendait aussi l'ancienne lecture (même texte, messages compris)
    assert.equal(r.texte.split('\n').slice(0, 2).join('\n'), '--- erreur\n\'hote\' : _faute.mjs:4:1 Failed to parse')
  })
})
