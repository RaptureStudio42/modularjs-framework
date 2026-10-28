// Fichier de page et navigation interne (UJS) — pourquoi ce test existe.
//
// Une route prérendue (`render.startup: 'bundle'`) est servie avec un fichier `mjs_page-<slug>-….js`
// qui assemble ses composants, et une fiche `<script type="application/json" id="__mjs_page">`
// que le manifeste lit AU DÉMARRAGE pour repointer `µ.paths[nom]` vers ce fichier. Défaut d'origine :
// à l'arrivée par un lien interne (échange du contenu par UJS, sans rechargement), la fiche de la
// page reçue n'était jamais relue. Le lien `modulepreload` du fichier de page était inséré, le
// fichier téléchargé (17 Ko compressés pour la doc, 59 Ko pour l'accueil), mais `µ.paths` pointait
// toujours les fichiers séparés : le fichier de page n'était jamais exécuté et les composants
// étaient redemandés un par un, en cascade (doc : 4 niveaux ; accueil : 28 fichiers sur 7 niveaux).
//
// Ce que le test garde : à chaque échange de page par UJS (clic, retour arrière rechargé depuis le
// réseau, soumission de formulaire, rafraîchissement de fond), la fiche du document REÇU est
// appliquée AVANT que le contenu ne soit installé (donc avant que l'Autoloader ne voie les balises) ;
// une fiche absente, abîmée ou mal formée ne change rien et ne lève jamais ; les valeurs posées sont
// celles de la fiche, telles quelles (même forme compacte que `µ.paths` : le préfixe factorisé
// `µ.pathsPrefix` n'est pas touché).
//
// Choix assumé : un nom présent dans la fiche de la page A et absent de celle de B garde le fichier
// de A, il n'est pas remis sur son fichier séparé. C'est juste parce que (1) ce fichier est déjà
// dans le cache du navigateur (il a servi A), (2) l'importer par son URL ne l'exécute qu'une fois,
// (3) tout composant déjà défini y est ignoré (`customElements.get` gardé dans la définition), et
// (4) l'Autoloader ne charge jamais une balise déjà définie. Remettre l'ancien chemin exigerait de
// le mémoriser au démarrage dans le manifeste, donc du poids dans CHAQUE fichier de départ.
//
// Méthode : extraction réelle de la fonction depuis la source (marqueurs `extrait-test`), happy-dom
// pour de vrais documents ; le branchement aux sites d'échange est vérifié sur la source.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { extractMarked } from './helpers/extract-marked.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UJS_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')

function monter(paths: Record<string, string> | undefined) {
  const win: any = new Window({ url: 'http://x/a' })
  const µ: any = { paths }
  new Function('µ', 'document', extractMarked(UJS_SRC, '_mjs_navPageFile'))(µ, win.document)
  const reponse = (corps: string) => new win.DOMParser().parseFromString(`<html><head></head><body>${corps}</body></html>`, 'text/html')
  return { µ, reponse }
}
const fiche = (json: string) => `<script type="application/json" id="__mjs_page">${json}</script>`

