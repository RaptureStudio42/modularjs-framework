// {for} — une classe (`@class{x is $choix}`) ou un style (`@style.x={x is $choix ? …}`) calculé par une comparaison à une variable suit TOUTES les lignes qui
// portent la valeur choisie. Le compilateur tient un index des lignes par valeur, pour ne toucher que l'ancienne et la nouvelle quand le choix change ;
// cet index ne gardait qu'UNE ligne par valeur : quand deux lignes portaient la même (une liste qui répète une valeur, deux groupes d'un {for} imbriqué
// qui contiennent la même, une liste à clé filtrée sur un autre champ que la clé), seule la dernière suivait le choix, l'autre restait figée sur son état
// de départ. Trois listes : valeurs répétées, deux groupes aux mêmes valeurs, lignes à clé filtrées sur un champ qui se répète ; quatre liaisons : une
// classe, un style retiré quand la ligne n'est pas choisie, un style à deux valeurs, un style dont la valeur lit la ligne. La page est lue dans un navigateur
// réel : au départ, quand le choix change, après un remaniement des listes (lignes retirées, recréées, une clé reprise par une autre ligne) suivi d'un
// nouveau choix, et quand le champ filtré d'une ligne change en place ; rendue par le serveur happy-dom et par le serveur navigateur (le départ seulement).

import assert from 'node:assert/strict'
import { monterComposants, VISITER, type Composants } from './helpers/composants-navigateur.js'

const FORMES   = ['plat', 'imbrique', 'cle']
const LIAISONS = ['classe', 'style-vide', 'style-valeur', 'style-ligne']

// la ligne qui porte la liaison ; `data-k` dit la forme de la liste et la liaison. `lue` : ce que la valeur du style lit de la ligne
function element(liaison: string, forme: string, item: string, lue: string): string {
  const marque = `data-k="${forme}-${liaison}"`
  if (liaison === 'classe') return `<p ${marque} @class{${item} is $choix}="on">x</p>`
  if (liaison === 'style-vide') return `<p ${marque} @style.color={${item} is $choix ? 'red' : ''}>x</p>`
  if (liaison === 'style-valeur') return `<p ${marque} @style.opacity={${item} is $choix ? '1' : '0.5'}>x</p>`
  return `<p ${marque} @style.--lu={${item} is $choix ? ${lue} : ''}>x</p>`
}

function listes(liaison: string): string {
  return `{for x in $valeurs}\n${element(liaison, 'plat', 'x', 'x')}\n{end}\n` +
    `{for g in $groupes}\n{for x in g.valeurs}\n${element(liaison, 'imbrique', 'x', 'x')}\n{end}\n{end}\n` +
    `{for p in $gens by id}\n${element(liaison, 'cle', 'p.ville', 'p.nom')}\n{end}`
}

const COMPOSANT = `<script lang="coffee">
$choix   = 'b'
$valeurs = ['a', 'b', 'b', 'c']
$groupes = [{ valeurs: ['a', 'b', 'c'] }, { valeurs: ['a', 'b', 'c'] }]
$gens    = [{ id: 1, ville: 'a', nom: 'n1' }, { id: 2, ville: 'b', nom: 'n2' }, { id: 3, ville: 'b', nom: 'n3' }, { id: 4, ville: 'c', nom: 'n4' }]
changer = ->
  $choix = 'c'
remanier = ->
  $valeurs = ['b', 'a', 'b']
  $groupes = [{ valeurs: ['c', 'b'] }, { valeurs: ['b', 'b'] }, { valeurs: ['a'] }]
  $gens    = [{ id: 7, ville: 'b', nom: 'n7' }, { id: 2, ville: 'b', nom: 'n2' }, { id: 9, ville: 'a', nom: 'n9' }]
defaire = ->
  $valeurs = ['a', 'b', 'b', 'c']
  $groupes = [{ valeurs: ['a', 'b', 'c'] }, { valeurs: ['a', 'b', 'c'] }]
  $gens    = [{ id: 1, ville: 'a', nom: 'n1' }, { id: 2, ville: 'b', nom: 'n2' }, { id: 3, ville: 'b', nom: 'n3' }, { id: 4, ville: 'c', nom: 'n4' }]
revenir = ->
  $choix = 'a'
retourner = ->
  $choix = 'b'
muter = ->
  $gens[1].ville = 'c'
</script>
<button class="changer" @click={changer}>changer</button>
<button class="remanier" @click={remanier}>remanier</button>
<button class="defaire" @click={defaire}>defaire</button>
<button class="revenir" @click={revenir}>revenir</button>
<button class="retourner" @click={retourner}>retourner</button>
<button class="muter" @click={muter}>muter</button>
<div>
${LIAISONS.map(listes).join('\n')}
</div>
`

