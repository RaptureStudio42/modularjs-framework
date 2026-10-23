// Page rendue par le serveur puis reprise dans un navigateur réel : les blocs `{for}`, `{if}`, `{key}` et `{await}`, seuls
// ou imbriqués, et les blocs qui contiennent un composant, restent VIVANTS après la reprise. Quatre modes de reprise
// (`ssrMode` : markers, replace, positional, diff), plus `markers`, `positional` et `diff` sur une page rendue par le moteur navigateur
// du prérendu, en développement et en production (vrai build, un morceau par module, manifeste `bundle.js` et chargeur à la
// demande), dans Chromium et Firefox.
// Chaque forme est jouée comme un visiteur le ferait : l'état de départ rendu par le serveur, puis des écritures de l'état
// (réordre, ajout, retrait, liste vidée puis remplie, bascule dans les deux sens, nouvelle clé, nouvelle promesse) après la
// reprise, et le DOM doit suivre chaque écriture, sans ligne en double ni erreur de page.
// En `markers` la reprise garde aussi les nœuds du serveur hors des blocs (mêmes objets avant et après), et ne laisse aucun
// marqueur dans le DOM. Hors de `markers`, le HTML du serveur ne porte aucun commentaire.
// Les formes `tx-*` jouent le texte : une interpolation que suit du texte fixe (« Bonjour {$nom}! », « Total : {$n} € »), au
// début, au milieu ou à la fin d'un texte, collée à une autre, vide, à la racine du composant, dans un attribut, dans les lignes
// d'un `{for}`, à côté d'un bloc. Le parseur du navigateur fusionne en un seul nœud les textes voisins que le serveur a écrits :
// la reprise doit les redécouper sans perdre ni dupliquer un caractère, dans chacun des modes.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'

const MODES = ['markers', 'replace', 'positional', 'diff'] as const
const ENVS  = ['dev', 'prod'] as const

// les pages rendues par le moteur navigateur du prérendu (vrai Chromium), dans les trois modes qui reprennent les nœuds du serveur : même HTML que le rendu happy-dom
const NAVIGATEUR = ['markers', 'positional', 'diff'].map((m) => `${m} (moteur navigateur)`)
const VARIANTES  = [...MODES, ...NAVIGATEUR] as const

type Forme = {
  tag:     string
  source:  string
  // le résumé du DOM de la forme, lu dans sa racine d'ombre (`r`)
  vue:     string
  depart:  string
  // [nom, geste (le composant est `el`), résumé attendu juste après]
  etapes:  Array<[string, string, string]>
  // les nœuds du serveur, hors des blocs, que `markers` doit reprendre tels quels
  reprises: string[]
}

const ENFANT = `<span class="e">{$x}</span>
`

