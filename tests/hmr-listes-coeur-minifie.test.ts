// Les listes de noms internes du rechargement à chaud (champs hors garde, champs remis à neuf, champs gardés) sont des clés nues : un
// cœur de développement minifié (`minify: true`) raccourcit les champs `_mjs_*` et ces clés avec eux, de la même façon. Écrites en
// texte, elles gardaient les noms longs : la garde ne reconnaissait plus aucun champ interne (chaque échange rechargeait la page) et la
// remise à neuf ne retirait rien. Ce test bâtit un tel cœur et y retrouve chaque liste, écrite avec les noms courts de la construction.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const hotswap = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'runtime', 'mjs_hotswap.ts')
const LISTES  = ['_mjsHotInternal', '_mjsHotReset', '_mjsHotKeep']

// les clés d'une liste, dans l'ordre de la source
function cles(nom: string): string[] {
  const m = new RegExp(`^var ${nom} = \\{ ([^}]*) \\};$`, 'm').exec(readFileSync(hotswap, 'utf8'))
  assert.ok(m, `${nom} introuvable, ou pas écrite en clés nues`)
  return m[1].split(', ').map((c) => c.replace(/: 1$/, ''))
}

describe('rechargement à chaud — les listes de noms internes d\'un cœur de développement minifié', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('chaque liste porte les noms courts que la construction donne aux champs', async () => {
    const root = mjsTmp('hmr-listes-minifie')
    const src  = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'compteur.mjs'), '<script>\n$n = 0\n</script>\n<button @click={$n++}>{$n}</button>\n')
    const bundler = new Bundler({ sourceDir: src, outputDir: join(root, 'out'), manifestPath: join(root, 'out', 'bundle.js'), minify: true })
    try {
      const stats = await bundler.compile()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
      const out   = join(root, 'out')
      const coeur = readdirSync(out).filter((f) => /^mjs_core-[0-9a-z]{5}\.js$/.test(f)).map((f) => readFileSync(join(out, f), 'utf8')).join('\n')
      assert.equal(coeur.includes('._mjs_is_mounted'), false, 'cœur non minifié : le test ne prouverait rien')
      for (const nom of LISTES) {
        const courts = cles(nom).map((k) => typeof bundler.mangleCache[k] === 'string' ? bundler.mangleCache[k] as string : k)
        assert.ok(coeur.includes('{' + courts.map((k) => k + ':1').join(',') + '}'), `${nom} : la liste ne suit pas les noms raccourcis`)
      }
    }
    finally {
      await bundler.close()
    }
  })
})
