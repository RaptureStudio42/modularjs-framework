// Les alias que ModularJS livre (src/effects/aliases-mjs.ts) : le test lit le fichier lui-même, alias par alias.
// Chacun pose l'effet qu'il règle comme l'écriture en clair de ses réglages (mêmes réglages reçus par l'effet, même code émis,
// mêmes modules du cœur en production), son nom suit la règle des alias et reste unique pour son effet, aucun ne porte une image
// ni une cible propre à une page (l'auteur les donne à l'usage), et celui de l'appli qui porte le même nom le remplace, avec un
// avertissement. La liste des noms est une promesse faite aux auteurs : en ajouter, en retirer ou en renommer un se fait ici aussi.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { EFFECTS, ALIAS_NAME, parseEffect, withProjectEffects } from '../src/effects/catalog.js'
import { MJS_ALIASES } from '../src/effects/aliases-mjs.js'
import { resolveProjectEffects } from '../src/effects/project.js'
import { mjsTmp } from './helpers/tmp.js'

// les noms livrés, par effet, dans l'ordre du fichier
const PROMIS: Record<string, string[]> = {
  backlight:      ['wide_glow', 'caption_glow'],
  gradient:       ['knockout', 'texture'],
  behind:         ['depth', 'blurred_edge', 'solid_edge'],
  pile:           ['offset', 'deep', 'blurred'],
  velocity:       ['stretch', 'tilt', 'bend', 'motion_blur', 'lag'],
  fluid:          ['ink_title', 'two_colors', 'glow_rays', 'long_trail'],
  focus:          ['dim_others', 'gray_others'],
  gallery:        ['strip', 'wheel', 'free_wheel', 'arc', 'tunnel', 'sphere'],
  liquid:         ['tiles', 'red_ghost', 'smooth_wave'],
  marquee:        ['thumbnails', 'columns', 'wall', 'text_pause'],
  physics:        ['springy_cards', 'hanging_letters', 'balloons'],
  pointer:        ['pink_ring', 'trailing_dot', 'gray_lens', 'blur_lens', 'soft_circle'],
  lift:           ['pressed_key'],
  neon:           ['breathing_red', 'pink_frame'],
  tilt:           ['floating_layers', 'bounce_back'],
  loader:         ['amber_vortex', 'steps', 'plus', 'neon', 'trio', 'slab_ring', 'bloom', 'spiral', 'galaxy', 'cross'],
  parallax:       ['drift'],
  scrub:          ['on_hover'],
  filter:         ['gray_spot', 'frosted_glass', 'lens', 'sepia_spot', 'vintage', 'lomo', 'cyberpunk', 'thermal', 'posterize', 'halftone', 'vignette', 'tiltshift', 'duotone', 'gray_at_rest', 'pixelate', 'bright_hue_shift'],
  spotlight:      ['dark_veil', 'hover_veil', 'lagging_halo', 'green_torch', 'corner_glow', 'corner_flash'],
  sprite:         ['hover_two_frames', 'spin_on_click', 'burst_once', 'four_directions'],
  stagger:        ['masked_lines', 'scroll_lines', 'cards_in_row', 'menu_slide', 'title_words', 'flip', 'blur_words', 'scroll_words'],
  sticky:         ['reappearing_bar', 'hiding_bar'],
  fly:            ['rising_caption', 'slide_left', 'spin_in', 'light_speed'],
  iris:           ['tilted_box', 'tilted_oval', 'from_click', 'box', 'diamond', 'cross'],
  blocks:         ['random_tiles', 'stripes', 'from_center'],
  scale:          ['zoom_out', 'stretch_x'],
  pixelate:       ['three_steps', 'big_pixels', 'scroll_mosaic'],
  travel:         ['spin_path', 'flip_card', 'reveal'],
  longshadow:     ['lamp'],
  pixels:         ['explode', 'strip', 'card_burst', 'mosaic', 'swap'],
  particles:      ['aura', 'stars', 'network', 'meteors'],
  border:         ['wave', 'run'],
  ink:            ['brush', 'wash', 'smoke', 'drip', 'dots', 'shards', 'swirl', 'tear', 'burn', 'frost', 'rain', 'cells', 'cracks', 'ripple', 'scribble', 'petals', 'glitch', 'topo', 'maze'],
  grid:           ['halo', 'trail', 'needle', 'outline', 'glow', 'rows', 'lines'],
  magnet:         ['ring'],
  zoom:           ['from_pointer'],
  goo:            ['merge'],
  attention:      ['heartbeat', 'jello', 'rubber', 'swing', 'wiggle'],
  shine:          ['shimmer'],
  annotate:       ['circle', 'box', 'strike', 'bracket'],
  cycle:          ['flip', 'blur', 'typewriter', 'frame'],
  wheel:          ['four_spokes'],
  rotate:         ['quarter_turn'],
  flipcard:       ['click_flip'],
  scratch:        ['gold'],
  spoiler:        ['blur', 'bar', 'pixels', 'on_hover'],
  weight:         ['stretch'],
  mesh:           ['aurora', 'sunset', 'ocean', 'neon', 'candy', 'forest'],
  chromatic:      ['cmy_title'],
  reflect:        ['water'],
  crt:            ['amber'],
  scrollprogress: ['glow_gradient', 'side_rail'],
  path:           ['loop', 'circle', 'infinity', 'zigzag', 'spiral', 'heart'],
  blend:          ['difference', 'overlay', 'screen_gradient']
}

