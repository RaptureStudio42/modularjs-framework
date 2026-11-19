// Un objet de l'état tenu à plusieurs endroits (deux lignes, un parent et ses enfants, deux variables, un magasin, une `Map`)
// et écrit par un détour (une autre variable, un enfant, la variable d'une boucle, un élément trouvé) : chaque affichage
// de l'objet montre la valeur écrite, comme après l'écriture par le chemin direct. Chaque cas a son témoin, la forme
// directe, qui suit déjà. Développement et production ; sans enveloppe (`"proxy": false`), MJS ne voit que les chemins
// compilés : y jouent la ligne choisie puis écrite, l'avertissement et les témoins. Cœur construit, monté dans happy-dom
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
const SOURCES: Record<string, string> = {
  // enfants
  'zd-cat':      js(['$item = null;'], "<em>{$item ? $item.cat.nom : 'nul'}</em>"),
  'zd-nom':      js(['$item = null;'], "<em>{$item ? $item.nom : 'nul'}</em>"),
  'zd-lab':      js(['$item = null;'], "<em>{$item ? $item.label : 'nul'}</em>"),
  'zd-vu':       js(['$item = null;'], "<em>{$item ? $item.n : 'nul'}</em>"),
  'zd-ec':       js(['$item = null;', "@ecrire = function(v) { $item.n = 'E' + v; };"], "<em>{$item ? $item.n : 'nul'}</em>"),
  'zd-ecx':      js(['$item = null;', '@ecrire = function(v) { $item.x.c = v; };'], "<em>{$item ? $item.x.c : 'nul'}</em>"),
  'zd-adr':      js(['$item = null;'], "<em>{$item ? $item.adresse.ville : 'nul'}</em>"),
  'zd-liste':    js(['$rows = [];'], '{for r in $rows by id}<em>{r.label}</em>{end}'),
  // un objet commun à deux lignes, rangé aussi dans une autre variable ; les enfants tiennent les lignes
  'zd-commun':   js(["const chat = { nom: 'a' };", '$cats = [chat];', '$rows = [{ id: 1, cat: chat }, { id: 2, cat: chat }];', "@parAutre = function(v) { $cats[0].nom = 'A' + v; };", "@direct = function(v) { $rows[0].cat.nom = 'D' + v; };"], '{for r in $rows by id}<@zd-cat item={r}></@zd-cat>{end}'),
  'zd-commun-o': js(["const chat = { nom: 'a' };", '$cats = [chat];', '$rows = [{ id: 1, cat: chat }, { id: 2, cat: chat }];', "@parAutre = function(v) { $cats[0].nom = 'A' + v; };", "@direct = function(v) { $rows[0].cat.nom = 'D' + v; };"], '{for r in $rows by id}<@zd-nom item={r.cat}></@zd-nom>{end}'),
  // le même objet, tenu par deux enfants qui le reçoivent du même chemin
  'zd-enfant':   js(["$o = { a: { n: 'a' } };", "@direct = function(v) { $o.a.n = 'P' + v; };"], '<b>{$o.a.n}</b><@zd-ec item={$o.a}></@zd-ec><@zd-vu item={$o.a}></@zd-vu>'),
  // une ligne choisie dans une autre variable puis écrite par elle
  'zd-choisie':  js(["$rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];", '$sel = null;', '@choisir = function() { $sel = $rows[1]; };', "@ecrire = function(v) { $sel.label = 'S' + v; };", "@direct = function(v) { $rows[1].label = 'D' + v; };"], "{for r in $rows by id}<@zd-lab item={r}></@zd-lab><i>{r.label}</i>{end}<@zd-lab item={$sel}></@zd-lab><b>{$sel ? $sel.label : 'nul'}</b>"),
  // une ligne trouvée par une méthode de la liste, rangée dans une autre variable puis écrite par elle
  'zd-trouvee':  js(["$rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];", '$sel = null;', '@trouver = function() { $sel = $rows.find((r) => r.id === 2); };', "@ecrire = function(v) { $sel.label = 'S' + v; };"], "{for r in $rows by id}<@zd-lab item={r}></@zd-lab><i>{r.label}</i>{end}<@zd-lab item={$sel}></@zd-lab><b>{$sel ? $sel.label : 'nul'}</b>"),
  // une ligne prise en tête du script (valeur dérivée), puis écrite par elle ; deux noms en chaîne, écrits par le second
  'zd-tete':     js(["$rows = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }];", '$sel = $rows[1];', "@ecrire = function(v) { $sel.label = 'S' + v; };"], "{for r in $rows by id}<@zd-lab item={r}></@zd-lab><i>{r.label}</i>{end}<@zd-lab item={$sel}></@zd-lab>"),
  'zd-chaine':   js(["$rows = [{ id: 1, sub: { n: 'a' } }];", '$a = null;', '$b = null;', '@prendre = function() { $a = $rows[0]; $b = $a.sub; };', "@ecrire = function(v) { $b.n = 'C' + v; };"], '{for r in $rows by id}<i>{r.sub.n}</i>{end}<b>{$b && $b.n}</b>'),
  // le même objet dans deux lignes, écrit par le composant de l'une
  'zd-deux':     js(["const o = { n: 'a' };", '$rows = [o, o];', "@direct = function(v) { $rows[0].n = 'D' + v; };"], '{for r in $rows}<@zd-ec item={r}></@zd-ec>{end}<b>{$rows[1].n}</b>'),
  // une ligne écrite plus bas par son propre composant
  'zd-propre':   js(['$rows = [{ id: 1, x: { c: 0 } }, { id: 2, x: { c: 0 } }];', '@direct = function(v) { $rows[1].x.c = v; };'], '{for r in $rows by id}<@zd-ecx item={r}></@zd-ecx><i>{r.x.c}</i>{end}'),
  // magasin écrit par la variable d'une boucle, par un élément trouvé, par le chemin
  'zd-magasin':  js(["$$zdliste = [{ id: 1, adresse: { ville: 'a' } }, { id: 2, adresse: { ville: 'b' } }];", "@parBoucle = function(v) { for (const t of $$zdliste) if (t.id === 2) t.adresse.ville = 'B' + v; };", "@parTrouve = function(v) { $$zdliste.find((t) => t.id === 2).adresse.ville = 'T' + v; };", "@direct = function(v) { $$zdliste[1].adresse.ville = 'D' + v; };"], '{for t in $$zdliste by id}<@zd-adr item={t}></@zd-adr><i>{t.adresse.ville}</i>{end}'),
  // liste brute changée sur place puis µrefresh : affichée par un enfant et par le composant
  'zd-brute':    js(["$lignes = µraw([{ id: 1, label: 'a' }, { id: 2, label: 'b' }], true);", "@changer = function(v) { $lignes[1].label = 'R' + v; µrefresh($lignes); };"], '<@zd-liste rows={$lignes}></@zd-liste>{for r in $lignes by id}<b>{r.label}</b>{end}'),
  // magasin dérivé de `µ.Store` dont la donnée est rangée dans un champ `state`, tenu par une variable ordinaire, ou par une variable `$`
  'zd-store':    js(['class Panier extends µ.Store { constructor() { super(); this.state = { rows: [{ id: 1, n: 1 }, { id: 2, n: 2 }] }; } }', 'const p = new Panier();', '@ecrire = function(v) { p.state.rows[1].n = v; };'], '{for r in p.state.rows by id}<i>{r.n}</i>{end}'),
  'zd-store-d':  js(['const q = new µ.Store({ rows: [{ id: 1, n: 1 }, { id: 2, n: 2 }] });', '@ecrire = function(v) { q.data.rows[1].n = v; };'], '{for r in q.data.rows by id}<i>{r.n}</i>{end}'),
  // une `Map` dont la clé est l'enveloppe d'un autre composant, lue par une valeur dérivée
  'zd-carte-a':  js(["const k0 = { nom: 'a' };", '$rows = [k0];', 'const m = new Map([[$rows[0], 1]]);', 'window.__zdPartage = m;', '$m = m;', '@wa = function(x) { $rows[0].nom = x; };'], '<p>{$rows[0].nom}</p>'),
  'zd-carte-b':  js(['$m = window.__zdPartage;', "$form = { q: '' };", "$v = [...$m.keys()].map((x) => x.nom).join(',');", '@w = function(x) { $form.q = x; };', '@wb = function(x) { for (const k of $m.keys()) k.nom = x; };'], '<p class="v">{$v}</p><p class="q">{$form.q}</p>'),
  // la ligne d'un état partagé ou d'un `µ.Store`, lue par le composant, tenue et écrite par un enfant
  'zd-etat':     js(["const st = µ.state({ rows: [{ id: 1, n: 'a' }] });"], '{for r in st.rows by id}<@zd-ec item={r}></@zd-ec><i>{r.n}</i>{end}'),
  'zd-classe':   js(["const q = new µ.Store({ rows: [{ id: 1, n: 'a' }] });"], '{for r in q.data.rows by id}<@zd-ec item={r}></@zd-ec><i>{r.n}</i>{end}'),
  // magasin modifié par une méthode, ou par une suppression, sur un élément trouvé ; l'enfant de la ligne montre la liste et les champs
  'zd-tags':     js(['$item = null;'], "<em>{$item ? $item.tags.join(',') + '/' + Object.keys($item.adresse).join(',') : 'nul'}</em>"),
  'zd-magasin2': js(["$$zdl2 = [{ id: 1, tags: ['a'], adresse: { ville: 'a', x: 1 } }, { id: 2, tags: ['b'], adresse: { ville: 'b', x: 1 } }];", '@pousser = function(v) { $$zdl2.find((t) => t.id === 2).tags.push(v); };', '@retirer = function() { delete $$zdl2.find((t) => t.id === 2).adresse.x; };'], '{for t in $$zdl2 by id}<@zd-tags item={t}></@zd-tags>{end}'),
  // deux composants qui tiennent le même objet ; le second sort de la page puis y revient
  'zd-garde-a':  js(['$o = window.__zdGarde ||= { n: \'a\' };', '@w = function(v) { $o.n = v; };'], '<p>{$o.n}</p>'),
  'zd-garde-b':  js(['$o = window.__zdGarde ||= { n: \'a\' };'], '<p>{$o.n}</p>'),
  // ligne du magasin `$$`, lue par le composant, tenue et écrite par un enfant
  'zd-lecteurs': js(["$$zdl3 = [{ id: 1, n: 'a' }];"], '{for t in $$zdl3 by id}<@zd-ec item={t}></@zd-ec><i>{t.n}</i>{end}'),
  // objet lu par le composant à travers un objet gelé, passé à un enfant qui l'écrit
  'zd-gel':      js(["$o = { f: Object.freeze({ inner: { n: 'a' } }) };"], '<b>{$o.f.inner.n}</b><@zd-ec item={$o.f.inner}></@zd-ec>'),
  'zd-carte-c':  js(["$m = new Map([[{ nom: 'a' }, 1]]);", "$v = [...$m.keys()].map((x) => x.nom).join(',');", '@wb = function(x) { for (const k of $m.keys()) k.nom = x; };'], '<p class="v">{$v}</p>'),
}
const REGLAGES: Array<[string, any]> = [['développement', {}], ['production', { env: 'prod' }], ['développement sans enveloppe', { proxy: false }]]
const ombre   = (el: any) => el._shadow || el.shadowRoot || el
const enfants = (el: any, tag: string) => (Array.from(ombre(el).querySelectorAll('*')) as any[]).filter((c) => c.tagName === tag)
const textes  = (el: any, tag: string, sel: string) => enfants(el, tag).map((k) => { const n = ombre(k).querySelector(sel); return n ? n.textContent : 'absent' }).join(' ')
const propres = (el: any, sel: string) => (Array.from(ombre(el).querySelectorAll(sel)) as any[]).map((n) => n.textContent).join(' ')
type Lu = Array<[string, string, string]>
// `attente` : un cas que MJS ne suit pas encore, écrit et passé (sa raison) ; `attenteSans`, de même sous le seul réglage `"proxy": false` ;
// `puis` : un second geste, joué après le premier rendu
type Cas = { balises: string[], dev?: boolean, tous?: boolean, attente?: string, attenteSans?: string, geste: (els: any[]) => void, puis?: (els: any[]) => void, lire: (els: any[], avis: string[]) => Lu }
const CAS: Record<string, Cas> = {
  'un objet commun à deux lignes, écrit par une autre variable (`$cats[0].nom = v`) : les enfants qui tiennent les lignes le montrent': {
    balises: ['zd-commun'], geste: ([el]) => el.parAutre(1), lire: ([el]) => [['enfants', textes(el, 'MJS-ZD-CAT', 'em'), 'A1 A1']],
  },
  'un objet commun à deux lignes, écrit par le chemin d\'une ligne (`$rows[0].cat.nom = v`) : l\'enfant qui tient l\'autre ligne le montre': {
    balises: ['zd-commun'], geste: ([el]) => el.direct(1), lire: ([el]) => [['enfants', textes(el, 'MJS-ZD-CAT', 'em'), 'D1 D1']],
  },
  'témoin — un objet commun à deux lignes, écrit par le chemin d\'une ligne : les enfants qui tiennent l\'objet commun le montrent': {
    tous: true, balises: ['zd-commun-o'], geste: ([el]) => el.direct(1), lire: ([el]) => [['enfants', textes(el, 'MJS-ZD-NOM', 'em'), 'D1 D1']],
  },
  'témoin — un objet commun à deux lignes, écrit par une autre variable : les enfants qui tiennent l\'objet commun le montrent': {
    balises: ['zd-commun-o'], geste: ([el]) => el.parAutre(1), lire: ([el]) => [['enfants', textes(el, 'MJS-ZD-NOM', 'em'), 'A1 A1']],
  },
  'un enfant écrit l\'objet qu\'il tient (`$item.n = v`) : le parent et le frère qui tient le même objet le montrent': {
    balises: ['zd-enfant'], geste: ([el]) => enfants(el, 'MJS-ZD-EC')[0].ecrire(1), lire: ([el]) => [['parent', propres(el, 'b'), 'E1'], ['écrivain', textes(el, 'MJS-ZD-EC', 'em'), 'E1'], ['frère', textes(el, 'MJS-ZD-VU', 'em'), 'E1']],
  },
  'témoin — le parent écrit l\'objet tenu par ses enfants (`$o.a.n = v`) : le parent et les deux enfants le montrent': {
    tous: true, balises: ['zd-enfant'], geste: ([el]) => el.direct(1), lire: ([el]) => [['parent', propres(el, 'b'), 'P1'], ['écrivain', textes(el, 'MJS-ZD-EC', 'em'), 'P1'], ['frère', textes(el, 'MJS-ZD-VU', 'em'), 'P1']],
  },
  'une ligne choisie (`$sel = $rows[1]`) puis écrite par la variable (`$sel.label = v`) : la liste, l\'enfant de la ligne et la fiche la montrent': {
    tous: true, balises: ['zd-choisie'], geste: ([el]) => { el.choisir(); el.ecrire(1) }, lire: ([el]) => [['enfants', textes(el, 'MJS-ZD-LAB', 'em'), 'a S1 S1'], ['liste', propres(el, 'i'), 'a S1'], ['texte', propres(el, 'b'), 'S1']],
  },
  'une ligne trouvée (`$sel = $rows.find(f)`) puis écrite par la variable (`$sel.label = v`) : la liste, l\'enfant de la ligne et la fiche la montrent': {
    tous: true, balises: ['zd-trouvee'], geste: ([el]) => { el.trouver(); el.ecrire(1) }, lire: ([el]) => [['enfants', textes(el, 'MJS-ZD-LAB', 'em'), 'a S1 S1'], ['liste', propres(el, 'i'), 'a S1'], ['texte', propres(el, 'b'), 'S1']],
  },
  'une ligne prise en tête du script (`$sel = $rows[1]`, valeur dérivée) puis écrite par la variable (`$sel.label = v`) : la liste et l\'enfant de la ligne la montrent': {
    tous: true, balises: ['zd-tete'], geste: ([el]) => el.ecrire(1), lire: ([el]) => [['enfants', textes(el, 'MJS-ZD-LAB', 'em'), 'a S1 S1'], ['liste', propres(el, 'i'), 'a S1']],
  },
  'deux noms en chaîne (`$a = $rows[0]`, puis `$b = $a.sub`) et une écriture par le second (`$b.n = v`) : la liste et la fiche la montrent': {
    tous: true, balises: ['zd-chaine'], geste: ([el]) => { el.prendre(); el.ecrire(1) }, lire: ([el]) => [['liste', propres(el, 'i'), 'C1'], ['texte', propres(el, 'b'), 'C1']],
  },
  'témoin — une ligne choisie puis écrite par son chemin (`$rows[1].label = v`) : la liste, l\'enfant de la ligne et la fiche la montrent': {
    tous: true, balises: ['zd-choisie'], geste: ([el]) => { el.choisir(); el.direct(1) }, lire: ([el]) => [['enfants', textes(el, 'MJS-ZD-LAB', 'em'), 'a D1 D1'], ['liste', propres(el, 'i'), 'a D1'], ['texte', propres(el, 'b'), 'D1']],
  },
  'un objet tenu par deux lignes, écrit par le composant de l\'une : l\'autre ligne et le parent le montrent': {
    balises: ['zd-deux'], geste: ([el]) => enfants(el, 'MJS-ZD-EC')[0].ecrire(1), lire: ([el]) => [['enfants', textes(el, 'MJS-ZD-EC', 'em'), 'E1 E1'], ['parent', propres(el, 'b'), 'E1']],
  },
  'témoin — un objet tenu par deux lignes, écrit par le parent (`$rows[0].n = v`) : les deux lignes le montrent': {
    tous: true, balises: ['zd-deux'], geste: ([el]) => el.direct(1), lire: ([el]) => [['enfants', textes(el, 'MJS-ZD-EC', 'em'), 'D1 D1'], ['parent', propres(el, 'b'), 'D1']],
  },
  'une ligne écrite plus bas par son propre composant (`$item.x.c = v`) : la ligne du parent et l\'enfant le montrent': {
    balises: ['zd-propre'], geste: ([el]) => enfants(el, 'MJS-ZD-ECX')[1].ecrire(5), lire: ([el]) => [['enfants', textes(el, 'MJS-ZD-ECX', 'em'), '0 5'], ['liste', propres(el, 'i'), '0 5']],
  },
  'témoin — une ligne écrite plus bas par le parent (`$rows[1].x.c = v`) : la ligne du parent et l\'enfant le montrent': {
    tous: true, balises: ['zd-propre'], geste: ([el]) => el.direct(5), lire: ([el]) => [['enfants', textes(el, 'MJS-ZD-ECX', 'em'), '0 5'], ['liste', propres(el, 'i'), '0 5']],
  },
  'magasin écrit plus bas par la variable d\'une boucle (`for (const t of $$liste) t.adresse.ville = v`) : la ligne et son enfant le montrent': {
    balises: ['zd-magasin'], geste: ([el]) => el.parBoucle(1), lire: ([el]) => [['enfants', textes(el, 'MJS-ZD-ADR', 'em'), 'a B1'], ['liste', propres(el, 'i'), 'a B1']],
  },
  'magasin écrit plus bas par un élément trouvé (`$$liste.find(f).adresse.ville = v`) : la ligne et son enfant le montrent': {
    balises: ['zd-magasin'], geste: ([el]) => el.parTrouve(1), lire: ([el]) => [['enfants', textes(el, 'MJS-ZD-ADR', 'em'), 'a T1'], ['liste', propres(el, 'i'), 'a T1']],
  },
  'témoin — magasin écrit plus bas par le chemin (`$$liste[1].adresse.ville = v`) : la ligne et son enfant le montrent': {
    tous: true, balises: ['zd-magasin'], geste: ([el]) => el.direct(1), lire: ([el]) => [['enfants', textes(el, 'MJS-ZD-ADR', 'em'), 'a D1'], ['liste', propres(el, 'i'), 'a D1']],
  },
  'liste brute changée sur place puis `µrefresh($lignes)` : l\'enfant qui la reçoit en prop relit ses lignes': {
    balises: ['zd-brute'], geste: ([el]) => el.changer(1), lire: ([el]) => [['enfant', (Array.from(ombre(enfants(el, 'MJS-ZD-LISTE')[0]).querySelectorAll('em')) as any[]).map((n) => n.textContent).join(' '), 'a R1']],
  },
  'témoin — liste brute changée sur place puis `µrefresh($lignes)` : le composant qui l\'affiche relit ses lignes': {
    tous: true, balises: ['zd-brute'], geste: ([el]) => el.changer(1), lire: ([el]) => [['composant', propres(el, 'b'), 'a R1']],
  },
  'un `µ.Store` dérivé qui range sa donnée dans un champ à lui (`this.state = …`), lu par la vue `{for r in p.state.rows}` : le développement dit que ce champ n\'est pas suivi et nomme `.data`': {
    balises: ['zd-store'], dev: true, tous: true, geste: ([el]) => el.ecrire(7), lire: (_els, avis) => [['avertissement', String(avis.some((a) => /state/.test(a) && /\.data/.test(a))), 'true']],
  },
  'témoin — vue `{for r in q.data.rows}` d\'un `µ.Store` tenu par une variable ordinaire : la ligne le montre': {
    tous: true, balises: ['zd-store-d'], geste: ([el]) => el.ecrire(7), lire: ([el]) => [['liste', propres(el, 'i'), '1 7']],
  },
  'clé d\'une `Map` rangée sous l\'enveloppe d\'un autre composant, écrite par lui : la valeur dérivée qui lit les clés suit': {
    balises: ['zd-carte-a', 'zd-carte-b'], geste: ([a]) => a.wa('y'), lire: ([, b]) => [['dérivée', propres(b, '.v'), 'y']],
  },
  'clé d\'une `Map` rangée sous l\'enveloppe d\'un autre composant, écrite par le composant qui lit la `Map` : sa valeur dérivée suit': {
    balises: ['zd-carte-a', 'zd-carte-b'], geste: ([, b]) => b.wb('z'), lire: ([, b]) => [['dérivée', propres(b, '.v'), 'z']],
  },
  'la ligne d\'un `µ.state` passée à un enfant, écrite par lui (`$item.n = v`) : le composant qui lit l\'état la montre': {
    balises: ['zd-etat'], geste: ([el]) => enfants(el, 'MJS-ZD-EC')[0].ecrire(1), lire: ([el]) => [['enfant', textes(el, 'MJS-ZD-EC', 'em'), 'E1'], ['liste', propres(el, 'i'), 'E1']],
  },
  'la ligne d\'un `µ.Store` passée à un enfant, écrite par lui (`$item.n = v`) : le composant qui lit le magasin la montre': {
    balises: ['zd-classe'], geste: ([el]) => enfants(el, 'MJS-ZD-EC')[0].ecrire(1), lire: ([el]) => [['enfant', textes(el, 'MJS-ZD-EC', 'em'), 'E1'], ['liste', propres(el, 'i'), 'E1']],
  },
  'magasin modifié par une méthode sur un élément trouvé (`$$liste.find(f).tags.push(v)`) : l\'enfant de la ligne le montre': {
    balises: ['zd-magasin2'], geste: ([el]) => el.pousser('z'), lire: ([el]) => [['enfants', textes(el, 'MJS-ZD-TAGS', 'em'), 'a/ville,x b,z/ville,x']],
  },
  'magasin modifié par une suppression sur un élément trouvé (`delete $$liste.find(f).adresse.x`) : l\'enfant de la ligne le montre': {
    balises: ['zd-magasin2'], geste: ([el]) => el.retirer(), lire: ([el]) => [['enfants', textes(el, 'MJS-ZD-TAGS', 'em'), 'a/ville,x b/ville']],
  },
  'un composant qui tient un objet partagé sort de la page et y revient (le routeur qui le garde) : il suit les écritures suivantes': {
    balises: ['zd-garde-a', 'zd-garde-b'], geste: ([a, b]) => { b.remove(); a.w('x1'); b.ownerDocument.body.appendChild(b) }, puis: ([a]) => a.w('x2'), lire: ([, b]) => [['gardé', propres(b, 'p'), 'x2']],
  },
  'la ligne d\'un magasin `$$` passée à un enfant, écrite par lui (`$item.n = v`) : le composant qui lit le magasin la montre': {
    attente: 'le magasin `$$` n\'est pas un détenteur : un composant qui lit ses lignes sans les ranger dans une variable `$` n\'apprend pas ce qu\'un enfant y écrit', balises: ['zd-lecteurs'], geste: ([el]) => enfants(el, 'MJS-ZD-EC')[0].ecrire(1), lire: ([el]) => [['enfant', textes(el, 'MJS-ZD-EC', 'em'), 'E1'], ['liste', propres(el, 'i'), 'E1']],
  },
  'avertissement — l\'enfant écrit l\'objet que le parent tient : le développement dit que l\'écran suit': {
    dev: true, balises: ['zd-enfant'], geste: ([el]) => enfants(el, 'MJS-ZD-EC')[0].ecrire(1), lire: (_els, avis) => [['avertissement', ((avis) => String(avis.some((a) => /l'écran suit/.test(a)) && !avis.some((a) => /n'en est pas prévenu/.test(a))))(avis), 'true']],
  },
  'avertissement — l\'enfant écrit une ligne du magasin `$$` que le parent lit sans variable `$` : le développement dit que le parent n\'en est pas prévenu': {
    dev: true, balises: ['zd-lecteurs'], geste: ([el]) => enfants(el, 'MJS-ZD-EC')[0].ecrire(1), lire: (_els, avis) => [['avertissement', ((avis) => String(avis.some((a) => /n'en est pas prévenu/.test(a)) && !avis.some((a) => /l'écran suit/.test(a))))(avis), 'true']],
  },
  'avertissement — l\'enfant écrit un objet que le parent lit à travers un objet gelé : le développement dit que le parent n\'en est pas prévenu': {
    dev: true, balises: ['zd-gel'], geste: ([el]) => enfants(el, 'MJS-ZD-EC')[0].ecrire(1), lire: (_els, avis) => [['avertissement', ((avis) => String(avis.some((a) => /n'en est pas prévenu/.test(a)) && !avis.some((a) => /l'écran suit/.test(a))))(avis), 'true']],
  },
  'témoin — clé d\'une `Map` du composant, écrite par lui : sa valeur dérivée suit': {
    balises: ['zd-carte-c'], geste: ([c]) => c.wb('z'), lire: ([c]) => [['dérivée', propres(c, '.v'), 'z']],
  },
}

