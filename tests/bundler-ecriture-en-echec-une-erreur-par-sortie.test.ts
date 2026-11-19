// une sortie dont l'écriture échoue (droits, disque plein) : la construction dit cette erreur, une par sortie en échec, et rien d'autre ;
// la sortie fautive ne reçoit plus en plus « repère interne jamais résolu … bogue du bundler », et les sorties saines qui venaient
// après sont écrites. L'échec est provoqué à l'écriture d'un composant, avec l'erreur que donne le système (EACCES)
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

async function construire(env: 'dev' | 'prod', enEchec: string[]): Promise<{ erreurs: string[], ecrits: string[] }> {
  const root = mjsTmp('ecriture-en-echec')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  for (const f of ['a', 'b', 'c']) writeFileSync(join(src, f + '.mjs'), `<p>${f}</p>\n`)
  const ecrits: string[] = []
  const b: any  = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env } as any)
  const ecrire  = b.writeHashed
  b.writeHashed = function (stem: string, ...reste: any[]): string {
    if (enEchec.includes(stem)) throw Object.assign(new Error(`EACCES: permission denied, open '${stem}'`), { code: 'EACCES' })
    ecrits.push(stem)
    return ecrire.call(this, stem, ...reste)
  }
  const s = await b.compile()
  await b.close()
  return { erreurs: s.errors.map((e: Error) => e.message).sort(), ecrits }
}

describe('construction : une sortie qui ne s\'écrit pas', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  const cas: Array<[string, 'dev' | 'prod', string[]]> = [
    ['dev : a ne s\'écrit pas', 'dev', ['a']],
    ['prod : a ne s\'écrit pas', 'prod', ['a']],
    ['prod : a et b ne s\'écrivent pas', 'prod', ['a', 'b']],
  ]
  for (const [nom, env, enEchec] of cas) {
    it(`${nom} — une erreur par sortie en échec, rien d'autre, les autres écrites`, async () => {
      const r = await construire(env, enEchec)
      assert.deepEqual(r.erreurs, enEchec.map(f => `EACCES: permission denied, open '${f}'`))
      for (const f of ['a', 'b', 'c'].filter(f => !enEchec.includes(f))) assert.ok(r.ecrits.includes(f), `${f} doit être écrit : ${r.ecrits.join(', ')}`)
    })
  }
})
