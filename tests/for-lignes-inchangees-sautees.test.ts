// {for} de racine sur une collection `µraw` — une ligne dont l'élément et l'index n'ont pas bougé,
// et qui ne lit rien d'autre que cet élément et cet index, n'est plus rappelée à la mise à jour.
// On compte les lectures par un accesseur posé sur les objets (aucun appel de fonction dans la ligne).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { transpile } from '../src/transpiler/index.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

async function compileAndMount(fileBase: string, source: string, tagName: string, extra: Record<string, string> = {}) {
  const root = mjsTmp(`flis-${fileBase}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, `${fileBase}.mjs`), source)
  for (const [nom, src] of Object.entries(extra)) writeFileSync(join(srcDir, `${nom}.mjs`), src)

  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

  const win: any = new Window({ url: 'http://localhost/' })
  const document: any = win.document
  const files = readdirSync(outDir)
  const coreFile = files.find((f: string) => /^mjs_core-/.test(f))
  assert.ok(coreFile, 'core compilé')
  const coreCode = stripEsm(readFileSync(join(outDir, coreFile!), 'utf-8'))
  const compFiles = files.filter((f: string) => /^(?!mjs_core)/.test(f) && f.endsWith('.js'))
  const compCode = compFiles.map((f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  win.eval(`${coreCode}\nglobalThis.µ = µ;\n${compCode}`)

  document.body.innerHTML = `<${tagName}></${tagName}>`
  const el: any = document.body.firstElementChild
  await new Promise((r) => setTimeout(r, 80))
  return { win, document, el, code: compCode }
}

const attendre = (ms = 50) => new Promise((r) => setTimeout(r, ms))

// objet dont le champ `label` compte ses lectures dans `lus[id]`
function ligne(lus: Record<number, number>, id: number, label: string, extra: any = {}) {
  const o: any = { id, ...extra }
  lus[id] = 0
  Object.defineProperty(o, 'label', { enumerable: true, get() { lus[id]++; return label } })
  return o
}
const texte = (el: any, sel = 'li') => [...el._shadow.querySelectorAll(sel)].map((n: any) => n.textContent.trim())

const PURE = `
<script lang="js">
$data = µ.raw([]);
$suffixe = '';
@set = function(rows) { rows.forEach((r) => { if (r && typeof r === 'object') µ.raw(r); }); $data = µ.raw(rows); };
@suf = function(s) { $suffixe = s; };
</script>
<ul>
{for i, row in $data by id}
  <li class="r" title={row.id + '-' + i}>{i}:{row.label}</li>
{end}
</ul>
`

describe('{for} — lignes inchangées d\'une collection µraw sautées', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('la ligne pure porte le drapeau dans le code généré', async () => {
    const { code } = await compileAndMount('lis-pure', PURE, 'mjs-lis-pure')
    assert.ok(/_mjs_p: 1/.test(code), 'drapeau présent')
  })

  it('liste µraw remplacée, 1 objet neuf sur 10 : seules les lignes neuves sont relues', async () => {
    const { el } = await compileAndMount('lis-pure-b', PURE, 'mjs-lis-pure-b')
    const lus: Record<number, number> = {}
    const rows = Array.from({ length: 30 }, (_, k) => ligne(lus, k + 1, 'a' + k))
    el.set(rows)
    await attendre()
    assert.deepEqual(texte(el), rows.map((_, k) => `${k}:a${k}`))
    for (const k of Object.keys(lus)) lus[+k] = 0
    const next = rows.map((r, k) => (k % 10 === 0 ? ligne(lus, r.id, 'b' + k) : r))
    for (const k of Object.keys(lus)) lus[+k] = 0
    el.set(next)
    await attendre()
    assert.deepEqual(texte(el), next.map((_, k) => `${k}:${k % 10 === 0 ? 'b' : 'a'}${k}`))
    next.forEach((r, k) => {
      if (k % 10 === 0) assert.ok(lus[r.id] >= 1, `ligne neuve ${k} relue`)
      else assert.equal(lus[r.id], 0, `ligne inchangée ${k} non relue`)
    })
    assert.equal(el._shadow.querySelector('li').getAttribute('title'), '1-0')
  })

  it('échange, retrait, ajout : affichage et index justes, ligne à index changé relue', async () => {
    const { el } = await compileAndMount('lis-pure-c', PURE, 'mjs-lis-pure-c')
    const lus: Record<number, number> = {}
    const rows = Array.from({ length: 6 }, (_, k) => ligne(lus, k + 1, 'x' + (k + 1)))
    el.set(rows)
    await attendre()
    const echange = rows.slice(); [echange[1], echange[4]] = [echange[4], echange[1]]
    el.set(echange)
    await attendre()
    assert.deepEqual(texte(el), ['0:x1', '1:x5', '2:x3', '3:x4', '4:x2', '5:x6'])
    const retrait = echange.filter((r) => r.id !== 3)
    for (const k of Object.keys(lus)) lus[+k] = 0
    el.set(retrait)
    await attendre()
    assert.equal(lus[1], 0, 'avant le retrait : index inchangé, sautée')
    assert.equal(lus[5], 0, 'avant le retrait : index inchangé, sautée')
    assert.ok(lus[4] >= 1 && lus[2] >= 1 && lus[6] >= 1, 'après le retrait : index changé, relues')
    assert.deepEqual(texte(el), ['0:x1', '1:x5', '2:x4', '3:x2', '4:x6'])
    assert.deepEqual(texte(el).length, 5)
    assert.equal(el._shadow.querySelectorAll('li')[2].getAttribute('title'), '4-2')
    const ajout = [...retrait, ligne(lus, 9, 'x9')]
    for (const k of Object.keys(lus)) lus[+k] = 0
    el.set(ajout)
    await attendre()
    assert.equal(lus[1] + lus[5] + lus[4] + lus[2] + lus[6], 0, 'ajout en fin : les lignes existantes sautées')
    assert.deepEqual(texte(el), ['0:x1', '1:x5', '2:x4', '3:x2', '4:x6', '5:x9'])
  })

  it('vidage puis recréation avec les mêmes objets (réserve) : jamais sautée à la première pose', async () => {
    const { el } = await compileAndMount('lis-pure-d', PURE, 'mjs-lis-pure-d')
    const lus: Record<number, number> = {}
    const rows = Array.from({ length: 5 }, (_, k) => ligne(lus, k + 1, 'p' + k))
    el.set(rows)
    await attendre()
    el.set([])
    await attendre()
    assert.equal(texte(el).length, 0)
    el.set(rows)
    await attendre()
    assert.deepEqual(texte(el), rows.map((_, k) => `${k}:p${k}`))
    // recréation avec d'autres objets et des index décalés (lignes de la réserve)
    const autres = [ligne(lus, 21, 'q0'), ligne(lus, 22, 'q1')]
    el.set([])
    await attendre()
    el.set(autres)
    await attendre()
    assert.deepEqual(texte(el), ['0:q0', '1:q1'])
    assert.equal(el._shadow.querySelectorAll('li')[1].getAttribute('title'), '22-1')
  })

  it('même liste NON brute, élément modifié en place : la ligne suit', async () => {
    const src = `
<script lang="js">
$data = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }, { id: 4, label: 'd' }];
@mod = function() { $data[3].label = 'x'; };
@copie = function() { $data = [...$data]; };
</script>
<ul>
{for row in $data by id}
  <li>{row.label}</li>
{end}
</ul>
`
    const { el } = await compileAndMount('lis-nonbrut', src, 'mjs-lis-nonbrut')
    el.mod()
    await attendre()
    assert.deepEqual(texte(el), ['a', 'b', 'c', 'x'])
    el.copie()
    await attendre()
    assert.deepEqual(texte(el), ['a', 'b', 'c', 'x'])
  })

  it('ligne qui lit une variable du composant : changer la variable met toutes les lignes à jour', async () => {
    const src = `
