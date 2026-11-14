// types : la forme appelable de µajax et `type:` se lisent pareil partout — dans le rappel d'un verbe, dans un module .coffee, .civet
// ou .js importé, dans un magasin ; dans un verbe, `type: Reward` (un type déclaré que rien ne lie dans le fichier) arrête la
// construction ; le signal porte l'adresse réelle de la page, coupée avant `?` et `#` ; un gestionnaire qui lève n'empêche pas le signal ; une valeur de
// départ entre accolades renvoie à la forme en retrait, et le texte d'une règle ne montre jamais une écriture refusée

import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseTypesBlock, parseRule, compileAjaxTypes, compileVars, checkAjaxVerbNames, type RuleAst } from '../src/transpiler/var-types.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { poserMessages } from './helpers/messages-stub.js'

const ICI  = dirname(fileURLToPath(import.meta.url))
const lire = (f: string): string => readFileSync(join(ICI, '../src/runtime', f), 'utf-8')

const T_REWARD = ['<types>', 'Reward', '  id     int 1..', '  title  string 1..80', '  price = 0 int 0..', '</types>'].join('\n')
const DEFS: Record<string, RuleAst> = {}
for (const d of parseTypesBlock(['', 'Reward', '  id int 1..', '  title string 1..80', '  price = 0 int 0..', 'Commande', '  id int 1..', '  adresse', '    ville string', "    cp = '' string"].join('\n'), 1)) DEFS[d.name] = d.rule

// l'appel compilé de la forme appelable, la règle de sa réponse, et la définition de la forme appelable (bloc gardé de mjs_ajax.ts)
const APPEL      = /µ\._mjs_ajax\s*\(/
const REGLE      = /µ\._mjs_tajax\s*\(/
const DEFINITION = /_mjs_ajax\s*=\s*function/

// une appli construite comme par `mjs build` : ses erreurs, et tout le JavaScript écrit (cœur, composants, modules)
async function construire(fichiers: Record<string, string>, o: { dev?: boolean } = {}): Promise<{ erreurs: string[], texte: string }> {
  const racine = mkdtempSync(join(tmpdir(), 'types-partout-'))
  try {
    const src = join(racine, 'src')
    const out = join(racine, 'out')
    mkdirSync(src, { recursive: true })
    for (const [nom, texte] of Object.entries(fichiers)) writeFileSync(join(src, nom), texte + '\n')
    const b: any = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(racine, 'bundle.js'), minify: false } as any)
    b.envMode = o.dev ? 'dev' : 'prod'
    const journal = [console.log, console.warn, console.error]
    console.log = console.warn = console.error = () => {}
    let st: any
    try {
      st = await b.compile()
    }
    finally {
      [console.log, console.warn, console.error] = journal
    }
    const js = existsSync(out) ? (readdirSync(out, { recursive: true }) as string[]).map(String).filter(f => f.endsWith('.js')) : []
    return { erreurs: (st.errors ?? []).map((e: any) => String(e?.message ?? e)), texte: js.map(f => readFileSync(join(out, f), 'utf-8')).join('\n') }
  }
  finally {
    rmSync(racine, { recursive: true, force: true })
  }
}

// la règle compilée d'un `type:`, premier argument de µ._mjs_tajax, en production qui signale
function regle(type: string): any {
  const m = /µ\._mjs_tajax\((\{.*\}), "mjs-boutique"\)/.exec(compileAjaxTypes(`r = await µajax '/app/rewards', type: ${type}`, DEFS, 'names', 1, 'mjs-boutique').code)
  assert.ok(m, 'règle compilée')
  return new Function(`return ${m![1]}`)()
}

