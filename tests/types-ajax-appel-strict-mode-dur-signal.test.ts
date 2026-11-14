// types : `µajax '/app/rewards', type: Reward[]` (la forme appelable : un GET, ou la méthode de ses options, dont la promesse rend le
// corps), `strict` en fin de règle, le mode dur (`"types": "throw"`, `µtypes.onError`), le signal en production (`typesReport`), les
// blocs du runtime que le build ne garde que pour l'appli qui s'en sert, et µrules sur un champ qui a sa valeur de départ

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTypesBlock, compileAjaxTypes, compileAjaxCall, compileVars, type RuleAst } from '../src/transpiler/var-types.js'
import { scanCompiledFeatures, TYPES_DEFAULTS, TYPES_STRICT, TYPES_HARD, AJAX_CALL } from '../src/bundler/features.js'
import { projeterBlocs } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { poserMessages } from './helpers/messages-stub.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const lire      = (f: string): string => readFileSync(join(ICI, '../src/runtime', f), 'utf-8')
const TYPES_SRC = lire('mjs_types.ts')
const TAJAX_SRC = lire('mjs_types_ajax.ts')
const AJAX_SRC  = lire('mjs_ajax.ts')
const RULES_SRC = lire('mjs_rules.ts')

const DEFS: Record<string, RuleAst> = {}
for (const d of parseTypesBlock(['', 'Reward', '  id int 1..', '  title string 1..80', '  price = 0 int 0..'].join('\n'), 1)) DEFS[d.name] = d.rule

// la règle compilée d'un `type:`, premier argument de µ._mjs_tajax
function regle(type: string, texte = true): any {
  const m = /µ\._mjs_tajax\((\{.*\}), "mjs-boutique"\)/.exec(compileAjaxTypes(`r = await µajax '/app/rewards', type: ${type}`, DEFS, texte, 1, 'mjs-boutique').code)
  assert.ok(m, 'règle compilée')
  return new Function(`return ${m![1]}`)()
}

function reponse(corps: string) {
  return { status: 200, ok: true, url: 'https://app.example/app/rewards', headers: { get: (n: string) => n === 'content-type' ? 'application/json' : null }, json: async () => JSON.parse(corps), text: async () => corps }
}

// les runtimes des types, de µrules et de µajax sur un même µ ; sans `mode`, la production ; `dur` : `"types": "throw"`, `signal` : `typesReport`
function monter(o: { mode?: string, dur?: boolean, signal?: string, corps?: string } = {}): any {
  const µ: any = { warnings: [] as string[], fetchs: [] as any[], beacons: [] as any[], log() {}, warn(m: string) { µ.warnings.push(m) }, error() {}, _mjs_toRaw: (x: any) => x, _mjs_interpolatorSet: new WeakSet(), _mjs_storeRaw: {}, _runtimeLabelsLang: 'fr' }
  if (o.mode) µ._typesMode = o.mode
  if (o.dur) µ._typesThrow = 1
  if (o.signal) µ._typesReport = o.signal
  poserMessages(µ)
  const navigator = { sendBeacon: (url: string, corps: Blob) => { µ.beacons.push({ url, corps }); return true } }
  new Function('µ', 'navigator', 'location', TYPES_SRC + '\n' + TAJAX_SRC + '\n' + RULES_SRC)(µ, navigator, { pathname: '/boutique' })
  new Function('µ', 'fetch', 'document', AJAX_SRC)(µ, async (url: string, init: any) => { µ.fetchs.push({ url, method: init.method, body: init.body }); return reponse(o.corps ?? '{}') }, { querySelector: () => null })
  return µ
}

// un composant dont le bloc <vars> est `vars`
function composant(vars: string, texte = true): any {
  return { localName: 'mjs-lecteur', _mjs_types: new Function(`return {${compileVars({ raw: vars, startLine: 1 }, DEFS, texte).vars.join(',')}}`)() }
}

