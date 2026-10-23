// heatmapPackage — ce que le serveur accepte, et ce qu'il garde :
//   - `origins` (la liste blanche des origines de vos pages) est obligatoire : l'en-tête Origin se falsifie
//     par un script, et la page d'admin charge les adresses reçues dans un cadre — sans liste, le paquet
//     refuse de démarrer ; une trame d'une autre origine n'écrit rien ;
//   - `onPoint` reçoit tous les points, avant les plafonds de mémoire ;
//   - un plafond (maxPoints, maxPages, maxZones) à 0, négatif, NaN, texte ou infini est refusé, comme maxAge ;
//   - une trame porte un point (la forme d'avant) ou plusieurs (`pts`), le seau de débit en compte un par point ;
//   - l'adresse gardée perd ses jetons et ses e-mails (_SECRET_ID_) — la règle du navigateur (chaleur-masque-adresses.test.ts) ;
//   - un fichier relu qui dépasse maxPoints : les plus anciens partent.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { heatmapPackage } from '../src/mjs-ws/index.js'
import { cleanPoint } from '../src/mjs-ws/heatmap.js'
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
  // `origin` null : une connexion sans en-tête Origin
  const recoit = (p: unknown, origin: string | null = SITE, qui = 'v') => {
    const cle = qui + '|' + origin
    if (!clients.has(cle)) clients.set(cle, { meta: { origin: origin ?? undefined } })
    handlers['heatmap:point'](p, clients.get(cle))
  }
  const carte = () => app.heatmap() as { pages: Array<{ url: string, n: number, zones: Array<{ zone: string, ev: string, n: number, pts: number[][] }> }> }
  const total = () => carte().pages.reduce((n, p) => n + p.zones.reduce((m, z) => m + z.n, 0), 0)
  return { app, pkg, recoit, carte, total }
}

describe('heatmapPackage — les origines : une liste blanche obligatoire', () => {
  it('sans `origins`, le paquet refuse de démarrer, avec un message clair', () => {
    assert.throws(() => (heatmapPackage as any)(), /origins/)
    assert.throws(() => (heatmapPackage as any)({ maxAge: 3, unit: 'day' }), /origins.*https:\/\/monsite\.fr/s)
    assert.throws(() => heatmapPackage({ origins: [] }), /origins/)
  })

  it('une origine mal écrite est refusée : texte seul, adresse sans schéma, chemin, schéma inconnu, nombre', () => {
    for (const mauvais of ['https://monsite.fr', 'monsite.fr', ['monsite.fr'], ['https://monsite.fr/page'], ['https://monsite.fr?x=1'], ['ftp://monsite.fr'], [42], ['*']]) {
      assert.throws(() => heatmapPackage({ origins: mauvais as any }), /origins/, JSON.stringify(mauvais))
    }
  })

  it('une origine bien écrite passe : avec ou sans « / » final, avec un port, plusieurs', () => {
    assert.doesNotThrow(() => heatmapPackage({ origins: ['https://monsite.fr/', 'http://localhost:3000', 'https://www.monsite.fr'] }))
  })

  it('une trame d\'une autre origine n\'écrit rien : en-tête falsifié, adresse d\'une autre origine, majuscules, port', () => {
    const { recoit, carte } = monte()
    // l'en-tête Origin se falsifie par un script : l'adresse inventée est de la même origine, mais pas dans la liste
    recoit(point('https://evil.example/phish'), 'https://evil.example', 'pirate')
    // une page de monsite.fr qui annonce l'adresse d'un autre site
    recoit(point('https://evil.example/phish'), SITE, 'autre')
    recoit(point('https://monsite.fr/'), 'https://MONSITE.fr', 'majuscules')
    recoit(point('https://monsite.fr/'), 'https://monsite.fr:443', 'port')
    recoit(point('https://monsite.fr/'), null, 'sans-en-tete')
    assert.deepEqual(carte().pages, [])
    recoit(point('https://monsite.fr/tarifs'))
    assert.deepEqual(carte().pages.map((p) => p.url), ['https://monsite.fr/tarifs'])
  })

  it('plusieurs origines : chacune compte, pour ses propres adresses', () => {
    const { recoit, carte } = monte({ origins: [SITE, 'https://www.monsite.fr/'] })
    recoit(point('https://www.monsite.fr/a'), 'https://www.monsite.fr', 'www')
    recoit(point('https://monsite.fr/b'), SITE, 'nu')
    recoit(point('https://monsite.fr/c'), 'https://www.monsite.fr', 'croise')
    assert.deepEqual(carte().pages.map((p) => p.url).sort(), ['https://monsite.fr/b', 'https://www.monsite.fr/a'])
  })
})

