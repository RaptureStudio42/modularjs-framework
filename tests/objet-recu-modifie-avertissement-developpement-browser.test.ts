// Avertissement du développement, en navigateur réel, cliqué à la souris : la règle simple de Svelte 5. Un objet reçu par une prop
// simple (`items={$items}`, sans `!`), ou atteint à partir de lui à toute profondeur, que l'enfant modifie — `$items.push(x)`,
// `$items[0].nom = v`, `$cfg.a = 1`, `delete $cfg.b`, `Object.defineProperty`, `Object.defineProperties`, `Object.assign`, une méthode
// native qui change l'objet (`reverse`, `setFullYear`, `delete` et `clear` d'une Map ou d'un Set), ce qu'on lit d'une Map ou d'un Set, une
// autre variable qui le garde, une fonction qui le reçoit, un élément modifié à travers une copie de la liste — est dit une fois par
// composant et par prop, quoi que fasse le parent ensuite : il garde l'objet, le lâche, le recalcule, le recopie, le lie plus loin ; deux
// parents du même enfant n'en font pas dire deux. L'objet vient d'où le parent le prend : son état, une valeur dérivée, le magasin `$$`
// (passé tel quel, par un de ses éléments, par la ligne d'un `{for}` sur lui, `{for}` imbriqués compris), un `µ.state`. Une ligne de
// `{for}`, une prop étalée, une balise qui porte un gestionnaire d'événement comptent, comme la modification faite pendant le rendu de
// l'enfant. La prop simple écrite compte, même quand une prop liée atteint le même objet.
// Une prop liée (`!{…}`) n'avertit pas : ce que l'enfant lié modifie, il le modifie pour celui qui la lie. Quand celui-ci a reçu l'objet
// par une prop simple, c'est lui qui est nommé, avec l'enfant lié qui modifie, au bout d'une chaîne de liaisons comprise, dans une boucle,
// par une autre variable ou par une ligne liée par son rang (`item=!{$items[i]}`) ; rien quand toute la chaîne est liée, ni pour les
// frères à sens unique d'un frère lié qui modifie.
// Le message nomme l'enfant, la prop et le composant qui la lui a passée, sous les balises telles que l'auteur les écrit, en français et
// en anglais, avec la pile d'appels de la modification et un renvoi à la documentation (« Modifier un objet reçu », 04-props.md), sans
// remède au cas par cas ; l'enfant qui lie à son propre enfant la copie en surface d'une liste reçue est nommé quand le petit-enfant en
// modifie un élément, pas pour une copie profonde. Les exemples que la documentation donne du principe sûr — l'objet se modifie là où il
// est rangé, par sa variable `$` ou `$$`, l'enfant le demande par un événement ou écrit par une prop liée — sont joués : écrans justes
// partout, rien n'est dit.
// Rien n'est dit pour un objet que l'enfant a fait et garde (sa copie, même rangée dans sa propre prop et passée à son propre enfant, une
// copie envoyée à la place de la sienne), une réaffectation (`$items = …`, que l'avertissement « écrit sa prop » dit seul), un objet µraw,
// le magasin écrit par `$$` dans l'enfant, ce que le gestionnaire du parent écrit dans l'objet que l'enfant lui envoie (`e.data`, aussitôt
// ou plus tard), ni une écriture du parent dans son propre état.
// Ce que la documentation promet de la prop liée, joué tel quel : elle redessine le parent pour ce que l'enfant écrit par elle dans son
// script, à toute profondeur, et pour ce qu'il change à la liste elle-même par une fonction, pas pour un changement plus profond fait par
// une autre variable ou par une fonction.
// Le coût : une modification ne parcourt ni le registre des composants ni l'état du parent — 1 000 modifications sur une page de 1 000
// composants le montrent, comme un parent de 10 000 lignes changé avant chaque modification de l'enfant ; la lecture d'une liste reçue sur
// deux niveaux ne fait, en développement, aucune recherche dans une table faible de plus qu'en production (Chromium et Firefox).
// En production : ni l'avertissement, ni son texte (fichiers envoyés lus), et la page se comporte de même.

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { attendre, construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'
import { playTogether } from './helpers/engines-together.js'

// un enfant : son script, sa ligne `.vu`, son bouton `.x`
const enfant = (script: string, vu: string) => `<script>\n${script}\n</script>\n\n<p class="vu">${vu}</p>\n<button class="x" type="button" @click={agir()}>x</button>\n`
// un enfant qui garde l'objet reçu (`.y` : prendre) avant de le modifier (`.x` : agir)
const gardien = (script: string, vu: string) => enfant(script, vu) + '<button class="y" type="button" @click={prendre()}>y</button>\n'
const garde   = gardien("  $sel = null\n\n  prendre = -> $sel = $items[0]\n  agir    = -> $sel.nom = 'Z'", "{$sel ? $sel.nom : '-'}-{$items ? $items[0].nom : '-'}")
const tient   = gardien("  $mien = null\n\n  prendre = -> $mien = $obj\n  agir    = -> $mien.n = $mien.n + 1", "{$mien ? $mien.n : '-'}-{$obj ? $obj.n : '-'}")
// un enfant qui modifie le dernier élément de la liste reçue
const dernier = enfant("  agir = -> $items[$items.length - 1].nom = 'Q'", "{$items ? $items[$items.length - 1].nom : '-'}")
// un enfant qui modifie le premier élément de la liste reçue, puis prévient son parent par un événement
const signale = enfant("  agir = ->\n    $items[0].nom = $items[0].nom + 'Z'\n    µemit 'fait'", "{$items ? $items[0].nom : '-'}")
// un parent qui lâche sa liste quand l'enfant lui envoie `fait`, de la façon `lacher`
const lacheur = (tag: string, lacher: string) => `<script>\n  $items = [{ nom: 'a' }]\n\n  lacher = ->\n${lacher}\n</script>\n\n<@${tag} items={$items} @fait={lacher()}>\n<p class="etat">{$items[0].nom}</p>\n`
// un enfant qui envoie la liste reçue, et le parent qui en écrit le premier élément par `e.data`, de la façon `ecrire`
const emetteur = enfant("  agir = -> µemit 'x', $items", "{$items ? $items[0].nom : '-'}")
const receveur = (tag: string, ecrire: string, extra = '') => `<script>\n  $items = [{ nom: 'a' }]\n${extra}</script>\n\n<@${tag} items={$items} @x={${ecrire}}>\n<p class="etat">{$items[0].nom}</p>\n`
// un parent qui passe sa liste à `c-pousse`
const passeur = "<script>\n  $l = [{ nom: 'a' }]\n</script>\n\n<p class=\"vu\">{$l.length}</p>\n<@c-pousse items={$l}>\n"
// un enfant qui fait une copie de l'objet reçu, la modifie, puis envoie `envoi` au parent, et modifie encore sa copie
const brouillon = (envoi: string) => gardien(`  $mien = null\n\n  prendre = ->\n    $mien = { ...$cfg }\n    $mien.a = 5\n    µemit 'valide', ${envoi}\n  agir = -> $mien.a = $mien.a + 1`, "{$mien ? $mien.a : '-'}-{$cfg ? $cfg.a : '-'}")
// un enfant qui lie la liste reçue à son propre enfant `petit` (`items=!{$items}`)
const milieu = (petit: string) => `<p class="vu">{$items ? $items.length : '-'}</p>\n<@${petit} items=!{$items}>\n`

// un enfant qui montre la longueur de la liste et le nom de son premier élément : il ne fait rien (et porte `extra`), ou il ajoute `nom`
const LONG   = "{$items ? $items.length + $items[0].nom : '-'}"
const NUL    = (extra: string) => enfant('  agir = -> null', LONG) + extra
const POUSSE = (nom: string) => enfant(`  agir = -> $items.push({ nom: '${nom}' })`, LONG)

const SOURCES: Record<string, string> = {
  // chaque enfant modifie l'objet du parent d'une façon : chacun est dit, une fois
  'rs-modifie.mjs': `<script>
  $l1 = [{ nom: 'a' }, { nom: 'b' }]
  $l2 = [{ nom: 'a' }, { nom: 'b' }]
  $l3 = [{ nom: 'a' }, { nom: 'b' }]
  $l4 = [{ nom: 'a' }, { nom: 'b' }]
  $c1 = { a: 0, b: 1 }
  $c2 = { a: 0, b: 1 }
  $c3 = { a: 0, b: 1 }
  $d1 = new Date(2020, 0, 1)
</script>

<@c-pousse items={$l1}>
<@c-champ items={$l2}>
<@c-inverse items={$l3}>
<@c-alias items={$l4}>
<@c-cle cfg={$c1}>
<@c-retire cfg={$c2}>
<@c-fonction cfg={$c3}>
<@c-date jour={$d1}>
<p class="etat">{$l1.length}-{$l2[0].nom}-{$c1.a}</p>
`,
  'c-pousse.mjs':   enfant("  agir = -> $items.push({ nom: 'z' })", "{$items ? $items.length : '-'}"),
  'c-champ.mjs':    enfant("  agir = -> $items[0].nom = 'Z'", "{$items ? $items[0].nom : '-'}"),
  'c-inverse.mjs':  enfant('  agir = -> $items.reverse()', "{$items ? $items[0].nom + $items[1].nom : '-'}"),
  'c-alias.mjs':    enfant("  agir = ->\n    t = $items[0]\n    t.nom = 'Y'", "{$items ? $items[0].nom : '-'}"),
  'c-cle.mjs':      enfant('  agir = -> $cfg.a = 1', "{$cfg ? $cfg.a : '-'}"),
  'c-retire.mjs':   enfant('  agir = -> delete $cfg.b', "{$cfg ? Object.keys($cfg).join(',') : '-'}"),
  'c-fonction.mjs': enfant('  regler = (o) -> o.n = 5\n  agir   = -> regler($cfg)', "{$cfg ? $cfg.n : '-'}"),
  'c-date.mjs':     enfant('  agir = -> $jour.setFullYear(2030)', "{$jour ? $jour.getFullYear() : '-'}"),

  // rien n'est dit : prop liée, objet à soi et copies, réaffectation, µraw, écriture du parent ; le magasin modifié par la prop de l'enfant
  // est dit, écrit par `$$` il ne l'est pas
  'rs-calme.mjs': `<script>
  $l1      = [{ nom: 'a' }, { nom: 'b' }]
  $l2      = [{ nom: 'a' }, { nom: 'b' }]
  $l3      = [{ nom: 'a' }, { nom: 'b' }]
  $c1      = { a: 0 }
  $big     = µraw([1, 2])
  $$panier = [1]

  ajouter = -> $l3.push({ nom: 'p' })
</script>

<@c-lie items=!{$l1}>
<@c-mien items={$l2} cfg={$c1}>
<@c-reaffecte items={$l3}>
<@c-brut big={$big}>
<@c-magasin liste={$$panier}>
<button class="p" type="button" @click={ajouter()}>p</button>
<p class="etat">{$l1.length}-{$l3.length}</p>
`,
  'c-lie.mjs':       enfant("  agir = -> $items.push({ nom: 'z' })", "{$items ? $items.length : '-'}"),
  'c-mien.mjs':      enfant("  $mien  = []\n  $copie = []\n  $autre = {}\n\n  agir = ->\n    $mien.push(1)\n    $copie = [...$items]\n    $copie.push({ nom: 'q' })\n    $autre = { ...$cfg }\n    $autre.a = 9", '{$mien.length}-{$copie.length}-{$autre.a}'),
  'c-reaffecte.mjs': enfant("  agir = ->\n    $items = [{ nom: 'n' }]\n    $items.push({ nom: 'm' })", "{$items ? $items.length : '-'}"),
  'c-brut.mjs':      enfant('  agir = -> $big.push(3)', "{$big ? $big.length : '-'}"),
  'c-magasin.mjs':   enfant('  agir = ->\n    $$panier.push(2)\n    $liste.push(3)', "{$liste ? $liste.length : '-'}"),

  // trois lignes d'un {for}, chacune modifie l'objet de sa ligne : un seul avertissement ; la ligne d'un {for} de l'enfant sur la liste reçue,
  // modifiée par son gestionnaire, est dite aussi
  'rs-liste.mjs': `<script>
  $rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
</script>

{for r in $rows}
  <@c-ligne item={r}>
{end}
<@c-boucle items={$rows}>
`,
  'c-ligne.mjs':  enfant('  agir = -> $item.fait = true', "{$item ? $item.id : '-'}{$item && $item.fait ? '+' : ''}"),
  'c-boucle.mjs': "<p class=\"vu\">{$items ? $items.filter((r) -> r.vu).length : '-'}</p>\n{for r in $items}\n  <button class=\"x\" type=\"button\" @click={r.vu = 1}>{r.id}</button>\n{end}\n",

  // une prop étalée, une balise qui porte un gestionnaire d'événement
  'rs-etale.mjs': `<script>
  $data = { liste: [1, 2] }
  $l1   = [1]
  $vus  = 0
</script>

<@c-etale {...$data}>
<@c-ecoute items={$l1} @change={$vus = $vus + 1}>
<p class="etat">{$vus}</p>
`,
  'c-etale.mjs':  enfant('  agir = -> $liste.push(3)', "{$liste ? $liste.length : '-'}"),
  'c-ecoute.mjs': enfant("  agir = ->\n    $items.push(2)\n    µemit 'change'", "{$items ? $items.length : '-'}"),

  // la liste copiée, son élément modifié : l'élément est celui du parent
  'rs-copie.mjs': `<script>
  $l1 = [{ nom: 'a' }]
</script>

<@c-copie items={$l1}>
<p class="etat">{$l1[0].nom}</p>
`,
  'c-copie.mjs': enfant("  $mien = []\n\n  agir = ->\n    $mien = [...$items]\n    $mien[0].nom = 'K'", '{$mien.length}'),

  // l'enfant range une copie de la liste dans sa propre prop, la passe à son propre enfant, puis la modifie : la copie est à lui
  'rs-milieu.mjs': `<script>
  $l1 = [{ nom: 'a' }, { nom: 'b' }]
</script>

<@c-milieu items={$l1}>
<p class="etat">{$l1.length}</p>
`,
  'c-milieu.mjs': enfant("  agir  = -> $items = [...$items]\n  autre = -> $items.push({ nom: 'm' })", "{$items ? $items.length : '-'}") + '<@c-petit items={$items}>\n<button class="y" type="button" @click={autre()}>y</button>\n',
  'c-petit.mjs':  "<p class=\"vu\">{$items ? $items.length : '-'}</p>\n",

  // l'enfant envoie la liste reçue dans un événement : ce que le gestionnaire du parent y écrit (`e.data`), aussitôt, après une minuterie ou
  // après un `await`, est l'écriture du parent ; l'enfant qui la modifie lui-même avant de l'envoyer est dit
  'rs-emet.mjs': `<script>
  $l1  = [{ nom: 'a' }]
  $l2  = [{ nom: 'a' }]
  $l3  = [{ nom: 'a' }]
  $vus = 0

  tard = (e) ->
    µafter 0, -> e.data.push(9)
    return
</script>

<@c-emet items={$l1} @x={e.data.push(9)}>
<@c-pousse-emet items={$l2} @x={$vus = $vus + 1}>
<@c-emet-tard items={$l3} @x={tard(e)}>
<p class="etat">{$l1.length}-{$l2.length}-{$l3.length}-{$vus}</p>
`,
  'c-emet.mjs':        enfant("  agir = -> µemit 'x', $items", "{$items ? $items.length : '-'}"),
  'c-pousse-emet.mjs': enfant("  agir = ->\n    $items.push({ nom: 'q' })\n    µemit 'x', $items", "{$items ? $items.length : '-'}"),
  'c-emet-tard.mjs':   enfant("  agir = -> µemit 'x', $items", "{$items ? $items.length : '-'}"),
  'rs-attend.mjs':     receveur('c-attend', 'ecrire(e)', "\n  ecrire = (e) ->\n    await null\n    e.data[0].nom = 'T'\n"),
  'c-attend.mjs':      emetteur,

  // l'enfant modifie l'objet reçu pendant son rendu : dit aussi quand il est déjà défini à la livraison (le rendu suit alors la prop
  // aussitôt livrée)
  'rs-rendu.mjs': `<script>
  $m = { grid: null }
</script>

<@c-rendu map={$m}>
`,
  'c-rendu.mjs': enfant("  plan = ->\n    $map.grid ?= {}\n    'p'\n  agir = -> null", "{$map ? plan() : '-'}"),

  // chaque enfant garde l'élément reçu, puis le parent recharge ses listes : l'objet reste venu de la prop, l'enfant qui le modifie est dit,
  // qu'il le garde seul, par une copie de la liste, que le parent le lise, le garde ou le range dans `$pile`
  'rs-lache.mjs': `<script>
  $v1   = [{ nom: 'a' }]
  $v2   = [{ nom: 'a' }]
  $v3   = [{ nom: 'a' }]
  $v4   = [{ nom: 'a' }]
  $v5   = [{ nom: 'a' }]
  $pile = []

  recharger = ->
    $v1 = [{ nom: 'b' }]
    $v2 = [{ nom: 'b' }]
    $v3 = [{ nom: 'b' }]
    $pile.push($v5)
    $v5 = [{ nom: 'b' }]
</script>

<@c-garde items={$v1}>
<@c-garde-copie items={$v2}>
<@c-garde-lu items={$v3}>
<@c-garde-sans items={$v4}>
<@c-garde-pile items={$v5}>
<button class="p" type="button" @click={recharger()}>p</button>
<p class="etat">{$v1.length}|{$v2.length}|{$v3[0].nom}|{$v4.length}|{$v5.length}|{$pile.length}</p>
`,
  'c-garde.mjs':       garde,
  'c-garde-lu.mjs':    garde,
  'c-garde-sans.mjs':  garde,
  'c-garde-pile.mjs':  garde,
  'c-garde-copie.mjs': gardien("  $mien = []\n\n  prendre = -> $mien = [...$items]\n  agir    = -> $mien[0].nom = 'Z'", "{$mien.length ? $mien[0].nom : '-'}-{$items ? $items[0].nom : '-'}"),

  // l'élément que le parent n'a jamais lu : modifié à travers une copie de la liste, rangée à part ou dans la prop elle-même (filtrée
  // comprise), ou à travers une copie de l'objet, il est dit
  'rs-nonlu.mjs': `<script>
  $u1 = [{ nom: 'a' }]
  $u2 = [{ nom: 'a' }]
  $u3 = [{ nom: 'a' }, { nom: 'b' }]
  $u4 = { sous: { n: 0 } }
</script>

<@c-nonlu-mien items={$u1}>
<@c-nonlu-prop items={$u2}>
<@c-nonlu-filtre items={$u3}>
<@c-nonlu-objet cfg={$u4}>
<p class="etat">{$u1.length}|{$u2.length}|{$u3.length}|{$u4 ? 'o' : '-'}</p>
`,
  'c-nonlu-mien.mjs':   enfant("  $mien = []\n\n  agir = ->\n    $mien = [...$items]\n    $mien[0].nom = 'K'", "{$mien.length}-{$items ? $items[0].nom : '-'}"),
  'c-nonlu-prop.mjs':   enfant("  agir = ->\n    $items = [...$items]\n    $items[0].nom = 'K'", "{$items ? $items[0].nom : '-'}"),
  'c-nonlu-filtre.mjs': enfant("  agir = ->\n    $items = $items.filter((x) -> x.nom == 'a')\n    $items[0].nom = 'K'", "{$items ? $items.length + $items[0].nom : '-'}"),
  'c-nonlu-objet.mjs':  enfant("  agir = ->\n    $cfg = { ...$cfg }\n    $cfg.sous.n = 1", "{$cfg && $cfg.sous ? $cfg.sous.n : '-'}"),

  // une fonction du parent que l'enfant appelle avec l'objet reçu l'écrit par l'enfant : c'est dit sous son nom, et le parent suit
  'rs-rappel.mjs': `<script>
  $t1 = [{ nom: 'a' }]

  prendre = (x) -> x.push(9)
</script>

<@c-rappel items={$t1} pris={prendre}>
<p class="etat">{$t1.length}</p>
`,
  'c-rappel.mjs': enfant('  agir = -> $pris($items)', "{$items ? $items.length : '-'}"),

  // chaque enfant garde l'objet reçu, puis le parent le lâche par une valeur simple (`false`, `''`, `null`) : l'objet reste venu de la
  // prop, le modifier est dit
  'rs-lache-simple.mjs': `<script>
  $o1 = { n: 0 }
  $o2 = { n: 0 }
  $o3 = { n: 0 }

  faux = -> $o1 = false
  vide = -> $o2 = ''
  nul  = -> $o3 = null
</script>

<@c-tient-faux obj={$o1}>
<@c-tient-vide obj={$o2}>
<@c-tient-nul obj={$o3}>
<button class="p" type="button" @click={faux()}>p</button>
<button class="q" type="button" @click={vide()}>q</button>
<button class="r" type="button" @click={nul()}>r</button>
<p class="etat">{$o1 ? 'o' : 'non'}|{$o2 ? 'o' : 'non'}|{$o3 ? 'o' : 'non'}</p>
`,
  'c-tient-faux.mjs': tient,
  'c-tient-vide.mjs': tient,
  'c-tient-nul.mjs':  tient,

  // des frères écrivent la liste du parent par leur propre enveloppe, le gestionnaire du parent y ajoute un élément par `e.data` : chaque
  // enfant qui modifie lui-même un objet venu de sa prop est dit, l'élément qu'un frère a retiré compris ; l'enfant qui envoie la liste,
  // non
  'rs-freres.mjs': `<script>
  $r1 = [{ nom: 'a' }, { nom: 'b' }]
  $r2 = [{ nom: 'a' }]
  $r3 = [{ nom: 'a' }]
</script>

<@c-retire-un items={$r1}>
<@c-garde-un items={$r1}>
<@c-ajoute-un items={$r2}>
<@c-dernier items={$r2}>
<@c-emet-ajout items={$r3} @x={e.data.push({ nom: 'e' })}>
<@c-dernier-emis items={$r3}>
<p class="etat">{$r1.length}|{$r2.length}|{$r3.length}</p>
`,
  'c-retire-un.mjs':    enfant('  agir = -> $items.splice(0, 1)', "{$items ? $items.length : '-'}"),
  'c-garde-un.mjs':     garde,
  'c-ajoute-un.mjs':    enfant("  agir = -> $items.push({ nom: 'n' })", "{$items ? $items.length : '-'}"),
  'c-dernier.mjs':      dernier,
  'c-emet-ajout.mjs':   enfant("  agir = -> µemit 'x', $items", "{$items ? $items.length : '-'}"),
  'c-dernier-emis.mjs': dernier,

  // une valeur dérivée du parent passée en prop, modifiée, ou gardée puis modifiée après un nouveau calcul ; la ligne d'une liste µraw,
  // elle-même suivie dans l'enveloppe de l'enfant : chacune est dite
  'rs-derive.mjs': `<script>
  $n     = 1
  $cfg   = { a: $n }
  $liste = [{ nom: 'a' }]
  $vue   = $liste.map((x) -> ({ ...x }))
  $big   = µraw([{ nom: 'r' }])
  $m     = 1
  $vieux = { a: $m }

  changer = -> $m = $m + 1
</script>

<@c-cle-derive cfg={$cfg}>
<@c-champ-derive items={$vue}>
<@c-brut-ligne item={$big[0]}>
<@c-garde-derive cfg={$vieux}>
<button class="p" type="button" @click={changer()}>p</button>
<p class="etat">{$cfg.a}|{$cfg.b ? $cfg.b : '-'}|{$vue[0].nom}|{$big[0].nom}|{$vieux.a}</p>
`,
  'c-cle-derive.mjs':   enfant('  agir = -> $cfg.b = 2', "{$cfg ? $cfg.b : '-'}"),
  'c-champ-derive.mjs': enfant("  agir = -> $items[0].nom = 'V'", "{$items ? $items[0].nom : '-'}"),
  'c-brut-ligne.mjs':   enfant("  agir = -> $item.nom = 'R'", "{$item ? $item.nom : '-'}"),
  'c-garde-derive.mjs': gardien("  $mien = null\n\n  prendre = -> $mien = $cfg\n  agir    = -> $mien.a = 9", "{$mien ? $mien.a : '-'}-{$cfg ? $cfg.a : '-'}"),

  // le parent recharge sa liste dans l'écouteur du même clic (sur une enveloppe, ou sur la balise de l'enfant), ou dans une micro-tâche
  // lancée par le gestionnaire de l'événement que l'enfant envoie : l'enfant qui a modifié l'élément est dit
  'rs-reel.mjs': "<script>\n  $items = [{ nom: 'a' }]\n\n  lacher = -> $items = [{ nom: 'b' }]\n</script>\n\n<div class=\"zone\" @click={lacher()}>\n  <@c-reel items={$items}>\n</div>\n<@c-reel2 items={$items} @click={lacher()}>\n<p class=\"etat\">{$items[0].nom}</p>\n",
  'c-reel.mjs':  signale,
  'c-reel2.mjs': signale,
  'rs-micro.mjs': lacheur('c-micro', "    queueMicrotask(=> $items = [{ nom: 'b' }])"),
  'c-micro.mjs':  signale,
  'rs-then.mjs':  lacheur('c-then', "    Promise.resolve().then(=> $items = [{ nom: 'b' }])"),
  'c-then.mjs':   signale,

  // une dérivée du parent garde l'élément de l'ancienne liste, plus relue après le rechargement : l'enfant qui modifie l'élément gardé est dit
  'rs-perime.mjs': "<script>\n  $items   = [{ nom: 'a' }]\n  $premier = $items[0]\n  $voir    = true\n\n  cacher    = -> $voir = false\n  recharger = -> $items = [{ nom: 'b' }]\n</script>\n\n<@c-perime items={$items}>\n{if $voir}\n  <p class=\"pr\">{$premier.nom}</p>\n{end}\n<button class=\"p\" type=\"button\" @click={recharger()}>p</button>\n<button class=\"q\" type=\"button\" @click={cacher()}>q</button>\n<p class=\"etat\">{$items[0].nom}</p>\n",
  'c-perime.mjs': garde,

  // deux props sur le même objet, l'une liée à deux sens (`items=!{$items}`), l'autre simple (`sel={$items[0]}`) : écrit par la prop liée,
  // rien n'est dit ; par la prop simple, c'est dit, et le parent se redessine
  'rs-deux.mjs': "<script>\n  $items = [{ nom: 'a' }]\n</script>\n\n<@c-deux items=!{$items} sel={$items[0]}>\n<p class=\"etat\">{$items[0].nom}</p>\n",
  'c-deux.mjs':  gardien("  prendre = -> $sel.nom = $sel.nom + 'S'\n  agir    = -> $items[0].nom = $items[0].nom + 'Z'", "{$sel ? $sel.nom : '-'}-{$items ? $items[0].nom : '-'}"),

  // le magasin passé en prop par un de ses éléments ou par la ligne d'un `{for}` sur lui, un objet d'un `µ.state` : chacun est dit, une fois
  // pour les deux lignes
  'rs-partage.mjs': "<script>\n  $$stock = [{ n: 0 }, { n: 0 }]\n  etat = µ.state({ liste: [{ n: 0 }] })\n</script>\n\n<@c-stock-el item={$$stock[0]}>\n{for s in $$stock}\n  <@c-stock-ligne item={s}>\n{end}\n<@c-etat item={etat.liste[0]}>\n<p class=\"etat\">{$$stock[0].n}|{$$stock[1].n}</p>\n",
  'c-stock-el.mjs':    enfant('  agir = -> $item.n = $item.n + 1', "{$item ? $item.n : '-'}"),
  'c-stock-ligne.mjs': enfant('  agir = -> $item.n = $item.n + 1', "{$item ? $item.n : '-'}"),
  'c-etat.mjs':        enfant('  agir = -> $item.n = $item.n + 1', "{$item ? $item.n : '-'}"),

  // deux parents différents passent chacun leur liste au même enfant : un seul avertissement pour l'enfant et sa prop, au nom du premier
  'rs-parents.mjs':  '<@c-parent-a>\n<@c-parent-b>\n',
  'c-parent-a.mjs':  passeur,
  'c-parent-b.mjs':  passeur,
  // une copie de l'enfant que le parent reçoit par un événement, puis lui repasse par une prop (rangée dans la liste passée, ou dans la
  // variable passée) : elle vient désormais du parent, qui la tient — la modifier est dit ; une copie envoyée à la place de la sienne
  // (`µemit 'valide', {...$mien}`) laisse la sienne à l'enfant
  'rs-neuf.mjs': "<script>\n  $l1   = [{ nom: 'a' }]\n  $recu = null\n  $cfg  = { a: 0 }\n  $cfg2 = { a: 0 }\n</script>\n\n<@c-neuf items={$l1} @ajoute={$l1.push(e.data)}>\n<@c-retour sel={$recu} @garde={$recu = e.data}>\n<@c-brouillon cfg={$cfg} @valide={$cfg = e.data}>\n<@c-envoie-copie cfg={$cfg2} @valide={$cfg2 = e.data}>\n<p class=\"etat\">{$l1.map((x) -> x.nom).join(',')}|{$recu ? $recu.n : '-'}|{$cfg.a}|{$cfg2.a}</p>\n",
  'c-neuf.mjs':         gardien("  $neuf = null\n\n  prendre = ->\n    $neuf = { nom: 'n' }\n    µemit 'ajoute', $neuf\n  agir = -> $neuf.nom = 'm'", "{$items ? $items.map((x) -> x.nom).join(',') : '-'}"),
  'c-retour.mjs':       gardien("  $mien = { n: 0 }\n\n  prendre = -> µemit 'garde', $mien\n  agir    = -> $mien.n = $mien.n + 1", "{$mien.n}-{$sel ? $sel.n : '-'}"),
  'c-brouillon.mjs':    brouillon('$mien'),
  'c-envoie-copie.mjs': brouillon('{ ...$mien }'),

  // une propriété définie par `Object.defineProperty` sur l'objet reçu est dite comme une écriture ; comme elle, elle redessine
  // l'enfant et ne prévient pas le parent
  'rs-define.mjs': "<script>\n  $c1 = { a: 0 }\n</script>\n\n<@c-define cfg={$c1}>\n<p class=\"etat\">{$c1.a}</p>\n",
  'c-define.mjs':  enfant("  agir = -> Object.defineProperty($cfg, 'a', { value: 1, writable: true, enumerable: true, configurable: true })", "{$cfg ? $cfg.a : '-'}"),

  // la chaîne : l'enfant reçoit la liste par une prop simple et la lie à son propre enfant (`items=!{$items}`) ; le petit-enfant qui la
  // modifie (par `$items`, par une autre variable, dans une liste de nombres) la modifie pour l'enfant, qui l'a reçue par une prop simple :
  // l'enfant est nommé, avec le petit-enfant lié qui modifie et le composant qui la lui passe, même quand sa balise porte un gestionnaire
  // d'événement ; rien n'est dit quand toute la chaîne est liée
  'rs-chaine.mjs': "<script>\n  $l1  = [{ nom: 'a' }]\n  $l2  = [{ nom: 'a' }]\n  $l3  = [1]\n  $l4  = [{ nom: 'a' }]\n  $l5  = [{ nom: 'a' }]\n  $vus = 0\n</script>\n\n<@c-milieu-lie items={$l1}>\n<@c-milieu-alias items={$l2}>\n<@c-milieu-nb items={$l3}>\n<@c-milieu-tout items=!{$l4}>\n<@c-milieu-ecoute items={$l5} @change={$vus = $vus + 1}>\n<p class=\"etat\">{$l1.length}|{$l2[0].nom}|{$l3.length}|{$l4.length}|{$l5.length}</p>\n",
  'c-milieu-lie.mjs':   milieu('c-petit-lie'),
  'c-milieu-alias.mjs': milieu('c-petit-alias'),
  'c-milieu-nb.mjs':    milieu('c-petit-nb'),
  'c-milieu-tout.mjs':  milieu('c-petit-tout'),
  'c-milieu-ecoute.mjs': milieu('c-petit-ecoute'),
  'c-petit-lie.mjs':    enfant("  agir = -> $items.push({ nom: 'g' })", "{$items ? $items.length : '-'}"),
  'c-petit-alias.mjs':  enfant("  agir = ->\n    t = $items[0]\n    t.nom = 'Y'", "{$items ? $items[0].nom : '-'}"),
  'c-petit-nb.mjs':     enfant("  agir = -> $items.push({ nom: 'h' })", "{$items ? $items.length : '-'}"),
  'c-petit-tout.mjs':   enfant("  agir = -> $items.push({ nom: 'g' })", "{$items ? $items.length : '-'}"),
  'c-petit-ecoute.mjs': enfant("  agir = -> $items.push({ nom: 'e' })", "{$items ? $items.length : '-'}"),

  // une prop liée à deux sens (`items=!{…}`) : ce que l'enfant écrit par `$items` dans son script, à toute profondeur, ce qu'il change à
  // la liste elle-même par une fonction, et un changement plus profond fait par une autre variable ou par une fonction redessinent le parent,
  // comme l'écriture directe ; rien n'est dit, l'objet est partagé par la prop liée
  'rs-lie.mjs': "<script>\n  $b1 = [{ sous: { n: 0 } }]\n  $b2 = [1]\n  $b3 = [{ sous: { n: 0 } }]\n  $b4 = [{ nom: 'a' }]\n</script>\n\n<@c-lie-prof items=!{$b1}>\n<@c-lie-pousse-fn items=!{$b2}>\n<@c-lie-fn items=!{$b3}>\n<@c-lie-alias items=!{$b4}>\n<p class=\"etat\">{$b1[0].sous.n}|{$b2.length}|{$b3[0].sous.n}|{$b4[0].nom}</p>\n",
  'c-lie-prof.mjs':      enfant('  agir = -> $items[0].sous.n = $items[0].sous.n + 1', "{$items ? $items[0].sous.n : '-'}"),
  'c-lie-pousse-fn.mjs': enfant('  pousser = (l) -> l.push(2)\n  agir    = -> pousser($items)', "{$items ? $items.length : '-'}"),
  'c-lie-fn.mjs':        enfant('  regler = (o) -> o.sous.n = o.sous.n + 1\n  agir   = -> regler($items[0])', "{$items ? $items[0].sous.n : '-'}"),
  'c-lie-alias.mjs':     enfant("  agir = ->\n    t = $items[0]\n    t.nom = 'Y'", "{$items ? $items[0].nom : '-'}"),

  // un objet du magasin passé tel quel : l'enfant qui le modifie par sa prop ne prévient pas les lecteurs du magasin, c'est dit ; écrit par
  // `$$` dans l'enfant, il prévient ceux qui le lisent par `$$` (le parent), pas la prop de l'enfant, et rien n'est dit
  'rs-magasin.mjs': "<script>\n  $$panier2 = [1]\n  $$panier3 = [1]\n</script>\n\n<@c-st-prop liste={$$panier2}>\n<@c-st-ecrit liste={$$panier3}>\n<p class=\"etat\">{$$panier2.length}|{$$panier3.length}</p>\n",
  'c-st-prop.mjs':  enfant('  agir = -> $liste.push(4)', "{$liste ? $liste.length : '-'}"),
  'c-st-ecrit.mjs': enfant('  agir = -> $$panier3.push(4)', "{$liste ? $liste.length : '-'}"),

  // frères à sens unique d'un frère lié qui modifie la liste du parent (par `push`, par une chaîne liée, en profondeur, l'un avant l'autre,
  // pour la ligne d'un `{for}`) : les frères ne modifient rien, rien n'est dit
  'rs-voisins.mjs': "<script>\n  $t1 = [{ nom: 'a' }]\n  $t2 = [{ nom: 'a' }]\n  $t3 = [{ nom: 'a' }]\n  $t4 = [{ nom: 'a' }]\n  $t5 = [{ nom: 'a' }]\n</script>\n\n<@c-resume1 items={$t1}>\n<@c-editeur1 items=!{$t1}>\n<@c-resume2 items={$t2}>\n<@c-mid-b items=!{$t2}>\n<@c-resume3 items={$t3}>\n<@c-editeur3 items=!{$t3}>\n<@c-editeur4 items=!{$t4}>\n<@c-resume4 items={$t4}>\n{for r in $t5}\n  <@c-ligne5 item={r}>\n{end}\n<@c-editeur5 items=!{$t5}>\n<p class=\"etat\">{$t1.length}|{$t2.length}|{$t3[0].nom}|{$t4.length}|{$t5[0].nom}</p>\n",
  'c-resume1.mjs':  NUL(''),
  'c-resume2.mjs':  NUL(''),
  'c-resume3.mjs':  NUL(''),
  'c-resume4.mjs':  NUL(''),
  'c-ligne5.mjs':   enfant('  agir = -> null', "{$item ? $item.nom : '-'}"),
  'c-editeur1.mjs': POUSSE('e'),
  'c-mid-b.mjs':    NUL('<@c-petit-b items=!{$items}>\n'),
  'c-petit-b.mjs':  POUSSE('p'),
  'c-editeur3.mjs': enfant("  agir = -> $items[0].nom = 'E'", LONG),
  'c-editeur4.mjs': POUSSE('f'),
  'c-editeur5.mjs': enfant("  agir = -> $items[0].nom = 'F'", LONG),

  // les chaînes : l'enfant reçoit la liste par une prop simple et la lie plus loin — lien sur lien, petit-enfant qui la modifie dans une
  // boucle, lien sur lien avec une autre variable au bout, ligne d'un `{for}` liée par son rang (`item=!{$items[i]}`) : l'enfant est nommé,
  // avec celui qui modifie
  'rs-chaines.mjs': "<script>\n  $l1 = [{ nom: 'a' }]\n  $l2 = [{ nom: 'a' }]\n  $l3 = [{ nom: 'a' }]\n  $l4 = [{ nom: 'a' }]\n</script>\n\n<@c-m1 items={$l1}>\n<@c-mb items={$l2}>\n<@c-m1a items={$l3}>\n<@c-mfor items={$l4}>\n<p class=\"etat\">{$l1.length}|{$l2.length}|{$l3[0].nom}|{$l4[0].nom}</p>\n",
  'c-m1.mjs':      NUL('<@c-m2 items=!{$items}>\n'),
  'c-m2.mjs':      NUL('<@c-m3 items=!{$items}>\n'),
  'c-m3.mjs':      POUSSE('g'),
  'c-mb.mjs':      NUL('<@c-pb items=!{$items}>\n'),
  'c-pb.mjs':      enfant("  agir = ->\n    for x in [1, 2]\n      $items.push({ nom: 'b' + x })", LONG),
  'c-m1a.mjs':     NUL('<@c-m2a items=!{$items}>\n'),
  'c-m2a.mjs':     NUL('<@c-m3a items=!{$items}>\n'),
  'c-m3a.mjs':     enfant("  agir = ->\n    t = $items[0]\n    t.nom = 'Y'", LONG),
  'c-mfor.mjs':    NUL('{for i, r in $items}\n  <@c-row-lie item=!{$items[i]}>\n{end}\n'),
  'c-row-lie.mjs': enfant("  agir = -> $item.nom = 'R'", "{$item ? $item.nom : '-'}"),

  // une Map, un Set (une valeur lue puis gardée, `forEach`, `delete`, `clear`), `Object.defineProperties`, `Object.defineProperty` et
  // `Object.assign` sur un élément : chacun est dit
  'rs-justes.mjs': "<script>\n  $m1 = new Map([['a', { n: 0 }]])\n  $m2 = new Map([['a', { n: 0 }]])\n  $s1 = new Set([{ n: 0 }])\n  $m3 = new Map([['a', 1]])\n  $s2 = new Set([1, 2])\n  $o1 = { a: 0 }\n  $k1 = [{ nom: 'a' }]\n  $k2 = [{ nom: 'a' }]\n</script>\n\n<@c-mapalias m={$m1}>\n<@c-mapeach m={$m2}>\n<@c-seteach s={$s1}>\n<@c-mapdel m={$m3}>\n<@c-setclear s={$s2}>\n<@c-defs cfg={$o1}>\n<@c-defprof items={$k1}>\n<@c-assignprof items={$k2}>\n<p class=\"etat\">{$m1.get('a').n}|{$m2.get('a').n}|{[...$s1][0].n}|{$m3.size}|{$s2.size}|{$o1.a}|{$k1[0].nom}|{$k2[0].nom}</p>\n",
  'c-mapalias.mjs':   enfant("  agir = ->\n    v = $m.get('a')\n    v.n = 1", "{$m ? $m.get('a').n : '-'}"),
  'c-mapeach.mjs':    enfant('  agir = -> $m.forEach((v) -> v.n = 2)', "{$m ? $m.get('a').n : '-'}"),
  'c-seteach.mjs':    enfant('  agir = -> $s.forEach((o) -> o.n = 3)', "{$s ? [...$s][0].n : '-'}"),
  'c-mapdel.mjs':     enfant("  agir = -> $m.delete('a')", "{$m ? $m.size : '-'}"),
  'c-setclear.mjs':   enfant('  agir = -> $s.clear()', "{$s ? $s.size : '-'}"),
  'c-defs.mjs':       enfant('  agir = -> Object.defineProperties($cfg, { a: { value: 1, writable: true, enumerable: true, configurable: true } })', "{$cfg ? $cfg.a : '-'}"),
  'c-defprof.mjs':    enfant("  agir = -> Object.defineProperty($items[0], 'nom', { value: 'D', writable: true, enumerable: true, configurable: true })", LONG),
  'c-assignprof.mjs': enfant("  agir = -> Object.assign($items[0], { nom: 'A' })", LONG),

  // le magasin par des `{for}` imbriqués, ou par un chemin écrit en entier : chacun est dit ; une copie de l'enfant que le parent reprend
  // par un événement puis relâche (`$cfg = { a: 100 }`) : la copie revenue par la prop, modifiée ensuite par l'enfant, est dite
  'rs-sous.mjs': "<script>\n  $$cmds = [{ lignes: [{ n: 0 }] }]\n  $cfg   = { a: 0 }\n</script>\n\n{for p in $$cmds}\n  {for q in p.lignes}\n    <@c-st-sous item={q}>\n  {end}\n{end}\n<@c-st-sous2 item={$$cmds[0].lignes[0]}>\n<@c-reprise cfg={$cfg} @valide={$cfg = e.data} @lache={$cfg = { a: 100 }}>\n<p class=\"etat\">{$$cmds[0].lignes[0].n}|{$cfg.a}</p>\n",
  'c-st-sous.mjs':  enfant('  agir = -> $item.n = $item.n + 1', "{$item ? $item.n : '-'}"),
  'c-st-sous2.mjs': enfant('  agir = -> $item.n = $item.n + 10', "{$item ? $item.n : '-'}"),
  'c-reprise.mjs':  gardien("  $mien = null\n\n  prendre = ->\n    $mien = { ...$cfg }\n    $mien.a = 5\n    µemit 'valide', $mien\n  lacher = -> µemit 'lache'\n  agir   = -> $mien.a = $mien.a + 1", "{$mien ? $mien.a : '-'}-{$cfg ? $cfg.a : '-'}") + '<button class="z" type="button" @click={lacher()}>z</button>\n',

  // la ligne d'un `{for}` : liée par son rang au parent qui tient la liste, rien n'est dit ; passée par une prop simple, c'est dit, avec le
  // remède qui marche pour une ligne (un événement, ou une copie)
  'rs-rangs.mjs': "<script>\n  $rows  = [{ nom: 'a' }]\n  $rows2 = [{ nom: 'a' }]\n</script>\n\n{for i, r in $rows}\n  <@c-row-lie2 item=!{$rows[i]}>\n{end}\n{for r in $rows2}\n  <@c-row-simple item={r}>\n{end}\n<p class=\"etat\">{$rows[0].nom}|{$rows2[0].nom}</p>\n",
  'c-row-lie2.mjs':   enfant("  agir = -> $item.nom = 'L'", "{$item ? $item.nom : '-'}"),
  'c-row-simple.mjs': enfant("  agir = -> $item.nom = 'S'", "{$item ? $item.nom : '-'}"),

  // l'enfant lie à son propre enfant une copie de la liste reçue : en surface, elle partage ses éléments, et le petit-enfant qui en modifie
  // un le modifie pour l'enfant, qui est nommé ; profonde (`JSON.parse(JSON.stringify(…))`), elle est à l'enfant, rien n'est dit
  'rs-copieliee.mjs':  "<script>\n  $l5 = [{ nom: 'a' }]\n  $l6 = [{ nom: 'a' }]\n</script>\n\n<@c-copieliee items={$l5}>\n<@c-copiejson items={$l6}>\n<p class=\"etat\">{$l5[0].nom}|{$l6[0].nom}</p>\n",
  'c-copieliee.mjs':   "<script>\n  $copie = if $items then [...$items] else []\n</script>\n\n<p class=\"vu\">c</p>\n<@c-feuillelie items=!{$copie}>\n",
  'c-copiejson.mjs':   "<script>\n  $copie = if $items then JSON.parse(JSON.stringify($items)) else []\n</script>\n\n<p class=\"vu\">c</p>\n<@c-feuillejson items=!{$copie}>\n",
  'c-feuillelie.mjs':  enfant("  agir = -> $items[0].nom = 'F'", "{$items && $items[0] ? $items[0].nom : '-'}"),
  'c-feuillejson.mjs': enfant("  agir = -> $items[0].nom = 'J'", "{$items && $items[0] ? $items[0].nom : '-'}"),

  // une prop que le composant du milieu a reçue sans `!`, qu'il repasse à son enfant : la lier chez lui ne la lie pas à la page (qui suit pourtant, comme tout composant qui tient l'objet), le message
  // propose la copie ; reçue par une prop liée (`items=!{$l8}` chez la page), la lier chez lui est proposé
  'rs-mid.mjs':  "<script>\n  $l7 = [{ nom: 'a' }]\n  $l8 = [{ nom: 'a' }]\n</script>\n\n<@c-mid items={$l7}>\n<@c-mid2 items=!{$l8}>\n<p class=\"etat\">{$l7[0].nom}|{$l8[0].nom}</p>\n",
  'c-mid.mjs':   "<p class=\"vu\">m</p>\n<@c-bas items={$items}>\n",
  'c-mid2.mjs':  "<p class=\"vu\">m</p>\n<@c-bas2 items={$items}>\n",
  'c-bas.mjs':   enfant("  agir = -> $items[0].nom = 'B'", "{$items ? $items[0].nom : '-'}"),
  'c-bas2.mjs':  enfant("  agir = -> $items[0].nom = 'B'", "{$items ? $items[0].nom : '-'}"),
}
const BALISES = Object.keys(SOURCES).filter((f) => f.startsWith('rs-')).map((f) => 'mjs-' + f.replace('.mjs', ''))

type Langue = 'fr' | 'en'

// le texte attendu dans la console, en entier (chaque page en garde `SIGNES` signes, cf. `charger`) : un objet reçu modifié dit que l'écran
// suit quand l'écran du parent suit (`modif`, `modifL`), sinon que le parent n'en est pas prévenu (`modifN`) ; une scène compare
// qui modifie, par quelle prop, sous quel parent, et ce que montre l'écran
const SIGNES = 2000
const texte  = (langue: Langue, cle: 'propMutated' | 'propMutatedUnseen' | 'propMutatedBound' | 'propMutatedBoundUnseen' | 'propOneWay', vars: Record<string, string>) => {
  const modele = (RUNTIME_LABELS as any)[langue].dev[cle] ?? `(libellé dev.${cle} absent en ${langue})`
  return '[ModularJS] ' + modele.replace(/\{(\w+)\}/g, (m: string, n: string) => (n in vars ? vars[n] : m))
}
// l'objet modifié par l'enfant, ou par un enfant lié (`par`) ; la prop écrite
const modif   = (langue: Langue, tag: string, prop: string, parent: string) => texte(langue, 'propMutated', { tag, prop, parent })
const modifN  = (langue: Langue, tag: string, prop: string, parent: string) => texte(langue, 'propMutatedUnseen', { tag, prop, parent })
const modifL  = (langue: Langue, tag: string, par: string, prop: string, parent: string) => texte(langue, 'propMutatedBound', { tag, by: par, prop, parent })
const ecrit   = (langue: Langue, tag: string, prop: string) => texte(langue, 'propOneWay', { tag, prop })

// le bouton `bouton` du `n`-ième composant `enfant` de la page, dans l'ordre du document et à toute profondeur d'ombre, ou celui du parent
// (`enfant` vide)
const bouton = (balise: string, enfant: string, bouton: string, n: number) => `(() => {
  const tous = []
  const tour = (r) => { for (const e of r.querySelectorAll('*')) { tous.push(e); if (e._shadow) tour(e._shadow) } }
  tour(document)
  const hote = ${enfant ? `tous.filter((e) => e.localName === '${enfant}')[${n}]` : `document.querySelector('${balise}')`}
  return hote && hote._shadow && hote._shadow.querySelector('${bouton}')
})()`

// vrai clic de souris : le bouton amené au milieu de la fenêtre, la souris posée au centre de sa boîte, qui doit bien tomber sur lui — le
// navigateur vide les micro-tâches entre deux écouteurs d'un même clic, ce qu'un `el.click()` ne fait pas
const cliquer = async (page: any, balise: string, enfant: string, nom = '.x', n = 0) => {
  const b = bouton(balise, enfant, nom, n)
  await page.waitForFunction(`!!${b}`, null, { timeout: 3000 }).catch(() => { throw new Error(`bouton introuvable : ${enfant || balise} ${nom} #${n}`) })
  const p = await page.evaluate(`(() => {
    const e = ${b}
    e.scrollIntoView({ block: 'center' })
    const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2
    return { x, y, vise: e.getRootNode().elementFromPoint(x, y) === e }
  })()`)
  assert.ok(p.vise, `la souris ne tombe pas sur ${enfant || balise} ${nom} #${n}`)
  await page.mouse.click(p.x, p.y)
  await page.waitForTimeout(80)
}

// les lignes `.vu` des enfants, dans l'ordre de la page, puis la ligne `.etat` du parent
const vus = (page: any, balise: string): Promise<string[]> => page.evaluate(`(() => {
  const sh = document.querySelector('${balise}')._shadow
  const kids = Array.from(sh.querySelectorAll('*')).filter((c) => c.localName.startsWith('mjs-c-'))
  const etat = sh.querySelector('.etat')
  return kids.map((c) => c.localName.slice(4) + '=' + (c._shadow && c._shadow.querySelector('.vu') ? c._shadow.querySelector('.vu').textContent : '?')).concat(etat ? ['etat=' + etat.textContent] : [])
})()`)

// les avertissements « objet modifié » partis avec une pile d'appels (un objet `Error` après le message)
const ECOUTER_PILES = `(() => {
  window.__piles = []
  const w = console.warn
  console.warn = function (...a) {
    if (/ par sa prop « | through its prop "/.test(String(a[0]))) window.__piles.push(a[1] instanceof Error && /\\S/.test(a[1].stack || '') ? 'pile' : 'sans pile')
    return w.apply(this, a)
  }
})()`

type Scenario = { enfants: number, gestes: (page: any, b: string) => Promise<void>, avis: (l: Langue) => string[], vus: string[], piles?: number }

const SCENARIOS: Record<string, Scenario> = {
  'mjs-rs-modifie': {
    enfants: 8,
    gestes: async (p, b) => {
      await cliquer(p, b, 'mjs-c-pousse')
      await cliquer(p, b, 'mjs-c-pousse')
      for (const c of ['champ', 'inverse', 'alias', 'cle', 'retire', 'fonction', 'date']) await cliquer(p, b, 'mjs-c-' + c)
    },
    avis: (l) => [
      modif(l, '@c-pousse', 'items', '@rs-modifie'), modif(l, '@c-champ', 'items', '@rs-modifie'), modif(l, '@c-inverse', 'items', '@rs-modifie'),
      modifN(l, '@c-alias', 'items', '@rs-modifie'), modif(l, '@c-cle', 'cfg', '@rs-modifie'), modif(l, '@c-retire', 'cfg', '@rs-modifie'),
      modif(l, '@c-fonction', 'cfg', '@rs-modifie'), modif(l, '@c-date', 'jour', '@rs-modifie'),
    ],
    // le parent suit, comme tout composant qui tient l'objet : son affichage montre la modification
    vus: ['c-pousse=4', 'c-champ=Z', 'c-inverse=ba', 'c-alias=Y', 'c-cle=1', 'c-retire=a', 'c-fonction=5', 'c-date=2030', 'etat=4-Z-1'],
    piles: 8,
  },
  'mjs-rs-calme': {
    enfants: 5,
    gestes: async (p, b) => {
      await cliquer(p, b, '', '.p')
      for (const c of ['lie', 'mien', 'reaffecte', 'brut', 'magasin']) await cliquer(p, b, 'mjs-c-' + c)
    },
    // la réaffectation, par l'avertissement « écrit sa prop » ; le magasin modifié par la prop
    avis: (l) => [ecrit(l, '@c-reaffecte', 'items'), modifN(l, '@c-magasin', 'liste', '@rs-calme')],
    vus: ['c-lie=3', 'c-mien=1-3-9', 'c-reaffecte=2', 'c-brut=2', 'c-magasin=3', 'etat=3-3'],
  },
  'mjs-rs-liste': {
    enfants: 4,
    gestes: async (p, b) => {
      for (const n of [0, 1, 2]) await cliquer(p, b, 'mjs-c-ligne', '.x', n)
      await cliquer(p, b, 'mjs-c-boucle')
    },
    avis: (l) => [modif(l, '@c-ligne', 'item', '@rs-liste'), modif(l, '@c-boucle', 'items', '@rs-liste')],
    vus: ['c-ligne=1+', 'c-ligne=2+', 'c-ligne=3+', 'c-boucle=1'],
  },
  'mjs-rs-etale': {
    enfants: 2,
    gestes: async (p, b) => {
      await cliquer(p, b, 'mjs-c-etale')
      await cliquer(p, b, 'mjs-c-ecoute')
    },
    avis: (l) => [modif(l, '@c-etale', 'liste', '@rs-etale'), modif(l, '@c-ecoute', 'items', '@rs-etale')],
    vus: ['c-etale=3', 'c-ecoute=2', 'etat=1'],
  },
  'mjs-rs-copie': {
    enfants: 1,
    gestes: (p, b) => cliquer(p, b, 'mjs-c-copie'),
    avis: (l) => [modif(l, '@c-copie', 'items', '@rs-copie')],
    vus: ['c-copie=1', 'etat=K'],
  },
  'mjs-rs-milieu': {
    enfants: 1,
    gestes: async (p, b) => {
      await cliquer(p, b, 'mjs-c-milieu')
      await cliquer(p, b, 'mjs-c-milieu', '.y')
    },
    avis: () => [],
    vus: ['c-milieu=3', 'etat=2'],
  },
  'mjs-rs-emet': {
    enfants: 3,
    gestes: async (p, b) => {
      for (const c of ['emet', 'pousse-emet', 'emet-tard']) await cliquer(p, b, 'mjs-c-' + c)
      await p.waitForTimeout(100)
    },
    avis: (l) => [modif(l, '@c-pousse-emet', 'items', '@rs-emet')],
    vus: ['c-emet=2', 'c-pousse-emet=2', 'c-emet-tard=2', 'etat=2-2-2-1'],
  },
  'mjs-rs-attend': {
    enfants: 1,
    gestes: async (p, b) => {
      await cliquer(p, b, 'mjs-c-attend')
      await p.waitForTimeout(100)
    },
    avis: () => [],
    vus: ['c-attend=T', 'etat=T'],
  },
  'mjs-rs-rendu': {
    enfants: 1,
    gestes: async () => {},
    avis: (l) => [modif(l, '@c-rendu', 'map', '@rs-rendu')],
    vus: ['c-rendu=p'],
  },
  'mjs-rs-lache': {
    enfants: 5,
    gestes: async (p, b) => {
      const gardiens = ['garde', 'garde-copie', 'garde-lu', 'garde-sans', 'garde-pile']
      for (const c of gardiens) await cliquer(p, b, 'mjs-c-' + c, '.y')
      await cliquer(p, b, '', '.p')
      for (const c of gardiens) await cliquer(p, b, 'mjs-c-' + c)
    },
    avis: (l) => ['garde', 'garde-copie', 'garde-lu', 'garde-sans', 'garde-pile'].map((c) => (c === 'garde-lu' ? modif : modifN)(l, '@c-' + c, 'items', '@rs-lache')),
    vus: ['c-garde=Z-b', 'c-garde-copie=Z-b', 'c-garde-lu=Z-b', 'c-garde-sans=Z-Z', 'c-garde-pile=Z-b', 'etat=1|1|b|1|1|1'],
  },
  'mjs-rs-nonlu': {
    enfants: 4,
    gestes: async (p, b) => {
      for (const c of ['nonlu-mien', 'nonlu-prop', 'nonlu-filtre', 'nonlu-objet']) await cliquer(p, b, 'mjs-c-' + c)
    },
    // la liste filtrée et l'objet copié, rangés dans la prop, sont aussi dits par l'avertissement « écrit sa prop »
    avis: (l) => [
      modifN(l, '@c-nonlu-mien', 'items', '@rs-nonlu'), modifN(l, '@c-nonlu-prop', 'items', '@rs-nonlu'), modifN(l, '@c-nonlu-filtre', 'items', '@rs-nonlu'),
      ecrit(l, '@c-nonlu-filtre', 'items'), modifN(l, '@c-nonlu-objet', 'cfg', '@rs-nonlu'), ecrit(l, '@c-nonlu-objet', 'cfg'),
    ],
    vus: ['c-nonlu-mien=1-K', 'c-nonlu-prop=K', 'c-nonlu-filtre=1K', 'c-nonlu-objet=1', 'etat=1|1|2|o'],
  },
  'mjs-rs-rappel': {
    enfants: 1,
    gestes: (p, b) => cliquer(p, b, 'mjs-c-rappel'),
    avis: (l) => [modif(l, '@c-rappel', 'items', '@rs-rappel')],
    vus: ['c-rappel=2', 'etat=2'],
  },
  'mjs-rs-lache-simple': {
    enfants: 3,
    gestes: async (p, b) => {
      for (const c of ['tient-faux', 'tient-vide', 'tient-nul']) await cliquer(p, b, 'mjs-c-' + c, '.y')
      for (const [lacher, c] of [['.p', 'tient-faux'], ['.q', 'tient-vide'], ['.r', 'tient-nul']]) {
        await cliquer(p, b, '', lacher)
        await cliquer(p, b, 'mjs-c-' + c)
      }
    },
    avis: (l) => ['tient-faux', 'tient-vide', 'tient-nul'].map((c) => modif(l, '@c-' + c, 'obj', '@rs-lache-simple')),
    vus: ['c-tient-faux=1--', 'c-tient-vide=1--', 'c-tient-nul=1--', 'etat=non|non|non'],
  },
  'mjs-rs-freres': {
    enfants: 6,
    gestes: async (p, b) => {
      await cliquer(p, b, 'mjs-c-garde-un', '.y')
      for (const c of ['retire-un', 'garde-un', 'ajoute-un', 'dernier', 'emet-ajout', 'dernier-emis']) await cliquer(p, b, 'mjs-c-' + c)
    },
    avis: (l) => ['retire-un', 'garde-un', 'ajoute-un', 'dernier', 'dernier-emis'].map((c) => (c === 'retire-un' || c === 'ajoute-un' ? modif : modifN)(l, '@c-' + c, 'items', '@rs-freres')),
    vus: ['c-retire-un=1', 'c-garde-un=Z-b', 'c-ajoute-un=2', 'c-dernier=Q', 'c-emet-ajout=2', 'c-dernier-emis=Q', 'etat=1|2|2'],
  },
  'mjs-rs-derive': {
    enfants: 4,
    gestes: async (p, b) => {
      await cliquer(p, b, 'mjs-c-garde-derive', '.y')
      for (const c of ['cle-derive', 'champ-derive', 'brut-ligne']) await cliquer(p, b, 'mjs-c-' + c)
      await cliquer(p, b, '', '.p')
      await cliquer(p, b, 'mjs-c-garde-derive')
    },
    avis: (l) => [
      modifN(l, '@c-cle-derive', 'cfg', '@rs-derive'), modifN(l, '@c-champ-derive', 'items', '@rs-derive'), modifN(l, '@c-brut-ligne', 'item', '@rs-derive'),
      modifN(l, '@c-garde-derive', 'cfg', '@rs-derive'),
    ],
    vus: ['c-cle-derive=2', 'c-champ-derive=V', 'c-brut-ligne=R', 'c-garde-derive=9-2', 'etat=1|-|a|r|2'],
  },
  'mjs-rs-reel': {
    enfants: 2,
    gestes: async (p, b) => {
      await cliquer(p, b, 'mjs-c-reel')
      await cliquer(p, b, 'mjs-c-reel2')
    },
    avis: (l) => [modif(l, '@c-reel', 'items', '@rs-reel'), modif(l, '@c-reel2', 'items', '@rs-reel')],
    vus: ['c-reel=b', 'c-reel2=b', 'etat=b'],
  },
  'mjs-rs-micro': {
    enfants: 1,
    gestes: (p, b) => cliquer(p, b, 'mjs-c-micro'),
    avis: (l) => [modif(l, '@c-micro', 'items', '@rs-micro')],
    vus: ['c-micro=b', 'etat=b'],
  },
  'mjs-rs-then': {
    enfants: 1,
    gestes: (p, b) => cliquer(p, b, 'mjs-c-then'),
    avis: (l) => [modif(l, '@c-then', 'items', '@rs-then')],
    vus: ['c-then=b', 'etat=b'],
  },
  'mjs-rs-perime': {
    enfants: 1,
    gestes: async (p, b) => {
      await cliquer(p, b, 'mjs-c-perime', '.y')
      await cliquer(p, b, '', '.q')
      await cliquer(p, b, '', '.p')
      await cliquer(p, b, 'mjs-c-perime')
    },
    avis: (l) => [modif(l, '@c-perime', 'items', '@rs-perime')],
    vus: ['c-perime=Z-b', 'etat=b'],
  },
  'mjs-rs-deux': {
    enfants: 1,
    gestes: async (p, b) => {
      await cliquer(p, b, 'mjs-c-deux')
      await cliquer(p, b, 'mjs-c-deux', '.y')
    },
    avis: (l) => [modif(l, '@c-deux', 'sel', '@rs-deux')],
    vus: ['c-deux=aZS-aZS', 'etat=aZS'],
  },
  'mjs-rs-partage': {
    enfants: 4,
    gestes: async (p, b) => {
      await cliquer(p, b, 'mjs-c-stock-el')
      for (const n of [0, 1]) await cliquer(p, b, 'mjs-c-stock-ligne', '.x', n)
      await cliquer(p, b, 'mjs-c-etat')
    },
    // les lignes du magasin `$$` : le parent n'en est pas prévenu ; l'objet de `<@c-etat>`, que le parent lit par un `µ.state` qui le tient :
    // l'écran suit
    avis: (l) => [modifN(l, '@c-stock-el', 'item', '@rs-partage'), modifN(l, '@c-stock-ligne', 'item', '@rs-partage'), modif(l, '@c-etat', 'item', '@rs-partage')],
    vus: ['c-stock-el=2', 'c-stock-ligne=2', 'c-stock-ligne=1', 'c-etat=1', 'etat=2|1'],
  },
  'mjs-rs-parents': {
    enfants: 2,
    gestes: async (p, b) => {
      for (const n of [0, 1]) await cliquer(p, b, 'mjs-c-pousse', '.x', n)
    },
    avis: (l) => [modif(l, '@c-pousse', 'items', '@c-parent-a')],
    vus: ['c-parent-a=2', 'c-parent-b=2'],
  },
  'mjs-rs-neuf': {
    enfants: 4,
    gestes: async (p, b) => {
      for (const c of ['neuf', 'retour', 'brouillon', 'envoie-copie']) {
        await cliquer(p, b, 'mjs-c-' + c, '.y')
        await cliquer(p, b, 'mjs-c-' + c)
      }
    },
    avis: (l) => [modif(l, '@c-neuf', 'items', '@rs-neuf'), modif(l, '@c-retour', 'sel', '@rs-neuf'), modif(l, '@c-brouillon', 'cfg', '@rs-neuf')],
    // le parent suit : son affichage montre ce que l'enfant a écrit
    vus: ['c-neuf=a,m', 'c-retour=1-1', 'c-brouillon=6-6', 'c-envoie-copie=6-5', 'etat=a,m|1|6|5'],
    piles: 3,
  },
  'mjs-rs-define': {
    enfants: 1,
    gestes: (p, b) => cliquer(p, b, 'mjs-c-define'),
    avis: (l) => [modif(l, '@c-define', 'cfg', '@rs-define')],
    vus: ['c-define=1', 'etat=1'],
    piles: 1,
  },
  'mjs-rs-chaine': {
    enfants: 5,
    gestes: async (p, b) => {
      for (const c of ['lie', 'alias', 'nb', 'tout', 'ecoute']) await cliquer(p, b, 'mjs-c-petit-' + c)
    },
    avis: (l) => ['lie', 'alias', 'nb', 'ecoute'].map((c) => modifL(l, '@c-milieu-' + c, '@c-petit-' + c, 'items', '@rs-chaine')),
    // l'enfant suit l'écho de la liaison quand la liste elle-même a changé ; le parent, qui passe par une prop simple, suit aussi
    vus: ['c-milieu-lie=2', 'c-milieu-alias=1', 'c-milieu-nb=2', 'c-milieu-tout=2', 'c-milieu-ecoute=2', 'etat=2|Y|2|2|2'],
    piles: 4,
  },
  'mjs-rs-lie': {
    enfants: 4,
    gestes: async (p, b) => {
      for (const c of ['lie-prof', 'lie-pousse-fn', 'lie-fn', 'lie-alias']) await cliquer(p, b, 'mjs-c-' + c)
    },
    avis: () => [],
    // `regler($items[0])` et `t = $items[0]; t.nom = 'Y'` redessinent le parent lié comme `$items[0].sous.n = …` : il montre 1 et Y
    vus: ['c-lie-prof=1', 'c-lie-pousse-fn=2', 'c-lie-fn=1', 'c-lie-alias=Y', 'etat=1|2|1|Y'],
  },
  'mjs-rs-magasin': {
    enfants: 2,
    gestes: async (p, b) => {
      await cliquer(p, b, 'mjs-c-st-prop')
      await cliquer(p, b, 'mjs-c-st-ecrit')
    },
    avis: (l) => [modifN(l, '@c-st-prop', 'liste', '@rs-magasin')],
    vus: ['c-st-prop=2', 'c-st-ecrit=2', 'etat=1|2'],
  },
  'mjs-rs-voisins': {
    enfants: 10,
    gestes: async (p, b) => {
      for (const c of ['editeur1', 'petit-b', 'editeur3', 'editeur4', 'editeur5']) await cliquer(p, b, 'mjs-c-' + c)
    },
    avis: () => [],
    // la ligne `c-ligne5` tient l'objet (`item={r}`) dont l'éditeur lié écrit le champ (`$items[0].nom = 'F'`) : elle montre F, comme
    // l'éditeur et le parent — l'écriture fait avancer l'époque de l'objet écrit, que la ligne compare quand le parent le lui repose
    vus: ['c-resume1=2a', 'c-editeur1=2a', 'c-resume2=2a', 'c-mid-b=2a', 'c-resume3=1E', 'c-editeur3=1E', 'c-editeur4=2a', 'c-resume4=2a', 'c-ligne5=F', 'c-editeur5=1F', 'etat=2|2|E|2|F'],
  },
  'mjs-rs-chaines': {
    enfants: 4,
    gestes: async (p, b) => {
      for (const c of ['m3', 'pb', 'm3a', 'row-lie']) await cliquer(p, b, 'mjs-c-' + c)
    },
    avis: (l) => [['m1', 'm3'], ['mb', 'pb'], ['m1a', 'm3a'], ['mfor', 'row-lie']].map(([c, par]) => modifL(l, '@c-' + c, '@c-' + par, 'items', '@rs-chaines')),
    // le parent, qui passe par une prop simple, suit aussi ; l'enfant suit l'écho de la liaison quand la liste elle-même a changé,
    // et quand le petit-enfant lié écrit un objet de la liste par une autre variable (`t = $items[0]; t.nom = 'Y'`), comme sous l'écriture
    // directe `$items[0].nom = 'Y'` : c-m1a montre Y
    vus: ['c-m1=2a', 'c-mb=3a', 'c-m1a=1Y', 'c-mfor=1R', 'etat=2|3|Y|R'],
    piles: 4,
  },
  'mjs-rs-justes': {
    enfants: 8,
    gestes: async (p, b) => {
      for (const c of ['mapalias', 'mapeach', 'seteach', 'mapdel', 'setclear', 'defs', 'defprof', 'assignprof']) await cliquer(p, b, 'mjs-c-' + c)
    },
    avis: (l) => [['mapalias', 'm'], ['mapeach', 'm'], ['seteach', 's'], ['mapdel', 'm'], ['setclear', 's'], ['defs', 'cfg'], ['defprof', 'items'], ['assignprof', 'items']].map(([c, prop]) => modif(l, '@c-' + c, prop, '@rs-justes')),
    vus: ['c-mapalias=1', 'c-mapeach=2', 'c-seteach=3', 'c-mapdel=0', 'c-setclear=0', 'c-defs=1', 'c-defprof=1D', 'c-assignprof=1A', 'etat=1|2|3|0|0|1|D|A'],
  },
  'mjs-rs-sous': {
    enfants: 3,
    gestes: async (p, b) => {
      await cliquer(p, b, 'mjs-c-st-sous')
      await cliquer(p, b, 'mjs-c-st-sous2')
      for (const n of ['.y', '.z', '.x']) await cliquer(p, b, 'mjs-c-reprise', n)
    },
    avis: (l) => [modifN(l, '@c-st-sous', 'item', '@rs-sous'), modifN(l, '@c-st-sous2', 'item', '@rs-sous'), modif(l, '@c-reprise', 'cfg', '@rs-sous')],
    // le même objet du magasin, modifié par les deux enfants : ni le magasin ni l'autre enfant ne sont prévenus
    vus: ['c-st-sous=11', 'c-st-sous2=11', 'c-reprise=6-100', 'etat=0|100'],
  },
  'mjs-rs-rangs': {
    enfants: 2,
    gestes: async (p, b) => {
      await cliquer(p, b, 'mjs-c-row-simple')
      await cliquer(p, b, 'mjs-c-row-lie2')
    },
    avis: (l) => [modif(l, '@c-row-simple', 'item', '@rs-rangs')],
    // la ligne liée par son rang redessine le parent : l'objet de la liste est le même, et ceux qui le tiennent suivent
    vus: ['c-row-lie2=L', 'c-row-simple=S', 'etat=L|S'],
  },
  'mjs-rs-copieliee': {
    enfants: 2,
    gestes: async (p, b) => {
      await cliquer(p, b, 'mjs-c-feuillelie')
      await cliquer(p, b, 'mjs-c-feuillejson')
    },
    avis: (l) => [modifL(l, '@c-copieliee', '@c-feuillelie', 'items', '@rs-copieliee')],
    // l'objet de la page change sans qu'elle soit redessinée ; la copie profonde laisse le sien intact
    vus: ['c-copieliee=c', 'c-copiejson=c', 'etat=F|a'],
    piles: 1,
  },
  'mjs-rs-mid': {
    enfants: 2,
    gestes: async (p, b) => {
      await cliquer(p, b, 'mjs-c-bas')
      await cliquer(p, b, 'mjs-c-bas2')
    },
    avis: (l) => [modifN(l, '@c-bas', 'items', '@c-mid'), modifN(l, '@c-bas2', 'items', '@c-mid2')],
    vus: ['c-mid=m', 'c-mid2=m', 'etat=B|B'],
  },
}

// chaque moteur, en développement (parents définis avant leurs enfants, puis l'inverse) et en production
const NAVIGATEURS = ['chromium', 'firefox', 'webkit'] as const
const MODES_JOUES: Record<typeof NAVIGATEURS[number], Mode[]> = {
  chromium: ['dev-parents-avant', 'dev-enfants-avant', 'bundle', 'split'],
  firefox:  ['dev-parents-avant', 'dev-enfants-avant', 'bundle'],
  webkit:   ['dev-parents-avant', 'dev-enfants-avant', 'split'],
}
const PROD = (mode: Mode) => mode === 'bundle' || mode === 'split'

// une construction par mode, partagée par les navigateurs
const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}
// la même page, annoncée en anglais
const enAnglais = (c: Cible): Cible => ({ ...c, document: (b, v) => c.document(b, v).replace('<html lang="fr">', '<html lang="en">') })

