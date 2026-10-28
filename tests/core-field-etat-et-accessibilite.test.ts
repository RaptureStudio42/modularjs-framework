// module cœur field (<@@field>) : l'état succès n'arrive qu'avec une réponse du serveur (le name
// déduit du champ au montage n'en est pas une), le libellé du module nomme le champ enveloppé (un
// <label for> dans le shadow ne vise rien hors de son arbre), l'erreur se lit aussi pour un lecteur
// d'écran, et le libellé flottant suit une valeur posée par programme.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'
import { attendre } from './helpers/attendre.js'

const champDe = (hote: any, sel = 'mjs-core-field') => hote._shadow.querySelector(sel)
const classe  = (f: any, c: string) => f._shadow.querySelector('.field').classList.contains(c)

// l'hôte monté, puis chaque <@@field> qu'il pose : une porte sur leur rendu (la pause fixe de monterHote ne suffit pas
// toujours sous charge) ; chaque état attendu après un geste l'est aussi, une pause ne reste que pour vérifier que
// rien ne bouge
async function monter(source: string, prefixe: string) {
  const m = await monterHote(source, prefixe)
  await attendre(() => {
    const champs = Array.from(m.hote._shadow.querySelectorAll('mjs-core-field')) as any[]
    return champs.length > 0 && champs.every((f) => !!f._shadow?.querySelector('.field'))
  }, `${prefixe} : chaque <@@field> monté`)
  return m
}

describe('mjs-core-field — le succès attend une réponse du serveur', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('sans name sur l\'enveloppe : neutre au montage, ni bordure verte ni message de succès', async () => {
    const { window, hote } = await monter('<@@field label="Email" ok-label="Disponible !"><input type="email" name="email"></@@field>', 'field-succes-montage')
    const f = champDe(hote)
    assert.equal(f._shadow.querySelector('.field').classList.contains('has-ok'), false, 'aucune classe has-ok')
    assert.equal(f.querySelector('input').hasAttribute('mjs-field'), false, 'aucun état posé sur le champ')
    assert.equal(f._shadow.querySelector('.ok') === null, true, 'aucun message de succès')
    window.close()
  })

  it('le name du champ renommé ensuite, sans réponse : toujours neutre', async () => {
    const { window, hote } = await monter('<@@field label="Pseudo"><input name="pseudo"></@@field>', 'field-succes-renomme')
    const f = champDe(hote)
    f.querySelector('input').setAttribute('name', 'surnom')
    await attendre(() => f._state.name === 'surnom', 'le name déduit suit le champ renommé')
    await pause(80)
    assert.equal(f._state.name, 'surnom', 'préalable : le name déduit a suivi')
    assert.equal(f._shadow.querySelector('.field').classList.contains('has-ok'), false)
    window.close()
  })

  it('sans name sur l\'enveloppe : une réponse sans erreur pour ce champ le passe bien au succès', async () => {
    const { window, hote } = await monter('<@@field label="Email"><input type="email" name="email"></@@field>', 'field-succes-reponse')
    window.eval('µ._mjs_resMerge({errors: {autre: \'requis\'}});')
    const f = champDe(hote)
    await attendre(() => classe(f, 'has-ok'), 'le champ passe au succès')
    assert.equal(f._shadow.querySelector('.field').classList.contains('has-ok'), true)
    assert.equal(f.querySelector('input').getAttribute('mjs-field'), 'ok')
    window.close()
  })
})

describe('mjs-core-field — le libellé nomme le champ enveloppé', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le champ sans nom accessible reçoit le libellé en aria-label', async () => {
    const { window, hote } = await monter('<@@field label="Email"><input type="email" name="email"></@@field>', 'field-libelle')
    assert.equal(champDe(hote).querySelector('input').getAttribute('aria-label'), 'Email')
    window.close()
  })

  it('en layout float aussi, et dans un conteneur : sur le vrai champ, pas sur l\'enveloppe', async () => {
    const { window, hote } = await monter('<@@field layout="float" label="Nom"><div class="wrap"><input name="nom"></div></@@field>', 'field-libelle-float')
    const f = champDe(hote)
    assert.equal(f.querySelector('input').getAttribute('aria-label'), 'Nom')
    assert.equal(f.querySelector('.wrap').hasAttribute('aria-label'), false)
    window.close()
  })

  it('le libellé changé ensuite suit', async () => {
    const { window, hote } = await monter('<script>\n  $l = \'Email\'\n</script>\n<@@field label={$l}><input name="email"></@@field>\n<button class="b" @click={$l = \'Courriel\'}>b</button>', 'field-libelle-suit')
    hote._shadow.querySelector('.b').click()
    await attendre(() => champDe(hote).querySelector('input').getAttribute('aria-label') === 'Courriel', 'le libellé changé suit : aria-label="Courriel"')
    assert.equal(champDe(hote).querySelector('input').getAttribute('aria-label'), 'Courriel')
    window.close()
  })

  it('un nom déjà donné par la page (aria-label, aria-labelledby, <label for>) est gardé tel quel', async () => {
    const { window, hote } = await monter([
      '<@@field class="a" label="Email"><input name="a" aria-label="Adresse"></@@field>',
      '<span id="t">Titre</span>',
      '<@@field class="b" label="Email"><input name="b" aria-labelledby="t"></@@field>',
      '<label for="c-champ">Le mien</label>',
      '<@@field class="c" label="Email"><input id="c-champ" name="c"></@@field>',
    ].join('\n'), 'field-libelle-garde')
    assert.equal(champDe(hote, '.a').querySelector('input').getAttribute('aria-label'), 'Adresse')
    assert.equal(champDe(hote, '.b').querySelector('input').hasAttribute('aria-label'), false)
    assert.equal(champDe(hote, '.c').querySelector('input').hasAttribute('aria-label'), false)
    window.close()
  })
})

