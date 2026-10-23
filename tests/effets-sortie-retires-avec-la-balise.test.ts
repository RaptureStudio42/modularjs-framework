// Un effet qui se joue en sortie (`@out=*scramble`) est reposé sur la balise pendant sa sortie : à son
// départ définitif, il doit partir avec elle — sinon sa poignée reste inscrite dans le composant, qui
// retient la balise retirée (et ses observateurs, ses minuteries) jusqu'à sa propre destruction, une
// de plus à chaque sortie.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'sortie-jeu': '<script>\n$vu = true\n</script>\n<div class="box">{if $vu}<p class="p" @out=*scramble(speed: 10)>ABC</p>{end}</div>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('effet joué en sortie : il part avec la balise', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-sortie-retires')
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

  it('@out=*scramble, quatre sorties : aucune poignée qui s\'accumule, aucune balise retirée encore habillée', async () => {
    window.document.body.innerHTML = '<mjs-sortie-jeu></mjs-sortie-jeu>'
    const comp = window.document.querySelector('mjs-sortie-jeu')
    await attendre(() => !!comp._shadow?.querySelector('.p'))
    const poignees = () => (comp._mjs_attachments ? comp._mjs_attachments.size : 0)
    const depart   = poignees()
    const partis: any[] = []
    for (let i = 0; i < 4; i++) {
      partis.push(comp._shadow.querySelector('.p'))
      comp._set('vu', false)
      await attendre(() => !comp._shadow.querySelector('.p'))
      assert.equal(!!comp._shadow.querySelector('.p'), false, 'sortie ' + (i + 1) + ' : la balise est partie')
      comp._set('vu', true)
      await attendre(() => !!comp._shadow.querySelector('.p'))
    }
    assert.equal(poignees(), depart, 'poignées d\'effets inscrites dans le composant')
    assert.deepEqual(partis.map((p) => !!p._mjs_fxOff), [false, false, false, false], 'balises retirées encore habillées')
  })
})
