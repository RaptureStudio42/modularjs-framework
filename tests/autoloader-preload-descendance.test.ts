// `µ.Autoloader.preload(nom)` — charger d'avance un composant ET toute sa descendance.
//
// Le besoin : une page à onglets dont chaque onglet est un composant « coquille » contenant des dizaines
// de cartes. `µ.Autoloader.load(nom)` au survol d'un onglet ne charge que la coquille ; ses cartes
// n'arrivent qu'au clic, une à une (369 fichiers servis pour la page). `preload` pose, sans rien
// exécuter, un lien `modulepreload` pour le fichier du composant et pour ceux de toute sa descendance
// (table des dépendances du manifeste, fichiers d'effets compris) : le clic trouve tout en cache.
//
// La fonction vit dans le manifeste, SEULEMENT quand le build voit l'appel dans un composant ou un
// module du projet : une appli qui n'appelle jamais `preload` ne paie pas un octet. Elle lit la table
// des chemins compacte (préfixe factorisé), accepte le nom avec ou sans `mjs-` comme `load`, ne
// redemande aucun fichier (déjà demandé, déjà présent en lien dans la page, composant déjà défini) et
// ne fait rien, sans exception, pour un nom inconnu.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const BASE: Record<string, string> = {
  'partage.module.civet': 'export marque := \'valeur-du-module-partage\'\n',
  'puce.mjs':             '<i class="puce">puce</i>\n',
  'carte-a.mjs':          '@import marque \'partage.module.civet\'\n\n<p class="a" *glitch>{marque}</p>\n<mjs-puce></mjs-puce>\n',
  'carte-b.mjs':          '<p class="b">b</p>\n<mjs-puce></mjs-puce>\n',
  'onglet.mjs':           '<h2 class="o">onglet</h2>\n<mjs-carte-a></mjs-carte-a>\n<mjs-carte-b></mjs-carte-b>\n',
  'libre.mjs':            '<p class="l">libre</p>\n',
}

const APPELANT = '<script>\n@chauffer = -> µ.Autoloader.preload(\'onglet\')\n</script>\n<button class="s" @mouseover=@chauffer>survol</button>\n'

async function construire(etiquette: string, extra: Record<string, string>, opts: Record<string, unknown> = {}) {
  const root   = mjsTmp('preload-' + etiquette)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries({ ...BASE, ...extra })) writeFileSync(join(srcDir, nom), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', ...opts } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  return { manifeste: readFileSync(join(outDir, 'bundle.js'), 'utf-8') }
}

// la page : le prologue SYNCHRONE du manifeste (tout ce qui précède l'import du cœur, que happy-dom ne sait
// pas résoudre) est évalué dans un document ; `preload` en sort tel que le cœur le recevra (`µ.Autoloader.preload`)
function page(manifeste: string, corps = '') {
  const window: any = new Window({ url: 'http://localhost/' })
  window.document.body.innerHTML = corps
  const prologue = manifeste.slice(0, manifeste.indexOf('const µReady'))
  window.eval(stripEsm(prologue) + '\nwindow.__preload = typeof µPreload === \'function\' ? µPreload : null;')
  const liens = (): string[] => [...window.document.head.querySelectorAll('link[rel="modulepreload"]')].map((l: any) => l.getAttribute('href'))
  return { window, preload: window.__preload as ((nom: any) => void) | null, liens }
}

const SUIVIS = [/\/out\/onglet-[0-9a-z]{5}\.js$/, /\/out\/carte-a-[0-9a-z]{5}\.js$/, /\/out\/carte-b-[0-9a-z]{5}\.js$/, /\/out\/puce-[0-9a-z]{5}\.js$/, /\/out\/partage\.module-[0-9a-z]{5}\.js$/, /\/out\/mjs_fx_glitch-[0-9a-z]{5}\.js$/]

