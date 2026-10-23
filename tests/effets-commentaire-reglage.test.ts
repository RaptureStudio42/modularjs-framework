// Un commentaire (`// …` jusqu'au bout de sa ligne, `/* … */`) écrit dans les réglages d'un effet arrête la construction, avec un message qui le
// cite : sur une balise ou un composant (`*nom(…)`), sur une transition (`@in=*nom(…)`, `@out`, `@transition`), sur `<@document>`, dans un alias
// ou un effet d'un fichier `*.effects.mjs` (le bloc `<effects>`), en développement, en production et dans la veille. Avant, le message parlait d'autre
// chose (« écrit deux fois ») ou la construction réussissait : la note devenait une valeur (une couleur) et le réglage qui la suivait était perdu.
// Ce qui n'est pas un commentaire passe comme avant : le `//` d'une adresse, une chaîne entre guillemets, le `/*` d'un chemin à joker, la barre
// oblique d'une division ou d'une couleur, une valeur liée à une variable. La lecture elle-même est tenue par effets-commentaire-reglage-lecture.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { collectEffectDefs } from '../src/bundler/effects-files.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

const FIN_FR = 'un commentaire ne s\'écrit pas dans les réglages d\'un effet : retirez-le. Si c\'est une adresse, mettez-la entre guillemets : image: \'//cdn/a.png\'.'
const FIN_EN = 'a comment cannot be written in an effect\'s settings: remove it. If it is an address, put it between quotes: image: \'//cdn/a.png\'.'

// le message d'une balise (le fichier est le préfixe `'commentaire' : ` de transpile, ou celui du Bundler) et celui d'un fichier d'effets
const fr        = (nom: string, ligne: number, commentaire: string) => `[ModularJS] *${nom} (ligne ${ligne}) : « ${commentaire} » — ${FIN_FR}`
const en        = (nom: string, ligne: number, commentaire: string) => `[ModularJS] *${nom} (line ${ligne}): "${commentaire}" — ${FIN_EN}`
const frFichier = (fichier: string, ligne: number, nom: string, commentaire: string) => `[ModularJS] ${fichier} (ligne ${ligne}) : *${nom} — « ${commentaire} » : ${FIN_FR}`
const enFichier = (fichier: string, ligne: number, nom: string, commentaire: string) => `[ModularJS] ${fichier} (line ${ligne}): *${nom} — "${commentaire}": ${FIN_EN}`

async function refus(source: string, effectDefs?: Record<string, any>): Promise<string> {
  let message = ''
  try {
    await transpile(source, { moduleName: 'commentaire', effectDefs })
  }
  catch (e) {
    message = String((e as Error).message)
  }
  assert.notEqual(message, '', 'la construction aurait dû s\'arrêter')
  return message
}

async function compiler(source: string, effectDefs?: Record<string, any>): Promise<string> {
  return (await transpile(source, { moduleName: 'commentaire', effectDefs })).output
}

// la pose d'un effet sur une balise, telle que le compilateur l'écrit
const pose = (effet: string, reglages: object) => `µ._mjs_fx(this, _mjs_fxn, ${JSON.stringify(effet)}, ${JSON.stringify(reglages)})`

