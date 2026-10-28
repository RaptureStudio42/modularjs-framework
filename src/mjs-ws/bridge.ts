// mjs-ws/bridge — « le pont universel » : serveur HTTP embarqué (node:http/node:crypto
// SEULS, aucune dépendance ajoutée) qui laisse n'importe quel back (Ruby, PHP, Python, un
// autre Node…) pousser du temps réel dans MJS-WS par simple POST signé, et recevoir en
// retour des webhooks sur les événements qui l'intéressent —
// activé par `opts.bridge` de mjsWs() (cf. index.ts), démarré/arrêté avec le reste de
// l'app (app.listen()/app.stop(), câblage dans core.ts qui fournit un `MjsWsBridgeContext`
// et pilote `MjsWsBridgeEngine`). AUCUNE connaissance du protocole µ: ici — tout passe par
// la façade publique `MjsWsApp` (broadcast/send/room/stream/clients) + une poignée de
// lectures/notifications internes fournies par core.ts (présence agrégée, cycle de vie).
// cf. docs/23-mjs-ws.md « Le pont universel » : signature canonique expliquée pas à pas +
// un exemple curl complet par endpoint + recettes Ruby/PHP/Python côté back.

import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createHmac } from 'node:crypto'
import { Buffer } from 'node:buffer'
import type { AddressInfo } from 'node:net'
import { peerIdOf } from './rooms.js'
import { WRITTEN_BY_BRIDGE } from './streams.js'
// limite de débit — seau à jetons réutilisé TEL QUEL depuis guard.ts (lecture seule,
// aucune primitive dupliquée) ; cf. la section « limite de débit » plus bas pour l'assemblage.
import { TokenBucket } from './guard.js'
import { safeEqual } from './package-helpers.js'
import type { MjsWsApp, MjsWsBroadcastOpts, MjsWsClient, MjsWsLogFn } from './core.js'
import type { MjsWsRemoteInfo } from './transport.js'
import { addressForLimits } from './transport.js'
// état/métriques — cf. stats.ts (registre + formateur Prometheus), stats-page.ts (page /state)
import { toPrometheusText } from './stats.js'
import type { MjsWsStatsRegistry } from './stats.js'
import { renderStatsPage } from './stats-page.js'
import { t } from '../messages/index.js'
import type { MsgKey } from '../messages/index.js'
import { hostHeaderName } from '../host-header.js'

// --- options utilisateur (opts.bridge de mjsWs()) ---------------------------------------

export interface MjsWsBridgeWebhooksOptions {
  /** URL du back qui reçoit les webhooks (POST signé, cf. docs/23-mjs-ws.md). */
  url: string
  /** Secret de signature des webhooks — défaut : celui du pont (`opts.bridge.secret`). Même forme (littérale ou
   *  `env:NOM_VAR`). Le préfixe de direction ('in'/'out', cf. canonicalString) rend désormais un secret PARTAGÉ
   *  sûr — une signature entrante n'est plus rejouable en sortie ni l'inverse — mais un secret DISTINCT reste
   *  recommandé en défense supplémentaire (compromission d'un des deux canaux sans effet sur l'autre). */
  secret?: string
  /** Événements à transmettre : 'connect', 'disconnect', 'join', 'leave', 'message:<type>'. */
  events: string[]
  /** Délai avant abandon d'UNE tentative, ms (défaut 5000). */
  timeoutMs?: number
  /** En-têtes du visiteur recopiés en plus dans `meta.headers` des webhooks connect/disconnect (noms, sans tenir compte de la
   *  casse) — par défaut seule une courte liste d'en-têtes sans secret part, cf. WEBHOOK_HEADERS. Un nom listé part tel quel. */
  forwardHeaders?: string[]
}

// limite de débit — [capacité, fenêtreMs] par seau ; défauts appliqués par
// resolveBridgeOptions si la clé (ou l'objet entier) est absente. cf. docs/23-mjs-ws.md « Limite de débit ».
export interface MjsWsBridgeRateLimitOptions {
  /** seau général PAR IP, requêtes sans signature (GET /health exempté) — défaut [120, 10000] (120 req/10 s, éclatement = capacité). */
  perIp?: [number, number]
  /** seau des échecs de signature PAR IP, PLUS STRICT — défaut [10, 60000] (10×401/60 s, au-delà 429 sans vérification HMAC). */
  fails?: [number, number]
}

export interface MjsWsBridgeOptions {
  /** Port du serveur HTTP du pont — défaut : port du transport `ws` + 1. */
  port?: number
  /** Host d'écoute — défaut '127.0.0.1' (loopback : c'est le back qui appelle, jamais Internet). */
  host?: string
  /** OBLIGATOIRE — chaîne littérale, ou `'env:NOM_VAR'` résolue via `process.env.NOM_VAR`. */
  secret: string
  /** Webhooks sortants (MJS-WS → le back) — absent = aucun webhook émis. */
  webhooks?: MjsWsBridgeWebhooksOptions
  /**
   * Limite de débit par IP — ACTIVE PAR DÉFAUT, `false` pour désactiver. Seau général
   * sur les requêtes SANS signature (`GET /health` exempté), + seau séparé plus strict sur les échecs de
   * signature (401) — au-delà, 429 immédiat SANS vérification HMAC. cf. docs/23-mjs-ws.md « Limite de débit ».
   */
  rateLimit?: MjsWsBridgeRateLimitOptions | false
  /**
   * Nonce anti-rejeu — ACTIF PAR DÉFAUT, `false` pour désactiver. Exige un en-tête `x-mjs-ws-nonce`
   * (8-64 caractères) sur CHAQUE requête signée, suffixé à la chaîne canonique — ferme la fenêtre
   * de rejeu ±300 s (§7.2) à un usage strictement unique par nonce ; `false` rend la fenêtre seule.
   * cf. docs/23-mjs-ws.md « Nonce anti-rejeu ».
   */
  nonce?: boolean
}

// --- options résolues (défauts appliqués, secret(s) déjà lus depuis l'environnement) ----

export interface MjsWsResolvedBridgeWebhooks {
  url: string
  secret: string
  events: Set<string>
  timeoutMs: number
  /** `forwardHeaders` en minuscules — absent : la liste permise seule */
  forwardHeaders?: ReadonlySet<string>
}

// limite de débit — forme RÉSOLUE (défauts déjà appliqués) d'un seau ; `null` au
// niveau `MjsWsResolvedBridgeOptions.rateLimit` = désactivée (opts.bridge.rateLimit === false).
export interface MjsWsResolvedRateLimit {
  perIp: { capacity: number; windowMs: number }
  fails: { capacity: number; windowMs: number }
}

export interface MjsWsResolvedBridgeOptions {
  port: number
  host: string
  secret: string
  webhooks?: MjsWsResolvedBridgeWebhooks
  rateLimit: MjsWsResolvedRateLimit | null
  /** nonce anti-rejeu — TOUJOURS résolu (comme rateLimit ci-dessus), défaut true */
  nonce: boolean
}

// longueur conseillée d'un secret de signature, même règle que le secret des jetons (token.ts) : en deçà, il se devine
// hors ligne à partir d'une seule requête signée interceptée. Un secret court passe, avec un avertissement pour chaque
// serveur qui l'emploie : ses options se résolvent une fois, à sa création (resolveBridgeOptions). Les serveurs /ws et
// /mjs-server d'un même processus partagent ce module, un avertissement unique par processus taisait le second
const SECRET_MIN_LENGTH = 32

function warnShortSecret(secret: string, label: string): void {
  if (secret.length >= SECRET_MIN_LENGTH) return
  console.warn(t('ws.bridge.secret-court', { label, length: secret.length, min: SECRET_MIN_LENGTH }))
}

/** un secret littéral, ou 'env:NOM_VAR' → process.env.NOM_VAR ; vide, ou variable absente ou vide : une erreur — `manquant` et
 *  `envAbsent`, les messages de l'appelant (le pont, le proxy de décision : proxy.ts) */
export function resolveSecretRef(raw: string | undefined, label: string, manquant: MsgKey, envAbsent: MsgKey): string {
  if (raw == null || raw === '') throw new Error(t(manquant, { label }))
  if (raw.indexOf('env:') !== 0) return raw
  const varName = raw.slice(4)
  const value   = process.env[varName]
  if (!value) throw new Error(t(envAbsent, { label, varName }))
  return value
}

// même règle pour le secret du pont et celui des webhooks (si absent côté webhooks, celui du pont est réutilisé, DÉJÀ
// résolu ici) ; un secret court est signalé
function resolveSecretValue(raw: string | undefined, label: string): string {
  const value = resolveSecretRef(raw, label, 'ws.bridge.secret-manquant', 'ws.bridge.secret-env-absent')
  warnShortSecret(value, label)
  return value
}

