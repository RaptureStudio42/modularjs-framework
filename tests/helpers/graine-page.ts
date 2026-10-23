// Une page rendue par le serveur (prérendu, ou reprise par hydratation) servie à un navigateur réel, avec des règles réseau par fragment de
// langue (retard, échec 404), et le relevé de ce que la page montre à chaque image. Sert aux tests de la bascule du démarrage : la page
// demandée dans une autre langue que celle de sa graine (`?lang=en` sur une page rendue en français).

import assert from 'node:assert/strict'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './tmp.js'
import { Bundler } from '../../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../../src/bundler/config.js'
import { prerenderPages } from '../../src/server/prerender.js'
import { emitStartup } from '../../src/bundler/startup.js'
import { createBrowserRenderer } from '../../src/server/render-browser.js'
import { createSSRRenderer } from '../../src/server/renderToString.js'

export type Moteur = 'chromium' | 'firefox' | 'webkit'
export const MOTEURS: Moteur[] = ['chromium', 'firefox', 'webkit']

export async function lancer(nom: Moteur): Promise<any> {
  try {
    const playwright = await import('playwright')
    if (!existsSync(playwright[nom].executablePath())) return null
    return await playwright[nom].launch()
  }
  catch {
    return null
  }
}

// les textes du projet, français et anglais : des mots qui ne se confondent pas, pour dire de quelle langue est un texte
const FR_RACINE = 'titre: Titre\nenfant: Enfant\n'
const EN_RACINE = { titre: 'Title', enfant: 'Child' }
const SECTIONS: Record<string, [string, Record<string, string>]> = {
  accueil: ['salut: Bonjour accueil\n', { salut: 'Hello home' }],
  fiche:   ['nom: Fiche\n', { nom: 'Card' }],
  extra:   ['nom: Supplément\n', { nom: 'Extra' }]
}
const MOTS_FR = new Set(['Titre', 'Enfant', 'Bonjour', 'accueil', 'Fiche', 'Supplément'])
const MOTS_EN = new Set(['Title', 'Child', 'Hello', 'home', 'Card', 'Extra'])

// les langues que mêle un texte (les repères ⟦clé⟧ du développement n'en sont pas)
export function langues(texte: string): Set<string> {
  const trouvees = new Set<string>()
  for (const mot of texte.replace(/⟦[^⟧]*⟧/g, ' ').split(/[^A-Za-zÀ-ÿ]+/)) {
    if (MOTS_FR.has(mot)) trouvees.add('fr')
    if (MOTS_EN.has(mot)) trouvees.add('en')
  }
  return trouvees
}

export interface Options {
  nom: string
  composants: Record<string, string>
  env?: 'dev' | 'prod'
  placeholder?: string
  i18n?: Record<string, unknown>
  // reprise par hydratation : le HTML vient du moteur navigateur, le client ne porte que la reprise (+ les traductions) ; `runtime` est sa liste
  hydrate?: boolean
  runtime?: string[]
  // page sans rendu serveur : le HTML de la page est celui que donne `html` (aucun contenu, aucune graine)
  sansRendu?: boolean
  // page rendue par l'API du serveur (`createSSRRenderer`) : le client est construit à part, sans bloc `render` ni `hydrate` ;
  // `store` : l'état global posé au rendu (`{ __mjsLang: 'fr' }` : le serveur pose la langue de la page, que `#__mjs_store` transporte)
  api?: boolean
  store?: Record<string, unknown>
  html?: (page: string) => string
}

// les règles réseau : `racineEn` et `racineFr` retardent le fichier de langue anglais et le français (ms), `echecRacineEn` et `echecRacineFr` le font répondre 404,
// `retards` retarde les fragments anglais d'une section (ms), `echecs` les sections dont le fragment anglais répond 404, `pendus` celles dont il ne répond jamais
export interface Reseau {
  racineEn?: number
  racineFr?: number
  echecRacineEn?: boolean
  echecRacineFr?: boolean
  retards?: Record<string, number>
  echecs?: string[]
  pendus?: string[]
}

export interface Page {
  base: string
  poser: (reseau: Reseau) => void
  fermer: () => Promise<void>
}

