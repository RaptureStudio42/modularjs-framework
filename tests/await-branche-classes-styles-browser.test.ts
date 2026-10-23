// `@class{cond}`, `@style.prop={…}` et `@flip` posés dans une branche de `{await}` (attente, `{success}`, `{error}`, ou un `{if}` / un `{key}` qui s'y
// trouve) agissent comme hors du bloc : la classe et le style sont posés à la création de la branche, puis suivent la variable quand elle change après
// l'arrivée (ou le rejet) de la promesse ; les lignes d'un `{for}` placé dans `{success}` glissent quand leur ordre change, comme celles d'un `{for}`
// de la racine (la liste de `{success}` se refait quand une variable du dehors lue par ses lignes change : les lignes du cas `@flip` lisent donc la liste).
// Chaque cas a son témoin, la même balise hors de `{await}` : un témoin faux dirait que le test lui-même est faux, il arrête donc le cas aussitôt.
// La promesse est tenue par le test (`finir()`), pour que la branche d'attente existe avant l'arrivée.
// Les trois modes : développement, production en fichiers séparés, production en un seul fichier. Chromium réel.
// branche plus affichée (promesse remplacée, rejetée ou retirée) : son nœud reste connu du composant, l'effet d'une condition qui lit la valeur
// de la branche ne relit rien, sinon le composant entier tombe ; un `{const}` lu par la condition fait suivre la variable qu'il lit
// un `<svg>` à `class` fixe, un `<use href>` et un `<math>` d'une branche construite élément par élément reçoivent leurs attributs sans erreur
// un `@attach` qui lit la valeur de la branche et une variable, un `@text=!{v.titre}` et un `@html=!{v.corps}` : même garde, une branche qui n'est plus affichée
// ne relit rien (la valeur qu'elle lisait est `null`), puis la liaison reprend quand la branche revient (succès → attente → succès, succès → erreur → succès)

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  // la branche `{success}` : une balise dans le bloc, son témoin à la racine
  'aw-succes.mjs': `<script>
  $on = true
  $c  = 'red'
  fin = null
  $p  = new Promise((res) -> fin = res)
  @finir   = -> fin('ok')
  @allumer = (x) -> $on = x
  @teinter = (x) -> $c = x
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <b class="ok" @class{$on}="actif" @style.color={$c}>{v}</b>
{end}
<u class="temoin" @class{$on}="actif" @style.color={$c}>témoin</u>
`,
  // les autres écritures du style : propriété composée, `--variable`, forme conditionnelle, valeur fixe, `!important`
  'aw-formes.mjs': `<script>
  $on = true
  $c  = 'red'
  fin = null
  $p  = new Promise((res) -> fin = res)
  @finir   = -> fin('ok')
  @allumer = (x) -> $on = x
  @teinter = (x) -> $c = x
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <b class="ok" --teinte={$c} @style.border-color={$c} @style.width{$on}="10px" @style.height="20px" @style.margin-top={$on ? '4px !important' : '8px'}>{v}</b>
{end}
<u class="temoin" --teinte={$c} @style.border-color={$c} @style.width{$on}="10px" @style.height="20px" @style.margin-top={$on ? '4px !important' : '8px'}>témoin</u>
`,
  // un `{if}` et un `{key}` placés dans `{success}` : ils prennent le contexte de la branche qui les enveloppe
  'aw-imbrique.mjs': `<script>
  $on = true
  $c  = 'red'
  fin = null
  $p  = new Promise((res) -> fin = res)
  @finir   = -> fin('ok')
  @allumer = (x) -> $on = x
  @teinter = (x) -> $c = x
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  {if v}
    <b class="dans-si" @class{$on}="actif" @style.color={$c}>{v}</b>
  {end}
  {key v}
    <b class="dans-key" @class{$on}="actif" @style.color={$c}>{v}</b>
  {end}
{end}
<u class="temoin" @class{$on}="actif" @style.color={$c}>témoin</u>
`,
  // la promesse est remplacée : la branche `{success}` est refaite, la classe doit suivre les nouveaux nœuds et non les anciens
  'aw-relance.mjs': `<script>
  $on = true
  fin = null
  $p  = new Promise((res) -> fin = res)
  @finir    = -> fin('ok')
  @relancer = -> $p = new Promise((res) -> fin = res)
  @allumer  = (x) -> $on = x
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <b class="ok" @class{$on}="actif">{v}</b>
{end}
<u class="temoin" @class{$on}="actif">témoin</u>
`,
  // la branche d'attente : la promesse n'est jamais réglée
  'aw-attente.mjs': `<script>
  $on = true
  $c  = 'red'
  fin = null
  $p  = new Promise((res) -> fin = res)
  @allumer = (x) -> $on = x
  @teinter = (x) -> $c = x
</script>
{await $p}
  <i class="att" @class{$on}="actif" @style.color={$c}>attente</i>
{success v}
  <b class="ok">{v}</b>
{end}
<u class="temoin" @class{$on}="actif" @style.color={$c}>témoin</u>
`,
  // la branche `{error}` : la promesse est rejetée par `finir()`
  'aw-erreur.mjs': `<script>
  $on = true
  $c  = 'red'
  fin = null
  $p  = new Promise((res, rej) -> fin = rej)
  @finir   = -> fin(new Error('non'))
  @allumer = (x) -> $on = x
  @teinter = (x) -> $c = x
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <b class="ok">{v}</b>
{error err}
  <b class="ko" @class{$on}="actif" @style.color={$c}>{err.message}</b>
{end}
<u class="temoin" @class{$on}="actif" @style.color={$c}>témoin</u>
`,
  // les lignes d'un `{for}` de `{success}` et celles du même `{for}` à la racine
  'aw-lignes.mjs': `<script>
  $on    = true
  $c     = 'red'
  $liste = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }]
  fin    = null
  $p     = new Promise((res) -> fin = res)
  @finir   = -> fin('ok')
  @allumer = (x) -> $on = x
  @teinter = (x) -> $c = x
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <ul class="dans">
    {for it in $liste by id}
      <li class="l" @class{$on}="actif" @style.color={$c}>{it.t}</li>
    {end}
  </ul>
{end}
<ul class="hors">
  {for it in $liste by id}
    <li class="l" @class{$on}="actif" @style.color={$c}>{it.t}</li>
  {end}
</ul>
`,
  // la condition et la valeur lisent ce que la branche introduit : la valeur de `{success}` et un `{const}`
  'aw-valeur.mjs': `<script>
  $on  = true
  $val = { n: 7, couleur: 'green' }
  fin  = null
  $p   = new Promise((res) -> fin = res)
  @finir   = -> fin({ n: 7, couleur: 'green' })
  @allumer = (x) -> $on = x
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  {const gros = v.n > 5}
  <b class="ok" @class{gros and $on}="actif" @style.color={v.couleur}>{v.n}</b>
{end}
<u class="temoin" @class{$val.n > 5 and $on}="actif" @style.color={$val.couleur}>témoin</u>
`,
  // le même `{for}` dans `{success}` et à la racine, `@flip` sur chaque ligne (cinq secondes : l'animation est encore en cours à la lecture) ;
  // chaque ligne affiche la taille de la liste : c'est la variable du dehors qu'elle lit qui refait la liste de `{success}` quand `$liste` change
  'aw-flip.mjs': `<script>
  $liste = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  fin    = null
  $p     = new Promise((res) -> fin = res)
  @finir = -> fin('ok')
  @poser = (l) -> $liste = l
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <ul class="dans">
    {for it in $liste by id}
      <li @flip=5000 data-k="{it.id}">{it.id} sur {$liste.length}</li>
    {end}
  </ul>
{end}
<ul class="hors">
  {for it in $liste by id}
    <li @flip=5000 data-k="{it.id}">{it.id} sur {$liste.length}</li>
  {end}
</ul>
<style>
  ul
    list-style: none
    padding: 0
    margin: 8px 0

  li
    min-height: 24px
</style>
`,
  // la condition lit la valeur de `{success}` ET une variable ; la promesse est remplacée, rejetée (sans branche `{error}`) ou retirée
  // pendant que la variable bouge : la branche n'est plus affichée, la valeur qu'elle lisait n'existe plus
  'aw-perime.mjs': `<script>
  $on = true
  fin = null
  $p  = Promise.resolve({ n: 7 })
  @attendre = -> $p = new Promise((res, rej) -> fin = [res, rej])
  @finir    = (x) -> fin[0](x)
  @rejeter  = -> $p = Promise.reject(new Error('non'))
  @vider    = -> $p = null
  @allumer  = (x) -> $on = x
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <b class="ok" @class{v.n > 5 and $on}="actif">{v.n}</b>
{end}
<u class="temoin" @class{$on}="actif">témoin</u>
`,
  // `{success}` et `{error}` lisent chacune leur valeur et une variable : la promesse passe de l'une à l'autre
  'aw-perime-erreur.mjs': `<script>
  $on = true
  fin = null
  $p  = Promise.resolve({ n: 7 })
  @attendre = -> $p = new Promise((res, rej) -> fin = [res, rej])
  @finir    = (x) -> fin[0](x)
  @refuser  = (m) -> fin[1](new Error(m))
  @allumer  = (x) -> $on = x
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <b class="ok" @class{v.n > 5 and $on}="actif">{v.n}</b>
{error err}
  <b class="ko" @class{err.message === 'non' and $on}="actif">{err.message}</b>
{end}
<u class="temoin" @class{$on}="actif">témoin</u>
`,
  // une liaison à deux sens sur une propriété de la valeur de `{success}` : même effet de la racine, même garde
  'aw-champ.mjs': `<script>
  fin = null
  $p  = Promise.resolve({ nom: 'Ada' })
  @attendre = -> $p = new Promise((res, rej) -> fin = [res, rej])
  @finir    = (x) -> fin[0](x)
  @refuser  = -> fin[1](new Error('non'))
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <label>nom <input class="champ" value=!{v.nom}></label>
{end}
<u class="temoin">témoin</u>
`,
  // un `<svg>` à `class` fixe, un `<use href>` et un `<math>` dans une branche qui porte aussi un `@class` (la branche se construit alors élément
  // par élément) ; le même `<svg>` à la racine sert de témoin à la lecture
  'aw-svg.mjs': `<script>
  $on = true
  fin = null
  $p  = new Promise((res) -> fin = res)
  @finir   = -> fin('ok')
  @allumer = (x) -> $on = x
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <svg class="icone" id="dessin" viewBox="0 0 10 10" width="20" height="20"><circle class="rond" cx="5" cy="5" r="4"></circle><use href="#a"></use></svg>
  <math class="formule"><mi>x</mi></math>
  <b class="ok" @class{$on}="actif">{v}</b>
{end}
<svg class="icone" id="hors" viewBox="0 0 10 10" width="20" height="20"><circle class="rond" cx="5" cy="5" r="4"></circle><use href="#a"></use></svg>
<u class="temoin" @class{$on}="actif">témoin</u>
`,
  // un `<svg>` à `class` fixe dans une branche qui contient un `{if}`, un `{for}` ou une interpolation, sans aucun `@class`
  'aw-svg-si.mjs': `<script>
  $on = true
  fin = null
  $p  = new Promise((res) -> fin = res)
  @finir = -> fin('ok')
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <svg class="icone" viewBox="0 0 10 10"><circle class="rond" cx="5" cy="5" r="4"></circle><use href="#a"></use></svg>
  {if $on}
    <b class="dans">{v}</b>
  {end}
{end}
<u class="temoin">témoin</u>
`,
  'aw-svg-pour.mjs': `<script>
  fin = null
  $p  = new Promise((res) -> fin = res)
  @finir = -> fin(['a', 'b'])
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <svg class="icone" viewBox="0 0 10 10"><circle class="rond" cx="5" cy="5" r="4"></circle><use href="#a"></use></svg>
  {for x in v}
    <i class="dans">{x}</i>
  {end}
{end}
<u class="temoin">témoin</u>
`,
  'aw-svg-texte.mjs': `<script>
  fin = null
  $p  = new Promise((res) -> fin = res)
  @finir = -> fin('ok')
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <svg class="icone" viewBox="0 0 10 10"><circle class="rond" cx="5" cy="5" r="4"></circle><use href="#a"></use></svg>
  <b class="dans">{v}</b>
{end}
<u class="temoin">témoin</u>
`,
  // la condition et la couleur lisent un `{const}` qui en lit un autre, lequel lit une variable : la classe et la couleur suivent cette variable
  // seule, sans que la promesse ni rien d'autre ne bouge ; le témoin refait le même calcul à la racine
  'aw-const.mjs': `<script>
  $n = 1
  fin = null
  $p  = new Promise((res) -> fin = res)
  @finir = -> fin({ k: 3 })
  @poser = (x) -> $n = x
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  {const deux = $n * 2}
  {const total = deux + v.k}
  <b class="ok" @class{total > 8}="actif" @style.color={total > 8 ? 'red' : 'blue'}>{total}</b>
{end}
<u class="temoin" @class{$n * 2 + 3 > 8}="actif" @style.color={$n * 2 + 3 > 8 ? 'red' : 'blue'}>témoin</u>
`,
  // un `@attach` dont la fabrique lit la valeur de chaque branche et le thème : la fabrique est rappelée quand le thème change, seulement dans la branche
  // affichée ; chaque pose écrit `data-marque` (texte/thème), son retrait l'efface ; le témoin refait la même pose à la racine
  'aw-attache.mjs': `<script>
  $theme = 'clair'
  fin    = null
  $p     = Promise.resolve({ label: 'A' })
  marque = (txt, th) -> (n) ->
    n.setAttribute('data-marque', txt + '/' + th)
    -> n.removeAttribute('data-marque')
  @attendre = -> $p = new Promise((res, rej) -> fin = [res, rej])
  @finir    = (x) -> fin[0](x)
  @refuser  = (m) -> fin[1](new Error(m))
  @habiller = (x) -> $theme = x
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <b class="ok" @attach={marque(v.label, $theme)}>{v.label}</b>
{error err}
  <b class="ko" @attach={marque(err.message, $theme)}>{err.message}</b>
{end}
<u class="temoin" @attach={marque('T', $theme)}>témoin</u>
`,
  // `@text=!{v.titre}` et `@html=!{v.corps}` sur des balises de `{success}` : elles reçoivent le texte et le html de la valeur de la branche ; la valeur
  // n'existe plus quand la promesse est remplacée ou rejetée ; le témoin lie la même donnée hors de `{await}`
  'aw-texte.mjs': `<script>
  $val = { titre: 'Ada', corps: '<i>un</i>' }
  fin  = null
  $p   = Promise.resolve({ titre: 'Ada', corps: '<i>un</i>' })
  @attendre = -> $p = new Promise((res, rej) -> fin = [res, rej])
  @finir    = (x) -> fin[0](x)
  @refuser  = (m) -> fin[1](new Error(m))
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <div class="ce" contenteditable="true" @text=!{v.titre}></div>
  <div class="rich" contenteditable="true" @html=!{v.corps}></div>
{error err}
  <b class="ko">{err.message}</b>
{end}
<u class="temoin" contenteditable="true" @text=!{$val.titre}></u>
`,
  // des liaisons de branche qui ne lisent PAS la valeur de la branche (`@attach={marque($theme)}`, `@emit.ok={$theme}`, `@text=!{$val.titre}`, `@html=!{$val.corps}`) : au repos tant que
  // la branche n'est pas affichée, reprises avec la valeur du moment quand elle revient ; chaque appel de la fabrique est noté avec l'état de la balise (`connecte` ou `detache`),
  // le témoin refait les mêmes liaisons à la racine
  'aw-libre.mjs': `<script>
  $theme = 'clair'
  $val   = { titre: 'Ada', corps: '<i>un</i>' }
  fin    = null
  $p     = Promise.resolve(1)
  marque = (th) -> (n) ->
    (window.__appels ||= []).push(th + ':' + (if n.isConnected then 'connecte' else 'detache'))
    n.setAttribute('data-marque', th)
    -> n.removeAttribute('data-marque')
  @attendre = -> $p = new Promise((res, rej) -> fin = [res, rej])
  @finir    = -> fin[0](1)
  @refuser  = (m) -> fin[1](new Error(m))
  @habiller = (x) -> $theme = x
  @titrer   = (t, c) -> $val = { titre: t, corps: c }
</script>
{await $p}
  <i class="att">attente</i>
{success v}
  <b class="ok" @attach={marque($theme)} @emit.ok={$theme}>ok</b>
  <div class="ce" contenteditable="true" @text=!{$val.titre}></div>
  <div class="rich" contenteditable="true" @html=!{$val.corps}></div>
{error err}
  <b class="ko" @attach={marque($theme)}>ko</b>
{end}
<u class="temoin" @attach={marque($theme)} @emit.tem={$theme}>témoin</u>
`
}
const BALISES = Object.keys(SOURCES).map((f) => 'mjs-' + f.replace('.mjs', ''))

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

