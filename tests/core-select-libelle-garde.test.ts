// Ce que ce test garantit : avec `match="async"`, le bouton de `<@@select>` garde le libellé et l'icône du choix courant quand la page
// remplace les options pendant une recherche et que l'option choisie n'y est plus.
// - choix simple et choix multiple : le libellé reste, le bouton n'est pas grisé, le champ du formulaire (FormData) garde la valeur ;
// - recherche vidée : tout revient ; un autre choix fait pendant la recherche prend la place du libellé ;
// - une valeur posée par la page qui ne correspond à aucune option jamais vue montre toujours le texte d'attente, avec ou sans `match="async"` ;
// - une liste sans `match="async"` dont l'option choisie quitte la liste ne change pas : texte d'attente comme avant ;
// - `match="none"` n'est pas un mode : valeur inconnue, la liste ne garde aucun libellé, comme une liste sans `match="async"`.
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const TOUS = "[{ id: 'a', nom: 'Alpha' }, { id: 'b', nom: 'Beta' }, { id: 'c', nom: 'Gamma' }]"

const HOTE = `<script>
  $simple = ${TOUS}
  $multi  = ${TOUS}
  $nu     = ${TOUS}
  $ancien = ${TOUS}

  @cherche = (e)->
    $simple = if e.data == 'x' then [{ id: 'x1', nom: 'Xi' }] else ${TOUS}

  @chercheMulti = (e)->
    $multi = if e.data == 'x' then [{ id: 'x1', nom: 'Xi' }] else ${TOUS}

  @chercheNu = (e)->
    $nu = if e.data == 'x' then [{ id: 'x1', nom: 'Xi' }] else ${TOUS}

  @chercheAncien = (e)->
    $ancien = if e.data == 'x' then [{ id: 'x1', nom: 'Xi' }] else ${TOUS}
</script>

<form id="formulaire" @noUJS>
  <div id="simple">
    <@@select name="simple" search match="async" @search={@cherche(e)}>
      {for t in $simple by id}
        <@@option value={t.id} icon="★">{t.nom}</@@option>
      {end}
    </@@select>
  </div>

  <div id="multi">
    <@@select name="multi[]" multiple search match="async" @search={@chercheMulti(e)}>
      {for t in $multi by id}
        <@@option value={t.id}>{t.nom}</@@option>
      {end}
    </@@select>
  </div>

  <div id="inconnue">
    <@@select name="inconnue" search match="async" value="zz">
      <@@option value="a">Alpha</@@option>
    </@@select>
  </div>

  <div id="inconnue-filtre">
    <@@select name="inconnue-filtre" search value="zz">
      <@@option value="a">Alpha</@@option>
    </@@select>
  </div>

  <div id="ordinaire">
    <@@select name="ordinaire" search @search={@chercheNu(e)}>
      {for t in $nu by id}
        <@@option value={t.id}>{t.nom}</@@option>
      {end}
    </@@select>
  </div>

  <div id="ancien">
    <@@select name="ancien" search match="none" @search={@chercheAncien(e)}>
      {for t in $ancien by id}
        <@@option value={t.id}>{t.nom}</@@option>
      {end}
    </@@select>
  </div>
</form>
`

