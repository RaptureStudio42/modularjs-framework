// {if $x} dont le contenu lit `$x.champ` : quand `$x` repasse à null, le contenu de la branche n'est plus jamais
// évalué — y compris quand deux écritures de variables qui pilotent un bloc tombent dans le même tour synchrone
// (un gestionnaire qui écrit `$etape` puis `$x = null`, ou `$x` deux fois de suite). La seconde écriture ne doit
// pas rafraîchir le contenu contre une structure pas encore mise à jour : sinon « Cannot read properties of
// null » et le composant entier tombe en « Fatal Error ». Les écritures d'un même tour gardent leur état final.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const COMPOSANTS: Record<string, string> = {
  // la même variable écrite deux fois dans le même gestionnaire
  'si-double': '<script>\n$x = { champ: \'a\' }\nrelire = ->\n  $x = { champ: \'b\' }\n  $x = null\nouvrir = ->\n  $x = { champ: \'d\' }\n  $x = { champ: \'e\' }\n</script>\n<button class="fermer" @click={relire()}>f</button>\n<button class="ouvrir" @click={ouvrir()}>o</button>\n{if $x}<p>{$x.champ}</p>{end}\n',
  // une autre variable affichée qui pilote un bloc, écrite juste avant la fermeture
  'si-etape': '<script>\n$x = { champ: \'a\' }\n$etape = 1\nfermer = ->\n  $etape = 2\n  $x = null\n</script>\n<span class="etape">{$etape}</span>\n{if $etape > 0}<i>en cours</i>{end}\n<button class="fermer" @click={fermer()}>f</button>\n{if $x}<p>{$x.champ.toUpperCase()}</p>{end}\n'
}

describe('{if} — une branche fermée ne relit plus son contenu, même après deux écritures dans le même tour', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('if-branche-fermee')
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

  it('$x réécrit puis remis à null dans le même gestionnaire : aucune erreur, la branche disparaît', async () => {
    const comp = await monter('si-double')
    assert.equal(comp._shadow.querySelector('p')?.textContent, 'a')
    comp._shadow.querySelector('.fermer').click()
    await pause(80)
    assert.deepEqual(erreurs(), [], 'aucune erreur à la fermeture')
    assert.ok(!comp._mjs_has_crashed, 'le composant ne tombe pas')
    assert.equal(comp._shadow.querySelectorAll('.mjs-fatal-error').length, 0)
    assert.equal(comp._shadow.querySelectorAll('p').length, 0, 'la branche est défaite')
    comp._shadow.querySelector('.ouvrir').click()
    await pause(80)
    assert.equal(comp._shadow.querySelector('p')?.textContent, 'e', 'deux écritures du même tour : l\'état final est affiché')
    assert.deepEqual(erreurs(), [])
  })

  it('une autre variable de bloc écrite juste avant $x = null : aucune erreur, étape à jour, branche défaite', async () => {
    const comp = await monter('si-etape')
    assert.equal(comp._shadow.querySelector('p')?.textContent, 'A')
    comp._shadow.querySelector('.fermer').click()
    await pause(80)
    assert.deepEqual(erreurs(), [], 'aucune erreur à la fermeture')
    assert.ok(!comp._mjs_has_crashed, 'le composant ne tombe pas')
    assert.equal(comp._shadow.querySelectorAll('.mjs-fatal-error').length, 0)
    assert.equal(comp._shadow.querySelectorAll('p').length, 0, 'la branche est défaite')
    assert.equal(comp._shadow.querySelector('.etape')?.textContent, '2')
    assert.equal(comp._shadow.querySelectorAll('i').length, 1)
  })
})