// ce que la console a dit d'une prop reçue : un objet venu d'elle modifié (son texte entier, sans la pile d'appels qui le suit), ou la prop
// écrite
const nosAvis = (avis: string[]) => avis.filter((a) => / par sa prop « | through its prop "|écrit sa prop|writes its prop/.test(a)).map((a) => a.replace(/(\(04-props\.md\)\.)[\s\S]*$/, '$1')).sort()

const jouerScenario = async (browser: any, c: Cible, mode: Mode, balise: string, langue: Langue) => {
  const o = await charger(browser, c, balise, '', SIGNES)
  try {
    const s = SCENARIOS[balise]
    await o.page.evaluate(ECOUTER_PILES)
    await attendre(o.page, balise, s.enfants)
    await s.gestes(o.page, balise)
    await o.page.waitForTimeout(150)
    assert.deepEqual(await vus(o.page, balise), s.vus, 'ce que montre la page')
    assert.deepEqual(nosAvis(o.avis), PROD(mode) ? [] : s.avis(langue).sort(), 'les avertissements dits')
    if (s.piles && !PROD(mode)) assert.deepEqual(await o.page.evaluate('window.__piles'), Array(s.piles).fill('pile'), 'chaque avertissement porte la pile d\'appels de la modification')
    assert.deepEqual(graves(o), [], 'aucune erreur')
  } finally {
    await o.fermer()
  }
}

for (const nav of NAVIGATEURS) for (const mode of MODES_JOUES[nav]) playTogether(describe(`avertissement du développement : objet reçu par une prop à sens unique, modifié par l'enfant (${mode}, ${nav} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) { console.log(`  ℹ️  ${nav} non installé, test de l'avertissement sauté. Activer : \`npx playwright install ${nav}\``); return }
    browser = await playwright[nav].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const balise of BALISES) it(`${balise.slice(7)} : ${PROD(mode) ? 'rien n\'est dit, la page se comporte de même' : 'dit une fois par composant et par prop, dans les bons cas seulement'}`, async function () {
    if (!present) { this.skip(); return }
    await jouerScenario(browser, await cible(mode), mode, balise, 'fr')
  })

  if (nav === 'chromium' && mode === 'dev-parents-avant') it('modifie : en anglais, page annoncée en « en »', async function () {
    if (!present) { this.skip(); return }
    await jouerScenario(browser, enAnglais(await cible(mode)), mode, 'mjs-rs-modifie', 'en')
  })
}))

