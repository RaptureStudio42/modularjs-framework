// attributs booléens du HTML — tous ceux que la spécification HTML nomme et qui ont un sens sur une balise que MJS rend se posent et se retirent comme
// `selected` ou `disabled` : présents quand la valeur est vraie, absents quand elle est fausse. La liste des booléens du compilateur ne portait que 14
// noms ; les douze autres (`allowfullscreen`, `async`, `default`, `defer`, `formnovalidate`, `inert`, `ismap`, `itemscope`, `nomodule`, `novalidate`,
// `playsinline`, `reversed`) recevaient le TEXTE « true » ou « false » dans une ligne de {for} comparée à une variable : « false » est un attribut présent,
// donc actif — toutes les lignes s'allumaient. Sept écritures : comparaison à une variable dans une ligne de {for}, valeur calculée dans une ligne,
// valeur d'une variable à la racine, la même avec le préfixe `@`, attribut nu, attribut nu dans une ligne, valeur d'une variable dans une branche {await}. Les trois listes de noms du compilateur
// (la liste du générateur, celle de l'exécution, celle de l'analyseur pour l'attribut nu) disent les mêmes. La page est lue dans un navigateur réel :
// rendue par le client seul (au départ, puis quand la valeur change), par le serveur happy-dom et par le serveur navigateur.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { monterComposants, VISITER, type Composants } from './helpers/composants-navigateur.js'

// la balise sur laquelle chaque attribut a un sens ; `async`, `defer` et `nomodule` sont ceux d'un <script> (balise du composant lui-même, jamais rendue
// dans la page) : on les lit sur un <div>, l'attribut seul compte
const BALISES: Record<string, string> = {
  allowfullscreen: 'iframe', async: 'div', default: 'track', defer: 'div', formnovalidate: 'button', inert: 'div', ismap: 'img',
  itemscope: 'div', nomodule: 'div', novalidate: 'form', playsinline: 'video', reversed: 'ol'
}
const NOMS   = Object.keys(BALISES)
const VIDES  = new Set(['track', 'img'])
const FORMES = ['filtre', 'ligne', 'racine', 'arobase', 'nu', 'nu-ligne', 'attente']

// la propriété DOM qui reflète l'attribut, quand son nom diffère ou qu'elle existe (les attributs de <script> et `itemscope` n'en ont pas de fiable)
const PROPRIETE: Record<string, string | null> = {
  allowfullscreen: 'allowFullscreen', async: null, default: 'default', defer: null, formnovalidate: 'formNoValidate', inert: 'inert', ismap: 'isMap',
  itemscope: null, nomodule: null, novalidate: 'noValidate', playsinline: 'playsInline', reversed: 'reversed'
}

// ce que chaque balise demande pour ne pas être signalée (titre d'un cadre, texte d'un bouton, formulaire retenu) : le test ne regarde que l'attribut
const COMPLEMENT: Record<string, string> = { iframe: ' title="cadre"', img: ' alt="image"', form: ' @noUJS' }

function element(nom: string, forme: string, ecrit: string): string {
  const balise = BALISES[nom]
  const ouvre  = `<${balise} class="k-${nom}-${forme}"${COMPLEMENT[balise] ?? ''} ${ecrit}>`
  if (VIDES.has(balise)) return ouvre
  return `${ouvre}${balise === 'button' ? 'x' : ''}</${balise}>`
}

function ecritures(nom: string): string {
  return `{for x in $valeurs}\n${element(nom, 'filtre', `${nom}={x is $choix}`)}\n{end}\n` +
    `{for l in $lignes}\n${element(nom, 'ligne', `${nom}={l.actif}`)}\n{end}\n` +
    `${element(nom, 'racine', `${nom}={$actif}`)}\n` +
    `${element(nom, 'arobase', `@${nom}={$actif}`)}\n` +
    `${element(nom, 'nu', nom)}\n` +
    `{for x in $valeurs}\n${element(nom, 'nu-ligne', nom)}\n{end}\n` +
    `{await $promesse}\n{success d}\n${element(nom, 'attente', `${nom}={$actif}`)}\n{end}`
}

const COMPOSANT = `<script lang="coffee">
$choix   = 'b'
$valeurs = ['a', 'b', 'c']
$lignes  = [{ actif: false }, { actif: true }, { actif: false }]
$actif   = false
$promesse = Promise.resolve({ ok: true })
changer = ->
  $choix   = 'c'
  $lignes  = [{ actif: true }, { actif: false }, { actif: true }]
  $actif   = true
</script>
<button class="changer" @click={changer}>changer</button>
<div>
${NOMS.map(ecritures).join('\n')}
</div>
`

// présence de l'attribut et propriété DOM de chaque élément, par classe, dans toutes les racines d'ombre de la page
const LIRE = `(() => {
  ${VISITER}
  const PROP = ${JSON.stringify(PROPRIETE)}
  const out = {}
  visiter(document, (racine) => {
    for (const el of racine.querySelectorAll('[class^="k-"]')) {
      const nom = el.className.split('-')[1]
      ;(out[el.className] ??= []).push([el.hasAttribute(nom), PROP[nom] ? el[PROP[nom]] === true : null])
    }
  })
  return out
})()`

