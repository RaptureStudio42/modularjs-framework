// Classement des valeurs dérivées par le compilateur (`transpile(…, { derived: true })`, lu par `mjs check --derived`) :
//   - « précise » : le compilateur prouve ce qu'elle lit — variables `$` du composant, autres dérivées précises,
//     littéraux, opérateurs, champs lus, appels de la liste courte (méthodes de liste et de chaîne, `Math.*`, `String`…),
//     paramètres d'une fonction écrite sur place en argument d'une méthode de liste — et seulement si son calcul coûte plus
//     que sa vérification (appel de méthode, liste ou objet bâti) ou si une valeur précise la lit ;
//   - « horloge » : tout le reste, avec la raison — une lecture qui échappe à l'analyse (variable ordinaire changée
//     ailleurs, import, globale du navigateur, propriété du composant, l'heure, le hasard, `await`, dérivée à l'horloge),
//     ou à défaut la forme hors de la liste courte (`liste` : fonction ou constante du `<script>` ou du module, magasin,
//     contexte, `µread`, méthode hors de la liste…), ou `simple` : prouvée, mais faite de lectures, de `.length`,
//     d'opérateurs, de `Math.*` — la refaire coûte moins que vérifier ses sources.
// Sans l'option, rien n'est calculé et le code produit est le même, octet pour octet.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

interface Raison { code: string; nom?: string; par?: string }
interface Classee { nom: string; classe: 'precise' | 'horloge'; raisons: Raison[] }

async function classer(src: string, moduleName: string): Promise<Map<string, Classee>> {
  const r     = await transpile(src, { moduleName, derived: true })
  const liste = (r.data as any).derivees as Classee[] | undefined
  assert.ok(Array.isArray(liste), 'transpile(…, { derived: true }) rend le classement des dérivées dans data.derivees')
  return new Map(liste.map((d) => [d.nom, d]))
}

function precise(m: Map<string, Classee>, nom: string): void {
  const d = m.get(nom)
  assert.ok(d, `dérivée $${nom} classée`)
  assert.equal(d.classe, 'precise', `$${nom} précise, raisons : ${JSON.stringify(d.raisons)}`)
  assert.deepEqual(d.raisons, [])
}

// à l'horloge parce qu'une forme sort de la liste courte : `lu`, la forme nommée
function liste(m: Map<string, Classee>, nom: string, lu: string): void {
  horloge(m, nom, 'liste', lu)
}

function horloge(m: Map<string, Classee>, nom: string, code: string, lu?: string, par?: string): void {
  const d = m.get(nom)
  assert.ok(d, `dérivée $${nom} classée`)
  assert.equal(d.classe, 'horloge', `$${nom} à l'horloge`)
  const trouvee = d.raisons.some((x) => x.code === code && (lu === undefined || x.nom === lu) && (par === undefined || x.par === par))
  assert.ok(trouvee, `$${nom} : raison ${code} ${lu ?? ''} ${par ? 'par ' + par : ''} attendue, reçu ${JSON.stringify(d.raisons)}`)
}