// le coût : 1 000 lignes, chacune un enfant qui modifie l'objet reçu — tenu par le parent (`item={r}`) ou fait pour la ligne (`item={neuf(r)}`)
const SOURCES_MILLE: Record<string, string> = {
  'rs-mille.mjs': "<script>\n  $rows = Array.from({ length: 1000 }, (_, i) -> ({ id: i, n: 0 }))\n</script>\n\n{for r in $rows}\n  <@c-mille item={r}>\n{end}\n",
  'rs-frais.mjs': "<script>\n  $rows = Array.from({ length: 1000 }, (_, i) -> ({ id: i, n: 0 }))\n  neuf  = (r) -> ({ id: r.id, n: 0 })\n</script>\n\n{for r in $rows}\n  <@c-mille item={neuf(r)}>\n{end}\n",
  'c-mille.mjs':  enfant('  agir = -> $item.n = $item.n + 1', "{$item ? $item.id : '-'}-{$item ? $item.n : 0}"),
  // le pire cas d'hier : un parent de 10 000 lignes, changé avant chaque modification que l'enfant fait dans sa propre copie de la liste reçue
  'rs-pire.mjs': "<script>\n  $rows = Array.from({ length: 10000 }, (_, i) -> ({ id: i, n: 0, t: { v: i } }))\n  $sous = [{ id: -1, n: 0 }]\n\n  toucher = -> $rows[0].n = $rows[0].n + 1\n</script>\n\n<@c-pire items={$sous}>\n<button class=\"p\" type=\"button\" @click={toucher()}>p</button>\n",
  'c-pire.mjs':  gardien("  prendre = -> $items = [...$items]\n  agir    = -> $items.push(0)", "{$items ? $items.length : '-'}"),
}
const BALISES_MILLE = ['mjs-rs-mille', 'mjs-rs-frais', 'mjs-rs-pire']

