// le repérage des chemins locaux écrits en clair dans les réglages d'image d'un effet : la règle du catalogue décide
// (localImages), le repérage dans le gabarit (scanEffectImages) et la réécriture en µimage('…') (resolveEffectImages)
// ne connaissent aucun effet par son nom

import assert from 'node:assert/strict'
import { fixedImages, localImages, parseEffect, withProjectEffects } from '../src/effects/catalog.js'
import { scanEffectImages, resolveEffectImages } from '../src/transpiler/effect-images.js'
import { t, setMessagesLang } from '../src/messages/index.js'

const chemins = (nom: string, reglages: string) => localImages(nom, reglages).map((i) => i.path)

describe('localImages — ce que la règle du catalogue range parmi les chemins locaux', () => {
  it('le réglage principal et le réglage nommé : la position du littéral, guillemets compris', () => {
    assert.deepEqual(localImages('behind', "'photo.jpg'"), [{ key: 'image', path: 'photo.jpg', start: 0, end: 11 }])
    const r = "image: 'photo.jpg', depth: 2"
    const [i] = localImages('behind', r)
    assert.equal(r.slice(i.start, i.end), "'photo.jpg'")
    assert.equal(i.key, 'image')
  })

  it('guillemets doubles, dossier, ./', () => {
    assert.deepEqual(chemins('behind', '"photo.jpg"'), ['photo.jpg'])
    assert.deepEqual(chemins('behind', "'img/photo.jpg'"), ['img/photo.jpg'])
    assert.deepEqual(chemins('behind', "'./photo.jpg'"), ['./photo.jpg'])
  })

  it('une adresse complète, //, data:, blob:, une adresse de la racine, une ancre : rien', () => {
    for (const v of ['https://x.test/a.jpg', 'http://x.test/a.jpg', '//x.test/a.jpg', 'data:image/png;base64,AAAA', 'blob:http://l/abc', '/a.jpg', '#a'])
      assert.deepEqual(localImages('behind', `'${v}'`), [], v)
  })

  it('une variable, une variable de boucle, un appel µimage ou µasset : rien', () => {
    for (const v of ['$img', '$$img', 'item.src', "µimage('a.jpg')", "µasset('a.jpg')", "µimage('a.jpg', 480)", '{"src":"/a.jpg"}'])
      assert.deepEqual(localImages('behind', v), [], v)
  })

  it('un chemin écrit nu : un chemin quand il finit par une extension d\'image, pour un réglage image comme pour une liste', () => {
    assert.deepEqual(chemins('behind', 'photo.png'), ['photo.png'])
    assert.deepEqual(chemins('behind', 'img/a.webp'), ['img/a.webp'])
    assert.deepEqual(chemins('behind', './a.JPG'), ['./a.JPG'])
    assert.deepEqual(chemins('gradient', 'image: photo.png'), ['photo.png'])
    assert.deepEqual(chemins('scrub', 'images: [a.avif, img/b.JPG]'), ['a.avif', 'img/b.JPG'])
    const r = 'photo.png, depth: 2'
    const [i] = localImages('behind', r)
    assert.equal(r.slice(i.start, i.end), 'photo.png')
  })

  it('une expression n\'est pas un chemin : variable de boucle, propriété, mot sans extension — réglage image, liste, valeur seule', () => {
    for (const v of ['g.frames', 'item.src', 'g.src', 'photo', 'a.b.c', 'frames[0]', 'g.png.x', 'item?.src']) {
      assert.deepEqual(localImages('behind', v), [], 'behind ' + v)
      assert.deepEqual(localImages('scrub', `images: [${v}]`), [], 'scrub liste ' + v)
      assert.deepEqual(localImages('scrub', `images: ${v}`), [], 'scrub seul ' + v)
    }
  })

  it('entre guillemets aussi, le chemin se reconnaît à son extension d\'image : un texte, un émoji, un dégradé ne sont pas des fichiers', () => {
    for (const v of ["'photo'", "'📡'", "'Wi-Fi'", "'linear-gradient(red, blue)'", "'url(a.png)'", "'script.mjs'"]) assert.deepEqual(localImages('behind', v), [], v)
    assert.deepEqual(chemins('behind', "'photo.png?v=2'"), ['photo.png?v=2'], 'une requête après l\'extension : c\'est un chemin, le build dira que ce fichier n\'existe pas')
  })

  it('*pixels(swap, image: …) et *offline(logo: …) : des réglages d\'image, comme les autres', () => {
    assert.deepEqual(chemins('pixels', "swap, image: 'photo.png'"), ['photo.png'])
    assert.deepEqual(chemins('pixels', 'swap, image: photo.png'), ['photo.png'])
    assert.deepEqual(chemins('offline', "logo: 'logo.png'"), ['logo.png'])
    for (const v of ["'/img/a.png'", "'https://x.test/a.png'", "'data:image/png;base64,AAAA'", "'linear-gradient(red, blue)'", "'url(a.png)'", "'📡'", 'item.logo']) {
      assert.deepEqual(localImages('pixels', `swap, image: ${v}`), [], 'pixels ' + v)
      assert.deepEqual(localImages('offline', `logo: ${v}`), [], 'offline ' + v)
    }
  })

  it('un réglage dont l\'effet ne lit que l\'adresse (jamais les variantes de largeur) le dit : scrub images, offline logo', () => {
    assert.equal(localImages('scrub', "images: ['a.png']")[0].plain, true)
    assert.equal(localImages('offline', "logo: 'a.png'")[0].plain, true)
    for (const [nom, reglages] of [['behind', "'a.png'"], ['pixels', "swap, image: 'a.png'"], ['hologram', "image: 'a.png'"], ['gradient', "'a.png'"]]) {
      assert.notEqual(localImages(nom, reglages)[0].plain, true, nom)
    }
  })

  it('les autres réglages ne sont pas des images : un texte entre guillemets n\'est jamais pris pour un chemin', () => {
    assert.deepEqual(chemins('behind', "'photo.jpg', size: 'cover'"), ['photo.jpg'])
    assert.deepEqual(chemins('scratch', "text: 'photo.jpg', color: '#ccc'"), [])
    assert.deepEqual(chemins('ink', "style: 'blots', image: 'm.png'"), ['m.png'])
  })

  it('deux réglages d\'image dans le même effet', () => {
    const r = "v-full, image: 'i.png', mask: 'm.png'"
    const liste = localImages('hologram', r)
    assert.deepEqual(liste.map((i) => [i.key, i.path]), [['image', 'i.png'], ['mask', 'm.png']])
    assert.deepEqual(liste.map((i) => r.slice(i.start, i.end)), ["'i.png'", "'m.png'"])
  })

  it('une liste d\'images : chaque élément local, guillemets ou non, le reste intact', () => {
    const r = "images: [a.png, 'b.png', 'data:x', /c.png, http://d.test/e.png, µasset('f.png'), µimage('g.png')], count: 3"
    const liste = localImages('scrub', r)
    assert.deepEqual(liste.map((i) => i.path), ['a.png', 'b.png'])
    assert.deepEqual(liste.map((i) => r.slice(i.start, i.end)), ['a.png', "'b.png'"])
    assert.ok(liste.every((i) => i.key === 'images'))
  })

  it('une liste seule, sans crochets : un seul élément', () => {
    assert.deepEqual(chemins('scrub', 'images: a.png'), ['a.png'])
  })

  it('une valeur seule pour une liste d\'images, écrite avec ce que le build pose (un objet) : une liste d\'un élément', () => {
    const objet = '{"src":"/assets/a-abc.png","srcset":"","sizes":"","width":64,"height":8}'
    assert.deepEqual(parseEffect('scrub', `images: ${objet}`).fixed.images, [objet])
    assert.deepEqual(parseEffect('scrub', `images: [${objet}, ${objet}]`).fixed.images, [objet, objet])
    assert.throws(() => parseEffect('scrub', 'images: {"srcset":"a 1w"}'), /\*scrub : images/)
    assert.throws(() => parseEffect('scrub', 'images: {a}'), /\*scrub/)
  })

  it('un effet inconnu, un réglage inconnu, des réglages vides : rien, et aucune exception', () => {
    assert.deepEqual(localImages('nexistepas', "'a.png'"), [])
    assert.deepEqual(localImages('behind', "inconnu: 'a.png'"), [])
    assert.deepEqual(localImages('behind', ''), [])
    assert.deepEqual(localImages('behind', "image: 'a.png"), [])
  })
})