// limite de débit — défauts : 120 req/10 s par IP (seau général), 10×401/60 s (seau
// des échecs de signature, plus strict) — exportées pour que la bannière CLI (cli/ws.ts) et les
// tests affichent/vérifient les MÊMES littéraux, jamais recopiés en dur ailleurs.
export const DEFAULT_BRIDGE_RATE_LIMIT_PER_IP: [number, number] = [120, 10000]
export const DEFAULT_BRIDGE_RATE_LIMIT_FAILS:  [number, number] = [10, 60000]

function resolveRateLimitBucket(tuple: [number, number] | undefined, fallback: [number, number]): { capacity: number; windowMs: number } {
  const [capacity, windowMs] = tuple ?? fallback
  return { capacity, windowMs }
}

/** Résout `opts.bridge` — défauts (port = port ws + 1, host = 127.0.0.1) + secret(s) lus
 *  depuis l'environnement si besoin. Lève en français si `secret` est absent/vide. */
export function resolveBridgeOptions(userBridge: MjsWsBridgeOptions, wsPort: number): MjsWsResolvedBridgeOptions {
  const secret = resolveSecretValue(userBridge.secret, 'opts.bridge.secret')
  const port   = userBridge.port ?? (wsPort + 1)
  const host   = userBridge.host ?? '127.0.0.1'

  let webhooks: MjsWsResolvedBridgeWebhooks | undefined
  if (userBridge.webhooks) {
    const wh = userBridge.webhooks
    if (!wh.url) throw new Error(t('ws.bridge.webhooks-url-manquant'))
    if (!Array.isArray(wh.events) || wh.events.length === 0) {
      throw new Error(t('ws.bridge.webhooks-events-vide'))
    }
    webhooks = {
      url:       wh.url,
      secret:    wh.secret != null ? resolveSecretValue(wh.secret, 'opts.bridge.webhooks.secret') : secret,
      events:    new Set(wh.events),
      timeoutMs: wh.timeoutMs ?? 5000,
    }
    const extra = resolveForwardHeaders(wh.forwardHeaders)
    if (extra) webhooks.forwardHeaders = extra
  }

  // limite de débit — ACTIVE PAR DÉFAUT (userBridge.rateLimit absent = objet vide,
  // les deux seaux prennent alors leurs défauts) ; `false` EXPLICITE = désactivée (null).
  const rateLimit: MjsWsResolvedRateLimit | null = userBridge.rateLimit === false ? null : {
    perIp: resolveRateLimitBucket(userBridge.rateLimit?.perIp, DEFAULT_BRIDGE_RATE_LIMIT_PER_IP),
    fails: resolveRateLimitBucket(userBridge.rateLimit?.fails, DEFAULT_BRIDGE_RATE_LIMIT_FAILS),
  }

  // nonce anti-rejeu — ACTIF PAR DÉFAUT, seul un `false` EXPLICITE le coupe, MÊME philosophie que
  // rateLimit ci-dessus (résolu ici une fois pour toutes, jamais relu depuis userBridge ailleurs)
  const nonce = userBridge.nonce !== false

  return { port, host, secret, webhooks, rateLimit, nonce }
}

// état/métriques — SEUL endroit qui tranche « le pont est-il en loopback ? » (réutilisé
// pour la gate de signature de /stats, /metrics, /state ci-dessous ET pour la bannière de `mjs ws`,
// cf. cli/ws.ts via l'export de index.ts) : dès que `host` n'est PAS 127.0.0.1/::1, la signature
// redevient obligatoire PARTOUT, aucune exception — cf. docs/23-mjs-ws.md « L'état du serveur ».
export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1'
}

// --- signature HMAC-SHA256 — chaîne canonique --------------------------------------------
// DEUX formats cohabitent dans `canonicalString`, choisis par la présence du 6e argument
// `direction` — jamais deux fonctions, un seul point d'entrée :
//
// 1. format HISTORIQUE (`direction` absent) — `${ts}.${MÉTHODE}.${cheminAvecQuery}.${corps}`
//    (+ `.{nonce}` si fourni), INCHANGÉ OCTET PRÈS. C'est celui que réutilisent tels quels
//    proxy.ts (canonicalString POST/RESPONSE du proxy de décisions, direction déjà portée par
//    le champ MÉTHODE — cf. docs/23-mjs-ws.md §7.11) et src/mjs-server/persist-bridge.ts, SANS
//    jamais passer `direction` : zéro régression pour ces deux modules, ni pour la recette du
//    proxy de décisions documentée telle quelle.
//
// 2. format DIRIGÉ + INJECTIF (séparation de domaine du secret, canonicalString rendue
//    injective) — réservé aux DEUX usages
//    internes de bridge.ts : verifyIncomingSignature ci-dessous (`'in'`, commande admin entrante)
//    et deliver() des webhooks sortants plus bas (`'out'`). Chaque champ (direction, ts, méthode,
//    chemin, corps, nonce éventuel) est encodé en LONGUEUR-PRÉFIXÉE (`{longueur}:{champ}`) avant
//    concaténation — la chaîne devient INJECTIVE (un `.` dans le corps ne permet plus de la
//    re-découper autrement, cf. docs/23-mjs-ws.md « Chaîne canonique »), et `direction` est le
//    PREMIER champ : une signature calculée pour un sens est désormais inutilisable dans l'autre,
//    MÊME secret partagé (webhooks.secret absent) — cf. docs/23-mjs-ws.md « Séparation de domaine ».
//    ⚠️ CHANGEMENT DE PROTOCOLE (pré-publication, cf. docs) : les recettes §7.3/§7.5/§7.7/§7.10
//    sont mises à jour vers ce nouveau format — aucun back existant ne suivait encore l'ancien
//    format en production.
export type MjsWsBridgeDirection = 'in' | 'out'

// encodage longueur-préfixée d'UN champ — cf. point 2 ci-dessus
function lengthPrefixed(field: string): string {
  return field.length +':'+ field
}

export function canonicalString(ts: number, method: string, pathWithQuery: string, rawBody: string, nonce?: string, direction?: MjsWsBridgeDirection): string {
  if (direction == null) {
    const base = ts +'.'+ method.toUpperCase() +'.'+ pathWithQuery +'.'+ rawBody
    return nonce != null ? base +'.'+ nonce : base
  }
  const fields = [direction, String(ts), method.toUpperCase(), pathWithQuery, rawBody]
  if (nonce != null) fields.push(nonce)
  return fields.map(lengthPrefixed).join('')
}

export function signCanonical(secret: string, canonical: string): string {
  return createHmac('sha256', secret).update(canonical).digest('hex')
}

export const REPLAY_WINDOW_S = 300   // ± 5 min autour de maintenant — au-delà, 401 anti-rejeu

// nonce anti-rejeu — gabarit de longueur, cf. docs/23-mjs-ws.md « Nonce anti-rejeu »
const NONCE_MIN_LEN = 8
const NONCE_MAX_LEN = 64

// dé-duplique un en-tête Node (`string | string[] | undefined`, un tableau si répété sur le fil) —
// MÊME repli que ts/sig ci-dessous, factorisé pour x-mjs-ws-nonce sans tripler la logique
function firstHeader(h: string | string[] | undefined): string | undefined {
  return Array.isArray(h) ? h[0] : h
}

/** `null` si la requête est correctement signée, sinon le message d'erreur (français, → 401).
 *  `nonce.required` — `nonce.value` = en-tête x-mjs-ws-nonce déjà extrait par
 *  l'appelant (cf. handleRequest, qui en a aussi besoin ENSUITE pour la vérification anti-rejeu
 *  proprement dite, hors de cette fonction restée SANS état — cf. createBridgeNonceStore). */
