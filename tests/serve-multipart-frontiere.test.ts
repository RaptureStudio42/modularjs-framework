// Envoi multipart : une valeur de champ texte qui contient, en plein milieu, l'octet-suite
// "--<boundary>" suivie d'autre chose que CRLF ou "--" n'est PAS une vraie frontière — le lecteur
// de valeur ne doit s'arrêter que sur une frontière VRAIE (CRLF ou "--" juste après), jamais sur
// une coïncidence fortuite au milieu de la valeur.

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { handleMutatingRequest, type ActionPipelineDeps } from '../src/server/action-pipeline.js'

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

async function poster(raw: string): Promise<{ status: number, body: any }> {
  const { req, res } = fakeReqRes('POST', { 'content-type': 'multipart/form-data; boundary=BOUND' })
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
  req.emit('data', Buffer.from(raw, 'utf-8'))
  req.emit('end')
  await p
  return { status: res.statusCode, body: capturedBody }
}

describe('action-pipeline — multipart : la frontière exige CRLF ou "--" juste après elle', () => {
  it("une valeur contenant \"\\r\\n--BOUNDsuffix\" (préfixe fortuit, pas suivi de CRLF/--) n'est pas coupée", async () => {
    const raw =
      '--BOUND\r\n' +
      'Content-Disposition: form-data; name="f"\r\n' +
      '\r\n' +
      'hello\r\n--BOUNDsuffix\r\nworld\r\n' +
      '--BOUND--\r\n'
    const { status, body } = await poster(raw)
    assert.equal(status, 303, JSON.stringify(body))
    assert.equal((body as any).f, 'hello\r\n--BOUNDsuffix\r\nworld', 'la valeur complète doit survivre, jamais tronquée au premier préfixe fortuit')
  })

  it('une VRAIE frontière (CRLF juste après) continue de couper la valeur — non-régression', async () => {
    const raw =
      '--BOUND\r\n' +
      'Content-Disposition: form-data; name="f"\r\n' +
      '\r\n' +
      'hello\r\n' +
      '--BOUND\r\n' +
      'Content-Disposition: form-data; name="g"\r\n' +
      '\r\n' +
      'world\r\n' +
      '--BOUND--\r\n'
    const { status, body } = await poster(raw)
    assert.equal(status, 303, JSON.stringify(body))
    assert.deepEqual(body, { f: 'hello', g: 'world' })
  })

  it('une VRAIE frontière terminale ("--" juste après) continue de couper la valeur — non-régression', async () => {
    const raw =
      '--BOUND\r\n' +
      'Content-Disposition: form-data; name="f"\r\n' +
      '\r\n' +
      'hello\r\n' +
      '--BOUND--\r\n'
    const { status, body } = await poster(raw)
    assert.equal(status, 303, JSON.stringify(body))
    assert.deepEqual(body, { f: 'hello' })
  })
})
