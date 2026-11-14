// Une écriture profonde prévient TOUTES les variables qui atteignent l'objet écrit, y compris celle qui ne l'atteint que PENDANT la
// notification : `$a = S ; $b = { sub: S }`, le gabarit ne lit `$b.sub` qu'une fois `$a.x > 0` — la notification de `a` relit cette
// liaison, qui lit alors l'objet par `b` pour la première fois ; `b`, la variable écrite (`$b.sub.x = 5`), doit être prévenue quand même :
// l'enfant qui la reçoit, le reffet et la liaison qui la lisent suivent. Lecture croisée faite par le gabarit, par une valeur dérivée, par
// une méthode ; ligne d'une liste ; suppression puis écriture ; témoin à deux variables déjà connues. Cœur construit, monté dans happy-dom
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')

const TETE = ['const C = globalThis.__C, E = globalThis.__E;', 'const c = function(n) { C[n] = (C[n] || 0) + 1; };', '@t = function(n, v) { c(n); return v; };']
const DEUX = [...TETE, 'const S = { x: 0 };', '$a = S;', '$b = { sub: S, n: 0 };', '@ecrire = function(v) { $b.sub.x = v; };']
const ENF  = '<p>{@t("pb", $b.n)}</p><@cn-enf item={$b}></@cn-enf>'
const SOURCES: Record<string, string> = {
  'cn-enf.mjs':      js(['$item = null;'], '<em>{$item ? JSON.stringify($item) : ""}</em>'),
  'cn-ternaire.mjs': js(DEUX, '<p>{$a.x > 0 ? $b.sub.x : 0}</p>' + ENF),
  'cn-si.mjs':       js(DEUX, '{if $a.x > 0}<p>{$b.sub.x}</p>{end}' + ENF),
  'cn-reffet.mjs':   js([...DEUX, 'µeffect(() => { E.push("eb:" + $b.n); });'], '<p>{$a.x > 0 ? $b.sub.x : 0}</p>'),
  'cn-derivee.mjs':  js([...TETE, 'const S = { x: 0 };', '$a = S;', '$b = { sub: S, n: 0 };', '$dv = $a.x > 0 ? $b.sub.x : 0;', '@ecrire = function(v) { $b.sub.x = v; };'], '<p>{$dv}</p>' + ENF),
  'cn-methode.mjs':  js([...DEUX, '@lu = function() { return $a.x > 0 ? $b.sub.x : 0; };'], '<p>{$a.x > 0 ? @lu() : 0}</p>' + ENF),
  'cn-liste.mjs':    js([...TETE, 'const l = [{ id: 1, n: 0 }, { id: 2, n: 0 }];', '$sel = l[0];', '$rows = l;', '@ecrire = function(v) { $rows[0].n = v; };'], '<p>{$sel.n > 0 ? $rows[0].n : "-"}</p><p>{@t("pb", $rows.length)}</p><@cn-enf item={$rows}></@cn-enf>'),
  'cn-retire.mjs':   js([...TETE, 'const S = { x: 0, y: 1 };', '$a = S;', '$b = { sub: S, n: 0 };', '@ecrire = function(v) { delete $b.sub.y; $b.sub.x = v; };'], '<p>{$a.y === undefined ? $b.sub.x : 0}</p>' + ENF),
  'cn-temoin.mjs':   js([...TETE, 'const S = { x: 0 };', '$a = S;', '$c = S;', '$b = { sub: S, n: 0 };', '@ecrire = function(v) { $b.sub.x = v; };'], '<p>{$a.x > 0 ? $b.sub.x : 0}</p><p>{$c.x}</p>' + ENF),
}

const REGLAGES: Array<[string, any]> = [['développement', {}], ['production', { env: 'prod' }], ['production sans enveloppe', { env: 'prod', proxy: false }]]
const ombre = (el: any) => el._shadow || el.shadowRoot || el

for (const [nom, opts] of REGLAGES) describe(`état : la variable qui atteint l'objet pendant la notification est prévenue (${nom})`, function () {
  this.timeout(120000)
  let code = ''
  const fenetres: any[] = []

  before(async () => {
    const root   = mjsTmp('cle-pendant-notification')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...opts } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
    code = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  const monte = async (tag: string) => {
    const win: any = new Window({ url: 'http://localhost/' })
    fenetres.push(win)
    win.eval('globalThis.__C = {}; globalThis.__E = [];')
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = `<mjs-${tag}></mjs-${tag}>`
    await tic(); await tic()
    const el = win.document.querySelector('mjs-' + tag)
    return { win, el, enfant: () => { const e = ombre(el).querySelector('mjs-cn-enf'); return e ? ombre(e).querySelector('em').textContent : '' }, p: (i: number) => ombre(el).querySelectorAll('p')[i].textContent }
  }

  for (const [tag, quoi] of [['cn-ternaire', 'une expression du gabarit'], ['cn-si', 'un bloc {if}'], ['cn-derivee', 'une valeur dérivée'], ['cn-methode', 'une méthode appelée du gabarit'], ['cn-temoin', 'le gabarit, les deux variables déjà connues']] as const) {
    it(`lecture croisée faite par ${quoi} : l'enfant qui reçoit la variable écrite suit, sa liaison est relue`, async () => {
      const { win, el, enfant, p } = await monte(tag)
      assert.equal(enfant(), '{"sub":{"x":0},"n":0}')
      const pb = win.__C.pb
      el.ecrire(5)
      await tic()
      assert.equal(enfant(), '{"sub":{"x":5},"n":0}', 'l\'enfant qui reçoit `$b` montre la valeur écrite')
      if (tag !== 'cn-si') assert.equal(p(0), '5')
      assert.ok(win.__C.pb > pb, `la liaison qui lit \`$b.n\` est relue (${pb} → ${win.__C.pb})`)
      el.ecrire(6)
      await tic()
      assert.equal(enfant(), '{"sub":{"x":6},"n":0}')
    })
  }

  it('le reffet qui lit la variable écrite repart', async () => {
    const { win, el } = await monte('cn-reffet')
    assert.equal(win.__E.length, 1)
    el.ecrire(5)
    await tic()
    assert.equal(win.__E.length, 2, 'le reffet qui lit `$b` est relancé par `$b.sub.x = 5`')
  })

  it('ligne d\'une liste tenue aussi par une autre variable : l\'enfant qui reçoit la liste suit', async () => {
    const { el, enfant, p } = await monte('cn-liste')
    el.ecrire(5)
    await tic()
    assert.equal(enfant(), '[{"id":1,"n":5},{"id":2,"n":0}]')
    assert.equal(p(0), '5')
  })

  it('suppression puis écriture dans le même geste : aucune des deux notifications de la variable écrite n\'est perdue', async () => {
    const { win, el, enfant } = await monte('cn-retire')
    const pb = win.__C.pb
    el.ecrire(5)
    await tic()
    assert.equal(enfant(), '{"sub":{"x":5},"n":0}')
    assert.ok(win.__C.pb > pb, 'la liaison qui lit `$b.n` est relue')
  })
})
