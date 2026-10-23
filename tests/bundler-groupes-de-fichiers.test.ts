// Groupes de fichiers (`"bundles": { "<nom>": ["<composant racine>", …] }` de mjs.config.json).
//
// Le besoin : une page à onglets dont chaque onglet est un composant qui contient des dizaines de
// petites cartes (369 fichiers servis pour une seule page). Les rassembler en UN fichier par onglet
// évite 40 à 80 requêtes par onglet, sans toucher au code des composants.
//
// En production, un groupe = ses composants racines + toute leur descendance (table des dépendances
// du manifeste), assemblés en `mjs_group-<nom>-<empreinte>.js`. Restent EXTERNES, comme dans un
// fichier de page : le cœur, les MODULES (un module doit rester une instance unique), les feuilles,
// les animations, les fichiers de langue et les fichiers d'effets. Le manifeste (`µPaths`) repointe
// chaque composant du groupe sur ce fichier : charger n'importe lequel charge le groupe, une fois.
// Les fichiers séparés existent toujours (le rendu serveur les lit un par un, `prune` les garde).
//
// En développement : aucun regroupement, une ligne d'information.
//
// Règles de conflit : un composant atteint par plusieurs groupes est une erreur de build ; un composant
// du groupe aussi utilisé hors du groupe reste dans le groupe, son chemin pointe vers le groupe et
// le build avertit ; le fichier de page d'une route prérendue l'emporte, pour cette route, sur le
// groupe.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { prerenderPages } from '../src/server/prerender.js'
import { emitStartup } from '../src/bundler/startup.js'
import { setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

const GROUPE_RE = /^mjs_group-onglet-[0-9a-z]{5}\.js$/

// un onglet (`onglet`) : deux cartes, une puce partagée par les deux, un module partagé, un effet
const BASE: Record<string, string> = {
  'partage.module.civet': 'export marque := \'valeur-du-module-partage\'\n',
  'puce.mjs':             '<i class="puce">puce</i>\n',
  'carte-a.mjs':          '@import marque \'partage.module.civet\'\n\n<p class="a" *glitch>{marque}</p>\n<mjs-puce></mjs-puce>\n',
  'carte-b.mjs':          '@import marque \'partage.module.civet\'\n\n<p class="b">{marque}</p>\n<mjs-puce></mjs-puce>\n',
  'onglet.mjs':           '<h2 class="o">onglet</h2>\n<mjs-carte-a></mjs-carte-a>\n<mjs-carte-b></mjs-carte-b>\n',
  'accueil.mjs':          '<h1 class="t">accueil</h1>\n<mjs-onglet></mjs-onglet>\n',
  'libre.mjs':            '<p class="l">libre</p>\n',
}

interface Projet { root: string; srcDir: string; outDir: string }

function projet(etiquette: string, extra: Record<string, string> = {}): Projet {
  const root   = mjsTmp('groupes-' + etiquette)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries({ ...BASE, ...extra })) writeFileSync(join(srcDir, nom), src)
  return { root, srcDir, outDir: join(root, 'out') }
}

async function compiler(p: Projet, bundles: Record<string, any> | undefined, env: 'dev' | 'prod' = 'prod') {
  const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: join(p.outDir, 'bundle.js'), urlPrefix: '/out', env, bundles } as any)
  const stats   = await bundler.compile()
  return { bundler, stats, messages: stats.errors.map((e: any) => e.message) }
}

function paths(p: Projet): Record<string, string> {
  return JSON.parse(/const µPaths = (\{.*\});/.exec(readFileSync(join(p.outDir, 'bundle.js'), 'utf-8'))![1])
}

const fichiers = (p: Projet): string[] => readdirSync(p.outDir)

