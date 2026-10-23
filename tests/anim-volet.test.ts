// l'animation intégrée volet (`*volet`), jumelle élément du préréglage de page homonyme
// (mjs_vt_presets.ts). Chargement du factory : lecture de la
// source + `new Function('µ', 'return (...)')`, même technique que
// tests/anim-typewriter-text-node-guard.test.ts — le fichier est une expression IIFE, pas un
// module ES exportable tel quel. Pas de happy-dom : `window` est un mock minimal
// (getComputedStyle fixe, l'argument `node` n'est jamais inspecté par l'animation elle-même),
// posé en beforeEach et retiré en afterEach.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ANIM_DIR = join(__dirname, '..', 'src', 'runtime', 'animations')

function loadFactory(name: string, µMock: any) {
  const src = readFileSync(join(ANIM_DIR, `${name}.ts`), 'utf-8')
  return new Function('µ', 'return (' + src.trim().replace(/;\s*$/, '') + ')')(µMock)
}

function makeµ() {
  const warns: string[] = []
  const resolved: any[] = []
  const µMock = {
    warn: function (m: any) { warns.push(String(m)) },
    easing: {
      resolve: function (e: any) { resolved.push(e); return typeof e === 'function' ? e : function (t: number) { return t } },
      linear: function (t: number) { return t },
    },
  }
  return { µMock, warns, resolved }
}

describe('animations/volet.ts', function () {
  beforeEach(function () {
    (globalThis as any).window = { getComputedStyle: function () { return { opacity: '1', transform: 'none' } } }
  })

  afterEach(function () {
    delete (globalThis as any).window
  })

  describe('volet.ts', function () {
    it('cfg par défaut : duration 380, easing ease-out', function () {
      const { µMock, resolved } = makeµ()
      const cfg = loadFactory('volet', µMock)({}).intro({})
      assert.equal(cfg.duration, 380)
      assert.ok(resolved.indexOf('ease-out') !== -1, `resolved = ${JSON.stringify(resolved)}`)
    })

    it("down (défaut) : css(0, 1), css(1, 0) — p=0 ne rend JAMAIS \"-0\" (String(-0) === '0'), css(0.25, 0.75)", function () {
      const { µMock } = makeµ()
      const cfg = loadFactory('volet', µMock)({}).intro({})
      let css = cfg.css(0, 1)
      assert.equal(css.transform, 'translateY(-100%)')
      assert.equal(css.clipPath, 'inset(100% 0 0 0)')
      css = cfg.css(1, 0)
      assert.equal(css.transform, 'translateY(0%)')
      assert.equal(css.transform.indexOf('-0'), -1, 'aucune trace de "-0" littéral dans le transform')
      assert.equal(css.clipPath, 'inset(0% 0 0 0)')
      css = cfg.css(0.25, 0.75)
      assert.equal(css.transform, 'translateY(-75%)')
      assert.equal(css.clipPath, 'inset(75% 0 0 0)')
    })

    it("{ dir: 'up' } : à t=0, translateY(100%) / inset(0 0 100% 0)", function () {
      const { µMock } = makeµ()
      const cfg = loadFactory('volet', µMock)({ dir: 'up' }).intro({})
      const css = cfg.css(0, 1)
      assert.equal(css.transform, 'translateY(100%)')
      assert.equal(css.clipPath, 'inset(0 0 100% 0)')
    })

    it("{ dir: 'left' } : à t=0, translateX(100%) / inset(0 100% 0 0)", function () {
      const { µMock } = makeµ()
      const cfg = loadFactory('volet', µMock)({ dir: 'left' }).intro({})
      const css = cfg.css(0, 1)
      assert.equal(css.transform, 'translateX(100%)')
      assert.equal(css.clipPath, 'inset(0 100% 0 0)')
    })

    it("{ direction: 'right' } (clé longue seule) : à t=0, translateX(-100%) / inset(0 0 0 100%)", function () {
      const { µMock } = makeµ()
      const cfg = loadFactory('volet', µMock)({ direction: 'right' }).intro({})
      const css = cfg.css(0, 1)
      assert.equal(css.transform, 'translateX(-100%)')
      assert.equal(css.clipPath, 'inset(0 0 0 100%)')
    })

    it("{ dir: 'up', direction: 'left' } : dir gagne — translateY(100%)", function () {
      const { µMock } = makeµ()
      const cfg = loadFactory('volet', µMock)({ dir: 'up', direction: 'left' }).intro({})
      assert.equal(cfg.css(0, 1).transform, 'translateY(100%)')
    })

    it("{ dir: 'diagonal' } : direction invalide — 1 warn explicite, repli 'down'", function () {
      const { µMock, warns } = makeµ()
      const cfg = loadFactory('volet', µMock)({ dir: 'diagonal' }).intro({})
      assert.equal(warns.length, 1)
      assert.ok(warns[0].indexOf("direction invalide 'diagonal'") !== -1, warns[0])
      const css = cfg.css(0, 1)
      assert.equal(css.transform, 'translateY(-100%)', 'comportement = celui de down')
      assert.equal(css.clipPath, 'inset(100% 0 0 0)', 'comportement = celui de down')
    })

    it('préfixe un transform déjà posé sur le nœud (baseTransform)', function () {
      (globalThis as any).window = { getComputedStyle: function () { return { opacity: '1', transform: 'rotate(3deg)' } } }
      const { µMock } = makeµ()
      const cfg = loadFactory('volet', µMock)({}).intro({})
      assert.equal(cfg.css(1, 0).transform, 'rotate(3deg) translateY(0%)')
    })
  })
})
