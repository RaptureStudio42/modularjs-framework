// *shared(clé) — l'élément partagé d'une transition de page : deux balises qui portent la même clé de
// part et d'autre d'une navigation (la vignette d'un produit dans la liste, sa photo dans la page du
// produit) reçoivent le même `view-transition-name`, posé en style sur la balise : le navigateur fait
// glisser et grandir l'une jusqu'à la place de l'autre (le routeur lève les balises nommées hors des
// shadow roots, cf. mjs_vt_presets.ts). La clé : un nombre ou un mot, fixe ou variable (`p.id` dans
// un {for}) ; `group` sépare deux éléments de la même fiche (la photo, le titre).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

describe('*shared — à la compilation', () => {
  it('une clé fixe, un groupe', async () => {
    assert.match(await compiler('<img src="a.png" alt="" *shared(42)>'), /µ\._mjs_fx\(this, _mjs_fxn, "shared", \{"key":42\}\)/)
    assert.match(await compiler('<h2 *shared(bol-bleu, group: titre)>Bol</h2>'), /µ\._mjs_fx\(this, _mjs_fxn, "shared", \{"key":"bol-bleu","group":"titre"\}\)/)
  })

  it('la clé d\'une boucle, suivie', async () => {
    const js = await compiler('<script>\n$produits = [{ id: 1 }]\n</script>\n{for p in $produits by id}<img src="a.png" alt="" *shared(p.id)>{end}')
    assert.match(js, /µ\._mjs_fx\(this, _mjs_fxn, "shared", \{\}, \{"key": \(p\.id\)\}/)
  })

  it('sans clé : le build le dit', async () => {
    await assert.rejects(compiler('<img src="a.png" alt="" *shared>'), /\*shared : la clé manque/)
  })
})

describe('*shared — dans la page', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('effets-shared')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-boutique.mjs'), '<script>\n$produits = [{ id: 1, nom: \'Bol\' }, { id: \'lampe à huile\', nom: \'Lampe\' }]\n$vu = true\n</script>\n{if $vu}\n{for p in $produits by nom}<img class="v" src="a.png" alt="" *shared(p.id)><b class="t" *shared(p.id, group: titre)>{p.nom}</b>{end}\n{end}\n<button class="cache" @click={$vu = false}>x</button>\n<button class="change" @click={$produits = [{ id: 7, nom: \'Bol\' }, $produits[1]]}>c</button>')
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

  const attendre = async (cond: () => boolean) => { const fin = Date.now() + 3000; while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10)) }
  const noms     = (els: any[]) => els.map((e) => e.style.viewTransitionName || e.style.getPropertyValue('view-transition-name'))

  it('chaque balise porte le nom de sa clé, en style (la couche de lévitation du routeur le trouve) ; un nom CSS toujours valide', async () => {
    window.document.body.innerHTML = '<mjs-fx-boutique></mjs-fx-boutique>'
    const comp = window.document.querySelector('mjs-fx-boutique')
    await attendre(() => comp._shadow?.querySelectorAll('.v').length === 2)
    const r = comp._shadow
    assert.deepEqual(noms([...r.querySelectorAll('.v')]), ['mjs-shared-1', 'mjs-shared-lampe_20_e0_20huile'])
    assert.deepEqual(noms([...r.querySelectorAll('.t')]), ['mjs-titre-1', 'mjs-titre-lampe_20_e0_20huile'])
    assert.equal(r.querySelectorAll('[style*="view-transition-name"]').length, 4)
  })

  it('la clé change : le nom suit', async () => {
    const r = window.document.querySelector('mjs-fx-boutique')._shadow
    r.querySelector('.change').click()
    await attendre(() => noms([...r.querySelectorAll('.v')])[0] === 'mjs-shared-7')
    assert.equal(noms([...r.querySelectorAll('.v')])[0], 'mjs-shared-7')
  })

  it('la balise retirée : son nom part avec l\'effet', async () => {
    const r = window.document.querySelector('mjs-fx-boutique')._shadow
    const v = r.querySelector('.v')
    r.querySelector('.cache').click()
    await attendre(() => !r.querySelector('.v'))
    await new Promise((res) => setTimeout(res, 30))
    assert.equal(noms([v])[0], '')
  })
})
