// Deux reffets qui lisent et écrivent la même clé du store ne se relancent jamais l'un l'autre par cette clé ; ils repartent
// quand du code hors reffet l'écrit (bouton, gestionnaire, minuterie, réponse réseau).
//
// Défaut : deux exemplaires d'un composant dont le reffet aligne une clé du store sur une valeur propre à l'exemplaire
// (`µeffect -> $$filtre = $f if $$filtre != $f`, `$f` différent) se relançaient l'un l'autre : 20 000 passages, deux
// avertissements « Boucle réactive détectée », puis un écran faux (`b:a` alors que le store valait `b`).
//
// Correctif : une clé que le reffet lit et écrit pendant son passage ne le relance que sur une écriture faite hors de tout
// reffet ; entre reffets, la dernière écriture gagne et chacun passe une fois. Et quand le garde-fou des boucles se
// déclenche malgré tout (un reffet qui réécrit sans fin une variable qu'il lit), l'écran suit l'état : seuls les reffets du
// composant s'arrêtent jusqu'à la fin de la rafale, le rendu continue.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

export const SOURCES: Record<string, string> = {
  'sync-un': [
    '<script>',
    '$f = "x"',
    'µeffect ->',
    '  globalThis.__passes = (globalThis.__passes ?? 0) + 1',
    '  $$filtre = $f if $$filtre != $f',
    '</script>',
    '<p class="f">{$f}:{$$filtre}</p>',
  ].join('\n'),
  'sync-deux': '<mjs-sync-un class="i1" f="a"></mjs-sync-un><mjs-sync-un class="i2" f="b"></mjs-sync-un>',
  'borne-basse': [
    '<script>',
    'µeffect ->',
    '  globalThis.__bas = (globalThis.__bas ?? 0) + 1',
    '  $$niv = 10 if $$niv > 10',
    '</script>',
    '<p class="niv">{$$niv}</p>',
  ].join('\n'),
  'borne-haute': [
    '<script>',
    'µeffect ->',
    '  globalThis.__haut = (globalThis.__haut ?? 0) + 1',
    '  $$niv = 20 if $$niv < 20',
    '</script>',
    '<p class="niv">{$$niv}</p>',
  ].join('\n'),
  'bornes-contraires': '<mjs-borne-basse></mjs-borne-basse><mjs-borne-haute></mjs-borne-haute>',
  'boucle-locale': [
    '<script>',
    '$x = 0',
    'µeffect ->',
    '  $x = Math.random()',
    '</script>',
    '<p class="x">{$x}</p>',
  ].join('\n'),
}

const pause = (ms = 60) => new Promise(r => setTimeout(r, ms))

for (const [etiquette, config] of [['dev', {}], ['minifie', { minify: true }]] as const) {
  describe(`µeffect — deux reffets ne se relancent pas par une clé du store qu'ils écrivent tous deux ; écran juste après le garde-fou (${etiquette})`, function () {
    this.timeout(120000)
    let app: any
    let avis: string[]
    let restaurer: () => void
    before(async () => {
      const root = mjsTmp('effets-deux-exemplaires-' + etiquette)
      mkdirSync(join(root, 'src'), { recursive: true })
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', ...config }))
      for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(root, 'src', `${nom}.mjs`), source + '\n')
      app = await createHarness({ root })
      avis = []
      const w = app.window
      const ow = w.console.warn
      w.console.warn = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
      restaurer = () => { w.console.warn = ow }
    })
    after(async () => {
      restaurer?.()
      await app?.destroy()
      await terminateSharedWorkerPool()
    })
    beforeEach(() => { avis.length = 0 })
    const boucles = () => avis.filter((a) => /Boucle réactive|Reactive loop/.test(a))
    const textes = (m: any, balise: string, q: string) => m.findAll(balise).map((k: any) => (k._shadow ?? k).querySelector(q).textContent)

    it('deux exemplaires alignent la clé sur leur propre valeur : un passage chacun, le dernier gagne, les écrans suivent le store', async () => {
      app.window.__passes = 0
      const m = await app.mount('sync-deux')
      for (let i = 0; i < 5; i++) await m.tick()
      assert.equal(app.window.__passes, 2, 'un passage par exemplaire')
      assert.equal(app.µ.store.filtre, 'b')
      assert.deepEqual(textes(m, 'mjs-sync-un', '.f'), ['a:b', 'b:b'])
      assert.deepEqual(boucles(), [])
      // une écriture hors reffet relance les deux, une fois chacun
      app.µ.store.filtre = 'z'
      await pause()
      assert.equal(app.window.__passes, 4)
      assert.deepEqual(textes(m, 'mjs-sync-un', '.f'), [`a:${app.µ.store.filtre}`, `b:${app.µ.store.filtre}`])
      assert.deepEqual(boucles(), [])
    })

    it('deux composants aux bornes contraires : aucune boucle, chacun repart sur l\'écriture hors reffet, les écrans suivent le store', async () => {
      app.window.__bas = 0
      app.window.__haut = 0
      const m = await app.mount('bornes-contraires')
      for (let i = 0; i < 5; i++) await m.tick()
      app.µ.store.niv = 15
      await pause()
      assert.equal(app.window.__bas, 2)
      assert.equal(app.window.__haut, 2)
      const niv = String(app.µ.store.niv)
      assert.deepEqual([...textes(m, 'mjs-borne-basse', '.niv'), ...textes(m, 'mjs-borne-haute', '.niv')], [niv, niv])
      assert.deepEqual(boucles(), [])
    })

    it('garde-fou déclenché (reffet qui réécrit sans fin une variable qu\'il lit) : l\'avertissement part, l\'écran montre l\'état', async () => {
      const m = await app.mount('boucle-locale')
      await pause(400)
      assert.equal(boucles().length, 1, 'un avertissement')
      assert.equal(m.text('.x'), String(m.state.x), 'l\'écran suit la dernière valeur écrite')
    })
  })
}
