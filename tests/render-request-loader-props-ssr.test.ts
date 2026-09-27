// Données chargées côté serveur (chargeur `.server.mjs`, `props`) : disponibles au navigateur
// (balise `__mjs_res`, cf. nav-res-first-load.test.ts) mais jamais transmises au RENDU SSR
// lui-même — le composant affichait sa valeur par défaut (ou rien) au premier affichage, alors
// que le script juste à côté portait déjà la bonne donnée. render-request.ts doit désormais
// fusionner ces props dans le rendu, pour le mode `ssr` (le prérendu au build, sans requête HTTP
// entrante, n'a structurellement aucun chargeur `.server.mjs` par-requête à consulter).
//
// Même harnais que nav-res-first-load.test.ts (startRenderServer + fetch), composant qui AFFICHE
// la prop dans son markup au lieu de se contenter de la recevoir.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'
import { startRenderServer } from '../src/server/render-server.js'

after(() => sweepRegistered())

const FIXTURE = `export default {
  props: {
    '/': (params, req) -> { titre: 'Charge-cote-serveur' }
  }
}
`

function setup() {
  const root = mjsTmp('render-request-loader-props')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  // aucun <script> : $titre est une PROP auto-déclarée (docs/04-props.md), reçue en attribut par
  // le renderer (props → attribut, docs/19-ssr.md §4) — jamais besoin de la déclarer à vide.
  writeFileSync(join(srcDir, 'home.mjs'), '<h1 class="t">{$titre}</h1>\n')
  writeFileSync(join(root, 'serve.server.mjs'), FIXTURE)
  const config = {
    sourceDir: 'src', outputDir: 'out',
    render: { routes: { '/': { component: 'mjs-home', mode: 'ssr' as const } } },
  }
  return { root, config }
}

function extractResTag(html: string): string | null {
  const m = html.match(/<script type="application\/json" id="__mjs_res">([\s\S]*?)<\/script>/)
  return m ? m[1] : null
}

describe('render-request — props du chargeur .server.mjs transmises au RENDU SSR', () => {
  it('le markup SSR affiche la donnée chargée côté serveur, pas seulement la balise __mjs_res', async function () {
    this.timeout(15000)
    const { root, config } = setup()
    const running = await startRenderServer(config as any, root, { port: 0 })
    try {
      const res = await fetch(`http://127.0.0.1:${running.port}/`)
      assert.equal(res.status, 200)
      const html = await res.text()
      // contrôle : la donnée EST bien chargée quelque part — si ce contrôle échoue, le test ne
      // prouverait rien sur la présence de la donnée DANS le HTML rendu.
      const raw = extractResTag(html)
      assert.ok(raw, 'la balise __mjs_res doit être présente (contrôle)')
      assert.deepEqual(JSON.parse(raw!), { titre: 'Charge-cote-serveur' })
      // BUG confirmé si absent : le composant rendu CÔTÉ SERVEUR n'a jamais reçu `titre`, son
      // premier affichage (avant toute hydratation JS) est donc vide ou périmé.
      assert.match(html, /<h1 class="t">Charge-cote-serveur<\/h1>/, `le markup SSR doit afficher la prop chargée, html :\n${html}`)
    } finally { await running.close() }
  })

  it("route SANS entrée de chargeur pour ce chemin : le rendu SSR garde son comportement (prop absente, jamais de crash)", async function () {
    this.timeout(15000)
    const root = mjsTmp('render-request-loader-props-vide')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'vide.mjs'), '<h1 class="t">{$titre}</h1>\n')
    writeFileSync(join(root, 'serve.server.mjs'), FIXTURE)
    const config = {
      sourceDir: 'src', outputDir: 'out',
      render: { routes: { '/vide': { component: 'mjs-vide', mode: 'ssr' as const } } },
    }
    const running = await startRenderServer(config as any, root, { port: 0 })
    try {
      const res = await fetch(`http://127.0.0.1:${running.port}/vide`)
      assert.equal(res.status, 200)
      const html = await res.text()
      assert.equal(extractResTag(html), null, 'aucune entrée de chargeur pour /vide → pas de balise __mjs_res')
      assert.match(html, /<h1 class="t"><\/h1>/, 'prop absente : rendu vide, jamais un crash')
    } finally { await running.close() }
  })
})
