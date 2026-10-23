// Ce que ce test garantit : sur un <@@select> FERMÉ et focalisé, la flèche droite choisit l'option suivante et la flèche gauche la
// précédente, sans ouvrir la liste, comme un choix à la souris (variable liée à jour, champ caché du formulaire à jour AVANT `change`,
// `change` émis une seule fois avec la valeur dans son type). Aux bords : rien, la suite ne reboucle pas. Les groupes ne sont pas des
// arrêts, deux options de même valeur ne coincent pas la flèche, la ligne « Autre… » n'est jamais une étape (la flèche ne l'ouvre pas) et
// une réponse libre déjà donnée n'est pas remplacée. Choix `multiple` : rien. Liste ouverte, ou touche de modification enfoncée avec la
// gauche ou la droite : la touche garde son rôle (déplacer le curseur d'un champ, retour arrière du navigateur).
// Les flèches haute et basse, elles, OUVRENT la liste fermée (même ligne active à l'ouverture, `multiple` et réponse libre comprises,
// rien n'est choisi), avec ou sans Alt, Ctrl, Méta ou Maj enfoncé : Alt + flèche ouvre une liste native, et la haute fait comme la basse.
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const PAYS = '<@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option><@@option value="us">États-Unis</@@option>'

const ZONES: Record<string, string> = {
  droite:   `<@@select name="pays" value="de">${PAYS}</@@select>`,
  gauche:   `<@@select name="pays" value="de">${PAYS}</@@select>`,
  lie:      `<@@select name="lie" value=!{$lie} @change={@onLie(e)}>${PAYS}</@@select>`,
  vide:     `<@@select name="vide">${PAYS}</@@select>`,
  types:    '<@@select name="nombre" value={7}><@@option value={7}>Sept</@@option><@@option value={18}>Dix-huit</@@option><@@option value={30}>Trente</@@option></@@select>',
  groupes:  '<@@select name="groupes" value="de"><@@optgroup label="Europe"><@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option></@@optgroup><@@optgroup label="Asie"><@@option value="jp">Japon</@@option></@@optgroup></@@select>',
  doublons: '<@@select name="doublons" value="1"><@@option value="1">Un</@@option><@@option value="1">Un bis</@@option><@@option value="2">Deux</@@option></@@select>',
  multi:    `<@@select name="multi" multiple value={['de']}>${PAYS}</@@select>`,
  libre:    `<@@select name="libre" other value="de">${PAYS}</@@select>`,
  donnee:   `<@@select name="donnee" other value="Zed">${PAYS}</@@select>`,
  modifs:   `<@@select name="modifs" value="de">${PAYS}</@@select>`,
  ouverte:  `<@@select name="ouverte" value="de">${PAYS}</@@select>`,
  cherche:  `<@@select name="cherche" search value="de">${PAYS}</@@select>`,
  saisie:   `<@@select name="saisie" other value="de">${PAYS}</@@select>`
}

// l'ouverture par les flèches verticales : chaque cas est posé deux fois, une liste par flèche, pour comparer l'état d'après (la ligne active attendue est le rang de la ligne : « Autre… » suit les trois options)
const OUVERTURES: Array<[string, string, number]> = [
  ['simple', `<@@select name="ouvre" value="de">${PAYS}</@@select>`, 1],
  ['vide', `<@@select name="ouvre">${PAYS}</@@select>`, 0],
  ['multi', `<@@select name="ouvre" multiple value={['de']}>${PAYS}</@@select>`, 1],
  ['donnee', `<@@select name="ouvre" other value="Zed">${PAYS}</@@select>`, 3]
]
for (const [cas, balise] of OUVERTURES) {
  ZONES[`haut-${cas}`] = balise
  ZONES[`bas-${cas}`]  = balise
}

const HOTE = `<script>
  $lie   = 'de'
  $echos = 0

  @onLie = (e)->
    $echos++
</script>

${Object.entries(ZONES).map(([id, balise]) => `<div id="${id}">${balise}</div>`).join('\n')}
`