const FORMES: Forme[] = [
  {
    tag: 'bl-for',
    source: `<script>
  $items = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }, { id: 3, t: 'c' }, { id: 4, t: 'd' }]
  @pose = (l) -> $items = l
</script>

<p class="n">{$items.length}</p>
<ul>
  {for it in $items by id}
    <li data-k="{it.t}">{it.t}</li>
  {end}
</ul>
<p class="fin">fin</p>
`,
    vue: `(r) => 'n=' + r.querySelector('.n').textContent + ' li=' + Array.from(r.querySelectorAll('li')).map((l) => l.textContent.trim()).join('') + ' lignes=' + r.querySelectorAll('li').length + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'n=4 li=abcd lignes=4 fin=1',
    etapes: [
      ['réordre d b a c',        `el.pose(L('d', 'b', 'a', 'c'))`,      'n=4 li=dbac lignes=4 fin=1'],
      ['ajout en tête e',        `el.pose(L('e', 'd', 'b', 'a', 'c'))`, 'n=5 li=edbac lignes=5 fin=1'],
      ['retrait de b',           `el.pose(L('e', 'd', 'a', 'c'))`,      'n=4 li=edac lignes=4 fin=1'],
      ['liste vidée',            `el.pose([])`,                         'n=0 li= lignes=0 fin=1'],
      ['liste remplie a b',      `el.pose(L('a', 'b'))`,                'n=2 li=ab lignes=2 fin=1'],
      ['retour a b c d',         `el.pose(L('a', 'b', 'c', 'd'))`,      'n=4 li=abcd lignes=4 fin=1']
    ],
    reprises: ['.n', 'ul', '.fin']
  },
  {
    tag: 'bl-for-vide',
    source: `<script>
  $items = []
  @pose = (l) -> $items = l
</script>

<p class="n">{$items.length}</p>
<ul>
  {for it in $items by id}
    <li data-k="{it.t}">{it.t}</li>
  {end}
</ul>
<p class="fin">fin</p>
`,
    vue: `(r) => 'n=' + r.querySelector('.n').textContent + ' li=' + Array.from(r.querySelectorAll('li')).map((l) => l.textContent.trim()).join('') + ' lignes=' + r.querySelectorAll('li').length + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'n=0 li= lignes=0 fin=1',
    etapes: [
      ['liste remplie a b c',    `el.pose(L('a', 'b', 'c'))`,           'n=3 li=abc lignes=3 fin=1'],
      ['liste vidée',            `el.pose([])`,                         'n=0 li= lignes=0 fin=1'],
      ['liste remplie c',        `el.pose(L('c'))`,                     'n=1 li=c lignes=1 fin=1'],
      ['ajout en tête d',        `el.pose(L('d', 'c'))`,                'n=2 li=dc lignes=2 fin=1']
    ],
    reprises: ['.n', 'ul', '.fin']
  },
  {
    tag: 'bl-if',
    source: `<script>
  $on = true
  @pose = (v) -> $on = v
</script>

<p class="t">titre</p>
{if $on}
  <p class="x">oui</p>
{else}
  <p class="y">non</p>
{end}
<p class="fin">fin</p>
`,
    vue: `(r) => 'x=' + r.querySelectorAll('.x').length + ' y=' + r.querySelectorAll('.y').length + ' t=' + r.querySelectorAll('.t').length + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'x=1 y=0 t=1 fin=1',
    etapes: [
      ['bascule à faux',         `el.pose(false)`,                      'x=0 y=1 t=1 fin=1'],
      ['bascule à vrai',         `el.pose(true)`,                       'x=1 y=0 t=1 fin=1'],
      ['bascule à faux',         `el.pose(false)`,                      'x=0 y=1 t=1 fin=1']
    ],
    reprises: ['.t', '.fin']
  },
  {
    tag: 'bl-if-faux',
    source: `<script>
  $on = false
  @pose = (v) -> $on = v
</script>

<p class="t">titre</p>
{if $on}
  <p class="x">oui</p>
{end}
<p class="fin">fin</p>
`,
    vue: `(r) => 'x=' + r.querySelectorAll('.x').length + ' t=' + r.querySelectorAll('.t').length + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'x=0 t=1 fin=1',
    etapes: [
      ['bascule à vrai',         `el.pose(true)`,                       'x=1 t=1 fin=1'],
      ['bascule à faux',         `el.pose(false)`,                      'x=0 t=1 fin=1'],
      ['bascule à vrai',         `el.pose(true)`,                       'x=1 t=1 fin=1']
    ],
    reprises: ['.t', '.fin']
  },
  {
    tag: 'bl-key',
    source: `<script>
  $k = 1
  @pose = (v) -> $k = v
</script>

<p class="t">titre</p>
{key $k}
  <p class="k">cle {$k}</p>
{end}
<p class="fin">fin</p>
`,
    vue: `(r) => 'k=' + Array.from(r.querySelectorAll('.k')).map((p) => p.textContent.trim()).join('|') + ' t=' + r.querySelectorAll('.t').length + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'k=cle 1 t=1 fin=1',
    etapes: [
      ['clé 2',                  `el.pose(2)`,                          'k=cle 2 t=1 fin=1'],
      ['clé 3',                  `el.pose(3)`,                          'k=cle 3 t=1 fin=1']
    ],
    reprises: ['.t', '.fin']
  },
  {
    tag: 'bl-await',
    source: `<script>
  $p = Promise.resolve(7)
  @pose = (v) -> $p = Promise.resolve(v)
  @rejette = -> $p = Promise.reject(new Error('refus'))
</script>

<p class="t">titre</p>
{await $p}
  <p class="a">attente</p>
{success v}
  <p class="s">valeur {v}</p>
{error err}
  <p class="e">erreur</p>
{end}
<p class="fin">fin</p>
`,
    vue: `(r) => 'a=' + r.querySelectorAll('.a').length + ' s=' + Array.from(r.querySelectorAll('.s')).map((p) => p.textContent.trim()).join('|') + ' e=' + r.querySelectorAll('.e').length + ' t=' + r.querySelectorAll('.t').length + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'a=0 s=valeur 7 e=0 t=1 fin=1',
    etapes: [
      ['nouvelle promesse 8',    `el.pose(8)`,                          'a=0 s=valeur 8 e=0 t=1 fin=1'],
      ['promesse rejetée',       `el.rejette()`,                        'a=0 s= e=1 t=1 fin=1'],
      ['nouvelle promesse 9',    `el.pose(9)`,                          'a=0 s=valeur 9 e=0 t=1 fin=1']
    ],
    reprises: ['.t', '.fin']
  },
  {
    tag: 'bl-if-dans-for',
    source: `<script>
  $items = [{ id: 1, t: 'a', on: false }, { id: 2, t: 'b', on: true }, { id: 3, t: 'c', on: false }]
  @pose = (l) -> $items = l
</script>

<p class="n">{$items.length}</p>
<ul>
  {for it in $items by id}
    <li>{it.t}{if it.on}<b class="on">!</b>{end}</li>
  {end}
</ul>
<p class="fin">fin</p>
`,
    vue: `(r) => 'n=' + r.querySelector('.n').textContent + ' li=' + Array.from(r.querySelectorAll('li')).map((l) => l.textContent.trim()).join(',') + ' marques=' + r.querySelectorAll('.on').length + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'n=3 li=a,b!,c marques=1 fin=1',
    etapes: [
      ['a marqué, b non',        `el.pose([{ id: 1, t: 'a', on: true }, { id: 2, t: 'b', on: false }, { id: 3, t: 'c', on: false }])`,                               'n=3 li=a!,b,c marques=1 fin=1'],
      ['ajout de d marqué',      `el.pose([{ id: 4, t: 'd', on: true }, { id: 1, t: 'a', on: true }, { id: 2, t: 'b', on: false }, { id: 3, t: 'c', on: false }])`, 'n=4 li=d!,a!,b,c marques=2 fin=1'],
      ['retrait de a',           `el.pose([{ id: 4, t: 'd', on: true }, { id: 2, t: 'b', on: false }, { id: 3, t: 'c', on: true }])`,                                'n=3 li=d!,b,c! marques=2 fin=1'],
      ['liste vidée',            `el.pose([])`,                                                                                                                       'n=0 li= marques=0 fin=1']
    ],
    reprises: ['.n', 'ul', '.fin']
  },
  {
    tag: 'bl-for-dans-if',
    source: `<script>
  $on = true
  $items = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }]
  @pose = (l) -> $items = l
  @bascule = (v) -> $on = v
