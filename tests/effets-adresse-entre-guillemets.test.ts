// Une adresse écrite ENTRE GUILLEMETS dans les réglages d'un effet est un texte : elle n'est jamais lue comme un commentaire, même quand elle
// commence par `//` (`image: '//cdn/a.png'`, une adresse sans protocole). Chaque réglage d'image du catalogue la garde telle quelle, sur une
// balise comme dans un effet réglé d'un fichier `*.effects.mjs`, en développement comme en production. Sans guillemets, `//cdn/a.png` (un
// nom d'hôte sans point) est lu comme un commentaire et refusé : le message dit d'écrire l'adresse entre guillemets. Ce que les images
// demandent au navigateur est tenu par effets-adresse-entre-guillemets-browser.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EFFECTS, parseEffect } from '../src/effects/catalog.js'
import { parseEffectsBlock, resolveProjectEffects } from '../src/effects/project.js'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ADRESSE = '//cdn/a.png'

// la fin du message du refus : le conseil d'écrire l'adresse entre guillemets
const CONSEIL_FR = 'Si c\'est une adresse, mettez-la entre guillemets : image: \'//cdn/a.png\'.'
const CONSEIL_EN = 'If it is an address, put it between quotes: image: \'//cdn/a.png\'.'

// [effet, réglage, règle] : tous les réglages d'image du catalogue
const IMAGES: Array<[string, string, string]> = []
for (const [nom, spec] of Object.entries(EFFECTS)) {
  for (const [reglage, regle] of Object.entries(spec.settings)) {
    if (regle.rule === 'image' || regle.rule === 'images') IMAGES.push([nom, reglage, regle.rule])
  }
}

async function refus(source: string, effectDefs?: Record<string, any>): Promise<string> {
  try {
    await transpile(source, { moduleName: 'adresse', effectDefs })
  }
  catch (e) {
    return String((e as Error).message)
  }
  return assert.fail('la construction aurait dû s\'arrêter')
}