<script lang="js">
$data = µ.raw([{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }]);
$suffixe = '';
@suf = function(s) { $suffixe = s; };
</script>
<ul>
{for row in $data by id}
  <li>{row.label} {$suffixe}</li>
{end}
</ul>
`
    const { el, code } = await compileAndMount('lis-var', src, 'mjs-lis-var')
    assert.ok(!/_mjs_p: 1/.test(code), 'drapeau absent')
    el.suf('!')
    await attendre()
    assert.deepEqual(texte(el), ['a !', 'b !', 'c !'])
  })

  it('appel de fonction dans la ligne : jamais sautée (drapeau absent, fonction rappelée)', async () => {
    const src = `
<script lang="js">
$data = µ.raw([]);
@set = function(rows) { rows.forEach((r) => { if (r && typeof r === 'object') µ.raw(r); }); $data = µ.raw(rows); };
@fmt = function(v) { globalThis.__appels = (globalThis.__appels || 0) + 1; return v + '.'; };
</script>
<ul>
{for row in $data by id}
  <li>{@fmt(row.label)}</li>
{end}
</ul>
`
    const { el, code, win } = await compileAndMount('lis-appel', src, 'mjs-lis-appel')
    assert.ok(!/_mjs_p: 1/.test(code), 'drapeau absent')
    const rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }]
    el.set(rows)
    await attendre()
    win.__appels = 0
    el.set(rows.slice())
    await attendre()
    assert.ok(win.__appels >= 3, `appels : ${win.__appels}`)
    assert.deepEqual(texte(el), ['a.', 'b.', 'c.'])
  })

  it('{if} niché : jamais sautée (drapeau absent, condition relue)', async () => {
    const src = `