// consigne des noms au registre des sorties (`.mjs-outputs.json`, clé `files`), comme l'aurait fait le build qui les a
// écrits : le ménage ne retire que ce que ce registre liste, jamais un fichier sur la seule forme de son nom
function consigner(dossier: string, ...noms: string[]): void {
  const chemin   = join(dossier, '.mjs-outputs.json')
  const registre = JSON.parse(readFileSync(chemin, 'utf-8'))
  registre.files = [...new Set([...(registre.files ?? []), ...noms])].sort()
  writeFileSync(chemin, JSON.stringify(registre, null, 2) + '\n')
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// la CLI transmet la clé au Bundler (une clé lue mais non transmise resterait inerte, sans erreur)
describe('groupes de fichiers (bundles) — par la vraie CLI', function () {
  this.timeout(120000)

  it('mjs build --prod lit bundles dans mjs.config.json : le fichier de groupe est écrit, la ligne du journal le nomme', () => {
    const p = projet('cli')
    writeFileSync(join(p.root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', bundles: { onglet: ['onglet'] } }, null, 2))
    const result = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--prod', '--root', p.root], { cwd: repoRoot, encoding: 'utf-8' })
    assert.equal(result.status, 0, `stderr:\n${result.stderr}\nstdout:\n${result.stdout}`)
    const groupe = fichiers(p).find(f => GROUPE_RE.test(f))
    assert.ok(groupe, `fichier de groupe attendu, vus : ${fichiers(p).join(' ')}`)
    assert.ok(result.stdout.includes(groupe!), 'le journal du build nomme le fichier de groupe')
    assert.equal(paths(p)['carte-a'], groupe)
  })

  it('mjs build sans --prod : aucun fichier de groupe, une ligne d\'information au journal', () => {
    const p = projet('cli-dev')
    writeFileSync(join(p.root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', bundles: { onglet: ['onglet'] } }, null, 2))
    const result = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--root', p.root], { cwd: repoRoot, encoding: 'utf-8' })
    assert.equal(result.status, 0, `stderr:\n${result.stderr}\nstdout:\n${result.stdout}`)
    assert.deepEqual(fichiers(p).filter(f => /^mjs_group-/.test(f)), [])
    assert.match(result.stdout, /bundles.*--prod/)
  })
})

describe('groupes de fichiers (bundles)', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('production : un fichier assemble l\'onglet et toute sa descendance, une fois chaque composant', async () => {
    const p = projet('assemblage')
    const { stats, bundler } = await compiler(p, { onglet: ['onglet'] })
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const groupe = fichiers(p).filter(f => GROUPE_RE.test(f))
    assert.equal(groupe.length, 1, `un seul fichier de groupe attendu, vus : ${fichiers(p).join(' ')}`)
    const code    = readFileSync(join(p.outDir, groupe[0]), 'utf-8')
    const definis = [...code.matchAll(/\._def\("(mjs-[a-z-]+)"/g)].map(m => m[1]).sort()
    assert.deepEqual(definis, ['mjs-carte-a', 'mjs-carte-b', 'mjs-onglet', 'mjs-puce'])
    assert.ok(bundler.groupReport.some(g => g.name === 'onglet' && g.names.join() === 'carte-a,carte-b,onglet,puce'), 'le rapport du build nomme les composants du groupe')
  })

  it('le cœur, le module partagé et le fichier d\'effet restent des imports externes du groupe', async () => {
    const p = projet('externes')
    await compiler(p, { onglet: ['onglet'] })
    const code = readFileSync(join(p.outDir, fichiers(p).find(f => GROUPE_RE.test(f))!), 'utf-8')
    assert.match(code, /from\s*"\/out\/mjs_core-[0-9a-z]{5}\.js"/, 'le cœur reste externe')
    assert.match(code, /from\s*"\/out\/partage\.module-[0-9a-z]{5}\.js"/, 'le module reste externe : une seule instance')
    assert.match(code, /"\/out\/mjs_fx_glitch-[0-9a-z]{5}\.js"/, 'le fichier de l\'effet reste externe')
    assert.equal(code.includes('mjs-stale-reload'), false, 'le code du cœur n\'est pas recopié')
    assert.equal(code.includes('valeur-du-module-partage'), false, 'le code du module n\'est pas recopié')
  })

  it('le manifeste repointe chaque composant du groupe sur le fichier de groupe, pas les autres', async () => {
    const p = projet('manifeste')
    await compiler(p, { onglet: ['onglet'] })
    const groupe = fichiers(p).find(f => GROUPE_RE.test(f))!
    const table  = paths(p)
    for (const nom of ['onglet', 'carte-a', 'carte-b', 'puce']) assert.equal(table[nom], groupe, `µPaths['${nom}'] pointe le groupe`)
    assert.match(table['accueil'], /^accueil-[0-9a-z]{5}\.js$/, 'un composant hors groupe garde son fichier')
    assert.match(table['libre'], /^libre-[0-9a-z]{5}\.js$/)
    assert.match(table['partage.module'], /^partage\.module-[0-9a-z]{5}\.js$/, 'le module garde son fichier')
    assert.match(table['mjs_fx_glitch'], /^mjs_fx_glitch-[0-9a-z]{5}\.js$/, 'le fichier d\'effet garde le sien')
  })

  it('les fichiers séparés existent toujours, et prune retire un orphelin sans toucher ni au groupe ni aux séparés', async () => {
    const p = projet('prune')
    const { bundler } = await compiler(p, { onglet: ['onglet'] })
    for (const nom of ['onglet', 'carte-a', 'carte-b', 'puce']) {
      assert.ok(fichiers(p).some(f => new RegExp(`^${nom}-[0-9a-z]{5}\\.js$`).test(f)), `le fichier séparé de ${nom} existe`)
    }
    // un orphelin qu'un build précédent a écrit (consigné au registre), pour prouver que la purge tourne vraiment (une purge
    // muette ne prouverait rien)
    writeFileSync(join(p.outDir, 'ancien-aaaaaaaa.js'), 'export {}\n')
    consigner(p.outDir, 'ancien-aaaaaaaa.js')
    const avant = fichiers(p).filter(f => /^(onglet|carte-a|carte-b|puce|mjs_group-onglet)-/.test(f)).sort()
    const { removed, skipped } = bundler.pruneOrphans()
    assert.equal(skipped, undefined, `la purge doit tourner (sautée : ${skipped})`)
    assert.deepEqual(removed, ['ancien-aaaaaaaa.js'])
    assert.deepEqual(fichiers(p).filter(f => /^(onglet|carte-a|carte-b|puce|mjs_group-onglet)-/.test(f)).sort(), avant)
  })

  it('développement : aucun fichier de groupe, la table du manifeste inchangée, une ligne d\'information', async () => {
    const p = projet('dev')
    const { stats, bundler } = await compiler(p, { onglet: ['onglet'] }, 'dev')
    assert.equal(stats.errors.length, 0)
    assert.deepEqual(fichiers(p).filter(f => /^mjs_group-/.test(f)), [])
    assert.match(paths(p)['carte-a'], /^carte-a-[0-9a-z]{5}\.js$/)
    assert.ok(bundler.groupInfo.some(l => /bundles|groupe/i.test(l) && /production|--prod/.test(l)), `ligne d'information attendue : ${bundler.groupInfo.join(' | ')}`)
  })

  it('sans clé bundles : aucun fichier de groupe, rien de changé', async () => {
    const p = projet('sans')
    const { stats } = await compiler(p, undefined)
    assert.equal(stats.errors.length, 0)
    assert.deepEqual(fichiers(p).filter(f => /^mjs_group-/.test(f)), [])
    assert.match(paths(p)['carte-a'], /^carte-a-[0-9a-z]{5}\.js$/)
  })

  it('deux groupes qui atteignent le même composant : erreur de build qui nomme le composant et les deux groupes', async () => {
    const p = projet('deux-groupes', { 'autre.mjs': '<b class="x">autre</b>\n<mjs-puce></mjs-puce>\n' })
    const { messages } = await compiler(p, { onglet: ['onglet'], autre: ['autre'] })
    assert.equal(messages.length, 1, messages.join('\n'))
    assert.match(messages[0], /puce/)
    assert.match(messages[0], /onglet/)
    assert.match(messages[0], /autre/)
    assert.equal(fichiers(p).some(f => /^mjs_group-/.test(f)), false, 'aucun groupe écrit quand la répartition est ambiguë')
  })

  it('un composant du groupe utilisé hors du groupe : il reste dans le groupe, son chemin y pointe, le build avertit en le nommant', async () => {
    const p = projet('hors-groupe', { 'dehors.mjs': '<u class="d">dehors</u>\n<mjs-carte-b></mjs-carte-b>\n' })
    const { stats } = await compiler(p, { onglet: ['onglet'] })
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const groupe = fichiers(p).find(f => GROUPE_RE.test(f))!
    assert.equal(paths(p)['carte-b'], groupe, 'carte-b reste dans le groupe : une page qui l\'utilise charge tout le groupe')
    const avis = stats.warnings.filter(w => /carte-b/.test(w))
    assert.equal(avis.length, 1, `un avertissement qui nomme carte-b, vus : ${stats.warnings.join(' | ')}`)
    assert.match(avis[0], /onglet/, 'l\'avertissement nomme le groupe')
    assert.match(avis[0], /dehors/, 'l\'avertissement nomme le composant extérieur')
  })

  it('le composant racine, appelé depuis l\'extérieur, est l\'usage prévu : aucun avertissement', async () => {
    const p = projet('racine-appelee')
    const { stats } = await compiler(p, { onglet: ['onglet'] })
    assert.deepEqual(stats.warnings.filter(w => /onglet/.test(w) && /groupe/i.test(w)), [])
  })

  it('composant racine inconnu : erreur de build qui le nomme', async () => {
    const p = projet('racine-inconnue')
    const { messages } = await compiler(p, { onglet: ['fantome'] })
    assert.equal(messages.length, 1, messages.join('\n'))
    assert.match(messages[0], /fantome/)
    assert.match(messages[0], /onglet/)
  })

  it('un module n\'est pas un composant : le désigner comme racine est refusé', async () => {
    const p = projet('racine-module')
    const { messages } = await compiler(p, { onglet: ['partage.module'] })
    assert.equal(messages.length, 1, messages.join('\n'))
    assert.match(messages[0], /partage\.module/)
  })

  it('la racine se nomme avec ou sans le préfixe mjs-', async () => {
    const p = projet('prefixe')
    const { stats } = await compiler(p, { onglet: ['mjs-onglet'] })
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    assert.equal(paths(p)['carte-a'], fichiers(p).find(f => GROUPE_RE.test(f)))
  })

  it('reconstruction à l\'identique : même fichier de groupe ; un composant modifié change l\'empreinte et purge l\'ancien', async () => {
    const p = projet('stable')
    await compiler(p, { onglet: ['onglet'] })
    const premier = fichiers(p).find(f => GROUPE_RE.test(f))!
    await compiler(p, { onglet: ['onglet'] })
    assert.equal(fichiers(p).filter(f => GROUPE_RE.test(f)).join(), premier, 'même contenu, même empreinte')
    writeFileSync(join(p.srcDir, 'puce.mjs'), '<i class="puce">puce revue</i>\n')
    await compiler(p, { onglet: ['onglet'] })
    const troisieme = fichiers(p).filter(f => GROUPE_RE.test(f))
    assert.equal(troisieme.length, 1, `l'ancien fichier de groupe est purgé, vus : ${troisieme.join(' ')}`)
    assert.notEqual(troisieme[0], premier)
  })
})

// la clé lue dans mjs.config.json : type, nom de groupe, liste, éléments — chaque faute dit laquelle
describe('groupes de fichiers (bundles) — lecture de mjs.config.json', () => {
  const lire = (bundles: unknown) => {
    const root = mjsTmp('groupes-cfg')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ bundles }))
    return findConfig(root)
  }

  it('une configuration correcte est lue et transmise au Bundler', () => {
    const found = lire({ 'onglet-texte': ['fx-famille-text'], b2: ['a', 'mjs-b'] })
    assert.deepEqual(found!.config.bundles, { 'onglet-texte': ['fx-famille-text'], b2: ['a', 'mjs-b'] })
    assert.deepEqual(resolveBundlerOpts(found!.config, found!.configDir).bundles, found!.config.bundles)
  })

  it('une valeur qui n\'est pas un objet est refusée', () => {
    assert.throws(() => lire(['a']), /bundles.*objet/)
    assert.throws(() => lire('onglet'), /bundles.*objet/)
  })

  it('un nom de groupe invalide est refusé et cité', () => {
    assert.throws(() => lire({ 'Mon Onglet': ['a'] }), /Mon Onglet/)
    assert.throws(() => lire({ '': ['a'] }), /bundles/)
  })

  it('une liste absente, vide ou mal formée est refusée et nomme le groupe', () => {
    assert.throws(() => lire({ onglet: 'a' }), /onglet.*liste|liste.*onglet/)
    assert.throws(() => lire({ onglet: [] }), /onglet.*vide|vide.*onglet/)
    assert.throws(() => lire({ onglet: ['a', 3] }), /onglet/)
    assert.throws(() => lire({ onglet: ['a', ''] }), /onglet/)
  })
})

// le fichier de page d'une route prérendue l'emporte, pour cette route, sur le groupe ; le groupe sert ailleurs
describe('groupes de fichiers (bundles) — avec les fichiers de page et le préchargement', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  function ecrireProjet(etiquette: string, startup: 'bundle' | 'preload'): Projet {
    const p = projet(etiquette)
    writeFileSync(join(p.root, 'mjs.config.json'), JSON.stringify({
      sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out',
      bundles: { onglet: ['onglet'] },
      render: { default: 'prerender', engine: { prerender: 'happy-dom' }, startup, routes: { '/': { component: 'mjs-accueil' } } },
    }, null, 2))
    return p
  }

  async function construire(p: Projet) {
    const found   = findConfig(p.root)!
    const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const report  = await prerenderPages(found.config, found.configDir, () => {}, { env: 'prod' })
    assert.ok(report.generated.length > 0, 'pages ignorées : ' + JSON.stringify(report.skipped))
    const journal: string[] = []
    await emitStartup(bundler, found.config.render, report, { prod: true, log: m => journal.push(m) })
    await bundler.close()
    return { report, journal }
  }

  it('startup: bundle : le fragment pointe sur le fichier de page, qui contient les composants du groupe ; le manifeste sert le groupe aux autres routes', async () => {
    const p = ecrireProjet('page', 'bundle')
    const { report } = await construire(p)
    const texte  = readFileSync(report.generated.find(g => g.url === '/')!.file, 'utf-8')
    const fiche  = JSON.parse(/id="__mjs_page">(.*?)<\/script>/.exec(texte)![1])
    const pages  = fichiers(p).filter(f => /^mjs_page-index-[0-9a-z]{5}\.js$/.test(f))
    assert.equal(pages.length, 1)
    assert.equal(fiche.file, pages[0], 'la fiche de la route nomme le fichier de page')
    assert.deepEqual(fiche.names, ['accueil', 'carte-a', 'carte-b', 'onglet', 'puce'], 'le fichier de page porte aussi les composants du groupe')
    assert.equal(texte.includes('mjs_group-'), false, 'aucun lien vers le groupe sur cette route : le fichier de page l\'emporte')
    // ailleurs (le manifeste), la table sert le groupe
    const groupe = fichiers(p).find(f => GROUPE_RE.test(f))!
    assert.equal(paths(p)['carte-a'], groupe)
  })

  it('startup: preload : le fragment précharge le fichier de groupe, une seule fois, et plus les fichiers séparés du groupe', async () => {
    const p = ecrireProjet('preload', 'preload')
    const { report } = await construire(p)
    const texte  = readFileSync(report.generated.find(g => g.url === '/')!.file, 'utf-8')
    const hrefs  = [...texte.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(m => m[1])
    const groupe = fichiers(p).find(f => GROUPE_RE.test(f))!
    assert.equal(hrefs.filter(h => h === `/out/${groupe}`).length, 1, `le groupe est préchargé une fois, vus : ${hrefs.join(' ')}`)
    assert.deepEqual(hrefs.filter(h => /\/out\/(onglet|carte-a|carte-b|puce)-[0-9a-z]{5}\.js$/.test(h)), [], 'aucun fichier séparé du groupe n\'est demandé')
    assert.ok(existsSync(join(p.outDir, groupe)))
    assert.ok(basename(groupe))
  })
})

// « ce groupe, sauf ces composants » — pourquoi ces essais existent.
//
// Le besoin, mesuré sur un vrai site : l'onglet « Composants » regroupe des dizaines de cartes qui
// utilisent quelques composants du cœur (champ, jauge, bouton…) dont une autre page se sert aussi.
// Dans le groupe, une page qui n'utilise que l'un d'eux téléchargerait tout le groupe. La forme objet
// `{ "roots": [...], "except": [...] }` laisse ces composants dehors : un composant listé dans
// `except`, et la descendance qui n'est atteinte QUE par lui, restent en fichiers séparés, qui se
// chargent comme d'habitude quand la coquille les appelle. La forme courte `["racine"]` ne change pas.
//
// Projet de l'essai : `onglet` appelle carte-a, carte-b et `champ` ; `champ` appelle `loupe` (qu'il est
// seul à appeler) et `puce` (que les deux cartes appellent aussi) ; `dehors` appelle `champ`.
describe('groupes de fichiers (bundles) — « sauf ces composants » (except)', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  const EXTRA = {
    'champ.mjs':  '<input class="champ">\n<mjs-loupe></mjs-loupe>\n<mjs-puce></mjs-puce>\n',
    'loupe.mjs':  '<s class="loupe">loupe</s>\n',
    'dehors.mjs': '<u class="d">dehors</u>\n<mjs-champ></mjs-champ>\n',
    'onglet.mjs': '<h2 class="o">onglet</h2>\n<mjs-carte-a></mjs-carte-a>\n<mjs-carte-b></mjs-carte-b>\n<mjs-champ></mjs-champ>\n',
  }
  const objet = (except: string[], roots: string[] = ['onglet']) => ({ onglet: { roots, except } }) as any
  const definis = (p: Projet): string[] => {
    const code = readFileSync(join(p.outDir, fichiers(p).find(f => GROUPE_RE.test(f))!), 'utf-8')
    return [...code.matchAll(/\._def\("(mjs-[a-z-]+)"/g)].map(m => m[1]).sort()
  }

  it('l\'exclu et sa descendance propre restent en fichiers séparés ; le reste du groupe est assemblé', async () => {
    const p = projet('except-base', EXTRA)
    const { stats, bundler } = await compiler(p, objet(['champ']))
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    assert.deepEqual(definis(p), ['mjs-carte-a', 'mjs-carte-b', 'mjs-onglet', 'mjs-puce'], 'ni champ ni loupe dans le fichier de groupe')
    const groupe = fichiers(p).find(f => GROUPE_RE.test(f))!
    const table  = paths(p)
    assert.match(table['champ'], /^champ-[0-9a-z]{5}\.js$/, 'champ garde son fichier')
    assert.match(table['loupe'], /^loupe-[0-9a-z]{5}\.js$/, 'loupe, que seul champ appelle, part avec lui')
    for (const nom of ['onglet', 'carte-a', 'carte-b', 'puce']) assert.equal(table[nom], groupe)
    assert.deepEqual(bundler.groupReport[0].names, ['carte-a', 'carte-b', 'onglet', 'puce'])
  })

  it('un descendant que l\'exclu atteint ET qu\'un non-exclu atteint aussi reste dans le groupe (puce)', async () => {
    const p = projet('except-partage', EXTRA)
    await compiler(p, objet(['champ']))
    assert.equal(paths(p)['puce'], fichiers(p).find(f => GROUPE_RE.test(f)))
    assert.ok(definis(p).includes('mjs-puce'))
  })

  it('la forme objet sans except donne le même groupe que la forme courte', async () => {
    const court = projet('except-court', EXTRA)
    const objetSeul = projet('except-objet-seul', EXTRA)
    await compiler(court, { onglet: ['onglet'] })
    await compiler(objetSeul, { onglet: { roots: ['onglet'] } } as any)
    assert.equal(fichiers(court).find(f => GROUPE_RE.test(f)), fichiers(objetSeul).find(f => GROUPE_RE.test(f)), 'même contenu, même empreinte')
    assert.deepEqual(definis(court), ['mjs-carte-a', 'mjs-carte-b', 'mjs-champ', 'mjs-loupe', 'mjs-onglet', 'mjs-puce'])
  })

  it('un exclu appelé de l\'extérieur ne déclenche plus l\'avertissement « utilisé hors du groupe » ; sans except, l\'avertissement propose la solution', async () => {
    const sans = projet('except-avis-sans', EXTRA)
    const { stats: avant } = await compiler(sans, { onglet: ['onglet'] })
    const avis = avant.warnings.filter(w => /champ/.test(w) && /dehors/.test(w))
    assert.equal(avis.length, 1, `un avertissement qui nomme champ et dehors, vus : ${avant.warnings.join(' | ')}`)
    assert.match(avis[0], /except/, 'l\'avertissement propose la clé except')
    assert.match(avis[0], /onglet/, 'et nomme le groupe où l\'ajouter')
    const avec = projet('except-avis-avec', EXTRA)
    const { stats } = await compiler(avec, objet(['champ']))
    assert.deepEqual(stats.warnings.filter(w => /'(champ|loupe)' est dans/.test(w)), [], `plus d'avertissement sur champ ni loupe, vus : ${stats.warnings.join(' | ')}`)
    // puce reste dans le groupe (les cartes l'appellent) et champ, désormais dehors, l'appelle : une page qui n'utilise
    // que champ charge donc le groupe par puce — l'avertissement existant le dit, c'est la conséquence à connaître
    const puce = stats.warnings.filter(w => /'puce' est dans/.test(w))
    assert.equal(puce.length, 1, `puce est signalée, vus : ${stats.warnings.join(' | ')}`)
    assert.match(puce[0], /champ/)
  })

  it('les exclus restent dans la table des dépendances : précharger la racine les nomme avec le groupe', async () => {
    const p = projet('except-deps', EXTRA)
    await compiler(p, objet(['champ']))
    const deps = JSON.parse(/const µDeps = (\{.*\});/.exec(readFileSync(join(p.outDir, 'bundle.js'), 'utf-8'))![1])
    assert.ok(deps['onglet'].includes('champ'), `onglet appelle champ, table : ${JSON.stringify(deps['onglet'])}`)
    assert.ok(deps['champ'].includes('loupe'), 'champ appelle loupe')
  })

  it('les fichiers séparés des exclus existent, et la purge ne touche ni eux ni le groupe', async () => {
    const p = projet('except-prune', EXTRA)
    const { bundler } = await compiler(p, objet(['champ']))
    const { removed, skipped } = bundler.pruneOrphans()
    assert.equal(skipped, undefined)
    assert.deepEqual(removed, [])
    for (const nom of ['champ', 'loupe']) assert.ok(fichiers(p).some(f => new RegExp(`^${nom}-[0-9a-z]{5}\\.js$`).test(f)), `fichier de ${nom}`)
  })

  it('l\'exclu se nomme avec ou sans le préfixe mjs-', async () => {
    const p = projet('except-prefixe', EXTRA)
    await compiler(p, objet(['mjs-champ']))
    assert.deepEqual(definis(p), ['mjs-carte-a', 'mjs-carte-b', 'mjs-onglet', 'mjs-puce'])
  })

  it('un nom inconnu dans except est une erreur de build qui le nomme', async () => {
    const p = projet('except-inconnu', EXTRA)
    const { messages } = await compiler(p, objet(['fantome']))
    assert.equal(messages.length, 1, messages.join('\n'))
    assert.match(messages[0], /fantome/)
    assert.match(messages[0], /except/)
    assert.match(messages[0], /onglet/)
  })

  it('un module n\'est pas un composant : l\'exclure est refusé', async () => {
    const p = projet('except-module', EXTRA)
    const { messages } = await compiler(p, objet(['partage.module']))
    assert.equal(messages.length, 1, messages.join('\n'))
    assert.match(messages[0], /partage\.module/)
  })

  it('une racine listée dans except est une erreur (elle viderait le groupe de sa raison d\'être)', async () => {
    const p = projet('except-racine', EXTRA)
    const { messages } = await compiler(p, objet(['onglet']))
    assert.equal(messages.length, 1, messages.join('\n'))
    assert.match(messages[0], /onglet/)
    assert.match(messages[0], /racine/)
    assert.equal(fichiers(p).some(f => /^mjs_group-/.test(f)), false)
  })

  it('toutes les racines exclues : même erreur, aucun groupe vide n\'est écrit', async () => {
    const p = projet('except-tout', EXTRA)
    const { messages } = await compiler(p, objet(['carte-a', 'carte-b'], ['carte-a', 'carte-b']))
    assert.equal(messages.length, 1, messages.join('\n'))
    assert.match(messages[0], /carte-a/)
    assert.equal(fichiers(p).some(f => /^mjs_group-/.test(f)), false)
  })
})

describe('groupes de fichiers (bundles) — forme objet dans mjs.config.json', () => {
  const lire = (bundles: unknown) => {
    const root = mjsTmp('groupes-cfg-objet')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ bundles }))
    return findConfig(root)
  }

  it('les deux formes se lisent côte à côte et sont transmises au Bundler telles quelles', () => {
    const bundles = { a: ['x'], b: { roots: ['y', 'z'], except: ['core-field'] }, c: { roots: ['w'] } }
    const found = lire(bundles)
    assert.deepEqual(found!.config.bundles, bundles)
    assert.deepEqual(resolveBundlerOpts(found!.config, found!.configDir).bundles, bundles)
  })

  it('une clé inconnue de l\'objet est refusée, avec les clés valides', () => {
    assert.throws(() => lire({ a: { roots: ['x'], excpet: [] } }), /excpet.*roots.*except|roots.*except.*excpet/s)
  })

  it('roots absent, vide ou mal formé est refusé et nomme le groupe', () => {
    assert.throws(() => lire({ a: { except: ['x'] } }), /a.*roots|roots.*a/s)
    assert.throws(() => lire({ a: { roots: [] } }), /a.*vide|vide.*a/s)
    assert.throws(() => lire({ a: { roots: ['x', 3] } }), /a/)
  })

  it('except doit être une liste de noms (chaînes non vides) ; une liste vide est acceptée', () => {
    assert.throws(() => lire({ a: { roots: ['x'], except: 'y' } }), /a.*except|except.*a/s)
    assert.throws(() => lire({ a: { roots: ['x'], except: ['y', ''] } }), /except/)
    assert.throws(() => lire({ a: { roots: ['x'], except: [4] } }), /except/)
    assert.doesNotThrow(() => lire({ a: { roots: ['x'], except: [] } }))
  })
})

