// *loader(vortex) — un style de plus : vingt points qui tournent d'un tour en se rapprochant du centre.
// Le dessin et ses réglages se prouvent ici (happy-dom : la structure, les variables, le CSS écrit) ; le
// mouvement lui-même — rotation, orbite qui se resserre, flou qui se résorbe — se mesure dans Chromium et
// Firefox (effets-loader-vortex-browser.test.ts). Les autres styles ne bougent pas : la structure de chacun,
// et sa taille d'origine, restent celles d'avant.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { EFFECTS } from '../src/effects/catalog.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const STYLES = ['dots', 'steps', 'plus', 'neon', 'trio', '3d', 'bloom', 'spiral', 'galaxy', 'cross']
// les balises de chaque style d'avant : leur nombre ne change pas
const PARTIES: Record<string, number> = { steps: 2, plus: 5, neon: 6, dots: 20, trio: 6, '3d': 3, bloom: 84, spiral: 21, galaxy: 84, cross: 84 }
const ORIGINE: Record<string, number> = { steps: 320, plus: 450, neon: 200, dots: 300, trio: 240, '3d': 300, bloom: 620, spiral: 460, galaxy: 460, cross: 640 }

const COMPOSANTS: Record<string, string> = {
  'fx-vx':        '<span class="d" *loader(vortex)></span>\n<span class="g" *loader(vortex, size: 240, speed: 8s, color: #ff5fa2)></span>\n<span class="p" *loader></span>\n<span class="b" *loader(bloom)></span>',
  'fx-vx-tous':   STYLES.map((s) => `<span class="s-${s}" *loader(${s})></span>`).join('\n'),
  'fx-vx-retrait': '<script>\n$on = true\n</script>\n{if $on}<span class="v" *loader(vortex)></span>{end}\n<button class="t" @click={$on = !$on}>t</button>',
  'fx-vx-etat':   '<script>\n$c = \'#ff5fa2\'\n$v = \'8s\'\n</script>\n<span class="v" *loader(vortex, color: $c, speed: $v)></span>\n<button class="k" @click={$c = \'#ffa657\'}>k</button>'
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('*loader(vortex) — le catalogue', () => {
  it('vortex rejoint la liste des styles, après cross ; le style par défaut et les autres réglages ne bougent pas', () => {
    const l = EFFECTS.loader
    assert.equal(l.settings.style.dflt, 'dots')
    assert.ok(l.settings.style.rule.endsWith("'cross' | 'vortex'"), l.settings.style.rule)
    for (const s of [...STYLES, 'vortex']) assert.ok(l.settings.style.rule.includes(`'${s}'`), `style ${s}`)
    assert.deepEqual(Object.keys(l.settings), ['style', 'color', 'color2', 'size', 'speed'])
    assert.equal(l.main, 'style')
    assert.equal(l.settings.size.rule, 'int 16..600')
    assert.equal(l.settings.size.dflt, 96)
    assert.equal(l.settings.color2.dflt, '#e91e63')
  })

  it('se compile ; un style inconnu est refusé et la liste permise nomme vortex', async () => {
    const ok = await transpile('<span *loader(vortex)></span>', { moduleName: 'fx-essai' })
    assert.ok(/"loader"/.test(ok.output), 'l\'effet est posé')
    await assert.rejects(transpile('<span *loader(tourbillon)></span>', { moduleName: 'fx-essai' }), /tourbillon[\s\S]*'vortex'/)
  })
})

describe('*loader(vortex) — le dessin dans un composant', function () {
  this.timeout(90000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-loader-vortex')
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
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string, pret: string): Promise<any> {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(pret))
    return comp
  }

  const calque = (comp: any, sel: string) => comp._shadow.querySelector(`${sel} [mjs-fx-layer="loader"]`)

  it('vortex : vingt points numérotés de 1 à 20, dans une boîte de 400 px réduite à la taille demandée (96 px par défaut)', async () => {
    const comp = await monter('mjs-fx-vx', '.d [mjs-fx-layer="loader"]')
    const c    = calque(comp, '.d')
    assert.equal(c.getAttribute('mjs-fx-loader-style'), 'vortex')
    assert.equal(c.querySelector('[mjs-fx-loader-box]').getAttribute('aria-hidden'), 'true', 'le dessin reste muet')
    assert.equal(c.style.width, '96px')
    const boite = c.querySelector('[mjs-fx-loader-box]')
    assert.equal(boite.style.width, '400px')
    assert.equal(boite.style.transform, 'scale(0.2400)')
    const points = [...c.querySelectorAll('[mjs-fx-p]')]
    assert.equal(points.length, 20)
    assert.ok(points.every((p: any) => p.getAttribute('mjs-fx-p') === 'dot'), 'des points, rien d\'autre')
    assert.deepEqual(points.map((p: any) => p.style.getPropertyValue('--i')), Array.from({ length: 20 }, (_, i) => String(i + 1)))
    // tout le mouvement est dans le CSS : aucune animation, aucun délai posés balise par balise
    assert.ok(points.every((p: any) => !p.style.animation && !p.style.animationDelay && !p.style.transform), 'rien en ligne')
    assert.equal(comp._shadow.querySelector('.d').getAttribute('role'), 'status')
  })

  it('size, speed et color se règlent : 240 px, cycle de 8 s, couleur écrite — par les variables de l\'effet, sans toucher au dessin', async () => {
    const comp = await monter('mjs-fx-vx', '.g [mjs-fx-layer="loader"]')
    const c    = calque(comp, '.g')
    assert.equal(c.style.width, '240px')
    assert.equal(c.querySelector('[mjs-fx-loader-box]').style.transform, 'scale(0.6000)')
    assert.equal(c.querySelectorAll('[mjs-fx-p]').length, 20, 'toujours vingt points')
    const hote = comp._shadow.querySelector('.g')
    assert.equal(hote.style.getPropertyValue('--mjs-loader-color'), '#ff5fa2')
    assert.equal(hote.style.getPropertyValue('--mjs-loader-speed'), '8s')
  })

  it('les réglages tenus par une variable suivent sans reposer le dessin', async () => {
    const comp = await monter('mjs-fx-vx-etat', '.v [mjs-fx-layer="loader"]')
    const c    = calque(comp, '.v')
    comp._shadow.querySelector('.k').click()
    await attendre(() => comp._shadow.querySelector('.v').style.getPropertyValue('--mjs-loader-color') === '#ffa657')
    assert.equal(comp._shadow.querySelector('.v').style.getPropertyValue('--mjs-loader-color'), '#ffa657')
    assert.ok(calque(comp, '.v') === c, 'le même dessin')
    assert.equal(c.querySelectorAll('[mjs-fx-p]').length, 20)
  })

  it('le CSS : le mouvement et le croisement du flou et du net ne touchent que transform et opacity ; un tour, l\'échelle 3 puis 0.5, flou fixe de 3 px puis net', () => {
    const css: string = window.µ._mjs_fxDefs.loader.css
    const blocs = [...css.matchAll(/@keyframes mjs-fx-loader-vortex\{([\s\S]*?\}\})/g)]
    assert.equal(blocs.length, 1)
    const k = blocs[0][1]
    const proprietes = new Set([...k.matchAll(/([a-z-]+):/g)].map((m) => m[1]))
    assert.deepEqual([...proprietes].sort(), ['opacity', 'transform'], 'par image, seulement ce que la carte graphique sait faire : aucun filtre animé')
    assert.ok(k.includes('0%{transform:rotate(0deg) scale(3);opacity:0}'), 'départ : grand, transparent')
    assert.ok(k.includes('50%{opacity:1}'), 'à mi-course : opaque')
    assert.ok(k.includes('100%{transform:rotate(360deg) scale(.5);opacity:0}'), 'arrivée : un tour de plus, petit, effacé')
    // le flou fixe s'efface, le net apparaît, pendant la première moitié du cycle : la somme des deux opacités vaut 1
    assert.ok(css.includes('@keyframes mjs-fx-loader-vortex-soft{0%{opacity:1}50%,100%{opacity:0}}'), 'le disque flou s\'efface')
    assert.ok(css.includes('@keyframes mjs-fx-loader-vortex-sharp{0%{opacity:0}50%,100%{opacity:1}}'), 'le disque net apparaît')
    assert.ok(css.includes('[mjs-fx-p="dot"]::before{filter:blur(3px);animation:mjs-fx-loader-vortex-soft'), 'le flou est fixe, porté par le premier disque')
    assert.ok(css.includes('[mjs-fx-p="dot"]::after{mix-blend-mode:plus-lighter;animation:mjs-fx-loader-vortex-sharp'), 'le disque net s\'additionne au flou')
    assert.ok(css.includes('[mjs-fx-loader-style="vortex"]{--mjs-fx-loader-c:var(--mjs-loader-color,#25e2bc);--mjs-fx-loader-t:var(--mjs-loader-speed,4s)}'), 'couleur et cycle du style')
    assert.ok(css.includes('animation:mjs-fx-loader-vortex var(--mjs-fx-loader-t) linear calc(var(--mjs-fx-loader-t) * -.05 * var(--i)) infinite'), 'un vingtième de cycle d\'écart par point')
    assert.ok(css.includes('transform-origin:-35px 15px'), 'le point tourne autour du centre du dessin')
    // l'animation est mise en pause, pas supprimée, sous « réduire les animations »
    assert.ok(css.includes('@media (prefers-reduced-motion:reduce){[mjs-fx-layer="loader"] [mjs-fx-p]{animation-play-state:paused}'))
    // et par une règle aussi précise que celle de son `animation:` (sans quoi elle ne gagnerait pas), pour le point et ses deux disques, la dernière du CSS
    const calme = css.slice(css.indexOf('@media (prefers-reduced-motion:reduce)'))
    assert.ok(calme.endsWith('[mjs-fx-layer="loader"][mjs-fx-loader-style="vortex"] [mjs-fx-p="dot"]{animation-play-state:paused}[mjs-fx-layer="loader"][mjs-fx-loader-style="vortex"] [mjs-fx-p="dot"]::before,[mjs-fx-layer="loader"][mjs-fx-loader-style="vortex"] [mjs-fx-p="dot"]::after{animation-play-state:paused}}'), calme.slice(-260))
  })

  it('les douze styles d\'avant : mêmes balises, même taille d\'origine', async () => {
    const comp = await monter('mjs-fx-vx-tous', '.s-cross [mjs-fx-layer="loader"]')
    for (const s of STYLES) {
      const c = calque(comp, `.s-${s}`)
      assert.equal(c.getAttribute('mjs-fx-loader-style'), s)
      assert.equal(c.querySelectorAll('[mjs-fx-p]').length, PARTIES[s], `${s} : ses balises`)
      assert.equal(c.querySelector('[mjs-fx-loader-box]').style.width, ORIGINE[s] + 'px', `${s} : sa taille d'origine`)
    }
  })

  it('retiré ({if} refermé) : ni dessin, ni rôle, ni variable', async () => {
    const comp = await monter('mjs-fx-vx-retrait', '.v [mjs-fx-layer="loader"]')
    const v    = comp._shadow.querySelector('.v')
    assert.equal(v.getAttribute('role'), 'status')
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.v'))
    assert.ok(!comp._shadow.querySelector('.v'))
    assertAbsent(v.querySelector('[mjs-fx-layer]'), 'le dessin est parti avec la balise')
    assert.deepEqual(v.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx')), [])
  })
})
