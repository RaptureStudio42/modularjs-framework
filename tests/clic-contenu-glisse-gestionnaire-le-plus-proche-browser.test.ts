// Un clic sur du contenu glissé dans un composant suit la règle de tous les clics : il joue le premier
// gestionnaire trouvé en remontant, et s'arrête là ; `.propagate` le laisse continuer. Le composant qui
// reçoit le contenu le voit donc arriver par son `<@slot>` : le cadre qui entoure le slot répond au clic
// d'un titre glissé (qui n'a pas de gestionnaire), pas à celui d'un bouton glissé qui a le sien — sauf
// `.propagate`. Défaut garanti absent : le cadre ignorait tout ce qu'on glissait dedans (ni clic, ni
// survol), et un composant qui enveloppait son propre slot restait muet lui aussi.
// Gardes : `.self` sur le fond d'une fenêtre ne répond qu'au fond ; le gestionnaire posé sur la balise du
// composant répond comme avant ; un composant glissé garde ses propres clics ; le carrousel du cœur ne
// tourne pas quand on tape une flèche dans un champ d'une de ses diapositives.
// Chromium et pas happy-dom : happy-dom ne présente pas au shadow root qui reçoit la cible glissée comme
// le fait un vrai navigateur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function chromiumPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

const SOURCES: Record<string, string> = {
  'carte.mjs': '<script>\n$s = 0\n$m = 0\n$q = 0\n</script>\n<div class="cadre" role="button" tabindex="0" @click={$s++} @mouseenter={$m++} @mouseleave={$q++}><@slot/></div>\n<p class="s">{$s}</p>\n<p class="m">{$m}</p>\n<p class="q">{$q}</p>\n',
  'fenetre.mjs': '<script>\n$f = 0\n</script>\n<div class="fond" role="button" tabindex="0" @click={$f++}><div class="boite"><@slot/></div></div>\n<p class="f">{$f}</p>\n',
  'fenetre-self.mjs': '<script>\n$f = 0\n</script>\n<div class="fond" role="button" tabindex="0" @click.self={$f++}><div class="boite"><@slot/></div></div>\n<p class="f">{$f}</p>\n',
  'enveloppe.mjs': '<script>\n$t = 0\n</script>\n<@carte><div class="tour" role="button" tabindex="0" @click={$t++}><@slot/></div></@carte>\n<p class="t">{$t}</p>\n',
  'menu.mjs': '<script>\n$open = false\n</script>\n<div class="menu" @mouseenter={$open = true} @mouseleave={$open = false}><button class="bt">Menu</button>{if $open}<div class="panel"><@slot/></div>{end}</div>\n<style>\n.menu\n  width: 200px\n.panel\n  padding: 10px\n</style>\n',
  'compteur.mjs': '<script>\n$n = 0\n</script>\n<button class="plus" @click={$n++}>+1</button>\n<p class="n">{$n}</p>\n',
  'page.mjs': '<script>\n$a = 0\n$l = 0\n$h = 0\n$c = 0\n</script>\n<@carte @click={$h++}><h3 class="titre">Bougie noire</h3><button class="acheter" @click={$a++}>Acheter</button><button class="aimer" @click.propagate={$l++}>aimer</button></@carte>\n<@fenetre><p class="texte">Votre commande est prête.</p></@fenetre>\n<@fenetre-self><p class="texte2">Votre commande est prête.</p></@fenetre-self>\n<@enveloppe><h3 class="titre2">Titre</h3></@enveloppe>\n<@carte><@compteur @lightDom></@carte>\n<p class="a">{$a}</p>\n<p class="l">{$l}</p>\n<p class="h">{$h}</p>\n<@menu><span class="e1">entrée 1</span><span class="e2">entrée 2</span></@menu>\n<@@carousel @change={$c++}><div><input class="champ" value="abc"></div><div>deux</div><div>trois</div></@@carousel>\n<p class="c">{$c}</p>\n<style>\n.e1, .e2\n  display: block\n  height: 30px\n</style>\n'
}