// les réglages de chaque alias, figés par une donnée qui ne vient pas du fichier : l'empreinte (8 premiers caractères du sha256) de
// [l'effet réglé, ses réglages résolus par ordre alphabétique], dans l'ordre de PROMIS. Un réglage changé, retiré ou ajouté à un alias
// change son empreinte ; le test dit alors la nouvelle, à reporter ici quand le changement est voulu
const EMPREINTES: Record<string, string> = {
  backlight:      '131244ac f6cb76c7',
  gradient:       '931e1df8 fc99ef02',
  behind:         '281f5a54 b5b3b11d ead8e3c7',
  pile:           '0fe35627 7ca83262 1fa09a14',
  velocity:       '8c912020 40b79e44 259b2ee1 9a2ec0c4 12e07767',
  fluid:          'bbaedd7e b6c51e2e 4aeae418 077eb3a0',
  focus:          '8e17b0a2 e804f22a',
  gallery:        '058d026a 1bf41342 c71c7938 a20886af 568938c5 7681dc3f',
  liquid:         'cf92f1c9 8458b169 263efea3',
  marquee:        '0b84836e d562946d ad912913 f7f2a259',
  physics:        'e51bf455 3169c7bd 83962dcf',
  pointer:        '7c3337c2 8b8f2381 7dda5322 ccf1af60 05cb9f1a',
  lift:           'be32cdaa',
  neon:           'fa450c9c bb2a9d35',
  tilt:           'e0e172ca d38d6eac',
  loader:         '766fc72e 9111b943 d488d05f ff7df085 096d101c cacd6187 c8c6c4bd a3ea989e 29ac3e79 865a92d7',
  parallax:       'ede1fa81',
  scrub:          '28398bcd',
  filter:         'b7254b5b 66e3262c 9c84eea5 e561f84d 7b7f6ba6 1a00a3d6 64b07e10 c7706805 ab9c1865 0f503ff2 53457107 56fa9b03 046260c8 58d64a99 29f6925e d0b71ae9',
  spotlight:      '7dc7d570 2a1b46c0 366b9153 d08b3cf3 70742a78 4ebb605f',
  sprite:         '2c665989 e0aa959d 31e83b8a 879d2fae',
  stagger:        '3058903c 85076fd2 73d3b1ef 4a94721d c1da0c93 a900df3b 901a61a7 71c845db',
  sticky:         'e487625a c4cec2e5',
  fly:            '65adcb79 f1f250ee 96025d67 55487f8b',
  iris:           'b4082e11 79471595 6ba08b79 661db2ce cd4dbf52 b7c48ddc',
  blocks:         '8a12c292 5b0a996a 657fbb09',
  scale:          'ec21cd2a a04d61ba',
  pixelate:       '0b8e53f6 f60feb14 104bd43b',
  travel:         'a06722a6 682d53af 9dc82aa3',
  longshadow:     '99c64252',
  pixels:         '686feecb f43d47a3 7ef3b761 8e2b8f80 9288e602',
  particles:      '60762958 7f5db31d 818f01c9 11b0d265',
  border:         'e3054714 17d713d5',
  ink:            '0f8a85dc e3bc8034 dd3df95c 8845e322 2486a944 5686b995 dc1d1567 ba10a863 496689d5 030fdfa3 806ee4d4 5179600f d89e27ea 525a8cd9 64e3ce5d 2f94e68f 1fef1cf2 64cd2abb 3e359b72',
  grid:           'a58a6c87 56a8aad6 cfee7c3f 74449227 c9d2095f c0af41c4 65381cda',
  magnet:         'ad2f854f',
  zoom:           'a4d02b47',
  goo:            'cffe300e',
  attention:      'effdbff5 8368c41b 538b73ae 7cdb078a 41bd866f',
  shine:          '278a6d7f',
  annotate:       '073d38ed 0f94cc78 4cb6284e 3e6a7a9e',
  cycle:          '64dc3dae f8014981 3a18cc1a fc32f750',
  wheel:          '764b4093',
  rotate:         'ac924119',
  flipcard:       '52b3d061',
  scratch:        'd3e98b07',
  spoiler:        '3a668796 b7752b80 dacb690b 1644408c',
  weight:         'd4dc3985',
  mesh:           'd921799f 800a2c56 545960eb ad73a9aa 8a4e523a 5c1bc260',
  chromatic:      '3aa974f7',
  reflect:        '10aedf1b',
  crt:            '3fc633ba',
  scrollprogress: '7b6b5de1 576d450c',
  path:           '4872296d 4086b63b 22026137 d84681ef 7a4fda26 8b4ea82b',
  blend:          'a5a4f025 4c8db5f3 31cfc4b5'
}

