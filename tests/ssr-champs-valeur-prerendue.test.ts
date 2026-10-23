// SSR — la valeur des champs dans une page préparée par le serveur. Un champ lié à une variable (`<input type="range" value={$x}>`)
// reçoit sa valeur par la PROPRIÉTÉ `value`, que la sérialisation du HTML n'écrit pas : la page sortait avec `value=""`, les curseurs
// au milieu de leur course, puis ils sautaient à leur place au démarrage. Le serveur recopie désormais l'état courant de chaque champ
// dans le HTML : `value` des champs de saisie, `checked` des cases et des boutons radio, `selected` de l'option choisie, texte d'un
// `<textarea>` — à toute profondeur, dans les ombres imbriquées comprises. Jamais la valeur d'un mot de passe ni d'un fichier.
// Les deux moteurs de rendu (happy-dom, navigateur réel) écrivent la même page ; le navigateur est ignoré s'il n'est pas installé.

import assert from 'node:assert/strict'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { ecrireChamps, balise, attribut, contenu, option, ETAT } from './helpers/champs-prerendu.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

interface Rendus { page: string; leger: string }

async function navigateurPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

// le dossier d'un projet de test avec les composants du formulaire
function projet(): string {
  const root = mjsTmp('champs-prerendus')
  mkdirSync(join(root, 'src'), { recursive: true })
  ecrireChamps(join(root, 'src'))
  return root
}

async function rendreHappyDom(): Promise<Rendus> {
  const root     = projet()
  const renderer = await createSSRRenderer({ sourceDir: join(root, 'src'), outputDir: join(root, 'out') })
  try {
    const page  = await renderer.renderToString('mjs-champs-tous')
    const leger = await renderer.renderToString('mjs-champ-leger', { light: true })
    return { page: page.html, leger: leger.html }
  } finally {
    await renderer.close()
  }
}

async function rendreNavigateur(): Promise<Rendus> {
  const root     = projet()
  const renderer = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out' }, { configDir: root })
  try {
    const page  = await renderer.renderPage('mjs-champs-tous', {})
    const leger = await renderer.renderPage('mjs-champ-leger', { light: true })
    return { page: page.html, leger: leger.html }
  } finally {
    await renderer.close()
  }
}

const MOTEURS: Array<{ nom: string; rendre: () => Promise<Rendus>; present: () => Promise<boolean> }> = [
  { nom: 'happy-dom',  rendre: rendreHappyDom,  present: async () => true },
  { nom: 'navigateur', rendre: rendreNavigateur, present: navigateurPresent }
]

