// La silhouette d'attente d'un composant (`*skeleton`, `effects.skeleton` ∋ 'components') est posée
// dans sa balise tant que son code arrive, puis retirée juste avant l'enregistrement. Un composant
// rangé dans un dossier a aussi une balise courte (`doc/doc-carte.mjs` → `<mjs-carte>`) : sa
// silhouette doit partir de la même façon, sinon ses barres scintillent à vie dans la carte (projetées
// dans son <slot>). Le registre des silhouettes ne retient pas non plus une balise retirée avant
// l'arrivée du code.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

describe('silhouette d\'attente : retirée aussi pour la balise courte d\'un composant', function () {
  this.timeout(60000)
  let coeur    = ''
  let composant = ''

  before(async () => {
    const root   = mjsTmp('silhouette-alias')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(join(srcDir, 'doc'), { recursive: true })
    writeFileSync(join(srcDir, 'doc', 'doc-carte.mjs'), '<p class="c"><slot></slot></p>')
    writeFileSync(join(srcDir, 'attente.mjs'), '<div class="a" *skeleton></div>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const lire  = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : 1
    coeur     = files.filter((f) => f.startsWith('mjs_')).sort((a, b) => rang(a) - rang(b)).map(lire).join('\n')
    composant = files.filter((f) => /doc-carte/.test(f)).map(lire).join('\n')
    assert.match(composant, /µ\._al\(/, 'le composant enregistre sa balise courte')
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('<mjs-carte> en attente : sa silhouette part à l\'arrivée du code, comme celle de <mjs-doc-carte>', async () => {
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`${coeur}\nglobalThis.µ = µ; µ._skels = { 'doc-carte': '<i mjs-skel="m"></i>', carte: '<i mjs-skel="m"></i>' };`)
    window.document.body.innerHTML = '<mjs-doc-carte></mjs-doc-carte><mjs-carte></mjs-carte>'
    const longue = window.document.querySelector('mjs-doc-carte')
    const courte = window.document.querySelector('mjs-carte')
    assert.ok(window.µ._mjs_skelShow(longue), 'silhouette posée sur la balise longue')
    assert.ok(window.µ._mjs_skelShow(courte), 'silhouette posée sur la balise courte')
    window.eval(composant)
    await new Promise((r) => setTimeout(r, 30))
    const reste = (tag: string) => {
      const el = window.document.querySelector(tag)
      return { zones: el.querySelectorAll('[mjs-skel-zone]').length, hote: el.hasAttribute('mjs-skel-host') }
    }
    assert.deepEqual(reste('mjs-doc-carte'), { zones: 0, hote: false })
    assert.deepEqual(reste('mjs-carte'), { zones: 0, hote: false })
    window.close()
  })

  it('une balise retirée avant l\'arrivée du code : sa zone quitte le registre des silhouettes', async () => {
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`${coeur}\nglobalThis.µ = µ; µ._skels = { 'doc-carte': '<i mjs-skel="m"></i>' };`)
    window.document.body.innerHTML = '<div class="z"><mjs-doc-carte></mjs-doc-carte></div>'
    const el  = window.document.querySelector('mjs-doc-carte')
    const off = window.µ._mjs_fx(null, el, 'skeleton', {})
    const zone = el.querySelector('[mjs-skel-zone]')
    assert.ok(zone, 'la silhouette est posée par l\'effet')
    // la zone retirée (l'effet défait), puis la balise elle-même : plus rien ne doit la retenir
    off()
    el.remove()
    // l'arrivée du code : la zone retirée n'est plus dans le registre, rien à défaire
    let retiree = 0
    const remove0 = window.Element.prototype.remove
    window.Element.prototype.remove = function (this: any) {
      if (this === zone) retiree++
      return remove0.call(this)
    }
    try {
      window.eval(composant)
    }
    finally {
      window.Element.prototype.remove = remove0
    }
    assert.equal(retiree, 0, 'la zone déjà défaite est encore dans le registre')
    window.close()
  })
})