// [titre, source, effet, ligne du commentaire, commentaire tel que le message le cite]
const LONG = '// ' + 'abcdefghij'.repeat(10)
const REFUSES: Array<[string, string, string, number, string]> = [
  ['tilt, `//` en fin de ligne', '<p>un</p>\n<div class="a" *tilt(\n  max: 12, // la pente\n  scale: 1.1\n)>x</div>\n', 'tilt', 3, '// la pente'],
  ['fluid, `//` en fin de ligne (la note devenait une couleur)', '<p>un</p>\n<div class="a" *fluid(\n  background: red, // le fond de la toile\n  size: 2\n)>x</div>\n', 'fluid', 3, '// le fond de la toile'],
  ['tilt, `/* */`', '<p>un</p>\n<div class="a" *tilt(\n  max: 12, /* la pente */\n  scale: 1.1\n)>x</div>\n', 'tilt', 3, '/* la pente */'],
  ['fluid, `/* */`', '<p>un</p>\n<div class="a" *fluid(\n  background: red, /* le fond de la toile */\n  size: 2\n)>x</div>\n', 'fluid', 3, '/* le fond de la toile */'],
  ['`/* */` sur deux lignes : la ligne de son début, le texte sur une ligne', '<p>un</p>\n<div class="a" *tilt(max: 12, /* la pente\n   douce */ scale: 1.1)>x</div>\n', 'tilt', 2, '/* la pente douce */'],
  ['`//` avant la parenthèse fermante, sur la ligne de la balise', '<p>un</p>\n<div class="a" *tilt(max: 12 // la pente)>x</div>\n', 'tilt', 2, '// la pente'],
  ['`//` collé à la virgule', '<p>un</p>\n<div class="a" *tilt(\n  max: 12,// la pente\n  scale: 1.1\n)>x</div>\n', 'tilt', 3, '// la pente'],
  ['`//` collé à la valeur', '<p>un</p>\n<div class="a" *tilt(\n  max: 12// la pente\n  , scale: 1.1\n)>x</div>\n', 'tilt', 3, '// la pente'],
  ['`/* */` collé à la valeur', '<p>un</p>\n<div class="a" *fluid(background: red/* le fond */, size: 2)>x</div>\n', 'fluid', 2, '/* le fond */'],
  ['`//` en tête des réglages', '<p>un</p>\n<div class="a" *tilt(// la pente\n  max: 12)>x</div>\n', 'tilt', 2, '// la pente'],
  ['`/*` en tête des réglages', '<p>un</p>\n<div class="a" *tilt(/* la pente */ max: 12)>x</div>\n', 'tilt', 2, '/* la pente */'],
  ['un commentaire sur sa propre ligne', '<p>un</p>\n<div class="a" *tilt(\n  // la pente\n  max: 12\n)>x</div>\n', 'tilt', 3, '// la pente'],
  ['une apostrophe dans le commentaire', '<p>un</p>\n<div class="a" *fluid(\n  background: red, // l\'été\n  size: 2\n)>x</div>\n', 'fluid', 3, '// l\'été'],
  ['un guillemet double dans le commentaire', '<p>un</p>\n<div class="a" *fluid(\n  background: red, /* le "fond" */\n  size: 2\n)>x</div>\n', 'fluid', 3, '/* le "fond" */'],
  ['un commentaire long est raccourci', `<p>un</p>\n<div class="a" *tilt(\n  max: 12, ${LONG}\n  scale: 1.1\n)>x</div>\n`, 'tilt', 3, LONG.slice(0, 40) + '…'],
  ['le réglage principal', '<p>un</p>\n<div class="a" *neon(#0ff // cyan\n)>x</div>\n', 'neon', 2, '// cyan'],
  ['le réglage principal, `/* */`', '<p>un</p>\n<div class="a" *neon(#0ff /* cyan */)>x</div>\n', 'neon', 2, '/* cyan */'],
  ['à côté d\'une valeur liée à une variable', '<script>\n  $pente = 12\n</script>\n<div class="a" *tilt(\n  max: $pente, // la pente\n  scale: 1.1\n)>x</div>\n', 'tilt', 5, '// la pente'],
  ['le second effet de la balise', '<p>un</p>\n<div class="a" *neon(color: red) *tilt(\n  max: 12, // la pente\n  scale: 1.1\n)>x</div>\n', 'tilt', 3, '// la pente'],
  ['dans un {if}', '<script>\n  $on = true\n</script>\n{if $on}\n<div class="a" *tilt(\n  max: 12, // la pente\n  scale: 1.1\n)>x</div>\n{end}\n', 'tilt', 6, '// la pente'],
  ['dans un {for}', '<script>\n  $liste = [1, 2]\n</script>\n{for n in $liste}\n<div class="a" *tilt(\n  max: n, // la pente\n  scale: 1.1\n)>{n}</div>\n{end}\n', 'tilt', 6, '// la pente'],
  ['sur un composant, `<@card>`', '<p>un</p>\n<@card *tilt(\n  max: 12, // la pente\n  scale: 1.1\n)></@card>\n', 'tilt', 3, '// la pente'],
  ['sur un composant, `<mjs-card>`', '<p>un</p>\n<mjs-card *tilt(\n  max: 12, /* la pente */\n  scale: 1.1\n)></mjs-card>\n', 'tilt', 3, '/* la pente */'],
  ['transition `@in`', '<script>\n  $vu = true\n</script>\n{if $vu}<p @in=*fly(up, // le sens\n  duration: 2s)>x</p>{end}\n', 'fly', 4, '// le sens'],
  ['transition `@out`', '<script>\n  $vu = true\n</script>\n{if $vu}<p @out=*fade(duration: 1s /* vite */)>x</p>{end}\n', 'fade', 4, '/* vite */'],
  ['transition `@transition`', '<script>\n  $vu = true\n</script>\n{if $vu}\n<p @transition=*fly(up, // le sens\n  duration: 2s)>x</p>{end}\n', 'fly', 5, '// le sens'],
  ['transition `@in.global`', '<script>\n  $vu = true\n</script>\n{if $vu}<p @in.global=*fly(up, /* le sens */ duration: 2s)>x</p>{end}\n', 'fly', 4, '/* le sens */']
]

