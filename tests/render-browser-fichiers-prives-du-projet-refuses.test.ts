// Moteur de rendu par navigateur avec le dossier de sortie à la racine du projet (`"outputDir": "."`) : la page rendue lisait par
// `fetch` tous les fichiers du projet, secrets compris (`.env`, `mjs.config.json`, `config/master.key`, `id_rsa`, `package.json`,
// `server.js`, `secrets.json` : 200 avec leur contenu), là où `mjs serve` répond 404 sur le même projet ; et le HTML rendu part au
// visiteur. L'interception de la page applique maintenant le même refus que `mjs serve` : les fichiers privés du projet quand le
// dossier de sortie est la racine du projet (ou la contient), et tout segment caché du chemin, quel que soit le dossier de sortie.
// Les sorties du build (le cœur, les composants que la page charge) et les fichiers publics restent servis.
//
// Garde de disponibilité — même motif que tests/render-browser.test.ts : Chromium optionnel.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

async function isChromiumAvailable(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

// composant qui lit chaque chemin par `fetch` et écrit `chemin=statut:début du texte`, séparés par ` ¦ `
function lecture(chemins: string[]): string {
  const liste = JSON.stringify(chemins).replace(/"/g, "'")
  return `
<script>
$p = Promise.all(${liste}.map((u) -> fetch(u, { cache: 'no-store' }).then((r) -> r.text().then((t) -> u + '=' + r.status + ':' + t.slice(0, 40))))).then((a) -> a.join(' ¦ '))
</script>
{await $p}<span class="pending">attente</span>{success s}<span class="lu">{s}</span>{end}
`
}

// rend la page et relève, par chemin, le statut et le début du texte lus par la page
async function lire(config: any, root: string): Promise<{ html: string, vus: Map<string, { statut: number, texte: string }> }> {
  const renderer = await createBrowserRenderer(config, { configDir: root })
  try {
    const r  = await renderer.renderPage('mjs-lecture', { settleMs: 5000 })
    const lu = (r.html.match(/<span class="lu">([^<]*)<\/span>/) || [])[1]
    assert.ok(lu !== undefined, 'rendu abouti : ' + r.html.slice(0, 300))
    const vus = new Map<string, { statut: number, texte: string }>()
    for (const ligne of lu.split(' ¦ ')) {
      const m = ligne.match(/^([^=]+)=(\d+):([\s\S]*)$/)
      assert.ok(m, 'ligne lisible : ' + ligne)
      vus.set(m[1], { statut: Number(m[2]), texte: m[3] })
    }
    return { html: r.html, vus }
  } finally {
    await renderer.close()
  }
}

describe('render-browser — la page rendue ne lit pas les fichiers privés du projet', function () {
  let chromiumReady = false

  before(async function () {
    this.timeout(10000)
    chromiumReady = await isChromiumAvailable()
    if (!chromiumReady) {
      console.log('  ℹ️  Chromium non installé, test render-browser-fichiers-prives-du-projet-refuses sauté.')
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('dossier de sortie à la racine du projet : chaque fichier privé répond 404, un fichier public et le build restent servis', async function () {
    if (!chromiumReady) { this.skip(); return }
    this.timeout(90000)
    const root = mjsTmp('render-browser-prives')
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'config'), { recursive: true })
    mkdirSync(join(root, 'donnees'), { recursive: true })
    writeFileSync(join(root, '.env'), 'DB_PASSWORD=env-secret')
    writeFileSync(join(root, 'mjs.config.json'), '{"sourceDir":"src","outputDir":".","x":"cfg-secret"}')
    writeFileSync(join(root, 'config', 'master.key'), 'key-secret')
    writeFileSync(join(root, 'id_rsa'), 'rsa-secret')
    writeFileSync(join(root, 'package.json'), '{"name":"pkg-secret"}')
    writeFileSync(join(root, 'server.js'), '// srv-secret')
    writeFileSync(join(root, 'secrets.json'), '{"k":"json-secret"}')
    writeFileSync(join(root, 'donnees', 'info.txt'), 'INFO PUBLIQUE')
    const prives = ['/.env', '/mjs.config.json', '/config/master.key', '/id_rsa', '/package.json', '/server.js', '/secrets.json']
    writeFileSync(join(root, 'src', 'lecture.mjs'), lecture([...prives, '/donnees/info.txt']))
    // le rendu lui-même charge le cœur et le composant compilés, rangés à la racine du projet : le build reste servi
    const { html, vus } = await lire({ sourceDir: 'src', outputDir: '.', render: { browserPool: { size: 1 } } }, root)
    for (const chemin of prives) {
      const vu = vus.get(chemin)
      assert.ok(vu, 'chemin lu par la page : ' + chemin)
      assert.equal(vu.statut, 404, chemin + ' refusé à la page (lu : ' + vu.statut + ' ' + vu.texte + ')')
    }
    assert.deepEqual(vus.get('/donnees/info.txt'), { statut: 200, texte: 'INFO PUBLIQUE' })
    assert.doesNotMatch(html, /(env|cfg|key|rsa|pkg|srv|json)-secret/, 'aucun secret du projet dans le HTML rendu')
  })

  it('dossier de sortie dédié : un segment caché du chemin répond 404, comme sous `mjs serve` ; le reste du dossier est servi', async function () {
    if (!chromiumReady) { this.skip(); return }
    this.timeout(90000)
    const root = mjsTmp('render-browser-caches')
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'out', '.cache'), { recursive: true })
    writeFileSync(join(root, 'out', '.mjs-cache.json'), '{"cache":"secret-cache"}')
    writeFileSync(join(root, 'out', '.cache', 'notes.txt'), 'secret-notes')
    writeFileSync(join(root, 'out', 'donnees.txt'), 'DONNEE')
    writeFileSync(join(root, 'src', 'lecture.mjs'), lecture(['/.mjs-cache.json', '/.cache/notes.txt', '/donnees.txt']))
    const { html, vus } = await lire({ sourceDir: 'src', outputDir: 'out', render: { browserPool: { size: 1 } } }, root)
    assert.equal(vus.get('/.mjs-cache.json')?.statut, 404)
    assert.equal(vus.get('/.cache/notes.txt')?.statut, 404)
    assert.deepEqual(vus.get('/donnees.txt'), { statut: 200, texte: 'DONNEE' })
    assert.doesNotMatch(html, /secret-(cache|notes)/)
  })
})
