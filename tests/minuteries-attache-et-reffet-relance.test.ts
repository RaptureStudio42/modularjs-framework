// minuteries de passage : posée pendant la partie synchrone d'une attache (`@attach`), une minuterie appartient à cette
// attache — arrêtée au détachement, la prochaine attache en pose une neuve ; posée pendant un passage d'un `µeffect`, elle
// appartient à ce passage — arrêtée quand le passage suivant commence et au retrait du reffet, `always: true` excepté
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
const S  = (...l: string[]) => ['<p>{$x}</p>', '<script lang="coffee">', '$x = 0', ...l, '</script>'].join('\n')
const UN = (cle: string) => 'window.' + cle + ' = (window.' + cle + ' or 0) + 1'
const ATTACHE = ['attacher = (n) ->', '  µevery 20, immediate: false, -> ' + UN('__att'), '  null']

describe('minuteries : attache et reffet relancé', function () {
  this.timeout(60000)
  after(async () => { for (const w of fenetres) await w.happyDOM?.close?.(); await terminateSharedWorkerPool() })

  it('@attach, minuterie hors de la dernière ligne : retrait puis remise du composant, une seule répétition', async () => {
    const { win, doc, el } = await monter('attacheretrait', ['<p :attach={attacher}>a</p>', '<script lang="coffee">', ...ATTACHE, '</script>'].join('\n'))
    assert.equal(el._mjs_minuteries?.size, 1)
    el.remove(); await attendre(40)
    doc.body.appendChild(el); await attendre(40)
    assert.equal(el._mjs_minuteries?.size, 1, 'la répétition de la première attache est arrêtée, la nouvelle attache pose la sienne')
    const a = win.__att ?? 0
    await attendre(200)
    const tirs = (win.__att ?? 0) - a
    assert.ok(tirs <= 12, `une seule répétition de 20 ms : ${tirs} tirs en 200 ms`)
    el.remove()
  })

  it('@attach, minuterie hors de la dernière ligne : la balise retirée par un {if} arrête la sienne', async () => {
    const { win, el } = await monter('attacheif', ['{if $vu}<p :attach={attacher}>a</p>{end}', '<script lang="coffee">', '$vu = true', 'window.__cacher = -> $vu = false', 'window.__montrer = -> $vu = true', ...ATTACHE.map(l => l.replace('__att', '__atti')), '</script>'].join('\n'))
    assert.equal(el._mjs_minuteries?.size, 1)
    win.__cacher(); await attendre(40)
    assert.equal(el._mjs_minuteries?.size, 0, 'détachée avec sa balise')
    const a = win.__atti ?? 0
    await attendre(100)
    assert.equal((win.__atti ?? 0) - a, 0, 'plus aucun tir')
    win.__montrer(); await attendre(40)
    assert.equal(el._mjs_minuteries?.size, 1, 'la nouvelle attache pose la sienne')
    el.remove()
  })

  for (const derniere of [false, true]) {
    it(`µeffect relancé trois fois, µevery ${derniere ? 'en dernière ligne' : 'hors de la dernière ligne'} : une seule répétition`, async () => {
      const cle  = derniere ? '__e2' : '__e1'
      const fin  = derniere ? [] : ['  null']
      const { el, win } = await monter(derniere ? 'reffetder' : 'reffethors', S('$dep = 0', 'window.__changer = -> $dep++', 'µeffect ->', '  $dep', '  µevery 20, immediate: false, -> ' + UN(cle), ...fin))
      assert.equal(el._mjs_minuteries?.size, 1)
      for (let i = 0; i < 3; i++) { win.__changer(); await attendre(30) }
      await attendre(40)
      assert.equal(el._mjs_minuteries?.size, 1, 'la répétition du passage d\'avant est arrêtée par le passage suivant')
      el.remove()
    })
  }

  it('µeffect : un µafter reposé avant son tir ne part qu\'une fois (anti-rebond)', async () => {
    const { el, win } = await monter('reffetrebond', S('$dep = 0', 'window.__changer = -> $dep++', 'µeffect ->', '  $dep', '  µafter 300, -> ' + UN('__e3'), '  null'))
    for (let i = 0; i < 3; i++) { win.__changer(); await attendre(15) }
    await attendre(600)
    assert.equal(win.__e3 ?? 0, 1, 'seul le tir du dernier passage part')
    el.remove()
  })

  it('µeffect : un µafter always: true n\'est pas arrêté par le passage suivant', async () => {
    const { el, win } = await monter('reffetalways', S('$dep = 0', 'window.__changer = -> $dep++', 'µeffect ->', '  $dep', '  µafter 150, always: true, -> ' + UN('__e4'), '  null'))
    for (let i = 0; i < 3; i++) { win.__changer(); await attendre(15) }
    await attendre(500)
    assert.equal(win.__e4 ?? 0, 4, 'un tir par passage')
    el.remove()
  })

  it('µeffect qui rend un nettoyage : le nettoyage joue et la répétition du passage d\'avant s\'arrête', async () => {
    const { el, win } = await monter('reffetnettoie', S('$dep = 0', 'window.__changer = -> $dep++', 'µeffect ->', '  $dep', '  µevery 20, immediate: false, -> ' + UN('__e5'), '  -> ' + UN('__e5n')))
    for (let i = 0; i < 3; i++) { win.__changer(); await attendre(30) }
    await attendre(40)
    assert.equal(win.__e5n ?? 0, 3, 'le nettoyage rendu joue à chaque passage suivant')
    assert.equal(el._mjs_minuteries?.size, 1)
    el.remove()
  })

  it('µeffect retiré par sa main : la répétition de son dernier passage s\'arrête', async () => {
    const { el, win } = await monter('reffetretire', S('arret = µeffect ->', '  µevery 20, immediate: false, -> ' + UN('__e6'), '  null', 'window.__retirer = -> arret()'))
    assert.equal(el._mjs_minuteries?.size, 1)
    win.__retirer(); await attendre(20)
    assert.equal(el._mjs_minuteries?.size, 0, 'arrêtée avec son reffet')
    el.remove()
  })
})
