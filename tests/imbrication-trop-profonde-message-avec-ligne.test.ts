// Gabarit imbriqué sur des milliers de niveaux (balises dans des balises, `{if}` dans des `{if}`) :
// l'analyse et la génération descendent d'un appel par niveau, la pile d'appels finit par déborder
// et la construction s'arrêtait sur « RangeError: Maximum call stack size exceeded », sans dire où.
// Le message doit désormais nommer le problème et donner la ligne ; le fichier est cité par le
// constructeur, comme pour toute erreur de composant.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, pileDebordee } from '../src/parser/index.js'
import { compile } from '../src/generator/index.js'
import { transpile } from '../src/transpiler/index.js'
import { lireFichier, parcourir } from '../src/reader/index.js'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const balises = (n: number): string => '<p>a</p>\n' + '<div>\n'.repeat(n) + 'x' + '</div>'.repeat(n)
const blocs = (n: number): string => '{if $a}\n'.repeat(n) + 'x' + '{end}'.repeat(n)

const messageClair = (e: any): boolean => {
  assert.ok(!(e instanceof RangeError), 'pas de RangeError brute : ' + e?.message)
  assert.match(e.message, /imbrication trop profonde/i)
  assert.match(e.message, /ligne \d+/)
  return true
}

describe('imbrication trop profonde : message clair, avec la ligne', function () {
  this.timeout(120000)

  it('analyse : 20 000 balises imbriquées', () => {
    assert.throws(() => parse(balises(20000), []), messageClair)
  })

  // avant l'analyse, la construction cherche les `<@include>` dans l'arbre du gabarit : ce parcours ne descend pas d'un
  // appel par niveau, sinon la pile déborde là, hors de la garde qui nomme le problème
  it('composant entier : 20 000 balises imbriquées, le même message clair', async () => {
    await assert.rejects(transpile(balises(20000), { moduleName: 'p' } as any), messageClair)
  })

  it('parcours de l\'arbre : 200 000 niveaux visités sans épuiser la pile', () => {
    let vus = 0
    parcourir(lireFichier(balises(200000), { gabarit: true }), () => { vus++ })
    assert.ok(vus > 200000, vus + ' nœuds visités')
  })

  it('parcours de l\'arbre : parent avant enfants, enfants dans l\'ordre, branches des blocs comprises', () => {
    const arbre   = lireFichier('<a><b>1</b>{if $x}<c>2</c>{elsif $y}<d>{for v in $l}<e>3</e>{if v}<h></h>{else}vide{end}{end}</d>{else}5{end}<f>{$z}</f></a><g></g>', { gabarit: true })
    const attendu: any[] = []
    const visites: any[] = []
    const reference = (n: any): void => {
      attendu.push(n)
      for (const enfant of n.enfants ?? []) reference(enfant)
      for (const branche of n.branches ?? []) for (const enfant of branche.enfants) reference(enfant)
    }
    reference(arbre)
    parcourir(arbre, (n) => { visites.push(n) })
    assert.ok(attendu.length > 12, attendu.length + ' nœuds dans l\'arbre du test')
    assert.ok(attendu.some((n) => n.sorte === 'bloc' && n.branches.length === 3), 'un bloc à trois branches dans l\'arbre du test')
    assert.ok(attendu.some((n) => n.sorte === 'bloc' && n.nom === 'for'), 'un {for} dans une branche')
    assert.equal(visites.length, attendu.length)
    assert.ok(visites.every((n, i) => n === attendu[i]), 'même ordre que la descente parent, enfants, branches')
  })

  it('génération : 1 500 `{if}` imbriqués (l\'analyse passe, la génération déborde)', () => {
    assert.doesNotThrow(() => parse(blocs(1500), []))
    assert.throws(() => compile(blocs(1500), {}), messageClair)
  })

  it('une imbrication ordinaire se construit toujours', () => {
    assert.doesNotThrow(() => compile(blocs(50), {}))
    assert.doesNotThrow(() => parse(balises(500), []))
  })

  // la pile peut s'épuiser pendant que le moteur compile une expression régulière (la première fois, ou après que le
  // ramasse-miettes a jeté sa forme compilée) : l'erreur est alors une SyntaxError « Invalid regular expression … Maximum
  // call stack size exceeded », et non une RangeError — c'est le même débordement
  it('le débordement reconnu sous ses deux formes : RangeError, et SyntaxError d\'une regex compilée trop profond', () => {
    assert.equal(pileDebordee(new RangeError('Maximum call stack size exceeded')), true)
    assert.equal(pileDebordee(new SyntaxError('Invalid regular expression: /(?<![\\w.$])µ\\.?minmax\\b/: Maximum call stack size exceeded')), true)
    assert.equal(pileDebordee(new SyntaxError('Invalid regular expression: /(?<![\\w.$])µ\\.?minmax\\b/: Stack overflow')), true)
    assert.equal(pileDebordee(new SyntaxError('Invalid regular expression: /(/: Unterminated group')), false)
    assert.equal(pileDebordee(new Error('Maximum call stack size exceeded')), false)
    assert.equal(pileDebordee(new TypeError('x is not a function')), false)
  })

  it('construction d\'un projet : le fichier ET la ligne sont cités', async () => {
    const root = mjsTmp('imbrication')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'tres-profond.mjs'), '<script>\n$a = 1\n</script>\n' + blocs(1500))
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    let message = ''
    let app: any
    try {
      app = await createHarness({ root })
    }
    catch (e: any) {
      message = String(e?.message ?? e)
    }
    finally {
      if (app) await app.destroy()
    }
    assert.match(message, /tres-profond\.mjs/)
    assert.match(message, /imbrication trop profonde/i)
    assert.match(message, /ligne \d+/)
  })
})