for (const [nom, opts] of REGLAGES) describe(`objet de l'état tenu à plusieurs endroits, écrit par un détour (${nom})`, function () {
  this.timeout(240000)
  let code = ''
  const fenetres: any[] = []
  before(async () => {
    const root = mjsTmp('etat-ecrit-par-un-detour'), srcDir = join(root, 'src'), outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f + '.mjs'), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...opts } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    code = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })
  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })
  // monte les balises une à une, dans l'ordre : la seconde peut lire ce que la première a posé
  const monter = async (balises: string[]) => {
    const win: any = new Window({ url: 'http://localhost/' })
    fenetres.push(win)
    win.eval(`${code}\nglobalThis.µ = µ;`)
    const avis = [] as string[]
    win.µ.warn = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
    const els = [] as any[]
    for (const b of balises) {
      win.document.body.insertAdjacentHTML('beforeend', `<mjs-${b}></mjs-${b}>`)
      await tic()
      els.push(win.document.querySelector('mjs-' + b))
    }
    return { els, avis }
  }
  for (const [titre, cas] of Object.entries(CAS)) if ((!cas.dev || !opts.env) && (cas.tous || opts.proxy !== false)) {
    const attente = cas.attente || (opts.proxy === false ? cas.attenteSans : void 0)
    ;(attente ? it.skip : it)(attente ? `${titre} (en attente : ${attente})` : titre, async () => {
      const { els, avis } = await monter(cas.balises)
      cas.geste(els)
      await tic()
      if (cas.puis) {
        cas.puis(els)
        await tic()
      }
      const ecarts = cas.lire(els, avis).filter(([, montre, attendu]) => montre !== attendu).map(([quoi, montre, attendu]) => `${quoi} montre «${montre}», attendu «${attendu}»`)
      assert.deepEqual(ecarts, [])
    })
  }
})