describe('navigation interne — la fiche du fichier de page est relue à chaque échange', () => {
  it('une fiche valide repointe chaque nom de la page reçue vers le fichier de page', () => {
    const { µ, reponse } = monter({ card: 'card-11111111.js', badge: 'badge-22222222.js', autre: 'autre-33333333.js' })
    µ._mjs_navPageFile(reponse(fiche('{"file":"mjs_page-doc-aaaaaaaa.js","names":["card","badge"]}')))
    assert.equal(µ.paths.card, 'mjs_page-doc-aaaaaaaa.js')
    assert.equal(µ.paths.badge, 'mjs_page-doc-aaaaaaaa.js')
    assert.equal(µ.paths.autre, 'autre-33333333.js', 'un nom hors fiche ne bouge pas')
  })

  it('la valeur posée est celle de la fiche, telle quelle : le préfixe factorisé reste à l\'Autoloader', () => {
    const { µ, reponse } = monter({ card: 'card-11111111.js' })
    µ.pathsPrefix = '/out/'
    µ._mjs_navPageFile(reponse(fiche('{"file":"mjs_page-doc-aaaaaaaa.js","names":["card"]}')))
    assert.equal(µ.paths.card, 'mjs_page-doc-aaaaaaaa.js', 'basename seul, comme au démarrage')
    assert.equal(µ.pathsPrefix, '/out/', 'le préfixe n\'est pas touché')
  })

  it('page A puis page B : le nom de A absent de B garde le fichier de A (déjà en cache, importé une seule fois)', () => {
    const { µ, reponse } = monter({ card: 'card-11111111.js', badge: 'badge-22222222.js', extra: 'extra-44444444.js' })
    µ._mjs_navPageFile(reponse(fiche('{"file":"mjs_page-a-aaaaaaaa.js","names":["card","badge"]}')))
    µ._mjs_navPageFile(reponse(fiche('{"file":"mjs_page-b-bbbbbbbb.js","names":["card","extra"]}')))
    assert.equal(µ.paths.card, 'mjs_page-b-bbbbbbbb.js', 'nom commun : la page courante gagne')
    assert.equal(µ.paths.extra, 'mjs_page-b-bbbbbbbb.js')
    assert.equal(µ.paths.badge, 'mjs_page-a-aaaaaaaa.js', 'nom de A seul : reste sur le fichier de A, jamais sur un chemin cassé')
  })

  // pourquoi ce test : la fiche vient d'un HTML reçu par le réseau. Posée sans contrôle, elle pouvait
  // faire importer un script d'un autre site (`http://ailleurs/x.js`) ou un script écrit dans l'adresse
  // même (`data:`). Elle ne peut désigner qu'un fichier de page du site
  it('une fiche qui désigne autre chose qu\'un fichier de page du site est ignorée', () => {
    const refus = ['http://ailleurs.test/mjs_page-x-aaaaaaaa.js', 'https://ailleurs.test/evil.js', '//ailleurs.test/mjs_page-x-aaaaaaaa.js', 'data:text/javascript,window.x=1', 'javascript:alert(1)', 'blob:http://x/1', 'evil.js', 'card-11111111.js', '', '\\\\ailleurs\\mjs_page-x-aaaaaaaa.js', 'mjs_page-x-aaaaaaaa.js?x=http://a', 'mjs_page-x-aaaaaaaa.mjs', ' http://ailleurs.test/mjs_page-x-aaaaaaaa.js', 'ht\ttp://ailleurs.test/mjs_page-x-aaaaaaaa.js', '/\t/ailleurs.test/mjs_page-x-aaaaaaaa.js', '\n//ailleurs.test/mjs_page-x-aaaaaaaa.js', 'HTTP://ailleurs.test/mjs_page-x-aaaaaaaa.js', 'mjs_page-x-aaaaaaaa.js#', '/\\ailleurs.test/mjs_page-x-aaaaaaaa.js']
    for (const file of refus) {
      const { µ, reponse } = monter({ card: 'card-11111111.js' })
      µ._mjs_navPageFile(reponse(fiche(JSON.stringify({ file, names: ['card'] }))))
      assert.equal(µ.paths.card, 'card-11111111.js', `refusé : ${file}`)
    }
    for (const file of ['mjs_page-doc-aaaaaaaa.js', '/out/mjs_page-doc-aaaaaaaa.js', '/assets/modularJS_compiled/mjs_page-index-0f3a9c21.js']) {
      const { µ, reponse } = monter({ card: 'card-11111111.js' })
      µ._mjs_navPageFile(reponse(fiche(JSON.stringify({ file, names: ['card'] }))))
      assert.equal(µ.paths.card, file, `accepté : ${file}`)
    }
  })

  // pourquoi ce test : si le fichier de page n'arrive pas (404 pendant un déploiement), l'Autoloader doit
  // pouvoir revenir au fichier séparé du composant. L'ancien chemin est donc gardé, le PREMIER seulement
  it('l\'ancien chemin de chaque nom est gardé pour un retour au fichier séparé', () => {
    const { µ, reponse } = monter({ card: 'card-11111111.js', extra: 'extra-44444444.js' })
    µ._mjs_navPageFile(reponse(fiche('{"file":"mjs_page-a-aaaaaaaa.js","names":["card"]}')))
    µ._mjs_navPageFile(reponse(fiche('{"file":"mjs_page-b-bbbbbbbb.js","names":["card","extra"]}')))
    assert.equal(µ._mjs_pagePrev.card, 'card-11111111.js', 'le chemin d\'origine, pas celui de la page A')
    assert.equal(µ._mjs_pagePrev.extra, 'extra-44444444.js')
  })

  it('fiche absente : aucun effet', () => {
    const { µ, reponse } = monter({ card: 'card-11111111.js' })
    µ._mjs_navPageFile(reponse('<mjs-card></mjs-card>'))
    assert.deepEqual(µ.paths, { card: 'card-11111111.js' })
  })

  it('JSON abîmé : aucun effet, aucune exception', () => {
    const { µ, reponse } = monter({ card: 'card-11111111.js' })
    assert.doesNotThrow(() => µ._mjs_navPageFile(reponse(fiche('{"file":"x.js","names":['))))
    assert.deepEqual(µ.paths, { card: 'card-11111111.js' })
  })

  it('fiche mal formée (file absent, names qui n\'est pas une liste, noms non textuels) : rien de posé', () => {
    const { µ, reponse } = monter({ card: 'card-11111111.js' })
    µ._mjs_navPageFile(reponse(fiche('{"names":["card"]}')))
    µ._mjs_navPageFile(reponse(fiche('{"file":"x.js","names":"card"}')))
    µ._mjs_navPageFile(reponse(fiche('{"file":42,"names":["card"]}')))
    µ._mjs_navPageFile(reponse(fiche('null')))
    µ._mjs_navPageFile(reponse(fiche('{"file":"x.js","names":[7,null]}')))
    assert.deepEqual(µ.paths, { card: 'card-11111111.js' })
  })

  it('table de chemins absente (aucun manifeste) ou document absent : aucun effet, aucune exception', () => {
    const { µ, reponse } = monter(undefined)
    assert.doesNotThrow(() => µ._mjs_navPageFile(reponse(fiche('{"file":"x.js","names":["card"]}'))))
    assert.equal(µ.paths, undefined)
    const b = monter({ card: 'c.js' })
    assert.doesNotThrow(() => b.µ._mjs_navPageFile(null))
    assert.doesNotThrow(() => b.µ._mjs_navPageFile({}))
  })
})

