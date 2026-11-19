// refus à la construction autour des valeurs dérivées qui attendent (`$resultats = await rechercher($q)`, transpiler/await-derived.ts),
// lus sur l'arbre du script d'un composant, où son premier niveau est celui du programme :
// - `await` au premier niveau du script, hors de toute fonction et hors d'une valeur dérivée (`config = await …`, `$x += await …`,
//   `$x =: await …`, un `await` seul) : le script ne s'arrête jamais pour attendre, la construction finissait sur « await hors d'une
//   fonction async » puis « c'est un bogue du bundler » ; le message dit la forme juste ;
// - `await` dans la valeur d'un magasin (`$$x = await …`, `µ$$x = await …`, `new µStore(… await …)`) : un magasin ne garde pas de
//   valeur qui attend (µload(adresse) partage déjà une donnée chargée). Au premier niveau d'un fichier de module ou d'un
//   `<script module>`, la même ligne n'est pas une valeur qui attend : elle tourne une fois, au chargement du module, jamais lue ici ;
// - une valeur qui attend qui se cite, d'elle-même ou par une autre valeur dérivée : chaque réponse relancerait la demande, sans fin.
// Chaque refus cite la ligne du fichier et la forme telles qu'écrites (`x := await …`), cherchées sur le code du fichier (WrittenScript),
// chaînes et commentaires masqués ; sans certitude, aucune ligne (cf. writtenLine), jamais une ligne fausse

import * as walk from 'acorn-walk'
import { t } from '../messages/index.js'
import { maskNonCode, maskHtmlComments } from '../mask.js'

// le texte écrit : son composant (`moduleName`, sans `.mjs`), le rang dans le fichier de sa première ligne, ses lignes, la langue de son
// script ; `fichier` : le fichier entier (scripts, styles, gabarit) plutôt qu'un script seul
export interface WrittenScript { moduleName: string; first: number; lines: string[]; lang?: string; wholeFile?: boolean }