function verifyIncomingSignature(
  secret: string, method: string, pathWithQuery: string, rawBody: string, headers: IncomingMessage['headers'], now = Date.now(),
  nonce?: { required: true; value: string | undefined },
): string | null {
  const ts  = firstHeader(headers['x-mjs-ws-timestamp'])
  const sig = firstHeader(headers['x-mjs-ws-signature'])
  if (!ts || !sig) return t('ws.bridge.signature-manquante')

  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum)) return t('ws.bridge.timestamp-invalide')
  if (Math.abs(now / 1000 - tsNum) > REPLAY_WINDOW_S) return t('ws.bridge.horodatage-hors-fenetre')

  if (nonce) {
    const n = nonce.value
    // en-tête absent : une recette d'avant le nonce par défaut — le message dit quoi ajouter
    if (n == null) return t('ws.bridge.nonce-manquant', { min: NONCE_MIN_LEN, max: NONCE_MAX_LEN })
    if (n.length < NONCE_MIN_LEN || n.length > NONCE_MAX_LEN) {
      return t('ws.bridge.nonce-requis', { min: NONCE_MIN_LEN, max: NONCE_MAX_LEN })
    }
  }

  // direction 'in' — une signature calculée côté back pour un webhook ('out') ne
  // vérifie plus ici, cf. canonicalString ci-dessus « Séparation de domaine »
  const expected = signCanonical(secret, canonicalString(tsNum, method, pathWithQuery, rawBody, nonce?.value, 'in'))
  if (!safeEqual(expected, sig, 'hex')) return t('ws.bridge.signature-invalide')
  return null
}

// --- lecture du corps, bornée à 1 Mo (au-delà : 413, mémoire jamais dépassée) -----------

const MAX_BODY_BYTES = 1024 * 1024

function readBody(req: IncomingMessage): Promise<{ ok: true; body: string } | { ok: false; status: number; error: string }> {
  return new Promise((resolvePromise) => {
    let total    = 0
    let tooLarge = false
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > MAX_BODY_BYTES) { tooLarge = true; return }   // on continue de drainer, sans accumuler — mémoire bornée
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) resolvePromise({ ok: false, status: 413, error: t('ws.bridge.corps-trop-volumineux') })
      else resolvePromise({ ok: true, body: Buffer.concat(chunks).toString('utf8') })
    })
    req.on('error', () => resolvePromise({ ok: false, status: 400, error: t('ws.bridge.erreur-lecture-corps') }))
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data) })
  res.end(data)
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

// --- ce que core.ts fournit au pont (lecture seule, ZÉRO connaissance du protocole µ:) ---

export interface MjsWsBridgeContext {
  app: MjsWsApp
  /** présence agrégée — MÊME source que les deltas µ:presence (rooms.ts), room absente = globale */
  presence(room?: string): Array<{ id: string; meta: unknown }>
  onLog: MjsWsLogFn
  /**
   * propage un `/send` ciblé (client|user) aux AUTRES process du cluster — absent =
   * mono-process (rien à propager). `/broadcast`, `/room/send`, `/room/kick` et `/stream`
   * traversent DÉJÀ tout seuls (app.broadcast/room()/stream() sont cluster-aware à la source,
   * cf. core.ts) : `/send` est le SEUL endpoint qui a besoin de cette accroche dédiée, parce
   * qu'il résout son id-cible en objet client LOCAL avant d'appeler app.send() (qui, lui,
   * reste sciemment local-only — cf. core.ts pour le pourquoi).
   */
  publishSend?: (target: { client?: string; user?: string }, type: string, p: unknown) => void
  /** `/room/kick {client}` : propage l'expulsion d'UNE connexion (son id) aux autres processus — absente hors cluster */
  publishKickConnexion?: (room: string, clientId: string, reason: string | undefined) => void
  /**
   * destinataires LOCAUX d'un `/send` — une connexion par son id (`client`), ou toutes les connexions d'un utilisateur
   * (`user`, MÊME résolution que app.sendUser) — par les index du serveur (core.ts::ciblesLocales) : le coût suit les
   * connexions de la cible, jamais le nombre total de connectés.
   */
  ciblesLocales: (clientId: string | undefined, user: string | undefined) => MjsWsClient[]
  /** connexions LOCALES désignées par un `except` : ses personnes (`identity.id`, ou `anon:` suivi de l'id de connexion —
   *  MÊME résolution que peerIdOf) et ses connexions (par leur id seul), par les index du serveur (core.ts::connexionsDesIds) */
  connexionsDesIds: (recu: MjsWsExceptRecu) => MjsWsClient[]
  /** état/métriques (stats.ts) — registre TOUJOURS peuplé (écriture : compteurs pont ci-dessous) ; lecture d'un instantané via `app.stats()` (déjà dans `app`). */
  stats: MjsWsStatsRegistry
  /** GET /stats, /metrics, /state actifs seulement si true (option `stats` de mjsWs(), désactivée par défaut) — le registre tourne quand même dans les deux cas. */
  statsEnabled: boolean
}

// --- ce que core.ts pilote (démarrage/arrêt + notifications de cycle de vie, webhooks) --

export interface MjsWsBridgeEngine {
  start(): Promise<void>
  stop(): Promise<void>
  notifyConnect(client: MjsWsClient): void
  notifyDisconnect(client: MjsWsClient, reason?: string): void
  notifyMessage(type: string, p: unknown, client: MjsWsClient): void
  notifyRoomJoin(room: string, id: string, meta: unknown): void
  notifyRoomLeave(room: string, id: string, meta: unknown): void
}

// --- petites aides de validation des corps entrants --------------------------------------

function isStr(x: unknown): x is string { return typeof x === 'string' && x.length > 0 }
function isPlainObject(x: unknown): x is Record<string, unknown> { return typeof x === 'object' && x !== null && !Array.isArray(x) }

// 'except' (broadcast/room-send) : absente, une personne (chaîne : identity.id, ou `anon:` suivi de l'id de connexion —
// peerIdOf), une seule connexion (`{ client: id }`, comme /room/kick), ou un tableau des deux mélangés. Jamais une chaîne
// pour une connexion : un compte peut porter l'id d'une connexion
function parseExcept(x: unknown): MjsWsExceptRecu | null {
  const recu: MjsWsExceptRecu = { personnes: [], connexions: [] }
  if (x === undefined) return recu
  for (const v of Array.isArray(x) ? x : [x]) {
    if (typeof v === 'string') recu.personnes.push(v)
    else if (isPlainObject(v) && typeof v.client === 'string' && Object.keys(v).length === 1) recu.connexions.push(v.client)
    else return null
  }
  return recu
}

// Bogue comblé — valide la charge (p/value/values) à L'ENTRÉE plutôt que de
// laisser core.ts::preEncodeFrame échouer en silence à l'envoi (JSON.stringify lève un RangeError
// sur une charge trop imbriquée — atteignable en UNE requête sous le plafond de 1 Mo du pont, environ
// 170 000 niveaux) : SANS cette garde, les 4 endpoints de push répondent `{ok:true}` alors qu'AUCUN
// client n'a rien reçu. MÊME plafond que streams.ts::MAX_VALUE_DEPTH, dupliqué ICI (module
// indépendant, cf. le commentaire de tête de proxy.ts sur la duplication délibérée entre fichiers
// mjs-ws) — la profondeur est la SEULE borne utile ici, cf. isSerializablePayload plus bas.
const MAX_PAYLOAD_DEPTH = 64

function isTooDeep(value: unknown, limit: number, depth = 0): boolean {
  if (depth > limit) return true
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) {
    for (const item of value) if (isTooDeep(item, limit, depth + 1)) return true
    return false
  }
  for (const k in value as Record<string, unknown>) if (isTooDeep((value as Record<string, unknown>)[k], limit, depth + 1)) return true
  return false
}

// la charge (p/value/values) naît TOUJOURS d'un JSON.parse du corps : ni Map, ni Set, ni fonction,
// ni Symbol, ni BigInt, ni `undefined` niché, rien que JSON.stringify refuse ou perde — sauf la
// profondeur (RangeError à l'envoi, cf. plus haut), seule bornée ici. Ni parcours de plus, ni
// sérialisation « pour voir » avant celle de l'envoi. `p`/`value`/`values` omis à la racine reste
// accepté, comportement historique inchangé (cf. tests/mjs-ws-bridge.test.ts « requête bien signée
// → 200 » avec `{type:'x'}`, sans `p`).
function isSerializablePayload(value: unknown): boolean {
  return !isTooDeep(value, MAX_PAYLOAD_DEPTH)
}

// option interne d'`app.broadcast` et de `room().send` (jamais documentée) : l'`except` tel que reçu par le pont, ses
// personnes et ses connexions à part. Les connexions résolues ici n'existent que dans CE processus ; relayées aux autres
// processus (cf. core.ts, idsExclus), l'id d'un compte y exclut aussi ses onglets servis ailleurs
export const EXCEPT_RECU: unique symbol = Symbol('except reçu par le pont')

/** un `except` par identifiants : des personnes (`identity.id`, ou `anon:` suivi de l'id de connexion), des connexions */
export interface MjsWsExceptRecu {
  personnes: string[]
  connexions: string[]
}