// l'état d'une balise du composant : sa classe `actif` et sa couleur en ligne, ou null quand elle n'est pas dans la page
const etat = (page: any, balise: string, sel: string): Promise<{ actif: boolean, couleur: string } | null> => page.evaluate(`(() => {
  const n = document.querySelector('${balise}')._shadow.querySelector('${sel}')
  return n ? { actif: n.classList.contains('actif'), couleur: n.style.color } : null
})()`)

// les écritures de style d'une balise, en une ligne : la `--variable`, la propriété composée, la forme conditionnelle, la valeur fixe et la priorité `!important`
const formes = (page: any, balise: string, sel: string): Promise<string | null> => page.evaluate(`(() => {
  const n = document.querySelector('${balise}')._shadow.querySelector('${sel}')
  if (!n) return null
  const s = n.style
  return 'teinte=' + s.getPropertyValue('--teinte') + ' bord=' + s.borderColor + ' larg=' + s.width + ' haut=' + s.height + ' marge=' + s.marginTop + (s.getPropertyPriority('margin-top') ? '!' + s.getPropertyPriority('margin-top') : '')
})()`)

// l'état de chaque balise d'une liste, en une ligne : `classe/couleur` pour chacune
const lignes = (page: any, balise: string, sel: string): Promise<string> => page.evaluate(`Array.from(document.querySelector('${balise}')._shadow.querySelectorAll('${sel}')).map((n) => n.classList.contains('actif') + '/' + n.style.color).join(' ')`)

