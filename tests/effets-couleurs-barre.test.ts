// Une couleur CSS dont la barre oblique suit un pourcentage (`hsl(210 50% 20% / .4)`, `rgb(0% 0% 0% / 50%)`, `rgb(calc(100% / 2) 0 0)`) ou une
// parenthèse (`url(/a.png)`) s'écrit en clair, hors guillemets, dans les réglages d'un effet : sur une balise, sur une transition (`@in=*nom(…)`), dans un
// alias ou un effet d'un fichier `*.effects.mjs`. Elle arrive entière dans la pose, et le reste de la balise (attributs suivants, autres effets, texte après)
// est intact. Un réglage est du CSS, des mots ou des listes, jamais du JavaScript : la barre oblique n'y ouvre jamais une regex (elle avalait la parenthèse
// fermante et, avec une seconde barre sur la même balise, tout le texte entre les deux, sans erreur). Les expressions de gabarit et de script gardent leur
// lecture (parser-barre-expressions.test.ts).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { collectEffectDefs } from '../src/bundler/effects-files.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import type { ProjectEffect } from '../src/effects/catalog.js'
import { mjsTmp } from './helpers/tmp.js'

// les écritures que la construction refusait (ou lisait de travers) hors guillemets
const REFUSEES = [
  'rgb(0% 0% 0% / 50%)',
  'hsl(210 50% 20% / .4)',
  'hsl(210 50% 20% / 50%)',
  'hsl(210deg 50% 20% / .4)',
  'hsl(210 50% 20%/.4)',
  'hsl(none 50% 20% / .4)',
  'hwb(200 20% 30% / .5)',
  'rgb(calc(100% / 2) 0 0)',
  'var(--a, hsl(0 0% 0% / 50%))',
  'url(/a.png)'
]

// … et celles qui passaient déjà : la pose reste la même
const ACCEPTEES = [
  'rgba(0, 0, 0, .5)',
  'rgb(0 0 0 / 50%)',
  'rgb(0 0 0/50%)',
  'oklch(70% 0.1 200 / 50%)',
  'oklch(0.7 0.1 200 / 0.5)',
  'oklab(0.7 0.1 0.1 / 0.5)',
  'lab(29% 39 20 / .5)',
  'lch(29% 39 20 / .5)',
  'hwb(194 0% 0%)',
  'color-mix(in srgb, red 40%, blue)',
  'color-mix(in oklab, red 40%, blue)',
  'rgb(from red r g b / 50%)',
  'hsl(from red h s l / 50%)',
  'color(display-p3 1 0 0 / 50%)',
  'light-dark(#fff, #000)',
  'hsl(calc(360 / 3) 50% 50%)',
  '#12345678',
  'currentColor'
]

async function compiler(source: string, effectDefs?: Record<string, ProjectEffect>): Promise<string> {
  return (await transpile(source, { moduleName: 'couleurs-barre', effectDefs })).output
}

// la pose d'un effet sur une balise, telle que le compilateur l'écrit
const pose = (effet: string, reglages: object) => `µ._mjs_fx(this, _mjs_fxn, ${JSON.stringify(effet)}, ${JSON.stringify(reglages)})`
// … et celle d'une transition (`@in=*nom(…)`)
const poseTransition = (effet: string, reglages: object) => `µ._mjs_fxAnim(_mjsThis, _mjs_node, ${JSON.stringify(effet)}, ${JSON.stringify(reglages)}, null, null )`

