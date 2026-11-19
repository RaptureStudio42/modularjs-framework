// `ws.host` (et `server.host`, même section) vide ou fait de blancs est refusé à la lecture, comme `dev.host` et `ws.bridge.host` :
// un hôte vide ne passe plus en silence pour l'hôte par défaut ; un hôte écrit reste accepté
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { findConfig } from '../src/bundler/config.js'
import { setMessagesLang } from '../src/messages/index.js'

describe('config — ws.host vide refusé', () => {
  afterEach(() => setMessagesLang('fr'))

  for (const section of ['ws', 'server']) {
    for (const host of ['', '   ']) {
      it(`${section}.host ${JSON.stringify(host)} : refusé, comme dev.host`, () => {
        const root = mjsTmp('config-ws-hote-vide')
        writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ [section]: { host } }))
        setMessagesLang('fr')
        assert.throws(() => findConfig(root), new RegExp(`${section}\\.host doit être une chaîne non vide`))
        const rootEn = mjsTmp('config-ws-hote-vide-en')
        writeFileSync(join(rootEn, 'mjs.config.json'), JSON.stringify({ lang: 'en', [section]: { host } }))
        assert.throws(() => findConfig(rootEn), new RegExp(`${section}\\.host must be a non-empty string`))
      })
    }
  }

  it('ws.host "127.0.0.1" : accepté', () => {
    const root = mjsTmp('config-ws-hote-ecrit')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ ws: { host: '127.0.0.1' } }))
    assert.equal((findConfig(root)!.config as any).ws.host, '127.0.0.1')
  })
})
