// Sans clé `runtime`, un module optionnel (ujs, modal, socket, spring…) n'entre au cœur que s'il est REPÉRÉ dans le code
// compilé du projet, comme les modules du cœur détectés. Une liste explicite garde son sens, `"runtime": "all"` écrit garde
// tout. Prudence : un usage qui ne laisse aucune trace dans les sources (navigation d'une vue serveur, confirmation, toast
// ou traduction depuis un script de la page) garde ujs, router, ajax, modal, vault et journal dès que le projet a des vues
// serveur (bloc `render`, dossier de vues à sa racine) ; les réglages de navigation écrits (`anchorHistory`,
// `viewTransition`, `preload`) gardent ujs. ujs emmène ses partenaires : router et ajax (sans eux l'interception reste
// inerte), modal (la question de `@confirm`, les messages renvoyés par le serveur). Un effet en direct (*follow, *cursors,
// *react, *heatmap) emmène socket, où vivent ses aides ; un effet à courbe (*travel, *path, *flipcard) emmène easing, où se
// lit une courbe nommée ; socket emmène schema (un serveur MJS-WS qui déclare un schéma encode ses messages en binaire sans
// regarder ce que la page sait lire). Ce qui reste de côté est nommé par une information de construction qui dit quoi écrire,
// lue sur le cœur tel qu'il part : un module emmené par un autre y compte comme gardé.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts, OPTIONAL_RUNTIME_MODULES } from '../src/bundler/config.js'

const fichier = (m: string) => m === 'vault' ? 'mjs_store_globals.ts' : 'mjs_' + m + '.ts'