// carte des sources + fichier de groupe — pourquoi ces essais existent.
//
// `sourceMap: 'prod'` (ou 'always') avec `bundles` faisait échouer TOUT le build en production :
// l'assemblage du fichier de groupe demandait à esbuild une carte externe sans lui donner de fichier
// de sortie (« Cannot use an external source map without an output path »). Un site qui veut sa carte
// ET ses groupes ne pouvait donc pas construire. Le fichier de groupe suit la règle des autres sorties
// du build : `<nom>-<empreinte>.js` + `<nom>-<empreinte>.js.map` à côté, et le commentaire
// `sourceMappingURL` en dernière ligne ; la carte désigne les vraies sources `.mjs`, et la purge
// connaît le `.map` (elle ne le retire pas tant que le groupe vit, elle l'emporte avec l'ancien groupe).
describe('groupes de fichiers (bundles) — avec la carte des sources', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  async function compilerAvecCarte(p: Projet, sourceMap: 'prod' | 'always') {
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: join(p.outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', sourceMap, bundles: { onglet: ['onglet'] } } as any)
    const stats   = await bundler.compile()
    return { bundler, stats }
  }

  for (const mode of ['prod', 'always'] as const) {
    it(`sourceMap: '${mode}' : le build réussit, le fichier de groupe et sa carte sont écrits et se répondent`, async () => {
      const p = projet('carte-' + mode)
      const { stats } = await compilerAvecCarte(p, mode)
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const groupe = fichiers(p).find(f => GROUPE_RE.test(f))!
      assert.ok(groupe, 'fichier de groupe écrit')
      const code = readFileSync(join(p.outDir, groupe), 'utf-8')
      assert.ok(code.trimEnd().endsWith(`//# sourceMappingURL=${groupe}.map`), `le groupe renvoie à sa carte, fin : ${code.slice(-120)}`)
      assert.ok(existsSync(join(p.outDir, `${groupe}.map`)), 'la carte du groupe est écrite à côté')
      const carte = JSON.parse(readFileSync(join(p.outDir, `${groupe}.map`), 'utf-8'))
      const sources = (carte.sources as string[]).join(' ')
      for (const nom of ['onglet', 'carte-a', 'carte-b', 'puce']) assert.ok(sources.includes(`${nom}.mjs`), `la carte désigne la vraie source ${nom}.mjs, vus : ${sources}`)
    })
  }

  it('la purge connaît la carte du groupe : épargnée tant que le groupe vit, emportée avec lui quand il change', async () => {
    const p = projet('carte-purge')
    const { bundler } = await compilerAvecCarte(p, 'prod')
    const premier = fichiers(p).find(f => GROUPE_RE.test(f))!
    writeFileSync(join(p.outDir, 'ancien-aaaaaaaa.js'), 'export {}\n')
    consigner(p.outDir, 'ancien-aaaaaaaa.js')
    const { removed, skipped } = bundler.pruneOrphans()
    assert.equal(skipped, undefined, `la purge doit tourner (sautée : ${skipped})`)
    assert.deepEqual(removed, ['ancien-aaaaaaaa.js'])
    assert.ok(existsSync(join(p.outDir, `${premier}.map`)), 'la carte du groupe survit à la purge')
    await bundler.close()
    // un composant du groupe change : nouveau groupe, l'ancien et sa carte partent
    writeFileSync(join(p.srcDir, 'puce.mjs'), '<i class="puce">puce changée</i>\n')
    const second = await compilerAvecCarte(p, 'prod')
    assert.equal(second.stats.errors.length, 0, second.stats.errors.map((e: any) => e.message).join('\n'))
    const groupes = fichiers(p).filter(f => /^mjs_group-onglet-/.test(f))
    assert.equal(groupes.filter(f => f.endsWith('.js')).length, 1, `un seul fichier de groupe, vus : ${groupes.join(' ')}`)
    assert.notEqual(groupes.find(f => f.endsWith('.js')), premier, 'l\'empreinte a changé')
    assert.equal(groupes.filter(f => f.endsWith('.map')).length, 1, `une seule carte de groupe, vus : ${groupes.join(' ')}`)
    await second.bundler.close()
  })
})

