// Test runtime — un `{for}` de racine n'est relu que si sa liste ou une variable lue par ses lignes change.
//
// Défaut : la passe de structure d'un composant rejoue TOUS ses blocs dès qu'UNE variable de l'union
// `_mjs_renderStructVars` change. Un `{if}` voisin qui bascule rappelait donc `_mjs_updFor`, et la mise
// à jour de chaque ligne, alors que ni la liste ni rien de ce qu'elle lit n'avait bougé : 500 lignes à 3
// expressions = 1 500 évaluations par bascule. Le `{if}` avait déjà sa garde (il compare sa condition à
// l'ancienne), le `{for}` n'en avait aucune.
//
// Règle gardée ici : un `{for}` de racine n'est rappelé que si l'une de SES variables (itérable + celles
// que ses lignes lisent) a changé depuis la dernière passe, ou si le rendu est complet (montage, langue,
// promesse résolue, reprise) ; sinon il est sauté d'un bloc. On compte les lectures faites dans les lignes.
//
// Les cas « gain » (un voisin bouge : zéro lecture dans la liste) échouaient avant la garde. Les cas
// « garde » (tout ce qui DOIT rafraîchir la liste) passaient avant et doivent passer après : une liste
// ne doit jamais rester figée.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm, fileToId, ssrScopeFile, topoSortFiles } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const pause = (ms = 60) => new Promise((r) => setTimeout(r, ms))

async function monter(fichiers: Record<string, string>, avecI18n = false) {
  const root   = mjsTmp('for-relu')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), source)
  if (avecI18n) {
    const dir = join(srcDir, 'i18n')
    mkdirSync(join(dir, 'fr'), { recursive: true })
    mkdirSync(join(dir, 'en'), { recursive: true })
    writeFileSync(join(dir, 'fr.yml'), 'titre: Bienvenue\n')
    writeFileSync(join(dir, 'en.json'), JSON.stringify({ titre: 'Welcome' }))
    writeFileSync(join(dir, 'fr/liste.yml'), 'mot: Bonjour\n')
    writeFileSync(join(dir, 'en/liste.json'), JSON.stringify({ mot: 'Hello' }))
  }
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...(avecI18n ? { i18n: { default: 'fr' } } : {}) } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()

  const win: any = new Window({ url: 'http://localhost/' })
  if (avecI18n) {
    win.fetch = async (url: string) => {
      const m = url.match(/\/i18n\/([^/]+)\/([^/]+\.json)$/)
      const chemin = m ? join(outDir, 'i18n', m[1], m[2]) : ''
      if (!m || !existsSync(chemin)) return { ok: false, status: 404 }
      const json = JSON.parse(readFileSync(chemin, 'utf-8'))
      return { ok: true, status: 200, json: async () => json }
    }
    win.__mjsI18nImport = async (url: string) => {
      const src = readFileSync(join(outDir, String(url).split('/').pop()!), 'utf-8')
      return { default: JSON.parse(src.replace(/^export default /, '').replace(/;\s*$/, '')) }
    }
  }
  const files    = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const coreFile = files.find((f) => /^mjs_core-/.test(f))!
  const coeur    = stripEsm(readFileSync(join(outDir, coreFile), 'utf-8'))
  let code: string
  if (avecI18n) {
    const brut      = readFileSync(join(root, 'bundle.js'), 'utf-8')
    const debut     = brut.indexOf('const µReady = ')
    const corps     = brut.match(/const µReady = import\(µCore\)\.then\(async \(\{ µ \}\) => \{\n([\s\S]*)\n\}\);\nif \(typeof window/)
    assert.ok(corps, 'corps du manifeste introuvable')
    const manifeste = [stripEsm(brut.slice(0, debut)), corps![1]].join('\n').replace(/window\.µ\s*=\s*µ;?/, '')
    const autres    = files.filter((f) => f !== coreFile)
    const ids       = new Map(autres.map((f) => [f, fileToId(f)]))
    const resoudre  = (url: string): string | null => ids.get(url.split('/').pop() || '') ?? null
    const portees   = autres.map((f) => ({ f, id: ids.get(f)!, ...ssrScopeFile(readFileSync(join(outDir, f), 'utf-8'), ids.get(f)!, resoudre) }))
    const ordre     = topoSortFiles(portees.map((p) => p.id), new Map(portees.map((p) => [p.id, p.deps])), new Map(portees.map((p) => [p.id, p.f])))
    code = `µ._i18nImport = globalThis.__mjsI18nImport;\n${manifeste}\nglobalThis.µ = µ;\n${ordre.map((id) => portees.find((p) => p.id === id)!.code).join('\n')}`
  }
  else {
    const rang = (f: string) => f.startsWith('mjs_') ? 1 : 2
    code = `globalThis.µ = µ;\n${[...files].filter((f) => f !== coreFile).sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')}`
  }
  win.eval(`${coeur}\n${code}`)
  return win
}

