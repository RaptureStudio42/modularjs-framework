// Trois fautes vues à la construction, jamais une erreur (docs/32-cli-et-configuration.md, « Le bloc `lint` ») : un attribut que le
// composant du projet ne lit pas (propUnknown), un lien `#/…` qu'aucune route ne prend (routeUnknown), une clé `µt('…')` absente du
// dictionnaire de la langue par défaut (i18nKeyUnknown). Chaque ligne dit le fichier, la ligne et quoi écrire ; chaque type se coupe
// dans `lint` ; dans le doute (propagation `{...obj}`, attribut lu par un nom calculé, table de routes calculée, clé calculée), rien

import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { checkProject, routeMatches } from '../src/bundler/build-checks.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { Bundler } from '../src/bundler/index.js'
import { LINT_SEVERITY } from '../src/diagnostics.js'
import { getMessagesLang, setMessagesLang, t } from '../src/messages/index.js'
import { parse, type ProjectTagSeen, type TagRef } from '../src/parser/index.js'
import { templateNamesRoutes } from '../src/transpiler/build-checks.js'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function projet(fichiers: Record<string, string>, config: Record<string, unknown> = {}): string {
  const root = mjsTmp('lint-construction')
  for (const [nom, texte] of Object.entries(fichiers)) {
    const chemin = join(root, 'app', 'modularjs', nom)
    mkdirSync(dirname(chemin), { recursive: true })
    writeFileSync(chemin, texte)
  }
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'out', manifestPath: 'out/bundle.js', ...config }))
  return root
}

async function construire(fichiers: Record<string, string>, config: Record<string, unknown> = {}): Promise<string[]> {
  const root  = projet(fichiers, config)
  const found = findConfig(root)
  assert.ok(found, 'mjs.config.json doit être trouvé')
  const bundler = new Bundler(resolveBundlerOpts(found!.config, root) as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))
  return stats.warnings
}

const deType = (warnings: string[], type: string) => warnings.filter(w => w.endsWith(`[lint.${type}]`))

// une construction qui peut échouer : ses erreurs et ses avertissements, tels quels
async function compiler(fichiers: Record<string, string>, config: Record<string, unknown> = {}, avant?: (root: string, bundler: Bundler) => void) {
  const root    = projet(fichiers, config)
  const bundler = new Bundler(resolveBundlerOpts(findConfig(root)!.config, root) as any)
  avant?.(root, bundler)
  return bundler.compile()
}

const TROIS_COUPES = { lint: { propUnknown: false, routeUnknown: false, i18nKeyUnknown: false } }

describe('build — propUnknown : un attribut que le composant du projet ne lit pas', function () {
  this.timeout(60000)

  const FICHE = '<h2>{$titre}</h2>\n<p>{$userName}</p>\n'

  it('faute de frappe : le fichier, la ligne de la balise, le nom le plus proche', async () => {
    const w = deType(await construire({ 'page.mjs': '<main>\n  <@fiche titel="Bonjour"></@fiche>\n</main>\n', 'fiche.mjs': FICHE }), 'propUnknown')
    assert.equal(w.length, 1, JSON.stringify(w))
    assert.match(w[0], /page\.mjs/)
    assert.match(w[0], /ligne 2\b/)
    assert.match(w[0], /« titel »/)
    assert.match(w[0], /[Vv]ouliez-vous écrire « titre » \?/)
  })

  it('rien pour une prop lue (camelCase et tirets compris), un attribut natif ou global, data-*, aria-*, une directive', async () => {
    const page = '<@fiche titre="a" userName="b" class="c" id="d" title="e" style="color: red" hidden data-x="1" aria-label="f" lang="fr" @click={go}></@fiche>\n<@fiche user-name="g"></@fiche>\n<script>\n  go = -> 1\n</script>\n'
    const w    = deType(await construire({ 'page.mjs': page, 'fiche.mjs': FICHE }), 'propUnknown')
    assert.deepEqual(w, [])
  })

  it('rien quand l\'enfant lit l\'attribut sur sa balise : sélecteur de son style, getAttribute écrit en dur ou calculé', async () => {
    const fichiers = {
      'page.mjs':  '<@carte taille="l"></@carte>\n<@genre sorte="x"></@genre>\n<@libre zzz="1"></@libre>\n',
      'carte.mjs': '<p>carte</p>\n<style>\n  :host([taille="l"])\n    width: 20em\n</style>\n',
      'genre.mjs': '<p>{@getAttribute(\'sorte\')}</p>\n',
      'libre.mjs': '<script>\n  nom = \'zzz\'\n  µmount ->\n    console.log @getAttribute(nom)\n</script>\n<p>libre</p>\n',
    }
    assert.deepEqual(deType(await construire(fichiers), 'propUnknown'), [])
  })

  it('rien sur un module du cœur, une balise d\'une autre bibliothèque, une balise qui reçoit une propagation {...obj}', async () => {
    const page = '<@@checkbox inconnu="1"></@@checkbox>\n<sl-button variante="x"></sl-button>\n<@fiche {...opts} titel="x"></@fiche>\n<script>\n  opts = { titre: \'a\' }\n</script>\n'
    assert.deepEqual(deType(await construire({ 'page.mjs': page, 'fiche.mjs': FICHE }), 'propUnknown'), [])
  })

  it('un modèle en fichier choisi par une valeur calculée reçoit les attributs de la base : ce que la base lit compte', async () => {
    const fichiers = {
      'page.mjs':           '<@carte layout={$vue} description="d"></@carte>\n<script>\n  $vue = \'compacte\'\n</script>\n',
      'carte.mjs':          '<p>{$titre} {$description}</p>\n',
      'carte.compacte.mjs': '<p>{$titre}</p>\n',
    }
    assert.deepEqual(deType(await construire(fichiers), 'propUnknown'), [])
  })

  it('une balise venue d\'un partiel inclus : signalée sans ligne (les lignes du HTML compilé sont décalées)', async () => {
    const w = deType(await construire({ 'page.mjs': '<main>\n  <@include entete>\n</main>\n', '_entete.mjs': '<@fiche titel="x"></@fiche>\n', 'fiche.mjs': FICHE }), 'propUnknown')
    assert.equal(w.length, 1, JSON.stringify(w))
    assert.match(w[0], /page\.mjs : <@fiche>/)
  })

  it('lint.propUnknown: false coupe l\'avertissement', async () => {
    const w = await construire({ 'page.mjs': '<@fiche titel="Bonjour"></@fiche>\n', 'fiche.mjs': FICHE }, { lint: { propUnknown: false } })
    assert.deepEqual(deType(w, 'propUnknown'), [])
  })
})

