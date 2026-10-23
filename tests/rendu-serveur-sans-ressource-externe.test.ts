// Rendu serveur happy-dom : la fenêtre de rendu chargeait pour de vrai les ressources du DOM rendu
// (`<link rel="stylesheet">`, `<iframe src>`, `window.open`) — une requête sortante du serveur à CHAQUE rendu, hors de
// toute garde (forwardOrigin et le refus des cibles internes ne couvrent que le proxy du moteur
// navigateur). Le rendu serveur n'a besoin d'aucune de ces ressources : aucune ne doit partir.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

describe('rendu serveur happy-dom — aucune ressource externe chargée', function () {
  after(async () => { await terminateSharedWorkerPool() })

  it('`<link rel="stylesheet">`, `<iframe src>`, `<script src>`, `window.open` : aucune requête sortante, sur deux rendus', async function () {
    this.timeout(60000)
    const recu: string[] = []
    const serveur = createServer((req, res) => { recu.push(`${req.method} ${req.url}`); res.end('') })
    await new Promise<void>(r => serveur.listen(0, '127.0.0.1', () => r()))
    const base = `http://127.0.0.1:${(serveur.address() as any).port}`
    const root = mjsTmp('ssr-sans-ressource')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'ressources.mjs'), `
<script lang="coffee">
s = document.createElement('script')
s.src = '${base}/script.js'
document.head.appendChild(s)
window.open('${base}/fenetre.html')
</script>
<link rel="stylesheet" href="${base}/feuille.css">
<iframe src="${base}/cadre.html"></iframe>
<p class="ok">rendu</p>
`)
    const renderer = await createSSRRenderer({ sourceDir: join(root, 'src') })
    try {
      for (let i = 0; i < 2; i++) {
        const { html } = await renderer.renderToString('mjs-ressources')
        assert.match(html, /rendu/)
      }
      // un chargement parti en tâche de fond arriverait juste après le rendu
      await new Promise(r => setTimeout(r, 300))
      assert.deepEqual(recu, [], 'le rendu serveur ne doit charger aucune ressource')
    } finally {
      await renderer.close()
      serveur.close()
    }
  })
})