describe('une adresse entre guillemets dans les réglages d\'un effet', () => {
  it('le catalogue a des réglages d\'image (le test les relève lui-même)', () => {
    assert.ok(IMAGES.length >= 12, IMAGES.map(([e, r]) => e + '.' + r).join(' '))
    assert.ok(IMAGES.some(([e, r]) => e === 'hologram' && r === 'image'))
    assert.ok(IMAGES.some(([e, r, regle]) => e === 'scrub' && r === 'images' && regle === 'images'))
  })

  describe('chaque réglage d\'image la garde telle quelle', () => {
    for (const [effet, reglage, regle] of IMAGES) {
      it(`*${effet}(${reglage}: '${ADRESSE}')`, () => {
        const lue = regle === 'images'
          ? parseEffect(effet, `${reglage}: ['${ADRESSE}', "//cdn/b.png"]`, [], true).fixed[reglage]
          : parseEffect(effet, `${reglage}: '${ADRESSE}'`, [], true).fixed[reglage]
        assert.deepEqual(lue, regle === 'images' ? [ADRESSE, '//cdn/b.png'] : ADRESSE)
      })
    }

    it('l\'adresse d\'un serveur (`server`, une chaîne), de *cursors, *react, *follow et *heatmap', () => {
      for (const effet of ['cursors', 'react', 'follow', 'heatmap']) {
        assert.equal(parseEffect(effet, 'server: \'//cdn/ws\'', [], true).fixed.server, '//cdn/ws', effet)
        assert.equal(parseEffect(effet, 'server: "wss://exemple.fr/ws"', [], true).fixed.server, 'wss://exemple.fr/ws', effet)
      }
    })

    it('le réglage principal, écrit sans son nom : *behind(\'//cdn/a.png\'), *sprite(\'//cdn/a.png\')', () => {
      assert.equal(parseEffect('behind', `'${ADRESSE}'`, [], true).fixed.image, ADRESSE)
      assert.equal(parseEffect('sprite', `'${ADRESSE}', frames: 4`, [], true).fixed.image, ADRESSE)
    })
  })

  describe('sur une balise : l\'adresse part telle quelle dans la pose', () => {
    const POSES: Array<[string, string, RegExp]> = [
      ['hologram', '<div class="a" *hologram(rays, image: \'//cdn/a.png\', mask: "//cdn/m.png", zoom: spin, back: \'//cdn/d.png\')>x</div>', /"image":"\/\/cdn\/a\.png","mask":"\/\/cdn\/m\.png".*"back":"\/\/cdn\/d\.png"/],
      ['sprite', '<div class="a" *sprite(image: \'//cdn/a.png\', frames: 4)>x</div>', /"image":"\/\/cdn\/a\.png"/],
      ['scrub', '<canvas class="a" *scrub(images: [\'//cdn/a.png\', \'//cdn/b.png\'])></canvas>', /"images":\["\/\/cdn\/a\.png","\/\/cdn\/b\.png"\]/],
      ['gradient', '<h1 class="a" *gradient(image: \'//cdn/a.png\')>x</h1>', /"image":"\/\/cdn\/a\.png"/],
      ['behind', '<div class="a" *behind(\'//cdn/a.png\')>x</div>', /"image":"\/\/cdn\/a\.png"/],
      ['ink, en transition @in', '<script>\n  $vu = true\n</script>\n{if $vu}<p @in=*ink(image: \'//cdn/a.png\')>x</p>{end}\n', /"image":"\/\/cdn\/a\.png"/]
    ]
    for (const [effet, source, attendu] of POSES) {
      it(effet.startsWith('ink') ? effet : '*' + effet, async () => {
        const sortie = (await transpile(source, { moduleName: 'adresse' })).output
        assert.match(sortie, attendu)
      })
    }
  })

  describe('dans un effet réglé d\'un fichier *.effects.mjs', () => {
    it('l\'adresse entre guillemets est un réglage fixe de l\'effet', () => {
      const bloc  = parseEffectsBlock('*carte = *hologram(rays, image: \'//cdn/a.png\')\n*bande = *scrub(images: [\'//cdn/a.png\', "//cdn/b.png"])', 1, 'mes.effects.mjs')
      const effets = resolveProjectEffects([bloc])
      assert.equal(effets.carte.fixed!.image, ADRESSE)
      assert.deepEqual(effets.bande.fixed!.images, [ADRESSE, '//cdn/b.png'])
    })
  })

  describe('sans guillemets, un nom d\'hôte sans point est un commentaire : le refus conseille les guillemets', () => {
    afterEach(() => setMessagesLang('fr'))

    it('sur une balise, en français', async () => {
      const message = await refus('<p>un</p>\n<div class="a" *hologram(\n  rays, image: //cdn/a.png\n)>x</div>\n')
      assert.equal(message, `'adresse' : [ModularJS] *hologram (ligne 3) : « //cdn/a.png » — un commentaire ne s'écrit pas dans les réglages d'un effet : retirez-le. ${CONSEIL_FR}`)
    })

    it('sur une balise, en anglais', async () => {
      setMessagesLang('en')
      const message = await refus('<p>un</p>\n<div class="a" *hologram(\n  rays, image: //cdn/a.png\n)>x</div>\n')
      assert.equal(message, `'adresse': [ModularJS] *hologram (line 3): "//cdn/a.png" — a comment cannot be written in an effect's settings: remove it. ${CONSEIL_EN}`)
    })

    it('dans un fichier d\'effets, en français', () => {
      assert.throws(() => parseEffectsBlock('*carte = *hologram(rays, image: //cdn/a.png)', 1, 'mes.effects.mjs'),
        { message: `[ModularJS] mes.effects.mjs (ligne 1) : *carte — « //cdn/a.png » : un commentaire ne s'écrit pas dans les réglages d'un effet : retirez-le. ${CONSEIL_FR}` })
    })

    it('dans un fichier d\'effets, en anglais', () => {
      setMessagesLang('en')
      assert.throws(() => parseEffectsBlock('*carte = *hologram(rays, image: //cdn/a.png)', 1, 'mes.effects.mjs'),
        { message: `[ModularJS] mes.effects.mjs (line 1): *carte — "//cdn/a.png": a comment cannot be written in an effect's settings: remove it. ${CONSEIL_EN}` })
    })

    it('le même réglage entre guillemets se construit', async () => {
      const sortie = (await transpile('<p>un</p>\n<div class="a" *hologram(\n  rays, image: \'//cdn/a.png\'\n)>x</div>\n', { moduleName: 'adresse' })).output
      assert.match(sortie, /"image":"\/\/cdn\/a\.png"/)
    })
  })

  describe('en production, le code publié garde l\'adresse', function () {
    this.timeout(120000)
    let dev  = ''
    let prod = ''

    const SOURCES: Record<string, string> = {
      'app.effects.mjs': '<effects>\n  *carte-fond = *hologram(rays, image: \'//cdn/alias.png\')\n</effects>\n',
      'ad-page.mjs': [
        '<div class="a" *hologram(rays, image: \'//cdn/holo.png\', mask: \'//cdn/masque.png\', zoom: spin, back: \'//cdn/dos.png\')>x</div>',
        '<div class="b" *sprite(image: \'//cdn/sprite.png\', frames: 4)></div>',
        '<canvas class="c" *scrub(images: [\'//cdn/s1.png\', \'//cdn/s2.png\'])></canvas>',
        '<h1 class="d" *gradient(image: \'//cdn/gradient.png\')>x</h1>',
        '<div class="e" *carte-fond>x</div>'
      ].join('\n') + '\n'
    }

    async function construire(env: 'dev' | 'prod'): Promise<string> {
      const root   = mjsTmp('effets-adresse-' + env)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      for (const [fichier, texte] of Object.entries(SOURCES)) writeFileSync(join(srcDir, fichier), texte)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      return readdirSync(outDir).filter((f) => f.endsWith('.js')).sort().map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
    }

    before(async () => {
      dev  = await construire('dev')
      prod = await construire('prod')
    })

    after(async () => { await terminateSharedWorkerPool() })

    for (const adresse of ['holo', 'masque', 'dos', 'sprite', 's1', 's2', 'gradient', 'alias']) {
      it(`//cdn/${adresse}.png`, () => {
        assert.ok(dev.includes(`"//cdn/${adresse}.png"`), 'développement')
        assert.ok(prod.includes(`"//cdn/${adresse}.png"`) || prod.includes(`'//cdn/${adresse}.png'`), 'production')
      })
    }
  })
})