// chaque parcours du registre des composants (`µ.instances`), et chaque parcours de l'état du parent (ses clés énumérées), comptés dans la page
const COMPTER_PARCOURS = (balise: string) => `(() => {
  const reg = µ.instances
  window.__parcours = 0
  for (const m of [Symbol.iterator, 'forEach', 'values', 'keys', 'entries']) {
    const f = reg[m]
    reg[m] = function () { window.__parcours++; return f.apply(this, arguments) }
  }
  const h = document.querySelector('${balise}')
  window.__etat = 0
  h._state = new Proxy(h._state, { ownKeys(t) { window.__etat++; return Reflect.ownKeys(t) } })
})()`
// les 1 000 enfants de la page montés et rendus, puis un clic du script sur le bouton `bouton` de chacun (mille vrais clics ne
// mesureraient que la souris), et l'image suivante
const MONTES = (balise: string, enfant: string) => `(() => { const k = document.querySelector('${balise}')?._shadow?.querySelectorAll('${enfant}'); return !!k && k.length === 1000 && Array.from(k).every((e) => e._shadow && e._shadow.querySelector('.vu')) })()`
const CLIC_CHACUN = (balise: string, enfant: string, bouton: string) => `(async () => {
  for (const e of document.querySelector('${balise}')._shadow.querySelectorAll('${enfant}')) e._shadow.querySelector('${bouton}').click()
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
})()`

