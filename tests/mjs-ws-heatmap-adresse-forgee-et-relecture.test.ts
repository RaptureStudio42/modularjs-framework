// heatmapPackage({ file }) : la relecture du fichier ne se laisse pas faire par un seul point forgé, et applique les
// mêmes bornes que la réception.
//   - la limite de 2 000 caractères porte sur l'adresse GARDÉE (normalisée) : une adresse brute de 1 916 caractères non
//     ASCII en pèse 11 416 une fois encodée, et la relecture, qui refusait déjà plus de 2 000, mettait de côté TOUT le
//     fichier au redémarrage (une connexion anonyme qui falsifie son en-tête Origin suffisait) ;
//   - une page dont l'adresse est trop longue est écartée seule, le journal le dit, le fichier n'est pas mis de côté ;
//   - `origins`, `maxPages` et `maxZones` valent à la relecture comme à la réception : 3 000 pages sous un plafond de 1 000,
//     500 zones sous un plafond de 64, ou une origine qui n'est plus dans la liste, ne remplissent plus la mémoire.

import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { heatmapPackage, cleanPoint } from '../src/mjs-ws/heatmap.js'
import { mjsTmp } from './helpers/tmp.js'

const SITE = 'https://monsite.fr'
const point = (url: string) => ({ url, ev: 'click', z: [['document', 0.5, 0.5, 100, 100]] })

// une page du fichier : `n` points au hasard, ses heures dans la dernière minute, et `zones` zones
function page(url: string, n: number, zones = 1) {
  const maintenant = Date.now()
  const pts: number[][] = []
  const ts: number[]    = []
  for (let i = 0; i < n; i++) { pts.push([i / 100, 0.5]); ts.push(maintenant - n + i) }
  return { url, n, zones: Array.from({ length: zones }, (_, k) => ({ zone: k === 0 ? 'document' : 'zone' + k, ev: 'click', n, w: 100, h: 100, pts, ts })) }
}

// le paquet sur une appli réduite à ce qu'il touche (une trame se joue par `recoit`), le fichier à cet endroit
function demarre(file: string, opts: Record<string, unknown> = {}) {
  const journal: Array<[string, string]> = []
  const handlers: Record<string, (p: unknown, c: unknown) => void> = {}
  const app: any = { on(type: string, h: (p: unknown, c: unknown) => void) { handlers[type] = h }, stop: async () => {} }
  const pkg: any = heatmapPackage({ origins: [SITE], file, onLog: (niveau: string, message: string) => journal.push([niveau, message]), ...opts })
  pkg.installer(app)
  const recoit = (p: unknown) => handlers['heatmap:point'](p, { meta: { origin: SITE } })
  const urls = () => (app.heatmap().pages as Array<{ url: string }>).map((p) => p.url).sort()
  return { app, journal, recoit, urls, pkg }
}

// un dossier à soi, un fichier déjà écrit
function ecrit(pages: unknown[]) {
  const dir  = mjsTmp('heatmap-relecture-bornes')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'carte.json')
  writeFileSync(file, JSON.stringify({ v: 1, pages }))
  return { dir, file }
}

describe('heatmapPackage — un point forgé ne fait pas mettre de côté le fichier de sauvegarde', () => {
  it('6 pages et un point à l\'adresse de 1 916 caractères non ASCII (11 416 une fois normalisée) : l\'arrêt, le redémarrage, les 6 pages sont là', async () => {
    const dir  = mjsTmp('heatmap-adresse-forgee')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'carte.json')
    const a = demarre(file)
    for (let i = 0; i < 6; i++) a.recoit(point(SITE + '/page' + i))
    // un script qui falsifie l'en-tête Origin : une adresse brute sous la limite, démesurée une fois encodée
    a.recoit(point(SITE + '/' + 'é'.repeat(1900)))
    assert.equal(a.urls().length, 6, 'le point forgé n\'est pas pris à la réception')
    await a.app.stop()
    const b = demarre(file)
    assert.equal(b.urls().length, 6, '6 pages au redémarrage : ' + JSON.stringify(b.journal))
    assert.deepEqual(readdirSync(dir), ['carte.json'], 'le fichier n\'est pas mis de côté')
    assert.ok(!b.journal.some(([niveau]) => niveau === 'error'), JSON.stringify(b.journal))
  })

  it('la limite de 2 000 caractères porte sur l\'adresse gardée : refusée à la réception même quand l\'adresse brute est courte', () => {
    assert.equal(cleanPoint(point(SITE + '/' + 'é'.repeat(1900)), SITE), null, 'adresse brute de 1 916, 11 416 une fois normalisée')
    assert.equal(cleanPoint(point(SITE + '/' + 'é'.repeat(600)), SITE), null, 'adresse brute de 618, 3 618 une fois normalisée')
    assert.equal(cleanPoint(point(SITE + '/' + 'é'.repeat(300)), SITE)?.url.length, 1819, '1 819 caractères gardés : passe')
    // des segments de 15 lettres : un segment de 16 caractères ou plus serait masqué (`_SECRET_ID_`)
    assert.equal(cleanPoint(point(SITE + '/' + ('a'.repeat(15) + '/').repeat(119).slice(0, 1900)), SITE)?.url.length, 1919)
  })
})

