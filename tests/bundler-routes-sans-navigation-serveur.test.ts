// Une appli à routes `#/` qui ne navigue jamais vers le serveur : le routeur emmène ujs (l'écouteur `hashchange`), mais ni la
// modale (et son thème), ni ajax, ni les rideaux de `:viewTransition`. Ils reviennent dès qu'UN fait les réclame : la navigation
// vers le serveur (lien `/x`, formulaire, HTML brut, `location.assign`, vues serveur, `:confirm`, réglages de navigation), ou
// leur propre signal (`µmodal`, `µajax`, `µload`, `:viewTransition`, `:vt`). Constructions réelles de production, non minifiées
// (noms longs lisibles dans le paquet)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { mjsTmp } from './helpers/tmp.js'

const ROUTES = '<routes target="root">\n  /   page-a\n  /b  page-b\n</routes>\n\n'
const NAV    = '<nav><a id="va" href="#/">A</a> <a id="vb" href="#/b">B</a></nav>\n'
const VUE    = '<@view root>\n'
const BASE: Record<string, string> = {
  'shell.page.mjs': ROUTES + NAV + VUE,
  'page-a.mjs':     '<p class="a">A</p>\n',
  'page-b.mjs':     '<p class="b">B</p>\n',
}

const MODALE  = 'mjs-modal-box'
const AJAX    = '_mjs_ajaxRequest = '
const RIDEAUX = '_mjs_vtCurtainRun = '

interface Bati { paquet: string, infos: string[] }

async function batir(extra: Record<string, string> = {}, reglages: Record<string, unknown> = {}, vues = false): Promise<Bati> {
  const root = mjsTmp('routes-sans-nav-serveur')
  const src  = join(root, 'app/modularjs')
  mkdirSync(src, { recursive: true })
  if (vues) mkdirSync(join(root, 'app/views'), { recursive: true })
  for (const [nom, texte] of Object.entries({ ...BASE, ...extra })) writeFileSync(join(src, nom), texte)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'out', manifestPath: 'bundle.js', minify: false, ...reglages }))
  const found   = findConfig(root)
  const opts    = resolveBundlerOpts(found!.config, found!.configDir)
  const ici     = process.cwd()
  process.chdir(root)
  let bundler: Bundler
  try {
    bundler = new Bundler({ ...opts, env: 'prod' } as any)
  }
  finally {
    process.chdir(ici)
  }
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => String(e.message ?? e)), [], 'aucune erreur de construction')
  const out    = join(root, 'out')
  const paquet = readdirSync(out, { recursive: true }).map(String).filter(f => f.endsWith('.js')).map(f => readFileSync(join(out, f), 'utf-8')).join('\n')
  return { paquet, infos: (bundler as any).resolveRuntimeFiles((bundler as any).collectUsedFeatures()).infos }
}

describe('routes `#/` sans navigation vers le serveur : ni modale, ni ajax, ni rideaux', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('deux routes, liens `#/` seuls, sans dossier de vues : le paquet ne porte ni la modale, ni ajax, ni les rideaux', async () => {
    const { paquet } = await batir()
    assert.ok(paquet.includes('_mjs_ujsOnClick = '), 'ujs reste : le routeur suit les adresses `#/` par lui')
    assert.equal(paquet.includes(MODALE), false, 'la modale ne doit plus suivre ujs')
    assert.equal(paquet.includes(AJAX), false, 'ajax ne doit plus suivre ujs')
    assert.equal(paquet.includes(RIDEAUX), false, 'les rideaux ne doivent plus suivre le seul routeur')
  })

  const MODALE_PAR: Array<[string, Record<string, string>, boolean]> = [
    ['µmodal', { 'page-b.mjs': "<script>\nµmount ->\n  window.__m = -> µmodal.fire({ html: 'x' })\n</script>\n<p class=\"b\">B</p>\n" }, false],
    [':confirm', { 'page-b.mjs': '<a href="#/" :confirm="Sûr ?">retour</a>\n' }, false],
    ['un dossier app/views', {}, true],
    ['un lien `/x`', { 'page-b.mjs': '<a href="/x">ailleurs</a>\n' }, false],
    ['un formulaire', { 'page-b.mjs': '<form action="/x"><button>ok</button></form>\n' }, false],
    ['du HTML brut', { 'page-b.mjs': "<script>\n$h = '<b>x</b>'\n</script>\n<div>{{$h}}</div>\n" }, false],
    ['location.assign', { 'page-b.mjs': "<script>\nµmount ->\n  window.__va = -> location.assign('/x')\n</script>\n<p class=\"b\">B</p>\n" }, false],
    ['un lien `href={$url}` (début inconnu à la construction)', { 'page-b.mjs': "<script>\n$url = '/x'\n</script>\n<a href={$url}>ailleurs</a>\n" }, false],
  ]
  for (const [fait, extra, vues] of MODALE_PAR) {
    it(`avec ${fait} : la modale revient`, async () => {
      const { paquet } = await batir(extra, {}, vues)
      assert.ok(paquet.includes(MODALE), `${fait} réclame la modale`)
    })
  }

  it('un lien `#/item/{$id}` (début écrit `#/`) est une route de la page : ni modale, ni ajax, ni rideaux', async () => {
    const { paquet } = await batir({ 'page-b.mjs': '<script>\n$id = 3\n</script>\n<a href="#/item/{$id}">fiche</a>\n' })
    assert.equal(paquet.includes(MODALE), false, 'un `href` qui commence par `#/` ne navigue pas vers le serveur')
    assert.equal(paquet.includes(AJAX), false)
    assert.equal(paquet.includes(RIDEAUX), false)
  })

  it('avec µajax : ajax revient', async () => {
    const { paquet } = await batir({ 'page-b.mjs': "<script>\nµmount ->\n  window.__g = -> µajax.get('/api/x')\n</script>\n<p class=\"b\">B</p>\n" })
    assert.ok(paquet.includes(AJAX))
  })

  it('avec µload : ajax revient', async () => {
    const { paquet } = await batir({ 'page-b.mjs': "<script>\n$me = µload('/api/me')\n</script>\n<p class=\"b\">{$me.data?.n}</p>\n" })
    assert.ok(paquet.includes(AJAX))
  })

  it('avec `:viewTransition.slide` sur une page : les rideaux reviennent', async () => {
    const { paquet } = await batir({ 'page-b.mjs': '<style :viewTransition.slide></style>\n<p class="b">B</p>\n' })
    assert.ok(paquet.includes(RIDEAUX))
  })

  it('avec le réglage viewTransition : les rideaux reviennent', async () => {
    const { paquet } = await batir({}, { viewTransition: 'fade' })
    assert.ok(paquet.includes(RIDEAUX))
  })

  it('avec un lien `:pageTransition` : les rideaux reviennent', async () => {
    const { paquet } = await batir({ 'shell.page.mjs': ROUTES + '<nav><a id="va" href="#/">A</a> <a id="vb" href="#/b" :pageTransition="zoom">B</a></nav>\n' + VUE })
    assert.ok(paquet.includes(RIDEAUX))
  })

  it('le message de la construction dit pourquoi chaque module est gardé', async () => {
    const { infos } = await batir({ 'page-b.mjs': '<a href="/x">ailleurs</a>\n' })
    const ligne = infos.find(i => /gardés|kept/.test(i)) ?? ''
    assert.match(ligne, /modal \([^)]*navigation vers le serveur|modal \([^)]*server navigation/, ligne)
    assert.match(ligne, /router \(/, ligne)
  })
})
