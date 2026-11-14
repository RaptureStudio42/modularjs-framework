// Les réponses du serveur rangées par formulaire, dans trois situations où le formulaire d'un champ se cherche mal : un formulaire à `id`
// qu'un {if} cache pendant que sa réponse lente arrive (une page à un seul formulaire) retrouve son refus quand il revient ; un champ
// enveloppé (une icône, un affixe) et rattaché par `form="…"` à un autre formulaire lit les réponses de CE formulaire ; une liste
// (`name="tags[]"`) lue par l'objet formulaire garde son refus quand un autre formulaire est refusé, avec ou sans enveloppe nommée.
// moteurs exigés : chromium firefox webkit

import { bancFormulaires, type Cas } from './helpers/formulaires-banc.js'

const CAS: Cas[] = [
  {
    titre: 'un formulaire à id, caché par un {if} pendant que sa réponse lente arrive, retrouve son refus quand il revient',
    sources: { 'l9.mjs': `<script>
  $voir = true
</script>

{if $voir}
  <form id="f9" action="/f9" method="post"><@@field label="j"><input id="j9" name="j" value="lent"></@@field><button id="bf9">go</button></form>
{end}
<button type="button" id="cache9" @click={$voir = false}>cache</button>
<button type="button" id="montre9" @click={$voir = true}>montre</button>
` },
    champs: ['j9'],
    refus: { f9: { j: 'J refuse' } },
    attendu: [
      'depart | j9=[null,""]',
      'cache-pendant-envoi | j9=null',
      'remontre | j9=["error","J refuse"]'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      const rep = h.attendreEnvoi()
      await h.cliquerSeul('bf9')
      await h.cliquer('cache9')
      await h.voir('cache-pendant-envoi')
      await rep
      await h.attendre(500)
      await h.cliquer('montre9')
      await h.voir('remontre')
    }
  },
  {
    titre: 'un champ enveloppé (affixe) et rattaché par form="…" à un autre formulaire lit les réponses de ce formulaire',
    sources: { 'l2.mjs': `<form id="fa2" action="/fa2" method="post">
  <@@field label="q"><span class="affixe" id="qxw"><input id="qx" name="q" form="fb2" value="qq"></span></@@field>
  <@@field label="r"><input id="ra" name="r" value="rr"></@@field>
  <button id="bfa2">a</button>
</form>
<form id="fb2" action="/fb2" method="post"><button id="bfb2">b</button></form>
` },
    champs: ['qxw', 'ra'],
    refus: { fa2: { r: 'R par fa' }, fb2: { q: 'Q par fb' } },
    attendu: [
      'depart | qxw=[null,""] ra=[null,""]',
      'b-422 | qxw=["error","Q par fb"] ra=[null,""]',
      'a-422 | qxw=["error","Q par fb"] ra=["error","R par fa"]'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.envoyer('fb2')
      await h.voir('b-422')
      await h.envoyer('fa2')
      await h.voir('a-422')
    }
  },
  {
    titre: 'objet formulaire : une liste tags[] dans une enveloppe nommée garde son refus quand un autre formulaire est refusé',
    sources: { 'l1.mjs': `<vars>
  $tags string 1..5[] ..2 | null
  $x string 1..20
</vars>

<script>
  $tags = null
  $x    = 'xx'
  $form = µform(this)
</script>

<form id="fta" action="/fta" method="post"><@@field label="t" name="tags"><select id="tags" name="tags[]" multiple value=!{$tags}><option>a</option><option>b</option></select></@@field><button id="bfta">a</button></form>
<form id="ftb" action="/ftb" method="post"><@@field label="x"><input id="xb" name="x" value="xx"></@@field><button id="bftb">b</button></form>
<p id="ex">{JSON.stringify([$form.tags.error, $form.x.error])}</p>
` },
    champs: ['tags', 'xb'],
    objet: true,
    refus: { fta: { tags: 'T refuse' }, ftb: { x: 'X refuse' } },
    attendu: [
      'depart | tags=[null,""] xb=[null,""] ex=["",""]',
      'a-422 | tags=["error","T refuse"] xb=[null,""] ex=["T refuse",""]',
      'b-422 | tags=["error","T refuse"] xb=["error","X refuse"] ex=["T refuse","X refuse"]'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.envoyer('fta')
      await h.voir('a-422')
      await h.envoyer('ftb')
      await h.voir('b-422')
    }
  },
  {
    titre: 'objet formulaire : une liste tags[] sans enveloppe nommée garde son refus quand un autre formulaire est refusé',
    sources: { 'l1n.mjs': `<vars>
  $tags string 1..5[] ..2 | null
  $x string 1..20
</vars>

<script>
  $tags = null
  $x    = 'xx'
  $form = µform(this)
</script>

<form id="ftc" action="/ftc" method="post"><select id="tags2" aria-label="t" name="tags[]" multiple value=!{$tags}><option>a</option><option>b</option></select><button id="bftc">a</button></form>
<form id="ftd" action="/ftd" method="post"><@@field label="x"><input id="xd" name="x" value="xx"></@@field><button id="bftd">b</button></form>
<p id="ex">{JSON.stringify([$form.tags.error, $form.x.error])}</p>
` },
    champs: ['xd'],
    objet: true,
    refus: { ftc: { tags: 'T refuse' }, ftd: { x: 'X refuse' } },
    attendu: [
      'depart | xd=[null,""] ex=["",""]',
      'c-422 | xd=[null,""] ex=["T refuse",""]',
      'd-422 | xd=["error","X refuse"] ex=["T refuse","X refuse"]'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.envoyer('ftc')
      await h.voir('c-422')
      await h.envoyer('ftd')
      await h.voir('d-422')
    }
  }
]

bancFormulaires('les réponses rangées par formulaire : réponse lente d’un formulaire caché, champ enveloppé rattaché ailleurs, liste lue par l’objet', 'form-lentes', CAS)
