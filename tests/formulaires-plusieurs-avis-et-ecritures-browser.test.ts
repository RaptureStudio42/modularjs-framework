// Plusieurs formulaires dans une page, suite : des formulaires d'une liste {for} qui portent tous le même `id` n'en font qu'un (un `id` en
// double est déjà faux en HTML) ; deux succès de suite d'un formulaire ne préviennent que lui (l'objet formulaire d'un autre composant ne
// repasse pas) ; la réponse lente d'un formulaire retiré entre-temps reste la sienne ; une écriture de l'application dans `µres.errors` (le
// sac entier ou une clé en place) vaut pour tous les formulaires ; l'objet formulaire lu tard (son gabarit caché pendant deux refus) montre
// le refus de chacun de ses formulaires.
// moteurs exigés : chromium firefox webkit

import { bancFormulaires, type Cas } from './helpers/formulaires-banc.js'

const CAS: Cas[] = [
  {
    titre: 'une liste {for} de formulaires au même id : un seul formulaire, ses réponses partagées',
    sources: { 'p6.mjs': `<script>
  $items = [{id: 1}, {id: 2}]
  ajout  = -> $items = $items.concat([{id: 3}])
  retire = -> $items = $items.slice(1)
</script>

{for it in $items by id}
  <form id="fl" action="/fl" method="post"><@@field label="q"><input id="q{it.id}" name="q" value="qq"></@@field><button id="bfl{it.id}">go</button></form>
{end}
<button type="button" id="ajout" @click=ajout>ajout</button>
<button type="button" id="retire" @click=retire>retire</button>
` },
    champs: ['q1', 'q2', 'q3'],
    refus: { fl: { q: 'Q refuse par fl' } },
    attendu: [
      'depart | q1=[null,""] q2=[null,""] q3=null',
      'item2-422 | q1=["error","Q refuse par fl"] q2=["error","Q refuse par fl"] q3=null',
      'ajout-3 | q1=["error","Q refuse par fl"] q2=["error","Q refuse par fl"] q3=["error","Q refuse par fl"]',
      'retire-1 | q1=null q2=["error","Q refuse par fl"] q3=["error","Q refuse par fl"]',
      'item3-200-null | q1=null q2=["ok",""] q3=["ok",""]'
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
  },
  {
    titre: 'deux composants avec objet, deux succès de suite du premier : l’objet de l’autre ne repasse pas',
    sources: {
      'p7.mjs': `<@c7a></@c7a>
<@c7b></@c7b>
`,
      'c7a.mjs': `<vars>
  $r string 3..10
</vars>

<script>
  $r    = 'rara'
  $form = µform(this)
  µeffect ->
    window.__compte('a-valid', $form.valid)
</script>

<form id="f7" action="/f7a" method="post"><@@field label="r"><input id="ra" name="r" value="rara"></@@field><button id="bf7a">a</button></form>
`,
      'c7b.mjs': `<vars>
  $r string 3..10
</vars>

<script>
  $r    = 'rbrb'
  $form = µform(this)
  µeffect ->
    window.__compte('b-valid', $form.valid)
</script>

<form id="f7" action="/f7b" method="post"><@@field label="r"><input id="rb" name="r" value="rbrb"></@@field><button id="bf7b">b</button></form>
`
    },
    champs: ['ra', 'rb'],
    refus: { f7a: { r: 'R par f7a' }, f7b: { r: 'R par f7b' } },
    attendu: [
      'depart | ra=[null,""] rb=[null,""]',
      'a-422 | ra=["error","R par f7a"] rb=[null,""]',
      'b-200-null | ra=["error","R par f7a"] rb=["ok",""]',
      'a-200-null | ra=["ok",""] rb=["ok",""]',
      'a-200-null | b-valid=+0'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.envoyer('f7a')
      await h.voir('a-422')
      await h.remplir('rb', 'okok')
      await h.envoyer('f7b')
      await h.voir('b-200-null')
      await h.noter('b-valid')
      await h.remplir('ra', 'okok')
      await h.envoyer('f7a')
      await h.voir('a-200-null')
      await h.ecart('a-200-null', 'b-valid')
    }
  },
  {
    titre: 'la réponse lente d’un formulaire retiré avant elle reste la sienne',
    sources: { 'p8.mjs': `<script>
  $voir = true
</script>

<form id="f8a" action="/f8a" method="post"><@@field label="r"><input id="r8a" name="r" value="r8r8"></@@field><button id="bf8a">a</button></form>
{if $voir}
  <form id="f8b" action="/f8b" method="post"><@@field label="r"><input id="r8b" name="r" value="lent"></@@field><button id="bf8b">b</button></form>
{end}
<button type="button" id="cache8" @click={$voir = false}>cache</button>
` },
    champs: ['r8a', 'r8b'],
    refus: { f8a: { r: 'R par f8a' }, f8b: { r: 'R par f8b' } },
    attendu: [
      'depart | r8a=[null,""] r8b=[null,""]',
      'a-422 | r8a=["error","R par f8a"] r8b=[null,""]',
      'apres-reponse-lente | r8a=["error","R par f8a"] r8b=null'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.envoyer('f8a')
      await h.voir('a-422')
      const rep = h.attendreEnvoi()
      await h.cliquerSeul('bf8b')
      await h.cliquer('cache8')
      await rep
      await h.attendre(500)
      await h.voir('apres-reponse-lente')
    }
  },
  {
    titre: 'les écritures de l’application dans µres.errors valent pour tous les formulaires',
    sources: { 'p9.mjs': `<script>
  window.__erreurs = (e)-> µres.errors = e
  window.__enPlace = (k, v)-> µres.errors[k] = v
</script>

<form id="f9a" action="/f9a" method="post"><@@field label="sa"><input id="sa" name="sa" value="sasa"></@@field><button id="bf9a">a</button></form>
<form id="f9b" action="/f9b" method="post"><@@field label="sb"><input id="sb" name="sb" value="sbsb"></@@field><button id="bf9b">b</button></form>
` },
    champs: ['sa', 'sb'],
    refus: { f9a: { sa: 'SA refuse' }, f9b: { sb: 'SB refuse' } },
    attendu: [
      'depart | sa=[null,""] sb=[null,""]',
      'a-422 | sa=["error","SA refuse"] sb=[null,""]',
      'appli-en-place-sb | sa=["error","SA refuse"] sb=["error","SB en place"]',
      'appli-en-place-sa | sa=["error","SA en place"] sb=["error","SB en place"]',
      'appli-erreurs | sa=["error","SA appli"] sb=["error","SB appli"]',
      'appli-null | sa=["ok",""] sb=["ok",""]',
      'b-422 | sa=["ok",""] sb=["error","SB refuse"]'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.envoyer('f9a')
      await h.voir('a-422')
      await h.appli('cle', ['sb', 'SB en place'])
      await h.voir('appli-en-place-sb')
      await h.appli('cle', ['sa', 'SA en place'])
      await h.voir('appli-en-place-sa')
      await h.appli('sac', { sa: 'SA appli', sb: 'SB appli' })
      await h.voir('appli-erreurs')
      await h.appli('sac', null)
      await h.voir('appli-null')
      await h.envoyer('f9b')
      await h.voir('b-422')
    }
  },
  {
    titre: 'l’objet formulaire lu tard, son gabarit caché pendant les refus de ses deux formulaires',
    sources: { 'p10.mjs': `<vars>
  $wc string 3..10
  $wd string 3..10
</vars>

<script>
  $wc   = 'wcwc'
  $wd   = 'wdwd'
  $voir = false
  $form = µform(this)
</script>

{if $voir}
  <p id="ex">{JSON.stringify([$form.wc.error, $form.wd.error])}</p>
{end}
<form id="f10c" action="/f10c" method="post"><@@field label="wc"><input id="wc" name="wc" value="wcwc"></@@field><button id="bf10c">c</button></form>
<form id="f10d" action="/f10d" method="post"><@@field label="wd"><input id="wd" name="wd" value="wdwd"></@@field><button id="bf10d">d</button></form>
<button type="button" id="voir10" @click={$voir = true}>voir</button>
` },
    champs: ['wc', 'wd'],
    objet: true,
    refus: { f10c: { wc: 'WC refuse', wd: 'WD par f10c' }, f10d: { wc: 'WC par f10d', wd: 'WD refuse' } },
    attendu: [
      'c-422 | wc=["error","WC refuse"] wd=[null,""] ex=null',
      'd-422 | wc=["error","WC refuse"] wd=["error","WD refuse"] ex=null',
      'voir | wc=["error","WC refuse"] wd=["error","WD refuse"] ex=["WC refuse","WD refuse"]'
    ],
    jouer: async (h) => {
      await h.envoyer('f10c')
      await h.voir('c-422')
      await h.envoyer('f10d')
      await h.voir('d-422')
      await h.cliquer('voir10')
      await h.voir('voir')
    }
  }
]

bancFormulaires('plusieurs formulaires dans une page : avis ciblés, réponses lentes, écritures de l’application, objet lu tard', 'form-avis', CAS)