describe('scanEffectImages — où les effets écrivent des chemins locaux', () => {
  const effets = (html: string) => scanEffectImages(html).map((e) => [e.effet, e.reglage, e.chemin])

  it('un effet sur une balise, entre d\'autres attributs', () => {
    assert.deepEqual(effets("<div class=\"x\" id=\"y\" *behind('a.png') data-z=\"1\"></div>"), [['behind', 'image', 'a.png']])
  })

  it('une transition (@in, @out, @transition) : l\'effet suit le signe égal', () => {
    assert.deepEqual(effets("<div @in=*ink(image: 'a.png', duration: 2s)></div>"), [['ink', 'image', 'a.png']])
    assert.deepEqual(effets("<div @out.global=*ink(image: 'b.png')></div>"), [['ink', 'image', 'b.png']])
  })

  it('un effet sur <@document>, une liste', () => {
    assert.deepEqual(effets('<@document *scrub(images: [a.png, b.png])></@document>'), [['scrub', 'images', 'a.png'], ['scrub', 'images', 'b.png']])
  })

  it('plusieurs balises, plusieurs effets, dans l\'ordre du texte', () => {
    const html = "<div *behind('a.png')></div>\n<p>texte</p>\n<h1 *gradient('b.png') *behind('c.png')>M</h1>"
    assert.deepEqual(effets(html).map((e) => e[2]), ['a.png', 'b.png', 'c.png'])
  })

  it('un > dans un guillemet ou dans les réglages ne ferme pas la balise trop tôt', () => {
    assert.deepEqual(effets("<div title=\"a > b\" *behind('a.png')></div>").map((e) => e[2]), ['a.png'])
  })

  it('ni dans du texte, ni dans <pre>/<code>, ni dans un commentaire, ni dans <script>/<style>, ni dans la valeur d\'un attribut', () => {
    const html = [
      "<p>Écrivez *behind('a.png') sur une balise</p>",
      "<pre><div *behind('b.png')></div></pre>",
      "<code><div *behind('c.png')></div></code>",
      "<!-- <div *behind('d.png')></div> -->",
      "<script>x = ' *behind(\"e.png\") '</script>",
      "<style>.a::after { content: ' *behind(\"f.png\") ' }</style>",
      "<div title=\" *behind('g.png')\"></div>"
    ].join('\n')
    assert.deepEqual(effets(html), [])
  })

  it('un effet dont les parenthèses ne se ferment pas : ignoré, sans exception', () => {
    assert.deepEqual(effets("<div *behind('a.png'></div>"), [])
  })

  it('les positions sont celles du texte donné', () => {
    const html = "<div *behind('a.png')></div>"
    const [e] = scanEffectImages(html)
    assert.equal(html.slice(e.debut, e.fin), "'a.png'")
  })
})