describe('<@@select> — flèches sur la liste fermée', function () {
  this.timeout(60000)

  let window: any = null
  let hote: any   = null
  const recus: Array<{ zone: string; type: string; data: any; champs: string[] }> = []

  const sel    = (zone: string) => hote._shadow.querySelector(`#${zone} mjs-core-select`)
  const coque  = (zone: string) => sel(zone)._shadow
  const bouton = (zone: string) => coque(zone).querySelector('.select-btn')
  const clic   = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
  const libelle = (zone: string) => coque(zone).querySelector('.select-label').textContent.trim()
  const de     = (zone: string, type = 'change') => recus.filter((r) => r.zone === zone && r.type === type)

  // vrai quand la touche est consommée (preventDefault) : la page ne défile pas, un champ n'y répond pas
  const touche = (el: any, k: string, modif: Record<string, boolean> = {}): boolean => !el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, composed: true, ...modif }))

  async function presser(zone: string, k: string, modif: Record<string, boolean> = {}): Promise<boolean> {
    const consommee = touche(bouton(zone), k, modif)
    await pause(30)
    return consommee
  }

  const ferme = (zone: string) => sel(zone)._state.open === false && coque(zone).querySelector('.select-panel') === null

  before(async () => {
    const monte = await monterHote(HOTE, 'core-select-fleches')
    window = monte.window
    hote   = monte.hote
    for (const zone of Object.keys(ZONES)) {
      const div = hote._shadow.querySelector(`#${zone}`)
      for (const type of ['change', 'other']) div.addEventListener(type, (e: any) => {
        const champs = Array.from(sel(zone).querySelectorAll(':scope > input[type=hidden]')).map((n: any) => `${n.name}=${n.value}`)
        recus.push({ zone, type, data: e.data, champs })
      })
    }
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('flèche droite : l\'option suivante, sans ouvrir la liste, un seul change, champ du formulaire déjà à jour ; au bord, rien', async () => {
    assert.equal(libelle('droite'), 'Allemagne', 'sanity : le départ')
    assert.equal(await presser('droite', 'ArrowRight'), true, 'la touche est consommée')
    assert.deepEqual(de('droite').map((r) => [r.data, r.champs]), [['us', ['pays=us']]], 'un change, déjà avec le champ d\'après')
    assert.equal(sel('droite')._state.value, 'us')
    assert.equal(libelle('droite'), 'États-Unis', 'le bouton dit le nouveau choix')
    assert.equal(ferme('droite'), true, 'la liste reste fermée')
    assert.equal(await presser('droite', 'ArrowRight'), true, 'au bord la touche reste consommée')
    assert.equal(de('droite').length, 1, 'au bord : aucun change de plus')
    assert.equal(sel('droite')._state.value, 'us', 'pas de retour à la première option')
  })

  it('flèche gauche : l\'option précédente ; au bord, rien', async () => {
    assert.equal(await presser('gauche', 'ArrowLeft'), true)
    assert.deepEqual(de('gauche').map((r) => [r.data, r.champs]), [['fr', ['pays=fr']]])
    assert.equal(libelle('gauche'), 'France')
    assert.equal(ferme('gauche'), true)
    assert.equal(await presser('gauche', 'ArrowLeft'), true)
    assert.equal(de('gauche').length, 1)
    assert.equal(sel('gauche')._state.value, 'fr', 'pas de retour à la dernière option')
  })

  it('valeur liée value=!{…} : la variable suit le geste, et @change joue une fois', async () => {
    await presser('lie', 'ArrowRight')
    assert.equal(hote._state.lie, 'us')
    assert.equal(hote._state.echos, 1)
    await presser('lie', 'ArrowLeft')
    assert.equal(hote._state.lie, 'de')
    assert.equal(hote._state.echos, 2)
  })

  it('rien de choisi : la droite choisit la première option, la gauche ne choisit rien', async () => {
    assert.equal(await presser('vide', 'ArrowLeft'), true)
    assert.equal(de('vide').length, 0)
    await presser('vide', 'ArrowRight')
    assert.deepEqual(de('vide').map((r) => r.data), ['fr'])
    assert.equal(libelle('vide'), 'France')
  })

  it('valeur typée : e.data garde le type posé par la page (le nombre 18, puis 30)', async () => {
    await presser('types', 'ArrowRight')
    await presser('types', 'ArrowRight')
    assert.deepEqual(de('types').map((r) => r.data), [18, 30])
    assert.deepEqual(de('types').map((r) => r.champs), [['nombre=18'], ['nombre=30']])
  })

  it('groupes : les titres ne sont pas des arrêts, la flèche passe d\'un groupe à l\'autre comme dans une seule liste', async () => {
    await presser('groupes', 'ArrowRight')
    await presser('groupes', 'ArrowLeft')
    await presser('groupes', 'ArrowLeft')
    assert.deepEqual(de('groupes').map((r) => r.data), ['jp', 'de', 'fr'])
  })

  it('deux options de même valeur : la flèche ne reste pas coincée sur la première', async () => {
    assert.equal(libelle('doublons'), 'Un')
    await presser('doublons', 'ArrowRight')
    await presser('doublons', 'ArrowLeft')
    await presser('doublons', 'ArrowLeft')
    assert.deepEqual(de('doublons').map((r) => r.data), ['2', '1'], 'de 1 à 2 (la copie est sautée), de 2 à 1, puis le bord')
    assert.equal(libelle('doublons'), 'Un')
  })

  it('choix multiple : les flèches ne font rien et restent à la page', async () => {
    assert.equal(await presser('multi', 'ArrowRight'), false)
    assert.equal(await presser('multi', 'ArrowLeft'), false)
    assert.equal(de('multi').length, 0)
    assert.deepEqual(Array.from(sel('multi')._state.value), ['de'])
    assert.equal(ferme('multi'), true)
  })

  it('« Autre… » : la flèche saute la ligne, elle ne l\'ouvre pas ; la dernière option est le bord', async () => {
    await presser('libre', 'ArrowRight')
    await presser('libre', 'ArrowRight')
    assert.deepEqual(de('libre').map((r) => r.data), ['us'])
    assert.equal(de('libre', 'other').length, 0, 'aucune réponse libre ne change')
    assert.equal(sel('libre')._state.otherEditing, false, 'le champ de réponse libre reste fermé')
    assert.equal(ferme('libre'), true)
    await presser('libre', 'ArrowLeft')
    assert.deepEqual(de('libre').map((r) => r.data), ['us', 'de'])
  })

  it('réponse libre déjà donnée : les flèches ne la remplacent pas', async () => {
    await presser('donnee', 'ArrowRight')
    await presser('donnee', 'ArrowLeft')
    assert.equal(de('donnee').length, 0)
    assert.equal(de('donnee', 'other').length, 0)
    assert.equal(sel('donnee')._state.value, 'Zed')
    assert.equal(ferme('donnee'), true)
  })

  it('une touche de modification enfoncée (Alt, Ctrl, Méta, Maj) : rien, la touche reste au navigateur', async () => {
    for (const modif of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
      assert.equal(await presser('modifs', 'ArrowRight', { [modif]: true }), false, modif)
      assert.equal(await presser('modifs', 'ArrowLeft', { [modif]: true }), false, modif)
    }
    assert.equal(de('modifs').length, 0)
    assert.equal(sel('modifs')._state.value, 'de')
  })

  for (const [cas, , rang] of OUVERTURES) it(`flèche haute, liste fermée (${cas}) : elle s'ouvre comme avec la basse, sur la même ligne active, sans rien choisir`, async () => {
    const choix  = (zone: string) => { const v = sel(zone)._state.value; return Array.isArray(v) ? Array.from(v) : v }
    const depart = choix(`bas-${cas}`)
    for (const [zone, k] of [[`bas-${cas}`, 'ArrowDown'], [`haut-${cas}`, 'ArrowUp']]) {
      assert.equal(ferme(zone), true, `${zone} : sanity, fermée au départ`)
      assert.equal(await presser(zone, k), true, `${zone} : la touche est consommée`)
      assert.equal(sel(zone)._state.open, true, `${zone} : la liste est ouverte`)
      assert.equal(coque(zone).querySelector('.select-panel') !== null, true, `${zone} : le panneau est là`)
      assert.equal(sel(zone)._state.activeIndex, rang, `${zone} : la ligne active`)
      assert.deepEqual(choix(zone), depart, `${zone} : le choix ne bouge pas`)
      assert.equal(de(zone).length + de(zone, 'other').length, 0, `${zone} : aucun change ni other`)
      await presser(zone, 'Escape')
      assert.equal(ferme(zone), true, `${zone} : Échap la referme`)
    }
  })

  it('flèche haute avec Alt, Ctrl, Méta ou Maj enfoncé : elle ouvre la liste comme la flèche basse avec les mêmes touches, sur la même ligne active, sans rien choisir', async () => {
    for (const modif of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
      const lignes: number[] = []
      for (const k of ['ArrowDown', 'ArrowUp']) {
        assert.equal(ferme('modifs'), true, `${k} + ${modif} : sanity, fermée au départ`)
        assert.equal(await presser('modifs', k, { [modif]: true }), true, `${k} + ${modif} : la touche est consommée`)
        assert.equal(sel('modifs')._state.open, true, `${k} + ${modif} : la liste est ouverte`)
        assert.equal(sel('modifs')._state.value, 'de', `${k} + ${modif} : le choix ne bouge pas`)
        lignes.push(sel('modifs')._state.activeIndex)
        await presser('modifs', 'Escape')
        assert.equal(ferme('modifs'), true, `${k} + ${modif} : Échap la referme`)
      }
      assert.equal(lignes[0], lignes[1], `${modif} : même ligne active, haute et basse`)
    }
    assert.equal(de('modifs').length, 0, 'aucun change')
  })

  it('liste ouverte sans recherche : droite et gauche ne changent rien, ni le choix ni la ligne active', async () => {
    clic(bouton('ouverte'))
    await pause(30)
    assert.equal(sel('ouverte')._state.open, true, 'sanity : la liste est ouverte')
    const active = sel('ouverte')._state.activeIndex
    assert.equal(await presser('ouverte', 'ArrowRight'), false)
    assert.equal(await presser('ouverte', 'ArrowLeft'), false)
    assert.equal(de('ouverte').length, 0)
    assert.equal(sel('ouverte')._state.value, 'de')
    assert.equal(sel('ouverte')._state.open, true, 'la liste reste ouverte')
    assert.equal(sel('ouverte')._state.activeIndex, active, 'la ligne active ne bouge pas')
    await presser('ouverte', 'Escape')
  })

  it('liste ouverte avec recherche : droite et gauche restent au champ de recherche (curseur)', async () => {
    clic(bouton('cherche'))
    await pause(30)
    const champ = coque('cherche').querySelector('.select-search')
    assert.equal(champ !== null, true, 'sanity : le champ de recherche est là')
    assert.equal(touche(champ, 'ArrowRight'), false)
    assert.equal(touche(champ, 'ArrowLeft'), false)
    await pause(30)
    assert.equal(de('cherche').length, 0)
    assert.equal(sel('cherche')._state.value, 'de')
    assert.equal(sel('cherche')._state.open, true)
    await presser('cherche', 'Escape')
  })

  it('saisie d\'une réponse libre : droite et gauche restent au champ de saisie', async () => {
    clic(bouton('saisie'))
    await pause(30)
    clic(coque('saisie').querySelector('.select-other'))
    await pause(60)
    const champ = coque('saisie').querySelector('.select-other-input')
    assert.equal(champ !== null, true, 'sanity : le champ de réponse libre est ouvert')
    assert.equal(touche(champ, 'ArrowRight'), false)
    assert.equal(touche(champ, 'ArrowLeft'), false)
    await pause(30)
    assert.equal(de('saisie').length, 0)
    assert.equal(sel('saisie')._state.value, 'de')
    assert.equal(sel('saisie')._state.otherEditing, true, 'le champ reste ouvert')
    touche(champ, 'Escape')
    await pause(30)
    await presser('saisie', 'Escape')
  })
})
