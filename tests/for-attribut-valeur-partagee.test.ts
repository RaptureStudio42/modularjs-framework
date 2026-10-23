// {for} — un attribut calculé par une comparaison à une variable (`checked={x is $choix}`, `data-on={p.ville is $choix}`) suit TOUTES les lignes qui
// portent la valeur choisie. Le compilateur tient un index des lignes par valeur, pour ne toucher que l'ancienne et la nouvelle quand le choix change ;
// cet index ne gardait qu'UNE ligne par valeur : quand deux lignes portaient la même (une liste qui répète une valeur, deux groupes d'un {for} imbriqué
// qui contiennent la même, une liste à clé filtrée sur un autre champ que la clé), seule la dernière suivait le choix, l'autre restait figée sur son état
// de départ. Trois listes : valeurs répétées, deux groupes aux mêmes valeurs, lignes à clé filtrées sur un champ qui se répète ; trois attributs :
// `checked` et `disabled` (propriétés), `data-on` (texte). La page est lue dans un navigateur réel : au départ, quand le choix change, puis après un
// remaniement des listes (lignes retirées, recréées, une clé reprise par une autre ligne) suivi d'un nouveau choix ; rendue par le serveur happy-dom et
// par le serveur navigateur (le départ seulement).

import assert from 'node:assert/strict'
import { monterComposants, VISITER, type Composants } from './helpers/composants-navigateur.js'

const FORMES    = ['plat', 'imbrique', 'cle']
const ATTRIBUTS = ['checked', 'disabled', 'data-on']

// la ligne qui porte l'attribut, sa classe dit la forme de la liste et l'attribut
function element(attribut: string, classe: string, item: string): string {
  const ecrit = `${attribut}={${item} is $choix}`
  if (attribut === 'checked') return `<input class="${classe}" type="checkbox" aria-label="case" ${ecrit}>`
  if (attribut === 'disabled') return `<button class="${classe}" ${ecrit}>x</button>`
  return `<p class="${classe}" ${ecrit}>x</p>`
}

function listes(attribut: string): string {
  const k = (forme: string): string => `k-${forme}-${attribut}`
  return `{for x in $valeurs}\n${element(attribut, k('plat'), 'x')}\n{end}\n` +
    `{for g in $groupes}\n{for x in g.valeurs}\n${element(attribut, k('imbrique'), 'x')}\n{end}\n{end}\n` +
    `{for p in $gens by id}\n${element(attribut, k('cle'), 'p.ville')}\n{end}`
}

const COMPOSANT = `<script lang="coffee">
$choix   = 'b'
$valeurs = ['a', 'b', 'b', 'c']
$groupes = [{ valeurs: ['a', 'b', 'c'] }, { valeurs: ['a', 'b', 'c'] }]
$gens    = [{ id: 1, ville: 'a' }, { id: 2, ville: 'b' }, { id: 3, ville: 'b' }, { id: 4, ville: 'c' }]
changer = ->
  $choix = 'c'
remanier = ->
  $valeurs = ['b', 'a', 'b']
  $groupes = [{ valeurs: ['c', 'b'] }, { valeurs: ['b', 'b'] }, { valeurs: ['a'] }]
  $gens    = [{ id: 7, ville: 'b' }, { id: 2, ville: 'b' }, { id: 9, ville: 'a' }]
defaire = ->
  $valeurs = ['a', 'b', 'b', 'c']
  $groupes = [{ valeurs: ['a', 'b', 'c'] }, { valeurs: ['a', 'b', 'c'] }]
  $gens    = [{ id: 1, ville: 'a' }, { id: 2, ville: 'b' }, { id: 3, ville: 'b' }, { id: 4, ville: 'c' }]
revenir = ->
  $choix = 'a'
</script>
<button class="changer" @click={changer}>changer</button>
<button class="remanier" @click={remanier}>remanier</button>
<button class="defaire" @click={defaire}>defaire</button>
<button class="revenir" @click={revenir}>revenir</button>
<div>
${ATTRIBUTS.map(listes).join('\n')}
</div>
`

// l'état de chaque ligne, par classe, dans toutes les racines d'ombre de la page : la propriété pour les cases et les boutons, le texte pour `data-on`
const LIRE = `(() => {
  ${VISITER}
  const out = {}
  visiter(document, (racine) => {
    for (const el of racine.querySelectorAll('[class^="k-"]')) {
      const attribut = el.className.split('-').slice(2).join('-')
      const etat     = attribut === 'data-on' ? el.getAttribute('data-on') === 'true' : el[attribut] === true
      ;(out[el.className] ??= []).push(etat)
    }
  })
  return out
})()`

// le nombre de fonctions de lignes que l'index garde : une par ligne vivante et par attribut, jamais une de plus (une ligne retirée ne laisse rien derrière elle)
const FONCTIONS = `(() => {
  const el = document.querySelector('mjs-valeur-partagee')
  let n = 0
  for (const fe of Object.values(el._mjs_filt || {})) for (const e of (fe.idx || new Map()).values()) n += e instanceof Set ? e.size : 1
  return n
})()`