describe('µ.Autoloader.preload — le composant et toute sa descendance', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le build voit l\'appel : le manifeste porte la fonction et la pose sur µ.Autoloader', async () => {
    const { manifeste } = await construire('fonction', { 'appelant.mjs': APPELANT })
    assert.match(manifeste, /const µPreload = /)
    assert.match(manifeste, /µ\.Autoloader\.preload = µPreload;/)
  })

  it('aucun appel dans le projet : le manifeste ne porte rien de la fonction (rien à payer)', async () => {
    const { manifeste } = await construire('sans-appel', {})
    assert.equal(manifeste.includes('µPreload'), false)
    assert.equal(manifeste.includes('µAsked'), false)
    assert.equal(manifeste.includes('Autoloader.preload'), false)
  })

  it('un nom qui ressemble à l\'appel sans en être un ne le déclenche pas', async () => {
    const { manifeste } = await construire('faux-ami', { 'prose.mjs': '<p>préchargez avec preload(\'onglet\')</p>\n<script>\n@preload = -> 1\n</script>\n' })
    assert.equal(manifeste.includes('µPreload'), false)
  })

  it('preload(\'onglet\') pose un lien pour l\'onglet, ses cartes, la puce, le module et le fichier d\'effet', async () => {
    const { manifeste } = await construire('descendance', { 'appelant.mjs': APPELANT })
    const { preload, liens } = page(manifeste)
    assert.ok(preload, 'µPreload est définie dans le prologue')
    const avant = liens()
    preload!('onglet')
    const poses = liens().filter(h => !avant.includes(h))
    for (const re of SUIVIS) assert.equal(poses.filter(h => re.test(h)).length, 1, `un lien attendu pour ${re}, posés : ${poses.join(' ')}`)
    assert.equal(poses.length, SUIVIS.length, `rien d'autre que la descendance : ${poses.join(' ')}`)
    assert.equal(poses.some(h => /libre-/.test(h)), false, 'un composant hors de la descendance n\'est pas touché')
  })

  it('les chemins compacts de la table sont recollés au préfixe : chaque lien est un chemin entier', async () => {
    const { manifeste } = await construire('compact', { 'appelant.mjs': APPELANT })
    assert.match(manifeste, /const µPathsPrefix = "\/out\/";/, 'la table est compacte dans ce build')
    const { preload, liens } = page(manifeste)
    preload!('onglet')
    assert.ok(liens().filter(h => /^\/out\/puce-/.test(h)).length === 1, `lien entier attendu, vus : ${liens().join(' ')}`)
    assert.equal(liens().some(h => /^puce-/.test(h)), false, 'jamais un suffixe nu')
  })

  it('le nom s\'écrit avec ou sans mjs-, en majuscules ou non, comme pour load', async () => {
    const { manifeste } = await construire('noms', { 'appelant.mjs': APPELANT })
    const a = page(manifeste); a.preload!('onglet')
    const b = page(manifeste); b.preload!('mjs-onglet')
    const c = page(manifeste); c.preload!('MJS-Onglet')
    assert.deepEqual(b.liens(), a.liens())
    assert.deepEqual(c.liens(), a.liens())
  })

  it('sans doublon : un second appel ne repose rien', async () => {
    const { manifeste } = await construire('doublon', { 'appelant.mjs': APPELANT })
    const { preload, liens } = page(manifeste)
    preload!('onglet')
    const apres = liens()
    preload!('onglet')
    preload!('carte-a')
    assert.deepEqual(liens(), apres)
    assert.equal(new Set(liens()).size, liens().length, 'aucun lien en double')
  })

  it('un fichier déjà annoncé par un lien de la page (en-tête de page prérendue) n\'est pas redemandé', async () => {
    const { manifeste } = await construire('deja-lie', { 'appelant.mjs': APPELANT })
    const { window, preload, liens } = page(manifeste)
    const puce = JSON.parse(/const µPaths = (\{.*\});/.exec(manifeste)![1])['puce']
    const lien = window.document.createElement('link')
    lien.rel = 'modulepreload'
    lien.href = `/out/${puce}`
    window.document.head.appendChild(lien)
    preload!('onglet')
    assert.equal(liens().filter(h => h === `/out/${puce}`).length, 1)
  })

  it('un composant déjà défini n\'est pas redemandé, sa descendance l\'est', async () => {
    const { manifeste } = await construire('deja-defini', { 'appelant.mjs': APPELANT })
    const { window, preload, liens } = page(manifeste)
    window.customElements.define('mjs-onglet', class extends window.HTMLElement {})
    const avant = liens()
    preload!('onglet')
    const poses = liens().filter(h => !avant.includes(h))
    assert.equal(poses.some(h => /\/onglet-/.test(h)), false, 'l\'onglet est déjà là')
    assert.equal(poses.some(h => /\/carte-a-/.test(h)), true, 'ses cartes ne le sont pas')
  })

  it('un nom inconnu, vide ou qui n\'est pas une chaîne : rien ne se passe, aucune exception', async () => {
    const { manifeste } = await construire('inconnu', { 'appelant.mjs': APPELANT })
    const { preload, liens } = page(manifeste)
    const avant = liens()
    for (const nom of ['fantome', '', undefined, null, 42, {}, 'constructor', '__proto__', 'mjs-']) assert.doesNotThrow(() => preload!(nom), `nom ${String(nom)}`)
    assert.deepEqual(liens(), avant)
  })

  it('avec un groupe de fichiers : un seul lien pour tout l\'onglet, plus le module et le fichier d\'effet', async () => {
    const { manifeste } = await construire('groupe', { 'appelant.mjs': APPELANT }, { bundles: { onglet: ['onglet'] } })
    const { preload, liens } = page(manifeste)
    const avant = liens()
    preload!('onglet')
    const poses = liens().filter(h => !avant.includes(h))
    assert.equal(poses.filter(h => /\/mjs_group-onglet-[0-9a-z]{5}\.js$/.test(h)).length, 1, `un lien de groupe : ${poses.join(' ')}`)
    assert.equal(poses.filter(h => /\/(onglet|carte-a|carte-b|puce)-[0-9a-z]{5}\.js$/.test(h)).length, 0, 'aucun fichier séparé')
    assert.equal(poses.filter(h => /partage\.module-/.test(h)).length, 1, 'le module reste un fichier à part')
    assert.equal(poses.filter(h => /mjs_fx_glitch-/.test(h)).length, 1, 'le fichier d\'effet aussi')
  })
  // les formes d'appel que le build ne voyait pas — pourquoi ces essais existent.
  //
  // La fonction n'est émise au manifeste que si le build « voit » l'appel. Il ne cherchait que l'écriture
  // littérale `Autoloader.preload(` : avec un alias (`A = µ.Autoloader`), une déstructuration
  // (`{ preload } = µ.Autoloader`) ou un appel optionnel (`preload?(…)`), la fonction manquait en production
  // (« a.preload is not a function », ou un appel optionnel sans erreur NI effet). Désormais le build
  // l'émet dès que le code de l'appli mentionne `Autoloader` ET le mot `preload` (faux positifs
  // acceptés : la fonction pèse peu, et seulement dans le manifeste). Chaque forme est jouée pour de bon.
  const FORMES: Record<string, Record<string, string>> = {
    'alias': { 'appelant.mjs': '<script>\n@chauffer = ->\n  A := µ.Autoloader\n  A.preload(\'onglet\')\n</script>\n<button class="s" @mouseover=@chauffer>survol</button>\n' },
    'déstructuration': { 'appelant.mjs': '<script>\n@chauffer = ->\n  { preload } := µ.Autoloader\n  preload(\'onglet\')\n</script>\n<button class="s" @mouseover=@chauffer>survol</button>\n' },
    'appel optionnel': { 'appelant.mjs': '<script>\n@chauffer = -> µ.Autoloader.preload?(\'onglet\')\n</script>\n<button class="s" @mouseover=@chauffer>survol</button>\n' },
    'module .civet avec alias': {
      'aide.module.civet': 'export chauffer := (nom) ->\n  A := µ.Autoloader\n  A.preload nom\n',
      'appelant.mjs':      '@import chauffer \'aide.module.civet\'\n\n<button class="s" @mouseover={chauffer(\'onglet\')}>survol</button>\n',
    },
  }

  for (const [forme, fichiers] of Object.entries(FORMES)) {
    it(`forme « ${forme} » : la fonction est émise, et elle pose les liens de l'onglet sans erreur`, async () => {
      const { manifeste } = await construire('forme-' + forme.replace(/\W+/g, '-'), fichiers)
      assert.match(manifeste, /µ\.Autoloader\.preload = µPreload;/, 'la fonction est au manifeste')
      const { preload, liens } = page(manifeste)
      assert.ok(preload, 'µPreload est définie dans le prologue')
      assert.doesNotThrow(() => preload!('onglet'))
      assert.ok(liens().some(h => /\/out\/onglet-/.test(h)), `les liens de l'onglet sont posés, vus : ${liens().join(' ')}`)
    })
  }

  it('Autoloader sans le mot preload : rien d\'émis (load et les autres usages ne paient rien)', async () => {
    const { manifeste } = await construire('autoloader-seul', { 'charge.mjs': '<script>\n@go = -> µ.Autoloader.load(\'onglet\')\n</script>\n<button @click=@go>go</button>\n' })
    assert.equal(manifeste.includes('µPreload'), false)
  })
})