// l'état de chaque ligne, par marque, dans toutes les racines d'ombre de la page : la classe, la couleur, l'opacité, la propriété `--lu`
const LIRE = `(() => {
  ${VISITER}
  const out = {}
  visiter(document, (racine) => {
    for (const el of racine.querySelectorAll('[data-k]')) {
      const k       = el.getAttribute('data-k')
      const liaison = k.slice(k.indexOf('-') + 1)
      let etat
      if (liaison === 'classe') etat = el.classList.contains('on')
      else if (liaison === 'style-vide') etat = el.style.color === 'red'
      else if (liaison === 'style-valeur') etat = el.style.opacity === '1'
      else etat = el.style.getPropertyValue('--lu') !== ''
      ;(out[k] ??= []).push(etat)
    }
  })
  return out
})()`

// le nombre de fonctions de lignes que l'index garde : une par ligne vivante et par liaison, jamais une de plus (une ligne retirée ne laisse rien derrière elle)
const FONCTIONS = `(() => {
  const el = document.querySelector('mjs-classe-style-partagee')
  let n = 0
  for (const fe of Object.values(el._mjs_filt || {})) for (const e of (fe.idx || new Map()).values()) n += e instanceof Set ? e.size : 1
  return n
})()`

// ce que doit dire chaque liste pour le choix donné : « vrai » sur chaque ligne dont la valeur est le choix
const VALEURS: Record<string, Record<string, string[]>> = {
  depart:  { plat: ['a', 'b', 'b', 'c'], imbrique: ['a', 'b', 'c', 'a', 'b', 'c'], cle: ['a', 'b', 'b', 'c'] },
  remanie: { plat: ['b', 'a', 'b'], imbrique: ['c', 'b', 'b', 'b', 'a'], cle: ['b', 'b', 'a'] },
  mute:    { plat: ['a', 'b', 'b', 'c'], imbrique: ['a', 'b', 'c', 'a', 'b', 'c'], cle: ['a', 'c', 'b', 'c'] }
}

// ce qui s'écarte de l'attendu, une ligne par liste : vide quand tout est juste
function ecarts(lu: Record<string, boolean[]>, etat: string, choix: string): string[] {
  const out: string[] = []
  for (const forme of FORMES) for (const liaison of LIAISONS) {
    const trouve = lu[`${forme}-${liaison}`]
    const voulu  = VALEURS[etat][forme].map((v) => v === choix)
    if (!trouve) out.push(`${forme} ${liaison} : absent de la page`)
    else if (JSON.stringify(trouve) !== JSON.stringify(voulu)) out.push(`${forme} ${liaison} : ${JSON.stringify(trouve)}, attendu ${JSON.stringify(voulu)}`)
  }
  return out
}

describe('{for} — une classe ou un style calculé par une comparaison à une variable, valeur portée par plusieurs lignes', function () {
  this.timeout(240000)
  let composants: Composants | null

  before(async function () {
    composants = await monterComposants({ 'classe-style-partagee': COMPOSANT })
    if (!composants) this.skip()
  })

  after(async () => {
    if (composants) await composants.fermer()
  })

  async function page(): Promise<any> {
    return composants!.client('classe-style-partagee', '[data-k="cle-classe"]')
  }

  async function cliquer(p: any, classe: string): Promise<void> {
    await p.evaluate(`document.querySelector('mjs-classe-style-partagee')._shadow.querySelector('.${classe}').click()`)
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
      // quatre lignes à plat, six dans les groupes, quatre à clé : quatorze par liaison
      const vivantes = 14 * LIAISONS.length
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

  it('client seul : un champ filtré qui change en place fait suivre à la ligne sa nouvelle valeur, pas l\'ancienne', async function () {
    const p = await page()
    try {
      await cliquer(p, 'muter')
      assert.deepEqual(ecarts(await p.evaluate(LIRE), 'mute', 'b'), [], 'après la mutation')
      await cliquer(p, 'changer')
      assert.deepEqual(ecarts(await p.evaluate(LIRE), 'mute', 'c'), [], 'sur la nouvelle valeur')
      await cliquer(p, 'retourner')
      assert.deepEqual(ecarts(await p.evaluate(LIRE), 'mute', 'b'), [], 'de retour sur l\'ancienne')
      assert.equal(await p.evaluate(FONCTIONS), 14 * LIAISONS.length, 'une fonction par ligne et par liaison')
    } finally {
      await p.close()
    }
  })

  for (const moteur of ['happy', 'navigateur'] as const) {
    it(`serveur ${moteur === 'happy' ? 'happy-dom' : 'navigateur'} : la page dit allumée chaque ligne qui porte la valeur choisie`, async function () {
      const p = await composants!.photo(composants!.serveur[moteur]['classe-style-partagee'])
      try {
        assert.deepEqual(ecarts(await p.evaluate(LIRE), 'depart', 'b'), [])
      } finally {
        await p.close()
      }
    })
  }
})
