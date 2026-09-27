// Régression — panneau de dev (mjs_devpanel.ts, onglet État) : le filtre masquait TOUTE clé
// d'état commençant par « _ ». Or `$_nom` est un nom de variable d'état VALIDE (SIGIL_ID =
// '[a-zA-Z_][a-zA-Z0-9_]*', src/sigils.ts — underscore autorisé en 1re position, c'est même
// l'exemple du framework pour µread/µwrite), et se compile en une clé `_state` du même nom, SANS
// préfixe `_mjs_`. Une variable applicative ainsi nommée disparaissait donc de l'onglet État,
// sans le moindre signal. Le filtre ne doit exclure que la plomberie INTERNE du framework
// (préfixe `_mjs_`), jamais un nom d'utilisateur qui commence juste par un underscore.
//
// Pipeline RÉEL (Bundler → composant compilé puis monté dans happy-dom), même patron que
// devpanel.test.ts (cf. son en-tête) : jamais une copie recodée à la main du panneau.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANT = [
  '<script>',
  '$_secret ?= 42',
  '$visible ?= 1',
  '</script>',
  '<p class="t">{$visible}</p>',
].join('\n')

async function compiler() {
  const root   = mjsTmp('devpanel-underscore')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'dp-secret.mjs'), COMPOSANT)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir)
  await bundler.close()
  return { outDir, files }
}

function charger(outDir: string, files: string[]) {
  const window: any = new Window({ url: 'http://localhost/' })
  const lire = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
  window.eval(`${lire(files.find(f => /^mjs_core-/.test(f))!)}\nglobalThis.µ = µ;`)
  window.eval(lire(files.find(f => /^dp-secret-[a-f0-9]{8}\.js$/.test(f))!))
  return window
}

describe("mjs_devpanel — onglet État : une variable préfixée d'un underscore ($_x) reste visible", function () {
  this.timeout(60000)

  after(async () => { await terminateSharedWorkerPool() })

  it("$_secret figure dans l'onglet État, aux côtés de $visible", async () => {
    const { outDir, files } = await compiler()
    const window = charger(outDir, files)
    window.document.body.innerHTML = '<mjs-dp-secret></mjs-dp-secret>'
    await new Promise(r => setTimeout(r, 60))
    const el: any = window.document.body.firstElementChild
    assert.equal(el._state._secret, 42, 'la compilation doit bien poser la clé `_secret` (sans préfixe _mjs_) sur _state')

    window.µ.devPanel(true)
    const racine = window.document.querySelector('[data-mjs-devpanel]').shadowRoot
    racine.querySelectorAll('.ligne')[0].dispatchEvent(new window.Event('click', { bubbles: true }))

    const etatTexte = racine.querySelector('.onglet-corps').textContent
    assert.match(etatTexte, /_secret/, `\$_secret doit apparaître dans l'onglet État :\n${etatTexte}`)
    assert.match(etatTexte, /\$?visible/, etatTexte)
    window.µ.devPanel(false)
  })
})
