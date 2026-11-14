// un module `.js.mjs` est compilé par MJS et chargé comme un module : une ligne `#!` en tête n'y aurait plus sa place après la
// compilation (µ importé, `@import` réécrits) — la construction s'arrête, nomme le fichier et dit de retirer la ligne, ou de nommer
// le fichier `.js` (bibliothèque copiée telle quelle, ligne `#!` comprise) s'il ne se sert pas de µ

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

// une appli de développement : rend les erreurs de sa construction
async function construire(fichiers: Record<string, string>): Promise<string[]> {
  const racine  = mkdtempSync(join(tmpdir(), 'js-mjs-bang-'))
  const src     = join(racine, 'src')
  const journal = [console.log, console.warn, console.error]
  mkdirSync(src, { recursive: true })
  for (const [nom, texte] of Object.entries(fichiers)) writeFileSync(join(src, nom), texte)
  console.log = console.warn = console.error = () => {}
  try {
    const b: any  = new Bundler({ sourceDir: src, outputDir: join(racine, 'out'), manifestPath: join(racine, 'bundle.js'), minify: false } as any)
    const st: any = await b.compile()
    return (st.errors ?? []).map((e: any) => String(e?.message ?? e))
  }
  finally {
    [console.log, console.warn, console.error] = journal
    rmSync(racine, { recursive: true, force: true })
  }
}

const COMPOSANT = "<script>\n@import { f } 'outil.js.mjs'\nload = -> $r = f()\n</script>\n<p>{$r}</p>\n"

describe('module .js.mjs : une ligne #! en tête', function () {
  this.timeout(60000)
  after(() => terminateSharedWorkerPool())

  it('arrête la construction, nomme le fichier et dit de retirer la ligne, ou de le nommer .js s\'il ne se sert pas de µ', async () => {
    const erreurs = await construire({ 'alpha.mjs': COMPOSANT, 'outil.js.mjs': "#!/usr/bin/env node\nexport const f = () => µ.log('x')\n" })
    assert.equal(erreurs.length, 1, erreurs.join('\n'))
    assert.match(erreurs[0], /outil\.js\.mjs/)
    assert.match(erreurs[0], /« #! »|"#!"/)
    assert.match(erreurs[0], /outil\.js\b(?!\.mjs)/)
  })

  it('sans ligne #!, le même module se construit', async () => {
    assert.deepEqual(await construire({ 'alpha.mjs': COMPOSANT, 'outil.js.mjs': "export const f = () => µ.log('x')\n" }), [])
  })
})