// les runtimes des types et de µajax sur un même µ, en production qui signale ; `adresse` : la page affichée ; `routes` : les routes
// d'un composant de l'appli (le routeur entre alors avec elles)
function monter(adresse: { pathname: string, hash?: string }, routes?: Record<string, string>, corps = '{}'): any {
  const µ: any = { warnings: [] as string[], beacons: [] as any[], log() {}, warn(m: string) { µ.warnings.push(m) }, error() {}, _mjs_toRaw: (x: any) => x, _mjs_interpolatorSet: new WeakSet(), _mjs_storeRaw: {}, _runtimeLabelsLang: 'fr', _typesReport: '/errors/types' }
  poserMessages(µ)
  const navigator = { sendBeacon: (url: string, c: Blob) => { µ.beacons.push(c); return true } }
  const location  = { pathname: adresse.pathname, hash: adresse.hash ?? '', search: '', href: 'https://app.example' + adresse.pathname + (adresse.hash ?? '') }
  const reponse   = { status: 200, ok: true, url: 'https://app.example/x', headers: { get: (n: string) => n === 'content-type' ? 'application/json' : null }, json: async () => JSON.parse(corps), text: async () => corps }
  new Function('µ', 'navigator', 'location', lire('mjs_types.ts') + '\n' + lire('mjs_types_ajax.ts') + (routes ? '\n' + lire('mjs_router.ts') : ''))(µ, navigator, location)
  new Function('µ', 'fetch', 'document', lire('mjs_ajax.ts'))(µ, async () => reponse, { querySelector: () => null })
  if (routes) µ.Router._mjs_awareComponents.add({ routes: { principal: routes } })
  return µ
}
const signaux  = async (µ: any): Promise<any[]> => (await Promise.all(µ.beacons.map((b: Blob) => b.text()))).map((c: string) => JSON.parse(c))
const composant = (vars: string): any => ({ localName: 'mjs-boutique', _mjs_types: new Function(`return {${compileVars({ raw: vars, startLine: 1 }, DEFS, 'names').vars.join(',')}}`)() })

describe('la forme appelable dans le rappel d\'un verbe', function () {
  this.timeout(60000)
  after(() => terminateSharedWorkerPool())

  it('se compile comme ailleurs ; un verbe écrit dans un rappel garde sa règle', () => {
    assert.match(compileAjaxTypes("µajax.post '/a', {t: 1}, (r) ->\n  $r = await µajax '/b', type: Reward[]", DEFS, true, 1).code, REGLE)
    assert.match(compileAjaxTypes("µajax.post('/a', d, async (r) => { x = await µajax('/b', { type: Reward[] }) })", DEFS, true, 1).code, REGLE)
    assert.throws(() => compileAjaxTypes("µajax.post '/a', d, (r) ->\n  µajax.get '/b', type: Reward[], f", DEFS, true, 1), /ligne 2/)
    assert.throws(() => compileAjaxTypes("µajax.post '/a', d, -> µajax.get '/b', type: Reward[], f", DEFS, true, 1), /µajax '\/url', type: Reward\[\]/)
  })

  for (const dev of [false, true]) {
    it(`une appli qui l'écrit se construit — ${dev ? 'développement' : 'production'}`, async () => {
      const { erreurs, texte } = await construire({ 'app.types.mjs': T_REWARD, 'alpha.mjs': "<script>\nenvoyer = ->\n  µajax.post '/app/rewards', {title: 'x'}, ->\n    $r = await µajax '/app/rewards', type: Reward[]\n</script>\n<p>{$r}</p>" }, { dev })
      assert.deepEqual(erreurs, [])
      for (const re of [APPEL, REGLE, DEFINITION]) assert.match(texte, re)
    })
  }
})

