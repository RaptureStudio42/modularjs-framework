// *hologram, l'avertissement du développement — image, mask et back ne servent qu'aux styles de carte : posés sur un style
// simple (rainbow, le défaut, foil, galaxy, prism, gold), ils sont ignorés et aucune image n'est chargée. La console le dit,
// une fois par balise, dans la langue de la page, en développement seulement : la production ne porte ni le code ni le texte.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'

const IMAGES = '*hologram(rainbow, image: \'/i/motif.webp\', mask: \'/i/masque.webp\', back: \'/i/dos.webp\')'

const COMPOSANTS: Record<string, string> = {
  'ha-images':   `<div class="a" ${IMAGES}>x</div>`,
  'ha-defaut':   '<div class="a" *hologram(image: \'/i/motif.webp\')>x</div>',
  'ha-masque':   '<div class="a" *hologram(foil, mask: \'/i/masque.webp\')>x</div>',
  'ha-dos':      '<div class="a" *hologram(gold, back: \'/i/dos.webp\')>x</div>',
  'ha-nu':       '<div class="a" *hologram(rainbow)>x</div><div class="b" *hologram(prism, colors: [#f00, #0f0], strength: 0.5)>x</div>',
  'ha-carte':    '<div class="a" *hologram(rays, image: \'/i/motif.webp\', mask: \'/i/masque.webp\', back: \'/i/dos.webp\', zoom: spin)>x</div>',
  'ha-deux':     '<div class="a" *hologram(rainbow, image: \'/i/motif.webp\')>x</div><div class="b" *hologram(galaxy, image: \'/i/motif.webp\')>x</div>',
  'ha-variable': '<script>\n$style = \'rays\'\n</script>\n<div class="a" *hologram(style: $style, image: \'/i/motif.webp\', mask: \'/i/masque.webp\')>x</div><button class="t" @click={$style = \'foil\'}>t</button>'
}

const texte = (style: string) => `[ModularJS] *hologram : image, mask et back ne servent qu'aux styles de carte ; avec le style « ${style} », ils sont ignorés et aucune image n'est chargée`
const text  = (style: string) => `[ModularJS] *hologram: image, mask and back only apply to card styles; with the style "${style}", they are ignored and no image is loaded`

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))

describe('effets — *hologram, l\'avertissement du développement', function () {
  this.timeout(60000)
  const fenetres: any[] = []
  let code     = ''
  let libelles = ''

  before(async () => {
    const root   = mjsTmp('effets-hologramme-avertissement')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    code     = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    libelles = libellesDuManifeste(join(root, 'bundle.js'))
  })

  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  // une page chargée comme le navigateur la lit (le cœur, l'effet, le composant, puis les libellés du manifeste) ; la console est espionnée
  function page(lang = '') {
    const window: any = new Window({ url: 'http://localhost/' })
    if (lang) window.document.documentElement.setAttribute('lang', lang)
    fenetres.push(window)
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.eval(libelles)
    window.requestAnimationFrame = () => 0
    window.cancelAnimationFrame  = () => {}
    const recus: Array<{ texte: string, balise: any }> = []
    window.µ.warn = (...a: any[]) => { recus.push({ texte: String(a[0]), balise: a[1] }) }
    return { window, recus }
  }

  async function monter(window: any, tag: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector('.a'))
    await pause(60)
    return comp
  }

  it('un style simple qui reçoit image, mask et back : la console le dit, une fois, avec le nom du style et la balise', async () => {
    const { window, recus } = page()
    const comp = await monter(window, 'mjs-ha-images')
    assert.deepEqual(recus.map((r) => r.texte), [texte('rainbow')])
    assert.ok(recus[0].balise === comp._shadow.querySelector('.a'), 'la balise fautive est donnée à la console')
  })

  it('le style par défaut (rainbow) est un style simple : image seule suffit', async () => {
    const { window, recus } = page()
    await monter(window, 'mjs-ha-defaut')
    assert.deepEqual(recus.map((r) => r.texte), [texte('rainbow')])
  })

  it('mask seul, back seul : chacun suffit, le style simple écrit est nommé', async () => {
    const un = page()
    await monter(un.window, 'mjs-ha-masque')
    assert.deepEqual(un.recus.map((r) => r.texte), [texte('foil')])
    const deux = page()
    await monter(deux.window, 'mjs-ha-dos')
    assert.deepEqual(deux.recus.map((r) => r.texte), [texte('gold')])
  })

  it('un style simple sans image, mask ni back : rien à dire', async () => {
    const { window, recus } = page()
    await monter(window, 'mjs-ha-nu')
    assert.deepEqual(recus.map((r) => r.texte), [])
  })

  it('un style de carte qui les emploie : rien à dire', async () => {
    const { window, recus } = page()
    await monter(window, 'mjs-ha-carte')
    assert.deepEqual(recus.map((r) => r.texte), [])
  })

  it('deux balises fautives : un avertissement chacune, avec son style', async () => {
    const { window, recus } = page()
    const comp = await monter(window, 'mjs-ha-deux')
    assert.deepEqual(recus.map((r) => r.texte), [texte('rainbow'), texte('galaxy')])
    assert.ok(recus[0].balise === comp._shadow.querySelector('.a'), 'la première balise fautive est donnée à la console')
    assert.ok(recus[1].balise === comp._shadow.querySelector('.b'), 'la seconde balise fautive est donnée à la console')
  })

  it('un style tenu par une variable : rien tant que c\'est un style de carte, l\'avertissement quand il devient simple, une seule fois', async () => {
    const { window, recus } = page()
    const comp = await monter(window, 'mjs-ha-variable')
    assert.deepEqual(recus.map((r) => r.texte), [], 'rays emploie image et mask')
    comp._shadow.querySelector('.t').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await attendre(() => recus.length > 0, 1500)
    await pause(100)
    assert.deepEqual(recus.map((r) => r.texte), [texte('foil')])
  })

  it('en anglais, la console parle anglais', async () => {
    const { window, recus } = page('en')
    await monter(window, 'mjs-ha-images')
    assert.deepEqual(recus.map((r) => r.texte), [text('rainbow')])
  })
})

