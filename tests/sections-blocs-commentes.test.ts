// Un bloc mis en COMMENTAIRE HTML doit rester INERTE — trou constaté sur les deux
// blocs neufs du mois : `<theme>` et `<style name="…">` étaient extraits par expression régulière
// SANS masquage des commentaires. Mettre une ancienne version de côté en la commentant la
// RALLUMAIT : `themes: ["dark"]` depuis un commentaire, et — pire — si l'active portait le même
// nom, la compilation échouait sur « deux blocs <theme name="dark"> » ; seule, la version commentée
// REMPLAÇAIT silencieusement l'active. Le bloc `<routes>`, juste en dessous dans le même fichier,
// recevait déjà ce masquage (avec le commentaire qui l'explique), et `directives.ts` aussi.
//
// `<script>` recevait ENCORE moins que `<theme>`/`<style>` : la vue utilisée pour le repérer
// (`maskedCivet`) neutralise les littéraux Civet mais jamais les commentaires HTML — un
// `<script>…</script>` COMPLET écrit dans `<!-- … -->` était donc extrait comme LE script réel
// du composant (marqueur du script commenté retrouvé dans la sortie compilée).

import assert from 'node:assert/strict'
import { extractSections } from '../src/transpiler/sections.js'

describe('sections : un bloc en commentaire HTML est INERTE', () => {
  it('<theme> commenté : aucun thème extrait', () => {
    const src = '<div>x</div>\n<!-- ancienne version, gardée en référence :\n<theme name="dark">$$accent: black</theme>\n-->\n'
    assert.deepEqual(extractSections(src).themes.map(t => t.name), [])
  })

  it('contre-cas : le même <theme> HORS commentaire est bien extrait', () => {
    const src = '<div>x</div>\n<theme name="dark">$$accent: black</theme>\n'
    assert.deepEqual(extractSections(src).themes.map(t => t.name), ['dark'])
  })

  it('<theme> commenté + <theme> ACTIF de même nom : plus d\'erreur « theme-double »', () => {
    const src = '<div>x</div>\n<!--\n<theme name="dark">$$accent: black</theme>\n-->\n<theme name="dark">$$accent: navy</theme>\n'
    const r = extractSections(src)
    assert.deepEqual(r.themes.map(t => t.name), ['dark'])
    assert.match(r.themes[0].raw, /navy/, 'c\'est la version ACTIVE qui doit gagner, jamais la commentée')
  })

  it('<style name="…"> commenté : aucun variant extrait', () => {
    const src = '<div>x</div>\n<!--\n<style name="old">.x{color:green}</style>\n-->\n'
    assert.deepEqual(extractSections(src).layouts.map(l => l.name), [])
  })

  it('contre-cas : le même <style name> HORS commentaire est bien extrait', () => {
    const src = '<div>x</div>\n<style name="old">.x{color:green}</style>\n'
    assert.deepEqual(extractSections(src).layouts.map(l => l.name), ['old'])
  })

  it('<style> de BASE commenté : le style du composant reste vide, pas d\'erreur « style-double »', () => {
    const src = '<div>x</div>\n<!--\n<style>.a{color:red}</style>\n-->\n<style>.b{color:blue}</style>\n'
    const r = extractSections(src)
    assert.match(r.style.raw, /color:blue/)
    assert.doesNotMatch(r.style.raw, /color:red/)
  })

  it('<script> COMPLET (ouverture ET fermeture) commenté : aucun script extrait, pas le composant réel', () => {
    const src = '<div>x</div>\n<!-- désactivé temporairement :\n<script>\nwindow.__marqueur_script_commente = true\n</script>\n-->\n<p>reste visible</p>\n'
    const r = extractSections(src)
    assert.equal(r.script.raw.includes('__marqueur_script_commente'), false, r.script.raw)
    assert.match(r.html, /reste visible/)
  })

  it('<script> commenté + <script> ACTIF : c\'est l\'actif qui devient le script du composant', () => {
    const src = '<div>x</div>\n<!--\n<script>\n$x = 0\nwindow.__ancien = true\n</script>\n-->\n<script>\n$x = 1\n</script>\n<p>{$x}</p>\n'
    const r = extractSections(src)
    assert.equal(r.script.raw.includes('__ancien'), false, r.script.raw)
    assert.match(r.script.raw, /\$x = 1/)
  })

  it('<script module> commenté : aucun module extrait', () => {
    const src = '<div>x</div>\n<!--\n<script module>\nexport salut = -> 1\n</script>\n-->\n<script>\n$n = 0\n</script>\n<p>{$n}</p>\n'
    const r = extractSections(src)
    assert.equal(r.module.raw, '')
  })

  it('contre-cas : le même <script> HORS commentaire est bien extrait', () => {
    const src = '<div>x</div>\n<script>\nwindow.__marqueur = true\n</script>\n<p>x</p>\n'
    assert.match(extractSections(src).script.raw, /__marqueur/)
  })

  it('non-régression — <routes> commenté reste inerte (masquage déjà en place)', () => {
    const src = '<div>x</div>\n<!--\n<routes target="#vue">\n/a → page-a\n</routes>\n-->\n'
    assert.deepEqual(extractSections(src).routes, [])
  })

  it('le commentaire lui-même n\'est pas consommé : il ressort dans le HTML', () => {
    const src = '<div>x</div>\n<!--\n<theme name="dark">$$accent: black</theme>\n-->\n'
    assert.match(extractSections(src).html, /<!--/, 'le commentaire doit rester dans le HTML, masqué ≠ supprimé')
  })

  // le masquage tourne sur une vue déjà « inertée » (chaînes/commentaires CSS) : une apostrophe
  // française dans du texte HTML ne doit pas décaler les plages de commentaire
  it('apostrophes françaises dans le HTML : le masquage ne dérape pas', () => {
    const src = "<p>C'est l'été, l'heure d'y aller</p>\n<!--\n<theme name=\"dark\">$$accent: black</theme>\n-->\n<theme name=\"clair\">$$accent: white</theme>\n"
    assert.deepEqual(extractSections(src).themes.map(t => t.name), ['clair'])
  })

  // un `<!--` JAMAIS refermé ne doit rien masquer (motif lazy exigeant `-->`)
  it('commentaire jamais refermé : aucun masquage, le bloc actif reste vu', () => {
    const src = '<div>x</div>\n<!-- oups, pas de fermeture\n<theme name="dark">$$accent: black</theme>\n'
    assert.deepEqual(extractSections(src).themes.map(t => t.name), ['dark'])
  })

  // le garde-fou « balise orpheline » traite désormais `</script>` comme `</style>`/`</theme>`/
  // `</routes>` : commenté, il est inerte (le masquage des commentaires HTML tourne maintenant
  // AVANT la recherche de `<script>`, cf. maskHtmlComments) ; HORS commentaire, il reste refusé.
  it('garde orpheline : une balise fermante COMMENTÉE (`</script>`, `</style>`) reste inerte', () => {
    assert.doesNotThrow(() => extractSections('<div>x</div>\n<!-- </script> -->\n'))
    assert.doesNotThrow(() => extractSections('<div>x</div>\n<!-- </style> -->\n'))
    assert.throws(() => extractSections('<div>x</div>\n</script>\n'), /orphelin/)
    assert.throws(() => extractSections('<div>x</div>\n</style>\n'), /orphelin/)
  })
})