function poser(win: any, tag: string) {
  win.document.body.insertAdjacentHTML('beforeend', `<${tag}></${tag}>`)
  const el: any = win.document.body.querySelector(tag)
  return {
    el,
    cnt:   () => (win.__cnt ?? {}) as Record<string, number>,
    clic:  (sel: string) => el._shadow.querySelector(sel).dispatchEvent(new win.Event('click', { bubbles: true, composed: true })),
    texte: (sel: string) => [...el._shadow.querySelectorAll(sel)].map((n: any) => n.textContent.trim()).join(','),
  }
}

// compteur commun : chaque lecture faite dans une ligne s'enregistre sous son nom. C'est une MÉTHODE
// (`@compte`) : le compilateur sait ce qu'une méthode lit, alors qu'une fonction nue du script appelée
// dans une ligne laisse la liste rejouée à chaque passe (cf. le dernier groupe de tests)
const COMPTE = `
@compte = (nom, v) ->
  c = (globalThis.__cnt ?= {})
  c[nom] = (c[nom] or 0) + 1
  v
`

// une liste, et à côté : un `{if}`, un `{key}`, un autre `{for}`, une variable lue hors des blocs
const VOISINS = `
<script>
$liste = [{id: 1, nom: 'a'}, {id: 2, nom: 'b'}, {id: 3, nom: 'c'}]
$mode = true
$cle = 0
$autres = ['p', 'q']
$hors = 0
${COMPTE}
basculer = -> $mode = not $mode
changerCle = -> $cle = $cle + 1
autresPlus = -> $autres = [...$autres, 'r']
horsPlus = -> $hors = $hors + 1
</script>
<div>
  <button class="mode" @click={basculer()}>m</button>
  <button class="cle" @click={changerCle()}>k</button>
  <button class="autres" @click={autresPlus()}>o</button>
  <button class="hors" @click={horsPlus()}>h</button>
  <i class="valhors" title={$hors}>{$hors}</i>
  {if $mode}<p class="m">oui</p>{else}<p class="m">non</p>{end}
  {key $cle}<b class="k">{$cle}</b>{end}
  <ul class="l">{for n in $liste by id}<li>{@compte('l', n.nom)}</li>{end}</ul>
  <ul class="o">{for m in $autres}<li>{@compte('o', m)}</li>{end}</ul>
</div>
`

