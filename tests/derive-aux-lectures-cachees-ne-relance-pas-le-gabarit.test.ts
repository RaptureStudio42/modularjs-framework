// Une valeur dérivée aux lectures cachées (fonction du `<script>` qui lit l'état, `fetch`…) est périmée par toute écriture
// et se recalcule quand on la lit ; ce que le gabarit en affiche ne se relance qu'avec les variables qu'elle lit en toutes
// lettres. Relancer ses liaisons après chaque écriture faisait refaire la requête d'un `{await}` à chaque frappe sans
// rapport, reconstruire les lignes d'un `{for}` (le champ focalisé perdait sa saisie) et recalculer une valeur affichée
// que rien n'avait changée. Le remède d'un affichage qui doit suivre une lecture cachée reste `µderived` avec ses
// dépendances. Civet, CoffeeScript et JavaScript ; développement et production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const GABARIT = `
<p class="q">{$q}</p>
<p class="l">{$label}</p>
{await $user}
  <p class="att">attente</p>
{success u}
  <p class="v">{u.nom}</p>
{end}
{for r in $rows}<input class="r" aria-label="ligne" value={r.t}>{end}
`

const CIVET = `<script>
$id = 1
$q = ''
$sel = 1
$items = [{id: 1, t: 'a'}, {id: 2, t: 'b'}]
$user = fetch('/api/u/' + $id).then((r) -> r.json())
marque = (x) -> x.id == $sel
$rows = $items.map((x) -> ({id: x.id, t: x.t, on: marque(x)}))
formater = (p) ->
  window.calculs += 1
  p + ' €'
$label = formater($id)
@taper = (x) -> $q = x
@changer = (x) -> $id = x
</script>
${GABARIT}`

const COFFEE = `<script lang="coffee">
$id = 1
$q = ''
$sel = 1
$items = [{id: 1, t: 'a'}, {id: 2, t: 'b'}]
$user = fetch('/api/u/' + $id).then((r) -> r.json())
marque = (x) -> x.id == $sel
$rows = $items.map((x) -> {id: x.id, t: x.t, on: marque(x)})
formater = (p) ->
  window.calculs += 1
  p + ' €'
