// <@@select> lié à une variable de nombre typée, devant une longue liste d'options (1 000 options `value={i}`, le cas d'une
// liste d'identifiants liée à un `int`) : changer la valeur ou ouvrir la liste coûte autant que la même liste liée à une
// variable libre. Chercher l'option qui écrit le nombre parcourait toutes les options pour chacune d'elles (un million de
// comparaisons pour un seul choix, la page gelée près d'une seconde) ; elle se cherche une fois par nombre et par liste
// d'options. Le coût se compte sans chronomètre : les appels à `String` faits par le code de la page pendant le geste

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, attendre, pause } from './helpers/coeur-monter.js'

const N = 1000

const HOTE = [
  '<vars>',
  '  $id int',
  '</vars>',
  '',
  '<script>',
  '  $id  = 1',
  '  $lib = 1',
  `  $ids = ${JSON.stringify(Array.from({ length: N }, (_, i) => i + 1))}`,
  '</script>',
  '',
  '<div id="zone-typee"><@@select name="t" value=!{$id}>{for i in $ids}<@@option value={i}>o{i}</@@option>{end}</@@select></div>',
  '<div id="zone-libre"><@@select name="l" value=!{$lib}>{for i in $ids}<@@option value={i}>o{i}</@@option>{end}</@@select></div>',
  `<button id="bt" @click={$id = ${N}}>t</button>`,
  `<button id="bl" @click={$lib = ${N}}>l</button>`,
].join('\n') + '\n'

describe('<@@select> typé nombre, 1 000 options : un choix et une ouverture coûtent autant que sur une liste libre', function () {
  this.timeout(240000)

  let window: any = null
  let hote: any   = null

  const sel       = (zone: string) => hote._shadow.querySelector(`#${zone} mjs-core-select`)
  const etiquette = (zone: string) => sel(zone)._shadow.querySelector('.select-label').textContent.trim()
  const cochee    = (zone: string) => sel(zone)._shadow.querySelectorAll('.select-option[aria-selected="true"]').length === 1
  const clic      = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))

  // les appels à `String` faits par le code de la page entre le geste et la fin de sa mise à jour
  async function conversions(geste: () => void, fini: () => boolean): Promise<number> {
    window.eval('globalThis.__mesure = { S: String, n: 0 }; globalThis.String = new Proxy(__mesure.S, { apply: (t, s, a) => { __mesure.n++; return Reflect.apply(t, s, a) } })')
    try {
      geste()
      await attendre(fini, 200000)
      await pause(150)
    }
    finally {
      window.eval('globalThis.String = __mesure.S')
    }
    assert.ok(fini(), 'le geste a abouti')
    return window.eval('__mesure.n')
  }

  before(async () => {
    const monte = await monterHote(HOTE, 'core-select-typee-cout')
    window = monte.window
    hote   = monte.hote
    await attendre(() => etiquette('zone-typee') === 'o1' && etiquette('zone-libre') === 'o1', 60000)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('la liste liée à `$id int` porte `typed`, la liste libre non', () => {
    assert.ok(sel('zone-typee').hasAttribute('typed'), 'liste typée')
    assert.ok(!sel('zone-libre').hasAttribute('typed'), 'liste libre')
  })

  it('une valeur écrite par le code (la dernière option) : au plus trois fois le coût de la liste libre', async () => {
    const libre = await conversions(() => clic(hote._shadow.querySelector('#bl')), () => etiquette('zone-libre') === `o${N}`)
    const typee = await conversions(() => clic(hote._shadow.querySelector('#bt')), () => etiquette('zone-typee') === `o${N}`)
    assert.ok(typee <= 3 * libre, `liste typée : ${typee} appels à String, liste libre : ${libre}`)
  })

  it('l\'ouverture de la liste, l\'option choisie en vue : au plus trois fois le coût de la liste libre', async () => {
    const libre = await conversions(() => clic(sel('zone-libre')._shadow.querySelector('.select-btn')), () => cochee('zone-libre'))
    const typee = await conversions(() => clic(sel('zone-typee')._shadow.querySelector('.select-btn')), () => cochee('zone-typee'))
    assert.ok(typee <= 3 * libre, `liste typée : ${typee} appels à String, liste libre : ${libre}`)
  })
})
