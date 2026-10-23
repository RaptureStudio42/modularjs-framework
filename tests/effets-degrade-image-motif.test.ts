// *gradient remplit les lettres (ou la balise) d'un fond qui défile : un dégradé, une image ou un motif — *knockout et
// *texture y sont fondus. Leurs écritures d'avant arrêtent la construction sur un message qui donne la nouvelle (en
// français et en anglais) ; *gradient.knockout et *gradient.texture posent les variables mêmes des anciens effets par
// défaut ; une valeur écrite sans nom va à l'image quand c'en est une, au motif quand c'en est un, aux couleurs sinon ;
// *gradient sans image ni motif pose ce qu'il posait.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { DETECTED_CORE_MODULES } from '../src/bundler/config.js'
import { parseEffect, localImages, withProjectEffects, EFFECTS } from '../src/effects/catalog.js'
import { resolveProjectEffects } from '../src/effects/project.js'
import { setMessagesLang } from '../src/messages/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const ICI = dirname(fileURLToPath(import.meta.url))

// un PNG de 1 × 1 : la photo que l'auteur donne à l'usage
const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const COMPOSANTS: Record<string, string> = {
  'dg-nu':       '<h1 class="a" *gradient>TEXTE</h1>',
  'dg-knockout': '<h1 class="a" *gradient.knockout>TEXTE</h1>',
  'dg-photo':    "<h1 class=\"a\" *gradient.knockout('photo.png')>TEXTE</h1>",
  'dg-texture':  '<h1 class="a" *gradient.texture>TEXTE</h1>',
  'dg-pois':     '<h1 class="a" *gradient.texture(dots)>TEXTE</h1>',
  'dg-damier':   '<h1 class="a" *gradient(pattern: checks, colors: [#000, #fff], angle: 90)>TEXTE</h1>',
  'dg-contour':  '<h1 class="a" *gradient(outline: #fff, width: 2)>TEXTE</h1>',
  'dg-taille':   '<h1 class="a" *gradient(size: 150, direction: up)>TEXTE</h1>',
  'dg-retrait':  "<script>\n$on = true\n</script>\n{if $on}<h1 class=\"a\" *gradient.knockout(image: '/photo.png', outline: #fff, width: 2)>TEXTE</h1>{end}\n<button class=\"t\" @click={$on = !$on}>t</button>",
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets — *gradient : un dégradé, une image ou un motif dans les lettres (*knockout et *texture y sont fondus)', function () {
  this.timeout(120000)
  let window: any
  let code = ''
  let fournis: ReturnType<typeof resolveProjectEffects>

  before(async () => {
    fournis = resolveProjectEffects([])
    const root   = mjsTmp('effets-degrade-image-motif')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'photo.png'), PHOTO)
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    code = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  afterEach(() => setMessagesLang('fr'))

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector('.a'))
    await pause()
    return comp._shadow.querySelector('.a')
  }

  const v = (el: any, nom: string) => el.style.getPropertyValue(nom)

  describe('les anciens effets', () => {
    it('le catalogue ne connaît plus *knockout ni *texture, ni leurs modules d\'exécution', () => {
      assert.ok(!('knockout' in EFFECTS), 'plus de ligne `knockout` dans EFFECTS')
      assert.ok(!('texture' in EFFECTS), 'plus de ligne `texture` dans EFFECTS')
      assert.ok(!existsSync(join(ICI, '../src/runtime/mjs_fx_knockout.ts')), 'plus de module mjs_fx_knockout')
      assert.ok(!existsSync(join(ICI, '../src/runtime/mjs_fx_texture.ts')), 'plus de module mjs_fx_texture')
      assert.ok(!(DETECTED_CORE_MODULES as readonly string[]).includes('fx_knockout'), 'fx_knockout hors des modules du cœur')
      assert.ok(!(DETECTED_CORE_MODULES as readonly string[]).includes('fx_texture'), 'fx_texture hors des modules du cœur')
    })

    it('*knockout et *texture, avec ou sans réglages : la construction s\'arrête, le message donne le nouveau nom', async () => {
      const cas: Array<[string, string]> = [
        ['<h1 *knockout>x</h1>', 'gradient.knockout'],
        ["<h1 *knockout('photo.png', size: 300)>x</h1>", 'gradient.knockout'],
        ['<h1 *texture>x</h1>', 'gradient.texture'],
        ['<h1 *texture(dots, speed: 2s)>x</h1>', 'gradient.texture']
      ]
      for (const [balise, nouveau] of cas) {
        await assert.rejects(transpile(balise, { moduleName: 'dg-ancien' }), (e: Error) => {
          assert.match(e.message, new RegExp(`\\*${balise.slice(5).split(/[(>]/)[0]} n'existe plus : il fait désormais partie d'un autre effet — écrivez \\*${nouveau.replace('.', '\\.')}`), balise)
          return true
        })
      }
    })

    it('sur <@document> : le même message', async () => {
      const { data } = await transpile('<@document *texture(waves)></@document>\n<p>x</p>\n', { moduleName: 'dg-ancien-doc' })
      assert.equal(data.macroErrors.length, 1, JSON.stringify(data.macroErrors))
      assert.match(data.macroErrors[0], /\*texture n'existe plus : il fait désormais partie d'un autre effet — écrivez \*gradient\.texture\(pattern: waves\), où vos réglages sont traduits \(correspondance des réglages : style → pattern\)/)
    })

    it('en anglais, et le message vouvoie ou ne s\'adresse à personne', () => {
      setMessagesLang('en')
      assert.throws(() => parseEffect('knockout', ''), /\*knockout no longer exists: it is now part of another effect — write \*gradient\.knockout, which renders the same/)
      assert.throws(() => parseEffect('texture', 'dots'), /\*texture no longer exists: it is now part of another effect — write \*gradient\.texture\(pattern: dots\), with the settings translated \(settings correspondence: style → pattern\)/)
      for (const lang of ['fr', 'en'] as const) {
        setMessagesLang(lang)
        for (const nom of ['knockout', 'texture']) assert.throws(() => parseEffect(nom, ''), (e: Error) => !/\b(tu|ton|ta|tes|toi|your)\b/i.test(e.message))
      }
    })

    it('*gradient.texture(style: dots) : `style` est devenu `pattern`, le message le dit', () => {
      withProjectEffects(fournis, () => {
        assert.throws(() => parseEffect('gradient.texture', 'style: dots'), /« style » a été remplacé — à la place : pattern/)
      })
    })
  })

  describe('une valeur écrite sans nom', () => {
    const fixe = (raw: string) => parseEffect('gradient', raw).fixed

    it('une image (chemin, adresse, url(…), data:, ce que µimage laisse au build) va à `image`', () => {
      assert.deepEqual(fixe("'photo.jpg'"), { image: 'photo.jpg' })
      assert.deepEqual(fixe('img/photo.webp'), { image: 'img/photo.webp' })
      assert.deepEqual(fixe("'https://exemple.test/a.png?v=2'"), { image: 'https://exemple.test/a.png?v=2' })
      assert.deepEqual(fixe('url(a.png)'), { image: 'url(a.png)' })
      assert.deepEqual(fixe("'data:image/png;base64,AAAA'"), { image: 'data:image/png;base64,AAAA' })
      assert.deepEqual(fixe('{"src":"/assets/m-abc.png"}'), { image: '/assets/m-abc.png' })
    })

    it('un mot de motif va à `pattern` ; des couleurs, une couleur, une variable restent aux couleurs', () => {
      assert.deepEqual(fixe('dots'), { pattern: 'dots' })
      assert.deepEqual(fixe('[#f00, #0f0]'), { colors: ['#f00', '#0f0'] })
      assert.deepEqual(fixe('#f00'), { colors: ['#f00'] })
      assert.deepEqual(parseEffect('gradient', '$couleurs').dynamic, { colors: '$couleurs' })
    })

    it('*gradient.knockout(\'photo.jpg\') : l\'image s\'ajoute aux réglages du préréglage, et le build la voit comme une image', () => {
      withProjectEffects(fournis, () => {
        const r = parseEffect('gradient.knockout', "'photo.jpg'")
        assert.equal(r.fixed.image, 'photo.jpg')
        assert.equal(r.fixed.size, 200)
        assert.equal(r.base, 'gradient')
        assert.deepEqual(localImages('gradient.knockout', "'photo.jpg'"), [{ key: 'image', path: 'photo.jpg', start: 0, end: 11 }])
      })
    })

    it('le chemin donné au préréglage est publié, jamais écrit tel quel', () => {
      assert.match(code, /"image":"\/[\w/-]*photo-[0-9a-f]{8}\.png"/)
      assert.doesNotMatch(code, /"image":"photo\.png"/)
    })
  })

  describe('posé dans une page', () => {
    it('*gradient seul : le dégradé d\'avant (deux tours de couleurs, image trois fois plus grande que la balise)', async () => {
      const el = await monter('mjs-dg-nu')
      assert.equal(el.getAttribute('mjs-fx'), 'gradient')
      assert.equal(v(el, '--mjs-fx-gradient'), 'linear-gradient(90deg,#22d3ee,#ff4fa3,#facc15,#22d3ee,#ff4fa3,#facc15,#22d3ee)')
      assert.equal(v(el, '--mjs-fx-gradient-from'), '75% 0%')
      assert.equal(v(el, '--mjs-fx-gradient-to'), '0% 0%')
      assert.equal(v(el, '--mjs-fx-gradient-size'), '', 'la taille par défaut du CSS : 300 % 300 %')
      assert.match(window.µ._mjs_fxDefs.gradient.css, /background-size:var\(--mjs-fx-gradient-size,300% 300%\)/)
    })

    it('*gradient.knockout : le dégradé de *knockout par défaut (une tuile de 200 %, qui boucle vers la gauche en 15 s)', async () => {
      const el = await monter('mjs-dg-knockout')
      assert.equal(v(el, '--mjs-fx-gradient'), 'linear-gradient(90deg,#ff4fa3,#7c3aed,#22d3ee,#ff4fa3)')
      assert.equal(v(el, '--mjs-fx-gradient-size'), '200% 100%')
      assert.equal(v(el, '--mjs-fx-gradient-from'), '0% 0%')
      assert.equal(v(el, '--mjs-fx-gradient-to'), '200% 0%')
      assert.equal(v(el, '--mjs-gradient-speed'), '15s')
      assert.equal(el.getAttribute('mjs-fx-gradient-flow'), null, 'une boucle, pas un va-et-vient')
    })

    it('*gradient.knockout(\'photo.png\') : l\'image publiée en fond, qui va et vient', async () => {
      const el = await monter('mjs-dg-photo')
      assert.match(v(el, '--mjs-fx-gradient'), /^url\("\/[\w/-]*photo-[0-9a-f]{8}\.png"\)$/)
      assert.equal(v(el, '--mjs-fx-gradient-size'), '200% auto')
      assert.equal(el.getAttribute('mjs-fx-gradient-flow'), 'swing')
      assert.equal(v(el, '--mjs-fx-gradient-from'), '0% 50%')
      assert.equal(v(el, '--mjs-fx-gradient-to'), '100% 50%')
      assert.equal(v(el, '--mjs-fx-gradient-way'), 'alternate')
    })

    it('*gradient.texture : les rayures de *texture par défaut (45°, trois couleurs, en 6 s)', async () => {
      const el = await monter('mjs-dg-texture')
      assert.equal(v(el, '--mjs-fx-gradient'), 'repeating-linear-gradient(45deg,#ff4fa3 0px 6px,#7c3aed 6px 12px,#22d3ee 12px 18px)')
      assert.equal(v(el, '--mjs-fx-gradient-size'), '25.456px 25.456px')
      assert.equal(v(el, '--mjs-fx-gradient-from'), '0px 0px')
      assert.equal(v(el, '--mjs-fx-gradient-to'), '178.191px 0px')
      assert.equal(v(el, '--mjs-gradient-speed'), '6s')
    })

    it('*gradient.texture(dots) : le mot sans nom choisit le motif, les autres réglages restent ceux du préréglage', async () => {
      const el = await monter('mjs-dg-pois')
      assert.equal(v(el, '--mjs-fx-gradient'), 'radial-gradient(circle,#ff4fa3 0 3px,transparent 3.5px),radial-gradient(circle,#7c3aed 0 3px,transparent 3.5px),linear-gradient(#22d3ee,#22d3ee)')
      assert.equal(v(el, '--mjs-fx-gradient-size'), '14px 14px,14px 14px,100% 100%')
      assert.equal(v(el, '--mjs-fx-gradient-to'), '126px -126px,133px -119px,0px 0px')
    })

    it('*gradient(pattern: checks, angle: 90) : un damier qui avance vers la droite', async () => {
      const el = await monter('mjs-dg-damier')
      assert.equal(v(el, '--mjs-fx-gradient'), 'conic-gradient(#000 25%,#fff 0 50%,#000 0 75%,#fff 0)')
      assert.equal(v(el, '--mjs-fx-gradient-size'), '16px 16px')
      assert.equal(v(el, '--mjs-fx-gradient-to'), '128px 0px')
    })

    it('*gradient(outline, width) : le contour des lettres, sur le dégradé d\'avant', async () => {
      const el = await monter('mjs-dg-contour')
      assert.equal(v(el, '--mjs-gradient-outline'), '#fff')
      assert.equal(v(el, '--mjs-gradient-width'), '2px')
      assert.equal(v(el, '--mjs-fx-gradient-from'), '75% 0%')
      assert.match(window.µ._mjs_fxDefs.gradient.css, /-webkit-text-stroke:var\(--mjs-gradient-width,0px\) var\(--mjs-gradient-outline,currentColor\)/)
    })

    it('*gradient(size: 150, direction: up) : une tuile de 150 % qui boucle vers le haut, bandes perpendiculaires au défilé', async () => {
      const el = await monter('mjs-dg-taille')
      assert.equal(v(el, '--mjs-fx-gradient'), 'linear-gradient(0deg,#22d3ee,#ff4fa3,#facc15,#22d3ee)')
      assert.equal(v(el, '--mjs-fx-gradient-size'), '100% 150%')
      assert.equal(v(el, '--mjs-fx-gradient-from'), '0% 0%')
      assert.equal(v(el, '--mjs-fx-gradient-to'), '0% 300%')
    })

    it('le retrait rend la balise comme avant (image, contour, va-et-vient)', async () => {
      const comp = window.document.body.appendChild(window.document.createElement('mjs-dg-retrait'))
      await attendre(() => !!comp._shadow?.querySelector('.a'))
      await pause()
      const el = comp._shadow.querySelector('.a')
      assert.equal(el.getAttribute('mjs-fx'), 'gradient')
      assert.equal(el.getAttribute('mjs-fx-gradient-flow'), 'swing')
      comp._shadow.querySelector('.t').click()
      await attendre(() => !comp._shadow.querySelector('.a'))
      await pause(50)
      assert.equal(el.getAttribute('mjs-fx'), null, 'marque restée')
      assert.equal(el.getAttribute('mjs-fx-gradient-flow'), null)
      assert.equal(el.getAttribute('style') || '', '', 'variables restées')
    })
  })
})
