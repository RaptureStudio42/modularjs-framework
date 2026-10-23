// *physics — le moteur seul, sans navigateur : une fonction pure du fichier de l'effet, appelée ici. Pas fixe de
// 1/120 s, boîtes, pilules et disques, bords du conteneur, ressorts (la souris, float, hang). Ce que doit
// tenir un moteur de corps solides : une pile de boîtes qui ne tremble ni ne s'enfonce et s'endort, rien qui
// traverse un bord, une énergie qui ne remonte pas, un fil qui garde sa longueur, un rappel qui ramène.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')

// le moteur d'effets (µ) puis le fichier de l'effet : la définition rend son moteur dans `engine`
function moteur(): any {
  const µ: any = {}
  new Function('µ', readFileSync(join(RUNTIME, 'mjs_fx.ts'), 'utf-8') + '\n' + readFileSync(join(RUNTIME, 'mjs_fx_physics.ts'), 'utf-8'))(µ)
  return µ._mjs_fxDefs.physics.engine
}

// un tirage reproductible
function hasard(graine: number) {
  let s = graine
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

// fait tourner le monde jusqu'à son sommeil (ou `max` secondes) ; rend le nombre de pas
function jusquauSommeil(w: any, max = 30): number {
  let n = 0
  while (!w.asleep && n < 120 * max) {
    w.step()
    n++
  }
  return n
}

const vitesse = (w: any) => Math.max(0, ...w.bodies.map((b: any) => Math.hypot(b.vx, b.vy) + Math.abs(b.w)))

describe('*physics — le moteur seul', function () {
  this.timeout(120000)
  const E = moteur()

  it('exposé par la définition : pas de 1/120 s, pesanteur 1 = 1000 px/s²', () => {
    assert.equal(E.step, 1 / 120)
    assert.equal(E.gravity, 1000)
    assert.equal(typeof E.world, 'function')
  })

  it('une tour de 20 boîtes alignées reste debout : immobile, recouvrement sous 1 px, endormie', () => {
    const w = E.world({ width: 400, height: 800 })
    for (let i = 0; i < 20; i++) w.add({ x: 200, y: 800 - 15 - i * 30.5, w: 120, h: 30 })
    w.config({ gravity: 1, bounce: 0.2, friction: 0.5, mode: 'fall', walls: 'all' })
    let pire = 0
    let n    = 0
    while (!w.asleep && n < 120 * 20) {
      w.step()
      n++
      pire = Math.min(pire, w.depth())
    }
    assert.ok(w.asleep, 'la tour ne s\'endort pas')
    assert.equal(vitesse(w), 0, 'des corps bougent encore')
    assert.ok(pire > -1.2, `recouvrement de ${pire.toFixed(2)} px pendant la mise en place`)
    assert.ok(w.depth() > -1, `recouvrement final de ${w.depth().toFixed(2)} px`)
    const derive = Math.max(...w.bodies.map((b: any) => Math.abs(b.x - 200)))
    assert.ok(derive < 8, `la tour a glissé de ${derive.toFixed(1)} px`)
    // endormie, elle ne bouge plus : le pas ne fait rien
    const avant = w.bodies.map((b: any) => b.y)
    for (let i = 0; i < 240; i++) w.step()
    assert.deepEqual(w.bodies.map((b: any) => b.y), avant)
  })

  it('vingt étiquettes lâchées en vrac s\'entassent sans trembler, rien ne se recouvre de plus d\'un pixel, et s\'endorment', () => {
    const r = hasard(7)
    const w = E.world({ width: 600, height: 400 })
    for (let i = 0; i < 20; i++) w.add({ x: 60 + (i % 5) * 110 + r() * 20, y: 30 + Math.floor(i / 5) * 55, w: 100, h: 36, radius: i % 2 ? 18 : 7 })
    w.config({ gravity: 1, bounce: 0.5, friction: 0.3, mode: 'fall', walls: 'all' })
    const n = jusquauSommeil(w, 20)
    assert.ok(w.asleep, 'les étiquettes ne s\'endorment pas')
    assert.ok(n < 120 * 8, `trop long : ${(n / 120).toFixed(1)} s`)
    assert.equal(vitesse(w), 0)
    assert.ok(w.depth() > -1, `recouvrement final de ${w.depth().toFixed(2)} px`)
    // au sol : aucun corps ne flotte au-dessus d'un autre sans le toucher (la pile est basse)
    const haut = Math.min(...w.bodies.map((b: any) => b.y - b.hh))
    assert.ok(haut > 400 - 3 * 36 - 40, `une étiquette est restée en l'air (${haut.toFixed(0)} px)`)
  })

  it('l\'énergie ne remonte pas pendant la chute (relevée toutes les 0,25 s)', () => {
    const r = hasard(3)
    const w = E.world({ width: 700, height: 450 })
    // une grille : aucun corps ne démarre dans un autre (un recouvrement de départ, en se dégageant, ajoute de l'énergie)
    for (let i = 0; i < 24; i++) w.add({ x: 60 + (i % 6) * 110, y: 40 + Math.floor(i / 6) * 55, w: 60 + r() * 40, h: 26 + r() * 14, radius: i % 3 === 0 ? 0 : 12 })
    w.config({ gravity: 1, bounce: 0.6, friction: 0.3, mode: 'fall', walls: 'all' })
    const e0 = w.energy()
    let prec = e0
    let n    = 0
    while (!w.asleep && n < 120 * 20) {
      w.step()
      n++
      if (n % 30 === 0) {
        const e = w.energy()
        assert.ok(e <= prec * 1.01 + 2e6, `l'énergie remonte à ${(e / 1e9).toFixed(3)} (avant ${(prec / 1e9).toFixed(3)}) à ${(n / 120).toFixed(2)} s`)
        prec = e
      }
    }
    assert.ok(w.energy() < e0 * 0.5, 'l\'énergie ne baisse pas de moitié')
  })

  it('rien ne traverse un bord : boîtes, pilules et disques lancés à 3000 px/s restent dans le conteneur pendant 10 s', () => {
    const r = hasard(11)
    const L = 700
    const H = 450
    const w = E.world({ width: L, height: H })
    for (let i = 0; i < 40; i++) {
      const t = i % 4
      const b = w.add(t === 0 ? { x: 50 + r() * 600, y: 40 + r() * 150, w: 60 + r() * 60, h: 24 + r() * 20, radius: 0 }
        : t === 1 ? { x: 50 + r() * 600, y: 40 + r() * 150, w: 70 + r() * 50, h: 30, radius: 12 }
        : t === 2 ? { x: 50 + r() * 600, y: 40 + r() * 150, w: 90 + r() * 50, h: 30, radius: 15 }
        : { x: 50 + r() * 600, y: 40 + r() * 150, w: 40, h: 40, radius: 20 })
      b.vx = (r() - 0.5) * 6000
      b.vy = (r() - 0.5) * 6000
      b.w  = (r() - 0.5) * 10
    }
    w.config({ gravity: 1, bounce: 0.6, friction: 0.3, mode: 'fall', walls: 'all' })
    for (let n = 1; n <= 1200; n++) {
      w.step()
      for (const b of w.bodies) {
        assert.ok(b.x >= 0 && b.x <= L && b.y >= 0 && b.y <= H, `un corps est sorti : ${b.x.toFixed(0)}, ${b.y.toFixed(0)} à ${(n / 120).toFixed(2)} s`)
      }
    }
    // chaque boîte englobante au repos est dans le conteneur, à un pixel près
    let dehors = 0
    for (const b of w.bodies) {
      for (let i = 0; i < b.n; i++) dehors = Math.max(dehors, -(b.wx[i] - b.r), b.wx[i] + b.r - L, -(b.wy[i] - b.r), b.wy[i] + b.r - H)
    }
    assert.ok(dehors < 1, `un corps dépasse de ${dehors.toFixed(2)} px`)
  })

  it('des pilules côte à côte, alignées, s\'endorment (leurs bouts se touchent sans se repousser)', () => {
    for (const graine of [1, 4, 9]) {
      const r = hasard(graine)
      const w = E.world({ width: 1248, height: 360 })
      let x = 14
      for (let i = 0; i < 10; i++) {
        const l = 90 + r() * 50
        w.add({ x: x + l / 2, y: 33, w: l, h: 38, radius: 999 })
        x += l + 8
      }
      w.config({ gravity: 1, bounce: 0.65, friction: 0.2, mode: 'fall', walls: 'all' })
      jusquauSommeil(w, 20)
      assert.ok(w.asleep, `graine ${graine} : les pilules ne s'endorment pas`)
      assert.ok(w.depth() > -1)
    }
  })

  it('un disque lancé sur le sol roule, ralentit et s\'arrête dans le conteneur', () => {
    const w = E.world({ width: 900, height: 300 })
    const d = w.add({ x: 100, y: 270, w: 60, h: 60, radius: 30 })
    w.config({ gravity: 1, bounce: 0.3, friction: 0.3, mode: 'fall', walls: 'all' })
    d.vx = 400
    jusquauSommeil(w, 40)
    assert.ok(w.asleep, 'le disque roule encore')
    assert.ok(d.x > 100 && d.x < 900 - 30)
    assert.ok(Math.abs(d.y - 270) < 1, `le disque est à ${d.y.toFixed(1)}`)
  })

  it('sans rotation (spin: false) les corps restent droits', () => {
    const r = hasard(5)
    const w = E.world({ width: 500, height: 400 })
    for (let i = 0; i < 12; i++) w.add({ x: 60 + r() * 380, y: 40 + r() * 120, w: 70, h: 30, radius: 8, spin: false })
    w.config({ gravity: 1, bounce: 0.5, friction: 0.3, mode: 'fall', walls: 'all' })
    jusquauSommeil(w, 20)
    assert.ok(w.asleep)
    for (const b of w.bodies) assert.ok(Math.abs(b.a) < 1e-9, `un corps a tourné de ${b.a}`)
  })

  it('un corps fixe retient les autres : il ne bouge pas et un corps libre repose dessus', () => {
    const w = E.world({ width: 400, height: 400 })
    const f = w.add({ x: 200, y: 300, w: 200, h: 40, fixed: true })
    const b = w.add({ x: 200, y: 100, w: 60, h: 30 })
    w.config({ gravity: 1, bounce: 0.3, friction: 0.3, mode: 'fall', walls: 'all' })
    jusquauSommeil(w, 20)
    assert.ok(w.asleep)
    assert.equal(f.y, 300)
    assert.ok(Math.abs(b.y - (300 - 20 - 15)) < 1, `le corps repose à ${b.y.toFixed(1)}, attendu 265`)
  })

  it('walls : « all » retient par le haut, « floor » laisse sortir par le haut (le monde s\'endort), « none » laisse tout sortir', () => {
    const essai = (walls: string, gravity: number) => {
      const w = E.world({ width: 400, height: 300 })
      const b = w.add({ x: 200, y: 150, w: 60, h: 40 })
      w.config({ gravity: gravity, bounce: 0.5, friction: 0.3, mode: 'fall', walls: walls })
      jusquauSommeil(w, 20)
      return { w: w, b: b }
    }
    const haut = essai('all', -1)
    assert.ok(haut.w.asleep && haut.b.y - haut.b.hh >= -0.5 && haut.b.y < 40, `all : le corps doit rester contre le plafond (${haut.b.y.toFixed(1)})`)
    const sorti = essai('floor', -1)
    assert.ok(sorti.b.y < -1000, `floor : le corps doit sortir par le haut (${sorti.b.y.toFixed(0)})`)
    assert.ok(sorti.w.asleep, 'floor : le monde doit s\'endormir une fois le corps loin')
    const chute = essai('none', 1)
    assert.ok(chute.b.y > 1000 && chute.w.asleep, 'none : le corps tombe hors du conteneur')
    // le sol et les côtés retiennent encore avec « floor »
    const sol = essai('floor', 1)
    assert.ok(sol.b.y < 300 && sol.w.asleep)
  })

  it('un pendule garde la longueur de son fil (au centième de la longueur près) et pend à sa place au repos', () => {
    const w = E.world({ width: 400, height: 700 })
    const b = w.add({ x: 200, y: 300, w: 80, h: 40 })
    w.config({ mode: 'hang', gravity: 1, strength: 0.3, length: 120, walls: 'all', bounce: 0.5, friction: 0.3 })
    const fil = b.rope
    const th  = Math.PI / 3
    b.x = fil.ax + 120 * Math.sin(th)
    b.y = fil.ay + 120 * Math.cos(th) + b.hh
    w.wake()
    let min = Infinity
    let max = -Infinity
    for (let n = 0; n < 1200; n++) {
      w.step()
      const d = Math.hypot(b.x + b.cs * fil.lx - b.sn * fil.ly - fil.ax, b.y + b.sn * fil.lx + b.cs * fil.ly - fil.ay)
      min = Math.min(min, d)
      max = Math.max(max, d)
    }
    assert.ok(min > 120 - 1.2 && max < 120 + 1.2, `le fil mesure de ${min.toFixed(2)} à ${max.toFixed(2)} px (120 attendus)`)
    // au repos, à sa place de mise en page : le fil tendu ne tire pas le corps plus bas
    const repos = E.world({ width: 400, height: 700 })
    const c     = repos.add({ x: 200, y: 300, w: 80, h: 40 })
    repos.config({ mode: 'hang', gravity: 1, strength: 0.3, length: 120, walls: 'all' })
    jusquauSommeil(repos, 5)
    assert.ok(Math.abs(c.x - 200) < 0.05 && Math.abs(c.y - 300) < 0.05, `le corps a dérivé : ${c.x - 200}, ${c.y - 300}`)
  })

  it('hang : un pendule lâché finit par s\'arrêter (le monde s\'endort, le corps est revenu)', () => {
    const w = E.world({ width: 400, height: 700 })
    const b = w.add({ x: 200, y: 300, w: 80, h: 40 })
    w.config({ mode: 'hang', gravity: 1, strength: 0.3, length: 120, walls: 'all' })
    b.x += 100
    w.wake()
    jusquauSommeil(w, 40)
    assert.ok(w.asleep, 'le pendule se balance encore')
    assert.ok(Math.abs(b.x - 200) < 1 && Math.abs(b.y - 300) < 1)
  })

  it('hang à l\'envers (pesanteur négative) : le fil part du dessous, le corps flotte à sa place', () => {
    const w = E.world({ width: 400, height: 700 })
    const b = w.add({ x: 200, y: 300, w: 80, h: 40 })
    w.config({ mode: 'hang', gravity: -1, strength: 0.3, length: 120, walls: 'all' })
    assert.ok(b.rope.ay > b.y, 'le fil doit partir du dessous')
    jusquauSommeil(w, 10)
    assert.ok(Math.abs(b.x - 200) < 0.05 && Math.abs(b.y - 300) < 0.05)
  })

  it('pendule de Newton : avec 2 px entre les billes (sans frottement, rebond 1), la dernière repart et les autres restent', () => {
    const w = E.world({ width: 800, height: 500 })
    const billes: any[] = []
    for (let i = 0; i < 5; i++) billes.push(w.add({ x: 200 + i * 62, y: 300, w: 60, h: 60, radius: 30 }))
    w.config({ mode: 'hang', gravity: 1, strength: 1, length: 200, walls: 'none', bounce: 1, friction: 0 })
    const fil = billes[0].rope
    billes[0].x = fil.ax - 200 * Math.sin(0.9)
    billes[0].y = fil.ay + 200 * Math.cos(0.9) + 30
    w.wake()
    let loin = 0
    let milieu = 0
    for (let n = 0; n < 480; n++) {
      w.step()
      loin   = Math.max(loin, billes[4].x - billes[4].hx)
      milieu = Math.max(milieu, Math.abs(billes[2].x - billes[2].hx))
    }
    assert.ok(loin > 40, `la dernière bille ne repart pas (${loin.toFixed(0)} px)`)
    assert.ok(milieu < 8, `la bille du milieu a bougé de ${milieu.toFixed(0)} px`)
  })

  it('float : un corps écarté et tourné revient à sa place, droit, puis s\'endort', () => {
    const w = E.world({ width: 600, height: 300 })
    const b = w.add({ x: 300, y: 150, w: 200, h: 50, radius: 25 })
    w.config({ mode: 'float', gravity: 0, strength: 0.3, push: 140, walls: 'all' })
    b.x += 60
    b.y -= 30
    b.a = 0.3
    w.wake()
    jusquauSommeil(w, 12)
    assert.ok(w.asleep)
    assert.ok(Math.abs(b.x - 300) < 0.5 && Math.abs(b.y - 150) < 0.5 && Math.abs(b.a) < 0.01, `écart ${(b.x - 300).toFixed(2)}, ${(b.y - 150).toFixed(2)}, angle ${b.a.toFixed(3)}`)
  })

  it('float sous pesanteur : le corps repose à sa place de mise en page (le ressort en tient compte)', () => {
    const w = E.world({ width: 600, height: 300 })
    const b = w.add({ x: 300, y: 150, w: 200, h: 50, radius: 25 })
    w.config({ mode: 'float', gravity: 1, strength: 0.3, walls: 'all' })
    jusquauSommeil(w, 10)
    assert.ok(Math.abs(b.y - 150) < 0.05, `le corps a coulé de ${(b.y - 150).toFixed(2)} px`)
  })

  it('float : la souris posée sur un corps le pousse, hors de portée elle ne fait rien, et le corps revient quand elle part', () => {
    const w = E.world({ width: 600, height: 300 })
    const b = w.add({ x: 300, y: 150, w: 200, h: 50, radius: 25 })
    w.config({ mode: 'float', gravity: 0, strength: 0.3, push: 140, walls: 'all' })
    assert.equal(w.near(300, 150), true)
    assert.equal(w.near(300, 10), true)
    assert.equal(w.near(300, 290), true)
    w.config({ push: 20 })
    assert.equal(w.near(300, 10), false, 'hors de portée')
    w.config({ push: 140 })
    w.pointer = { x: 280, y: 150 }
    for (let i = 0; i < 120; i++) w.step()
    assert.ok(Math.hypot(b.x - 300, b.y - 150) > 20, `le corps n'a pas été poussé (${(b.x - 300).toFixed(1)})`)
    w.pointer = null
    jusquauSommeil(w, 12)
    assert.ok(w.asleep && Math.abs(b.x - 300) < 0.5 && Math.abs(b.y - 150) < 0.5)
    // push: 0 : aucune bousculade
    w.config({ push: 0 })
    w.pointer = { x: 280, y: 150 }
    for (let i = 0; i < 120; i++) w.step()
    assert.ok(Math.hypot(b.x - 300, b.y - 150) < 0.5)
  })

  it('la souris attrape un corps : il suit sa cible, et lâché il garde sa vitesse', () => {
    const w = E.world({ width: 600, height: 400 })
    const b = w.add({ x: 300, y: 380, w: 100, h: 40, radius: 8 })
    w.config({ mode: 'fall', gravity: 1, walls: 'all' })
    jusquauSommeil(w, 5)
    w.grab(b, 0, 0, b.x, b.y)
    assert.equal(w.asleep, false)
    let tx = 300
    let ty = 380
    for (let i = 0; i < 80; i++) {
      tx += 2.5
      ty -= 2
      w.pull(tx, ty)
      w.step()
    }
    assert.ok(Math.hypot(b.x - tx, b.y - ty) < 25, `le corps traîne à ${Math.hypot(b.x - tx, b.y - ty).toFixed(0)} px de la cible`)
    const v = Math.hypot(b.vx, b.vy)
    assert.ok(v > 150, `vitesse au lâcher : ${v.toFixed(0)}`)
    w.release()
    for (let i = 0; i < 30; i++) w.step()
    assert.ok(b.x > tx, 'le corps lâché garde sa vitesse et continue')
  })

  it('reset remet chaque corps à sa place de mise en page, immobile', () => {
    const w = E.world({ width: 400, height: 400 })
    const b = w.add({ x: 200, y: 100, w: 60, h: 30 })
    w.config({ mode: 'fall', gravity: 1, walls: 'all' })
    jusquauSommeil(w, 10)
    assert.ok(b.y > 300)
    w.reset()
    assert.ok(b.x === 200 && b.y === 100 && b.vx === 0 && b.vy === 0 && b.a === 0 && w.asleep === false)
  })

  it('un monde sans corps s\'endort au premier pas : rien à simuler, la boucle ne tourne pas pour rien, même réveillé', () => {
    const w = E.world({ width: 300, height: 200 })
    w.config({ gravity: 1, mode: 'fall', walls: 'all' })
    assert.equal(w.asleep, false, 'le monde vient d\'être réglé : éveillé')
    w.step()
    assert.equal(w.asleep, true, 'un monde sans corps ne s\'endort pas')
    w.wake()
    w.step()
    assert.equal(w.asleep, true, 'réveillé à vide, il se rendort au pas suivant')
    w.add({ x: 100, y: 20, w: 60, h: 30 })
    w.wake()
    jusquauSommeil(w, 10)
    assert.ok(w.bodies[0].y > 150, 'un corps ajouté tombe')
  })

  it('friction : le réglage est suivi, une caisse lancée sur le sol glisse d\'autant moins loin que le frottement est fort', () => {
    const glisse = (friction: number) => {
      const w = E.world({ width: 3000, height: 400 })
      const b = w.add({ x: 100, y: 385, w: 60, h: 30, spin: false })
      w.config({ gravity: 1, bounce: 0, friction, mode: 'fall', walls: 'all' })
      b.vx = 600
      w.wake()
      for (let i = 0; i < 360; i++) w.step()
      return b.x - 100
    }
    const nul   = glisse(0)
    const moyen = glisse(0.3)
    const fort  = glisse(1)
    assert.ok(nul > moyen + 300 && moyen > fort + 150, `distances parcourues en 3 s : ${nul.toFixed(0)} (0), ${moyen.toFixed(0)} (0,3), ${fort.toFixed(0)} (1)`)
  })

  it('strength : le ressort de float est d\'autant plus raide que le réglage est grand, et 0 le supprime (le corps écarté reste où il est)', () => {
    const retour = (strength: number) => {
      const w = E.world({ width: 800, height: 600 })
      const b = w.add({ x: 400, y: 300, w: 120, h: 40, radius: 20 })
      w.config({ gravity: 0, bounce: 0.5, friction: 0.3, mode: 'float', strength, push: 0, walls: 'all' })
      b.x += 100
      w.wake()
      let passage = -1
      for (let i = 0; i < 360; i++) {
        w.step()
        if (passage < 0 && b.x <= 400) passage = (i + 1) / 120
      }
      return { passage: passage, x: b.x }
    }
    const sans = retour(0)
    assert.equal(sans.passage, -1, 'sans ressort le corps ne revient pas')
    assert.ok(Math.abs(sans.x - 500) < 1, `sans ressort le corps reste où il est (${sans.x.toFixed(1)})`)
    const mou = retour(0.1)
    const mi  = retour(0.3)
    const dur = retour(1)
    assert.ok(dur.passage > 0 && dur.passage < mi.passage && mi.passage < mou.passage, `premiers passages à la place : ${dur.passage} (1), ${mi.passage} (0,3), ${mou.passage} (0,1)`)
  })

  // 24 étiquettes de 60 × 30 px posées au hasard dans 120 × 120 px : elles ne tiennent pas, se repoussent sans fin
  const surpeuple = () => {
    const r = hasard(5)
    const w = E.world({ width: 120, height: 120 })
    for (let i = 0; i < 24; i++) w.add({ x: 20 + r() * 80, y: 20 + r() * 80, w: 60, h: 30, radius: 4 })
    w.config({ gravity: 1, bounce: 0.5, friction: 0.3, mode: 'fall', walls: 'all' })
    return w
  }
  const pas = (w: any, secondes: number) => { for (let i = 0; i < Math.round(secondes * 120); i++) w.step() }

  it('conteneur trop petit pour ses corps : ils se repoussent sans fin, puis se figent où ils sont au bout de la borne, sans geste ; un geste la remet à zéro', () => {
    assert.ok(E.awake >= 20 && E.awake <= 60, `la borne (${E.awake} s) est exposée par le moteur`)
    const w = surpeuple()
    pas(w, E.awake - 1)
    assert.equal(w.asleep, false, 'ils se sont calmés avant la borne : le conteneur n\'est pas trop petit pour ce test')
    pas(w, 1.2)
    assert.equal(w.asleep, true, `toujours éveillés ${E.awake} s après le dernier geste`)
    assert.equal(vitesse(w), 0, 'figés : plus aucune vitesse')
    const figes = w.bodies.map((b: any) => [b.x, b.y, b.a])
    pas(w, 2)
    assert.deepEqual(w.bodies.map((b: any) => [b.x, b.y, b.a]), figes, 'figés où ils sont')
    // un geste (ici un réveil) remet la borne à zéro : elle se compte depuis le DERNIER geste
    w.wake()
    pas(w, 15)
    w.wake()
    pas(w, E.awake - 1)
    assert.equal(w.asleep, false, 'la borne ne s\'est pas comptée depuis le dernier geste')
    pas(w, 1.2)
    assert.equal(w.asleep, true)
  })

  it('un corps tenu à la souris ne se fige pas (le geste dure), et la borne repart au lâcher', () => {
    const w = surpeuple()
    const b = w.bodies[0]
    w.grab(b, 0, 0, b.x, b.y)
    pas(w, E.awake + 5)
    assert.equal(w.asleep, false, 'le monde s\'est figé pendant la saisie')
    assert.ok(w.grabbed, 'la saisie a été lâchée')
    w.release()
    pas(w, E.awake - 1)
    assert.equal(w.asleep, false, 'la borne n\'a pas repris au lâcher')
    pas(w, 1.2)
    assert.equal(w.asleep, true)
  })

  it('sleep : le délai de la borne est un réglage du monde (en secondes), compté depuis le dernier geste, le changement du réglage compris', () => {
    const w = surpeuple()
    w.config({ sleep: 2 })
    pas(w, 1)
    assert.equal(w.asleep, false, 'figé avant son délai')
    pas(w, 1.2)
    assert.equal(w.asleep, true, 'toujours éveillé 2 s après le dernier geste')
    assert.equal(vitesse(w), 0, 'figés : plus aucune vitesse')
    // un délai posé en route se compte depuis ce moment (le réglage qui change est un geste), pas depuis le départ
    const v = surpeuple()
    pas(v, 1)
    v.config({ sleep: 5 })
    pas(v, 4)
    assert.equal(v.asleep, false, 'le délai posé en route est compté depuis le départ')
    pas(v, 1.2)
    assert.equal(v.asleep, true, 'le délai posé en route n\'est pas suivi')
  })

  it('sleep: 0 : le monde ne se fige jamais de lui-même, posé au départ ou en route', () => {
    const w = surpeuple()
    w.config({ sleep: 0 })
    pas(w, E.awake + 30)
    assert.equal(w.asleep, false, 'figé alors que la borne est levée')
    const v = surpeuple()
    v.config({ sleep: 2 })
    pas(v, 1)
    v.config({ sleep: 0 })
    pas(v, E.awake + 30)
    assert.equal(v.asleep, false, 'figé alors que la borne a été levée en route')
  })

  it('la borne ne coupe aucun mouvement qui s\'amortit : un pendule tiré large et un corps lancé sans pesanteur à la vitesse maximale s\'endorment bien avant', () => {
    const pendule = E.world({ width: 2400, height: 3000 })
    const p = pendule.add({ x: 1200, y: 1500, w: 60, h: 60, radius: 30 })
    pendule.config({ gravity: 1, mode: 'hang', strength: 0.5, length: 1000, walls: 'none' })
    p.x += 900
    p.y -= 400
    pendule.wake()
    const tp = jusquauSommeil(pendule, 60) / 120
    assert.ok(pendule.asleep && tp < E.awake - 5, `pendule : endormi en ${tp.toFixed(1)} s`)
    const vol = E.world({ width: 600, height: 400 })
    const v = vol.add({ x: 300, y: 200, w: 40, h: 40, radius: 20 })
    vol.config({ gravity: 0, bounce: 1, friction: 0, mode: 'fall', walls: 'all' })
    v.vx = 2800
    v.vy = 2100
    vol.wake()
    const tv = jusquauSommeil(vol, 60) / 120
    assert.ok(vol.asleep && tv < E.awake - 5, `corps lancé : endormi en ${tv.toFixed(1)} s`)
  })
})
