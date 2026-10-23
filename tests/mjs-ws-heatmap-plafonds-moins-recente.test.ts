// heatmapPackage — au-delà de `maxPages` ou de `maxZones`, la page (ou la zone de la page) la moins récente part pour faire place
// à la nouvelle : un script qui remplit la carte d'adresses ou de zones inventées ne fige plus les vraies pages jusqu'à l'âge
// limite des points (7 jours par défaut) — elles reviennent dès qu'on les visite. La moins récente : celle dont le dernier point
// est le plus ancien, relue d'un fichier comprise (pas la moins fréquentée). Le débit : un seau par connexion, comme avant, et un
// seau par adresse (une IPv6 compte pour son préfixe /56), que se partagent toutes les connexions de l'adresse — 100 connexions
// d'une même adresse ne multiplient plus le débit par 100.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { heatmapPackage } from '../src/mjs-ws/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SITE  = 'https://monsite.fr'
const point = (url: string, zones: any[] = [['document', 0.5, 0.5, 100, 100]]) => ({ url, ev: 'click', z: zones })

// le paquet sur une appli réduite à ce qu'il touche : les trames s'y jouent sans réseau, une connexion par nom
function monte(opts: any = {}) {
  const handlers: Record<string, (p: unknown, c: unknown) => void> = {}
  const app: any = { on(type: string, h: (p: unknown, c: unknown) => void) { handlers[type] = h }, stop: async () => {} }
  const pkg: any = heatmapPackage({ origins: [SITE], onLog: () => {}, ...opts })
  pkg.installer(app)
  const clients = new Map<string, any>()
  const recoit = (p: unknown, qui = 'v', address?: string) => {
    if (!clients.has(qui)) clients.set(qui, { meta: { origin: SITE, address } })
    handlers['heatmap:point'](p, clients.get(qui))
  }
  const carte = () => app.heatmap() as { pages: Array<{ url: string, n: number, zones: Array<{ zone: string, n: number }> }> }
  const urls  = () => carte().pages.map(p => p.url).sort()
  const total = () => carte().pages.reduce((n, p) => n + p.zones.reduce((m, z) => m + z.n, 0), 0)
  return { app, recoit, carte, urls, total }
}

describe('heatmapPackage — aux plafonds, la moins récente part', () => {
  it('au-delà de maxPages : la page dont le dernier point est le plus ancien part, la nouvelle est prise', () => {
    let horloge = 1_000_000
    const { recoit, urls, total } = monte({ maxPages: 3, now: () => ++horloge })
    recoit(point(SITE + '/a'))
    recoit(point(SITE + '/b'))
    recoit(point(SITE + '/c'))
    // /a revient : /b devient la moins récente
    recoit(point(SITE + '/a'))
    recoit(point(SITE + '/d'))
    assert.deepEqual(urls(), [SITE + '/a', SITE + '/c', SITE + '/d'])
    assert.equal(total(), 4, 'les points de la page partie partent avec elle')
  })

  it('un script qui remplit la carte d\'adresses inventées ne fige plus une vraie page', () => {
    let horloge = 1_000_000
    const { recoit, urls } = monte({ maxPages: 10, now: () => ++horloge })
    for (let i = 0; i < 10; i++) recoit(point(SITE + '/invente-' + i), 'script')
    recoit(point(SITE + '/vraie-page'), 'visiteur')
    assert.ok(urls().includes(SITE + '/vraie-page'), 'la vraie page est prise : ' + urls().join(' '))
    assert.equal(urls().length, 10)
  })

  it('au-delà de maxZones : la zone la moins récente de la page part, la nouvelle est prise', () => {
    let horloge = 1_000_000
    const { recoit, carte } = monte({ maxZones: 2, now: () => ++horloge })
    recoit(point(SITE + '/p', [['document', 0.5, 0.5, 100, 100], ['mjs-a', 0.5, 0.5, 10, 10]]))
    recoit(point(SITE + '/p', [['document', 0.5, 0.5, 100, 100], ['mjs-b', 0.5, 0.5, 10, 10]]))
    assert.deepEqual(carte().pages[0].zones.map(z => z.zone).sort(), ['document', 'mjs-b'])
  })

  it('relue d\'un fichier : la moins récente est celle dont le dernier point est le plus ancien, pas la moins fréquentée', async () => {
    const dir = mjsTmp('heatmap-plafond-moins-recente')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'carte.json')
    const t0   = 2_000_000_000_000
    // le fichier range les plus fréquentées d'abord : /frequente (3 points, récents), puis /ancienne (1 point, ancien)
    writeFileSync(file, JSON.stringify({ v: 1, pages: [
      { url: SITE + '/frequente', n: 3, zones: [{ zone: 'document', ev: 'click', n: 3, w: 100, h: 100, pts: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]], ts: [t0 - 30, t0 - 20, t0 - 10] }] },
      { url: SITE + '/ancienne', n: 1, zones: [{ zone: 'document', ev: 'click', n: 1, w: 100, h: 100, pts: [[0.5, 0.5]], ts: [t0 - 3000] }] }
    ] }))
    let horloge = t0
    const { app, recoit, urls } = monte({ file, maxPages: 2, saveEvery: 3_600_000, now: () => ++horloge })
    try {
      assert.deepEqual(urls(), [SITE + '/ancienne', SITE + '/frequente'])
      recoit(point(SITE + '/nouvelle'))
      assert.deepEqual(urls(), [SITE + '/frequente', SITE + '/nouvelle'])
    }
    finally {
      // l'arrêt écrit le fichier une dernière fois et retire l'écriture de fin de processus : le dossier temporaire part au balai
      await app.stop()
    }
  })
})

