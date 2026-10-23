// La remise à zéro des modules de saisie du cœur est écrite UNE fois (une aide du cœur) : un formulaire qui
// contient plusieurs modules, de natures différentes, n'écoute le `reset` qu'UNE fois. L'écoute se pose à
// l'arrivée du premier module du formulaire et se retire au départ du dernier ; chaque module garde son état
// de départ, pris un cran après son montage, et le retrouve à la remise, sauf si la page l'annule.
// - trois modules différents dans un formulaire (dans l'ombre de la page, comme ici) : une seule écoute ;
// - un module déplacé dans un autre formulaire : l'ancien est quitté, le nouveau écouté une seule fois ;
// - une remise annulée par la page ne touche à rien ;
// - un module retiré de la page n'est ni restauré ni écouté ; un module ajouté après coup l'est.
// happy-dom, bundler réel.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monterHote, pause } from './helpers/coeur-monter.js'

const TROIS = [
  '<script>',
  '  $a = false',
  '  $b = false',
  '  $c = false',
  '</script>',
  '<form id="f" @noUJS>',
  '  {if $a}<@@checkbox class="c" name="c" checked>Case</@@checkbox>{end}',
  '  {if $b}<@@gauge class="g" name="g" value={3}></@@gauge>{end}',
  '  {if $c}<@@select class="p" name="pays" value="fr"><@@option value="fr">France</@@option><@@option value="be">Belgique</@@option></@@select>{end}',
  '</form>',
  '<form id="g" @noUJS></form>',
].join('\n')

const formulaire = (hote: any, id = 'f') => hote._shadow.querySelector('#' + id)

// ce que les formulaires reçoivent comme écoute du `reset` : les appels (poses), les écouteurs distincts encore là (vivants)
function espionner(forms: any[]) {
  const poses   = new Map<any, number>()
  const vivants = new Map<any, Set<any>>()
  for (const form of forms) {
    poses.set(form, 0)
    vivants.set(form, new Set())
    const ajouter = form.addEventListener.bind(form)
    const retirer = form.removeEventListener.bind(form)
    form.addEventListener    = (t: string, f: any, o?: any) => { if (t === 'reset') { poses.set(form, poses.get(form)! + 1); vivants.get(form)!.add(f) } return ajouter(t, f, o) }
    form.removeEventListener = (t: string, f: any, o?: any) => { if (t === 'reset') vivants.get(form)!.delete(f); return retirer(t, f, o) }
  }
  return { poses: (form: any) => poses.get(form)!, vivants: (form: any) => vivants.get(form)!.size }
}

// les gestes d'un utilisateur : décocher la case, un cran de plus sur la jauge, choisir Belgique
const natif    = (m: any, classe: string) => m.hote._shadow.querySelector('.' + classe)._shadow.querySelector('input')
const etat     = (m: any) => [natif(m, 'c').checked, m.hote._shadow.querySelector('.g')._shadow.querySelector('output').textContent.trim(), m.hote._shadow.querySelector('.p')._shadow.querySelector('.select-label').textContent.trim()]
async function modifier(m: any) {
  natif(m, 'c').click()
  m.hote._shadow.querySelector('.g')._shadow.querySelector('.btn').click()
  m.hote._shadow.querySelector('.p')._shadow.querySelector('.select-btn').click()
  await attendre(() => !!m.hote._shadow.querySelector('.p')._shadow.querySelector('.select-option'))
  m.hote._shadow.querySelector('.p')._shadow.querySelectorAll('.select-option')[1].click()
  await pause(200)
}

const DEPART = [true, '3', 'France']
const CHANGE = [false, '4', 'Belgique']

// un hôte dont le formulaire est vide, espionné, puis rempli module par module (la case, la jauge, la liste)
async function monterTrois(prefixe: string, drapeaux: string[] = ['a', 'b', 'c']) {
  const m = await monterHote(TROIS, prefixe)
  const ecoute = espionner([formulaire(m.hote), formulaire(m.hote, 'g')])
  for (const d of drapeaux) {
    m.hote._set(d, true)
    await pause(150)
  }
  if (drapeaux.includes('c')) await attendre(() => !!m.hote._shadow.querySelector('.p')?._shadow?.querySelector('.select-label'))
  await pause(300)
  return { m, ecoute }
}

const MODULES = 'mjs-core-checkbox, mjs-core-gauge, mjs-core-select'

