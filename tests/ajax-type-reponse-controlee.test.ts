// µajax : une réponse contrôlée une fois, à son arrivée, par un type nommé. `type: Reward[]` dans un appel
// µajax devient au build la règle compilée (`µ._mjs_tajax({…})`) ; la réponse y passe une fois (conversions,
// bornes, valeurs de départ), puis plus rien. Refusée : `typeError` de l'appel rend la réponse à sa place ; sans
// lui, la promesse est rejetée par une µTypeError (chemin, règle, valeur). La forme appelable `µajax '/url', options`
// (µ._mjs_ajax) rend le corps de la réponse.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTypesBlock, compileAjaxTypes, type RuleAst } from '../src/transpiler/var-types.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'
import { poserMessages } from './helpers/messages-stub.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const TYPES_SRC = readFileSync(join(ICI, '../src/runtime/mjs_types.ts'), 'utf-8')
const AJAX_SRC  = readFileSync(join(ICI, '../src/runtime/mjs_ajax.ts'), 'utf-8')
const TAJAX_SRC = readFileSync(join(ICI, '../src/runtime/mjs_types_ajax.ts'), 'utf-8')

const DEFS: Record<string, RuleAst> = {}
for (const d of parseTypesBlock(['', 'Reward', '  id int 1..', '  title string 1..80', '  price = 0 int 0..', '  surprise = false bool'].join('\n'), 1)) DEFS[d.name] = d.rule

const compiler = (code: string, texte = true) => compileAjaxTypes(code, DEFS, texte, 1)

// la règle que le code compilé passe à µ._mjs_tajax
function regle(code: string, texte = true): any {
  const m = /µ\._mjs_tajax\((\{.*\})\)/.exec(compiler(code, texte).code)
  assert.ok(m, 'règle compilée')
  return new Function(`return ${m![1]}`)()
}

function reponse(status: number, corps: string) {
  return {
    status,
    ok: status >= 200 && status < 300,
    url: 'https://app.example/app/rewards',
    headers: { get: (n: string) => n === 'content-type' ? 'application/json' : null },
    json: async () => JSON.parse(corps),
    text: async () => corps
  }
}

// les modules des types et de µajax sur un même µ, et un fetch qui rend `corps`
function monter(corps: string, status = 200, mode: string | undefined = 'warn'): any {
  const µ: any = { warnings: [] as string[], log() {}, warn(m: string) { µ.warnings.push(m) }, error() {}, _mjs_toRaw: (x: any) => x, _mjs_interpolatorSet: new WeakSet(), _mjs_storeRaw: {}, _runtimeLabelsLang: 'fr' }
  if (mode) µ._typesMode = mode
  poserMessages(µ)
  new Function('µ', TYPES_SRC + '\n' + TAJAX_SRC)(µ)
  new Function('µ', 'fetch', 'document', AJAX_SRC)(µ, async () => reponse(status, corps), { querySelector: () => null })
  return µ
}

const REWARDS = "rewards = await µajax '/app/rewards', type: Reward[]"