</script>

<p class="t">titre</p>
{if $on}
  <ul>
    {for it in $items by id}
      <li>{it.t}</li>
    {end}
  </ul>
{else}
  <p class="vide">rien</p>
{end}
<p class="fin">fin</p>
`,
    vue: `(r) => 'ul=' + r.querySelectorAll('ul').length + ' li=' + Array.from(r.querySelectorAll('li')).map((l) => l.textContent.trim()).join('') + ' vide=' + r.querySelectorAll('.vide').length + ' t=' + r.querySelectorAll('.t').length + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'ul=1 li=ab vide=0 t=1 fin=1',
    etapes: [
      ['réordre et ajout c',     `el.pose(L('c', 'b', 'a'))`,           'ul=1 li=cba vide=0 t=1 fin=1'],
      ['bloc fermé',             `el.bascule(false)`,                   'ul=0 li= vide=1 t=1 fin=1'],
      ['liste changée fermée',   `el.pose(L('d'))`,                     'ul=0 li= vide=1 t=1 fin=1'],
      ['bloc rouvert',           `el.bascule(true)`,                    'ul=1 li=d vide=0 t=1 fin=1'],
      ['liste vidée',            `el.pose([])`,                         'ul=1 li= vide=0 t=1 fin=1'],
      ['liste remplie a b',      `el.pose(L('a', 'b'))`,                'ul=1 li=ab vide=0 t=1 fin=1']
    ],
    reprises: ['.t', '.fin']
  },
  {
    tag: 'bl-if-composant',
    source: `<script>
  $on = true
  $n = 1
  @bascule = (v) -> $on = v
  @pose = (v) -> $n = v
</script>

<p class="t">titre</p>
{if $on}
  <@bl-enfant x={$n}></@bl-enfant>
{end}
<p class="fin">fin</p>
`,
    vue: `(r) => 'enfants=' + r.querySelectorAll('mjs-bl-enfant').length + ' e=' + Array.from(r.querySelectorAll('mjs-bl-enfant')).map((c) => c._shadow && c._shadow.querySelector('.e') ? c._shadow.querySelector('.e').textContent.trim() : '?').join('|') + ' t=' + r.querySelectorAll('.t').length + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'enfants=1 e=1 t=1 fin=1',
    etapes: [
      ['nouvelle valeur 2',      `el.pose(2)`,                          'enfants=1 e=2 t=1 fin=1'],
      ['bloc fermé',             `el.bascule(false)`,                   'enfants=0 e= t=1 fin=1'],
      ['bloc rouvert',           `el.bascule(true)`,                    'enfants=1 e=2 t=1 fin=1'],
      ['nouvelle valeur 3',      `el.pose(3)`,                          'enfants=1 e=3 t=1 fin=1']
    ],
    reprises: ['.t', '.fin']
  },
  {
    tag: 'bl-for-composant',
    source: `<script>
  $items = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }, { id: 3, t: 'c' }]
  @pose = (l) -> $items = l
