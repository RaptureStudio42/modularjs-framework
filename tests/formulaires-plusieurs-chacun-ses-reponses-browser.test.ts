// Plusieurs formulaires dans une page : la réponse du serveur à l'envoi d'un formulaire (un refus 422, un succès `method: 'none'` avec
// `errors: null`) se range sous CE formulaire. Ses <@@field> et l'objet formulaire de ses champs la lisent ; ceux d'un autre formulaire
// gardent ce qu'ils montraient, même quand les deux formulaires nomment leurs champs pareil : un refus ne s'affiche pas chez le voisin, un
// succès ne fait pas passer le voisin au vert, deux succès de suite (sac inchangé) remettent le second formulaire au succès. Deux formulaires
// d'un même composant, avec et sans objet, deux composants, deux instances d'un composant (le même `id` : chacune le sien), une liste
// {for} de formulaires sans `id` ; un lien qui répond `errors: null` vaut pour tous.
// moteurs exigés : chromium firefox webkit

import { bancFormulaires, type Cas } from './helpers/formulaires-banc.js'

const CAS: Cas[] = [
  {
    titre: 'deux formulaires d’un même composant, sans objet, champs de même nom',
    sources: { 'pa1.mjs': `<form id="fa" action="/fa" method="post"><@@field label="qa"><input id="qa" name="q" value="qaqa"></@@field><button id="bfa">a</button></form>
<form id="fb" action="/fb" method="post"><@@field label="qb"><input id="qb" name="q" value="qbqb"></@@field><button id="bfb">b</button></form>
<a id="lp1" href="/lien-null">lien</a>
` },
    champs: ['qa', 'qb'],
    refus: { fa: { q: 'Q refuse par fa' }, fb: { q: 'Q refuse par fb' } },
    attendu: [
      'depart | qa=[null,""] qb=[null,""]',
      'a-422 | qa=["error","Q refuse par fa"] qb=[null,""]',
      'b-200-null | qa=["error","Q refuse par fa"] qb=["ok",""]',
      'a-200-null | qa=["ok",""] qb=["ok",""]',
      'b-422 | qa=["ok",""] qb=["error","Q refuse par fb"]',
      'lien-null | qa=["ok",""] qb=["ok",""]'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.envoyer('fa')
      await h.voir('a-422')
      await h.remplir('qb', 'okok')
      await h.envoyer('fb')
      await h.voir('b-200-null')
      await h.remplir('qa', 'okok')
      await h.envoyer('fa')
      await h.voir('a-200-null')
      await h.remplir('qb', 'bbbb')
      await h.envoyer('fb')
      await h.voir('b-422')
      await h.lien('lp1')
      await h.voir('lien-null')
    }
  },
  {
    titre: 'deux formulaires d’un même composant avec objet, chaque refus nommant aussi le champ de l’autre',
    sources: { 'pa2.mjs': `<vars>
  $qa string 3..10
  $qb string 3..10
</vars>

<script>
  $qa   = 'qaqa'
  $qb   = 'qbqb'
  $form = µform(this)
</script>

<p id="ex">{JSON.stringify([$form.qa.error, $form.qb.error, $form.valid])}</p>
<form id="fc" action="/fc" method="post"><@@field label="qa"><input id="qa2" name="qa" value="qaqa"></@@field><button id="bfc">c</button></form>
<form id="fd" action="/fd" method="post"><@@field label="qb"><input id="qb2" name="qb" value="qbqb"></@@field><button id="bfd">d</button></form>
<a id="lp2" href="/lien-null">lien</a>
` },
    champs: ['qa2', 'qb2'],
    objet: true,
    refus: { fc: { qa: 'QA refuse', qb: 'QB par fc' }, fd: { qa: 'QA par fd', qb: 'QB refuse' } },
    attendu: [
      'depart | qa2=[null,""] qb2=[null,""] ex=["","",true]',
      'c-422 | qa2=["error","QA refuse"] qb2=[null,""] ex=["QA refuse","",false]',
      'd-422 | qa2=["error","QA refuse"] qb2=["error","QB refuse"] ex=["QA refuse","QB refuse",false]',
      'c-200-null | qa2=["ok",""] qb2=["error","QB refuse"] ex=["","QB refuse",false]',
      'd-200-null | qa2=["ok",""] qb2=["ok",""] ex=["","",true]',
      'lien-null | qa2=["ok",""] qb2=["ok",""] ex=["","",true]'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.envoyer('fc')
      await h.voir('c-422')
      await h.envoyer('fd')
      await h.voir('d-422')
      await h.remplir('qa2', 'okok')
      await h.envoyer('fc')
      await h.voir('c-200-null')
      await h.remplir('qb2', 'okok')
      await h.envoyer('fd')
      await h.voir('d-200-null')
      await h.lien('lp2')
      await h.voir('lien-null')
    }
  },
  {
    titre: 'deux composants, chacun son formulaire sans id, champs de même nom',
    sources: {
      'pa3.mjs': `<@c3a></@c3a>
<@c3b></@c3b>
`,
      'c3a.mjs': `<form action="/f3a" method="post"><@@field label="q"><input id="q3a" name="q" value="q3q3"></@@field><button id="bf3a">a</button></form>
`,
      'c3b.mjs': `<form action="/f3b" method="post"><@@field label="q"><input id="q3b" name="q" value="q3q3"></@@field><button id="bf3b">b</button></form>
`
    },
    champs: ['q3a', 'q3b'],
    refus: { f3a: { q: 'Q par f3a' }, f3b: { q: 'Q par f3b' } },
    attendu: [
      'depart | q3a=[null,""] q3b=[null,""]',
      'a-422 | q3a=["error","Q par f3a"] q3b=[null,""]',
      'b-422 | q3a=["error","Q par f3a"] q3b=["error","Q par f3b"]',
      'a-200-null | q3a=["ok",""] q3b=["error","Q par f3b"]'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.envoyer('f3a')
      await h.voir('a-422')
      await h.envoyer('f3b')
      await h.voir('b-422')
      await h.remplir('q3a', 'okok')
      await h.envoyer('f3a')
      await h.voir('a-200-null')
    }
  },
  {
    titre: 'deux instances d’un même composant, dont le formulaire porte le même id : chacune le sien',
    sources: {
      'pa4.mjs': `<@bi></@bi>
<@bi></@bi>
`,
      'bi.mjs': `<script>
  window.__k = (window.__k or 0) + 1
  $k = window.__k
</script>

<form id="fi" action="/fi" method="post"><@@field label="q"><input id="q{$k}" name="q" value="qq"></@@field><button id="bfi{$k}">go</button></form>
`
    },
    champs: ['q1', 'q2'],
    refus: { fi: { q: 'Q refuse par fi' } },
    attendu: [
      'depart | q1=[null,""] q2=[null,""]',
      'inst2-422 | q1=[null,""] q2=["error","Q refuse par fi"]',
      'inst1-200-null | q1=["ok",""] q2=["error","Q refuse par fi"]'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.envoyer('fi2')
      await h.voir('inst2-422')
      await h.remplir('q1', 'okok')
      await h.envoyer('fi1')
      await h.voir('inst1-200-null')
    }
  },
  {
    titre: 'une liste {for} de formulaires sans id : chaque élément le sien, un élément ajouté repart à neuf',
    sources: { 'pa5.mjs': `<script>
  $items = [{id: 1}, {id: 2}]
  ajout  = -> $items = $items.concat([{id: 3}])
  retire = -> $items = $items.slice(1)
</script>

{for it in $items by id}
  <form action="/fl" method="post"><@@field label="q"><input id="q{it.id}" name="q" value="qq"></@@field><button id="bfl{it.id}">go</button></form>
{end}
<button type="button" id="ajout" @click=ajout>ajout</button>
<button type="button" id="retire" @click=retire>retire</button>
` },
    champs: ['q1', 'q2', 'q3'],
    refus: { fl: { q: 'Q refuse par fl' } },
    attendu: [
      'depart | q1=[null,""] q2=[null,""] q3=null',
      'item2-422 | q1=[null,""] q2=["error","Q refuse par fl"] q3=null',
      'ajout-3 | q1=[null,""] q2=["error","Q refuse par fl"] q3=[null,""]',
      'retire-1 | q1=null q2=["error","Q refuse par fl"] q3=[null,""]',
      'item3-200-null | q1=null q2=["error","Q refuse par fl"] q3=["ok",""]'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.envoyer('fl2')
      await h.voir('item2-422')
      await h.cliquer('ajout')
      await h.voir('ajout-3')
      await h.cliquer('retire')
      await h.voir('retire-1')
      await h.remplir('q3', 'okok')
      await h.envoyer('fl3')
      await h.voir('item3-200-null')
    }
  }
]

bancFormulaires('plusieurs formulaires dans une page : chacun ses réponses', 'form-chacun', CAS)
