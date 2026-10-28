// Étage client du journal d'erreurs : avec `µ.config.journal` à false (le défaut), le module bundlé ne pose AUCUN écouteur
// sur window — les deux écouteurs (`error`, `unhandledrejection`) arrivent quand l'application passe le réglage à true,
// même après le chargement du cœur, et repartent quand elle le remet à false.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

describe('runtime — journal client : aucun écouteur tant que le réglage est à false', function () {
  this.timeout(40000)

  let coreCode = ''

  before(async function () {
    const root = mjsTmp('journal-ecouteurs')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'placeholder.mjs'), '<script>\n$x = 0\n</script>\n<div>ph</div>')
    const b     = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), runtime: ['journal'] })
    const stats = await b.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const coeur = readdirSync(join(root, 'out')).find((f: string) => /^mjs_core-/.test(f))!
    coreCode = stripEsm(readFileSync(join(root, 'out', coeur), 'utf-8'))
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  // fenêtre neuve ; relève les écouteurs du journal posés sur window (ceux qui appellent son envoi)
  function fenetre(): { window: any; poses: () => string[] } {
    const window: any = new Window({ url: 'http://localhost/app' })
    const actifs = new Map<any, string>()
    const add    = window.addEventListener.bind(window)
    const remove = window.removeEventListener.bind(window)
    window.addEventListener = (type: string, fn: any, o?: any) => { if (String(fn).includes('_mjs_journalSend')) actifs.set(fn, type); return add(type, fn, o) }
    window.removeEventListener = (type: string, fn: any, o?: any) => { actifs.delete(fn); return remove(type, fn, o) }
    window.eval(`${coreCode}\nglobalThis.µ = µ;`)
    return { window, poses: () => [...actifs.values()].sort() }
  }

  it('µ.config.journal à false (défaut) : aucun écouteur sur window', () => {
    const { window, poses } = fenetre()
    assert.equal(window.µ.config.journal, false)
    assert.deepEqual(poses(), [], 'AVANT : `error` et `unhandledrejection` posés même journal coupé')
  })

  it('passé à true après le chargement : les deux écouteurs arrivent, une erreur part', async () => {
    const { window, poses } = fenetre()
    const envois: string[] = []
    window.navigator.sendBeacon = (url: string) => { envois.push(url); return true }
    window.µ.config.journal = true
    assert.equal(window.µ.config.journal, true)
    assert.deepEqual(poses(), ['error', 'unhandledrejection'])
    window.dispatchEvent(new window.ErrorEvent('error', { message: 'boum', error: new window.Error('boum') }))
    assert.deepEqual(envois, ['/__mjs/errors'])
  })

  it('remis à false : les écouteurs repartent, plus rien n\'est envoyé', () => {
    const { window, poses } = fenetre()
    const envois: string[] = []
    window.navigator.sendBeacon = (url: string) => { envois.push(url); return true }
    window.µ.config.journal = true
    window.µ.config.journal = false
    assert.deepEqual(poses(), [])
    window.dispatchEvent(new window.ErrorEvent('error', { message: 'boum', error: new window.Error('boum') }))
    assert.deepEqual(envois, [])
  })
})
