// testing — harnais de test des APPLICATIONS ModularJS.
//
// Le framework a 4500 tests pour lui-même et ne proposait rien à ceux qui l'utilisent.
// Ce module ouvre une porte publique sur la mécanique qui existait déjà : compiler le
// projet avec le VRAI Bundler, charger le résultat dans un DOM simulé, monter un
// composant, agir dessus, lire ce qu'il affiche.
//
// Ce n'est PAS un lanceur de tests : il n'impose ni Mocha, ni Vitest, ni Jest. On
// monte, on agit, on lit — l'assertion est celle de l'outil que l'auteur préfère.
//
//   import { createHarness } from 'modularjs-framework/testing'
//
//   const app     = await createHarness()          // lit mjs.config.json, compile une fois
//   const counter = await app.mount('my-counter', { start: 3 })
//   counter.text('.value')          // '3'
//   await counter.click('button')
//   counter.text('.value')          // '4'
//   counter.state.count             // 4
//   await app.destroy()
//
// DÉPENDANCE OPTIONNELLE — `happy-dom` fournit le DOM simulé. Le framework ne l'impose
// à personne (même patron que `playwright` pour le moteur de rendu navigateur) : elle
// est déclarée en pair optionnel, et son absence donne un message qui dit quoi installer.
// Une version trop ancienne (avant 20.11.2) est refusée de même, comme au rendu serveur.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { Bundler } from '../bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../bundler/config.js'
import { stripEsm, ssrScopeFile, fileToId, topoSortFiles } from '../server/renderToString.js'
import { outdatedHappyDomVersion, HAPPY_DOM_MINIMUM } from '../server/happy-dom-version.js'
import { provideStructuredClone } from '../server/structured-clone.js'
import { t } from '../messages/index.js'

export interface HarnessOptions {
  /** Racine du projet — c'est là que `mjs.config.json` est cherché. Défaut : le dossier courant. */
  root?: string
  /** Surcharges ponctuelles, pour un projet sans `mjs.config.json` (tests du framework, bacs à sable). */
  sourceDir?: string
  outputDir?: string
  manifestPath?: string
  stylesheetsDir?: string
  /** URL de la page simulée (utile pour tester un routeur). Défaut : `http://localhost/`. */
  url?: string
  /**
   * Ne charger QUE ces composants, par nom de fichier sans extension. Par défaut le
   * harnais charge TOUT le projet compilé : un composant imbriqué dans celui qu'on teste
   * se monte alors tout seul, sans rien déclarer. Sur un très gros projet, cette liste
   * réduit le temps de démarrage — au prix de devoir nommer les enfants.
   */
  only?: string[]
}

/** Un composant monté, avec de quoi agir dessus et lire ce qu'il affiche. */
export interface MountedComponent {
  /** L'élément lui-même (`<mjs-…>`), pour les cas que le harnais ne couvre pas. */
  el: any
  /** Sa racine d'ombre — c'est là que vivent les nœuds du gabarit. */
  shadow: any
  /** L'état réactif du composant, en lecture (`$count` se lit `state.count`). */
  state: Record<string, any>
  /** Premier nœud du composant qui correspond au sélecteur, ou `null`. */
  find(selector: string): any
  /** Tous les nœuds qui correspondent au sélecteur. */
  findAll(selector: string): any[]
  /** Texte affiché — du composant entier, ou du premier nœud qui correspond. */
  text(selector?: string): string
  /** Markup rendu, pour une assertion de forme ou un message d'échec lisible. */
  html(): string
  /** Clique, puis attend que le rendu ait eu lieu. */
  click(selector: string): Promise<void>
  /** Déclenche n'importe quel événement, puis attend le rendu. */
  fire(selector: string, type: string, init?: Record<string, any>): Promise<void>
  /** Saisit une valeur dans un champ (valeur posée + événement `input`), puis attend le rendu. */
  type(selector: string, value: string): Promise<void>
  /** Change des props depuis le parent, puis attend le rendu. */
  set(props: Record<string, any>): Promise<void>
  /** Attend que le rendu en attente ait eu lieu. Rarement utile : les verbes ci-dessus le font déjà. */
  tick(): Promise<void>
  /** Retire le composant de la page (ses hooks de démontage tournent). */
  destroy(): void
}