describe('µajax \'/url\', options — la forme appelable', () => {
  it('compilée : `µajax` appelé devient µ._mjs_ajax ; ses verbes, une valeur, un texte ou un commentaire ne bougent pas', () => {
    const cas: [string, string][] = [
      ["rewards = await µajax '/app/rewards', type: x", "rewards = await µ._mjs_ajax '/app/rewards', type: x"],
      ["r = await µajax('/x', o)", "r = await µ._mjs_ajax('/x', o)"],
      ['r = await µajax "/x/#{id}"', 'r = await µ._mjs_ajax "/x/#{id}"'],
      ['r = await µajax url, opts', 'r = await µ._mjs_ajax url, opts'],
      ["r = await µ.ajax '/x'", "r = await µ._mjs_ajax '/x'"]
    ]
    for (const [src, attendu] of cas) assert.equal(compileAjaxCall(src), attendu, src)
    for (const src of ["µajax.get '/x', f", "µajax.post '/x', d, f", "# µajax '/x'", "s = \"µajax '/x'\"", 'f = µajax', 'x = µajax or y', "µ.ajax.get('/x')", "µajaxX '/x'"]) assert.equal(compileAjaxCall(src), src, src)
  })

  it('`type: Nom[]` dans un appel par verbe arrête la construction et montre la forme appelable ; `type: Nom` y reste une donnée', () => {
    assert.throws(() => compileAjaxTypes("x = 1\nr = await µajax.get '/app/rewards', type: Reward[]", DEFS, true, 1), /ligne 2[\s\S]*µajax '\/url', type: Reward\[\]/)
    const src = "Reward = 'cadeau'\nr = await µajax.post '/x', data, type: Reward"
    assert.equal(compileAjaxTypes(src, DEFS, true, 1).code, src)
  })

  it('le build : la règle reçoit le nom du composant, et chaque fonction écrite est détectée', async () => {
    const src = "<script>\nload = -> $rewards = await µajax '/app/rewards', type: Reward[]\n</script>\n<p>{$rewards}</p>"
    const { output } = await transpile(src, { moduleName: 'boutique', typeDefs: DEFS })
    assert.match(output, /µ\._mjs_ajax\(['"]\/app\/rewards['"], \{\s*type: µ\._mjs_tajax\([\s\S]*_mjs_z:\s*\{[\s\S]*\}, "mjs-boutique"\s*\)/)
    const used = scanCompiledFeatures(output)
    for (const k of [AJAX_CALL, 'types_ajax', TYPES_DEFAULTS]) assert.ok(used.has(k), k)
    assert.ok(!used.has(TYPES_STRICT))
  })
})

describe('µajax \'/url\', options — à l\'exécution', () => {
  it('un GET dont la promesse rend le corps contrôlé ; `method:` et `data:` pour un autre verbe ; les rappels positionnels restent', async () => {
    const µ = monter({ mode: 'warn', corps: JSON.stringify([{ id: '1', title: 'Thé' }]) })
    assert.deepEqual(await µ._mjs_ajax('/app/rewards', { type: µ._mjs_tajax(regle('Reward[]'), 'mjs-boutique') }), [{ id: 1, title: 'Thé', price: 0 }])
    assert.deepEqual(await µ._mjs_ajax('/app/rewards'), [{ id: '1', title: 'Thé' }])
    await µ._mjs_ajax('/app/rewards', { method: 'POST', data: { a: 1 } })
    assert.deepEqual(µ.fetchs.map((f: any) => [f.method, f.body ?? null]), [['GET', null], ['GET', null], ['POST', '{"a":1}']])
    let recu: any
    await µ.ajax.get('/x', (b: any) => { recu = b })
    assert.deepEqual(recu, [{ id: '1', title: 'Thé' }])
  })

  it('réponse refusée : la µTypeError nomme le composant ; sans `typeError:` dans l\'appel, le gestionnaire de l\'appli décide', async () => {
    const µ    = monter({ mode: 'warn', corps: JSON.stringify([{ id: 'x', title: 'Thé' }]) })
    const type = µ._mjs_tajax(regle('Reward[]'), 'mjs-boutique')
    await assert.rejects(µ._mjs_ajax('/app/rewards', { type }), (e: any) => e instanceof µ.TypeError && e.component === 'mjs-boutique' && e.path === '[0].id' && e.rule === 'int 1..' && e.value === 'x')
    const vus: any[] = []
    µ.types.onError((e: any) => { vus.push(e); return 'warn' })
    assert.equal(await µ._mjs_ajax('/app/rewards', { type }), undefined)
    assert.equal(µ.warnings.length, 1)
    assert.match(µ.warnings[0], /\[0\]\.id refuse 'x'/)
    µ.types.onError(() => undefined)
    await assert.rejects(µ._mjs_ajax('/app/rewards', { type }), (e: any) => e.name === 'µTypeError')
    assert.deepEqual(await µ._mjs_ajax('/app/rewards', { type, typeError: () => [] }), [])
    assert.equal(vus.length, 1)
  })
})

describe('strict en fin de règle', () => {
  it('se lit dans <vars>, dans un champ (avant sa valeur de départ), et s\'écrit dans le texte de la règle', () => {
    assert.equal(compileVars({ raw: '\n$volume int 0..100 strict', startLine: 1 }, {}, true).vars[0], 'volume:{t:\'i\',a:0,b:100,_mjs_tstrict:1,d:"int 0..100 strict"}')
    const [piste] = parseTypesBlock(['', 'Piste', '  gain = 5 int 0..10 strict'].join('\n'), 1)
    const v = compileVars({ raw: '\n$p Piste', startLine: 1 }, { Piste: piste.rule }, true).vars[0]
    assert.match(v, /gain:\{t:'i',a:0,b:10,_mjs_tstrict:1,d:"int 0\.\.10 strict"\}/)
    assert.match(v, /_mjs_z:\{gain:5\}/)
    assert.throws(() => compileVars({ raw: '\n$x int strict strict', startLine: 1 }, {}, true), /strict/)
  })

  it('ni conversion ni valeur ramenée : hors règle, la valeur est refusée', () => {
    const µ  = monter({ mode: 'warn' })
    const el = composant('\n$volume int 0..100 strict\n$doux int 0..100')
    assert.equal(µ._mjs_tset(el, 'volume', 50), 50)
    for (const v of ['50', 150, 4.5, -1]) assert.ok(µ._mjs_tset(el, 'volume', v) === µ._mjs_TNO, String(v))
    assert.equal(µ._mjs_tset(el, 'doux', '150'), 100)
    assert.match(µ.warnings[0], /\$volume refuse '50' — permis : int 0\.\.100 strict/)
  })
})

describe('mode dur et gestionnaire de l\'appli', () => {
  it('`"types": "throw"` : une écriture refusée lève une µTypeError, en développement comme en production', () => {
    for (const mode of ['warn', undefined]) {
      const µ  = monter({ mode, dur: true })
      const el = composant('\n$volume int 0..100 strict', mode !== undefined)
      assert.throws(() => µ._mjs_tset(el, 'volume', 150), (e: any) => e instanceof µ.TypeError && e.path === '$volume' && e.value === 150 && e.component === 'mjs-lecteur' && e.rule === (mode ? 'int 0..100 strict' : undefined))
      assert.equal(µ.warnings.length, 0)
    }
  })

  it('en production, la µTypeError nomme le chemin dans une liste', () => {
    const µ  = monter({ dur: true })
    const el = composant('\n$rewards Reward[]', false)
    µ._mjs_tset(el, 'rewards', [{ id: 1, title: 'a' }])
    assert.throws(() => µ._mjs_tset(el, 'rewards', [{ id: 1, title: 'a' }, { id: 'x', title: 'b' }]), (e: any) => e.path === '$rewards[1].id' && e.value === 'x')
  })

  it('µtypes.onError : appelé avant tout ; « throw » lève, « warn » avertit, rien laisse le mode réglé', () => {
    const µ   = monter({ mode: 'warn' })
    const el  = composant('\n$n int 0..9')
    const vus: any[] = []
    let verdict: any = 'throw'
    µ.types.onError((e: any) => { vus.push(e); return verdict })
    assert.throws(() => µ._mjs_tset(el, 'n', 'x'), (e: any) => e === vus[0] && e.path === '$n' && e.rule === 'int 0..9')
    verdict = 'warn'
    assert.ok(µ._mjs_tset(el, 'n', 'y') === µ._mjs_TNO)
    verdict = undefined
    assert.ok(µ._mjs_tset(el, 'n', 'z') === µ._mjs_TNO)
    assert.equal(µ.warnings.length, 2)
    µ._typesThrow = 1
    assert.throws(() => µ._mjs_tset(el, 'n', 'w'), (e: any) => e.name === 'µTypeError')
    verdict = 'warn'
    assert.ok(µ._mjs_tset(el, 'n', 'v') === µ._mjs_TNO)
    assert.equal(µ.warnings.length, 3)
    assert.equal(vus.length, 5)
  })
})

describe('signal en production : typesReport', () => {
  it('chaque refus part une fois par page et par chemin, avec l\'adresse de la page, celle de la requête et le type de la valeur, jamais la valeur', async () => {
    const µ  = monter({ signal: '/errors/types', corps: JSON.stringify([{ id: 'secret', title: 'Thé' }]) })
    const el = composant('\n$age int 0..120\n$nom string')
    for (const v of ['secret', 'autre', [1]]) µ._mjs_tset(el, 'age', v)
    µ._mjs_tset(el, 'nom', null)
    await assert.rejects(µ._mjs_ajax('/app/rewards', { type: µ._mjs_tajax(regle('Reward[]'), 'mjs-boutique') }))
    assert.deepEqual(µ.beacons.map((b: any) => b.url), ['/errors/types', '/errors/types', '/errors/types'])
    const corps = await Promise.all(µ.beacons.map((b: any) => b.corps.text()))
    assert.ok(corps.every((c: string) => !c.includes('secret') && !c.includes('autre')))
    assert.deepEqual(corps.map((c: string) => JSON.parse(c)), [
      { path: '$age', rule: 'int 0..120', component: 'mjs-lecteur', page: '/boutique', type: 'string' },
      { path: '$nom', rule: 'string', component: 'mjs-lecteur', page: '/boutique', type: 'null' },
      { path: '[0].id', rule: 'int 1..', component: 'mjs-boutique', page: '/boutique', url: '/app/rewards', type: 'string' }
    ])
    assert.equal(µ.warnings.length, 0)
  })

  it('sans adresse, rien ne part', () => {
    const µ = monter({})
    µ._mjs_tset(composant('\n$age int 0..120', false), 'age', 'x')
    assert.equal(µ.beacons.length, 0)
  })
})

describe('les blocs du runtime : seulement chez qui s\'en sert', () => {
  const RIEN    = { 'types-defaut': false, 'types-strict': false, 'types-dur': false, 'types-signal': false, 'types-ajax': false, 'ajax-appel': false }
  const MARQUES = /\/\/ <\/?(?:sans-)?(?:types-(?:defaut|strict|dur|signal|ajax)|ajax-appel)>/

  it('chaque fonction écrite est détectée dans le code compilé, et seulement elle', () => {
    assert.ok(scanCompiledFeatures("µ._mjs_types = {r: {t: 'o', f: {}, _mjs_z: {a: 0}}};").has(TYPES_DEFAULTS))
    assert.ok(scanCompiledFeatures("x = {t: 'i', _mjs_tstrict: 1};").has(TYPES_STRICT))
    assert.ok(scanCompiledFeatures('µ.types.onError(function(e) { return "warn"; });').has(TYPES_HARD))
    assert.ok(scanCompiledFeatures("µ._mjs_ajax('/x', {});").has(AJAX_CALL))
    const rien = scanCompiledFeatures("µ.ajax.get('/x', f); x = {z: {a: 1}, k: 1}; e instanceof TypeError;")
    for (const k of [TYPES_DEFAULTS, TYPES_STRICT, TYPES_HARD, AJAX_CALL]) assert.ok(!rien.has(k), k)
  })

  it('sans elles, le runtime projeté n\'en garde aucune ligne, et contrôle comme avant', () => {
    // le code seul : les commentaires ne partent pas dans l'appli
    const code  = (s: string): string => s.replace(/^[ \t]*\/\/.*\n/gm, '')
    const ajax  = code(projeterBlocs(AJAX_SRC, RIEN))
    const types = code(projeterBlocs(TYPES_SRC, RIEN))
    assert.ok(!/_mjs_ajax =|options\.type/.test(ajax) && !MARQUES.test(AJAX_SRC.replace(/^[ \t]*\/\/ <\/?(?:types-ajax|ajax-appel)>\n/gm, '')))
    assert.ok(!/_mjs_z|_mjs_tstrict|TypeError|sendBeacon|_mjs_tonErr|_mjsTHard|µ\.types/.test(types) && !MARQUES.test(projeterBlocs(TYPES_SRC, RIEN)))
    assert.match(types, /^ {2}if \(n === void 0 \|\| !_mjsTDev\(\)\) return n;$/m)
    assert.ok(!/sendBeacon|_mjsTSignal/.test(code(projeterBlocs(TAJAX_SRC, { ...RIEN, 'types-dur': true }))))
    const µ: any = { warn() {}, _mjs_toRaw: (x: any) => x, _mjs_interpolatorSet: new WeakSet(), _mjs_storeRaw: {} }
    poserMessages(µ)
    new Function('µ', types)(µ)
    assert.equal(µ._mjs_tset({ localName: 'x', _mjs_types: { n: { t: 'i', a: 0, b: 9 } } }, 'n', '12'), 9)
    assert.equal(µ.types, undefined)
  })

  it('µrules : un champ absent qui a sa valeur de départ la prend dans la valeur rendue, la valeur reçue ne change pas', () => {
    const µ    = monter({ mode: 'warn' })
    const recu = { id: 1, title: 'Thé' }
    assert.deepEqual(µ.rules(composant('\n$reward Reward')).reward['~standard'].validate(recu), { value: { id: 1, title: 'Thé', price: 0 } })
    assert.deepEqual(recu, { id: 1, title: 'Thé' })
  })
})
