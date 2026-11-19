// mjs-ws/proxy — « proxy de décisions » : sucre façon Centrifugo au-dessus
// des gardes existantes opts.auth (core.ts, handleHello) et opts.rooms.join (rooms.ts, handleJoin).
// Aujourd'hui ces deux gardes sont des callbacks — le dev PEUT déjà appeler son back HTTP à la main
// dedans. Ce module fait l'appel POUR LUI : pointer { url, secret } suffit, MJS-WS pose le POST
// SIGNÉ (HMAC, MÊME schéma que les webhooks sortants du pont, cf. bridge.ts signCanonical/
// canonicalString — réutilisés tels quels, jamais réimplémentés), gère le timeout (refus, jamais
// bloquant/pendant) et un cache court optionnel (évite de marteler le back sur des reconnexions/
// rejoins rapprochés). RÉTRO-COMPAT TOTALE : la forme fonction historique continue de marcher — ce
// fichier ne fait QUE fournir l'AUTRE forme, jamais touchée.
//
// Le POST d'AUTH porte aussi le `cookie` de la requête d'upgrade (cf. cookieFromMeta plus bas) :
// c'est ce qui rend le patron « mjsWs rejoue le cookie » (docs §7.12) compatible avec ce proxy
// (docs §7.11) — il ne l'était pas, `meta` était reçu puis jeté.
//
// Détection objet-vs-fonction (typeof === 'function' vs objet {url,...}) et résolution UNE SEULE
// FOIS (jamais par appel — le cache ci-dessous doit survivre aux reconnexions/rejoins) : cf.
// core.ts (auth ET join, `authFn`/`joinFn`). Ce fichier ne connaît NI le protocole µ: NI le
// registre de salons — juste POST+signature+timeout+cache, générique.
//
// Graphe de modules — proxy.ts dépend de bridge.ts (signCanonical/canonicalString) qui dépend
// LUI-MÊME de rooms.ts (peerIdOf) : rooms.ts ne doit donc JAMAIS importer proxy.ts (ça boucherait
// le graphe de modules) — c'est pourquoi la résolution du proxy de JOIN vit dans core.ts, pas dans
// rooms.ts (qui ne reçoit qu'une fonction déjà prête, cf. rooms.ts::MjsWsRoomsEngineOptions).

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { canonicalString, signCanonical, isLoopbackHost, REPLAY_WINDOW_S, resolveSecretRef } from './bridge.js'
import { safeEqual } from './package-helpers.js'
import { errMessage } from './guard.js'
import type { MjsWsClient, MjsWsHelloPayload, MjsWsLogFn } from './core.js'
import type { MjsWsRemoteInfo } from './transport.js'
import { t } from '../messages/index.js'

export interface MjsWsProxyOptions {
  /** URL du back qui décide (POST signé) — cf. docs/23-mjs-ws.md « Proxy de décisions ». */
  url: string
  /** secret de signature — chaîne littérale, ou 'env:NOM_VAR' résolue via process.env.NOM_VAR (MÊME patron que opts.bridge.secret). */
  secret: string
  /** délai avant abandon d'UNE requête, ms (défaut 5000) — au-delà : décision de REFUS, jamais bloquant/pendant. */
  timeout?: number
  /** cache court optionnel, par clé de requête — évite de marteler le back sur des reconnexions/rejoins rapprochés. Absent = pas de cache.
   *  Seule une réponse du back se garde : un refus dû à une panne (délai dépassé, réseau, statut non 2xx) jamais. */
  cache?: { ttl: number }
  /** échappatoire EXPLICITE à la garde TLS de resolveProxyOptions — autorise `url`
   *  en http:// même hors loopback (127.0.0.1/localhost/::1/[::1]). Défaut false : à n'activer qu'en
   *  connaissance de cause (réseau interne de confiance, tunnel déjà chiffré en amont…), jamais par défaut. */
  allowInsecure?: boolean
  /** durcissement optionnel — exige que la RÉPONSE du back soit signée elle-même
   *  (mêmes en-têtes x-mjs-ws-timestamp/x-mjs-ws-signature, MÊME secret,
   *  canonicalString(ts, 'RESPONSE', pathWithQuery, signatureRequête + '\n' + corpsRéponse) — méthode
   *  'RESPONSE', jamais 'POST', pour ne jamais confondre la signature de la REQUÊTE avec celle de la
   *  RÉPONSE ; la signature de la requête lie la réponse à SA requête : rejouée pour une autre, elle
   *  est refusée). Défaut
   *  false : la réponse est acceptée telle quelle, comme avant — RÉTRO-COMPAT TOTALE (la recette
   *  Rails actuelle, docs/23-mjs-ws.md §7.11, ne signe pas sa réponse et continue de marcher SANS
   *  aucun changement tant que cette option reste absente). */
  verifyResponse?: boolean
}