describe('heatmapPackage — la relecture écarte une page fautive seule', () => {
  it('une page à l\'adresse de plus de 2 000 caractères : écartée, le journal le dit, les autres pages sont lues, le fichier reste', () => {
    const { file, dir } = ecrit([page(SITE + '/ok', 4), page(SITE + '/' + 'p'.repeat(2100), 3), page(SITE + '/aussi', 2)])
    const { urls, journal } = demarre(file)
    assert.deepEqual(urls(), [SITE + '/aussi', SITE + '/ok'])
    assert.ok(journal.some(([niveau, message]) => niveau === 'warn' && /: 1 — leur adresse/.test(message)), 'le journal dit une page écartée : ' + JSON.stringify(journal))
    assert.ok(journal.some(([, message]) => /6 points relus/.test(message)), 'seuls les points des pages gardées sont comptés : ' + JSON.stringify(journal))
    assert.ok(!journal.some(([niveau]) => niveau === 'error'), JSON.stringify(journal))
    assert.deepEqual(readdirSync(dir), ['carte.json'], 'le fichier n\'est pas mis de côté')
  })
})

describe('heatmapPackage — la relecture applique origins, maxPages et maxZones comme la réception', () => {
  it('une page d\'une origine qui n\'est pas dans `origins` est écartée, le journal le dit', () => {
    const { file } = ecrit([page(SITE + '/ok', 3), page('https://evil.example/phish', 5), page('http://localhost:3000/dev', 2), page(SITE + '/b', 1)])
    const { urls, journal } = demarre(file)
    assert.deepEqual(urls(), [SITE + '/b', SITE + '/ok'])
    assert.ok(journal.some(([niveau, message]) => niveau === 'warn' && /: 2 — leur origine n'est pas dans origins/.test(message)), 'le journal dit les deux pages d\'une autre origine : ' + JSON.stringify(journal))
    assert.ok(journal.some(([, message]) => /4 points relus/.test(message)), JSON.stringify(journal))
  })

  it('3 000 pages dans le fichier, maxPages à 1 000 : 1 000 pages chargées, les premières (les plus fréquentées), le journal le dit', () => {
    const pages = Array.from({ length: 3000 }, (_, i) => page(SITE + '/p' + i, 2))
    const { file } = ecrit(pages)
    const { urls, journal, app } = demarre(file, { maxPages: 1000 })
    assert.equal(urls().length, 1000, 'maxPages tient à la relecture')
    assert.ok(urls().includes(SITE + '/p0') && urls().includes(SITE + '/p999') && !urls().includes(SITE + '/p1000'), 'les premières pages du fichier')
    assert.ok(journal.some(([niveau, message]) => niveau === 'warn' && /2000 pages au-delà de maxPages \(1000\)/.test(message)), 'le journal dit les 2 000 pages écartées : ' + JSON.stringify(journal.slice(-3)))
    assert.ok(journal.some(([, message]) => /2000 points relus/.test(message)), 'seuls les points gardés sont comptés')
    // la mémoire reste bornée : une nouvelle page n'est pas prise
    assert.equal((app.heatmap().pages as unknown[]).length, 1000)
  })

  it('une page à 500 zones, maxZones à 64 : 64 zones chargées, le journal le dit', () => {
    const { file } = ecrit([page(SITE + '/zones', 2, 500)])
    const { app, journal } = demarre(file, { maxZones: 64 })
    const zones = (app.heatmap().pages as Array<{ zones: unknown[] }>)[0].zones
    assert.equal(zones.length, 64, 'maxZones tient à la relecture')
    assert.ok(journal.some(([niveau, message]) => niveau === 'warn' && /436 zones au-delà de maxZones \(64 par page\)/.test(message)), 'le journal dit les 436 zones écartées : ' + JSON.stringify(journal.slice(-3)))
    assert.ok(journal.some(([, message]) => /128 points relus/.test(message)), 'seuls les points gardés sont comptés : ' + JSON.stringify(journal))
  })

  it('un fichier dans les bornes se relit en entier, sans rien dire de plus', () => {
    const { file } = ecrit([page(SITE + '/a', 3), page(SITE + '/b', 2, 3)])
    const { urls, journal } = demarre(file)
    assert.deepEqual(urls(), [SITE + '/a', SITE + '/b'])
    assert.ok(!journal.some(([niveau]) => niveau === 'warn' || niveau === 'error'), JSON.stringify(journal))
  })
})