describe('composants du cœur — une seule écoute du reset par formulaire', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('la case, la jauge et la liste dans le même formulaire : UNE seule écoute du reset, pas une par module', async () => {
    const { m, ecoute } = await monterTrois('reset-un-ecouteur')
    const form = formulaire(m.hote)
    assert.equal(form.querySelectorAll(MODULES).length, 3, 'préalable : les trois modules sont dans le formulaire')
    assert.equal(ecoute.poses(form), 1, 'une seule pose')
    assert.equal(ecoute.vivants(form), 1, 'un seul écouteur vivant')
    m.window.close()
  })

  it('une remise rend les trois à leur départ', async () => {
    const { m } = await monterTrois('reset-un-ecouteur-remise')
    assert.deepEqual(etat(m), DEPART, 'départ posé par la page')
    await modifier(m)
    assert.deepEqual(etat(m), CHANGE, 'préalable : les gestes ont tout changé')
    formulaire(m.hote).reset()
    await attendre(() => JSON.stringify(etat(m)) === JSON.stringify(DEPART))
    await pause(150)
    assert.deepEqual(etat(m), DEPART, 'la case, la jauge et la liste sont revenues')
    m.window.close()
  })

  it('une remise annulée par la page, après coup, ne touche à rien', async () => {
    const { m } = await monterTrois('reset-un-ecouteur-annule')
    await modifier(m)
    assert.deepEqual(etat(m), CHANGE, 'préalable')
    const annule = (e: Event) => e.preventDefault()
    m.hote._shadow.addEventListener('reset', annule)
    formulaire(m.hote).reset()
    await pause(400)
    assert.deepEqual(etat(m), CHANGE, 'tout reste tel que l\'utilisateur l\'a laissé')
    m.hote._shadow.removeEventListener('reset', annule)
    formulaire(m.hote).reset()
    await attendre(() => JSON.stringify(etat(m)) === JSON.stringify(DEPART))
    await pause(150)
    assert.deepEqual(etat(m), DEPART, 'sans l\'annulation, tout revient')
    m.window.close()
  })

  it('déplacés dans un autre formulaire : l\'ancien est quitté, le nouveau écouté une seule fois', async () => {
    const { m, ecoute } = await monterTrois('reset-un-ecouteur-deplace')
    const f1  = formulaire(m.hote)
    const f2  = formulaire(m.hote, 'g')
    const bef = ecoute.poses(f2)
    for (const el of Array.from(f1.querySelectorAll(MODULES))) f2.appendChild(el)
    await pause(300)
    assert.equal(ecoute.vivants(f1), 0, 'l\'ancien formulaire n\'écoute plus')
    assert.equal(ecoute.vivants(f2), 1, 'le nouveau écoute une fois')
    assert.equal(ecoute.poses(f2) - bef, 1, 'une seule pose pour les trois')
    await modifier(m)
    assert.deepEqual(etat(m), CHANGE, 'préalable : les gestes ont tout changé')
    f1.reset()
    await pause(400)
    assert.deepEqual(etat(m), CHANGE, 'la remise de l\'ancien formulaire ne les concerne plus')
    f2.reset()
    await attendre(() => JSON.stringify(etat(m)) === JSON.stringify(DEPART))
    await pause(150)
    assert.deepEqual(etat(m), DEPART, 'la remise du nouveau les rend')
    m.window.close()
  })

  it('retirés de la page : ni écoutés ni restaurés, et l\'écoute part avec le dernier', async () => {
    const { m, ecoute } = await monterTrois('reset-un-ecouteur-retire')
    const form = formulaire(m.hote)
    const [a, b, c] = ['mjs-core-checkbox', 'mjs-core-gauge', 'mjs-core-select'].map((t) => form.querySelector(t))
    await modifier(m)
    assert.equal(a._state.checked, false, 'préalable : la case est décochée')
    a.remove()
    b.remove()
    await pause(150)
    assert.equal(ecoute.vivants(form), 1, 'il reste la liste : toujours une écoute')
    form.reset()
    await attendre(() => m.hote._shadow.querySelector('.p')._shadow.querySelector('.select-label').textContent.trim() === 'France')
    await pause(150)
    assert.equal(a._state.checked, false, 'la case retirée est restée comme l\'utilisateur l\'avait laissée : la remise ne l\'a pas rendue')
    c.remove()
    await pause(150)
    assert.equal(ecoute.vivants(form), 0, 'plus aucun module : plus d\'écoute')
    m.window.close()
  })

  it('un `reset` lancé depuis un élément du formulaire, pas par le formulaire : aucune erreur, rien n\'est rendu', async () => {
    const { m } = await monterTrois('reset-un-ecouteur-etranger', ['a'])
    const form    = formulaire(m.hote)
    const erreurs: string[] = []
    const prise   = (e: any) => erreurs.push(String(e?.message ?? e))
    const log     = m.window.console.error
    m.window.addEventListener('error', (e: any) => erreurs.push(String(e.message ?? e.error)))
    m.window.console.error = (...a: any[]) => { erreurs.push(a.map(String).join(' ')); log.apply(m.window.console, a) }
    process.on('uncaughtException', prise)
    natif(m, 'c').click()
    await pause(100)
    assert.equal(natif(m, 'c').checked, false, 'préalable : décochée')
    form.querySelector('mjs-core-checkbox').dispatchEvent(new m.window.Event('reset', { bubbles: true }))
    await pause(400)
    process.off('uncaughtException', prise)
    assert.deepEqual(erreurs, [], 'aucune erreur')
    assert.equal(natif(m, 'c').checked, false, 'comme un champ natif : seul le reset du formulaire rend le départ')
    form.reset()
    await attendre(() => natif(m, 'c').checked)
    assert.equal(natif(m, 'c').checked, true, 'le reset du formulaire, lui, la rend')
    m.window.close()
  })

  it('un module ajouté après le chargement est pris en compte, sans seconde écoute', async () => {
    const { m, ecoute } = await monterTrois('reset-un-ecouteur-tard', ['b'])
    const form = formulaire(m.hote)
    assert.equal(ecoute.vivants(form), 1, 'préalable : la jauge est écoutée')
    m.hote._set('a', true)
    await attendre(() => !!m.hote._shadow.querySelector('.c')?._shadow?.querySelector('input'))
    await pause(300)
    assert.equal(ecoute.vivants(form), 1, 'la case ajoutée ne pose pas de seconde écoute')
    assert.equal(ecoute.poses(form), 1, 'une seule pose en tout')
    natif(m, 'c').click()
    await pause(100)
    assert.equal(natif(m, 'c').checked, false, 'préalable : décochée')
    form.reset()
    await attendre(() => natif(m, 'c').checked)
    assert.equal(natif(m, 'c').checked, true, 'la remise la rend')
    m.window.close()
  })
})