<script lang="js">
$data = µ.raw([]);
@set = function(rows) { rows.forEach((r) => { if (r && typeof r === 'object') µ.raw(r); }); $data = µ.raw(rows); };
</script>
<ul>
{for row in $data by id}
  <li>{if row.on}oui{else}non{end}</li>
{end}
</ul>
`
    const { el, code } = await compileAndMount('lis-if', src, 'mjs-lis-if')
    assert.ok(!/_mjs_p: 1/.test(code), 'drapeau absent')
    let n = 0
    const o: any = { id: 1 }
    Object.defineProperty(o, 'on', { enumerable: true, get() { n++; return true } })
    const rows = [o, { id: 2, on: false }]
    el.set(rows)
    await attendre()
    n = 0
    el.set(rows.slice())
    await attendre()
    assert.ok(n >= 1, `condition relue : ${n}`)
    assert.deepEqual(texte(el), ['oui', 'non'])
  })

  it('µt, composant enfant, liste imbriquée : drapeau absent', async () => {
    const enfant = `<span>{@v}</span>\n<script lang="js">\n@v = 1;\n</script>\n`
    const formes: Record<string, string> = {
      'lis-t': `<li>{µt('x')}</li>`,
      'lis-enf': `<li><@lis-fils/></li>`,
      'lis-imb': `<li>{for c in row.items}<b>{c}</b>{end}</li>`,
      'lis-const': `{const n = row.label}<li>{n}</li>`,
      'lis-ctx': `<li>{row.label + @prefixe}</li>`,
      'lis-methode': `<li>{row.label.toUpperCase()}</li>`
    }
    for (const [nom, corps] of Object.entries(formes)) {
      const src = `<script lang="js">\n$data = µ.raw([]);\n@prefixe = 'p';\n</script>\n<ul>\n{for row in $data by id}\n${corps}\n{end}\n</ul>\n`
      const { code } = await compileAndMount(nom, src, `mjs-${nom}`, { 'lis-fils': enfant })
      assert.ok(!/_mjs_p: 1/.test(code), nom)
    }
  })

  it('collection objet {for cle, v in $obj} avec µraw', async () => {
    const src = `
<script lang="js">
$obj = µ.raw({});
@set = function(o) { Object.values(o).forEach((r) => { if (r && typeof r === 'object') µ.raw(r); }); $obj = µ.raw(o); };
</script>
<ul>
{for cle, v in $obj}
  <li>{cle}={v.label}</li>
{end}
</ul>
`
    const { el, code } = await compileAndMount('lis-obj', src, 'mjs-lis-obj')
    assert.ok(/_mjs_p: 1/.test(code), 'drapeau présent')
    const lus: Record<number, number> = {}
    const a = ligne(lus, 1, 'A'), b = ligne(lus, 2, 'B'), c = ligne(lus, 3, 'C')
    el.set({ x: a, y: b, z: c })
    await attendre()
    assert.deepEqual(texte(el), ['x=A', 'y=B', 'z=C'])
    lus[1] = lus[2] = lus[3] = 0
    const b2 = ligne(lus, 2, 'B2')
    el.set({ x: a, y: b2, z: c })
    await attendre()
    assert.deepEqual(texte(el), ['x=A', 'y=B2', 'z=C'])
    assert.equal(lus[1], 0)
    assert.equal(lus[3], 0)
    assert.ok(lus[2] >= 1)
    // même objet sous une autre clé : relue (la clé est l'index)
    el.set({ q: a, y: b2, z: c })
    await attendre()
    assert.deepEqual(texte(el), ['q=A', 'y=B2', 'z=C'])
  })

  it('sélecteur de classe par clé : la sélection reste juste pour une ligne sautée', async () => {
    const src = `
