// types : chaque forme de `µajax url, options` se construit seule (développement et production, sans clé `runtime`) ; `type:` ne
// contrôle la réponse qu'au premier niveau des options de cette forme (jamais dans `data:`, un objet imbriqué ni un appel par verbe) ;
// `µtypes.onError` passe avant le signal ; le signal ne porte rien de personnel (chemin dans la donnée, nom de la règle nommée, jamais
// l'adresse de la requête ni le texte des règles) ; `strict` laisse un champ absent prendre sa valeur de départ ; la marque de `strict`
// ne se confond pas avec la clé d'un attribut étalé ; une clé entre guillemets dans la forme en retrait

import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseTypesBlock, parseVarsBlock, parseRule, ruleText, compileAjaxTypes, compileVars, type RuleAst } from '../src/transpiler/var-types.js'
import { scanCompiledFeatures, TYPES_STRICT } from '../src/bundler/features.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { poserMessages } from './helpers/messages-stub.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const lire      = (f: string): string => readFileSync(join(ICI, '../src/runtime', f), 'utf-8')
const TYPES_SRC = lire('mjs_types.ts')
const TAJAX_SRC = lire('mjs_types_ajax.ts')
const AJAX_SRC  = lire('mjs_ajax.ts')

const T_REWARD = ['<types>', 'Reward', '  id     int 1..', '  title  string 1..80', '  price = 0 int 0..', '</types>'].join('\n')
const DEFS: Record<string, RuleAst> = {}
for (const d of parseTypesBlock(['', 'Reward', '  id int 1..', '  title string 1..80', '  price = 0 int 0..'].join('\n'), 1)) DEFS[d.name] = d.rule

// une appli construite comme par `mjs build` : ses erreurs, et tout le JavaScript écrit (cœur et composants)
async function construire(fichiers: Record<string, string>, o: { dev?: boolean, minify?: boolean, js?: boolean, typesReport?: string } = {}): Promise<{ erreurs: string[], texte: string }> {
  const racine = mkdtempSync(join(tmpdir(), 'types-construit-'))
  try {
    const src = join(racine, 'src')
    const out = join(racine, 'out')
    mkdirSync(src, { recursive: true })
    for (const [nom, texte] of Object.entries(fichiers)) writeFileSync(join(src, nom), texte + '\n')
    const b: any = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(racine, 'bundle.js'), minify: o.minify === true, ...(o.js ? { defaultScriptLang: 'js' } : {}), ...(o.typesReport ? { typesReport: o.typesReport } : {}) } as any)
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
    return { erreurs: (st.errors ?? []).map(String), texte: js.map(f => readFileSync(join(out, f), 'utf-8')).join('\n') }
  }
  finally {
    rmSync(racine, { recursive: true, force: true })
  }
}

// la règle compilée d'un `type:`, premier argument de µ._mjs_tajax ; `texte` : true (développement), 'names' (production qui signale)
function regle(type: string, texte: boolean | 'names'): any {
  const m = /µ\._mjs_tajax\((\{.*\}), "mjs-boutique"\)/.exec(compileAjaxTypes(`r = await µajax '/app/rewards', type: ${type}`, DEFS, texte as any, 1, 'mjs-boutique').code)
  assert.ok(m, 'règle compilée')
  return new Function(`return ${m![1]}`)()
}

// les runtimes des types et de µajax sur un même µ, en production ; `signal` : `typesReport`
function monter(o: { mode?: string, signal?: string, corps?: string } = {}): any {
  const µ: any = { warnings: [] as string[], beacons: [] as any[], log() {}, warn(m: string) { µ.warnings.push(m) }, error() {}, _mjs_toRaw: (x: any) => x, _mjs_interpolatorSet: new WeakSet(), _mjs_storeRaw: {}, _runtimeLabelsLang: 'fr' }
  if (o.mode) µ._typesMode = o.mode
  if (o.signal) µ._typesReport = o.signal
  poserMessages(µ)
  const navigator = { sendBeacon: (url: string, corps: Blob) => { µ.beacons.push({ url, corps }); return true } }
  const reponse   = { status: 200, ok: true, url: 'https://app.example/x', headers: { get: (n: string) => n === 'content-type' ? 'application/json' : null }, json: async () => JSON.parse(o.corps ?? '{}'), text: async () => o.corps ?? '{}' }
  new Function('µ', 'navigator', 'location', TYPES_SRC + '\n' + TAJAX_SRC)(µ, navigator, { pathname: '/boutique' })
  new Function('µ', 'fetch', 'document', AJAX_SRC)(µ, async () => reponse, { querySelector: () => null })
  return µ
}