describe('classement des dérivées : précise ou horloge (mjs check --derived)', function () {
  this.timeout(30000)

  it('la boutique : une dérivée qui lit une variable ordinaire changée par une fonction est à l\'horloge, une variable ordinaire lue aussi (hors de la liste courte), les autres sont précises', async () => {
    const m = await classer(`<script>
$cart = 0
$search = ''
$items = [{ name: 'a' }, { name: 'b' }]
dailyPrice .= 10
taux .= 2
$total = $cart * dailyPrice
$found = $items.filter((a) -> a.name.includes($search))
$banner = "#{$found.length} articles, panier #{$cart}"
$double = $cart * taux
$apres = $total + 1
@hausse = -> dailyPrice = 12
</script>
<p>{$total} {$banner} {$double} {$apres}</p>
`, 'boutique')
    horloge(m, 'total', 'variable', 'dailyPrice')
    precise(m, 'found')
    horloge(m, 'banner', 'simple', '$banner')
    liste(m, 'double', 'taux')
    horloge(m, 'apres', 'derivee', '$total')
  })

  it('variable ordinaire changée en membre, passée à une fonction, ou écrite par un gestionnaire du gabarit : horloge', async () => {
    const m = await classer(`<script>
$a = 1
cfg = { rate: 1 }
opts = { n: 1 }
prix .= 10
zone .= null
$parMembre = $a * cfg.rate
$parAppel = $a * opts.n
$parGabarit = $a * prix
$parRef = $a + (zone?.scrollTop ?? 0)
@regler = -> cfg.rate = 2
@envoyer = -> maj(opts)
</script>
<p>{$parMembre} {$parAppel} {$parGabarit} {$parRef}</p>
<button @click={prix = 12}>x</button>
<div :this=!{zone}></div>
`, 'membres')
    horloge(m, 'parMembre', 'variable', 'cfg')
    horloge(m, 'parAppel', 'variable', 'opts')
    horloge(m, 'parGabarit', 'variable', 'prix')
    horloge(m, 'parRef', 'variable', 'zone')
  })

  it('l\'heure, le hasard, une globale du navigateur, une propriété du composant, await : horloge ; Math : précise ; JSON et une méthode de date : hors de la liste courte', async () => {
    const m = await classer(`<script>
$a = 1
$q = ''
$maintenant = Date.now() + $a
$jour = new Date().getDate() + $a
$tirage = Math.random() + $a
$largeur = window.innerWidth + $a
$garde = localStorage.getItem('k') + $a
$titre = @nom + $a
$charge = await fetch("/x?q=#{$q}")
$borne = Math.max($a, 1) + JSON.stringify({ a: $a }).length
$dateFixe = new Date($a).getTime()
</script>
<p>{$maintenant} {$jour} {$tirage} {$largeur} {$garde} {$titre} {$borne} {$dateFixe}</p>
`, 'globales')
    horloge(m, 'maintenant', 'heure', 'Date.now()')
    horloge(m, 'jour', 'heure', 'new Date()')
    horloge(m, 'tirage', 'hasard', 'Math.random()')
    horloge(m, 'largeur', 'globale', 'window')
    horloge(m, 'garde', 'globale', 'localStorage')
    horloge(m, 'titre', 'instance', '@nom')
    horloge(m, 'charge', 'attente')
    liste(m, 'borne', '.stringify()')
    liste(m, 'dateFixe', '.getTime()')
  })

  it('une fonction importée est à l\'horloge (question Q1) ; un magasin importé (µ$$x) sort de la liste courte', async () => {
    const m = await classer(`@import trier 'outils.civet.mjs'
@import µ$$compte 'magasin.module.civet.mjs'
<script>
$items = [3, 1, 2]
$a = 1
$tri = trier($items)
$avecCompte = µ$$compte + $a
</script>
<p>{$tri} {$avecCompte}</p>
`, 'imports')
    horloge(m, 'tri', 'import', 'trier')
    liste(m, 'avecCompte', '$compte')
  })

  it('une fonction du composant atteinte par la dérivée : hors de la liste courte, une lecture cachée la passe à l\'horloge', async () => {
    const m = await classer(`<script>
$items = [1, 2, 3]
$a = 1
$b = 2
somme = (l) -> l.reduce(((s, x) -> s + x), 0)
lireTotal = -> $a + $b
lireFenetre = -> window.scrollY + $a
$total = somme($items)
$parFonction = lireTotal() * 2 + $b
$cachee = lireFenetre() + $b
</script>
<p>{$total} {$parFonction} {$cachee}</p>
`, 'fonctions')
    liste(m, 'total', 'somme()')
    liste(m, 'parFonction', 'lireTotal()')
    horloge(m, 'cachee', 'globale', 'window', 'lireFenetre')
  })

  it('chemins profonds : précise ; magasins, contextes réactifs, µread et constantes du <script module> : hors de la liste courte', async () => {
    const m = await classer(`<script module>
TABLE = [1, 2, 3]
maintenant = -> Date.now()
</script>
<script>
$o = { a: { b: { c: 1 } } }
$m = 1
$n = 2
$double = $o.a.b.c * 2
$fixe = $o.a.b.c.toFixed(2)
$panier = $$panier.n + 1
$theme = §§theme.length + $m
$lu = µread($n) + $m
$table = TABLE.length + $m
$horodate = maintenant() + $m
</script>
<p>{$double} {$fixe} {$panier} {$theme} {$lu} {$table} {$horodate}</p>
`, 'profonds')
    horloge(m, 'double', 'simple', '$double')
    precise(m, 'fixe')
    liste(m, 'panier', '$$panier')
    liste(m, 'theme', '§§theme')
    liste(m, 'lu', 'µread $n')
    liste(m, 'table', 'TABLE')
    horloge(m, 'horodate', 'heure', 'Date.now()', 'maintenant')
  })

  it('CoffeeScript : le même piège, la même raison', async () => {
    const m = await classer(`<script lang="coffee">
$cart = 0
prix = 10
$total = $cart * prix
$double = $cart * 2
$paire = [$cart, 2]
@hausse = -> prix = 12
</script>
<p>{$total} {$double} {$paire}</p>
`, 'boutiquecoffee')
    horloge(m, 'total', 'variable', 'prix')
    horloge(m, 'double', 'simple', '$double')
    precise(m, 'paire')
  })

  it('méthodes du langage sur une locale ou un espace (`.set()` d\'une Map locale, `Math.max.apply`) : hors de la liste courte', async () => {
    const m = await classer(`<script>
$items = [{ g: 'a' }, { g: 'b' }]
$notes = [3, 9, 4]
grouper = (l) ->
  t = new Map()
  for x in l
    t.set(x.g, (t.get(x.g) ?? 0) + 1)
  t
$groupes = grouper($items).size
$haut = Math.max.apply(null, $notes)
</script>
<p>{$groupes} {$haut}</p>
`, 'natives')
    liste(m, 'groupes', 'grouper()')
    liste(m, 'haut', '.apply()')
  })

  it('méthode du composant (`@m = ->`) : à l\'horloge par défaut ; suivie avec derivedMethods, ses lectures comptent', async () => {
    const src = `<script>
$a = 1
@fmt = (n) -> n.toFixed(2)
@lire = -> window.scrollY
$prix = @fmt($a)
$cache = @lire() + $a
</script>
<p>{$prix} {$cache}</p>
`
    const prudent = await classer(src, 'methodes')
    horloge(prudent, 'prix', 'instance', '@fmt()')
    const r       = await transpile(src, { moduleName: 'methodes', derived: true, derivedMethods: true })
    const suivies = new Map(((r.data as any).derivees as Classee[]).map((d) => [d.nom, d]))
    liste(suivies, 'prix', '.fmt()')
    horloge(suivies, 'cache', 'globale', 'window', '@lire')
  })

  it('variable qui reçoit un objet que le script garde (`$l = garde`) : la valeur qui la lit reste à l\'horloge, avec cette raison', async () => {
    const m = await classer(`<script>
$l = [1, 2]
$k = 0
garde = [5, 6]
$t = $l.map((x) -> x)
$u = [$k].join('')
@remplir = -> $l = garde
@choisir = (x) -> $l = x
</script>
<p>{$t} {$u}</p>
`, 'gardee')
    horloge(m, 't', 'garde', '$l')
    precise(m, 'u')
  })

  it('sans l\'option : aucun classement, et le code produit ne change pas d\'un octet', async () => {
    const src = `<script>
$cart = 0
dailyPrice .= 10
$total = $cart * dailyPrice
@hausse = -> dailyPrice = 12
</script>
<p>{$total}</p>
<button @click={dailyPrice = 13}>x</button>
`
    const sans = await transpile(src, { moduleName: 'temoin' })
    const avec = await transpile(src, { moduleName: 'temoin', derived: true })
    assert.equal((sans.data as any).derivees, undefined, 'rien de calculé sans l\'option')
    assert.ok(Array.isArray((avec.data as any).derivees), 'le classement avec l\'option')
    assert.equal(avec.output, sans.output, 'même code produit avec et sans l\'option')
  })
})
