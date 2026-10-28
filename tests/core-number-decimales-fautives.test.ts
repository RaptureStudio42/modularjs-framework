// module cœur number (<@@number>) : `decimals` attend un entier de 0 à 100, écrit en chiffres (« 2 ») ou en nombre (`decimals={2}`), comme
// <@@chart decimals> attend le sien. Une autre valeur (« abc », « -1 », « 2,5 », « 2.5 », « 101 ») est une faute : elle est ignorée (aucune
// décimale fixe, la valeur s'écrit telle quelle) et la console le dit (µ.error), au montage puis à chaque changement qui la laisse fautive ;
// vide ou absente, il n'y a pas de décimales fixes, sans un mot

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $p = 64.3',
  '  $d = \'x\'',
  '</script>',
  '<@@number class="abc" value=!{$p} decimals="abc"></@@number>',
  '<@@number class="moins" value=!{$p} decimals="-1"></@@number>',
  '<@@number class="virgule" value=!{$p} decimals="2,5"></@@number>',
  '<@@number class="point" value=!{$p} decimals="2.5"></@@number>',
  '<@@number class="trop" value=!{$p} decimals="101"></@@number>',
  '<@@number class="vide" value=!{$p} decimals=""></@@number>',
  '<@@number class="deux" value=!{$p} decimals="2"></@@number>',
  '<@@number class="nombre" value=!{$p} decimals={2}></@@number>',
  '<@@number class="lie" value=!{$p} decimals={$d}></@@number>',
  '<button class="b3" @click={$d = 3}>3</button>',
  '<button class="bz" @click={$d = \'-2\'}>-2</button>',
].join('\n')

describe('mjs-core-number — `decimals` fautif : ignoré, et la console le dit, comme <@@chart decimals>', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const champ = (hote: any, sel: string) => hote._shadow.querySelector(sel)._shadow.querySelector('.input')
  // les erreurs relevées dans la fenêtre de happy-dom, recopiées dans un tableau de Node (deepEqual compare aussi le prototype)
  const dites = (erreurs: string[]) => [...erreurs].filter((e) => /<@@number> : decimals/.test(e)).map((e) => /decimals « ([^»]*) »/.exec(e)?.[1] ?? e)

  it('« abc », « -1 », « 2,5 », « 2.5 », « 101 » et une variable à « x » : une erreur chacun, au vouvoiement ; la valeur s\'écrit sans décimales fixes', async () => {
    const { window, hote, erreurs } = await monterHote(HOTE, 'number-decimales-fautives')
    assert.deepEqual(dites(erreurs).sort(), ['-1', '101', '2,5', '2.5', 'abc', 'x'], erreurs.join('\n'))
    for (const e of erreurs.filter((l) => /<@@number> : decimals/.test(l))) assert.match(e, /écrivez un nombre entier de 0 à 100/)
    for (const c of ['abc', 'moins', 'virgule', 'point', 'trop', 'vide', 'lie']) assert.equal(champ(hote, '.' + c).value, '64.3', `${c} : aucune décimale fixe`)
    assert.equal(champ(hote, '.deux').value, '64,30', 'decimals="2" garde ses deux décimales')
    assert.equal(champ(hote, '.nombre').value, '64,30', 'decimals={2} aussi')
    window.close()
  })

  it('la variable passe à 3 : trois décimales, sans un mot ; puis à « -2 » : une erreur de plus', async () => {
    const { window, hote, erreurs } = await monterHote(HOTE, 'number-decimales-fautives-lie')
    const avant = dites(erreurs).length
    hote._shadow.querySelector('.b3').click()
    await pause(60)
    assert.equal(champ(hote, '.lie').value, '64,300')
    assert.equal(dites(window.eval('globalThis.__erreurs')).length, avant, 'une valeur juste ne dit rien')
    hote._shadow.querySelector('.bz').click()
    await pause(60)
    assert.deepEqual(dites(window.eval('globalThis.__erreurs')).slice(avant), ['-2'])
    assert.equal(champ(hote, '.lie').value, '64.3')
    window.close()
  })
})
