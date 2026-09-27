// Une lecture de corps HTTP interrompue en route (panne réseau, client qui abandonne) ne doit
// JAMAIS laisser passer un fragment vers une mutation (action .server.mjs ou entrée de journal) —
// refus AVANT toute mutation, 400, symétrique au plafond de taille (413 : trop, 400 : pas assez).
// Couvre les deux lecteurs de corps du serveur : handleMutatingRequest (action-pipeline.ts,
// formulaires) et readCappedBody (render-server.ts, POST /__mjs/errors).

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { handleMutatingRequest, type ActionPipelineDeps } from '../src/server/action-pipeline.js'
import { readCappedBody } from '../src/server/render-server.js'

function fakeReqRes(method: string, headers: Record<string, string>) {
  const req: any = new EventEmitter()
  req.method = method
  req.headers = headers
  req.destroy = () => {}
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(k: string, v: string) { this.headers[k] = v },
    end(b?: string) { this.body = b ?? '' },
  }
  return { req, res }
}

describe('action-pipeline — corps interrompu avant toute mutation (formulaires)', () => {
  it("une erreur réseau en plein envoi refuse le corps (400), l'action n'est jamais appelée", async () => {
    const { req, res } = fakeReqRes('POST', { 'content-type': 'application/x-www-form-urlencoded' })
    let actionAppelee = false
    const deps: ActionPipelineDeps = {
      config: {},
      entry: {
        actionFor: (pathname: string) => pathname === '/do' ? { params: {}, fn: async () => { actionAppelee = true; return { redirect: '/ok' } } } : null,
        propsFor: async () => ({}),
      } as any,
      recordServer: () => {},
      manifestPath: null,
    }
    const p = handleMutatingRequest(req, res, '/do', '/do', deps)
    // le client envoie un fragment ("amount=1", champ censé valoir bien plus), PUIS la connexion
    // casse (erreur réseau) AVANT tout évènement 'end' — jamais un envoi complet
    req.emit('data', Buffer.from('amount=1'))
    req.emit('error', new Error('ECONNRESET simulé'))
    const handled = await p
    assert.equal(handled, true, 'un verbe mutant doit toujours être traité (réponse posée ici)')
    assert.equal(actionAppelee, false, "le fragment ne doit jamais atteindre l'action")
    assert.equal(res.statusCode, 400)
  })

  it("un abandon ('aborted') a le même traitement qu'une erreur réseau", async () => {
    const { req, res } = fakeReqRes('POST', { 'content-type': 'application/x-www-form-urlencoded' })
    let actionAppelee = false
    const deps: ActionPipelineDeps = {
      config: {},
      entry: {
        actionFor: () => ({ params: {}, fn: async () => { actionAppelee = true; return { redirect: '/ok' } } }),
        propsFor: async () => ({}),
      } as any,
      recordServer: () => {},
      manifestPath: null,
    }
    const p = handleMutatingRequest(req, res, '/do', '/do', deps)
    req.emit('data', Buffer.from('amount=1'))
    req.emit('aborted')
    const handled = await p
    assert.equal(handled, true)
    assert.equal(actionAppelee, false)
    assert.equal(res.statusCode, 400)
  })

  it('un envoi complet (fin normale) continue d\'appeler l\'action — non-régression', async () => {
    const { req, res } = fakeReqRes('POST', { 'content-type': 'application/x-www-form-urlencoded' })
    let capturedBody: unknown = null
    const deps: ActionPipelineDeps = {
      config: {},
      entry: {
        actionFor: () => ({ params: {}, fn: async (_p: unknown, body: unknown) => { capturedBody = body; return { redirect: '/ok' } } }),
        propsFor: async () => ({}),
      } as any,
      recordServer: () => {},
      manifestPath: null,
    }
    const p = handleMutatingRequest(req, res, '/do', '/do', deps)
    req.emit('data', Buffer.from('amount=1'))
    req.emit('end')
    const handled = await p
    assert.equal(handled, true)
    assert.deepEqual(capturedBody, { amount: '1' })
    assert.equal(res.statusCode, 303)
  })
})

describe('render-server — readCappedBody : corps interrompu avant toute mutation (POST /__mjs/errors)', () => {
  it("une erreur réseau en plein envoi refuse (400), rend null — jamais le corps partiel", async () => {
    const { req, res } = fakeReqRes('POST', { 'content-type': 'application/json' })
    const p = readCappedBody(req, res, 65_536)
    req.emit('data', Buffer.from('{"message":"incomplet'))
    req.emit('error', new Error('ECONNRESET simulé'))
    const corps = await p
    assert.equal(corps, null)
    assert.equal(res.statusCode, 400)
  })

  it("un abandon ('aborted') a le même traitement qu'une erreur réseau", async () => {
    const { req, res } = fakeReqRes('POST', { 'content-type': 'application/json' })
    const p = readCappedBody(req, res, 65_536)
    req.emit('data', Buffer.from('{"message":"incomplet'))
    req.emit('aborted')
    const corps = await p
    assert.equal(corps, null)
    assert.equal(res.statusCode, 400)
  })

  it('un envoi complet (fin normale) rend le corps entier — non-régression', async () => {
    const { req, res } = fakeReqRes('POST', { 'content-type': 'application/json' })
    const p = readCappedBody(req, res, 65_536)
    req.emit('data', Buffer.from('{"message":"ok"}'))
    req.emit('end')
    const corps = await p
    assert.equal(corps?.toString('utf-8'), '{"message":"ok"}')
  })

  it('un dépassement de plafond reste un 413 (jamais 400) — non-régression', async () => {
    const { req, res } = fakeReqRes('POST', { 'content-type': 'application/json' })
    const p = readCappedBody(req, res, 8)
    req.emit('data', Buffer.from('un corps bien plus long que le plafond'))
    const corps = await p
    assert.equal(corps, null)
    assert.equal(res.statusCode, 413)
  })
})