export interface Harness {
  /** Monte un composant par son nom de fichier (`my-counter.mjs` → `'my-counter'`). */
  mount(name: string, props?: Record<string, any>): Promise<MountedComponent>
  /** La fenêtre simulée, pour les cas limites (horloge, taille, `localStorage`…). */
  window: any
  /** Son document. */
  document: any
  /** Le runtime du framework, tel que la page le voit. */
  µ: any
  /** Les composants trouvés dans le projet compilé, par nom. */
  components: string[]
  /** Ferme la fenêtre et libère le compilateur. À appeler en fin de fichier de test. */
  destroy(): Promise<void>
}

/** Attend deux tours de microtâches : le rendu de MJS est planifié en microtâche. */
function nextTick(): Promise<void> {
  return new Promise(r => setTimeout(r, 0))
}

/**
 * Classe d'évènement DOM adaptée au `type` demandé par `fire()` — un `Event` générique n'a
 * ni `key`, ni `code`, ni `detail` : un gestionnaire qui les lit les verrait toujours `undefined`.
 */
function eventCtorFor(window: any, type: string, hasDetail: boolean): any {
  if (/^key(down|up|press)$/.test(type)) return window.KeyboardEvent
  if (/^(click|dblclick|mouse|pointer|contextmenu|auxclick)/.test(type)) return window.PointerEvent
  if (/^(focus|blur)/.test(type)) return window.FocusEvent
  if (/^(input|beforeinput)$/.test(type)) return window.InputEvent
  return hasDetail ? window.CustomEvent : window.Event
}

/**
 * Prépare un projet pour les tests : compile une fois, charge le résultat dans un DOM
 * simulé, et rend de quoi monter des composants. Un harnais par fichier de test suffit
 * — la compilation est le gros du coût, le montage est instantané.
 */
