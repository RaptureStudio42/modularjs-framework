// `ws.bridge.host` vide, ou fait de blancs, est refusé à la lecture comme `dev.host` : le pont n'écoute plus en silence sur toutes
// les adresses de la machine ; un hôte écrit reste accepté
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { findConfig } from '../src/bundler/config.js'
import { setMessagesLang } from '../src/messages/index.js'

describe('config — ws.bridge.host vide refusé', () => {
  afterEach(() => setMessagesLang('fr'))

  for (const host of ['', '   ']) {
    it(`ws.bridge.host ${JSON.stringify(host)} : refusé, comme dev.host`, () => {
      const root = mjsTmp('config-ws-bridge-hote-vide')
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ ws: { bridge: { host } } }))
      setMessagesLang('fr')
      assert.throws(() => findConfig(root), /ws\.bridge\.host doit être une chaîne non vide/)
    })
  }

  it('ws.bridge.host "127.0.0.1" : accepté', () => {
    const root = mjsTmp('config-ws-bridge-hote-ecrit')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ ws: { bridge: { host: '127.0.0.1' } } }))
    assert.equal((findConfig(root)!.config as any).ws.bridge.host, '127.0.0.1')
  })
})