describe('build — routeUnknown : un lien `#/…` qu\'aucune route ne prend', function () {
  this.timeout(60000)

  const ROUTES = '<routes target="app">\n  /              accueil\n  /posts/:id     billet\n  /docs/*        docs\n  /archive/(:an) archive\n</routes>\n'
  const LIENS  = '<nav>\n  <a href="#/profil">Profil</a>\n  <a href="#/posts/42">Billet</a>\n  <a href="#/docs/a/b">Docs</a>\n  <a href="#/archive">Archive</a>\n  <a href="#/archive/2024/">2024</a>\n  <a href="#/?tri=nom">Accueil</a>\n  <a href="#/posts/{$id}">Calculé</a>\n  <a href="#section">Ancre</a>\n  <a href="/autre-page">Page</a>\n</nav>\n<@view app>\n'
  const PAGES  = { 'accueil.mjs': '<p>accueil</p>\n', 'billet.mjs': '<p>billet</p>\n', 'docs.mjs': '<p>docs</p>\n', 'archive.mjs': '<p>archive</p>\n' }

  it('un lien mort, et lui seul : le fichier, la ligne, quoi écrire', async () => {
    const w = deType(await construire({ 'app.page.mjs': ROUTES + LIENS, ...PAGES }), 'routeUnknown')
    assert.equal(w.length, 1, JSON.stringify(w))
    assert.match(w[0], /app\.page\.mjs/)
    assert.match(w[0], /ligne 8\b/)
    assert.match(w[0], /« #\/profil »/)
    assert.match(w[0], /<routes>/)
  })

  it('un projet sans table <routes> : rien', async () => {
    const w = deType(await construire({ 'menu.mjs': LIENS.replace('<@view app>\n', ''), ...PAGES }), 'routeUnknown')
    assert.deepEqual(w, [])
  })

  it('une table que le script calcule (@routes, un chemin calculé) : rien, elle peut prendre tout lien', async () => {
    const calcule = '<script>\n  chemin = \'/profil\'\n  @routes[\'app\'][chemin] = \'accueil\'\n</script>\n'
    const w       = deType(await construire({ 'app.page.mjs': ROUTES + LIENS + calcule, ...PAGES }), 'routeUnknown')
    assert.deepEqual(w, [])
  })

  it('lint.routeUnknown: false coupe l\'avertissement', async () => {
    const w = await construire({ 'app.page.mjs': ROUTES + LIENS, ...PAGES }, { lint: { routeUnknown: false } })
    assert.deepEqual(deType(w, 'routeUnknown'), [])
  })
})

describe('build — i18nKeyUnknown : une clé µt absente du dictionnaire de la langue par défaut', function () {
  this.timeout(60000)

  const DICOS = {
    'i18n/fr.yml':         'titre: Bonjour\nnav:\n  fermer: Fermer\nitems:\n  one: un article\n  other: des articles\n',
    'i18n/fr/panier.yml':  'resume: Résumé\n',
    'i18n/fr/autre.yml':   'seule: Ici\n',
    'i18n/en.yml':         'titre: Hello\n',
  }
  const CONFIG = { i18n: { default: 'fr' } }

  it('clé racine, clé de section, clé du script : le fichier, la ligne, la clé effective et son dictionnaire', async () => {
    const fichiers = {
      ...DICOS,
      'accueil.mjs': '<p>{µt(\'titre\')}</p>\n<p>{µt(\'nav.fermr\')}</p>\n<p>{µt(\'items\', { n: 2 })}</p>\n<p>{µt("x.#{$k}")}</p>\n<p>{µt(\'mjs.toast.success\')}</p>\n',
      'panier.mjs':  '@i18n \'panier\'\n\n<p>{µt(\'resume\')}</p>\n<p>{µt(\'vide\')}</p>\n<p>{µt(\'/nav.fermer\')}</p>\n',
      'script.mjs':  '<script>\n  msg = µt(\'absente.du.script\')\n</script>\n<p>{msg}</p>\n',
    }
    const w = deType(await construire(fichiers, CONFIG), 'i18nKeyUnknown')
    assert.equal(w.length, 3, JSON.stringify(w))
    const racine  = w.find(l => l.includes('nav.fermr'))
    const section = w.find(l => l.includes('panier.vide'))
    const script  = w.find(l => l.includes('absente.du.script'))
    assert.ok(racine && section && script, JSON.stringify(w))
    assert.match(racine!, /accueil\.mjs/)
    assert.match(racine!, /ligne 2\b/)
    assert.match(racine!, /i18n\/fr\.yml/)
    assert.match(racine!, /[Vv]ouliez-vous écrire « nav\.fermer » \?/)
    assert.match(section!, /panier\.mjs/)
    assert.match(section!, /ligne 4\b/)
    assert.match(section!, /i18n\/fr\/panier\.yml/)
    assert.match(script!, /ligne 2\b/)
  })

  it('plusieurs sections : la clé relative se trouve dans l\'une d\'elles, rien', async () => {
    const w = deType(await construire({ ...DICOS, 'deux.mjs': '@i18n \'panier\' \'autre\'\n\n<p>{µt(\'seule\')}</p>\n' }, CONFIG), 'i18nKeyUnknown')
    assert.deepEqual(w, [])
  })

  it('lint.i18nKeyUnknown: false coupe l\'avertissement', async () => {
    const w = await construire({ ...DICOS, 'accueil.mjs': '<p>{µt(\'nav.fermr\')}</p>\n' }, { ...CONFIG, lint: { i18nKeyUnknown: false } })
    assert.deepEqual(deType(w, 'i18nKeyUnknown'), [])
  })
})

describe('build — propUnknown : un avertissement seulement quand c\'est sûr', function () {
  this.timeout(60000)

  const FICHE = '<h2>{$titre}</h2>\n'

  it('un module que l\'enfant importe lit l\'attribut, à toute profondeur, par un nom écrit en dur ou calculé : rien', async () => {
    const fichiers = {
      'page.mjs':          '<@civetlit mode="x" niveau="2"></@civetlit>\n<@libre zzz="1"></@libre>\n',
      'civetlit.mjs':      '@import lire \'lib/lecteur.civet.mjs\'\n\n<script>\n  µmount ->\n    lire(@)\n</script>\n<p>civet</p>\n',
      'lib/lecteur.civet.mjs': '@import profond \'lib/profond.civet.mjs\'\n\nexport function lire(el) { profond(el); console.log(el.getAttribute(\'mode\')) }\n',
      'lib/profond.civet.mjs': 'export function profond(el) { console.log(el.getAttribute(\'niveau\')) }\n',
      'libre.mjs':         '@import tout \'lib/tout.civet.mjs\'\n\n<script>\n  µmount ->\n    tout(@, \'zzz\')\n</script>\n<p>libre</p>\n',
      'lib/tout.civet.mjs':    'export function tout(el, nom) { console.log(el.getAttribute(nom)) }\n',
    }
    assert.deepEqual(deType(await construire(fichiers), 'propUnknown'), [])
  })

  it('un module importé qui n\'a rien d\'une lecture (une expression régulière ancrée en fin, `…)$/`) laisse l\'enfant contrôlé : la faute reste signalée', async () => {
    const fichiers = {
      'page.mjs':        '<@graphe shape="line"></@graphe>\n',
      'graphe.mjs':      '@import teinte \'lib/maths.civet.mjs\'\n\n<p>{teinte(\'a\')}</p>\n',
      'lib/maths.civet.mjs': 'const TON = /^var\\(--[a-z]+\\)$/\nexport function teinte(x) { return TON.test(x) ? x : \'\' }\n',
    }
    const w = deType(await construire(fichiers), 'propUnknown')
    assert.equal(w.length, 1, JSON.stringify(w))
    assert.match(w[0], /<@graphe> porte l'attribut « shape »/)
  })

  it('un module importé depuis une adresse ne se lit pas : l\'enfant n\'est pas contrôlé', async () => {
    const fichiers = {
      'page.mjs':    '<@distant couleur="r"></@distant>\n',
      'distant.mjs': '@import lib \'https://exemple.test/lib.js\'\n\n<script>\n  µmount ->\n    lib(@)\n</script>\n<p>distant</p>\n',
    }
    assert.deepEqual(deType(await construire(fichiers), 'propUnknown'), [])
  })

  it('un modèle en fichier choisi à l\'exécution lit l\'attribut : tous les modèles de la base comptent', async () => {
    const fichiers = {
      'page.mjs':           '<@carte layout={$vue} titre="a" resume="r"></@carte>\n<script>\n  $vue = \'compacte\'\n</script>\n',
      'carte.mjs':          '<p>{$titre}</p>\n',
      'carte.compacte.mjs': '<p>{$titre} {$resume}</p>\n',
      'carte.large.mjs':    '<p>{$titre}</p>\n',
    }
    assert.deepEqual(deType(await construire(fichiers), 'propUnknown'), [])
  })

  it('un attribut que ni la base ni aucun de ses modèles ne lit : signalé une fois, avec le nom le plus proche', async () => {
    const fichiers = {
      'page.mjs':           '<@carte layout={$vue} titre="a" resme="r"></@carte>\n<script>\n  $vue = \'compacte\'\n</script>\n',
      'carte.mjs':          '<p>{$titre}</p>\n',
      'carte.compacte.mjs': '<p>{$titre} {$resume}</p>\n',
    }
    const w = deType(await construire(fichiers), 'propUnknown')
    assert.equal(w.length, 1, JSON.stringify(w))
    assert.match(w[0], /ligne 1, <@carte> porte l'attribut « resme »/)
    assert.match(w[0], /[Vv]ouliez-vous écrire « resume » \?/)
  })

  it('l\'enfant lit la liste de ses attributs (`@attributes`, sous toute forme) : rien', async () => {
    const fichiers = {
      'page.mjs':      '<@attributs couleur="r"></@attributs>\n<@crochets teinte="b"></@crochets>\n',
      'attributs.mjs': '<script>\n  µmount ->\n    for a of @attributes\n      console.log a.name\n</script>\n<p>attrs</p>\n',
      'crochets.mjs':  '<script>\n  µmount ->\n    console.log @[\'attributes\'].length\n</script>\n<p>crochets</p>\n',
    }
    assert.deepEqual(deType(await construire(fichiers), 'propUnknown'), [])
  })

  it('le style de l\'enfant lit l\'attribut par attr() : rien', async () => {
    const fichiers = {
      'page.mjs':    '<@cssattr etiquette="Nouveau"></@cssattr>\n',
      'cssattr.mjs': '<p>x</p>\n<style>\n  :host::after\n    content: attr(etiquette)\n</style>\n',
    }
    assert.deepEqual(deType(await construire(fichiers), 'propUnknown'), [])
  })

  it('un composant @formAssociated : form, readonly et required sont lus par le navigateur et le socle du formulaire ; une faute reste signalée', async () => {
    const fichiers = {
      'page.mjs':    '<form id="f1" action="/envoi"></form>\n<@oui-non name="accord" form="f1" readonly required disabled titel="x"></@oui-non>\n',
      'oui-non.mjs': '@formAssociated\n\n<script>\n  $oui = false\n  µeffect ->\n    $oui\n    @@internals?.setFormValue(if $oui then \'oui\' else null)\n</script>\n<button type="button" @click={$oui = not $oui}>{$oui}</button>\n',
    }
    const w = deType(await construire(fichiers), 'propUnknown')
    assert.equal(w.length, 1, JSON.stringify(w))
    assert.match(w[0], /« titel »/)
  })

  it('une feuille du projet cible l\'attribut : le style du parent, une feuille partagée — rien', async () => {
    const fichiers = {
      'page.mjs':          '<@fiche variante="large" titre="t"></@fiche>\n<@fiche ton="doux" titre="t"></@fiche>\n<style>\n  mjs-fiche[variante="large"]\n    font-size: 2em\n</style>\n',
      'fiche.mjs':         FICHE,
      'styles/theme.sass': 'mjs-fiche[ton]\n  color: blue\n',
    }
    assert.deepEqual(deType(await construire(fichiers, { stylesheetsDir: 'app/modularjs/styles' }), 'propUnknown'), [])
  })

  it('un partiel que l\'enfant inclut lit la prop ou l\'attribut (gabarit, script) : rien', async () => {
    const fichiers = {
      'page.mjs':   '<@fiche titre="a" sorte="b"></@fiche>\n',
      'fiche.mjs':  '<@include corps>\n',
      '_corps.mjs': '<h2>{$titre}</h2>\n<script>\n  µmount ->\n    console.log @getAttribute(\'sorte\')\n</script>\n',
    }
    assert.deepEqual(deType(await construire(fichiers), 'propUnknown'), [])
  })

  it('l\'enfant lit l\'attribut par un sélecteur de son script (matches, closest) ou par getAttributeNode : rien', async () => {
    const fichiers = {
      'page.mjs':      '<@selecteur variante="large" ton="doux"></@selecteur>\n',
      'selecteur.mjs': '<script>\n  µmount ->\n    console.log @matches(\'[variante="large"]\'), @getAttributeNode(\'ton\')\n</script>\n<p>s</p>\n',
    }
    assert.deepEqual(deType(await construire(fichiers), 'propUnknown'), [])
  })

  it('l\'enfant lit son état par un nom calculé (`$[nom]`) : tout attribut peut lui servir, rien', async () => {
    const fichiers = {
      'page.mjs':    '<@calcule titre="a"></@calcule>\n',
      'calcule.mjs': '<script>\n  $champ = \'titre\'\n</script>\n<p>{$[$champ]}</p>\n',
    }
    assert.deepEqual(deType(await construire(fichiers), 'propUnknown'), [])
  })

  it('en développement (même Bundler, plusieurs tours) : un enfant revenu du cache garde ce que lisent ses modules ; s\'il perd $titre, l\'avertissement paraît', async () => {
    const enfant = '@import lire \'lib/lecteur.civet.mjs\'\n\n<script>\n  µmount ->\n    lire(@)\n</script>\n<p>{$titre}</p>\n'
    const root   = projet({ 'page.mjs': '<@civetlit mode="x" titre="t"></@civetlit>\n', 'civetlit.mjs': enfant, 'lib/lecteur.civet.mjs': 'export function lire(el) { console.log(el.getAttribute(\'mode\')) }\n' })
    const dir    = join(root, 'app', 'modularjs')
    const found  = findConfig(root)
    assert.ok(found, 'mjs.config.json doit être trouvé')
    const bundler = new Bundler(resolveBundlerOpts(found!.config, root) as any)
    const tour    = async () => {
      const stats = await bundler.compile()
      assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))
      return deType(stats.warnings, 'propUnknown')
    }
    assert.deepEqual(await tour(), [])
    writeFileSync(join(dir, 'page.mjs'), '<@civetlit mode="x" titre="t"></@civetlit>\n<p>page</p>\n')
    assert.deepEqual(await tour(), [], 'l\'enfant revient du cache, ses modules importés avec lui')
    writeFileSync(join(dir, 'civetlit.mjs'), enfant.replace('{$titre}', 'civet'))
    const w = await tour()
    assert.equal(w.length, 1, JSON.stringify(w))
    assert.match(w[0], /« titre »/)
  })

  it('le parent lit l\'attribut de l\'enfant (getAttribute écrit en dur dans son script) : rien', async () => {
    const page = '<@fiche variante="x" titre="t"></@fiche>\n<script>\n  µmount ->\n    console.log @querySelector(\'mjs-fiche\').getAttribute(\'variante\')\n</script>\n'
    assert.deepEqual(deType(await construire({ 'page.mjs': page, 'fiche.mjs': FICHE }), 'propUnknown'), [])
  })
})

describe('build — propUnknown : la ligne de la balise quand le HTML compilé n\'a plus les lignes du fichier', function () {
  this.timeout(60000)

  const FICHE = '<h2>{$titre}</h2>\n'

  it('une page récrite avant la compilation (µt dans un attribut, bloc <@head> retiré) : ses balises gardent leur ligne', async () => {
    const page = '<@head>\n  <title>x</title>\n  <meta name="a" content="b">\n</@head>\n<p :title={µt(\'aide\')}>x</p>\n<main>\n  <@fiche titel="x"></@fiche>\n</main>\n'
    const w    = deType(await construire({ 'page.mjs': page, 'fiche.mjs': FICHE }), 'propUnknown')
    assert.equal(w.length, 1, JSON.stringify(w))
    assert.match(w[0], /page\.mjs : ligne 7, <@fiche>/)
  })

  it('un partiel inclus : les balises du composant ont leur ligne, celle du partiel n\'en a pas', async () => {
    const fichiers = {
      'page.mjs':    '<main>\n  <@include entete>\n  <@fiche titel="y"></@fiche>\n</main>\n',
      '_entete.mjs': '<header>\n  <@fiche titel="x"></@fiche>\n</header>\n',
      'fiche.mjs':   FICHE,
    }
    const w = deType(await construire(fichiers), 'propUnknown')
    assert.equal(w.length, 2, JSON.stringify(w))
    assert.ok(w.some(l => /page\.mjs : ligne 3, <@fiche>/.test(l)), JSON.stringify(w))
    assert.ok(w.some(l => /page\.mjs : <@fiche>/.test(l)), JSON.stringify(w))
  })

  it('le texte d\'une balise que le composant et un partiel écrivent à l\'identique ne se départage pas : sans ligne, jamais une ligne inventée', async () => {
    const fichiers = {
      'page.mjs':    '<main>\n  <@include entete>\n  <@fiche titel="x"></@fiche>\n</main>\n',
      '_entete.mjs': '<header>\n  <@fiche titel="x"></@fiche>\n</header>\n',
      'fiche.mjs':   FICHE,
    }
    const w = deType(await construire(fichiers), 'propUnknown')
    assert.equal(w.length, 1, JSON.stringify(w))
    assert.match(w[0], /page\.mjs : <@fiche>/)
  })
})

describe('parser — les balises des composants du projet, relevées à part (ParseDiag.projectTags)', () => {
  it('nom, attributs écrits, étalement, ligne, texte et rang ; les références gardent leur forme', () => {
    const refs: TagRef[]         = []
    const tags: ProjectTagSeen[] = []
    parse('<p>\n  <@fiche titre="a"></@fiche>\n  <mjs-fiche titre="a" {...$p}></mjs-fiche>\n  <@fiche titre="a"></@fiche>\n</p>', refs, { projectTags: tags })
    assert.deepEqual(refs, [{ name: 'fiche', kind: 'shortcut-dev' }, { name: 'fiche', kind: 'literal-dev' }, { name: 'fiche', kind: 'shortcut-dev' }])
    assert.deepEqual(tags.map(g => [g.name, g.kind, g.names, g.spread, g.line, g.text, g.rank, g.total]), [
      ['fiche', 'shortcut-dev', ['titre'], false, 2, '<@fiche titre="a"', 0, 2],
      ['fiche', 'literal-dev', ['titre'], true, 3, '<mjs-fiche titre="a" {...$p}', 0, 1],
      ['fiche', 'shortcut-dev', ['titre'], false, 4, '<@fiche titre="a"', 1, 2],
    ])
  })

  it('un modèle en fichier : écrit en dur, la balise du modèle ; choisi à l\'exécution, la base et la liste de ses modèles', () => {
    const tags: ProjectTagSeen[] = []
    parse('<@carte layout="compacte" a="1"></@carte><@carte layout={$vue} b="2"></@carte>', [], { projectTags: tags, models: { dev: { carte: ['compacte', 'large'] } } })
    assert.deepEqual(tags.map(g => [g.name, g.names, g.models]), [['carte--compacte', ['layout', 'a'], undefined], ['carte', ['layout', 'b'], ['compacte', 'large']]])
  })

  it('un module du cœur, une balise d\'une autre bibliothèque : pas une balise du projet', () => {
    const tags: ProjectTagSeen[] = []
    parse('<@@select other></@@select><mjs-core-select></mjs-core-select><sl-button variante="x"></sl-button>', [], { projectTags: tags })
    assert.deepEqual(tags, [])
  })
})

describe('build — i18nKeyUnknown : le message dit ce que l\'écran montre', function () {
  this.timeout(60000)

  const DICO = { 'i18n/fr.yml': 'nav:\n  fermer: Fermer\n' }

  it('⟦clé⟧ en développement comme en production', async () => {
    const w = deType(await construire({ ...DICO, 'accueil.mjs': '<p>{µt(\'nav.fermr\')}</p>\n' }, { i18n: { default: 'fr' } }), 'i18nKeyUnknown')
    assert.equal(w.length, 1, JSON.stringify(w))
    assert.match(w[0], /l'écran montrera ⟦nav\.fermr⟧, en développement comme en production\./)
    assert.doesNotMatch(w[0], /barre|texte vide/)
  })

  it('sous le réglage key (du config ou du module), le même message', async () => {
    const config = deType(await construire({ ...DICO, 'accueil.mjs': '<p>{µt(\'nav.fermr\')}</p>\n' }, { i18n: { default: 'fr', placeholder: 'key' } }), 'i18nKeyUnknown')
    const module = deType(await construire({ ...DICO, 'accueil.mjs': '@i18nPlaceholder key\n\n<p>{µt(\'nav.fermr\')}</p>\n' }, { i18n: { default: 'fr' } }), 'i18nKeyUnknown')
    for (const w of [config, module]) {
      assert.equal(w.length, 1, JSON.stringify(w))
      assert.match(w[0], /l'écran montrera ⟦nav\.fermr⟧, en développement comme en production\./)
    }
  })

  it('en anglais, au même sens', () => {
    const vars  = { file: 'a.mjs', line: 2, written: 'nav.fermr', key: 'nav.fermr', dict: 'i18n/fr.yml', addition: 'nav.fermr', lang: 'fr' }
    const avant = getMessagesLang()
    setMessagesLang('en')
    try {
      assert.match(t('bundler.build-checks.key-missing', vars), /the screen will show ⟦nav\.fermr⟧, in development as in production\./)
    }
    finally {
      setMessagesLang(avant)
    }
  })
})

describe('les trois types : table de la doc, gravité, mjs check --json', function () {
  this.timeout(90000)

  const TYPES = ['propUnknown', 'routeUnknown', 'i18nKeyUnknown']

  it('chaque type est un avertissement, avec sa ligne dans la table de docs/32-cli-et-configuration.md', () => {
    const doc = readFileSync(join(repoRoot, 'docs', '32-cli-et-configuration.md'), 'utf-8').split('\n')
    for (const type of TYPES) {
      assert.equal((LINT_SEVERITY as Record<string, string>)[type], 'warning', type)
      assert.ok(doc.some(l => l.startsWith(`| \`${type}\` | avertissement |`)), `ligne de la table pour ${type}`)
    }
  })

  it('mjs check --json : le type, le fichier, la ligne et quoi écrire pour chacun', () => {
    const root = projet({
      'i18n/fr.yml':  'nav:\n  fermer: Fermer\n',
      'app.page.mjs': '<routes target="app">\n  /        fiche\n  /profil  fiche\n</routes>\n<a href="#/profl">Profil</a>\n<@fiche titel="x"></@fiche>\n<p>{µt(\'nav.fermr\')}</p>\n<@view app>\n',
      'fiche.mjs':    '<h2>{$titre}</h2>\n',
    }, { i18n: { default: 'fr' } })
    const r      = spawnSync('npx', ['tsx', 'src/cli.ts', 'check', '--json', '--root', root], { cwd: repoRoot, encoding: 'utf-8' })
    const report = JSON.parse(r.stdout)
    assert.equal(r.status, 0, r.stderr)
    const attendus: Record<string, { line: number, fix: RegExp }> = {
      propUnknown:    { line: 6, fix: /^titre$/ },
      routeUnknown:   { line: 5, fix: /^#\/profil$/ },
      i18nKeyUnknown: { line: 7, fix: /^nav\.fermer$/ },
    }
    for (const [type, att] of Object.entries(attendus)) {
      const d = report.warnings.find((x: any) => x.type === type)
      assert.ok(d, `${type} dans ${JSON.stringify(report.warnings)}`)
      assert.equal(d.severity, 'warning')
      assert.equal(d.file, 'app/modularjs/app.page.mjs')
      assert.equal(d.line, att.line, JSON.stringify(d))
      assert.match(d.fix ?? '', att.fix, JSON.stringify(d))
    }
  })
})

describe('build — des cas justes muets : feuille de modèle déposée à la main, lien écrit dans une zone de saisie, clé citée d\'abord dans un commentaire', function () {
  this.timeout(60000)

  it('une feuille de modèle déposée à la main dans le dossier de sortie (`boite.alt.css`) vise l\'attribut : rien ; un attribut que rien ne lit reste signalé', async () => {
    const w = deType(await construire({
      'page.mjs':                '<@boite layout="alt" taille="l"></@boite>\n<@boite epaisseur="2"></@boite>\n',
      'boite.mjs':               '<p>{$titre}</p>\n',
      '../../out/boite.alt.css': ':host([taille="l"]) { width: 20em }\n',
    }), 'propUnknown')
    assert.equal(w.length, 1, JSON.stringify(w))
    assert.match(w[0], /ligne 2\b/)
    assert.match(w[0], /« epaisseur »/)
  })

  it('un lien écrit dans une zone de saisie (<textarea>) est du texte : rien ; le lien mort du gabarit reste signalé, à sa ligne', async () => {
    const page = '<routes target="a">\n  /x  px\n</routes>\n<@view a>\n<textarea><a href="#/mort1">t</a></textarea>\n<textarea name="n">\n  <a href=\'#/mort2\'>u</a>\n</textarea>\n<a href="#/mort3">v</a>\n'
    const w    = deType(await construire({ 'app.page.mjs': page, 'px.mjs': '<p>x</p>\n' }), 'routeUnknown')
    assert.equal(w.length, 1, JSON.stringify(w))
    assert.match(w[0], /« #\/mort3 »/)
    assert.match(w[0], /ligne 9\b/)
  })

  it('une clé citée d\'abord dans un commentaire (du script, du gabarit) : la ligne de l\'appel, jamais celle du commentaire', async () => {
    const fichiers = {
      'i18n/fr.yml': 'ok: OK\n',
      'script.mjs':  '<script>\n  # avant : µt(\'manque.ici\')\n  // aussi : µt(\'manque.ici\')\n  /* encore : µt(\'manque.ici\') */\n  msg = µt(\'manque.ici\')\n</script>\n<p>{msg}</p>\n',
      'gabarit.mjs': '<!-- ancien : {µt(\'manque.la\')} -->\n<p>{µt(\'ok\')}</p>\n<p>{µt(\'manque.la\')}</p>\n',
    }
    const w = deType(await construire(fichiers, { i18n: { default: 'fr' } }), 'i18nKeyUnknown')
    assert.equal(w.length, 2, JSON.stringify(w))
    assert.match(w.find(l => l.includes('manque.ici')) ?? '', /script\.mjs : ligne 5\b/)
    assert.match(w.find(l => l.includes('manque.la')) ?? '', /gabarit\.mjs : ligne 3\b/)
  })
})

describe('build — routeUnknown : la route de repli et la table que le script écrit', function () {
  this.timeout(60000)

  const PAGES = { 'accueil.mjs': '<p>accueil</p>\n', 'profil.mjs': '<p>profil</p>\n', 'docs.mjs': '<p>docs</p>\n', 'introuvable.mjs': '<p>introuvable</p>\n' }

  it('un lien que seule la route de repli (`/*`) prend est signalé, avec la route voisine ; une route joker sous un chemin (`/docs/*`) est une vraie route', async () => {
    const page = '<routes target="app">\n  /         accueil\n  /profil   profil\n  /docs/*   docs\n  /*        introuvable\n</routes>\n<a href="#/profil">p</a>\n<a href="#/docs/a/b">d</a>\n<a href="#/">a</a>\n<a href="#/profl">f</a>\n<@view app>\n'
    const w    = deType(await construire({ 'app.page.mjs': page, ...PAGES }), 'routeUnknown')
    assert.equal(w.length, 1, JSON.stringify(w))
    assert.match(w[0], /ligne 10\b/)
    assert.match(w[0], /« #\/profl »/)
    assert.match(w[0], /« \/\* »/)
    assert.match(w[0], /[Vv]ouliez-vous écrire « #\/profil » \?/)
  })

  it('tables imbriquées (une mise en page sur `/*`, sa table et sa page introuvable) : un lien qu\'une vraie route prend passe, la faute est signalée', async () => {
    const fichiers = {
      'app.page.mjs':          '<routes target="racine">\n  /bienvenue  accueil\n  /*          mise-en-page\n</routes>\n<@view racine>\n',
      'mise-en-page.page.mjs': '<routes target="main">\n  /chemin       profil\n  /chemin/:tab  profil\n  /*            introuvable\n</routes>\n<nav>\n  <a href="#/chemin">c</a>\n  <a href="#/chemin/a">t</a>\n  <a href="#/bienvenue">b</a>\n  <a href="#/cheminn">f</a>\n</nav>\n<@view main>\n',
      ...PAGES,
    }
    const w = deType(await construire(fichiers), 'routeUnknown')
    assert.equal(w.length, 1, JSON.stringify(w))
    assert.match(w[0], /mise-en-page\.page\.mjs : ligne 10\b/)
    assert.match(w[0], /« #\/cheminn »/)
  })

  it('un joker que seuls des segments facultatifs précèdent (`/(:lang)/*`) prend tout chemin : une route de repli comme `/*`', async () => {
    const page = '<routes target="app">\n  /(:lang)/*     accueil\n  /:lang/profil  profil\n</routes>\n<a href="#/fr/profil">p</a>\n<a href="#/fr/profl">f</a>\n<@view app>\n'
    const w    = deType(await construire({ 'app.page.mjs': page, ...PAGES }), 'routeUnknown')
    assert.equal(w.length, 1, JSON.stringify(w))
    assert.match(w[0], /« #\/fr\/profl »/)
  })

  it('une table que le script écrit en toutes lettres (`@routes[\'app\'][\'/extra\'] = …`, `@routes = …`) se connaît : ses routes prennent leurs liens, la faute reste signalée', async () => {
    const bloc  = '<routes target="app">\n  /         accueil\n  /profil   profil\n</routes>\n<a href="#/extra">e</a>\n<a href="#/profl">f</a>\n<@view app>\n<script>\n  @routes[\'app\'][\'/extra\'] = \'accueil\'\n</script>\n'
    const seule = '<a href="#/a-propos">a</a>\n<a href="#/contct">c</a>\n<@view main>\n<script>\n  @routes =\n    main:\n      \'/\': \'accueil\'\n      \'/a-propos\': \'profil\'\n      \'/contact\': \'profil\'\n</script>\n'
    const w1    = deType(await construire({ 'app.page.mjs': bloc, ...PAGES }), 'routeUnknown')
    assert.equal(w1.length, 1, JSON.stringify(w1))
    assert.match(w1[0], /« #\/profl »/)
    const w2 = deType(await construire({ 'app.page.mjs': seule, ...PAGES }), 'routeUnknown')
    assert.equal(w2.length, 1, JSON.stringify(w2))
    assert.match(w2[0], /« #\/contct »/)
    assert.match(w2[0], /[Vv]ouliez-vous écrire « #\/contact » \?/)
  })

  it('une table que le script calcule (un chemin calculé, la table passée à une fonction, une valeur calculée, la table tirée de @) : rien, elle peut prendre tout lien', async () => {
    const debut = '<routes target="app">\n  /  accueil\n</routes>\n<a href="#/profl">f</a>\n<@view app>\n'
    for (const script of [
      '<script>\n  chemin = \'/profil\'\n  @routes[\'app\'][chemin] = \'profil\'\n</script>\n',
      '<script>\n  ajoute = (t) -> t.app[\'/profil\'] = \'profil\'\n  ajoute(@routes)\n</script>\n',
      '<script>\n  @routes = \'app\': Object.fromEntries([[\'/profil\', \'profil\']])\n</script>\n',
      '<script>\n  { routes } = @\n  routes.app[\'/profil\'] = \'profil\'\n</script>\n',
    ]) {
      assert.deepEqual(deType(await construire({ 'app.page.mjs': debut + script, ...PAGES }), 'routeUnknown'), [], script)
    }
  })
})

describe('build — un contrôle de construction ne fait jamais échouer ni lever', function () {
  this.timeout(90000)

  it('feuilles partagées et dossier de sortie hostiles (sous-dossier et feuille illisibles, lien cassé, fichier binaire) : la construction rend ce qu\'elle rend sans les contrôles, et la faute reste signalée', async () => {
    const illisibles = [] as string[]
    const hostile    = (root: string) => {
      const styles = join(root, 'styles')
      const sortie = join(root, 'out')
      mkdirSync(join(styles, 'sub'), { recursive: true })
      mkdirSync(sortie, { recursive: true })
      writeFileSync(join(styles, 'sub', 'a.css'), 'mjs-fiche[zzz] { color: red }\n')
      writeFileSync(join(styles, 'binaire.css'), Buffer.from([0, 255, 254, 0, 91, 120, 93, 0, 10, 200]))
      writeFileSync(join(sortie, 'fiche.vue.css'), 'mjs-fiche[yyy] { color: red }\n')
      symlinkSync(join(root, 'absent.css'), join(sortie, 'fiche.alt.css'))
      for (const f of [join(styles, 'sub'), join(sortie, 'fiche.vue.css')]) {
        chmodSync(f, 0o000)
        illisibles.push(f)
      }
    }
    const fichiers = { 'page.mjs': '<@fiche titel="x"></@fiche>\n', 'fiche.mjs': '<h2>{$titre}</h2>\n' }
    try {
      const avec     = await compiler(fichiers, { stylesheetsDir: 'styles' }, hostile)
      const sans     = await compiler(fichiers, { stylesheetsDir: 'styles', ...TROIS_COUPES }, hostile)
      const messages = (stats: typeof avec) => stats.errors.map(e => e.message.replace(/mjs-lint-construction-\w+/g, '…'))
      assert.deepEqual(messages(avec), messages(sans))
      assert.equal(avec.errors.length, 0, messages(avec).join('\n'))
      const w = deType(avec.warnings, 'propUnknown')
      assert.equal(w.length, 1, JSON.stringify(w))
      assert.match(w[0], /« titel »/)
    }
    finally {
      for (const f of illisibles) chmodSync(f, 0o755)
    }
  })

  it('un contrôle croisé qui lève se tait : aucune erreur de plus', async () => {
    const stats = await compiler({ 'page.mjs': '<@fiche titel="x"></@fiche>\n', 'fiche.mjs': '<h2>{$titre}</h2>\n' }, {}, (_root, bundler) => {
      (bundler as any).runBuildChecks = () => { throw new Error('panne du contrôle') }
    })
    assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))
  })

  it('un composant qui ne se compile pas : les mêmes erreurs que sans les trois contrôles, et aucun lien dit mort (la table du projet ne se connaît plus)', async () => {
    const fichiers = {
      'casse.mjs':    '<p>x</p>\n<script>\n  a = (\n</script>\n',
      'app.page.mjs': '<routes target="app">\n  /  accueil\n</routes>\n<a href="#/profl">f</a>\n<@view app>\n',
      'accueil.mjs':  '<p>accueil</p>\n',
    }
    const avec = await compiler(fichiers)
    const sans = await compiler(fichiers, TROIS_COUPES)
    assert.ok(avec.errors.length > 0, 'le composant cassé doit échouer')
    const messages = (stats: typeof avec) => stats.errors.map(e => e.message.replace(/mjs-lint-construction-\w+/g, '…'))
    assert.deepEqual(messages(avec), messages(sans))
    assert.deepEqual(deType(avec.warnings, 'routeUnknown'), [])
  })
})

describe('build — routeUnknown : seuls les liens des éléments <a>, et seulement quand toute la table se connaît', function () {
  this.timeout(120000)

  const APP   = '<routes target="app">\n  /  accueil\n</routes>\n<a href="#/profl">f</a>\n<@view app>\n'
  const PAGES = { 'accueil.mjs': '<p>accueil</p>\n' }

  it('un texte, une chaîne, un commentaire, une zone de saisie ne sont pas des liens ; un lien après une <textarea /> autofermée est vu, à sa ligne', async () => {
    const page = '<routes target="app">\n  /x  px\n</routes>\n<@view app>\n<p>{"<a href=\'#/mort-texte\'>"} &lt;a href="#/mort-entite"&gt;</p>\n<!-- <a href="#/mort-commentaire">c</a> -->\n<textarea><a href="#/mort-zone">t</a></textarea>\n<textarea value={$x} />\n<a href="#/mort-apres">a</a>\n<a href="#/x">x</a>\n<script>\n  $x = \'a\'\n  gabarit = \'<a href="#/mort-script">s</a>\'\n</script>\n'
    const w    = deType(await construire({ 'app.page.mjs': page, 'px.mjs': '<p>x</p>\n' }), 'routeUnknown')
    assert.equal(w.length, 1, JSON.stringify(w))
    assert.match(w[0], /« #\/mort-apres »/)
    assert.match(w[0], /app\.page\.mjs : ligne 9\b/)
  })

  it('un script, un module, un gabarit qui nomme `routes` autrement qu\'en toutes lettres sur @, ou laisse le composant à un autre code : rien, pour tout le projet', async () => {
    const script = (code: string) => `<p>c</p>\n<script>\n${code}</script>\n`
    const cas: Record<string, Record<string, string>> = {
      'arobase-double':    { 'cas.page.mjs': script('  µmount ->\n    @@routes.app[\'/profl\'] = \'accueil\'\n') },
      'alias':             { 'cas.page.mjs': script('  self = @\n  self.routes.app[\'/profl\'] = \'accueil\'\n') },
      'fonction-recoit':   { 'cas.page.mjs': script('  ajoute = (c) -> c.routes.app[\'/profl\'] = \'accueil\'\n  ajoute(@)\n') },
      'object-assign':     { 'cas.page.mjs': script('  Object.assign @, routes: app: \'/profl\': \'accueil\'\n') },
      'composant-passe':   { 'cas.page.mjs': script('  µmount ->\n    brancher(@)\n') },
      'nom-calcule':       { 'cas.page.mjs': script('  cle = \'rou\' + \'tes\'\n  @[cle].app[\'/profl\'] = \'accueil\'\n') },
      'range-ailleurs':    { 'cas.page.mjs': script('  window.appli = @\n') },
      'module-importe':    { 'cas.page.mjs': '@import brancher \'lib/branche.civet.mjs\'\n\n<p>c</p>\n<script>\n  µmount ->\n    brancher()\n</script>\n', 'lib/branche.civet.mjs': 'export function brancher() { document.querySelector(\'mjs-app\').routes.app[\'/profl\'] = \'accueil\' }\n' },
      'script-module':     { 'cas.page.mjs': '<script module>\n  export brancher = -> document.querySelector(\'mjs-app\').routes.app[\'/profl\'] = \'accueil\'\n</script>\n<p>c</p>\n' },
      'gestionnaire':      { 'cas.page.mjs': '<button @click={@routes.app[\'/profl\'] = \'accueil\'}>b</button>\n' },
      'gabarit-composant': { 'cas.page.mjs': '<@accueil parent={@}></@accueil>\n' },
    }
    for (const [nom, fichiers] of Object.entries(cas)) {
      const stats = await compiler({ 'app.page.mjs': APP, ...PAGES, ...fichiers })
      assert.equal(stats.errors.length, 0, `${nom} : ${stats.errors.map(e => e.message).join('\n')}`)
      assert.deepEqual(deType(stats.warnings, 'routeUnknown'), [], nom)
    }
  })

  it('un module importé qui ne cite `routes` qu\'en commentaire laisse le contrôle : la faute reste signalée', async () => {
    const cas = '@import aide \'lib/aide.civet.mjs\'\n\n<p>c</p>\n<script>\n  µmount ->\n    aide()\n</script>\n'
    const w   = deType(await construire({ 'app.page.mjs': APP, ...PAGES, 'cas.mjs': cas, 'lib/aide.civet.mjs': '// les onglets sont des routes : la page remonte\nexport function aide() { return 1 }\n' }), 'routeUnknown')
    assert.equal(w.length, 1, JSON.stringify(w))
  })

  it('un composant qui se nomme autrement sans rien faire de sa table (`@@x`, `self.x`, `@[\'x\']`, `if @`) laisse le contrôle : la faute reste signalée', async () => {
    const autre = '<p>c</p>\n<script>\n  @@compte = 1\n  self = @\n  self.titre = \'x\'\n  @[\'nom\'] = 2\n  if @ then @x = 1\n  µmount ->\n    µafter 0, -> @@compte += 1\n</script>\n'
    const w     = deType(await construire({ 'app.page.mjs': APP, ...PAGES, 'autre.mjs': autre }), 'routeUnknown')
    assert.equal(w.length, 1, JSON.stringify(w))
    assert.match(w[0], /app\.page\.mjs : ligne 4\b/)
  })
})

describe('build — routeUnknown : un `@` écrit en texte dans une accolade, un module du cœur, une route à segments facultatifs en nombre', function () {
  this.timeout(180000)

  const APP   = '<routes target="app">\n  /  accueil\n</routes>\n<a href="#/profl">f</a>\n<@view app>\n'
  const PAGES = { 'accueil.mjs': '<p>accueil</p>\n' }

  it('le texte d\'une chaîne ou d\'un commentaire d\'une accolade (`{\'@\'}`, `{"@"}`, `` {`@`} ``, `{x /* @ */}`) ne laisse pas le composant à un autre code : la faute reste signalée', async () => {
    for (const gabarit of [
      '<p><b>{u.nom}</b>{if u.alias}<small>{\'@\'}{u.alias}</small>{end}</p>\n<script>\n  u = { nom: \'a\', alias: \'b\' }\n</script>\n',
      '<p>{"@"} {`@`} {\'@\' + x} {`@${x}`} {"this"} {\'eval\'}</p>\n<script>\n  x = 1\n</script>\n',
      '<p>{x /* @ */}</p>\n<script>\n  x = 1\n</script>\n',
    ]) {
      const w = deType(await construire({ 'app.page.mjs': APP, ...PAGES, 'cas.mjs': gabarit }), 'routeUnknown')
      assert.equal(w.length, 1, gabarit + JSON.stringify(w))
      assert.match(w[0], /app\.page\.mjs : ligne 4\b/)
    }
  })

  it('le code d\'une accolade qui laisse le composant à un autre code (`{@}`, `{f(@)}`, `{@[nom]}`, `` {`${@}`} ``, `{"#{f(@)}"}`) garde le contrôle muet', async () => {
    for (const gabarit of [
      '<p>{@}</p>\n',
      '<p>{f(@)}</p>\n<script>\n  f = (c) -> 1\n</script>\n',
      '<p>{@[nom]}</p>\n<script>\n  nom = \'x\'\n</script>\n',
      '<p>{`${@}`}</p>\n',
      '<p>{"#{f(@)}"}</p>\n<script>\n  f = (c) -> 1\n</script>\n',
    ]) {
      const stats = await compiler({ 'app.page.mjs': APP, ...PAGES, 'cas.mjs': gabarit })
      assert.equal(stats.errors.length, 0, `${gabarit} : ${stats.errors.map(e => e.message).join('\n')}`)
      assert.deepEqual(deType(stats.warnings, 'routeUnknown'), [], gabarit)
    }
  })

  it('un module du cœur qui se passe lui-même à une fonction (`<@@radio>`, `<@@select>`, `<@@sortable group>`) ne remplit pas la table du projet : la faute reste signalée', async () => {
    for (const gabarit of [
      '<@@radio value="a">A</@@radio>\n',
      '<@@select>\n  <@@option value="a">A</@@option>\n</@@select>\n',
      '<@@sortable group="g"><div class="p">x</div></@@sortable>\n',
    ]) {
      const w = deType(await construire({ 'app.page.mjs': APP, ...PAGES, 'cas.mjs': gabarit }), 'routeUnknown')
      assert.equal(w.length, 1, gabarit + JSON.stringify(w))
      assert.match(w[0], /app\.page\.mjs : ligne 4\b/)
    }
  })

  it('une route à trente segments facultatifs devant un lien qu\'elle ne prend pas : la réponse sous la seconde', () => {
    const route  = '/' + Array.from({ length: 30 }, (_, i) => `(:p${i})`).join('/') + '/fin'
    const href   = '#/' + Array.from({ length: 15 }, (_, i) => String(i + 1)).join('/')
    const checks = { props: [], targets: [], tags: [], keys: [], links: [{ href, line: 4 }, { href: href + '/fin', line: 5 }], routes: [route], routesScript: false }
    const debut  = performance.now()
    const w      = checkProject({ components: [{ file: 'rx.page.mjs', moduleName: 'rx', core: false, checks }], targets: new Set(), dictionary: null })
    const duree  = performance.now() - debut
    assert.equal(deType(w, 'routeUnknown').length, 1, JSON.stringify(w))
    assert.match(w[0], /rx\.page\.mjs : ligne 4\b/)
    assert.ok(duree < 1000, `${Math.round(duree)} ms`)
  })

  it('la recherche qui garde chaque position en mémoire rend les réponses de la recherche pas à pas, sur des milliers de couples tirés au hasard', () => {
    // la recherche sans mémoire, la référence : chaque segment facultatif essayé présent, puis absent
    const pasAPas = (route: string, chemin: string): boolean => {
      const rp     = route.split('/').filter(Boolean)
      const mp     = chemin.split('/').filter(Boolean)
      const decode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }
      const essai  = (ri: number, mi: number): boolean => {
        if (ri >= rp.length) return mi >= mp.length
        let seg   = rp[ri]
        const opt = seg.startsWith('(') && seg.endsWith(')')
        if (opt) seg = seg.slice(1, -1)
        if (seg === '*') return true
        const present = mi < mp.length && (seg.startsWith(':') || seg === mp[mi] || seg === decode(mp[mi]))
        if (present && essai(ri + 1, mi + 1)) return true
        return opt && essai(ri + 1, mi)
      }
      return essai(0, 0)
    }
    // un tirage qui se rejoue à l'identique (générateur congruentiel, bits de poids fort)
    let graine   = 20261029
    const tirage = (n: number): number => {
      graine = (Math.imul(graine, 1664525) + 1013904223) >>> 0
      return Math.floor(graine / 4294967296 * n)
    }
    const SEGMENTS = ['a', 'b', 'café', ':x', ':y', '(a)', '(b)', '(café)', '(:z)', '*', '(*)']
    const VALEURS  = ['a', 'b', 'c', 'café', 'caf%C3%A9', '%E0%A4%A', '42', '']
    const valeur   = () => VALEURS[tirage(VALEURS.length)]
    let oui        = 0
    for (let n = 0; n < 20000; n++) {
      const route = '/' + Array.from({ length: tirage(9) }, () => SEGMENTS[tirage(SEGMENTS.length)]).join('/')
      // un chemin sur deux suit la route (segment facultatif pris ou laissé, valeur d'un paramètre, suite d'un joker), puis change parfois
      // d'un segment ; l'autre est tiré au hasard
      const suivi = [] as string[]
      for (const s of route.split('/').filter(Boolean)) {
        const nu = s.replace(/^\((.*)\)$/, '$1')
        if (nu !== s && tirage(2) === 0) continue
        if (nu === '*') {
          for (let k = tirage(3); k > 0; k--) suivi.push(valeur())
          break
        }
        suivi.push(nu.startsWith(':') ? valeur() : nu === 'café' && tirage(2) === 0 ? 'caf%C3%A9' : nu)
      }
      if (tirage(3) === 0) suivi.splice(tirage(suivi.length + 1), tirage(2), valeur())
      const chemin  = '/' + (tirage(2) === 0 ? suivi : Array.from({ length: tirage(9) }, valeur)).join('/')
      const attendu = pasAPas(route, chemin)
      assert.equal(routeMatches(route, chemin), attendu, `${route} ← ${chemin}`)
      if (attendu) oui++
    }
    // les deux réponses, chacune en nombre : le tirage ne joue pas qu'un seul cas
    assert.ok(oui > 3000 && oui < 17000, `${oui} oui sur 20000`)
  })
})

describe('build — routeUnknown : une expression régulière dans une accolade, une barre qui peut diviser ou ouvrir une expression régulière', function () {
  this.timeout(180000)

  const APP   = '<routes target="app">\n  /  accueil\n</routes>\n<a href="#/profl">f</a>\n<@view app>\n'
  const PAGES = { 'accueil.mjs': '<p>accueil</p>\n' }
  const VARS  = '<script>\n  s = \'a\'\n  p = \'/a\'\n  a = 4\n  b = 2\n  c = 1\n  f = (x) -> 1\n</script>\n'

  // la construction d'un projet dont le composant `cas.mjs` affiche l'accolade, lu par l'arbre
  async function sousLArbre(accolade: string) {
    const stats = await compiler({ 'app.page.mjs': APP, ...PAGES, 'cas.mjs': `<p>{${accolade}}</p>\n` + VARS })
    return [{ lecture: 'arbre', errors: stats.errors.map(e => e.message), routeUnknown: deType(stats.warnings, 'routeUnknown') }]
  }

  it('le code qui suit une expression régulière (apostrophe, guillemet ou `/*` dedans, classe, barre échappée ; après `(`, `,`, `=`, `return`) passe le composant à un autre code : le contrôle reste muet', async () => {
    for (const accolade of [
      's.replace(/\'/g, \'’\') + f(@) + \'!\'',
      'p.replace(/^\\/*/, \'\') + f(@)',
      's.split(/"/).map(f(@)).join("-")',
      's.replace(/[@\'"]/g, \'\') + f(@) + \'x\'',
      's.replace(/[\'"]/g, \'\') + f(@) + \'x\'',
      's.replace(/\\/\'/g, \'\') + f(@) + \'x\'',
      '[a, /\'/].length + f(@) + \'x\'',
      '(re = /\'/g) and f(@) + \'x\'',
      '(-> return /\'/.test(s))() + f(@) + \'x\'',
      '(-> return /}/.test(s))() + f(@)',
      's.replace ///\'///g, f(@) + \'x\'',
    ]) {
      for (const { lecture, errors, routeUnknown } of await sousLArbre(accolade)) {
        assert.deepEqual(errors, [], `{${accolade}} (${lecture})`)
        assert.deepEqual(routeUnknown, [], `{${accolade}} (${lecture})`)
      }
    }
  })

  it('une vraie division (`a / b / c`) n\'ouvre pas d\'expression régulière : le code entre deux barres reste du code', async () => {
    for (const accolade of ['a / f(@) / c', 'a / 2 + \' / \' + f(@) + \'!\'']) {
      for (const { lecture, errors, routeUnknown } of await sousLArbre(accolade)) {
        assert.deepEqual(errors, [], `{${accolade}} (${lecture})`)
        assert.deepEqual(routeUnknown, [], `{${accolade}} (${lecture})`)
      }
    }
  })

  it('le texte d\'une chaîne à côté d\'une expression régulière ou d\'une division sûres, une chaîne qui écrit `</` : la faute reste signalée', async () => {
    for (const accolade of ['s.replace(/\'/g, \'’\') + \'@\'', 's.replace(/x/g, \'\') + \'@\'', 'a / b / c + \'@\'', '\'</b>@\'', '"</b>" + \'@\'']) {
      for (const { lecture, errors, routeUnknown } of await sousLArbre(accolade)) {
        assert.deepEqual(errors, [], `{${accolade}} (${lecture})`)
        assert.equal(routeUnknown.length, 1, `{${accolade}} (${lecture}) ${JSON.stringify(routeUnknown)}`)
        assert.match(routeUnknown[0], /app\.page\.mjs : ligne 4\b/)
      }
    }
  })

  it('une barre qui peut aussi bien diviser qu\'ouvrir une expression régulière (appel sans parenthèses de Civet, après `typeof` ou `<`, `///`) : la suite du gabarit est lue comme du code, la moindre arobase fait taire le contrôle', () => {
    for (const [gabarit, muet] of [
      ['<p>{typeof /\'/ + f(@) + \'x\'}</p>\n', true],
      ['<p>{a /\'/ ; f(@) + \'x\'}</p>\n', true],
      ['<p>{x < /\'/.test(s) + f(@) + \'x\'}</p>\n', true],
      ['<p>{s.replace ///\'///g, f(@) + \'x\'}</p>\n', true],
      ['<p>{(-> return /}/.test(s))()\n  + f(@)}</p>\n', true],
      ['<p>{a /b/ c}</p>\n<p>{\'@\'}</p>\n', true],
      ['<p>{a /b/ c}</p>\n', false],
      ['<p>{s.replace(/@/g, \'\')}</p>\n', true],
      ['<p>{s.replace(/\'/g, \'’\') + \'@\'}</p>\n', false],
      ['<p>{x /* @ */}</p>\n', false],
    ] as [string, boolean][]) {
      assert.equal(templateNamesRoutes(gabarit), muet, gabarit)
    }
  })
})

describe('build — routeUnknown : un commentaire de ligne, une chaîne ou un gabarit de plusieurs lignes dans une accolade, lus comme le compilateur', function () {
  this.timeout(180000)

  const APP   = '<routes target="app">\n  /  accueil\n</routes>\n<a href="#/profl">f</a>\n<@view app>\n'
  const PAGES = { 'accueil.mjs': '<p>accueil</p>\n' }
  const VARS  = '<script>\n  s = \'a\'\n  a = 4\n  b = 2\n  f = (x) -> 1\n</script>\n'

  // la construction d'un projet dont le composant `cas.mjs` affiche l'accolade — ou l'inclut d'un partiel, que la construction lit sans
  // normaliser ses fins de ligne —, lu par l'arbre
  async function sousLArbre(accolade: string, partiel = false) {
    const cas   = partiel ? { 'cas.mjs': '<@include part>\n' + VARS, '_part.mjs': `<p>{${accolade}}</p>\n` } : { 'cas.mjs': `<p>{${accolade}}</p>\n` + VARS }
    const stats = await compiler({ 'app.page.mjs': APP, ...PAGES, ...cas })
    return [{ lecture: 'arbre', errors: stats.errors.map(e => e.message), routeUnknown: deType(stats.warnings, 'routeUnknown') }]
  }

  async function muet(accolades: string[], partiel = false) {
    for (const accolade of accolades) {
      for (const { lecture, errors, routeUnknown } of await sousLArbre(accolade, partiel)) {
        assert.deepEqual(errors, [], `{${accolade}} (${lecture})`)
        assert.deepEqual(routeUnknown, [], `{${accolade}} (${lecture})`)
      }
    }
  }

  async function signale(accolades: string[], partiel = false) {
    for (const accolade of accolades) {
      for (const { lecture, errors, routeUnknown } of await sousLArbre(accolade, partiel)) {
        assert.deepEqual(errors, [], `{${accolade}} (${lecture})`)
        assert.equal(routeUnknown.length, 1, `{${accolade}} (${lecture}) ${JSON.stringify(routeUnknown)}`)
        assert.match(routeUnknown[0], /app\.page\.mjs : ligne 4\b/)
      }
    }
  }

  it('un commentaire de ligne au premier niveau de l\'accolade, suivi d\'un accent grave, de `/*`, de `\'\'\'` ou de `"""` : le code de la ligne suivante passe le composant à un autre code, le contrôle reste muet', async () => {
    await muet(['a // un ` ici\n  + f(@)', 'a // voir /*\n  + f(@)', 'a // \'\'\'\n  + f(@)', 'a // """\n  + f(@)'])
  })

  it('`//` écrit dans une chaîne, dans une expression régulière ou dans l\'interpolation d\'un gabarit : le code qui suit passe le composant, le contrôle reste muet', async () => {
    await muet(['\'//\' + f(@) + \'!\'', 's.replace(/\\/\\//g, \'\') + f(@)', '`${a // c\n}` + f(@)'])
  })

  it('le texte d\'un commentaire de ligne n\'est pas du code : une arobase écrite dedans, ou dans une chaîne qui cite `//`, laisse la faute signalée', async () => {
    await signale(['a // @\n  + b', '\'//@\' + a'])
  })

  it('une chaîne sur plusieurs lignes (apostrophes, guillemets, guillemet échappé dedans, barre oblique inverse en fin de ligne) : le code qui la suit passe le composant, le contrôle reste muet', async () => {
    await muet(['\'x\n\' + f(@) + \'y\'', '"x\n" + f(@) + "y"', '\'l\\\'x\n\' + f(@) + \'y\'', '"l\\"x\n" + f(@) + "y"', '\'x\\\ny\' + f(@) + \'!\''])
  })

  it('un gabarit `${…}` sur plusieurs lignes : le code de son interpolation passe le composant ; une arobase de son texte laisse la faute signalée', async () => {
    await muet(['`a${\n  f(@)\n}b`'])
    await signale(['`a\n${b}\n@`'])
  })

  it('une forme que braceEnd peut lire autrement que le compilateur fait lire la suite du gabarit comme du code ; les formes qu\'ils lisent de même laissent parler le contrôle', () => {
    for (const [gabarit, attendu] of [
      ['<p>{a // un ` ici\n  + f(@)}</p>\n', true],
      ['<p>{a // @\n  + b}</p>\n', false],
      ['<p title={a // t}>{f(@)}</p>\n', true],
      ['<p>{\'x\n@\'}</p>\n', true],
      ['<p>{x # \'@\'}</p>\n', false],
      ['<p>{x # \'}\' + f(@)}</p>\n', true],
      ['<p>{"a #{b + "c"} d" + f(@)}</p>\n', true],
      ['<p>{"#{f(@)}"}</p>\n', true],
      ['<p>{"\\#{f(@)}"}</p>\n', false],
      ['<p>{\'\'\'it\'s\'\'\' + f(@) + \'x\'}</p>\n', true],
      ['<p>{"""a #{f(@)} b"""}</p>\n', true],
      ['<p>{"""a ${f(@)} b"""}</p>\n', false],
      ['<p>{```a ${f(@)} b```}</p>\n', true],
      ['<p>{a! / 2 + \'/\' + f(@) + \'/\' + \'x\'}</p>\n', true],
      ['<p>{if /}/.test(s)}<b>{f(@)}</b>{end}</p>\n', true],
    ] as [string, boolean][]) {
      assert.equal(templateNamesRoutes(gabarit), attendu, gabarit)
    }
  })

  it('un commentaire de ligne qu\'un retour chariot seul referme pour JavaScript, dans un partiel (lu sans normaliser ses fins de ligne) comme dans le fichier principal : le code qui suit passe le composant à un autre code, le contrôle reste muet ; sans arobase, la faute reste signalée', async () => {
    await muet(['a // x\r + f(@)\n'])
    await muet(['a // x\r + f(@)\n', 'a // x\r f(@)\n'], true)
    for (const partiel of [false, true]) await signale(['a // x\r + b\n'], partiel)
  })

  it('U+2028 ou U+2029 dans un commentaire de ligne, dans le fichier principal comme dans un partiel : le contrôle ne signale rien', async () => {
    for (const partiel of [false, true]) {
      for (const accolade of ['a // x\u2028 + f(@)\n', 'a // x\u2029 + f(@)\n']) {
        for (const { lecture, routeUnknown } of await sousLArbre(accolade, partiel)) assert.deepEqual(routeUnknown, [], `${JSON.stringify(accolade)} ${partiel ? 'partiel' : 'principal'} (${lecture})`)
      }
    }
  })

  it('un retour chariot seul, U+2028 ou U+2029 referment un commentaire de ligne avant le saut de ligne que lit braceEnd : la suite du gabarit est lue comme du code, la moindre arobase fait taire le contrôle ; `\\r\\n` reste une seule fin de ligne', () => {
    for (const [gabarit, attendu] of [
      ['<p>{a // x\r + f(@)\n}</p>\n', true],
      ['<p>{a // x\r f(@)\n}</p>\n', true],
      ['<p>{a // x\u2028 + f(@)\n}</p>\n', true],
      ['<p>{a // x\u2029 + f(@)\n}</p>\n', true],
      ['<p title={a // x\r + f(@)\n}>t</p>\n', true],
      ['<p>{a // x\r + b\n}</p>\n', false],
      ['<p>{a // x\u2028 + b\n}</p>\n', false],
      ['<p>{a // @\r\n + b}</p>\r\n', false],
    ] as [string, boolean][]) {
      assert.equal(templateNamesRoutes(gabarit), attendu, JSON.stringify(gabarit))
    }
  })

  it('des accolades douteuses sans arobase et des guillemets échappés jamais refermés, par dizaines de milliers : une seule lecture de la suite du gabarit', () => {
    for (const [nom, gabarit] of [
      ['40 000 accolades `{a /b/ c}`', '<p>{a /b/ c}</p>\n'.repeat(40000)],
      ['40 000 guillemets échappés', '<p>{' + '\'\\'.repeat(40000) + '}</p>\n'],
    ]) {
      const debut = performance.now()
      const nomme = templateNamesRoutes(gabarit)
      const duree = performance.now() - debut
      assert.equal(nomme, false, nom)
      assert.ok(duree < 150, `${nom} : ${Math.round(duree)} ms`)
    }
  })
})

describe('build — les lignes : celle de l\'appel, ou aucune', function () {
  this.timeout(60000)

  it('une clé citée d\'abord dans un commentaire de <style>, un texte ou une chaîne : la ligne de l\'appel ; une clé du seul partiel : sans ligne', async () => {
    const fichiers = {
      'i18n/fr.yml': 'ok: OK\n',
      'cles.mjs':    '<style>\n  /* µt(\'manque.cle\') */\n</style>\n<p>µt(\'manque.cle\') en texte</p>\n<@include bout>\n<script>\n  note = "voir µt(\'manque.cle\')"\n  msg = µt(\'manque.cle\')\n</script>\n<p>{msg} {note}</p>\n',
      '_bout.mjs':   '<p>{µt(\'manque.partiel\')}</p>\n',
    }
    const w = deType(await construire(fichiers, { i18n: { default: 'fr' } }), 'i18nKeyUnknown')
    assert.equal(w.length, 2, JSON.stringify(w))
    assert.match(w.find(l => l.includes('manque.cle')) ?? '', /cles\.mjs : ligne 8, µt/)
    assert.match(w.find(l => l.includes('manque.partiel')) ?? '', /cles\.mjs : µt\('manque\.partiel'\)/)
  })
})
