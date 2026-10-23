// server/hmr — WebSocket HMR (Hot Module Replacement) en mode dev.
//
// Architecture minimale :
//   - Server WebSocket sur le même HTTP server que StaticServer (upgrade)
//   - Le bundler appelle `hmr.notifyReload(filePath)` après une recompile
//   - Le client (script injecté) écoute et :
//      * reload module entier si .js bundle ou .mjs
//      * patch le shadow CSS si .css (zéro flicker)
//      * fallback location.reload() en dernier recours
//
// Le diff est fait côté bundler (CompileStats.cssOnly) —
// un changement 100 % CSS passe par 'css-update' (hot-swap µ._hotCss, sans
// reload), tout le reste garde le reload complet.

import { WebSocketServer, WebSocket } from 'ws'
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import { networkInterfaces, hostname } from 'node:os'
import type { CssOnlyPayload } from '../bundler/index.js'
import { t } from '../messages/index.js'
// lecture de l'en-tête Host commune avec la garde du pont MJS WS (mjs-ws/bridge.ts)
import { hostHeaderName as hostnameOf } from '../host-header.js'

export interface HMRMessage {
  type: 'reload' | 'css-update' | 'connected' | 'error' | 'theme-vars'
  modules?: string[]
  message?: string
  /** Charge d'un `css-update` : CSS frais par composant/feuille
   * (cf. CssOnlyPayload, bundler). Consommée côté page par `µ._hotCss`. */
  css?: CssOnlyPayload
  /** Charge d'un `theme-vars` (atelier /__mjs/theme) : custom properties PRÉFIXÉES
   * (`--mjs-accent`) → valeur. Le préfixe est appliqué par l'émetteur, qui seul
   * connaît `varPrefix` — le client pose les clés telles quelles. Valeur vide
   * (`''`) = retrait de la surcharge, retour à la valeur du source. */
  themeVars?: Record<string, string>
}

// Ni ce serveur WebSocket HMR
// (connexion ouverte sans vérifier `Origin`) ni le serveur statique
// (`index.ts`, `Access-Control-Allow-Origin: *` inconditionnel) ne
// restreignaient l'origine des appelants. En dev, ces serveurs tournent sur
// `127.0.0.1` — un navigateur N'APPLIQUE PAS la same-origin policy au
// HANDSHAKE WebSocket lui-même (contrairement à fetch/XHR, où le CORS
// bloque la LECTURE de la réponse mais laisse partir la requête), donc
// N'IMPORTE QUEL site web ouvert dans le même navigateur peut se connecter à
// `ws://127.0.0.1:PORT/__mjs_hmr` — et via DNS rebinding (le domaine d'une
// page attaquante résout d'abord ailleurs pour passer une vérification
// quelconque, puis bascule vers 127.0.0.1 avec un TTL DNS très court), même
// une vérification naïve de `Origin` côté client ne protège pas : c'est au
// SERVEUR de refuser les origines non locales. Borné au dev (`mjs dev`
// uniquement), mais un principe de moindre privilège de base. Fix : n'accepter
// que les origines localhost/127.0.0.1/[::1] (avec port variable — le
// dashboard/l'app peuvent tourner sur un port différent du serveur HMR).
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

/** true si `origin` est une origine locale de confiance (ou absente — CLI/curl, pas un navigateur). */
export function isTrustedDevOrigin(origin: string | string[] | undefined): boolean {
  if (origin === undefined) return true   // pas de navigateur (curl, requête serveur-à-serveur en dev)
  const v = Array.isArray(origin) ? origin[0] : origin
  return LOCAL_ORIGIN_RE.test(v)
}

/** Version STRICTE, pour les routes qui ÉCRIVENT (pas seulement CORS/diffusion) : l'ABSENCE
 * d'Origin n'est PAS traitée comme une confiance par défaut, contrairement à isTrustedDevOrigin
 * ci-dessus. Un navigateur envoie TOUJOURS Origin sur une requête cross-origin (fetch/XHR/WS) —
 * seul un client qui n'EST PAS un navigateur (curl, un script, une autre machine si `dev.host`
 * est ouvert au réseau) peut l'omettre, et c'est justement le cas à ne plus laisser passer sur
 * une route qui écrit dans le code source du projet (trouvé 23/09 : `dev.host=0.0.0.0`, cas réel
 * documenté pour tester sur mobile, ouvrait l'écriture à tout le réseau local sans vérification). */
