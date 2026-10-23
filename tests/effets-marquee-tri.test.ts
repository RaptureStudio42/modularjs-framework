// *marquee — le mode « balises » (la piste des enfants) n'est envoyé qu'aux applis dont une pose en a besoin. Le compilateur regarde ce que contient la
// balise : du texte seulement, le mode n'est pas envoyé ; une balise qui n'a que des éléments pour enfants, ou qu'une construction peut remplir de balises
// (`{for}`, `{if}` dont une branche écrit un élément, `<slot>`, un composant, du HTML inséré tel quel), le demande par le réglage `unit: child` qu'il écrit
// lui-même dans la pose. Une balise qu'un script remplit le demande à la main : `unit: child`.
//
// Deux gardes : la règle du compilateur sur des gabarits (la pose porte ou non `unit: 'child'`) ; des builds réels de production (le code de la piste est
// dans la sortie, ou n'y est pas), dans les deux réglages (cœur complet en fichiers séparés ; `runtime: 'core'` avec `js: 'bundle'`).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output
// la pose d'un `*marquee` aux réglages fixes : `µ._mjs_fx(this, _mjs_fxn, "marquee", {…})`
const poses    = (js: string) => [...js.matchAll(/µ\._mjs_fx\(this, _mjs_fxn, "marquee", (\{[^}]*\})\)/g)].map((m) => JSON.parse(m[1]))
const unite    = async (html: string) => poses(await compiler(html)).map((p) => p.unit)

const VARS = '<script>\n$l = [1, 2]\n$msg = \'a\'\n$x = true\n$h = \'<b>a</b>\'\n$u = \'child\'\n</script>\n'

// [nom, gabarit, la pose demande-t-elle le mode « balises » ?]
const CAS: Array<[string, string, boolean]> = [
  ['du texte fixe', '<p *marquee>Bonjour</p>', false],
  ['une interpolation de texte', '<p *marquee>{$msg}</p>', false],
  ['du texte et ses balises en ligne', '<p *marquee>Soldes {$msg} <b>-50 %</b> <i>vite</i><br><code>x</code> <em>e</em> <strong>s</strong> <a href="#">lien</a> <span>s</span></p>', false],
  ['une balise vide (un script la remplira)', '<div *marquee></div>', false],
  ['un commentaire seul', '<div *marquee><!-- rien --></div>', false],
  ['un {if} dont les branches sont du texte', '<p *marquee>{if $x}Oui{else}Non{end}</p>', false],
  ['du texte avec une balise de bloc', '<div *marquee>Texte <div>bloc</div></div>', false],
  ['des éléments seuls', '<div *marquee>\n  <img src="a.png" alt="a">\n  <img src="b.png" alt="b">\n</div>', true],
  ['un seul élément (un titre dans un span)', '<h2 *marquee><span>Titre</span></h2>', true],
  ['une liste {for}', '<div *marquee>{for i in $l}<p>{i}</p>{end}</div>', true],
  ['une liste {for} de texte (dans le doute)', '<div *marquee>{for i in $l}{i} {end}</div>', true],
  ['du texte et une liste {for} (dans le doute)', '<p *marquee>Titre {for i in $l}<b>{i}</b>{end}</p>', true],
  ['un {if} dont une branche écrit un élément', '<div *marquee>{if $x}Salut{else}<img src="a.png" alt="a">{end}</div>', true],
  ['un <slot>', '<div *marquee><slot></slot></div>', true],
  ['du texte autour d\'un <slot> (dans le doute)', '<p *marquee>Avant <slot></slot></p>', true],
  ['un composant enfant', '<div *marquee><@carte></@carte></div>', true],
  ['du HTML inséré tel quel', '<div *marquee>{{ $h }}</div>', true],
  ['un {key} qui écrit un élément', '<div *marquee>{key $x}<img src="a.png" alt="a">{end}</div>', true],
  ['un {await} dont une branche écrit un élément', '<div *marquee>{await $l}<img src="a.png" alt="a">{end}</div>', true],
  ['du texte autour d\'un composant enfant (dans le doute)', '<p *marquee>Avant <@carte></@carte></p>', true],
  ['du HTML posé dans la balise par @html=!{…}', '<div *marquee @html=!{$h}></div>', true],
  ['du HTML posé dans la balise par @html=!{…}, et un texte', '<p *marquee @html=!{$h}>Texte</p>', true],
  ['du texte posé dans la balise par @text=!{…} (du texte seulement)', '<div *marquee @text=!{$msg}></div>', false]
]

