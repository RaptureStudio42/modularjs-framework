// un gestionnaire qui commence par une regex (`@click={/abc/.test($t) and @go()}`) agit au clic : Civet lisait le corps mis entre
// parenthèses, `(/abc/…)`, comme une section d'opérateur, une fonction jamais appelée (le clic ne faisait rien, sans erreur).
// Composant bâti, monté dans happy-dom, bouton cliqué, effet lu à l'écran
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const ETAT = "<script>\n$t = 'xabcx'\n$n = 0\n@go = -> $n++\n</script>\n<p>{$n}</p>\n"

// gestionnaire écrit → nombre à l'écran après un clic
const CAS: [string, string][] = [
  ['<button @click={/abc/.test($t) and @go()}>+</button>', '1'],
  ['<button @click={/zzz/.test($t) or @go()}>+</button>', '1'],
  ['<button @click={/ABC/i.test($t) and $n++}>+</button>', '1'],
  ['<button @click={/zzz/.test($t) and @go()}>+</button>', '0'],
  ['<button @click.prevent={/abc/.test($t) and @go()}>+</button>', '1'],
  ['<button @click={\n  /abc/.test($t) and @go()\n}>+</button>', '1'],
  ['{for v in [1]}\n  <button @click={/abc/.test($t) and @go()}>+</button>\n{end}', '1'],
  ['<button @click={/abc/.test($t) and $n = $n + v for v in [1]}>+</button>', '1'],
  ['<button @click={/abc/.test $t and @go()}>+</button>', '1']
]

const ecran = (hote: any): string => String((hote._shadow ?? hote.shadowRoot ?? hote).querySelector('p')?.textContent ?? '').trim()

describe('gestionnaire qui commence par une regex', function () {
  this.timeout(90000)
  after(async () => { await terminateSharedWorkerPool() })

  CAS.forEach(([gabarit, attendu], i) => {
    it(`${gabarit} : ${attendu} après un clic`, async () => {
      const { hote, erreurs } = await monterHote(ETAT + gabarit + '\n', `gestionnaire-regex-${i}`)
      assert.equal(ecran(hote), '0')
      ;(hote._shadow ?? hote.shadowRoot ?? hote).querySelector('button').click()
      await pause(60)
      assert.equal(ecran(hote), attendu)
      assert.equal(erreurs.length, 0, String(erreurs))
    })
  })
})
