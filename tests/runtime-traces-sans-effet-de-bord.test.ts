// les traces du cœur ne portent aucun effet de bord
//
// en production, quand le niveau de console coupe `log`, le build retire chaque trace AVEC ses arguments
// (minify.ts, option runtimeSource) : une trace ne doit donc rien faire d'autre qu'écrire. ce test relit les
// sources du runtime et refuse
//   - tout usage de µ.log ou de µ._mjs_logger hors d'un appel direct (alias, .call, passage en argument) ;
//   - dans les arguments d'une trace : affectation, ++ ou --, await, yield, delete, new ;
//   - dans les arguments d'une trace directe µ.log(…) : tout appel de fonction ;
//   - dans les arguments d'une trace gardée µ._mjs_logger()?.(…) : tout appel hors µ._mjs_txt et toLowerCase ;
//   - un appel à µ._mjs_txt dans une trace directe : en production il inscrit une entrée d'attente et pose
//     deux écouteurs, la forme gardée est la seule qui ne l'évalue qu'à l'écriture
//
// la garde est prouvée sur du texte écrit pour l'occasion avant d'être branchée sur les sources du runtime
//
// avertissements et erreurs du runtime (animations comprises) : aux niveaux de production qui les taisent ('error' et 'silent'
// pour µ.warn, 'silent' pour µ.error quand le journal des erreurs n'est pas embarqué), le build les retire aussi avec leurs
// arguments ; ceux-ci ne font que lire et tirer leur texte de la table (µ._mjs_txt, µ._mjs_msg : l'entrée d'attente et le
// fichier de messages qu'ils demandent ne servent qu'à l'écriture). Refusés : affectation, ++ ou --, await, yield, delete,
// new, et tout appel hors de la liste CONSOLE_PERMIS ; un usage indirect (alias, repli `µ.warn || …`) reste dans le code
// envoyé : la liste STRAYS_CONSOLE les compte

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { maskInertSameLength } from '../src/lexer/index.js'

const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')

interface Site { file: string, line: number, guarded: boolean, args: string }

const CALL_RE = /(?<![\w$µ.])µ\.(log\s*\(|_mjs_logger\(\)\?\.\()/g
const USE_RE  = /(?<![\w$µ.])µ\.(log|_mjs_logger)(?![\w$])/g

// la seule affectation d'une trace du cœur : le temporaire `ref` de mjs_if.ts, propre à la trace et posé dans un bloc µ.debug que la production retire
const EXCEPTIONS = [{ file: 'mjs_if.ts', fragment: '(ref = s.parentNode)' }]

// parenthèse fermante de celle qui s'ouvre en `open`, cherchée sur la vue masquée (chaînes, gabarits, commentaires blanchis)
function closing(masked: string, open: number): number {
  let depth = 0
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '(') depth++
    else if (masked[i] === ')' && --depth === 0) return i
  }
  return -1
}

// le code d'un argument : texte des chaînes et des gabarits blanchi, expressions `${…}` conservées
function codeOf(text: string): string {
  const frames: Array<{ tpl: boolean, depth: number }> = [{ tpl: false, depth: 0 }]
  let out = ''
  let i   = 0
  while (i < text.length) {
    const c   = text[i]
    const top = frames[frames.length - 1]
    if (top.tpl) {
      if (c === '\\') i += 2
      else if (c === '`') { frames.pop(); i++ }
      else if (c === '$' && text[i + 1] === '{') { frames.push({ tpl: false, depth: 0 }); i += 2 }
      else i++
      continue
    }
    if (c === '\'' || c === '"') {
      i++
      while (i < text.length && text[i] !== c) i += text[i] === '\\' ? 2 : 1
      i++
    }
    else if (c === '`') { frames.push({ tpl: true, depth: 0 }); i++ }
    else if (c === '{') { top.depth++; out += c; i++ }
    else if (c === '}' && top.depth === 0 && frames.length > 1) { frames.pop(); i++ }
    else { if (c === '}') top.depth--; out += c; i++ }
  }
  return out
}

