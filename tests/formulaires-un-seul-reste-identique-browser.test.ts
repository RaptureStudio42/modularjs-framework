// Une page à un seul formulaire, qui reste dans la page, une page sans formulaire, un champ hors de tout formulaire : les réponses du
// serveur s'y lisent comme dans le sac commun `µres.errors`, sans rien de plus — ce que montre chaque <@@field>, l'objet formulaire, et le
// nombre de passages des µeffect de la page (avec et sans `µform`) sont ceux d'avant le rangement des réponses par formulaire. Refus,
// succès, deux succès de suite, frappe, lien qui répond `errors: null` ou une autre clé, écritures de l'application dans `µres.errors`.
// moteurs exigés : chromium firefox webkit

import { bancFormulaires, type Cas } from './helpers/formulaires-banc.js'

const CAS: Cas[] = [
  {
    titre: 'un formulaire sans objet : refus, succès, refus, frappe, lien',
    sources: { 'u1.mjs': `<form id="fu1" action="/fu1" method="post"><@@field label="a1"><input id="a1" name="a1" value="a1a1"></@@field><button id="bfu1">go</button></form>
<a id="lu1" href="/lien-null">lien</a>
` },
    champs: ['a1'],
    refus: { fu1: { a1: 'A1 refuse' } },
    attendu: [
      'depart | a1=[null,""]',
      '422 | a1=["error","A1 refuse"]',
      '422-bis | a1=["error","A1 refuse"]',
      '200-null | a1=["ok",""]',
      '422-apres-succes | a1=["error","A1 refuse"]',
      'frappe | a1=["error","A1 refuse"]',
      'lien-null | a1=["ok",""]'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.envoyer('fu1')
      await h.voir('422')
      await h.envoyer('fu1')
      await h.voir('422-bis')
      await h.remplir('a1', 'okok')
      await h.envoyer('fu1')
      await h.voir('200-null')
      await h.remplir('a1', 'bad1')
      await h.envoyer('fu1')
      await h.voir('422-apres-succes')
      await h.remplir('a1', 'zz')
      await h.attendre(300)
      await h.voir('frappe')
      await h.lien('lu1')
      await h.voir('lien-null')
    }
  },
  {
    titre: 'un formulaire avec objet : refus, succès, refus, frappe refusée par la règle, lien',
    sources: { 'u2.mjs': `<vars>
  $a2 string 3..10
</vars>

<script>
  $a2   = 'a2a2'
  $form = µform(this)
</script>

<p id="ex">{JSON.stringify([$form.a2.error])}</p>
<form id="fu2" action="/fu2" method="post"><@@field label="a2"><input id="a2" name="a2" value="a2a2"></@@field><button id="bfu2">go</button></form>
<a id="lu2" href="/lien-null">lien</a>
` },
    champs: ['a2'],
    objet: true,
    refus: { fu2: { a2: 'A2 refuse' } },
    attendu: [
      'depart | a2=[null,""] ex=[""]',
      '422 | a2=["error","A2 refuse"] ex=["A2 refuse"]',
      '200-null | a2=["ok",""] ex=[""]',
      '422-apres-succes | a2=["error","A2 refuse"] ex=["A2 refuse"]',
      'frappe | a2=["error","Saisissez de 3 à 10 caractères"] ex=["Saisissez de 3 à 10 caractères"]',
      'lien-null | a2=["error","Saisissez de 3 à 10 caractères"] ex=["Saisissez de 3 à 10 caractères"]'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.envoyer('fu2')
      await h.voir('422')
      await h.remplir('a2', 'okok')
      await h.envoyer('fu2')
      await h.voir('200-null')
      await h.remplir('a2', 'bad2')
      await h.envoyer('fu2')
      await h.voir('422-apres-succes')
      await h.remplir('a2', 'z')
      await h.attendre(300)
      await h.voir('frappe')
      await h.lien('lu2')
      await h.voir('lien-null')
    }
  },
  {
    titre: 'un formulaire avec objet et trois µeffect (validité, sac, autre clé) : passages comptés sur des succès de suite, deux liens, un refus',
    sources: { 'u3.mjs': `<vars>
  $q5 string 3..10
</vars>

<script>
  $q5   = 'okok'
  $form = µform(this)
  µeffect ->
    window.__compte('eff-valid', $form.valid)
  µeffect ->
    window.__compte('eff-errors', µres.errors)
  µeffect ->
    window.__compte('eff-autre', µres.autre)
</script>

<p id="ex">{JSON.stringify([$form.q5.error])}</p>
<form id="fr5" action="/fr5" method="post"><@@field label="q5"><input id="q5" name="q5" value="okok"></@@field><button id="bfr5">go</button></form>
<a id="ln5" href="/lien-null">lien</a>
<a id="la5" href="/lien-autre">autre</a>
` },
    champs: ['q5'],
    objet: true,
    refus: { fr5: { q5: 'Q5 refuse' } },
    attendu: [
      'depart | compteurs={"eff-valid":2,"eff-errors":2,"eff-autre":2}',
      'null-1 | compteurs={"eff-valid":6,"eff-errors":6,"eff-autre":6}',
      'null-3 | compteurs={"eff-valid":12,"eff-errors":12,"eff-autre":12}',
      'lien-null | compteurs={"eff-valid":12,"eff-errors":12,"eff-autre":12}',
      'lien-autre | compteurs={"eff-valid":13,"eff-errors":13,"eff-autre":13}',
      '422 | compteurs={"eff-valid":19,"eff-errors":19,"eff-autre":19}',
      'champ | q5=["error","Q5 refuse"] ex=["Q5 refuse"]',
      'repos | compteurs={"eff-valid":19,"eff-errors":19,"eff-autre":19}'
    ],
    jouer: async (h) => {
      await h.compter('depart')
      await h.envoyer('fr5')
      await h.compter('null-1')
      await h.envoyer('fr5')
      await h.envoyer('fr5')
      await h.compter('null-3')
      await h.lien('ln5')
      await h.compter('lien-null')
      await h.lien('la5', '/lien-autre')
      await h.compter('lien-autre')
      await h.remplir('q5', 'bad')
      await h.envoyer('fr5')
      await h.compter('422')
      await h.voir('champ')
      await h.attendre(1000)
      await h.compter('repos')
    }
  },
  {
    titre: 'un formulaire, écritures de l’application dans µres.errors : le sac entier, une clé en place, avant et après un refus',
    sources: { 'u4.mjs': `<script>
  window.__erreurs = (e)-> µres.errors = e
  window.__enPlace = (k, v)-> µres.errors[k] = v
</script>

<form id="fe6" action="/fe6" method="post"><@@field label="q6"><input id="q6" name="q6" value="q6q6"></@@field><button id="bfe6">go</button></form>
` },
    champs: ['q6'],
    refus: { fe6: { q6: 'Q6 refuse' } },
    attendu: [
      'depart | q6=[null,""]',
      'appli | q6=["error","Q6 appli"]',
      'en-place | q6=["error","Q6 en place"]',
      '422 | q6=["error","Q6 refuse"]',
      'en-place-apres-422 | q6=["error","Q6 en place 2"]',
      'autre-cle | q6=["error","Q6 en place 2"]',
      'appli-2 | q6=["error","Q6 appli 2"]',
      '200-null | q6=["ok",""]',
      'appli-null | q6=["ok",""]'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.appli('sac', { q6: 'Q6 appli' })
      await h.voir('appli')
      await h.appli('cle', ['q6', 'Q6 en place'])
      await h.voir('en-place')
      await h.envoyer('fe6')
      await h.voir('422')
      await h.appli('cle', ['q6', 'Q6 en place 2'])
      await h.voir('en-place-apres-422')
      await h.appli('cle', ['autre', 'x'])
      await h.voir('autre-cle')
      await h.appli('sac', { q6: 'Q6 appli 2' })
      await h.voir('appli-2')
      await h.remplir('q6', 'okok')
      await h.envoyer('fe6')
      await h.voir('200-null')
      await h.appli('sac', null)
      await h.voir('appli-null')
    }
  },
  {
    titre: 'un formulaire, un champ rattaché par form="…" et un champ hors de tout formulaire',
    sources: { 'u5.mjs': `<form id="fu5" action="/fu5" method="post"><@@field label="g5"><input id="g5" name="g5" value="g5g5"></@@field><button id="bfu5">go</button></form>
<@@field label="h5"><input id="h5" name="h5" form="fu5" value="h5h5"></@@field>
<@@field label="i5"><input id="i5" name="i5" value="i5i5"></@@field>
` },
    champs: ['g5', 'h5', 'i5'],
    refus: { fu5: { g5: 'G5 refuse', h5: 'H5 refuse', i5: 'I5 refuse' } },
    attendu: [
      'depart | g5=[null,""] h5=[null,""] i5=[null,""]',
      '422 | g5=["error","G5 refuse"] h5=["error","H5 refuse"] i5=["error","I5 refuse"]',
      '200-null | g5=["ok",""] h5=["ok",""] i5=["ok",""]'
    ],
    jouer: async (h) => {
      await h.voir('depart')
      await h.envoyer('fu5')
      await h.voir('422')
      await h.remplir('g5', 'okok')
      await h.envoyer('fu5')
      await h.voir('200-null')
    }
  },
  {
    titre: 'une page sans formulaire : passages des µeffect sur deux liens',
    sources: { 'u6.mjs': `<script>
  µeffect ->
    window.__compte('eff-errors', µres.errors)
  µeffect ->
    window.__compte('eff-autre', µres.autre)
</script>

<input id="z8" name="z8">
<a id="ln8" href="/lien-null">lien</a>
<a id="la8" href="/lien-autre">autre</a>
` },
    champs: ['z8'],
    refus: {},
    attendu: [
      'depart | compteurs={"eff-errors":1,"eff-autre":1}',
      'lien-null | compteurs={"eff-errors":2,"eff-autre":2}',
      'lien-autre | compteurs={"eff-errors":3,"eff-autre":3}',
      'repos | compteurs={"eff-errors":3,"eff-autre":3}'
    ],
    jouer: async (h) => {
      await h.compter('depart')
      await h.lien('ln8')
      await h.compter('lien-null')
      await h.lien('la8', '/lien-autre')
      await h.compter('lien-autre')
      await h.attendre(800)
      await h.compter('repos')
    }
  },
  {
    titre: 'un formulaire sans objet et deux µeffect : trois succès de suite (sac inchangé), puis un lien qui change une autre clé',
    sources: { 'u7.mjs': `<script>
  µeffect ->
    window.__compte('eff-errors', µres.errors)
  µeffect ->
    window.__compte('eff-autre', µres.autre)
</script>

<form id="fu7" action="/fu7" method="post"><@@field label="ta"><input id="ta" name="ta" value="okok"></@@field><button id="bfu7">go</button></form>
<a id="lu7" href="/lien-autre">autre</a>
` },
    champs: ['ta'],
    refus: { fu7: { ta: 'TA refuse' } },
    attendu: [
      'depart | compteurs={"eff-errors":1,"eff-autre":1}',
      '200-null-1 | compteurs={"eff-errors":2,"eff-autre":2}',
      '200-null-2 | compteurs={"eff-errors":2,"eff-autre":2}',
      '200-null-3 | compteurs={"eff-errors":2,"eff-autre":2}',
      'lien-autre | compteurs={"eff-errors":3,"eff-autre":3}',
      'champ | ta=["ok",""]'
    ],
    jouer: async (h) => {
      await h.compter('depart')
      await h.envoyer('fu7')
      await h.compter('200-null-1')
      await h.envoyer('fu7')
      await h.compter('200-null-2')
      await h.envoyer('fu7')
      await h.compter('200-null-3')
      await h.lien('lu7', '/lien-autre')
      await h.compter('lien-autre')
      await h.voir('champ')
    }
  }
]

bancFormulaires('une page à un seul formulaire, qui reste dans la page, ou sans formulaire : les réponses se lisent comme dans le sac commun', 'form-un-seul', CAS)