// construit un petit projet, compile, puis rend la sélection tirée du relevé réel (celle que bundleRuntime a prise)
async function selection(composants: Record<string, string>, config: Record<string, unknown> = {}, avant?: (racine: string) => void, env: 'dev' | 'prod' = 'dev'): Promise<{ modules: string[]; infos: string[]; files: string[]; coreOnly: boolean; coeur: string | null }> {
  const racine = mjsTmp('runtime-repere')
  const src    = join(racine, 'src')
  mkdirSync(src, { recursive: true })
  for (const [nom, code] of Object.entries(composants)) writeFileSync(join(src, nom + '.mjs'), code)
  writeFileSync(join(racine, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', ...config }))
  if (avant) avant(racine)
  const trouve = findConfig(racine)!
  const ici    = process.cwd()
  process.chdir(racine)
  let b: Bundler
  try {
    b = new Bundler({ ...resolveBundlerOpts(trouve.config, trouve.configDir), env })
  }
  finally {
    process.chdir(ici)
  }
  const stats = await b.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const { files, infos, coreOnly } = b.resolveRuntimeFiles((b as any).collectUsedFeatures())
  const modules = OPTIONAL_RUNTIME_MODULES.filter(m => files.includes(fichier(m)))
  // le cœur écrit par la construction, tel quel
  const nomCoeur = readdirSync(join(racine, 'out')).find(f => /^mjs_core-.*\.js$/.test(f))
  return { modules, infos, files, coreOnly, coeur: nomCoeur ? readFileSync(join(racine, 'out', nomCoeur), 'utf-8') : null }
}

// la liste « prête à coller » de l'information, lue telle quelle (null si l'information n'en propose pas)
function listeProposee(infos: string[]): string[] | null {
  const m = infos.map(l => /"runtime": (\[[^\]]*\])/.exec(l)).find(x => x !== null)
  return m ? JSON.parse(m[1]) : null
}

// tous les modules optionnels, comme `"runtime": "all"` sans traduction configurée
const TOUS = OPTIONAL_RUNTIME_MODULES.filter(m => m !== 'i18n')

const SANS_RIEN = `<script>\n$ville = ''\n@chercher = -> $ville = ''\n</script>\n<form class="f" @submit.prevent={chercher()} @noUJS><input value=!{$ville}><button>ok</button></form>\n<p><a href="https://exemple.org/x" target="_blank" rel="noopener">source</a></p>`

describe('bundler — sans clé `runtime`, seuls les modules optionnels repérés partent au cœur', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('un formulaire `@noUJS` et un lien vers un autre site : aucun module optionnel', async () => {
    const { modules } = await selection({ 'meteo-app': SANS_RIEN })
    assert.deepEqual(modules, [], 'AVANT : tous les modules optionnels partaient (ujs, modal, socket…)')
  })

  it('un lien interne garde ujs, et avec lui router, ajax et modal', async () => {
    const { modules } = await selection({ 'menu-app': '<nav><a href="/produits">produits</a></nav>' })
    assert.deepEqual(modules, ['ajax', 'router', 'modal', 'ujs'])
  })

  it("une vue `<@view>` garde router, et avec lui ujs (l'adresse `#/…` changée passe par son écouteur), ajax et modal", async () => {
    const app = ['<script>', '  @routes =', "    'main':", "      '/':      'home-page'", "      '/about': 'about-page'", '</script>', '', '<@view main>'].join('\n')
    const { modules } = await selection({ 'app.page': app, 'home-page': '<h1>Accueil</h1>', 'about-page': '<h1>A propos</h1>' })
    assert.deepEqual(modules, ['ajax', 'router', 'modal', 'ujs'], 'AVANT : router seul, `location.hash = \'#/about\'` ne changeait plus la vue')
  })

  it('un formulaire ordinaire garde ujs, router, ajax et modal', async () => {
    const { modules } = await selection({ 'form-app': '<form action="/envoi" method="post"><button>ok</button></form>' })
    assert.deepEqual(modules, ['ajax', 'router', 'modal', 'ujs'])
  })

  it('µ.modal, µ.socket et sock.game écrits dans le script : modal, socket (avec schema) et game, rien de plus', async () => {
    const code = `<script>\n@ouvrir = -> µ.modal.fire({ title: 'Bonjour' })\n@jouer = ->\n  sock = µ.socket('/ws')\n  sock.game('pong')\n</script>\n<button @click={ouvrir()}>ouvrir</button>`
    const { modules } = await selection({ 'jeu-app': code })
    assert.deepEqual(modules, ['socket', 'schema', 'game', 'modal'])
  })

  // un effet en direct qui ouvre lui-même sa connexion (`server:`) : aucun `µsocket` dans le code, et ses aides vivent avec la connexion
  for (const [effet, code] of Object.entries({
    follow:  `<div class="z" *follow(server: 'wss://exemple.org/ws', lead: true)><p>zone</p></div>`,
    cursors: `<div class="z" *cursors(server: 'wss://exemple.org/ws')><p>zone</p></div>`,
    react:   `<@document *react(server: 'wss://exemple.org/ws')></@document>\n<p>page</p>`,
    heatmap: `<@document *heatmap(server: 'wss://exemple.org/ws')></@document>\n<p>page</p>`
  })) {
    it(`*${effet}(server: …), sans µsocket dans le code : socket est gardé, avec schema`, async () => {
      const { modules } = await selection({ 'direct-app': code })
      assert.deepEqual(modules, ['socket', 'schema'], 'AVANT : socket laissé de côté, l\'effet ne trouvait pas ses aides')
    })
  }

  // un effet dont la courbe peut être une courbe nommée (`easing: bounce-out`) : elle se lit dans µ.easing, sans trace dans les sources
  for (const [effet, code] of Object.entries({
    travel:   `<div class="t" *travel('.d', easing: bounce-out)><p>t</p></div>\n<div class="d"><p>d</p></div>`,
    path:     `<i class="a" *path(circle, easing: bounce-out)></i>`,
    flipcard: `<div class="a" *flipcard(easing: bounce-out)><p>recto</p><p>verso</p></div>`
  })) {
    it(`*${effet}(easing: bounce-out) : easing est gardé`, async () => {
      const { modules } = await selection({ 'courbe-app': code })
      assert.deepEqual(modules, ['easing'], 'AVANT : easing laissé de côté, la courbe nommée revenait en silence à une courbe simple')
    })
  }

  // un serveur temps réel (MJS-WS) qui déclare un schéma (`app.schema`) encode ses messages en binaire sans regarder ce que la
  // page sait lire ; l'écran les écoute par `sock.on` sans écrire `µ.schema` (rien à déclarer côté client : le serveur pousse ses schémas)
  it('un écran qui écoute son serveur par `sock.on`, sans `µ.schema` écrit : schema part avec socket', async () => {
    const code = `<script>\n$coup = 0\n@ecouter = ->\n  sock = µ.socket('wss://exemple.org/jeu')\n  sock.on('echecs.move', (p) -> $coup = p.n)\n</script>\n<button @click={ecouter()}>{$coup}</button>`
    const { modules } = await selection({ 'partie-app': code })
    assert.deepEqual(modules, ['socket', 'schema'], 'AVANT : schema laissé de côté, les coups encodés en binaire par le serveur étaient jetés sans un mot')
  })

  it('un bloc `render` (pages servies) garde ujs, router, ajax, modal, vault et journal', async () => {
    const { modules } = await selection({ 'meteo-app': SANS_RIEN }, { render: { routes: { '/': { component: 'mjs-meteo-app' } } } })
    assert.deepEqual(modules, ['vault', 'ajax', 'router', 'modal', 'ujs', 'journal'].sort((a, b) => OPTIONAL_RUNTIME_MODULES.indexOf(a as any) - OPTIONAL_RUNTIME_MODULES.indexOf(b as any)))
  })

  it('un dossier de vues serveur à la racine du projet (`app/views`) garde la même famille', async () => {
    const { modules } = await selection({ 'meteo-app': SANS_RIEN }, {}, (racine) => mkdirSync(join(racine, 'app', 'views'), { recursive: true }))
    assert.deepEqual(modules, ['vault', 'ajax', 'router', 'modal', 'ujs', 'journal'].sort((a, b) => OPTIONAL_RUNTIME_MODULES.indexOf(a as any) - OPTIONAL_RUNTIME_MODULES.indexOf(b as any)))
  })

  it('`"anchorHistory": true` garde ujs, router, ajax et modal', async () => {
    const { modules } = await selection({ 'meteo-app': SANS_RIEN }, { anchorHistory: true })
    assert.deepEqual(modules, ['ajax', 'router', 'modal', 'ujs'])
  })

  it("l'information de construction nomme ce qui reste de côté et dit quoi écrire", async () => {
    const { infos } = await selection({ 'menu-app': '<nav><a href="/produits">produits</a></nav>' })
    const ligne = infos.find(l => l.includes('"runtime": "all"'))
    assert.ok(ligne, 'information attendue : ' + infos.join(' | '))
    assert.match(ligne!, /gardés : ajax, router, modal, ujs ;/)
    assert.match(ligne!, /laissés de côté : .*socket/)
    assert.doesNotMatch(ligne!, /·/)
    assert.doesNotMatch(ligne!, /\[lint\./, 'une information, pas un avertissement : ni étiquette ni ligne d\'aide')
  })

  it("l'information de construction donne la liste gardée prête à coller, et dit qu'un serveur temps réel peut en demander plus", async () => {
    const { infos } = await selection({ 'menu-app': '<nav><a href="/produits">produits</a></nav>' })
    const ligne = infos.find(l => l.includes('"runtime": "all"'))
    assert.ok(ligne, 'information attendue : ' + infos.join(' | '))
    assert.ok(ligne!.includes('"runtime": ["ajax", "router", "modal", "ujs"]'), 'AVANT : aucune liste à coller : ' + ligne)
    assert.match(ligne!, /serveur temps réel qui parle à la page/, 'AVANT : le serveur temps réel n\'était jamais cité')
  })

  it("un module emmené par un autre compte comme gardé : avec `@transition` seul, easing n'est pas dit laissé de côté", async () => {
    const code = `<script>\n  $vu = true\n</script>\n\n{if $vu}\n  <p @transition=*fade>bonjour</p>\n{end}`
    const { modules, infos } = await selection({ 'essai-app': code })
    assert.deepEqual(modules, ['easing'], 'le moteur des transitions vit dans easing')
    const ligne = infos.find(l => l.includes('"runtime": "all"'))
    assert.ok(ligne, 'information attendue : ' + infos.join(' | '))
    assert.match(ligne!, /gardés : easing ;/, 'AVANT : « gardés : — »')
    assert.doesNotMatch(/laissés de côté : ([^.]*)\./.exec(ligne!)![1], /easing/, 'AVANT : easing dit laissé de côté alors qu\'il part au cœur')
    assert.ok(ligne!.includes('"runtime": ["easing"]'), ligne)
  })

  it('`"runtime": "all"` écrit garde tous les modules optionnels', async () => {
    const { modules, infos } = await selection({ 'meteo-app': SANS_RIEN }, { runtime: 'all' })
    assert.deepEqual(modules, OPTIONAL_RUNTIME_MODULES.filter(m => m !== 'i18n'))
    assert.equal(infos.some(l => l.includes('"runtime": "all"')), false)
  })

  it('une liste explicite garde son sens : exactement ses modules', async () => {
    const { modules } = await selection({ 'meteo-app': SANS_RIEN }, { runtime: ['modal'] })
    assert.deepEqual(modules, ['modal'])
  })

  // un accès que le repérage ne sait pas résoudre ne dit pas quel module sert : par prudence, tous restent, et l'information dit où
  for (const [cas, lignes, ligne] of [
    ['un indice calculé `µ[nom].fire`', ['<script>', '  ouvrir := ->', "    nom := 'mo' + 'dal'", "    µ[nom].fire { title: 'x' }", '</script>', '<button @click={ouvrir()}>a</button>'], 4],
    ['une déstructuration `{ ajax } := µ`', ['<script>', '  ouvrir := ->', '    { ajax } := µ', "    ajax '/x'", '</script>', '<button @click={ouvrir()}>a</button>'], 3],
    ['`µ` passé à une fonction', ['<script>', '  brancher := (m) -> m.modal.fire { title: \'x\' }', '', '  ouvrir := -> brancher µ', '</script>', '<button @click={ouvrir()}>a</button>'], 4]
  ] as Array<[string, string[], number]>) {
    it(`${cas} : tous les modules optionnels sont gardés, et l'information dit où et comment l'éviter`, async () => {
      const { modules, infos } = await selection({ 'calcul-app': lignes.join('\n') })
      assert.deepEqual(modules, TOUS, 'AVANT : aucun module gardé, l\'appel levait TypeError')
      const info = infos.find(l => l.includes('src/calcul-app.mjs:' + ligne))
      assert.ok(info, 'information attendue, avec le fichier et la ligne : ' + infos.join(' | '))
      assert.match(info!, /tous les modules optionnels/)
      assert.match(info!, /µ\.modal/, 'comment l\'éviter : écrire le nom après le point')
      assert.match(info!, /"runtime": \[/, 'ou écrire la liste')
    })
  }

  it("un accès que le repérage ne sait pas résoudre dans un module `.civet` : nommé à sa ligne du fichier", async () => {
    const composant = "@import go 'outil.module.civet'\n<script>\n  lancer := -> go()\n</script>\n<button @click={lancer()}>a</button>"
    const module    = "export go = ->\n  { modal } := µ\n  modal.fire { title: 'x' }\n"
    const { modules, infos } = await selection({ 'outil-app': composant }, {}, (racine) => writeFileSync(join(racine, 'src', 'outil.module.civet'), module))
    assert.deepEqual(modules, TOUS)
    assert.ok(infos.some(l => l.includes('src/outil.module.civet:2')), 'information attendue : ' + infos.join(' | '))
  })

  it("un accès que le repérage ne sait pas résoudre dans un fichier du manifeste externe : nommé à sa ligne du fichier", async () => {
    const { modules, infos } = await selection({ 'ext-app': '<p>x</p>' }, { manifestExternal: 'ext/manifest.js' }, (racine) => {
      mkdirSync(join(racine, 'ext'), { recursive: true })
      writeFileSync(join(racine, 'ext', 'manifest.js'), '#= require ./outil.js\n')
      writeFileSync(join(racine, 'ext', 'outil.js'), "window.ouvrir = () => {\n  const { modal } = µ\n  modal.fire({ title: 'x' })\n}\n")
    })
    assert.deepEqual(modules, TOUS)
    assert.ok(infos.some(l => l.includes('ext/outil.js:2')), 'information attendue : ' + infos.join(' | '))
  })

  it("témoins : `µ` cité dans une chaîne ou dans le texte du gabarit, et `typeof µ`, ne gardent rien de plus", async () => {
    const code = ['<script>', "  ok := -> typeof µ isnt 'undefined'", '  s := "µ[nom] reste du texte"', '</script>', '<p>le symbole µ seul, µ[nom] en prose</p>', '<button @click={ok()}>a</button>'].join('\n')
    const { modules, infos } = await selection({ 'texte-app': code })
    assert.deepEqual(modules, [])
    assert.equal(infos.some(l => l.includes('tous les modules optionnels')), false, infos.join(' | '))
  })

  it("`µ.ajax.binary(url, { schema })` garde schema avec ajax", async () => {
    const code = `<script>\n@charger = -> µ.ajax.binary('/coups', { schema: 'coup' })\n</script>\n<button @click={charger()}>a</button>`
    const { modules } = await selection({ 'coups-app': code })
    assert.deepEqual(modules, ['ajax', 'schema'], 'AVANT : ajax seul, l\'appel levait ajaxBinNoSchemaModule')
  })

  // `µ.ajax` lu en entier (rangé dans une variable, décomposé, passé à une fonction) ne dit pas quelle méthode sert : `binary`, qui décode
  // la réponse avec le codec de schema, peut en être une — schema est gardé avec ajax, et l'information dit où et comment l'éviter
  for (const [cas, lignes, ligne] of [
    ['`a := µ.ajax` puis `a.binary(…)`', ['<script>', '  charger := ->', '    a := µ.ajax', "    a.binary '/coups', { schema: 'coup' }", '</script>', '<button @click={charger()}>a</button>'], 3],
    ['une déstructuration `{ binary } := µ.ajax`', ['<script>', '  charger := ->', '    { binary } := µ.ajax', "    binary '/coups', { schema: 'coup' }", '</script>', '<button @click={charger()}>a</button>'], 3],
    ['`µ.ajax` passé à une fonction', ['<script>', "  lire := (a) -> a.binary '/coups', { schema: 'coup' }", '', '  charger := -> lire µ.ajax', '</script>', '<button @click={charger()}>a</button>'], 4]
  ] as Array<[string, string[], number]>) {
    it(`${cas} : schema est gardé avec ajax, et l'information dit où et comment l'éviter`, async () => {
      const { modules, infos } = await selection({ 'coups-app': lignes.join('\n') })
      assert.deepEqual(modules, ['ajax', 'schema'], 'AVANT : ajax seul, l\'appel levait ajaxBinNoSchemaModule')
      const info = infos.find(l => l.includes('src/coups-app.mjs:' + ligne))
      assert.ok(info, 'information attendue, avec le fichier et la ligne : ' + infos.join(' | '))
      assert.match(info!, /schema/)
      assert.match(info!, /µ\.ajax\.get/, 'comment l\'éviter : écrire la méthode après le point')
      assert.deepEqual(listeProposee(infos), ['ajax', 'schema'], 'la liste prête à coller garde schema')
    })
  }

  it("témoins : `µ.ajax.get(…)`, et `µ.ajax` cité dans une chaîne ou dans le texte du gabarit, ne gardent pas schema", async () => {
    const code = ['<script>', "  charger := -> µ.ajax.get '/x'", '  s := "µ.ajax reste du texte"', '</script>', '<p>µ.ajax en prose</p>', '<button @click={charger()}>a</button>'].join('\n')
    const { modules, infos } = await selection({ 'get-app': code })
    assert.deepEqual(modules, ['ajax'])
    assert.equal(infos.some(l => l.includes('get-app.mjs:')), false, infos.join(' | '))
  })

  // la liste proposée, collée, rend le même cœur, dans l'environnement de la construction
  it("en développement, sans module gardé : l'information ne propose pas `\"runtime\": []`, un cœur nu sans les outils de développement", async () => {
    const { infos, coreOnly } = await selection({ 'meteo-app': SANS_RIEN })
    assert.equal(coreOnly, false, 'le repérage garde les outils de développement')
    const ligne = infos.find(l => l.includes('"runtime": "all"'))
    assert.ok(ligne, 'information attendue : ' + infos.join(' | '))
    assert.equal(ligne!.includes('"runtime": []'), false, 'AVANT : « "runtime": [] » proposé, collé c\'était un cœur nu : ' + ligne)
  })

  for (const env of ['dev', 'prod'] as const) {
    it(`la liste proposée, collée dans mjs.config.json, rend le même cœur (${env})`, async () => {
      const defaut = await selection({ 'menu-app': '<nav><a href="/produits">produits</a></nav>' }, {}, undefined, env)
      const liste  = listeProposee(defaut.infos)
      assert.ok(liste, 'liste attendue : ' + defaut.infos.join(' | '))
      const collee = await selection({ 'menu-app': '<nav><a href="/produits">produits</a></nav>' }, { runtime: liste }, undefined, env)
      assert.deepEqual(collee.files, defaut.files)
      assert.equal(collee.coreOnly, defaut.coreOnly)
    })
  }

  // chat, accounts et lobby ne s'écrivent dans une liste que par le préréglage du même nom, qui emmène aussi smooth : collée, la
  // liste rendrait un autre cœur — l'information n'en propose aucune, dit pourquoi, et nomme toujours ce qui est gardé et laissé de côté
  const LIEN = '<nav><a href="/produits">produits</a></nav>'
  for (const [cas, composants, config, avant, gardes, prereglages] of [
    ['appli de salon réduite : un salon (`sock.chat`) et un lien interne', { 'salon-app': `<script>\n@parler = ->\n  sock = µ.socket('wss://exemple.org/ws')\n  sock.chat('salon')\n</script>\n<button @click={parler()}>a</button>\n${LIEN}` }, {}, undefined, 'ajax, socket, schema, chat, router, modal, ujs', /\bchat\b/],
    ['appli de jeu réduite : vues serveur, partie, salon, compte et lobby', { 'jeu-app': `<script>\n@jouer = ->\n  sock = µ.socket('wss://exemple.org/ws')\n  sock.game('pong')\n  sock.chat('salon')\n  sock.account.login('a', 'b')\n  sock.lobby.join('x')\n</script>\n<button @click={jouer()}>a</button>` }, {}, (racine: string) => mkdirSync(join(racine, 'app', 'views'), { recursive: true }), 'vault, ajax, socket, schema, game, chat, accounts, lobby, router, modal, ujs, journal', /chat, accounts, lobby/],
    ['un compte seul (`sock.account`)', { 'compte-app': `<script>\n@entrer = ->\n  sock = µ.socket('wss://exemple.org/ws')\n  sock.account.login('a', 'b')\n</script>\n<button @click={entrer()}>a</button>` }, {}, undefined, 'socket, schema, accounts', /\baccounts\b/],
    ['un lobby seul (`sock.lobby`)', { 'lobby-app': `<script>\n@entrer = ->\n  sock = µ.socket('wss://exemple.org/ws')\n  sock.lobby.join('x')\n</script>\n<button @click={entrer()}>a</button>` }, {}, undefined, 'socket, schema, lobby', /\blobby\b/]
  ] as Array<[string, Record<string, string>, Record<string, unknown>, ((racine: string) => void) | undefined, string, RegExp]>) {
    it(`${cas} : aucune liste à coller, l'information dit pourquoi (le préréglage emmène smooth)`, async () => {
      const { modules, infos } = await selection(composants, config, avant)
      assert.equal(modules.includes('smooth'), false, 'smooth n\'est pas gardé')
      const ligne = infos.find(l => l.includes('"runtime": "all"'))
      assert.ok(ligne, 'information attendue : ' + infos.join(' | '))
      assert.ok(ligne!.includes('gardés : ' + gardes + ' ;'), ligne)
      assert.match(ligne!, /laissés de côté : .*smooth/)
      assert.doesNotMatch(ligne!, /"runtime": \["/, 'AVANT : une liste proposée qui, collée, ajoutait smooth (et µ.Ticker) au cœur : ' + ligne)
      assert.match(ligne!, prereglages)
      assert.match(ligne!, /préréglage/)
      assert.match(ligne!, /emmène(nt)? aussi smooth/)
    })
  }

  // appli à vues serveur et appli en JavaScript réduites : la liste proposée, collée, rend le même cœur, à l'octet
  for (const [cas, composants, config, avant] of [
    ['appli à vues serveur réduite : aucun usage dans les composants', { 'meteo-app': SANS_RIEN }, {}, (racine: string) => mkdirSync(join(racine, 'app', 'views'), { recursive: true })],
    ['appli en JavaScript réduite : un lien interne', { 'menu-app': `<script>\nconst titre = 'menu'\n</script>\n${LIEN}` }, { defaultScriptLang: 'js' }, undefined]
  ] as Array<[string, Record<string, string>, Record<string, unknown>, ((racine: string) => void) | undefined]>) {
    it(`${cas} : la liste proposée, collée, rend le même cœur à l'octet`, async () => {
      const defaut = await selection(composants, config, avant, 'prod')
      const liste  = listeProposee(defaut.infos)
      assert.ok(liste, 'liste attendue : ' + defaut.infos.join(' | '))
      const collee = await selection(composants, { ...config, runtime: liste }, avant, 'prod')
      assert.ok(defaut.coeur !== null && collee.coeur !== null, 'cœur écrit attendu')
      assert.ok(collee.coeur === defaut.coeur, 'même cœur à l\'octet')
    })
  }

  it('faits inconnus (appel direct, sans relevé) : tous les modules optionnels, comme avant', () => {
    const { files } = new Bundler({}).resolveRuntimeFiles()
    assert.deepEqual(OPTIONAL_RUNTIME_MODULES.filter(m => files.includes(fichier(m))), OPTIONAL_RUNTIME_MODULES.filter(m => m !== 'i18n'))
  })
})
