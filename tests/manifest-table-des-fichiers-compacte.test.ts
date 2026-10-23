// table des fichiers du manifeste (`µPaths`) — forme COMPACTE des valeurs en production.
//
// Mesuré sur le build de production du site : 1 830 entrées, 103 Ko bruts, 24,3 Ko compressés.
// Chaque valeur répétait le nom du composant, déjà présent dans la clé, puis l'empreinte et `.js`
// (`"about":"about-207681d6.js"`). Sur ce site, 1 155 valeurs sont exactement `<clé>-<empreinte>.js`
// et 675 portent un préfixe de dossier devant la clé (`"ajax-csrf":"tuto-ajax-csrf-eeaa76e7.js"`).
//
// La règle d'écriture, en production et au-dessus d'un seuil d'entrées seulement :
//   - une valeur SANS point est compacte : ses 5 derniers caractères sont l'empreinte, ce qui
//     précède (souvent rien) est le préfixe de dossier ; le fichier est `<préfixe><clé>-<empreinte>.js` ;
//   - une valeur AVEC point est un nom de fichier entier, lu tel quel (fichier de groupe, de page,
//     alias dont le fichier ne porte pas la clé). Tout fichier se termine par `.js` : le point
//     est le marqueur, il ne peut pas apparaître dans une empreinte ni dans un préfixe (l'écriture
//     refuse alors la forme compacte).
// En développement, et sous le seuil, la table reste entière et lisible. Aucun fichier n'est renommé,
// aucune empreinte n'est raccourcie : le cache des visiteurs n'est pas touché.
//
// Ce que ce fichier garde : la forme de chaque famille d'entrée dans un build réel, que CHAQUE entrée
// se décode vers un fichier qui existe sur le disque, les noms pièges (point dans la clé, chiffre
// final, clé qui ressemble à une empreinte, deux composants de même nom), le seuil de petite appli,
// et le décodeur du manifeste lui-même (évalué sur la table réelle). Le comportement dans un vrai
// navigateur : manifest-table-des-fichiers-compacte-browser.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Window } from 'happy-dom'
import { mjsTmp } from './helpers/tmp.js'
import * as bundlerModule from '../src/bundler/index.js'

const { Bundler, terminateSharedWorkerPool } = bundlerModule

interface Projet { root: string; srcDir: string; outDir: string }

/** Règle de lecture, écrite ici à part du code qui l'applique : le contrat vu d'un lecteur. */
function decoder(cle: string, valeur: string): string {
  return valeur.includes('.') ? valeur : `${valeur.slice(0, -5)}${cle}-${valeur.slice(-5)}.js`
}

function projet(prefixe: string, fichiers: Record<string, string>): Projet {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  for (const [rel, contenu] of Object.entries(fichiers)) {
    const complet = join(srcDir, rel)
    mkdirSync(dirname(complet), { recursive: true })
    writeFileSync(complet, contenu)
  }
  return { root, srcDir, outDir: join(root, 'out') }
}

/** N petits composants sans lien entre eux : de quoi passer le seuil d'une grosse appli. */
function remplissage(n: number): Record<string, string> {
  const r: Record<string, string> = {}
  for (let i = 1; i <= n; i++) r[`fiche-${String(i).padStart(3, '0')}.mjs`] = `<p>fiche ${i}</p>\n`
  return r
}

const PIEGES: Record<string, string> = {
  'carte.mjs':                  '@import marque \'outils.module.civet\'\n\n<p class="carte">{marque}</p>\n<mjs-puce></mjs-puce>\n',
  'puce.mjs':                   '<i>puce</i>\n',
  'outils.module.civet':        'export marque := \'outils\'\n',
  'v2.mjs':                     '<p>v2</p>\n',
  'deadbeef.mjs':               '<p>ressemble à une empreinte</p>\n',
  'tuto/tuto-ajax.mjs':         '<p>tuto ajax</p>\n',
  'doc/doc-intro.mjs':          '<p>intro de la doc</p>\n',
  'tuto/tuto-intro.mjs':        '<p>intro du tuto</p>\n',
  'ateliers/lecteur.mjs':       '<p>lecteur de l\'atelier</p>\n',
  'cours/lecteur.mjs':          '<p>lecteur du cours</p>\n',
  'onglet.mjs':                 '<h2>onglet</h2>\n<mjs-carte></mjs-carte>\n'
}

async function construire(p: Projet, env: 'dev' | 'prod', extra: Record<string, unknown> = {}) {
  const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: join(p.outDir, 'bundle.js'), urlPrefix: '/out', env, ...extra } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return stats
}

function table(p: Projet): Record<string, string> {
  return JSON.parse(/^const µPaths = (\{.*\});$/m.exec(readFileSync(join(p.outDir, 'bundle.js'), 'utf-8'))![1])
}

const EMPREINTE = /^[0-9a-z]{5}$/