describe('*marquee — le compilateur écrit `unit: child` aux poses qui peuvent recevoir des balises', function () {
  this.timeout(120000)

  for (const [nom, gabarit, demande] of CAS) {
    it(`${nom} : ${demande ? 'la pose demande le mode « balises »' : 'la pose ne le demande pas'}`, async () => {
      assert.deepEqual(await unite(VARS + gabarit), [demande ? 'child' : undefined])
    })
  }

  it('le réglage écrit gagne : unit: child reste child (une fois), unit: auto est résolu par le compilateur', async () => {
    assert.deepEqual(await unite('<div *marquee(unit: child)></div>'), ['child'])
    assert.deepEqual(await unite('<p *marquee(unit: child)>Texte</p>'), ['child'])
    assert.deepEqual(await unite('<p *marquee(unit: auto)>Texte</p>'), [undefined], 'du texte : auto vaut le défaut, la pose ne le porte pas')
    assert.deepEqual(await unite('<div *marquee(unit: auto)><img src="a.png" alt="a"></div>'), ['child'], 'des balises : auto devient child')
    assert.deepEqual(await unite('<div *marquee(unit: child)><img src="a.png" alt="a"></div>'), ['child'])
    await assert.rejects(compiler('<div *marquee(unit: lettre)>x</div>'), /unit/)
  })

  it('une valeur tenue par une variable n\'est pas touchée : la pose la porte, le build garde le mode', async () => {
    const js = await compiler(VARS + '<div *marquee(unit: $u)><img src="a.png" alt="a"></div>')
    assert.equal(poses(js).length, 0, 'une pose à réglage variable porte ses valeurs dynamiques à part')
    assert.match(js, /"unit": \(/)
    assert.match(js, /"marquee", \{\}, \{"unit": \(/, 'les réglages fixes de la pose restent vides : le compilateur n\'écrit pas unit: child à côté d\'une valeur tenue par une variable')
  })

  it('drag, axis: both et on: scroll demandent déjà la piste : le compilateur n\'ajoute rien', async () => {
    assert.deepEqual(await unite('<div *marquee(drag: true)><img src="a.png" alt="a"></div>'), [undefined])
    assert.deepEqual(await unite('<div *marquee(axis: both)><img src="a.png" alt="a"></div>'), [undefined])
    assert.deepEqual(await unite('<div *marquee(on: scroll)><img src="a.png" alt="a"></div>'), [undefined])
    assert.deepEqual(await unite(VARS + '<div *marquee(drag: false)>{for i in $l}<p>{i}</p>{end}</div>'), ['child'], 'drag: false ne demande rien')
  })

  it('les autres réglages de la pose restent tels qu\'écrits', async () => {
    const [pose] = poses(await compiler(VARS + '<div *marquee(speed: 8s, gap: 10, pause: true)>{for i in $l}<p>{i}</p>{end}</div>'))
    assert.deepEqual(pose, { speed: '8s', gap: 10, pause: true, unit: 'child' })
  })

  it('deux poses dans un gabarit : chacune selon sa balise', async () => {
    assert.deepEqual(await unite('<p *marquee>Texte</p><div *marquee><img src="a.png" alt="a"></div>'), [undefined, 'child'])
  })

  it('sans rien de plus qu\'un texte, la pose est celle d\'avant : aucun octet de plus', async () => {
    assert.match(await compiler('<p *marquee>Texte</p>'), /µ\._mjs_fx\(this, _mjs_fxn, "marquee", \{\}\)/)
    assert.match(await compiler('<p *marquee(speed: 8s)>Texte</p>'), /µ\._mjs_fx\(this, _mjs_fxn, "marquee", \{"speed":"8s"\}\)/)
  })
})

// ---- le blanc écrit en entité, et les écritures qui posent du contenu dans la balise ----

// le moteur lit le texte DÉCODÉ par le navigateur (`textContent.trim() === ''`) : `&nbsp;` y est U+00A0, un blanc. Le gabarit, lui, écrit l'entité
const IMG = '<img src="a.png" alt="a">'
// les blancs du moteur (ceux de `trim()`), calculés ici : tous sont dans le plan de base
const BLANCS_NOMBRES: number[] = []
for (let n = 0; n < 0x10000; n++) if (String.fromCodePoint(n).trim() === '') BLANCS_NOMBRES.push(n)
const BLANCS_NOMMES = ['&nbsp;', '&NonBreakingSpace;', '&ensp;', '&emsp;', '&emsp13;', '&emsp14;', '&numsp;', '&puncsp;', '&thinsp;', '&ThinSpace;', '&hairsp;', '&VeryThinSpace;', '&MediumSpace;', '&ThickSpace;', '&Tab;', '&NewLine;']
const BLANCS = [
  ...BLANCS_NOMMES,
  ...BLANCS_NOMBRES.flatMap((n) => [`&#${n};`, `&#x${n.toString(16)};`, `&#X${n.toString(16).toUpperCase()};`]),
  '&nbsp;&nbsp;', ' &nbsp; ', '&#32', '&#x20', '&nbsp;&#32;&ensp;'
]
// les références que le compilateur ne sait pas lire à coup sûr : dans le doute, la balise demande le mode
const INCERTAINES = ['&nbsp', '&ensp', '&inconnue;', '&nbspx;', '&#0;', '&#128;', '&#xD800;', '&#1114112;']
// ce qui est du texte pour le moteur, sûrement : le calque du texte garde la balise
const TEXTES = ['&amp;', '&lt;', '&copy;', '&bull;', '&mdash;', '&lrm;', '&zwj;', '&shy;', '&#8203;', '&#x200B;', '&#169;', '&#x2022;', '&#65;', 'x', 'A&nbsp;B', '&nbsp;A', '&amp;&nbsp;', '&#32;&#8203;&#32;', '& ', '&#;', '&#xZZ;']

describe('*marquee — un blanc écrit en entité est un blanc, comme pour le moteur (qui lit le texte décodé)', () => {
  const trois = (b: string) => `<div *marquee>${b}${IMG}${IMG}</div><div *marquee>${IMG}${b}${IMG}</div><div *marquee>${IMG}${IMG}${b}</div>`

  it('les blancs de trim() sont tous parmi ceux qu\'on essaie (le plan de base)', () => {
    assert.ok(BLANCS_NOMBRES.includes(0xA0) && BLANCS_NOMBRES.includes(0x20) && BLANCS_NOMBRES.includes(0x2003) && BLANCS_NOMBRES.includes(0xFEFF))
    for (let n = 0x10000; n < 0x110000; n += 1) if (String.fromCodePoint(n).trim() === '') assert.fail('un blanc hors du plan de base : ' + n)
  })

  for (const b of BLANCS) {
    it(`${JSON.stringify(b)} entre des éléments : la balise n'a que des éléments pour enfants, la pose demande le mode`, async () => {
      assert.deepEqual(await unite(VARS + trois(b)), ['child', 'child', 'child'])
    })
  }

  for (const b of INCERTAINES) {
    it(`${JSON.stringify(b)} : le compilateur ne sait pas le lire à coup sûr, dans le doute le mode part`, async () => {
      assert.deepEqual(await unite(VARS + trois(b)), ['child', 'child', 'child'])
    })
  }

  for (const t of TEXTES) {
    it(`${JSON.stringify(t)} avec des éléments : du texte pour le moteur, le calque garde la balise`, async () => {
      assert.deepEqual(await unite(VARS + trois(t)), [undefined, undefined, undefined])
    })
  }

  it('un blanc en entité et un texte nu ensemble : le texte l\'emporte, comme au moteur', async () => {
    assert.deepEqual(await unite(VARS + `<div *marquee>Soldes&nbsp;${IMG}</div>`), [undefined])
    assert.deepEqual(await unite(VARS + `<div *marquee>&nbsp;Soldes&nbsp;${IMG}</div>`), [undefined])
  })

  it('un blanc en entité seul (aucun élément) ne demande rien : c\'est un texte vide', async () => {
    assert.deepEqual(await unite(VARS + '<div *marquee>&nbsp;</div><div *marquee>&#32;&ensp;</div>'), [undefined, undefined])
  })

  it('dans une pose de cycle de vie, la même règle : @in=*marquee et @in.global=*marquee', async () => {
    const vie = async (html: string) => [...(await compiler(VARS + html)).matchAll(/µ\._mjs_fxLife\(_mjsThis, _mjs_fxn, "marquee", (\{[^}]*\})/g)].map((m) => JSON.parse(m[1]).unit)
    assert.deepEqual(await vie(`<div @in=*marquee>&nbsp;${IMG}${IMG}</div>`), ['child'])
    assert.deepEqual(await vie(`<div @in.global=*marquee(speed: 4s)>${IMG}&ensp;${IMG}</div>`), ['child'])
    assert.deepEqual(await vie(`<div @in=*marquee>${IMG}${IMG}</div>`), ['child'])
    assert.deepEqual(await vie('<p @in=*marquee>Texte</p>'), [undefined])
    assert.deepEqual(await vie('<p @in.global=*marquee>Texte</p>'), [undefined])
  })
})

// ---- ce que l'analyseur HTML du navigateur ne garde pas comme du texte ----

// le gabarit emporte le texte tel quel dans le template : le navigateur y lit des constructions qu'il ne garde pas (`<!…>`, `<?…>`, `</…>` : un commentaire, ou rien, fermés au
// premier `>`) et ignore U+0000. Une balise dont les éléments sont séparés par l'une d'elles n'a, pour le moteur, que des éléments : le compilateur demande le mode, comme
// pour un blanc. Une construction ouverte sans `>` dans son nœud de texte avale la suite du gabarit : il ne sait plus lire, le mode part
const CONSTRUCTIONS: Array<[string, string]> = [
  ['une section CDATA', '<![CDATA[x]]>'],
  ['une instruction', '<?xml version="1.0"?>'],
  ['une instruction sans point d\'interrogation final', '<?pi>'],
  ['un doctype', '<!DOCTYPE html>'],
  ['une déclaration quelconque', '<!x>'],
  ['une déclaration vide', '<!>'],
  ['une fermante sans nom', '</>'],
  ['une fermante dont le nom commence par un espace', '</ x>'],
  ['une fermante dont le nom commence par un chiffre (après un blanc : en tête d\'un nœud de texte, le parseur la lit comme une fermante)', ' </3>'],
  ['deux constructions de suite', '<!x><?y>'],
  ['U+0000', '\u0000'],
  ['une construction et U+0000', '<!x>\u0000']
]
// ouvertes, sans `>` dans leur nœud de texte
const OUVERTES = ['<?', '<!', '</', '<![CDATA[', '<!x', '<?xml', '</ x', '<!x> <?']
// du texte que le navigateur garde
const GARDES = ['texte', 'a < b', 'prix : 3 €', 'x<3', '1 < 2 > 0', '&lt;!x&gt;', '&lt;?x?&gt;', '&lt;/x&gt;', '<![CDATA[a>b]]>', '<?x>y', '<!x>y', '<!x &gt; y>y', '<\u0000!x>']

describe('*marquee — ce que le navigateur ne garde pas comme du texte n\'est pas du texte (CDATA, instruction, doctype, U+0000…)', function () {
  this.timeout(120000)
  const trois = (b: string) => `<div *marquee>${b}${IMG}${IMG}</div><div *marquee>${IMG}${b}${IMG}</div><div *marquee>${IMG}${IMG}${b}</div>`
  // un vrai texte à côté : il l'emporte, comme au moteur (qui voit alors un nœud de texte non blanc)
  const avecTexte = (b: string) => `<div *marquee>texte ${b}${IMG}${IMG}</div><div *marquee>${IMG}${b}texte${IMG}</div><div *marquee>${IMG}${IMG}${b} texte</div>`

  for (const [nom, b] of CONSTRUCTIONS) {
    it(`${nom} entre des éléments : le moteur n'y voit que des éléments, la pose demande le mode`, async () => {
      assert.deepEqual(await unite(VARS + trois(b)), ['child', 'child', 'child'])
    })

    it(`${nom} à côté d'un vrai texte : le texte l'emporte, la balise garde le calque`, async () => {
      assert.deepEqual(await unite(VARS + avecTexte(b)), [undefined, undefined, undefined])
    })
  }

  for (const b of OUVERTES) {
    it(`${JSON.stringify(b)} sans \`>\` dans son nœud : il avale la suite du gabarit dans le navigateur, le compilateur ne sait plus lire, le mode part`, async () => {
      assert.deepEqual(await unite(VARS + trois(b)), ['child', 'child', 'child'])
      assert.deepEqual(await unite(VARS + `<div *marquee>texte ${b}${IMG}</div>`), ['child'], 'même à côté d\'un vrai texte : dans le doute')
    })
  }

  for (const t of GARDES) {
    it(`${JSON.stringify(t)} avec des éléments : le navigateur en garde du texte, le calque garde la balise`, async () => {
      assert.deepEqual(await unite(VARS + trois(t)), [undefined, undefined, undefined])
    })
  }

  it('une construction fermée dans un nœud et une autre ouverte dans le suivant : celle qui reste ouverte fait partir le mode', async () => {
    assert.deepEqual(await unite(VARS + `<div *marquee><!x>${IMG}<?${IMG}</div>`), ['child'])
  })

  it('une construction ouverte sous un enfant avale sa fermante : le texte qui suit entre dans l\'enfant, la balise n\'a plus qu\'un élément, le mode part', async () => {
    assert.deepEqual(await unite(VARS + '<div *marquee><b>x<?</b>texte</div>'), ['child'])
    assert.deepEqual(await unite(VARS + `<div *marquee><span>x<!</span>texte${IMG}</div>`), ['child'])
    assert.deepEqual(await unite(VARS + '<div *marquee>{if $x}<b>x</</b>texte{end}</div>'), ['child'], 'sous un {if} aussi')
  })

  it('une construction fermée sous un enfant n\'est qu\'un commentaire : le texte qui suit reste le texte de la balise', async () => {
    assert.deepEqual(await unite(VARS + '<div *marquee><b>x<?y></b>texte</div>'), [undefined])
    assert.deepEqual(await unite(VARS + `<div *marquee><b>x<![CDATA[y]]></b>${IMG}</div>`), ['child'], 'des éléments seuls, comme sans la construction')
  })

  it('une construction qui entoure une interpolation s\'ouvre dans un nœud et se ferme dans l\'autre : le compilateur ne sait plus lire, le mode part', async () => {
    assert.deepEqual(await unite(VARS + `<div *marquee>${IMG}<![CDATA[{$msg}]]>${IMG}</div>`), ['child'])
  })

  it('dans une pose de cycle de vie, la même règle : @in=*marquee', async () => {
    const jouer = async (html: string) => [...(await compiler(VARS + html)).matchAll(/µ\._mjs_fxLife\(_mjsThis, _mjs_fxn, "marquee", (\{[^}]*\})/g)].map((m) => JSON.parse(m[1]).unit)
    assert.deepEqual(await jouer(`<div @in=*marquee><![CDATA[x]]>${IMG}${IMG}</div>`), ['child'])
    assert.deepEqual(await jouer(`<div @in=*marquee>${IMG}<?${IMG}</div>`), ['child'])
    assert.deepEqual(await jouer(`<p @in=*marquee>texte <![CDATA[x]]></p>`), [undefined])
  })
})

// ---- unit: auto écrit en clair vaut le défaut ----

describe('*marquee — unit: auto écrit en clair est le défaut : la pose ne le porte pas', function () {
  this.timeout(120000)
  const vie = async (html: string) => [...(await compiler(VARS + html)).matchAll(/µ\._mjs_fxLife\(_mjsThis, _mjs_fxn, "marquee", (\{[^}]*\})/g)].map((m) => JSON.parse(m[1]))

  it('sur un texte, la pose est celle d\'un *marquee sans ce réglage', async () => {
    assert.match(await compiler('<p *marquee(unit: auto)>Texte</p>'), /µ\._mjs_fx\(this, _mjs_fxn, "marquee", \{\}\)/)
    assert.match(await compiler('<p *marquee(unit: auto, speed: 8s)>Texte</p>'), /µ\._mjs_fx\(this, _mjs_fxn, "marquee", \{"speed":"8s"\}\)/)
    assert.match(await compiler('<div *marquee(unit: auto)></div>'), /µ\._mjs_fx\(this, _mjs_fxn, "marquee", \{\}\)/, 'sur une balise vide aussi')
  })

  it('avec drag, axis: both ou on: scroll, que le build lit déjà, il n\'est pas porté non plus', async () => {
    for (const reglage of ['drag: true', 'axis: both', 'on: scroll']) {
      const [pose] = poses(await compiler(`<div *marquee(unit: auto, ${reglage})><img src="a.png" alt="a"></div>`))
      assert.equal('unit' in pose, false, `unit: auto avec ${reglage} : ${JSON.stringify(pose)}`)
    }
  })

  it('sur des balises, auto devient child (une fois), et la valeur écrite child reste', async () => {
    assert.deepEqual(poses(await compiler('<div *marquee(unit: auto, speed: 4s)><img src="a.png" alt="a"></div>')), [{ speed: '4s', unit: 'child' }])
    assert.deepEqual(poses(await compiler('<div *marquee(unit: child, speed: 4s)></div>')), [{ speed: '4s', unit: 'child' }])
  })

  it('dans une pose de cycle de vie aussi : @in=*marquee(unit: auto)', async () => {
    assert.deepEqual(await vie('<p @in=*marquee(unit: auto)>Texte</p>'), [{}])
    assert.deepEqual(await vie(`<div @in=*marquee(unit: auto)>${IMG}${IMG}</div>`), [{ unit: 'child' }])
  })

  it('une valeur tenue par une variable n\'est pas touchée', async () => {
    assert.match(await compiler(VARS + `<div *marquee(unit: $u)>${IMG}</div>`), /"marquee", \{\}, \{"unit": \(/)
  })
})

// ---- le HTML brut : les deux écritures sont lues comme le générateur les rend ----

describe('*marquee — le HTML brut : `{{ … }}` et `{ {…} }` demandent le mode, comme le générateur les rend', function () {
  this.timeout(120000)
  for (const ecrit of ['{{ $h }}', '{{$h}}', '{ {$h} }', '{ {$h}}', '{{ $h}}']) {
    it(`${ecrit} : le générateur le rend en HTML brut, la pose demande le mode`, async () => {
      const js = await compiler(VARS + `<div *marquee>${ecrit}</div>`)
      assert.match(js, /_mjs_updHtml/, 'rendu en HTML brut')
      assert.deepEqual(poses(js).map((p) => p.unit), ['child'])
    })
  }

  it('l\'interpolation de texte `{$msg}` reste du texte pour les deux : ni HTML brut, ni mode', async () => {
    const js = await compiler(VARS + '<div *marquee>{$msg}</div>')
    assert.doesNotMatch(js, /_mjs_updHtml/)
    assert.deepEqual(poses(js).map((p) => p.unit), [undefined])
  })
})

// ---- @html avec un modificateur, et la forme que le parseur refuse ----

describe('*marquee — @html pose du HTML dans la balise, avec ou sans modificateur', function () {
  this.timeout(120000)
  it('@html.x=!{…} : la balise est remplie de HTML, le mode part', async () => {
    assert.deepEqual(await unite(VARS + '<div *marquee @html.x=!{$h}></div>'), ['child'])
  })

  it('@html.once=!{…} : un vrai modificateur, même règle', async () => {
    assert.deepEqual(await unite(VARS + '<div *marquee @html.once=!{$h}></div>'), ['child'])
  })

  it('@html{…} : le parseur le refuse (un `{…}` nu n\'est pas un attribut d\'une <div>), il n\'arrive jamais à la pose', async () => {
    await assert.rejects(compiler(VARS + '<div *marquee @html{$h}></div>'), /`\{\$h\}` nu/)
  })

  it('@text.x=!{…} reste du texte : rien à demander', async () => {
    assert.deepEqual(await unite(VARS + '<div *marquee @text.x=!{$msg}></div>'), [undefined])
  })
})

// ---- des builds réels de production ----

const compte =(texte: string, motif: string) => texte.split(motif).length - 1

// ce qui n'est que dans le mode « balises » : la piste des enfants, ses copies, ses règles
const PISTE = ['function _mjsFxMarqueeKids(', 'function _mjsFxMarqueeMirror(', 'var stripSetup = function() {', '[mjs-fx-marquee-strip="kids"]', '@keyframes mjs-fx-marquee-run{', 'var _MJS_FX_MARQUEE_RUN']
// ce que le texte seul garde
const TEXTE = ['var layerSetup = function() {', 'function _mjsFxMarqueeAway(', "[mjs-fx~=\"marquee\"] [mjs-fx-marquee-track]{display:flex", 'part.textContent = txt.trim();']
// l'avertissement du développement
const AVIS = "µ._mjs_msg('dev.marqueeKids'"
// le texte de l'avertissement, dans les deux langues : réservé au développement, il ne part dans aucun fichier d'une production ordinaire (catalogues de messages compris)
const TEXTES_AVIS = ['cette balise fait défiler des balises que le compilateur', 'this tag scrolls child tags that the compiler']

const S = '\n<style>\n.a\n  width: 300px\n</style>\n'

describe('*marquee — le code de la piste ne part que si une pose de l\'application en a besoin (production)', function () {
  this.timeout(600000)
  after(async () => { await terminateSharedWorkerPool() })

  // un build RÉEL dont le code reste lisible (`minify: false`) ; `env: 'prod'` : le développement envoie le fichier en entier
  async function construire(nom: string, source: string, reglage: 'defaut' | 'coeur' | 'dev' = 'defaut'): Promise<string> {
    const root   = mjsTmp('marquee-tri-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'p.mjs'), source)
    const options: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false }
    if (reglage !== 'dev') options.env = 'prod'
    if (reglage === 'coeur') Object.assign(options, { runtime: 'core', js: 'bundle' })
    const bundler = new Bundler(options)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    // les .js, et les catalogues de messages (.json) que la production écrit à côté
    const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js') || f.endsWith('.json')).map((f) => readFileSync(join(outDir, f), 'utf-8'))
    if (existsSync(join(root, 'bundle.js'))) fichiers.push(readFileSync(join(root, 'bundle.js'), 'utf-8'))
    return fichiers.join('\n')
  }
  const page = (balise: string) => `${VARS}${balise}${S}`

  // [nom, la page, la piste doit-elle être dans la sortie ?]
  const PAGES: Array<[string, string, boolean]> = [
    ['un texte seul', page('<p class="a" *marquee>Un texte</p>'), false],
    ['une interpolation de texte', page('<p class="a" *marquee>{$msg}</p>'), false],
    ['un texte et ses balises en ligne', page('<p class="a" *marquee>Soldes <b>-50 %</b> et <a href="#">plus</a></p>'), false],
    ['un texte aux réglages de la V3 (speed, direction, gap, pause)', page('<p class="a" *marquee(speed: 8s, direction: up, gap: 20, pause: true)>Un texte</p>'), false],
    ['une balise vide qu\'un script remplira', page('<div class="a" *marquee></div>'), false],
    ['unit: auto sur un texte', page('<p class="a" *marquee(unit: auto)>Un texte</p>'), false],
    ['une balise à balises', page('<div class="a" *marquee><p>un</p><p>deux</p></div>'), true],
    ['une liste {for}', page('<div class="a" *marquee>{for i in $l}<p>{i}</p>{end}</div>'), true],
    ['un <slot>', page('<div class="a" *marquee><slot></slot></div>'), true],
    ['du HTML inséré tel quel', page('<div class="a" *marquee>{{ $h }}</div>'), true],
    ['un {if} dont une branche écrit un élément', page('<div class="a" *marquee>{if $x}Salut{else}<img src="a.png" alt="a">{end}</div>'), true],
    ['unit: child sur une balise vide', page('<div class="a" *marquee(unit: child)></div>'), true],
    ['unit: child tenu par une variable', page('<div class="a" *marquee(unit: $u)></div>'), true],
    ['drag sur un texte', page('<p class="a" *marquee(drag: true)>Un texte</p>'), true],
    ['axis: both sur un texte', page('<p class="a" *marquee(axis: both)>Un texte</p>'), true],
    ['on: scroll sur un texte', page('<p class="a" *marquee(on: scroll)>Un texte</p>'), true],
    ['deux poses, une seule en a besoin', page('<p class="a" *marquee>Un texte</p><div class="b" *marquee><p>un</p></div>'), true]
  ]

  for (const reglage of ['defaut', 'coeur'] as const) {
    describe(reglage === 'defaut' ? 'réglage par défaut du bundler' : 'runtime: \'core\' et js: \'bundle\'', () => {
      for (const [nom, source, piste] of PAGES) {
        it(`${nom} : ${piste ? 'la piste des enfants part' : 'la piste des enfants ne part pas, le texte reste'}`, async () => {
          const sortie = await construire(`${reglage}-${nom.replace(/\W+/g, '-')}`, source, reglage)
          for (const t of PISTE) assert.equal(compte(sortie, t) > 0, piste, `« ${t} » ${piste ? 'doit' : 'ne doit pas'} être dans la sortie`)
          for (const t of TEXTE) assert.ok(sortie.includes(t), `le texte seul garde « ${t} »`)
          assert.equal(sortie.includes(AVIS), false, 'l\'avertissement du développement ne part pas en production')
          for (const t of TEXTES_AVIS) assert.equal(sortie.includes(t), false, `« ${t}… » est du développement : ni les .js, ni le manifeste, ni les catalogues de messages de la production ne le portent`)
          assert.equal(sortie.split('\n').some((l) => /^\s*\/\/ @@/.test(l) || /\s\/\/ @@ [A-Za-z]/.test(l)), false, 'aucune marque de section ne sort')
        })
      }
    })
  }

  it('le développement envoie le fichier en entier : la piste, quelle que soit la balise, et l\'avertissement', async () => {
    const sortie = await construire('developpement', page('<p class="a" *marquee>Un texte</p>'), 'dev')
    for (const t of [...PISTE, ...TEXTE, AVIS]) assert.ok(sortie.includes(t), `développement : « ${t} »`)
    for (const t of TEXTES_AVIS) assert.ok(sortie.includes(t), `développement : le texte « ${t}… » est au manifeste`)
  })

  it('une demande explicite du fichier (runtime: [\'fx_marquee\']) envoie tout, comme avant', async () => {
    const root = mjsTmp('marquee-tri-explicite')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'p.mjs'), page('<p class="a" *marquee>Un texte</p>'))
    const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), minify: false, env: 'prod', runtime: ['fx_marquee'] } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    const sortie = readdirSync(join(root, 'out')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(root, 'out', f), 'utf-8')).join('\n')
    for (const t of PISTE) assert.ok(sortie.includes(t), `demande explicite : « ${t} »`)
  })
})
