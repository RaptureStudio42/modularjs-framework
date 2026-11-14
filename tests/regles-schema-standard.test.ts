// Les règles du bloc <vars> dans la langue commune des validateurs (Standard Schema v1) : `µrules(@)` dans un composant
// (mjs_rules.ts, chargé seul avec un `µ` minimal, comme le contrôle des types), `rule()` et `rules()` du module
// `modularjs-framework/rules` au serveur, sans navigateur. Aucun paquet qui consomme ce standard n'est installé : le
// consommateur ci-dessous est écrit d'après l'interface publiée (https://standardschema.dev) — il ne connaît que `~standard`.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseRule, resolveRule, emitRuntimeRule, parseTypesBlock, type RuleAst } from '../src/transpiler/var-types.js'
import { transpile } from '../src/transpiler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { Bundler } from '../src/bundler/index.js'
import { retirerPage } from './helpers/page-globale.js'

const RACINE  = join(dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME = join(RACINE, 'src/runtime')

// un `µ` réduit à ce que lisent les deux fichiers ; `rules` : charger aussi mjs_rules.ts
function makeMu(lang = 'fr', rules = true): any {
  const µ: any = { warn() {}, _mjs_toRaw: (x: any) => x, _mjs_interpolatorSet: new WeakSet(), _mjs_storeRaw: {}, _mjs_storeNotifyDeep() {}, _runtimeLabelsLang: 'fr', _mjs_labelLang: () => lang }
  new Function('µ', readFileSync(join(RUNTIME, 'mjs_types.ts'), 'utf-8'))(µ)
  if (rules) new Function('µ', readFileSync(join(RUNTIME, 'mjs_rules.ts'), 'utf-8'))(µ)
  return µ
}

// les types nommés des règles d'objet, en retrait, un champ par ligne, comme dans un fichier *.types.mjs (ou opts.types de rules(),
// où un objet d'un seul champ commence par une fin de ligne)
const TYPES: Record<string, string> = {
  Reglages: 'volume  int 0..100\nbass?  int -10..10',
  Panier:   '\nquantity  int 1..99',
  Paire:    'a  int\nb?  bool',
  A:        '\na  int',
  Ville:    '\ncity  string',
  Adresse:  'city  string 1..\nzip  int\ngeo?\n  lat  float',
  Matrice:  '\nm  int[][]',
}

// une règle écrite comme dans <vars>, compilée comme le fait le build de production (sans texte)
function regle(texte: string): any {
  const ou   = { bloc: '<vars>', ligne: 1 }
  const defs: Record<string, RuleAst> = {}
  for (const [k, v] of Object.entries(TYPES)) defs[k] = parseTypesBlock(`${k}\n${v.split('\n').map(l => '  ' + l).join('\n')}`, 0)[0].rule
  return new Function(`return ${emitRuntimeRule(resolveRule(parseRule(texte, ou), defs, ou), false)}`)()
}

function table(regles: Record<string, string>): any {
  const T: any = {}
  for (const [k, v] of Object.entries(regles)) T[k] = regle(v)
  return T
}

// le consommateur : vérifie la forme v1, attend une promesse s'il en reçoit une, ramène un segment `{ key }` à sa clé
async function standardValidate(schema: any, value: unknown): Promise<{ ok: true, value: unknown } | { ok: false, issues: { message: string, path: PropertyKey[] }[] }> {
  const props = schema?.['~standard']
  if (!props || props.version !== 1 || typeof props.vendor !== 'string' || typeof props.validate !== 'function') throw new TypeError('pas un schéma standard v1')
  let result = props.validate(value)
  if (result instanceof Promise) result = await result
  if (result.issues) {
    return { ok: false, issues: result.issues.map((i: any) => {
      assert.equal(typeof i.message, 'string')
      return { message: i.message, path: (i.path ?? []).map((s: any) => s !== null && typeof s === 'object' ? s.key : s) }
    }) }
  }
  return { ok: true, value: result.value }
}

const COMPOSANT = { age: 'int 18..120', nick: "string 3..20 ! 'admin' | 'root'", color: "'red' | 'green' | 'blue'", tags: 'string 1..10[] ..3', settings: 'Reglages' }

describe('règles en schémas standard — dans le composant (µrules)', () => {
  it('chaque règle des variables et des props expose ~standard : version 1, vendor mjs, validate ; l’ensemble aussi', () => {
    const µ  = makeMu()
    const rs = µ.rules({ _mjs_types: table(COMPOSANT) })
    for (const k of [...Object.keys(COMPOSANT), '~standard']) {
      const s = k === '~standard' ? rs : rs[k]
      assert.equal(s['~standard'].version, 1, k)
      assert.equal(s['~standard'].vendor, 'mjs', k)
      assert.equal(typeof s['~standard'].validate, 'function', k)
    }
  })

  it('une valeur bonne rend { value } telle que la variable l’écrirait : conversions faites, sans issues', async () => {
    const rs = makeMu().rules({ _mjs_types: table(COMPOSANT) })
    assert.deepEqual(await standardValidate(rs.age, '42'), { ok: true, value: 42 })
    assert.deepEqual(await standardValidate(rs.age, 50), { ok: true, value: 50 })
    assert.deepEqual(await standardValidate(rs.nick, 'ann'), { ok: true, value: 'ann' })
    assert.deepEqual(rs.color['~standard'].validate('green'), { value: 'green' })
  })

  it('refusée, ou hors de sa plage (jamais ramenée) : un refus en vouvoiement, chemin vide', async () => {
    const rs = makeMu().rules({ _mjs_types: table(COMPOSANT) })
    const un = async (s: any, v: unknown) => (await standardValidate(s, v) as any).issues
    assert.deepEqual(await un(rs.age, 150), [{ message: 'Saisissez un nombre entier de 18 à 120', path: [] }])
    assert.deepEqual(await un(rs.age, 'abc'), [{ message: 'Saisissez un nombre entier de 18 à 120', path: [] }])
    assert.deepEqual(await un(rs.age, ''), [{ message: 'Ce champ est obligatoire', path: [] }])
    assert.deepEqual(await un(rs.nick, 'admin'), [{ message: 'Cette valeur n\'est pas permise', path: [] }])
    assert.deepEqual(await un(rs.nick, 'ab'), [{ message: 'Saisissez de 3 à 20 caractères', path: [] }])
    assert.deepEqual(await un(rs.color, 'purple'), [{ message: 'Choisissez parmi : red, green ou blue', path: [] }])
  })

  it('l’ensemble : chaque champ refusé a son refus et son chemin, jusque dans les listes et les objets', async () => {
    const rs  = makeMu().rules({ _mjs_types: table(COMPOSANT) })
    const res = await standardValidate(rs, { age: 'x', nick: 'admin', color: 'red', tags: ['ok', '', 'x'.repeat(11)], settings: { volume: 50, bass: 30 }, libre: 1 }) as any
    assert.deepEqual(res.issues, [
      { message: 'Saisissez un nombre entier de 18 à 120', path: ['age'] },
      { message: 'Cette valeur n\'est pas permise', path: ['nick'] },
      { message: 'Ce champ est obligatoire', path: ['tags', 1] },
      { message: 'Saisissez de 1 à 10 caractères', path: ['tags', 2] },
      { message: 'Saisissez un nombre entier de -10 à 10', path: ['settings', 'bass'] },
    ])
    const trop = await standardValidate(rs.tags, ['a', 'b', 'c', 'd']) as any
    assert.deepEqual(trop.issues, [{ message: 'Choisissez au plus 3 éléments', path: [] }])
    const manque = await standardValidate(rs, {}) as any
    assert.deepEqual(manque.issues.map((i: any) => i.path), [['age'], ['nick'], ['color'], ['tags'], ['settings']])
  })

  it('la valeur reçue n’est jamais modifiée : la valeur rendue est une copie convertie', () => {
    const rs   = makeMu().rules({ _mjs_types: table(COMPOSANT) })
    const recu = { age: '42', nick: 'ann', color: 'red', tags: ['a'], settings: { volume: '7' }, libre: { garde: true } }
    const res  = rs['~standard'].validate(recu)
    assert.deepEqual(res, { value: { age: 42, nick: 'ann', color: 'red', tags: ['a'], settings: { volume: 7 }, libre: { garde: true } } })
    assert.equal(recu.age, '42')
    assert.equal(recu.settings.volume, '7')
    assert.ok(res.value !== recu && res.value.settings !== recu.settings, 'une copie')
    assert.ok(res.value.libre === recu.libre, 'un champ non déclaré est gardé tel quel')
  })

  it('langue de la page : l’anglais quand la page l’est ; un texte du projet (mjs.rules.*) passe avant', () => {
    const en = makeMu('en').rules({ _mjs_types: table(COMPOSANT) })
    assert.deepEqual(en.age['~standard'].validate(7).issues, [{ message: 'Enter a whole number from 18 to 120', path: [] }])
    assert.deepEqual(en.nick['~standard'].validate('root').issues, [{ message: 'This value is not allowed', path: [] }])
    const µ = makeMu()
    µ._mjs_label = (g: string, k: string) => g === 'rules' && k === 'required' ? 'Obligatoire, vraiment' : undefined
    assert.deepEqual(µ.rules({ _mjs_types: table(COMPOSANT) }).age['~standard'].validate(undefined).issues, [{ message: 'Obligatoire, vraiment', path: [] }])
  })

  it('µrules() sans composant : les règles des stores, relues à chaque appel', () => {
    const µ = makeMu()
    assert.deepEqual(Object.keys(µ.rules()), ['~standard'])
    µ._mjs_storeTypes({ cart: regle('Panier') })
    assert.deepEqual(µ.rules().cart['~standard'].validate({ quantity: 0 }).issues, [{ message: 'Saisissez un nombre entier de 1 à 99', path: ['quantity'] }])
  })

  it('le contrôle de chaque écriture garde son comportement : µ._mjs_tcheck identique, le fichier n’ajoute que µ.rules', () => {
    const seul = makeMu('fr', false)
    const deux = makeMu()
    assert.deepEqual(Object.keys(deux).filter(k => !(k in seul)), ['rules'])
    const cas: [string, unknown][] = [['int 0..100', 150], ['int 0..100', '42'], ['string 3..5', 'ab'], ['int 1..5[] 1..', [9, '2']], ['Paire', { a: '3', b: 'true' }], ['int 0..10 | \'auto\'', 'auto'], ["! 'x'", 'x']]
    for (const [texte, v] of cas) assert.deepEqual(deux._mjs_tcheck(regle(texte), structuredClone(v)), seul._mjs_tcheck(regle(texte), structuredClone(v)), texte)
  })
})

describe('règles en schémas standard — au serveur (modularjs-framework/rules)', () => {
  it('rule() : une règle écrite comme dans <vars>, contrôlée sans navigateur', async () => {
    // sans navigateur, même quand un autre fichier du même processus a laissé une page globale derrière lui
    const rendrePage = retirerPage(['document', 'window'])
    try {
      assert.equal(typeof (globalThis as any).document, 'undefined')
      assert.equal(typeof (globalThis as any).window, 'undefined')
      const { rule } = await import('../src/rules/index.js')
      const age = rule('int 18..120')
      assert.deepEqual(await standardValidate(age, '42'), { ok: true, value: 42 })
      assert.deepEqual(await standardValidate(age, '17'), { ok: false, issues: [{ message: 'Saisissez un nombre entier de 18 à 120', path: [] }] })
      assert.equal(age['~standard'].vendor, 'mjs')
    }
    finally {
      rendrePage()
    }
  })

  it('rules() : plusieurs règles, des règles nommées, la langue des messages ; l’objet reçu (formulaire) est contrôlé en entier', async () => {
    const { rules } = await import('../src/rules/index.js')
    const form = rules({ nick: 'Nick', age: 'int 18..120' }, { types: { Nick: "string 3..20 ! 'admin' | 'root'" }, lang: 'en' })
    assert.deepEqual(await standardValidate(form, { nick: 'root', age: '200' }), { ok: false, issues: [{ message: 'This value is not allowed', path: ['nick'] }, { message: 'Enter a whole number from 18 to 120', path: ['age'] }] })
    assert.deepEqual(await standardValidate(form, { nick: 'ann', age: '30' }), { ok: true, value: { nick: 'ann', age: 30 } })
    assert.deepEqual(form.age['~standard'].validate(17).issues, [{ message: 'Enter a whole number from 18 to 120', path: [] }])
  })

  it('une règle mal écrite est refusée à la création, avec la grammaire en cause', async () => {
    const { rule } = await import('../src/rules/index.js')
    assert.throws(() => rule('0..100'), /int|float/)
  })
})

describe('règles en schémas standard — le cœur ne les emporte que si l’appli les lit', () => {
  it('la rune µrules(@) compile en µ.rules(this), que la construction détecte', async () => {
    const { output } = await transpile('<vars>\n$age int 18..120\n</vars>\n<script>\nrs = µrules(@)\n$ok = rs.age[\'~standard\'].validate(20).value is 20\n</script>\n<p>{$ok}</p>', { moduleName: 'regles-std' })
    assert.match(output, /µ\.rules\(this\)/)
    assert.ok(scanCompiledFeatures(output).has('rules'))
  })

  it('détection exacte : µ.rules, mjs.rules et leurs formes échappées, jamais un autre objet, une classe ou un texte', () => {
    for (const js of ['const rs = µ.rules(this)', 'let f = µ.rules', 'µ?.rules(this)', 'µ . rules(this)', 'mjs.rules(this)', 'var r = \\u00b5.rules(this)', 'var r = \\u00B5.rules(this)', 'var r = \\u{b5}.rules(this)', 'm = `${Object.keys(µ.rules(this)).length} règles`', 'a = b / c; d = µ.rules(this)']) assert.ok(scanCompiledFeatures(js).has('rules'), js)
    for (const js of ['n = config.rules.length', 'const t = jeu.rules', 'p.textContent = "Lisez game.rules avant de jouer"', '.rules{color:red}', 'µ.rulesX(this)', 'µ.rules$(this)', 'xµ.rules(this)', 'monmjs.rules(this)']) assert.ok(!scanCompiledFeatures(js).has('rules'), js)
  })

  it('un mjs ou un µ champ d’un objet (opts.mjs.rules) ne l’embarque pas ; une décomposition (...µ.rules) si', () => {
    for (const js of ['const r = opts.mjs.rules', 'opts.mjs.rules(this)', 'opts?.mjs.rules', 'opts.mjs?.rules', 'cfg. mjs .rules', 'cfg.µ.rules(this)', 'this.µ?.rules']) assert.ok(!scanCompiledFeatures(js).has('rules'), js)
    for (const js of ['const r = { ...µ.rules(this) }', 'f(...mjs.rules(this))', 'x = opts.mjs; y = mjs.rules(this)']) assert.ok(scanCompiledFeatures(js).has('rules'), js)
  })

  it('seul le code compte : un texte, une chaîne, une clé de traduction mjs.rules.*, un commentaire ne l’embarquent jamais', async () => {
    for (const js of ['p = "\\xb5.rules(this)"', 'p.textContent = "Lisez mjs.rules avant de jouer"', 'p = "La rune devient µ.rules(this)"', "k = 'mjs.rules.required'", 't = µ.t(\'mjs.rules.required\')', '// voir µ.rules plus tard\nn = 1', '/* mjs.rules */ n = 1', 'r = /µ.rules/g', 'm = `µ.rules(this)`']) assert.ok(!scanCompiledFeatures(js).has('rules'), js)
    const textes = ['<p>Lisez mjs.rules avant de jouer</p>', '<p>La rune µrules(@) devient µ.rules(this) une fois compilée</p>', "<script>\n  $k = 'mjs.rules.required'\n</script>\n<p>{$k}</p>", '<script>\n  # voir µ.rules plus tard\n  $n = 1\n</script>\n<p>{$n}</p>']
    for (const [i, src] of textes.entries()) {
      const { output } = await transpile(src, { moduleName: `regles-texte-${i}` })
      assert.ok(!scanCompiledFeatures(output).has('rules'), src)
    }
    const codes = ['<script>\n  rs = µrules(@)\n  $n = Object.keys(rs).length\n</script>\n<p>{$n}</p>', '<script>\n  $m = "#{Object.keys(µrules(@)).length} règles"\n</script>\n<p>{$m}</p>', '<p>{Object.keys(µrules(@)).length}</p>']
    for (const [i, src] of codes.entries()) {
      const { output } = await transpile(src, { moduleName: `regles-code-${i}` })
      assert.ok(scanCompiledFeatures(output).has('rules'), src)
    }
  })

  it('un <vars> sans µrules ne la détecte pas ; la clé rules entraîne le contrôle des types, jamais l’inverse', async () => {
    const { output } = await transpile('<vars>\n$age int 18..120\n</vars>\n<script>\n$age = 20\n</script>\n<p>{$age}</p>', { moduleName: 'regles-sans' })
    const used = scanCompiledFeatures(output)
    assert.ok(used.has('types') && !used.has('rules'))
    const avec = new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles(new Set(['rules'])).files
    assert.ok(avec.includes('mjs_rules.ts') && avec.includes('mjs_types.ts'))
    assert.ok(avec.indexOf('mjs_types.ts') < avec.indexOf('mjs_rules.ts'))
    const sans = new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles(new Set(['types'])).files
    assert.ok(sans.includes('mjs_types.ts') && !sans.includes('mjs_rules.ts'))
    assert.ok(new Bundler({ runtime: ['rules'] } as any).resolveRuntimeFiles(new Set()).files.includes('mjs_rules.ts'))
  })
})

describe('règles en schémas standard — messages vrais', () => {
  const msg = (rs: any, k: string, v: unknown) => rs[k]['~standard'].validate(v).issues[0].message

  it('un champ qui accepte null n’est jamais dit obligatoire ; null n’est jamais proposé comme un choix', () => {
    const rs = makeMu().rules({ _mjs_types: table({ opt: 'int 1..10 | null', couleur: "'a' | 'b' | null", nom: 'string 2..5 | null' }) })
    assert.deepEqual(rs.opt['~standard'].validate(null), { value: null })
    assert.equal(msg(rs, 'opt', ''), 'Saisissez un nombre entier de 1 à 10')
    assert.equal(msg(rs, 'opt', 'x'), 'Saisissez un nombre entier de 1 à 10')
    assert.equal(msg(rs, 'couleur', 'c'), 'Choisissez parmi : a ou b')
    assert.equal(msg(rs, 'couleur', ''), 'Choisissez parmi : a ou b')
    assert.equal(msg(rs, 'nom', 'x'), 'Saisissez de 2 à 5 caractères')
  })

  it('une liste ou un objet qui accepte null : le refus descend jusqu’à l’élément ou au champ, son message toujours complet (fr et en)', () => {
    const T  = table({ ids: 'int[] | null', tags: 'string 1..5[] | null', borne: 'int[] 1..3 | null', adr: 'A | null' })
    const fr = makeMu().rules({ _mjs_types: T })
    const en = makeMu('en').rules({ _mjs_types: T })
    const refus = (rs: any, k: string, v: unknown) => rs[k]['~standard'].validate(v).issues
    assert.deepEqual(refus(fr, 'ids', ['x']), [{ message: 'Saisissez un nombre entier', path: [0] }])
    assert.deepEqual(refus(fr, 'ids', [1, 'x']), [{ message: 'Saisissez un nombre entier', path: [1] }])
    assert.deepEqual(refus(fr, 'tags', ['abcdefg']), [{ message: 'Saisissez de 1 à 5 caractères', path: [0] }])
    assert.deepEqual(refus(fr, 'borne', [1, 2, 3, 4]), [{ message: 'Choisissez de 1 à 3 éléments', path: [] }])
    assert.deepEqual(refus(fr, 'adr', { a: 'x' }), [{ message: 'Saisissez un nombre entier', path: ['a'] }])
    assert.deepEqual(refus(en, 'ids', ['x']), [{ message: 'Enter a whole number', path: [0] }])
    assert.deepEqual(refus(en, 'tags', ['abcdefg']), [{ message: 'Enter 1 to 5 characters', path: [0] }])
    assert.deepEqual(fr.ids['~standard'].validate(null), { value: null })
    for (const rs of [fr, en]) {
      for (const [k, v] of [['ids', ['x']], ['ids', 'x'], ['tags', ['abcdefg']], ['tags', [1, 2]], ['borne', []], ['adr', 'x'], ['adr', { a: 1.5 }]] as const) {
        for (const i of refus(rs, k, v) ?? []) assert.ok(!/[{}]/.test(i.message), `${k} ${JSON.stringify(v)} : ${i.message}`)
      }
    }
  })

  it('accords : 1 caractère, 2 caractères, 1 élément, 3 éléments — en français comme en anglais', () => {
    const T  = table({ un: 'string ..1', deux: 'string 2..', plage: 'string 0..1', liste1: 'int[] ..1', liste3: 'int[] 3..' })
    const fr = makeMu().rules({ _mjs_types: T })
    assert.equal(msg(fr, 'un', 'ab'), 'Saisissez au plus 1 caractère')
    assert.equal(msg(fr, 'deux', 'a'), 'Saisissez au moins 2 caractères')
    assert.equal(msg(fr, 'plage', 'ab'), 'Saisissez de 0 à 1 caractère')
    assert.equal(msg(fr, 'liste1', [1, 2]), 'Choisissez au plus 1 élément')
    assert.equal(msg(fr, 'liste3', [1]), 'Choisissez au moins 3 éléments')
    const en = makeMu('en').rules({ _mjs_types: T })
    assert.equal(msg(en, 'un', 'ab'), 'Enter at most 1 character')
    assert.equal(msg(en, 'deux', 'a'), 'Enter at least 2 characters')
    assert.equal(msg(en, 'liste1', [1, 2]), 'Choose at most 1 item')
    assert.equal(msg(en, 'liste3', [1]), 'Choose at least 3 items')
  })

  it('une règle int refuse un nombre non entier au lieu de l’arrondir, dans une liste aussi ; la variable, elle, arrondit toujours', () => {
    const rs = makeMu().rules({ _mjs_types: table({ age: 'int 18..120', notes: 'int 0..20[]', reel: 'int | float' }) })
    assert.deepEqual(rs.age['~standard'].validate(17.6).issues, [{ message: 'Saisissez un nombre entier de 18 à 120', path: [] }])
    assert.deepEqual(rs.age['~standard'].validate('42.5').issues, [{ message: 'Saisissez un nombre entier de 18 à 120', path: [] }])
    assert.deepEqual(rs.notes['~standard'].validate([12, 13.5]).issues, [{ message: 'Saisissez un nombre entier de 0 à 20', path: [1] }])
    assert.deepEqual(rs.reel['~standard'].validate(2.5), { value: 2.5 })
    assert.deepEqual(rs.age['~standard'].validate('42'), { value: 42 })
    assert.deepEqual(makeMu()._mjs_tcheck(regle('int 18..120'), 17.6), { s: 1, v: 18 })
  })

  it('au serveur, une langue sans messages propres parle anglais ; fr-CA parle français', async () => {
    const { rule } = await import('../src/rules/index.js')
    assert.equal(msg({ a: rule('int 18..120', { lang: 'de' }) }, 'a', 7), 'Enter a whole number from 18 to 120')
    assert.equal(msg({ a: rule('int 18..120', { lang: 'fr-CA' }) }, 'a', 7), 'Saisissez un nombre entier de 18 à 120')
    assert.equal(msg({ a: rule('int 18..120') }, 'a', 7), 'Saisissez un nombre entier de 18 à 120')
  })

  it('aucun cache sans borne : 3 000 langues demandées au serveur ne gardent rien en mémoire', function () {
    this.timeout(60000)
    const script = `const { rule } = await import(${JSON.stringify(pathToFileURL(join(RACINE, 'src/rules/index.ts')).href)})
rule('int', { lang: 'fr' }); rule('int', { lang: 'en' })
globalThis.gc(); const avant = process.memoryUsage().heapUsed
for (let i = 0; i < 3000; i++) rule('int', { lang: 'x' + i })
globalThis.gc(); console.log(process.memoryUsage().heapUsed - avant)`
    const r = spawnSync(process.execPath, ['--expose-gc', '--import', 'tsx', '--input-type=module', '-e', script], { cwd: RACINE, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.ok(Number(r.stdout.trim()) < 2e6, 'octets gardés : ' + r.stdout)
  })
})

describe('règles en schémas standard — un formulaire reçu (FormData, URLSearchParams)', () => {
  const REGLES = { tags: 'string 1..5[]', ok: 'bool', opt: 'int 1..10 | null', age: 'int 18..120', nick: 'string 3..20' }

  it('URLSearchParams : plusieurs valeurs en liste, case cochée true et absente false, champ vide d’une règle | null en null, nombres tirés des chaînes', async () => {
    const { rules } = await import('../src/rules/index.js')
    const form = rules(REGLES)
    assert.deepEqual(form['~standard'].validate(new URLSearchParams('tags=a&tags=b&ok=on&opt=&age=42&nick=ann&jeton=xyz')), { value: { tags: ['a', 'b'], ok: true, opt: null, age: 42, nick: 'ann', jeton: 'xyz' } })
    assert.deepEqual(form['~standard'].validate(new URLSearchParams('age=42&nick=ann')), { value: { tags: [], ok: false, opt: null, age: 42, nick: 'ann' } })
  })

  it('FormData : refus nommés champ par champ, un nombre non entier refusé', async () => {
    const { rules } = await import('../src/rules/index.js')
    const fd = new FormData()
    for (const [k, v] of [['tags', 'a'], ['tags', 'beaucoup trop'], ['ok', 'peut-être'], ['opt', '11'], ['age', '17.6'], ['nick', 'x']]) fd.append(k, v)
    assert.deepEqual(rules(REGLES)['~standard'].validate(fd).issues, [
      { message: 'Saisissez de 1 à 5 caractères', path: ['tags', 1] },
      { message: 'Choisissez oui ou non', path: ['ok'] },
      { message: 'Saisissez un nombre entier de 1 à 10', path: ['opt'] },
      { message: 'Saisissez un nombre entier de 18 à 120', path: ['age'] },
      { message: 'Saisissez de 3 à 20 caractères', path: ['nick'] },
    ])
  })

  it('un champ vide ou absent d’une règle | null vaut null, listes et cases à cocher comprises ; un champ rempli se contrôle toujours', async () => {
    const { rules } = await import('../src/rules/index.js')
    for (const regle of ['int[] 2..3 | null', 'int[] | null', 'string[] 1.. | null', 'bool | null', 'int 1..10 | null']) {
      const corps = regle.includes('[]') ? ['', 'x=', 'x[]=', 'x=&x='] : ['', 'x=']
      for (const c of corps) assert.deepEqual(rules({ x: regle })['~standard'].validate(new URLSearchParams(c)), { value: { x: null } }, `${regle} : « ${c} »`)
    }
    assert.deepEqual(rules({ x: 'int[] 2..3 | null' })['~standard'].validate(new URLSearchParams('x=1')).issues, [{ message: 'Choisissez de 2 à 3 éléments', path: ['x'] }])
    assert.deepEqual(rules({ x: 'int[] | null' })['~standard'].validate(new URLSearchParams('x=1&x[]=2')), { value: { x: [1, 2] } })
    assert.deepEqual(rules({ x: 'int[] | null' })['~standard'].validate(new URLSearchParams('x=&x=2')).issues, [{ message: 'Ce champ est obligatoire', path: ['x', 0] }])
    assert.deepEqual(rules({ x: 'bool | null' })['~standard'].validate(new URLSearchParams('x=on')), { value: { x: true } })
    assert.deepEqual(rules({ x: 'bool' })['~standard'].validate(new URLSearchParams('')), { value: { x: false } })
  })

  it('tags[] : la forme courante d’un champ de liste se lit comme tags, dans l’ordre du formulaire', async () => {
    const { rules } = await import('../src/rules/index.js')
    const form = rules({ tags: 'string 1..5[]', ids: 'int[] | null', nick: 'string' })
    assert.deepEqual(form['~standard'].validate(new URLSearchParams('tags[]=a&tags[]=b&ids[]=1&ids=2&nick=ann')), { value: { tags: ['a', 'b'], ids: [1, 2], nick: 'ann' } })
    assert.deepEqual(form['~standard'].validate(new URLSearchParams('tags[]=a&tags[]=beaucoup&nick=ann')).issues, [{ message: 'Saisissez de 1 à 5 caractères', path: ['tags', 1] }])
    assert.deepEqual(form['~standard'].validate(new URLSearchParams('nick[]=x&nick=ann&autre[]=z')), { value: { tags: [], ids: null, nick: 'ann', 'nick[]': 'x', 'autre[]': 'z' } })
  })

  it('adr.city : les champs d’un objet se lisent sous son nom suivi d’un point, à toute profondeur ; un champ objet absent est obligatoire', async () => {
    const { rules } = await import('../src/rules/index.js')
    const form = rules({ nick: 'string', adr: 'Adresse', alt: 'Ville | null' }, { types: TYPES })
    assert.deepEqual(form['~standard'].validate(new URLSearchParams('nick=ann&adr.city=Paris&adr.zip=75001&adr.geo.lat=48.8')), { value: { nick: 'ann', adr: { city: 'Paris', zip: 75001, geo: { lat: 48.8 } }, alt: null } })
    assert.deepEqual(form['~standard'].validate(new URLSearchParams('nick=ann&alt.city=Lyon&adr.city=P&adr.zip=1')), { value: { nick: 'ann', alt: { city: 'Lyon' }, adr: { city: 'P', zip: 1 } } })
    assert.deepEqual(Object.keys(form['~standard'].validate(new URLSearchParams('nick=ann&adr.city=P&adr.zip=1&adr.__proto__=x&adr.constructor=y&adr.prototype=z')).value.adr), ['city', 'zip'])
    assert.deepEqual(form['~standard'].validate(new URLSearchParams('nick=ann&adr.city=&adr.zip=x')).issues, [{ message: 'Ce champ est obligatoire', path: ['adr', 'city'] }, { message: 'Saisissez un nombre entier', path: ['adr', 'zip'] }])
    assert.deepEqual(form['~standard'].validate(new URLSearchParams('nick=ann')).issues, [{ message: 'Ce champ est obligatoire', path: ['adr'] }])
    assert.equal(({} as any).x, undefined)
  })

  it('une liste d’objets ou de listes n’a pas de forme dans un formulaire : refusée par un message clair, jamais perdue en silence', async () => {
    const { rules } = await import('../src/rules/index.js')
    const form = rules({ nick: 'string', items: 'A[]', adr: 'Matrice' }, { types: TYPES })
    assert.deepEqual(form['~standard'].validate(new URLSearchParams('nick=ann&items.0.a=1&items[0][a]=1')).issues, [
      { message: 'Un formulaire ne peut pas remplir ce champ (liste d\'objets ou de listes)', path: ['items'] },
      { message: 'Un formulaire ne peut pas remplir ce champ (liste d\'objets ou de listes)', path: ['adr', 'm'] },
    ])
    assert.deepEqual(rules({ items: 'A[]' }, { lang: 'en', types: TYPES })['~standard'].validate(new URLSearchParams()).issues, [{ message: 'A form cannot fill this field (list of objects or lists)', path: ['items'] }])
    assert.deepEqual(rules({ items: 'A[]' }, { types: TYPES })['~standard'].validate({ items: [{ a: '2' }] }), { value: { items: [{ a: 2 }] } })
  })

  it('dans le composant aussi : µrules(@) contrôle un FormData ; un objet ordinaire garde les conversions de la variable', () => {
    const rs = makeMu().rules({ _mjs_types: table(REGLES) })
    const fd = new FormData()
    for (const [k, v] of [['tags', 'x'], ['ok', 'on'], ['age', '30'], ['nick', 'bob']]) fd.append(k, v)
    assert.deepEqual(rs['~standard'].validate(fd), { value: { tags: ['x'], ok: true, opt: null, age: 30, nick: 'bob' } })
    assert.deepEqual(rs['~standard'].validate({ tags: 'x', ok: 'on', opt: null, age: '30', nick: 'bob' }).issues.map((i: any) => i.path), [['tags'], ['ok']])
  })
})