// le composant est prêt quand son témoin est dans l'ombre ; `attendre` (liaison-navigateur) guette un état qu'il n'atteint pas en production et cède
// alors au bout de cinq secondes, à chaque cas
const pret = async (page: any, balise: string) => {
  await page.waitForFunction(`!!document.querySelector('${balise}')?._shadow?.querySelector('.temoin, .hors')`, null, { timeout: 10000 })
  await page.waitForTimeout(150)
}

// un appel sur le composant (`finir()`, `allumer(false)`…), puis le temps de la mise à jour ; la méthode rend parfois une promesse
// (`relancer()` rend celle qu'elle pose) et `evaluate` l'attendrait : rien n'est rendu à la page
const regler = async (page: any, balise: string, appel: string) => {
  await page.evaluate(`(() => { document.querySelector('${balise}').${appel}; return null })()`)
  await page.waitForTimeout(200)
}

// note un écart, sans arrêter le cas : tous les écarts d'un cas sont rendus ensemble
const verifier = (ecarts: string[], quoi: string, lu: unknown, attendu: unknown) => {
  if (lu !== attendu) ecarts.push(`${quoi} : attendu ${JSON.stringify(attendu)}, lu ${JSON.stringify(lu) ?? 'rien (balise absente)'}`)
}

// la classe `actif` suit `$on` : vraie à la création, puis à chaque changement de la liste ; le témoin répond pareil à chaque étape
async function parcoursClasse(page: any, balise: string, sel: string, quoi: string, changements: boolean[], ecarts: string[]) {
  const etapes: Array<[string, boolean, string | null]> = [['à la création', true, null]]
  for (const o of changements) etapes.push([`$on = ${o}`, o, `allumer(${o})`])
  for (const [nom, attendu, appel] of etapes) {
    if (appel) await regler(page, balise, appel)
    assert.equal((await etat(page, balise, '.temoin'))?.actif, attendu, `le témoin hors de {await} est faux (${nom}) : le test lui-même est à revoir`)
    verifier(ecarts, `${quoi}, classe ${nom}`, (await etat(page, balise, sel))?.actif, attendu)
  }
}

// la couleur en ligne suit `$c` : rouge à la création, puis à chaque couleur de la liste ; le témoin répond pareil à chaque étape
async function parcoursCouleur(page: any, balise: string, sel: string, quoi: string, couleurs: string[], ecarts: string[]) {
  const etapes: Array<[string, string, string | null]> = [['à la création', 'red', null]]
  for (const c of couleurs) etapes.push([`$c = ${c}`, c, `teinter('${c}')`])
  for (const [nom, attendu, appel] of etapes) {
    if (appel) await regler(page, balise, appel)
    assert.equal((await etat(page, balise, '.temoin'))?.couleur, attendu, `le témoin hors de {await} est faux (${nom}) : le test lui-même est à revoir`)
    verifier(ecarts, `${quoi}, couleur ${nom}`, (await etat(page, balise, sel))?.couleur, attendu)
  }
}

