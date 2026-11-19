// une donnée dont une clé porte le nom d'une méthode d'`Object.prototype` (`hasOwnProperty`, `valueOf`, `isPrototypeOf`…) : un JSON venu du
// serveur suffit. Étalée sur un enfant, écrite par `_set` ou champ par champ, passée en prop, rangée dans le magasin : le composant rend
// la donnée et vit. Avant, une table du cœur indexée par le nom de la variable rendait la méthode héritée, prise pour une liste de
// liaisons : « Fatal Error », le composant mort

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { attendre, pause } from './helpers/coeur-monter.js'
import { mjsTmp } from './helpers/tmp.js'

const NATIVES = ['hasOwnProperty', 'valueOf', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__lookupGetter__', '__defineSetter__']
const natives = (n: number) => NATIVES.map((k, i) => `"${k}":${n + i}`).join(',')

// les composants `.mjs` construits par le vrai Bundler, montés dans happy-dom ; erreurs et plantages recueillis
async function monter(sources: Record<string, string>, prefixe: string): Promise<{ window: any; hote: any; erreurs: string[] }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const n in sources) writeFileSync(join(srcDir, n), sources[n])
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files   = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre   = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const code    = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  const erreurs: string[] = []
  window.console = { log() {}, info() {}, debug() {}, warn() {}, error: (...a: any[]) => erreurs.push(a.map(String).join(' ')) }
  window.eval(`${code}\nglobalThis.µ = µ;`)
  window.µ.error = (...a: any[]) => erreurs.push(a.map(String).join(' '))
  window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
  const hote = window.document.querySelector('mjs-hote')
  await attendre(() => hote._shadow && hote._shadow.querySelector('p'))
  await pause(80)
  return { window, hote, erreurs }
}

// texte du premier `<p>` de l'ombre, ou le message du plantage qui l'a remplacé
const texte  = (el: any) => el._shadow.querySelector('.mjs-fatal-error')?.textContent || el._shadow.querySelector('p')?.textContent
const plante = (...els: any[]) => els.map((el) => !!el._mjs_has_crashed)

const ENFANT = `
<script>
  $nom ?= ''
</script>

<p>{$nom}</p>
`

const FICHE = `
<script>
  $data ?= {}
</script>

<p>{$data.nom}</p>
`

describe('donnée dont une clé porte le nom d\'une méthode d\'Object.prototype', function () {
  this.timeout(60000)

  after(() => terminateSharedWorkerPool())

  it('étalée sur un enfant (`{...$data}`), au montage puis à l\'écriture suivante : l\'enfant rend la donnée et vit', async () => {
    const { window, hote, erreurs } = await monter({
      'hote.mjs': `
<script>
  $data = JSON.parse('{"nom":"a",${natives(1)}}')
  @changer = -> $data = JSON.parse('{"nom":"b",${natives(11)}}')
</script>

<mjs-enfant {...$data}></mjs-enfant><p>hote</p>
`,
      'enfant.mjs': ENFANT
    }, 'cles-natives-etalement')
    try {
      const enfant = hote._shadow.querySelector('mjs-enfant')
      await attendre(() => !!enfant._shadow && !!texte(enfant))
      const avant = texte(enfant)
      hote.changer()
      await attendre(() => texte(enfant) === 'b', 1500)
      assert.deepEqual([avant, texte(enfant), plante(hote, enfant), erreurs], ['a', 'b', [false, false], []])
    }
    finally { await window.happyDOM.close() }
  })

  it('écrite directement, par `_set` et champ par champ (`$data.isPrototypeOf = 1`) : le composant rend la donnée et vit', async () => {
    const { window, hote, erreurs } = await monter({
      'hote.mjs': `
<script>
  $data = { nom: 'a' }
  @ecrire = ->
    $data.isPrototypeOf = 1
    $data.hasOwnProperty = 2
    $data.valueOf = 3
    $data.nom = 'b'
</script>

<p>{$data.nom}</p>
`
    }, 'cles-natives-ecriture')
    try {
      for (const k of NATIVES) hote._set(k, 7)
      await pause(40)
      hote.ecrire()
      await attendre(() => texte(hote) === 'b', 1500)
      assert.deepEqual([texte(hote), hote._state.data.isPrototypeOf, plante(hote), erreurs], ['b', 1, [false], []])
    }
    finally { await window.happyDOM.close() }
  })

  it('écrite par `_set` pendant un reffet (chemin ordinaire, rendu en microtâche) : le composant rend la donnée et vit', async () => {
    const { window, hote, erreurs } = await monter({
      'hote.mjs': `
<script>
  $nom = 'a'
</script>

<p>{$nom}</p>
`
    }, 'cles-natives-microtache')
    try {
      // une écriture faite pendant un reffet ne passe pas sur-le-champ : ses liaisons attendent la passe en microtâche
      window.µ._mjs_inEffect = true
      for (const k of NATIVES) hote._set(k, 7)
      hote._set('nom', 'b')
      window.µ._mjs_inEffect = false
      await attendre(() => texte(hote) === 'b', 1500)
      assert.deepEqual([texte(hote), plante(hote), erreurs], ['b', [false], []])
    }
    finally { await window.happyDOM.close() }
  })

  it('reçue en prop (`<mjs-fiche data={$o}>`) : l\'enfant rend la donnée et vit', async () => {
    const { window, hote, erreurs } = await monter({
      'hote.mjs': `
<script>
  $o = JSON.parse('{"nom":"a",${natives(1)}}')
  @changer = -> $o = JSON.parse('{"nom":"b",${natives(11)}}')
</script>

<mjs-fiche data={$o}></mjs-fiche><p>hote</p>
`,
      'fiche.mjs': FICHE
    }, 'cles-natives-prop')
    try {
      const fiche = hote._shadow.querySelector('mjs-fiche')
      await attendre(() => !!fiche._shadow && !!texte(fiche))
      const avant = texte(fiche)
      hote.changer()
      await attendre(() => texte(fiche) === 'b', 1500)
      assert.deepEqual([avant, texte(fiche), plante(hote, fiche), erreurs], ['a', 'b', [false, false], []])
    }
    finally { await window.happyDOM.close() }
  })

  it('rangée dans le magasin (`$$x`), entière puis champ par champ : le composant rend la donnée et vit', async () => {
    const { window, hote, erreurs } = await monter({
      'hote.mjs': `
<script>
  $$x = JSON.parse('{"nom":"a",${natives(1)}}')
  @changer = -> $$x = JSON.parse('{"nom":"b",${natives(11)}}')
  @champ = ->
    $$x.isPrototypeOf = 8
    $$x.valueOf = 9
    $$x.nom = 'c'
</script>

<p>{$$x.nom}</p>
`
    }, 'cles-natives-magasin')
    try {
      const avant = texte(hote)
      hote.changer()
      await attendre(() => texte(hote) === 'b', 1500)
      const puis = texte(hote)
      hote.champ()
      await attendre(() => texte(hote) === 'c', 1500)
      assert.deepEqual([avant, puis, texte(hote), plante(hote), erreurs], ['a', 'b', 'c', [false], []])
    }
    finally { await window.happyDOM.close() }
  })
})
