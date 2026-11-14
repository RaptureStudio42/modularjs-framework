// Un formulaire recréé par un {if} : celui qui porte un `id` est reconnu par cet `id` dans son composant et retrouve ses réponses (deux
// formulaires de même `id` qui alternent n'en font qu'un) ; celui qui n'en porte pas est un formulaire neuf, sans les réponses de l'ancien.
// Deux formulaires d'ids différents qui alternent par {if} / {else} gardent chacun les leurs.
// moteurs exigés : chromium firefox webkit

import { bancFormulaires, type Cas } from './helpers/formulaires-banc.js'

const CAS: Cas[] = [
  {
    titre: 'deux formulaires d’ids différents alternés par {if} / {else} : chacun retrouve les siennes',
    sources: { 'r1.mjs': `<script>
  $voir = true
</script>

{if $voir}
  <form id="fra" action="/fra" method="post"><@@field label="q"><input id="qra" name="q" value="qq"></@@field><button id="bfra">a</button></form>
{else}
  <form id="frb" action="/frb" method="post"><@@field label="q"><input id="qrb" name="q" value="qq"></@@field><button id="bfrb">b</button></form>
{end}
<button type="button" id="versB" @click={$voir = false}>versB</button>
<button type="button" id="versA" @click={$voir = true}>versA</button>
` },
    champs: ['qra', 'qrb'],
    refus: { fra: { q: 'Q refuse par fra' }, frb: { q: 'Q refuse par frb' } },
    attendu: [
      'depart | qra=[null,""] qrb=null',
      'a-422 | qra=["error","Q refuse par fra"] qrb=null',
      'b-montre | qra=null qrb=[null,""]',
      'b-200-null | qra=null qrb=["ok",""]',
      'a-remontre | qra=["error","Q refuse par fra"] qrb=null'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.envoyer('fra')
      await h.voir('a-422')
      await h.cliquer('versB')
      await h.voir('b-montre')
      await h.remplir('qrb', 'okok')
      await h.envoyer('frb')
      await h.voir('b-200-null')
      await h.cliquer('versA')
      await h.voir('a-remontre')
    }
  },
  {
    titre: 'un formulaire sans id recréé par {if} repart à neuf',
    sources: { 'r2.mjs': `<script>
  $voir = true
</script>

{if $voir}
  <form action="/f2r" method="post"><@@field label="j"><input id="j2" name="j" value="jjjj"></@@field><button id="bf2r">go</button></form>
{end}
<button type="button" id="cache2" @click={$voir = false}>cache</button>
<button type="button" id="montre2" @click={$voir = true}>montre</button>
` },
    champs: ['j2'],
    refus: { f2r: { j: 'J refuse' } },
    attendu: [
      'depart | j2=[null,""]',
      '422 | j2=["error","J refuse"]',
      'remonte | j2=[null,""]',
      '422-formulaire-neuf | j2=["error","J refuse"]',
      '200-null | j2=["ok",""]'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.envoyer('f2r')
      await h.voir('422')
      await h.cliquer('cache2')
      await h.cliquer('montre2')
      await h.voir('remonte')
      await h.envoyer('f2r')
      await h.voir('422-formulaire-neuf')
      await h.remplir('j2', 'okok')
      await h.envoyer('f2r')
      await h.voir('200-null')
    }
  },
  {
    titre: 'un formulaire à id recréé par {if} retrouve les siennes',
    sources: { 'r3.mjs': `<script>
  $voir = true
</script>

{if $voir}
  <form id="f3r" action="/f3r" method="post"><@@field label="j"><input id="j3" name="j" value="jjjj"></@@field><button id="bf3r">go</button></form>
{end}
<button type="button" id="cache3" @click={$voir = false}>cache</button>
<button type="button" id="montre3" @click={$voir = true}>montre</button>
` },
    champs: ['j3'],
    refus: { f3r: { j: 'J refuse' } },
    attendu: [
      'depart | j3=[null,""]',
      '422 | j3=["error","J refuse"]',
      'remonte | j3=["error","J refuse"]',
      '200-null | j3=["ok",""]'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.envoyer('f3r')
      await h.voir('422')
      await h.cliquer('cache3')
      await h.cliquer('montre3')
      await h.voir('remonte')
      await h.remplir('j3', 'okok')
      await h.envoyer('f3r')
      await h.voir('200-null')
    }
  },
  {
    titre: 'deux formulaires de même id alternés par {if} : un seul formulaire, ses réponses partagées',
    sources: { 'r4.mjs': `<script>
  $voirA = true
  $voirC = false
</script>

{if $voirA}
  <form id="fx" action="/fx" method="post"><@@field label="q"><input id="qa" name="q" value="qq"></@@field><button id="bfxa">a</button></form>
{end}
{if $voirC}
  <form id="fx" action="/fx" method="post"><@@field label="q"><input id="qc" name="q" value="qq"></@@field><button id="bfxc">c</button></form>
{end}
<button type="button" id="cacheA" @click={$voirA = false}>cacheA</button>
<button type="button" id="montreA" @click={$voirA = true}>montreA</button>
<button type="button" id="montreC" @click={$voirC = true}>montreC</button>
` },
    champs: ['qa', 'qc'],
    refus: { fx: { q: 'Q refuse par fx' } },
    attendu: [
      'depart | qa=[null,""] qc=null',
      'a-422 | qa=["error","Q refuse par fx"] qc=null',
      'a-cache-c-montre | qa=null qc=["error","Q refuse par fx"]',
      'a-remontre | qa=["error","Q refuse par fx"] qc=["error","Q refuse par fx"]'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.envoyer('fxa')
      await h.voir('a-422')
      await h.cliquer('cacheA')
      await h.cliquer('montreC')
      await h.voir('a-cache-c-montre')
      await h.cliquer('montreA')
      await h.voir('a-remontre')
    }
  }
]

bancFormulaires('un formulaire recréé par un {if} : avec un id, il retrouve ses réponses ; sans id, il repart à neuf', 'form-recrees', CAS)