export interface MjsWsResolvedProxyOptions {
  url: string
  pathWithQuery: string
  secret: string
  timeout: number
  cache: { ttl: number } | null
  verifyResponse: boolean
}

export const DEFAULT_PROXY_TIMEOUT_MS = 5000

/** objet-proxy {url,...} vs fonction historique — MÊME détection PARTOUT (core.ts), jamais réimplémentée deux fois. */
export function isProxyOptions(x: unknown): x is MjsWsProxyOptions {
  return typeof x === 'object' && x !== null && typeof (x as { url?: unknown }).url === 'string'
}

// secret littéral OU 'env:NOM_VAR' — la règle du pont (bridge.ts::resolveSecretRef), avec les messages du proxy
function resolveSecret(raw: string, label: string): string {
  return resolveSecretRef(raw, label, 'ws.proxy.secret-missing', 'ws.proxy.secret-env-missing')
}

// hôtes "loopback" — jamais exposés à un tiers réseau, donc hors du périmètre de la garde TLS
// ci-dessous : 127.0.0.1/::1 (MÊME notion que isLoopbackHost, bridge.ts — réutilisée telle quelle)
// + leurs alias usuels localhost/[::1] (jamais couverts par isLoopbackHost : celui-ci ne voit QUE
// le host D'ÉCOUTE du pont, jamais un hostname d'URL SORTANTE comme ici — 'localhost' n'a par
// exemple aucun sens comme host d'écoute mais est très courant dans une URL de proxy en dev local).
function isLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return isLoopbackHost(h) || h === 'localhost' || h === '[::1]'
}

/** Résout `{url, secret, timeout?, cache?}` — défauts appliqués, secret déjà lu depuis l'environnement si besoin, URL validée UNE FOIS (jamais reparsée à chaque requête). */
export function resolveProxyOptions(raw: MjsWsProxyOptions): MjsWsResolvedProxyOptions {
  if (!raw || typeof raw.url !== 'string' || raw.url === '') {
    throw new Error(t('ws.proxy.url-missing'))
  }
  let parsed: URL
  try { parsed = new URL(raw.url) }
  catch { throw new Error(t('ws.proxy.url-invalid', { url: JSON.stringify(raw.url) })) }
  // garde TLS — la RÉPONSE de cette URL AUTHENTIFIE l'utilisateur (createAuthProxy,
  // `{ok:true,identity}` posé tel quel comme identity du client) ou décide d'un accès de salon
  // (createJoinProxy) : en http:// non-loopback, un attaquant EN CHEMIN (MITM) peut forger cette
  // réponse et s'authentifier comme n'importe qui. On refuse donc http:// dès que l'hôte n'est pas
  // loopback, SAUF raw.allowInsecure:true (échappatoire EXPLICITE, en connaissance de cause).
  // CHANGEMENT DE COMPORTEMENT : une telle URL était acceptée SANS garde avant ce
  // correctif. NB — https:// impose le chiffrement/l'authenticité du TRANSPORT, pas l'authenticité
  // du CONTENU de la réponse : ce durcissement complémentaire (signer la réponse elle-même) est
  // désormais disponible en opt-in (`verifyResponse: true`, cf. docs/23-mjs-ws.md §7.11).
  if (parsed.protocol === 'http:' && !isLoopback(parsed.hostname) && !raw.allowInsecure) {
    throw new Error(t('ws.proxy.http-not-loopback', { url: raw.url }))
  }
  if (raw.cache !== undefined && (typeof raw.cache !== 'object' || raw.cache === null || typeof raw.cache.ttl !== 'number' || raw.cache.ttl <= 0)) {
    throw new Error(t('ws.proxy.cache-ttl-invalid', { url: raw.url }))
  }
  return {
    url:            raw.url,
    pathWithQuery:  parsed.pathname + parsed.search,
    secret:         resolveSecret(raw.secret, `proxy de décision (${raw.url})`),
    timeout:        raw.timeout ?? DEFAULT_PROXY_TIMEOUT_MS,
    cache:          raw.cache ? { ttl: raw.cache.ttl } : null,
    verifyResponse: raw.verifyResponse === true,
  }
}

