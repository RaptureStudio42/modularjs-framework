// `µfailed` mal écrit dans le gabarit (`{µfailed $r}`, `{µfailed($$r)}`, `title={µfailed $r}`) : refusé à la construction, le message
// cite la forme telle qu'écrite (sans le crochet de la passe des expressions), le fichier et la ligne où elle est écrite ; écrite deux
// fois, aucune ligne n'est citée (laquelle des deux ?), le refus reste. Compilation seule et vraie construction
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { refus, erreursDeConstruction } from './helpers/derivee-await-refus.js'

const F    = '  f = (q) -> fetch("/api/m-#{q}").then((r) -> r.json())\n'
const avec = (gabarit: string) => `<script>\n${F}  $r = await f(1)\n</script>\n${gabarit}\n`

describe('µfailed mal écrit dans le gabarit : la forme écrite, le fichier et la ligne', function () {
  this.timeout(200000)
  after(async () => { await terminateSharedWorkerPool() })

  const cas: Array<[string, string]> = [
    ['<i>{µfailed $r}</i>', 'µfailed $r'],
    ['<i>{µfailed($$r)}</i>', 'µfailed($$r)'],
    ['<i title={µfailed $r}>x</i>', 'µfailed $r'],
  ]
  for (const [gabarit, forme] of cas) {
    it(`${gabarit} : « ${forme} », le fichier et la ligne 5`, async () => {
      const msg = await refus(avec(gabarit))
      assert.ok(msg.includes(`'refus.mjs', ligne 5 : « ${forme} » : µfailed lit`), msg)
    })
  }

  it('la même forme écrite sur deux lignes : refusée, sans ligne citée', async () => {
    const msg = await refus(avec('<i>{µfailed $r}</i>\n<b>{µfailed $r}</b>'))
    assert.ok(msg.includes('[ModularJS] « µfailed $r » : µfailed lit'), msg)
    assert.doesNotMatch(msg, /ligne \d/)
  })

  it('vraie construction : le fichier et la ligne', async () => {
    const msg = await erreursDeConstruction('failed-mal-ecrit-gabarit', { 'carte.mjs': avec('<p>a</p>\n<i>{µfailed $r}</i>') })
    assert.match(msg, /'carte\.mjs', ligne 6 : « µfailed \$r » : µfailed lit/, msg)
  })
})