describe('resolveEffectImages — la réécriture en µimage(\'…\')', () => {
  it('chaque chemin local devient l\'appel µimage, à la place du littéral', () => {
    assert.equal(resolveEffectImages("<div *behind('a.png', depth: 2)></div>"), "<div *behind(µimage('a.png'), depth: 2)></div>")
    assert.equal(resolveEffectImages('<div *behind("a.png")></div>'), "<div *behind(µimage('a.png'))></div>")
  })

  it('une liste : les éléments locaux seuls (µasset pour un effet qui ne lit que l\'adresse)', () => {
    assert.equal(resolveEffectImages("<div *scrub(images: [a.png, 'b.png', 'data:x', /c.png])></div>"), "<div *scrub(images: [µasset('a.png'), µasset('b.png'), 'data:x', /c.png])></div>")
  })

  it('une transition', () => {
    assert.equal(resolveEffectImages("<div @in=*ink(image: 'm.png')></div>"), "<div @in=*ink(image: µimage('m.png'))></div>")
  })

  it('deux réglages, deux balises : toutes les réécritures, dans le bon ordre', () => {
    const html = "<div *hologram(image: 'i.png', mask: 'm.png')></div><div *behind('i.png')></div>"
    assert.equal(resolveEffectImages(html), "<div *hologram(image: µimage('i.png'), mask: µimage('m.png'))></div><div *behind(µimage('i.png'))></div>")
  })

  it('rien à réécrire : le texte rendu est le texte reçu', () => {
    const html = "<div *behind('https://x.test/a.png')></div><div *behind($img)></div><p>*behind('a.png')</p>"
    assert.equal(resolveEffectImages(html), html)
  })

  it('deux passes valent une passe : un µimage déjà écrit n\'est plus un chemin local', () => {
    const une = resolveEffectImages("<div *behind('a.png')></div>")
    assert.equal(resolveEffectImages(une), une)
  })

  it('un chemin qui porte un guillemet, une barre oblique inverse ou un saut de ligne est laissé tel quel', () => {
    for (const v of ["'a\"b.png'", "'a\\b.png'", "'a\nb.png'"]) {
      const html = `<div *behind(${v})></div>`
      assert.equal(resolveEffectImages(html), html)
    }
  })
})