// le code de `ecrit`, chaînes et commentaires blanchis (maskNonCode : même longueur, retours à la ligne gardés), et les places de ses
// scripts ; dans le fichier entier, chaque script dans sa langue, les styles et les commentaires HTML blanchis aussi, le gabarit lu tel
// quel (ses `{…}` sont du code)
const codes = new WeakMap<WrittenScript, { view: string, scripts: Array<[number, number]> }>()
function writtenCode(written: WrittenScript): { view: string, scripts: Array<[number, number]> } {
  const already = codes.get(written)
  if (already !== undefined) return already
  const text = written.lines.join('\n')
  const lang = written.lang ?? 'civet'
  const code = { view: '', scripts: [] as Array<[number, number]> }
  if (!written.wholeFile) {
    code.view    = maskNonCode(text, lang)
    code.scripts = [[0, text.length]]
  }
  else {
    const html = maskHtmlComments(text)
    let cursor = 0
    for (const m of html.matchAll(/(<(script|style)\b[^>]*>)([\s\S]*?)<\/\2\s*>/gi)) {
      const start  = m.index! + m[1].length
      const end    = start + m[3].length
      const inside = text.slice(start, end)
      const style  = m[2].toLowerCase() === 'style'
      code.view   += html.slice(cursor, start) + (style ? inside.replace(/[^\n]/g, ' ') : maskNonCode(inside, /\blang\s*=\s*["']?(\w+)/i.exec(m[1])?.[1] ?? lang))
      if (!style) code.scripts.push([start, end])
      cursor = end
    }
    code.view += html.slice(cursor)
  }
  codes.set(written, code)
  return code
}

// la place de la forme `re` dans le code écrit (writtenCode) : la ligne de sa lecture `k`, celle de son dernier `await` (une valeur écrite
// sur deux lignes, `$r =` puis `await f($q)`), sinon de son début. Citée seulement avec certitude : la forme s'y lit `n` fois, autant que
// le code compilé la porte (`n` négatif : jamais), et dans un script seulement si `inScript` (`'scripts'` : seules celles des scripts
// comptent, pour un code qui ne porte que le script, jamais le gabarit) ; sinon ni ligne ni captures (`m`)
export function writtenLine(written: WrittenScript | undefined, re: RegExp, n = 1, k = 0, inScript: boolean | 'scripts' = false): { moduleName: string; line: number | ''; m: RegExpMatchArray | null } {
  if (written === undefined) return { moduleName: '', line: '', m: null }
  const { view, scripts } = writtenCode(written)
  const inside            = (x: RegExpMatchArray) => scripts.some(([a, b]) => a <= x.index! && x.index! < b)
  const reads              = [...view.matchAll(new RegExp(re.source, re.flags.replace('g', '') + 'g'))].filter((x) => inScript !== 'scripts' || inside(x))
  const m                 = reads[k]
  const certain              = m !== undefined && reads.length === n && (!inScript || reads.every(inside))
  if (!certain) return { moduleName: written.moduleName, line: '', m: null }
  const hint = m.index! + Math.max(m[0].search(/\bawait\b(?![\s\S]*\bawait\b)/), 0)
  return { moduleName: written.moduleName, line: written.first + (view.slice(0, hint).match(/\n/g)?.length ?? 0), m }
}

// un nom écrit (`$x`, `µ$$x`) lu tel quel dans une expression régulière, jamais au milieu d'un autre nom
export const writtenName = (name: string) => '(?<![\\w$µ.@])' + name.replace(/[$.*+?^()[\]{}|\\]/g, '\\$&') + '(?![\\w$])'

// `µ.nom` (membre direct, non calculé)
const mu = (n: any, name: string) => n?.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && n.object.name === 'µ' && n.property.type === 'Identifier' && n.property.name === name

// `$.x` : la variable `x` du composant
const dollar = (n: any): string | null => n?.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && n.object.name === '$' && n.property.type === 'Identifier' ? n.property.name : null

// le magasin qu'écrit ou que crée `p`, écrit comme dans le source (`$$x`, `µ$$x`, `µStore`) : `µ.store.x = …` et `µ._storeSet('x', …)`
// pour `$$x`, `µ_state.x ??= …` pour `µ$$x`, `new µ.Store(…)` ; null sinon
function store(p: any): string | null {
  if (p.type === 'AssignmentExpression' && p.left.type === 'MemberExpression' && !p.left.computed && p.left.property.type === 'Identifier') {
    if (mu(p.left.object, 'store')) return `$$${p.left.property.name} = await …`
    if (p.left.object.type === 'Identifier' && p.left.object.name === 'µ_state') return `µ$$${p.left.property.name} = await …`
  }
  if (p.type === 'CallExpression' && mu(p.callee, '_storeSet') && p.arguments[0]?.type === 'Literal') return `$$${p.arguments[0].value} = await …`
  if (p.type === 'NewExpression' && (mu(p.callee, 'Store') || (p.callee.type === 'Identifier' && p.callee.name === 'µStore'))) return 'new µStore(… await …)'
  return null
}

// ce qui reçoit la valeur d'un `await` (`config`, `$x`, `$$x`), écrit comme dans le source
function target(n: any): string | null {
  if (n.type === 'Identifier') return n.name
  const x = dollar(n)
  if (x !== null) return '$' + x
  return n.type === 'MemberExpression' && !n.computed && mu(n.object, 'store') ? '$$' + n.property.name : null
}

// `derived` : les expressions des valeurs dérivées du script (analyze()), où `await` fait une valeur qui attend
export function rejectAwaitOutsideDerived(ast: any, derived: any[], written?: WrittenScript): void {
  // chaque `await` fautif, dans l'ordre du script : la clé de sa forme, ce qui la cherche dans le texte écrit, son refus ; le premier est
  // refusé, sa ligne citée si sa forme s'y lit autant de fois que le code en porte. Hors d'une valeur qui attend, sa forme peut s'écrire
  // sans nom (`{a, b} = await f()`, `f(await g())`, `x = (await f())`) et se lire aussi dans une fonction, où elle est permise : la ligne
  // est celle de l'`await` du même rang (`n`) parmi tous ceux de l'arbre (`tous`), quand les scripts en portent autant (comme µsignal)
  const faults: Array<{ key: string, re: RegExp, n?: any, reject: (place: ReturnType<typeof writtenLine>) => Error }> = []
  const all: any[] = []
  walk.ancestor(ast, {
    AwaitExpression(n: any, _walkState: any, parents: any[]) {
      all.push(n)
      if (parents.some((p) => /Function/.test(p.type))) return
      if (derived.some((d) => d.start <= n.start && n.end <= d.end)) return
      for (let i = parents.length - 2; i >= 0; i--) {
        const shape = store(parents[i])
        if (shape === null) continue
        // `$$x` s'écrit aussi `µ$$x` dans un composant (`export µ$$feed = await …`) : la forme est citée telle qu'écrite
        const name = shape.split(' ')[0]
        const re   = shape.startsWith('new') ? /new\s+µStore\b/ : new RegExp('(?<![\\w$µ.@])(' + (name.startsWith('µ') ? '' : 'µ?') + name.replace(/\$/g, '\\$') + ')\\s*=\\s*await\\b')
        faults.push({ key: 'magasin ' + shape, re, reject: ({ moduleName, line, m }) => new Error(t('analyzer.await-store', { shape: m?.[1] ? m[1] + ' = await …' : shape, moduleName, line: line })) })
        return
      }
      // `$x =: await …` : la ligne devient `$.x = µ.snap(…)`
      for (let i = parents.length - 2; i > 0; i--) {
        const name = mu(parents[i].callee, 'snap') && parents[i - 1].type === 'AssignmentExpression' ? dollar(parents[i - 1].left) : null
        if (name === null) continue
        faults.push({ key: 'instantane ' + name, re: new RegExp(writtenName('$' + name) + '\\s*=:\\s*await\\b'), reject: ({ moduleName, line }) => new Error(t('analyzer.await-snapshot', { name: name, moduleName, line: line })) })
        return
      }
      const receiver = parents.slice(0, -1).reverse().find((p) => p.type === 'VariableDeclarator' || p.type === 'AssignmentExpression')
      const name     = receiver === undefined ? null : target(receiver.type === 'VariableDeclarator' ? receiver.id : receiver.left)
      // l'opérateur tel qu'écrit (`x := await …`, `x .= await …`) ; à défaut, celui du code compilé. `$x = await …` est une valeur qui
      // attend : pour une variable $, le `=` seul n'est pas cette forme
      const ops    = ':=|\\.=|=:|[-+*/%]=|\\|\\|=|&&=|\\?\\?=|\\?=' + (name !== null && name.startsWith('$') ? '' : '|=')
      const before = name === null ? null : new RegExp(writtenName(name) + '\\s*(' + ops + ')\\s*$')
      faults.push({ key: 'hors ' + name, re: new RegExp(writtenName('await')), n, reject: (place) => {
        // l'opérateur écrit juste avant cet `await` (`place.m`, l'`await` du même rang), s'il suit le nom
        const op    = (place.m === null || before === null ? undefined : before.exec(writtenCode(written!).view.slice(0, place.m.index!))?.[1]) ?? (receiver?.type === 'AssignmentExpression' ? receiver.operator : '=')
        const shape = name === null ? 'await …' : `${name} ${op} await …`
        // sans nom, chaque langue écrit son propre exemple (`$valeur`, `$value`) : texte affiché, pas un nom du code
        return new Error(t('analyzer.await-outside-derived', { shape: shape, example: name === null ? undefined : `$${name.replace(/^\$+/, '')} = await …`, moduleName: place.moduleName, line: place.line }))
      } })
    },
  })
  const f = faults[0]
  if (f === undefined) return
  all.sort((a, b) => a.start - b.start)
  throw f.reject(f.n === undefined ? writtenLine(written, f.re, faults.filter((x) => x.key === f.key).length) : writtenLine(written, f.re, all.length, all.indexOf(f.n), 'scripts'))
}

// `dependencies` : ce que lit chaque valeur dérivée du script ; `attentes` : les valeurs qui attendent. Le message dit le chemin
// (`$r` lit `$r` par `$n`) quand la valeur se cite par d'autres
export function rejectSelfCitingWait(dependencies: Record<string, string[]>, waits: Set<string>, written?: WrittenScript): void {
  for (const name of waits) {
    const seen = new Set<string>()
    const path = (from: string): string[] | null => {
      for (const d of dependencies[from] ?? []) {
        if (d === name) return []
        if (seen.has(d)) continue
        seen.add(d)
        const rest = path(d)
        if (rest !== null) return [d, ...rest]
      }
      return null
    }
    const by = path(name)
    if (by === null) continue
    // la ligne de son `await`, sur la même ligne que `$r =` ou sur la suivante
    const { moduleName, line } = writtenLine(written, new RegExp(writtenName('$' + name) + '\\s*:?=(?![=>])(?:[^\\n]*?|\\s*)\\bawait\\b'))
    throw new Error(t('analyzer.await-cited', { name: name, by: by.map((v) => '$' + v).join(', '), moduleName, line: line }))
  }
}