// [lieu de la couleur, l'effet écrit, la pose attendue]
const CONTEXTES: Array<[string, (f: string) => string, (f: string) => string]> = [
  ['réglage background', (f) => `*fluid(background: ${f})`, (f) => pose('fluid', { background: f })],
  ['réglage color', (f) => `*neon(color: ${f})`, (f) => pose('neon', { color: f })],
  ['réglage principal, une couleur', (f) => `*neon(${f})`, (f) => pose('neon', { color: f })],
  ['liste colors', (f) => `*fluid(colors: [${f}, #fff])`, (f) => pose('fluid', { colors: [f, '#fff'] })],
  ['liste colors, couleur en dernier', (f) => `*fluid(colors: [#fff, ${f}])`, (f) => pose('fluid', { colors: ['#fff', f] })],
  ['réglage principal, une liste', (f) => `*fluid([${f}, #fff])`, (f) => pose('fluid', { colors: [f, '#fff'] })]
]

describe('une couleur CSS à barre oblique s\'écrit en clair dans les réglages d\'un effet', function () {
  this.timeout(60000)

  for (const [titre, formes] of [['écritures refusées avant', REFUSEES], ['écritures qui passaient déjà', ACCEPTEES]] as Array<[string, string[]]>) {
    describe(titre, () => {
      for (const f of formes) {
        it(f, async () => {
          for (const [lieu, ecrit, attendu] of CONTEXTES) {
            const code = await compiler(`<div ${ecrit(f)}></div>\n`)
            assert.ok(code.includes(attendu(f)), `${lieu} : la pose ne porte pas la valeur entière — ${attendu(f)}`)
          }
        })
      }
    })
  }

  it('la même valeur entre guillemets donne exactement le même code', async () => {
    for (const f of REFUSEES) {
      assert.equal(await compiler(`<div *fluid(background: '${f}')></div>\n`), await compiler(`<div *fluid(background: ${f})></div>\n`), f)
    }
  })

  it('le reste de la balise est intact : attributs suivants, second effet à barre oblique, texte et balise voisine', async () => {
    for (const [i, f] of REFUSEES.entries()) {
      const g    = REFUSEES[(i + 1) % REFUSEES.length]
      const code = await compiler(`<div class="a" *fluid(background: ${f}) id="b" *neon(color: ${g}) data-x="1">texte</div><p>après</p>\n`)
      assert.ok(code.includes(pose('fluid', { background: f })), `${f} : première pose`)
      assert.ok(code.includes(pose('neon', { color: g })), `${g} : seconde pose`)
      assert.ok(code.includes('_mjs_cloneTpl("<div class=\'a\' id=\'b\' data-x=\'1\'>texte</div><p>après</p>")'), `${f} : la balise et le texte qui suit ont changé`)
    }
  })

  it('une couleur à barre oblique après une pose sur la même ligne : chaque effet garde sa valeur, rien n\'est avalé entre les deux barres', async () => {
    const code = await compiler('<p *neon(color: hsl(0 0% 0% / .5))>un</p><p *neon(color: hsl(10 10% 10% / .5))>deux</p><p *neon(color: red)>trois</p>\n')
    assert.ok(code.includes(pose('neon', { color: 'hsl(0 0% 0% / .5)' })))
    assert.ok(code.includes(pose('neon', { color: 'hsl(10 10% 10% / .5)' })))
    assert.ok(code.includes(pose('neon', { color: 'red' })))
    assert.ok(code.includes('_mjs_cloneTpl("<p>un</p><p>deux</p><p>trois</p>")'))
  })

  it('une transition (@in=*nom(…)) lit la valeur entière, avec un effet sur la même balise', async () => {
    for (const [i, f] of REFUSEES.entries()) {
      const g    = REFUSEES[(i + 3) % REFUSEES.length]
      const code = await compiler(`<div @in=*crossfade(group: ${f}) class="z" *fluid(background: ${g})>x</div>\n`)
      assert.ok(code.includes(poseTransition('crossfade', { group: f })), `${f} : la transition ne porte pas la valeur entière`)
      assert.ok(code.includes(pose('fluid', { background: g })), `${g} : la pose de l'effet voisin`)
      assert.ok(code.includes('_mjs_cloneTpl("<div class=\'z\'>x</div>")'), `${f} : la balise a changé`)
    }
  })

  it('un effet de <@document> (sa lecture ne passe pas par le même scanner) garde son comportement', async () => {
    const code = await compiler('<@document *ripple(color: hsl(210 50% 20% / .4))>\n<p>x</p>\n')
    assert.ok(code.includes('"ripple", {"color":"hsl(210 50% 20% / .4)"}'))
  })
})