describe('clic sur un contenu glissé (Chromium réel) — le gestionnaire le plus proche, puis `.propagate`', function () {
  this.timeout(90000)
  let present = false
  let script  = ''
  let browser: any
  let page: any

  // ce que chaque composant a compté
  const read = () => page.evaluate(() => {
    const p: any   = document.querySelector('mjs-page')
    const sh       = p._shadow
    const txt      = (racine: any, sel: string) => racine.querySelector(sel).textContent
    const cards    = sh.querySelectorAll('mjs-carte')
    const env: any = sh.querySelector('mjs-enveloppe')
    const light    = sh.querySelector('mjs-compteur')
    return {
      a: txt(sh, '.a'), l: txt(sh, '.l'), h: txt(sh, '.h'),
      s: txt(cards[0]._shadow, '.s'),
      f: txt(sh.querySelector('mjs-fenetre')._shadow, '.f'),
      fs: txt(sh.querySelector('mjs-fenetre-self')._shadow, '.f'),
      t: txt(env._shadow, '.t'), si: txt(env._shadow.querySelector('mjs-carte')._shadow, '.s'),
      s2: txt(cards[1]._shadow, '.s'), n: txt(light, '.n')
    }
  })
  const hover = () => page.evaluate(() => {
    const card: any = (document.querySelector('mjs-page') as any)._shadow.querySelectorAll('mjs-carte')[0]
    return { m: card._shadow.querySelector('.m').textContent, q: card._shadow.querySelector('.q').textContent }
  })
  // clic sur une balise que la page a écrite (elle vit dans le shadow de la page)
  const click = async (sel: string) => {
    await page.evaluate((s: string) => { (document.querySelector('mjs-page') as any)._shadow.querySelector(s).click() }, sel)
    await page.waitForTimeout(50)
  }
  const center = (sel: string) => page.evaluate((s: string) => {
    const r = (document.querySelector('mjs-page') as any)._shadow.querySelector(s).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, sel)

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium non installé, test des clics glissés sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('clic-glisse')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const { chromium } = await import('playwright')
    browser = await chromium.launch()
  })

  beforeEach(async function () {
    if (!present) return
    page = await browser.newPage({ viewport: { width: 800, height: 900 } })
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-page></mjs-page><script>${script}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-page') as any)?._shadow?.querySelector('mjs-compteur .plus'))
  })

  afterEach(async function () { if (page) await page.close() })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('titre glissé sans gestionnaire : le cadre qui entoure le slot répond', async function () {
    if (!present) { this.skip(); return }
    await click('.titre')
    const r = await read()
    assert.equal(r.s, '1', 'le cadre de la carte joue pour un clic sur le titre glissé')
    assert.equal(r.h, '1', 'le gestionnaire posé sur la balise de la carte joue comme avant')
  })

  it('bouton glissé qui a son gestionnaire : lui seul joue, le cadre non', async function () {
    if (!present) { this.skip(); return }
    await click('.acheter')
    const r = await read()
    assert.deepEqual({ a: r.a, s: r.s, h: r.h }, { a: '1', s: '0', h: '0' })
  })

  it('`.propagate` sur le bouton glissé : son gestionnaire, puis le cadre', async function () {
    if (!present) { this.skip(); return }
    await click('.aimer')
    const r = await read()
    assert.deepEqual({ l: r.l, s: r.s, h: r.h }, { l: '1', s: '1', h: '1' })
  })

  it('fenêtre maison : le fond répond au texte glissé ; avec `.self`, au fond seulement', async function () {
    if (!present) { this.skip(); return }
    await click('.texte')
    await click('.texte2')
    let r = await read()
    assert.deepEqual({ f: r.f, fs: r.fs }, { f: '1', fs: '0' })
    await page.evaluate(() => { (document.querySelector('mjs-page') as any)._shadow.querySelector('mjs-fenetre-self')._shadow.querySelector('.fond').click() })
    await page.waitForTimeout(50)
    r = await read()
    assert.equal(r.fs, '1', '`.self` : le fond répond à un clic sur lui-même')
  })

  it('contenu glissé deux fois : le composant qui enveloppe son slot répond, pas le cadre plus loin', async function () {
    if (!present) { this.skip(); return }
    await click('.titre2')
    const r = await read()
    assert.deepEqual({ t: r.t, si: r.si }, { t: '1', si: '0' })
  })

  it('composant glissé : il garde ses clics, et le cadre le voit comme toute balise glissée', async function () {
    if (!present) { this.skip(); return }
    await click('mjs-compteur .plus')
    const r = await read()
    assert.deepEqual({ n: r.n, s2: r.s2 }, { n: '1', s2: '1' })
  })

  it('survol : entrer par le contenu glissé fait entrer dans le cadre, une fois ; en sortir, sortir', async function () {
    if (!present) { this.skip(); return }
    const title = await center('.titre')
    const buy   = await center('.acheter')
    await page.mouse.move(790, 890)
    await page.mouse.move(title.x, title.y, { steps: 3 })
    await page.waitForTimeout(50)
    assert.deepEqual(await hover(), { m: '1', q: '0' }, 'la souris arrive de dehors sur le titre glissé')
    await page.mouse.move(buy.x, buy.y, { steps: 3 })
    await page.waitForTimeout(50)
    assert.deepEqual(await hover(), { m: '1', q: '0' }, 'passer d\'une balise glissée à l\'autre ne fait ni sortir ni rentrer')
    const edge = await page.evaluate(() => (document.querySelector('mjs-page') as any)._shadow.querySelectorAll('mjs-carte')[0]._shadow.querySelector('.cadre').getBoundingClientRect().right - 6)
    await page.mouse.move(edge, buy.y, { steps: 3 })
    await page.waitForTimeout(50)
    assert.deepEqual(await hover(), { m: '1', q: '0' }, 'du contenu glissé au cadre lui-même : toujours dedans')
    await page.mouse.move(790, 890, { steps: 3 })
    await page.waitForTimeout(50)
    assert.deepEqual(await hover(), { m: '1', q: '1' }, 'la souris repart : une sortie')
  })

  it('menu ouvert au survol : il le reste quand la souris passe sur une entrée glissée, et se ferme quand elle part', async function () {
    if (!present) { this.skip(); return }
    const opened = () => page.evaluate(() => !!(document.querySelector('mjs-page') as any)._shadow.querySelector('mjs-menu')._shadow.querySelector('.panel'))
    const button = await page.evaluate(() => {
      const menu: any = (document.querySelector('mjs-page') as any)._shadow.querySelector('mjs-menu')
      menu.scrollIntoView({ block: 'center' })
      const r = menu._shadow.querySelector('.bt').getBoundingClientRect()
      return { x: r.left + 5, y: r.top + 5 }
    })
    await page.mouse.move(790, 5)
    await page.mouse.move(button.x, button.y, { steps: 3 })
    await page.waitForTimeout(80)
    assert.equal(await opened(), true, 'la souris sur le bouton : le menu s\'ouvre')
    for (const sel of ['.e1', '.e2']) {
      const entry = await center(sel)
      await page.mouse.move(entry.x, entry.y, { steps: 6 })
      await page.waitForTimeout(80)
      assert.equal(await opened(), true, `la souris sur l'entrée glissée ${sel} : le menu reste ouvert`)
    }
    await page.mouse.move(790, 5, { steps: 3 })
    await page.waitForTimeout(80)
    assert.equal(await opened(), false, 'la souris repart : le menu se ferme')
  })

  it('carrousel : une flèche tapée dans un champ glissé déplace le curseur du champ, pas le carrousel', async function () {
    if (!present) { this.skip(); return }
    const state = () => page.evaluate(() => {
      const sh = (document.querySelector('mjs-page') as any)._shadow
      return { c: sh.querySelector('.c').textContent, caret: sh.querySelector('.champ').selectionStart }
    })
    await page.evaluate(() => {
      const input = (document.querySelector('mjs-page') as any)._shadow.querySelector('.champ')
      input.focus()
      input.setSelectionRange(0, 0)
    })
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(50)
    assert.deepEqual(await state(), { c: '0', caret: 1 }, 'la flèche reste au champ')
    await page.evaluate(() => { (document.querySelector('mjs-page') as any)._shadow.querySelector('mjs-core-carousel')._shadow.querySelector('.carousel').focus() })
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(50)
    assert.equal((await state()).c, '1', 'le carrousel lui-même au clavier : il tourne')
    await page.evaluate(() => { (document.querySelector('mjs-page') as any)._shadow.querySelector('mjs-core-carousel')._shadow.querySelector('.next').focus() })
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(50)
    assert.equal((await state()).c, '2', 'une flèche sur un bouton du carrousel : il tourne comme avant')
  })
})