describe('avertissement du développement, objet reçu modifié : le coût d\'une modification ne dépend ni du nombre de composants ni de l\'état du parent (chromium réel)', function () {
  this.timeout(180000)
  let browser: any = null
  let present = false
  let mille: Promise<Cible> | null = null

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test du coût sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const [balise, parent] of [['mjs-rs-mille', '@rs-mille'], ['mjs-rs-frais', '@rs-frais']]) it(`${balise.slice(7)} : 1 000 modifications, 1 000 composants, un avertissement, ni le registre des composants ni l'état du parent parcourus`, async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await (mille ??= construire('dev-parents-avant', SOURCES_MILLE, BALISES_MILLE)), balise, '', SIGNES)
    try {
      await o.page.waitForFunction(MONTES(balise, 'mjs-c-mille'), null, { timeout: 30000 })
      await o.page.evaluate(COMPTER_PARCOURS(balise))
      await o.page.evaluate(CLIC_CHACUN(balise, 'mjs-c-mille', '.x'))
      const fin = await o.page.evaluate(`document.querySelector('${balise}')._shadow.querySelectorAll('mjs-c-mille')[999]._shadow.querySelector('.vu').textContent`)
      assert.equal(fin, '999-1', 'la dernière ligne a reçu sa modification')
      assert.equal(await o.page.evaluate('window.__parcours'), 0, 'parcours du registre des composants pendant les 1 000 modifications')
      assert.equal(await o.page.evaluate('window.__etat'), 0, 'parcours de l\'état du parent pendant les 1 000 modifications')
      // `<@rs-frais>` fabrique l'objet pour l'enfant (`neuf(r)`) : il ne le tient pas, il n'en est pas prévenu
      assert.deepEqual(nosAvis(o.avis), [(parent === '@rs-frais' ? modifN : modif)('fr', '@c-mille', 'item', parent)], 'les avertissements dits')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })

  it('pire : le parent de 10 000 lignes change avant chaque modification de l\'enfant dans sa copie, son état n\'est jamais parcouru', async function () {
    if (!present) { this.skip(); return }
    const balise = 'mjs-rs-pire'
    const enf    = `document.querySelector('${balise}')._shadow.querySelector('mjs-c-pire')`
    const tour   = `const p = document.querySelector('${balise}')._shadow.querySelector('.p'), x = ${enf}._shadow.querySelector('.x')`
    const o      = await charger(browser, await (mille ??= construire('dev-parents-avant', SOURCES_MILLE, BALISES_MILLE)), balise, '', SIGNES)
    try {
      await o.page.waitForFunction(`!!(${enf} && ${enf}._shadow && ${enf}._shadow.querySelector('.vu'))`, null, { timeout: 30000 })
      await o.page.evaluate(`${enf}._shadow.querySelector('.y').click()`)
      await o.page.evaluate(COMPTER_PARCOURS(balise))
      // 100 modifications dans le même tour, puis 5 tours d'une modification chacun
      await o.page.evaluate(`(() => { ${tour}; for (let i = 0; i < 100; i++) { p.click(); x.click() } })()`)
      await o.page.evaluate(`(async () => { ${tour}; for (let i = 0; i < 5; i++) { p.click(); x.click(); await new Promise((r) => setTimeout(r, 0)) } })()`)
      await o.page.waitForTimeout(100)
      assert.equal(await o.page.evaluate(`${enf}._shadow.querySelector('.vu').textContent`), '106', 'la copie de l\'enfant a reçu ses 105 modifications')
      assert.equal(await o.page.evaluate('window.__etat'), 0, 'parcours de l\'état du parent')
      assert.equal(await o.page.evaluate('window.__parcours'), 0, 'parcours du registre des composants')
      assert.deepEqual(nosAvis(o.avis), [], 'les avertissements dits')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })
})