describe('un réglage d\'effet n\'est pas du JavaScript', function () {
  this.timeout(60000)

  it('une valeur qui commence par une barre oblique s\'écrit en clair : chemin d\'image, mots, url()', async () => {
    assert.ok((await compiler('<div *gradient(image: /a.png)>x</div>\n')).includes(pose('gradient', { image: '/a.png' })))
    assert.ok((await compiler('<div *cycle(words: [/home, /about])>x</div>\n')).includes(pose('cycle', { words: ['/home', '/about'] })))
    assert.ok((await compiler('<div *fluid(background: url(/img/a.png))></div>\n')).includes(pose('fluid', { background: 'url(/img/a.png)' })))
    assert.ok((await compiler('<div *fluid(background: url(//cdn.example.com/a.png))></div>\n')).includes(pose('fluid', { background: 'url(//cdn.example.com/a.png)' })))
  })

  it('une apostrophe est un texte ouvert dans un réglage, qu\'une barre oblique la précède ou non', async () => {
    for (const valeur of ['it\'s', '50% / it\'s']) {
      await assert.rejects(compiler(`<div *neon(color: ${valeur})></div>\n`), /CHAÎNE NON FERMÉE/, valeur)
    }
  })

  it('un gabarit à interpolation lit aussi sa barre oblique sans regex : l\'erreur n\'est plus celle d\'une accolade jamais refermée', async () => {
    await assert.rejects(compiler('<div *neon(color: `${ 50% / 2 }`)></div>\n'), (e: Error) => !/EXPRESSION NON FERMÉE/.test(e.message))
  })

  it('une valeur réellement mal fermée garde son erreur, au même endroit', async () => {
    const nonFermee = (ligne: number, debut: string) => `'couleurs-barre' : \n\n🚨 [EXPRESSION NON FERMÉE] \`(\` ouvert ligne ${ligne} n'a pas de \`)\` correspondant.\n   Fin de fichier atteinte : tout le HTML suivant a été avalé par l'expression.\n👉 Fermez l'expression par \`)\` (une accolade à afficher telle quelle s'écrit \`&#123;\`).\n   Début avalé : ${debut}\n\n`
    const cas: Array<[string, number, string]> = [
      ['<p>un</p>\n<p>deux</p>\n<div *fluid(background: hsl(210 50% 20%></div>\n<p>fin</p>\n', 3, 'background: hsl(210 50% 20%></div> <p>fin</p>'],
      ['<p>un</p>\n<p>deux</p>\n<div *fluid(background: hsl(210 50% 20% / .4></div>\n<p>fin</p>\n', 3, 'background: hsl(210 50% 20% / .4></div> <p>fin</p>'],
      ['<p>un</p>\n<div @in=*crossfade(group: a / b></div>\n<p>fin</p>\n', 2, 'group: a / b></div> <p>fin</p>']
    ]
    for (const [source, ligne, debut] of cas) {
      await assert.rejects(compiler(source), (e: Error) => {
        assert.equal(e.message, nonFermee(ligne, debut))
        return true
      })
    }
  })
})