describe('µajax — `type:` compilé au build', () => {
  it('`type: Reward[]` devient la règle compilée, sur la même ligne', () => {
    const { code, used } = compiler(REWARDS + '\n$n = rewards.length')
    assert.ok(used)
    assert.equal(code.split('\n').length, 2)
    assert.match(code, /^rewards = await µajax '\/app\/rewards', type: µ\._mjs_tajax\(\{t:'a',e:\{t:'o',f:\{id:\{t:'i',a:1/)
    assert.match(code, /d:"Reward\[\]"/)
    assert.equal(code.split('\n')[1], '$n = rewards.length')
  })

  it('un appel sur plusieurs lignes, et la forme entre parenthèses', () => {
    const civet = "r = await µajax '/app/rewards/1',\n  type: Reward\n  typeError: (e) -> null"
    assert.match(compiler(civet).code.split('\n')[1], /^  type: µ\._mjs_tajax\(\{t:'o'/)
    assert.match(compiler("r = await µajax('/x', { method: 'POST', data: data, type: Reward[], typeError: f })").code, /type: µ\._mjs_tajax\(\{t:'a'.*\}\), typeError: f \}\)$/)
  })

  it('un nom inconnu : erreur de construction, avec la ligne et une suggestion', () => {
    assert.throws(() => compiler("x = 1\nr = await µajax '/app/rewards', type: Rewrd[]"), /ligne 2[\s\S]*Rewrd[\s\S]*Reward/)
    assert.throws(() => compiler("r = await µajax '/x', type: Rewad"), /Reward/)
  })

  it('hors d\'un appel µajax, dans un texte ou dans des données : rien ne change', () => {
    for (const src of ["µajax.post '/x', { type: kind }", "µajax.post '/x', { type: 'reward' }", 'x = { type: Reward }', "µajax.get '/x?type: Reward[]', f", "µajax.post '/x', { type: Kind.A }"]) {
      const { code, used } = compiler(src)
      assert.equal(code, src, src)
      assert.ok(!used, src)
    }
  })

  it('le build l\'émet dans le composant, et son module suit ; une appli à <vars> sans `type:` ne le paie pas', async () => {
    const src = "<script>\nload = -> $rewards = await µajax '/app/rewards', type: Reward[]\n</script>\n<p>{$rewards}</p>"
    const { output } = await transpile(src, { moduleName: 'boutique', typeDefs: DEFS })
    assert.match(output, /_mjs_tajax\(/)
    assert.ok(scanCompiledFeatures(output).has('types_ajax'))
    assert.ok(!scanCompiledFeatures("µ.ajax.get('/x', f)").has('types_ajax'))
    const typee = await transpile('<vars>\n$x int 0..9\n</vars>\n<script>\n$x = 1\n</script>\n<p>{$x}</p>', { moduleName: 'typee', typeDefs: DEFS })
    assert.ok(scanCompiledFeatures(typee.output).has('types'))
    assert.ok(!scanCompiledFeatures(typee.output).has('types_ajax'))
  })
})

describe('µajax — la réponse contrôlée à son arrivée', () => {
  it('acceptée : convertie, ramenée, complétée, rendue par la promesse', async () => {
    const µ = monter(JSON.stringify([{ id: '1', title: 'Thé', price: -5 }, { id: 2, title: 'Café', surprise: true }]))
    const rewards = await µ._mjs_ajax('/app/rewards', { type: µ._mjs_tajax(regle(REWARDS)) })
    assert.deepEqual(rewards, [{ id: 1, title: 'Thé', price: 0, surprise: false }, { id: 2, title: 'Café', price: 0, surprise: true }])
    assert.equal(µ.warnings.length, 1)
    assert.match(µ.warnings[0], /\[0\]\.price : -5 ramené à 0/)
  })

  it('refusée, sans gestionnaire : la promesse est rejetée par une µTypeError', async () => {
    const µ = monter(JSON.stringify([{ id: 1, title: 'Thé' }, { id: 'x', title: 'Café' }]))
    let toujours = 0
    await assert.rejects(µ._mjs_ajax('/app/rewards', { type: µ._mjs_tajax(regle(REWARDS)), always: () => { toujours++ } }), (e: any) => {
      assert.ok(e instanceof µ.TypeError && e instanceof Error)
      assert.equal(e.name, 'µTypeError')
      assert.equal(e.path, '[1].id')
      assert.equal(e.rule, 'int 1..')
      assert.equal(e.value, 'x')
      assert.match(e.message, /\[1\]\.id refuse 'x'/)
      return true
    })
    assert.equal(toujours, 1)
  })

  it('refusée, avec typeError : ce qu\'il rend devient la réponse, rien n\'est rejeté', async () => {
    const µ = monter(JSON.stringify({ id: 1 }))
    let vu: any
    const r = await µ._mjs_ajax('/app/rewards', { type: µ._mjs_tajax(regle(REWARDS)), typeError: (e: any) => { vu = e; return [] } })
    assert.deepEqual(r, [])
    assert.equal(vu.path, '')
    assert.equal(vu.rule, 'Reward[]')
  })

  it('en production : le même contrôle, sans texte de règle', async () => {
    const µ = monter(JSON.stringify([{ id: 'x', title: 'x' }]), 200, undefined)
    await assert.rejects(µ._mjs_ajax('/app/rewards', { type: µ._mjs_tajax(regle(REWARDS, false)) }), (e: any) => e.name === 'µTypeError' && e.path === '[0].id' && e.rule === undefined && e.value === 'x')
  })

  it('la forme appelable sans type : la promesse rend le corps ; un rappel positionnel garde sa forme', async () => {
    const µ = monter(JSON.stringify({ ok: 1 }))
    assert.deepEqual(await µ._mjs_ajax('/x'), { ok: 1 })
    assert.deepEqual(await µ._mjs_ajax('/x', { method: 'POST', data: { a: 1 }, type: µ._mjs_tajax({ t: 'o', f: { ok: { t: 's' } } }) }), { ok: '1' })
    let recu: any
    await µ.ajax.get('/x', (b: any) => { recu = b })
    assert.deepEqual(recu, { ok: 1 })
  })

  it('une réponse en erreur HTTP ne passe pas par le type : error la reçoit, comme avant', async () => {
    const µ = monter(JSON.stringify({ error: 'non' }), 422)
    let err: any
    await µ._mjs_ajax('/x', { type: µ._mjs_tajax(regle(REWARDS)), error: (e: any) => { err = e } })
    assert.equal(err.status, 422)
  })
})

// la forme appelable sur un fetch donné : réseau coupé, délai dépassé
function monterFetch(f: any): any {
  const µ = monter('{}')
  new Function('µ', 'fetch', 'document', AJAX_SRC)(µ, f, { querySelector: () => null })
  return µ
}

describe('µajax — la forme appelable et l\'erreur du serveur', () => {
  it('code 4xx / 5xx : `error:` de l\'appel la reçoit, ce qu\'elle rend devient le résultat de await ; ni la règle ni `typeError:` ne la voient', async () => {
    let vu: any
    let refus = 0
    const µ   = monter(JSON.stringify({ message: 'introuvable' }), 404)
    const r   = await µ._mjs_ajax('/app/rewards', { type: µ._mjs_tajax(regle(REWARDS)), typeError: () => { refus++; return [] }, error: (e: any) => { vu = e; return 'repli' } })
    assert.equal(r, 'repli')
    assert.equal(vu.status, 404)
    assert.equal(refus, 0)
  })

  it('sans `error:`, µ.ajax.error l\'affiche et await rend undefined, sans rejet', async () => {
    const µ             = monter(JSON.stringify({ message: 'panne' }), 500, undefined)
    const vus: string[] = []
    µ.error = (m: string) => { vus.push(m) }
    assert.equal(await µ._mjs_ajax('/app/rewards', { type: µ._mjs_tajax(regle(REWARDS)) }), undefined)
    assert.equal(await µ._mjs_ajax('/app/rewards'), undefined)
    assert.deepEqual(vus, ['panne', 'panne'])
  })

  it('pas de réponse, délai dépassé : `error:` la reçoit ; sans elle, µ.ajax.error l\'affiche et await rend undefined', async () => {
    const vus: string[] = []
    const coupe         = monterFetch(async () => { throw new TypeError('Failed to fetch') })
    const lent          = monterFetch((_u: string, init: any) => new Promise((_ok, ko) => init.signal.addEventListener('abort', () => ko(Object.assign(new Error('abandon'), { name: 'AbortError' })))))
    coupe.error = lent.error = (m: string) => { vus.push(m) }
    assert.equal(await coupe._mjs_ajax('/app/rewards', { type: coupe._mjs_tajax(regle(REWARDS)), error: (e: any) => e.message }), 'Failed to fetch')
    assert.equal(await coupe._mjs_ajax('/app/rewards', { type: coupe._mjs_tajax(regle(REWARDS)) }), undefined)
    assert.match(await lent._mjs_ajax('/app/rewards', { timeout: 20, error: (e: any) => e.message }), /20 ?ms/)
    assert.equal(await lent._mjs_ajax('/app/rewards', { timeout: 20 }), undefined)
    assert.equal(vus.length, 2)
    assert.equal(vus[0], 'Failed to fetch')
    assert.match(vus[1], /20 ?ms/)
  })

  it('un refus de type : ce que rend `typeError:` devient le résultat ; sans aucun gestionnaire, une µTypeError rejette la promesse, `error:` n\'y peut rien', async () => {
    const µ = monter(JSON.stringify([{ id: 'x', title: 'a' }]), 200, undefined)
    assert.deepEqual(await µ._mjs_ajax('/app/rewards', { type: µ._mjs_tajax(regle(REWARDS)), typeError: (e: any) => [e.path] }), ['[0].id'])
    await assert.rejects(µ._mjs_ajax('/app/rewards', { type: µ._mjs_tajax(regle(REWARDS)), error: () => 'jamais' }), (e: any) => e.name === 'µTypeError' && e.path === '[0].id')
  })

  it('abandon voulu par l\'appelant (`signal:`) : await rend undefined, en silence — ni `error:`, ni µ.ajax.error, ni `typeError:` ; un verbe garde son résultat d\'abandon', async () => {
    const vus: string[] = []
    const pendu         = (_u: string, init: any) => new Promise((_ok, ko) => init.signal.addEventListener('abort', () => ko(Object.assign(new Error('abandon'), { name: 'AbortError' }))))
    const µ             = monterFetch(pendu)
    const c             = new AbortController()
    const v             = new AbortController()
    µ.error = (m: string) => { vus.push(m) }
    const p = µ._mjs_ajax('/app/rewards', { signal: c.signal, type: µ._mjs_tajax(regle(REWARDS)), error: () => 'erreur', typeError: () => 'refus' })
    c.abort()
    assert.equal(await p, undefined)
    const q = µ.ajax.get('/app/rewards', () => vus.push('succès'), () => vus.push('erreur'), undefined, undefined, v.signal)
    v.abort()
    assert.deepEqual(await q, { body: null, url: '/app/rewards', aborted: true })
    assert.deepEqual(vus, [])
  })
})
