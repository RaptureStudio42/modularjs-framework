// une minuterie posée pendant un µmount ou un passage d'un µeffect appartient à ce passage : arrêtée au retrait du
// composant, le passage rejoué au retour en pose une neuve — jamais deux pour une ; posée par une méthode, elle est
// suspendue puis reprise au retour ; avec `always: true`, elle part après le retrait
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")
const attendre = (ms: number) => new Promise(r => setTimeout(r, ms))
const fenetres: any[] = []

async function monter(nom: string, source: string) {
  const root   = mjsTmp('minuteries-passage-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, nom + '.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const win: any = new Window({ url: 'http://localhost/' })
  fenetres.push(win)
  const files    = readdirSync(outDir)
  const coreFile = files.find((f: string) => /^mjs_core-/.test(f))!
  const compFile = files.find((f: string) => new RegExp('^' + nom + '-').test(f))!
  win.eval(`${stripEsm(readFileSync(join(outDir, coreFile), 'utf-8'))}\nglobalThis.µ = µ;\n${stripEsm(readFileSync(join(outDir, compFile), 'utf-8'))}`)
  const doc: any = win.document
  const el: any  = doc.createElement('mjs-' + nom)
  doc.body.appendChild(el)
  await attendre(20)
  return { win, doc, el }
}

const S = (...l: string[]) => ['<p>{$x}</p>', '<script lang="coffee">', '$x = 0', ...l, '</script>'].join('\n')

describe('minuteries : posées par un passage de µmount ou de µeffect, composant retiré puis remis', function () {
  this.timeout(60000)
  after(async () => {
    for (const w of fenetres) await w.happyDOM?.close?.()
    await terminateSharedWorkerPool()
  })

  for (const [nom, rune] of [['passmontage', 'µmount'], ['passreffet', 'µeffect']] as const) {
    it(`${rune} : µevery hors de la dernière ligne, une seule répétition après retrait et remise`, async () => {
      const { win, doc, el } = await monter(nom, S(rune + ' ->', '  µevery 20, immediate: false, -> window.__n = (window.__n or 0) + 1', '  null'))
      await attendre(10)
      assert.equal(el._mjs_minuteries?.size, 1)
      let a = win.__n ?? 0
      await attendre(300)
      const avant = (win.__n ?? 0) - a
      el.remove()
      await attendre(40)
      doc.body.appendChild(el)
      await attendre(40)
      assert.equal(el._mjs_minuteries?.size, 1, 'une seule minuterie dans le registre après retrait et remise')
      a = win.__n ?? 0
      await attendre(300)
      const apres = (win.__n ?? 0) - a
      assert.ok(avant > 0 && apres > 0, `tirs par 300 ms : avant ${avant}, après ${apres}`)
      assert.ok(apres <= avant * 1.6 + 3, `aucun doublon : tirs par 300 ms avant ${avant}, après ${apres}`)
    })
  }

  it('méthode : la répétition est suspendue au retrait, puis reprend au retour', async () => {
    const { win, doc, el } = await monter('passmethode', S('window.__poser = -> µevery 20, immediate: false, -> window.__m = (window.__m or 0) + 1'))
    win.__poser()
    await attendre(100)
    assert.ok((win.__m ?? 0) > 0, 'la répétition tourne')
    el.remove()
    await attendre(40)
    const pendant = win.__m ?? 0
    await attendre(100)
    assert.equal(win.__m ?? 0, pendant, 'rien ne part tant que le composant est hors de la page')
    doc.body.appendChild(el)
    await attendre(40)
    const retour = win.__m ?? 0
    await attendre(150)
    assert.ok((win.__m ?? 0) > retour, 'reprise au retour')
    assert.equal(el._mjs_minuteries?.size, 1)
  })

  it('µmount : µafter … always: true hors de la dernière ligne part après le retrait', async () => {
    const { win, el } = await monter('passtoujours', S('µmount ->', '  µafter 60, always: true, -> window.__t = (window.__t or 0) + 1', '  null'))
    await attendre(10)
    el.remove()
    await attendre(150)
    assert.equal(win.__t ?? 0, 1)
  })
})