describe('{for} de racine — relu seulement si sa liste ou ses variables changent', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('gain : un voisin bouge, la liste ne lit plus rien', function () {
    it('un {if} voisin qui bascule : zéro lecture dans la liste', async () => {
      const win = await monter({ 'fr-voisins.mjs': VOISINS })
      const { el, cnt, clic, texte } = poser(win, 'mjs-fr-voisins')
      await pause(100)
      assert.equal(el._mjs_has_crashed, undefined)
      assert.equal(texte('ul.l li'), 'a,b,c')
      const avant = cnt().l
      assert.equal(avant, 3, 'montage : une lecture par ligne')
      clic('.mode')
      await pause()
      assert.equal(texte('.m'), 'non', 'le {if} a bien basculé')
      assert.equal(cnt().l, avant, 'bascule du {if} : aucune ligne relue')
      assert.equal(cnt().o, 2, 'l\'autre liste non plus')
      clic('.mode')
      await pause()
      assert.equal(texte('.m'), 'oui')
      assert.equal(cnt().l, avant, 'bascule retour : aucune ligne relue')
    })

    it('un {key} voisin qui change : zéro lecture dans la liste', async () => {
      const win = await monter({ 'fr-voisins.mjs': VOISINS })
      const { cnt, clic, texte } = poser(win, 'mjs-fr-voisins')
      await pause(100)
      const avant = cnt().l
      clic('.cle')
      await pause()
      assert.equal(texte('.k'), '1', 'le {key} a bien été recréé')
      assert.equal(cnt().l, avant, '{key} voisin : aucune ligne relue')
    })

    it('un autre {for} voisin dont la liste change : seul celui-là est relu', async () => {
      const win = await monter({ 'fr-voisins.mjs': VOISINS })
      const { cnt, clic, texte } = poser(win, 'mjs-fr-voisins')
      await pause(100)
      const avantL = cnt().l
      const avantO = cnt().o
      clic('.autres')
      await pause()
      assert.equal(texte('ul.o li'), 'p,q,r', 'l\'autre liste a bien suivi')
      assert.equal(cnt().l, avantL, 'liste voisine changée : la première n\'est pas relue')
      assert.ok(cnt().o > avantO, 'la liste changée, elle, est relue')
    })

    it('une variable lue seulement hors des blocs : zéro lecture dans la liste', async () => {
      const win = await monter({ 'fr-voisins.mjs': VOISINS })
      const { el, cnt, clic, texte } = poser(win, 'mjs-fr-voisins')
      await pause(100)
      const avant = cnt().l
      clic('.hors')
      await pause()
      assert.equal(texte('.valhors'), '1', 'la variable lue hors des blocs a bien suivi')
      assert.equal(el._shadow.querySelector('.valhors').getAttribute('title'), '1')
      assert.equal(cnt().l, avant, 'variable hors des blocs : aucune ligne relue')
    })
  })

  describe('garde : tout ce qui doit rafraîchir la liste la rafraîchit', function () {
    const LISTE = `
<script>
$liste = [{id: 1, nom: 'a'}, {id: 2, nom: 'b'}]
$x = 0
$mode = true
${COMPTE}
ajouter = -> $liste = [...$liste, {id: $liste.length + 1, nom: 'z' + $liste.length}]
retirer = -> $liste = $liste.slice(0, -1)
remplacer = -> $liste = [{id: 9, nom: 'n'}]
profond = -> $liste[1].nom = 'B'
empiler = -> $liste.push({id: 7, nom: 'p'})
xPlus = -> $x = $x + 1
basculer = -> $mode = not $mode
</script>
<div>
  <button class="ajout" @click={ajouter()}>a</button>
  <button class="retrait" @click={retirer()}>r</button>
  <button class="rempl" @click={remplacer()}>e</button>
  <button class="prof" @click={profond()}>d</button>
  <button class="push" @click={empiler()}>p</button>
  <button class="x" @click={xPlus()}>x</button>
  <button class="mode" @click={basculer()}>m</button>
  {if $mode}<p class="m">oui</p>{end}
  <ul>{for n in $liste by id}<li>{@compte('l', n.nom)}-{$x}</li>{end}</ul>
</div>
`
    it('la liste change : ajout, retrait, réaffectation, champ profond, push', async () => {
      const win = await monter({ 'fr-liste.mjs': LISTE })
      const { cnt, clic, texte } = poser(win, 'mjs-fr-liste')
      await pause(100)
      assert.equal(texte('li'), 'a-0,b-0')
      clic('.ajout');  await pause()
      assert.equal(texte('li'), 'a-0,b-0,z2-0', 'ajout')
      clic('.retrait'); await pause()
      assert.equal(texte('li'), 'a-0,b-0', 'retrait')
      clic('.prof');   await pause()
      assert.equal(texte('li'), 'a-0,B-0', 'champ profond modifié en place')
      clic('.push');   await pause()
      assert.equal(texte('li'), 'a-0,B-0,p-0', 'push')
      clic('.rempl');  await pause()
      assert.equal(texte('li'), 'n-0', 'réaffectation')
      assert.ok(cnt().l > 0)
    })

    it('une variable lue par une ligne change : la ligne suit', async () => {
      const win = await monter({ 'fr-liste.mjs': LISTE })
      const { clic, texte } = poser(win, 'mjs-fr-liste')
      await pause(100)
      clic('.x'); await pause()
      assert.equal(texte('li'), 'a-1,b-1')
      clic('.x'); await pause()
      assert.equal(texte('li'), 'a-2,b-2')
    })

    it('deux écritures dans le même tour (voisin + liste) : la liste suit', async () => {
      const win = await monter({ 'fr-liste.mjs': LISTE })
      const { el, texte } = poser(win, 'mjs-fr-liste')
      await pause(100)
      el._set('mode', false)
      el._set('liste', [{ id: 5, nom: 'k' }])
      await pause()
      assert.equal(texte('li'), 'k-0')
      assertAbsent(el._shadow.querySelector('.m'))
      el._set('liste', [{ id: 6, nom: 'm' }])
      el._set('mode', true)
      await pause()
      assert.equal(texte('li'), 'm-0')
      assert.equal(texte('.m'), 'oui')
    })

    it('liste écrite dans un tour, voisin écrit dans le suivant : la liste a déjà suivi, rien de plus', async () => {
      const win = await monter({ 'fr-liste.mjs': LISTE })
      const { el, cnt, texte } = poser(win, 'mjs-fr-liste')
      await pause(100)
      el._set('liste', [{ id: 5, nom: 'k' }, { id: 6, nom: 'l' }])
      await pause()
      assert.equal(texte('li'), 'k-0,l-0')
      const apres = cnt().l
      el._set('mode', false)
      await pause()
      assert.equal(texte('li'), 'k-0,l-0')
      assert.equal(cnt().l, apres, 'le voisin du tour suivant ne relit pas la liste')
      el._set('liste', [{ id: 7, nom: 'u' }])
      await pause()
      assert.equal(texte('li'), 'u-0', 'et la liste suit encore après')
    })

    it('µraw réaffecté : la liste suit, un voisin qui bascule ne la relit pas', async () => {
      const source = `
<script>
$liste = µraw([{id: 1, nom: 'a'}])
$mode = true
${COMPTE}
remplacer = -> $liste = µraw([...$liste, {id: $liste.length + 1, nom: 'r' + $liste.length}])
basculer = -> $mode = not $mode
</script>
<div>
  <button class="rempl" @click={remplacer()}>e</button>
  <button class="mode" @click={basculer()}>m</button>
  {if $mode}<p class="m">oui</p>{end}
  <ul>{for n in $liste by id}<li>{@compte('l', n.nom)}</li>{end}</ul>
</div>
`
      const win = await monter({ 'fr-raw.mjs': source })
      const { cnt, clic, texte } = poser(win, 'mjs-fr-raw')
      await pause(100)
      clic('.rempl'); await pause()
      assert.equal(texte('li'), 'a,r1', 'µraw réaffecté')
      const avant = cnt().l
      clic('.mode'); await pause()
      assert.equal(cnt().l, avant, 'voisin : aucune ligne relue')
      clic('.rempl'); await pause()
      assert.equal(texte('li'), 'a,r1,r2', 'et la liste suit encore')
    })

    it('liste dérivée ($tous suit $liste) et variable dérivée lue par une ligne', async () => {
      const source = `
<script>
$base = [1, 2]
$k = 10
$tous = $base.map((v) -> v * 2)
$dec = $k + 1
${COMPTE}
plus = -> $base = [...$base, $base.length + 1]
kPlus = -> $k = $k + 1
</script>
<div>
  <button class="plus" @click={plus()}>p</button>
  <button class="k" @click={kPlus()}>k</button>
  <ul>{for v in $tous}<li>{@compte('l', v)}-{$dec}</li>{end}</ul>
</div>
`
      const win = await monter({ 'fr-derive.mjs': source })
      const { clic, texte } = poser(win, 'mjs-fr-derive')
      await pause(100)
      assert.equal(texte('li'), '2-11,4-11')
      clic('.plus'); await pause()
      assert.equal(texte('li'), '2-11,4-11,6-11', 'la dérivée-liste suit sa source')
      clic('.k'); await pause()
      assert.equal(texte('li'), '2-12,4-12,6-12', 'la dérivée lue par la ligne suit')
    })

    it('méthode du script appelée dans une ligne (@f) : suit les variables qu\'elle lit', async () => {
      const source = `
<script>
$liste = [{id: 1, nom: 'a'}]
$x = 0
@fmt = (n) -> n.nom + '/' + $x
xPlus = -> $x = $x + 1
${COMPTE}
</script>
<div>
  <button class="x" @click={xPlus()}>x</button>
  <ul>{for n in $liste by id}<li>{@fmt(n)}</li>{end}</ul>
</div>
`
      const win = await monter({ 'fr-methode.mjs': source })
      const { clic, texte } = poser(win, 'mjs-fr-methode')
      await pause(100)
      assert.equal(texte('li'), 'a/0')
      clic('.x'); await pause()
      assert.equal(texte('li'), 'a/1', 'la méthode lit $x : la ligne suit')
    })

    it('toutes les formes de liaison d\'une ligne suivent leur variable', async () => {
      const source = `
<script>
$liste = [{id: 1, nom: 'a'}]
$x = 'u'
$on = false
$c = 'red'
$h = '<b>h</b>'
xChange = -> $x = 'v'
onChange = -> $on = true
cChange = -> $c = 'blue'
hChange = -> $h = '<i>H</i>'
</script>
<div>
  <button class="x" @click={xChange()}>x</button>
  <button class="on" @click={onChange()}>o</button>
  <button class="c" @click={cChange()}>c</button>
  <button class="h" @click={hChange()}>h</button>
  <ul>{for n in $liste by id}<li class="r" title={$x} data-v="{n.nom}-{$x}" @class{$on}="actif" @style.color={$c} disabled={$on}>{$x}{{$h}}</li>{end}</ul>
</div>
`
      const win = await monter({ 'fr-formes.mjs': source })
      const { el, clic } = poser(win, 'mjs-fr-formes')
      await pause(100)
      const li = () => el._shadow.querySelector('li.r')
      assert.equal(li().getAttribute('title'), 'u')
      clic('.x'); await pause()
      assert.equal(li().getAttribute('title'), 'v', 'attribut lié')
      assert.equal(li().getAttribute('data-v'), 'a-v', 'attribut texte à trous')
      assert.ok(li().textContent.startsWith('v'), 'texte')
      clic('.on'); await pause()
      assert.ok(li().classList.contains('actif'), 'classe conditionnelle')
      assert.ok(li().hasAttribute('disabled'), 'booléen')
      clic('.c'); await pause()
      assert.equal(li().style.color, 'blue', 'style')
      clic('.h'); await pause()
      assert.ok(li().innerHTML.includes('<i>H</i>'), 'texte brut')
    })

    it('liste sous un {if} parent qui la recrée : les lignes sont refaites', async () => {
      const source = `
<script>
$liste = [{id: 1, nom: 'a'}, {id: 2, nom: 'b'}]
$mode = true
basculer = -> $mode = not $mode
</script>
<div>
  <button class="mode" @click={basculer()}>m</button>
  {if $mode}<ul>{for n in $liste by id}<li>{n.nom}</li>{end}</ul>{end}
</div>
`
      const win = await monter({ 'fr-parent-if.mjs': source })
      const { clic, texte } = poser(win, 'mjs-fr-parent-if')
      await pause(100)
      assert.equal(texte('li'), 'a,b')
      clic('.mode'); await pause()
      assert.equal(texte('li'), '', 'fermé')
      clic('.mode'); await pause()
      assert.equal(texte('li'), 'a,b', 'rouvert : lignes refaites')
    })

    it('prop reçue du parent : la liste de l\'enfant suit, son {if} voisin ne la relit pas', async () => {
      const pere = `
<script>
$liste = [{id: 1, nom: 'a'}]
ajouter = -> $liste = [...$liste, {id: $liste.length + 1, nom: 'z' + $liste.length}]
</script>
<button class="ajout" @click={ajouter()}>a</button>
<@fr-fils items={$liste}/>
`
      const fils = `
<script>
$mode = true
${COMPTE}
basculer = -> $mode = not $mode
</script>
<button class="mode" @click={basculer()}>m</button>
{if $mode}<p class="m">oui</p>{end}
<ul>{for n in $items by id}<li>{@compte('l', n.nom)}</li>{end}</ul>
`
      const win = await monter({ 'fr-pere.mjs': pere, 'fr-fils.mjs': fils })
      const { el, cnt, clic } = poser(win, 'mjs-fr-pere')
      await pause(120)
      const enfant: any = el._shadow.querySelector('mjs-fr-fils')
      const lire = () => [...enfant._shadow.querySelectorAll('li')].map((n: any) => n.textContent.trim()).join(',')
      assert.equal(lire(), 'a')
      clic('.ajout'); await pause()
      assert.equal(lire(), 'a,z1', 'prop changée : la liste suit')
      const avant = cnt().l
      enfant._shadow.querySelector('.mode').dispatchEvent(new win.Event('click', { bubbles: true, composed: true }))
      await pause()
      assertAbsent(enfant._shadow.querySelector('.m'), 'le {if} a basculé')
      assert.equal(cnt().l, avant, 'voisin de l\'enfant : liste non relue')
    })

    it('store universel lu dans l\'itérable et dans une ligne : la liste suit, un voisin ne la relit pas', async () => {
      const source = `
<script>
$$items = [{id: 1, nom: 'a'}]
$$tag = 't0'
$mode = true
${COMPTE}
basculer = -> $mode = not $mode
</script>
<div>
  <button class="mode" @click={basculer()}>m</button>
  {if $mode}<p class="m">oui</p>{end}
  <ul>{for n in $$items by id}<li>{@compte('l', n.nom)}-{$$tag}</li>{end}</ul>
</div>
`
      const win = await monter({ 'fr-store.mjs': source })
      const { cnt, clic, texte } = poser(win, 'mjs-fr-store')
      await pause(100)
      assert.equal(texte('li'), 'a-t0')
      win.µ.store.items = [{ id: 1, nom: 'a' }, { id: 2, nom: 'b' }]
      await pause()
      assert.equal(texte('li'), 'a-t0,b-t0', 'store itéré réaffecté')
      win.µ.store.tag = 't1'
      await pause()
      assert.equal(texte('li'), 'a-t1,b-t1', 'store lu par la ligne')
      const avant = cnt().l
      clic('.mode'); await pause()
      assert.equal(cnt().l, avant, 'voisin : liste non relue')
    })

    it('contexte réactif (§§) lu dans l\'itérable d\'un enfant : la liste suit', async () => {
      const pere = `
<script>
§§cfg = {liste: ['a']}
ajouter = -> §§cfg.liste = [...§§cfg.liste, 'z']
</script>
<button class="ajout" @click={ajouter()}>a</button>
<@fr-cfils/>
`
      const fils = `
<script>
$mode = true
</script>
{if $mode}<p class="m">oui</p>{end}
<ul>{for n in §§cfg.liste}<li>{n}</li>{end}</ul>
`
      const win = await monter({ 'fr-cpere.mjs': pere, 'fr-cfils.mjs': fils })
      const { el, clic } = poser(win, 'mjs-fr-cpere')
      await pause(120)
      const enfant: any = el._shadow.querySelector('mjs-fr-cfils')
      const lire = () => [...enfant._shadow.querySelectorAll('li')].map((n: any) => n.textContent.trim()).join(',')
      assert.equal(lire(), 'a')
      clic('.ajout'); await pause()
      assert.equal(lire(), 'a,z', 'contexte réactif réécrit : la liste suit')
    })

    it('promesse d\'un {await} voisin qui se résout : la liste est relue, ses lignes sont justes', async () => {
      const source = `
<script>
$liste = [{id: 1, nom: 'a'}]
$x = 0
$p = window.__p
${COMPTE}
window.__p.then (v) -> $x = v
</script>
<div>
  {await $p}<i class="att">...</i>{success v}<b class="ok">{v}</b>{end}
  <ul>{for n in $liste by id}<li>{@compte('l', n.nom)}-{$x}</li>{end}</ul>
</div>
`
      const win = await monter({ 'fr-promesse.mjs': source })
      let resoudre: (v: any) => void = () => {}
      win.__p = new Promise((r) => { resoudre = r })
      const { cnt, texte } = poser(win, 'mjs-fr-promesse')
      await pause(100)
      assert.equal(texte('li'), 'a-0')
      const avant = cnt().l
      resoudre(5)
      await pause(120)
      assert.equal(texte('.ok'), '5', 'la branche {success} est posée')
      assert.equal(texte('li'), 'a-5', 'la ligne lit la valeur écrite à la résolution')
      assert.ok(cnt().l > avant, 'rendu complet : la liste a été relue')
    })

    it('changement de langue (µt dans une ligne) : la liste est refaite, un voisin ne la relit pas', async () => {
      const source = `
@i18n 'liste'
<script>
$liste = [{id: 1, nom: 'a'}]
$mode = true
${COMPTE}
basculer = -> $mode = not $mode
</script>
<div>
  <button class="mode" @click={basculer()}>m</button>
  {if $mode}<p class="m">oui</p>{end}
  <ul>{for n in $liste by id}<li>{@compte('l', n.nom)}-{µt('mot')}</li>{end}</ul>
</div>
`
      const win = await monter({ 'fr-langue.mjs': source }, true)
      const { cnt, clic, texte } = poser(win, 'mjs-fr-langue')
      await pause(250)
      assert.equal(texte('li'), 'a-Bonjour')
      const avant = cnt().l
      clic('.mode'); await pause()
      assert.equal(cnt().l, avant, 'voisin : liste non relue')
      win.µ.store.__mjsLang = 'en'
      await pause(250)
      assert.equal(texte('li'), 'a-Hello', 'langue changée : la liste suit')
      win.µ.store.__mjsLang = 'fr'
      await pause(250)
      assert.equal(texte('li'), 'a-Bonjour', 'retour au français')
    })

    it('ligne qui sort avec une transition pendant qu\'un voisin bascule : elle finit de partir', async () => {
      const source = `
<script>
$liste = [{id: 1, nom: 'a'}, {id: 2, nom: 'b'}]
$mode = true
retirer = -> $liste = $liste.slice(0, 1)
basculer = -> $mode = not $mode
</script>
<div>
  <button class="retrait" @click={retirer()}>r</button>
  <button class="mode" @click={basculer()}>m</button>
  {if $mode}<p class="m">oui</p>{end}
  <ul>{for n in $liste by id}<li @out=*fade(duration: 80ms)>{n.nom}</li>{end}</ul>
</div>
`
      const win = await monter({ 'fr-sortie.mjs': source })
      const { el, clic, texte } = poser(win, 'mjs-fr-sortie')
      await pause(100)
      assert.equal(texte('li'), 'a,b')
      clic('.retrait')
      await pause(10)
      clic('.mode')
      await pause(400)
      assert.equal(texte('li'), 'a', 'la ligne retirée a fini de partir')
      assertAbsent(el._shadow.querySelector('.m'), 'le voisin a bien basculé')
      clic('.mode'); await pause()
      assert.equal(texte('li'), 'a')
    })

    it('listes imbriquées : une variable lue seulement par la ligne intérieure est suivie', async () => {
      const source = `
<script>
$groupes = [{id: 1, items: ['a', 'b']}]
$x = 0
xPlus = -> $x = $x + 1
ajout = -> $groupes = [{id: 1, items: ['a', 'b', 'c']}]
</script>
<div>
  <button class="x" @click={xPlus()}>x</button>
  <button class="ajout" @click={ajout()}>a</button>
  {for g in $groupes by id}<ul>{for it in g.items}<li>{it}{$x}</li>{end}</ul>{end}
</div>
`
      const win = await monter({ 'fr-imbrique.mjs': source })
      const { clic, texte } = poser(win, 'mjs-fr-imbrique')
      await pause(100)
      assert.equal(texte('li'), 'a0,b0')
      clic('.x'); await pause()
      assert.equal(texte('li'), 'a1,b1')
      clic('.ajout'); await pause()
      assert.equal(texte('li'), 'a1,b1,c1')
    })
  })
  // pourquoi ces tests : une fonction du script appelée dans une ligne ou dans l'itérable peut lire une
  // variable que le compilateur ne voit pas. Une telle liste n'est PAS gardée : elle reste rejouée à
  // chaque passe de structure, comme avant, pour ne jamais rester figée
  describe('fonction nue du script : la liste reste rejouée à chaque passe', function () {
    it('ligne {fmt(n)} où fmt lit $x : un {if} voisin sur $x la rafraîchit toujours', async () => {
      const source = `
<script>
fmt = (n) -> n.nom + '+' + $x
$liste = [{id: 1, nom: 'a'}]
$x = 'x0'
suite = -> $x = if $x is 'x0' then 'x1' else 'x2'
</script>
<div>
  <button class="x" @click={suite()}>x</button>
  {if $x}<p class="m">ok</p>{end}
  <ul>{for n in $liste by id}<li>{fmt(n)}</li>{end}</ul>
</div>
`
      const win = await monter({ 'fr-nue.mjs': source })
      const { clic, texte } = poser(win, 'mjs-fr-nue')
      await pause(100)
      assert.equal(texte('li'), 'a+x0')
      clic('.x'); await pause()
      assert.equal(texte('li'), 'a+x1')
      clic('.x'); await pause()
      assert.equal(texte('li'), 'a+x2')
    })

    it('itérable visibles() qui lit $filtre, ligne qui lit $x : la liste suit $filtre', async () => {
      const source = `
<script>
$liste = [{id: 1, nom: 'a'}, {id: 2, nom: 'b'}]
$filtre = ''
$x = 'x'
visibles = -> $liste.filter((q) -> q.nom != $filtre)
filtrer = -> $filtre = if $filtre is 'a' then 'b' else 'a'
</script>
<div>
  <button class="f" @click={filtrer()}>f</button>
  {if [$filtre, $liste].length}<p class="m">ok</p>{end}
  <ul>{for n in visibles() by id}<li>{n.nom}{$x}</li>{end}</ul>
</div>
`
      const win = await monter({ 'fr-iter.mjs': source })
      const { clic, texte: textes } = poser(win, 'mjs-fr-iter')
      await pause(100)
      assert.equal(textes('li'), 'ax,bx')
      clic('.f'); await pause()
      assert.equal(textes('li'), 'bx')
      clic('.f'); await pause()
      assert.equal(textes('li'), 'ax')
    })

    it('{if cond(n)} dans une ligne, cond lit $filtre : la ligne suit', async () => {
      const source = `
<script>
$liste = [{id: 1, nom: 'a'}, {id: 2, nom: 'b'}]
$filtre = ''
cond = (n) -> n.nom != $filtre
filtrer = -> $filtre = if $filtre is 'a' then 'b' else 'a'
</script>
<div>
  <button class="f" @click={filtrer()}>f</button>
  {if $filtre}<p class="m">ok</p>{end}
  <ul>{for n in $liste by id}{if cond(n)}<li>{n.nom}</li>{end}{end}</ul>
</div>
`
      const win = await monter({ 'fr-cond.mjs': source })
      const { clic, texte: textes } = poser(win, 'mjs-fr-cond')
      await pause(100)
      assert.equal(textes('li'), 'a,b')
      clic('.f'); await pause()
      assert.equal(textes('li'), 'b')
      clic('.f'); await pause()
      assert.equal(textes('li'), 'a')
    })

    // formes où une fonction, une constante, un accesseur ou une variable du script est lue SANS que le
    // compilateur la voie : la liste n'est pas gardée, un `{if}` voisin sur la variable cachée la rafraîchit.
    // Le préfixe d'un nom (`format`, `ifOk`, `Numero`, `_fmt`) ne fait pas de lui un mot du langage
    const SCRIPT_NU = `<script lang="coffee">
$liste = [{id: 1, nom: 'a', tags: [{nom: 't1'}, {nom: 't2'}]}, {id: 2, nom: 'b', tags: [{nom: 't3'}]}]
$unit = 'x'
$tick = 0
compteur = 0
fmt = (s) -> s + '+' + $unit
format = (s) -> s + '+' + $unit
formatDate = (s) -> s + '+' + $unit
forme = (s) -> s + '+' + $unit
ifOk = (s) -> s + '+' + $unit
newLabel = (s) -> s + '+' + $unit
Numero = (s) -> s + '+' + $unit
returnIt = (s) -> s + '+' + $unit
awaitIt = (s) -> s + '+' + $unit
typeofIt = (s) -> s + '+' + $unit
_fmt = (s) -> s + '+' + $unit
__f = (s) -> s + '+' + $unit
lab = (t) -> t.nom + '+' + $unit
fmtO = (o) -> o.nom + '+' + $unit
garder = (s) -> $unit is 'x' or s isnt 'b'
tag = (s, v) -> s[0] + v + '+' + $unit
utils = { fmt: (s) -> s + '+' + $unit }
class Fmt
  constructor: (n) -> @n = n
  v: -> @n + '+' + $unit
objget = Object.defineProperty({}, 'val', { get: -> $unit })
changerUnit = -> $unit = 'y'
bump = ->
  compteur++
  $tick++
</script>
`
    const ligne = (expr: string) => `{for n in $liste by id}<p class="x">${expr}</p>{end}`
    const unitAvant = /^a\S*x\S*,b\S*x\S*$/
    const unitApres = /^a\S*y\S*,b\S*y\S*$/
    const formesNues: Array<[string, string, RegExp, RegExp, string]> = [
      ['format(', ligne('{format(n.nom)}'), unitAvant, unitApres, 'u'],
      ['formatDate(', ligne('{formatDate(n.nom)}'), unitAvant, unitApres, 'u'],
      ['forme(', ligne('{forme(n.nom)}'), unitAvant, unitApres, 'u'],
      ['ifOk(', ligne('{ifOk(n.nom)}'), unitAvant, unitApres, 'u'],
      ['newLabel(', ligne('{newLabel(n.nom)}'), unitAvant, unitApres, 'u'],
      ['Numero(', ligne('{Numero(n.nom)}'), unitAvant, unitApres, 'u'],
      ['returnIt(', ligne('{returnIt(n.nom)}'), unitAvant, unitApres, 'u'],
      ['awaitIt(', ligne('{awaitIt(n.nom)}'), unitAvant, unitApres, 'u'],
      ['typeofIt(', ligne('{typeofIt(n.nom)}'), unitAvant, unitApres, 'u'],
      ['_fmt(', ligne('{_fmt(n.nom)}'), unitAvant, unitApres, 'u'],
      ['__f(', ligne('{__f(n.nom)}'), unitAvant, unitApres, 'u'],
      ['appel optionnel fmt?.(n)', ligne('{fmt?.(n.nom)}'), unitAvant, unitApres, 'u'],
      ['gabarit étiqueté', ligne('{tag`${n.nom}`}'), unitAvant, unitApres, 'u'],
      ['fonction passée en rappel dans une ligne', ligne('{n.tags.map(lab).join(",")}'), /^t1\+x,t2\+x,t3\+x$/, /^t1\+y,t2\+y,t3\+y$/, 'u'],
      ['fonction passée en rappel dans l\'itérable', '{for n in $liste.map(fmtO) by n}<p class="x">{n}</p>{end}', unitAvant, unitApres, 'u'],
      ['fonction nue dans une fléchée de l\'itérable', '{for n in $liste.filter((e) -> garder(e.nom)) by id}<p class="x">{n.nom}</p>{end}', /^a,b$/, /^a$/, 'u'],
      ['accesseur (get) d\'un objet du script', ligne('{n.nom}{objget.val}'), unitAvant, unitApres, 'u'],
      ['variable let du script non réactive', ligne('{n.nom}{compteur}'), /^a0,b0$/, /^a1,b1$/, 'b'],
      ['appel par un objet du script', ligne('{utils.fmt(n.nom)}'), unitAvant, unitApres, 'u'],
      ['new d\'une classe du script', ligne('{new Fmt(n.nom).v()}'), unitAvant, unitApres, 'u'],
    ]
    for (const [nom, liste, avant, apres, bouton] of formesNues) {
      it(`${nom} : un {if} voisin sur la variable cachée rafraîchit la liste`, async () => {
        const source = `${SCRIPT_NU}<div>
  <button class="u" @click={changerUnit()}>u</button>
  <button class="b" @click={bump()}>b</button>
  {if $unit is 'y' or $tick > 0}<b class="y">Y</b>{end}
  <div class="liste">${liste}</div>
</div>
`
        const win = await monter({ 'fr-forme.mjs': source })
        const { clic, texte } = poser(win, 'mjs-fr-forme')
        await pause(100)
        assert.match(texte('.x'), avant, 'montage')
        clic('.' + bouton); await pause()
        assert.match(texte('.x'), apres, 'après le changement de la variable cachée')
      })
    }
  })

  // pourquoi ces tests : ce que le compilateur voit en entier (élément, index, état réactif, méthode
  // `@nom`, globaux JavaScript sans état, fléchée en ligne qui ne lit que son paramètre) laisse la liste
  // gardée : un voisin qui bascule ne rappelle plus aucune ligne
  describe('formes toujours gardées : un voisin qui bascule, zéro lecture', function () {
    const formesGardees: Array<[string, string]> = [
      ['texte {n.nom}', `{@compte('l', n.nom)}`],
      ['somme {n.a + n.b}', `{@compte('l', n.a + n.b)}`],
      ['String(n.x)', `{@compte('l', String(n.x))}`],
      ['Math.round(n.x)', `{@compte('l', Math.round(n.x))}`],
      ['n.ts.join(\', \')', `{@compte('l', n.ts.join(', '))}`],
      ['fléchée en ligne qui ne lit que son paramètre', `{@compte('l', n.tags.map((t) -> t.nom).join(' '))}`],
      ['méthode @fmt(n)', `{@fmt(n)}`],
      ['variable réactive {n.nom}{$x}', `{@compte('l', n.nom)}{$x}`],
    ]
    for (const [nom, expr] of formesGardees) {
      it(`${nom} : un {if} voisin qui bascule ne rappelle pas la liste`, async () => {
        const source = `<script>
$liste = [{id: 1, nom: 'a', a: 1, b: 2, x: 1.4, ts: ['t1', 't2'], tags: [{nom: 't1'}]}, {id: 2, nom: 'b', a: 3, b: 4, x: 2.6, ts: ['t3'], tags: [{nom: 't3'}]}]
$mode = true
$x = 'x0'
${COMPTE}
@fmt = (n) -> @compte('l', n.nom)
basculer = -> $mode = not $mode
</script>
<div>
  <button class="mode" @click={basculer()}>m</button>
  {if $mode}<p class="m">oui</p>{else}<p class="m">non</p>{end}
  <ul>{for n in $liste by id}<li>${expr}</li>{end}</ul>
</div>
`
        const win = await monter({ 'fr-gardee.mjs': source })
        const { cnt, clic, texte } = poser(win, 'mjs-fr-gardee')
        await pause(100)
        const avant = cnt().l
        assert.equal(avant, 2, 'montage : une lecture par ligne')
        clic('.mode'); await pause()
        assert.equal(texte('.m'), 'non', 'le {if} a bien basculé')
        assert.equal(cnt().l, avant, 'aucune ligne relue')
      })
    }
  })
})
