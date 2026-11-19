// une sortie à empreinte changée sur le disque après son écriture (fins de ligne CRLF d'un checkout git, bandeau d'un outil de
// déploiement) : la construction suivante réussit et remet le bon contenu sous ce nom, comme la 4.0.0 réussissait ; ce n'est pas une
// collision d'empreinte (le contenu du disque ne porte pas l'empreinte du nom)
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

async function construire(opts: any): Promise<any> {
  const b     = new Bundler(opts)
  const stats = await b.compile()
  await b.close()
  return stats
}

describe('sortie à empreinte changée sur le disque entre deux constructions', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const env of ['dev', 'prod']) for (const [cas, changer] of [['fins de ligne CRLF', (t: string) => t.replace(/\n/g, '\r\n')], ['bandeau en tête', (t: string) => '/* bandeau */\n' + t]] as const) {
    it(`${env}, ${cas} : la construction suivante réussit et remet le contenu`, async () => {
      const root = mjsTmp('sortie-changee')
      const src  = join(root, 'src')
      const out  = join(root, 'out')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, 'a.mjs'), ['<script>', '  $x = 1', '</script>', '<p>{$x}</p>'].join('\n'))
      const opts   = { sourceDir: src, outputDir: out, manifestPath: join(out, 'manifest.js'), urlPrefix: '/out', js: 'split', env }
      const avant  = await construire(opts)
      assert.equal(avant.errors.length, 0)
      const noms   = readdirSync(out).filter(f => /-[0-9a-z]{5}\.js$/.test(f))
      const sains  = new Map(noms.map(f => [f, readFileSync(join(out, f), 'utf-8')]))
      assert.ok(noms.length >= 2, 'le cœur et le composant')
      for (const f of noms) writeFileSync(join(out, f), changer(sains.get(f)!))
      const apres  = await construire(opts)
      assert.deepEqual(apres.errors.map((e: any) => e.message), [], 'la construction échoue sur une sortie changée après coup')
      for (const f of noms) assert.equal(readFileSync(join(out, f), 'utf-8'), sains.get(f), `${f} n'a pas retrouvé son contenu`)
    })
  }
})