describe('heatmapPackage — onPoint reçoit tous les points, avant les plafonds de mémoire', () => {
  it('au-delà de maxPages, de maxZones et de maxPoints, onPoint reçoit encore chaque point', () => {
    const vus: string[] = []
    // une horloge qui avance à chaque point : l'évincement sépare les points par leur heure, et deux points de la même
    // milliseconde ne se départagent pas (avec l'heure réelle, ce test dépendait de la vitesse de la machine)
    let horloge = 1_000_000
    const { recoit, carte, total } = monte({ maxPages: 1, maxZones: 1, maxPoints: 3, rateLimit: { rate: 1000, burst: 1000 }, now: () => ++horloge, onPoint: (p: any) => vus.push(p.url + ' ' + p.z.length) })
    recoit(point('https://monsite.fr/a'))
    recoit(point('https://monsite.fr/b'))
    recoit(point('https://monsite.fr/c'))
    recoit(point('https://monsite.fr/a', [['document', 0.1, 0.1, 100, 100], ['z1', 0.1, 0.1, 10, 10]]))
    for (let i = 0; i < 4; i++) recoit(point('https://monsite.fr/a'))
    assert.equal(vus.length, 8, 'onPoint : ' + JSON.stringify(vus))
    assert.deepEqual(carte().pages.map((p) => p.url), ['https://monsite.fr/a'], 'la mémoire reste bornée : une page')
    assert.ok(total() <= 3, 'trois points au plus en mémoire : ' + total())
  })
})

describe('heatmapPackage — les plafonds refusent une valeur absurde, comme maxAge', () => {
  for (const nom of ['maxPoints', 'maxPages', 'maxZones']) {
    it(`${nom} à 0, négatif, NaN, texte ou infini : refusé, le message nomme l'option`, () => {
      for (const mauvais of [0, -1, NaN, 'beaucoup', Infinity, {}, true]) {
        assert.throws(() => heatmapPackage({ origins: [SITE], [nom]: mauvais } as any), new RegExp(nom), `${nom}: ${String(mauvais)}`)
      }
    })

    it(`${nom} absent ou valide : accepté`, () => {
      assert.doesNotThrow(() => heatmapPackage({ origins: [SITE] }))
      assert.doesNotThrow(() => heatmapPackage({ origins: [SITE], [nom]: 5 } as any))
    })
  }
})

describe('heatmapPackage — une trame porte un point (la forme d\'avant) ou plusieurs (`pts`)', () => {
  it('un lot de trois points : les trois sont gardés ; la forme à un point marche toujours', () => {
    const { recoit, total } = monte()
    recoit({ pts: [point('https://monsite.fr/a'), point('https://monsite.fr/b'), point('https://monsite.fr/a')] })
    assert.equal(total(), 3)
    recoit(point('https://monsite.fr/c'))
    assert.equal(total(), 4)
  })

  it('une entrée invalide du lot est écartée, les autres sont gardées', () => {
    const { recoit, total } = monte()
    recoit({ pts: [point('https://monsite.fr/a'), null, 'x', { url: 'https://evil.example/', ev: 'click', z: [['document', 0.5, 0.5, 1, 1]] }, point('https://monsite.fr/b')] })
    assert.equal(total(), 2)
  })

  it('le seau de débit en compte un par point : un lot de 5 avec 3 jetons n\'en garde que 3', () => {
    const { recoit, total } = monte({ rateLimit: { rate: 0.001, burst: 3 } })
    recoit({ pts: Array.from({ length: 5 }, (_, i) => point('https://monsite.fr/p' + i)) })
    assert.equal(total(), 3)
  })

  it('un lot trop long est tronqué : 50 points au plus par trame', () => {
    const { recoit, total } = monte({ rateLimit: { rate: 1000, burst: 1000 } })
    recoit({ pts: Array.from({ length: 80 }, () => point('https://monsite.fr/a')) })
    assert.equal(total(), 50)
  })

  it('`pts` qui n\'est pas une liste : rien n\'est écrit', () => {
    const { recoit, total } = monte()
    recoit({ pts: 'beaucoup' })
    recoit({ pts: { length: 3 } })
    assert.equal(total(), 0)
  })
})

