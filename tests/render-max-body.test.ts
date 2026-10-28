// `render.maxBody` : la taille la plus grande, en octets, du corps qu'une action du serveur de rendu accepte (`mjs serve`
// et `mjs dev`, même pipeline). Défaut 1 Mo, inchangé ; au-delà, 413 et lecture arrêtée. La clé est bornée (de 1 Ko à
// 100 Mo, un entier) : une autre valeur est refusée à la lecture de la configuration.

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { handleMutatingRequest, type ActionPipelineDeps } from '../src/server/action-pipeline.js'
import { findConfig } from '../src/bundler/config.js'

function fakeReqRes() {
  const req: any = new EventEmitter()
  req.method    = 'POST'
  req.headers   = { 'content-type': 'application/x-www-form-urlencoded' }
  req.destroyed = false
  req.destroy   = () => { req.destroyed = true }
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(k: string, v: string) { this.headers[k] = v },
    end(b?: string) { this.body = b ?? '' },
  }
  return { req, res }
}

// envoie un corps de `taille` octets (champ `x`) en morceaux de 64 Ko, s'arrête dès que le serveur coupe
async function envoi(config: Record<string, unknown>, taille: number): Promise<{ statut: number; appelee: boolean; coupe: boolean }> {
  const { req, res } = fakeReqRes()
  let appelee = false
  const deps: ActionPipelineDeps = {
    config: config as any,
    entry: {
      actionFor: () => ({ params: {}, fn: async () => { appelee = true; return { redirect: '/ok' } } }),
      propsFor: async () => ({}),
    } as any,
    recordServer: () => {},
    manifestPath: null,
  }
  const p     = handleMutatingRequest(req, res, '/envoi', '/envoi', deps)
  const corps = Buffer.from('x=' + 'a'.repeat(taille - 2))
  for (let i = 0; i < corps.length && !req.destroyed; i += 65_536) req.emit('data', corps.subarray(i, i + 65_536))
  if (!req.destroyed) req.emit('end')
  await p
  return { statut: res.statusCode, appelee, coupe: req.destroyed }
}

describe('serveur de rendu — `render.maxBody`, plafond du corps d\'une action', () => {
  it('défaut 1 Mo : 1 048 576 octets acceptés, un de plus refusé (413)', async () => {
    assert.deepEqual(await envoi({}, 1_048_576), { statut: 303, appelee: true, coupe: false })
    assert.deepEqual(await envoi({}, 1_048_577), { statut: 413, appelee: false, coupe: true })
  })

  it('un plafond plus bas : 413 au-delà, accepté en deçà', async () => {
    const config = { render: { maxBody: 4096 } }
    assert.deepEqual(await envoi(config, 4096), { statut: 303, appelee: true, coupe: false })
    assert.deepEqual(await envoi(config, 4097), { statut: 413, appelee: false, coupe: true })
  })

  it('un plafond plus haut : un corps de 3 Mo passe', async () => {
    assert.deepEqual(await envoi({ render: { maxBody: 4 * 1_048_576 } }, 3 * 1_048_576), { statut: 303, appelee: true, coupe: false }, 'AVANT : 413 à 1 Mo quelle que soit la configuration')
  })

  it('une valeur invalide est refusée à la lecture de la configuration', () => {
    for (const valeur of ['1mb', 0, -5, 1.5, 1023, 104_857_601, true, null]) {
      const racine = mjsTmp('max-body')
      writeFileSync(join(racine, 'mjs.config.json'), JSON.stringify({ render: { maxBody: valeur } }))
      assert.throws(() => findConfig(racine), /render\.maxBody/, 'valeur ' + JSON.stringify(valeur))
    }
    for (const valeur of [1024, 1_048_576, 104_857_600]) {
      const racine = mjsTmp('max-body')
      writeFileSync(join(racine, 'mjs.config.json'), JSON.stringify({ render: { maxBody: valeur } }))
      assert.equal(findConfig(racine)!.config.render!.maxBody, valeur)
    }
  })
})
