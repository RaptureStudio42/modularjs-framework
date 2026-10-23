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
const RESERVES = ['on', 'duration', 'delay', 'easing', 'once', 'range']
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
function fermante(s: string, i: number): number {
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
// les parenthèses, c'est un réglage, et un commentaire y est refusé (cf. sansNote)
function sansCommentaire(texte: string): string {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < texte.length; i++) {
    const ch = texte[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === '/' && texte[i + 1] === '/' && depth === 0) return texte.slice(0, i).trimEnd()
  }
  return texte
}

// un nom que JavaScript donne déjà à tout objet (`constructor`, `toString`…) : ni un effet ni un réglage ne le prend, il
// tomberait sur la méthode héritée
const prisParJs = (nom: string): boolean => nom in Object.prototype

// `(…)` équilibrée en fin de chaîne : [ce qui précède, le contenu] ; null si la chaîne ne finit pas
// par une parenthèse fermante qui répond à la première ouvrante
function parens(s: string): [string, string] | null {
  const i = s.indexOf('(')
  if (i < 0 || !s.endsWith(')')) return null
  const j = fermante(s, i)
  return j === s.length - 1 ? [s.slice(0, i), s.slice(i + 1, j)] : null
}

/** les effets écrits dans un bloc <effects> (non résolus : cf. collectEffectDefs) ; `problems` : une faute y est rangée au lieu de lever, pour que la
 * lecture aille au bout — un nom défini deux fois (la première définition reste), une déclaration illisible (elle est sautée avec ce qu'elle porte en
 * retrait : les déclarations d'avant et d'après restent lues, leurs alias connus) */
