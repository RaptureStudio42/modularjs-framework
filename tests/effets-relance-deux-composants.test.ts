// Un effet posé sur la même balise par deux composants (deux composants qui écrivent le même effet sur
// <@document>) reste tant que l'un des deux est affiché. Relancé — un réglage de comportement changé
// (µ._mjs_fxSet), le passage aux effets économes (µ._mjs_fxGoLite) —, il garde ses deux composants :
// la destruction du premier ne l'emporte pas.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'deux-poses': '<button class="b" *shake(on: click)>ok</button>\n<p class="s" *sparkles>✦</p>',
}

describe('effet posé par deux composants : relancé, il garde les deux', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('relance-deux-composants')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // un composant réduit à ce que lit le moteur : ses poignées, défaites à sa destruction
  const composant = () => ({ _mjs_attachments: new Set<any>() })
  const detruire  = (c: any) => { for (const h of Array.from(c._mjs_attachments)) (h as any)() }

  it('réglage de comportement changé (µ._mjs_fxSet) : la destruction du premier composant ne retire pas l\'effet', () => {
    const el = window.document.createElement('button')
    window.document.body.appendChild(el)
    const a = composant()
    const b = composant()
    window.µ._mjs_fx(a, el, 'shake', { on: 'click' })
    window.µ._mjs_fx(b, el, 'shake', { on: 'click' })
    window.µ._mjs_fxSet(el, 'shake', { on: 'hover' }, null)
    assert.equal(el._mjs_fxOff.shake._s.on, 'hover', 'relancé avec son nouveau réglage')
    detruire(a)
    assert.equal(!!(el._mjs_fxOff && el._mjs_fxOff.shake), true, 'le second composant est encore là')
    detruire(b)
    assert.equal(!!(el._mjs_fxOff && el._mjs_fxOff.shake), false, 'plus aucun composant : l\'effet part')
  })

  it('effets économes (µ._mjs_fxGoLite) : même chose pour un effet lourd relancé', () => {
    const el = window.document.createElement('p')
    el.textContent = 'x'
    window.document.body.appendChild(el)
    const a = composant()
    const b = composant()
    window.µ._mjs_fx(a, el, 'sparkles', {})
    window.µ._mjs_fx(b, el, 'sparkles', {})
    const avant = el._mjs_fxOff.sparkles
    window.µ._mjs_fxGoLite()
    assert.equal(el._mjs_fxOff.sparkles !== avant, true, 'relancé en économe')
    detruire(a)
    assert.equal(!!(el._mjs_fxOff && el._mjs_fxOff.sparkles), true, 'le second composant est encore là')
    detruire(b)
    assert.equal(!!(el._mjs_fxOff && el._mjs_fxOff.sparkles), false)
  })
})
