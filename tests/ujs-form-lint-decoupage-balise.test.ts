// Le contrôle « <form> sans action ni méthode » découpe la balise comme le fait un lecteur de HTML : les
// guillemets d'une accolade `{…}` n'ouvrent aucune valeur, un `>` dans une valeur ou dans une accolade
// (`=>`) ne ferme pas la balise. Défauts gardés absents : une apostrophe dans une accolade s'appariait avec
// un attribut en guillemets simples et cachait le vrai `action=` (faux avertissement) ; un `>` dans une
// valeur tronquait la balise avant l'`action=`.
// Gardes : sans action, l'avertissement reste dû dans les mêmes balises ; la ligne citée est celle de la balise.

import assert from 'node:assert/strict'
import { checkUjsForm } from '../src/transpiler/ujs-form.js'

const nb = (html: string) => checkUjsForm(html, 'mod').length

describe('checkUjsForm — découpage de la balise', () => {
  it('apostrophe dans une accolade, puis attribut en guillemets simples : l\'action est lue', () => {
    assert.equal(nb('<form data-x={`l\'un`} action="/x" data-y=\'z\'></form>'), 0)
  })

  it('apostrophe dans une accolade : sans action, avertit', () => {
    assert.equal(nb('<form data-x={`l\'un`} data-y=\'z\'></form>'), 1)
  })

  it('guillemet double dans une accolade, puis attribut en guillemets doubles : l\'action est lue', () => {
    assert.equal(nb('<form data-x={\'a"b\'} action="/x" data-y="z"></form>'), 0)
  })

  it('« > » dans une valeur entre guillemets, avant l\'action : l\'action est lue', () => {
    assert.equal(nb('<form title="a > b" action="/x"></form>'), 0)
    assert.equal(nb('<form title=\'a > b\' action="/x"></form>'), 0)
  })

  it('« > » dans une valeur, sans action : un seul avertissement', () => {
    assert.equal(nb('<form title="a > b"></form>'), 1)
  })

  it('« => » dans une accolade, avant l\'action : l\'action est lue', () => {
    assert.equal(nb('<form @click={() => go()} action="/x"></form>'), 0)
  })

  it('« => » dans une accolade, sans action : avertit', () => {
    assert.equal(nb('<form @click={() => go()}></form>'), 1)
  })

  it('accolades imbriquées avec un « > » : la balise se ferme à son vrai « > »', () => {
    assert.equal(nb('<form data-x={{ a: b => c }} action="/x"></form>'), 0)
  })

  it('une directive @submit.prevent après une accolade à apostrophe : silence', () => {
    assert.equal(nb('<form data-x={`l\'un`} @submit.prevent={envoyer} data-y=\'z\'></form>'), 0)
  })

  it('un mot « action » dans une valeur ou une accolade n\'est pas une action', () => {
    assert.equal(nb('<form data-x={`l\'un action="/x"`} title=\'action="/y"\'></form>'), 1)
  })

  it('la ligne citée est celle de la balise, avec une balise sur plusieurs lignes', () => {
    const [msg] = checkUjsForm('<p>a</p>\n<form\n  data-x={`l\'un`}\n  data-y=\'z\'\n>\n</form>', 'mod')
    assert.match(msg, /2/)
  })

  it('deux formulaires de suite : chacun jugé seul', () => {
    assert.equal(nb('<form data-x={`l\'un`} action="/x"></form><form data-y=\'z\'></form>'), 1)
  })
})