describe('table des fichiers du manifeste — forme compacte en production', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le seuil existe et reste modeste (une grosse appli y gagne, une petite n\'y perd rien)', () => {
    const seuil = (bundlerModule as any).PATHS_ENCODE_MIN_ENTRIES
    assert.equal(typeof seuil, 'number', 'le bundler publie le nombre d\'entrées à partir duquel la table se compacte')
    assert.ok(seuil >= 8 && seuil <= 60, `seuil raisonnable, reçu : ${seuil}`)
  })

  describe('production, au-dessus du seuil', () => {
    let p: Projet
    let t: Record<string, string>
    before(async () => {
      p = projet('table-compacte', { ...remplissage(70), ...PIEGES })
      await construire(p, 'prod', { bundles: { onglet: ['onglet'] } })
      t = table(p)
    })

    it('composant simple : la valeur est l\'empreinte seule', () => {
      assert.match(t['fiche-001'], EMPREINTE, `reçu : ${t['fiche-001']}`)
      assert.match(t['lecteur'], EMPREINTE, `reçu : ${t['lecteur']}`)
    })

    it('composant d\'un dossier : la clé courte (alias) porte le préfixe du dossier avant l\'empreinte', () => {
      assert.match(t['tuto-ajax'], EMPREINTE, 'la clé entière du composant : empreinte seule')
      assert.match(t['ajax'], /^tuto-[0-9a-z]{5}$/, `alias court : préfixe + empreinte, reçu : ${t['ajax']}`)
      assert.equal(decoder('ajax', t['ajax']), decoder('tuto-ajax', t['tuto-ajax']), 'les deux clés mènent au même fichier')
    })

    it('module : la clé contient un point, la valeur reste l\'empreinte seule', () => {
      assert.match(t['outils.module'], EMPREINTE, `reçu : ${t['outils.module']}`)
      assert.equal(decoder('outils.module', t['outils.module']).startsWith('outils.module-'), true)
    })

    it('fichier d\'effet : empreinte seule', () => {
      const clesFx = Object.keys(t).filter(k => k.startsWith('mjs_fx_'))
      for (const k of clesFx) assert.match(t[k], EMPREINTE, `${k} : ${t[k]}`)
    })

    it('fichier de groupe : la racine du groupe se compacte en préfixe + empreinte, les autres membres gardent le nom entier (avec son point)', () => {
      assert.match(t['onglet'], /^mjs_group-[0-9a-z]{5}$/, `racine : ${t['onglet']}`)
      for (const nom of ['carte', 'puce']) assert.match(t[nom], /^mjs_group-onglet-[0-9a-z]{5}\.js$/, `${nom} : ${t[nom]}`)
      const fichiers = ['onglet', 'carte', 'puce'].map(nom => decoder(nom, t[nom]))
      assert.equal(new Set(fichiers).size, 1, `les trois mènent au même fichier de groupe : ${fichiers.join(' ')}`)
    })

    it('nom piège : un chiffre final dans la clé', () => {
      assert.match(t['v2'], EMPREINTE)
      assert.equal(existsSync(join(p.outDir, decoder('v2', t['v2']))), true)
    })

    it('nom piège : une clé qui ressemble à une empreinte', () => {
      assert.match(t['deadbeef'], EMPREINTE)
      assert.equal(decoder('deadbeef', t['deadbeef']).startsWith('deadbeef-'), true)
      assert.equal(existsSync(join(p.outDir, decoder('deadbeef', t['deadbeef']))), true)
    })

    it('nom piège : deux composants de même nom dans deux dossiers (la clé disputée mène à un fichier réel)', () => {
      for (const cle of ['lecteur', 'intro']) {
        if (!(cle in t)) continue
        assert.equal(existsSync(join(p.outDir, decoder(cle, t[cle]))), true, `${cle} → ${decoder(cle, t[cle])}`)
      }
      assert.ok('lecteur' in t, 'la clé `lecteur` existe : un des deux composants gagne')
    })

    it('chaque entrée de la table se décode vers un fichier qui EXISTE sur le disque', () => {
      const cles = Object.keys(t)
      assert.ok(cles.length > 70, `table complète attendue, ${cles.length} entrées`)
      for (const cle of cles) {
        const fichier = decoder(cle, t[cle])
        assert.equal(existsSync(join(p.outDir, fichier)), true, `${cle} → ${t[cle]} → ${fichier} absent`)
      }
    })

    it('aucune valeur compacte ne contient de point, aucun nom entier ne perd son `.js`', () => {
      for (const [cle, v] of Object.entries(t)) {
        if (v.includes('.')) assert.match(v, /^[^/]+\.js$/, `${cle} : nom entier sans chemin, reçu ${v}`)
        else assert.ok(v.length >= 5 && /^[a-z0-9_-]+$/.test(v) && EMPREINTE.test(v.slice(-5)), `${cle} : forme compacte invalide ${v}`)
      }
    })

    it('la table pèse moins que sa forme entière (le gain est réel)', () => {
      const brut    = readFileSync(join(p.outDir, 'bundle.js'), 'utf-8')
      const entiere = JSON.stringify(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, decoder(k, v)])))
      const ligne   = /^const µPaths = (\{.*\});$/m.exec(brut)![1]
      assert.ok(ligne.length < entiere.length * 0.75, `${ligne.length} octets compacte contre ${entiere.length} entière`)
    })

    it('le manifeste porte UN décodeur partagé, posé sur µ pour le cœur', () => {
      const src = readFileSync(join(p.outDir, 'bundle.js'), 'utf-8')
      assert.match(src, /^const µPath = /m, 'le décodeur du manifeste')
      assert.match(src, /µ\.pathOf = µPath;/, 'le cœur lit les chemins par le même décodeur')
    })

    it('le décodeur du manifeste, évalué, rend le même chemin que la règle ci-dessus pour chaque entrée', () => {
      const src = readFileSync(join(p.outDir, 'bundle.js'), 'utf-8')
      const m   = /^const µPath = .*$/m.exec(src)!
      const µPaths = t
      const µPathsPrefix = '/out/'
      const µPath = new Function('µPaths', 'µPathsPrefix', `${m[0]}\nreturn µPath;`)(µPaths, µPathsPrefix)
      for (const [cle, v] of Object.entries(t)) assert.equal(µPath(cle), '/out/' + decoder(cle, v), cle)
      assert.equal(µPath('absent'), '', 'clé inconnue : chaîne vide, jamais d\'exception')
      assert.equal(µPath('constructor'), '', 'clé du prototype : chaîne vide')
    })

    it('le manifeste complet, évalué dans une fenêtre, précharge des liens vers des fichiers qui existent', () => {
      const src    = readFileSync(join(p.outDir, 'bundle.js'), 'utf-8')
      const window = new Window({ url: 'http://localhost/' })
      window.document.body.innerHTML = '<mjs-fiche-001></mjs-fiche-001><mjs-ajax></mjs-ajax>'
      window.eval(src)
      const hrefs = Array.from(window.document.head.querySelectorAll('link[rel="modulepreload"]')).map((l: any) => l.getAttribute('href') as string)
      assert.ok(hrefs.length >= 3, `liens attendus, vus : ${hrefs.join(' ')}`)
      for (const href of hrefs) {
        assert.match(href, /^\/out\/[^/]+\.js$/, `href entier : ${href}`)
        assert.equal(existsSync(join(p.outDir, href.slice('/out/'.length))), true, `${href} absent du disque`)
      }
      assert.ok(hrefs.some(h => /\/out\/tuto-ajax-[0-9a-z]{5}\.js$/.test(h)), 'l\'alias `ajax` précharge le fichier préfixé')
    })
  })

  describe('développement et petite appli : table entière, lisible', () => {
    it('développement, même grosse appli : chaque valeur est le nom de fichier entier', async () => {
      const p = projet('table-dev', { ...remplissage(70), ...PIEGES })
      await construire(p, 'dev')
      const t = table(p)
      assert.ok(Object.keys(t).length > 70)
      assert.match(t['fiche-001'], /^fiche-001-[0-9a-z]{5}\.js$/)
      assert.match(t['ajax'], /^tuto-ajax-[0-9a-z]{5}\.js$/)
      for (const v of Object.values(t)) assert.ok(v.includes('.'), `valeur entière attendue : ${v}`)
      assert.equal(/µPath = /.test(readFileSync(join(p.outDir, 'bundle.js'), 'utf-8')), false, 'aucun décodeur émis')
    })

    it('production, petite appli (3 composants) : table entière et aucun décodeur', async () => {
      const p = projet('table-petite', { 'a.mjs': '<mjs-b></mjs-b>\n', 'b.mjs': '<p>b</p>\n', 'c.mjs': '<p>c</p>\n' })
      await construire(p, 'prod')
      const src = readFileSync(join(p.outDir, 'bundle.js'), 'utf-8')
      const t   = table(p)
      assert.deepEqual(Object.keys(t).sort(), ['a', 'b', 'c'])
      for (const [k, v] of Object.entries(t)) assert.match(v, new RegExp(`^${k}-[0-9a-z]{5}\\.js$`))
      assert.equal(/µPath = |pathOf/.test(src), false, 'le décodeur ne coûte rien à une petite appli')
    })

    it('juste sous le seuil : table entière ; au seuil : table compacte', async () => {
      const seuil = (bundlerModule as any).PATHS_ENCODE_MIN_ENTRIES as number
      const sous  = projet('table-sous', remplissage(seuil - 1))
      await construire(sous, 'prod')
      assert.equal(Object.keys(table(sous)).length, seuil - 1)
      for (const v of Object.values(table(sous))) assert.ok(v.includes('.'), `sous le seuil : valeur entière, reçu ${v}`)
      const egal = projet('table-egal', remplissage(seuil))
      await construire(egal, 'prod')
      assert.equal(Object.keys(table(egal)).length, seuil)
      for (const v of Object.values(table(egal))) assert.match(v, EMPREINTE, 'au seuil : forme compacte')
    })
  })
})
