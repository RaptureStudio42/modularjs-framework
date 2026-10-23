// fixtures partagées des tests « valeur des champs dans une page préparée » : un formulaire qui porte un champ de chaque sorte, lié à
// une variable de la page, puis deux sous-composants à ombre propre qui en portent un à leur tour (le champ vit alors dans une ombre
// imbriquée), et un composant léger. L'état de départ est écrit une seule fois, ici : ce que le serveur doit recopier dans le HTML.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// ce que chaque champ vaut au moment où le serveur écrit la page
export const ETAT = {
  luminosite: '1.4',
  teinte:     '#ff8800',
  nom:        'Ada "L" <b>&</b>',
  langue:     'en',
  note:       'Bonjour\nle monde',
  suite:      '\nsuite',
  retour:     '\r\nretour',
  cr:         '\rcr',
  secret:     'mot-de-passe-secret',
  leger:      '4'
}

const FORMULAIRE = `<script lang="coffee">
$luminosite = ${ETAT.luminosite}
$teinte     = '${ETAT.teinte}'
$nom        = 'Ada "L" <b>&</b>'
$actif      = true
$offre      = 'pro'
$langue     = '${ETAT.langue}'
$note       = 'Bonjour\\nle monde'
$suite      = '\\nsuite'
$retour     = '\\r\\nretour'
$cr         = '\\rcr'
$secret     = '${ETAT.secret}'
cocher      = (n) -> n.checked = true
</script>
<form class="f" @noUJS>
  <input class="lum" type="range" name="lum" min="0" max="3" step="0.01" value={$luminosite} aria-label="luminosité">
  <input class="lum2" type="range" name="lum2" min="0" max="3" step="0.01" value=!{$luminosite} aria-label="luminosité liée dans les deux sens">
  <input class="teinte" type="color" name="teinte" value={$teinte} aria-label="teinte">
  <input class="nom" type="text" name="nom" value={$nom} aria-label="nom">
  <input class="actif" type="checkbox" name="actif" checked={$actif} aria-label="actif">
  <input class="inactif" type="checkbox" name="inactif" checked={not $actif} aria-label="inactif">
  <input class="free" type="radio" name="offre" value="free" checked={$offre is 'free'} aria-label="offre libre">
  <input class="pro" type="radio" name="offre" value="pro" checked={$offre is 'pro'} aria-label="offre pro">
  <input class="imperatif" type="checkbox" name="imperatif" aria-label="case cochée par le script" @attach={cocher}>
  <select class="langue" name="langue" value={$langue} aria-label="langue"><option value="fr">Français</option><option value="en">English</option><optgroup label="autres"><option value="de">Deutsch</option></optgroup></select>
  <textarea class="note" name="note" value={$note} aria-label="note"></textarea>
  <textarea class="suite" name="suite" value={$suite} aria-label="suite"></textarea>
  <textarea class="retour" name="retour" value={$retour} aria-label="retour chariot et saut de ligne en tête"></textarea>
  <textarea class="cr" name="cr" value={$cr} aria-label="retour chariot seul en tête"></textarea>
  <input class="secret" type="password" name="secret" value={$secret} aria-label="secret">
  <input class="libre" type="range" name="libre" min="0" max="10" aria-label="curseur sans valeur de départ">
  <input class="noir" type="color" name="noir" aria-label="couleur sans valeur de départ">
  <select class="seul" name="seul" aria-label="liste sans choix écrit"><option value="a">A</option><option value="b">B</option></select>
  <@champ-interne valeur={$luminosite}>
</form>
`

const INTERNE = `<div class="ci">
  <input class="ri" type="range" min="0" max="3" step="0.01" value={$valeur} aria-label="curseur du sous-composant">
  <@champ-profond texte={$valeur}>
</div>
`

const PROFOND = `<div class="cp">
  <input class="rp" type="text" value={$texte} aria-label="texte du petit-enfant">
</div>
`

const LEGER = `<script lang="coffee">
$v = ${ETAT.leger}
</script>
<input class="leger" type="range" min="0" max="5" step="0.5" value={$v} aria-label="curseur léger">
`

// une case cochée au montage, puis décochée par la page : le moteur navigateur lance `µmount` pour de vrai
const TARDIVE = `<script lang="coffee">
$coche = true
µmount ->
  $coche = false
</script>
<input class="tardive" type="checkbox" checked={$coche} aria-label="case décochée au montage">
`

// deux boutons radio d'un même groupe : le script choisit le second
const RADIOS = `<script lang="coffee">
choisir = (n) -> n.checked = true
</script>
<form @noUJS>
  <input class="premier" type="radio" name="i" value="1" aria-label="premier">
  <input class="second" type="radio" name="i" value="2" aria-label="second" @attach={choisir}>
</form>
`

export const FICHIERS: Record<string, string> = {
  'champs-tous.mjs':    FORMULAIRE,
  'champ-interne.mjs':  INTERNE,
  'champ-profond.mjs':  PROFOND,
  'champ-leger.mjs':    LEGER,
  'champ-tardive.mjs':  TARDIVE,
  'champ-radios.mjs':   RADIOS
}

// écrit les composants dans le dossier source d'un projet de test
export function ecrireChamps(srcDir: string): void {
  for (const [nom, source] of Object.entries(FICHIERS)) writeFileSync(join(srcDir, nom), source)
}

// les attributs d'une balise ouvrante : un `>` écrit dans une valeur entre guillemets ne la termine pas
const ATTRS = '(?:"[^"]*"|[^>"])*'

// la balise ouvrante du champ de cette classe, telle que le serveur l'a écrite ('' si absente)
export function balise(html: string, classe: string): string {
  return (html.match(new RegExp('<(?:input|select|textarea)\\b' + ATTRS + '\\bclass="' + classe + '"' + ATTRS + '>')) ?? [''])[0]
}

const ENTITES: Record<string, string> = { '&quot;': '"', '&lt;': '<', '&gt;': '>', '&amp;': '&' }

// la valeur de l'attribut `nom` d'une balise ouvrante, entités décodées ; null si l'attribut n'y est pas
export function attribut(ouvrante: string, nom: string): string | null {
  const m = ouvrante.match(new RegExp('\\s' + nom + '(?:="([^"]*)")?(?=[\\s>])'))
  if (!m) return null
  return (m[1] ?? '').replace(/&(?:quot|lt|gt|amp);/g, (e) => ENTITES[e])
}

// le texte d'un <textarea> de cette classe, entités décodées ; null si absent
export function contenu(html: string, classe: string): string | null {
  const m = html.match(new RegExp('<textarea\\b' + ATTRS + '\\bclass="' + classe + '"' + ATTRS + '>([\\s\\S]*?)</textarea>'))
  return m ? m[1].replace(/&(?:quot|lt|gt|amp);/g, (e) => ENTITES[e]) : null
}

// la balise ouvrante de l'<option> de cette valeur ('' si absente)
export function option(html: string, valeur: string): string {
  return (html.match(new RegExp('<option\\b' + ATTRS + '\\bvalue="' + valeur + '"' + ATTRS + '>')) ?? [''])[0]
}
