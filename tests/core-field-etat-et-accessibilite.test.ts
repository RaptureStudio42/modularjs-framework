// module cœur field (<@@field>) : l'état succès n'arrive qu'avec une réponse du serveur (le name
// déduit du champ au montage n'en est pas une), le libellé du module nomme le champ enveloppé (un
// <label for> dans le shadow ne vise rien hors de son arbre), l'erreur se lit aussi pour un lecteur
// d'écran, et le libellé flottant suit une valeur posée par programme.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause, attendre } from './helpers/coeur-monter.js'

const champDe = (hote: any, sel = 'mjs-core-field') => hote._shadow.querySelector(sel)

describe('mjs-core-field — le succès attend une réponse du serveur', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('sans name sur l\'enveloppe : neutre au montage, ni bordure verte ni message de succès', async () => {
    const { window, hote } = await monterHote('<@@field label="Email" ok-label="Disponible !"><input type="email" name="email"></@@field>', 'field-succes-montage')
    const f = champDe(hote)
    assert.equal(f._shadow.querySelector('.field').classList.contains('has-ok'), false, 'aucune classe has-ok')
    assert.equal(f.querySelector('input').hasAttribute('mjs-field'), false, 'aucun état posé sur le champ')
    assert.equal(f._shadow.querySelector('.ok') === null, true, 'aucun message de succès')
    window.close()
  })

  it('le name du champ renommé ensuite, sans réponse : toujours neutre', async () => {
    const { window, hote } = await monterHote('<@@field label="Pseudo"><input name="pseudo"></@@field>', 'field-succes-renomme')
    const f = champDe(hote)
    f.querySelector('input').setAttribute('name', 'surnom')
    await attendre(() => f._state.name === 'surnom')
    await pause(80)
    assert.equal(f._state.name, 'surnom', 'préalable : le name déduit a suivi')
    assert.equal(f._shadow.querySelector('.field').classList.contains('has-ok'), false)
    window.close()
  })

  it('sans name sur l\'enveloppe : une réponse sans erreur pour ce champ le passe bien au succès', async () => {
    const { window, hote } = await monterHote('<@@field label="Email"><input type="email" name="email"></@@field>', 'field-succes-reponse')
    window.eval('µ._mjs_resMerge({errors: {autre: \'requis\'}});')
    await pause(80)
    const f = champDe(hote)
    assert.equal(f._shadow.querySelector('.field').classList.contains('has-ok'), true)
    assert.equal(f.querySelector('input').getAttribute('mjs-field'), 'ok')
    window.close()
  })
})

describe('mjs-core-field — le libellé nomme le champ enveloppé', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le champ sans nom accessible reçoit le libellé en aria-label', async () => {
    const { window, hote } = await monterHote('<@@field label="Email"><input type="email" name="email"></@@field>', 'field-libelle')
    assert.equal(champDe(hote).querySelector('input').getAttribute('aria-label'), 'Email')
    window.close()
  })

  it('en layout float aussi, et dans un conteneur : sur le vrai champ, pas sur l\'enveloppe', async () => {
    const { window, hote } = await monterHote('<@@field layout="float" label="Nom"><div class="wrap"><input name="nom"></div></@@field>', 'field-libelle-float')
    const f = champDe(hote)
    assert.equal(f.querySelector('input').getAttribute('aria-label'), 'Nom')
    assert.equal(f.querySelector('.wrap').hasAttribute('aria-label'), false)
    window.close()
  })

  it('le libellé changé ensuite suit', async () => {
    const { window, hote } = await monterHote('<script>\n  $l = \'Email\'\n</script>\n<@@field label={$l}><input name="email"></@@field>\n<button class="b" @click={$l = \'Courriel\'}>b</button>', 'field-libelle-suit')
    hote._shadow.querySelector('.b').click()
    await pause(80)
    assert.equal(champDe(hote).querySelector('input').getAttribute('aria-label'), 'Courriel')
    window.close()
  })

  it('un nom déjà donné par la page (aria-label, aria-labelledby, <label for>) est gardé tel quel', async () => {
    const { window, hote } = await monterHote([
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
    const { window, hote } = await monterHote('<@@field label="Email"><input type="email" name="email"></@@field>', 'field-erreur-annoncee')
    const f     = champDe(hote)
    const input = f.querySelector('input')
    assert.equal(input.hasAttribute('aria-invalid'), false, 'neutre : rien')
    window.eval('µ._mjs_resMerge({errors: {email: \'format invalide\'}});')
    await pause(80)
    assert.equal(input.getAttribute('aria-invalid'), 'true')
    assert.equal(f._shadow.querySelector('.error').getAttribute('role'), 'alert')
    window.eval('µ._mjs_resMerge({errors: {}});')
    await pause(80)
    assert.equal(input.hasAttribute('aria-invalid'), false)
    window.close()
  })

  it('un aria-invalid posé par la page n\'est pas retiré au montage', async () => {
    const { window, hote } = await monterHote('<@@field label="Email"><input name="email" aria-invalid="true"></@@field>', 'field-erreur-garde')
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
    const { window, hote } = await monterHote(HOTE, 'field-float-programme')
    const f = champDe(hote)
    assert.equal(f._shadow.querySelector('.field').classList.contains('filled'), false, 'préalable : vide')
    hote._shadow.querySelector('.poser').click()
    await pause(80)
    assert.equal(f.querySelector('input').value, 'bob@x.fr', 'préalable : la valeur est dans le champ')
    assert.equal(f._shadow.querySelector('.field').classList.contains('filled'), true)
    window.close()
  })

  it('le formulaire remis à zéro : le libellé redescend', async () => {
    const { window, hote } = await monterHote(HOTE, 'field-float-reset')
    const f     = champDe(hote)
    const input = f.querySelector('input')
    input.value = 'tapé'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await pause(40)
    assert.equal(f._shadow.querySelector('.field').classList.contains('filled'), true, 'préalable : rempli')
    hote._shadow.querySelector('.f').reset()
    await pause(80)
    assert.equal(input.value, '', 'préalable : le champ est vide')
    assert.equal(f._shadow.querySelector('.field').classList.contains('filled'), false)
    window.close()
  })
})