export function parseEffectsBlock(raw: string, startLine: number, file: string, problems?: Error[]): Record<string, Written> {
  const fichier = basename(file)
  const lignes  = raw.split('\n').map((text, i) => ({ text: text.replace(/\s+$/, ''), indent: (/^[ \t]*/.exec(text)![0]).replace(/\t/g, '  ').length, line: startLine + i }))
  // une ligne qui n'est qu'un commentaire est retirée, comme le fait SASS
  const pleines = lignes.filter(l => l.text.trim() !== '' && !isCommentLine(l.text))
  const faute   = (l: { line: number, text: string }, cle: MsgKey, vars: Record<string, string> = {}) => new Error(t(cle, { fichier, ligne: l.line, texte: l.text.trim(), ...vars }))
  const out: Record<string, Written> = {}
  if (pleines.length === 0) return out
  const base = pleines[0].indent
  // une déclaration (sa ligne, puis ce qui est plus en retrait qu'elle) : l'index de la suivante
  const declaration = (i: number): number => {
    const l = pleines[i]
    if (l.indent !== base) throw faute(l, 'effets-fichier.retrait')
    const texte = sansCommentaire(l.text.trim())
    const m = /^\*([A-Za-z][\w-]*)(?:\.([^\s=(]*))?\s*([\s\S]*)$/.exec(texte)
    if (!m) throw faute(l, 'effets-fichier.ligne')
    // `*filter.frosted_glass = …` : un alias, rattaché à son effet ; son nom en minuscules, chiffres et _
    const alias = m[2]
    if (alias !== undefined && !ALIAS_NAME.test(alias)) throw faute(l, 'effets-fichier.alias-nom', { effet: m[1], alias, exemple: aliasExample(m[1]) })
    const nom = alias === undefined ? m[1] : m[1] + '.' + alias
    if (alias === undefined && prisParJs(nom)) throw faute(l, 'effets-fichier.nom-js', { nom })
    // des réglages sans commentaire : il se lirait comme une valeur et ferait perdre les réglages qui le suivent
    const sansNote = (reglages: string): void => {
      const trouve = settingsComment(reglages)
      if (trouve) throw faute(l, 'effets-fichier.commentaire', { nom, commentaire: trouve.text })
    }
    let reste = m[3]
    let params: string | null = null
    // `*nom(réglages) =` : les réglages d'un effet CSS, avant le `=`
    if (reste.startsWith('(')) {
      const fin = fermante(reste, 0)
      if (fin < 0) throw faute(l, 'effets-fichier.ligne')
      params = reste.slice(1, fin)
      reste  = reste.slice(fin + 1).trim()
      sansNote(params)
    }
    if (!reste.startsWith('=')) throw faute(l, 'effets-fichier.ligne')
    reste = reste.slice(1).trim()
    if (alias !== undefined && reste === '') throw faute(l, 'effets-fichier.alias-cible', { effet: m[1], alias })
    // les lignes du corps : plus en retrait que la définition
    const corps: typeof pleines = []
    let j = i + 1
    while (j < pleines.length && pleines[j].indent > base) corps.push(pleines[j++])
    if (Object.prototype.hasOwnProperty.call(out, nom)) {
      const doublon = faute(l, 'effets-fichier.double', { nom })
      if (!problems) throw doublon
      problems.push(doublon)
      return j
    }
    if (reste !== '') {
      // `*nom = *base(réglages)` : un effet réglé ; rien en dessous
      if (params !== null) throw faute(l, 'effets-fichier.alias-reglages', { nom })
      if (corps.length > 0) throw faute(corps[0], 'effets-fichier.alias-corps', { nom })
      const cible = /^\*([A-Za-z][\w-]*)$/.exec(reste)
      const avec  = cible ? null : parens(reste)
      if (avec) sansNote(avec[1])
      const cm    = cible ?? (avec ? /^\*([A-Za-z][\w-]*)$/.exec(avec[0].trim()) : null)
      if (!cm) {
        // un ancien nom pointé (`*typing.typewriter`, un alias livré retiré) : le message dit quoi écrire à la place
        const pointe = /^\*([A-Za-z][\w-]*\.[a-z][a-z0-9_]*)$/.exec(avec ? avec[0].trim() : reste)
        const gone   = pointe ? removedEffectError(pointe[1], avec ? avec[1] : '', true) : null
        throw gone ? faute(l, 'effets-fichier.reglage-faux', { detail: gone.replace(/^\[ModularJS\] /, '') }) : faute(l, 'effets-fichier.ligne')
      }
      // un alias d'un effet fondu dans un autre (`*shimmer.lent = *shimmer(…)`) : il se rattache à celui qui l'a repris
      const fondu = alias === undefined ? null : replacedAlias(m[1], alias, cm[1], avec ? avec[1] : '')
      if (fondu) throw faute(l, 'effets-fichier.alias-fondu', { effet: m[1], alias, nouveau: fondu.nouveau, ecriture: fondu.ecriture })
      if (alias !== undefined && (cm[1] !== m[1] || !EFFECTS[m[1]])) throw faute(l, 'effets-fichier.alias-cible', { effet: m[1], alias })
      out[nom] = { target: cm[1], args: avec ? avec[1] : '', file, line: l.line }
      return j
    }
    // `*nom(réglages) =` puis le CSS ; un commentaire `//` est retiré (le navigateur jetterait la déclaration), une ligne qui n'est qu'un commentaire est ignorée
    const css = corps.filter(c => !isCommentLine(c.text)).map(c => ({ ...c, code: stripLineComment(c.text) }))
    if (css.length === 0) throw faute(l, 'effets-fichier.vide', { nom })
    const reglages: Array<[string, string]> = []
    for (const item of params === null ? [] : splitTop(params)) {
      const pm = /^([A-Za-z][\w-]*)\s*:\s*([\s\S]+)$/.exec(item)
      if (!pm) throw faute(l, 'effets-fichier.reglage', { nom, reglage: item })
      if (RESERVES.includes(pm[1])) throw faute(l, 'effets-fichier.reserve', { nom, reglage: pm[1], liste: RESERVES.join(', ') })
      if (prisParJs(pm[1])) throw faute(l, 'effets-fichier.nom-js', { nom: pm[1] })
      const v = pm[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
      // un défaut ne lit pas `$réglage` : la feuille le garderait tel quel (refusé aussi quand on change ce réglage, plus bas)
      if (v === '' || /[;{}$]/.test(v)) throw faute(l, 'effets-fichier.reglage', { nom, reglage: item })
      if (!closedCss(v)) throw faute(l, 'effets-fichier.non-ferme', { nom, texte: item })
      reglages.push([pm[1], v])
    }
    const connus = new Set(reglages.map(r => r[0]))
    const valeur = (c: typeof pleines[number], v: string) => {
      if (v === '' || /[;{}]/.test(v)) throw faute(c, 'effets-fichier.declaration', { nom })
      if (!closedCss(v)) throw faute(c, 'effets-fichier.non-ferme', { nom })
      for (const ref of v.matchAll(/\$([A-Za-z_][\w-]*)/g)) {
        if (!connus.has(ref[1])) throw faute(c, 'effets-fichier.inconnu', { nom, reglage: ref[1], liste: [...connus].map(k => '$' + k).join(', ') || '—' })
      }
      return v
    }
    const decls: Array<[string, string]> = []
    const keyframes: Array<[string, Array<[string, string]>]> = []
    const niveau = css[0].indent
    let k = 0
    while (k < css.length) {
      const c = css[k]
      if (c.indent !== niveau) throw faute(c, 'effets-fichier.retrait')
      const tc = c.code.trim()
      if (tc === '@keyframes') {
        k++
        let etape: [string, Array<[string, string]>] | null = null
        while (k < css.length && css[k].indent > niveau) {
          const e  = css[k]
          const te = e.code.trim()
          if (SEL_RE.test(te)) {
            etape = [te.replace(/\s*,\s*/g, ', '), []]
            keyframes.push(etape)
          }
          else {
            const dm = /^(-?[a-z][a-z0-9-]*)\s*:\s*([\s\S]*)$/.exec(te)
            if (!dm || !etape || !PROP_RE.test(dm[1])) throw faute(e, 'effets-fichier.images-cles', { nom })
            etape[1].push([dm[1], valeur(e, dm[2].trim())])
          }
          k++
        }
        if (keyframes.length === 0) throw faute(c, 'effets-fichier.images-cles', { nom })
        continue
      }
      const dm = /^(-?[a-z][a-z0-9-]*)\s*:\s*([\s\S]*)$/.exec(tc)
      if (!dm || !PROP_RE.test(dm[1])) throw faute(c, 'effets-fichier.declaration', { nom })
      decls.push([dm[1], valeur(c, dm[2].trim())])
      k++
    }
    out[nom] = { params: reglages, decls, keyframes, file, line: l.line }
    return j
  }
  let i = 0
  while (i < pleines.length) {
    try {
      i = declaration(i)
    }
    catch (e) {
      if (!problems) throw e
      problems.push(e as Error)
      i++
      while (i < pleines.length && pleines[i].indent > base) i++
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
  const ecrits: Record<string, Written> = parseEffectsBlock(MJS_ALIASES, 1, MJS_ALIASES_FILE)
  const livres = new Set(Object.keys(ecrits))
  for (const p of parts) {
    for (const [nom, e] of Object.entries(p)) {
      const ici = basename(e.file)
      if (EFFECTS[nom]) {
        const pris = new Error(t('effets-fichier.nom-pris', { fichier: ici, ligne: e.line, nom }))
        if (!problems) throw pris
        problems.push(pris)
        continue
      }
      if (livres.has(nom)) {
        livres.delete(nom)
        warn?.(t('effets-fichier.alias-remplace', { fichier: ici, ligne: e.line, nom }))
      }
      else if (Object.prototype.hasOwnProperty.call(ecrits, nom)) {
        const doublon = new Error(t('effets-fichier.nom-double', { nom, fichier1: basename(ecrits[nom].file), fichier2: ici }))
        if (!problems) throw doublon
        problems.push(doublon)
        continue
      }
      ecrits[nom] = e
    }
  }
  const out: Record<string, ProjectEffect> = {}
  const fautes = new Map<string, Error>()
  const resolution = (nom: string, chaine: string[]): ProjectEffect => {
    if (out[nom]) return out[nom]
    const e = ecrits[nom]
    if (e.target === undefined) return (out[nom] = { params: e.params, decls: e.decls, keyframes: e.keyframes, file: e.file, line: e.line })
    const ici = basename(e.file)
    if (chaine.includes(nom)) throw new Error(t('effets-fichier.boucle', { fichier: ici, ligne: e.line, chaine: [...chaine, nom].map(n => '*' + n).join(' → ') }))
    // les effets du fichier donnés en réglage (`*vague = *delta(fx: *halo)`) : résolus d'abord, la
    // vérification des réglages les lit (cf. withProjectEffects plus bas)
    for (const n of nestedNames(e.args ?? '')) {
      if (Object.prototype.hasOwnProperty.call(ecrits, n)) resoudre(n, [...chaine, nom])
    }
    const cible = e.target
    if (EFFECTS[cible]) {
      let r
      try {
        r = withProjectEffects(out, () => asWritten(nom, cible, () => parseEffect(cible, e.args ?? '', [], true)))
      }
      catch (err: any) {
        throw new Error(t('effets-fichier.reglage-faux', { fichier: ici, ligne: e.line, detail: String(err?.message ?? err).replace(/^\[ModularJS\] /, '') }))
      }
      if (Object.keys(r.dynamic).length > 0) throw new Error(t('effets-fichier.variable', { fichier: ici, ligne: e.line, nom }))
      return (out[nom] = { base: cible, fixed: r.fixed, file: e.file, line: e.line })
    }
    if (!Object.prototype.hasOwnProperty.call(ecrits, cible)) {
      // un effet retiré, ou fondu dans un autre (`*titre = *lens(150)`) : son remplaçant, réglages traduits
      const gone = removedEffectError(cible, e.args ?? '', true)
      if (gone) throw new Error(t('effets-fichier.reglage-faux', { fichier: ici, ligne: e.line, detail: gone.replace(/^\[ModularJS\] /, '') }))
      const tous = [...Object.keys(EFFECTS), ...Object.keys(ecrits)]
      const proche = tous.find(n => n.toLowerCase() === cible.toLowerCase())
      throw new Error(t('effets-fichier.cible-inconnue', { fichier: ici, ligne: e.line, nom, cible, suggestion: proche ? ` (*${proche} ?)` : '' }))
    }
    const dessous = resoudre(cible, [...chaine, nom])
    if (dessous.base) {
      // un effet réglé d'un effet réglé : ses réglages par-dessus, vérifiés sur l'effet de la bibliothèque
      let r
      try {
        r = withProjectEffects(out, () => asWritten(nom, dessous.base!, () => parseEffect(dessous.base!, e.args ?? '', [], true)))
      }
      catch (err: any) {
        throw new Error(t('effets-fichier.reglage-faux', { fichier: ici, ligne: e.line, detail: String(err?.message ?? err).replace(/^\[ModularJS\] /, '') }))
      }
      if (Object.keys(r.dynamic).length > 0) throw new Error(t('effets-fichier.variable', { fichier: ici, ligne: e.line, nom }))
      return (out[nom] = { base: dessous.base, fixed: { ...dessous.fixed, ...r.fixed }, file: e.file, line: e.line })
    }
    // un effet CSS réglé : ses valeurs par défaut changées
    const params = (dessous.params ?? []).map(([k, v]) => [k, v] as [string, string])
    for (const item of splitTop(e.args ?? '')) {
      const pm = /^([A-Za-z][\w-]*)\s*:\s*([\s\S]+)$/.exec(item)
      const k  = pm ? pm[1] : params[0]?.[0]
      const v  = (pm ? pm[2] : item).trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
      const at = params.findIndex(p => p[0] === k)
      if (at < 0 || v === '' || /[;{}$]/.test(v)) throw new Error(t('effets-fichier.reglage', { fichier: ici, ligne: e.line, texte: item, nom, reglage: item }))
      if (!closedCss(v)) throw new Error(t('effets-fichier.non-ferme', { fichier: ici, ligne: e.line, texte: item, nom }))
      params[at] = [k!, v]
    }
    return (out[nom] = { params, decls: dessous.decls, keyframes: dessous.keyframes, file: e.file, line: e.line })
  }
  // la faute d'un effet est celle de chaque effet qui s'y règle : la même erreur remonte, elle n'est dite qu'une fois
  const resoudre = (nom: string, chaine: string[]): ProjectEffect => {
    if (out[nom]) return out[nom]
    const connue = fautes.get(nom)
    if (connue) throw connue
    try {
      return resolution(nom, chaine)
    }
    catch (err) {
      fautes.set(nom, err as Error)
      throw err
    }
  }
  const dites = new Set<Error>()
  for (const nom of Object.keys(ecrits)) {
    try {
      resoudre(nom, [])
    }
    catch (err) {
      if (!problems) throw err
      if (!dites.has(err as Error)) problems.push(err as Error)
      dites.add(err as Error)
    }
  }
  return out
}
