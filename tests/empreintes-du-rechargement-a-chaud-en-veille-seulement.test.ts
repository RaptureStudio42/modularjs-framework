// Les empreintes `restHash` et `hotHash` d'un composant (cf. transpileFromMsg) ne servent qu'au mode veille : il compare chaque composant
// recompilé à sa version d'avant (CSS seul, échange à chaud). Hors veille personne ne les lit : l'ouvrier ne les calcule plus, le message
// que lui envoie le bundler dit quand il le faut. Le message et la réponse sont ici ceux d'un vrai tour : même préparation, même fonction.

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpileFromMsg } from '../src/bundler/transpile-msg.js'

function project(prefix: string, env: 'dev' | 'prod') {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  const file   = join(srcDir, 'carte.mjs')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(file, '<script>\n$n = 1\n</script>\n<p class="t">{$n}</p>\n<style>\n.t\n  color: red\n</style>\n')
  return { file, bundler: new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), env }) }
}

// le message que le bundler enverrait à un ouvrier pour ce composant, et la réponse de l'ouvrier
async function workerReply(bundler: Bundler, file: string) {
  const { msg } = await (bundler as any).coldTranspileMsg(file, 'carte', undefined, readFileSync(file, 'utf-8'))
  return transpileFromMsg(msg)
}

describe('empreintes du rechargement à chaud : calculées en mode veille seulement', function () {
  this.timeout(30000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const env of ['dev', 'prod'] as const) {
    it(`construction (${env}) : ni restHash ni hotHash`, async function () {
      const { file, bundler } = project(`empreintes-${env}`, env)
      await bundler.compile()
      const reply = await workerReply(bundler, file)
      await bundler.close()
      assert.equal(reply.data.restHash, undefined)
      assert.equal(reply.data.hotHash, undefined)
    })
  }

  it('mode veille : les deux empreintes sont calculées', async function () {
    const { file, bundler } = project('empreintes-veille', 'dev')
    await bundler.compile()
    await bundler.watch()
    const reply = await workerReply(bundler, file)
    await bundler.close()
    assert.match(reply.data.restHash, /^[0-9a-f]{16}$/)
    assert.match(reply.data.hotHash, /^[0-9a-f]{16}$/)
  })
})