describe('heatmapPackage — l\'adresse gardée ne porte ni jeton ni identifiant', () => {
  const url = (u: string) => cleanPoint(point(u))?.url

  it('un UUID, un JWT, un e-mail, un jeton sans tiret de 16 caractères ou plus mêlant lettres et chiffres, un nombre de 6 chiffres et plus : le segment part remplacé par _SECRET_ID_', () => {
    assert.equal(url('https://site.fr/reset/AbCd1234EfGh5678'), 'https://site.fr/reset/_SECRET_ID_')
    assert.equal(url('https://site.fr/reset/0123456789abcdef0123456789abcdef'), 'https://site.fr/reset/_SECRET_ID_')
    assert.equal(url('https://site.fr/p/550e8400-e29b-41d4-a716-446655440000'), 'https://site.fr/p/_SECRET_ID_')
    assert.equal(url('https://site.fr/s/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVP'), 'https://site.fr/s/_SECRET_ID_')
    assert.equal(url('https://site.fr/unsubscribe/jean.dupont@example.com'), 'https://site.fr/unsubscribe/_SECRET_ID_')
    assert.equal(url('https://site.fr/orders/20261003'), 'https://site.fr/orders/_SECRET_ID_')
    assert.equal(url('https://site.fr/commande/123456/suivi'), 'https://site.fr/commande/_SECRET_ID_/suivi')
    assert.equal(url('https://site.fr/p/1234567890123456'), 'https://site.fr/p/_SECRET_ID_')
  })

  it('un slug à tirets, une date, une version, un numéro court restent en clair : la page garde son nom', () => {
    for (const chemin of ['/blog/top-10-des-meilleurs-outils', '/articles/comment-installer-php-8', '/produit/chaussures-running-nike-air-max-270', '/products/iphone-15-pro-max-256gb', '/docs/mjs-ws-4-5-la-carte-de-chaleur', '/produits/12', '/p/12345', '/p/abcd1234efgh567', '/v1.2.3/docs', '/']) {
      assert.equal(url('https://site.fr' + chemin), 'https://site.fr' + chemin, chemin)
    }
  })

  it('la route du routeur MJS : un jeton y part remplacé aussi ; un motif (#/reset/:jeton) part tel quel', () => {
    assert.equal(url('https://site.fr/#/reset/AbCd1234EfGh5678?x=1'), 'https://site.fr/#/reset/_SECRET_ID_')
    assert.equal(url('https://site.fr/#/reset/:jeton'), 'https://site.fr/#/reset/:jeton')
    assert.equal(url('https://site.fr/#/produits/12?tri=prix'), 'https://site.fr/#/produits/12')
  })
})

describe('heatmapPackage — un fichier relu qui dépasse maxPoints', () => {
  it('les plus anciens points partent à la relecture, les plus récents restent', () => {
    const dir  = mjsTmp('heatmap-relecture-plafond')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'carte.json')
    const n    = 100
    const pts: number[][] = []
    const ts: number[]    = []
    const maintenant = Date.now()
    for (let i = 0; i < n; i++) { pts.push([i / 1000, 0.5]); ts.push(maintenant - n + i) }
    writeFileSync(file, JSON.stringify({ v: 1, pages: [{ url: SITE + '/', n, zones: [{ zone: 'document', ev: 'click', n, w: 100, h: 100, pts, ts }] }] }))
    const { carte, total } = monte({ file, maxPoints: 50 })
    assert.ok(total() <= 50, 'cinquante points au plus : ' + total())
    assert.ok(total() > 0, 'des points restent')
    const z = carte().pages[0].zones[0]
    assert.equal(z.pts[z.pts.length - 1][0], 0.099, 'le plus récent est gardé')
    assert.ok(z.pts[0][0] >= 0.05, 'le plus ancien est parti : ' + z.pts[0][0])
  })
})
