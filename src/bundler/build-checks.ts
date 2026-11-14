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
function propKey(nom: string): string {
  return nom.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()).toLowerCase()
}

// le candidat le plus proche d'un nom (une faute de frappe : 1 écart sur un nom court, 2 au plus), `null` sans candidat assez proche
function proche(nom: string, candidats: Iterable<string>): string | null {
  const max = nom.length <= 4 ? 1 : 2
  let best  = null as string | null
  let dist  = Infinity
  for (const c of candidats) {
    if (c === nom) continue
    const d = levenshtein(nom, c)
    if (d < dist) { dist = d; best = c }
  }
  return best !== null && dist <= max ? best : null
}

/** une route prend-elle ce chemin ? Mêmes règles que le routeur (µ.Router._mjs_matchRoute) : segments littéraux, `:param`, `(…)`
 *  facultatif à toute position, `*` qui prend toute la suite (rien compris). Chaque position (segment de la route, segment du chemin)
 *  ne s'essaie qu'une fois : sans mémoire, un segment facultatif essayé présent puis absent double les essais de la suite — trente
 *  segments facultatifs devant un lien de quinze qu'ils ne prennent pas, c'est 1,4 milliard d'essais, contre 496 positions au plus */
export function routePrend(route: string, chemin: string): boolean {
  const rp     = route.split('/').filter(Boolean)
  const mp     = chemin.split('/').filter(Boolean)
  const decode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }
  // la réponse de chaque position déjà essayée : 0 pas encore, 1 non, 2 oui
  const vu     = new Uint8Array((rp.length + 1) * (mp.length + 1))
  const essai  = (ri: number, mi: number): boolean => {
    if (ri >= rp.length) return mi >= mp.length
    const pos = ri * (mp.length + 1) + mi
    if (vu[pos] !== 0) return vu[pos] === 2
    let seg   = rp[ri]
    const opt = seg.startsWith('(') && seg.endsWith(')')
    if (opt) seg = seg.slice(1, -1)
    if (seg === '*') return true
    const present = mi < mp.length && (seg.startsWith(':') || seg === mp[mi] || seg === decode(mp[mi]))
    const prend   = (present && essai(ri + 1, mi + 1)) || (opt && essai(ri + 1, mi))
    vu[pos]       = prend ? 2 : 1
    return prend
  }
  return essai(0, 0)
}

// une route de repli : un joker que rien ne précède, ou seulement des segments facultatifs (`/*`, `*`, `/(:lang)/*`) — elle prend tout chemin,
// pour rendre la page introuvable ou une mise en page dont la vue reste vide ; un joker sous un chemin (`/docs/*`) est une vraie route
function routeDeRepli(route: string): boolean {
  for (const seg of route.split('/').filter(Boolean)) {
    const nu = seg.startsWith('(') && seg.endsWith(')') ? seg.slice(1, -1) : seg
    if (nu === '*') return true
    if (nu === seg) return false
  }
  return false
}

// le chemin d'un lien `#/…` tel que le routeur le lit : sans la requête, sans barre finale
function cheminDuLien(href: string): string {
  let chemin = href.slice(1)
  const q    = chemin.indexOf('?')
  if (q !== -1) chemin = chemin.slice(0, q)
  while (chemin.length > 1 && chemin.endsWith('/')) chemin = chemin.slice(0, -1)
  return chemin
}

// un chemin du dictionnaire (`a.b.c`), comme le runtime le résout : une table, une liste par position, jamais un texte ni le prototype
function resoudre(node: any, parts: string[]): any {
  for (const p of parts) {
    if (node === null || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, p)) return undefined
    node = node[p]
  }
  return node
}

// la clé existe-t-elle dans la langue par défaut ? Une section porte son premier segment ; la racine, la clé entière
function cleTrouvee(dico: ProjectDictionary, cle: string): boolean {
  const parts   = cle.split('.')
  const section = dico.sections[parts[0]]
  if (section && resoudre(section.data, parts.slice(1)) != null) return true
  return dico.root !== null && resoudre(dico.root, parts) != null
}