describe('ce qui se construisait avant se construit encore (la lecture d\'avant est reprise quand la lecture sans regex échoue)', function () {
  this.timeout(60000)

  it('un joker de chemin : /* n\'ouvre pas un commentaire qui avale la balise', async () => {
    const code = await compiler('<div *scrub(images: [/img/*.png]) id="x">t</div>\n<p>/* c */</p>\n')
    assert.ok(code.includes(pose('scrub', { images: ['/img/*.png'] })))
    assert.ok(code.includes('_mjs_cloneTpl("<div id=\'x\'>t</div><p>/* c */</p>")'))
  })

  it('… sur une transition aussi', async () => {
    const code = await compiler('<div @in=*crossfade(group: /img/*.png) class="z">x</div>\n')
    assert.ok(code.includes(poseTransition('crossfade', { group: '/img/*.png' })))
    assert.ok(code.includes('_mjs_cloneTpl("<div class=\'z\'>x</div>")'))
  })

  it('une regex à apostrophe dans une valeur calculée garde le refus clair du catalogue', async () => {
    await assert.rejects(compiler('<div *neon(color: $a.replace(/\'/g, \'\'))>t</div>\n'), (e: Error) => /passez par une variable dérivée/.test(e.message) && !/NON FERMÉE/.test(e.message))
  })

  it('une valeur entre deux barres qui porte une apostrophe passe encore', async () => {
    assert.ok((await compiler('<div *neon(color: /it\'s/x)>t</div>\n')).includes(pose('neon', { color: '/it\'s/x' })))
  })

  it('une couleur à barre oblique dans des réglages sur plusieurs lignes : le fond, la balise et le texte qui suit', async () => {
    const code = await compiler('<div class="a" *fluid(\n  background: hsl(210 50% 20% / .4),\n  size: .5,\n  fade: 1.5\n) id="b">texte</div>\n<p>après</p>\n')
    assert.ok(code.includes('µ._mjs_fx(this, _mjs_fxn, "fluid", {"background":"hsl(210 50% 20% / .4)"'))
    assert.ok(code.includes('_mjs_cloneTpl("<div class=\'a\' id=\'b\'>texte</div><p>après</p>")'))
  })

  it('… avec un // (apostrophe, parenthèse ouvrante) et un /* */ (deux parenthèses fermantes) : un commentaire dans les réglages est refusé, par son commentaire', async () => {
    await assert.rejects(
      compiler('<div class="a" *fluid(\n  background: hsl(210 50% 20% / .4), // le fond (l\'été\n  size: .5, /* la taille (essentielle)) */\n  fade: 1.5\n) id="b">texte</div>\n<p>après</p>\n'),
      { message: '\'couleurs-barre\' : [ModularJS] *fluid (ligne 2) : « // le fond (l\'été » — un commentaire ne s\'écrit pas dans les réglages d\'un effet : retirez-le. Si c\'est une adresse, mettez-la entre guillemets : image: \'//cdn/a.png\'.' }
    )
  })
})

