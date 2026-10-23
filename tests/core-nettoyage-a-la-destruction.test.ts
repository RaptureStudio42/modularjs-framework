// Un champ nombre ou une liste retirés de la page ne laissent rien derrière eux : le champ nombre retire ses trois
// écouteurs de fenêtre (`pointerup`, `pointercancel`, `blur`) et la liste débranche ses observateurs de mutations
// (options, balise hôte, étiquettes). Sans ça, chaque affichage puis retrait d'un {if} en accumule un de plus.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const HOST = `<script>
$nombre = false
$liste  = false
</script>
{if $nombre}<@@number value="3" min="0" max="9"></@@number>{end}
{if $liste}<@@select name="s"><@@option value="x">X</@@option><@@option value="y">Y</@@option></@@select>{end}`

// compte les écouteurs de fenêtre vivants par type, et les observateurs de mutations vivants ; celui des options
// d'une liste est le seul à guetter aussi le texte (`characterData`)
const ESPION = `(() => {
  const NatifObs = window.MutationObserver
  window.__obs = new Set()
  window.MutationObserver = class extends NatifObs {
    observe(...a) { this.surveilleLeTexte = !!a[1]?.characterData; window.__obs.add(this); return super.observe(...a) }
    disconnect() { window.__obs.delete(this); return super.disconnect() }
  }
  window.__ecouteurs = {}
  const ajoute = window.addEventListener.bind(window)
  const retire = window.removeEventListener.bind(window)
  window.addEventListener = (type, fn, ...r) => {
    const m = window.__ecouteurs[type] ||= new Set()
    m.add(fn)
    return ajoute(type, fn, ...r)
  }
  window.removeEventListener = (type, fn, ...r) => {
    window.__ecouteurs[type]?.delete(fn)
    return retire(type, fn, ...r)
  }
})()`

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('nettoyage à la destruction — champ nombre et liste', function () {
  this.timeout(60000)
  let window: any
  let host: any
  const optionsGuettees = (): number => [...window.__obs].filter((o: any) => o.surveilleLeTexte).length
  const ecouteurs = (type: string): number => window.__ecouteurs[type]?.size ?? 0
  const basculer  = async (nom: string, valeur: boolean) => { host._set(nom, valeur); await wait(150) }

  before(async () => {
    const root   = mjsTmp('core-nettoyage-destruction')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOST)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const code  = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(ESPION)
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
    host = window.document.querySelector('mjs-hote')
    await wait(200)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  for (const type of ['pointerup', 'pointercancel', 'blur']) {
    it(`le champ nombre retiré rend son écouteur « ${type} » de la fenêtre`, async () => {
      const avant = ecouteurs(type)
      await basculer('nombre', true)
      assert.equal(ecouteurs(type), avant + 1, `préalable : le champ pose « ${type} » à son montage`)
      await basculer('nombre', false)
      assert.equal(ecouteurs(type), avant, `« ${type} » doit être retiré quand le champ part`)
    })
  }

  it('la liste retirée débranche l\'observateur de ses options', async () => {
    const avant = optionsGuettees()
    await basculer('liste', true)
    assert.ok(optionsGuettees() > avant, 'préalable : la liste guette ses options à son montage')
    await basculer('liste', false)
    assert.equal(optionsGuettees(), avant, 'l\'observateur des options ne survit pas à la liste')
  })
})
