// heatmapPackage({ file }) relit un fichier au démarrage : ses adresses sont revalidées comme celles d'un point qui
// arrive. La page d'admin charge chaque adresse dans un cadre (`src`) : une adresse qui n'est pas http(s) —
// `javascript:`, `data:`… — n'y arrive jamais, même par un fichier modifié ou venu d'ailleurs. Les pages aux adresses
// refusées sont écartées (le journal le dit), les autres sont relues, le fichier n'est pas mis de côté. L'origine d'une page
// relue doit être dans `origins`, comme à la réception.

import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { heatmapPackage, renderHeatmapPage } from '../src/mjs-ws/heatmap.js'
import { mjsTmp } from './helpers/tmp.js'

const SITE = 'https://monsite.fr'

// une page du fichier : `n` points au hasard, ses heures dans la dernière minute
function page(url: string, n: number) {
  const maintenant = Date.now()
  const pts: number[][] = []
  const ts: number[]    = []
  for (let i = 0; i < n; i++) { pts.push([i / 100, 0.5]); ts.push(maintenant - n + i) }
  return { url, n, zones: [{ zone: 'document', ev: 'click', n, w: 100, h: 100, pts, ts }] }
}

// le paquet sur une appli réduite à ce qu'il touche, le fichier déjà écrit
function relit(pages: unknown[]) {
  const dir  = mjsTmp('heatmap-relecture-adresses')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'carte.json')
  writeFileSync(file, JSON.stringify({ v: 1, pages }))
  const journal: Array<[string, string]> = []
  const app: any = { on() {}, stop: async () => {} }
  const pkg: any = heatmapPackage({ origins: [SITE], file, onLog: (niveau: string, message: string) => journal.push([niveau, message]) })
  pkg.installer(app)
  return { app, dir, journal, urls: () => (app.heatmap().pages as Array<{ url: string }>).map((p) => p.url).sort() }
}

describe('heatmapPackage — un fichier relu : les adresses sont revalidées', () => {
  it('une adresse qui n\'est pas http(s) est écartée : javascript:, data:, ftp:, protocole relatif, chemin relatif', () => {
    const { urls, journal, dir } = relit([
      page('javascript:alert(document.domain)', 5),
      page('data:text/html,<script>alert(1)</script>', 4),
      page('ftp://monsite.fr/x', 3),
      page('//evil.example/x', 2),
      page('/relatif', 2),
      page(SITE + '/ok', 6),
      page('http://localhost:3000/dev', 3)
    ])
    // `http://localhost:3000` est une adresse http, mais son origine n'est pas dans `origins` : écartée aussi (cf. mjs-ws-heatmap-adresse-forgee-et-relecture.test.ts)
    assert.deepEqual(urls(), [SITE + '/ok'])
    assert.ok(journal.some(([niveau, message]) => niveau === 'warn' && /: 5 — leur adresse/.test(message)), 'le journal dit combien de pages sont écartées : ' + JSON.stringify(journal))
    assert.ok(journal.some(([, message]) => /6 points relus/.test(message)), 'seuls les points des pages gardées sont comptés : ' + JSON.stringify(journal))
    assert.deepEqual(readdirSync(dir), ['carte.json'], 'le fichier n\'est pas mis de côté')
  })

  it('la page d\'admin ne contient aucune adresse hostile', () => {
    const { app } = relit([page('javascript:alert(document.domain)', 3), page(SITE + '/ok', 2)])
    const html = renderHeatmapPage(app.heatmap())
    assert.ok(!/javascript:/i.test(html), 'aucun javascript: dans la page d\'admin')
    assert.ok(html.includes(SITE + '/ok'))
  })

  it('un fichier aux adresses toutes bonnes se relit en entier', () => {
    const { urls, journal } = relit([page(SITE + '/a', 3), page(SITE + '/b/c', 2)])
    assert.deepEqual(urls(), [SITE + '/a', SITE + '/b/c'])
    assert.ok(!journal.some(([niveau]) => niveau === 'warn'), 'rien à signaler : ' + JSON.stringify(journal))
  })

  it('un fichier dont une valeur est hors de sa forme reste illisible, adresses bonnes ou non', () => {
    const { urls, journal, dir } = relit([page(SITE + '/ok', 3), { url: SITE + '/mauvais', zones: 'pas une liste' }])
    assert.deepEqual(urls(), [])
    assert.ok(journal.some(([niveau, message]) => niveau === 'error' && /illisible/.test(message)), JSON.stringify(journal))
    assert.ok(readdirSync(dir).some((f) => f.startsWith('carte.json.bad-')), 'mis de côté')
  })
})
