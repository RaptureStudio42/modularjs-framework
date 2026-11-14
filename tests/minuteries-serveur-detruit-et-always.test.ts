// µafter / µevery : rien ne part pendant le rendu serveur, rien ne part pour un composant déjà détruit, et `always: true`
// n'est jamais défait par la fonction qui rend la main d'arrêt (µmount, @attach, µeffect, gestionnaire)
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { renderToString } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, '\'http://localhost/\'')
const attendre = (ms: number) => new Promise(r => setTimeout(r, ms))
const fenetres: any[] = []
const coffee   = (...l: string[]) => ['<script lang="coffee">', ...l, '</script>'].join('\n')

async function monter(nom: string, source: string) {
  const root   = mjsTmp('minuteries-sda-' + nom)
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

// plafond d'attente court : une promesse jamais tenue rend la branche d'attente du bloc {await}
async function rendreAuServeur(nom: string, source: string): Promise<string> {
  const root   = mjsTmp('minuteries-ssr-' + nom)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, nom + '.mjs'), source)
  const res: any = await renderToString({ sourceDir: srcDir, tag: 'mjs-' + nom, settleMs: 300 })
  return String(res.html)
}

const ATTENTE = '{await $p}<span class="pending">attente</span>{success val}<span class="done">{val}</span>{end}'
const bouton  = (el: any) => (el._shadow ?? el.shadowRoot ?? el).querySelector('button.b')

describe('minuteries : rien ne part pendant le rendu serveur', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('await µafter dans la promesse d\'un bloc {await}, après un premier await : le rendu envoie l\'état d\'attente', async () => {
    const html = await rendreAuServeur('ssrattente', coffee('$p = do ->', '  await Promise.resolve()', '  await µafter 30', '  \'FINI\'') + '\n' + ATTENTE)
    assert.ok(html.includes('class="pending"') && !html.includes('FINI'), html)
  })

  it('µafter posé par un µeffect ne tire pas', async () => {
    const html = await rendreAuServeur('ssreffet', coffee('tenir = null', '$p = new Promise (t) -> tenir = t', 'µeffect ->', '  µafter 20, -> tenir(\'EFFET\')', '  null') + '\n' + ATTENTE)
    assert.ok(html.includes('class="pending"') && !html.includes('EFFET'), html)
  })

  it('µevery posé par un µeffect ne tire pas', async () => {
    const html = await rendreAuServeur('ssrrepete', coffee('tenir = null', '$p = new Promise (t) -> tenir = t', 'µeffect ->', '  µevery 10, -> tenir(\'TIC\')', '  null') + '\n' + ATTENTE)
    assert.ok(html.includes('class="pending"') && !html.includes('TIC'), html)
  })

  it('µevery à la racine du script ne tire pas', async () => {
    const html = await rendreAuServeur('ssrracine', coffee('tenir = null', '$p = new Promise (t) -> tenir = t', 'µevery 10, -> tenir(\'RACINE\')') + '\n' + ATTENTE)
    assert.ok(html.includes('class="pending"') && !html.includes('RACINE'), html)
  })
})

describe('minuteries : rien ne part pour un composant déjà détruit', function () {
  this.timeout(60000)
  after(async () => { for (const w of fenetres) w.happyDOM?.abort?.(); await terminateSharedWorkerPool() })

  // le gestionnaire attend une promesse tenue APRÈS le retrait du composant, puis pose sa minuterie
  const gabarit = (suite: string[]) => ['<button class="b" @click={-> plusTard()}>b</button>', '<script lang="coffee">', 'µmount -> null', 'plusTard = ->', '  await new Promise (r) -> window.__libere = r', ...suite, '  null', '</script>'].join('\n')
  const CAS: [string, string[]][] = [
    ['µafter 20, -> …', ['  µafter 20, -> window.__k = (window.__k or 0) + 1']],
    ['await µafter 20 puis la suite', ['  await µafter 20', '  window.__k = (window.__k or 0) + 1']],
    ['µevery 20, -> …', ['  µevery 20, -> window.__k = (window.__k or 0) + 1']]
  ]
  CAS.forEach(([quoi, suite], i) => {
    it(quoi + ' : part sur un composant présent, jamais sur un composant retiré', async () => {
      const present = await monter('present' + i, gabarit(suite))
      bouton(present.el).click()
      await attendre(10)
      present.win.__libere()
      await attendre(150)
      assert.ok((present.win.__k ?? 0) >= 1, 'témoin : la minuterie part sur un composant présent')
      const { win, el } = await monter('retire' + i, gabarit(suite))
      bouton(el).click()
      await attendre(10)
      el.remove()
      await attendre(40)
      win.__libere()
      await attendre(150)
      assert.equal(win.__k ?? 0, 0)
    })
  })
})

describe('minuteries : `always: true` jamais défait', function () {
  this.timeout(60000)
  after(async () => { for (const w of fenetres) w.happyDOM?.abort?.(); await terminateSharedWorkerPool() })

  const tir = '-> window.__tir = (window.__tir or 0) + 1'
  const CAS: [string, string][] = [
    ['main rendue par µmount (dernière ligne)', '<p>a</p>\n' + coffee('µmount ->', '  µafter 60, always: true, ' + tir)],
    ['main rendue par @attach', '<div class="d" :attach={attacher}>d</div>\n' + coffee('attacher = (n) -> µafter 60, always: true, ' + tir)],
    ['main rendue par un µeffect (dernière ligne)', '<p>a</p>\n' + coffee('µeffect ->', '  µafter 60, always: true, ' + tir)]
  ]
  CAS.forEach(([quoi, source], i) => {
    it(quoi + ' : le tir part après le retrait du composant', async () => {
      const { win, el } = await monter('toujours' + i, source)
      el.remove()
      await attendre(200)
      assert.equal(win.__tir ?? 0, 1)
    })
  })

  it('main rendue par un gestionnaire : le tir part après le retrait du composant', async () => {
    const { win, el } = await monter('toujoursclic', '<button class="b" @click={-> µafter 60, always: true, ' + tir + '}>b</button>\n' + coffee('x = 0'))
    bouton(el).click()
    el.remove()
    await attendre(200)
    assert.equal(win.__tir ?? 0, 1)
  })

  it('sans always, la main rendue par µmount reste son nettoyage : rien ne part après le retrait', async () => {
    const { win, el } = await monter('sanstoujours', '<p>a</p>\n' + coffee('µmount ->', '  µafter 60, ' + tir))
    el.remove()
    await attendre(200)
    assert.equal(win.__tir ?? 0, 0)
  })

  it('µmount qui finit par µevery, composant retiré puis remis : une seule répétition', async () => {
    const { doc, el } = await monter('remis', '<p>a</p>\n' + coffee('µmount ->', '  µevery 20, -> window.__n = (window.__n or 0) + 1'))
    el.remove()
    await attendre(60)
    doc.body.appendChild(el)
    await attendre(40)
    assert.equal(el._mjs_minuteries?.size, 1)
  })
})
