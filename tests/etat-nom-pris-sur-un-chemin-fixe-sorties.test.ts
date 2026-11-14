// Sorties du compilateur pour un nom pris sur un chemin fixe de l'état. Pris : `const t = $o.a.b; t.c = 5` (réglage `"proxy": false`)
// passe par le chemin relu au moment de l'écriture, sans avertissement ; `const t = $$s.a.b; t.c = 5` (avec et sans enveloppe) aussi. Pas
// pris, la sortie d'aujourd'hui et son avertissement : nom réaffecté, tiré d'un motif, reçu en paramètre, pris sur un appel
// (`$o.get(k)`), sur une clé qui agit (`$o[k++]`) ou sur une clé qui n'est plus à portée à l'écriture (nom pris dans une boucle) ; une
// appli sans cette forme ne reçoit aucune garde. Code émis valide pour une valeur entre parenthèses (magasin) et une écriture en chaîne
// (`t.n = t.z = 6`, "proxy": false). Compilation seule
import assert from 'node:assert/strict'
import { transform } from 'esbuild'
import { transpile } from '../src/transpiler/index.js'

const net  = (a: unknown) => String(a).replace(/\x1b\[[0-9;]*m/g, '')
const src  = (corps: string[]) => ['<script lang="js">', '  $o = { a: { b: { c: 0 } }, get(k) { return this.a; } };', '  $$s = { a: { b: { c: 0 } } };', '  let k = 0;', ...corps.map((l) => '  ' + l), '</script>', '<p>{$o.a.b.c}{$$s.a.b.c}</p>'].join('\n')
const PRIS = 'µ._mjs_toRaw(t)'

async function sortie(corps: string[], proxy = false) {
  const r: any = await transpile(src(corps), { moduleName: 'chemin-fixe', ...(proxy ? {} : { proxy: false }) } as any)
  return { code: String(r.output), avis: (r.data?.sectionWarnings ?? []).map(net) as string[] }
}

describe('nom pris sur un chemin fixe : sorties du compilateur', function () {
  this.timeout(60000)

  it('"proxy": false — const t = $o.a.b ; t.c = 5 passe par le chemin gardé, sans avertissement', async () => {
    const s = await sortie(['@w = function() { const t = $o.a.b; t.c = 5; };'])
    assert.ok(s.code.includes(PRIS), s.code)
    assert.ok(!s.avis.some((a) => a.includes('écriture par `t`')), JSON.stringify(s.avis))
  })
  for (const proxy of [false, true]) it(`magasin${proxy ? '' : ', "proxy": false'} — const t = $$s.a.b ; t.c = 5 passe par le chemin du magasin relu`, async () => {
    const s = await sortie(['@w = function() { const t = $$s.a.b; t.c = 5; };'], proxy)
    assert.ok(s.code.includes('µ.store.s?.a?.b === t ? µ._mjs_storeDeepSet("s"'), s.code)
  })
  const ABSTIENT: Array<[string, string]> = [
    ['nom réaffecté', '@w = function() { let t = $o.a.b; t = {}; t.c = 5; };'],
    ['motif', '@w = function() { const { b } = $o.a; b.c = 5; };'],
    ['paramètre', '@w = function(t) { t.c = 5; };'],
    ['pris sur un appel', '@w = function() { const t = $o.get(1); t.c = 5; };'],
    ['clé qui agit', '@w = function() { const t = $o.a[k++]; t.c = 5; };'],
  ]
  for (const [cas, ligne] of ABSTIENT) it(`"proxy": false — ${cas} : aucune garde de chemin, la sortie d'aujourd'hui`, async () => {
    const s = await sortie([ligne])
    const n = (/@w = function\(t\)/.test(ligne) ? 't' : /\{ b \}/.test(ligne) ? 'b' : 't')
    assert.ok(!s.code.includes(`µ._mjs_toRaw(${n})`) && !s.code.includes(`=== ${n} ?`), s.code)
  })
  it('"proxy": false — nom réaffecté : l\'avertissement reste', async () => {
    const s = await sortie(['@w = function() { let t = $o.a.b; t = $o.a.b; t.c = 5; };'])
    assert.ok(s.avis.some((a) => a.includes('écriture par `t`') && a.includes('µrefresh($o)')), JSON.stringify(s.avis))
  })
  // sortie d'un composant seul : ses lignes d'import (repères du bundler) écartées, le reste doit se lire en JavaScript
  const valide = async (code: string) => { await transform(code.split('\n').filter((l) => !/^import\b/.test(l)).join('\n'), { loader: 'js', format: 'esm' }) }
  for (const proxy of [false, true]) it(`magasin${proxy ? '' : ', "proxy": false'} — t.ok = (a === 2) : code émis valide`, async () => {
    const s = await sortie(['@w = function() { const a = 2; const t = $$s.a.b; t.ok = (a === 2); t.v = (a > 5 ? "grand" : "petit"); };'], proxy)
    await valide(s.code)
  })
  it('"proxy": false — écriture en chaîne t.n = t.z = 6 : code émis valide', async () => {
    const s = await sortie(['@w = function() { const t = $o.a.b; let b; b = (t.n = t.z = 6); t.c = t.n = 7; };'])
    await valide(s.code)
  })
  for (const proxy of [false, true]) it(`nom pris dans une boucle sur une clé, écrit après elle${proxy ? '' : ', "proxy": false'} : la règle s'abstient`, async () => {
    const s = await sortie(['@w = function() { let trouve; let pris; for (const q of Object.keys($o.a)) { trouve = $o.a[q]; pris = $$s.a[q]; } trouve.c = 5; pris.c = 6; };'], proxy)
    await valide(s.code)
    assert.ok(!s.code.includes('µ._mjs_toRaw(trouve)') && !s.code.includes('=== trouve ?') && !s.code.includes('=== pris ?'), s.code)
  })
  for (const proxy of [false, true]) it(`appli sans la forme${proxy ? '' : ', "proxy": false'} : aucune garde de chemin`, async () => {
    const s = await sortie(['@w = function() { $o.a.b.c = 5; $$s.a.b.c = 6; };'], proxy)
    assert.ok(!s.code.includes('µ._mjs_toRaw(') && !s.code.includes('µ.store.s?.'), s.code)
  })
})