$label = formater($id)
@taper = (x) -> $q = x
@changer = (x) -> $id = x
</script>
${GABARIT}`

const JS = `<script lang="js">
$id = 1
$q = ''
$sel = 1
$items = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }]
$user = fetch('/api/u/' + $id).then((r) => r.json())
const marque = (x) => x.id == $sel
$rows = $items.map((x) => ({ id: x.id, t: x.t, on: marque(x) }))
const formater = (p) => { window.calculs += 1; return p + ' €' }
$label = formater($id)
@taper = function(x) { $q = x }
@changer = function(x) { $id = x }
</script>
${GABARIT}`

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const attendre = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await pause(10)
}

async function monter(hote: string, prod: boolean) {
  const root   = mjsTmp('derive-sans-relance')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'derive-sans-relance.mjs'), hote)
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
  // requêtes vues par le composant (réponse immédiate)
  const appels: string[] = []
  const reponse = (): any => ({ ok: true, status: 200, headers: new window.Headers({ 'content-type': 'application/json' }), json: async () => ({ nom: 'Ada' }), text: async () => '{"nom":"Ada"}', clone: () => reponse() })
  window.fetch = (u: any) => { appels.push(String(u)); return Promise.resolve(reponse()) }
  // calculs du libellé
  window.calculs = 0
  window.eval(code)
  window.document.body.innerHTML = '<mjs-derive-sans-relance></mjs-derive-sans-relance>'
  const el = window.document.querySelector('mjs-derive-sans-relance')
  await attendre(() => (el._shadow?.querySelector('.v') ?? el._shadow?.querySelector('.a'))?.textContent != null)
  await pause(30)
  return { window, el, appels }
}

const SOURCES: [string, string][] = [['Civet', CIVET], ['CoffeeScript', COFFEE], ['JavaScript', JS]]

describe('valeur dérivée aux lectures cachées : son affichage ne se relance pas après une écriture sans rapport', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [langue, source] of SOURCES) {
    for (const prod of [false, true]) {
      const mode = prod ? 'production' : 'développement'
      describe(`${langue}, ${mode}`, function () {
        let m: any
        before(async () => { m = await monter(source, prod) })
        const texte = (c: string) => m.el._shadow.querySelector(c)?.textContent ?? null

        it('au montage : une requête, la réponse affichée', () => {
          assert.deepEqual(m.appels, ['/api/u/1'])
          assert.equal(texte('.v'), 'Ada')
          assert.equal(texte('.l'), '1 €')
        })

        it('{for} : le champ focalisé d\'une ligne garde son nœud, son focus et sa saisie', async () => {
          const champ = m.el._shadow.querySelector('.r')
          champ.focus()
          champ.value = 'saisie'
          assert.ok(m.el._shadow.activeElement === champ, 'le champ a le focus')
          m.el.taper('x')
          await pause(40)
          const apres = m.el._shadow.querySelector('.r')
          // nœuds comparés par `ok` : un `equal` qui échoue sérialise tout le DOM
          assert.ok(apres === champ, 'la ligne garde son nœud')
          assert.ok(m.el._shadow.activeElement === champ, 'le champ garde le focus')
          assert.equal(apres.value, 'saisie', 'la saisie reste')
        })

        it('{await} : trois frappes sans rapport ne refont pas la requête, la branche d\'attente ne revient pas', async () => {
          const vus: (string | null)[] = []
          for (const x of ['a', 'ab', 'abc']) {
            m.el.taper(x)
            await pause(2)
            vus.push(texte('.att'))
          }
          await pause(40)
          assert.deepEqual(m.appels, ['/api/u/1'], 'une seule requête')
          assert.deepEqual(vus, [null, null, null])
          assert.equal(texte('.q'), 'abc')
          assert.equal(texte('.v'), 'Ada')
        })

        it('une valeur affichée que rien n\'a changée ne se recalcule pas', async () => {
          const avant = m.window.calculs
          m.el.taper('abcd')
          await pause(40)
          assert.equal(m.window.calculs, avant)
        })

        it('écrire une variable lue en toutes lettres refait la requête et le libellé', async () => {
          m.el.changer(2)
          await attendre(() => m.appels.length === 2 && texte('.v') === 'Ada')
          await pause(30)
          assert.deepEqual(m.appels, ['/api/u/1', '/api/u/2'])
          assert.equal(texte('.l'), '2 €')
        })
      })
    }
  }
})

// une valeur dérivée aux lectures cachées qui écrit l'état en se calculant (un compteur de passages) : une écriture sans
// rapport ne la recalcule pas, et rien ne boucle
const COMPTEURS: [string, string][] = [
  ['Civet', `<script>
$n = 1
$passages = 0
$autre = 0
formater = (p) ->
  $passages += 1
  p + ' €'
$label = formater($n)
@ecrireAutre = (x) -> $autre = x
@lirePassages = -> $passages
</script>
<p class="l">{$label}</p><p class="a">{$autre}</p>
`],
  ['CoffeeScript', `<script lang="coffee">
$n = 1
$passages = 0
$autre = 0
formater = (p) ->
  $passages += 1
  p + ' €'
$label = formater($n)
@ecrireAutre = (x) -> $autre = x
@lirePassages = -> $passages
</script>
<p class="l">{$label}</p><p class="a">{$autre}</p>
`],
  ['JavaScript', `<script lang="js">
$n = 1
$passages = 0
$autre = 0
const formater = (p) => { $passages += 1; return p + ' €' }
$label = formater($n)
@ecrireAutre = function(x) { $autre = x }
@lirePassages = function() { return $passages }
</script>
<p class="l">{$label}</p><p class="a">{$autre}</p>
`],
]

describe('valeur dérivée aux lectures cachées qui écrit l\'état en se calculant', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [langue, source] of COMPTEURS) {
    for (const prod of [false, true]) {
      it(`${langue}, ${prod ? 'production' : 'développement'} : une écriture sans rapport ne la recalcule pas`, async () => {
        const { el } = await monter(source, prod)
        const avant = el.lirePassages()
        el.ecrireAutre(1)
        await pause(60)
        assert.equal(el._shadow.querySelector('.a')?.textContent, '1')
        assert.equal(el.lirePassages(), avant)
        assert.equal(el._shadow.querySelector('.l')?.textContent, '1 €')
      })
    }
  }
})