describe('navigation interne — branchement aux sites d\'échange de page', () => {
  const lignes = UJS_SRC.split('\n')
  const appelsTete = lignes.map((l, i) => ({ l, i })).filter(({ l }) => l.includes('µ._mjs_navApplyHead(doc);'))

  it('les 4 sites qui installent un document reçu (rafraîchissement de fond, retour arrière, clic, soumission) appliquent la fiche juste avant la tête', () => {
    assert.equal(appelsTete.length, 4, 'quatre sites d\'échange HTML')
    for (const { i } of appelsTete) {
      // la fiche dans les trois lignes qui précèdent la tête : la reprise du jeton préchargé peut s'intercaler
      assert.ok(lignes.slice(Math.max(0, i - 3), i + 1).some((l) => l.includes('µ._mjs_navPageFile(doc);')), `ligne ${i + 1} : la fiche doit être appliquée avant la tête`)
    }
    assert.equal(lignes.filter(l => l.includes('µ._mjs_navPageFile(doc);')).length, 4, 'ni oubli ni appel en trop')
  })

  it('à chaque site la fiche est appliquée AVANT l\'installation du contenu (l\'Autoloader voit alors les nouveaux chemins)', () => {
    for (const { i } of appelsTete) {
      const suite = lignes.slice(i, i + 4).join('\n')
      assert.match(suite, /µ\._mjs_(navInstallNodes|zoneFill)\(/, `ligne ${i + 1} : l'installation suit`)
      const avant = lignes.slice(Math.max(0, i - 3), i).join('\n')
      assert.match(avant, /µ\._mjs_navPageFile\(doc\);/, `ligne ${i + 1} : la fiche précède`)
    }
  })
})