// vérifie que la RÉPONSE du back est bien signée par LUI (durcissement optionnel, verifyResponse)
// — MÊME schéma que la requête (canonicalString/signCanonical de bridge.ts, safeEqual de package-helpers.ts,
// réutilisées telles quelles), méthode 'RESPONSE' pour ne jamais confondre avec la signature 'POST' de la
// requête sortante (postSigned ci-dessous). La signature de la requête (`requestSig`) entre dans la
// chaîne signée : sans elle, une réponse vue en chemin se rejouerait pour n'importe quel autre hello
// pendant toute la fenêtre anti-rejeu. `null` = signature valide, sinon le message d'erreur
// (français, journalisé par l'appelant) — jamais de throw, cf. postSigned.
function verifyResponseSignature(resolved: MjsWsResolvedProxyOptions, rawBody: string, headers: Headers, requestSig: string): string | null {
  const ts  = headers.get('x-mjs-ws-timestamp')
  const sig = headers.get('x-mjs-ws-signature')
  if (!ts || !sig) return t('ws.proxy.signature-missing')
  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum)) return t('ws.proxy.timestamp-invalid')
  if (Math.abs(Date.now() / 1000 - tsNum) > REPLAY_WINDOW_S) return t('ws.proxy.timestamp-outside-window')
  const expected = signCanonical(resolved.secret, canonicalString(tsNum, 'RESPONSE', resolved.pathWithQuery, requestSig +'\n'+ rawBody))
  return safeEqual(expected, sig, 'hex') ? null : t('ws.bridge.signature-invalid')
}

// Plafond de la RÉPONSE du back, MÊME esprit que readBody
// (bridge.ts, corps ENTRANT du pont, 1 Mo) : SANS lui, un back bogué/compromis (ou une redirection,
// cf. plus bas) peut faire bufferiser une réponse arbitrairement grosse en mémoire, sans le
// moindre avertissement. Lecture EN FLUX (`res.body`, pas `res.text()`) : la lecture s'arrête dès
// le dépassement, jamais la réponse entière accumulée puis rejetée après coup.
const MAX_PROXY_RESPONSE_BYTES = 1024 * 1024

async function readBoundedText(res: Response): Promise<{ ok: true; body: string } | { ok: false }> {
  if (!res.body) {
    // repli défensif — un transport fetch sans flux de corps (improbable ici) reste borné aussi
    const body = await res.text()
    return Buffer.byteLength(body, 'utf8') > MAX_PROXY_RESPONSE_BYTES ? { ok: false } : { ok: true, body }
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_PROXY_RESPONSE_BYTES) { reader.cancel().catch(() => {}); return { ok: false } }
    chunks.push(value)
  }
  return { ok: true, body: Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8') }
}

// --- POST signé bas niveau — JAMAIS de throw : timeout/réseau/statut non-2xx/JSON invalide = `null`
// (décision de REFUS laissée à `mapResult`, cf. createProxyDecision ci-dessous) ------------------
async function postSigned(resolved: MjsWsResolvedProxyOptions, event: string, bodyText: Record<string, unknown>, onLog: MjsWsLogFn): Promise<any> {
  const body = JSON.stringify({ event, ...bodyText })
  const ts   = Math.floor(Date.now() / 1000)
  const sig  = signCanonical(resolved.secret, canonicalString(ts, 'POST', resolved.pathWithQuery, body))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), resolved.timeout)
  try {
    const res = await fetch(resolved.url, {
      method:  'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-mjs-ws-timestamp': String(ts), 'x-mjs-ws-signature': sig },
      body,
      signal:  controller.signal,
      // 'manual' : ne JAMAIS suivre une redirection 3xx. La
      // garde TLS/loopback (resolveProxyOptions) n'a vérifié QUE `resolved.url` ; une redirection
      // pointerait vers une destination JAMAIS soumise à cette garde. `res.ok` est déjà `false`
      // pour un 3xx (statut préservé) → traité PAR le refus existant
      // ci-dessous, aucune branche dédiée nécessaire.
      redirect: 'manual',
    })
    if (!res.ok) { onLog('warn', t('ws.proxy.response-status-refusal', { url: resolved.url, status: res.status, event })); return null }
    const bounded = await readBoundedText(res)
    if (!bounded.ok) { onLog('warn', t('ws.proxy.response-too-large', { url: resolved.url, event, max: MAX_PROXY_RESPONSE_BYTES })); return null }
    const rawBody = bounded.body
    // durcissement optionnel (verifyResponse) — AVANT le JSON.parse : une réponse mal signée est
    // refusée sans même être interprétée, cf. verifyResponseSignature ci-dessus.
    if (resolved.verifyResponse) {
      const error = verifyResponseSignature(resolved, rawBody, res.headers, sig)
      if (error) { onLog('warn', t('ws.proxy.response-signature-refusal', { url: resolved.url, error: error, event })); return null }
    }
    try { return JSON.parse(rawBody) }
    catch { onLog('warn', t('ws.proxy.response-json-invalid', { url: resolved.url, event })); return null }
  } catch (err) {
    onLog('warn', t('ws.proxy.request-failed', { url: resolved.url, event }), { cause: errMessage(err) })
    return null
  } finally {
    clearTimeout(timer)
  }
}