// le coût de la lecture : un enfant lit par son enveloppe la liste reçue de 1 000 lignes sur deux niveaux (`p[i].t.v`), une première fois
// (ses enveloppes se créent), puis une tâche plus tard (elles se relisent) ; chaque lecture compte ses recherches dans une table faible
// le parent porte une valeur dérivée (`$double`, qui ne lit pas la liste) : sans valeur dérivée, la production retire du cœur le registre
// des détenteurs de la précision (objet tenu par un autre composant → horloge), que le développement garde toujours, soit deux recherches
// de plus par enveloppe neuve ; avec elle, les deux builds le portent et la mesure ne compte que l'avertissement des objets reçus
const SOURCES_LECTURE: Record<string, string> = {
  'rs-lecture.mjs': "<script>\n  $rows   = Array.from({ length: 1000 }, (_, i) -> ({ id: i, t: { v: i } }))\n  $n      = 1\n  $double = $n * 2\n</script>\n\n<p class=\"double\">{$double}</p>\n<@c-lit rows={$rows}>\n",
  'c-lit.mjs':      "<p class=\"vu\">{$rows ? $rows.length : '-'}</p>\n",
}
const COMPTER_LECTURES = `(async () => {
  const c = document.querySelector('mjs-rs-lecture')._shadow.querySelector('mjs-c-lit')
  const p = c._state.rows
  const W = WeakMap.prototype, S = WeakSet.prototype, n = { v: 0 }
  const propres = [W.get, W.has, W.set, S.has, S.add]
  const lire = () => { n.v = 0; let s = 0; for (let i = 0; i < p.length; i++) s += p[i].t.v; return [s, n.v] }
  ;[W.get, W.has, W.set, S.has, S.add] = propres.map((f) => function () { n.v++; return f.apply(this, arguments) })
  try {
    const premiere = lire()
    await new Promise((r) => setTimeout(r, 0))
    const seconde = lire()
    return { somme: premiere[0], premiere: premiere[1], seconde: seconde[1] }
  }
  finally {
    ;[W.get, W.has, W.set, S.has, S.add] = propres
  }
})()`