export function hasTrustedBrowserOrigin(origin: string | string[] | undefined): boolean {
  if (origin === undefined) return false
  const v = Array.isArray(origin) ? origin[0] : origin
  return LOCAL_ORIGIN_RE.test(v)
}

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', ''])

/** Hôte d'écoute prêt à entrer dans une URL : une IPv6 entre crochets (`[::1]`), le reste tel quel. */
export function hostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? '[' + host + ']' : host
}

/** true si le serveur écoute ailleurs que sur la seule boucle locale (`0.0.0.0`, une adresse du
 * réseau local…) : une page ouverte depuis une autre machine peut alors être légitime. */
export function listensBeyondLoopback(listenHost: string): boolean {
  const h = hostnameOf(hostForUrl(listenHost)) ?? listenHost
  return !(h === 'localhost' || h === '::1' || h.startsWith('127.'))
}

/** Noms propres du serveur de développement : localhost et ses sous-domaines (`app.localhost`, toujours en boucle locale),
 * 127.0.0.1, [::1], le nom de la machine (et `<nom>.local`), l'hôte d'écoute lui-même et, quand il écoute sur toutes les interfaces
 * (`0.0.0.0`, `::`), les adresses de la machine (test sur un téléphone du réseau local). La garde Host les admet d'office
 * (createDevHostCheck) ; la page servie sous l'un d'eux passe la garde d'origine quand son origine est la même que Host
 * (devOriginVerdict), jamais comme origine locale. `adresses` : pour les tests ; par défaut les interfaces réseau, relevées une fois. */
function createDevOwnNameCheck(listenHost: string, adresses?: string[]): (nom: string) => boolean {
  const admis   = new Set(['localhost', '127.0.0.1', '::1'])
  const machine = hostname().toLowerCase()
  const court   = machine.split('.')[0]
  for (const n of [machine, court, court + '.local']) if (n && n !== '.local') admis.add(n)
  const ecoute = hostnameOf(hostForUrl(listenHost)) ?? listenHost.toLowerCase()
  if (!WILDCARD_HOSTS.has(ecoute)) admis.add(ecoute)
  else {
    const liste = adresses ?? Object.values(networkInterfaces()).flatMap(l => (l ?? []).map(i => i.address))
    for (const a of liste) admis.add(a.toLowerCase().replace(/%.*$/, ''))
  }
  return (nom) => admis.has(nom) || nom.endsWith('.localhost')
}

/** Garde contre le rebinding DNS : le nom d'une page hostile peut basculer vers 127.0.0.1, mais
 * son navigateur envoie toujours CE nom dans l'en-tête Host. Acceptés d'office : les noms propres
 * du serveur (createDevOwnNameCheck). `permis` (`dev.allowedHosts`) ouvre d'autres noms (tunnel,
 * proxy) : nom exact, `.domaine` pour ce domaine et ses sous-domaines, `true` pour tout permettre.
 * En-tête absent : refusé, sauf avec `true`. `adresses` : pour les tests. */
export function createDevHostCheck(listenHost: string, adresses?: string[], permis?: readonly string[] | true): (host: string | string[] | undefined) => boolean {
  if (permis === true) return () => true
  const propre    = createDevOwnNameCheck(listenHost, adresses)
  const nomPermis = allowedHostName(permis)
  return (host) => {
    const nom = hostnameOf(host)
    if (nom === undefined) return false
    return propre(nom) || nomPermis(nom)
  }
}

// nom de la boucle locale au sens strict : localhost et ses sous-domaines (toujours en boucle locale), 127.0.0.1, ::1 — l'origine d'une
// page de cette machine, sur tout port, et le Host qu'écrit un tunnel qui le réécrit. Le nom de la machine, `<nom>.local` et les adresses
// du réseau n'en sont pas : dans Host, ils prouvent que la requête arrive ici ; dans une origine, pas que la page vient d'ici (un nom du
// réseau local, une réponse mDNS se contrefont)
function isLoopbackName(nom: string): boolean {
  return nom === 'localhost' || nom.endsWith('.localhost') || nom === '127.0.0.1' || nom === '::1'
}