// une clé voisine qui existe : le premier segment absent remplacé par le plus proche de ses frères
function cleProche(dico: ProjectDictionary, cle: string): string | null {
  const parts   = cle.split('.')
  const section = dico.sections[parts[0]]
  const essais  = [] as { base: any, debut: number, prefixe: string[] }[]
  if (section) essais.push({ base: section.data, debut: 1, prefixe: [parts[0]] })
  if (dico.root !== null) essais.push({ base: dico.root, debut: 0, prefixe: [] })
  for (const { base, debut, prefixe } of essais) {
    let node = base
    for (let i = debut; i < parts.length; i++) {
      if (node === null || typeof node !== 'object') break
      if (!Object.prototype.hasOwnProperty.call(node, parts[i])) {
        const voisin = proche(parts[i], Object.keys(node))
        if (voisin === null) break
        const essai = [...prefixe, ...parts.slice(debut, i), voisin, ...parts.slice(i + 1)].join('.')
        if (cleTrouvee(dico, essai)) return essai
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
 * `routesIncompletes` : la table de routes du projet ne se connaît pas en entier (construction en échec, composant sans relevé, module qui
 * nomme `routes`), les liens ne sont pas contrôlés.
 */
export function checkProject(input: {
  components:         { file: string, moduleName: string, core: boolean, checks: BuildChecks }[]
  targets:            ReadonlySet<string>
  dictionary:         ProjectDictionary | null
  lint?:              LintToggles
  routesIncompletes?: boolean
}): string[] {
  const out  = [] as string[]
  const vues = new Set<string>()
  const push = (type: 'propUnknown' | 'routeUnknown' | 'i18nKeyUnknown', message: string) => {
    if (vues.has(message)) return
    vues.add(message)
    const ligne = typedLine(type, message, input.lint)
    if (ligne !== null) out.push(ligne)
  }
  const projet = input.components.filter((c) => !c.core)

  // 1. attributs : la balise d'un composant du projet, sans propagation `{...obj}`, quand tout ce qui reçoit ses attributs — le composant,
  // sa base s'il en est un modèle, chacun des modèles d'une base choisis à l'exécution — les lit par des noms que l'analyse connaît
  if (input.lint?.propUnknown !== false) {
    const parNom = new Map<string, (typeof projet)[number] | null>()
    for (const c of projet) {
      const nom = c.moduleName.toLowerCase()
      parNom.set(nom, parNom.has(nom) ? null : c)
    }
    const vises = new Set([...input.targets].map(propKey))
    for (const c of projet) {
      for (const tag of c.checks.tags ?? []) {
        if (tag.spread) continue
        const nom      = tag.name.toLowerCase()
        const base     = nom.split('--')[0]
        const lecteurs = [nom, ...(base !== nom ? [base] : []), ...(tag.modeles ?? []).map((m) => `${base}--${m.toLowerCase()}`)].map((n) => parNom.get(n))
        if (lecteurs.some((l) => !l || l.checks.props === null)) continue
        const connus = new Map<string, string>()
        for (const l of lecteurs) for (const p of l!.checks.props!) if (!connus.has(propKey(p))) connus.set(propKey(p), p)
        for (const attr of tag.names) {
          const bas = attr.toLowerCase()
          if (!/^[A-Za-z][\w-]*$/.test(attr) || NATIVE_ATTRS.has(bas) || /^(?:data|aria|mjs)-/.test(bas) || bas.startsWith('on')) continue
          if (connus.has(propKey(attr)) || vises.has(propKey(attr))) continue
          const voisin = proche(propKey(attr), connus.keys())
          push('propUnknown', t('bundler.build-checks.attribut-inconnu', {
            fichier:    c.file,
            ligne:      tag.line ?? undefined,
            balise:     tag.kind === 'litteral-dev' ? `mjs-${tag.name.split('--')[0]}` : `@${tag.name.split('--')[0]}`,
            attribut:   attr,
            prop:       attr.replace(/-([a-z])/g, (_m, l: string) => l.toUpperCase()),
            composant:  basename(lecteurs[0]!.file),
            suggestion: voisin === null ? undefined : connus.get(voisin),
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
  const routes = projet.flatMap((c) => c.checks.routes)
  if (input.lint?.routeUnknown !== false && !input.routesIncompletes && routes.length > 0 && !projet.some((c) => c.checks.routesScript)) {
    const fixes  = routes.filter((r) => !/[:*(]/.test(r))
    const vraies = routes.filter((r) => !routeDeRepli(r))
    for (const c of projet) {
      for (const lien of c.checks.links) {
        const chemin = cheminDuLien(lien.href)
        if (vraies.some((r) => routePrend(r, chemin))) continue
        const voisin = proche(chemin, fixes)
        const repli  = routes.find((r) => routeDeRepli(r) && routePrend(r, chemin))
        push('routeUnknown', t('bundler.build-checks.lien-mort', { fichier: c.file, ligne: lien.line ?? undefined, href: lien.href, chemin, repli, suggestion: voisin === null ? undefined : `#${voisin}` }))
      }
    }
  }

  // 3. clés : le dictionnaire de la langue par défaut ; les libellés du framework (`mjs.…`) ont leur propre table
  const dico = input.dictionary
  if (input.lint?.i18nKeyUnknown !== false && dico !== null && (dico.root !== null || Object.keys(dico.sections).length > 0)) {
    for (const c of projet) {
      for (const k of c.checks.keys) {
        if (k.key === 'mjs' || k.key.startsWith('mjs.')) continue
        if ([k.key, ...(k.alts ?? [])].some((cle) => cleTrouvee(dico, cle))) continue
        const parts    = k.key.split('.')
        const section  = dico.sections[parts[0]]
        const fichier  = section ? section.rel : (dico.rootFile ?? `i18n/${dico.lang}.yml`)
        const voisine  = cleProche(dico, k.key)
        // le texte à écrire dans µt : la clé voisine sous la forme écrite (relative à la section du module, ou chemin absolu)
        const relative = !k.written.startsWith('/') && k.key.endsWith(k.written) ? k.key.length - k.written.length : 0
        const ecrire   = voisine === null ? undefined : k.written.startsWith('/') ? '/' + voisine : voisine.slice(relative)
        push('i18nKeyUnknown', t('bundler.build-checks.cle-absente', { fichier: c.file, ligne: k.line ?? undefined, ecrit: k.written, cle: k.key, dico: fichier, ajout: section ? parts.slice(1).join('.') : k.key, langue: dico.lang, suggestion: ecrire }))
      }
    }
  }
  return out
}
