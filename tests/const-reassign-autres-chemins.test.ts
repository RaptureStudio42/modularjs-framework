// Réaffecter une constante Civet (`:=` → `const`) refuse de compiler sur TOUS les chemins qui
// compilent du Civet, pas seulement le `<script>` d'un composant et le module `.civet` autonome :
//   - `<script module>` d'un composant (réaffectée dans le bloc lui-même, depuis une fonction) ;
//   - `<script>` d'un composant qui réaffecte une constante de son `<script module>` ;
//   - fichier serveur `.server.mjs` (mjs ws / mjs serveur) et entrée `.civet` brute ;
//   - fichiers `.civet` réunis par un manifeste externe (`#= require`).
// Sans ce refus : build vert, puis `TypeError: Assignment to constant variable` à l'exécution.
// Un homonyme local (`.=` dans le `<script>`, paramètre) n'est jamais visé.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { compileServerFile, compileRawCivetFile } from '../src/cli/server-entry.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('constante `:=` — <script module> d\'un composant', function () {
  it('réaffectée dans le bloc lui-même, depuis une fonction : refus à la compilation', async () => {
    const src = '<script module>\nx := 1\nbump = ->\n  x = 2\n</script>\n<script>\n</script>\n<p>{x}</p>'
    await assert.rejects(transpile(src, { moduleName: 'const-module-interne' }), /« x »/)
  })

  it('réaffectée par le <script> du composant (dans une fonction) : refus à la compilation', async () => {
    const src = '<script module>\nx := 1\n</script>\n<script>\nbump = ->\n  x = 2\n</script>\n<button @click={bump()}>{x}</button>'
    await assert.rejects(transpile(src, { moduleName: 'const-module-par-script' }), /« x »/)
  })

  it('réaffectée par le <script> du composant, au premier niveau : refus à la compilation', async () => {
    const src = '<script module>\nx := 1\n</script>\n<script>\nx = 2\n</script>\n<p>{x}</p>'
    await assert.rejects(transpile(src, { moduleName: 'const-module-par-script-niveau' }), /« x »/)
  })

  it('lue seulement par le <script>, ou masquée par un `.=` local : compile', async () => {
    const lecture = '<script module>\nx := 1\n</script>\n<script>\ny := x + 1\n</script>\n<p>{y}</p>'
    await assert.doesNotReject(transpile(lecture, { moduleName: 'const-module-lecture' }))
    const masque = '<script module>\nx := 1\n</script>\n<script>\nx .= 5\nbump = ->\n  x = 6\n</script>\n<button @click={bump()}>{x}</button>'
    await assert.doesNotReject(transpile(masque, { moduleName: 'const-module-masque' }))
  })
})

describe('constante `:=` — fichiers serveur (mjs ws / mjs serveur)', function () {
  it('.server.mjs : réaffectée depuis une fonction imbriquée → refus à la compilation', async () => {
    const root  = mjsTmp('const-server-mjs')
    const entry = join(root, 'app.server.mjs')
    writeFileSync(entry, 'x := 1\nbump = ->\n  x = 2\nexport default { setup: (app) -> bump() }\n')
    await assert.rejects(() => compileServerFile(entry, root), /« x »/)
  })

  it('.server.mjs : `.=` réaffectable normalement → compile', async () => {
    const root  = mjsTmp('const-server-mjs-ok')
    const entry = join(root, 'app.server.mjs')
    writeFileSync(entry, 'x .= 1\nbump = ->\n  x = 2\nexport default { setup: (app) -> bump() }\n')
    await assert.doesNotReject(() => compileServerFile(entry, root))
  })

  it('entrée .civet brute : réaffectée depuis une fonction imbriquée → refus à la compilation', async () => {
    const root  = mjsTmp('const-civet-brut')
    const entry = join(root, 'app.civet')
    writeFileSync(entry, 'x := 1\nbump := ->\n  x = 2\nexport default { setup: (app) -> bump() }\n')
    await assert.rejects(() => compileRawCivetFile(entry, root), /« x »/)
  })
})

describe('constante `:=` — manifeste externe (#= require)', function () {
  this.timeout(30000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('un fichier .civet requis qui réaffecte sa constante → erreur de build qui nomme le fichier', async () => {
    const root   = mjsTmp('const-manifeste')
    const srcDir = join(root, 'app/modularjs')
    const libDir = join(root, 'vendor/lib')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    mkdirSync(libDir, { recursive: true })
    writeFileSync(join(root, 'vendor/manifest.civet'), '#= require ./lib/a\n')
    writeFileSync(join(libDir, 'a.civet'), 'compte := 0\nglobalThis.plus = ->\n  compte = compte + 1\n')

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), manifestExternal: join(root, 'vendor/manifest.civet') })
    try {
      const stats = await bundler.compile()
      const messages = stats.errors.map(e => e.message).join('\n')
      assert.match(messages, /a\.civet[\s\S]*'compte'/, `erreur attendue sur a.civet, reçu : ${messages || '(aucune erreur)'}`)
    } finally {
      await bundler.close()
    }
  })
})
