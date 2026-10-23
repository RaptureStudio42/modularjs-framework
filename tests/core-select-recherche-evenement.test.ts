// Ce que ce test garantit : une page peut chercher elle-même pour `<@@select>`.
// - un champ de recherche (`search`) annonce chaque saisie par l'événement `search` (qui remonte, `e.data` = le texte tapé), comme `change` annonce le choix ;
//   quand le panneau se ferme sur une recherche qui portait du texte, `search` part aussi avec '' (la page remet sa liste) ;
// - `match="async"` : la liste ne filtre plus d'elle-même, la page fournit les options à montrer ; l'option active reste valide quand elles changent
//   pendant que le panneau est ouvert, et les groupes <@@optgroup> se rendent toujours ;
// - une liste qui n'écrit ni `@search` ni `match="async"` ne change pas : elle filtre comme avant ;
// - `match="none"` n'est pas un mode : c'est une valeur inconnue, qui retombe sur `contains` comme toute autre (la liste filtre elle-même).
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'
import { assertAbsent } from './helpers/dom-assert.js'

const HOTE = `<script>
  $trouves = [{ id: 'a', nom: 'Alpha' }, { id: 'b', nom: 'Beta' }, { id: 'c', nom: 'Gamma' }]

  @cherche = (e)->
    $trouves = if e.data == 'x' then [{ id: 'x1', nom: 'Xi' }] else if e.data == 'vide' then [] else [{ id: 'a', nom: 'Alpha' }, { id: 'b', nom: 'Beta' }, { id: 'c', nom: 'Gamma' }]
</script>

<div id="serveur">
  <@@select name="serveur" search match="async" @search={@cherche(e)}>
    {for t in $trouves by id}
      <@@option value={t.id}>{t.nom}</@@option>
    {end}
  </@@select>
</div>

<div id="groupes">
  <@@select name="groupes" search match="async">
    <@@optgroup label="Lettres">
      <@@option value="a">Alpha</@@option>
      <@@option value="b">Beta</@@option>
    </@@optgroup>
    <@@optgroup label="Chiffres">
      <@@option value="un">Un</@@option>
    </@@optgroup>
  </@@select>
</div>

<div id="ordinaire">
  <@@select name="ordinaire" search>
    <@@option value="a">Alpha</@@option>
    <@@option value="b">Beta</@@option>
    <@@option value="c">Gamma</@@option>
  </@@select>
</div>

<div id="ancien">
  <@@select name="ancien" search match="none">
    <@@option value="a">Alpha</@@option>
    <@@option value="b">Beta</@@option>
    <@@option value="c">Gamma</@@option>
  </@@select>
</div>

<div id="inconnu">
  <@@select name="inconnu" search match="bidule">
    <@@option value="a">Alpha</@@option>
    <@@option value="b">Beta</@@option>
    <@@option value="c">Gamma</@@option>
  </@@select>
</div>
`