describe('mjs-core-field — l\'erreur se lit aussi pour un lecteur d\'écran', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('en erreur : aria-invalid="true" sur le champ et le message en role="alert" ; au succès, aria-invalid retiré', async () => {
    const { window, hote } = await monter('<@@field label="Email"><input type="email" name="email"></@@field>', 'field-erreur-annoncee')
    const f     = champDe(hote)
    const input = f.querySelector('input')
    assert.equal(input.hasAttribute('aria-invalid'), false, 'neutre : rien')
    window.eval('µ._mjs_resMerge({errors: {email: \'format invalide\'}});')
    await attendre(() => input.getAttribute('aria-invalid') === 'true' && !!f._shadow.querySelector('.error'), 'le champ en erreur : aria-invalid et message')
    assert.equal(input.getAttribute('aria-invalid'), 'true')
    assert.equal(f._shadow.querySelector('.error').getAttribute('role'), 'alert')
    window.eval('µ._mjs_resMerge({errors: {}});')
    await attendre(() => !input.hasAttribute('aria-invalid'), 'au succès, aria-invalid retiré')
    assert.equal(input.hasAttribute('aria-invalid'), false)
    window.close()
  })

  it('un aria-invalid posé par la page n\'est pas retiré au montage', async () => {
    const { window, hote } = await monter('<@@field label="Email"><input name="email" aria-invalid="true"></@@field>', 'field-erreur-garde')
    assert.equal(champDe(hote).querySelector('input').getAttribute('aria-invalid'), 'true')
    window.close()
  })
})

describe('mjs-core-field layout float — le libellé suit la valeur, même posée par programme', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const HOTE = [
    '<script>',
    '  $em = \'\'',
    '</script>',
    '<form class="f">',
    '  <@@field layout="float" label="Email"><input name="email" value=!{$em}></@@field>',
    '</form>',
    '<button class="poser" @click={$em = \'bob@x.fr\'}>poser</button>',
  ].join('\n')

  it('une valeur posée par la page (liaison value) fait monter le libellé', async () => {
    const { window, hote } = await monter(HOTE, 'field-float-programme')
    const f = champDe(hote)
    assert.equal(f._shadow.querySelector('.field').classList.contains('filled'), false, 'préalable : vide')
    hote._shadow.querySelector('.poser').click()
    await attendre(() => f.querySelector('input').value === 'bob@x.fr' && classe(f, 'filled'), 'la valeur posée par la page dans le champ, le libellé monté')
    assert.equal(f.querySelector('input').value, 'bob@x.fr', 'préalable : la valeur est dans le champ')
    assert.equal(f._shadow.querySelector('.field').classList.contains('filled'), true)
    window.close()
  })

  it('le formulaire remis à zéro : le libellé redescend', async () => {
    const { window, hote } = await monter(HOTE, 'field-float-reset')
    const f     = champDe(hote)
    const input = f.querySelector('input')
    input.value = 'tapé'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await attendre(() => classe(f, 'filled'), 'le champ tapé : libellé monté')
    assert.equal(f._shadow.querySelector('.field').classList.contains('filled'), true, 'préalable : rempli')
    hote._shadow.querySelector('.f').reset()
    await attendre(() => input.value === '' && !classe(f, 'filled'), 'le formulaire remis à zéro : champ vide, libellé redescendu')
    assert.equal(input.value, '', 'préalable : le champ est vide')
    assert.equal(f._shadow.querySelector('.field').classList.contains('filled'), false)
    window.close()
  })
})