// options d'envoi d'un `except` reçu : les connexions locales désignées (par les index, cf. connexionsDesIds), plus
// l'`except` reçu pour les autres processus — même quand aucun onglet du compte n'est servi ici
function exceptRecu(ctx: MjsWsBridgeContext, recu: MjsWsExceptRecu): MjsWsBroadcastOpts | undefined {
  if (recu.personnes.length === 0 && recu.connexions.length === 0) return undefined
  return { except: ctx.connexionsDesIds(recu), [EXCEPT_RECU]: recu } as MjsWsBroadcastOpts
}

// --- endpoints ----------------------------------------------------------------------------

function handleBroadcast(ctx: MjsWsBridgeContext, payload: any, res: ServerResponse): void {
  if (!isStr(payload?.type)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.type-requis') }); return }
  const recu = parseExcept(payload.except)
  if (recu === null) { sendJson(res, 400, { ok: false, error: t('ws.bridge.except-invalide') }); return }
  if (!isSerializablePayload(payload.p)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.charge-non-serialisable', { depth: MAX_PAYLOAD_DEPTH }) }); return }
  // `app.broadcast` renvoie désormais `boolean` — `false` UNIQUEMENT si la
  // charge n'a pas pu être sérialisée à l'envoi, résiduel après la validation d'entrée ci-dessus
  const delivered = ctx.app.broadcast(payload.type, payload.p, exceptRecu(ctx, recu))
  if (!delivered) { ctx.onLog('error', t('ws.bridge.echec-envoi')); sendJson(res, 500, { ok: false, error: t('ws.bridge.echec-envoi') }); return }
  sendJson(res, 200, { ok: true })
}

// 'client' (id de connexion, AU PLUS une correspondance) OU 'user' (id agrégé, TOUTES ses connexions) — jamais les deux, jamais aucun
function handleSend(ctx: MjsWsBridgeContext, payload: any, res: ServerResponse): void {
  if (!isStr(payload?.type)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.type-requis') }); return }
  const hasClient = payload?.client !== undefined
  const hasUser   = payload?.user !== undefined
  if (hasClient === hasUser) { sendJson(res, 400, { ok: false, error: t('ws.bridge.client-ou-user') }); return }
  const target = hasClient ? payload.client : payload.user
  if (!isStr(target)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.client-user-chaine') }); return }
  if (!isSerializablePayload(payload.p)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.charge-non-serialisable', { depth: MAX_PAYLOAD_DEPTH }) }); return }

  let sent = 0
  let echecEnvoi = false
  // par les index (cf. MjsWsBridgeContext.ciblesLocales) — un id de connexion désigne au plus une connexion
  for (const c of ctx.ciblesLocales(hasClient ? target : undefined, hasUser ? target : undefined)) {
    // `app.send` renvoie désormais `boolean` — cf. handleBroadcast ci-dessus
    if (!ctx.app.send(c, payload.type, payload.p)) echecEnvoi = true
    sent++
  }
  // cluster — un autre process peut détenir d'autres connexions (client|user)
  ctx.publishSend?.({ client: hasClient ? target : undefined, user: hasUser ? target : undefined }, payload.type, payload.p)
  if (echecEnvoi) { ctx.onLog('error', t('ws.bridge.echec-envoi')); sendJson(res, 500, { ok: false, error: t('ws.bridge.echec-envoi') }); return }
  sendJson(res, 200, { ok: true, sent })
}

function handleRoomSend(ctx: MjsWsBridgeContext, payload: any, res: ServerResponse): void {
  if (!isStr(payload?.room)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.room-requis') }); return }
  if (!isStr(payload?.type)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.type-requis') }); return }
  const recu = parseExcept(payload.except)
  if (recu === null) { sendJson(res, 400, { ok: false, error: t('ws.bridge.except-invalide') }); return }
  if (!isSerializablePayload(payload.p)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.charge-non-serialisable', { depth: MAX_PAYLOAD_DEPTH }) }); return }
  try {
    // MÊME sémantique que room().send actuel — type VERBATIM, le pont ne préfixe rien (cf. docs/23-mjs-ws.md §4)
    // room().send() (rooms.ts, hors périmètre de ce module) reste `void` — CONTRAIREMENT à
    // app.broadcast/send ci-dessus, aucun signal d'échec d'encodage
    // résiduel n'est disponible ICI (accroche rooms.ts à poser) ; ce
    // try/catch reste un filet pour un throw IMPRÉVU (aucun aujourd'hui), pas un vrai signal.
    ctx.app.room(payload.room).send(payload.type, payload.p, exceptRecu(ctx, recu))
  } catch (err) {
    ctx.onLog('error', t('ws.bridge.echec-envoi'), { err })
    sendJson(res, 500, { ok: false, error: t('ws.bridge.echec-envoi') })
    return
  }
  sendJson(res, 200, { ok: true })
}

function handleRoomKick(ctx: MjsWsBridgeContext, payload: any, res: ServerResponse): void {
  if (!isStr(payload?.room)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.room-requis') }); return }
  const hasClient = payload?.client !== undefined
  const hasUser   = payload?.user !== undefined
  if (hasClient === hasUser) { sendJson(res, 400, { ok: false, error: t('ws.bridge.client-ou-user') }); return }
  const target = hasClient ? payload.client : payload.user
  if (!isStr(target)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.client-user-chaine') }); return }

  // {client} : CETTE connexion, par son id ; {user} : toutes les connexions de cette personne (peerIdOf — `anon:` suivi
  // de l'id de connexion pour un visiteur sans compte), jamais l'un pour l'autre : un compte peut porter l'id d'une
  // connexion. Comptage AVANT le kick : .kick() ne retourne rien
  const roomHandle = ctx.app.room(payload.room)
  const cibles     = Array.from(roomHandle.clients).filter(c => hasClient ? c.id === target : peerIdOf(c) === target)
  if (!hasClient) roomHandle.kick(target, payload.reason)
  else if (cibles.length > 0) roomHandle.kick(cibles[0], payload.reason)
  else ctx.publishKickConnexion?.(payload.room, target, payload.reason)   // servie par un autre processus
  sendJson(res, 200, { ok: true, kicked: cibles.length })
}

const STREAM_OPS = new Set(['add', 'update', 'remove', 'reset'])

function handleStream(ctx: MjsWsBridgeContext, payload: any, res: ServerResponse): void {
  if (!isStr(payload?.name)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.name-requis') }); return }
  if (!STREAM_OPS.has(payload?.op)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.op-invalide') }); return }

  // la charge se vérifie AVANT de toucher au flux : une écriture refusée ne crée rien
  switch (payload.op) {
    case 'add':
      if (!isStr(payload.id)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.id-requis-add') }); return }
      if (payload.value === undefined) { sendJson(res, 400, { ok: false, error: t('ws.bridge.value-requis-add') }); return }
      if (!isSerializablePayload(payload.value)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.charge-non-serialisable', { depth: MAX_PAYLOAD_DEPTH }) }); return }
      break
    case 'update':
      if (!isStr(payload.id)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.id-requis-update') }); return }
      if (!isPlainObject(payload.value)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.value-objet-update') }); return }
      if (!isSerializablePayload(payload.value)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.charge-non-serialisable', { depth: MAX_PAYLOAD_DEPTH }) }); return }
      break
    case 'remove':
      if (!isStr(payload.id)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.id-requis-remove') }); return }
      break
    case 'reset':
      if (!isPlainObject(payload.values)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.values-objet-reset') }); return }
      if (!isSerializablePayload(payload.values)) { sendJson(res, 400, { ok: false, error: t('ws.bridge.charge-non-serialisable', { depth: MAX_PAYLOAD_DEPTH }) }); return }
      break
  }

  // créé à la volée si nouveau, mais écrit, pas déclaré : servi seulement une fois déclaré par le code (cf. streams.ts)
  const s = ctx.app.stream(payload.name, WRITTEN_BY_BRIDGE)
  if (payload.op === 'add') s.add(payload.id, payload.value)
  else if (payload.op === 'update') s.update(payload.id, payload.value)
  else if (payload.op === 'remove') s.remove(payload.id)
  else s.reset(payload.values)
  sendJson(res, 200, { ok: true })
}

function handlePresence(ctx: MjsWsBridgeContext, url: URL, res: ServerResponse): void {
  const room  = url.searchParams.get('room') ?? undefined
  const peers = ctx.presence(room)
  sendJson(res, 200, { ok: true, peers })
}

// --- état/métriques (stats.ts) — 3 endpoints, actifs seulement si ctx.statsEnabled ----
// (sinon MÊME 404 qu'un chemin réellement inconnu — jamais un comportement observable différent
// qui trahirait « l'option existe mais est coupée »). Gate de signature : cf. STATS_ROUTES + son
// call-site dans handleRequest (isLoopbackHost, seul endroit qui tranche la question).

function handleStats(ctx: MjsWsBridgeContext, res: ServerResponse): void {
  if (!ctx.statsEnabled) { sendJson(res, 404, { ok: false, error: t('ws.bridge.chemin-inconnu', { route: 'GET /stats' }) }); return }
  sendJson(res, 200, ctx.app.stats())
}

function handleMetrics(ctx: MjsWsBridgeContext, res: ServerResponse): void {
  if (!ctx.statsEnabled) { sendJson(res, 404, { ok: false, error: t('ws.bridge.chemin-inconnu', { route: 'GET /metrics' }) }); return }
  const text = toPrometheusText(ctx.app.stats())
  res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

function handleState(ctx: MjsWsBridgeContext, res: ServerResponse): void {
  if (!ctx.statsEnabled) { sendJson(res, 404, { ok: false, error: t('ws.bridge.chemin-inconnu', { route: 'GET /state' }) }); return }
  const html = renderStatsPage(ctx.app.stats())
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html) })
  res.end(html)
}

// --- carte de chaleur (heatmap.ts) — la page d'admin et ses données, là seulement où le paquet est
// installé (sinon MÊME 404 qu'un chemin inconnu) ; même règle de signature que /state (STATS_ROUTES).
// Écrites en flux (des dizaines de Mo au plafond par défaut) : chaque morceau part dès qu'il est sérialisé, la
// main rendue au serveur temps réel entre deux, et un client qui lit lentement fait attendre la suite (la
// vidange du flux) — d'un seul trait, la boucle gelait plus de 600 ms à chaque requête ; gardée entière en
// texte, la carte nourrissait le ramasse-miettes. Un client parti : l'écriture s'arrête. Un client qui ne lit plus rien pendant
// CLIENT_ARRETE_MS (le serveur du pont n'a aucun délai de réponse) : sa réponse est coupée, jamais tenue sans fin
const CLIENT_PARTI     = new Error('client parti')
const CLIENT_ARRETE_MS = 30000
async function handleHeatmap(ctx: MjsWsBridgeContext, res: ServerResponse, json: boolean): Promise<void> {
  const write = (ctx.app as any)._heatmapWrite
  if (typeof write !== 'function') { sendJson(res, 404, { ok: false, error: t('ws.bridge.chemin-inconnu', { route: json ? 'GET /heatmap.json' : 'GET /heatmap' }) }); return }
  res.writeHead(200, { 'content-type': json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8' })
  const envoi = (morceau: string): void | Promise<void> => {
    if (res.destroyed) throw CLIENT_PARTI
    if (res.write(morceau)) return
    return new Promise<void>(ok => {
      const delai = setTimeout(() => res.destroy(), CLIENT_ARRETE_MS)
      const fin   = (): void => { clearTimeout(delai); res.off('drain', fin); res.off('close', fin); ok() }
      res.on('drain', fin)
      res.on('close', fin)
    })
  }
  try { await write(!json, envoi) }
  catch (err) {
    if (err === CLIENT_PARTI) return
    throw err
  }
  res.end()
}

// une carte qui échoue en cours de route : le journal le dit ; la réponse commencée est coupée (jamais un JSON tronqué pris pour entier)
function heatmapFailed(ctx: MjsWsBridgeContext, res: ServerResponse, err: unknown): void {
  ctx.onLog('error', t('ws.bridge.erreur-interne'), { err })
  if (!res.headersSent) sendJson(res, 500, { ok: false, error: t('ws.bridge.erreur-interne') })
  else res.destroy()
}

// --- limite de débit par IP — seau général + seau (plus strict) des échecs de
// signature, réutilisent TokenBucket (guard.ts) ------------------------------------------------
// TokenBucket n'expose qu'un take() CONSOMMATEUR (aucun « peek ») : le seau-échecs ne peut donc
// pas se pré-vérifier sans se consommer lui-même. On dérive un verrou `failBlockedUntil` (horloge),
// posé au moment où un take() de comptage échoue (le 401 QUI FAIT DÉBORDER le seau) — il couvre
// exactement « au-delà, 429 immédiat AVANT toute vérification HMAC » pour toutes les requêtes
// SUIVANTES, sans jamais faire payer le budget-échecs à une requête correctement signée (cf.
// docs/23-mjs-ws.md « Limite de débit »). Mémoire bornée par éviction PARESSEUSE : la Map reste
// ordonnée par ancienneté de DERNIER accès (ré-insertion en fin à chaque touche), un passage de
// purge regarde donc seulement le FRONT (borné à IP_SWEEP_MAX), jamais un scan complet.

const IP_ENTRY_TTL_MS = 10 * 60 * 1000   // entrée intacte depuis > 10 min → purgée au passage
const IP_SWEEP_MAX    = 8                // borne le coût d'un passage (jamais O(n) sur une IP isolée)

interface IpBucketEntry {
  general: TokenBucket
  fails: TokenBucket
  failBlockedUntil: number
  lastSeen: number
}

export interface MjsWsBridgeRateLimiter {
  /** true = admis (jeton général consommé) ; false = seau général épuisé → 429. */
  admitGeneral(ip: string, now?: number): boolean
  /** rend le jeton général d'une requête dont la signature est vérifiée (cf. handleRequest). */
  refundGeneral(ip: string, now?: number): void
  /** true = IP actuellement en pénalité (trop d'échecs de signature récents) → 429 immédiat, AUCUNE vérification HMAC. */
  isFailBlocked(ip: string, now?: number): boolean
  /** à appeler après un 401 CONFIRMÉ — true = encore dans le budget (401 normal), false = dépassé (429, IP verrouillée pour la fenêtre). */
  recordFailure(ip: string, now?: number): boolean
  /** nombre d'IP actuellement suivies — tests d'éviction uniquement. */
  readonly size: number
}

/** Construit le limiteur d'un pont — un couple de seaux PAR IP, créés à la volée au premier
 *  contact. `now` accepté sur chaque méthode (défaut Date.now()) : permet aux tests d'injecter
 *  une horloge pour l'éviction, SANS prétendre pouvoir accélérer le remplissage propre à
 *  TokenBucket (celui-ci reste sur l'horloge réelle, cf. guard.ts). */
export function createBridgeRateLimiter(config: MjsWsResolvedRateLimit): MjsWsBridgeRateLimiter {
  const perIpRefill = config.perIp.capacity / (config.perIp.windowMs / 1000)
  const failsRefill = config.fails.capacity / (config.fails.windowMs / 1000)
  const map = new Map<string, IpBucketEntry>()

  function sweep(now: number): void {
    let evicted = 0
    for (const [ip, entry] of map) {
      if (now - entry.lastSeen <= IP_ENTRY_TTL_MS) break   // Map ordonnée par ancienneté d'accès — le reste est plus récent
      map.delete(ip)
      if (++evicted >= IP_SWEEP_MAX) break
    }
  }

  function touch(address: string, now: number): IpBucketEntry {
    sweep(now)
    // une IPv6 compte pour son préfixe /56, comme toutes les limites par adresse (cf. transport.ts::addressForLimits)
    const ip  = addressForLimits(address) ?? address
    let entry = map.get(ip)
    if (entry) {
      entry.lastSeen = now
      map.delete(ip); map.set(ip, entry)   // ré-insère en fin — ordre = ancienneté de dernier accès
    } else {
      entry = {
        general:          new TokenBucket(config.perIp.capacity, perIpRefill),
        fails:            new TokenBucket(config.fails.capacity, failsRefill),
        failBlockedUntil: 0,
        lastSeen:         now,
      }
      map.set(ip, entry)
    }
    return entry
  }

  return {
    admitGeneral(ip, now = Date.now()) { return touch(ip, now).general.take(1) },
    refundGeneral(ip, now = Date.now()) { touch(ip, now).general.give(1) },
    isFailBlocked(ip, now = Date.now()) { return now < touch(ip, now).failBlockedUntil },
    recordFailure(ip, now = Date.now()) {
      const entry  = touch(ip, now)
      const within = entry.fails.take(1)
      if (!within) entry.failBlockedUntil = now + config.fails.windowMs
      return within
    },
    get size() { return map.size },
  }
}

// --- nonce anti-rejeu (actif par défaut — ws.bridge.nonce) — store PARTAGÉ ----------------------
// un nonce, une fois VU, n'est plus jamais retouché (contrairement à un seau de débit qui se
// rafraîchit à chaque accès) : le revoir EST la fraude détectée, pas un événement à prolonger.
//
// Faille HAUTE comblée — la fenêtre de rétention SUIT L'HORODATAGE SIGNÉ de la requête (+
// REPLAY_WINDOW_S), PAS l'instant de RÉCEPTION : verifyIncomingSignature accepte un ts jusqu'à
// REPLAY_WINDOW_S dans le FUTUR (§7.2, horloge émetteur en avance) — un nonce reçu à t0 pour un tel
// ts peut donc encore être « valide » (signature acceptée) jusqu'à `ts + REPLAY_WINDOW_S`, soit
// jusqu'à PRESQUE 2×REPLAY_WINDOW_S après t0. Une éviction comptée depuis t0 seul (ancien
// comportement) pouvait donc oublier le nonce AVANT que son propre ts cesse d'être jugé valide —
// le rejeu redevenait possible dans cette fenêtre. `checkAndRecord` reçoit maintenant l'horodatage
// SIGNÉ (ms) et retient le nonce jusqu'à CETTE échéance à lui, pas une fenêtre uniforme depuis la
// réception. La correction ne dépend PLUS de l'ordre de la Map (l'échéance n'est plus monotone avec
// l'ordre d'insertion, contrairement à avant) : chaque `checkAndRecord` compare directement
// l'échéance du nonce concerné ; un balayage complet, opportuniste, purge les entrées déjà expirées
// — au plus une fois par seconde (NONCE_SWEEP_EVERY_MS), jamais à chaque requête : un back qui
// pousse beaucoup ne paie plus un parcours de toute la table par requête (coût quadratique), et la
// rétention d'un nonce échu ne s'allonge que d'une seconde au plus.

export interface MjsWsBridgeNonceStore {
  /** true = nonce inédit DANS SA FENÊTRE (ACCEPTÉ, désormais enregistré jusqu'à `signedTsMs +
   *  REPLAY_WINDOW_S`) ; false = déjà vu, encore dans cette fenêtre (REJETÉ, rien ré-enregistré). */
  checkAndRecord(nonce: string, signedTsMs: number, now?: number): boolean
  /** nombre de nonces actuellement suivis — tests d'éviction uniquement. */
  readonly size: number
}

const NONCE_SWEEP_EVERY_MS = 1000

export function createBridgeNonceStore(): MjsWsBridgeNonceStore {
  const expiresAt = new Map<string, number>()   // nonce → échéance (ms epoch) = horodatage SIGNÉ + fenêtre
  let lastSweep   = -Infinity

  // purge OPPORTUNISTE, complète — cf. commentaire de tête : l'échéance suit le ts signé de CHAQUE
  // requête, plus l'ordre d'insertion de la Map (ne serait plus fiable pour un arrêt anticipé).
  // Horloge qui recule (réglage NTP) : purge tout de suite, jamais suspendue jusqu'à son retour.
  function sweep(now: number): void {
    if (now >= lastSweep && now - lastSweep < NONCE_SWEEP_EVERY_MS) return
    lastSweep = now
    for (const [nonce, exp] of expiresAt) if (exp < now) expiresAt.delete(nonce)
  }

  return {
    checkAndRecord(nonce, signedTsMs, now = Date.now()) {
      const exp = expiresAt.get(nonce)
      if (exp !== undefined && exp >= now) return false   // encore dans SA fenêtre — rejeu détecté
      expiresAt.set(nonce, signedTsMs + REPLAY_WINDOW_S * 1000)   // neuf, ou fenêtre expirée — (ré)enregistré
      sweep(now)
      return true
    },
    get size() { return expiresAt.size },
  }
}

// adresse IP source — clé de compteur SEULEMENT (jamais journalisée nommément, jamais renvoyée
// au client) ; remoteAddress est la seule source fiable ici (le pont écoute en loopback par
// défaut — un en-tête X-Forwarded-For serait trivialement falsifiable par l'appelant lui-même,
// qui EST la source de la requête).
function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'inconnue'
}

// --- dispatch HTTP --------------------------------------------------------------------------

// routes CONNUES — seules celles-ci comptent dans pont.requetesParEndpoint : un chemin
// bidon envoyé en rafale par un client curieux ne doit JAMAIS faire grossir le registre sans borne
// (même esprit que le journal circulaire des flux ou la file de webhooks, toujours bornés).
const KNOWN_ROUTES = new Set([
  'GET /health', 'POST /broadcast', 'POST /send', 'POST /room/send', 'POST /room/kick',
  'POST /stream', 'GET /presence', 'GET /stats', 'GET /metrics', 'GET /state',
  'GET /heatmap', 'GET /heatmap.json',
])
// /stats, /metrics, /state — signature EXEMPTÉE uniquement si le host effectif du pont
// est loopback (isLoopbackHost) : outil de dev local. Dès que le pont écoute ailleurs, ces 3
// endpoints redeviennent signés comme tout le reste — AUCUNE exception au-delà du loopback.
const STATS_ROUTES = new Set(['GET /stats', 'GET /metrics', 'GET /state', 'GET /heatmap', 'GET /heatmap.json'])

// voie non signée (STATS_ROUTES en boucle locale) — parade au rebinding DNS : une page étrangère
// qui fait pointer SON nom de domaine vers 127.0.0.1 envoie ce nom dans Host. Seuls les noms de la
// machine elle-même passent (localhost, 127.0.0.1, [::1], ou le host d'écoute) ; le port reste
// libre (un tunnel ssh garde son nom local). Host absent ou malformé : refusé. Lecture de l'en-tête commune avec le
// serveur de développement (host-header.ts) ; `listenHost` est ici 127.0.0.1 ou ::1 (cf. isLoopbackHost)
function isLocalHostHeader(header: string | undefined, listenHost: string): boolean {
  const name = hostHeaderName(header)
  return name === 'localhost' || name === '127.0.0.1' || name === '::1' || name === listenHost
}

// 401 (signature invalide/absente OU nonce rejoué) — CRÉDITE le seau-échecs (limite
// de débit) : CHOKE POINT unique pour tout refus adjacent à la signature, jamais
// dupliqué entre le chemin sigError et le chemin nonce ci-dessous. Peut lui-même se transformer
// en 429 si le budget déborde (cf. createBridgeRateLimiter) — http401 ne compte alors QUE les
// vraies réponses 401, jamais celles requalifiées en 429 (mêmes garanties Prometheus qu'avant).
function rejectUnauthorized(
  ctx: MjsWsBridgeContext, limiter: MjsWsBridgeRateLimiter | null, ip: string, now: number,
  res: ServerResponse, error: string, method: string, path: string,
): void {
  const withinBudget = limiter ? limiter.recordFailure(ip, now) : true
  if (!withinBudget) {
    ctx.stats.pont.rateLimited++
    sendJson(res, 429, { ok: false, error: 'rate-limited' })
    return
  }
  ctx.stats.pont.http401++
  ctx.onLog('warn', t('ws.bridge.requete-refusee', { error }), { method, path })
  sendJson(res, 401, { ok: false, error })
}

async function handleRequest(
  resolved: MjsWsResolvedBridgeOptions, ctx: MjsWsBridgeContext, limiter: MjsWsBridgeRateLimiter | null,
  nonceStore: MjsWsBridgeNonceStore | null, req: IncomingMessage, res: ServerResponse,
): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase()
  const url    = new URL(req.url ?? '/', 'http://mjs-ws.local')   // base bidon — seuls pathname/searchParams servent
  const route  = method +' '+ url.pathname
  if (KNOWN_ROUTES.has(route)) ctx.stats.pont.requetesParEndpoint[route] = (ctx.stats.pont.requetesParEndpoint[route] ?? 0) + 1

  if (method === 'GET' && url.pathname === '/health') { sendText(res, 200, 'ok'); return }   // SEUL endpoint non signé ET jamais limité (sonde d'orchestrateur — hors /stats-/metrics-/state en loopback, cf. plus bas)

  const now           = Date.now()
  const ip            = clientIp(req)
  const skipSignature = STATS_ROUTES.has(route) && isLoopbackHost(resolved.host)

  // limite de débit — AVANT toute lecture de corps (ne dépense rien — mémoire/CPU — pour un flux déjà bloqué). Toute requête
  // prend un jeton du seau général PAR IP ; celle dont la signature est VÉRIFIÉE le rend aussitôt (cf. plus bas) : un back qui
  // signe n'est pas limité par lui, quel que soit son débit, mais un en-tête de signature, jamais vérifié à ce stade, ne
  // dispense de rien. Une signature fausse se paie en plus au seau-échecs, plus strict : IP déjà en pénalité → 429 immédiat,
  // AUCUNE vérification HMAC tentée
  const signed = !skipSignature && firstHeader(req.headers['x-mjs-ws-signature']) !== undefined
  if (limiter && (!limiter.admitGeneral(ip, now) || (!skipSignature && limiter.isFailBlocked(ip, now)))) {
    ctx.stats.pont.rateLimited++
    sendJson(res, 429, { ok: false, error: 'rate-limited' })
    return
  }

  const bodyResult = await readBody(req)
  // cast explicite : strictNullChecks: false (tsconfig du projet) désactive le control-flow
  // narrowing natif des unions discriminées (cf. bundler/config.ts, même angle mort connu)
  if (!bodyResult.ok) {
    const bad = bodyResult as { ok: false; status: number; error: string }
    // corps trop gros ou illisible sous un en-tête de signature : un échec compté, comme une signature fausse
    if (signed && limiter && !limiter.recordFailure(ip, now)) {
      ctx.stats.pont.rateLimited++
      sendJson(res, 429, { ok: false, error: 'rate-limited' })
      return
    }
    sendJson(res, bad.status, { ok: false, error: bad.error })
    return
  }
  const rawBody = bodyResult.body

  if (skipSignature && !isLocalHostHeader(req.headers.host, resolved.host)) {
    sendJson(res, 403, { ok: false, error: t('ws.bridge.hote-refuse') })
    return
  }

  if (!skipSignature) {
    // nonce anti-rejeu (ws.bridge.nonce) — extrait AVANT verifyIncomingSignature :
    // suffixé à la chaîne canonique (cf. canonicalString), donc requis pour même CALCULER la
    // signature attendue quand l'option est active (défaut). Chaîne sans nonce si `resolved.nonce`
    // est false (`nonce: false` explicite) — nonceHeader reste alors `undefined`, jamais lu ni exigé.
    const nonceHeader = resolved.nonce ? firstHeader(req.headers['x-mjs-ws-nonce']) : undefined
    const sigError = verifyIncomingSignature(
      resolved.secret, method, req.url ?? '/', rawBody, req.headers, undefined,
      resolved.nonce ? { required: true, value: nonceHeader } : undefined,
    )
    if (sigError) { rejectUnauthorized(ctx, limiter, ip, now, res, sigError, method, url.pathname); return }
    // signature (et gabarit du nonce) valides — reste à vérifier que ce nonce PRÉCIS n'a jamais
    // été vu DANS SA FENÊTRE (cf. createBridgeNonceStore, alignée sur l'horodatage SIGNÉ, pas
    // seulement ±300 s depuis la réception) : un rejeu de la MÊME requête (même ts, même sig, même
    // nonce) est désormais détecté même DANS la fenêtre de §7.2. `x-mjs-ws-timestamp` déjà validé
    // fini par verifyIncomingSignature ci-dessus (sinon `sigError` aurait déjà fait sortir).
    if (nonceStore) {
      const signedTsMs = Number(firstHeader(req.headers['x-mjs-ws-timestamp'])) * 1000
      if (!nonceStore.checkAndRecord(nonceHeader!, signedTsMs, now)) {
        rejectUnauthorized(ctx, limiter, ip, now, res, 'nonce-rejoué', method, url.pathname)
        return
      }
    }
    // signature vérifiée : le jeton général pris à l'arrivée est rendu
    if (limiter) limiter.refundGeneral(ip, now)
  }

  let payload: any = {}
  if (rawBody.length > 0) {
    try { payload = JSON.parse(rawBody) }
    catch { sendJson(res, 400, { ok: false, error: t('ws.bridge.json-invalide') }); return }
  }

  try {
    switch (route) {
      case 'POST /broadcast':  handleBroadcast(ctx, payload, res); return
      case 'POST /send':       handleSend(ctx, payload, res); return
      case 'POST /room/send':  handleRoomSend(ctx, payload, res); return
      case 'POST /room/kick':  handleRoomKick(ctx, payload, res); return
      case 'POST /stream':     handleStream(ctx, payload, res); return
      case 'GET /presence':    handlePresence(ctx, url, res); return
      case 'GET /stats':       handleStats(ctx, res); return
      case 'GET /metrics':     handleMetrics(ctx, res); return
      case 'GET /state':        handleState(ctx, res); return
      case 'GET /heatmap':      void handleHeatmap(ctx, res, false).catch(err => heatmapFailed(ctx, res, err)); return
      case 'GET /heatmap.json': void handleHeatmap(ctx, res, true).catch(err => heatmapFailed(ctx, res, err)); return
      default: sendJson(res, 404, { ok: false, error: t('ws.bridge.chemin-inconnu', { route }) })
    }
  } catch (err) {
    ctx.onLog('error', t('ws.bridge.erreur-interne'), { err })
    sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

// --- webhooks sortants : file bornée, parallélisme borné, retentatives bornées ----------
// un échec ne bloque JAMAIS le serveur (fire-and-forget) — la réponse du back n'est JAMAIS
// renvoyée au client d'origine, cf. docs/23-mjs-ws.md.

const WEBHOOK_QUEUE_MAX       = 1000
const WEBHOOK_INFLIGHT_MAX    = 4
const WEBHOOK_RETRY_DELAYS_MS = [2000, 10000]   // délai AVANT chaque retentative — l'essai initial part sans délai (0/2/10 s)
const WEBHOOK_FULL_WARN_MS    = 60 * 1000       // file pleine : un avertissement au plus par minute, avec le compte des perdus

// corps déjà sérialisé à l'émission (cf. emit) — une charge que JSON refuse n'entre jamais en file ;
// `attempt` = rang de la prochaine tentative (0 = la première)
interface WebhookJob { event: string; body: string; attempt: number }

// en-têtes du visiteur recopiés dans un webhook connect/disconnect : une courte liste d'en-têtes utiles et sans secret,
// plus ceux que l'appli ajoute (webhooks.forwardHeaders). Une liste de noms interdits laissait toujours passer ce qu'elle
// ne nommait pas — l'identité posée par un proxy d'authentification (Remote-User, X-Forwarded-Groups, X-Userinfo, le
// certificat client…) partait vers l'URL du webhook (http possible) et ses journaux. Cookie, Authorization,
// Sec-WebSocket-Protocol (où l'on met souvent le jeton) et tout le reste ne partent pas ; l'adresse et l'origine du
// visiteur restent dans `meta` (address, origin)
const WEBHOOK_HEADERS = new Set(['host', 'origin', 'user-agent', 'accept-language', 'x-request-id', 'x-forwarded-proto', 'sec-websocket-version'])

// nom d'en-tête HTTP (jeton de la RFC 9110)
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

// webhooks.forwardHeaders — une liste de noms d'en-têtes, comparés en minuscules ; tout autre valeur refusée à la déclaration
function resolveForwardHeaders(raw: unknown): Set<string> | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || !raw.every(nom => typeof nom === 'string' && HEADER_NAME.test(nom))) {
    let received: string
    try { received = JSON.stringify(raw) ?? String(raw) }
    catch { received = String(raw) }
    throw new Error(t('ws.bridge.webhooks-forward-headers-invalide', { received }))
  }
  return new Set(raw.map(nom => nom.toLowerCase()))
}

// copie de la méta pour le webhook — client.meta reste entière (opts.auth lit le cookie)
function webhookMeta(meta: MjsWsRemoteInfo, extra: ReadonlySet<string> | undefined): MjsWsRemoteInfo {
  const headers = meta?.headers
  if (!headers) return meta
  const kept: Record<string, string | string[] | undefined> = {}
  for (const name in headers) {
    const nom = name.toLowerCase()
    if (WEBHOOK_HEADERS.has(nom) || (extra !== undefined && extra.has(nom))) kept[name] = headers[name]
  }
  return { ...meta, headers: kept }
}

function postJson(target: URL, body: string, ts: number, sig: string, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolvePromise, reject) => {
    const requester = target.protocol === 'https:' ? httpsRequest : httpRequest
    const req = requester(target, {
      method: 'POST',
      headers: {
        'content-type':      'application/json; charset=utf-8',
        'content-length':    Buffer.byteLength(body),
        'x-mjs-ws-timestamp': String(ts),
        'x-mjs-ws-signature': sig,
      },
      timeout: timeoutMs,
      signal,   // app.stop() interrompt la requête en vol (cf. createWebhookSender.stop)
    }, (res) => {
      res.resume()   // corps de réponse du back ignoré — fire-and-forget
      const status = res.statusCode ?? 0
      resolvePromise(status >= 200 && status < 300)
    })
    req.on('timeout', () => req.destroy(new Error(t('ws.bridge.delai-webhook-depasse'))))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function createWebhookSender(webhooks: MjsWsResolvedBridgeWebhooks | undefined, onLog: MjsWsLogFn, stats: MjsWsStatsRegistry) {
  if (!webhooks) return { emit(_event: string, _payload: unknown): void {}, stop(): void {} }
  const wh = webhooks
  const target = new URL(wh.url)
  const queue: WebhookJob[] = []
  let inflight = 0
  let stopped  = false
  // ce que stop() coupe : les retentatives en attente (minuterie → l'événement) et les requêtes en vol
  const retries  = new Map<ReturnType<typeof setTimeout>, WebhookJob>()
  const requetes = new Set<AbortController>()
  // file pleine — perdus depuis le dernier avertissement, dernier événement perdu, prochain avertissement permis
  let perdus        = 0
  let dernierPerdu  = ''
  let prochainAvert = 0

  // une livraison en échec attend sa retentative HORS des places en vol : un back tombé une seconde n'immobilise plus les
  // WEBHOOK_INFLIGHT_MAX places pendant les pauses (2 s, puis 10 s), les événements suivants partent. La pause finie,
  // l'événement repasse en tête de file ; en attente, il compte dans la borne de la file (cf. emit)
  function planRetry(job: WebhookJob, ms: number): void {
    const timer = setTimeout(() => {
      retries.delete(timer)
      if (stopped) return
      queue.unshift(job)
      pump()
    }, ms)
    retries.set(timer, job)
  }

  function pump(): void {
    while (!stopped && inflight < WEBHOOK_INFLIGHT_MAX && queue.length > 0) {
      const job = queue.shift()!
      inflight++
      void deliver(job)
        .catch(err => onLog('error', t('ws.bridge.erreur-interne-non-geree'), { err }))
        .finally(() => { inflight--; pump() })
    }
  }

  async function deliver(job: WebhookJob): Promise<void> {
    const ts   = Math.floor(Date.now() / 1000)
    // direction 'out' — une signature captée sur une commande admin ('in') ne
    // vérifie plus côté back pour un webhook, cf. canonicalString ci-dessus « Séparation de domaine »
    const sig  = signCanonical(wh.secret, canonicalString(ts, 'POST', target.pathname + target.search, job.body, undefined, 'out'))
    try {
      const controller = new AbortController()
      requetes.add(controller)
      let okStatus: boolean
      try { okStatus = await postJson(target, job.body, ts, sig, wh.timeoutMs, controller.signal) }
      finally { requetes.delete(controller) }
      if (!okStatus) throw new Error(t('ws.bridge.reponse-http-non-2xx'))
      stats.pont.webhooksEnvoyes++
    } catch (err) {
      stats.pont.webhooksEchoues++
      if (stopped) return
      if (job.attempt < WEBHOOK_RETRY_DELAYS_MS.length) {
        planRetry({ ...job, attempt: job.attempt + 1 }, WEBHOOK_RETRY_DELAYS_MS[job.attempt])
        return
      }
      stats.pont.webhooksAbandonnes++
      onLog('warn', t('ws.bridge.webhook-abandonne', { event: job.event, tentative: job.attempt + 1 }), { err: err instanceof Error ? err.message : String(err), url: wh.url })
    }
  }

  // file pleine : la première perte se dit tout de suite, les suivantes se comptent — une ligne au plus
  // par minute avec leur nombre, le reste du compte à l'arrêt ; jamais une ligne par message perdu
  function signalerPerte(event: string): void {
    perdus++
    dernierPerdu = event
    const now = Date.now()
    if (now < prochainAvert) return
    if (perdus === 1) onLog('warn', t('ws.bridge.file-webhooks-pleine', { max: WEBHOOK_QUEUE_MAX, event }), { max: WEBHOOK_QUEUE_MAX, event, perdus })
    else onLog('warn', t('ws.bridge.file-webhooks-pleine-compte', { max: WEBHOOK_QUEUE_MAX, event, perdus }), { max: WEBHOOK_QUEUE_MAX, event, perdus })
    perdus        = 0
    prochainAvert = now + WEBHOOK_FULL_WARN_MS
  }

  return {
    emit(event: string, payload: unknown): void {
      if (stopped || !wh.events.has(event)) return
      if (queue.length + retries.size >= WEBHOOK_QUEUE_MAX) { signalerPerte(event); return }
      // sérialisé ICI, sous garde : une identité que JSON refuse (BigInt d'une colonne de base,
      // objet cyclique d'un ORM) perd son webhook, jamais le processus
      let body: string
      try { body = JSON.stringify(payload) }
      catch (err) {
        stats.pont.webhooksAbandonnes++
        onLog('error', t('ws.bridge.webhook-non-serialisable', { event }), { event, err: err instanceof Error ? err.message : String(err) })
        return
      }
      queue.push({ event, body, attempt: 0 })
      pump()
    },
    stop(): void {
      stopped = true
      for (const timer of retries.keys()) clearTimeout(timer)
      retries.clear()
      for (const controller of requetes) controller.abort()
      if (perdus > 0) {
        onLog('warn', t('ws.bridge.file-webhooks-pleine-compte', { max: WEBHOOK_QUEUE_MAX, event: dernierPerdu, perdus }), { max: WEBHOOK_QUEUE_MAX, event: dernierPerdu, perdus })
        perdus = 0
      }
    },
  }
}

// --- le pont — démarrage/arrêt + notifications de cycle de vie (câblées par core.ts) -----

export function createBridge(resolved: MjsWsResolvedBridgeOptions, ctx: MjsWsBridgeContext): MjsWsBridgeEngine {
  const webhooks = createWebhookSender(resolved.webhooks, ctx.onLog, ctx.stats)
  // limite de débit — un seul limiteur pour la durée de vie du pont (Maps internes
  // par IP, éviction paresseuse, cf. createBridgeRateLimiter ci-dessus) ; `null` = désactivée.
  const limiter = resolved.rateLimit ? createBridgeRateLimiter(resolved.rateLimit) : null
  // nonce anti-rejeu — MÊME principe que limiter ci-dessus : un seul store pour la
  // durée de vie du pont, `null` = désactivé (`nonce: false`, cf. resolveBridgeOptions)
  const nonceStore = resolved.nonce ? createBridgeNonceStore() : null
  let server: ReturnType<typeof createServer> | null = null

  return {
    async start() {
      server = createServer((req, res) => {
        handleRequest(resolved, ctx, limiter, nonceStore, req, res).catch(err => {
          ctx.onLog('error', t('ws.bridge.erreur-interne-non-geree'), { err })
          try { res.destroy() } catch { /* déjà fermée */ }
        })
      })
      await new Promise<void>((resolveStart, reject) => {
        server!.once('error', reject)
        server!.listen(resolved.port, resolved.host, () => resolveStart())
      })
      const addr       = server.address() as AddressInfo | null
      const actualPort = addr ? addr.port : resolved.port
      // mention « nonce : exigé » — mini-bannière PROPRE au pont (log de démarrage
      // bridge.ts) ; la bannière ÉLABORÉE de `mjs ws` (limite de débit, etc.) vit dans cli/ws.ts.
      ctx.onLog('info', t('ws.bridge.ecoute-pont', { host: resolved.host, port: actualPort, nonce: resolved.nonce }), {
        host: resolved.host, port: actualPort,
        webhookEvents: resolved.webhooks ? Array.from(resolved.webhooks.events) : null,
        nonce: resolved.nonce,
      })
    },

    async stop() {
      webhooks.stop()
      if (!server) return
      const s = server
      server = null
      await new Promise<void>(r => s.close(() => r()))
    },

    notifyConnect(client) {
      webhooks.emit('connect', { event: 'connect', at: Date.now(), client: { id: client.id, identity: client.identity, meta: webhookMeta(client.meta, resolved.webhooks?.forwardHeaders) } })
    },

    notifyDisconnect(client, reason) {
      const p: Record<string, unknown> = { event: 'disconnect', at: Date.now(), client: { id: client.id, identity: client.identity, meta: webhookMeta(client.meta, resolved.webhooks?.forwardHeaders) } }
      if (reason !== undefined) p.reason = reason
      webhooks.emit('disconnect', p)
    },

    notifyMessage(type, p, client) {
      webhooks.emit(`message:${type}`, { event: 'message', type, p, client: { id: client.id, identity: client.identity } })
    },

    notifyRoomJoin(room, id, meta) {
      webhooks.emit('join', { event: 'join', at: Date.now(), room, user: { id, meta } })
    },

    notifyRoomLeave(room, id, meta) {
      webhooks.emit('leave', { event: 'leave', at: Date.now(), room, user: { id, meta } })
    },
  }
}