<script lang="js">
$data = µ.raw([]);
$selected = -1;
@set = function(rows) { rows.forEach((r) => { if (r && typeof r === 'object') µ.raw(r); }); $data = µ.raw(rows); };
@sel = function(id) { $selected = id; };
</script>
<ul>
{for row in $data by id}
  <li @class{$selected === row.id}="danger" @click={@sel(row.id)}>{row.label}</li>
{end}
</ul>
`
    const { el, code } = await compileAndMount('lis-sel', src, 'mjs-lis-sel')
    assert.ok(/_mjs_p: 1/.test(code), 'drapeau présent')
    const lus: Record<number, number> = {}
    const rows = Array.from({ length: 5 }, (_, k) => ligne(lus, k + 1, 'r' + k))
    const danger = () => [...el._shadow.querySelectorAll('li')].map((n: any, k: number) => n.classList.contains('danger') ? k : -1).filter((k: number) => k >= 0)
    el.set(rows)
    await attendre()
    el.sel(2)
    await attendre()
    assert.deepEqual(danger(), [1])
    for (const k of Object.keys(lus)) lus[+k] = 0
    el.set(rows.slice())
    await attendre()
    assert.deepEqual(danger(), [1])
    assert.equal(lus[3], 0, 'ligne sautée')
    el.sel(4)
    await attendre()
    assert.deepEqual(danger(), [3])
    // liste remplacée avec un objet neuf pour la ligne sélectionnée
    const neuf = rows.slice()
    neuf[3] = ligne(lus, 4, 'neuf')
    el.set(neuf)
    await attendre()
    assert.deepEqual(danger(), [3])
    el.sel(1)
    await attendre()
    assert.deepEqual(danger(), [0])
    // retrait de la ligne avant : l'index change, la sélection reste sur la même ligne
    el.set(neuf.filter((r) => r.id !== 3))
    await attendre()
    assert.deepEqual(danger(), [0])
    el.sel(5)
    await attendre()
    assert.deepEqual(danger(), [3])
  })
  // un objet ordinaire d'une liste µraw reste suivi par son tableau réactif d'origine : jamais sauté
  it('liste µraw tirée d\'un tableau réactif : un élément modifié par ce tableau s\'affiche', async () => {
    const src = `<script lang="js">
$all = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];
$data = µ.raw($all.filter((r) => r.id > 0));
@mod = function() { $all[0].label = 'MOD'; };
</script>
<ul>
{for row in $data by id}
<li>{row.label}</li>
{end}
</ul>
`
    const { win, el } = await compileAndMount('flisproxy', src, 'mjs-flisproxy')
    el.mod()
    await attendre()
    assert.equal(el._shadow.querySelector('li').textContent, 'MOD')
    win.close?.()
  })

  it('appel sans parenthèses de Civet et appel conditionnel : drapeau absent', async () => {
    for (const corps of ['<li>{row.fmt i}</li>', '<li>{row.fmt?(i)}</li>', '<li>{row.fmt row}</li>', '<li>{row.fmt -i}</li>', '<li>{row.fmt -1}</li>', '<li>{row.fmt !i}</li>', '<li>{row.fmt +i}</li>', '<li>{row.fmt not i}</li>', '<li>{row.x? 1}</li>', '<li>{row.x? -i}</li>', '<li>{row.x . y}</li>', '<li>{row.x ?.y}</li>']) {
      const { output } = await transpile(`<script>\n$data = µraw([])\n</script>\n<ul>\n{for i, row in $data by id}\n${corps}\n{end}\n</ul>\n`, { moduleName: 'flisciv' })
      assert.doesNotMatch(output, /_mjs_p: 1/, corps)
    }
  })
  it('expressions de ligne ordinaires : drapeau présent', async () => {
    for (const corps of ['<li>{row.label}</li>', '<li>{row.a + row.b}</li>', '<li>{row.a - i}</li>', '<li>{row.on ? row.a : row.b}</li>', '<li>{row.a?.b}</li>', '<li>{i + 1}</li>', '<li title={row.a + \' \' + row.b}>{row.n * 2}</li>']) {
      const { output } = await transpile(`<script>\n$data = µraw([])\n</script>\n<ul>\n{for i, row in $data by id}\n${corps}\n{end}\n</ul>\n`, { moduleName: 'flisok' })
      assert.match(output, /_mjs_p: 1/, corps)
    }
  })
})