// ce que doit dire chaque liste pour le choix donné : « vrai » sur chaque ligne dont la valeur est le choix
const VALEURS: Record<string, Record<string, string[]>> = {
  depart:   { plat: ['a', 'b', 'b', 'c'], imbrique: ['a', 'b', 'c', 'a', 'b', 'c'], cle: ['a', 'b', 'b', 'c'] },
  remanie:  { plat: ['b', 'a', 'b'], imbrique: ['c', 'b', 'b', 'b', 'a'], cle: ['b', 'b', 'a'] }
}

// ce qui s'écarte de l'attendu, une ligne par liste : vide quand tout est juste
function ecarts(lu: Record<string, boolean[]>, etat: string, choix: string): string[] {
  const out: string[] = []
  for (const forme of FORMES) for (const attribut of ATTRIBUTS) {
    const trouve = lu[`k-${forme}-${attribut}`]
    const voulu  = VALEURS[etat][forme].map((v) => v === choix)
    if (!trouve) out.push(`${forme} ${attribut} : absent de la page`)
    else if (JSON.stringify(trouve) !== JSON.stringify(voulu)) out.push(`${forme} ${attribut} : ${JSON.stringify(trouve)}, attendu ${JSON.stringify(voulu)}`)
  }
  return out
}

describe('{for} — un attribut calculé par une comparaison à une variable, valeur portée par plusieurs lignes', function () {
  this.timeout(240000)
  let composants: Composants | null

  before(async function () {
    composants = await monterComposants({ 'valeur-partagee': COMPOSANT })
    if (!composants) this.skip()
  })

  after(async () => {
    if (composants) await composants.fermer()
  })

  async function page(): Promise<any> {
    return composants!.client('valeur-partagee', '.k-cle-data-on')
  }

  async function cliquer(p: any, classe: string): Promise<void> {
    await p.evaluate(`document.querySelector('mjs-valeur-partagee')._shadow.querySelector('.${classe}').click()`)
    await p.waitForTimeout(300)
  }

  it('client seul : au départ, chaque ligne qui porte la valeur choisie est allumée', async function () {
    const p = await page()
    try {
      assert.deepEqual(ecarts(await p.evaluate(LIRE), 'depart', 'b'), [])
    } finally {
      await p.close()
    }
  })

  it('client seul : quand le choix change, toutes les lignes suivent', async function () {
    const p = await page()
    try {
      await cliquer(p, 'changer')
      assert.deepEqual(ecarts(await p.evaluate(LIRE), 'depart', 'c'), [])
    } finally {
      await p.close()
    }
  })

  it('client seul : après un remaniement des listes, le nouveau choix est suivi par toutes les lignes', async function () {
    const p = await page()
    try {
      await cliquer(p, 'remanier')
      assert.deepEqual(ecarts(await p.evaluate(LIRE), 'remanie', 'b'), [], 'après le remaniement')
      await cliquer(p, 'revenir')
      assert.deepEqual(ecarts(await p.evaluate(LIRE), 'remanie', 'a'), [], 'après le nouveau choix')
      await cliquer(p, 'changer')
      assert.deepEqual(ecarts(await p.evaluate(LIRE), 'remanie', 'c'), [], 'après un dernier choix')
    } finally {
      await p.close()
    }
  })

  it('client seul : des lignes retirées puis recréées ne laissent aucune fonction morte dans l\'index', async function () {
    const p = await page()
    try {
      // quatre lignes à plat, six dans les groupes, quatre à clé : quatorze par attribut
      const vivantes = 14 * ATTRIBUTS.length
      assert.equal(await p.evaluate(FONCTIONS), vivantes, 'au départ')
      for (let tour = 0; tour < 4; tour++) {
        await cliquer(p, 'remanier')
        await cliquer(p, 'defaire')
      }
      assert.equal(await p.evaluate(FONCTIONS), vivantes, 'après quatre remaniements')
      assert.deepEqual(ecarts(await p.evaluate(LIRE), 'depart', 'b'), [], 'les lignes recréées')
      await cliquer(p, 'changer')
      assert.deepEqual(ecarts(await p.evaluate(LIRE), 'depart', 'c'), [], 'le choix suivant')
    } finally {
      await p.close()
    }
  })

  for (const moteur of ['happy', 'navigateur'] as const) {
    it(`serveur ${moteur === 'happy' ? 'happy-dom' : 'navigateur'} : la page dit allumée chaque ligne qui porte la valeur choisie`, async function () {
      const p = await composants!.photo(composants!.serveur[moteur]['valeur-partagee'])
      try {
        assert.deepEqual(ecarts(await p.evaluate(LIRE), 'depart', 'b'), [])
      } finally {
        await p.close()
      }
    })
  }
})