// le composant a survécu : un plantage vide son ombre, lui pose la classe `mjs-error` et y met un bandeau `mjs-fatal-error`
const vivant = (page: any, balise: string): Promise<boolean> => page.evaluate(`(() => {
  const h = document.querySelector('${balise}')
  return !h.classList.contains('mjs-error') && !h._shadow.querySelector('.mjs-fatal-error') && !!h._shadow.querySelector('.temoin')
})()`)

// la classe `actif` de chaque balise de `sels` après chaque geste : `true` / `false`, ou `absente` quand la balise n'est pas dans la page ;
// le composant doit rester vivant à chaque étape
async function parcoursEtats(page: any, balise: string, sels: string[], etapes: Array<[string, string | null, ...Array<boolean | 'absente'>]>, ecarts: string[]) {
  for (const [nom, appel, ...attendus] of etapes) {
    if (appel) await regler(page, balise, appel)
    verifier(ecarts, `composant vivant, ${nom}`, await vivant(page, balise), true)
    for (let i = 0; i < sels.length; i++) verifier(ecarts, `${sels[i]}, ${nom}`, (await etat(page, balise, sels[i]))?.actif ?? 'absente', attendus[i])
  }
}

// ce que lit une expression sur une balise (`n` est la balise : `n.textContent`, `n.getAttribute('data-marque')`…), ou `absente` quand elle n'est pas dans la page
const lu = (page: any, balise: string, sel: string, expr: string): Promise<string> => page.evaluate(`(() => {
  const n = document.querySelector('${balise}')._shadow.querySelector('${sel}')
  return n ? String(${expr}) : 'absente'
})()`)

// ce que lisent les couples [sélecteur, expression] après chaque geste, le composant vivant à chaque étape : un composant tombé ne lit plus rien, le parcours
// s'arrête à cette étape avec le texte de son bandeau ; la première lecture est celle du témoin hors de {await} : fausse, elle arrête le cas aussitôt
async function parcoursLus(page: any, balise: string, lectures: Array<[string, string]>, etapes: Array<[string, string | null, ...string[]]>, ecarts: string[]) {
  for (const [nom, appel, ...attendus] of etapes) {
    if (appel) await regler(page, balise, appel)
    const vif = await vivant(page, balise)
    verifier(ecarts, `composant vivant, ${nom}`, vif, true)
    if (!vif) {
      ecarts.push(`bandeau du plantage : ${(await lu(page, balise, '.mjs-fatal-error', 'n.textContent')).slice(0, 200)}`)
      return
    }
    for (let i = 0; i < lectures.length; i++) {
      const lecture = await lu(page, balise, lectures[i][0], lectures[i][1])
      if (i === 0) assert.equal(lecture, attendus[0], `le témoin hors de {await} est faux (${nom}) : le test lui-même est à revoir`)
      else verifier(ecarts, `${lectures[i][0]}, ${nom}`, lecture, attendus[i])
    }
  }
}

// l'espace de noms d'une balise et ses attributs, en une ligne : `svg class=icone id=dessin` ; `absente` quand elle n'est pas dans la page
const attributs = (page: any, balise: string, sel: string, noms: string[]): Promise<string> => page.evaluate(`(() => {
  const n = document.querySelector('${balise}')._shadow.querySelector('${sel}')
  if (!n) return 'absente'
  return n.namespaceURI.split('/').pop() + ' ' + ${JSON.stringify(noms)}.map((a) => a + '=' + n.getAttribute(a)).join(' ')
})()`)

// la place de chaque ligne `[data-k]` d'une liste, par sa clé
const MESURER =([tag, classe]: [string, string]) => {
  const racine = (document.querySelector(tag) as any)._shadow
  const out    = {} as Record<string, number[]>
  for (const el of Array.from(racine.querySelectorAll('.' + classe + ' [data-k]')) as any[]) {
    const r = el.getBoundingClientRect()
    out[el.getAttribute('data-k')] = [r.left, r.top]
  }
  return out
}

// ce que chaque ligne a fait depuis : `glisse` (une animation `mjs-flip` dont le premier keyframe est l'écart entre l'ancienne et la nouvelle place),
// `immobile` (n'a pas bougé, pas animée), ou le défaut constaté ; les animations sont relevées puis coupées AVANT de mesurer la place d'arrivée,
// que la transformation en cours fausserait
const JUGER = ([tag, classe, avant]: [string, string, Record<string, number[]>]) => {
  const racine = (document.querySelector(tag) as any)._shadow
  const lus    = (Array.from(racine.querySelectorAll('.' + classe + ' [data-k]')) as any[]).map((el) => {
    const flips = el.getAnimations().filter((a: any) => a.id === 'mjs-flip')
    const m     = flips.length ? /translate\((-?[\d.e+-]+)px,\s*(-?[\d.e+-]+)px\)/.exec(String(flips[0].effect.getKeyframes()[0].transform || '')) : null
    return { el, k: el.getAttribute('data-k'), n: flips.length, depart: m ? [parseFloat(m[1]), parseFloat(m[2])] : null }
  })
  for (const el of Array.from(racine.querySelectorAll('.' + classe + ' *')) as any[]) el.getAnimations().forEach((a: any) => a.cancel())
  const out = {} as Record<string, string>
  for (const { el, k, n, depart } of lus) {
    const r     = el.getBoundingClientRect()
    const dx    = avant[k][0] - r.left
    const dy    = avant[k][1] - r.top
    const bouge = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5
    if (!n) out[k] = bouge ? 'muette (a bougé de ' + Math.round(dx) + ',' + Math.round(dy) + ')' : 'immobile'
    else if (!bouge) out[k] = 'animée sans bouger'
    else if (!depart) out[k] = 'départ illisible'
    else if (Math.abs(depart[0] - dx) < 1.5 && Math.abs(depart[1] - dy) < 1.5) out[k] = n > 1 ? n + ' glissements' : 'glisse'
    else out[k] = 'part de ' + Math.round(depart[0]) + ',' + Math.round(depart[1]) + ' au lieu de ' + Math.round(dx) + ',' + Math.round(dy)
  }
  return out
}

