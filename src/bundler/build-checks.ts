// bundler/build-checks — trois contrôles croisés sur tout le projet, une fois chaque composant compilé : un attribut écrit sur la
// balise d'un composant du projet que ce composant ne lit pas (propUnknown), un lien `#/…` écrit en dur qu'aucune route ne prend
// (routeUnknown), une clé `µt('…')` écrite en dur absente du dictionnaire de la langue par défaut (i18nKeyUnknown). De simples
// avertissements, jamais une erreur ; dans le doute, rien. Les relevés viennent du transpileur (transpiler/build-checks.ts) : ce que
// chaque composant lit et vise, les balises du projet que son gabarit écrit (nom, ligne, attributs écrits), ses clés, liens et routes

import { t } from '../messages/index.js'
import { typedLine, type LintToggles } from '../diagnostics.js'
import { basename } from 'node:path'
import type { BuildChecks } from '../transpiler/build-checks.js'
import { levenshtein } from './config.js'

/** le dictionnaire de la langue par défaut, tel que lu par scanI18n (racine, sections et leurs chemins relatifs) */
export interface ProjectDictionary {
  lang:     string
  root:     Record<string, any> | null
  rootFile: string | null
  sections: Record<string, { data: any, rel: string }>
}

// les attributs qu'une balise de composant porte sans que le composant les lise : ceux que le runtime laisse à l'élément
// (MJS_NATIVE_ATTRS de runtime/mjs_element.ts), les attributs globaux du HTML, et ceux que MJS lit lui-même sur toute balise
// de composant (déclinaison `layout` ou `template`, variante de thème `theme`)
const NATIVE_ATTRS = new Set([
  'class', 'id', 'style', 'src', 'href', 'alt', 'title', 'type', 'value', 'placeholder', 'disabled', 'checked', 'name', 'for', 'tabindex', 'role', 'lang', 'dir', 'hidden', 'draggable', 'contenteditable', 'spellcheck', 'translate', 'inert', 'slot', 'is', 'part', 'exportparts',
  'accesskey', 'anchor', 'autocapitalize', 'autocorrect', 'autofocus', 'enterkeyhint', 'inputmode', 'itemid', 'itemprop', 'itemref', 'itemscope', 'itemtype', 'nonce', 'popover', 'virtualkeyboardpolicy', 'writingsuggestions',
  'layout', 'template', 'theme',
])

// le nom sous lequel un attribut arrive à une prop : tirets en camelCase, puis sans la casse (cf. _mjs_propKey, runtime/mjs_element.ts)
function propKey(name: string): string {
  return name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()).toLowerCase()
}

// le candidat le plus proche d'un nom (une faute de frappe : 1 écart sur un nom court, 2 au plus), `null` sans candidat assez proche
function near(name: string, candidates: Iterable<string>): string | null {
  const max = name.length <= 4 ? 1 : 2
  let best  = null as string | null
  let dist  = Infinity
  for (const c of candidates) {
    if (c === name) continue
    const d = levenshtein(name, c)
    if (d < dist) { dist = d; best = c }
  }
  return best !== null && dist <= max ? best : null
}

/** une route prend-elle ce chemin ? Mêmes règles que le routeur (µ.Router._mjs_matchRoute) : segments littéraux, `:param`, `(…)`
 *  facultatif à toute position, `*` qui prend toute la suite (rien compris). Chaque position (segment de la route, segment du chemin)
 *  ne s'essaie qu'une fois : sans mémoire, un segment facultatif essayé présent puis absent double les essais de la suite — trente
 *  segments facultatifs devant un lien de quinze qu'ils ne prennent pas, c'est 1,4 milliard d'essais, contre 496 positions au plus */
export function routeMatches(route: string, path: string): boolean {
  const rp     = route.split('/').filter(Boolean)
  const mp     = path.split('/').filter(Boolean)
  const decode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }
  // la réponse de chaque position déjà essayée : 0 pas encore, 1 non, 2 oui
  const seen    = new Uint8Array((rp.length + 1) * (mp.length + 1))
  const attempt = (ri: number, mi: number): boolean => {
    if (ri >= rp.length) return mi >= mp.length
    const pos = ri * (mp.length + 1) + mi
    if (seen[pos] !== 0) return seen[pos] === 2
    let seg   = rp[ri]
    const opt = seg.startsWith('(') && seg.endsWith(')')
    if (opt) seg = seg.slice(1, -1)
    if (seg === '*') return true
    const present = mi < mp.length && (seg.startsWith(':') || seg === mp[mi] || seg === decode(mp[mi]))
    const matches = (present && attempt(ri + 1, mi + 1)) || (opt && attempt(ri + 1, mi))
    seen[pos]     = matches ? 2 : 1
    return matches
  }
  return attempt(0, 0)
}

