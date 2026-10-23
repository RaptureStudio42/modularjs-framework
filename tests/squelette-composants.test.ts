// Squelette d'un composant dont le code arrive : sa balise montre la silhouette de son HTML en
// attendant. Pas par défaut — la clé `"effects": { "skeleton": [..., "components"] }` de
// mjs.config.json l'active pour tous ; sinon `*skeleton` écrit sur la balise du composant, pour
// lui seul. Le build tire la silhouette du gabarit (skeletonHtml) et la range au manifeste
// (`µ._skels`) ; la page la pose dans la balise encore inconnue, et `µ._def` la retire juste
// avant d'enregistrer le composant (jamais visible à côté de son vrai rendu).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { skeletonHtml } from '../src/parser/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

async function construire(etiquette: string, fichiers: Record<string, string>, effects?: any) {
  const root   = mjsTmp('squelette-composants-' + etiquette)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...(effects ? { effects } : {}) })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  return { root, outDir, manifeste: readFileSync(join(root, 'bundle.js'), 'utf-8') }
}

const CARTE  = '<article class="carte"><h3 class="nom">{$nom}</h3><p class="bio">{$bio}</p><img class="photo" src={$photo} alt=""></article>'
const PAGE   = '<@carte *skeleton></@carte>'

describe('squelette d\'un composant dont le code arrive', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('skeletonHtml : la silhouette d\'un gabarit — les balises et leurs classes, une barre par texte, l\'image gardée en boîte', () => {
    assert.equal(skeletonHtml(CARTE), '<article class="carte"><h3 class="nom"><i mjs-skel="title"></i></h3><p class="bio"><i mjs-skel="lines"><i mjs-skel="line"></i><i mjs-skel="line"></i><i mjs-skel="line"></i></i></p><img class="photo" mjs-skel="media"></article>')
  })

  it('le manifeste : rien par défaut ; `components` dans la config, chaque composant ; `*skeleton` sur une balise, ce composant seul', async () => {
    const rien = await construire('rien', { 'carte.mjs': CARTE, 'page.mjs': '<@carte></@carte>' })
    assert.doesNotMatch(rien.manifeste, /_skels/)
    const tous = await construire('tous', { 'carte.mjs': CARTE, 'page.mjs': '<@carte></@carte>' }, { skeleton: ['await', 'components'] })
    const t = /µ\._skels = (\{[\s\S]*?\});/.exec(tous.manifeste)
    assert.ok(t, 'µ._skels au manifeste')
    assert.deepEqual(Object.keys(JSON.parse(t![1])).sort(), ['carte', 'page'])
    const un = await construire('un', { 'carte.mjs': CARTE, 'page.mjs': PAGE, 'autre.mjs': '<p>{$x}</p>' })
    const u = /µ\._skels = (\{[\s\S]*?\});/.exec(un.manifeste)
    assert.ok(u, 'µ._skels au manifeste')
    assert.deepEqual(Object.keys(JSON.parse(u![1])), ['carte'])
  })

  it('le manifeste ne pose aucun nom en _mjs_ : le cœur minifié les raccourcit, pas le manifeste (la silhouette resterait muette en production)', async () => {
    const tous = await construire('noms', { 'carte.mjs': CARTE, 'page.mjs': '<@carte></@carte>' }, { skeleton: ['await', 'components'] })
    // la table des messages cite des noms internes dans ses TEXTES (« µ._mjs_storeWatch : callback en erreur. ») : ce n'est pas du code
    const code = tous.manifeste.replace(/µ\._runtimeLabels = \{.*\};/, '')
    assert.notEqual(code, tous.manifeste, 'la ligne de la table des libellés est bien reconnue')
    assert.deepEqual(code.match(/µ\._mjs_\w+/g) ?? [], [])
  })

  it('à la page : la balise encore inconnue montre sa silhouette ; elle part AVANT que le composant ne s\'enregistre', async () => {
    const { outDir, manifeste } = await construire('page', { 'carte.mjs': CARTE, 'page.mjs': PAGE })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = stripEsm(readFileSync(join(outDir, files.find((f) => /^mjs_core-/.test(f))!), 'utf-8'))
    const skels = /µ\._skels = (\{[\s\S]*?\});/.exec(manifeste)![1]
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`${coeur}\nglobalThis.µ = µ; µ._skels = ${skels};`)
    const doc = window.document
    doc.body.innerHTML = '<mjs-carte></mjs-carte>'
    const el = doc.querySelector('mjs-carte')
    const zone = window.µ._mjs_skelShow(el)
    assert.ok(zone && el.querySelector('[mjs-skel-zone] h3.nom > i[mjs-skel="title"]'), 'la silhouette dans la balise')
    const bouclier = [...window.µ._mjs_shield.cssRules][0].selectorText
    assert.equal(doc.createElement('mjs-inconnu').matches(bouclier), true, 'une balise encore inconnue est cachée par le bouclier du cœur')
    assert.equal(el.matches(bouclier), false, 'celle qui montre sa silhouette, non')
    let vuAuMontage: any = 'non vu'
    class Carte extends window.HTMLElement { connectedCallback() { vuAuMontage = this.querySelector('[mjs-skel-zone]') } }
    window.µ._def('mjs-carte', Carte)
    assertAbsent(vuAuMontage, 'plus de silhouette quand le composant se monte')
    assert.equal(el.hasAttribute('mjs-skel-host'), false, 'ni sa marque')
    window.close()
  })
})