describe('modules importés et magasin : la même réécriture avant la lecture par le langage', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())
  const appli = (module: string, texte: string): Record<string, string> => ({ 'app.types.mjs': T_REWARD, [module]: texte, 'alpha.mjs': `<script>\n@import { charger } '${module}'\nload = -> $r = await charger()\n</script>\n<p>{$r}</p>` })
  const cas: [string, Record<string, string>, RegExp[]][] = [
    ['module .coffee, type: Reward[]', appli('charger.coffee.mjs', "export charger = -> await µajax '/app/rewards', type: Reward[]"), [APPEL, REGLE, DEFINITION]],
    ['module .coffee sans type: (le module µajax et son bloc d\'appel entrent)', appli('charger.coffee.mjs', "export charger = -> await µajax '/app/rewards'"), [APPEL, DEFINITION]],
    ['module .civet, type: Reward[]', appli('charger.civet.mjs', "export async function charger() { return await µajax('/app/rewards', { type: Reward[] }) }"), [APPEL, REGLE, DEFINITION]],
    ['module .js, type: Reward[]', appli('charger.js.mjs', "export async function charger () { return await µajax('/app/rewards', { type: Reward[] }) }"), [APPEL, REGLE, DEFINITION]],
    ['magasin, type: Reward[]', { 'app.types.mjs': T_REWARD, 'rewards.module.civet.mjs': "export µ$$rewards = { liste: [] }\nexport async function recharger() { µ$$rewards.liste = await µajax('/app/rewards', { type: Reward[] }) }", 'alpha.mjs': "<script>\n@import µ$$rewards 'rewards.module.civet.mjs'\n</script>\n<p>{µ$$rewards.liste.length}</p>" }, [APPEL, REGLE, DEFINITION]],
  ]
  for (const dev of [false, true]) {
    for (const [nom, fichiers, attendus] of cas) {
      it(`${nom} — ${dev ? 'développement' : 'production'}`, async () => {
        const { erreurs, texte } = await construire(fichiers, { dev })
        assert.deepEqual(erreurs, [])
        for (const re of attendus) assert.match(texte, re)
      })
    }
  }
})

describe('`type: Reward` dans un verbe', function () {
  this.timeout(60000)
  after(() => terminateSharedWorkerPool())

  it('un type déclaré que rien ne lie dans le fichier : la construction s\'arrête et montre la forme courte ; un nom lié reste une donnée', () => {
    // le nom se cherche sur le code compilé du fichier (ici écrit à la main)
    const verifier = (src: string, js: string): void => checkAjaxVerbNames(js, compileAjaxTypes(src, DEFS, true, 1).aLier)
    assert.throws(() => verifier("µajax.get '/app/rewards', type: Reward, (r) -> $x = r", "µ.ajax.get('/app/rewards', { type: Reward }, (r) => r)"), (e: any) => /ligne 1/.test(e.message) && e.message.includes("µajax '/url', type: Reward "))
    assert.throws(() => verifier("x = 1\nµajax.post '/x', {type: Reward}, f", "var x; x = 1; µ.ajax.post('/x', { type: Reward }, f)"), (e: any) => /ligne 2/.test(e.message) && e.message.includes("method: 'POST'"))
    for (const src of ["Reward = 'cadeau'\nµajax.get '/x', type: Reward, f", "envoyer = (Reward) -> µajax.post '/x', {type: Reward}, f", "µajax.get '/x', type: kind, f", "µajax.get '/x', type: Inconnu, f", "µajax.get '/x', (r) ->\n  x = type: Reward"]) assert.equal(compileAjaxTypes(src, DEFS, true, 1).code, src, src)
  })

  for (const dev of [false, true]) {
    it(`une appli qui l'écrit ne se construit pas, sauf si le nom est lié dans le fichier — ${dev ? 'développement' : 'production'}`, async () => {
      const verbe = "µmount ->\n  µajax.get '/app/rewards', type: Reward, (r) -> $x = r\n</script>\n<p>{$x}</p>"
      const { erreurs } = await construire({ 'app.types.mjs': T_REWARD, 'verbe.mjs': '<script>\n' + verbe }, { dev })
      assert.equal(erreurs.length, 1, erreurs.join('\n'))
      assert.match(erreurs[0], /µajax '\/url', type: Reward /)
      const lie = await construire({ 'app.types.mjs': T_REWARD, 'verbe.mjs': "<script module>\nReward = 'cadeau'\n</script>\n<script>\n" + verbe }, { dev })
      assert.deepEqual(lie.erreurs, [])
    })
  }
})