for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`@class, @style et @flip dans une branche de {await} (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test des branches de {await} sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // ouvre le composant, joue le scénario, puis exige qu'aucune erreur n'ait été dite par la page
  const jouer = async (balise: string, scenario: (page: any) => Promise<void>) => {
    const o = await charger(browser, await cible(mode), balise)
    try {
      await pret(o.page, balise)
      await scenario(o.page)
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  }

  it('les composants se compilent', async function () {
    if (!present) { this.skip(); return }
    await cible(mode)
  })

  it('{success} : @class{$on} et @style.color={$c} posés à la création, puis suivis après l\'arrivée de la promesse', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-succes'
    const ecarts = [] as string[]
    await jouer(B, async (page) => {
      assert.equal(await etat(page, B, '.ok'), null, 'avant l\'arrivée, la branche {success} n\'est pas là')
      assert.notEqual(await etat(page, B, '.att'), null, 'avant l\'arrivée, la branche d\'attente est là')
      await regler(page, B, 'finir()')
      assert.notEqual(await etat(page, B, '.ok'), null, 'après l\'arrivée, la branche {success} est là')
      await parcoursClasse(page, B, '.ok', '{success}', [false, true, false, true], ecarts)
      await parcoursCouleur(page, B, '.ok', '{success}', ['blue', 'red', 'blue'], ecarts)
    })
    assert.deepEqual(ecarts, [])
  })

  it('{success} : créée avec $on faux et $c bleu, la branche n\'a pas la classe et porte le bleu, puis elle suit', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-succes'
    const ecarts = [] as string[]
    await jouer(B, async (page) => {
      await regler(page, B, 'allumer(false)')
      await regler(page, B, 'teinter(\'blue\')')
      await regler(page, B, 'finir()')
      assert.equal((await etat(page, B, '.temoin'))?.actif, false, 'le témoin est éteint : le test lui-même est à revoir')
      assert.equal((await etat(page, B, '.temoin'))?.couleur, 'blue', 'le témoin est bleu : le test lui-même est à revoir')
      verifier(ecarts, 'branche créée éteinte, classe', (await etat(page, B, '.ok'))?.actif, false)
      verifier(ecarts, 'branche créée bleue, couleur', (await etat(page, B, '.ok'))?.couleur, 'blue')
      await regler(page, B, 'allumer(true)')
      await regler(page, B, 'teinter(\'red\')')
      assert.equal((await etat(page, B, '.temoin'))?.actif, true, 'le témoin est allumé : le test lui-même est à revoir')
      assert.equal((await etat(page, B, '.temoin'))?.couleur, 'red', 'le témoin est rouge : le test lui-même est à revoir')
      verifier(ecarts, 'branche rallumée, classe', (await etat(page, B, '.ok'))?.actif, true)
      verifier(ecarts, 'branche reteintée, couleur', (await etat(page, B, '.ok'))?.couleur, 'red')
    })
    assert.deepEqual(ecarts, [])
  })

  it('{success} : --variable, propriété composée, forme conditionnelle, valeur fixe et !important suivent leurs variables', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-formes'
    const ecarts = [] as string[]
    const etapes: Array<[string, string | null, string]> = [
      ['à la création', null,                'teinte=red bord=red larg=10px haut=20px marge=4px!important'],
      ['$c = blue',     'teinter(\'blue\')', 'teinte=blue bord=blue larg=10px haut=20px marge=4px!important'],
      ['$on = false',   'allumer(false)',    'teinte=blue bord=blue larg= haut=20px marge=8px'],
      ['$on = true',    'allumer(true)',     'teinte=blue bord=blue larg=10px haut=20px marge=4px!important']
    ]
    await jouer(B, async (page) => {
      await regler(page, B, 'finir()')
      for (const [nom, appel, attendu] of etapes) {
        if (appel) await regler(page, B, appel)
        assert.equal(await formes(page, B, '.temoin'), attendu, `le témoin hors de {await} est faux (${nom}) : le test lui-même est à revoir`)
        verifier(ecarts, `écritures de style de {success}, ${nom}`, await formes(page, B, '.ok'), attendu)
      }
    })
    assert.deepEqual(ecarts, [])
  })

  it('{if} et {key} dans {success} : @class{$on} et @style.color={$c} posés à la création, puis suivis', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-imbrique'
    const ecarts = [] as string[]
    await jouer(B, async (page) => {
      await regler(page, B, 'finir()')
      for (const sel of ['.dans-si', '.dans-key']) {
        assert.notEqual(await etat(page, B, sel), null, `${sel} est là`)
        await parcoursClasse(page, B, sel, sel, [false, true], ecarts)
        await parcoursCouleur(page, B, sel, sel, ['blue', 'red'], ecarts)
      }
    })
    assert.deepEqual(ecarts, [])
  })

  it('{success} : la branche refaite après une promesse remplacée prend la classe du moment, puis la suit', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-relance'
    const ecarts = [] as string[]
    const nb     = (page: any) => page.evaluate(`document.querySelector('${B}')._shadow.querySelectorAll('.ok').length`)
    await jouer(B, async (page) => {
      await regler(page, B, 'finir()')
      assert.equal(await nb(page), 1, 'la première branche {success} est là')
      verifier(ecarts, 'première branche, classe à la création', (await etat(page, B, '.ok'))?.actif, true)
      await regler(page, B, 'relancer()')
      assert.equal(await nb(page), 0, 'la promesse remplacée remet l\'attente : plus de branche {success}')
      await regler(page, B, 'allumer(false)')
      await regler(page, B, 'finir()')
      assert.equal(await nb(page), 1, 'la seconde branche {success} est là, une seule')
      assert.equal((await etat(page, B, '.temoin'))?.actif, false, 'le témoin est éteint : le test lui-même est à revoir')
      verifier(ecarts, 'branche refaite avec $on faux, classe à la création', (await etat(page, B, '.ok'))?.actif, false)
      await regler(page, B, 'allumer(true)')
      assert.equal((await etat(page, B, '.temoin'))?.actif, true, 'le témoin est allumé : le test lui-même est à revoir')
      verifier(ecarts, 'branche refaite, classe après $on = true', (await etat(page, B, '.ok'))?.actif, true)
    })
    assert.deepEqual(ecarts, [])
  })

  it('attente : @class{$on} et @style.color={$c} sur la branche d\'attente, avant l\'arrivée de la promesse', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-attente'
    const ecarts = [] as string[]
    await jouer(B, async (page) => {
      assert.notEqual(await etat(page, B, '.att'), null, 'la branche d\'attente est là')
      await parcoursClasse(page, B, '.att', 'attente', [false, true, false, true], ecarts)
      await parcoursCouleur(page, B, '.att', 'attente', ['blue', 'red', 'blue'], ecarts)
    })
    assert.deepEqual(ecarts, [])
  })

  it('{error} : @class{$on} et @style.color={$c} posés à la création, puis suivis après le rejet de la promesse', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-erreur'
    const ecarts = [] as string[]
    await jouer(B, async (page) => {
      assert.equal(await etat(page, B, '.ko'), null, 'avant le rejet, la branche {error} n\'est pas là')
      await regler(page, B, 'finir()')
      assert.notEqual(await etat(page, B, '.ko'), null, 'après le rejet, la branche {error} est là')
      await parcoursClasse(page, B, '.ko', '{error}', [false, true, false, true], ecarts)
      await parcoursCouleur(page, B, '.ko', '{error}', ['blue', 'red', 'blue'], ecarts)
    })
    assert.deepEqual(ecarts, [])
  })

  it('{for} dans {success} : @class et @style sur une ligne suivent $on et $c, comme les lignes du même {for} à la racine', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-lignes'
    const ecarts = [] as string[]
    const etapes: Array<[string, string | null, string]> = [
      ['à la création', null,                'true/red true/red'],
      ['$on = false',   'allumer(false)',    'false/red false/red'],
      ['$c = blue',     'teinter(\'blue\')', 'false/blue false/blue'],
      ['$on = true',    'allumer(true)',     'true/blue true/blue'],
      ['$c = red',      'teinter(\'red\')',  'true/red true/red']
    ]
    await jouer(B, async (page) => {
      await regler(page, B, 'finir()')
      for (const [nom, appel, attendu] of etapes) {
        if (appel) await regler(page, B, appel)
        assert.equal(await lignes(page, B, '.hors .l'), attendu, `le témoin hors de {await} est faux (${nom}) : le test lui-même est à revoir`)
        verifier(ecarts, `lignes de {for} dans {success}, ${nom}`, await lignes(page, B, '.dans .l'), attendu)
      }
    })
    assert.deepEqual(ecarts, [])
  })

  it('{success} : la condition et la valeur peuvent lire la valeur de la branche et un {const}', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-valeur'
    const ecarts = [] as string[]
    const etapes: Array<[string, string | null, boolean]> = [['à la création', null, true], ['$on = false', 'allumer(false)', false], ['$on = true', 'allumer(true)', true]]
    await jouer(B, async (page) => {
      await regler(page, B, 'finir()')
      for (const [nom, appel, actif] of etapes) {
        if (appel) await regler(page, B, appel)
        assert.deepEqual(await etat(page, B, '.temoin'), { actif, couleur: 'green' }, `le témoin hors de {await} est faux (${nom}) : le test lui-même est à revoir`)
        verifier(ecarts, `valeur et {const} de la branche, ${nom}`, JSON.stringify(await etat(page, B, '.ok')), JSON.stringify({ actif, couleur: 'green' }))
      }
    })
    assert.deepEqual(ecarts, [])
  })

  it('{for} dans {success} : @flip, les lignes glissent quand l\'ordre change, comme celles du même {for} à la racine', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-aw-flip'
    await jouer(B, async (page) => {
      await regler(page, B, 'finir()')
      const avantDans = await page.evaluate(MESURER, [B, 'dans'])
      const avantHors = await page.evaluate(MESURER, [B, 'hors'])
      assert.deepEqual(Object.keys(avantDans), ['a', 'b', 'c', 'd'], 'les quatre lignes de {success} sont là')
      await page.evaluate(`document.querySelector('${B}').poser([{ id: 'd' }, { id: 'b' }, { id: 'a' }, { id: 'c' }])`)
      await page.waitForTimeout(150)
      const hors = await page.evaluate(JUGER, [B, 'hors', avantHors])
      const dans = await page.evaluate(JUGER, [B, 'dans', avantDans])
      assert.deepEqual(hors, { d: 'glisse', b: 'immobile', a: 'glisse', c: 'glisse' }, 'le témoin hors de {await} est faux : le test lui-même est à revoir')
      assert.deepEqual(dans, hors, 'les lignes de {success} se comportent comme celles de la racine')
    })
  })

  it('{success} qui lit sa valeur et une variable : la promesse remplacée, puis la variable qui bouge, ne font pas tomber le composant', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-perime'
    const ecarts = [] as string[]
    await jouer(B, async (page) => {
      await parcoursEtats(page, B, ['.ok'], [
        ['à la création',             null,                  true],
        ['promesse remplacée',        'attendre()',          'absente'],
        ['$on = false, en attente',   'allumer(false)',      'absente'],
        ['$on = true, en attente',    'allumer(true)',       'absente'],
        ['réglée avec n = 9',         'finir({ n: 9 })',     true],
        ['$on = false',               'allumer(false)',      false],
        ['promesse remplacée',        'attendre()',          'absente'],
        ['$on = true, en attente',    'allumer(true)',       'absente'],
        ['réglée avec n = 3',         'finir({ n: 3 })',     false],
        ['$on = false',               'allumer(false)',      false],
        ['$on = true',                'allumer(true)',       false]
      ], ecarts)
      assert.deepEqual(ecarts, [])
    })
  })

  it('{success} qui lit sa valeur et une variable : la promesse rejetée, sans branche {error}, ne fait pas tomber le composant', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-perime'
    const ecarts = [] as string[]
    await jouer(B, async (page) => {
      await parcoursEtats(page, B, ['.ok'], [
        ['à la création',             null,                  true],
        ['promesse rejetée',          'rejeter()',           'absente'],
        ['$on = false après le rejet', 'allumer(false)',     'absente'],
        ['nouvelle promesse',         'attendre()',          'absente'],
        ['réglée avec n = 8',         'finir({ n: 8 })',     false],
        ['$on = true',                'allumer(true)',       true]
      ], ecarts)
      assert.deepEqual(ecarts, [])
    })
  })

  it('{success} qui lit sa valeur et une variable : la promesse retirée, puis la variable qui bouge, ne font pas tomber le composant', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-perime'
    const ecarts = [] as string[]
    await jouer(B, async (page) => {
      await parcoursEtats(page, B, ['.ok'], [
        ['à la création',             null,                  true],
        ['promesse retirée',          'vider()',             'absente'],
        ['$on = false, sans promesse', 'allumer(false)',     'absente'],
        ['nouvelle promesse',         'attendre()',          'absente'],
        ['réglée avec n = 8',         'finir({ n: 8 })',     false],
        ['$on = true',                'allumer(true)',       true]
      ], ecarts)
      assert.deepEqual(ecarts, [])
    })
  })

  it('{success} et {error} qui lisent leur valeur et une variable : le passage de l\'une à l\'autre, la variable qui bouge entre les deux, ne font pas tomber le composant', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-perime-erreur'
    const ecarts = [] as string[]
    await jouer(B, async (page) => {
      await parcoursEtats(page, B, ['.ok', '.ko'], [
        ['à la création',             null,                  true,      'absente'],
        ['promesse remplacée',        'attendre()',          'absente', 'absente'],
        ['rejetée « non »',           'refuser(\'non\')',    'absente', true],
        ['$on = false',               'allumer(false)',      'absente', false],
        ['promesse remplacée',        'attendre()',          'absente', 'absente'],
        ['réglée avec n = 9',         'finir({ n: 9 })',     false,     'absente'],
        ['$on = true',                'allumer(true)',       true,      'absente'],
        ['promesse remplacée',        'attendre()',          'absente', 'absente'],
        ['$on = false, en attente',   'allumer(false)',      'absente', 'absente'],
        ['rejetée « autre »',         'refuser(\'autre\')',  'absente', false],
        ['$on = true',                'allumer(true)',       'absente', false],
        ['promesse remplacée',        'attendre()',          'absente', 'absente'],
        ['rejetée « non »',           'refuser(\'non\')',    'absente', true]
      ], ecarts)
      assert.deepEqual(ecarts, [])
    })
  })

  it('{success} : une liaison à deux sens sur la valeur de la branche ne fait pas tomber le composant quand la promesse est remplacée puis rejetée', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-champ'
    const ecarts = [] as string[]
    const champ  = (page: any): Promise<string> => page.evaluate(`document.querySelector('${B}')._shadow.querySelector('.champ')?.value ?? 'absent'`)
    const etapes: Array<[string, string | null, string]> = [
      ['à la création',      null,                      'Ada'],
      ['promesse remplacée', 'attendre()',              'absent'],
      ['promesse rejetée',   'refuser()',               'absent'],
      ['nouvelle promesse',  'attendre()',              'absent'],
      ['réglée avec Bob',    'finir({ nom: \'Bob\' })', 'Bob']
    ]
    await jouer(B, async (page) => {
      for (const [nom, appel, attendu] of etapes) {
        if (appel) await regler(page, B, appel)
        verifier(ecarts, `composant vivant, ${nom}`, await vivant(page, B), true)
        verifier(ecarts, `champ, ${nom}`, await champ(page), attendu)
      }
      assert.deepEqual(ecarts, [])
    })
  })

  it('<svg> à class fixe, <use href> et <math> dans une branche qui porte un @class : les éléments sont construits avec leurs attributs', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-svg'
    const ecarts = [] as string[]
    await jouer(B, async (page) => {
      assert.equal(await attributs(page, B, '#hors', ['class', 'id']), 'svg class=icone id=hors', 'le <svg> de la racine, témoin de la lecture, est faux : le test lui-même est à revoir')
      assert.equal(await attributs(page, B, '#hors use', ['href']), 'svg href=#a', 'le <use> de la racine, témoin de la lecture, est faux : le test lui-même est à revoir')
      await regler(page, B, 'finir()')
      verifier(ecarts, 'composant vivant', await vivant(page, B), true)
      verifier(ecarts, '<svg>', await attributs(page, B, 'svg:not(#hors)', ['class', 'id']), 'svg class=icone id=dessin')
      verifier(ecarts, '<circle>', await attributs(page, B, 'svg:not(#hors) .rond', ['class']), 'svg class=rond')
      verifier(ecarts, '<use>', await attributs(page, B, 'svg:not(#hors) use', ['href']), 'svg href=#a')
      verifier(ecarts, '<math>', await attributs(page, B, 'math', ['class']), 'MathML class=formule')
      await parcoursEtats(page, B, ['.ok'], [['classe de la branche à la création', null, true], ['$on = false', 'allumer(false)', false], ['$on = true', 'allumer(true)', true]], ecarts)
      assert.deepEqual(ecarts, [])
    })
  })

  for (const [balise, quoi, dans] of [['mjs-aw-svg-si', 'un {if}', 1], ['mjs-aw-svg-pour', 'un {for}', 2], ['mjs-aw-svg-texte', 'une interpolation', 1]] as Array<[string, string, number]>) {
    it(`<svg> à class fixe et <use href> dans une branche qui contient ${quoi}, sans @class : les éléments sont construits avec leurs attributs`, async function () {
      if (!present) { this.skip(); return }
      const ecarts = [] as string[]
      await jouer(balise, async (page) => {
        await regler(page, balise, 'finir()')
        verifier(ecarts, 'composant vivant', await vivant(page, balise), true)
        verifier(ecarts, '<svg>', await attributs(page, balise, 'svg', ['class']), 'svg class=icone')
        verifier(ecarts, '<circle>', await attributs(page, balise, 'svg .rond', ['class']), 'svg class=rond')
        verifier(ecarts, '<use>', await attributs(page, balise, 'svg use', ['href']), 'svg href=#a')
        verifier(ecarts, 'éléments du bloc', await page.evaluate(`document.querySelector('${balise}')._shadow.querySelectorAll('.dans').length`), dans)
        assert.deepEqual(ecarts, [])
      })
    })
  }

  it('{success} : un {const} lu par la condition et par la couleur fait suivre la variable qu\'il lit', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-const'
    const ecarts = [] as string[]
    const etapes: Array<[string, string | null, boolean, string]> = [
      ['à la création', null,         false, 'blue'],
      ['$n = 3',        'poser(3)',   true,  'red'],
      ['$n = 2',        'poser(2)',   false, 'blue'],
      ['$n = 5',        'poser(5)',   true,  'red']
    ]
    await jouer(B, async (page) => {
      await regler(page, B, 'finir()')
      for (const [nom, appel, actif, couleur] of etapes) {
        if (appel) await regler(page, B, appel)
        assert.deepEqual(await etat(page, B, '.temoin'), { actif, couleur }, `le témoin hors de {await} est faux (${nom}) : le test lui-même est à revoir`)
        verifier(ecarts, `{const} lu par la condition et la couleur, ${nom}`, JSON.stringify(await etat(page, B, '.ok')), JSON.stringify({ actif, couleur }))
      }
      assert.deepEqual(ecarts, [])
    })
  })

  it('{success} et {error} : un @attach qui lit la valeur de la branche et une variable ne fait pas tomber le composant, et reprend quand la branche revient', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-attache'
    const ecarts = [] as string[]
    const MARQUE = 'n.getAttribute(\'data-marque\')'
    await jouer(B, async (page) => {
      await parcoursLus(page, B, [['.temoin', MARQUE], ['.ok', MARQUE], ['.ko', MARQUE]], [
        ['à la création',                null,                       'T/clair',  'A/clair',  'absente'],
        ['$theme = sombre',              'habiller(\'sombre\')',     'T/sombre', 'A/sombre', 'absente'],
        ['promesse remplacée',           'attendre()',               'T/sombre', 'absente',  'absente'],
        ['$theme = clair, en attente',   'habiller(\'clair\')',      'T/clair',  'absente',  'absente'],
        ['réglée avec B',                'finir({ label: \'B\' })',  'T/clair',  'B/clair',  'absente'],
        ['$theme = sombre',              'habiller(\'sombre\')',     'T/sombre', 'B/sombre', 'absente'],
        ['promesse remplacée',           'attendre()',               'T/sombre', 'absente',  'absente'],
        ['rejetée « non »',              'refuser(\'non\')',         'T/sombre', 'absente',  'non/sombre'],
        ['$theme = clair, en erreur',    'habiller(\'clair\')',      'T/clair',  'absente',  'non/clair'],
        ['promesse remplacée',           'attendre()',               'T/clair',  'absente',  'absente'],
        ['réglée avec C',                'finir({ label: \'C\' })',  'T/clair',  'C/clair',  'absente'],
        ['$theme = sombre',              'habiller(\'sombre\')',     'T/sombre', 'C/sombre', 'absente'],
        ['promesse remplacée',           'attendre()',               'T/sombre', 'absente',  'absente'],
        ['rejetée « autre »',            'refuser(\'autre\')',       'T/sombre', 'absente',  'autre/sombre'],
        ['$theme = clair',               'habiller(\'clair\')',      'T/clair',  'absente',  'autre/clair']
      ], ecarts)
      assert.deepEqual(ecarts, [])
    })
  })

  it('{success} : @text=!{v.titre} et @html=!{v.corps} ne font pas tomber le composant quand la promesse est remplacée ou rejetée, et reprennent quand la branche revient', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-texte'
    const ecarts = [] as string[]
    await jouer(B, async (page) => {
      await parcoursLus(page, B, [['.temoin', 'n.textContent'], ['.ce', 'n.textContent'], ['.rich', 'n.innerHTML'], ['.ko', 'n.textContent']], [
        ['à la création',                null,                                                              'Ada', 'Ada',      '<i>un</i>',      'absente'],
        ['promesse remplacée',           'attendre()',                                                      'Ada', 'absente',  'absente',        'absente'],
        ['rejetée « non »',              'refuser(\'non\')',                                                'Ada', 'absente',  'absente',        'non'],
        ['nouvelle promesse',            'attendre()',                                                      'Ada', 'absente',  'absente',        'absente'],
        ['réglée avec Bob',              'finir({ titre: \'Bob\', corps: \'<b>deux</b>\' })',               'Ada', 'Bob',      '<b>deux</b>',    'absente'],
        ['promesse remplacée',           'attendre()',                                                      'Ada', 'absente',  'absente',        'absente'],
        ['réglée avec Cy',               'finir({ titre: \'Cy\', corps: \'<u>trois</u>\' })',               'Ada', 'Cy',       '<u>trois</u>',   'absente'],
        ['promesse remplacée',           'attendre()',                                                      'Ada', 'absente',  'absente',        'absente'],
        ['rejetée « autre »',            'refuser(\'autre\')',                                              'Ada', 'absente',  'absente',        'autre'],
        ['nouvelle promesse',            'attendre()',                                                      'Ada', 'absente',  'absente',        'absente'],
        ['réglée avec Dan',              'finir({ titre: \'Dan\', corps: \'<s>quatre</s>\' })',             'Ada', 'Dan',      '<s>quatre</s>',  'absente']
      ], ecarts)
      assert.deepEqual(ecarts, [])
    })
  })

  it('{success} et {error} dont les liaisons ne lisent pas la valeur de la branche (@attach, @emit, @text, @html) : au repos tant que la branche n\'est pas affichée, reprises avec la valeur du moment quand elle revient', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-aw-libre'
    const ecarts = [] as string[]
    const MARQUE = 'n.getAttribute(\'data-marque\')'
    await jouer(B, async (page) => {
      // les nœuds d'une branche qui va disparaître sont gardés, pour voir si une liaison écrit encore dessus ; les événements partent vers `window.__emis`
      const garder = (cle: string, sel: string) => page.evaluate(`(() => { (window.__gardes ||= {}).${cle} = document.querySelector('${B}')._shadow.querySelector('${sel}'); return null })()`)
      const remettre = () => page.evaluate('(() => { window.__appels = []; window.__emis = []; return null })()')
      await page.evaluate(`(() => { const h = document.querySelector('${B}'); window.__emis = []; for (const nom of ['ok', 'tem']) h.addEventListener(nom, (e) => window.__emis.push(nom + ':' + e.data)); return null })()`)
      await garder('ok', '.ok')
      await garder('ce', '.ce')
      await garder('rich', '.rich')
      // ce que montre la page à une étape : les nœuds gardés (marque / texte / HTML), les appels de la fabrique et les événements de cette étape, puis les balises présentes
      const relever = async (): Promise<Record<string, string>> => ({
        vieux:    await page.evaluate('(() => { const g = window.__gardes; return [String(g.ok.getAttribute(\'data-marque\')), g.ce.textContent, g.rich.innerHTML].join(\'|\') })()'),
        vieuxKo:  await page.evaluate('(() => { const k = window.__gardes.ko; return k ? String(k.getAttribute(\'data-marque\')) : \'sans nœud\' })()'),
        appels:   await page.evaluate('window.__appels.slice().sort().join(\' \')'),
        ok:       await page.evaluate('window.__emis.filter((e) => e.startsWith(\'ok:\')).join(\' \')'),
        tem:      await page.evaluate('window.__emis.filter((e) => e.startsWith(\'tem:\')).join(\' \')'),
        marque:   await lu(page, B, '.ok', MARQUE),
        texte:    await lu(page, B, '.ce', 'n.textContent'),
        riche:    await lu(page, B, '.rich', 'n.innerHTML'),
        ko:       await lu(page, B, '.ko', MARQUE),
        temoin:   await lu(page, B, '.temoin', MARQUE)
      })
      const VIEUX = 'null|Ada|<i>un</i>'
      const etapes: Array<[string, string | null, Record<string, string>, [string, string]?]> = [
        ['à la création',                null,                                   { vieux: 'clair|Ada|<i>un</i>', marque: 'clair', texte: 'Ada', riche: '<i>un</i>', ko: 'absente', temoin: 'clair' }],
        ['promesse remplacée',           'attendre()',                           { vieux: VIEUX, appels: '', ok: '', tem: '', marque: 'absente', texte: 'absente', riche: 'absente', ko: 'absente', temoin: 'clair' }],
        ['$theme = sombre, en attente',  'habiller(\'sombre\')',                 { vieux: VIEUX, appels: 'sombre:connecte', ok: '', tem: 'tem:sombre', marque: 'absente', texte: 'absente', riche: 'absente', ko: 'absente', temoin: 'sombre' }],
        ['titre Bob, en attente',        'titrer(\'Bob\', \'<b>deux</b>\')',     { vieux: VIEUX, appels: '', ok: '', tem: '', marque: 'absente', texte: 'absente', riche: 'absente', ko: 'absente' }],
        ['réglée',                       'finir()',                              { ok: 'ok:sombre', marque: 'sombre', texte: 'Bob', riche: '<b>deux</b>', ko: 'absente', temoin: 'sombre' }],
        ['$theme = nuit',                'habiller(\'nuit\')',                   { ok: 'ok:nuit', tem: 'tem:nuit', marque: 'nuit', texte: 'Bob', riche: '<b>deux</b>', temoin: 'nuit' }],
        ['titre Cy',                     'titrer(\'Cy\', \'<u>trois</u>\')',     { marque: 'nuit', texte: 'Cy', riche: '<u>trois</u>' }],
        ['promesse remplacée',           'attendre()',                           { marque: 'absente', texte: 'absente', riche: 'absente', ko: 'absente' }],
        ['rejetée « non »',              'refuser(\'non\')',                     { marque: 'absente', ko: 'nuit', temoin: 'nuit' }, ['ko', '.ko']],
        ['promesse remplacée',           'attendre()',                           { vieuxKo: 'null', ko: 'absente' }],
        ['$theme = clair, en attente',   'habiller(\'clair\')',                  { vieuxKo: 'null', appels: 'clair:connecte', ko: 'absente', temoin: 'clair' }],
        ['rejetée « autre »',            'refuser(\'autre\')',                   { ko: 'clair', temoin: 'clair' }],
        ['$theme = sombre, en erreur',   'habiller(\'sombre\')',                 { ko: 'sombre', temoin: 'sombre' }]
      ]
      for (const [nom, appel, attendus, garde] of etapes) {
        if (appel) {
          await remettre()
          await regler(page, B, appel)
        }
        const vif = await vivant(page, B)
        verifier(ecarts, `composant vivant, ${nom}`, vif, true)
        if (!vif) {
          ecarts.push(`bandeau du plantage : ${(await lu(page, B, '.mjs-fatal-error', 'n.textContent')).slice(0, 200)}`)
          break
        }
        const relevees = await relever()
        for (const cle of Object.keys(attendus)) {
          if (cle === 'temoin') assert.equal(relevees[cle], attendus[cle], `le témoin hors de {await} est faux (${nom}) : le test lui-même est à revoir`)
          else verifier(ecarts, `${cle}, ${nom}`, relevees[cle], attendus[cle])
        }
        if (garde) await garder(garde[0], garde[1])
      }
      assert.deepEqual(ecarts, [])
    })
  })
})