describe('SSR — la valeur des champs est écrite dans la page préparée', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const moteur of MOTEURS) describe(`moteur ${moteur.nom}`, function () {
    let rendus: Rendus

    before(async function () {
      if (!(await moteur.present())) { this.skip(); return }
      rendus = await moteur.rendre()
    })

    it('un curseur, une couleur et un texte liés à une variable portent leur valeur', function () {
      const { page } = rendus
      assert.equal(attribut(balise(page, 'lum'), 'value'),    ETAT.luminosite, 'curseur lié dans un sens')
      assert.equal(attribut(balise(page, 'lum2'), 'value'),   ETAT.luminosite, 'curseur lié dans les deux sens')
      assert.equal(attribut(balise(page, 'teinte'), 'value'), ETAT.teinte, 'couleur')
      assert.equal(attribut(balise(page, 'nom'), 'value'),    ETAT.nom, 'texte')
    })

    it('une valeur qui porte des guillemets, des chevrons et une esperluette ne sort pas de son attribut', function () {
      const { page } = rendus
      assert.ok(!page.includes('value="Ada "'), 'le guillemet de la valeur est échappé')
      assert.doesNotMatch(page, /<b>&<\/b>/, 'la valeur n\'ouvre aucune balise')
      assert.equal(attribut(balise(page, 'nom'), 'value'), ETAT.nom, 'et se relit à l\'identique')
    })

    it('les cases et les boutons radio portent leur état, qu\'il vienne d\'une variable ou d\'un script', function () {
      const { page } = rendus
      assert.notEqual(attribut(balise(page, 'actif'), 'checked'), null, 'case cochée')
      assert.equal(attribut(balise(page, 'inactif'), 'checked'), null, 'case décochée')
      assert.notEqual(attribut(balise(page, 'pro'), 'checked'), null, 'radio choisi')
      assert.equal(attribut(balise(page, 'free'), 'checked'), null, 'radio laissé')
      assert.notEqual(attribut(balise(page, 'imperatif'), 'checked'), null, 'case cochée par le script')
    })

    it('la liste porte l\'option choisie, et elle seule', function () {
      const { page } = rendus
      assert.notEqual(attribut(option(page, 'en'), 'selected'), null, 'option choisie')
      assert.equal(attribut(option(page, 'fr'), 'selected'), null, 'option laissée')
      assert.equal(attribut(option(page, 'de'), 'selected'), null, 'option d\'un groupe, laissée')
    })

    it('un textarea porte son texte, un saut de ligne en tête compris', function () {
      const { page } = rendus
      assert.equal(contenu(page, 'note'), ETAT.note, 'texte sur deux lignes')
      // le parseur d'un navigateur retire le premier saut de ligne d'un <textarea> : il s'écrit donc en double
      assert.equal(contenu(page, 'suite'), '\n' + ETAT.suite, 'saut de ligne en tête')
    })

    it('un retour chariot en tête s\'écrit comme un saut de ligne en tête : la page redit la valeur que le navigateur donne au champ', function () {
      const { page } = rendus
      // le parseur d'un navigateur normalise `\r\n` et `\r` en `\n` AVANT de retirer le premier saut ; un champ ne rend jamais de retour chariot
      assert.equal(contenu(page, 'retour'), '\n\nretour', 'retour chariot et saut de ligne en tête')
      assert.equal(contenu(page, 'cr'), '\n\ncr', 'retour chariot seul en tête')
    })

    it('un champ que personne n\'a touché garde son balisage : ni valeur ni choix écrits en plus', function () {
      const { page } = rendus
      assert.equal(attribut(balise(page, 'libre'), 'value'), null, 'curseur sans valeur (le navigateur lui en donne une, au milieu)')
      assert.equal(attribut(balise(page, 'noir'), 'value'), null, 'couleur sans valeur (le navigateur lui donne le noir)')
      assert.equal(attribut(option(page, 'a'), 'selected'), null, 'première option de la liste, choisie par le navigateur seul')
      assert.equal(attribut(option(page, 'b'), 'selected'), null, 'seconde option de la liste')
    })

    it('un champ dans une ombre imbriquée, à deux niveaux, porte sa valeur', function () {
      const { page } = rendus
      assert.equal(attribut(balise(page, 'ri'), 'value'), '1.4', 'curseur du sous-composant')
      assert.equal(attribut(balise(page, 'rp'), 'value'), '1.4', 'texte du petit-enfant')
    })

    it('la valeur d\'un mot de passe n\'est jamais écrite dans la page', function () {
      const { page } = rendus
      assert.ok(!page.includes(ETAT.secret), 'le mot de passe n\'apparaît nulle part dans le HTML')
      assert.notEqual(attribut(balise(page, 'secret'), 'value'), ETAT.secret, 'ni dans son champ')
    })

    it('un composant léger (sans ombre) porte la valeur de son champ', function () {
      const { leger } = rendus
      assert.equal(attribut(balise(leger, 'leger'), 'value'), ETAT.leger, 'curseur du composant léger')
    })
  })

  describe('moteur navigateur — état changé après le premier rendu', function () {
    let tardive = ''
    let radios  = ''

    before(async function () {
      if (!(await navigateurPresent())) { this.skip(); return }
      const root     = projet()
      const renderer = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out' }, { configDir: root })
      try {
        tardive = (await renderer.renderPage('mjs-champ-tardive', {})).html
        radios  = (await renderer.renderPage('mjs-champ-radios', {})).html
      } finally {
        await renderer.close()
      }
    })

    it('une case cochée au premier rendu puis décochée au montage sort décochée', function () {
      assert.equal(attribut(balise(tardive, 'tardive'), 'checked'), null, 'le `checked` du premier rendu est retiré')
    })

    it('un bouton radio choisi par le script porte `checked`, son voisin du groupe non', function () {
      assert.notEqual(attribut(balise(radios, 'second'), 'checked'), null, 'le bouton choisi porte `checked`')
      assert.equal(attribut(balise(radios, 'premier'), 'checked'), null, 'le voisin n\'en porte pas')
    })
  })
})
