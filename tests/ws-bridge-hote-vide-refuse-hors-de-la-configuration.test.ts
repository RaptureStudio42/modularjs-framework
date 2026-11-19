// `mjsWs({ bridge: { host: '' } })`, écrit dans le code et non dans mjs.config.json : un hôte vide ou fait de blancs est refusé (le pont
// écouterait sur toutes les adresses de la machine), en français comme en anglais ; lu par resolveBridgeOptions, aucun serveur lancé
import assert from 'node:assert/strict'
import { resolveBridgeOptions } from '../src/mjs-ws/bridge.js'
import { setMessagesLang } from '../src/messages/index.js'

const SECRET = 's'.repeat(64)

describe('mjs-ws — opts.bridge.host vide refusé hors de mjs.config.json', () => {
  afterEach(() => setMessagesLang('fr'))

  for (const host of ['', '   ']) {
    it(`host ${JSON.stringify(host)} : refusé, en français`, () => {
      setMessagesLang('fr')
      assert.throws(() => resolveBridgeOptions({ host, secret: SECRET } as any, 4000), /opts\.bridge\.host doit être une chaîne non vide/)
    })
    it(`host ${JSON.stringify(host)} : refusé, en anglais`, () => {
      setMessagesLang('en')
      assert.throws(() => resolveBridgeOptions({ host, secret: SECRET } as any, 4000), /opts\.bridge\.host must be a non-empty string/)
    })
  }

  it('host absent : 127.0.0.1 ; host écrit : gardé', () => {
    assert.equal(resolveBridgeOptions({ secret: SECRET } as any, 4000).host, '127.0.0.1')
    assert.equal(resolveBridgeOptions({ host: '::1', secret: SECRET } as any, 4000).host, '::1')
  })
})