interface CacheEntry<T> { at: number; value: T }

/**
 * Fabrique GÉNÉRIQUE — POST signé `{event, ...corps}`, réponse JSON mappée vers la décision voulue
 * par `mapResult` (`null` en entrée = timeout/échec réseau/statut non-2xx/JSON invalide, jamais un
 * throw : à `mapResult` de choisir le refus qui va avec son protocole). Cache optionnel (clé = empreinte
 * sha256 du JSON du `corps` envoyé, 44 caractères quelle que soit la taille du hello : un champ libre
 * de 60 Ko ne s'accumule pas en mémoire) : résolu et construit ICI, UNE SEULE FOIS — la fonction RENVOYÉE porte le
 * cache dans sa fermeture, il survit donc à tous les appels ultérieurs (reconnexions/rejoins),
 * jamais recréé à chaque hello/join (cf. core.ts, qui appelle cette fabrique UNE fois au boot).
 */
export function createProxyDecision<T>(
  opts: MjsWsProxyOptions,
  event: string,
  mapResult: (json: any) => T,
  onLog: MjsWsLogFn,
): (body: Record<string, unknown>) => Promise<T> {
  const resolved = resolveProxyOptions(opts)
  const ttl   = resolved.cache?.ttl ?? null
  const cache = ttl != null ? new Map<string, CacheEntry<T>>() : null

  return async (body) => {
    let cacheKey: string | null = null
    if (cache && ttl != null) {
      try { cacheKey = createHash('sha256').update(JSON.stringify(body)).digest('base64') } catch { cacheKey = null }   // structure improbable (cyclique) — jamais de crash pour un simple souci de clé de cache
      if (cacheKey != null) {
        const hit = cache.get(cacheKey)
        if (hit && Date.now() - hit.at < ttl) return hit.value
      }
    }
    const json     = await postSigned(resolved, event, body, onLog)
    const decision = mapResult(json)
    // seule une réponse du back se garde : le refus d'une panne (délai dépassé, réseau, statut non 2xx, réponse illisible
    // ou mal signée) n'est jamais gardé, le visiteur entre dès que le back revient sans attendre la fin du `ttl`
    if (cache && cacheKey != null && json != null) {
      cache.delete(cacheKey)   // réécrite en queue : la purge par âge suppose l'ordre d'insertion = l'ordre d'âge
      cache.set(cacheKey, { at: Date.now(), value: decision })
      purgeCache(cache, ttl!)
    }
    return decision
  }
}

/** Plafond dur d'entrées gardées en mémoire, quand la purge par âge ne suffit pas à borner. */
const PROXY_CACHE_MAX = 5000

// PURGE — le cache ne retirait JAMAIS une entrée : une entrée périmée restait en mémoire
// pour la vie du processus, simplement plus jamais servie. Tant que la clé était le seul `corps`
// applicatif, la cardinalité restait basse ; depuis que le COOKIE de la requête d'upgrade entre
// dans la clé (cache par visiteur, cf. `cookieFromMeta`), c'est UNE entrée par session — la mémoire
// ne redescend plus jamais. Deux bornes, dans cet ordre :
//   1. par ÂGE — un `Map` conserve l'ordre d'INSERTION et le TTL est le même pour toutes : les
//      périmées sont exactement celles de tête. On s'arrête à la première encore valable, donc le
//      coût est proportionnel à ce qu'on retire, jamais à la taille du cache.
//   2. par NOMBRE — plafond dur, au cas où le débit d'entrées neuves dépasse le rythme
//      d'expiration : on évince les plus ANCIENNES, celles qui expireront de toute façon en
//      premier. Une éviction ne fait jamais qu'un aller-retour de plus vers le back.
function purgeCache<T>(cache: Map<string, CacheEntry<T>>, ttl: number): void {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now - entry.at < ttl) break
    cache.delete(key)
  }
  while (cache.size > PROXY_CACHE_MAX) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