</script>

<p class="n">{$items.length}</p>
<div class="liste">
  {for it in $items by id}
    <@bl-enfant x={it.t}></@bl-enfant>
  {end}
</div>
<p class="fin">fin</p>
`,
    vue: `(r) => 'n=' + r.querySelector('.n').textContent + ' enfants=' + r.querySelectorAll('mjs-bl-enfant').length + ' e=' + Array.from(r.querySelectorAll('mjs-bl-enfant')).map((c) => c._shadow && c._shadow.querySelector('.e') ? c._shadow.querySelector('.e').textContent.trim() : '?').join('') + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'n=3 enfants=3 e=abc fin=1',
    etapes: [
      ['réordre c a b',          `el.pose(L('c', 'a', 'b'))`,           'n=3 enfants=3 e=cab fin=1'],
      ['ajout en tête d',        `el.pose(L('d', 'c', 'a', 'b'))`,      'n=4 enfants=4 e=dcab fin=1'],
      ['retrait de a',           `el.pose(L('d', 'c', 'b'))`,           'n=3 enfants=3 e=dcb fin=1'],
      ['liste vidée',            `el.pose([])`,                         'n=0 enfants=0 e= fin=1'],
      ['liste remplie b',        `el.pose(L('b'))`,                     'n=1 enfants=1 e=b fin=1']
    ],
    reprises: ['.n', '.liste', '.fin']
  },
  {
    tag: 'bl-texte-vide',
    source: `<script>
  $nom = ''
  @pose = (v) -> $nom = v
</script>

<p class="b">Bonjour {$nom}!</p>
<p class="fin">fin</p>
`,
    vue: `(r) => 'b=' + r.querySelector('.b').textContent + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'b=Bonjour ! fin=1',
    etapes: [
      ['nom Bob',                `el.pose('Bob')`,                      'b=Bonjour Bob! fin=1'],
      ['nom vidé',               `el.pose('')`,                         'b=Bonjour ! fin=1'],
      ['nom Al',                 `el.pose('Al')`,                       'b=Bonjour Al! fin=1']
    ],
    reprises: ['.b', '.fin']
  },
  {
    tag: 'tx-fusion',
    source: `<script>
  $nom = 'Bob'
  @pose = (v) -> $nom = v
</script>

<p class="b">Bonjour {$nom}!</p>
<p class="fin">fin</p>
`,
    vue: `(r) => 'b=' + r.querySelector('.b').textContent + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'b=Bonjour Bob! fin=1',
    etapes: [
      ['nom Al',                 `el.pose('Al')`,                       'b=Bonjour Al! fin=1'],
      ['nom vidé',               `el.pose('')`,                         'b=Bonjour ! fin=1'],
      ['nom Jean-Pierre',        `el.pose('Jean-Pierre')`,              'b=Bonjour Jean-Pierre! fin=1']
    ],
    reprises: ['.b', '.fin']
  },
  {
    tag: 'tx-total',
    source: `<script>
  $n = 12
  @pose = (v) -> $n = v
</script>

<p class="b">Total : {$n} €</p>
<p class="fin">fin</p>
`,
    vue: `(r) => 'b=' + r.querySelector('.b').textContent + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'b=Total : 12 € fin=1',
    etapes: [
      ['zéro',                   `el.pose(0)`,                          'b=Total : 0 € fin=1'],
      ['quatre chiffres',        `el.pose(1250)`,                       'b=Total : 1250 € fin=1'],
      ['un chiffre',             `el.pose(7)`,                          'b=Total : 7 € fin=1']
    ],
    reprises: ['.b', '.fin']
  },
  {
    tag: 'tx-trois',
    source: `<script>
  $a = 'A'
  $b = 'B'
  $c = 'C'
  @pose = (x, y, z) ->
    $a = x
    $b = y
    $c = z
</script>

<p class="b">{$a} puis {$b} puis {$c}</p>
<p class="fin">fin</p>
`,
    vue: `(r) => 'b=' + r.querySelector('.b').textContent + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'b=A puis B puis C fin=1',
    etapes: [
      ['les trois changent',     `el.pose('1', '22', '333')`,           'b=1 puis 22 puis 333 fin=1'],
      ['seul le début change',   `el.pose('x', '22', '333')`,           'b=x puis 22 puis 333 fin=1'],
      ['seul le milieu change',  `el.pose('x', 'milieu', '333')`,       'b=x puis milieu puis 333 fin=1'],
      ['seule la fin change',    `el.pose('x', 'milieu', 'fin')`,       'b=x puis milieu puis fin fin=1']
    ],
    reprises: ['.b', '.fin']
  },
  {
    tag: 'tx-collees',
    source: `<script>
  $a = 'A'
  $b = 'B'
  @pose = (x, y) ->
    $a = x
    $b = y
</script>

<p class="b">{$a}{$b}!</p>
<p class="fin">fin</p>
`,
    vue: `(r) => 'b=' + r.querySelector('.b').textContent + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'b=AB! fin=1',
    etapes: [
      ['les deux changent',      `el.pose('un', 'deux')`,               'b=undeux! fin=1'],
      ['le premier vidé',        `el.pose('', 'deux')`,                 'b=deux! fin=1'],
      ['le second vidé',         `el.pose('un', '')`,                   'b=un! fin=1'],
      ['les deux remplis',       `el.pose('a', 'b')`,                   'b=ab! fin=1']
    ],
    reprises: ['.b', '.fin']
  },
  {
    tag: 'tx-vides',
    source: `<script>
  $a = ''
  $b = 'x'
  $c = ''
  @pose = (x, y, z) ->
    $a = x
    $b = y
    $c = z
</script>

<p class="b">[{$a}] [{$b}] [{$c}]</p>
<p class="fin">fin</p>
`,
    vue: `(r) => 'b=' + r.querySelector('.b').textContent + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'b=[] [x] [] fin=1',
    etapes: [
      ['début et fin remplis',   `el.pose('1', 'x', '3')`,              'b=[1] [x] [3] fin=1'],
      ['milieu vidé',            `el.pose('1', '', '3')`,               'b=[1] [] [3] fin=1'],
      ['tout vidé',              `el.pose('', '', '')`,                 'b=[] [] [] fin=1'],
      ['tout rempli',            `el.pose('a', 'b', 'c')`,              'b=[a] [b] [c] fin=1']
    ],
    reprises: ['.b', '.fin']
  },
  {
    tag: 'tx-racine',
    source: `<script>
  $nom = 'Bob'
  @pose = (v) -> $nom = v
</script>

Bonjour {$nom}!
<p class="fin">fin</p>
`,
    vue: `(r) => 'txt=' + Array.from(r.childNodes).filter((n) => n.nodeType === 3).map((n) => n.data).join('').trim() + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'txt=Bonjour Bob! fin=1',
    etapes: [
      ['nom Al',                 `el.pose('Al')`,                       'txt=Bonjour Al! fin=1'],
      ['nom vidé',               `el.pose('')`,                         'txt=Bonjour ! fin=1'],
      ['nom Zoé',                `el.pose('Zoé')`,                      'txt=Bonjour Zoé! fin=1']
    ],
    reprises: ['.fin']
  },
  {
    tag: 'tx-attribut',
    source: `<script>
  $k = 1
  @pose = (v) -> $k = v
</script>

<p class="b c-{$k}" title="n°{$k}!" data-k="{$k}">texte fixe</p>
<p class="fin">fin</p>
`,
    vue: `(r) => { const p = r.querySelector('.b'); return 'cls=' + p.className + ' title=' + p.title + ' k=' + p.dataset.k + ' txt=' + p.textContent + ' fin=' + r.querySelectorAll('.fin').length }`,
    depart: 'cls=b c-1 title=n°1! k=1 txt=texte fixe fin=1',
    etapes: [
      ['valeur 2',               `el.pose(2)`,                          'cls=b c-2 title=n°2! k=2 txt=texte fixe fin=1'],
      ['valeur 30',              `el.pose(30)`,                         'cls=b c-30 title=n°30! k=30 txt=texte fixe fin=1']
    ],
    reprises: ['.b', '.fin']
  },
  {
    tag: 'tx-liste',
    source: `<script>
  $items = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }]
  @pose = (l) -> $items = l