export async function createHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const root = resolve(opts.root ?? process.cwd())

  // config du projet, avec les surcharges éventuelles par-dessus
  const found     = findConfig(root)
  const fromFile  = found ? resolveBundlerOpts(found.config, found.configDir) : {}
  const opt: any  = { ...fromFile }
  if (opts.sourceDir)      opt.sourceDir      = resolve(root, opts.sourceDir)
  if (opts.outputDir)      opt.outputDir      = resolve(root, opts.outputDir)
  if (opts.manifestPath)   opt.manifestPath   = resolve(root, opts.manifestPath)
  if (opts.stylesheetsDir) opt.stylesheetsDir = resolve(root, opts.stylesheetsDir)
  if (!opt.sourceDir) throw new Error(t('testing.no-project', { root }))
  // le cœur bâti pour happy-dom, qui connecte le contenu d'une ombre avant son hôte (cf. BundlerOpts.happyDom)
  opt.happyDom = true

  const bundler = new Bundler(opt)
  const stats   = await bundler.compile()
  if (stats.errors.length > 0) {
    await bundler.close()
    throw new Error(t('testing.compilation-failed', { detail: stats.errors.map((e: any) => e.message).join('\n') }))
  }

  // happy-dom est une dépendance OPTIONNELLE : absente, on dit quoi installer plutôt
  // que de laisser tomber une erreur de résolution de module au visage de l'auteur
  let HappyDOM: any
  try {
    HappyDOM = await import('happy-dom')
  } catch {
    await bundler.close()
    throw new Error(t('testing.happy-dom-missing'))
  }
  // happy-dom plus ancien que la version exigée : refus net (version trouvée, version exigée, commande pour monter) plutôt que
  // des tests qui réussissent ou échouent au hasard — cf. server/happy-dom-version.ts
  const outdated = outdatedHappyDomVersion()
  if (outdated !== null) {
    await bundler.close()
    throw new Error(t('testing.happy-dom-too-old', { found: outdated, required: HAPPY_DOM_MINIMUM }))
  }

  const window: any   = new HappyDOM.Window({ url: opts.url ?? 'http://localhost/' })
  const document: any = window.document
  // `structuredClone` comme au navigateur, que happy-dom ne donne pas (cf. server/structured-clone.ts) ; son canal se ferme avec la fenêtre
  const closeStructuredClone = provideStructuredClone(window)
  const outDir        = bundler.outputDir
  const files         = existsSync(outDir) ? readdirSync(outDir).sort() : []
  // le runtime (cœur, feuilles partagées, effets) ne se prend que parmi les fichiers que CETTE compilation a écrits ou repris : le
  // dossier de sortie d'un vrai projet garde des sorties de builds antérieurs que le ménage des empreintes ne retire pas (celles
  // d'une 2.5 par exemple), dont les noms ressemblent aux siens — même règle que le rendu serveur (renderToString.ts)
  const emittedThisTurn = new Set(stats.sizes.map(s => basename(s.path)))
  const turnOutputs     = files.filter(f => emittedThisTurn.has(f))
  // fenêtre et compilateur fermés — en fin de tests, ou quand le chargement échoue : sans quoi le pool de threads du
  // compilateur garde le processus de test en vie
  const close = async () => {
    // Garde-fou — même motif que renderToString.ts : `window.close()`
    // (API DOM standard) est un NO-OP sur une Window happy-dom créée nue — `window.happyDOM.close()`
    // est la VRAIE API de nettoyage (annule les tâches en cours ET ferme), sans quoi un
    // `setInterval`/`setTimeout` posé par un `µeffect` pendant le montage fuit indéfiniment.
    closeStructuredClone()
    try { await window.happyDOM?.close?.() } catch { /* happy-dom peut refuser de fermer deux fois */ }
    await bundler.close()
  }

  // un build minifié importe le cœur sous un nom court (`import{µ as o}`) : ce nom rejoint le cœur global
  const read = (file: string) => stripEsm(readFileSync(join(outDir, file), 'utf-8'), { bridgeCore: true })
  // chaque fichier dans sa propre portée, comme un module ES dans le navigateur : minifiés, les fichiers
  // tirent leurs noms courts du même alphabet (`r`, `o`…) — côte à côte dans la portée globale, la
  // fonction d'un composant écrasait la variable du cœur qui porte µ. Et en mode STRICT, comme un module :
  // en non strict, une écriture refusée (objet gelé, propriété sans setter) passait en silence là où la
  // page lève une TypeError
  const evaluate = (code: string) => window.eval(`(function () {\n'use strict';\n${code}\n})();`)

  // 1. le cœur du runtime, puis `µ` en global — même amorce que le rendu serveur : le cœur que CETTE compilation vient d'écrire
  //    (`coreHashedPath`), jamais le premier `mjs_core-*` que liste le dossier, qui pouvait être celui d'un build antérieur
  const coreFile = basename(bundler.coreHashedPath)
  if (!coreFile || !turnOutputs.includes(coreFile)) {
    await close()
    throw new Error(t('testing.runtime-not-found', { dir: outDir }))
  }
  try {
    evaluate(`${read(coreFile)}\nglobalThis.µ = µ;`)
  } catch (e) {
    await close()
    throw e
  }

  // 1b. les libellés du runtime (nom du bouton de *spoiler, commande de *flipcard, textes de *guard, des modules cœur…), tels que le
  //     manifeste les pose dans la page juste après le cœur : toutes les langues, et celle du projet en repli. La langue affichée suit
  //     celle de la page simulée (`document.documentElement.lang`), le français par défaut
  const manifest = existsSync(bundler.manifestPath) ? readFileSync(bundler.manifestPath, 'utf-8') : ''
  const labels   = manifest.split('\n').filter(l => /^\s*µ\._runtimeLabels(?:Lang)? = /.test(l)).join('\n')
  if (labels !== '') {
    try {
      evaluate(labels)
    } catch (e) {
      await close()
      throw e
    }
  }

  // 2. les feuilles partagées émises en module (modes 'bundle' et 'split' ; en 'lazy'
  //    ce sont de vrais `.css` que le runtime ira chercher lui-même)
  for (const f of turnOutputs.filter(f => /^mjs_styles?(_[a-zA-Z0-9_]+)?-[0-9a-z]{5}\.js$/.test(f))) {
    try { evaluate(read(f)) } catch { /* une feuille qui refuse ne doit pas tuer le harnais */ }
  }

  // 2b. le code de chaque effet du projet (un fichier par effet, importé par les composants qui
  //     l'écrivent — l'import retiré ici, le fichier chargé d'avance) ; un effet qui refuse ne doit
  //     pas tuer le harnais : le composant qui le pose le dira à son montage
  for (const f of turnOutputs.filter(f => /^mjs_fx_[a-z0-9_]+-[0-9a-z]{5}\.js$/.test(f))) {
    try { evaluate(read(f)) } catch { /* cf. ci-dessus */ }
  }

  // 3. les composants. Par défaut TOUS : un composant imbriqué dans celui qu'on teste se
  //    monte alors sans rien avoir à déclarer. Chacun dans SON eval, pour qu'un composant
  //    fautif n'emporte pas les autres — l'erreur ressort au montage, nommée. Chaque fichier
  //    garde sa portée comme un module ES, à la façon du rendu serveur (ssrScopeFile) : ce qu'il
  //    importe d'un autre fichier du projet (`@import` d'un module) lui arrive, la cible chargée
  //    avant lui ; avec `only`, les fichiers importés suivent
  const internal   = (name: string) => name.startsWith('__')
  const names     = Object.keys(stats.manifest).filter(n => !internal(n)).sort()
  const toLoad    = opts.only ? names.filter(n => opts.only!.includes(n)) : names
  const failures  = new Map<string, string>()
  const fileOf    = (name: string) => basename(String(stats.manifest[name]))
  const presents  = names.filter(n => files.includes(fileOf(n)))
  const nameById  = new Map(presents.map(n => [fileToId(fileOf(n)), n]))
  const idOf      = new Map(presents.map(n => [fileOf(n), fileToId(fileOf(n))]))
  const resolveId = (url: string) => idOf.get(url.split('/').pop() || '') ?? null
  const scopes    = new Map<string, { code: string, deps: string[] }>()
  const ids       = presents.filter(n => toLoad.includes(n)).map(n => idOf.get(fileOf(n))!)
  const seen      = new Set(ids)
  for (let i = 0; i < ids.length; i++) {
    const p = ssrScopeFile(readFileSync(join(outDir, fileOf(nameById.get(ids[i])!)), 'utf-8'), ids[i], resolveId)
    scopes.set(ids[i], p)
    for (const d of p.deps) if (!seen.has(d)) { seen.add(d); ids.push(d) }
  }
  let order = ids
  // import circulaire (refusé par le rendu serveur) : l'ordre des noms reste, l'échec ressort au montage du composant touché
  try { order = topoSortFiles(ids, new Map(ids.map(id => [id, scopes.get(id)!.deps])), new Map(ids.map(id => [id, fileOf(nameById.get(id)!)]))) } catch { /* cf. ci-dessus */ }
  for (const id of order) {
    // la constante d'un eval reste dans l'eval : posée sur la fenêtre, pour les fichiers qui l'importent
    try { window.eval(`'use strict';\n${scopes.get(id)!.code}\nglobalThis.${id} = ${id};`) } catch (e: any) { failures.set(nameById.get(id)!, e?.message ?? String(e)) }
  }

  async function mount(name: string, props: Record<string, any> = {}): Promise<MountedComponent> {
    if (failures.has(name)) throw new Error(t('testing.component-failed', { name: name, detail: failures.get(name)! }))
    const tag = `mjs-${name}`
    if (!window.customElements.get(tag)) {
      throw new Error(t('testing.component-unknown', { name: name, known: toLoad.join(', ') || '—' }))
    }
    const el = document.createElement(tag)
    // props posées AVANT l'insertion : le runtime récupère les propriétés déposées sur
    // l'élément avant sa mise à niveau (`_mjs_var_bits`), ce qui laisse passer des objets et
    // des tableaux — un attribut ne saurait porter que du texte
    for (const [key, value] of Object.entries(props)) el[key] = value
    document.body.appendChild(el)
    await nextTick()
    return component(el)
  }

  function component(el: any): MountedComponent {
    const root = () => el._shadow ?? el
    const found = (sel: string) => root().querySelector(sel)
    const api: MountedComponent = {
      el,
      get shadow() { return root() },
      get state() { return el._state ?? {} },
      find: (sel) => found(sel),
      findAll: (sel) => Array.from(root().querySelectorAll(sel)),
      text: (sel) => (sel ? (found(sel)?.textContent ?? '') : (root().textContent ?? '')).trim(),
      html: () => root().innerHTML ?? '',
      async click(sel) {
        const target = found(sel)
        if (!target) throw new Error(t('testing.selector-no-node', { selector: sel, tag: el.tagName.toLowerCase() }))
        // activation NATIVE (comme un vrai navigateur) : seule .click() coche une case, active
        // un radio ou déclenche la soumission d'un formulaire — un Event('click') synthétique se
        // propage sans rien activer
        target.click()
        await nextTick()
      },
      async fire(sel, type, init = {}) {
        const target = found(sel)
        if (!target) throw new Error(t('testing.selector-no-node', { selector: sel, tag: el.tagName.toLowerCase() }))
        const Ctor = eventCtorFor(window, type, init.detail !== undefined)
        target.dispatchEvent(new Ctor(type, { bubbles: true, composed: true, ...init }))
        await nextTick()
      },
      async type(sel, value) {
        const target = found(sel)
        if (!target) throw new Error(t('testing.selector-no-node', { selector: sel, tag: el.tagName.toLowerCase() }))
        target.value = value
        target.dispatchEvent(new window.Event('input', { bubbles: true, composed: true }))
        await nextTick()
      },
      // Après le montage, un parent change une prop texte en changeant l'ATTRIBUT —
      // c'est l'observateur du composant qui la voit passer, exactement comme dans une
      // vraie page. Toute autre valeur (nombre, booléen, objet, tableau, fonction) passe par
      // l'écriture d'état du runtime, qui est ce que le compilateur émet quand un parent passe
      // une expression (`count={$n}`) : elle arrive avec son type — un nombre devenait du
      // texte par l'attribut, un attribut vide ou retiré ne rendait jamais un vrai booléen.
      async set(props) {
        for (const [key, value] of Object.entries(props)) {
          const scalar = value === null || typeof value === 'string'
          if (scalar && typeof el.setAttribute === 'function') {
            // l'attribut que le composant observe : `startValue` → `start-value` (le DOM abaisse les majuscules)
            const attr = key.replace(/[A-Z]/g, m => '-' + m.toLowerCase())
            if (value === null) el.removeAttribute(attr)
            else el.setAttribute(attr, String(value))
          }
          else if (typeof el._set === 'function') el._set(key, value)
          else el[key] = value
        }
        await nextTick()
      },
      tick: nextTick,
      // retrait par la méthode NATIVE du nœud, prise au prototype (comme `µ._mjs_rm` du runtime) : `@remove = ->` du
      // composant masque `el.remove()`, qui appellerait la méthode de l'auteur et laisserait le composant dans la page ;
      // et `µ._mjs_rm` lui-même porte un nom raccourci dans un projet minifié, que le harnais ne peut pas nommer
      destroy() {
        const parent = el.parentNode
        if (parent) window.Node.prototype.removeChild.call(parent, el)
      },
    }
    return api
  }

  return {
    mount,
    window,
    document,
    µ: window.µ,
    components: toLoad,
    // le pool de threads est partagé par tout le processus : seule la part de ce harnais est rendue (bundler.close),
    // un autre Bundler qui compile encore le garde
    destroy: close,
  }
}