describe('localImages — un effet de l\'appli qui règle un effet de la bibliothèque', () => {
  it('ses réglages sont ceux de l\'effet réglé : le chemin local qu\'on lui donne est repéré', () => {
    const fond = { base: 'behind', fixed: { depth: 20 }, file: 'effets.effects.mjs', line: 1 }
    withProjectEffects({ fond }, () => {
      assert.deepEqual(localImages('fond', "'photo.jpg'").map((i) => i.path), ['photo.jpg'])
      assert.deepEqual(localImages('fond', "'https://x.test/a.jpg'"), [])
    })
    assert.deepEqual(localImages('fond', "'photo.jpg'"), [], 'hors de la compilation de l\'appli, ce nom n\'est pas un effet')
  })

  it('un effet CSS de l\'appli n\'a aucun réglage d\'image', () => {
    const halo = { params: [['couleur', '#f0f']] as Array<[string, string]>, file: 'effets.effects.mjs', line: 1 }
    withProjectEffects({ halo }, () => assert.deepEqual(localImages('halo', "'photo.jpg'"), []))
  })
})

describe('les messages d\'image d\'effet — le chemin local y est dit, l\'avertissement de sharp ne parle pas que de µimage', () => {
  afterEach(() => { setMessagesLang('fr') })

  for (const lang of ['fr', 'en'] as const) {
    it(`${lang} : le libellé d'un réglage image cite le chemin d'un fichier, celui d'une liste d'images aussi`, () => {
      setMessagesLang(lang)
      assert.match(t('effets.regle-image'), /photo\.jpg/)
      assert.match(t('effets.regle-images'), /a\.jpg/)
      assert.throws(() => parseEffect('behind', "image: ''"), /photo\.jpg/, 'la faute d\'un réglage image montre ce libellé')
    })

    it(`${lang} : l'avertissement de sharp absent nomme les réglages d'image des effets et <@@img>, pas seulement µimage`, () => {
      setMessagesLang(lang)
      const message = t('bundler.index.image-sharp-absent')
      assert.match(message, lang === 'fr' ? /réglages d'image des effets/ : /effect image settings/)
      assert.match(message, /<@@img>/)
      assert.match(message, /npm i -D sharp/)
    })
  }
})

// une adresse de `n` caractères
const adresse = (n: number) => 'data:image/svg+xml,' + 'x'.repeat(n - 'data:image/svg+xml,'.length)

describe('*offline(logo) et *pixels(image) — une adresse data: longue et la valeur vide passent, comme avant la règle image', () => {
  for (const n of [2000, 2001, 2500, 5000]) {
    it(`${n} caractères : le logo et la seconde image sont acceptés tels quels`, () => {
      assert.equal(parseEffect('offline', `logo: '${adresse(n)}'`).fixed.logo, adresse(n))
      assert.equal(parseEffect('pixels', `swap, image: '${adresse(n)}'`).fixed.image, adresse(n))
    })
  }

  it('la valeur vide est acceptée : pas de logo, pas de seconde image', () => {
    assert.equal(parseEffect('offline', "logo: ''").fixed.logo, '')
    assert.equal(parseEffect('offline', 'logo:').fixed.logo, '')
    assert.equal(parseEffect('pixels', "swap, image: ''").fixed.image, '')
  })

  it('un url(…) ou un dégradé très long, un texte long : acceptés aussi, le build n\'y touche pas', () => {
    const long = `url(${adresse(3000)})`
    assert.equal(parseEffect('pixels', `swap, image: '${long}'`).fixed.image, long)
    assert.equal(parseEffect('offline', `logo: '${'Wi-Fi '.repeat(500)}'`).fixed.logo, 'Wi-Fi '.repeat(500))
  })

  it('une adresse longue ou vide donnée par une variable passe toujours (la valeur se vérifie à l\'exécution)', () => {
    assert.deepEqual(parseEffect('offline', 'logo: $logo').dynamic, { logo: '$logo' })
    assert.deepEqual(parseEffect('pixels', 'swap, image: $autre').dynamic, { image: '$autre' })
  })
})

describe('les autres réglages d\'image gardent leur borne (une valeur de 1 à 2000 caractères), et l\'erreur la dit', () => {
  afterEach(() => { setMessagesLang('fr') })

  it('2000 caractères passent, 2001 et plus sont refusés, la valeur vide aussi', () => {
    assert.equal(parseEffect('behind', `'${adresse(2000)}'`).fixed.image, adresse(2000))
    for (const [nom, raw] of [['behind', `'${adresse(2001)}'`], ['gradient', `image: '${adresse(2500)}'`], ['hologram', `image: '${adresse(5000)}'`], ['behind', "image: ''"]])
      assert.throws(() => parseEffect(nom, raw), raw.slice(0, 40))
  })

  for (const lang of ['fr', 'en'] as const) {
    it(`${lang} : l'erreur d'une valeur trop longue dit la borne et la longueur reçue`, () => {
      setMessagesLang(lang)
      for (const n of [2001, 2500, 5000]) {
        assert.throws(() => parseEffect('behind', `'${adresse(n)}'`), (e: Error) => /2000/.test(e.message) && e.message.includes(String(n)), `${n} caractères`)
      }
    })
  }
})

describe('localImages — chaque extension d\'image est reconnue, svg compris', () => {
  const EXTENSIONS = ['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'avif', 'apng', 'svg', 'bmp', 'ico', 'tif', 'tiff']

  it('un chemin local pour chacune, guillemets ou non, dans la casse écrite, pour un réglage image comme pour une liste', () => {
    for (const ext of EXTENSIONS) {
      assert.deepEqual(chemins('behind', `'logo.${ext}'`), [`logo.${ext}`], ext)
      assert.deepEqual(chemins('behind', `logo.${ext.toUpperCase()}`), [`logo.${ext.toUpperCase()}`], 'majuscules ' + ext)
      assert.deepEqual(chemins('scrub', `images: [a.${ext}, 'b.${ext}']`), [`a.${ext}`, `b.${ext}`], 'liste ' + ext)
    }
  })

  it('une extension qui n\'en est pas une n\'est pas un fichier d\'image', () => {
    for (const v of ['logo.svgz', 'a.pngx', 'a.jp', 'a.tifff', 'a.web', 'a.xsvg', 'a.svg.bak'])
      assert.deepEqual(localImages('behind', `'${v}'`), [], v)
  })
})

describe('fixedImages — les chemins que les réglages fixes d\'un effet réglé donnent à ses réglages d\'image', () => {
  it('une image seule : le chemin, la place -1, plain faux pour un effet qui lit le srcset (svg compris)', () => {
    assert.deepEqual(fixedImages('behind', { image: 'photo.png', depth: 3 }), [{ key: 'image', index: -1, path: 'photo.png', plain: false }])
    assert.deepEqual(fixedImages('behind', { image: 'logo.svg' }), [{ key: 'image', index: -1, path: 'logo.svg', plain: false }])
    assert.deepEqual(fixedImages('behind', { image: 'LOGO.Svg' }), [{ key: 'image', index: -1, path: 'LOGO.Svg', plain: false }])
  })

  it('une image que l\'effet lit seule : plain vrai — le logo de *offline, chaque élément des images de *scrub avec sa place', () => {
    assert.deepEqual(fixedImages('offline', { logo: 'logo.png' }), [{ key: 'logo', index: -1, path: 'logo.png', plain: true }])
    assert.deepEqual(fixedImages('scrub', { images: ['a.webp', 'sans-extension', 'b.webp'] }), [
      { key: 'images', index: 0, path: 'a.webp', plain: true },
      { key: 'images', index: 2, path: 'b.webp', plain: true }
    ])
  })

  it('un mot sans extension d\'image, une adresse complète, //, data:, la racine, un texte, un émoji, un dégradé : jamais un fichier', () => {
    for (const v of ['photo', 'script.mjs', 'https://x.test/a.png', '//x.test/a.png', 'data:image/png;base64,AAAA', '/a.png', 'Acme', '📡', 'linear-gradient(red, blue)', 'a"b.png', 'g.frames', 'photo.png.bak']) {
      assert.deepEqual(fixedImages('behind', { image: v }), [], v)
      assert.deepEqual(fixedImages('offline', { logo: v }), [], v)
      assert.deepEqual(fixedImages('scrub', { images: [v] }), [], v)
    }
  })

  it('un réglage qui n\'est pas une image, un effet inconnu : rien', () => {
    assert.deepEqual(fixedImages('behind', { edge: 'photo.png', depth: 5 }), [])
    assert.deepEqual(fixedImages('inconnu', { image: 'photo.png' }), [])
  })
})