describe('un fichier *.effects.mjs et ses alias', function () {
  this.timeout(60000)

  const alias   = REFUSEES.map((f, i) => `  *fluid.fond${i} = *fluid(background: ${f})`)
  const listes  = REFUSEES.map((f, i) => `  *fluid.liste${i} = *fluid(colors: [${f}, #fff])`)
  const fichier = `<effects>\n${[...alias, ...listes].join('\n')}\n  *halo(color: hsl(210 50% 20% / .4), size: 12px) =\n    box-shadow: 0 0 $size $color\n</effects>\n`
  const defs    = collectEffectDefs(['a.effects.mjs'], () => fichier)

  it('chaque alias garde la valeur entière, en réglage background comme en liste colors', () => {
    for (const [i, f] of REFUSEES.entries()) {
      assert.deepEqual(defs[`fluid.fond${i}`].fixed, { background: f })
      assert.deepEqual(defs[`fluid.liste${i}`].fixed, { colors: [f, '#fff'] })
    }
  })

  it('un effet CSS de l\'appli garde sa couleur par défaut', () => {
    assert.deepEqual(defs.halo.params, [['color', 'hsl(210 50% 20% / .4)'], ['size', '12px']])
  })

  it('un bloc <effects> écrit sur une seule ligne se lit aussi', () => {
    const une = collectEffectDefs(['b.effects.mjs'], () => '<effects>*fluid.verre = *fluid(background: hsl(210 50% 20% / .4))</effects>\n')
    assert.deepEqual(une['fluid.verre'].fixed, { background: 'hsl(210 50% 20% / .4)' })
  })

  it('un alias posé sur une balise donne la pose entière', async () => {
    for (const [i, f] of REFUSEES.entries()) {
      assert.ok((await compiler(`<div class="a" *fluid.fond${i} id="b">x</div>\n`, defs)).includes(pose('fluid', { background: f })), `fond${i}`)
      assert.ok((await compiler(`<div *fluid.liste${i}></div>\n`, defs)).includes(pose('fluid', { colors: [f, '#fff'] })), `liste${i}`)
    }
  })

  it('un alias dont on change le réglage à la pose, avec une valeur à barre oblique : la pose porte la valeur écrite', async () => {
    for (const i of REFUSEES.keys()) {
      const g = REFUSEES[(i + 1) % REFUSEES.length]
      assert.ok((await compiler(`<div *fluid.fond${i}(background: ${g}) id="b">x</div>\n`, defs)).includes(pose('fluid', { background: g })), `fond${i} → ${g}`)
      assert.ok((await compiler(`<div *fluid.liste${i}(colors: [${g}, #000])></div>\n`, defs)).includes(pose('fluid', { colors: [g, '#000'] })), `liste${i} → ${g}`)
    }
  })

  it('un effet CSS de l\'appli posé avec une couleur à barre oblique', async () => {
    for (const f of REFUSEES) {
      assert.ok((await compiler(`<div *halo(color: ${f})>x</div><p>après</p>\n`, defs)).includes(pose('halo', { color: f })), f)
    }
  })

  describe('construit avec le Bundler, un fichier d\'effets et un composant', () => {
    let stats: any
    let code = ''

    before(async () => {
      const root   = mjsTmp('effets-couleurs-barre')
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'couleurs.effects.mjs'), fichier)
      writeFileSync(join(srcDir, 'cb-page.mjs'), '<div class="un" *fluid.fond1>un</div>\n<div class="deux" *fluid.liste2>deux</div>\n<div class="trois" *fluid.fond3(background: hsl(0 0% 0% / 50%))>trois</div>\n<div class="quatre" *halo(color: hsl(1 2% 3% / .4))>quatre</div>\n<div class="cinq" *neon(color: rgb(0% 0% 0% / 50%)) *fluid(colors: [hsl(210 50% 20% / .4), #fff])>cinq</div>\n')
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      stats = await bundler.compile()
      await bundler.close()
      code = readdirSync(outDir).filter((f) => f.endsWith('.js') && !f.startsWith('mjs_')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
    })

    after(async () => {
      await terminateSharedWorkerPool()
    })

    it('la construction se fait sans erreur ni avertissement', () => {
      assert.deepEqual(stats.errors.map((e: any) => e.message), [])
      assert.deepEqual((stats.warnings || []).map((w: any) => w.message ?? String(w)), [])
    })

    it('chaque pose porte sa valeur entière', () => {
      assert.ok(code.includes(pose('fluid', { background: REFUSEES[1] })), 'alias fond1')
      assert.ok(code.includes(pose('fluid', { colors: [REFUSEES[2], '#fff'] })), 'alias liste2')
      assert.ok(code.includes(pose('fluid', { background: 'hsl(0 0% 0% / 50%)' })), 'alias fond3 réglé à la pose')
      assert.ok(code.includes(pose('halo', { color: 'hsl(1 2% 3% / .4)' })), 'effet CSS')
      assert.ok(code.includes(pose('neon', { color: 'rgb(0% 0% 0% / 50%)' })), 'deux effets sur la balise : le premier')
      assert.ok(code.includes(pose('fluid', { colors: ['hsl(210 50% 20% / .4)', '#fff'] })), 'deux effets sur la balise : le second')
    })
  })
})
