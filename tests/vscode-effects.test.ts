// L'extension VS Code (editors/vscode) : les effets proposés pendant la frappe — après `*`, leurs
// réglages dans `*nom(`, leurs mots permis après `réglage:` —, et leur aide au survol. Ses effets
// (effects.json) suivent le catalogue du framework et le chapitre 38 de la doc : un effet ajouté, un
// réglage changé sans relancer script/vscode-effects.mjs, et ce test le dit.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EFFECTS } from '../src/effects/catalog.js'
// @ts-expect-error — module JavaScript sans types
import { buildEffects } from '../script/vscode-effects.mjs'

const ICI     = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const help    = require('../editors/vscode/effects-help.js')
const labels  = (l: any[]) => l.map((s: any) => s.label)

describe('extension VS Code — les effets', () => {
  it('effects.json suit le catalogue et la doc (sinon : node --import tsx/esm script/vscode-effects.mjs)', () => {
    const fichier = JSON.parse(readFileSync(join(ICI, '../editors/vscode/effects.json'), 'utf-8'))
    assert.deepEqual(fichier, buildEffects())
    assert.equal(Object.keys(fichier).length, Object.keys(EFFECTS).length)
    const sansAide = Object.keys(fichier).filter((n) => !fichier[n].help)
    assert.deepEqual(sansAide, [], 'chaque effet dit ce qu\'il fait')
    const sansRegle = Object.keys(fichier).flatMap((n) => Object.keys(fichier[n].settings).filter((k) => !fichier[n].settings[k].rule).map((k) => `${n}.${k}`))
    assert.deepEqual(sansRegle, [], 'chaque réglage dit sa règle')
  })

  it('après * : les effets', () => {
    assert.ok(labels(help.suggest('<h1 *ne')).includes('neon'))
    assert.ok(labels(help.suggest('<div @in=*')).includes('fly'))
    assert.deepEqual(help.suggest('{$a*'), [], 'pas dans un calcul')
  })

  it('dans *nom( : ses réglages pas encore écrits, la règle et le défaut en détail', () => {
    const r = help.suggest('<h1 *neon(')
    assert.ok(labels(r).includes('color') && labels(r).includes('size'))
    assert.match(r.find((s: any) => s.label === 'size').detail, /0\.2\.\.5[\s\S]*défaut 1/)
    assert.ok(!labels(help.suggest('<h1 *neon(color: red, ')).includes('color'), 'color déjà écrit')
    assert.ok(!labels(help.suggest('<h1 *neon(red, ')).includes('color'), 'la première valeur sans nom est le principal')
    assert.equal(help.suggest('<h1 *neon(size: 2, ').find((s: any) => s.label === 'where').insert, 'where: ')
  })

  it('après réglage: — ses mots permis ; au début, ceux du principal', () => {
    assert.deepEqual(labels(help.suggest('<b *lift(on: ')), ['hover', 'view', 'click', 'always'])
    assert.ok(labels(help.suggest('<b *lift(on: ho')).includes('hover'))
    assert.ok(labels(help.suggest('<span *loader(')).includes('bloom'), 'les styles du loader, principal')
    assert.deepEqual(help.suggest('<h1 *neon(color: #f'), [], 'une couleur : rien à proposer')
  })

  it('un effet dans un effet : le plus profond', () => {
    assert.ok(labels(help.suggest('<b *delta(fx: *scramble(')).includes('speed'))
    assert.ok(labels(help.suggest('<b *delta(fx: *scramble(20), ')).includes('up'), 'refermé : de nouveau ceux de *delta')
  })

  it('au survol : l\'effet (ce qu\'il fait, son principal, ses réglages) ; un réglage (sa règle, son défaut)', () => {
    const ligne = '<h1 class="t" *neon(#f0f, size: 2)>Soirée</h1>'
    const effet = help.hover(ligne, ligne.indexOf('neon') + 2)
    assert.match(effet, /\*\*\\\*neon\*\* · Texte/)
    assert.match(effet, /lueur de néon/)
    assert.match(effet, /\| \*\*color\*\* \| une couleur CSS \| #0ff \|/)
    assert.match(effet, /\| where \| text, box, both \| text \|/)
    const reglage = help.hover(ligne, ligne.indexOf('size') + 1)
    assert.match(reglage, /\*\*size\*\* — réglage de `\*neon`[\s\S]*défaut : `1`/)
    assert.equal(help.hover(ligne, ligne.indexOf('class') + 1), null, 'un attribut HTML : rien')
  })
})