// un composant dont le bloc <vars> est `vars`
function composant(vars: string, texte: boolean | 'names' = true): any {
  return { localName: 'mjs-lecteur', _mjs_types: new Function(`return {${compileVars({ raw: vars, startLine: 1 }, DEFS, texte as any).vars.join(',')}}`)() }
}

describe('chaque forme de µajax se construit seule, sans clé runtime', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())
  const DEFINITION = /method:\s*['"]GET['"],\s*success:/
  const APPEL      = "<script>\nload = -> $r = await µajax '/app/rewards', type: Reward[], typeError: (e) -> []\n</script>\n<p>{$r}</p>"
  const CAS: [string, { dev?: boolean, minify?: boolean }][] = [['production', {}], ['production minifiée', { minify: true }], ['développement', { dev: true }]]

  for (const [nom, o] of CAS) {
    it(`µajax '/url', type: Reward[], typeError: f — seul appel de l'appli, ${nom}`, async () => {
      const { erreurs, texte } = await construire({ 'app.types.mjs': T_REWARD, 'alpha.mjs': APPEL }, o)
      assert.deepEqual(erreurs, [])
      assert.match(texte, DEFINITION, texte.slice(Math.max(0, texte.indexOf('GET') - 300), texte.indexOf('GET') + 200) || 'aucun GET')
    })
  }

  it("µajax '/url' sans options, seul — production", async () => {
    const { erreurs, texte } = await construire({ 'alpha.mjs': "<script>\nload = -> $r = await µajax '/app/rewards'\n</script>\n<p>{$r}</p>" })
    assert.deepEqual(erreurs, [])
    assert.match(texte, DEFINITION, texte.slice(Math.max(0, texte.indexOf('GET') - 300), texte.indexOf('GET') + 200) || 'aucun GET')
  })

  it("script JavaScript : µajax ('/url'), une espace avant la parenthèse — production", async () => {
    const { erreurs, texte } = await construire({ 'alpha.mjs': "<script>\nasync function load() { $r = await µajax ('/app/rewards') }\n</script>\n<p>{$r}</p>" }, { js: true })
    assert.deepEqual(erreurs, [])
    assert.match(texte, DEFINITION, texte.slice(Math.max(0, texte.indexOf('GET') - 300), texte.indexOf('GET') + 200) || 'aucun GET')
  })

  it('un appel par verbe dont la donnée porte `type:` (une règle de nom voisin déclarée) se construit, la donnée intacte', async () => {
    const { erreurs, texte } = await construire({ 'app.types.mjs': T_REWARD, 'alpha.mjs': "<script>\nreward = 'cadeau'\nenvoyer = -> µajax.post '/x', {type: reward}, (r) -> $r = r\n</script>\n<p>{$r}</p>" })
    assert.deepEqual(erreurs, [])
    assert.ok(!/_mjs_tajax/.test(texte))
  })

  it('production avec typesReport : aucun texte de règle dans le composant, le nom de la règle nommée seulement', async () => {
    const { erreurs, texte } = await construire({ 'app.types.mjs': T_REWARD, 'alpha.mjs': '<vars>\n$volume int 0..100\n$r Reward\n</vars>\n<p>{$volume}</p>' }, { typesReport: '/errors/types' })
    assert.deepEqual(erreurs, [])
    const texteDeRegle = /\bd:\s*["'](?:int 0\.\.100|string 1\.\.80|int 1\.\.)/.exec(texte)
    assert.ok(texteDeRegle === null, texteDeRegle === null ? '' : texte.slice(texteDeRegle.index - 160, texteDeRegle.index + 60))
    assert.match(texte, /["']Reward["']/)
  })
})

describe('`type:` à sa place seulement : le premier niveau des options de la forme appelable', () => {
  const compiler = (code: string): string => compileAjaxTypes(code, DEFS, true, 1).code

  it('un appel par verbe garde sa donnée `type:`, comme avant', () => {
    for (const src of ["µajax.post '/x', {type: reward}, f", "Reward = 'cadeau'\nµajax.post '/x', {type: Reward}, f", "Reward = 'cadeau'\nµajax.get '/x', type: Reward", "µajax.get '/app/rewards', (r) ->\n  x = type: Reward"]) assert.equal(compiler(src), src, src)
  })

  it('`data:`, un objet imbriqué ou un rappel gardent leur `type:`', () => {
    const cas = [
      "r = await µajax '/x', method: 'POST', data: {type: reward}",
      "r = await µajax '/x', method: 'POST', data: {type: Reward}",
      "r = await µajax '/x', method: 'POST', data: {a: 1, type: Reward}",
      "r = await µajax '/x', data: type: Reward",
      "r = await µajax '/x', method: 'POST', data:\n  type: Reward",
      "r = await µajax '/x',\n  method: 'POST'\n  data:\n    type: Reward",
      "r = await µajax('/x', { data: { type: Reward } })",
      "r = await µajax '/x', typeError: (e) -> type: Reward",
      "r = await µajax('/x'); y = {type: Reward}"
    ]
    for (const src of cas) assert.equal(compiler(src), src, src)
  })

  it('le premier niveau des options, sur la ligne de l\'appel ou en retrait, est contrôlé, et lui seul', () => {
    const cas = [
      "r = await µajax '/x', method: 'POST', data: {type: kind}, type: Reward[]",
      "r = await µajax '/x', {data: {type: Reward}, type: Reward[]}",
      "r = await µajax('/x', { data: { type: Reward }, type: Reward[] })",
      "r = await µajax '/x',\n  method: 'POST'\n  data:\n    type: Reward\n  type: Reward[]"
    ]
    for (const src of cas) {
      const out = compiler(src)
      assert.equal(out.match(/µ\._mjs_tajax\(/g)?.length, 1, src)
      assert.match(out, /type: µ\._mjs_tajax\(\{t:'a'/, src)
    }
  })
})

describe('µtypes.onError avant le signal ; rien de personnel au serveur', () => {
  it('le gestionnaire passe avant le signal : écriture refusée, réponse refusée, `typeError` d\'un appel', async () => {
    const µ      = monter({ signal: '/errors/types', corps: JSON.stringify([{ id: 'x', title: 'a' }]) })
    const partis: number[] = []
    const type   = µ._mjs_tajax(regle('Reward[]', 'names'), 'mjs-boutique')
    µ.types.onError(() => { partis.push(µ.beacons.length); return 'warn' })
    µ._mjs_tset(composant('\n$n int 0..9', 'names'), 'n', 'z')
    assert.equal(await µ._mjs_ajax('/app/rewards', { type }), undefined)
    assert.deepEqual(await µ._mjs_ajax('/app/rewards?page=2', { type, typeError: () => { partis.push(µ.beacons.length); return [] } }), [])
    assert.deepEqual(partis, [0, 1, 2])
    assert.equal(µ.beacons.length, 2)
  })

  it('le signal : l\'adresse réelle de la page et, pour une réponse, celle de la requête, coupées avant `?` et `#` (origine comprise) ; le chemin dans la donnée et le nom de la règle — jamais la valeur, ni le texte d\'une règle', async () => {
    const µ    = monter({ signal: '/errors/types', corps: JSON.stringify([{ id: 'x', title: 'a' }]) })
    const el   = composant('\n$age int 0..120\n$r Reward', 'names')
    const type = µ._mjs_tajax(regle('Reward[]', 'names'), 'mjs-boutique')
    µ._mjs_tset(el, 'age', 'quarante')
    µ._mjs_tset(el, 'r', { id: 'y', title: 'b' })
    await assert.rejects(µ._mjs_ajax('/users/jean.dupont@exemple.fr/rewards?token=abc#haut', { type }), (e: any) => e.path === '[0].id' && e.rule === 'Reward[]')
    assert.deepEqual(await µ._mjs_ajax('https://api.exemple.fr/v1/rewards#haut', { type, typeError: () => [] }), [])
    const corps = await Promise.all(µ.beacons.map((b: any) => b.corps.text()))
    assert.deepEqual(corps.map((c: string) => JSON.parse(c)), [
      { path: '$age', component: 'mjs-lecteur', page: '/boutique', type: 'string' },
      { path: '$r.id', rule: 'Reward', component: 'mjs-lecteur', page: '/boutique', type: 'string' },
      { path: '[0].id', rule: 'Reward[]', component: 'mjs-boutique', page: '/boutique', url: '/users/jean.dupont@exemple.fr/rewards', type: 'string' },
      { path: '[0].id', rule: 'Reward[]', component: 'mjs-boutique', page: '/boutique', url: 'https://api.exemple.fr/v1/rewards', type: 'string' }
    ])
    assert.ok(corps.every((c: string) => !/token|haut|quarante|"x"|"y"|int 0|int 1/.test(c)))
  })

  it('production qui signale : une règle écrite sur place n\'a pas de texte, une règle nommée garde son nom à son sommet seulement', () => {
    const v = compileVars({ raw: '\n$volume int 0..100\n$r Reward\n$rs Reward[]', startLine: 1 }, DEFS, 'names' as any).vars.join(',')
    assert.ok(!/int 0\.\.100|int 1\.\.|string 1\.\.80/.test(v), v)
    assert.match(v, /d:"Reward"\}/)
    assert.match(v, /d:"Reward\[\]"\}/)
    assert.equal(v.match(/\bd:/g)?.length, 2)
  })
})

describe('strict et valeur de départ', () => {
  it('un champ absent prend sa valeur de départ, puis strict juge les valeurs données', () => {
    const µ  = monter({ mode: 'warn' })
    const el = composant('\n$r Reward strict')
    assert.deepEqual(µ._mjs_tset(el, 'r', { id: 1, title: 'a' }), { id: 1, title: 'a', price: 0 })
    assert.ok(µ._mjs_tset(el, 'r', { id: 1, title: 'a', price: '5' }) === µ._mjs_TNO)
    assert.ok(µ._mjs_tset(el, 'r', { id: '1', title: 'a' }) === µ._mjs_TNO)
    assert.equal(µ.warnings.length, 2)
  })
})

describe('la marque de `strict` dans le code compilé', () => {
  it('ne se confond pas avec la clé d\'un attribut étalé, et se lit sur une règle stricte', () => {
    const etale = "if(_mjs_spd) for (const _mjs_k in _mjs_spd) _mjs_vu[_mjs_k.indexOf('-') < 0 || /^(?:data|aria)-/.test(_mjs_k) ? _mjs_k : _mjs_k.toLowerCase()] = 1;"
    assert.ok(!scanCompiledFeatures(etale).has(TYPES_STRICT))
    assert.ok(scanCompiledFeatures(`µ._mjs_types = {${compileVars({ raw: '\n$v int 0..9 strict', startLine: 1 }, DEFS, false).vars.join(',')}};`).has(TYPES_STRICT))
  })
})

describe('forme en retrait : une clé entre guillemets', () => {
  it('une clé qui n\'est pas un nom simple s\'écrit entre guillemets', () => {
    const [d] = parseTypesBlock(['', 'Profil', "  'prénom'  string 1..", '  "created-at" = \'\' string', "  'e-mail'?  string"].join('\n'), 1)
    assert.deepEqual((d.rule as any).fields.map((f: any) => f.key), ['prénom', 'created-at', 'e-mail'])
    const v = compileVars({ raw: '\n$p Profil', startLine: 1 }, { Profil: d.rule }, false).vars[0]
    assert.match(v, /"prénom":\{t:'s',a:1\}/)
    assert.match(v, /o:\["e-mail"\]/)
    assert.match(v, /_mjs_z:\{"created-at":""\}/)
  })

  it('sans guillemets, le message le dit et montre la clé entière', () => {
    for (const [ligne, cle] of [['  prénom  string', 'prénom'], ['  created-at  string', 'created-at']]) {
      assert.throws(() => parseTypesBlock(['', 'R', ligne].join('\n'), 1), (e: any) => e.message.includes(`'${cle}'`) && /guillemets/.test(e.message) && /ligne 3/.test(e.message), ligne)
    }
  })
})

describe('valeur de départ : `nom = valeur règle`, la valeur avant la règle', () => {
  it('forme en retrait : la valeur avant la règle, espaces facultatifs autour de `=`', () => {
    const champs = ['price=0 int 0..', 'stock =0 int 0..', 'gain = 5 int 0..10 strict', "title = 'sans titre' string 1..80", 'surprise = false bool', 'tags = [] string[] ..3', 'n = null int | null', 'bass = -5 int -10..10', "'prénom' = 'x' string", 'lot= 2 int']
    const [d] = parseTypesBlock(['', 'Profil', ...champs.map(c => '  ' + c)].join('\n'), 1)
    const v   = compileVars({ raw: '\n$p Profil', startLine: 1 }, { Profil: d.rule }, false).vars[0]
    assert.match(v, /_mjs_z:\{price:0,stock:0,gain:5,title:"sans titre",surprise:false,tags:\[\],n:null,bass:-5,"prénom":"x",lot:2\}/)
    assert.match(v, /gain:\{t:'i',a:0,b:10,_mjs_tstrict:1\}/)
    assert.ok(ruleText(d.rule).includes('\n  price = 0  int 0..\n  stock = 0  int 0..\n  gain = 5  int 0..10 strict'), ruleText(d.rule))
  })

  it('la valeur écrite après la règle : refusée, le message cite la ligne et montre la forme à écrire', () => {
    assert.throws(() => parseTypesBlock(['', 'R', '  price int 0.. = 0'].join('\n'), 1), (e: any) => /ligne 3/.test(e.message) && e.message.includes('price = 0 int 0..'))
    assert.throws(() => parseTypesBlock(['', 'R', '  gain int 0..10 strict = 5'].join('\n'), 1), (e: any) => e.message.includes('gain = 5 int 0..10 strict'))
  })

  it('entre accolades : refusé, le message montre la forme en retrait à écrire, valeur de départ comprise', () => {
    assert.throws(() => parseRule('{ id: int, price: int 0.. = 0 }', { bloc: '<vars>', ligne: 1 }), (e: any) => /\*\.types\.mjs/.test(e.message) && e.message.includes('price = 0  int 0..'))
  })

  it('une variable du <vars> : sa valeur de départ s\'écrit dans le <script>, avant comme après la règle', () => {
    assert.throws(() => parseVarsBlock('$volume = 50 int 0..100', 1), /<script>/)
    assert.throws(() => parseVarsBlock('$volume int 0..100 = 50', 1), /<script>/)
  })

  it('`type: Nom[]` dans un appel par verbe arrête la construction et montre la forme à écrire ; `type: nom`, une donnée, passe', () => {
    assert.throws(() => compileAjaxTypes("x = 1\nr = await µajax.get '/app/rewards', type: Reward[]", DEFS, true, 1), /ligne 2[\s\S]*µajax '\/url', type: Reward\[\]/)
    assert.throws(() => compileAjaxTypes("µajax.post '/x', {type: Reward[]}, f", DEFS, true, 1), /method: 'POST'/)
    for (const src of ["Reward = 'cadeau'\nµajax.post '/x', {type: Reward}, f", "µajax.get '/x', type: kind"]) assert.equal(compileAjaxTypes(src, DEFS, true, 1).code, src)
  })
})
