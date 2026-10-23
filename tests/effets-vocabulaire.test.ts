// Effets — le vocabulaire commun des sens et des points : `direction` s'écrit en mot (right, left,
// up, down, les diagonales) ou en angle (0 = vers le haut, 90 = vers la droite, comme un dégradé
// CSS) ; `origin` est un point (center, top-left…, « x% y% », pointer quand l'effet sait suivre la
// souris) ; `order` est l'ordre des lettres ; `zone` est la bande de l'écran où se joue un effet au
// défilement. Vérifié à la compilation, traduit à l'exécution.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { parseEffect, checkLife } from '../src/effects/catalog.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'fx-sens': [
    '<p class="flotte" *float(direction: 45)>F</p>',
    '<p class="reflet" *shine(where: text, direction: down)>S</p>',
    '<p class="lettres" *stagger(direction: left, order: center)>L</p>',
    '<p class="degrade" *gradient(direction: 270)>G</p>',
    '<p class="secousse" *shake(direction: up)>X</p>',
    '<figure class="loupe" *zoom(origin: top-left)><img alt=""></figure>',
    '<p class="tour" *spin(origin: 20% 80%)>T</p>',
    '<p class="souligne" *underline(origin: center)>U</p>',
    '<p class="arc" *rainbow([red, blue, green], animate: false, order: left)>ABC</p>',
  ].join('\n'),
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('effets — direction, origin, order', function () {
  this.timeout(60000)
  let window: any
  let racine: any

  before(async () => {
    const root   = mjsTmp('effets-vocabulaire')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const code  = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-fx-sens></mjs-fx-sens>'
    const comp = window.document.querySelector('mjs-fx-sens')
    await attendre(() => !!comp._shadow?.querySelector('.arc [mjs-fx-letter]'))
    racine = comp._shadow
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('direction : un mot, une diagonale ou un angle — ramené dans 0..360', () => {
    assert.deepEqual(parseEffect('float', 'direction: up-right').fixed, { direction: 'up-right' })
    assert.deepEqual(parseEffect('float', 'direction: 45').fixed, { direction: 45 })
    assert.deepEqual(parseEffect('float', 'direction: -90').fixed, { direction: 270 })
    assert.throws(() => parseEffect('float', 'direction: diagonal'), /direction = diagonal[\s\S]*up-right[\s\S]*angle/)
    assert.throws(() => parseEffect('float', 'direction: 400'), /direction = 400/)
  })

  it('origin : un point nommé, « x% y% », ou pointer quand l\'effet suit la souris', () => {
    assert.deepEqual(parseEffect('zoom', 'origin: top-left').fixed, { origin: 'top-left' })
    assert.deepEqual(parseEffect('zoom', 'origin: 20% 80%').fixed, { origin: '20% 80%' })
    assert.deepEqual(parseEffect('zoom', 'origin: pointer').fixed, { origin: 'pointer' })
    assert.throws(() => parseEffect('spin', 'origin: pointer'), /origin = pointer/)
    assert.throws(() => parseEffect('zoom', 'origin: milieu'), /origin = milieu/)
  })

  it('order est l\'ordre des lettres, direction leur mouvement : les deux ne se confondent pas', () => {
    assert.deepEqual(parseEffect('stagger', 'order: center').fixed, { order: 'center' })
    assert.throws(() => parseEffect('stagger', 'direction: center'), /direction = center/)
    assert.throws(() => parseEffect('scramble', 'direction: left'), /réglage « direction » inconnu/)
  })

  it('zone : deux hauteurs de l\'écran, en % ou en mots — refusée seule, vide, en px, et sur @in/@out', () => {
    assert.deepEqual(parseEffect('stagger', 'on: scroll, zone: 60% 40%').fixed, { on: 'scroll', zone: '60% 40%' })
    assert.deepEqual(parseEffect('fly', 'on: scroll, zone: bottom center').fixed, { on: 'scroll', zone: 'bottom center' })
    assert.throws(() => parseEffect('stagger', 'zone: 60%'), /zone = 60%/)
    assert.throws(() => parseEffect('stagger', 'zone: 50% 50%'), /zone = 50% 50%/)
    assert.throws(() => parseEffect('stagger', 'zone: 300px 100px'), /zone = 300px 100px/)
    assert.throws(() => checkLife('fly', parseEffect('fly', 'zone: 60% 40%'), 'in'), /zone/)
  })

  it('zone à l\'exécution : les hauteurs lues, l\'avancée entre elles (le haut de la balise)', () => {
    const µ = window.µ
    assert.deepEqual(Array.from(µ._mjs_fxZone('bottom center')), [1, 0.5])
    assert.deepEqual(Array.from(µ._mjs_fxZone('60% 40%')), [0.6, 0.4])
    assert.equal(µ._mjs_fxZone('50% 50%'), null)
    assert.equal(µ._mjs_fxZone(undefined), null)
    const box = { top: 0, height: 1000 }
    assert.equal(µ._mjs_fxAdvance({ top: 700, height: 50 }, box, [0.6, 0.4]), 0)
    assert.ok(Math.abs(µ._mjs_fxAdvance({ top: 500, height: 50 }, box, [0.6, 0.4]) - 0.5) < 1e-9)
    assert.equal(µ._mjs_fxAdvance({ top: 300, height: 50 }, box, [0.6, 0.4]), 1)
    // sans bande : 0 quand le haut touche le bas, 1 quand le milieu atteint le milieu
    assert.equal(µ._mjs_fxAdvance({ top: 1000, height: 50 }, box, null), 0)
    assert.equal(µ._mjs_fxAdvance({ top: 475, height: 50 }, box, null), 1)
  })

  it('*float(direction: 45) : la balise flotte en diagonale (vecteur posé en variables)', () => {
    const f = racine.querySelector('.flotte')
    assert.equal(f.style.getPropertyValue('--mjs-fx-float-x'), '0.7071')
    assert.equal(f.style.getPropertyValue('--mjs-fx-float-y'), '-0.7071')
  })

  it('*shine(where: text, direction: down) : le reflet part du haut et descend', () => {
    const s = racine.querySelector('.reflet')
    assert.equal(s.style.getPropertyValue('--mjs-fx-shine-a'), '180deg')
    assert.equal(s.style.getPropertyValue('--mjs-fx-shine-from'), '50% 150%')
    assert.equal(s.style.getPropertyValue('--mjs-fx-shine-to'), '50% -50%')
  })

  it('*stagger : le mouvement suit direction, l\'ordre suit order', () => {
    const l = racine.querySelector('.lettres')
    assert.equal(l.getAttribute('mjs-fx-stagger-order'), 'center')
    assert.equal(l.style.getPropertyValue('--mjs-fx-stagger-x'), '-1')
    assert.equal(l.style.getPropertyValue('--mjs-fx-stagger-y'), '0')
  })

  it('*gradient(direction: 270) : le dégradé et son défilé vont vers la gauche', () => {
    const g = racine.querySelector('.degrade')
    assert.match(g.style.getPropertyValue('--mjs-fx-gradient'), /^linear-gradient\(270deg,/)
  })

  it('*shake(direction: up) : la secousse sur l\'axe vertical', () => {
    const x = racine.querySelector('.secousse')
    assert.equal(x.style.getPropertyValue('--mjs-fx-shake-x'), '0')
    assert.equal(x.style.getPropertyValue('--mjs-fx-shake-y'), '-1')
  })

  it('origin : le point devient l\'origine de l\'effet', () => {
    const z = racine.querySelector('.loupe')
    assert.equal(z.style.getPropertyValue('--mjs-fx-zoom-ox'), '0')
    assert.equal(z.style.getPropertyValue('--mjs-fx-zoom-oy'), '0')
    assert.equal(racine.querySelector('.tour').style.getPropertyValue('--mjs-fx-spin-origin'), '20% 80%')
    assert.equal(racine.querySelector('.souligne').getAttribute('mjs-fx-underline-origin'), 'center')
  })

  it('*rainbow(order: left) : les couleurs se posent depuis la dernière lettre', () => {
    const couleurs = [...racine.querySelectorAll('.arc [mjs-fx-letter]')].map((l: any) => l.style.getPropertyValue('color'))
    assert.deepEqual(couleurs, ['green', 'blue', 'red'])
  })
})