// ---- développement et production ----

const AVIS   = 'hologramImages'
const TEXTES = ['image, mask et back ne servent qu\'aux styles de carte', 'image, mask and back only apply to card styles']

describe('effets — *hologram, l\'avertissement du développement ne part pas en production', function () {
  this.timeout(600000)
  after(async () => { await terminateSharedWorkerPool() })

  // un build RÉEL : tout ce qu'il écrit (les .js, les catalogues de messages .json, le manifeste), le code lisible ou minifié
  async function construire(nom: string, source: string, env: 'dev' | 'prod', minify: boolean): Promise<string> {
    const root   = mjsTmp('hologram-avis-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'p.mjs'), source)
    const options: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify }
    if (env === 'prod') options.env = 'prod'
    const bundler = new Bundler(options)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js') || f.endsWith('.json')).map((f) => readFileSync(join(outDir, f), 'utf-8'))
    if (existsSync(join(root, 'bundle.js'))) fichiers.push(readFileSync(join(root, 'bundle.js'), 'utf-8'))
    return fichiers.join('\n')
  }

  const PAGES: Array<[string, string]> = [
    ['un style simple avec ses images', `<div class="a" ${IMAGES}>x</div>`],
    ['un style de carte', '<div class="a" *hologram(rays, image: \'/i/motif.webp\', zone: inset(10% 8% 53% 8%))>x</div>'],
    ['un style tenu par une variable', COMPOSANTS['ha-variable']],
    ['deux poses', COMPOSANTS['ha-deux']]
  ]

  for (const minify of [false, true]) {
    for (const [nom, source] of PAGES) {
      it(`production ${minify ? 'minifiée' : 'lisible'}, ${nom} : ni l'appel, ni la clé, ni le texte, en aucune langue`, async () => {
        const sortie = await construire(`prod-${minify}-${nom.replace(/\W+/g, '-')}`, source, 'prod', minify)
        assert.ok(sortie.includes('mjs-fx-hologram'), 'témoin : l\'effet est bien dans la sortie')
        assert.equal(sortie.includes(AVIS), false, 'la clé du message est du développement')
        for (const t of TEXTES) assert.equal(sortie.includes(t), false, `« ${t}… » est du développement : ni les .js, ni le manifeste, ni les catalogues de messages de la production ne le portent`)
      })
    }
  }

  it('le développement envoie le fichier en entier : l\'appel et le texte, dans les deux langues', async () => {
    const sortie = await construire('dev', `<div class="a" ${IMAGES}>x</div>`, 'dev', false)
    assert.ok(sortie.includes('µ._mjs_msg(\'dev.' + AVIS + '\''), 'l\'appel')
    for (const t of TEXTES) assert.ok(sortie.includes(t), `développement : le texte « ${t}… » est au manifeste`)
  })
})