for (const nav of ['chromium', 'firefox'] as const) playTogether(describe(`avertissement du développement, objet reçu modifié : lire une liste reçue ne coûte pas plus qu'en production (${nav} réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false
  const lecture = new Map<Mode, Promise<Cible>>()

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) { console.log(`  ℹ️  ${nav} non installé, test du coût de la lecture sauté. Activer : \`npx playwright install ${nav}\``); return }
    browser = await playwright[nav].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('1 000 lignes lues sur deux niveaux, puis relues : autant de recherches dans les tables faibles en développement qu\'en production', async function () {
    if (!present) { this.skip(); return }
    const compte: Record<string, any> = {}
    for (const mode of ['dev-parents-avant', 'bundle'] as Mode[]) {
      if (!lecture.has(mode)) lecture.set(mode, construire(mode, SOURCES_LECTURE, ['mjs-rs-lecture']))
      const o = await charger(browser, await lecture.get(mode)!, 'mjs-rs-lecture')
      try {
        await o.page.waitForFunction(`(() => { const k = document.querySelector('mjs-rs-lecture')?._shadow?.querySelector('mjs-c-lit'); return !!(k && k._shadow && k._shadow.querySelector('.vu') && k._shadow.querySelector('.vu').textContent === '1000') })()`, null, { timeout: 20000 })
        compte[mode] = await o.page.evaluate(COMPTER_LECTURES)
        assert.deepEqual(graves(o), [], 'aucune erreur')
      } finally {
        await o.fermer()
      }
    }
    assert.equal(compte.bundle.somme, 499500, 'la production lit toute la liste')
    assert.deepEqual(compte['dev-parents-avant'], compte.bundle, 'recherches dans les tables faibles : développement contre production')
  })
}))