interface Livre {
  effet: string
  nom: string
  cible: string
  args: string
}

// une ligne du fichier : `*effet.nom = *effet(réglages)`
const FORME  = /^\*([a-z][a-z0-9-]*)\.([^\s=(]*) = \*([a-z][a-z0-9-]*)\((.*)\)$/
const LIGNES = MJS_ALIASES.split('\n')
const LIVRES: Livre[] = LIGNES.flatMap((ligne) => {
  const m = FORME.exec(ligne)
  return m ? [{ effet: m[1], nom: m[2], cible: m[3], args: m[4] }] : []
})

// ce que l'auteur donne à l'usage : le réglage exigé par l'effet (la clé de *travel), l'image que l'alias ne porte pas
const EXIGE_VALEUR = { to: '\'.cible\'' } as Record<string, string>
const IMAGE_VALEUR = { image: '\'photo.png\'', images: '[\'photo.png\', \'photo.png\']' } as Record<string, string>
const exige = (effet: string) => EFFECTS[effet].need ? `${EFFECTS[effet].need}: ${EXIGE_VALEUR[EFFECTS[effet].need!]}` : ''
const image = (effet: string) => {
  const reglages = EFFECTS[effet].settings
  const cle      = Object.keys(reglages).find((k) => reglages[k].rule === 'image' || reglages[k].rule === 'images')
  return cle ? `${cle}: ${IMAGE_VALEUR[reglages[cle].rule]}` : ''
}

const rang = (i: number) => String(i).padStart(3, '0')
// un effet de transition sans déclencheur (`on`) se pose après `@transition=`, comme dans une appli
const pose = (a: Livre) => EFFECTS[a.effet].transition && !/(^|, )on:/.test(a.args) ? '@transition=' : ''
const avec = (a: Livre, ...plus: string[]) => `<div class="a" ${pose(a)}*${a.effet}.${a.nom}${plus.some(Boolean) ? `(${plus.filter(Boolean).join(', ')})` : ''}>x</div>\n`
const sans = (a: Livre, ...plus: string[]) => `<div class="a" ${pose(a)}*${a.effet}(${[a.args, ...plus].filter(Boolean).join(', ')})>x</div>\n`

// un PNG de 1 × 1 : la photo que l'auteur donne à l'usage
const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function construire(nom: string, fichiers: Record<string, string | Buffer>, reglages: Record<string, unknown> = {}) {
  const root   = mjsTmp(nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, src] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(srcDir, f)), { recursive: true })
    writeFileSync(join(srcDir, f), src)
  }
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...reglages })
  const stats   = await bundler.compile()
  await bundler.close()
  const textes: Record<string, string> = {}
  for (const f of readdirSync(outDir).filter((x) => x.endsWith('.js'))) textes[f] = readFileSync(join(outDir, f), 'utf-8')
  const erreurs = stats.errors.map((e: any) => e.message).join('\n')
  const unite   = (prefixe: string) => Object.entries(textes).filter(([f]) => f.startsWith(prefixe)).map(([, s]) => s).join('\n')
  return { stats, erreurs, textes, unite }
}

