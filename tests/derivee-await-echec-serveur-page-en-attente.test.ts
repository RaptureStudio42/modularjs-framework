// Rendu serveur d'une valeur dérivée qui attend dont la demande échoue sur le serveur : comme pour `µload`, la page servie reste en
// attente (`µpending($r)` vrai, `µfailed($r)` vide : le message d'erreur n'entre jamais dans le HTML), rien n'est rangé, et le
// navigateur appelle la fonction à son réveil. En développement, le rendu dit l'échec dans ses avertissements, que le serveur écrit dans
// sa console ; en production, il se tait. Le rendu n'attend pas la fin du délai (`settleMs`) : la demande échouée n'est plus en vol, et
// le rendu ne dit pas qu'il s'est arrêté à son délai (« non stabilisé »), ce qu'il dirait s'il l'avait attendu.
// Méthode : le vrai rendu serveur, moteur happy-dom (développement et production) et moteur navigateur (prérendu) ; la reprise dans
// happy-dom, la balise `#__mjs_store` du serveur posée avant le cœur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'
import { pause } from './helpers/derivee-await-banc.js'
import { servir, reprendre, appels, TARD } from './helpers/derivee-await-serveur.js'
import { mjsTmp } from './helpers/tmp.js'

const SERVI = TARD + `<script>
  $q = 'a'
  f  = (q) ->
    (globalThis.__appels ||= []).push(q)
    if µ.server then Promise.reject(new Error('panne serveur')) else plusTard('vu-' + q, 10)
  $r = await f($q)
</script>
<i>{$r}|{µpending($r)}|{µfailed($r)?.message}</i>
`
const SOURCES = { 'servi.mjs': SERVI }
const ecrit   = (html: string) => String(html).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--.*?-->/g, '').match(/<i>.*?<\/i>/)?.[0]
const avis    = (res: any) => (res.warnings || []).filter((x: string) => /panne serveur/.test(x))

describe('valeur dérivée qui attend — une demande qui échoue sur le serveur laisse la page en attente', function () {
  this.timeout(120000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('moteur happy-dom : page en attente, rien de rangé, l\'échec dit en développement seulement ; le navigateur appelle', async () => {
    const dev = await servir('aw-echec-dev', SOURCES, 'mjs-servi')
    assert.deepEqual((dev.res.warnings || []).filter((x: string) => /stabilis/i.test(x)), [], 'le rendu n\'attend pas la fin du délai : la demande échouée n\'est plus en vol')
    assert.equal(ecrit(dev.res.html), '<i>|true|</i>', 'la page servie reste en attente, sans le message d\'erreur')
    assert.equal(dev.graine, null, 'rien n\'est rangé')
    assert.equal(avis(dev.res).length, 1, 'en développement, le rendu dit l\'échec : ' + JSON.stringify(dev.res.warnings))
    assert.match(avis(dev.res)[0], /<mjs-servi>/)
    assert.match(avis(dev.res)[0], /\$r\b/)
    const prod = await servir('aw-echec-prod', SOURCES, 'mjs-servi', { env: 'prod' })
    assert.equal(ecrit(prod.res.html), '<i>|true|</i>')
    assert.deepEqual(avis(prod.res), [], 'en production, le rendu se tait')
    const w = await reprendre('aw-echec-nav', SOURCES, dev.graine, '<mjs-servi mjs-ssr></mjs-servi>')
    await pause(80)
    assert.deepEqual(appels(w), ['a'], 'le navigateur appelle au réveil')
    assert.equal(ecrit(w.document.querySelector('mjs-servi')._shadow.innerHTML), '<i>vu-a|false|</i>')
    w.close()
  })

  it('moteur navigateur (prérendu) : page en attente, rien de rangé, l\'échec dit en développement', async () => {
    const root = mjsTmp('aw-echec-navigateur')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'servi.mjs'), SERVI)
    const moteur = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out' }, { configDir: root })
    try {
      const res: any = await moteur.renderPage('mjs-servi', { settleMs: 2000 } as any)
      assert.equal(ecrit(res.html), '<i>|true|</i>', 'la page servie reste en attente, sans le message d\'erreur')
      assert.doesNotMatch(String(res.sharedScript || ''), /__mjsAwait/, 'rien n\'est rangé')
      assert.equal(avis(res).length, 1, JSON.stringify(res.warnings))
    }
    finally {
      await moteur.close()
    }
  })
})
