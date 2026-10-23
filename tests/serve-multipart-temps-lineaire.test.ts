// Envoi multipart : chaque partie cherchait la fin de ses en-têtes ("\r\n\r\n") jusqu'au BOUT du
// corps. Un corps fait de milliers de parties minuscules sans en-tête coûtait alors un temps
// quadratique : 256 Kio bloquaient le serveur 16 s, 1 Mio plusieurs minutes, pour tout le monde.
// La recherche s'arrête désormais à la fin de la partie courante : temps linéaire.

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { handleMutatingRequest, type ActionPipelineDeps } from '../src/server/action-pipeline.js'

async function poster(raw: Buffer): Promise<{ status: number, body: any }> {
  const req: any = new EventEmitter()
  req.method = 'POST'
  req.headers = { 'content-type': 'multipart/form-data; boundary=B' }
  req.destroy = () => {}
  const res: any = { statusCode: 200, headers: {}, setHeader(k: string, v: string) { this.headers[k] = v }, end() {} }
  let recu: unknown = null
  const deps: ActionPipelineDeps = {
    config: {},
    entry: { actionFor: () => ({ params: {}, fn: async (_p: unknown, body: unknown) => { recu = body; return { redirect: '/ok' } } }), propsFor: async () => ({}) } as any,
    recordServer: () => {},
    manifestPath: null,
  }
  const p = handleMutatingRequest(req, res, '/do', '/do', deps)
  req.emit('data', raw)
  req.emit('end')
  await p
  return { status: res.statusCode, body: recu }
}

describe('action-pipeline — multipart analysé en temps linéaire', () => {
  it('256 Kio de parties de 8 octets sans en-tête : traités en moins de 300 ms', async function () {
    this.timeout(60000)
    const n = Math.floor(256 * 1024 / 8)
    const raw = Buffer.from('--B' + '\r\nX\r\n--B'.repeat(n) + '\r\nContent-Disposition: form-data; name="vrai"\r\n\r\nvaleur\r\n--B--\r\n')
    const t0 = performance.now()
    const { status, body } = await poster(raw)
    const duree = performance.now() - t0
    assert.equal(status, 303)
    assert.deepEqual(body, { vrai: 'valeur' })
    assert.ok(duree < 300, `analyse trop lente : ${duree.toFixed(0)} ms`)
  })
})
