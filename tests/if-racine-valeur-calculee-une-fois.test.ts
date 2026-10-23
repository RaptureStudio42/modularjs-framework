// Test runtime — une valeur lue dans une branche d'un `{if}` de racine n'est calculée qu'UNE fois.
//
// Avant : chaque interpolation / attribut lié d'une branche existait en deux exemplaires, l'un
// rejoué à chaque passe de `_mjs_renderStruct` (même branche inchangée), l'autre enregistré en
// effet (monté puis rejoué à chaque changement de sa variable) : 2 appels au montage, 1 de plus
// à chaque rendu de structure sans rapport. On compte les appels d'une fonction lue dans la branche.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

async function compileAndMount(fileBase: string, source: string, tagName: string) {
  const root = mjsTmp(`ifrv-${fileBase}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, `${fileBase}.mjs`), source)

  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

  const win: any = new Window({ url: 'http://localhost/' })
  const document: any = win.document
  const files = readdirSync(outDir)
  const coreFile = files.find((f: string) => /^mjs_core-/.test(f))
  const compFile = files.find((f: string) => new RegExp(`^${fileBase}-`).test(f))
  assert.ok(coreFile && compFile, 'core + composant compilés')
  const coreCode = stripEsm(readFileSync(join(outDir, coreFile!), 'utf-8'))
  const compCode = stripEsm(readFileSync(join(outDir, compFile!), 'utf-8'))
  win.eval(`${coreCode}\nglobalThis.µ = µ;\n${compCode}`)

  document.body.innerHTML = `<${tagName}></${tagName}>`
  const el: any = document.body.firstElementChild
  await new Promise((r) => setTimeout(r, 80))
  return { win, document, el }
}

const attendre = (ms = 50) => new Promise((r) => setTimeout(r, ms))

const COMPOSANT = `
<script>
$x = 1
$autre = 1
$mode = true
compte = (nom, v) ->
  c = (globalThis.__cnt ?= {})
  c[nom] = (c[nom] or 0) + 1
  v
bumpX = -> $x = $x + 1
bumpAutre = -> $autre = $autre + 1
basculer = -> $mode = not $mode
</script>
<div>
  <button class="x" @click={bumpX()}>x</button>
  <button class="autre" @click={bumpAutre()}>autre</button>
  <button class="mode" @click={basculer()}>mode</button>
  <i class="hors">{$autre}</i>
  {if $mode}
    <p class="a" title={compte('attr', $x)}>{compte('a', $x)}</p>
    <p class="fixe">{compte('fixe', 7)}</p>
  {else}
    <p class="b">{compte('b', $x)}</p>
  {end}
</div>
`

describe('{if} de racine — chaque valeur de la branche calculée une seule fois', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('au montage, après changement de sa variable, d\'une autre variable, puis bascule de branche', async () => {
    const { win, el } = await compileAndMount('ifrvbase', COMPOSANT, 'mjs-ifrvbase')
    const cnt = () => win.__cnt as Record<string, number>
    const click = (sel: string) => el._shadow.querySelector(sel)
      .dispatchEvent(new win.Event('click', { bubbles: true, composed: true }))
    const texte = (sel: string) => el._shadow.querySelector(sel)?.textContent

    assert.equal(el._mjs_has_crashed, undefined, 'aucun crash au montage')
    assert.equal(texte('.a'), '1')
    assert.equal(el._shadow.querySelector('.a').getAttribute('title'), '1')
    assert.equal(cnt().a, 1, 'texte lu une fois au montage')
    assert.equal(cnt().attr, 1, 'attribut lié lu une fois au montage')
    assert.equal(cnt().fixe, 1, 'valeur sans variable lue une fois au montage')

    click('.autre')
    await attendre()
    assert.equal(el._shadow.querySelector('.hors').textContent, '2', 'la variable sans rapport a bien changé')
    assert.equal(cnt().a, 1, 'autre variable : zéro calcul de plus (texte)')
    assert.equal(cnt().attr, 1, 'autre variable : zéro calcul de plus (attribut)')
    assert.equal(cnt().fixe, 1, 'autre variable : zéro calcul de plus (fixe)')

    click('.x')
    await attendre()
    assert.equal(texte('.a'), '2', 'la valeur suit $x')
    assert.equal(el._shadow.querySelector('.a').getAttribute('title'), '2')
    assert.equal(cnt().a, 2, 'sa variable change : un seul calcul de plus (texte)')
    assert.equal(cnt().attr, 2, 'sa variable change : un seul calcul de plus (attribut)')
    assert.equal(cnt().fixe, 1, 'sa variable change : la valeur fixe ne bouge pas')

    // bascule : la branche neuve est posée, valeurs comprises, même celles dont la variable n'a pas bougé
    click('.mode')
    await attendre()
    assert.equal(texte('.b'), '2', 'branche else posée avec la valeur courante de $x')
    assertAbsent(el._shadow.querySelector('.a'))
    assert.equal(cnt().b, 1, 'branche neuve : un seul calcul')

    click('.mode')
    await attendre()
    assert.equal(texte('.a'), '2', 'branche if re-posée avec la valeur courante')
    assert.equal(el._shadow.querySelector('.a').getAttribute('title'), '2', 'attribut re-posé')
    assert.equal(texte('.fixe'), '7', 'valeur fixe re-posée')
    assert.equal(cnt().a, 3, 'branche recréée : un seul calcul de plus')
    assert.equal(cnt().fixe, 2)

    click('.autre')
    await attendre()
    assert.equal(cnt().a, 3, 'après recréation, une variable sans rapport ne calcule toujours rien')
    assert.equal(cnt().b, 1)

    win.close?.()
  })

  it('{for} et {if} nichés dans la branche : ils suivent toujours', async () => {
    const source = `
<script>
$x = 1
$deep = false
$liste = ['u', 'v']
$mode = true
compte = (nom, v) ->
  c = (globalThis.__cnt ?= {})
  c[nom] = (c[nom] or 0) + 1
  v
bumpX = -> $x = $x + 1
ouvrir = -> $deep = true
ajouter = -> $liste = [...$liste, 'w']
fermer = -> $mode = false
rouvrir = -> $mode = true
</script>
<div>
  <button class="x" @click={bumpX()}>x</button>
  <button class="ouvre" @click={ouvrir()}>deep</button>
  <button class="add" @click={ajouter()}>add</button>
  <button class="off" @click={fermer()}>off</button>
  <button class="on" @click={rouvrir()}>on</button>
  {if $mode}
    <p class="a">{compte('a', $x)}</p>
    <ul>
      {for n in $liste}
        <li>{n}</li>
      {end}
    </ul>
    {if $deep}
      <em class="deep">{compte('deep', $x)}</em>
    {end}
  {end}
</div>
`
    const { win, el } = await compileAndMount('ifrvnid', source, 'mjs-ifrvnid')
    const cnt = () => win.__cnt as Record<string, number>
    const click = (sel: string) => el._shadow.querySelector(sel)
      .dispatchEvent(new win.Event('click', { bubbles: true, composed: true }))
    const items = () => [...el._shadow.querySelectorAll('li')].map((l: any) => l.textContent).join(',')

    assert.equal(el._mjs_has_crashed, undefined)
    assert.equal(items(), 'u,v')
    assert.equal(cnt().a, 1, 'montage : une seule lecture')

    click('.add')
    await attendre()
    assert.equal(items(), 'u,v,w', 'le {for} niché suit sa liste')
    assert.equal(cnt().a, 1, 'liste changée : la valeur de la branche n\'est pas recalculée')

    click('.ouvre')
    await attendre()
    assert.equal(el._shadow.querySelector('.deep')?.textContent, '1', 'le {if} niché s\'ouvre avec sa valeur')
    assert.equal(cnt().deep, 1, 'branche niché neuve : un seul calcul')
    assert.equal(cnt().a, 1)

    click('.x')
    await attendre()
    assert.equal(el._shadow.querySelector('.deep').textContent, '2', 'le {if} niché suit $x')
    assert.equal(el._shadow.querySelector('.a').textContent, '2')
    assert.equal(cnt().a, 2)
    assert.equal(cnt().deep, 2)

    click('.off')
    await attendre()
    click('.on')
    await attendre()
    assert.equal(items(), 'u,v,w', 'le {for} niché est reconstruit')
    assert.equal(el._shadow.querySelector('.a').textContent, '2', 'valeur posée dans la branche rouverte')
    assert.equal(el._shadow.querySelector('.deep').textContent, '2', 'le {if} niché est rouvert avec sa valeur')

    win.close?.()
  })
  // la valeur d'un <select> se pose APRÈS le {for} de ses <option> : posée avant, elle retombe sur la première
  it('branche rouverte : un <select> aux options en {for} retrouve sa valeur', async () => {
    const source = `
<script>
$v = 'b'
$opts = ['a', 'b', 'c']
$out = true
basculer = -> $out = not $out
</script>
<div>
  <button class="mode" @click={basculer()}>mode</button>
  {if $out}<select aria-label="s" value=!{$v}>{for o in $opts}<option value={o}>{o}</option>{end}</select>{end}
</div>
`
    const { win, el } = await compileAndMount('ifrvsel', source, 'mjs-ifrvsel')
    const click = (sel: string) => el._shadow.querySelector(sel)
      .dispatchEvent(new win.Event('click', { bubbles: true, composed: true }))
    assert.equal(el._shadow.querySelector('select').value, 'b', 'valeur au montage')
    click('.mode')
    await attendre()
    assertAbsent(el._shadow.querySelector('select'))
    click('.mode')
    await attendre()
    assert.equal(el._shadow.querySelector('select').value, 'b', 'valeur gardée à la réouverture')
    win.close?.()
  })
})