// noms de `dev.allowedHosts` : nom exact, `.domaine` pour ce domaine et ses sous-domaines, `true` pour tout nom — lecture de la garde
// Host (createDevHostCheck) ; la garde d'origine n'en garde que les noms exacts pour une origine autre que Host (devOriginVerdict)
function allowedHostName(permis?: readonly string[] | true): (nom: string) => boolean {
  if (permis === true) return () => true
  const noms = new Set<string>()
  const domaines: string[] = []
  for (const p of permis ?? []) {
    const n = p.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1')
    if (n.startsWith('.')) domaines.push(n.slice(1))
    else if (n) noms.add(n)
  }
  return (nom) => noms.has(nom) || domaines.some(d => nom === d || nom.endsWith('.' + d))
}

/** Nom de l'en-tête Host cité par la réponse 403 : sans le port, réduit aux caractères d'un nom
 * d'hôte (l'en-tête vient du client, il ne passe pas tel quel dans la réponse). */
export function hostNameForMessage(host: string | string[] | undefined): string {
  return (hostnameOf(host) ?? '').replace(/[^a-z0-9.:_-]/g, '') || 'nom.exemple'
}

// noms d'origine refusée signalés au terminal, au plus : au-delà, une ligne dit que les suivants sont tus (une page qui essaie mille
// sous-domaines n'inonde ni le terminal ni la mémoire)
const MAX_ORIGIN_WARNINGS = 20

/** Verdict de la garde d'origine de `mjs dev` pour une origine présente, le même pour le rechargement à chaud et les formulaires.
 * Admise (true) : une origine de la boucle locale (isLoopbackName, sur tout port : une autre appli de la machine) ; la même origine que
 * Host (la page servie par cette connexion), quand `hoteAdmis` admet ce Host ; ou une origine dont le nom est écrit exactement dans
 * `dev.allowedHosts` (`permis` : la page d'un tunnel qui réécrit Host en `localhost`). Une entrée `.domaine` et `true` admettent des
 * Host, pas une origine autre que Host : ils couvriraient aussi les pages d'autres sites (un autre utilisateur d'un domaine partagé
 * comme `.ngrok-free.app`, n'importe quel site), qui joignent ce serveur depuis votre navigateur. Refusée : l'entrée `.domaine` qui la
 * couvre quand le Host reçu est local (un tunnel l'a réécrit : le message dit d'écrire le nom exact), false sinon. */
function devOriginVerdict(origin: string, host: string | string[] | undefined, permis: readonly string[] | true | undefined, hoteAdmis: (host: string) => boolean): true | string | false {
  let u: URL
  try { u = new URL(origin) } catch { return false }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const nom = hostnameOf(u.host) ?? ''
  const h   = Array.isArray(host) ? host[0] : host
  if (isLoopbackName(nom) || (h !== undefined && h.toLowerCase() === u.host && hoteAdmis(h))) return true
  if (permis === undefined || permis === true) return false
  if (allowedHostName(permis.filter(p => !p.trim().startsWith('.')))(nom)) return true
  if (!isLoopbackName(hostnameOf(h) ?? '')) return false
  return permis.find(p => p.trim().startsWith('.') && allowedHostName([p])(nom))?.trim() ?? false
}

/** Garde d'origine de `mjs dev`, une par serveur, partagée par le rechargement à chaud et les formulaires (cf. devOriginVerdict) :
 * true, false, ou le message qui dit d'écrire le nom exact (Host réécrit par un tunnel, origine qu'une entrée `.domaine` couvre),
 * affiché aussi dans le terminal, une fois par nom et pour MAX_ORIGIN_WARNINGS noms au plus. `hostAllowed` : la garde Host du serveur
 * (createDevHostCheck), passée par lui pour que les deux gardes lisent les mêmes noms, relevés au même moment ; la même origine que
 * Host vaut quand ce Host passe cette garde, ou quand le serveur écoute au-delà de la boucle locale. Origine absente : false. */
