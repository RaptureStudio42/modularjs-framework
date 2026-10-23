// animations/iris.ts et animations/swipe.ts (built-in NEUVES) : iris est un rond qui
// s'ouvre au centre, swipe un front dégradé qui balaie l'élément et le révèle derrière lui. Ce
// sont les jumeaux « sur un élément » des rideaux de page iris/swipe de mjs_vt_presets.ts (là-bas
// un calque noir couvre l'écran puis révèle ; ici l'élément est révélé à travers un masque, sans
// calque, sans noir).
//
// Chargement du factory : lecture de la source + `new Function('µ', 'return (...)')`, même
// technique que anim-typewriter-text-node-guard.test.ts — le fichier est une expression IIFE,
// pas un module ES exportable tel quel. Pas de happy-dom nécessaire : setup(node) ne lit rien du
// nœud, node = {}.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const IRIS_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'animations', 'iris.ts'), 'utf-8')
const SWIPE_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'animations', 'swipe.ts'), 'utf-8')

function loadFactory(src: string, µMock: any) {
  return new Function('µ', 'return (' + src.trim().replace(/;\s*$/, '') + ')')(µMock)
}

function makeµMock() {
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

describe('animations/iris.ts — rond qui s\'ouvre au centre', function () {
  it('cfg par défaut : duration 380, delay 0, steps 60, easing résolu avec \'ease-out\'', function () {
    const { µMock, resolved } = makeµMock()
    const factory = loadFactory(IRIS_SRC, µMock)
    const { intro } = factory({})
    const cfg = intro({})
    assert.equal(cfg.duration, 380)
    assert.equal(cfg.delay, 0)
    assert.equal(cfg.steps, 60)
    assert.ok(resolved.includes('ease-out'), `resolved doit contenir 'ease-out' (obtenu ${JSON.stringify(resolved)})`)
  })

  it('css(t, u) : cercle 0% à t=0 (caché), 72% à t=1 (visible), 36% à mi-course', function () {
    const { µMock } = makeµMock()
    const factory = loadFactory(IRIS_SRC, µMock)
    const { intro } = factory({})
    const cfg = intro({})
    assert.equal(cfg.css(0, 1).clipPath, 'circle(0% at 50% 50%)')
    assert.equal(cfg.css(1, 0).clipPath, 'circle(72% at 50% 50%)')
    assert.equal(cfg.css(0.5, 0.5).clipPath, 'circle(36% at 50% 50%)')
  })

  it('options : duration et easing personnalisés remontent bien dans le cfg', function () {
    const { µMock, resolved } = makeµMock()
    const factory = loadFactory(IRIS_SRC, µMock)
    const { intro } = factory({ duration: 800, easing: 'linear' })
    const cfg = intro({})
    assert.equal(cfg.duration, 800)
    assert.ok(resolved.includes('linear'), `resolved doit contenir 'linear' (obtenu ${JSON.stringify(resolved)})`)
  })

  it('intro === outro : le runtime rejoue la même css(t, u) en sens inverse pour la sortie', function () {
    const { µMock } = makeµMock()
    const factory = loadFactory(IRIS_SRC, µMock)
    const { intro, outro } = factory({})
    assert.equal(intro, outro)
  })
})

describe('animations/swipe.ts — front dégradé qui balaie l\'élément, dans n\'importe quel sens', function () {
  // le masque à l'instant t : noir (visible) jusqu'au front, transparent après
  const masque = (cfg: any, t: number) => cfg.css(t, 1 - t).maskImage

  it('sens par défaut (vers la droite) : duration 320, easing ease-out ; à t=0 tout est caché, à t=1 tout est visible', function () {
    const { µMock, resolved } = makeµMock()
    const cfg = loadFactory(SWIPE_SRC, µMock)({}).intro({})
    assert.equal(cfg.duration, 320)
    assert.equal(resolved[0], 'ease-out')
    assert.equal(masque(cfg, 0), 'linear-gradient(90deg, #000 -20%, transparent 0%)')
    assert.equal(masque(cfg, 1), 'linear-gradient(90deg, #000 100%, transparent 120%)')
    assert.equal(cfg.css(0.5, 0.5).maskRepeat, 'no-repeat')
  })

  it('angle : le front suit l\'angle donné (135 = vers le bas à droite)', function () {
    const { µMock } = makeµMock()
    const cfg = loadFactory(SWIPE_SRC, µMock)({ angle: 135 }).intro({})
    assert.match(masque(cfg, 0.5), /^linear-gradient\(135deg, #000 40%, transparent 60%\)$/)
  })

  it('dir / direction en mot : right 90, down 180, left 270, up 0 ; dir gagne sur direction', function () {
    const { µMock } = makeµMock()
    const deg = (o: any) => /\((\d+)deg/.exec(masque(loadFactory(SWIPE_SRC, µMock)(o).intro({}), 0.5))![1]
    assert.equal(deg({ dir: 'left' }), '270')
    assert.equal(deg({ direction: 'down' }), '180')
    assert.equal(deg({ dir: 'up' }), '0')
    assert.equal(deg({ dir: 'up', direction: 'left' }), '0')
  })

  it('{ dir: \'diagonal\' } : direction invalide — 1 warn, repli vers la droite', function () {
    const { µMock, warns } = makeµMock()
    const cfg = loadFactory(SWIPE_SRC, µMock)({ dir: 'diagonal' }).intro({})
    assert.equal(warns.length, 1)
    assert.match(warns[0], /diagonal/)
    assert.match(masque(cfg, 0.5), /^linear-gradient\(90deg/)
  })

  it('intro === outro : la sortie rejoue le même masque à l\'envers', function () {
    const { µMock } = makeµMock()
    const f = loadFactory(SWIPE_SRC, µMock)({})
    assert.equal(f.intro, f.outro)
  })
})
