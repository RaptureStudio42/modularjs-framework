// Politique d'accès aux fichiers cachés du dossier de sortie : `.mjs-theme-vars.json` (écrit par le
// bundler à la racine d'outputDir, cf. bundler/index.ts pruneOrphans) a sa propre route dédiée
// (GET /__mjs/theme.json), fermée dès que le serveur tourne en production — mais l'accès DIRECT à
// ce même fichier, via le chemin d'asset ordinaire, ne suivait aucune de ces règles : la donnée
// restait lisible en production par ce deuxième chemin. Aligné sur la politique la plus stricte des
// deux : aucun segment caché (préfixé par un point) n'est jamais servi comme asset, dev ou prod.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'
import { startRenderServer } from '../src/server/render-server.js'

after(() => sweepRegistered())

function setup() {
  const root = mjsTmp('serve-dotfile')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(srcDir, 'home.mjs'), '<h1>Salut</h1>')
  writeFileSync(join(outDir, '.mjs-theme-vars.json'), '{"accent":{"declarations":[{"value":"#fff","file":"src/home.mjs","line":3}],"readBy":[]}}')
  writeFileSync(join(outDir, 'style-abc123.css'), '.x{color:red}')
  const config = { sourceDir: 'src', outputDir: 'out' }
  return { root, config }
}

describe('render-server — dotfiles d\'outputDir jamais servis comme asset', () => {
  it('la route dédiée /__mjs/theme.json est bien fermée en production (contrôle)', async function () {
    this.timeout(15000)
    const { root, config } = setup()
    const running = await startRenderServer(config as any, root, { port: 0, env: 'prod' })
    try {
      const res = await fetch(`http://127.0.0.1:${running.port}/__mjs/theme.json`)
      assert.equal(res.status, 404, 'outil de développement : fermé en production')
    } finally { await running.close() }
  })

  it('le MÊME fichier via le chemin ASSET direct (/.mjs-theme-vars.json) est refusé aussi en production', async function () {
    this.timeout(15000)
    const { root, config } = setup()
    const running = await startRenderServer(config as any, root, { port: 0, env: 'prod' })
    try {
      const res = await fetch(`http://127.0.0.1:${running.port}/.mjs-theme-vars.json`)
      assert.notEqual(res.status, 200, "BUG confirmé si le contenu du registre fuit par le chemin asset alors que la route dédiée est fermée")
      const body = await res.text()
      assert.doesNotMatch(body, /declarations/, 'le contenu du registre ne doit jamais fuiter par ce chemin')
    } finally { await running.close() }
  })

  it('le chemin ASSET direct est refusé aussi HORS production — un dotfile ne se sert jamais tel quel', async function () {
    this.timeout(15000)
    const { root, config } = setup()
    const running = await startRenderServer(config as any, root, { port: 0 })
    try {
      const res = await fetch(`http://127.0.0.1:${running.port}/.mjs-theme-vars.json`)
      assert.notEqual(res.status, 200)
    } finally { await running.close() }
  })

  it('un VRAI asset non caché continue d\'être servi normalement — non-régression', async function () {
    this.timeout(15000)
    const { root, config } = setup()
    const running = await startRenderServer(config as any, root, { port: 0 })
    try {
      const res = await fetch(`http://127.0.0.1:${running.port}/style-abc123.css`)
      assert.equal(res.status, 200)
      assert.equal(await res.text(), '.x{color:red}')
    } finally { await running.close() }
  })
})
