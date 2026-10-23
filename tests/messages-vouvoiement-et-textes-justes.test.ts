// Messages du compilateur : le ton et l'exactitude. Les messages vouvoient, tous (« vouliez-vous dire
// … ? », « renommez », « ajoutez ») — aucun ne tutoie ; le message de la clé `effects` décrit ses cinq
// réglages ; en anglais, les guillemets sont anglais ; un modèle en fichier choisi par une valeur
// calculée s'écrit `layout={…}` (le compilateur pose la balise du modèle choisi) ; « gabarit », mot
// banni par le glossaire, laisse la place à « HTML ».

import assert from 'node:assert/strict'
import { t, setMessagesLang, type MsgEntry } from '../src/messages/index.js'
import { fr } from '../src/messages/fr.js'
import { en } from '../src/messages/en.js'

// le texte d'un message : sa chaîne, ou la source de sa fonction, lettres accentuées rendues (la source
// compilée les écrit \xE9, \u2014)
const texteDe = (e: MsgEntry) => (typeof e === 'function' ? e.toString() : String(e)).replace(/\\x([0-9a-f]{2})|\\u([0-9a-f]{4})/gi, (_, x, u) => String.fromCharCode(parseInt(x ?? u, 16)))
// les clés dont le texte contient le motif
const fautives = (dict: Record<string, MsgEntry>, motif: RegExp) => Object.entries(dict).filter(([, e]) => motif.test(texteDe(e))).map(([k]) => k)

// un tutoiement : tu, te, toi, ton, ta, tes ; un impératif à la deuxième personne du singulier en tête de
// proposition (« — renomme le fichier », « : ajoute 'socket' », « ou écris … », en début de ligne, après un
// pictogramme) ; une défense (« , ne la pose qu'une fois ») ; un ordre bref après une virgule (« trop de
// coups, ralentis »). « garde » seul est aussi un nom (« — garde d'accès ») : relevé dans « garde l'un »
const VERBS = 'écris|mets|choisis|fais|prends|rends|ouvre|ajoute|renomme|utilise|vérifie|retire|remplace|corrige|déclare|importe|supprime|installe|précise|déplace|relance|garde-en|pose-le|passe-le|consomme-le|lis|garantis|calcule|réordonne|structure|migre|patiente|arme|referme|garde\\s+l[\'’]un'
const HEAD  = '(?:[—:;.(]\\s?|\\n\\s*|\\\\n\\s*|\\\\u\\{[0-9a-f]+\\}\\s?|\\p{Extended_Pictographic}\\s?|(?<!\\p{L})(?:ou|puis|sinon|et)\\s)'
const TU    = new RegExp('(?<!\\p{L})(tu|te|toi|ton|ta|tes)(?!\\p{L})|-toi(?!\\p{L})|' + HEAD + '(' + VERBS + ')(?![\\p{L}-])|[—,:;.(]\\s?ne\\s+(?:l[ea]s?\\s+|l[\'’])(pose|liste|mets|retire|garde)(?![\\p{L}-])|,\\s(ralentis|patiente)(?![\\p{L}-])', 'iu')

describe('messages : vouvoiement et textes justes', () => {
  afterEach(() => setMessagesLang('fr'))

  it('les suggestions vouvoient : « vouliez-vous dire … ? »', () => {
    assert.equal(t('effets.suggestion', { nom: 'blur' }), ' Vouliez-vous dire *blur ?')
    assert.equal(t('bundler.index.tag-suggestion', { nom: 'cart', nature: 'dev' }), ' Vouliez-vous dire <@cart> (composant du projet) ?')
    assert.equal(t('bundler.index.tag-suggestion', { nom: 'select', nature: 'coeur' }), ' Vouliez-vous dire <@@select> (module cœur) ?')
    assert.match(t('types.regle-inconnue-suggestion', { bloc: '<vars>', ligne: 2, nom: 'Percnt', suggestion: 'Percent' }), /inconnue — vouliez-vous dire « Percent » \?/)
  })

  it('aucun message français ne tutoie', () => {
    assert.deepEqual(fautives(fr as Record<string, MsgEntry>, TU), [])
  })

  it('les consignes vouvoient : « renommez », « ajoutez », « écrivez »', () => {
    assert.match(t('bundler.index.runtime-hint-game'), /Ajoutez 'socket'\./)
    assert.match(t('effets.sock-absent', { nom: 'follow' }), /écrivez @sock = µsocket/)
    assert.match(t('bundler.config.suggestion-hint', { suggestion: 'outputDir' }), /vouliez-vous dire 'outputDir' \?/)
  })

  it('"effects" est un objet : le message cite ses cinq réglages, dans les deux langues', () => {
    for (const lang of ['fr', 'en'] as const) {
      setMessagesLang(lang)
      const texte = t('bundler.config.effects-objet', { valeur: '"circle"' })
      for (const cle of ['"theme"', '"lite"', '"skeleton"', '"guard"', '"rate"']) assert.ok(texte.includes(cle), `${lang} : ${cle}`)
      assert.ok(texte.includes('"components"') && texte.includes('"delay"'), lang)
    }
  })

  it('en anglais, des guillemets anglais', () => {
    setMessagesLang('en')
    assert.equal(t('bundler.config.effects-element', { cle: 'skeleton', valeur: 'wait', valides: '"await", "components"' }), '[mjs.config.json] "effects.skeleton": "wait" — allowed: "await", "components".')
    assert.deepEqual(fautives(en as Record<string, MsgEntry>, /[«»]/), [])
  })

  it('un modèle en fichier choisi par une valeur calculée : écrire layout={…}, le compilateur pose la balise', () => {
    const vars = { tag: '@carte', nom: 'carte', modeles: 'compacte', premier: 'compacte', ligne: 3 }
    const fra  = t('parser.modele-fichier-calcule', vars)
    assert.ok(fra.includes('layout={$'), fra)
    assert.doesNotMatch(fra, /\{if\} autour/)
    setMessagesLang('en')
    const eng  = t('parser.modele-fichier-calcule', vars)
    assert.ok(eng.includes('layout={$'), eng)
    assert.doesNotMatch(eng, /\{if\} around/)
  })

  it('*effet sur <@document> tenu par une variable : le message parle du HTML, pas du « gabarit »', () => {
    const texte = t('effets.document-variable', { nom: 'ripple' })
    assert.doesNotMatch(texte, /gabarit/)
    assert.match(texte, /HTML/)
  })
})