// une route de repli : un joker que rien ne précède, ou seulement des segments facultatifs (`/*`, `*`, `/(:lang)/*`) — elle prend tout chemin,
// pour rendre la page introuvable ou une mise en page dont la vue reste vide ; un joker sous un chemin (`/docs/*`) est une vraie route
function isFallbackRoute(route: string): boolean {
  for (const seg of route.split('/').filter(Boolean)) {
    const bare = seg.startsWith('(') && seg.endsWith(')') ? seg.slice(1, -1) : seg
    if (bare === '*') return true
    if (bare === seg) return false
  }
  return false
}

// le chemin d'un lien `#/…` tel que le routeur le lit : sans la requête, sans barre finale
function linkPath(href: string): string {
  let path = href.slice(1)
  const q  = path.indexOf('?')
  if (q !== -1) path = path.slice(0, q)
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  return path
}

// un chemin du dictionnaire (`a.b.c`), comme le runtime le résout : une table, une liste par position, jamais un texte ni le prototype
function resolve(node: any, parts: string[]): any {
  for (const p of parts) {
    if (node === null || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, p)) return undefined
    node = node[p]
  }
  return node
}

// la clé existe-t-elle dans la langue par défaut ? Une section porte son premier segment ; la racine, la clé entière
function keyFound(dict: ProjectDictionary, key: string): boolean {
  const parts   = key.split('.')
  const section = dict.sections[parts[0]]
  if (section && resolve(section.data, parts.slice(1)) != null) return true
  return dict.root !== null && resolve(dict.root, parts) != null
}

// une clé voisine qui existe : le premier segment absent remplacé par le plus proche de ses frères
function nearestKey(dict: ProjectDictionary, key: string): string | null {
  const parts    = key.split('.')
  const section  = dict.sections[parts[0]]
  const attempts = [] as { base: any, start: number, prefix: string[] }[]
  if (section) attempts.push({ base: section.data, start: 1, prefix: [parts[0]] })
  if (dict.root !== null) attempts.push({ base: dict.root, start: 0, prefix: [] })
  for (const { base, start, prefix } of attempts) {
    let node = base
    for (let i = start; i < parts.length; i++) {
      if (node === null || typeof node !== 'object') break
      if (!Object.prototype.hasOwnProperty.call(node, parts[i])) {
        const neighbor = near(parts[i], Object.keys(node))
        if (neighbor === null) break
        const attempt = [...prefix, ...parts.slice(start, i), neighbor, ...parts.slice(i + 1)].join('.')
        if (keyFound(dict, attempt)) return attempt
        break
      }
      node = node[parts[i]]
    }
  }
  return null
}

/**
 * Les avertissements des trois contrôles (lignes étiquetées, un type coupé par `lint` n'en donne aucune). `components` : le relevé de
 * chaque composant du tour (`core` : un module du cœur, jamais contrôlé), les lectures de ses modules importés comprises ; `targets` : les
 * attributs qu'une feuille ou un script du projet vise (`[nom]`, `attr(nom)`, `getAttribute('nom')`), lus sur toute balise ;
 * `incompleteRoutes` : la table de routes du projet ne se connaît pas en entier (construction en échec, composant sans relevé, module qui
 * nomme `routes`), les liens ne sont pas contrôlés.
 */
