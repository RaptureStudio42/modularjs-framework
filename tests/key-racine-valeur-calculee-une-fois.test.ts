// Test runtime — une valeur lue dans un `{key}` de racine n'est calculée qu'UNE fois.
//
// Avant : chaque interpolation / attribut lié du bloc existait en deux exemplaires, l'un rejoué
// à chaque passe de `_mjs_renderStruct` (même clé inchangée), l'autre enregistré en effet (monté
// puis rejoué à chaque changement de sa variable) : 2 appels au montage, 1 de plus à chaque rendu
// de structure déclenché par un bloc voisin. Une fonction coûteuse lue dans le bloc payait donc
// double. On compte ici les appels d'une fonction lue dans le gabarit, et on garde que le bloc
// reste juste : recréé avec les valeurs courantes quand sa clé change, `<select>` compris,
// et ses structures nichées (composant, {if}, {for}) continuent de suivre.

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

async function compileAndMount(fileBase: string, source: string, extras: Record<string, string> = {}) {
  const root = mjsTmp(`keyrv-${fileBase}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, `${fileBase}.mjs`), source)
  for (const [nom, code] of Object.entries(extras)) writeFileSync(join(srcDir, `${nom}.mjs`), code)

  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

  const win: any = new Window({ url: 'http://localhost/' })
  const document: any = win.document
  const files = readdirSync(outDir)
  const coreFile = files.find((f: string) => /^mjs_core-/.test(f))
  assert.ok(coreFile, 'core compilé')
  const coreCode = stripEsm(readFileSync(join(outDir, coreFile!), 'utf-8'))
  const comps = [fileBase, ...Object.keys(extras)].map((nom) => {
    const f = files.find((x: string) => new RegExp(`^${nom}-`).test(x))
    assert.ok(f, `${nom} compilé`)
    return stripEsm(readFileSync(join(outDir, f!), 'utf-8'))
  })
  win.eval(`${coreCode}\nglobalThis.µ = µ;\n${comps.join('\n')}`)

  document.body.innerHTML = `<mjs-${fileBase}></mjs-${fileBase}>`
  const el: any = document.body.firstElementChild
  await new Promise((r) => setTimeout(r, 120))
  return { win, document, el }
}

const attendre = (ms = 50) => new Promise((r) => setTimeout(r, ms))

const COMPOSANT = `
<script>
$x = 1
$l = 'a'
$autre = 1
$voisin = false
$liste = ['u']
compte = (nom, v) ->
  c = (globalThis.__cnt ?= {})
  c[nom] = (c[nom] or 0) + 1
  v
bumpX = -> $x = $x + 1
changerCle = -> $l = $l + 'a'
bumpAutre = -> $autre = $autre + 1
voisinIf = -> $voisin = not $voisin
voisinFor = -> $liste = [...$liste, 'v']
</script>
<div>
  <button class="x" @click={bumpX()}>x</button>
  <button class="cle" @click={changerCle()}>cle</button>
  <button class="autre" @click={bumpAutre()}>autre</button>
  <button class="vif" @click={voisinIf()}>vif</button>
  <button class="vfor" @click={voisinFor()}>vfor</button>
  <i class="hors">{$autre}</i>
  {if $voisin}<b class="vb">oui</b>{end}
  <ul>{for n in $liste}<li>{n}</li>{end}</ul>
  {key $l}
    <p class="a" title={compte('attr', $x)}>{compte('t', $x)}</p>
    <p class="fixe">{compte('fixe', 7)}</p>
  {end}
</div>
`

describe('{key} de racine — chaque valeur du bloc calculée une seule fois', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('montage, sa variable, une autre variable, blocs voisins {if} et {for}, puis clé changée', async () => {
    const { win, el } = await compileAndMount('keyrvbase', COMPOSANT)
    const cnt = () => win.__cnt as Record<string, number>
    const click = (sel: string) => el._shadow.querySelector(sel)
      .dispatchEvent(new win.Event('click', { bubbles: true, composed: true }))
    const a = () => el._shadow.querySelector('.a')

    assert.equal(el._mjs_has_crashed, undefined, 'aucun crash au montage')
    assert.equal(a().textContent, '1')
    assert.equal(a().getAttribute('title'), '1')
    assert.equal(cnt().t, 1, 'montage : texte lu une fois')
    assert.equal(cnt().attr, 1, 'montage : attribut lié lu une fois')
    assert.equal(cnt().fixe, 1, 'montage : valeur sans variable lue une fois')

    click('.autre')
    await attendre()
    assert.equal(el._shadow.querySelector('.hors').textContent, '2', 'l\'autre variable a bien changé')
    assert.equal(cnt().t, 1, 'autre variable : zéro calcul de plus (texte)')
    assert.equal(cnt().attr, 1, 'autre variable : zéro calcul de plus (attribut)')
    assert.equal(cnt().fixe, 1, 'autre variable : zéro calcul de plus (fixe)')

    click('.vif')
    await attendre()
    assert.ok(el._shadow.querySelector('.vb'), 'le {if} voisin a basculé')
    assert.equal(cnt().t, 1, '{if} voisin qui bascule : zéro calcul de plus (texte)')
    assert.equal(cnt().attr, 1, '{if} voisin qui bascule : zéro calcul de plus (attribut)')
    assert.equal(cnt().fixe, 1, '{if} voisin qui bascule : zéro calcul de plus (fixe)')

    click('.vfor')
    await attendre()
    assert.equal(el._shadow.querySelectorAll('li').length, 2, 'le {for} voisin a grandi')
    assert.equal(cnt().t, 1, '{for} voisin qui change : zéro calcul de plus (texte)')
    assert.equal(cnt().attr, 1, '{for} voisin qui change : zéro calcul de plus (attribut)')
    assert.equal(cnt().fixe, 1, '{for} voisin qui change : zéro calcul de plus (fixe)')

    click('.x')
    await attendre()
    assert.equal(a().textContent, '2', 'la valeur suit $x')
    assert.equal(a().getAttribute('title'), '2')
    assert.equal(cnt().t, 2, 'sa variable change : un seul calcul de plus (texte)')
    assert.equal(cnt().attr, 2, 'sa variable change : un seul calcul de plus (attribut)')
    assert.equal(cnt().fixe, 1, 'sa variable change : la valeur fixe ne bouge pas')

    // clé changée : bloc neuf, posé avec les valeurs courantes, même celles dont la variable n'a pas bougé
    click('.cle')
    await attendre()
    assert.equal(a().textContent, '2', 'bloc recréé avec la valeur courante (texte)')
    assert.equal(a().getAttribute('title'), '2', 'bloc recréé avec la valeur courante (attribut)')
    assert.equal(el._shadow.querySelector('.fixe').textContent, '7', 'bloc recréé avec la valeur fixe')
    assert.equal(cnt().t, 3, 'clé changée : un seul calcul de plus (texte)')
    assert.equal(cnt().attr, 3, 'clé changée : un seul calcul de plus (attribut)')
    assert.equal(cnt().fixe, 2, 'clé changée : un seul calcul de plus (fixe)')

    click('.autre')
    await attendre()
    assert.equal(cnt().t, 3, 'après recréation, une variable sans rapport ne calcule rien')

    click('.x')
    await attendre()
    assert.equal(a().textContent, '3', 'après recréation, le bloc suit toujours $x')
    assert.equal(cnt().t, 4)

    win.close?.()
  })

  it('un <select> aux options en {for}, value=!{$v} : la valeur survit à un changement de clé', async () => {
    const source = `
<script>
$v = 'b'
$opts = ['a', 'b', 'c']
$k = 1
cle = -> $k = $k + 1
</script>
<div>
  <button class="cle" @click={cle()}>cle</button>
  {key $k}<select aria-label="s" value=!{$v}>{for o in $opts}<option value={o}>{o}</option>{end}</select>{end}
</div>
`
    const { win, el } = await compileAndMount('keyrvsel', source)
    const click = (sel: string) => el._shadow.querySelector(sel)
      .dispatchEvent(new win.Event('click', { bubbles: true, composed: true }))
    assert.equal(el._shadow.querySelector('select').value, 'b', 'valeur au montage')
    click('.cle')
    await attendre()
    assert.equal(el._shadow.querySelectorAll('option').length, 3, 'options recréées')
    assert.equal(el._shadow.querySelector('select').value, 'b', 'valeur gardée après changement de clé')
    win.close?.()
  })

  it('composant enfant, {if} et {for} dans le bloc : ils suivent toujours, y compris après changement de clé', async () => {
    const source = `
<script>
$x = 1
$k = 1
$deep = false
$liste = ['u', 'v']
compte = (nom, v) ->
  c = (globalThis.__cnt ?= {})
  c[nom] = (c[nom] or 0) + 1
  v
bumpX = -> $x = $x + 1
cle = -> $k = $k + 1
ouvrir = -> $deep = true
ajouter = -> $liste = [...$liste, 'w']
</script>
<div>
  <button class="x" @click={bumpX()}>x</button>
  <button class="cle" @click={cle()}>cle</button>
  <button class="ouvre" @click={ouvrir()}>deep</button>
  <button class="add" @click={ajouter()}>add</button>
  {key $k}
    <p class="a">{compte('a', $x)}</p>
    <@keyrvenfant>
    <ul>{for n in $liste}<li>{n}</li>{end}</ul>
    {if $deep}<em class="deep">{compte('deep', $x)}</em>{end}
  {end}
</div>
`
    const enfant = `<p class="enf">enfant</p>`
    const { win, el } = await compileAndMount('keyrvnid', source, { keyrvenfant: enfant })
    const cnt = () => win.__cnt as Record<string, number>
    const click = (sel: string) => el._shadow.querySelector(sel)
      .dispatchEvent(new win.Event('click', { bubbles: true, composed: true }))
    const items = () => [...el._shadow.querySelectorAll('li')].map((l: any) => l.textContent).join(',')
    const enf = () => el._shadow.querySelector('mjs-keyrvenfant')?._shadow?.querySelector('.enf')?.textContent

    assert.equal(el._mjs_has_crashed, undefined)
    assert.equal(enf(), 'enfant', 'composant enfant monté')
    assert.equal(items(), 'u,v')
    assert.equal(cnt().a, 1, 'montage : une seule lecture')

    click('.add')
    await attendre()
    assert.equal(items(), 'u,v,w', 'le {for} niché suit sa liste')
    assert.equal(cnt().a, 1, 'liste changée : la valeur du bloc n\'est pas recalculée')

    click('.ouvre')
    await attendre()
    assert.equal(el._shadow.querySelector('.deep')?.textContent, '1', 'le {if} niché s\'ouvre avec sa valeur')
    assert.equal(cnt().deep, 1, 'branche neuve : un seul calcul')

    click('.x')
    await attendre()
    assert.equal(el._shadow.querySelector('.deep').textContent, '2', 'le {if} niché suit $x')
    assert.equal(el._shadow.querySelector('.a').textContent, '2')

    click('.cle')
    await attendre()
    assert.equal(items(), 'u,v,w', 'le {for} niché est reconstruit')
    assert.equal(enf(), 'enfant', 'le composant enfant est remonté')
    assert.equal(el._shadow.querySelector('.a').textContent, '2', 'valeur posée dans le bloc recréé')
    assert.equal(el._shadow.querySelector('.deep').textContent, '2', 'le {if} niché est recréé avec sa valeur')

    click('.add')
    await attendre()
    assert.equal(items(), 'u,v,w,w', 'le {for} suit encore après recréation')
    win.close?.()
  })

  it('{key} dans un {if} et {if} dans un {key} : valeurs justes, rien de périmé', async () => {
    const source = `
<script>
$x = 1
$k = 1
$ok = true
$in = true
compte = (nom, v) ->
  c = (globalThis.__cnt ?= {})
  c[nom] = (c[nom] or 0) + 1
  v
bumpX = -> $x = $x + 1
cle = -> $k = $k + 1
off = -> $ok = not $ok
inn = -> $in = not $in
</script>
<div>
  <button class="x" @click={bumpX()}>x</button>
  <button class="cle" @click={cle()}>cle</button>
  <button class="off" @click={off()}>off</button>
  <button class="in" @click={inn()}>in</button>
  {if $ok}
    {key $k}<p class="dans">{compte('dans', $x)}</p>{end}
  {end}
  {key $k}
    {if $in}<p class="sous" title={compte('sous', $x)}>{compte('sous', $x)}</p>{end}
  {end}
</div>
`
    const { win, el } = await compileAndMount('keyrvmix', source)
    const cnt = () => win.__cnt as Record<string, number>
    const click = (sel: string) => el._shadow.querySelector(sel)
      .dispatchEvent(new win.Event('click', { bubbles: true, composed: true }))
    const txt = (sel: string) => el._shadow.querySelector(sel)?.textContent

    assert.equal(el._mjs_has_crashed, undefined)
    assert.equal(txt('.dans'), '1')
    assert.equal(txt('.sous'), '1')
    assert.equal(cnt().dans, 1, '{key} dans {if} : une lecture au montage')
    assert.equal(cnt().sous, 2, '{if} dans {key} : une lecture par liaison (texte + attribut) au montage')

    click('.x')
    await attendre()
    assert.equal(txt('.dans'), '2')
    assert.equal(txt('.sous'), '2')
    assert.equal(cnt().dans, 2, '{key} dans {if} : un calcul de plus')
    assert.equal(cnt().sous, 4, '{if} dans {key} : un calcul de plus par liaison')

    click('.off')
    await attendre()
    assertAbsent(el._shadow.querySelector('.dans'))
    click('.off')
    await attendre()
    assert.equal(txt('.dans'), '2', '{if} rouvert : {key} recréé avec la valeur courante')
    assert.equal(cnt().dans, 3, '{if} rouvert : un seul calcul')

    click('.cle')
    await attendre()
    assert.equal(txt('.dans'), '2')
    assert.equal(txt('.sous'), '2', '{key} changé : {if} recréé avec la valeur courante')
    assert.equal(el._shadow.querySelector('.sous').getAttribute('title'), '2')

    click('.in')
    await attendre()
    assertAbsent(el._shadow.querySelector('.sous'))
    click('.in')
    await attendre()
    assert.equal(txt('.sous'), '2', '{if} rouvert dans le {key}')

    click('.x')
    await attendre()
    assert.equal(txt('.dans'), '3')
    assert.equal(txt('.sous'), '3', 'tout suit $x')
    win.close?.()
  })
})
