// {elsif $x} dont le contenu lit `$x.champ` : quand `$x` repasse à null, la branche n'est plus jamais évaluée — y compris quand
// deux écritures de variables qui pilotent des blocs tombent dans le même tour synchrone (un gestionnaire qui écrit `$etape` puis
// `$x = null`, ou l'inverse). Même règle que pour `{if $x}` (cf. if-branche-fermee-deux-ecritures-meme-tour.test.ts) : une
// lecture sous une branche `{elsif}` n'est pas rejouée contre une structure pas encore mise à jour, sinon « Cannot read
// properties of null » et le composant entier tombe en « Fatal Error ». L'état final est celui des écritures, `{else}` compris.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// le composant : deux variables qui pilotent des blocs (`$etape` et `$x`), un bouton qui les écrit dans le même tour
const gabarit = (ecritures: string, bloc: string) => `<script>
$x = { champ: 'a' }
$etape = 1
$phase = 'result'
back = ->
${ecritures}
</script>
<span class="etape">{$etape}</span>
{if $etape > 0}<i>en cours</i>{end}
${bloc}
<button class="back" @click={back()}>back</button>
`
const ETAPE_PUIS_X = '  $etape = 2\n  $x = null'
const X_PUIS_ETAPE = '  $x = null\n  $etape = 2'

const COMPOSANTS: Record<string, string> = {
  // {elsif $x} sous un {if} qui porte sur une autre variable
  'elsif-simple': gabarit(ETAPE_PUIS_X, `{if $phase is 'ask'}<p class="ask">ask</p>{elsif $x}<p class="res">{$x.champ.toUpperCase()}</p>{end}`),
  // la même lecture écrite avec ?.
  'elsif-optionnel': gabarit(ETAPE_PUIS_X, `{if $phase is 'ask'}<p class="ask">ask</p>{elsif $x}<p class="res">{$x?.champ?.toUpperCase()}</p>{end}`),
  // {elsif} suivi d'un {else}, écritures dans l'autre ordre
  'elsif-sinon': gabarit(X_PUIS_ETAPE, `{if $phase is 'ask'}<p class="ask">ask</p>{elsif $x}<p class="res">{$x.champ.toUpperCase()}</p>{else}<p class="vide">vide</p>{end}`)
}

describe('{elsif} — une branche fermée ne relit plus son contenu, même après deux écritures dans le même tour', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('if-elsif-branche-fermee')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, `${nom}.mjs`), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;\nglobalThis.__erreurs = [];\nµ.error = function(...a) { globalThis.__erreurs.push(a.map(String).join(' ')); };`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // copie dans le domaine de Node : un tableau né dans la fenêtre n'est jamais deepEqual à []
  const erreurs = () => [...window.eval('globalThis.__erreurs')]

  async function monter(nom: string) {
    window.eval('globalThis.__erreurs.length = 0')
    window.document.body.innerHTML = `<mjs-${nom}></mjs-${nom}>`
    const comp = window.document.querySelector(`mjs-${nom}`)
    await pause(120)
    return comp
  }

  async function fermer(comp: any) {
    comp._shadow.querySelector('.back').click()
    await pause(80)
    assert.deepEqual(erreurs(), [], 'aucune erreur à la fermeture')
    assert.ok(!comp._mjs_has_crashed, 'le composant ne tombe pas')
    assert.equal(comp._shadow.querySelectorAll('.mjs-fatal-error').length, 0)
    assert.equal(comp._shadow.querySelectorAll('.res').length, 0, 'la branche {elsif} est défaite')
    assert.equal(comp._shadow.querySelector('.etape')?.textContent, '2', 'l\'autre variable est à jour')
    assert.equal(comp._shadow.querySelectorAll('i').length, 1)
  }

  it('{elsif $x} : $etape puis $x = null dans le même gestionnaire, aucune erreur et la branche disparaît', async () => {
    const comp = await monter('elsif-simple')
    assert.equal(comp._shadow.querySelector('.res')?.textContent, 'A')
    await fermer(comp)
    assert.equal(comp._shadow.querySelectorAll('.ask').length, 0)
  })

  it('{elsif $x} avec ?. dans la lecture : même résultat', async () => {
    const comp = await monter('elsif-optionnel')
    assert.equal(comp._shadow.querySelector('.res')?.textContent, 'A')
    await fermer(comp)
    assert.equal(comp._shadow.querySelectorAll('.ask').length, 0)
  })

  it('{elsif $x}{else} : $x = null puis $etape, aucune erreur et la branche {else} s\'affiche', async () => {
    const comp = await monter('elsif-sinon')
    assert.equal(comp._shadow.querySelector('.res')?.textContent, 'A')
    assert.equal(comp._shadow.querySelectorAll('.vide').length, 0)
    await fermer(comp)
    assert.equal(comp._shadow.querySelector('.vide')?.textContent, 'vide', 'l\'état final est affiché')
  })
})
