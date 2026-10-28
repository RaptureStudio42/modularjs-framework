// Valeurs dérivées qui lisent le magasin : `µwrite $$x, v` (écriture brute, sans prévenir personne) les périme comme une
// écriture ordinaire de `$$x` — celles de tous les composants qui lisent la clé, et de ceux qui énumèrent le magasin.
// Relue aussitôt, la valeur dérivée est juste ; l'écran, lui, ne bouge pas jusqu'à la prochaine écriture ordinaire.
// Forme nue et forme entre parenthèses ; JavaScript et Civet ; développement et production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const ECRIVAIN = `<script lang="js">
  $$x = 1;
  $y = $$x * 2;
  @setX = function(v) { $$x = v; };
  @raw = function(v) { µwrite $$x, v; };
  @rawParen = function(v) { µwrite($$x, v); };
  @read = function() { return $y; };
  @brut = function() { return µread $$x; };
</script>
<p class="v">{$$x}|{$y}</p>
`

const LECTEUR_CIVET = `<script>
$z = $$x + 1
@raw = (v) -> µwrite $$x, v
@read = -> $z
</script>
<p class="v">{$z}</p>
`

// lit tout le magasin (abonnement à sa structure, pas à la clé)
const ENUMERATION = `<script lang="js">
  $somme = Object.values(µ.store).reduce((a, v) => typeof v === 'number' ? a + v : a, 0);
  @read = function() { return $somme; };
</script>
<p class="v">{$somme}</p>
`

const attendre = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const texte = (el: any) => el._shadow?.querySelector('.v')?.textContent

async function monter(prod: boolean) {
  const root   = mjsTmp('derive-magasin-brut')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'magasin-ecrivain.mjs'), ECRIVAIN)
  writeFileSync(join(srcDir, 'magasin-lecteur.mjs'), LECTEUR_CIVET)
  writeFileSync(join(srcDir, 'magasin-tout.mjs'), ENUMERATION)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js') }
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const code  = prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(code)
  window.document.body.innerHTML = '<mjs-magasin-ecrivain></mjs-magasin-ecrivain><mjs-magasin-lecteur></mjs-magasin-lecteur><mjs-magasin-tout></mjs-magasin-tout>'
  const ecrivain = window.document.querySelector('mjs-magasin-ecrivain')
  const lecteur  = window.document.querySelector('mjs-magasin-lecteur')
  const tout     = window.document.querySelector('mjs-magasin-tout')
  await attendre(() => texte(ecrivain) === '1|2' && texte(lecteur) === '2' && texte(tout) === '1')
  return { window, ecrivain, lecteur, tout }
}

describe('valeurs dérivées : µwrite $$x, v périme celles qui lisent le magasin, sans redessiner', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    describe(prod ? 'production' : 'développement', function () {
      let m: any
      before(async () => { m = await monter(prod) })

      // remet `$$x` à `v` par une écriture ordinaire, les trois écrans compris
      async function ecrire(v: number) {
        m.ecrivain.setX(v)
        await attendre(() => texte(m.ecrivain) === `${v}|${v * 2}` && texte(m.lecteur) === `${v + 1}` && texte(m.tout) === `${v}`)
        assert.deepEqual([texte(m.ecrivain), texte(m.lecteur), texte(m.tout)], [`${v}|${v * 2}`, `${v + 1}`, `${v}`])
        assert.deepEqual([m.ecrivain.read(), m.lecteur.read(), m.tout.read()], [v * 2, v + 1, v])
      }

      // après une écriture brute de `v` : les trois valeurs dérivées relues aussitôt sont justes, les écrans restent sur `avant`
      async function verifierBrut(v: number, avant: number) {
        assert.equal(m.ecrivain.brut(), v, 'la valeur brute est écrite')
        assert.deepEqual([m.ecrivain.read(), m.lecteur.read(), m.tout.read()], [v * 2, v + 1, v], 'valeurs dérivées relues aussitôt')
        await pause(30)
        assert.deepEqual([texte(m.ecrivain), texte(m.lecteur), texte(m.tout)], [`${avant}|${avant * 2}`, `${avant + 1}`, `${avant}`], 'µwrite seul ne redessine pas')
      }

      it('JavaScript, µwrite $$x, v : les valeurs dérivées qui lisent la clé ou le magasin, ici et ailleurs', async () => {
        await ecrire(1)
        m.ecrivain.raw(7)
        await verifierBrut(7, 1)
      })

      it('JavaScript, µwrite($$x, v)', async () => {
        await ecrire(1)
        m.ecrivain.rawParen(4)
        await verifierBrut(4, 1)
      })

      it('Civet, µwrite $$x, v écrit par un autre composant que celui qui pose la clé', async () => {
        await ecrire(1)
        m.lecteur.raw(5)
        await verifierBrut(5, 1)
      })

      it('l\'écriture ordinaire suivante redessine tout', async () => {
        await ecrire(1)
        m.ecrivain.raw(9)
        await verifierBrut(9, 1)
        await ecrire(3)
      })
    })
  }
})
