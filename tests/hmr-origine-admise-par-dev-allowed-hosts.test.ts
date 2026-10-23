// derrière un tunnel https déclaré dans `dev.allowedHosts`, avec l'écoute locale par défaut, la page était servie mais le rechargement
// à chaud fermé aussitôt (`1008 Origin not allowed`) : l'origine de la page n'était admise que si le serveur écoutait au-delà de la
// boucle locale. Un nom de `dev.allowedHosts` (même lecture que la garde Host : nom exact, `.domaine`, `true`) est admis comme
// origine quand il nomme l'hôte de la connexion (Host gardé) ; quand l'origine diffère de Host (un tunnel qui le réécrit), seul un nom
// exact l'admet, ni `.domaine` ni `true` (cf. hmr-tunnel-host-reecrit.test.ts) — jamais une autre page

import assert from 'node:assert/strict'
import { request } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import WebSocket from 'ws'
import { isAcceptedHmrOrigin } from '../src/server/hmr.js'
import { StaticServer } from '../src/server/index.js'
import { mjsTmp } from './helpers/tmp.js'

const TUNNEL = 'abc.trycloudflare.com'

describe('rechargement à chaud — origine d\'un nom de dev.allowedHosts', () => {
  it('admise quand elle nomme l\'hôte de la connexion, en écoute locale', () => {
    assert.equal(isAcceptedHmrOrigin('https://' + TUNNEL, TUNNEL, '127.0.0.1', ['.trycloudflare.com']), true)
    assert.equal(isAcceptedHmrOrigin('https://mon-tunnel.example', 'mon-tunnel.example', '127.0.0.1', ['mon-tunnel.example']), true)
    assert.equal(isAcceptedHmrOrigin('https://n-importe.example', 'n-importe.example', '127.0.0.1', true), true)
  })

  it('refusée sans dev.allowedHosts, pour un autre nom, ou quand l\'hôte de la connexion diffère et que seuls `.domaine` ou `true` la couvrent', () => {
    assert.equal(isAcceptedHmrOrigin('https://' + TUNNEL, TUNNEL, '127.0.0.1'), false)
    assert.equal(isAcceptedHmrOrigin('https://evil.example', 'evil.example', '127.0.0.1', ['.trycloudflare.com']), false)
    assert.equal(isAcceptedHmrOrigin('https://x.mon-tunnel.example', 'x.mon-tunnel.example', '127.0.0.1', ['mon-tunnel.example']), false)
    assert.equal(isAcceptedHmrOrigin('https://' + TUNNEL, '127.0.0.1:3939', '127.0.0.1', ['.trycloudflare.com']), false)
    assert.equal(isAcceptedHmrOrigin('https://n-importe.example', '127.0.0.1:3939', '127.0.0.1', true), false)
    assert.equal(isAcceptedHmrOrigin('ftp://' + TUNNEL, TUNNEL, '127.0.0.1', ['.trycloudflare.com']), false)
  })

  it('mjs dev derrière le tunnel : page servie et rechargement à chaud connecté', async function () {
    this.timeout(15000)
    const root = mjsTmp('hmr-tunnel')
    mkdirSync(join(root, 'out'))
    writeFileSync(join(root, 'index.html'), '<!doctype html><html><head></head><body>page</body></html>')
    const srv = new StaticServer({ rootDir: join(root, 'out'), pathPrefix: '/modularjs', port: 0, host: '127.0.0.1', hmr: true, projectRoot: root, configDir: root, config: { dev: { allowedHosts: ['.trycloudflare.com'] } } as any })
    await srv.start()
    try {
      const port   = (srv.server!.address() as any).port
      const statut = await new Promise<number>((ok, ko) => { const r = request({ host: '127.0.0.1', port, path: '/', headers: { host: TUNNEL } }, (x) => { x.resume(); x.on('end', () => ok(x.statusCode!)) }); r.on('error', ko); r.end() })
      assert.equal(statut, 200)
      const recu = await new Promise<string>((ok) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/__mjs_hmr`, { headers: { host: TUNNEL, origin: 'https://' + TUNNEL } })
        ws.on('message', (m) => { ok(String(m)); ws.close() })
        ws.on('close', (code, raison) => ok(`fermé ${code} ${String(raison)}`))
        ws.on('error', (e) => ok('erreur ' + e.message))
      })
      assert.equal(recu, '{"type":"connected"}')
    } finally {
      await srv.stop()
    }
  })
})
