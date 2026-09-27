// fixture — process ENFANT de tests/render-server-close-journal.test.ts. Démarre un vrai serveur
// de rendu, déclenche une entrée de journal serveur (action qui échoue), ferme le serveur selon le
// mode reçu, efface le dossier de log puis quitte — même patron que journal-close-child.mts, mais
// via startRenderServer() plutôt que createJournal() directement : c'est SON close() à lui qui doit
// couper le hook 'exit', pas celui du journal seul.
// Extension .mts EXPRÈS (comme journal-close-child.mts) : `mocha --extension ts` ne la charge pas.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { startRenderServer } from '../../src/server/render-server.js'

const root = process.argv[2]
const mode = process.argv[3]   // 'avec-close' | 'sans-close'

const srcDir = join(root, 'src')
mkdirSync(srcDir, { recursive: true })
writeFileSync(join(srcDir, 'home.mjs'), '<h1>Salut</h1>')
writeFileSync(join(root, 'serve.server.mjs'), `export default {
  actions: {
    '/boom': (params, body, req) ->
      throw new Error('boom fixture')
  }
}
`)

const config: any = {
  sourceDir: 'src', outputDir: 'out',
  render: { routes: { '/boom': { component: 'mjs-home', mode: 'csr' as const } } },
}

const running = await startRenderServer(config, root, { port: 0 })
await fetch(`http://127.0.0.1:${running.port}/boom`, {
  method: 'POST',
  headers: { origin: `http://127.0.0.1:${running.port}`, 'content-type': 'application/x-www-form-urlencoded' },
  body: '',
})

if (mode === 'avec-close') await running.close()

// le ménage de l'appelant, joué AVANT que le process ne meure — exactement le scénario visé
rmSync(join(root, 'log'), { recursive: true, force: true })
process.exit(0)
