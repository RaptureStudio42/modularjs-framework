// effects/project — les effets de l'appli, écrits dans un fichier `*.effects.mjs` (un bloc <effects>),
// valables dans tous ses composants :
//
//   *titre = *scramble(311, on: click, order: left)    un effet de la bibliothèque réglé une fois pour
//                                                      toutes : `*titre` le pose tel quel,
//                                                      `*titre(delay: 0s)` change un réglage à la pose
//   *halo(color: #0ff, size: 12px) =                   un effet à soi, en CSS : ses réglages et leur
//     box-shadow: 0 0 $size $color                     valeur par défaut, puis ses déclarations
//     transition: box-shadow 300ms                     (`$réglage` : la valeur du réglage)
//   *battement(scale: 1.1) =                           `@keyframes` en fait une animation
//     @keyframes
//       50%
//         transform: scale($scale)
//
// Un effet de la bibliothèque réglé se résout à la compilation (rien n'en reste à l'exécution) ; un
// effet CSS part avec chaque composant qui l'utilise (runtime/mjs_fx_custom.ts construit sa feuille).

import { basename } from 'node:path'
import { EFFECTS, ALIAS_NAME, parseEffect, withProjectEffects, asWritten, closedCss, removedEffectError, replacedAlias, type ProjectEffect } from './catalog.js'
import { t, type MsgKey } from '../messages/index.js'
import { MJS_ALIASES, MJS_ALIASES_FILE, aliasExample } from './aliases-mjs.js'
import { settingsComment } from './settings-comment.js'
import { isCommentLine, stripLineComment } from './style-comment.js'

/** un effet tel qu'écrit, avant résolution : l'effet qu'il règle et ses réglages bruts, ou son CSS */
interface Written extends ProjectEffect {
  target?: string
  args?: string
}

// réglages que tout effet CSS a déjà : ils ne se déclarent pas
const RESERVED = ['on', 'duration', 'delay', 'easing', 'once', 'range', 'visible']
const PROP_RE  = /^-?[a-z][a-z0-9-]*$/
const SEL_RE   = /^(?:from|to|\d{1,3}(?:\.\d+)?%)(?:\s*,\s*(?:from|to|\d{1,3}(?:\.\d+)?%))*$/

// découpe aux virgules de premier niveau
function splitTop(raw: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let cur = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (quote) {
      cur += ch
      // un antislash garde dans la chaîne le caractère qui le suit (`"a\"b"`)
      if (ch === '\\' && i + 1 < raw.length) cur += raw[++i]
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') quote = ch
    else if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim() !== '') out.push(cur.trim())
  return out
}

// la parenthèse qui ferme celle ouverte en `i` (guillemets respectés), -1 sinon
function closing(s: string, i: number): number {
  let depth = 0
  let quote: string | null = null
  for (let j = i; j < s.length; j++) {
    const ch = s[j]
    if (quote) {
      if (ch === '\\') j++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')' && --depth === 0) return j
  }
  return -1
}

// les effets donnés en réglage dans des réglages bruts (`fx: *halo`, `*titre(10)` en réglage principal) :
// leurs noms — une valeur qui commence par `*`, jamais un mot d'une liste ou d'une chaîne
function nestedNames(args: string): string[] {
  const out: string[] = []
  for (const item of splitTop(args)) {
    const m = /^(?:[A-Za-z][\w-]*\s*:\s*)?\*([A-Za-z][\w-]*)/.exec(item)
    if (m) out.push(m[1])
  }
  return out
}

// une ligne de déclaration sans son commentaire `//` de fin, écrit hors des parenthèses — retiré, comme le fait SASS ; entre
// les parenthèses, c'est un réglage, et un commentaire y est refusé (cf. assertNoComment)
function withoutComment(text: string): string {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === '/' && text[i + 1] === '/' && depth === 0) return text.slice(0, i).trimEnd()
  }
  return text
}

// un nom que JavaScript donne déjà à tout objet (`constructor`, `toString`…) : ni un effet ni un réglage ne le prend, il
// tomberait sur la méthode héritée
const takenByJs = (name: string): boolean => name in Object.prototype