describe('<@@select> — la page peut chercher elle-même (@search, match="async")', function () {
  this.timeout(60000)

  let window: any = null
  let hote: any   = null
  const recus: Array<{ zone: string; data: any; bubbles: boolean; composed: boolean }> = []

  const sel     = (zone: string) => hote._shadow.querySelector(`#${zone} mjs-core-select`)
  const bouton  = (zone: string) => sel(zone)._shadow.querySelector('.select-btn')
  const options = (zone: string) => Array.from(sel(zone)._shadow.querySelectorAll('.select-option')) as any[]
  const textes  = (zone: string) => options(zone).map((o: any) => o.textContent.trim())
  const clic    = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
  const ouvrir  = async (zone: string) => { if (!sel(zone)._state.open) { clic(bouton(zone)); await pause(40) } }
  const fermer  = async (zone: string) => { if (sel(zone)._state.open) { clic(bouton(zone)); await pause(40) } }
  const taper   = async (zone: string, texte: string) => {
    const input = sel(zone)._shadow.querySelector('.select-search')
    input.value = texte
    input.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true, composed: true }))
    await pause(60)
  }
  const recusDe = (zone: string) => recus.filter((r) => r.zone === zone)

  before(async () => {
    const monte = await monterHote(HOTE, 'core-select-recherche')
    window = monte.window
    hote   = monte.hote
    for (const zone of ['serveur', 'groupes', 'ordinaire']) {
      hote._shadow.querySelector(`#${zone}`).addEventListener('search', (e: any) => recus.push({ zone, data: e.data, bubbles: e.bubbles, composed: e.composed }))
    }
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('chaque saisie annonce un événement search qui remonte, e.data = le texte tapé', async () => {
    await ouvrir('serveur')
    await taper('serveur', 'al')
    await taper('serveur', 'alp')
    assert.deepEqual(recusDe('serveur').map((r) => r.data), ['al', 'alp'])
    assert.equal(recusDe('serveur')[0].bubbles, true)
    assert.equal(recusDe('serveur')[0].composed, true)
  })

  it('match="async" : la liste ne filtre pas d\'elle-même, la page fournit ses options', async () => {
    assert.deepEqual(textes('serveur'), ['Alpha', 'Beta', 'Gamma'], 'le texte tapé n\'a rien filtré')
    await taper('serveur', 'x')
    assert.deepEqual(textes('serveur'), ['Xi'], 'la page a remplacé les options en réponse à @search')
    assertAbsent(hote._shadow.querySelector('#serveur .select-empty'))
  })

  it('options remplacées pendant que le panneau est ouvert : l\'option active reste valide', async () => {
    assert.equal(sel('serveur')._state.activeIndex, 0)
    await taper('serveur', 'vide')
    assert.equal(sel('serveur')._state.activeIndex, -1, 'liste vide : aucune ligne active')
    await taper('serveur', 'tout')
    assert.deepEqual(textes('serveur'), ['Alpha', 'Beta', 'Gamma'])
    assert.equal(sel('serveur')._state.activeIndex, 0, 'liste revenue : la première ligne est active')
    const roue = sel('serveur')._shadow.querySelector('.select')
    for (let k = 0; k < 2; k++) roue.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true, composed: true }))
    await pause(40)
    assert.equal(sel('serveur')._state.activeIndex, 2)
    await taper('serveur', 'x')
    assert.equal(sel('serveur')._state.activeIndex, 0, 'liste plus courte : l\'index reste dans les bornes')
    assert.ok(options('serveur')[0].classList.contains('active'))
  })

  it('fermeture d\'un panneau dont la recherche portait du texte : search part avec \'\'', async () => {
    const avant = recusDe('serveur').length
    await fermer('serveur')
    const apres = recusDe('serveur')
    assert.equal(apres.length, avant + 1)
    assert.equal(apres.at(-1)!.data, '')
  })

  it('fermeture d\'une recherche restée vide : aucun événement de plus', async () => {
    await ouvrir('serveur')
    const avant = recusDe('serveur').length
    await fermer('serveur')
    assert.equal(recusDe('serveur').length, avant)
  })

  it('match="async" avec des groupes : les sections et leurs titres se rendent, sans filtre', async () => {
    await ouvrir('groupes')
    await taper('groupes', 'zzz')
    const titres = Array.from(sel('groupes')._shadow.querySelectorAll('.select-group-label')).map((t: any) => t.textContent.trim())
    assert.deepEqual(titres, ['Lettres', 'Chiffres'])
    assert.deepEqual(textes('groupes'), ['Alpha', 'Beta', 'Un'])
    assert.equal(recusDe('groupes').at(-1)!.data, 'zzz')
    await fermer('groupes')
  })

  it('une liste sans match="async" filtre comme avant, et annonce quand même ce qui est tapé', async () => {
    await ouvrir('ordinaire')
    await taper('ordinaire', 'bet')
    assert.deepEqual(textes('ordinaire'), ['Beta'])
    assert.equal(recusDe('ordinaire').at(-1)!.data, 'bet')
    await fermer('ordinaire')
    assert.equal(recusDe('ordinaire').at(-1)!.data, '')
  })

  it('match="none" n\'est pas un mode : valeur inconnue comme « bidule », la liste filtre elle-même comme contains', async () => {
    for (const zone of ['ancien', 'inconnu']) {
      await ouvrir(zone)
      assert.deepEqual(textes(zone), ['Alpha', 'Beta', 'Gamma'], zone)
      await taper(zone, 'lph')
      assert.deepEqual(textes(zone), ['Alpha'], `${zone} : « lph » est au milieu de « Alpha »`)
      await taper(zone, 'ap')
      assert.deepEqual(textes(zone), [], `${zone} : contains veut les lettres collées, « ap » ne trouve rien`)
      await taper(zone, 'bet')
      assert.deepEqual(textes(zone), ['Beta'], zone)
      await fermer(zone)
    }
  })
})
