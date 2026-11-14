// mise à jour fine, ce que la relecture a trouvé périmé : chaque scène donne l'écran du chemin ordinaire (la variable entière
// prévenue). Un objet qui se cite lui-même (`$o.self = $o`, `$o.a = $o`), un miroir vivant (`µ.clone(el, { mirror: true })`), un champ
// lu par un accesseur (`get double()` d'un objet, d'une classe, d'une ligne), une liste rendue par une fonction ou une variable du
// script (la passe de structure la relit), une liaison qui lit l'horloge, et l'avertissement de développement d'un objet reçu modifié

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

const tic = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) }
const js = (script: string[], gabarit: string[]) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', ...gabarit].join('\n')
const LIGNES = "const a = []; for (let i = 0; i < 4; i++) a.push({ id: i + 1, label: 'r' + (i + 1) });"

const SOURCES: Record<string, string> = {
  'soi.mjs': js(["$o = { f7: 'a', self: null, a: null };", '@lier = function() { $o.self = $o; $o.a = $o; };', "@ecrire = function() { $o.f7 = $o.f7 + '!'; };"],
    ["<p>{$o.f7}</p><p>{$o.self ? $o.self.f7 : '-'}</p><p>{$o.a && $o.a.a ? $o.a.a.f7 : '-'}</p>"]),
  'reflet.mjs': js(["$o = { f7: 'a' };", '$data = [];', `@run = function() { ${LIGNES} $data = a; };`, "@w = function() { $o.f7 = $o.f7 + '!'; $data[0].label += '!'; };", '@miroir = function() { return µ.clone(this, { mirror: true }); };'],
    ['<p>{$o.f7}</p>', '{for row in $data by id}<i>{row.label}</i>{end}']),
  'acces.mjs': js(['class Panier { constructor() { this.qty = 1; this.prix = 10; } get total() { return this.qty * this.prix; } }', '$o = { qty: 1, get double() { return this.qty * 2; } };', '$p = new Panier();', '$data = [];',
    '@run = function() { const a = []; for (let i = 0; i < 3; i++) a.push({ id: i + 1, qty: 1, get total() { return this.qty * 10; } }); $data = a; };',
    '@w = function() { $o.qty = $o.qty + 1; $p.qty = $p.qty + 1; $data[1].qty = $data[1].qty + 1; };'],
    ['<p>{$o.qty}={$o.double}</p><p>{$p.qty}={$p.total}</p>', '{for row in $data by id}<i>{row.qty}={row.total}</i>{end}']),
  'inconnue.mjs': js(['$data = [];', 'let vus = [];', `@run = function() { ${LIGNES} $data = a; vus = [a[0]]; };`, 'function premiers() { return $data.slice(0, 2); }', "@w = function() { $data[0].label += '!'; };"],
    ['{for r in premiers() by id}<u>{r.label}</u>{end}', '{for v in vus by id}<s>{v.label}</s>{end}', '{for row in $data by id}<i>{row.label}</i>{end}']),
  'horloge.mjs': js(['$data = [];', `@run = function() { ${LIGNES} $data = a; };`, "@w = function() { $data[1].label += '!'; };"],
    ['{for row in $data by id}<i>{row.label}·{Date.now()}</i>{end}']),
  'recoit.mjs': js(["@w = function() { $item.f7 = $item.f7 + '!'; };"], ['<b>{$item.f7}</b>']),
  'donne.mjs': js(["$o = { f7: 'a' };"], ['<@recoit item={$o}></@recoit>']),
}

describe('mise à jour fine — les écrans que la relecture a trouvés périmés', function () {
  this.timeout(60000)
  let win: any
  const avis: string[] = []

  before(async () => {
    const root   = mjsTmp('fine-contre-verif')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    win = new Window({ url: 'http://localhost/' })
    win.console.warn = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    const code = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = '<mjs-soi></mjs-soi><div id="h"><mjs-reflet></mjs-reflet></div><div id="m"></div><mjs-acces></mjs-acces><mjs-inconnue></mjs-inconnue><mjs-horloge></mjs-horloge><mjs-donne></mjs-donne>'
    await tic()
  })
  after(async () => { win?.close?.(); await terminateSharedWorkerPool() })

  const hote = (sel: string): any => win.document.querySelector(sel)
  const textes = (el: any, sel: string) => Array.from((el._shadow || el.shadowRoot).querySelectorAll(sel)).map((x: any) => x.textContent)

  it('un objet qui se cite lui-même : la liaison qui lit sous un champ repasse à chaque champ écrit, la table reste', async () => {
    const el = hote('mjs-soi')
    el.lier()
    el.ecrire()
    assert.deepEqual(textes(el, 'p'), ['a!', 'a!', 'a!'])
    el.ecrire()
    assert.deepEqual(textes(el, 'p'), ['a!!', 'a!!', 'a!!'])
    assert.equal(el._mjs_fine.o.d.length, 2)
  })

  it('un miroir vivant : l\'original et le miroir suivent chacun l\'écriture de l\'autre', async () => {
    const el = hote('#h mjs-reflet')
    el.run()
    await tic()
    hote('#m').append(el.miroir())
    await tic()
    const k = hote('#m mjs-reflet')
    el.w()
    await tic()
    assert.deepEqual([textes(el, 'p')[0], textes(el, 'i')[0], textes(k, 'p')[0], textes(k, 'i')[0]], ['a!', 'r1!', 'a!', 'r1!'])
    k.w()
    await tic()
    assert.deepEqual([textes(el, 'p')[0], textes(el, 'i')[0], textes(k, 'p')[0], textes(k, 'i')[0]], ['a!!', 'r1!!', 'a!!', 'r1!!'])
  })

  it('un champ lu par un accesseur : objet, instance d\'une classe, ligne', async () => {
    const el = hote('mjs-acces')
    el.run()
    await tic()
    el.w()
    await tic()
    assert.deepEqual(textes(el, 'p'), ['2=4', '2=20'])
    assert.deepEqual(textes(el, 'i'), ['1=10', '2=20', '1=10'])
  })

  it('une liste rendue par une fonction ou une variable du script : aucune table, la passe de structure la relit', async () => {
    const el = hote('mjs-inconnue')
    el.run()
    await tic()
    assert.equal(el._mjs_fine, undefined)
    el.w()
    await tic()
    assert.deepEqual([...textes(el, 'u'), ...textes(el, 's'), ...textes(el, 'i')], ['r1!', 'r2', 'r1!', 'r1!', 'r2', 'r3', 'r4'])
  })

  it('une liaison de ligne qui lit l\'horloge : aucune table, toutes les lignes repassent comme avant', async () => {
    const el = hote('mjs-horloge')
    el.run()
    await tic()
    assert.equal(el._mjs_fine, undefined)
    let n = 0
    win.Date.now = () => ++n
    el.w()
    await tic()
    assert.deepEqual(textes(el, 'i'), ['r1·1', 'r2!·2', 'r3·3', 'r4·4'])
  })

  it('développement : l\'objet reçu par une prop, modifié par l\'enfant, est dit', async () => {
    const enfant = hote('mjs-donne')._shadow.querySelector('mjs-recoit')
    assert.ok(enfant._mjs_fine && enfant._mjs_fine.item, 'l\'enfant a sa table')
    avis.length = 0
    enfant.w()
    await tic()
    assert.equal(textes(enfant, 'b')[0], 'a!')
    assert.equal(avis.filter((a) => a.includes('item')).length, 1, avis.join('\n'))
  })
})