describe('le signal : l\'adresse réelle de la page, coupée avant `?` et `#`', () => {
  it('sans route, l\'adresse réelle de la page', async () => {
    const µ = monter({ pathname: '/users/jean.dupont@exemple.fr/boutique' })
    µ._mjs_tset(composant('\n$v int 0..10'), 'v', 'abc')
    assert.deepEqual(await signaux(µ), [{ path: '$v', component: 'mjs-boutique', page: '/users/jean.dupont@exemple.fr/boutique', type: 'string' }])
  })

  it('avec des routes, l\'adresse réelle aussi : ni le modèle de la route, ni ce qui suit `#`', async () => {
    const µ = monter({ pathname: '/compte/jean.dupont@exemple.fr', hash: '#/users/jean.dupont@exemple.fr/boutique' }, { '/': 'accueil', '/users/:nom/boutique': 'boutique' })
    µ._mjs_tset(composant('\n$v int 0..10'), 'v', 'abc')
    assert.deepEqual(await signaux(µ), [{ path: '$v', component: 'mjs-boutique', page: '/compte/jean.dupont@exemple.fr', type: 'string' }])
  })
})

describe('un gestionnaire qui lève', () => {
  it('le signal part quand même, puis l\'erreur du gestionnaire remonte — écriture refusée, réponse refusée', async () => {
    const µ = monter({ pathname: '/boutique' }, undefined, '[{"id":"x","title":"t"}]')
    µ.types.onError(() => { throw new Error('gestionnaire qui lève') })
    assert.throws(() => µ._mjs_tset(composant('\n$v int 0..10'), 'v', 'abc'), /gestionnaire qui lève/)
    assert.equal(µ.beacons.length, 1)
    await assert.rejects(µ._mjs_ajax('/app/rewards', { type: µ._mjs_tajax(regle('Reward[]'), 'mjs-boutique') }), /gestionnaire qui lève/)
    assert.equal(µ.beacons.length, 2)
    assert.deepEqual((await signaux(µ)).map(s => s.path), ['$v', '[0].id'])
    const µ2 = monter({ pathname: '/boutique' }, undefined, '[{"id":"x","title":"t"}]')
    await assert.rejects(µ2._mjs_ajax('/app/rewards', { type: µ2._mjs_tajax(regle('Reward[]'), 'mjs-boutique'), typeError: () => { throw new Error('rappel qui lève') } }), /rappel qui lève/)
    assert.equal(µ2.beacons.length, 1)
  })
})

