// `*trail` (particules, rayons, fumée, anneau, images) est retiré de la bibliothèque : une appli qui l'écrit encore
// s'arrête à la construction, avec un message qui dit que l'effet n'existe plus (en français et en anglais), sur une
// balise comme sur <@document> ; le catalogue, les modules du cœur et la liste des effets de page ne le portent plus.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { parseEffect, EFFECTS } from '../src/effects/catalog.js'
import { setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ICI = dirname(fileURLToPath(import.meta.url))

describe('*trail : un effet retiré', () => {
  afterEach(() => setMessagesLang('fr'))
  after(async () => { await terminateSharedWorkerPool() })

  it('le catalogue ne le connaît plus, ni son module d\'exécution', () => {
    assert.ok(!('trail' in EFFECTS), 'plus de ligne `trail` dans EFFECTS')
    assert.ok(!existsSync(join(ICI, '../src/runtime/mjs_fx_trail.ts')), 'plus de module mjs_fx_trail')
  })

  it('sur une balise : la compilation s\'arrête, le message dit qu\'il a été retiré', async () => {
    await assert.rejects(transpile('<div *trail(images, images: [a.jpg])>x</div>', { moduleName: 'trail-retire' }), (e: Error) => {
      assert.match(e.message, /\*trail[^\n]*effet inconnu/)
      assert.match(e.message, /retiré de la bibliothèque/)
      assert.ok(!/\*trail,/.test(e.message.split('disponibles')[1]), 'il ne se propose pas lui-même')
      return true
    })
  })

  it('sur <@document> : l\'erreur est signalée, avec le même message', async () => {
    const { data } = await transpile('<@document *trail(rays)></@document>\n<p>x</p>\n', { moduleName: 'trail-retire-doc' })
    assert.equal(data.macroErrors.length, 1, JSON.stringify(data.macroErrors))
    assert.match(data.macroErrors[0], /\*trail[^\n]*effet inconnu/)
    assert.match(data.macroErrors[0], /retiré de la bibliothèque/)
  })

  it('sur <@window> : le même message, pas « ne se pose pas sur <@window> »', async () => {
    const { data } = await transpile('<@window *trail></@window>\n<p>x</p>\n', { moduleName: 'trail-retire-window' })
    assert.equal(data.macroErrors.length, 1, JSON.stringify(data.macroErrors))
    assert.match(data.macroErrors[0], /retiré de la bibliothèque/)
    assert.doesNotMatch(data.macroErrors[0], /ne se pose pas/)
  })

  it('en anglais', () => {
    setMessagesLang('en')
    assert.throws(() => parseEffect('trail', ''), /\*trail: unknown effect — it was removed from the library/)
  })

  it('le message vouvoie ou ne s\'adresse à personne : aucun « tu »', () => {
    for (const lang of ['fr', 'en'] as const) {
      setMessagesLang(lang)
      assert.throws(() => parseEffect('trail', ''), (e: Error) => !/\b(tu|ton|ta|tes|toi|your)\b/i.test(e.message))
    }
  })

  it('la construction d\'une appli qui l\'écrit encore s\'arrête sur une erreur qui le nomme', async function () {
    this.timeout(60000)
    const root   = mjsTmp('trail-retire')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-ancien.mjs'), '<div class="a" *trail(smoke)>x</div>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.ok(stats.errors.length > 0, 'la construction ne passe pas')
    const texte = stats.errors.map((e: any) => e.message).join('\n')
    assert.match(texte, /\*trail[^\n]*effet inconnu/)
    assert.match(texte, /retiré de la bibliothèque/)
  })
})