export async function construire(o: Options): Promise<Page> {
  const env    = o.env ?? 'prod'
  const root   = mjsTmp('graine-page-' + o.nom)
  const srcDir = join(root, 'src')
  mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
  mkdirSync(join(srcDir, 'i18n', 'en'), { recursive: true })
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), FR_RACINE)
  writeFileSync(join(srcDir, 'i18n', 'en.json'), JSON.stringify(EN_RACINE))
  for (const [section, [fr, en]] of Object.entries(SECTIONS)) {
    writeFileSync(join(srcDir, 'i18n', 'fr', section + '.yml'), fr)
    writeFileSync(join(srcDir, 'i18n', 'en', section + '.json'), JSON.stringify(en))
  }
  for (const [fichier, source] of Object.entries(o.composants)) writeFileSync(join(srcDir, fichier + '.mjs'), source)
  const i18n: Record<string, unknown> = { default: 'fr', urlParam: true, ...(o.placeholder ? { placeholder: o.placeholder } : {}), ...(o.i18n ?? {}) }
  const sansPrerendu = o.hydrate || o.sansRendu || o.api
  const render       = sansPrerendu ? {} : { render: { default: 'prerender', engine: { prerender: 'happy-dom' }, startup: 'bundle', routes: { '/': { component: 'mjs-home' } } } }
  const config       = { sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', i18n, ...render }
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify(config, null, 2))

  let sortie = join(root, 'out')
  let page   = ''
  if (o.hydrate) {
    const renderer = await createBrowserRenderer(config, { configDir: root })
    const client   = new Bundler({ ...resolveBundlerOpts({ ...config, outputDir: 'client', manifestPath: 'client/bundle.js', urlPrefix: '/client', runtime: o.runtime ?? ['hydrate', 'i18n'], js: 'bundle' }, root), env } as any)
    const stats    = await client.compile()
    await client.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const rendu = await renderer.renderPage('mjs-home', { settleMs: 5000, ssrMode: 'markers' })
    await renderer.close()
    sortie = join(root, 'client')
    page   = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/client/bundle.js"></script></head><body>${rendu.hydrateScript}${rendu.sharedScript}${rendu.html}</body></html>`
  }
  else if (o.api) {
    // le client est construit seul : ni bloc `render` ni `hydrate`, c'est l'API du serveur qui rend la page et sème la graine
    const clientConfig = { ...config, outputDir: 'client', manifestPath: 'client/bundle.js', urlPrefix: '/client' }
    const bundlerOpts  = resolveBundlerOpts(clientConfig, root)
    const client       = new Bundler({ ...bundlerOpts, env } as any)
    const stats        = await client.compile()
    await client.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: join(root, 'serveur'), manifestPath: join(root, 'serveur', 'bundle.js'), bundlerOpts, env })
    let rendu
    try { rendu = await renderer.renderToString('mjs-home', { settleMs: 5000, ...(o.store ? { store: o.store } : {}) }) }
    finally { await renderer.close() }
    sortie = join(root, 'client')
    page   = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/client/bundle.js"></script></head><body>${rendu.sharedScript}${rendu.html}</body></html>`
  }
  else if (o.sansRendu) {
    const client = new Bundler({ ...resolveBundlerOpts({ ...config, outputDir: 'client', manifestPath: 'client/bundle.js', urlPrefix: '/client', runtime: o.runtime ?? ['hydrate', 'i18n'], js: 'bundle' }, root), env } as any)
    const stats  = await client.compile()
    await client.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    sortie = join(root, 'client')
    page   = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/client/bundle.js"></script></head><body><mjs-home></mjs-home></body></html>'
  }
  else {
    const trouve  = findConfig(root)!
    const bundler = new Bundler({ ...resolveBundlerOpts(trouve.config, trouve.configDir), env } as any)
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const rapport = await prerenderPages(trouve.config, trouve.configDir, () => {}, { env })
    await emitStartup(bundler, trouve.config.render, rapport, { prod: env === 'prod', log: () => {} })
    await bundler.close()
    const corps = readFileSync(rapport.generated.find(g => g.url === '/')!.file, 'utf-8')
    page = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body>${corps}</body></html>`
  }
  if (o.html) page = o.html(page)

  // le nom compact de chaque fragment anglais est dans le fichier de langue anglais
  const fichierEn = readdirSync(sortie).find(n => /^mjs_i18n-en-.*\.js$/.test(n))
  assert.ok(fichierEn, 'le fichier de langue anglais est construit')
  const sectionsEn: Record<string, string> = JSON.parse(readFileSync(join(sortie, fichierEn!), 'utf-8').replace(/^export default /, '').replace(/;\s*$/, '')).sections
  const sectionDe: Record<string, string> = Object.fromEntries(Object.entries(sectionsEn).map(([section, compact]) => [compact, section]))

  let reseau: Reseau = {}
  const pendues = new Set<ServerResponse>()
  const poser = (r: Reseau) => {
    for (const section of [...Object.keys(r.retards ?? {}), ...(r.echecs ?? []), ...(r.pendus ?? [])]) assert.ok(sectionsEn[section], 'section anglaise inconnue du fichier de langue : ' + section)
    reseau = r
  }
  const server: Server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(page)
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(sortie) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    const fragment = /\/i18n\/en\/([^/]+)\.json$/.exec(chemin)
    const section  = fragment ? sectionDe[fragment[1]] : undefined
    if (section && reseau.echecs?.includes(section)) { res.writeHead(404); res.end(); return }
    if (section && reseau.pendus?.includes(section)) { pendues.add(res); return }
    const racine = /\/mjs_i18n-(fr|en)-[^/]*\.js$/.exec(chemin)
    if (racine && (racine[1] === 'en' ? reseau.echecRacineEn : reseau.echecRacineFr)) { res.writeHead(404); res.end(); return }
    const retard = section ? reseau.retards?.[section] : (racine ? (racine[1] === 'en' ? reseau.racineEn : reseau.racineFr) : undefined)
    const envoyer = () => {
      res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
      res.end(readFileSync(fichier))
    }
    if (retard) setTimeout(envoyer, retard)
    else envoyer()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const fermer = () => new Promise<void>(resolve => {
    for (const res of pendues) res.destroy()
    server.close(() => resolve())
    server.closeAllConnections()
  })
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, poser, fermer }
}

// une sonde : le chemin des hôtes (préfixe `light:` : un enfant du DOM léger de l'hôte précédent), puis le sélecteur du texte
export type Sonde = { chemin: string[], sel: string }

// les images à juger : sans les toutes premières, prises avant que la page ait un seul des morceaux sondés (le HTML n'est pas encore analysé : tout se lit '-'),
// qui ne disent rien de la langue ; la dernière reste toujours
export function apresLeVide(vus: string[]): string[] {
  let i = 0
  while (i < vus.length - 1 && vus[i].split(' | ').every(morceau => morceau === '-')) i++
  return vus.slice(i)
}

export interface Releve {
  vus: string[]       // les textes successifs des sondes (réunis par « | »), un par changement vu à l'image
  etats: string[]     // les mêmes, avec leur date en ms depuis le chargement
  erreurs: string[]   // les exceptions non rattrapées de la page
  console: string[]   // les avertissements et erreurs de la console
  extra: any          // ce que rend le scénario
}

// le relevé tel qu'il part dans la page (JavaScript pur : une fonction transpilée par tsx y laisserait des appels __name) ; '-' pour ce qui n'est
// pas là, le texte suivi de « [C] » quand un hôte du chemin est caché (`mjs-loading` ou `display: none`)
const SCRIPT_SONDE = `function(sondes) {
  var w = window;
  w.__vus = [];
  w.__etats = [];
  var lire = function(s) {
    var racine = document;
    var cache = false;
    var hote = null;
    for (var i = 0; i < s.chemin.length; i++) {
      var etape = s.chemin[i];
      var lumiere = etape.indexOf('light:') === 0;
      var parts = (lumiere ? etape.slice(6) : etape).split(':');
      var liste = (lumiere ? hote : racine).querySelectorAll(parts[0]);
      hote = liste[parts[1] ? Number(parts[1]) : 0];
      if (!hote) return '-';
      if (hote.hasAttribute('mjs-loading') || getComputedStyle(hote).display === 'none') cache = true;
      racine = hote._shadow || hote.shadowRoot || hote;
    }
    var noeud = racine.querySelector(s.sel);
    return noeud ? noeud.textContent.replace(/\\u2007+/g, '▒').trim() + (cache ? ' [C]' : '') : '-';
  };
  var t0 = performance.now();
  var tick = function() {
    var v = sondes.map(lire).join(' | ');
    if (w.__vus.length === 0 || w.__vus[w.__vus.length - 1] !== v) {
      w.__vus.push(v);
      w.__etats.push(Math.round(performance.now() - t0) + 'ms ' + v);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}`

export async function relever(browser: any, url: string, sondes: Sonde[], o: { attente?: number, initScript?: string, scenario?: (page: any) => Promise<any> } = {}): Promise<Releve> {
  const contexte = await browser.newContext()
  const page     = await contexte.newPage()
  const erreurs: string[] = []
  const console_: string[] = []
  page.on('pageerror', (e: Error) => erreurs.push(e.message))
  page.on('console', (m: any) => { if (['warning', 'error'].includes(m.type())) console_.push(m.type() + ' : ' + m.text().slice(0, 300)) })
  if (o.initScript) await page.addInitScript(o.initScript)
  await page.addInitScript(`(${SCRIPT_SONDE})(${JSON.stringify(sondes)})`)
  try {
    await page.goto(url, { waitUntil: 'load' })
    const extra = o.scenario ? await o.scenario(page) : await page.waitForTimeout(o.attente ?? 2500)
    const vus: string[]   = await page.evaluate(() => (window as any).__vus)
    const etats: string[] = await page.evaluate(() => (window as any).__etats)
    return { vus, etats, erreurs, console: console_, extra }
  }
  finally { await contexte.close() }
}