// les fichiers d'une sortie, lus en texte
const lireTout = (dossier: string): string[] => readdirSync(dossier, { recursive: true }).map(String).filter((f) => /\.(js|json|html)$/.test(f)).map((f) => readFileSync(join(dossier, f), 'utf-8'))

describe('avertissement du développement, objet reçu modifié : absent de la production', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  // des morceaux sans accent ni variable du texte : une sortie qui échappe les accents les montre tels quels
  const MORCEAUX = ['lui a passé par sa prop', 'passed to it through its prop']

  it('le développement porte le texte, en français et en anglais', async () => {
    const dev  = await cible('dev-parents-avant')
    const tout = [...lireTout(join(dev.racine, 'out')), readFileSync(join(dev.racine, 'bundle.js'), 'utf-8')].join('\n')
    for (const m of MORCEAUX) assert.ok(tout.includes(m), `développement : « ${m} » attendu`)
  })

  for (const mode of ['bundle', 'split'] as const) it(`production (${mode}) : ni le texte, ni sa clé, dans aucun fichier envoyé`, async () => {
    const prod     = await cible(mode)
    const fichiers = lireTout(join(prod.racine, 'out'))
    assert.ok(fichiers.length > 1 && fichiers.join('').includes('rs-modifie'), 'la sortie de production est lue')
    for (const m of [...MORCEAUX, 'propMutated', '_mjs_oneWay', '_mjs_twoWay']) assert.ok(!fichiers.some((f) => f.includes(m)), `production : « ${m} » présent`)
  })
})

describe('avertissement du développement, objet reçu modifié : le libellé', () => {
  const dev = (langue: Langue) => (RUNTIME_LABELS as any)[langue].dev
  // ce que dit chaque libellé : le composant, la prop et le parent, puis le fait, au vouvoiement, et le renvoi à la documentation. Avec
  // l'enveloppe, l'écran suit : le libellé dit seulement la manière à préférer (un événement, une méthode du parent), jamais que le parent
  // n'est pas prévenu ; sans elle (`proxy: false`), il dit que le parent n'est pas prévenu et comment faire suivre son écran (µrefresh)
  const DOC = { fr: 'Lisez « Modifier un objet reçu » dans la documentation des props (04-props.md).', en: 'See the section on modifying a received object in the props documentation (04-props.md).' }
  const SUIT = { fr: ['l\'écran suit', 'par un événement ou par une de ses méthodes', DOC.fr], en: ['the screen follows', 'through an event or one of its methods', DOC.en] }
  const SANS = { fr: ['<{parent}> n\'en est pas prévenu', 'par un événement', 'µrefresh', DOC.fr], en: ['<{parent}> is not notified', 'through an event', 'µrefresh', DOC.en] }
  const SEUL = { fr: '<{tag}> modifie un objet que <{parent}> lui a passé par sa prop « {prop} »', en: '<{tag}> modifies an object that <{parent}> passed to it through its prop "{prop}"' }
  const LIE  = { fr: '<{by}>, lié à <{tag}>, modifie un objet que <{parent}> a passé à <{tag}> par sa prop « {prop} »', en: '<{by}>, bound to <{tag}>, modifies an object that <{parent}> passed to <{tag}> through its prop "{prop}"' }
  const ATTENDU: Record<string, Record<Langue, string[]>> = {
    propMutated:             { fr: [SEUL.fr, ...SUIT.fr], en: [SEUL.en, ...SUIT.en] },
    propMutatedBound:        { fr: [LIE.fr, ...SUIT.fr], en: [LIE.en, ...SUIT.en] },
    propMutatedNoProxy:      { fr: [SEUL.fr, ...SANS.fr], en: [SEUL.en, ...SANS.en] },
    propMutatedBoundNoProxy: { fr: [LIE.fr, ...SANS.fr], en: [LIE.en, ...SANS.en] },
    propMutatedUnseen:       { fr: [SEUL.fr, '<{parent}> n\'en est pas prévenu', DOC.fr], en: [SEUL.en, '<{parent}> is not notified', DOC.en] },
    propMutatedBoundUnseen:  { fr: [LIE.fr, '<{parent}> n\'en est pas prévenu', DOC.fr], en: [LIE.en, '<{parent}> is not notified', DOC.en] },
  }

  for (const cle of Object.keys(ATTENDU)) it(`${cle} : nomme le composant, la prop et le parent, dit ce que fait l'écran et la manière à préférer, et renvoie à la documentation (français et anglais)`, () => {
    for (const langue of ['fr', 'en'] as const) {
      const t = dev(langue)[cle]
      assert.ok(typeof t === 'string', `${langue} : libellé dev.${cle} absent`)
      for (const v of ATTENDU[cle][langue]) assert.ok(t.includes(v), `${langue} : « ${v} » attendu dans « ${t} »`)
      if (!/NoProxy$|Unseen$/.test(cle)) for (const r of ['n\'en est pas prévenu', 'is not notified', 'µrefresh']) assert.ok(!t.includes(r), `${langue} : dev.${cle} ne dit pas que le parent n'est pas prévenu (« ${r} »)`)
    }
    assert.match(dev('fr')[cle], /\bvous\b|\bvotre\b|\bvos\b|Lisez/, 'fr : au vouvoiement')
  })
})

// les exemples que la documentation donne du principe sûr (« Modifier un objet reçu », 04-props.md), joués tels qu'elle les écrit : plus rien
// n'est dit, et l'écran du parent comme celui de l'enfant montrent la modification — la ligne d'un `{for}` qui la demande par un événement,
// le gestionnaire de la page qui la fait ; le magasin lu et écrit par `$$` ; la variable de la page prêtée par une prop liée, écrite
// directement par elle
const SOURCES_EXEMPLES: Record<string, string> = {
  'ex-evenement.mjs': "<script>\n  $rows = [{ nom: 'a' }]\n</script>\n\n{for r in $rows}\n  <@c-ex-ligne item={r} @renomme={r.nom = e.data}>\n{end}\n<p class=\"etat\">{$rows[0].nom}</p>\n",
  'c-ex-ligne.mjs':   enfant("  agir = -> µemit 'renomme', 'Z'", "{$item ? $item.nom : '-'}"),
  'ex-magasin.mjs':   "<script>\n  $$panierx = [1]\n</script>\n\n<@c-ex-panier>\n<p class=\"etat\">{$$panierx.length}</p>\n",
  'c-ex-panier.mjs':  enfant('  agir = -> $$panierx.push(2)', '{$$panierx.length}'),
  'ex-lier.mjs':      "<script>\n  $items = [{ nom: 'a' }]\n</script>\n\n<@c-ex-lier items=!{$items}>\n<p class=\"etat\">{$items[0].nom}</p>\n",
  'c-ex-lier.mjs':    enfant("  agir = -> $items[0].nom = 'Z'", "{$items ? $items[0].nom : '-'}"),
}
const EXEMPLES: Record<string, { gestes: (page: any, b: string) => Promise<void>, ecrans: string[] }> = {
  'mjs-ex-evenement': { gestes: (p, b) => cliquer(p, b, 'mjs-c-ex-ligne'), ecrans: ['c-ex-ligne=Z', 'etat=Z'] },
  'mjs-ex-magasin':   { gestes: (p, b) => cliquer(p, b, 'mjs-c-ex-panier'), ecrans: ['c-ex-panier=2', 'etat=2'] },
  'mjs-ex-lier':      { gestes: (p, b) => cliquer(p, b, 'mjs-c-ex-lier'), ecrans: ['c-ex-lier=Z', 'etat=Z'] },
}
// les lignes `.vu` de tous les composants de la page, à toute profondeur d'ombre, dans l'ordre du document, puis la ligne `.etat` du parent
const ECRANS = (balise: string) => `(() => {
  const out = []
  const tour = (r) => { for (const e of r.querySelectorAll('*')) { if (e.localName.startsWith('mjs-c-')) out.push(e.localName.slice(4) + '=' + (e._shadow && e._shadow.querySelector('.vu') ? e._shadow.querySelector('.vu').textContent : '?')); if (e._shadow) tour(e._shadow) } }
  const h = document.querySelector('${balise}')
  tour(h._shadow)
  const etat = h._shadow.querySelector('.etat')
  return out.concat(etat ? ['etat=' + etat.textContent] : [])
})()`
let exemples: Promise<Cible> | null = null

for (const nav of NAVIGATEURS) playTogether(describe(`avertissement du développement, objet reçu modifié : les exemples de la documentation, joués, montrent la modification partout et ne font rien dire (dev-parents-avant, ${nav} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) { console.log(`  ℹ️  ${nav} non installé, test des exemples sauté. Activer : \`npx playwright install ${nav}\``); return }
    browser = await playwright[nav].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const balise of Object.keys(EXEMPLES)) it(`${balise.slice(7)} : écrans du parent et de l'enfant justes, rien n'est dit`, async function () {
    if (!present) { this.skip(); return }
    const x = EXEMPLES[balise]
    const o = await charger(browser, await (exemples ??= construire('dev-parents-avant', SOURCES_EXEMPLES, Object.keys(EXEMPLES))), balise)
    try {
      await attendre(o.page, balise, 1)
      await x.gestes(o.page, balise)
      await o.page.waitForTimeout(150)
      assert.deepEqual(await o.page.evaluate(ECRANS(balise)), x.ecrans, 'ce que montrent le parent et son enfant')
      assert.deepEqual(nosAvis(o.avis), [], 'les avertissements dits')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })
}))