// un ALIAS de racine — pourquoi ces essais existent.
//
// Un composant rangé dans un dossier de même préfixe (`x-y/x-y-zed.mjs`) a DEUX clés au manifeste :
// `zed` et `x-y-zed`, pour le même fichier. Le groupe `{ "g": ["zed"] }` ne repointait que `zed` ; la
// clé sœur gardait le fichier séparé, donc une page qui écrit `<mjs-x-y-zed>` ET `<mjs-zed>` téléchargeait
// les deux fichiers, exécutait le code du composant deux fois et voyait « déjà défini par un autre
// bundle ». Deux clés d'un même fichier sont UN composant : toutes suivent le groupe, ou toutes restent
// dehors quand le composant est dans « except ».
describe('groupes de fichiers (bundles) — un composant à deux clés (alias de dossier)', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  const ALIAS: Record<string, string> = {
    'x-y/x-y-zed.mjs': '<p class="z">zed</p>\n',
    'coque.mjs':       '<mjs-x-y-zed></mjs-x-y-zed>\n',
    'dehors.mjs':      '<u class="d">dehors</u>\n<mjs-zed></mjs-zed>\n',
  }
  function projetAlias(etiquette: string): Projet {
    const p = projet('alias-' + etiquette)
    mkdirSync(join(p.srcDir, 'x-y'), { recursive: true })
    for (const [nom, src] of Object.entries(ALIAS)) writeFileSync(join(p.srcDir, nom), src)
    return p
  }
  const GROUPE_G = /^mjs_group-g-[0-9a-z]{5}\.js$/

  it('racine donnée par un alias : les deux clés du même fichier pointent le groupe', async () => {
    const p = projetAlias('racine')
    const { stats } = await compiler(p, { g: ['zed'] } as any)
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const groupe = fichiers(p).find(f => GROUPE_G.test(f))!
    assert.ok(groupe, 'fichier de groupe écrit')
    const table = paths(p)
    assert.equal(table['zed'], groupe)
    assert.equal(table['x-y-zed'], groupe, 'la clé sœur suit le groupe')
  })

  it('composant NON racine à deux clés : les deux suivent le groupe', async () => {
    const p = projetAlias('descendant')
    const { stats } = await compiler(p, { g: ['coque'] } as any)
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const groupe = fichiers(p).find(f => GROUPE_G.test(f))!
    const table  = paths(p)
    assert.equal(table['coque'], groupe)
    assert.equal(table['x-y-zed'], groupe)
    assert.equal(table['zed'], groupe, 'l\'alias aussi, même si le groupe ne l\'atteint que par son autre clé')
  })

  it('composant de « except » à deux clés : les deux restent dehors, en fichier séparé', async () => {
    const p = projetAlias('except')
    const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: join(p.outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', bundles: { g: { roots: ['coque'], except: ['zed'] } } } as any)
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const table = paths(p)
    assert.match(table['zed'], /^(x-y-)?zed-[0-9a-z]{5}\.js$/)
    assert.equal(table['zed'], table['x-y-zed'], 'même fichier séparé pour les deux clés')
    assert.equal(table['coque'].startsWith('mjs_group-g-'), true)
    await bundler.close()
  })

  it('le groupe n\'est annoncé qu\'une fois par fichier : le décompte des composants ne double pas les alias', async () => {
    const p = projetAlias('compte')
    const { bundler } = await compiler(p, { g: ['coque'] } as any)
    assert.ok(bundler.groupInfo.some(l => /\(2 composants/.test(l)), `deux composants (coque, zed), vus : ${bundler.groupInfo.join(' | ')}`)
    await bundler.close()
  })
})

// la précache — pourquoi ces essais existent.
//
// `mjs-precache.json` est la liste que lit un service worker pour mettre le site en cache. Elle
// nommait le fichier de groupe ET les fichiers séparés de ses composants : le code était téléchargé
// deux fois. Les fichiers séparés restent écrits (rendu serveur, composants hors groupe), mais un
// composant dont la clé pointe vers un groupe n'a plus de raison d'y figurer.
describe('groupes de fichiers (bundles) — la précache ne liste pas deux fois le même code', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le groupe est dans la précache, ses composants séparés non ; les composants hors groupe, le module et l\'effet y restent', async () => {
    const p = projet('precache')
    const { stats, bundler } = await compiler(p, { onglet: ['onglet'] })
    assert.equal(stats.errors.length, 0)
    const liste = (JSON.parse(readFileSync(join(p.outDir, 'mjs-precache.json'), 'utf-8')).assets as string[]).map(a => basename(a))
    assert.equal(liste.filter(f => GROUPE_RE.test(f)).length, 1, `le groupe, vus : ${liste.join(' ')}`)
    assert.deepEqual(liste.filter(f => /^(onglet|carte-a|carte-b|puce)-/.test(f)), [], 'aucun composant déjà dans le groupe')
    for (const nom of ['accueil', 'libre', 'partage.module', 'mjs_fx_glitch']) assert.ok(liste.some(f => f.startsWith(nom + '-')), `${nom} reste dans la précache`)
    // les fichiers séparés existent toujours sur disque
    assert.ok(fichiers(p).some(f => /^carte-a-[0-9a-z]{5}\.js$/.test(f)))
    await bundler.close()
  })

  it('sans groupe : la précache liste chaque composant, comme avant', async () => {
    const p = projet('precache-sans')
    const { bundler } = await compiler(p, undefined)
    const liste = (JSON.parse(readFileSync(join(p.outDir, 'mjs-precache.json'), 'utf-8')).assets as string[]).map(a => basename(a))
    for (const nom of ['onglet', 'carte-a', 'carte-b', 'puce']) assert.ok(liste.some(f => f.startsWith(nom + '-')), `${nom} dans la précache`)
    await bundler.close()
  })
})

