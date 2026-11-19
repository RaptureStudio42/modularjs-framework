// réglage `"proxy": false` : l'appel d'une chaîne optionnelle dont une clé agit (`$l[$i++]?.push(1)`) reste suivi sans l'enveloppe — la
// clé est jouée une fois, l'élément qu'elle vise reçoit la valeur, et l'écran le montre ; de même pour une clé après le maillon
// (`$o?.l[$j++].push(1)`) et dans le magasin, qui n'a jamais d'enveloppe. Vraie construction, mode strict

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterStrict } from './helpers/construction-stricte.js'
import { attendreEgal } from './helpers/attendre.js'

const ETAT = `<script lang="js">
$l = [[], []];
$i = 0;
$o = { l: [[], []] };
$j = 0;
this.methode = function() { $l[$i++]?.push(1); };
this.appel = function() { $l[$i++]?.push?.(1); };
this.champ = function() { $o.l[$j++]?.push(1); };
this.apres = function() { $o?.l[$j++].push(1); };
this.raz = function() { $l = [[], []]; $i = 0; $o = { l: [[], []] }; $j = 0; };
</script>
<p>{$i}{$j}-{$l[0].length}{$l[1].length}-{$o.l[0].length}{$o.l[1].length}</p>
`

const MAGASIN = `<script lang="js">
$$m = [[], []];
$i = 0;
this.methode = function() { $$m[$i++]?.push(1); };
this.lire = function() { return JSON.stringify($$m); };
</script>
<p>{$i}-{$$m[0].length}{$$m[1].length}</p>
`

describe('réglage `"proxy": false` : chaîne optionnelle à clé qui agit (`$l[$i++]?.push(1)`), suivie sans l\'enveloppe, clé jouée une fois', function () {
  this.timeout(120000)
  let page: any

  before(async () => {
    page = await monterStrict('chaine-cle-sans-enveloppe', { 'chaine-etat': ETAT, 'chaine-magasin': MAGASIN }, { proxy: false })
  })

  after(async () => {
    await page?.window.happyDOM.close()
    await terminateSharedWorkerPool()
  })

  const texte = (balise: string) => page.window.document.querySelector(balise)._shadow.querySelector('p').textContent

  // chaque forme part d'un état neuf ; rend l'état et l'écran une fois l'appel fait
  const jouer = async (methode: string, attendu: { etat: string, ecran: string }) => {
    const e = page.window.document.querySelector('mjs-chaine-etat')
    e.raz()
    await attendreEgal(() => texte('mjs-chaine-etat'), '00-00-00', 'état neuf', 2000)
    e[methode]()
    const etat = () => `i${e._state.i} j${e._state.j} l${JSON.stringify(e._state.l)} o${JSON.stringify(e._state.o.l)}`
    await attendreEgal(() => ({ etat: etat(), ecran: texte('mjs-chaine-etat') }), attendu, methode, 2000)
  }

  it('`$l[$i++]?.push(1)` : `$i` vaut 1, le premier élément reçoit la valeur, l\'écran le montre', async () => {
    await jouer('methode', { etat: 'i1 j0 l[[1],[]] o[[],[]]', ecran: '10-10-00' })
  })

  it('`$l[$i++]?.push?.(1)` : de même', async () => {
    await jouer('appel', { etat: 'i1 j0 l[[1],[]] o[[],[]]', ecran: '10-10-00' })
  })

  it('`$o.l[$j++]?.push(1)` : de même pour un champ de l\'état', async () => {
    await jouer('champ', { etat: 'i0 j1 l[[],[]] o[[1],[]]', ecran: '01-00-10' })
  })

  it('`$o?.l[$j++].push(1)`, la clé après le maillon : de même', async () => {
    await jouer('apres', { etat: 'i0 j1 l[[],[]] o[[1],[]]', ecran: '01-00-10' })
  })

  it('magasin, `$$m[$i++]?.push(1)` : `$i` vaut 1, le premier élément du magasin reçoit la valeur, l\'écran le montre', async () => {
    const e = page.window.document.querySelector('mjs-chaine-magasin')
    assert.equal(texte('mjs-chaine-magasin'), '0-00')
    e.methode()
    await attendreEgal(() => ({ i: e._state.i, m: e.lire(), ecran: texte('mjs-chaine-magasin') }), { i: 1, m: '[[1],[]]', ecran: '1-10' }, 'clé jouée une fois, puis écran', 2000)
  })
})