// les lignes allumées de chaque écriture : au départ, puis après le clic
const ALLUMEES: Record<string, Record<string, boolean[]>> = {
  depart: { filtre: [false, true, false], ligne: [false, true, false], racine: [false], arobase: [false], nu: [true], 'nu-ligne': [true, true, true], attente: [false] },
  apres:  { filtre: [false, false, true], ligne: [true, false, true], racine: [true], arobase: [true], nu: [true], 'nu-ligne': [true, true, true], attente: [true] }
}

// ce qui s'écarte de l'attendu, une ligne par écriture : vide quand tout est juste. `proprietes` : la propriété DOM aussi (une propriété posée avant
// l'attribut peut ne pas le refléter)
function ecarts(lu: Record<string, any[][]>, etat: string, attributs: boolean): string[] {
  const out: string[] = []
  for (const nom of NOMS) for (const forme of FORMES) {
    const trouve = lu[`k-${nom}-${forme}`]
    const voulu  = ALLUMEES[etat][forme]
    if (!trouve) { out.push(`${nom} ${forme} : absent de la page`); continue }
    const presents = trouve.map((e) => e[0])
    if (JSON.stringify(presents) !== JSON.stringify(voulu)) out.push(`${nom} ${forme} : attribut ${JSON.stringify(presents)}, attendu ${JSON.stringify(voulu)}`)
    else if (attributs && PROPRIETE[nom] && JSON.stringify(trouve.map((e) => e[1])) !== JSON.stringify(voulu)) out.push(`${nom} ${forme} : propriété ${JSON.stringify(trouve.map((e) => e[1]))}, attendue ${JSON.stringify(voulu)}`)
  }
  return out
}

describe('attributs booléens du HTML — la liste complète', function () {
  this.timeout(240000)
  let composants: Composants | null

  before(async function () {
    composants = await monterComposants({ 'booleens-liste': COMPOSANT })
    if (!composants) this.skip()
  })

  after(async () => {
    if (composants) await composants.fermer()
  })

  async function page(): Promise<any> {
    return composants!.client('booleens-liste', '.k-reversed-nu-ligne')
  }

  it('client seul : au départ, chaque écriture dit présent ou absent comme sa valeur', async function () {
    const p = await page()
    try {
      assert.deepEqual(ecarts(await p.evaluate(LIRE), 'depart', true), [])
    } finally {
      await p.close()
    }
  })

  it('client seul : quand la valeur change, l\'attribut suit', async function () {
    const p = await page()
    try {
      await p.evaluate(`document.querySelector('mjs-booleens-liste')._shadow.querySelector('.changer').click()`)
      await p.waitForTimeout(300)
      assert.deepEqual(ecarts(await p.evaluate(LIRE), 'apres', true), [])
    } finally {
      await p.close()
    }
  })

  for (const moteur of ['happy', 'navigateur'] as const) {
    it(`serveur ${moteur === 'happy' ? 'happy-dom' : 'navigateur'} : la page dit présent ou absent comme la valeur`, async function () {
      const p = await composants!.photo(composants!.serveur[moteur]['booleens-liste'])
      try {
        assert.deepEqual(ecarts(await p.evaluate(LIRE), 'depart', false), [])
      } finally {
        await p.close()
      }
    })
  }

  // la liste du générateur (avec `value`, qui n'est pas un booléen mais suit la même voie de propriété), celle de l'exécution et celle de l'analyseur
  describe('les listes de noms du compilateur', function () {
    const lire      = (fichier: string): string => readFileSync(new URL(`../src/${fichier}`, import.meta.url), 'utf-8')
    const noms      = (texte: string): string[] => [...texte.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort()
    const generateur = async (): Promise<string[]> => [...(await import('../src/generator/attributes/index.js') as any).MJS_BOOLEAN_PROPS].sort()

    it('la liste du générateur et la liste de l\'exécution disent les mêmes noms', async function () {
      const execution = lire('runtime/mjs_element.ts').match(/MJS_BOOLEAN_PROPS = new Set\(\[([^\]]*)\]\)/)
      assert.ok(execution, 'la liste de l\'exécution se trouve dans la source')
      assert.deepEqual(noms(execution![1]), await generateur())
    })

    it('la liste de l\'analyseur (attribut nu) n\'a aucun nom que le générateur ne traite pas', async function () {
      const analyseur = lire('parser/index.ts').match(/const MJS_NATIVE_BOOLEAN_ATTRS = new Set\(\[([^\]]*)\]\)/)
      assert.ok(analyseur, 'la liste de l\'analyseur se trouve dans la source')
      const connus = new Set(await generateur())
      assert.deepEqual(noms(analyseur![1]).filter((nom) => !connus.has(nom)), [])
    })

    it('chaque nom du test est dans la liste du générateur', async function () {
      const connus = new Set(await generateur())
      assert.deepEqual(NOMS.filter((nom) => !connus.has(nom)), [])
    })
  })
})