describe('<@@select> — le bouton garde le libellé du choix quand la page remplace les options (match="async")', function () {
  this.timeout(60000)

  let window: any = null
  let hote: any   = null

  const sel      = (zone: string) => hote._shadow.querySelector(`#${zone} mjs-core-select`)
  const bouton   = (zone: string) => sel(zone)._shadow.querySelector('.select-btn')
  const etiquette = (zone: string) => sel(zone)._shadow.querySelector('.select-label')
  const icone    = (zone: string) => sel(zone)._shadow.querySelector('.select-btn .select-icon')
  const options  = (zone: string) => Array.from(sel(zone)._shadow.querySelectorAll('.select-option')) as any[]
  const textes   = (zone: string) => options(zone).map((o: any) => o.textContent.replace('★', '').trim())
  const libelle  = (zone: string) => etiquette(zone).textContent.trim()
  const grise    = (zone: string) => etiquette(zone).classList.contains('placeholder')
  const clic     = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
  const ouvrir   = async (zone: string) => { if (!sel(zone)._state.open) { clic(bouton(zone)); await pause(40) } }
  const taper    = async (zone: string, texte: string) => {
    const input = sel(zone)._shadow.querySelector('.select-search')
    input.value = texte
    input.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true, composed: true }))
    await pause(60)
  }
  const choisir  = async (zone: string, texte: string) => {
    clic(options(zone).find((o: any) => o.textContent.replace('★', '').trim() === texte))
    await pause(60)
  }
  const champs   = (nom: string) => Array.from(new window.FormData(hote._shadow.querySelector('#formulaire'))).filter((p: any) => p[0] === nom).map((p: any) => p[1])

  before(async () => {
    const monte = await monterHote(HOTE, 'core-select-libelle-garde')
    window = monte.window
    hote   = monte.hote
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('choix simple : l\'option choisie quitte la liste, le bouton garde son libellé et son icône, sans être grisé', async () => {
    await ouvrir('simple')
    await choisir('simple', 'Alpha')
    await ouvrir('simple')
    await taper('simple', 'x')
    assert.deepEqual(textes('simple'), ['Xi'])
    assert.equal(libelle('simple'), 'Alpha')
    assert.equal(grise('simple'), false)
    assert.equal(icone('simple')?.textContent.trim(), '★')
  })

  it('le champ du formulaire garde la valeur choisie', () => {
    assert.deepEqual(champs('simple'), ['a'])
  })

  it('recherche vidée : la liste revient, le libellé est le même', async () => {
    await taper('simple', '')
    assert.deepEqual(textes('simple'), ['Alpha', 'Beta', 'Gamma'])
    assert.equal(libelle('simple'), 'Alpha')
    assert.equal(grise('simple'), false)
  })

  it('un autre choix fait parmi les options de la recherche prend la place du libellé, et le garde après', async () => {
    await taper('simple', 'x')
    await choisir('simple', 'Xi')
    assert.equal(libelle('simple'), 'Xi')
    assert.deepEqual(champs('simple'), ['x1'])
    await ouvrir('simple')
    await taper('simple', '')
    assert.equal(libelle('simple'), 'Xi')
    assert.deepEqual(champs('simple'), ['x1'])
  })

  it('choix multiple : chaque valeur choisie garde son libellé, le champ garde les valeurs', async () => {
    await ouvrir('multi')
    await choisir('multi', 'Alpha')
    await choisir('multi', 'Beta')
    await taper('multi', 'x')
    assert.deepEqual(textes('multi'), ['Xi'])
    assert.equal(libelle('multi'), 'Alpha, Beta')
    assert.equal(grise('multi'), false)
    assert.deepEqual(champs('multi[]'), ['a', 'b'])
    await choisir('multi', 'Xi')
    assert.equal(libelle('multi'), 'Alpha, Beta, Xi')
    await taper('multi', '')
    assert.equal(libelle('multi'), 'Alpha, Beta, Xi')
    assert.deepEqual(champs('multi[]'), ['a', 'b', 'x1'])
  })

  it('une valeur posée par la page qui ne correspond à aucune option vue : texte d\'attente grisé, avec ou sans match="async"', () => {
    for (const zone of ['inconnue', 'inconnue-filtre']) {
      assert.equal(grise(zone), true, zone)
      assert.notEqual(libelle(zone), 'zz', zone)
    }
  })

  it('une liste sans match="async" dont l\'option choisie quitte la liste : texte d\'attente comme avant', async () => {
    await ouvrir('ordinaire')
    await choisir('ordinaire', 'Beta')
    await ouvrir('ordinaire')
    assert.equal(libelle('ordinaire'), 'Beta')
    await taper('ordinaire', 'x')
    assert.equal(grise('ordinaire'), true)
  })

  it('match="none" n\'est pas un mode : valeur inconnue, l\'option choisie qui quitte la liste ne garde pas son libellé', async () => {
    await ouvrir('ancien')
    await choisir('ancien', 'Beta')
    await ouvrir('ancien')
    assert.equal(libelle('ancien'), 'Beta')
    await taper('ancien', 'x')
    assert.deepEqual(textes('ancien'), ['Xi'])
    assert.equal(grise('ancien'), true)
  })
})
