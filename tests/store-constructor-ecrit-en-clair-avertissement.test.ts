// magasin `$$` — une écriture dont l'objet passe par `constructor` ÉCRIT dans le code (`$$taches.find(f).constructor.x = v`,
// `['constructor']`, `$$m.get(k).constructor`, une variable qui garde l'élément, `delete`, `+=`, une méthode appelée) atteint
// la fonction `Object` du navigateur : rien n'est écrit, et l'avertissement dit que ce `constructor` est écrit dans le code —
// jamais « sans doute amenée par une clé venue de l'extérieur », que garde la même écriture par une clé calculée. Avec et
// sans l'enveloppe (`"proxy": false`), écrit dans un composant ou dans un module importé

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const AIDES = `export moduleClair = (id) ->
  $$taches.find((x) -> x.id == id).constructor.pollueM = 'p'

export moduleCalcule = (id, k) ->
  $$taches.find((x) -> x.id == id)[k].pollueN = 'p'
`

const SOURCE = `@import moduleClair 'ctor-aides.civet.mjs'
@import moduleCalcule 'ctor-aides.civet.mjs'

<script>
  $$taches = [{ id: 1, n: 0 }]
  $$m = new Map([['a', { n: 1 }]])
  $$f1 = [{ id: 1, constructor: { nom: 'Ferrari' } }]
  @clair = -> $$taches.find((x) -> x.id == 1).constructor.pollueA = 'p'
  @crochet = -> $$taches.find((x) -> x.id == 1)['constructor'].pollueB = 'p'
  @carte = -> $$m.get('a').constructor.pollueC = 'p'
  @efface = -> delete $$taches.find((x) -> x.id == 1).constructor.keys
  @plus = -> $$taches.find((x) -> x.id == 1).constructor.pollueD += 1
  @pousse = -> $$taches.find((x) -> x.id == 1).constructor.push(1)
  @variable = ->
    t = $$taches.find((x) -> x.id == 1)
    t.constructor.pollueE = 'p'
  @calcule = (k) -> $$taches.find((x) -> x.id == 1)[k].pollueF = 'p'
  @gabarit = -> $$taches.find((x) -> x.id == 1)[\`constructor\`].pollueG = 'p'
  @donnee = -> $$f1.find((x) -> x.id == 1).constructor.nom = 'McLaren'
  @donneeCle = (k) -> $$f1.find((x) -> x.id == 1).constructor[k].pollueH = 'p'
  @module = -> moduleClair(1)
  @moduleCle = (k) -> moduleCalcule(1, k)
</script>
<p class="etat">{$$taches.length}</p>
`

const CLAIR   = /^\[ModularJS\] \$\$(taches|m)\.…\.\S+ : `constructor`, écrit dans le code, mène à la fonction Object du navigateur, que partage toute la page ; rien n'est écrit\. Écrivez dans l'objet lui-même, sans `constructor`\.$/
const CALCULE = /^\[ModularJS\] \$\$(taches|f1)\.…\.\S+ : \$\$(taches|f1)\.… contient la fonction Object du navigateur, sans doute amenée par une clé venue de l'extérieur /

async function construire(prefixe: string, proxy: boolean): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'ctor-aides.civet.mjs'), AIDES)
  writeFileSync(join(srcDir, 'ctor-clair.mjs'), SOURCE)
  const base: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler   = new Bundler(proxy ? base : { ...base, proxy: false })
  const stats     = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

describe('magasin $$ : `constructor` écrit dans le code d\'une écriture, l\'avertissement le dit', function () {
  this.timeout(120000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const proxy of [true, false]) {
    it(`${proxy ? 'avec l\'enveloppe' : 'avec "proxy": false'} : composant et module importé, Object intact, un avertissement juste par écriture`, async () => {
      const code   = await construire(`ctor-clair-${proxy ? 'p' : 'sp'}`, proxy)
      const window: any = new Window({ url: 'http://localhost/' })
      try {
        window.eval(`${code}\nglobalThis.µ = µ;`)
        const avis: string[] = []
        window.µ.warn = (m: string) => avis.push(String(m))
        window.document.body.innerHTML = '<mjs-ctor-clair></mjs-ctor-clair>'
        const comp = window.document.querySelector('mjs-ctor-clair')
        const fin  = Date.now() + 3000
        while (!comp._shadow?.querySelector('.etat')?.textContent && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
        const jouer = (m: string, ...args: unknown[]): string[] => {
          avis.length = 0
          comp[m](...args)
          const pollue = window.eval('Object.getOwnPropertyNames(Object).filter((n) => /^pollue/.test(n)).join(",")')
          assert.equal(pollue, '', `${m} : Object n'est pas écrit`)
          assert.equal(typeof window.eval('Object.keys'), 'function', `${m} : Object.keys reste en place`)
          return avis.slice()
        }
        for (const m of ['clair', 'crochet', 'carte', 'efface', 'plus', 'pousse', 'variable', 'module', 'gabarit']) {
          const vus = jouer(m)
          assert.equal(vus.length, 1, `${m} : un avertissement (${JSON.stringify(vus)})`)
          assert.match(vus[0], CLAIR, `${m} : l'avertissement dit que constructor est écrit dans le code (${vus[0]})`)
        }
        // la même écriture par une clé calculée garde l'avertissement du piège de la clé venue de l'extérieur
        // un champ de données nommé `constructor` reçoit l'écriture ; une clé calculée écrite après lui mène seule à la fonction du
        // navigateur : l'avertissement de la clé venue de l'extérieur
        assert.deepEqual(jouer('donnee'), [], 'donnee : aucun avertissement')
        assert.equal(window.eval('µ.store.f1[0].constructor.nom'), 'McLaren', 'donnee : le champ constructor est écrit')
        for (const m of ['calcule', 'moduleCle', 'donneeCle']) {
          const vus = jouer(m, 'constructor')
          assert.equal(vus.length, 1, `${m} : un avertissement (${JSON.stringify(vus)})`)
          assert.match(vus[0], CALCULE, `${m} : la clé calculée garde son avertissement (${vus[0]})`)
        }
      }
      finally {
        window.close()
      }
    })
  }
})
