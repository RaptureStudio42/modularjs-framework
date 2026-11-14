// la classe conditionnelle d'une ligne (`:class{cond}="x"`) qui n'est pas dans son gabarit : une ligne neuve naît sans elle, sa garde est
// posée à faux dès sa fabrication et aucune bascule (`classList.toggle(…, false)`) ne part tant que la condition est fausse. La classe
// reste juste partout : ligne neuve après un vidage (une classe posée avant ne la suit pas), classe écrite aussi dans le gabarit, condition qui lit
// la ligne, et ligne écrite par le serveur puis reprise (Chromium, Firefox et WebKit réels)

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const liste = (ligne: string) => [
  '<script lang="js">',
  '  $data = µ.raw([]);',
  '  $selected = -1;',
  '  @poser = function(a) { $data = a; };',
  '  @select = function(id) { $selected = id; };',
  '</script>',
  '<table><tbody>',
  '  {for row in $data by id}',
  `    ${ligne}`,
  '  {end}',
  '</tbody></table>'
].join('\n')

const SOURCES: Record<string, string> = {
  'clstable.mjs': liste('<tr :class{$selected === row.id}="danger"><td class="id">{row.id}</td><td><a class="sel" @click={@select(row.id)}>{row.label}</a></td></tr>'),
  'clsligne.mjs': liste('<tr :class{row.on}="on"><td class="id">{row.id}</td></tr>'),
  'clsecrite.mjs': liste('<tr class="on" :class{row.on}="on"><td class="id">{row.id}</td></tr>')
}

const tic = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) }

describe('{for} — classe conditionnelle absente du gabarit : aucune bascule à la création, classe juste partout', function () {
  this.timeout(60000)
  let win: any, µ: any
  const els: any = {}
  let bascules = 0

  before(async () => {
    const root = mjsTmp('for-classe-absente')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    win = new Window({ url: 'http://localhost/' })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    const code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = '<mjs-clstable></mjs-clstable><mjs-clsligne></mjs-clsligne><mjs-clsecrite></mjs-clsecrite>'
    for (const el of win.document.body.children) els[el.localName.slice(4)] = el
    µ = win.µ
    // chaque bascule de classe, comptée
    const proto = Object.getPrototypeOf(win.document.createElement('div').classList)
    const avant = proto.toggle
    proto.toggle = function(...a: any[]) { bascules++; return avant.apply(this, a) }
    await tic()
  })
  after(async () => { win?.close?.(); await terminateSharedWorkerPool() })

  const ombre = (el: any) => el._shadow || el.shadowRoot
  const ligne = (id: number, on = false) => µ.raw({ id, label: 'L' + id, on })
  const ids = (a: number, b: number) => { const r: any[] = []; for (let i = a; i <= b; i++) r.push(ligne(i)); return r }
  const poser = async (el: any, a: any[]) => { el.poser(µ.raw(a)); await tic() }
  const compte = async (fn: () => Promise<void>) => { bascules = 0; await fn(); return bascules }
  const avecClasse = (el: any, cls: string) => (Array.from(ombre(el).querySelectorAll('tbody > tr')) as any[]).filter((tr) => tr.classList.contains(cls)).map((tr) => +tr.querySelector('.id').textContent)

  it('300 lignes neuves, aucune sélectionnée : aucune bascule de classe', async () => {
    const el = els.clstable
    const n = await compte(() => poser(el, ids(1, 300)))
    assert.equal(n, 0, 'bascules à la création : ' + n)
    assert.deepEqual(avecClasse(el, 'danger'), [])
  })

  it('ligne sélectionnée puis vidage : la ligne neuve n\'a pas la classe', async () => {
    const el = els.clstable
    ombre(el).querySelectorAll('.sel')[4].click()
    await tic()
    assert.deepEqual(avecClasse(el, 'danger'), [5])
    await poser(el, [])
    await poser(el, ids(1001, 1300))
    assert.deepEqual(avecClasse(el, 'danger'), [], 'aucune ligne reprise ne garde la classe')
    ombre(el).querySelectorAll('.sel')[4].click()
    await tic()
    assert.deepEqual(avecClasse(el, 'danger'), [1005])
  })

  it('condition qui lit la ligne : classe posée à la création quand elle est vraie, seulement alors', async () => {
    const el = els.clsligne
    const n = await compte(() => poser(el, [ligne(1), ligne(2, true), ligne(3)]))
    assert.equal(n, 1, 'une bascule, pour la ligne où la condition est vraie')
    assert.deepEqual(avecClasse(el, 'on'), [2])
    await poser(el, [ligne(1, true), ligne(2), ligne(3)])
    assert.deepEqual(avecClasse(el, 'on'), [1])
  })

  it('classe écrite aussi dans le gabarit : retirée à la création quand la condition est fausse', async () => {
    const el = els.clsecrite
    await poser(el, [ligne(1), ligne(2, true)])
    assert.deepEqual(avecClasse(el, 'on'), [2])
  })
})

// le serveur sélectionne la ligne 2 (son moteur est happy-dom), le navigateur aucune : la ligne reprise doit perdre la classe écrite par le serveur
const SERVEUR: Record<string, string> = {
  'cls-serveur.mjs': [
    '<script lang="js">',
    '  $data = [{ id: 1, label: \'a\' }, { id: 2, label: \'b\' }, { id: 3, label: \'c\' }];',
    '  $selected = /HappyDOM/.test(navigator.userAgent) ? 2 : -1;',
    '</script>',
    '<table><tbody>',
    '  {for row in $data by id}',
    '    <tr :class{$selected === row.id}="danger"><td class="id">{row.id}</td><td>{row.label}</td></tr>',
    '  {end}',
    '</tbody></table>',
    '<p class="pret">{$selected}</p>'
  ].join('\n')
}

let cibleServeur: Promise<Cible> | null = null
for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`{for} — classe conditionnelle d'une ligne écrite par le serveur (${moteur} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[moteur].executablePath())
    if (!present) { console.log(`  ℹ️  ${moteur} non installé, test de la classe reprise du serveur sauté. Activer : \`npx playwright install ${moteur}\``); return }
    browser = await playwright[moteur].launch()
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('la classe écrite par le serveur part quand la condition est fausse dans le navigateur', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-cls-serveur'
    cibleServeur ||= construire('ssr', SERVEUR, [B])
    const c = await cibleServeur
    assert.match(c.document(B, 'markers'), /<tr class="danger"/, 'le serveur a écrit la classe')
    const o = await charger(browser, c, B, 'markers')
    try {
      await o.page.waitForFunction(`document.querySelector('${B}')?._shadow?.querySelector('.pret')?.textContent === '-1'`, null, { timeout: 10000 })
      await o.page.waitForTimeout(100)
      const lignes = await o.page.evaluate(`Array.from(document.querySelector('${B}')._shadow.querySelectorAll('tbody > tr')).map((tr) => tr.querySelector('.id').textContent + (tr.classList.contains('danger') ? '!' : ''))`)
      assert.deepEqual(lignes, ['1', '2', '3'], 'aucune ligne ne garde la classe du serveur')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })
})