// plusieurs groupes pour un même composant — pourquoi ces essais existent.
//
// Le besoin, mesuré sur un vrai site (14 groupes) : la construction s'arrêtait au PREMIER composant atteint par deux
// groupes. On le corrigeait, on relançait (une minute) et on tombait sur le suivant, trois fois de suite. Le message
// relève maintenant TOUS les conflits d'un coup : pour chaque composant, les groupes qui l'atteignent (liste abrégée
// au-delà de trois), puis ce qu'il faut écrire dans la configuration. La construction s'arrête toujours : seul le message
// change. Preuve : chaque essai applique le message À LA LETTRE (cf. `suivre`) — la ligne `"except"` collée aux groupes qu'il
// nomme, la liste complétée qu'il donne à un groupe qui a déjà un `except` — et construit sans erreur. Le message dit aussi
// ce que la ligne ne dit pas : un groupe écrit en liste devient un objet (seulement quand l'un des groupes à modifier est
// une liste), un `except` existant se complète au lieu de recevoir un second `except` qui le remplacerait en silence.
//
// Projet de l'essai : trois groupes (texte, carte, liste), une racine chacun ; trois composants partagés —
// `ui-checkbox` (les trois racines l'appellent), `ui-select` (texte et carte) qui appelle `ui-option`
// (que liste appelle aussi, directement).
describe('groupes de fichiers (bundles) — un composant dans plusieurs groupes : le message relève tout', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })
  afterEach(() => setMessagesLang('fr'))

  const PARTAGES: Record<string, string> = {
    'ui-checkbox.mjs': '<input type="checkbox" class="cb" aria-label="case">\n',
    'ui-option.mjs':   '<i class="op">option</i>\n',
    'ui-select.mjs':   '<select class="se" aria-label="choix"></select>\n<mjs-ui-option></mjs-ui-option>\n',
    'fx-texte.mjs':    '<p class="t">texte</p>\n<mjs-ui-checkbox></mjs-ui-checkbox>\n<mjs-ui-select></mjs-ui-select>\n',
    'fx-carte.mjs':    '<p class="c">carte</p>\n<mjs-ui-checkbox></mjs-ui-checkbox>\n<mjs-ui-select></mjs-ui-select>\n',
    'fx-liste.mjs':    '<p class="l">liste</p>\n<mjs-ui-checkbox></mjs-ui-checkbox>\n<mjs-ui-option></mjs-ui-option>\n',
  }
  const BUNDLES: Record<string, any> = { texte: ['fx-texte'], carte: ['fx-carte'], liste: ['fx-liste'] }
  const LISTE_PARTAGES               = ['ui-checkbox', 'ui-option', 'ui-select']

  // un composant (`ui-old`) que deux groupes laissent dehors depuis longtemps, un autre (`ui-new`) qu'ils atteignent tous deux
  const ANCIEN: Record<string, string> = {
    'ui-old.mjs': '<i class="o">ancien</i>\n',
    'ui-new.mjs': '<i class="n">nouveau</i>\n',
    'fx-a.mjs':   '<p class="a">a</p>\n<mjs-ui-old></mjs-ui-old>\n<mjs-ui-new></mjs-ui-new>\n',
    'fx-b.mjs':   '<p class="b">b</p>\n<mjs-ui-old></mjs-ui-old>\n<mjs-ui-new></mjs-ui-new>\n',
  }

  // une racine ne se laisse pas dehors (`except-racine`) : la ligne partagée ne la contient donc pas, et le message dit à part
  // où la mettre. `fx-a` appelle `fx-b`, racine du groupe `b` ; `fx-b` appelle `ui-x`.
  const RACINES: Record<string, string> = {
    'ui-x.mjs': '<i class="x">x</i>\n',
    'fx-b.mjs': '<p class="b">b</p>\n<mjs-ui-x></mjs-ui-x>\n',
    'fx-a.mjs': '<p class="a">a</p>\n<mjs-fx-b></mjs-fx-b>\n',
  }

  // `fx-a` appelle `fx-b`, racine du groupe `b`, qui n'appelle rien : le seul conflit est cette racine
  const RACINE_SEULE: Record<string, string> = {
    'fx-b.mjs': '<p class="b">b</p>\n',
    'fx-a.mjs': '<p class="a">a</p>\n<mjs-fx-b></mjs-fx-b>\n',
  }

  // `fx-s` est racine de deux groupes (`a` et `b`) et appelle `ui-y` ; `fx-c` et `fx-d` appellent `fx-s`
  const DEUX_RACINES: Record<string, string> = {
    'ui-y.mjs': '<i class="y">y</i>\n',
    'fx-s.mjs': '<p class="s">s</p>\n<mjs-ui-y></mjs-ui-y>\n',
    'fx-a.mjs': '<p class="a">a</p>\n',
    'fx-b.mjs': '<p class="b">b</p>\n',
    'fx-c.mjs': '<p class="c">c</p>\n<mjs-fx-s></mjs-fx-s>\n',
    'fx-d.mjs': '<p class="d">d</p>\n<mjs-fx-s></mjs-fx-s>\n',
  }
  const FORME   = '   Un groupe écrit en liste, ["racine"], devient { "roots": ["racine"], "except": [...] }.'
  const EXISTE  = '   Un groupe qui a déjà un "except" le complète, sans en ajouter un second qui remplacerait le premier :'
  const RETIRER = 'une racine ne peut pas être laissée dehors par "except". Gardez-le racine d\'un seul de ces groupes (ou réunissez-les) ; dans chacun des autres, retirez-le de "roots" et ajoutez-le à "except".'

  // cinq groupes qui atteignent tous le même composant : la liste de groupes dépasse trois
  function cinqGroupes(): { sources: Record<string, string>; bundles: Record<string, any> } {
    const sources: Record<string, string> = { 'ui-checkbox.mjs': '<input type="checkbox" class="cb" aria-label="case">\n' }
    const bundles: Record<string, any>    = {}
    for (const nom of ['cinq', 'deux', 'quatre', 'trois', 'un']) {
      sources[`fx-${nom}.mjs`] = `<p class="${nom}">${nom}</p>\n<mjs-ui-checkbox></mjs-ui-checkbox>\n`
      bundles[nom]             = [`fx-${nom}`]
    }
    return { sources, bundles }
  }

  // la ligne `"except": [...]` du message, et les groupes que la phrase qui la précède nomme entre parenthèses
  function conseil(message: string): { except: string[]; groupes: string[] } {
    const lignes = message.split('\n')
    const i      = lignes.findIndex(l => /^\s+"except": \[.*\]$/.test(l))
    assert.ok(i > 0, `la ligne "except" est attendue, vu :\n${message}`)
    const nommes = /\(([^)]*)\)\s?:$/.exec(lignes[i - 1])
    assert.ok(nommes, `les groupes sont attendus entre parenthèses avant la ligne, vu : ${lignes[i - 1]}`)
    return { except: JSON.parse('{' + lignes[i] + '}').except, groupes: nommes![1].split(', ') }
  }

  // ce que le message demande, appliqué À LA LETTRE à la configuration, sans rien fusionner qu'il ne dise :
  // - la ligne `"except": [...]` est collée comme clé à chaque groupe que la phrase qui la précède nomme ; sur un groupe qui a déjà un
  //   `except`, elle prendrait sa place (JSON garde la dernière clé) ; un groupe écrit en liste devient `{ roots: sa liste, except }`
  // - une ligne `groupe : "except": [...]` est la liste complète de ce groupe : elle remplace son `except`
  function suivre(message: string, bundles: Record<string, any>): Record<string, any> {
    const apres  = structuredClone(bundles)
    const lignes = message.split('\n')
    if (lignes.some(l => /^\s+"except": \[.*\]$/.test(l))) {
      const { except, groupes } = conseil(message)
      for (const nom of groupes) apres[nom] = Array.isArray(apres[nom]) ? { roots: apres[nom], except } : { ...apres[nom], except }
    }
    for (const l of lignes) {
      const m = /^\s+([a-z0-9-]+) ?: "except": (\[.*\])$/.exec(l)
      if (m) apres[m[1]] = { ...apres[m[1]], except: JSON.parse(m[2]) }
    }
    return apres
  }

  // ajoute des composants à l'`except` des groupes nommés (une consigne « ajoutez-le à "except" du groupe x ») : la forme courte devient la forme objet, un `except` existant est complété
  function ajouter(bundles: Record<string, any>, except: string[], groupes: string[]): Record<string, any> {
    return Object.fromEntries(Object.entries(bundles).map(([nom, conf]) => {
      const roots = Array.isArray(conf) ? conf : conf.roots
      return [nom, groupes.includes(nom) ? { roots, except: [...(Array.isArray(conf) ? [] : conf.except ?? []), ...except] } : conf]
    }))
  }

  // les composants que contient chaque fichier de groupe écrit, par nom de groupe
  const definisParGroupe = (p: Projet): Record<string, string[]> => Object.fromEntries(fichiers(p).filter(f => /^mjs_group-.+\.js$/.test(f)).map(f => [
    /^mjs_group-(.+)-[0-9a-z]{5}\.js$/.exec(f)![1],
    [...readFileSync(join(p.outDir, f), 'utf-8').matchAll(/\._def\("(mjs-[a-z-]+)"/g)].map(m => m[1]).sort(),
  ]))

  const sansErreur = (stats: { errors: any[] }) => assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

  it('tous les conflits d\'un coup : chaque composant et ses groupes, la ligne à ajouter, les groupes où l\'ajouter, la forme objet des listes ; aucun groupe n\'est écrit', async () => {
    const p            = projet('plusieurs-tout', PARTAGES)
    const { messages } = await compiler(p, BUNDLES)
    assert.equal(messages.length, 1, messages.join('\n'))
    assert.deepEqual(messages[0].split('\n'), [
      '[bundler] ✗ 3 composants sont dans plusieurs groupes : ui-checkbox, ui-option, ui-select',
      '   ui-checkbox : 3 groupes : carte, liste, texte',
      '   ui-option : 3 groupes : carte, liste, texte',
      '   ui-select : 2 groupes : carte, texte',
      '   Pour les sortir de ces groupes, ajoutez à chacun de ces groupes (carte, liste, texte) :',
      '   "except": ["ui-checkbox", "ui-option", "ui-select"]',
      FORME,
    ])
    assert.equal(fichiers(p).some(f => /^mjs_group-/.test(f)), false, 'aucun groupe écrit : la répartition est ambiguë')
  })

  it('la ligne du message, ajoutée aux groupes qu\'il nomme (écrits en liste), fait passer la construction : les partagés restent en fichiers séparés', async () => {
    const { messages }        = await compiler(projet('plusieurs-avant', PARTAGES), BUNDLES)
    const { except, groupes } = conseil(messages[0])
    assert.deepEqual(except, LISTE_PARTAGES)
    assert.deepEqual(groupes, ['carte', 'liste', 'texte'])
    const apres     = projet('plusieurs-apres', PARTAGES)
    const { stats } = await compiler(apres, suivre(messages[0], BUNDLES))
    sansErreur(stats)
    assert.deepEqual(definisParGroupe(apres), { carte: ['mjs-fx-carte'], liste: ['mjs-fx-liste'], texte: ['mjs-fx-texte'] }, 'chaque groupe ne contient plus que sa racine')
    const table = paths(apres)
    for (const nom of LISTE_PARTAGES) assert.match(table[nom], new RegExp(`^${nom}-[0-9a-z]{5}\\.js$`), `${nom} garde son fichier séparé`)
  })

  it('des groupes déjà en forme objet, sans except : la même ligne, et plus un mot sur la forme objet ; la construction passe', async () => {
    const objets       = { texte: { roots: ['fx-texte'] }, carte: { roots: ['fx-carte'] }, liste: { roots: ['fx-liste'] } }
    const { messages } = await compiler(projet('plusieurs-objets', PARTAGES), objets)
    assert.deepEqual(messages[0].split('\n').slice(4), [
      '   Pour les sortir de ces groupes, ajoutez à chacun de ces groupes (carte, liste, texte) :',
      '   "except": ["ui-checkbox", "ui-option", "ui-select"]',
    ])
    const { stats } = await compiler(projet('plusieurs-objets-apres', PARTAGES), suivre(messages[0], objets))
    sansErreur(stats)
  })

  it('un groupe qui a déjà un except : le message le complète (liste complète donnée), sans second except qui remplacerait le premier ; le groupe écrit en liste devient un objet', async () => {
    const bundles      = { a: { roots: ['fx-a'], except: ['ui-old'] }, b: ['fx-b'] }
    const { messages } = await compiler(projet('plusieurs-existant', ANCIEN), bundles)
    assert.deepEqual(messages[0].split('\n'), [
      '[bundler] ✗ 1 composant est dans plusieurs groupes : ui-new',
      '   ui-new : 2 groupes : a, b',
      '   Pour le sortir de ces groupes, ajoutez à ce groupe (b) :',
      '   "except": ["ui-new"]',
      EXISTE,
      '   a : "except": ["ui-old", "ui-new"]',
      FORME,
    ])
    // la ligne partagée collée au groupe qui avait déjà un except en prendrait la place : le premier except (ui-old) serait perdu
    const { except } = conseil(messages[0])
    const ecrase     = await compiler(projet('plusieurs-existant-ecrase', ANCIEN), { a: { roots: ['fx-a'], except }, b: { roots: ['fx-b'], except } })
    assert.match(ecrase.messages[0], /ui-old/, 'le témoin : coller la ligne partagée à ce groupe casse la construction sur l\'ancien composant')
    const apres     = projet('plusieurs-existant-apres', ANCIEN)
    const { stats } = await compiler(apres, suivre(messages[0], bundles))
    sansErreur(stats)
    assert.deepEqual(definisParGroupe(apres), { a: ['mjs-fx-a'], b: ['mjs-fx-b', 'mjs-ui-old'] })
  })

  it('tous les groupes ont déjà un except : pas de ligne partagée, la liste complétée de chacun ; aucun mot sur la forme objet ; la construction passe', async () => {
    const bundles      = { a: { roots: ['fx-a'], except: ['ui-old'] }, b: { roots: ['fx-b'], except: ['ui-old'] } }
    const { messages } = await compiler(projet('plusieurs-existants', ANCIEN), bundles)
    assert.deepEqual(messages[0].split('\n'), [
      '[bundler] ✗ 1 composant est dans plusieurs groupes : ui-new',
      '   ui-new : 2 groupes : a, b',
      EXISTE,
      '   a : "except": ["ui-old", "ui-new"]',
      '   b : "except": ["ui-old", "ui-new"]',
    ])
    const apres     = projet('plusieurs-existants-apres', ANCIEN)
    const { stats } = await compiler(apres, suivre(messages[0], bundles))
    sansErreur(stats)
    assert.deepEqual(definisParGroupe(apres), { a: ['mjs-fx-a'], b: ['mjs-fx-b'] })
  })

  it('un except existant mais vide : le groupe compte comme un groupe qui a un except, et reçoit sa liste complète comme les autres', async () => {
    const bundles      = { a: { roots: ['fx-a'], except: [] }, b: { roots: ['fx-b'] } }
    const { messages } = await compiler(projet('plusieurs-vide', ANCIEN), bundles)
    assert.deepEqual(messages[0].split('\n'), [
      '[bundler] ✗ 2 composants sont dans plusieurs groupes : ui-new, ui-old',
      '   ui-new : 2 groupes : a, b',
      '   ui-old : 2 groupes : a, b',
      '   Pour les sortir de ces groupes, ajoutez à ce groupe (b) :',
      '   "except": ["ui-new", "ui-old"]',
      EXISTE,
      '   a : "except": ["ui-new", "ui-old"]',
    ])
    const { stats } = await compiler(projet('plusieurs-vide-apres', ANCIEN), suivre(messages[0], bundles))
    sansErreur(stats)
  })

  it('liste abrégée au-delà de trois groupes (les deux premiers, puis « … »), au singulier pour un seul composant ; la phrase des groupes à modifier les nomme tous', async () => {
    const { sources, bundles } = cinqGroupes()
    const { messages }         = await compiler(projet('plusieurs-abrege', sources), bundles)
    assert.deepEqual(messages[0].split('\n'), [
      '[bundler] ✗ 1 composant est dans plusieurs groupes : ui-checkbox',
      '   ui-checkbox : 5 groupes : cinq, deux, …',
      '   Pour le sortir de ces groupes, ajoutez à chacun de ces groupes (cinq, deux, quatre, trois, un) :',
      '   "except": ["ui-checkbox"]',
      FORME,
    ])
    const { stats } = await compiler(projet('plusieurs-abrege-apres', sources), suivre(messages[0], bundles))
    sansErreur(stats)
  })

  it('en anglais : même relevé, même ligne, mêmes consignes, au pluriel puis au singulier', async () => {
    setMessagesLang('en')
    const { messages } = await compiler(projet('plusieurs-en', PARTAGES), BUNDLES)
    assert.deepEqual(messages[0].split('\n'), [
      '[bundler] ✗ 3 components are in several groups: ui-checkbox, ui-option, ui-select',
      '   ui-checkbox: 3 groups: carte, liste, texte',
      '   ui-option: 3 groups: carte, liste, texte',
      '   ui-select: 2 groups: carte, texte',
      '   To take them out of these groups, add to each of these groups (carte, liste, texte):',
      '   "except": ["ui-checkbox", "ui-option", "ui-select"]',
      '   A group written as a list, ["root"], becomes { "roots": ["root"], "except": [...] }.',
    ])
    const { sources, bundles } = cinqGroupes()
    const un                   = await compiler(projet('plusieurs-en-un', sources), bundles)
    assert.deepEqual(un.messages[0].split('\n'), [
      '[bundler] ✗ 1 component is in several groups: ui-checkbox',
      '   ui-checkbox: 5 groups: cinq, deux, …',
      '   To take it out of these groups, add to each of these groups (cinq, deux, quatre, trois, un):',
      '   "except": ["ui-checkbox"]',
      '   A group written as a list, ["root"], becomes { "roots": ["root"], "except": [...] }.',
    ])
    const existant = await compiler(projet('plusieurs-en-existant', ANCIEN), { a: { roots: ['fx-a'], except: ['ui-old'] }, b: ['fx-b'] })
    assert.deepEqual(existant.messages[0].split('\n'), [
      '[bundler] ✗ 1 component is in several groups: ui-new',
      '   ui-new: 2 groups: a, b',
      '   To take it out of these groups, add to this group (b):',
      '   "except": ["ui-new"]',
      '   A group that already has an "except" completes it, without adding a second one that would replace the first:',
      '   a: "except": ["ui-old", "ui-new"]',
      '   A group written as a list, ["root"], becomes { "roots": ["root"], "except": [...] }.',
    ])
    const racine = await compiler(projet('plusieurs-en-racine', RACINES), { a: { roots: ['fx-a'] }, b: { roots: ['fx-b'] } })
    assert.equal(racine.messages[0].split('\n').pop(), '   fx-b is a root of group b, where it stays: add it to "except" of group a only.')
    const deux = await compiler(projet('plusieurs-en-deux-racines', DEUX_RACINES), { a: { roots: ['fx-a', 'fx-s'] }, b: { roots: ['fx-b', 'fx-s'] }, c: { roots: ['fx-c'] } })
    assert.equal(deux.messages[0].split('\n').pop(), '   fx-s is a root of groups a, b: "except" cannot leave a root out. Keep it as a root of one of these groups only (or merge them); in each of the others, remove it from "roots" and add it to "except". Also add it to "except" of group c.')
    setMessagesLang('fr')
    const { stats } = await compiler(projet('plusieurs-en-apres', PARTAGES), suivre(messages[0], BUNDLES))
    sansErreur(stats)
  })

  it('la forme objet n\'est rappelée que si l\'un des groupes à modifier est écrit en liste', async () => {
    const lignes = async (etiquette: string, sources: Record<string, string>, bundles: Record<string, any>): Promise<string[]> => (await compiler(projet(etiquette, sources), bundles)).messages[0].split('\n')
    const vue    = (l: string[]) => l.includes(FORME)
    assert.equal(vue(await lignes('forme-listes', PARTAGES, BUNDLES)), true, 'tous en liste')
    assert.equal(vue(await lignes('forme-objets', PARTAGES, { texte: { roots: ['fx-texte'] }, carte: { roots: ['fx-carte'] }, liste: { roots: ['fx-liste'] } })), false, 'tous en objet')
    assert.equal(vue(await lignes('forme-existants', ANCIEN, { a: { roots: ['fx-a'], except: ['ui-old'] }, b: { roots: ['fx-b'], except: ['ui-old'] } })), false, 'tous en objet, avec except')
    assert.equal(vue(await lignes('forme-un-liste', ANCIEN, { a: { roots: ['fx-a'], except: ['ui-old'] }, b: ['fx-b'] })), true, 'un seul en liste')
    // le groupe en liste n'est nommé que par la consigne de la racine (aucun autre conflit) : la forme objet est rappelée aussi
    assert.equal(vue(await lignes('forme-racine-liste', RACINE_SEULE, { a: ['fx-a'], b: ['fx-b'] })), true, 'la consigne de la racine nomme le groupe a, écrit en liste')
    assert.equal(vue(await lignes('forme-racine-objet', RACINE_SEULE, { a: { roots: ['fx-a'] }, b: ['fx-b'] })), false, 'la consigne de la racine nomme le groupe a, écrit en objet : le groupe b, en liste, garde sa racine')
  })

  it('une racine atteinte par un autre groupe : hors de la ligne partagée, le message dit de l\'ajouter à « except » de l\'autre groupe seulement ; la construction passe', async () => {
    const bundles      = { a: ['fx-a'], b: ['fx-b'] }
    const { messages } = await compiler(projet('plusieurs-racine', RACINES), bundles)
    assert.deepEqual(messages[0].split('\n'), [
      '[bundler] ✗ 2 composants sont dans plusieurs groupes : fx-b, ui-x',
      '   fx-b : 2 groupes : a, b',
      '   ui-x : 2 groupes : a, b',
      '   Pour le sortir de ces groupes, ajoutez à chacun de ces groupes (a, b) :',
      '   "except": ["ui-x"]',
      '   fx-b est racine du groupe b, où il reste : ajoutez-le à "except" du groupe a seulement.',
      FORME,
    ])
    const autre = /ajoutez-le à "except" du groupe (\S+) seulement\.$/m.exec(messages[0])
    assert.ok(autre, messages[0])
    const apres     = projet('plusieurs-racine-apres', RACINES)
    const { stats } = await compiler(apres, ajouter(suivre(messages[0], bundles), ['fx-b'], [autre![1]]))
    sansErreur(stats)
    assert.deepEqual(definisParGroupe(apres), { a: ['mjs-fx-a'], b: ['mjs-fx-b'] })
  })

  it('une racine atteinte par plusieurs autres groupes : « des autres groupes » les nomme tous', async () => {
    const sources      = { ...RACINES, 'fx-c.mjs': '<p class="c">c</p>\n<mjs-fx-b></mjs-fx-b>\n' }
    const bundles      = { a: ['fx-a'], b: ['fx-b'], c: ['fx-c'] }
    const { messages } = await compiler(projet('plusieurs-racine-autres', sources), bundles)
    assert.ok(messages[0].split('\n').includes('   fx-b est racine du groupe b, où il reste : ajoutez-le à "except" des autres groupes (a, c) seulement.'), messages[0])
    const apres     = projet('plusieurs-racine-autres-apres', sources)
    const { stats } = await compiler(apres, ajouter(suivre(messages[0], bundles), ['fx-b'], ['a', 'c']))
    sansErreur(stats)
    assert.deepEqual(definisParGroupe(apres), { a: ['mjs-fx-a'], b: ['mjs-fx-b'], c: ['mjs-fx-c'] })
  })

  it('une racine de deux groupes : le message dit de la garder dans un seul et, dans l\'autre, de la retirer des racines ET de l\'ajouter à « except » ; la construction passe du premier coup', async () => {
    const bundles      = { a: ['fx-a', 'fx-s'], b: ['fx-b', 'fx-s'] }
    const { messages } = await compiler(projet('plusieurs-deux-racines', DEUX_RACINES), bundles)
    assert.deepEqual(messages[0].split('\n'), [
      '[bundler] ✗ 2 composants sont dans plusieurs groupes : fx-s, ui-y',
      '   fx-s : 2 groupes : a, b',
      '   ui-y : 2 groupes : a, b',
      '   Pour le sortir de ces groupes, ajoutez à chacun de ces groupes (a, b) :',
      '   "except": ["ui-y"]',
      `   fx-s est racine des groupes a, b : ${RETIRER}`,
      FORME,
    ])
    // la ligne seule laisse la racine : il ne reste qu'elle, dite seule, sans ligne « except »
    const { except } = conseil(messages[0])
    const reste      = await compiler(projet('plusieurs-deux-racines-ligne', DEUX_RACINES), suivre(messages[0], bundles))
    assert.deepEqual(reste.messages[0].split('\n'), [
      '[bundler] ✗ 1 composant est dans plusieurs groupes : fx-s',
      '   fx-s : 2 groupes : a, b',
      `   fx-s est racine des groupes a, b : ${RETIRER}`,
    ])
    // la consigne suivie : la racine gardée dans a ; dans b, retirée de « roots » et ajoutée à « except » (avec la ligne partagée)
    const apres     = projet('plusieurs-deux-racines-apres', DEUX_RACINES)
    const { stats } = await compiler(apres, { ...suivre(messages[0], bundles), b: { roots: ['fx-b'], except: [...except, 'fx-s'] } })
    sansErreur(stats)
    assert.deepEqual(definisParGroupe(apres), { a: ['mjs-fx-a', 'mjs-fx-s'], b: ['mjs-fx-b'] })
  })

  it('une racine de deux groupes que l\'un atteint aussi par une autre de ses racines : retirée des racines seulement, elle resterait en conflit ; avec « except », la consigne du message suffit', async () => {
    const bundles      = { a: ['fx-a', 'fx-s'], b: ['fx-b', 'fx-s', 'fx-c'] }
    const { messages } = await compiler(projet('plusieurs-racine-atteinte', DEUX_RACINES), bundles)
    assert.deepEqual(messages[0].split('\n'), [
      '[bundler] ✗ 2 composants sont dans plusieurs groupes : fx-s, ui-y',
      '   fx-s : 2 groupes : a, b',
      '   ui-y : 2 groupes : a, b',
      '   Pour le sortir de ces groupes, ajoutez à chacun de ces groupes (a, b) :',
      '   "except": ["ui-y"]',
      `   fx-s est racine des groupes a, b : ${RETIRER}`,
      FORME,
    ])
    const { except } = conseil(messages[0])
    const base       = suivre(messages[0], bundles)
    // le témoin : fx-s retirée des racines de b, sans « except » — b l'atteint encore par fx-c, le conflit reste (l'ancienne consigne exigeait un second tour)
    const seule = await compiler(projet('plusieurs-racine-atteinte-seule', DEUX_RACINES), { ...base, b: { roots: ['fx-b', 'fx-c'], except } })
    assert.match(seule.messages[0], /fx-s est racine du groupe a, où il reste/, 'sans « except », b atteint toujours fx-s par fx-c')
    const apres     = projet('plusieurs-racine-atteinte-apres', DEUX_RACINES)
    const { stats } = await compiler(apres, { ...base, b: { roots: ['fx-b', 'fx-c'], except: [...except, 'fx-s'] } })
    sansErreur(stats)
    assert.deepEqual(definisParGroupe(apres), { a: ['mjs-fx-a', 'mjs-fx-s'], b: ['mjs-fx-b', 'mjs-fx-c'] })
  })

  it('une racine de deux groupes que d\'autres groupes atteignent aussi : le message ajoute où la mettre dans « except », et la construction passe', async () => {
    const bundles      = { a: ['fx-a', 'fx-s'], b: ['fx-b', 'fx-s'], c: ['fx-c'], d: ['fx-d'] }
    const { messages } = await compiler(projet('plusieurs-deux-racines-autres', DEUX_RACINES), bundles)
    assert.deepEqual(messages[0].split('\n'), [
      '[bundler] ✗ 2 composants sont dans plusieurs groupes : fx-s, ui-y',
      '   fx-s : 4 groupes : a, b, …',
      '   ui-y : 4 groupes : a, b, …',
      '   Pour le sortir de ces groupes, ajoutez à chacun de ces groupes (a, b, c, d) :',
      '   "except": ["ui-y"]',
      `   fx-s est racine des groupes a, b : ${RETIRER} Ajoutez-le aussi à "except" des groupes (c, d).`,
      FORME,
    ])
    const { except } = conseil(messages[0])
    const apres      = projet('plusieurs-deux-racines-autres-apres', DEUX_RACINES)
    const corrige    = ajouter({ ...suivre(messages[0], bundles), b: { roots: ['fx-b'], except } }, ['fx-s'], ['b', 'c', 'd'])
    const { stats }  = await compiler(apres, corrige)
    sansErreur(stats)
    assert.deepEqual(definisParGroupe(apres), { a: ['mjs-fx-a', 'mjs-fx-s'], b: ['mjs-fx-b'], c: ['mjs-fx-c'], d: ['mjs-fx-d'] })
  })

  // le cas du vrai site : les composants du cœur (`<@@checkbox>`) sont des composants comme les autres pour les groupes
  it('un composant du cœur partagé par deux groupes : nommé comme le manifeste le nomme, et la ligne proposée fait passer la construction', async () => {
    const sources      = {
      'fx-texte.mjs': '<p class="t">texte</p>\n<@@checkbox aria-label="case"></@@checkbox>\n',
      'fx-carte.mjs': '<p class="c">carte</p>\n<@@checkbox aria-label="case"></@@checkbox>\n',
    }
    const bundles      = { texte: ['fx-texte'], carte: ['fx-carte'] }
    const { messages } = await compiler(projet('plusieurs-coeur', sources), bundles)
    assert.equal(messages.length, 1, messages.join('\n'))
    assert.match(messages[0], /^\[bundler\] ✗ \d+ composants? (?:est|sont) dans plusieurs groupes : .*core-checkbox/)
    const { except, groupes } = conseil(messages[0])
    assert.ok(except.includes('core-checkbox'), except.join())
    assert.deepEqual(groupes, ['carte', 'texte'])
    const { stats } = await compiler(projet('plusieurs-coeur-apres', sources), suivre(messages[0], bundles))
    sansErreur(stats)
  })

  it('un composant à deux clés (alias de dossier) compte pour un : nommé une fois, avec ses groupes ; la ligne le laisse dehors', async () => {
    const extra   = { 'coque.mjs': '<mjs-x-y-zed></mjs-x-y-zed>\n', 'dehors.mjs': '<u class="d">dehors</u>\n<mjs-zed></mjs-zed>\n' }
    const bundles = { g: ['coque'], h: ['dehors'] }
    const monter  = (etiquette: string) => {
      const p = projet(etiquette, extra)
      mkdirSync(join(p.srcDir, 'x-y'), { recursive: true })
      writeFileSync(join(p.srcDir, 'x-y', 'x-y-zed.mjs'), '<p class="z">zed</p>\n')
      return p
    }
    const { messages } = await compiler(monter('plusieurs-alias'), bundles)
    assert.deepEqual(messages[0].split('\n'), [
      '[bundler] ✗ 1 composant est dans plusieurs groupes : x-y-zed',
      '   x-y-zed : 2 groupes : g, h',
      '   Pour le sortir de ces groupes, ajoutez à chacun de ces groupes (g, h) :',
      '   "except": ["x-y-zed"]',
      FORME,
    ])
    const { stats } = await compiler(monter('plusieurs-alias-apres'), suivre(messages[0], bundles))
    sansErreur(stats)
  })

  // la CLI imprime la première ligne d'une erreur après un retrait de trois colonnes : les lignes suivantes du message portent le même
  it('par la vraie CLI : la première ligne du message et les suivantes sont alignées', () => {
    const p = projet('plusieurs-cli', PARTAGES)
    writeFileSync(join(p.root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', bundles: BUNDLES }, null, 2))
    const result = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--prod', '--root', p.root], { cwd: repoRoot, encoding: 'utf-8' })
    assert.equal(result.status, 1, `stderr:\n${result.stderr}\nstdout:\n${result.stdout}`)
    const lignes = result.stderr.split('\n')
    const debut  = lignes.findIndex(l => l.includes('[bundler] ✗ 3 composants'))
    assert.ok(debut >= 0, `le message est attendu sur la sortie d'erreur, vu :\n${result.stderr}`)
    const suite  = []
    for (let i = debut; i < lignes.length && (i === debut || /^\s/.test(lignes[i])); i++) suite.push(lignes[i])
    assert.equal(suite.length, 7, suite.join('\n'))
    assert.deepEqual(suite.map(l => l.length - l.trimStart().length), [3, 3, 3, 3, 3, 3, 3], `les sept lignes du message partent de la même colonne :\n${suite.join('\n')}`)
  })
})