export function createDevOriginCheck(permis?: readonly string[] | true, listenHost = '127.0.0.1', hostAllowed = createDevHostCheck(listenHost, undefined, permis)): (origin: string | string[] | undefined, host: string | string[] | undefined) => true | string | false {
  const auDela    = listensBeyondLoopback(listenHost)
  const hoteAdmis = (h: string) => auDela || hostAllowed(h)
  const signales  = new Set<string>()
  let tus         = false
  return (origin, host) => {
    const v = Array.isArray(origin) ? origin[0] : origin
    if (!v) return false
    const motif = devOriginVerdict(v, host, permis, hoteAdmis)
    if (typeof motif !== 'string') return motif
    const nom     = hostNameForMessage(new URL(v).host)
    const message = t('server.origine-nom-exact', { nom, motif, hote: hostNameForMessage(host) })
    if (signales.has(nom) || tus) return message
    if (signales.size < MAX_ORIGIN_WARNINGS) {
      signales.add(nom)
      console.warn(message)
    }
    else {
      tus = true
      console.warn(t('server.origine-refus-tus', { max: MAX_ORIGIN_WARNINGS }))
    }
    return message
  }
}

/** Origine acceptée pour le WebSocket de rechargement : absente (pas un navigateur : curl, un script) ou admise par la règle de la garde
 * d'origine de `mjs dev` (devOriginVerdict : boucle locale, même origine que Host, nom exact de `dev.allowedHosts`), la garde Host
 * relue ici à chaque appel. `mjs dev` lui-même passe par sa garde partagée avec les formulaires (createDevOriginCheck). */
export function isAcceptedHmrOrigin(origin: string | string[] | undefined, host: string | string[] | undefined, listenHost: string, permis?: readonly string[] | true): boolean {
  if (origin === undefined) return true
  const v = Array.isArray(origin) ? origin[0] : origin
  return !!v && devOriginVerdict(v, host, permis, (h) => listensBeyondLoopback(listenHost) || createDevHostCheck(listenHost, undefined, permis)(h)) === true
}

export class HMRServer {
  wss: WebSocketServer
  clients: Set<WebSocket>

  constructor(httpServer: HttpServer, opts: { path?: string, listenHost?: string, isAllowedHost?: (host: string | string[] | undefined) => boolean, allowedHosts?: readonly string[] | true, originCheck?: (origin: string | string[] | undefined, host: string | string[] | undefined) => true | string | false } = {}) {
    this.wss = new WebSocketServer({
      server: httpServer,
      path: opts.path ?? '/__mjs_hmr',
    })
    this.clients = new Set()

    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      const { origin, host } = request.headers
      // `mjs dev` : la garde d'origine partagée avec les formulaires (originCheck), qui dit au terminal le nom exact à écrire ; sinon la
      // même règle relue ici (listenHost), ou les seules origines locales
      let permise: boolean
      if (opts.originCheck) permise = origin === undefined || opts.originCheck(origin, host) === true
      else if (opts.listenHost !== undefined) permise = isAcceptedHmrOrigin(origin, host, opts.listenHost, opts.allowedHosts)
      else permise = isTrustedDevOrigin(origin)
      if (!permise || (opts.isAllowedHost && !opts.isAllowedHost(host))) {
        ws.close(1008, 'Origin not allowed')
        return
      }
      this.clients.add(ws)
      this.send(ws, { type: 'connected' })
      ws.on('close', () => this.clients.delete(ws))
      ws.on('error', () => this.clients.delete(ws))
    })
  }

  notifyReload(modules: string[] = []): void {
    this.broadcast({ type: 'reload', modules })
  }

  // Rechargement CSS à chaud : un recompile où SEUL le CSS a changé
  // (cf. bundler `CompileStats.cssOnly`) diffuse le CSS frais lui-même, le
  // client le pose EN PLACE (µ._hotCss) sans reload — l'état de la page survit.
  notifyCssUpdate(css: CssOnlyPayload): void {
    this.broadcast({ type: 'css-update', css })
  }

  notifyError(message: string): void {
    this.broadcast({ type: 'error', message })
  }

  // Aperçu de thème en direct (atelier /__mjs/theme) : l'atelier POSTe une
  // couleur, toutes les pages ouvertes la posent SANS recharger et SANS rien
  // écrire sur le disque. Canal DISTINCT de 'css-update' à dessein — ce
  // dernier passe par `µ._hotCss` et retombe sur `location.reload()` au
  // moindre doute, ce qui détruirait l'aperçu instantané (et l'état de la
  // page avec). Ici le repli est l'inverse : au moindre doute, on ne fait
  // RIEN. Une surcharge d'aperçu n'est jamais un état à sauver.
  notifyThemeVars(themeVars: Record<string, string>): void {
    this.broadcast({ type: 'theme-vars', themeVars })
  }

  /** Pages actuellement à l'écoute — l'atelier l'affiche pour que « rien ne
   *  bouge » se distingue de « aucune page ouverte ». */
  get clientCount(): number {
    let n = 0
    for (const ws of this.clients) if (ws.readyState === WebSocket.OPEN) n++
    return n
  }

  close(): void {
    for (const ws of this.clients) ws.close()
    this.wss.close()
  }

  private send(ws: WebSocket, msg: HMRMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  private broadcast(msg: HMRMessage): void {
    const payload = JSON.stringify(msg)
    // Un `ws.send` qui throw
    // (socket à demi fermée, buffer plein…) interrompait la boucle et privait
    // TOUS les clients suivants de la notification. try/catch par client +
    // retrait du client fautif (la suppression pendant l'itération d'un Set
    // est sûre en JS) : la diffusion continue quoi qu'il arrive.
    for (const ws of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue
      try { ws.send(payload) }
      catch { this.clients.delete(ws) }
    }
  }
}

