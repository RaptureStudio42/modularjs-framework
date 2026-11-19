// une valeur qui attend lue avant sa première réponse, en développement : le chapitre 3 dit qu'un message dit UNE fois quoi écrire. Un
// seul avis par variable et par composant, quelles que soient les formes lues (texte, boucle, décomposition, étalement, méthode) ; et
// le conseil de la forme lue : un étalement `...($r or [])`, une boucle `for … of ($r or [])` (écrite `for … of`, jamais `for … in`),
// une décomposition `{…} = ($r or {})`, une lecture `($r or []).length` ; la lecture d'un champ qui n'est pas celui d'une liste
// (`$r.nom`) : ce qu'elle rend, undefined, et `µpending($r)` pour montrer l'attente, sans `or []`, qui n'y changerait rien
// (happy-dom, vraie construction en développement)
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monter } from './helpers/derivee-await-banc.js'

const tete = (lit: string) => `<script>\n  f  = (q) -> fetch("/api/t-#{q}").then((r) -> r.json())\n  $r = await f(1)\n  @lit = ->\n${lit}\n</script>\n`
const TOUT    = tete('    a = []\n    a.push(x) for x of $r\n    {total} = $r\n    [a.length, [...$r].length, total, $r.map((x) -> x)]') + '<b>{$r.length}</b>\n'
const ETALE   = tete('    [...$r].length') + '<i>x</i>\n'
const BOUCLE  = tete('    a = []\n    a.push(x) for x of $r\n    a.length') + '<i>x</i>\n'
const DECOMPO = tete('    {total} = $r\n    total') + '<i>x</i>\n'
const LONGUE  = tete('    0') + '<b>{$r.length}</b>\n'
const CHAMP   = tete('    $r.nom') + '<i>x</i>\n'

describe('valeur qui attend lue avant sa réponse : un avis par variable, le conseil de la forme', function () {
  this.timeout(200000)
  after(async () => { await terminateSharedWorkerPool() })

  let w: any
  const avisDe = (balise: string): string[] => [...w.__avis].filter((a: string) => a.includes(`<${balise}>`) && /lit \$r avant sa première réponse/.test(a))

  before(async () => {
    w = await monter('avis-une-fois', { 'tout.mjs': TOUT, 'etale.mjs': ETALE, 'boucle.mjs': BOUCLE, 'decompo.mjs': DECOMPO, 'longue.mjs': LONGUE, 'champ.mjs': CHAMP }, '<mjs-tout></mjs-tout><mjs-etale></mjs-etale><mjs-boucle></mjs-boucle><mjs-decompo></mjs-decompo><mjs-longue></mjs-longue><mjs-champ></mjs-champ>')
    for (const balise of ['mjs-tout', 'mjs-etale', 'mjs-boucle', 'mjs-decompo', 'mjs-longue', 'mjs-champ']) w.document.querySelector(balise).lit()
  })
  after(() => { w?.close() })

  it('cinq formes lues dans un composant : un seul avis', () => {
    assert.equal(avisDe('mjs-tout').length, 1, avisDe('mjs-tout').join('\n'))
  })

  it('un étalement : le conseil de l\'étalement, pas .length', () => {
    const a = avisDe('mjs-etale')
    assert.equal(a.length, 1, a.join('\n'))
    assert.ok(a[0].includes('...$r lit $r') && a[0].includes('Écrivez ...($r or [])'), a[0])
    assert.ok(!a[0].includes('.length'), a[0])
  })

  it('une boucle for … of : écrite for … of, son conseil', () => {
    const a = avisDe('mjs-boucle')
    assert.equal(a.length, 1, a.join('\n'))
    assert.ok(a[0].includes('for … of $r lit $r') && a[0].includes('Écrivez for … of ($r or [])'), a[0])
    assert.ok(!a[0].includes('for … in'), a[0])
  })

  it('une décomposition : un objet vide', () => {
    const a = avisDe('mjs-decompo')
    assert.equal(a.length, 1, a.join('\n'))
    assert.ok(a[0].includes('Écrivez {…} = ($r or {})'), a[0])
  })

  it('une lecture .length : ($r or []).length', () => {
    const a = avisDe('mjs-longue')
    assert.equal(a.length, 1, a.join('\n'))
    assert.ok(a[0].includes('$r.length lit $r') && a[0].includes('Écrivez ($r or []).length'), a[0])
  })

  it('la lecture d\'un champ $r.nom : elle rend undefined, µpending($r) montre l\'attente, aucun or []', () => {
    const a = avisDe('mjs-champ')
    assert.equal(a.length, 1, a.join('\n'))
    assert.ok(a[0].includes('$r.nom lit $r') && a[0].includes('la lecture rend undefined') && a[0].includes('µpending($r) pour montrer l\'attente'), a[0])
    assert.ok(!a[0].includes(' or ') && !a[0].includes('Écrivez'), a[0])
  })
})