describe('accolades : refusées, valeur de départ comprise, renvoi à la forme en retrait', () => {
  it('`=` avant ou après les deux-points : le message renvoie au type nommé et montre la forme à écrire', () => {
    for (const r of ['{ price = 0 int 0.. }', '{ price: = 0 int 0.. }', '{ price = 0: int 0.. }']) assert.throws(() => parseRule(r, { bloc: '<vars>', ligne: 1 }), (e: any) => /\*\.types\.mjs/.test(e.message) && e.message.includes('price = 0  int 0..'), r)
  })

  it('le texte d\'un objet imbriqué qui a une valeur de départ se relit tel quel : jamais une écriture refusée', () => {
    const objets = (compileVars({ raw: '\n$c Commande', startLine: 1 }, DEFS, true).vars.join(',').match(/d:"[^"]*"/g) ?? []).map(d => JSON.parse(d.slice(2)) as string).filter(d => d.startsWith('\n'))
    assert.equal(objets.length, 1, objets.join(' · '))
    assert.match(objets[0], /^\n {2}ville {2}string\n {2}cp = .+ {2}string$/)
    for (const o of objets) assert.doesNotThrow(() => parseTypesBlock('Relu' + o, 1), o)
  })
})

describe('modules et magasins : une règle changée les recompile en développement ; leurs messages nomment le fichier', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  // une appli de développement construite deux fois par le même bundler, comme `mjs dev` après un changement : entre les deux, la borne
  // de `id` passe de 1 à 5 dans app.types.mjs ; rend le JavaScript écrit pour les fichiers dont le nom commence par `nom`, après
  // chaque construction
  async function deuxFois(fichiers: Record<string, string>, nom: string): Promise<[string, string]> {
    const racine = mkdtempSync(join(tmpdir(), 'types-dev-'))
    const journal = [console.log, console.warn, console.error]
    try {
      const src = join(racine, 'src')
      const out = join(racine, 'out')
      mkdirSync(src, { recursive: true })
      for (const [n, texte] of Object.entries({ 'app.types.mjs': T_REWARD, ...fichiers })) writeFileSync(join(src, n), texte + '\n')
      const b: any = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(racine, 'bundle.js'), minify: false } as any)
      b.envMode = 'dev'
      const ecrit = (): string => (readdirSync(out, { recursive: true }) as string[]).map(String).filter(f => f.split('/').pop()!.startsWith(nom) && f.endsWith('.js')).map(f => readFileSync(join(out, f), 'utf-8')).join('\n')
      console.log = console.warn = console.error = () => {}
      const a: any = await b.compile()
      assert.deepEqual((a.errors ?? []).map(String), [])
      const avant = ecrit()
      writeFileSync(join(src, 'app.types.mjs'), T_REWARD.replace('id     int 1..', 'id     int 5..') + '\n')
      const c: any = await b.compile()
      assert.deepEqual((c.errors ?? []).map(String), [])
      return [avant, ecrit()]
    }
    finally {
      [console.log, console.warn, console.error] = journal
      rmSync(racine, { recursive: true, force: true })
    }
  }

  it('module .coffee qui cite une règle nommée : la borne changée entre dans son contrôle, sans relancer', async () => {
    const [avant, apres] = await deuxFois({ 'charger.coffee.mjs': "export charger = -> await µajax '/app/rewards', type: Reward[]", 'alpha.mjs': "<script>\n@import { charger } 'charger.coffee.mjs'\nload = -> $r = await charger()\n</script>\n<p>{$r}</p>" }, 'charger')
    assert.match(avant, /int 1\.\./)
    assert.match(apres, /int 5\.\./)
  })

  it('magasin qui cite une règle nommée : la borne changée entre dans son contrôle, sans relancer', async () => {
    const [avant, apres] = await deuxFois({ 'rewards.module.civet.mjs': "export µ$$rewards = { liste: [] }\nexport async function recharger() { µ$$rewards.liste = await µajax('/app/rewards', { type: Reward[] }) }", 'alpha.mjs': "<script>\n@import µ$$rewards 'rewards.module.civet.mjs'\n</script>\n<p>{µ$$rewards.liste.length}</p>" }, 'rewards')
    assert.match(avant, /int 1\.\./)
    assert.match(apres, /int 5\.\./)
  })

  it('le refus d\'un verbe et un nom de type inconnu nomment le module, à sa ligne dans le fichier', async () => {
    const appli = (module: string, texte: string): Record<string, string> => ({ 'app.types.mjs': T_REWARD, [module]: texte, 'alpha.mjs': `<script>\n@import { charger } '${module}'\nload = -> $r = await charger()\n</script>\n<p>{$r}</p>` })
    const cas: [string, string, number][] = [
      ['charger.coffee.mjs', "# charge les cadeaux\nexport charger = -> µajax.get '/app/rewards', type: Reward, (r) -> r", 2],
      ['charger.coffee.mjs', "x = 1\n\nexport charger = -> await µajax '/app/rewards', type: Rewardz[]", 3],
      ['charger.civet.mjs', "x := 1\nexport async function charger() { return await µajax('/app/rewards', { type: Rewardz[] }) }", 2],
      ['charger.js.mjs', "export async function charger () {\n  return await µajax('/app/rewards', { type: Rewardz[] })\n}", 2],
    ]
    for (const [module, texte, ligne] of cas) {
      const { erreurs } = await construire(appli(module, texte))
      assert.equal(erreurs.length, 1, erreurs.join('\n'))
      assert.ok(erreurs[0].includes(`${module}, ligne ${ligne}`) && !erreurs[0].includes('<script>'), erreurs[0])
    }
  })
})