export function checkProject(input: {
  components:         { file: string, moduleName: string, core: boolean, checks: BuildChecks }[]
  targets:            ReadonlySet<string>
  dictionary:         ProjectDictionary | null
  lint?:              LintToggles
  incompleteRoutes?: boolean
}): string[] {
  const out  = [] as string[]
  const seen = new Set<string>()
  const push = (type: 'propUnknown' | 'routeUnknown' | 'i18nKeyUnknown', message: string) => {
    if (seen.has(message)) return
    seen.add(message)
    const line = typedLine(type, message, input.lint)
    if (line !== null) out.push(line)
  }
  const project = input.components.filter((c) => !c.core)

  // 1. attributs : la balise d'un composant du projet, sans propagation `{...obj}`, quand tout ce qui reçoit ses attributs — le composant,
  // sa base s'il en est un modèle, chacun des modèles d'une base choisis à l'exécution — les lit par des noms que l'analyse connaît
  if (input.lint?.propUnknown !== false) {
    const byName = new Map<string, (typeof project)[number] | null>()
    for (const c of project) {
      const name = c.moduleName.toLowerCase()
      byName.set(name, byName.has(name) ? null : c)
    }
    const targeted = new Set([...input.targets].map(propKey))
    for (const c of project) {
      for (const tag of c.checks.tags ?? []) {
        if (tag.spread) continue
        const name    = tag.name.toLowerCase()
        const base    = name.split('--')[0]
        const readers = [name, ...(base !== name ? [base] : []), ...(tag.models ?? []).map((m) => `${base}--${m.toLowerCase()}`)].map((n) => byName.get(n))
        if (readers.some((l) => !l || l.checks.props === null)) continue
        const known = new Map<string, string>()
        for (const l of readers) for (const p of l!.checks.props!) if (!known.has(propKey(p))) known.set(propKey(p), p)
        for (const attr of tag.names) {
          const lower = attr.toLowerCase()
          if (!/^[A-Za-z][\w-]*$/.test(attr) || NATIVE_ATTRS.has(lower) || /^(?:data|aria|mjs)-/.test(lower) || lower.startsWith('on')) continue
          if (known.has(propKey(attr)) || targeted.has(propKey(attr))) continue
          const neighbor = near(propKey(attr), known.keys())
          push('propUnknown', t('bundler.build-checks.attribute-unknown', {
            file:    c.file,
            line:      tag.line ?? undefined,
            tag:     tag.kind === 'literal-dev' ? `mjs-${tag.name.split('--')[0]}` : `@${tag.name.split('--')[0]}`,
            attribute:   attr,
            prop:       attr.replace(/-([a-z])/g, (_m, l: string) => l.toUpperCase()),
            component:  basename(readers[0]!.file),
            suggestion: neighbor === null ? undefined : known.get(neighbor),
          }))
        }
      }
    }
  }

  // 2. liens : les `<a href="#/…">` du projet, quand toute sa table se connaît — blocs <routes>, chemins que les scripts écrivent en toutes
  // lettres sur `@routes`, aucun composant du projet qui nomme `routes` autrement ni ne laisse le composant à un code qui pourrait la remplir
  // (cf. transpiler/build-checks.ts), tous les relevés là ; un lien que seule une route de repli prend ne mène à aucune page de l'application.
  // Les modules du cœur ne comptent pas : aucun ne nomme `routes` ni le routeur, n'exécute un texte, n'écrit une propriété au nom calculé sur
  // un élément ; ceux qui se passent eux-mêmes à une fonction (`soon(@)` de radio, l'observateur de select, la liste des groupes de
  // sortable) n'en font rien qui touche une table. Un module du cœur qui viendrait à remplir une table devra compter ici
  const routes = project.flatMap((c) => c.checks.routes)
  if (input.lint?.routeUnknown !== false && !input.incompleteRoutes && routes.length > 0 && !project.some((c) => c.checks.routesScript)) {
    const fixes = routes.filter((r) => !/[:*(]/.test(r))
    const real  = routes.filter((r) => !isFallbackRoute(r))
    for (const c of project) {
      for (const link of c.checks.links) {
        const path = linkPath(link.href)
        if (real.some((r) => routeMatches(r, path))) continue
        const neighbor = near(path, fixes)
        const fallback = routes.find((r) => isFallbackRoute(r) && routeMatches(r, path))
        push('routeUnknown', t('bundler.build-checks.link-dead', { file: c.file, line: link.line ?? undefined, href: link.href, path: path, fallback: fallback, suggestion: neighbor === null ? undefined : `#${neighbor}` }))
      }
    }
  }

  // 3. clés : le dictionnaire de la langue par défaut ; les libellés du framework (`mjs.…`) ont leur propre table
  const dict = input.dictionary
  if (input.lint?.i18nKeyUnknown !== false && dict !== null && (dict.root !== null || Object.keys(dict.sections).length > 0)) {
    for (const c of project) {
      for (const k of c.checks.keys) {
        if (k.key === 'mjs' || k.key.startsWith('mjs.')) continue
        if ([k.key, ...(k.alts ?? [])].some((key) => keyFound(dict, key))) continue
        const parts        = k.key.split('.')
        const section      = dict.sections[parts[0]]
        const file         = section ? section.rel : (dict.rootFile ?? `i18n/${dict.lang}.yml`)
        const suggestedKey = nearestKey(dict, k.key)
        // le texte à écrire dans µt : la clé voisine sous la forme écrite (relative à la section du module, ou chemin absolu)
        const relative = !k.written.startsWith('/') && k.key.endsWith(k.written) ? k.key.length - k.written.length : 0
        const write    = suggestedKey === null ? undefined : k.written.startsWith('/') ? '/' + suggestedKey : suggestedKey.slice(relative)
        push('i18nKeyUnknown', t('bundler.build-checks.key-missing', { file: c.file, line: k.line ?? undefined, written: k.written, key: k.key, dict: file, addition: section ? parts.slice(1).join('.') : k.key, lang: dict.lang, suggestion: write }))
      }
    }
  }
  return out
}
