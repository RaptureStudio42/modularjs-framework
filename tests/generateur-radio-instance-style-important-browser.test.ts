// Chromium réel :
// - le groupe natif d'une liaison radio `@group=!{$c}` est propre à chaque exemplaire du composant : deux exemplaires
//   posés sans ombre (`@lightDom`, même arbre) ne forment plus un seul groupe, cocher « b » dans l'un ne décoche plus
//   « a » dans l'autre (son écran disait « rien de choisi » quand son état disait « a »)
// - `@style.color="blue !important"` et `@style.color="{$c} !important"` posent la couleur en priorité `important`,
//   comme les formes `={…}` et `@style.x{cond}=` ; avant, le navigateur refusait la valeur entière, sans un mot

import assert from 'node:assert/strict'
import { monterComposants } from './helpers/composants-navigateur.js'

const SOURCES: Record<string, string> = {
  'r-radio': [
    '<script>',
    '$c = "a"',
    '</script>',
    '<input class="ra" type="radio" value="a" @group=!{$c} aria-label="a"><input class="rb" type="radio" value="b" @group=!{$c} aria-label="b">',
  ].join('\n'),
  'r-deux': '<p class="pret">p</p><mjs-r-radio class="i1" @lightDom></mjs-r-radio><mjs-r-radio class="i2" @lightDom></mjs-r-radio>\n',
  'r-imp': [
    '<script>',
    '$c = "red"',
    '</script>',
    '<p class="a" @style.color="blue !important">a</p><p class="b" @style.color="{$c} !important">b</p><p class="c" @style.color={$c + " !important"}>c</p><p class="d" @style.color{$c}="green !important">d</p>',
  ].join('\n'),
}

describe('générateur — groupe radio par exemplaire, !important des styles (Chromium réel)', function () {
  this.timeout(180000)
  let m: any = null

  before(async function () {
    m = await monterComposants(SOURCES)
    if (!m) { console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`'); this.skip() }
  })
  after(async () => { await m?.fermer() })

  it('deux exemplaires sans ombre : un clic dans l\'un ne change pas l\'autre', async () => {
    const p = await m.client('r-deux', '.pret')
    const r = await p.evaluate(async () => {
      const sh  = (document.querySelector('mjs-r-deux') as any)._shadow
      const ins = Array.from(sh.querySelectorAll('mjs-r-radio')) as any[]
      const racine = (el: any) => el._shadow ?? el
      const ra2 = racine(ins[1]).querySelector('.ra')
      const rb1 = racine(ins[0]).querySelector('.rb')
      const avant = ra2.checked
      rb1.click()
      await new Promise((res) => setTimeout(res, 50))
      return { avant, apres: ra2.checked, etat1: ins[0]._state.c, etat2: ins[1]._state.c, noms: [racine(ins[0]).querySelector('.ra').name, ra2.name] }
    })
    assert.equal(r.avant, true, 'le second exemplaire montre « a » au départ')
    assert.equal(r.etat1, 'b', 'le premier exemplaire prend « b »')
    assert.equal(r.etat2, 'a', 'le second garde « a » dans son état')
    assert.equal(r.apres, true, 'et à l\'écran')
    assert.notEqual(r.noms[0], r.noms[1], 'deux groupes natifs distincts')
  })

  it('les quatre formes de @style posent la priorité important', async () => {
    const p = await m.client('r-imp', '.d')
    const lus = await p.evaluate(() => {
      const s = (document.querySelector('mjs-r-imp') as any)._shadow
      return ['a', 'b', 'c', 'd'].map((k) => s.querySelector('.' + k).style.cssText)
    })
    assert.deepEqual(lus, ['color: blue !important;', 'color: red !important;', 'color: red !important;', 'color: green !important;'])
  })
})