// les appels de fonction d'un code : le nom de chaque appelé
function callees(code: string): string[] {
  return [...code.matchAll(/([\w$µ.]+)\s*\(/g)].map(m => m[1]).filter(n => !/^(typeof|void|if|while|for|switch|function)$/.test(n))
}

// les usages de µ.log et de µ._mjs_logger qui ne sont ni un appel direct, ni la définition, ni le retour de l'aide
function strays(file: string, source: string): string[] {
  const masked = maskInertSameLength(source)
  const calls  = new Set([...masked.matchAll(CALL_RE)].map(m => m.index))
  const out: string[] = []
  for (const m of masked.matchAll(USE_RE)) {
    if (calls.has(m.index)) continue
    const after  = masked.slice(m.index! + m[0].length)
    const before = masked.slice(0, m.index!)
    if (/^\s*=(?!=)/.test(after)) continue
    if (/\?\s*$/.test(before) && /^\s*:\s*null/.test(after)) continue
    out.push(`${file}:${source.slice(0, m.index!).split('\n').length}`)
  }
  return out
}

function sitesOf(file: string, source: string): Site[] {
  const masked = maskInertSameLength(source)
  const sites: Site[] = []
  for (const m of masked.matchAll(CALL_RE)) {
    const open  = m.index! + m[0].length - 1
    const close = closing(masked, open)
    assert.ok(close > open, `${file} : parenthèse de la trace non refermée`)
    sites.push({ file, line: source.slice(0, m.index!).split('\n').length, guarded: m[1].startsWith('_mjs_logger'), args: source.slice(open + 1, close) })
  }
  return sites
}

// ce qui, dans une trace, n'est pas permis ; une liste vide = la trace est sans effet de bord
function violations(site: Site): string[] {
  const code = codeOf(site.args)
  const out: string[] = []
  if (/(?<![=!<>])=(?![=>])/.test(code)) out.push('affectation')
  if (/\+\+|--/.test(code)) out.push('incrément ou décrément')
  if (/\b(await|yield|delete|new)\b/.test(code)) out.push('await, yield, delete ou new')
  const permis = site.guarded ? ['µ._mjs_txt', 'toLowerCase'] : []
  for (const n of callees(code)) {
    if (n === 'µ._mjs_txt' && !site.guarded) out.push('appel à µ._mjs_txt dans une trace directe (seule la forme gardée µ._mjs_logger()?.(…) ne l\'évalue qu\'à l\'écriture)')
    else if (!permis.includes(n) && !permis.some(p => n.endsWith('.' + p))) out.push(`appel de ${n}`)
  }
  return out
}

describe('garde des traces — prouvée sur du texte écrit pour l\'occasion', () => {
  const site = (text: string) => sitesOf('essai.ts', text)

  it('trouve une trace directe et une trace gardée, avec leurs arguments entiers', () => {
    const [a, b] = site('µ.log(\'a\' + f(g(1)))\nx = µ._mjs_logger()?.(`t ${v}`, 2)')
    assert.equal(a.guarded, false)
    assert.equal(a.args, '\'a\' + f(g(1))')
    assert.equal(b.guarded, true)
    assert.equal(b.args, '`t ${v}`, 2')
  })

  it('ne voit ni une chaîne, ni un gabarit, ni un commentaire, ni la définition', () => {
    const texte = '// µ.log(1)\nvar s = \'µ.log(2)\'\nvar t = `µ.log(3)`\nµ.log = function() {}\nµ._mjs_logger = function() { return ok ? µ.log : null }'
    assert.deepEqual(site(texte), [])
    assert.deepEqual(strays('essai.ts', texte), [])
  })

  it('refuse un alias, un .call, un passage en argument', () => {
    assert.equal(strays('essai.ts', 'var l = µ.log').length, 1)
    assert.equal(strays('essai.ts', 'µ.log.call(null, 1)').length, 1)
    assert.equal(strays('essai.ts', 'g(µ._mjs_logger)').length, 1)
  })

  it('refuse l\'affectation, l\'incrément, await, delete, new', () => {
    for (const args of ['x = 1', 'x += 1', 'i++', '--i', 'await f', 'delete o.k', 'new Date']) {
      assert.ok(violations(site(`µ.log(${args})`)[0]).length > 0, args)
    }
    assert.ok(violations(site('µ.log(`${(r = s)}`)')[0]).includes('affectation'), 'dans une expression de gabarit')
  })

  it('laisse passer les comparaisons, les flèches et les lectures', () => {
    for (const args of ['a == b', 'a === b', 'a != b', 'a <= b', 'a >= b', '!!node._mjs_outro', '`[x] ${a} ${b ? 1 : 2}`', '\'a = b\'', '...args']) {
      assert.deepEqual(violations(site(`µ.log(${args})`)[0]), [], args)
    }
  })

  it('refuse tout appel dans une trace directe, et µ._mjs_txt surtout', () => {
    assert.deepEqual(violations(site('µ.log(f(1))')[0]), ['appel de f'])
    const v = violations(site('µ.log(\'a\' + µ._mjs_txt(\'k\'))')[0])
    assert.equal(v.length, 1)
    assert.match(v[0], /µ\._mjs_txt dans une trace directe/)
  })

  it('une trace gardée peut tirer son texte de la table et passer en minuscules, rien d\'autre', () => {
    assert.deepEqual(violations(site('µ._mjs_logger()?.(\'a\' + µ._mjs_txt(\'k\', { tag: c.tagName.toLowerCase() }))')[0]), [])
    assert.deepEqual(violations(site('µ._mjs_logger()?.(f(1))')[0]), ['appel de f'])
    assert.ok(violations(site('µ._mjs_logger()?.(x = 1)')[0]).includes('affectation'))
  })
})

describe('traces du runtime — aucune ne porte d\'effet de bord', () => {
  const files   = readdirSync(RUNTIME_DIR).filter(f => f.endsWith('.ts')).sort()
  const sources = new Map(files.map(f => [f, readFileSync(join(RUNTIME_DIR, f), 'utf-8')]))
  const sites   = files.flatMap(f => sitesOf(f, sources.get(f)!))

  it('la lecture trouve les traces connues (la garde ne passe pas à vide)', () => {
    const count = (file: string, guarded: boolean) => sites.filter(s => s.file === file && s.guarded === guarded).length
    assert.equal(count('mjs_router.ts', true), 13)
    assert.equal(count('mjs_ujs.ts', true), 1)
    assert.ok(count('mjs_ajax.ts', false) >= 1)
    assert.ok(count('mjs_autoloader.ts', false) >= 2)
    assert.ok(count('mjs_for.ts', false) >= 4)
    assert.ok(count('mjs_if.ts', false) >= 2)
    assert.ok(sites.length >= 25)
  })

  it('tout usage de µ.log ou de µ._mjs_logger est un appel direct (le build ne réécrit que celui-là)', () => {
    const stray = files.flatMap(f => strays(f, sources.get(f)!))
    assert.deepEqual(stray, [])
  })

  it('les arguments d\'une trace : ni affectation, ni appel hors de la liste, ni µ._mjs_txt hors forme gardée', () => {
    const used = new Set<string>()
    const bad: string[] = []
    for (const s of sites) {
      const exception = EXCEPTIONS.find(e => e.file === s.file && s.args.includes(e.fragment))
      if (exception) { used.add(exception.fragment); continue }
      const v = violations(s)
      if (v.length) bad.push(`${s.file}:${s.line} — ${v.join(', ')}`)
    }
    assert.deepEqual(bad, [])
    assert.deepEqual([...used], EXCEPTIONS.map(e => e.fragment), 'une exception ne sert plus : retirez-la de la liste')
  })
})

// ce qu'un avertissement ou une erreur du runtime peut appeler dans ses arguments : le texte de la table, des lectures, un calcul
// sans effet (Math.ceil : l'attente en secondes de mjs_lockstep.ts), et quatre aides qui ne font que composer un texte
// (mjs_fx_reflect.ts, mjs_i18n.ts, mjs_modal.ts, et mjs_debug.ts : la balise telle que l'auteur l'écrit, `<@@select>` pour `mjs-core-select`)
const CONSOLE_PERMIS = ['µ._mjs_txt', 'µ._mjs_msg', 'String', 'JSON.stringify', 'Object.keys', 'join', 'toLowerCase', 'slice', 'replace', 'getAttribute', 'test', 'map', 'Math.ceil', '_mjsFxReflectWarn', '__i18nDelai', '__modalReason', '_mjsBaliseEcrite']

// la seule affectation : le temporaire `ref` de mjs_element.ts, local à _mjs_catchError et lu par le seul message
const CONSOLE_EXCEPTIONS = [{ file: 'mjs_element.ts', fragment: '(ref = this.tagName)' }]

// les usages indirects, qui restent dans le code envoyé (rendus muets par le niveau) : le repli de mjs_dom.ts, celui de
// mjs_interpolate.ts et sa garde, l'enveloppe du journal des erreurs
const STRAYS_CONSOLE: Record<string, number> = { 'mjs_dom.ts': 1, 'mjs_interpolate.ts': 3, 'mjs_journal.ts': 1, 'mjs_schema.ts': 2 } // mjs_schema.ts : le codec chargé seul pose µ.warn et µ.error s'ils manquent

const CONSOLE_CALL_RE = /(?<![\w$µ.])µ\.(warn|error)\s*\(/g
const CONSOLE_USE_RE  = /(?<![\w$µ.])µ\.(warn|error)(?![\w$])/g

interface ConsoleSite { file: string, line: number, method: string, args: string }

function consoleSitesOf(file: string, source: string): ConsoleSite[] {
  const masked = maskInertSameLength(source)
  const sites: ConsoleSite[] = []
  for (const m of masked.matchAll(CONSOLE_CALL_RE)) {
    const open  = m.index! + m[0].length - 1
    const close = closing(masked, open)
    assert.ok(close > open, `${file} : parenthèse de l'appel non refermée`)
    sites.push({ file, line: source.slice(0, m.index!).split('\n').length, method: m[1], args: source.slice(open + 1, close) })
  }
  return sites
}

// les usages de µ.warn et µ.error qui ne sont ni un appel direct, ni une définition
function consoleStrays(source: string): number {
  const masked = maskInertSameLength(source)
  const calls  = new Set([...masked.matchAll(CONSOLE_CALL_RE)].map(m => m.index))
  return [...masked.matchAll(CONSOLE_USE_RE)].filter(m => !calls.has(m.index) && !/^\s*=(?!=)/.test(masked.slice(m.index! + m[0].length))).length
}

function consoleViolations(site: ConsoleSite): string[] {
  const code = codeOf(site.args)
  const out: string[] = []
  if (/(?<![=!<>])=(?![=>])/.test(code)) out.push('affectation')
  if (/\+\+|--/.test(code)) out.push('incrément ou décrément')
  if (/\b(await|yield|delete|new)\b/.test(code)) out.push('await, yield, delete ou new')
  for (const n of callees(code)) if (!CONSOLE_PERMIS.some(p => n === p || n.endsWith('.' + p))) out.push(`appel de ${n}`)
  return out
}

// les fichiers du runtime, sous-dossiers compris (animations, pièces communes)
function runtimeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(f => statSync(join(dir, f)).isDirectory() ? runtimeFiles(join(dir, f)) : f.endsWith('.ts') && !f.endsWith('.d.ts') ? [join(dir, f)] : []).sort()
}

describe('garde des avertissements et des erreurs — prouvée sur du texte écrit pour l\'occasion', () => {
  const site = (text: string) => consoleSitesOf('essai.ts', text)

  it('trouve un avertissement et une erreur, avec leurs arguments entiers', () => {
    const [a, b] = site('µ.warn(µ._mjs_msg(\'k\', { l: x.join(\', \') }))\nµ.error(\'e\', err)')
    assert.equal(a.method, 'warn')
    assert.equal(a.args, 'µ._mjs_msg(\'k\', { l: x.join(\', \') })')
    assert.equal(b.method, 'error')
    assert.equal(b.args, '\'e\', err')
  })

  it('ne voit ni une chaîne, ni un commentaire, ni une définition, et compte un usage indirect', () => {
    assert.deepEqual(site('// µ.warn(1)\nvar s = \'µ.error(2)\'\nµ.warn = function() {}'), [])
    assert.equal(consoleStrays('µ.warn = function() {}\nµ.warn(1)'), 0)
    assert.equal(consoleStrays('(µ.warn || console.warn)(1)'), 1)
  })

  it('laisse passer le texte de la table et les lectures, refuse le reste', () => {
    assert.deepEqual(consoleViolations(site('µ.warn(µ._mjs_msg(\'k\', { n: String(v), t: el.tagName.toLowerCase(), o: Object.keys(o).join(\', \') }))')[0]), [])
    assert.deepEqual(consoleViolations(site('µ.error(µ._mjs_txt(\'k\'), e)')[0]), [])
    assert.deepEqual(consoleViolations(site('µ.warn(f(1))')[0]), ['appel de f'])
    for (const args of ['x = 1', 'i++', 'await p', 'new Date']) assert.ok(consoleViolations(site(`µ.error(${args})`)[0]).length > 0, args)
  })
})

describe('avertissements et erreurs du runtime — aucun ne porte d\'effet de bord', () => {
  const files   = runtimeFiles(RUNTIME_DIR)
  const sources = new Map(files.map(f => [relative(RUNTIME_DIR, f), readFileSync(f, 'utf-8')]))
  const sites   = [...sources].flatMap(([f, src]) => consoleSitesOf(f, src))

  it('la lecture trouve les appels connus (la garde ne passe pas à vide)', () => {
    const count = (file: string, method: string) => sites.filter(s => s.file === file && s.method === method).length
    assert.ok(sites.filter(s => s.method === 'warn').length >= 180)
    assert.ok(sites.filter(s => s.method === 'error').length >= 50)
    assert.ok(count('mjs_ujs.ts', 'warn') >= 20)
    assert.ok(count('mjs_socket.ts', 'error') >= 4)
    assert.ok(count(join('animations', 'bars.ts'), 'warn') >= 1)
  })

  it('les arguments d\'un avertissement ou d\'une erreur : ni affectation, ni appel hors de la liste', () => {
    const used = new Set<string>()
    const bad: string[] = []
    for (const s of sites) {
      const exception = CONSOLE_EXCEPTIONS.find(e => e.file === s.file && s.args.includes(e.fragment))
      if (exception) { used.add(exception.fragment); continue }
      const v = consoleViolations(s)
      if (v.length) bad.push(`${s.file}:${s.line} — ${v.join(', ')}`)
    }
    assert.deepEqual(bad, [])
    assert.deepEqual([...used], CONSOLE_EXCEPTIONS.map(e => e.fragment), 'une exception ne sert plus : retirez-la de la liste')
  })

  it('les usages indirects de µ.warn et µ.error sont ceux de la liste (ils restent dans le code envoyé)', () => {
    const strays: Record<string, number> = {}
    for (const [f, src] of sources) { const n = consoleStrays(src); if (n) strays[f] = n }
    assert.deepEqual(strays, STRAYS_CONSOLE)
  })
})
