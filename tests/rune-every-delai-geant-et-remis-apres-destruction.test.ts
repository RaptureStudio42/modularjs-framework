// µevery — deux défauts garantis absents :
//   1. un délai de plus de 2 147 483 647 ms (24,8 jours), ou `Infinity`, ne fait plus tourner la fonction en boucle
//      (le navigateur ramène un tel délai à 0, Node à 1 ms) : il est borné à cette limite ;
//   2. un composant retiré de la page, détruit, puis remis plus tard (panneau gardé en mémoire, défilement virtuel,
//      déplacement après un `await`) voit repartir le µevery qui tournait encore à sa destruction, comme µmount :
//      tir de reprise au montage, `times` continue son compte (jamais plus de n tirs au total), `onStop` part à
//      chaque arrêt (destruction comprise). Fini (`times`, `while`) ou arrêté par sa main, il reste arrêté.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  'ev-geant': [
    '<script>',
    '  $n = 0',
    '  $m = 0',
    '  µevery 2147483648, -> $n++',
    '  µevery Infinity, -> $m++',
    '</script>',
    '<p class="v">{$n}/{$m}</p>',
  ].join('\n'),
  'ev-remis': [
    '<script>',
    '  $n = 0',
    '  µevery 15, -> $n++',
    '</script>',
    '<p>{$n}</p>',
  ].join('\n'),
  'ev-compte': [
    '<script>',
    '  $n = 0',
    '  @_arrets = 0',
    '  µevery 100000, times: 2, onStop: (-> @_arrets++), -> $n++',
    '</script>',
    '<p>{$n}</p>',
  ].join('\n'),
  'ev-main': [
    '<script>',
    '  $n = 0',
    '  arreter = µevery 100000, -> $n++',
    '</script>',
    '<button class="stop" @click={arreter()}>stop</button>',
    '<p>{$n}</p>',
  ].join('\n'),
  'ev-pause': [
    '<script>',
    '  $n = 0',
    '  µevery 15, pause: true, -> $n++',
    '</script>',
    '<p>{$n}</p>',
  ].join('\n'),
}

function projetTemporaire(): string {
  const root   = mjsTmp('every-remis')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, code] of Object.entries(SOURCES)) writeFileSync(join(srcDir, `${nom}.mjs`), code)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await pause(10)
}

// retire l'élément, laisse passer la destruction différée (microtâche), puis le remet à sa place
async function retirer(el: any): Promise<any> {
  const hote = el.parentNode
  el.remove()
  await pause(40)
  return hote
}

describe('µevery — délai géant, composant remis après sa destruction', function () {
  this.timeout(180000)

  let app: any

  before(async () => { app = await createHarness({ root: projetTemporaire() }) })
  after(async () => { if (app) await app.destroy() })

  it('délai au-delà de 2³¹−1 ms ou Infinity : un seul tir (celui du montage), pas de boucle', async () => {
    const c = await app.mount('ev-geant')
    await pause(150)
    assert.equal(c.text('.v'), '1/1', 'seul le tir du montage a eu lieu')
  })

  it('retiré, détruit, puis remis : la répétition repart, et s’arrête de nouveau au retrait suivant', async () => {
    const c  = await app.mount('ev-remis')
    const el = c.el
    await attendre(() => c.state.n > 1)
    const hote = await retirer(el)
    const fige = c.state.n
    await pause(60)
    assert.equal(c.state.n, fige, 'détruit : la répétition est coupée')
    hote.appendChild(el)
    await attendre(() => c.state.n > fige + 1)
    assert.ok(c.state.n > fige + 1, `remis : la répétition a repris (${fige} → ${c.state.n})`)
    await retirer(el)
    const fige2 = c.state.n
    await pause(60)
    assert.equal(c.state.n, fige2, 'retiré une seconde fois : coupée de nouveau')
  })

  it('times continue son compte d’un montage à l’autre, onStop part à chaque arrêt, un timer fini reste fini', async () => {
    const c  = await app.mount('ev-compte')
    const el = c.el
    await attendre(() => c.state.n === 1)
    assert.equal(c.state.n, 1, 'tir du montage')
    let hote = await retirer(el)
    assert.equal(el._arrets, 1, 'la destruction arrête le timer : onStop')
    hote.appendChild(el)
    await attendre(() => c.state.n === 2)
    assert.equal(c.state.n, 2, 'remis : tir de reprise, le 2e et dernier permis par times: 2')
    assert.equal(el._arrets, 2, 'times atteint : onStop de nouveau')
    hote = await retirer(el)
    hote.appendChild(el)
    await pause(60)
    assert.equal(c.state.n, 2, 'fini avant la destruction : ne repart pas')
    assert.equal(el._arrets, 2, 'aucun arrêt de plus')
  })

  it('arrêté par sa main avant la destruction : ne repart pas', async () => {
    const c  = await app.mount('ev-main')
    const el = c.el
    await attendre(() => c.state.n === 1)
    await c.click('.stop')
    const hote = await retirer(el)
    hote.appendChild(el)
    await pause(60)
    assert.equal(c.state.n, 1, 'la main d’arrêt reste souveraine')
  })

  it('pause: true, détruit puis remis : une seule répétition repart (pas de doublon)', async () => {
    const w = app.window
    const actifs = new Set<any>()
    const si = w.setInterval, ci = w.clearInterval
    w.setInterval = function(...a: any[]) { const id = si.apply(this, a); actifs.add(id); return id }
    w.clearInterval = function(id: any) { actifs.delete(id); return ci.call(this, id) }
    try {
      const c  = await app.mount('ev-pause')
      const el = c.el
      await attendre(() => c.state.n > 1)
      const avant = actifs.size
      const hote = await retirer(el)
      assert.equal(actifs.size, avant - 1, 'retiré : sa répétition est coupée')
      hote.appendChild(el)
      await attendre(() => actifs.size === avant)
      await pause(30)
      assert.equal(actifs.size, avant, 'remis : une répétition et une seule')
    }
    finally {
      w.setInterval = si
      w.clearInterval = ci
    }
  })
})
