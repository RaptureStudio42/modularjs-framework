// Ce que ce test garantit : `match` de <@@select search> ne retient que les modes que le module connaît
// (contains, starts, fuzzy, starts-fuzzy, async). Tout autre nom retombe sur `contains`, y compris les noms que
// tout objet JavaScript hérite (constructor, toString, __proto__, valueOf, hasOwnProperty, isPrototypeOf) :
// - la liste filtre toujours (« amm » ne garde que « Gamma », « zzz » ne garde rien) ;
// - aucune erreur n'est levée à la première lettre tapée ;
// - les modes du module gardent leur sens.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const HERITES = ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty', 'isPrototypeOf']
const INCONNUS = ['bidule', 'none']
const CONNUS = ['contains', 'starts', 'fuzzy', 'starts-fuzzy']
const NOMS = [...HERITES, ...INCONNUS, ...CONNUS]

const HOTE = NOMS.map((n, i) => `<div id="z${i}">
  <@@select name="s${i}" search match="${n}">
    <@@option value="a">Alpha</@@option>
    <@@option value="b">Beta</@@option>
    <@@option value="c">Gamma</@@option>
  </@@select>
</div>`).join('\n')

describe('<@@select> — match : seuls les modes du module comptent, jamais un nom hérité d\'Object', function () {
  this.timeout(120000)

  let window: any = null
  let hote: any   = null
  let erreurs: string[] = []

  const sel     = (zone: string) => hote._shadow.querySelector(`#${zone} mjs-core-select`)
  const textes  = (zone: string) => Array.from(sel(zone)._shadow.querySelectorAll('.select-option')).map((o: any) => o.textContent.trim())
  const clic    = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
  const ouvrir  = async (zone: string) => { clic(sel(zone)._shadow.querySelector('.select-btn')); await pause(40) }
  const taper   = async (zone: string, texte: string) => {
    const input = sel(zone)._shadow.querySelector('.select-search')
    input.value = texte
    input.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true, composed: true }))
    await pause(60)
  }
  const zoneDe  = (nom: string) => `z${NOMS.indexOf(nom)}`

  before(async () => {
    const monte = await monterHote(HOTE, 'core-select-match-herites')
    window  = monte.window
    hote    = monte.hote
    erreurs = monte.erreurs
    window.addEventListener('error', (e: any) => erreurs.push('window.error ' + String(e.error?.message ?? e.message)))
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  for (const nom of [...HERITES, ...INCONNUS]) {
    it(`match="${nom}" : se comporte comme contains — « amm » ne garde que Gamma, « zzz » ne garde rien, sans erreur`, async () => {
      const zone  = zoneDe(nom)
      const avant = erreurs.length
      await ouvrir(zone)
      await taper(zone, 'amm')
      assert.deepEqual(textes(zone), ['Gamma'], 'le filtre contains s\'applique')
      await taper(zone, 'zzz')
      assert.deepEqual(textes(zone), [], 'rien ne correspond')
      await taper(zone, 'ETA')
      assert.deepEqual(textes(zone), ['Beta'], 'casse et accents ignorés, comme contains')
      assert.deepEqual([...erreurs.slice(avant)], [], 'aucune erreur levée à la saisie')
    })
  }

  it('les modes du module gardent leur sens : starts, fuzzy, starts-fuzzy, contains', async () => {
    const attendu: Record<string, Array<[string, string[]]>> = {
      contains:       [['amm', ['Gamma']], ['gma', []]],
      starts:         [['amm', []], ['ga', ['Gamma']]],
      fuzzy:          [['gma', ['Gamma']], ['zzz', []]],
      'starts-fuzzy': [['gma', ['Gamma']], ['ma', []]],
    }
    for (const nom of CONNUS) {
      const zone = zoneDe(nom)
      await ouvrir(zone)
      for (const [saisie, options] of attendu[nom]) {
        await taper(zone, saisie)
        assert.deepEqual(textes(zone), options, `match="${nom}", saisie « ${saisie} »`)
      }
    }
  })
})
