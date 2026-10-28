// L'extension VS Code : les alias que ModularJS livre (`*filter.frosted_glass`) et les effets qu'une appli déclare dans ses fichiers
// `*.effects.mjs` (`*titre = *scramble(311, on: click)`, `*halo(color: #0ff) =` puis son CSS) se complètent et s'expliquent au survol
// comme les effets de la bibliothèque. L'extension ne connaissait ni les uns ni les autres : rien après `*filter.`, aucun réglage dans
// `*filter.gray_spot(`, aucun survol (le point coupait le nom). Les réglages dont la règle mêle un type et des mots (`zoom: bool | 'spin'`)
// ne proposaient aucun de leurs mots, et l'aide n'existait qu'en français, quelle que soit la langue de VS Code.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MJS_ALIASES } from '../src/effects/aliases-mjs.js'
// @ts-expect-error — module JavaScript sans types
import * as generateur from '../script/vscode-effects.mjs'

const ICI     = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const help    = require('../editors/vscode/effects-help.js')
const labels  = (l: any[]) => l.map((s: any) => s.label)
const donnees = (fichier: string) => JSON.parse(readFileSync(join(ICI, '../editors/vscode', fichier), 'utf-8'))
// chargé à l'usage : chaque cas dit sa propre faute
const appli   = () => require('../editors/vscode/effects-app.js')

// un fichier d'effets d'appli : deux effets réglés (l'un à travers l'autre), un alias à soi, un alias qui remplace celui de MJS, deux effets CSS
const FICHIER = [
  '<effects>',
  '  // les titres',
  '  *titre = *scramble(311, on: click)',
  '  *grand_titre = *titre(order: center)',
  '  *filter.net = *filter(sepia, amount: 0.5)',
  '  *filter.frosted_glass = *filter(blur: 4)',
  '  *halo(color: #0ff, size: 12px) =',
  '    box-shadow: 0 0 $size $color',
  '  *battement(scale: 1.1) =',
  '    @keyframes',
  '      50%',
  '        transform: scale($scale)',
  '</effects>'
].join('\n')
const CHEMIN  = 'file:///projet/app/modularjs/titres.effects.mjs'

