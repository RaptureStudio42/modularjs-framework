// <@@editor colors="…"> : la couleur du texte, une palette FERMÉE donnée par la page (des noms anglais : gray brown orange yellow green blue purple pink red).
// Le HTML ne porte que `<span data-color="nom">` : une couleur de la palette est gardée (valeur posée, collage, dépôt : le même nettoyeur), toute autre
// couleur tombe (un style, un <font>, un nom hors de la palette, un nom inconnu) et son texte reste ; la couleur enveloppe les marques, le lien enveloppe
// la couleur, la plus proche du texte gagne, deux passages de même couleur fusionnent. Sans `colors`, aucune couleur n'entre. Le bouton de la barre
// (`color`) n'existe que pour un éditeur qui a une palette ; un nom de couleur inconnu est ignoré, un avertissement le dit

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monter } from './helpers/editeur-riche.js'

const HOTE = `<script>
  $cas  = window.__donnees ?? []
  $sans = '<p><span data-color="red">a</span></p>'
</script>

{for i, c in $cas by i}
  <@@editor name={"n" + i} colors="red green" toolbar="none" value={c}></@@editor>
{end}
<@@editor class="sans" name="sans" toolbar="none" value={$sans}></@@editor>
<@@editor class="barre" colors="red nope green"></@@editor>
<@@editor class="nue"></@@editor>
`

const CAS: Array<[string, string, string]> = [
  ['une couleur de la palette est gardée', '<p>un <span data-color="red">mot</span></p>', '<p>un <span data-color="red">mot</span></p>'],
  ['une couleur hors de la palette tombe, son texte reste', '<p><span data-color="blue">mot</span></p>', '<p>mot</p>'],
  ['un nom inconnu, ou écrit autrement, tombe', '<p><span data-color="magenta">a</span><span data-color="RED">b</span><span data-color=" red">c</span></p>', '<p>abc</p>'],
  ['les couleurs en style ou en <font> tombent', '<p><span style="color:red">a</span><font color="red">b</font><span style="color: #ff0000">c</span></p>', '<p>abc</p>'],
  ['seul data-color reste sur la balise', '<p><span data-color="red" style="color:blue" class="k" id="i">a</span></p>', '<p><span data-color="red">a</span></p>'],
  ['la couleur enveloppe les marques, le lien enveloppe la couleur', '<p><strong><span data-color="green">a</span></strong> <span data-color="red"><a href="https://x.fr">l</a></span></p>', '<p><span data-color="green"><strong>a</strong></span> <a href="https://x.fr"><span data-color="red">l</span></a></p>'],
  ['la couleur la plus proche du texte gagne', '<p><span data-color="red">a<span data-color="green">b</span>c</span></p>', '<p><span data-color="red">a</span><span data-color="green">b</span><span data-color="red">c</span></p>'],
  ['deux passages de même couleur fusionnent', '<p><span data-color="red">a</span><span data-color="red">b</span></p>', '<p><span data-color="red">ab</span></p>'],
  ['un blanc coloré en fin de ligne tombe avec sa balise', '<p>a<span data-color="red"> </span></p>', '<p>a</p>'],
  ['titres et listes gardent leur couleur', '<h2><span data-color="red">T</span></h2><ul><li><span data-color="green">x</span></li></ul>', '<h2><span data-color="red">T</span></h2><ul><li><span data-color="green">x</span></li></ul>'],
]

describe('<@@editor colors> : la couleur du texte (nettoyeur, barre)', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  let hote: any
  let avertissements: string[] = []
  const champ  = (n: string): string => hote._shadow.querySelector('input[name="' + n + '"]')?.value ?? '(champ absent)'
  const bouton = (cl: string): any => hote._shadow.querySelector('.' + cl)._shadow.querySelector('mjs-core-toolbar')?._shadow?.querySelector('[data-tool="color"]')

  before(async () => {
    ;({ hote, avertissements } = await monter(HOTE, 'editeur-couleur', CAS.map((c) => c[1])))
  })

  for (let i = 0; i < CAS.length; i++) {
    it(CAS[i][0], () => {
      assert.equal(champ('n' + i), CAS[i][2])
    })
  }

  it('sans `colors`, aucune couleur n\'entre', () => {
    assert.equal(champ('sans'), '<p>a</p>')
  })

  it('le bouton de la barre n\'existe que pour un éditeur qui a une palette', () => {
    const b = bouton('barre')
    assert.ok(!!b, 'bouton de couleur dans la barre de l\'éditeur à palette')
    assert.equal(b.getAttribute('aria-label'), 'Couleur du texte')
    assert.equal(b.getAttribute('aria-pressed'), 'false')
    assert.ok(!bouton('nue'), 'aucun bouton de couleur sans palette')
    assert.ok(!!hote._shadow.querySelector('.nue')._shadow.querySelector('mjs-core-toolbar')._shadow.querySelector('[data-tool="strike"]'), 'la barre sans palette garde ses autres boutons')
  })

  it('un nom de couleur inconnu est ignoré, un avertissement le dit', () => {
    assert.ok(avertissements.some((a) => a.includes('« nope »')), avertissements.join(' | '))
  })
})