// Cookie de la requête d'upgrade — le SEUL en-tête transmis au back (patron « mjsWs rejoue le
// cookie lui-même », docs/23-mjs-ws.md §7.12). Sans lui, ce patron ne pouvait PAS passer par le
// proxy (§7.11) et devait réécrire signature + délai + cache à la main : les deux recettes sont
// documentées côte à côte, elles se combinent désormais pour de vrai. Les AUTRES en-têtes ne
// partent jamais — un back n'a pas à recevoir l'`authorization` ou l'`user-agent` d'un client
// qu'il n'a pas demandés, et la garde TLS de resolveProxyOptions (http hors loopback refusé sauf
// allowInsecure) reste ce qui empêche ce cookie de voyager en clair.
//
// Clé de cache : empreinte du `corps` sérialisé (createProxyDecision) — le cookie EN FAIT PARTIE, le cache est
// donc par VISITEUR, jamais partagé entre deux identités. Cookie absent = clé omise, corps
// STRICTEMENT identique à l'ancien : un back déjà en place ne voit aucun changement.
//
// Casse des clés : les deux transports livrés minusculisent (`req.forEach` de µWS, `req.headers`
// de Node) — le repli sur 'Cookie' couvre un transport tiers qui ne le ferait pas, sans quoi
// l'absence serait SILENCIEUSE (un `false` d'authentification indiscernable d'un vrai refus).
function cookieFromMeta(meta: MjsWsRemoteInfo | undefined): string | undefined {
  const headers = meta?.headers
  if (!headers) return undefined
  const raw = headers.cookie ?? headers.Cookie
  const val = Array.isArray(raw) ? raw.join('; ') : raw
  return val ? val : undefined
}

interface DecisionConnect { ok: boolean; identity?: unknown; reason?: string }

/**
 * Spécialisation AUTH — compatible EXACTEMENT avec opts.auth (core.ts, `authFn`) : POST
 * `{event:'connect', hello, cookie?}` (cookie = celui de la requête d'upgrade, cf. cookieFromMeta
 * ci-dessus — absent quand il n'y en a pas, corps alors identique à l'historique), réponse
 * `{ok:true, identity}` → `identity` (welcome) ; `{ok:false,
 * reason?}` → THROW (reason, ou message générique) — réutilise le chemin `catch` DÉJÀ existant de
 * handleHello (`sendDeniedAndClose(client, errMessage(err))`), donc la raison du back atteint bien
 * le `µ:denied` du client SANS aucun branchement dédié côté core.ts.
 */
export function createAuthProxy(opts: MjsWsProxyOptions, onLog: MjsWsLogFn): (hello: MjsWsHelloPayload, meta: MjsWsRemoteInfo) => Promise<unknown> {
  const decide = createProxyDecision<DecisionConnect>(opts, 'connect', json => ({
    ok:       !!(json && json.ok === true),
    identity: json ? json.identity : undefined,
    reason:   json && typeof json.reason === 'string' ? json.reason : undefined,
  }), onLog)
  return async (hello, meta) => {
    const cookie = cookieFromMeta(meta)
    const r      = await decide(cookie === undefined ? { hello } : { hello, cookie })
    if (!r.ok) throw new Error(r.reason ?? t('ws.proxy.auth-refused'))
    return r.identity ?? {}
  }
}

/**
 * Spécialisation JOIN — compatible EXACTEMENT avec opts.rooms.join (rooms.ts, résolue par
 * core.ts) : POST `{event:'subscribe', room, identity}`, réponse `{ok:true}` → accès accordé ;
 * tout le reste → refus (message générique de rooms.ts::refuseJoin, MÊME contrat que le `false`
 * historique — pas de `reason` dédiée ici, le contrat documenté de `subscribe` n'en porte pas).
 */
export function createJoinProxy(opts: MjsWsProxyOptions, onLog: MjsWsLogFn): (room: string, client: MjsWsClient) => Promise<unknown> {
  const decide = createProxyDecision<boolean>(opts, 'subscribe', json => !!(json && json.ok === true), onLog)
  return (room, client) => decide({ room, identity: client.identity })
}