// les composants d'une appli d'essai : un par alias, posé une seule fois (six fois, il passerait par la table du cœur, qui n'est pas
// celle de l'écriture en clair) ; `nu` : tel quel, `image` : avec l'image donnée à l'usage, pour les effets qui en prennent une
type Groupe = 'nu' | 'image'
function composants(ecrit: (a: Livre, ...plus: string[]) => string, groupe: Groupe) {
  const out: Record<string, string | Buffer> = { 'photo.png': PHOTO }
  LIVRES.forEach((a, i) => {
    if (groupe === 'nu') out[`al${rang(i)}.mjs`] = ecrit(a, exige(a.effet))
    else if (image(a.effet)) out[`al${rang(i)}.mjs`] = ecrit(a, exige(a.effet), image(a.effet))
  })
  return out
}

describe('les alias que ModularJS livre', function () {
  this.timeout(600000)
  after(async () => { await terminateSharedWorkerPool() })

  let fournis: ReturnType<typeof resolveProjectEffects>

  before(() => {
    fournis = resolveProjectEffects([])
  })

  describe('le fichier', () => {
    it('ne contient que des lignes `*effet.nom = *effet(réglages)` : l\'effet réglé est celui auquel l\'alias se rattache', () => {
      const illisibles = LIGNES.filter((l) => !FORME.test(l))
      assert.deepEqual(illisibles, [])
      for (const a of LIVRES) assert.equal(a.cible, a.effet, `*${a.effet}.${a.nom} règle *${a.cible}`)
    })

    it('les noms livrés sont ceux de la liste promise, effet par effet, dans l\'ordre', () => {
      const lus = {} as Record<string, string[]>
      for (const a of LIVRES) (lus[a.effet] ??= []).push(a.nom)
      assert.deepEqual(lus, PROMIS)
      assert.deepEqual(Object.keys(lus), Object.keys(PROMIS), 'l\'ordre des effets')
    })

    it('le fichier livre 200 alias sur 55 effets', () => {
      assert.equal(LIVRES.length, 200)
      assert.equal(new Set(LIVRES.map((a) => a.effet)).size, 55)
      assert.equal(Object.keys(fournis).length, 200)
    })

    it('*fluid.clear n\'est pas livré : il ne dirait rien de plus que *fluid seul, son nom est un alias inconnu comme un autre', () => {
      assert.ok(!('fluid.clear' in fournis), '*fluid.clear est encore livré')
      assert.ok(!LIGNES.some((l) => l.startsWith('*fluid.clear ')), 'le fichier écrit encore *fluid.clear')
      withProjectEffects(fournis, () => {
        assert.throws(() => parseEffect('fluid.clear', '', [], true), (e: Error) => /^\[ModularJS\] \*fluid\.clear : aucun alias de ce nom pour \*fluid — alias connus : \*fluid\.glow_rays, \*fluid\.ink_title, \*fluid\.long_trail, \*fluid\.two_colors\. /.test(e.message))
      })
    })

    it('*fluid.ink_title n\'écrit pas `background` : les lettres gardent la couleur du texte de la balise, aucun rectangle sombre derrière le titre', () => {
      const ligne = LIGNES.find((l) => l.startsWith('*fluid.ink_title ')) ?? ''
      assert.ok(ligne, '*fluid.ink_title manque')
      assert.doesNotMatch(ligne, /background/)
      assert.deepEqual(Object.keys(fournis['fluid.ink_title'].fixed!).sort(), ['auto', 'colors', 'fade', 'size', 'where'])
      assert.equal(fournis['fluid.ink_title'].fixed!.where, 'text')
    })

    it('les alias d\'un même effet se suivent : le fichier est rangé par effet', () => {
      const vus = new Set<string>()
      let precedent = ''
      for (const a of LIVRES) {
        if (a.effet === precedent) continue
        assert.ok(!vus.has(a.effet), `les alias de *${a.effet} ne se suivent pas`)
        vus.add(a.effet)
        precedent = a.effet
      }
    })

    it('chaque nom suit la règle des alias (minuscules, chiffres, _) et reste unique pour son effet', () => {
      const vus = new Set<string>()
      for (const a of LIVRES) {
        assert.ok(ALIAS_NAME.test(a.nom), `*${a.effet}.${a.nom} : hors de la règle`)
        assert.ok(!vus.has(`${a.effet}.${a.nom}`), `*${a.effet}.${a.nom} est livré deux fois`)
        vus.add(`${a.effet}.${a.nom}`)
      }
      assert.equal(vus.size, LIVRES.length)
    })

    it('chaque ligne devient un alias de l\'appli, sous son nom pointé : rien de perdu, rien de plus', () => {
      assert.deepEqual(Object.keys(fournis).sort(), LIVRES.map((a) => `${a.effet}.${a.nom}`).sort())
    })

    it('aucun alias ne porte une image ni une cible propre à une page : l\'auteur les donne à l\'usage', () => {
      const AILLEURS = ['image', 'images', 'to', 'of', 'once']
      for (const a of LIVRES) {
        const reglages = EFFECTS[a.effet].settings
        const fixes    = Object.keys(parseEffect(a.effet, a.args, [], true).fixed)
        const trouves  = fixes.filter((k) => AILLEURS.includes(k) || reglages[k]?.rule === 'image' || reglages[k]?.rule === 'images')
        assert.deepEqual(trouves, [], `*${a.effet}.${a.nom} porte ${trouves.join(', ')}`)
      }
    })
  })

  describe('les réglages de chaque alias sont figés par une empreinte qui ne vient pas du fichier', () => {
    const forme     = (nom: string) => JSON.stringify([fournis[nom].base, Object.keys(fournis[nom].fixed!).sort().map((k) => [k, fournis[nom].fixed![k]])])
    const empreinte = (nom: string) => createHash('sha256').update(forme(nom)).digest('hex').slice(0, 8)

    it('une empreinte pour chaque alias promis, et pas une de plus', () => {
      assert.deepEqual(Object.keys(EMPREINTES), Object.keys(PROMIS))
      for (const effet of Object.keys(PROMIS)) assert.equal(EMPREINTES[effet].split(' ').length, PROMIS[effet].length, effet)
    })

    for (const effet of Object.keys(PROMIS)) {
      PROMIS[effet].forEach((nom, i) => {
        it(`*${effet}.${nom} : ses réglages sont ceux de l'empreinte`, () => {
          const nommee = `${effet}.${nom}`
          assert.ok(fournis[nommee], `*${nommee} n'est pas livré`)
          assert.equal(empreinte(nommee), EMPREINTES[effet].split(' ')[i], `*${nommee} a changé de réglages (empreinte ${empreinte(nommee)}) : ${forme(nommee)}`)
        })
      })
    }
  })

  describe('chaque alias se résout comme l\'écriture en clair de l\'effet qu\'il règle', () => {
    for (const a of LIVRES) {
      it(`*${a.effet}.${a.nom}`, () => {
        const alias = withProjectEffects(fournis, () => parseEffect(`${a.effet}.${a.nom}`, '', [], true))
        const clair = parseEffect(a.effet, a.args, [], true)
        assert.deepEqual(clair.dynamic, {}, 'un alias ne tient aucun réglage par une variable')
        assert.deepEqual(alias.fixed, clair.fixed)
        assert.equal(alias.base, a.effet)
      })
    }

    it('un effet qui exige un réglage (la clé de *travel) le reçoit à l\'usage : sans lui, l\'erreur nomme l\'alias', () => {
      const exigeants = LIVRES.filter((a) => EFFECTS[a.effet].need)
      assert.ok(exigeants.length > 0)
      withProjectEffects(fournis, () => {
        for (const a of exigeants) {
          const nom = `${a.effet}.${a.nom}`
          assert.ok(EXIGE_VALEUR[EFFECTS[a.effet].need!], `le test ne sait pas donner « ${EFFECTS[a.effet].need} »`)
          assert.throws(() => parseEffect(nom, ''), (e: Error) => e.message.includes(`*${nom}`) && /manque/.test(e.message), nom)
          const donne = parseEffect(nom, exige(a.effet))
          assert.equal(donne.fixed[EFFECTS[a.effet].need!], '.cible', nom)
        }
      })
    })
  })

  describe('construits, avec l\'alias ou en clair : la même pose, le même module', () => {
    const GROUPES = ['nu', 'image'] as const
    const MODES   = ['dev', 'prod'] as const
    const construits = {} as Record<string, Awaited<ReturnType<typeof construire>>>
    const cle = (groupe: Groupe, mode: string, forme: string) => `${groupe}-${mode}-${forme}`

    before(async () => {
      for (const groupe of GROUPES) {
        for (const mode of MODES) {
          const reglages = mode === 'prod' ? { env: 'prod' } : {}
          construits[cle(groupe, mode, 'avec')] = await construire(`alias-livres-${groupe}-${mode}-avec`, composants(avec, groupe), reglages)
          construits[cle(groupe, mode, 'sans')] = await construire(`alias-livres-${groupe}-${mode}-sans`, composants(sans, groupe), reglages)
        }
      }
    })

    // les modules d'effet que la production fait importer à un composant (le nom, sans l'empreinte)
    const modules = (code: string) => [...new Set([...code.matchAll(/mjs_fx_([a-z_]+)-[a-z0-9]+\.js/g)].map((m) => m[1]))].sort()

    it('les huit constructions se font sans erreur', () => {
      assert.equal(Object.keys(construits).length, 8)
      for (const [nom, r] of Object.entries(construits)) assert.equal(r.erreurs, '', nom)
    })

    for (const groupe of GROUPES) {
      const titre = groupe === 'nu' ? '' : ', avec l\'image donnée à l\'usage'
      LIVRES.forEach((a, i) => {
        if (groupe === 'image' && !image(a.effet)) return
        const prefixe = `al${rang(i)}-`

        it(`*${a.effet}.${a.nom}${titre} : le code émis du composant est celui de *${a.effet}(${a.args})`, () => {
          const code = construits[cle(groupe, 'dev', 'avec')].unite(prefixe)
          assert.match(code, pose(a) ? new RegExp(`"${a.effet}"`) : /_mjs_fx\(/, `${prefixe} ne pose aucun effet`)
          assert.equal(code, construits[cle(groupe, 'dev', 'sans')].unite(prefixe), prefixe)
        })

        it(`*${a.effet}.${a.nom}${titre} : en production, le même composant et les mêmes modules d'effet`, () => {
          const code = construits[cle(groupe, 'prod', 'avec')].unite(prefixe)
          assert.ok(code.length > 0, `${prefixe} absent de la sortie`)
          assert.equal(code, construits[cle(groupe, 'prod', 'sans')].unite(prefixe), prefixe)
          assert.deepEqual(modules(code), modules(construits[cle(groupe, 'prod', 'sans')].unite(prefixe)), prefixe)
          assert.ok(modules(code).includes(a.effet) || EFFECTS[a.effet].transition, `*${a.effet} : son module n'est pas importé`)
        })
      })

      it(`${groupe === 'nu' ? 'tels quels' : 'avec leur image'}, en développement comme en production : les mêmes fichiers sont émis (le nom dit le contenu), cœur et modules compris`, () => {
        for (const mode of MODES) assert.deepEqual(Object.keys(construits[cle(groupe, mode, 'avec')].textes).sort(), Object.keys(construits[cle(groupe, mode, 'sans')].textes).sort(), mode)
      })
    }

    it('un chemin d\'image donné à l\'usage est publié, jamais écrit tel quel', () => {
      assert.doesNotMatch(Object.values(construits[cle('image', 'prod', 'avec')].textes).join('\n'), /["']photo\.png["']/)
      assert.match(Object.values(construits[cle('image', 'dev', 'avec')].textes).join('\n'), /photo-[0-9a-f]{8}\.png/)
    })
  })

  describe('un alias de l\'appli qui porte le nom d\'un alias de ModularJS le remplace, avec un avertissement', () => {
    it('*filter.frosted_glass : l\'effet se pose avec les réglages de l\'appli, un avertissement le dit', async () => {
      const r = await construire('alias-livres-remplace', {
        'a.effects.mjs': '<effects>\n  *filter.frosted_glass = *filter(sepia, amount: 0.5)\n</effects>',
        'c.mjs':         '<img src="a.png" alt="" *filter.frosted_glass>\n<img src="b.png" alt="" *filter.gray_spot>'
      })
      assert.equal(r.erreurs, '')
      assert.match(r.unite('c-'), /"filter", \{"style":"sepia","amount":0\.5\}\)/)
      assert.match(r.unite('c-'), /"filter", \{"style":"grayscale","spot":280\}\)/, 'un autre alias livré reste celui de ModularJS')
      const avertis = r.stats.warnings.filter((w: string) => /remplace/.test(w))
      assert.equal(avertis.length, 1, r.stats.warnings.join('\n'))
      assert.match(avertis[0], /\*filter\.frosted_glass/)
    })

    it('tous les alias livrés peuvent être remplacés : un avertissement chacun, aucune erreur', async () => {
      const effets = ['<effects>', ...LIVRES.map((a) => `  *${a.effet}.${a.nom} = *${a.effet}()`), '</effects>'].join('\n')
      const r = await construire('alias-livres-remplace-tous', { 'a.effects.mjs': effets, 'c.mjs': '<div class="a" *tilt.bounce_back>x</div>' })
      assert.equal(r.erreurs, '')
      assert.match(r.unite('c-'), /"tilt", \{\}\)/, 'le réglage de l\'appli (aucun) a remplacé celui de ModularJS')
      const avertis = r.stats.warnings.filter((w: string) => /remplace l'alias/.test(w))
      assert.equal(avertis.length, LIVRES.length, r.stats.warnings.slice(0, 5).join('\n'))
      for (const a of LIVRES) assert.ok(avertis.some((w: string) => w.includes(`*${a.effet}.${a.nom} remplace`)), `*${a.effet}.${a.nom}`)
    })
  })

  describe('un alias que ModularJS ne livre pas est refusé à la construction, avec les alias connus de l\'effet', () => {
    it('*fluid.clear (ligne 2) : aucun alias de ce nom, les quatre alias de *fluid sont cités', async () => {
      const r = await construire('alias-livres-clear', { 'c.mjs': '<p>a</p>\n<div class="a" *fluid.clear>x</div>' })
      assert.match(r.erreurs, /\[ModularJS\] \*fluid\.clear \(ligne 2\) : aucun alias de ce nom pour \*fluid — alias connus : \*fluid\.glow_rays, \*fluid\.ink_title, \*fluid\.long_trail, \*fluid\.two_colors\./)
    })
  })

  describe('la doc', () => {
    // la ligne d'un alias dans la table de « Les alias que MJS livre »
    const ligneDoc = (nom: string) => readFileSync(new URL('../docs/38-effets.md', import.meta.url), 'utf8').split('\n').find((l) => l.startsWith(`| \`*${nom}\` |`)) ?? ''

    it('*fluid.ink_title : sa ligne dit que les lettres ont la couleur du texte de la balise', () => {
      assert.match(ligneDoc('fluid.ink_title'), /les lettres ont la couleur du texte de la balise/)
    })

    it('*fluid.pure_black, retiré, et *fluid.clear ne sont pas listés', () => {
      assert.equal(ligneDoc('fluid.pure_black'), '')
      assert.equal(ligneDoc('fluid.clear'), '')
    })

    it('liste chaque alias livré, et seulement ceux-là, dans « Les alias que MJS livre »', () => {
      const doc   = readFileSync(new URL('../docs/38-effets.md', import.meta.url), 'utf8')
      const debut = doc.indexOf('#### Les alias que MJS livre')
      assert.ok(debut > 0, 'le titre « Les alias que MJS livre » manque')
      const reste = doc.slice(debut + 10)
      const fin   = reste.search(/\n#{1,4} /)
      const liste = fin < 0 ? reste : reste.slice(0, fin)
      const cites = [...new Set([...liste.matchAll(/`\*([a-z][a-z0-9-]*\.[a-z][a-z0-9_]*)`/g)].map((m) => m[1]))]
      assert.deepEqual(cites.sort(), LIVRES.map((a) => `${a.effet}.${a.nom}`).sort())
    })

    it('l\'aide-mémoire cite un alias livré qui existe', () => {
      const memo  = readFileSync(new URL('../docs/22-aide-memoire.md', import.meta.url), 'utf8')
      const ligne = memo.split('\n').find((l) => l.includes('alias d\'effet')) ?? ''
      const noms  = [...ligne.matchAll(/`\*([a-z][a-z0-9-]*\.[a-z][a-z0-9_]*)(?:\([^`]*\))?`/g)].map((m) => m[1])
      const livres = new Set(LIVRES.map((a) => `${a.effet}.${a.nom}`))
      assert.ok(noms.some((n) => livres.has(n)), `aucun alias livré dans : ${noms.join(', ')}`)
    })
  })
})
