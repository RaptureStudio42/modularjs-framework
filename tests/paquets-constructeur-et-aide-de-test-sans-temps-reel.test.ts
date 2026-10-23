// Paquets publiés : le constructeur (`dist/worker.js`, la compilation dans les fils de travail) et l'aide de test (`dist/testing.js`)
// n'embarquent aucun module de MJS WS (src/mjs-ws/). La validation de `journal.trustProxy` (bundler/config.ts) lisait l'option par
// mjs-ws/trust-proxy.ts : les deux paquets tiraient alors ce module et transport.ts. Le constructeur ne valide jamais la config, mais
// esbuild gardait les instructions de premier niveau du module (une liste d'adresses remplie au chargement) et tout ce qu'elles
// touchent ; l'aide de test valide la config et n'a besoin que des règles de lecture. Ces règles vivent dans src/trust-proxy-rules.ts,
// commun au temps réel et à la config, sans instruction de premier niveau.
// Mêmes options esbuild que `npm run build:self`, lues dans les métadonnées (metafile), sans rien écrire.

import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const racine = join(dirname(fileURLToPath(import.meta.url)), '..')

// modules sources qui entrent dans le paquet de cette entrée
async function modulesDuPaquet(entree: string): Promise<string[]> {
  const r       = await build({ absWorkingDir: racine, entryPoints: [entree], bundle: true, platform: 'node', target: 'node20', format: 'esm', packages: 'external', outdir: 'dist', entryNames: '[name]', write: false, metafile: true, logLevel: 'silent' })
  const sorties = Object.values(r.metafile.outputs).filter(o => o.entryPoint === entree)
  assert.equal(sorties.length, 1, `une sortie pour ${entree}`)
  return Object.keys(sorties[0].inputs)
}

describe('paquets publiés : le constructeur et l\'aide de test sans le code du temps réel', function () {
  this.timeout(120000)

  it('dist/worker.js : aucun module de src/mjs-ws/, ni les règles de trustProxy (le constructeur ne valide pas la config)', async () => {
    const modules = await modulesDuPaquet('src/bundler/worker.ts')
    // le chemin par lequel le code arrivait existe toujours : la garde ne lit pas une liste vide
    assert.ok(modules.includes('src/bundler/config.ts'), 'bundler/config.ts fait partie du constructeur')
    assert.deepEqual(modules.filter(m => m.startsWith('src/mjs-ws/')), [])
    assert.ok(!modules.includes('src/trust-proxy-rules.ts'), 'les règles de trustProxy ne servent pas au constructeur')
  })

  it('dist/testing.js : aucun module de src/mjs-ws/, la validation de journal.trustProxy suffit aux règles communes', async () => {
    const modules = await modulesDuPaquet('src/testing/index.ts')
    assert.ok(modules.includes('src/bundler/config.ts'), 'bundler/config.ts fait partie de l\'aide de test')
    assert.deepEqual(modules.filter(m => m.startsWith('src/mjs-ws/')), [])
  })
})