describe('heatmapPackage — un seau de points par adresse', () => {
  it('100 connexions d\'une même adresse ne multiplient plus le débit par 100', () => {
    const { recoit, total } = monte({ maxPoints: 100_000 })
    const lot = { pts: Array.from({ length: 20 }, (_, i) => point(SITE + '/p' + (i % 5))) }
    for (let c = 0; c < 100; c++) recoit(lot, 'c' + c, '203.0.113.7')
    // le seau de l'adresse : une rafale de 200, 100 par seconde (quelques millisecondes de recharge pendant le test)
    assert.ok(total() >= 200 && total() <= 230, total() + ' points pris pour 2 000 envoyés')
  })

  it('une IPv6 compte pour son préfixe /56 ; une autre adresse a son propre seau ; sans adresse connue, le seau de la connexion seul', () => {
    const { recoit, total } = monte({ addressRateLimit: { rate: 0.001, burst: 30 } })
    const lot = { pts: Array.from({ length: 20 }, () => point(SITE + '/p')) }
    recoit(lot, 'a', '2001:db8:aa:bb01::1')
    recoit(lot, 'b', '2001:db8:aa:bb02::2')
    assert.equal(total(), 30, 'deux connexions du même /56 se partagent 30 points')
    recoit(lot, 'c', '2001:db8:aa:cc00::1')
    assert.equal(total(), 50, 'un autre /56 a son seau')
    recoit(lot, 'd')
    recoit(lot, 'e')
    assert.equal(total(), 90, 'une connexion sans adresse connue : son seau seul')
  })

  it('addressRateLimit: false — le seau de la connexion seul, comme avant', () => {
    const { recoit, total } = monte({ addressRateLimit: false })
    const lot = { pts: Array.from({ length: 20 }, () => point(SITE + '/p')) }
    for (let c = 0; c < 20; c++) recoit(lot, 'c' + c, '203.0.113.7')
    assert.equal(total(), 400)
  })
})

describe('heatmapPackage — addressRateLimit refuse une valeur absurde', () => {
  it('0, négatif, NaN, texte ou infini : heatmapPackage() lève une erreur qui nomme le réglage', () => {
    for (const mauvais of [{ rate: 0 }, { burst: -1 }, { rate: NaN }, { burst: '20' }, { rate: Infinity }]) {
      assert.throws(() => heatmapPackage({ origins: [SITE], addressRateLimit: mauvais as any }), /addressRateLimit\.(rate|burst)/, JSON.stringify(mauvais))
    }
  })
})