</script>

<p class="n">Total : {$items.length} lignes</p>
<ul>
  {for it in $items by id}
    <li>{it.t}!</li>
  {end}
</ul>
<p class="fin">fin</p>
`,
    vue: `(r) => 'n=' + r.querySelector('.n').textContent + ' li=' + Array.from(r.querySelectorAll('li')).map((l) => l.textContent.trim()).join(',') + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'n=Total : 2 lignes li=a!,b! fin=1',
    etapes: [
      ['ajout de c',             `el.pose(L('a', 'b', 'c'))`,           'n=Total : 3 lignes li=a!,b!,c! fin=1'],
      ['réordre c a b',          `el.pose(L('c', 'a', 'b'))`,           'n=Total : 3 lignes li=c!,a!,b! fin=1'],
      ['liste vidée',            `el.pose([])`,                         'n=Total : 0 lignes li= fin=1'],
      ['liste remplie d',        `el.pose(L('d'))`,                     'n=Total : 1 lignes li=d! fin=1']
    ],
    reprises: ['.n', 'ul', '.fin']
  },
  {
    tag: 'tx-bloc',
    source: `<script>
  $n = 12
  $on = true
  @pose = (v) -> $n = v
  @bascule = (v) -> $on = v
</script>

<p class="b">Total {$n}{if $on} (ok){end} fin</p>
<p class="fin">fin</p>
`,
    vue: `(r) => 'b=' + r.querySelector('.b').textContent + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'b=Total 12 (ok) fin fin=1',
    etapes: [
      ['bloc fermé',             `el.bascule(false)`,                   'b=Total 12 fin fin=1'],
      ['valeur 13',              `el.pose(13)`,                         'b=Total 13 fin fin=1'],
      ['bloc rouvert',           `el.bascule(true)`,                    'b=Total 13 (ok) fin fin=1']
    ],
    reprises: ['.b', '.fin']
  },
  {
    tag: 'tx-bloc-texte',
    source: `<script>
  $on = true
  @bascule = (v) -> $on = v
</script>

<p class="b">avant{if $on} milieu{end} après</p>
<p class="fin">fin</p>
`,
    vue: `(r) => 'b=' + r.querySelector('.b').textContent + ' fin=' + r.querySelectorAll('.fin').length`,
    depart: 'b=avant milieu après fin=1',
    etapes: [
      ['bloc fermé',             `el.bascule(false)`,                   'b=avant après fin=1'],
      ['bloc rouvert',           `el.bascule(true)`,                    'b=avant milieu après fin=1']
    ],
    reprises: ['.b', '.fin']
  }
]

type Rendus   = Record<string, { html: string; hydrateScript: string }>
type Construit = { rendus: Rendus; fichiers: Record<string, Map<string, Buffer>> }
let construit: Promise<Construit> | null = null

// les rendus du serveur dans chaque mode et les deux builds (développement, production), une seule fois pour les deux navigateurs
function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('blocs-hydratation')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const f of FORMES) writeFileSync(join(srcDir, f.tag + '.mjs'), f.source)
    writeFileSync(join(srcDir, 'bl-enfant.mjs'), ENFANT)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    const rendus: Rendus = {}
    for (const mode of MODES) {
      let html = ''
      let hydrateScript = ''
      for (const f of FORMES) {
        const r = await renderer.renderToString('mjs-' + f.tag, { ssrMode: mode } as any)
        html += r.html + '\n'
        hydrateScript = r.hydrateScript
      }
      rendus[mode] = { html, hydrateScript }
    }
    await renderer.close()
    const playwright = await import('playwright')
    if (existsSync(playwright.chromium.executablePath())) {
      const nav = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out-navigateur' } as any, { configDir: root })
      try {
        for (const variante of NAVIGATEUR) {
          let html = ''
          let hydrateScript = ''
          for (const f of FORMES) {
            const r = await nav.renderPage('mjs-' + f.tag, { ssrMode: variante.split(' ')[0] } as any)
            html += r.html + '\n'
            hydrateScript = r.hydrateScript
          }
          rendus[variante] = { html, hydrateScript }
        }
      } finally {
        await nav.close()
      }
    }
    const fichiers: Record<string, Map<string, Buffer>> = {}
    for (const env of ENVS) {
      const dossier = join(root, 'out-' + env)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: dossier, manifestPath: join(dossier, 'bundle.js'), urlPrefix: '/out', runtime: ['hydrate'], js: 'split', env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
      fichiers[env] = new Map<string, Buffer>()
      for (const n of readdirSync(dossier)) if (/\.(js|json)$/.test(n)) fichiers[env].set(n, readFileSync(join(dossier, n)))
      assert.ok(fichiers[env].has('bundle.js'), `le build ${env} écrit son manifeste`)
    }
    return { rendus, fichiers }
  })()
  return construit
}

// avant le bundle : chaque élément écrit par le serveur (dans toutes les racines d'ombre) porte un tampon, pour voir plus tard s'il a été repris
const TAMPON = `<script>(function () { function t(r) { r.querySelectorAll('*').forEach(function (n) { n.__srv = true; if (n.shadowRoot) t(n.shadowRoot) }) } document.querySelectorAll('*').forEach(function (h) { if (h.shadowRoot) t(h.shadowRoot) }) })()</script>`

for (const nom of ['chromium', 'firefox'] as const) for (const env of ENVS) for (const mode of VARIANTES) describe(`blocs après la reprise : ${nom}, ${env}, hydratation « ${mode} »`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any
  let contenu = ''
  let fichiers = new Map<string, Buffer>()
  const erreurs: string[] = []

  const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const lire   = (f: Forme): Promise<string> => page.evaluate(`(() => { const h = document.querySelector('mjs-${f.tag}'); const r = h && h._shadow; return r ? (${f.vue})(r) : 'pas de racine' })()`)

  // la vue attendue : le navigateur la rejoint (chargement d'un enfant, promesse) dans un délai court, sinon c'est un échec
  async function attendreVue(f: Forme, attendu: string, quand: string) {
    let vu = ''
    for (let i = 0; i < 80; i++) {
      try { vu = await lire(f) } catch (e: any) { vu = 'lecture impossible : ' + String(e.message).slice(0, 120) }
      if (vu === attendu) return
      await dormir(25)
    }
    assert.equal(vu, attendu, `${f.tag} ${quand}`)
  }

  before(async function () {
    this.timeout(180000)
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      const fait = await construire()
      if (!fait.rendus[mode]) { present = false; return }
      fichiers   = fait.fichiers[env]
      contenu    = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${fait.rendus[mode].html}\n${fait.rendus[mode].hydrateScript}\n${TAMPON}\n<script type="module" src="/out/bundle.js"></script></body></html>`
      browser    = await playwright[nom].launch()
      page       = await browser.newPage({ viewport: { width: 1000, height: 900 } })
      await page.addInitScript(`window.__name = (f) => f; window.L = (...ts) => ts.map((t) => ({ id: 'abcde'.indexOf(t) + 1, t }))`)
      page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 300)))
      page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push('console : ' + m.text().slice(0, 300)) })
      await page.route('http://blocs.test/**', async (route: any) => {
        const url = new URL(route.request().url())
        if (url.pathname.startsWith('/out/')) {
          const corps = fichiers.get(url.pathname.slice(5))
          if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
          await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
          return
        }
        await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
      })
      await page.goto('http://blocs.test/page', { waitUntil: 'load' })
      await page.waitForFunction(`(() => ${JSON.stringify(FORMES.map((f) => 'mjs-' + f.tag))}.every((t) => { const h = document.querySelector(t); return h && h.matches(':defined') && !h.hasAttribute('mjs-loading') && h._shadow && h._shadow.firstElementChild }))()`, { timeout: 60000 })
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // avant tout geste : les nœuds du serveur hors des blocs sont ceux de la page, et aucun marqueur ne reste dans le DOM
  if (mode.startsWith('markers')) it('les nœuds du serveur hors des blocs sont repris tels quels (mêmes objets), les marqueurs sont retirés', async function () {
    if (!present) { this.skip(); return }
    for (const f of FORMES) {
      for (const sel of f.reprises) {
        assert.equal(await page.evaluate(`(() => { const e = document.querySelector('mjs-${f.tag}')._shadow.querySelector('${sel}'); return !!e && e.__srv === true })()`), true, `${f.tag} : ${sel} est le nœud du serveur`)
      }
    }
    assert.equal(await page.evaluate(`Array.from(document.querySelectorAll('*')).some((h) => h._shadow && h._shadow.querySelector('[mjs-h]'))`), false, 'aucun attribut mjs-h ne reste')
    assert.equal(await page.evaluate(`Array.from(document.querySelectorAll('*')).some((h) => { const r = h._shadow; if (!r) return false; const w = document.createTreeWalker(r, 128); let c; while ((c = w.nextNode())) if (/^mjs-[he]:/.test(c.data)) return true; return false })`), false, 'aucun commentaire de marqueur ne reste')
  })

  // hors de `markers` rien n'est étiqueté : le HTML du serveur reste propre, sans le moindre commentaire (l'alignement se fait au client)
  if (!mode.startsWith('markers')) it('le HTML du serveur ne porte aucun commentaire', async function () {
    if (!present) { this.skip(); return }
    assert.equal(contenu.includes('<!--'), false, 'aucun commentaire dans la page rendue par le serveur')
  })

  for (const f of FORMES) it(`${f.tag} : l'état de départ, puis chaque écriture de l'état se retrouve dans le DOM`, async function () {
    if (!present) { this.skip(); return }
    await attendreVue(f, f.depart, 'au départ')
    for (const [quoi, geste, attendu] of f.etapes) {
      await page.evaluate(`(() => { const el = document.querySelector('mjs-${f.tag}'); ${geste} })()`)
      await attendreVue(f, attendu, `après « ${quoi} »`)
    }
    assert.deepEqual(erreurs.filter((e) => e.includes('mjs-' + f.tag)), [], `${f.tag} : aucune erreur de page`)
  })

  it('aucune erreur dans la page', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
  })
})