describe('un commentaire dans les réglages d\'un effet arrête la construction', function () {
  this.timeout(60000)

  describe('sur une balise, un composant ou une transition', () => {
    for (const [titre, source, effet, ligne, commentaire] of REFUSES) {
      it(titre, async () => {
        assert.equal(await refus(source), `'commentaire' : ${fr(effet, ligne, commentaire)}`)
      })
    }

    it('le message trompeur d\'avant ne sort plus : le commentaire est dit, pas « écrit deux fois »', async () => {
      const message = await refus('<div *tilt(\n  max: 12, // la pente\n  scale: 1.1\n)>x</div>\n')
      assert.doesNotMatch(message, /écrit deux fois/)
      assert.match(message, /un commentaire ne s'écrit pas dans les réglages d'un effet/)
    })

    it('un réglage écrit deux fois, sans commentaire, garde son message', async () => {
      assert.match(await refus('<div *tilt(max: 12, max: 13)>x</div>\n'), /\*tilt : « max » est écrit deux fois\./)
    })

    it('un effet inconnu, sans commentaire, garde son message', async () => {
      assert.match(await refus('<div *tiltt(max: 12)>x</div>\n'), /\*tiltt : effet inconnu/)
    })

    it('<@document> : l\'erreur cite la ligne du fichier, un <script> avant le HTML compris', async () => {
      const { data } = await transpile('<script>\n  $n = 1\n</script>\n\n<@document *ripple(\n  color: red, // la couleur\n  size: 3\n)></@document>\n<p>un</p>\n', { moduleName: 'commentaire' })
      assert.deepEqual(data.macroErrors, [fr('ripple', 6, '// la couleur')])
    })

    it('<@document> : `/* */` sur la ligne de la balise', async () => {
      const { data } = await transpile('<p>un</p>\n<@document *ripple(#f00, /* la couleur */ size: 60)></@document>\n', { moduleName: 'commentaire' })
      assert.deepEqual(data.macroErrors, [fr('ripple', 2, '/* la couleur */')])
    })

    it('<@document> : sans commentaire, l\'effet se pose comme avant', async () => {
      const { data, output } = await transpile('<p>un</p>\n<@document *ripple(#f00, size: 60)></@document>\n', { moduleName: 'commentaire' })
      assert.deepEqual(data.macroErrors, [])
      assert.match(output, /"ripple"/)
    })

    it('<@document> : une apostrophe dans le commentaire ouvre un texte (dit aussi) ; le commentaire est cité, pas une valeur de plus', async () => {
      const { data } = await transpile('<p>un</p>\n<@document *ripple(#f00, // l\'été\n  size: 60)></@document>\n', { moduleName: 'commentaire' })
      assert.equal(data.macroErrors.length, 2, JSON.stringify(data.macroErrors))
      assert.match(data.macroErrors[0], /jamais refermé/)
      assert.equal(data.macroErrors[1], fr('ripple', 2, '// l\'été'))
    })

    it('en anglais', async () => {
      setMessagesLang('en')
      try {
        assert.equal(await refus('<p>un</p>\n<div class="a" *tilt(\n  max: 12, // la pente\n  scale: 1.1\n)>x</div>\n'), `'commentaire': ${en('tilt', 3, '// la pente')}`)
        assert.equal(await refus('<script>\n  $vu = true\n</script>\n{if $vu}<p @in=*fly(up, /* le sens */ duration: 2s)>x</p>{end}\n'), `'commentaire': ${en('fly', 4, '/* le sens */')}`)
        const { data } = await transpile('<p>un</p>\n<@document *ripple(#f00, // la couleur\n size: 60)></@document>\n', { moduleName: 'commentaire' })
        assert.deepEqual(data.macroErrors, [en('ripple', 2, '// la couleur')])
      }
      finally {
        setMessagesLang('fr')
      }
    })

    it('un alias réglé à la pose : `*fluid.verre(…)` avec un commentaire', async () => {
      const defs = collectEffectDefs(['mes.effects.mjs'], () => '<effects>\n  *fluid.verre = *fluid(background: red, size: 2)\n</effects>\n')
      assert.equal(await refus('<p>un</p>\n<div *fluid.verre(\n  size: 1.5, // plus gros\n  background: blue\n)>x</div>\n', defs), `'commentaire' : ${fr('fluid.verre', 3, '// plus gros')}`)
    })

    it('une transition de l\'appli réglée à la pose : `@in=*entree(…)` avec un commentaire', async () => {
      const defs = collectEffectDefs(['mes.effects.mjs'], () => '<effects>\n  *entree = *fly(up, distance: 30px)\n</effects>\n')
      assert.equal(await refus('<script>\n  $vu = true\n</script>\n{if $vu}<p @in=*entree(duration: 1s /* plus lent */)>x</p>{end}\n', defs), `'commentaire' : ${fr('entree', 4, '/* plus lent */')}`)
    })
  })

  describe('dans un fichier d\'effets (le bloc <effects>)', () => {
    const lire = (source: string) => collectEffectDefs(['mes.effects.mjs'], () => source)
    const FICHIERS: Array<[string, string, string, number, string]> = [
      ['un effet réglé, `/* */`', '<effects>\n  *titre = *scramble(311, /* la vitesse */ on: click)\n</effects>\n', 'titre', 2, '/* la vitesse */'],
      ['un effet réglé, `//` (il emporte la fin de la ligne)', '<effects>\n  *titre = *scramble(311, // la vitesse, on: click)\n</effects>\n', 'titre', 2, '// la vitesse, on: click'],
      ['un alias, `/* */`', '<effects>\n  *fluid.verre = *fluid(background: red /* le fond */, size: 2)\n</effects>\n', 'fluid.verre', 2, '/* le fond */'],
      ['un alias, `//`', '<effects>\n  *fluid.verre = *fluid(background: red, // le fond)\n</effects>\n', 'fluid.verre', 2, '// le fond'],
      ['un effet réglé d\'un effet réglé', '<effects>\n  *titre = *scramble(311)\n  *titre-lent = *titre(speed: 80 /* plus lent */)\n</effects>\n', 'titre-lent', 3, '/* plus lent */'],
      ['les réglages d\'un effet CSS, `/* */`', '<effects>\n  *halo(color: #0ff, /* la teinte */ size: 12px) =\n    box-shadow: 0 0 $size $color\n</effects>\n', 'halo', 2, '/* la teinte */'],
      ['les réglages d\'un effet CSS, `//`', '<effects>\n  *halo(color: #0ff, // la teinte, size: 12px) =\n    box-shadow: 0 0 $size $color\n</effects>\n', 'halo', 2, '// la teinte, size: 12px'],
      ['la ligne est celle du fichier, des effets avant', '<effects>\n  *a = *fade(300ms)\n\n  *b = *fade(400ms)\n  *c(color: red) =\n    color: $color\n  *d = *scramble(311, /* la vitesse */ on: click)\n</effects>\n', 'd', 7, '/* la vitesse */']
    ]
    for (const [titre, source, nom, ligne, commentaire] of FICHIERS) {
      it(titre, () => {
        assert.throws(() => lire(source), { message: frFichier('mes.effects.mjs', ligne, nom, commentaire) })
      })
    }

    it('le texte exact du message, en français puis en anglais', () => {
      const source = '<effects>\n  *titre = *scramble(311, /* la vitesse */ on: click)\n</effects>\n'
      assert.throws(() => lire(source), { message: frFichier('mes.effects.mjs', 2, 'titre', '/* la vitesse */') })
      setMessagesLang('en')
      try {
        assert.throws(() => lire(source), { message: enFichier('mes.effects.mjs', 2, 'titre', '/* la vitesse */') })
      }
      finally {
        setMessagesLang('fr')
      }
    })

    it('la faute est rangée avec les autres quand le bundler la demande, et les autres effets sont lus', () => {
      const problems: Error[] = []
      const defs = collectEffectDefs(['mes.effects.mjs'], () => '<effects>\n  *bon = *fade(300ms)\n  *titre = *scramble(311, /* la vitesse */ on: click)\n  *autre = *fade(500ms)\n</effects>\n', undefined, problems)
      assert.deepEqual(problems.map((e) => e.message), [frFichier('mes.effects.mjs', 3, 'titre', '/* la vitesse */')])
      assert.ok('autre' in defs && 'bon' in defs && !('titre' in defs))
    })

    it('une adresse dans une ligne CSS d\'un effet : lue comme avant', () => {
      const defs = lire('<effects>\n  *cadre(color: #0ff) =\n    background-image: url(//cdn.exemple.fr/a.png)\n    outline-color: $color\n</effects>\n')
      assert.ok('cadre' in defs)
    })

    it('sans commentaire : un effet réglé, un alias et un effet CSS se lisent comme avant', () => {
      const defs = lire('<effects>\n  *titre = *scramble(300, on: click)\n  *fluid.verre = *fluid(background: red, size: 2)\n  *halo(color: #0ff, size: 12px) =\n    box-shadow: 0 0 $size $color\n</effects>\n')
      for (const nom of ['titre', 'fluid.verre', 'halo']) assert.ok(nom in defs, nom)
    })
  })

  describe('ce qui n\'est pas un commentaire passe comme avant', () => {
    // [titre, ce qui est écrit sur la balise, l'effet posé, ses réglages dans la pose]
    const GARDES: Array<[string, string, string, object]> = [
      ['le `//` d\'une adresse : `https://`', '*gradient(image: https://exemple.fr/a.png)', 'gradient', { image: 'https://exemple.fr/a.png' }],
      ['le `//` d\'une adresse : `http://`, dans une liste', '*scrub(images: [http://exemple.fr/a.png, /b.png])', 'scrub', { images: ['http://exemple.fr/a.png', '/b.png'] }],
      ['le `//` d\'une adresse sans protocole, dans `url(…)`', '*gradient(image: url(//cdn.exemple.fr/a.png))', 'gradient', { image: 'url(//cdn.exemple.fr/a.png)' }],
      ['le `//` d\'une adresse sans protocole, en fond de *fluid', '*fluid(background: url(//cdn.exemple.fr/a.png))', 'fluid', { background: 'url(//cdn.exemple.fr/a.png)' }],
      ['le `//` d\'une adresse sans protocole dont l\'hôte n\'a ni point ni port, dans `url(…)`', '*fluid(background: url(//cdn/a.png))', 'fluid', { background: 'url(//cdn/a.png)' }],
      ['le `//` d\'une adresse `https://` dans `url(…)`', '*fluid(background: url(https://exemple.fr/a.png))', 'fluid', { background: 'url(https://exemple.fr/a.png)' }],
      ['le `//` d\'une adresse sans protocole, seule', '*gradient(image: //cdn.exemple.fr/a.png)', 'gradient', { image: '//cdn.exemple.fr/a.png' }],
      ['le `//` d\'une adresse sans protocole, dans une liste', '*scrub(images: [//cdn.exemple.fr/a.png, /b.png])', 'scrub', { images: ['//cdn.exemple.fr/a.png', '/b.png'] }],
      ['une adresse entre guillemets', '*gradient(image: \'//cdn.exemple.fr/a.png\')', 'gradient', { image: '//cdn.exemple.fr/a.png' }],
      ['`//` et `/* */` entre guillemets simples et doubles', '*cycle(words: [\'// pas un commentaire\', "/* non plus */"])', 'cycle', { words: ['// pas un commentaire', '/* non plus */'] }],
      ['le `/*` d\'un chemin à joker', '*scrub(images: [/img/*.png])', 'scrub', { images: ['/img/*.png'] }],
      ['un joker de dossier : `/*/`', '*scrub(images: [/img/*/a.png])', 'scrub', { images: ['/img/*/a.png'] }],
      ['deux barres dans un chemin', '*scrub(images: [/img//a.png])', 'scrub', { images: ['/img//a.png'] }],
      ['une couleur à barre oblique', '*neon(color: hsl(210 50% 20% / .4))', 'neon', { color: 'hsl(210 50% 20% / .4)' }],
      ['une couleur à barre oblique, sans espaces', '*neon(color: hsl(210 50% 20%/.4))', 'neon', { color: 'hsl(210 50% 20%/.4)' }],
      ['une couleur à barre oblique, en pourcentages', '*neon(color: rgb(0% 0% 0% / 50%))', 'neon', { color: 'rgb(0% 0% 0% / 50%)' }],
      ['une division', '*neon(color: rgb(calc(100% / 2) 0 0))', 'neon', { color: 'rgb(calc(100% / 2) 0 0)' }],
      ['des chemins qui commencent par une barre', '*cycle(words: [/home, /about])', 'cycle', { words: ['/home', '/about'] }]
    ]
    for (const [titre, ecrit, effet, reglages] of GARDES) {
      it(titre, async () => {
        assert.ok((await compiler(`<div class="a" ${ecrit}>x</div>\n`)).includes(pose(effet, reglages)), ecrit)
      })
    }

    it('une valeur liée à une variable, d\'un script et d\'une boucle', async () => {
      const code = await compiler('<script>\n  $pente = 12\n  $echelle = 1.1\n  $liste = [{ max: 5 }]\n</script>\n<div class="a" *tilt(max: $pente, scale: $echelle)>x</div>\n{for g in $liste}<div class="b" *tilt(max: g.max)>y</div>{end}\n')
      assert.equal((code.match(/_mjs_fx\(this, _mjs_fxn, "tilt"/g) ?? []).length, 2)
    })

    it('une valeur liée à une variable, avec une adresse dans un autre réglage', async () => {
      const code = await compiler('<script>\n  $lisse = 0.15\n</script>\n<div class="a" *scrub(images: [https://exemple.fr/a.png], smooth: $lisse)>x</div>\n')
      assert.match(code, /"scrub"/)
      assert.match(code, /https:\/\/exemple\.fr\/a\.png/)
    })

    it('une transition, avec une adresse', async () => {
      const code = await compiler('<script>\n  $vu = true\n</script>\n{if $vu}<p @in=*fly(up, duration: 2s)>x</p>{end}\n')
      assert.match(code, /"fly"/)
    })

    it('un commentaire hors des réglages ne change rien : texte, HTML, script et style', async () => {
      const source = '<!-- <div *tilt(max: 12, // note\n  scale: 1)> -->\n<script>\n  // une note\n  /* une autre */\n  $n = 1\n</script>\n<div class="a" *tilt(max: 12)>// pas un réglage /* non plus */</div>\n<style>\n  /* le style */\n  .a\n    color: red\n</style>\n'
      assert.ok((await compiler(source)).includes(pose('tilt', { max: 12 })))
    })

    it('la valeur calculée garde le refus du catalogue, pas celui du commentaire', async () => {
      const message = await refus('<div *neon(color: $a.replace(/\'/g, \'\'))>x</div>\n')
      assert.match(message, /variable dérivée/)
      assert.doesNotMatch(message, /un commentaire ne s'écrit pas/)
    })

    it('une expression régulière d\'ancienne écriture reste lue : `/it\'s/x`', async () => {
      assert.ok((await compiler('<div class="a" *neon(color: /it\'s/x)>x</div>\n')).includes('"neon"'))
    })

    it('des adresses dans un fichier d\'effets : un effet réglé, un alias, un effet CSS', () => {
      const defs = collectEffectDefs(['mes.effects.mjs'], () => '<effects>\n  *logo = *gradient(image: https://exemple.fr/a.png)\n  *fond = *fluid(background: url(//cdn.exemple.fr/a.png))\n  *scrub.photos = *scrub(images: [/img/*.png])\n  *teinte = *neon(color: hsl(210 50% 20% / .4))\n  *mots = *cycle(words: [\'// non\', "/* non */"])\n  *cadre(image: https://exemple.fr/a.png) =\n    background-image: url($image)\n</effects>\n')
      for (const nom of ['cadre', 'fond', 'logo', 'mots', 'scrub.photos', 'teinte']) assert.ok(nom in defs, nom)
      assert.equal((defs.logo as any).fixed.image, 'https://exemple.fr/a.png')
      assert.equal((defs.fond as any).fixed.background, 'url(//cdn.exemple.fr/a.png)')
      assert.deepEqual((defs['scrub.photos'] as any).fixed.images, ['/img/*.png'])
    })
  })

  describe('le build, en développement, en production et dans la veille', () => {
    after(async () => { await terminateSharedWorkerPool() })

    const TILT  = '<p>un</p>\n<div class="a" *tilt(\n  max: 12, // la pente\n  scale: 1.1\n)>x</div>\n'
    const FLUID = '<p>un</p>\n<div class="a" *fluid(\n  background: red, // le fond de la toile\n  size: 2\n)>x</div>\n'
    const EFFETS = '<effects>\n  *titre = *scramble(311, /* la vitesse */ on: click)\n</effects>\n'

    async function construire(nom: string, fichiers: Record<string, string>, reglages: Record<string, unknown> = {}) {
      const root   = mjsTmp(nom)
      const srcDir = join(root, 'src')
      mkdirSync(srcDir, { recursive: true })
      for (const [f, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, f), src)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), ...reglages })
      try {
        const stats = await bundler.compile()
        return stats.errors.map((e: any) => String(e.message))
      }
      finally {
        await bundler.close()
      }
    }

    for (const [env, reglages] of [['développement', {}], ['production', { env: 'prod', minify: false }]] as Array<[string, Record<string, unknown>]>) {
      it(`${env} : la balise commentée arrête le build, le fichier et la ligne sont dits`, async () => {
        const erreurs = await construire('commentaire-' + env, { 'c.mjs': TILT, 'd.mjs': FLUID }, reglages)
        assert.equal(erreurs.length, 2, erreurs.join('\n'))
        const tilt  = erreurs.find((m) => m.includes('*tilt')) as string
        const fluid = erreurs.find((m) => m.includes('*fluid')) as string
        assert.match(tilt, /c\.mjs: 'c' : /)
        assert.ok(tilt.endsWith(`'c' : ${fr('tilt', 3, '// la pente')}`), tilt)
        assert.match(fluid, /d\.mjs: 'd' : /)
        assert.ok(fluid.endsWith(`'d' : ${fr('fluid', 3, '// le fond de la toile')}`), fluid)
      })

      it(`${env} : un effet du fichier d'effets commenté arrête le build`, async () => {
        const erreurs = await construire('commentaire-fichier-' + env, { 'mes.effects.mjs': EFFETS, 'c.mjs': '<h1 class="t">bonjour</h1>\n' }, reglages)
        assert.deepEqual(erreurs, [frFichier('mes.effects.mjs', 2, 'titre', '/* la vitesse */')])
      })
    }

    it('la veille : l\'erreur sort au premier passage et dans la console, la sauvegarde sans commentaire la retire', async () => {
      const root   = mjsTmp('commentaire-veille')
      const srcDir = join(root, 'src')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'c.mjs'), TILT)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
      const passages: Array<{ changed: string, erreurs: string[] }> = []
      const imprime: string[] = []
      const erreurOrigine = console.error
      console.error = (...args: unknown[]) => { imprime.push(args.join(' ')) }
      const attendre = async (vers: (p: { changed: string, erreurs: string[] }) => boolean) => {
        const debut = Date.now()
        for (;;) {
          const trouve = passages.find(vers)
          if (trouve) return trouve
          if (Date.now() - debut > 40000) throw new Error('rien après 40 s : ' + JSON.stringify(passages))
          await new Promise((resolve) => setTimeout(resolve, 40))
        }
      }
      try {
        await bundler.watch({ onRecompile: (changed, stats) => { passages.push({ changed, erreurs: (stats?.errors ?? []).map((e: any) => String(e.message)) }) } })
        const premier = await attendre((p) => p.changed === '<initial>')
        assert.equal(premier.erreurs.length, 1, premier.erreurs.join('\n'))
        assert.ok(premier.erreurs[0].endsWith(fr('tilt', 3, '// la pente')), premier.erreurs[0])
        assert.ok(imprime.some((l) => l.includes(fr('tilt', 3, '// la pente'))), imprime.join('\n'))

        writeFileSync(join(srcDir, 'c.mjs'), '<p>un</p>\n<div class="a" *tilt(\n  max: 12,\n  scale: 1.1\n)>x</div>\n')
        const apres = await attendre((p) => p.changed.endsWith('c.mjs'))
        assert.deepEqual(apres.erreurs, [], apres.erreurs.join('\n'))
      }
      finally {
        console.error = erreurOrigine
        await bundler.close()
      }
    })
  })
})
