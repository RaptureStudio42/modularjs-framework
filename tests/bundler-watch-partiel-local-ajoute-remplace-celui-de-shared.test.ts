// `mjs dev` (watch()) : `sous/fiche.mjs` inclut `entete` par son nom simple, pris dans `shared/_entete.mjs` ; un partiel local
// `sous/_entete.mjs` ajouté pendant la session le remplace. La fiche se recompile et sa sortie porte l'entête proche. Avant ce
// correctif, seul le partiel trouvé comptait dans les dépendances de la fiche : le cache de la session la gardait avec l'ancienne entête.

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// attend qu'une condition se vérifie, au plus `timeoutMs`
function waitFor(check: () => boolean, timeoutMs: number, what: () => string): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const poll = (): void => {
      if (check()) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error(`rien après ${timeoutMs} ms : ${what()}`))
      setTimeout(poll, 30)
    }
    poll()
  })
}

describe('watch() : un partiel local ajouté remplace celui de shared/ du même nom', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('la fiche se recompile et porte l\'entête proche', async function () {
    const root = mjsTmp('watch-partiel-proche')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(join(src, 'sous'), { recursive: true })
    mkdirSync(join(src, 'shared'))
    writeFileSync(join(src, 'accueil.mjs'), '<mjs-fiche></mjs-fiche>\n')
    writeFileSync(join(src, 'sous/fiche.mjs'), '<div>\n  <@include entete>\n</div>\n')
    writeFileSync(join(src, 'shared/_entete.mjs'), '<h2>ENTETE-PARTAGEE</h2>\n')
    // l'entête que porte la fiche écrite dans le dossier de sortie
    const header  = (): string => readdirSync(out).filter(f => /^fiche-.*\.js$/.test(f)).map(f => /ENTETE-[A-Z]+/.exec(readFileSync(join(out, f), 'utf-8'))?.[0] ?? '').join(' | ')
    const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(root, 'bundle.js') })
    const events: string[] = []
    try {
      await bundler.watch({ onRecompile: p => events.push(p) })
      assert.ok(events.includes('<initial>'), JSON.stringify(events))
      assert.equal(header(), 'ENTETE-PARTAGEE')
      writeFileSync(join(src, 'sous/_entete.mjs'), '<h2>ENTETE-PROCHE</h2>\n')
      await waitFor(() => events.some(e => e.endsWith('_entete.mjs')), 15000, () => JSON.stringify(events))
      assert.equal(header(), 'ENTETE-PROCHE')
    }
    finally {
      await bundler.close()
    }
  })
})