describe('extension VS Code — les alias livrés et les effets de l\'appli', () => {
  it('effects.json porte les alias que ModularJS livre : ce qu\'on voit (chapitre 38), leur écriture, les valeurs qu\'ils donnent', () => {
    const effets = donnees('effects.json')
    const livres = MJS_ALIASES.split('\n').map((l) => /^\*([a-z][a-z0-9-]*)\.([a-z][a-z0-9_]*) = /.exec(l))
    assert.equal(livres.length, 200)
    const sansAide = livres.filter((m) => !m || !effets[m[1]].aliases?.[m[2]]?.help).map((m) => m ? m[0] : '?')
    assert.deepEqual(sansAide, [], 'chaque alias livré dit ce qu\'on voit')
    const verre = effets.filter.aliases.frosted_glass
    assert.equal(verre.help, 'la photo est floue partout, nette sous la souris')
    assert.equal(verre.written, '*filter(style: none, blur: 12, spot: 240, soft: 100)')
    assert.deepEqual(verre.set, { style: 'none', blur: '12', spot: '240', soft: '100' })
  })

  it('effects-app.json suit le catalogue : les réglages que tout effet CSS de l\'appli reçoit (sinon : node --import tsx/esm script/vscode-effects.mjs)', () => {
    const modele = donnees('effects-app.json')
    assert.deepEqual(modele, generateur.buildAppEffects())
    assert.deepEqual(Object.keys(modele.still), ['on', 'duration', 'delay', 'easing'])
    assert.ok(modele.animated.on.values.includes('success'), 'une animation se joue aussi à la fin d\'une action')
  })

  it('après *effet. : ses alias, avec ce qu\'on voit ; jamais dans un calcul, rien pour un effet inconnu', () => {
    const r = help.suggest('<img *filter.')
    assert.ok(labels(r).includes('frosted_glass') && labels(r).includes('gray_spot'), JSON.stringify(labels(r)))
    assert.equal(r.length, 16)
    const verre = r.find((s: any) => s.label === 'frosted_glass')
    assert.equal(verre.insert, 'frosted_glass')
    assert.match(verre.detail, /floue partout/)
    assert.match(verre.help, /\*filter\(style: none, blur: 12, spot: 240, soft: 100\)/)
    assert.ok(labels(help.suggest('<img *filter.fro')).includes('frosted_glass'), 'le début du nom écrit')
    assert.ok(labels(help.suggest('<div @in=*ink.')).includes('brush'), 'après @in=')
    assert.deepEqual(help.suggest('{$a *filter.'), [])
    assert.deepEqual(help.suggest('<img *inconnu.'), [])
    assert.deepEqual(help.suggest('<img *toString.'), [])
  })

  it('dans *effet.alias( : les réglages de l\'effet, avec la valeur que l\'alias leur donne', () => {
    const r = help.suggest('<img *filter.gray_spot(')
    assert.ok(labels(r).includes('spot') && labels(r).includes('blur'))
    assert.match(r.find((s: any) => s.label === 'spot').detail, /\(alias : 280\)/)
    assert.match(r.find((s: any) => s.label === 'blur').detail, /\(défaut 0\)/)
    assert.ok(!labels(help.suggest('<img *filter.gray_spot(spot: 90, ')).includes('spot'), 'spot déjà écrit')
    assert.deepEqual(labels(help.suggest('<img *filter.gray_spot(ring: ')), ['true', 'false'])
  })

  it('au survol de *effet.alias, sur l\'effet comme sur l\'alias : l\'alias entier ; au survol d\'un réglage : sa règle et la valeur de l\'alias', () => {
    const ligne = '<img src="a.png" *filter.frosted_glass(blur: 20)>'
    for (const mot of ['filter', 'frosted', 'glass']) {
      const md = help.hover(ligne, ligne.indexOf(mot) + 1)
      assert.match(md, /\*\*\\\*filter\.frosted_glass\*\* · Images · alias livré par ModularJS/, mot)
      assert.match(md, /la photo est floue partout, nette sous la souris/)
      assert.match(md, /`\*filter\.frosted_glass` = `\*filter\(style: none, blur: 12, spot: 240, soft: 100\)`/)
      assert.match(md, /\| blur \| [^|]+ \| 12 \(alias\) \|/)
      assert.match(md, /\| contrast \| [^|]+ \| 1 \|/)
    }
    assert.match(help.hover(ligne, ligne.indexOf('blur:') + 1), /\*\*blur\*\* — réglage de `\*filter\.frosted_glass`[\s\S]*alias : `12`/)
    assert.match(help.hover('<img *filter.inconnu>', 7), /\*\*\\\*filter\*\* · Images/, 'un alias inconnu : l\'effet')
    assert.match(help.hover('<p *neon(#f0f).</p>', 5), /\*\*\\\*neon\*\*/, 'un point de phrase après l\'effet')
  })

  it('les réglages dont la règle mêle un type et des mots proposent leurs mots', () => {
    const effets = donnees('effects.json')
    assert.deepEqual(effets.hologram.settings.zoom.values, ['true', 'false', 'spin'])
    assert.deepEqual(labels(help.suggest('<div *hologram(zoom: ')), ['true', 'false', 'spin'])
    assert.deepEqual(labels(help.suggest('<img *behind(edge: ')), ['zoom', 'blur'])
    assert.deepEqual(labels(help.suggest('<div *heatmap(show: ')), ['true', 'false'])
  })

  it('un fichier d\'effets se lit : chaque déclaration, sa ligne, l\'effet qu\'elle règle ou ses réglages CSS', () => {
    const lu = appli().readEffectsFile(FICHIER)
    assert.deepEqual(lu.map((d: any) => d.name), ['titre', 'grand_titre', 'filter.net', 'filter.frosted_glass', 'halo', 'battement'])
    assert.deepEqual(lu[0], { name: 'titre', line: 3, target: 'scramble', args: '311, on: click' })
    assert.deepEqual(lu[4], { name: 'halo', line: 7, params: [['color', '#0ff'], ['size', '12px']], animated: false })
    assert.equal(lu[5].animated, true)
    assert.deepEqual(appli().readEffectsFile('<p>sans bloc</p>'), [])
    assert.deepEqual(appli().readEffectsFile('<effects>\n  *a = \n  ligne illisible\n  *b = *neon(#f0f\n  *c = *fade\n</effects>').map((d: any) => d.name), ['c'], 'une déclaration illisible est sautée')
  })

  it('les effets de l\'appli : après *, entre leurs parenthèses (les réglages de l\'effet réglé, ou les leurs), au survol', () => {
    const app = appli().appEffects({ [CHEMIN]: FICHIER })
    assert.deepEqual(Object.keys(app).sort(), ['battement', 'filter.frosted_glass', 'filter.net', 'grand_titre', 'halo', 'titre'])
    const etoile = labels(help.suggest('<h1 *', { app }))
    assert.ok(etoile.includes('titre') && etoile.includes('halo') && etoile.includes('neon'))
    assert.ok(!etoile.includes('filter.net'), 'un alias se propose après le point')
    const point = help.suggest('<img *filter.', { app })
    assert.ok(labels(point).includes('net') && labels(point).includes('gray_spot'))
    assert.equal(labels(point).filter((l: string) => l === 'frosted_glass').length, 1, 'l\'alias de l\'appli remplace celui de MJS')
    assert.match(help.hover('<img *filter.frosted_glass>', 8, { app }), /\*filter\(blur: 4\)/)
    const titre = help.suggest('<h1 *titre(', { app })
    assert.ok(labels(titre).includes('order') && labels(titre).includes('chars'))
    assert.match(titre.find((s: any) => s.label === 'speed').detail, /\(alias : 311\)/)
    assert.match(titre.find((s: any) => s.label === 'on').detail, /\(alias : click\)/)
    const grand = help.suggest('<h1 *grand_titre(', { app })
    assert.match(grand.find((s: any) => s.label === 'order').detail, /\(alias : center\)/)
    assert.match(grand.find((s: any) => s.label === 'speed').detail, /\(alias : 311\)/, 'à travers *titre')
    assert.match(help.suggest('<img *filter.net(', { app }).find((s: any) => s.label === 'style').detail, /\(alias : sepia\)/, 'la valeur sans nom : le principal')
    const halo = help.suggest('<p *halo(', { app })
    assert.deepEqual(labels(halo), ['color', 'size', 'on', 'duration', 'delay', 'easing'])
    assert.match(halo.find((s: any) => s.label === 'size').detail, /\(défaut 12px\)/)
    assert.deepEqual(labels(help.suggest('<p *halo(on: ', { app })), ['always', 'hover', 'view', 'click', 'load'])
    assert.ok(labels(help.suggest('<p *battement(on: ', { app })).includes('success'), 'une animation : success et error en plus')
    const md = help.hover('<h1 *titre>', 6, { app })
    assert.match(md, /\*\*\\\*titre\*\* · Texte · effet de l'appli/)
    assert.match(md, /`titres\.effects\.mjs`, ligne 3/)
    assert.match(md, /`\*titre` = `\*scramble\(311, on: click\)`/)
    assert.match(help.hover('<p *halo>', 4, { app }), /\*\*\\\*halo\*\* · effet CSS de l'appli[\s\S]*\| \*\*color\*\* \| [^|]+ \| #0ff \|/)
    assert.equal(help.hover('<h1 *titre>', 6), null, 'sans les effets de l\'appli : inconnu')
  })

  it('les effets de l\'appli se tiennent à jour : un fichier enregistré remplace ses effets, un fichier disparu les retire', () => {
    const { createStore, isEffectsFile } = appli()
    assert.ok(isEffectsFile('/p/app/titres.effects.mjs') && !isEffectsFile('/p/app/titres.mjs'))
    const store = createStore()
    store.put(CHEMIN, FICHIER)
    store.put('file:///projet/app/modularjs/autres.effects.mjs', '<effects>\n  *eclat = *neon(#f0f)\n</effects>')
    assert.ok(store.effects().titre && store.effects().eclat)
    store.put(CHEMIN, '<effects>\n  *sous_titre = *scramble(20)\n</effects>')
    assert.ok(!store.effects().titre && store.effects().sous_titre && store.effects().eclat)
    store.drop(CHEMIN)
    assert.deepEqual(Object.keys(store.effects()), ['eclat'])
  })

  it('l\'aide suit la langue de VS Code : l\'anglais hors du français', () => {
    assert.equal(help.language('fr'), 'fr')
    assert.equal(help.language('fr-ca'), 'fr')
    assert.equal(help.language(undefined), 'fr')
    assert.equal(help.language('en'), 'en')
    assert.equal(help.language('de'), 'en')
    const en   = { lang: 'en' }
    const neon = help.suggest('<h1 *neon(', en)
    assert.match(neon.find((s: any) => s.label === 'size').detail, /0\.2\.\.5 \(default 1\)/)
    assert.match(neon.find((s: any) => s.label === 'color').detail, /^a CSS color \(default #0ff\) — the main one$/)
    const md = help.hover('<h1 *neon(#f0f, size: 2)>', 6, en)
    assert.match(md, /\*\*\\\*neon\*\* · Text\n/)
    assert.match(md, /\| setting \| rule \| default \|/)
    assert.match(md, /\| \*\*color\*\* \| a CSS color \| #0ff \|/)
    assert.match(md, /`\*neon\(color\)` — the main setting is written without its name\./)
    assert.doesNotMatch(md, /réglage|défaut|principal/)
    assert.match(help.settingHelp('neon', 'size', en), /^\*\*size\*\* — setting of `\*neon`\n\nfloat 0\.2\.\.5 · default: `1`$/)
    assert.match(help.hover('<div @in=*crossfade>', 11, en), /^Lifecycle only: `@in=\*crossfade`, `@out=\*crossfade`, `@transition=\*crossfade`\.$/m)
    assert.match(help.hover('<img *filter.gray_spot>', 7, en), /· Images · alias shipped with ModularJS/)
    assert.match(help.suggest('<img *filter.gray_spot(', en).find((s: any) => s.label === 'spot').detail, /\(alias: 280\)/)
    const app = appli().appEffects({ [CHEMIN]: FICHIER })
    assert.match(help.hover('<h1 *titre>', 6, { lang: 'en', app }), /· Text · app effect[\s\S]*`titres\.effects\.mjs`, line 3/)
    assert.match(help.suggest('<p *halo(', { lang: 'en', app }).find((s: any) => s.label === 'color').detail, /^a CSS value/)
    assert.match(help.settingHelp('neon', 'size'), /réglage de `\*neon`/, 'le français reste l\'aide par défaut')
  })
})