// ----------------------------------------------------------------------------
// Client snippet : à injecter dans la page de dev. Écoute le WS et :
//   - 'reload'      → location.reload()
//   - 'css-update'  → hot-swap du CSS composants/feuilles via µ._hotCss
//                     (sans reload ni perte d'état ; repli
//                     location.reload() si le swap n'est pas sûr) + force
//                     re-fetch des <link rel=stylesheet>
//   - 'error'       → affiche un overlay plein écran avec le message
//   - 'reload' suivant un error → cache l'overlay
// ----------------------------------------------------------------------------
export const hmrClientSnippet = (wsUrl: string) => `
(() => {
  const OVERLAY_ID = '__mjs_hmr_overlay'
  const STYLE_ID = '__mjs_hmr_style'

  // Aperçu de thème (atelier /__mjs/theme) — feuille de SURCHARGE, adoptée
  // APRÈS toutes les autres et jamais remplie au boot. Elle vit ICI, dans le
  // snippet HMR, et non dans \`mjs_theme.ts\` : le runtime de thème est
  // DÉTECTÉ au build (cf. bundler resolveRuntimeFiles/wantsTheme), donc
  // absent d'un projet qui n'en déclenche aucun critère — l'aperçu, lui, doit
  // marcher sur toute page servie par \`mjs dev\`, avec ou sans cœur µ.
  // Surcharge et non remplacement : le CSS d'origine reste intact dessous,
  // et retirer une entrée suffit à revenir à la valeur du source.
  const themeEdits = new Map()
  let themeSheet = null

  const applyThemeVars = (vars) => {
    if (!vars) return
    for (const [name, value] of Object.entries(vars)) {
      // '' = retrait explicite, pas une couleur vide
      if (value === '') themeEdits.delete(name)
      else themeEdits.set(name, value)
    }
    // \`CSSStyleSheet\` constructible : absent des vieux navigateurs et de
    // certains contextes non sécurisés. Sans elle on ne fait RIEN (l'aperçu
    // est un confort, pas un état à sauver) plutôt que de recharger la page.
    try {
      if (!themeSheet) {
        themeSheet = new CSSStyleSheet()
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, themeSheet]
      }
      // \`:root\` nu, sans \`:where()\` : cette feuille doit GAGNER sur les
      // déclarations du source, y compris celles d'un jeu clair/sombre porté
      // par un attribut (cf. mjs_theme.ts, spécificité 0 par \`:where()\`).
      // Les custom properties traversent les frontières shadow par héritage :
      // une seule pose sur la racine suffit à toucher tout l'arbre.
      let corps = ''
      for (const [name, value] of themeEdits) corps += name + ':' + value + ';'
      themeSheet.replaceSync(corps ? ':root{' + corps + '}' : '')
    } catch {}
  }

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return
    const s = document.createElement('style')
    s.id = STYLE_ID
    s.textContent = \`
      .__mjs_hmr_overlay {
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(20, 20, 28, 0.95);
        color: #fbb;
        font: 14px/1.5 ui-monospace, monospace;
        padding: 32px;
        overflow: auto;
        white-space: pre-wrap;
      }
    \`
    document.head.appendChild(s)
  }

  const showError = (msg) => {
    ensureStyle()
    let div = document.getElementById(OVERLAY_ID)
    if (!div) {
      div = document.createElement('div')
      div.id = OVERLAY_ID
      div.className = '__mjs_hmr_overlay'
      document.body.appendChild(div)
    }
    div.textContent = ${JSON.stringify(t('server.hmr-compilation-echouee'))} + '\\n\\n' + msg
  }

  const hideError = () => {
    const div = document.getElementById(OVERLAY_ID)
    if (div) div.remove()
  }

  // chargé par <script src> : l'origine d'où il vient, wss: si elle est en https — derrière un tunnel qui réécrit Host, le Host reçu
  // par le serveur nomme localhost, seule cette origine passe par le tunnel ; écrit en ligne (sans src) : l'adresse du serveur
  let scriptSocket = ''
  try {
    const src = document.currentScript && document.currentScript.src
    if (typeof src === 'string' && src) {
      const u = new URL(src)
      scriptSocket = (u.protocol === 'https:' ? 'wss://' : 'ws://') + u.host + new URL('${wsUrl}').pathname
    }
  } catch {}

  let retries = 0
  const connect = () => {
    // adresse du serveur au protocole de la page : une page en https (tunnel) refuse ws: (contenu mixte)
    const ws = new WebSocket(scriptSocket || (location.protocol === 'https:' ? 'wss:' : 'ws:') + '${wsUrl}'.replace(/^wss?:/, ''))
    ws.addEventListener('open', () => {
      retries = 0
      console.log(${JSON.stringify(t('server.hmr-connecte'))})
    })
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'reload')      { hideError(); location.reload() }
        if (msg.type === 'css-update')  {
          hideError()
          // Hot-swap du CSS des composants/feuilles partagées via le runtime
          // (µ._hotCss, mjs_hotcss.ts — dev seulement, ABSENT d'un bundle de
          // production). Retour \`false\` = swap PAS sûr (composant jamais
          // chargé, feuille partagée entre tags divergents…) → repli reload
          // complet, au moindre doute. MÊME repli si la fonction est ABSENTE
          // (\`window.µ\` présent mais sans \`_hotCss\`, ex. bundle de prod servi
          // par erreur sous \`mjs dev\`) : avant, \`ok\` restait à sa valeur
          // initiale \`true\` (le \`if (hot)\` ne s'exécutait juste pas), le
          // remplacement de CSS devenait inerte EN SILENCE au lieu de
          // recharger. µ absent (page sans runtime) reste le seul cas où on
          // NE recharge PAS : rien à échanger, le re-fetch des <link> suffit.
          // >>> extrait-test hmr-hotcss-fallback
          let ok = true
          try {
            if (window.µ) ok = typeof window.µ._hotCss === 'function' && window.µ._hotCss.call(window.µ, msg.css || {}) !== false
          } catch { ok = false }
          if (!ok) { location.reload(); return }
          // <<< extrait-test hmr-hotcss-fallback
          for (const link of document.querySelectorAll('link[rel=stylesheet]')) {
            const u = new URL(link.href)
            u.searchParams.set('_hmr', Date.now().toString())
            link.href = u.toString()
          }
        }
        if (msg.type === 'theme-vars')  { applyThemeVars(msg.themeVars) }
        if (msg.type === 'error')       { showError(msg.message || ${JSON.stringify(t('server.hmr-aucun-message'))}) }
      } catch {}
    })
    ws.addEventListener('close', () => {
      retries++
      const wait = Math.min(retries * 500, 5000)
      console.warn(${JSON.stringify(t('server.hmr-deconnecte'))}.replace('{wait}', wait))
      setTimeout(connect, wait)
    })
  }
  connect()
})()
`.trim()