// `(…)` équilibrée en fin de chaîne : [ce qui précède, le contenu] ; null si la chaîne ne finit pas
// par une parenthèse fermante qui répond à la première ouvrante
function parens(s: string): [string, string] | null {
  const i = s.indexOf('(')
  if (i < 0 || !s.endsWith(')')) return null
  const j = closing(s, i)
  return j === s.length - 1 ? [s.slice(0, i), s.slice(i + 1, j)] : null
}

/** les effets écrits dans un bloc <effects> (non résolus : cf. collectEffectDefs) ; `problems` : une faute y est rangée au lieu de lever, pour que la
 * lecture aille au bout — un nom défini deux fois (la première définition reste), une déclaration illisible (elle est sautée avec ce qu'elle porte en
 * retrait : les déclarations d'avant et d'après restent lues, leurs alias connus) */
export function parseEffectsBlock(raw: string, startLine: number, file: string, problems?: Error[]): Record<string, Written> {
  const fileName = basename(file)
  const lines    = raw.split('\n').map((text, i) => ({ text: text.replace(/\s+$/, ''), indent: (/^[ \t]*/.exec(text)![0]).replace(/\t/g, '  ').length, line: startLine + i }))
  // une ligne qui n'est qu'un commentaire est retirée, comme le fait SASS
  const full                         = lines.filter(l => l.text.trim() !== '' && !isCommentLine(l.text))
  const fault                        = (l: { line: number, text: string }, key: MsgKey, vars: Record<string, string> = {}) => new Error(t(key, { file: fileName, line: l.line, text: l.text.trim(), ...vars }))
  const out: Record<string, Written> = {}
  if (full.length === 0) return out
  const base = full[0].indent
  // une déclaration (sa ligne, puis ce qui est plus en retrait qu'elle) : l'index de la suivante
  const declaration = (i: number): number => {
    const l = full[i]
    if (l.indent !== base) throw fault(l, 'effects-file.indent')
    const text = withoutComment(l.text.trim())
    const m = /^\*([A-Za-z][\w-]*)(?:\.([^\s=(]*))?\s*([\s\S]*)$/.exec(text)
    if (!m) throw fault(l, 'effects-file.line')
    // `*filter.frosted_glass = …` : un alias, rattaché à son effet ; son nom en minuscules, chiffres et _
    const alias = m[2]
    if (alias !== undefined && !ALIAS_NAME.test(alias)) throw fault(l, 'effects-file.alias-name', { effect: m[1], alias, example: aliasExample(m[1]) })
    const name = alias === undefined ? m[1] : m[1] + '.' + alias
    if (alias === undefined && takenByJs(name)) throw fault(l, 'effects-file.name-js', { name: name })
    // des réglages sans commentaire : il se lirait comme une valeur et ferait perdre les réglages qui le suivent
    const assertNoComment = (settings: string): void => {
      const found = settingsComment(settings)
      if (found) throw fault(l, 'effects-file.comment', { name: name, comment: found.text })
    }
    let rest = m[3]
    let params: string | null = null
    // `*nom(réglages) =` : les réglages d'un effet CSS, avant le `=`
    if (rest.startsWith('(')) {
      const end = closing(rest, 0)
      if (end < 0) throw fault(l, 'effects-file.line')
      params = rest.slice(1, end)
      rest   = rest.slice(end + 1).trim()
      assertNoComment(params)
    }
    if (!rest.startsWith('=')) throw fault(l, 'effects-file.line')
    rest = rest.slice(1).trim()
    if (alias !== undefined && rest === '') throw fault(l, 'effects-file.alias-target', { effect: m[1], alias })
    // les lignes du corps : plus en retrait que la définition
    const body: typeof full = []
    let j = i + 1
    while (j < full.length && full[j].indent > base) body.push(full[j++])
    if (Object.prototype.hasOwnProperty.call(out, name)) {
      const duplicate = fault(l, 'effects-file.duplicate', { name: name })
      if (!problems) throw duplicate
      problems.push(duplicate)
      return j
    }
    if (rest !== '') {
      // `*nom = *base(réglages)` : un effet réglé ; rien en dessous
      if (params !== null) throw fault(l, 'effects-file.alias-settings', { name: name })
      if (body.length > 0) throw fault(body[0], 'effects-file.alias-body', { name: name })
      const target     = /^\*([A-Za-z][\w-]*)$/.exec(rest)
      const withClause = target ? null : parens(rest)
      if (withClause) assertNoComment(withClause[1])
      const cm    = target ?? (withClause ? /^\*([A-Za-z][\w-]*)$/.exec(withClause[0].trim()) : null)
      if (!cm) {
        // un ancien nom pointé (`*typing.typewriter`, un alias livré retiré) : le message dit quoi écrire à la place
        const pointer = /^\*([A-Za-z][\w-]*\.[a-z][a-z0-9_]*)$/.exec(withClause ? withClause[0].trim() : rest)
        const gone    = pointer ? removedEffectError(pointer[1], withClause ? withClause[1] : '', true) : null
        throw gone ? fault(l, 'effects-file.setting-wrong', { detail: gone.replace(/^\[ModularJS\] /, '') }) : fault(l, 'effects-file.line')
      }
      // un alias d'un effet fondu dans un autre (`*shimmer.lent = *shimmer(…)`) : il se rattache à celui qui l'a repris
      const merged = alias === undefined ? null : replacedAlias(m[1], alias, cm[1], withClause ? withClause[1] : '')
      if (merged) throw fault(l, 'effects-file.alias-merged', { effect: m[1], alias, newName: merged.fresh, writing: merged.write })
      if (alias !== undefined && (cm[1] !== m[1] || !EFFECTS[m[1]])) throw fault(l, 'effects-file.alias-target', { effect: m[1], alias })
      out[name] = { target: cm[1], args: withClause ? withClause[1] : '', file, line: l.line }
      return j
    }
    // `*nom(réglages) =` puis le CSS ; un commentaire `//` est retiré (le navigateur jetterait la déclaration), une ligne qui n'est qu'un commentaire est ignorée
    const css = body.filter(c => !isCommentLine(c.text)).map(c => ({ ...c, code: stripLineComment(c.text) }))
    if (css.length === 0) throw fault(l, 'effects-file.empty', { name: name })
    const settings: Array<[string, string]> = []
    for (const item of params === null ? [] : splitTop(params)) {
      const pm = /^([A-Za-z][\w-]*)\s*:\s*([\s\S]+)$/.exec(item)
      if (!pm) throw fault(l, 'effects-file.setting', { name: name, setting: item })
      if (RESERVED.includes(pm[1])) throw fault(l, 'effects-file.reserved', { name: name, setting: pm[1], list: RESERVED.join(', ') })
      if (takenByJs(pm[1])) throw fault(l, 'effects-file.name-js', { name: pm[1] })
      const v = pm[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
      // un défaut ne lit pas `$réglage` : la feuille le garderait tel quel (refusé aussi quand on change ce réglage, plus bas)
      if (v === '' || /[;{}$]/.test(v)) throw fault(l, 'effects-file.setting', { name: name, setting: item })
      if (!closedCss(v)) throw fault(l, 'effects-file.not-closed', { name: name, text: item })
      settings.push([pm[1], v])
    }
    const known = new Set(settings.map(r => r[0]))
    const value = (c: typeof full[number], v: string) => {
      if (v === '' || /[;{}]/.test(v)) throw fault(c, 'effects-file.declaration', { name: name })
      if (!closedCss(v)) throw fault(c, 'effects-file.not-closed', { name: name })
      for (const ref of v.matchAll(/\$([A-Za-z_][\w-]*)/g)) {
        if (!known.has(ref[1])) throw fault(c, 'effects-file.unknown', { name: name, setting: ref[1], list: [...known].map(k => '$' + k).join(', ') || '—' })
      }
      return v
    }
    const decls: Array<[string, string]> = []
    const keyframes: Array<[string, Array<[string, string]>]> = []
    const level = css[0].indent
    let k = 0
    while (k < css.length) {
      const c = css[k]
      if (c.indent !== level) throw fault(c, 'effects-file.indent')
      const tc = c.code.trim()
      if (tc === '@keyframes') {
        k++
        let step: [string, Array<[string, string]>] | null = null
        while (k < css.length && css[k].indent > level) {
          const e  = css[k]
          const te = e.code.trim()
          if (SEL_RE.test(te)) {
            step = [te.replace(/\s*,\s*/g, ', '), []]
            keyframes.push(step)
          }
          else {
            const dm = /^(-?[a-z][a-z0-9-]*)\s*:\s*([\s\S]*)$/.exec(te)
            if (!dm || !step || !PROP_RE.test(dm[1])) throw fault(e, 'effects-file.keyframes', { name: name })
            step[1].push([dm[1], value(e, dm[2].trim())])
          }
          k++
        }
        if (keyframes.length === 0) throw fault(c, 'effects-file.keyframes', { name: name })
        continue
      }
      const dm = /^(-?[a-z][a-z0-9-]*)\s*:\s*([\s\S]*)$/.exec(tc)
      if (!dm || !PROP_RE.test(dm[1])) throw fault(c, 'effects-file.declaration', { name: name })
      decls.push([dm[1], value(c, dm[2].trim())])
      k++
    }
    out[name] = { params: settings, decls, keyframes, file, line: l.line }
    return j
  }
  let i = 0
  while (i < full.length) {
    try {
      i = declaration(i)
    }
    catch (e) {
      if (!problems) throw e
      problems.push(e as Error)
      i++
      while (i < full.length && full[i].indent > base) i++
    }
  }
  return out
}

/** tous les effets de l'appli, résolus : un nom par appli, jamais celui d'un effet de la
 * bibliothèque ; `problems` : une faute y est rangée, une seule fois, au lieu de lever (l'effet fautif, et celui qui en dépend, manquent, les autres sont rendus) ; un effet réglé pointe l'effet de la bibliothèque qu'il règle (à travers d'autres
 * effets réglés), avec ses réglages vérifiés — des valeurs fixes, le fichier vaut pour toute l'appli ;
 * un effet réglé qui en règle un CSS devient un effet CSS aux valeurs par défaut changées */
export function resolveProjectEffects(parts: Array<Record<string, Written>>, warn?: (message: string) => void, problems?: Error[]): Record<string, ProjectEffect> {
  // les alias que ModularJS livre : ceux de l'appli de même nom les remplacent (avertissement)
  const written: Record<string, Written> = parseEffectsBlock(MJS_ALIASES, 1, MJS_ALIASES_FILE)
  const shipped = new Set(Object.keys(written))
  for (const p of parts) {
    for (const [name, e] of Object.entries(p)) {
      const here = basename(e.file)
      if (EFFECTS[name]) {
        const taken = new Error(t('effects-file.name-taken', { file: here, line: e.line, name: name }))
        if (!problems) throw taken
        problems.push(taken)
        continue
      }
      if (shipped.has(name)) {
        shipped.delete(name)
        warn?.(t('effects-file.alias-replaced', { file: here, line: e.line, name: name }))
      }
      else if (Object.prototype.hasOwnProperty.call(written, name)) {
        const duplicate = new Error(t('effects-file.name-duplicate', { name: name, file1: basename(written[name].file), file2: here }))
        if (!problems) throw duplicate
        problems.push(duplicate)
        continue
      }
      written[name] = e
    }
  }
  const out: Record<string, ProjectEffect> = {}
  const faults = new Map<string, Error>()
  const resolution = (name: string, str: string[]): ProjectEffect => {
    if (out[name]) return out[name]
    const e = written[name]
    if (e.target === undefined) return (out[name] = { params: e.params, decls: e.decls, keyframes: e.keyframes, file: e.file, line: e.line })
    const here = basename(e.file)
    if (str.includes(name)) throw new Error(t('effects-file.loop', { file: here, line: e.line, chain: [...str, name].map(n => '*' + n).join(' → ') }))
    // les effets du fichier donnés en réglage (`*vague = *delta(fx: *halo)`) : résolus d'abord, la
    // vérification des réglages les lit (cf. withProjectEffects plus bas)
    for (const n of nestedNames(e.args ?? '')) {
      if (Object.prototype.hasOwnProperty.call(written, n)) resolve(n, [...str, name])
    }
    const target = e.target
    if (EFFECTS[target]) {
      let r
      try {
        r = withProjectEffects(out, () => asWritten(name, target, () => parseEffect(target, e.args ?? '', [], true)))
      }
      catch (err: any) {
        throw new Error(t('effects-file.setting-wrong', { file: here, line: e.line, detail: String(err?.message ?? err).replace(/^\[ModularJS\] /, '') }))
      }
      if (Object.keys(r.dynamic).length > 0) throw new Error(t('effects-file.variable', { file: here, line: e.line, name: name }))
      return (out[name] = { base: target, fixed: r.fixed, file: e.file, line: e.line })
    }
    if (!Object.prototype.hasOwnProperty.call(written, target)) {
      // un effet retiré, ou fondu dans un autre (`*titre = *lens(150)`) : son remplaçant, réglages traduits
      const gone = removedEffectError(target, e.args ?? '', true)
      if (gone) throw new Error(t('effects-file.setting-wrong', { file: here, line: e.line, detail: gone.replace(/^\[ModularJS\] /, '') }))
      const all = [...Object.keys(EFFECTS), ...Object.keys(written)]
      const near = all.find(n => n.toLowerCase() === target.toLowerCase())
      throw new Error(t('effects-file.target-unknown', { file: here, line: e.line, name: name, target: target, suggestion: near ? ` (*${near} ?)` : '' }))
    }
    const below = resolve(target, [...str, name])
    if (below.base) {
      // un effet réglé d'un effet réglé : ses réglages par-dessus, vérifiés sur l'effet de la bibliothèque
      let r
      try {
        r = withProjectEffects(out, () => asWritten(name, below.base!, () => parseEffect(below.base!, e.args ?? '', [], true)))
      }
      catch (err: any) {
        throw new Error(t('effects-file.setting-wrong', { file: here, line: e.line, detail: String(err?.message ?? err).replace(/^\[ModularJS\] /, '') }))
      }
      if (Object.keys(r.dynamic).length > 0) throw new Error(t('effects-file.variable', { file: here, line: e.line, name: name }))
      return (out[name] = { base: below.base, fixed: { ...below.fixed, ...r.fixed }, file: e.file, line: e.line })
    }
    // un effet CSS réglé : ses valeurs par défaut changées
    const params = (below.params ?? []).map(([k, v]) => [k, v] as [string, string])
    for (const item of splitTop(e.args ?? '')) {
      const pm = /^([A-Za-z][\w-]*)\s*:\s*([\s\S]+)$/.exec(item)
      const k  = pm ? pm[1] : params[0]?.[0]
      const v  = (pm ? pm[2] : item).trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
      const at = params.findIndex(p => p[0] === k)
      if (at < 0 || v === '' || /[;{}$]/.test(v)) throw new Error(t('effects-file.setting', { file: here, line: e.line, name: name, setting: item }))
      if (!closedCss(v)) throw new Error(t('effects-file.not-closed', { file: here, line: e.line, text: item, name: name }))
      params[at] = [k!, v]
    }
    return (out[name] = { params, decls: below.decls, keyframes: below.keyframes, file: e.file, line: e.line })
  }
  // la faute d'un effet est celle de chaque effet qui s'y règle : la même erreur remonte, elle n'est dite qu'une fois
  const resolve = (name: string, str: string[]): ProjectEffect => {
    if (out[name]) return out[name]
    const known = faults.get(name)
    if (known) throw known
    try {
      return resolution(name, str)
    }
    catch (err) {
      faults.set(name, err as Error)
      throw err
    }
  }
  const told = new Set<Error>()
  for (const name of Object.keys(written)) {
    try {
      resolve(name, [])
    }
    catch (err) {
      if (!problems) throw err
      if (!told.has(err as Error)) problems.push(err as Error)
      told.add(err as Error)
    }
  }
  return out
}
