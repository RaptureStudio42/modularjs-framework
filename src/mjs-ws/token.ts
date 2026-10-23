// mjs-ws/token — jetons JWT HS256 SANS dépendance (base64url header.payload.signature,
// node:crypto seul) : signToken/verifyToken bas niveau + jwtAuth(secret, opts), une aide prête
// à brancher sur `opts.auth` de mjsWs(). Autonome — n'a besoin d'AUCUNE connaissance du
// pont universel (bridge.ts), réutilisable tel quel même sans lui. Interopérable avec les
// bibliothèques JWT standard (gem jwt Ruby, firebase/php-jwt, pyjwt) : alg HS256 STRICT
// (jamais 'none', faille classique des vérificateurs laxistes), typ facultatif (JWT s'il est là :
// la gem jwt ne l'écrit pas), base64url SANS padding — format vérifié à la lettre. Secret
// obligatoire : vide, il laisserait n'importe qui fabriquer un jeton valide. `exp` et `nbf` toujours
// respectés (tolérance d'horloge en option) ; `aud` et `iss` vérifiés sur demande (`audience`,
// `issuer`) : un jeton fait pour un autre site qui partage le même secret est alors refusé.
// cf. docs/23-mjs-ws.md pour les recettes par langage.

import { createHmac } from 'node:crypto'
import type { MjsWsHelloPayload } from './core.js'
import type { MjsWsRemoteInfo } from './transport.js'
import { safeEqual, suggestKey } from './package-helpers.js'
import { t } from '../messages/index.js'

// --- base64url (RFC 4648 §5), SANS padding ------------------------------------------------

function b64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(input: string): Buffer {
  let s = input.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4 !== 0) s += '='
  return Buffer.from(s, 'base64')
}


// --- secret --------------------------------------------------------------------------------

// longueur conseillée : en deçà, un secret se devine hors ligne à partir d'un seul jeton intercepté
const SECRET_MIN_LENGTH = 32
let shortSecretWarned   = false

// secret absent, qui n'est pas une chaîne, ou vide (variable d'environnement oubliée) : la clé HMAC vide
// laisserait n'importe qui fabriquer un jeton valide, refusé en clair ; un secret court passe, avec un
// avertissement unique pour tout le processus
function checkSecret(secret: unknown, fn: string): void {
  if (typeof secret !== 'string' || secret === '') throw new Error(t('ws.token.secret-manquant', { fn }))
  if (secret.length < SECRET_MIN_LENGTH && !shortSecretWarned) {
    shortSecretWarned = true
    console.warn(t('ws.token.secret-court', { fn, length: secret.length, min: SECRET_MIN_LENGTH }))
  }
}

// --- signature bas niveau ------------------------------------------------------------------

export interface SignTokenOpts {
  /** durée de vie en SECONDES — pose `exp` (iat + ttl) ; absent = jeton sans expiration */
  ttl?: number
}

/** Signe un jeton HS256 — pose `iat` (maintenant, secondes) et `exp` si `ttl` fourni. Secret absent ou vide : lève. */
export function signToken(payload: Record<string, unknown>, secret: string, opts: SignTokenOpts = {}): string {
  checkSecret(secret, 'signToken')
  const header = { alg: 'HS256', typ: 'JWT' }
  const iat    = Math.floor(Date.now() / 1000)
  const body: Record<string, unknown> = { ...payload, iat }
  if (opts.ttl != null) body.exp = iat + opts.ttl

  const headerB64    = b64url(Buffer.from(JSON.stringify(header), 'utf8'))
  const payloadB64   = b64url(Buffer.from(JSON.stringify(body), 'utf8'))
  const signingInput = headerB64 +'.'+ payloadB64
  const sigB64        = b64url(createHmac('sha256', secret).update(signingInput).digest())
  return signingInput +'.'+ sigB64
}

// --- vérification : pour quel site, par qui, à partir de quand -----------------------------

export interface VerifyTokenOpts {
  /** site(s) pour lequel le jeton doit être fait — son `aud` (chaîne ou liste) doit en contenir un ; `aud` absent : refusé */
  audience?: string | string[]
  /** émetteur(s) admis — `iss` doit en être un ; `iss` absent : refusé */
  issuer?: string | string[]
  /** tolérance d'horloge en SECONDES (nombre fini ≥ 0, défaut 0), appliquée à `exp` et `nbf` */
  clockTolerance?: number
}

// options validées une fois pour toutes — `null` = claim non regardé
interface TokenRules {
  audience:       readonly string[] | null
  issuer:         readonly string[] | null
  clockTolerance: number
}

// valeur reçue, lisible dans un message d'erreur : NaN et Infinity restent eux-mêmes, un objet circulaire ne lève pas
function shown(value: unknown): string {
  if (typeof value === 'number') return String(value)
  try { return JSON.stringify(value) ?? String(value) }
  catch { return String(value) }
}

// une chaîne non vide, ou une liste non vide de chaînes non vides → la liste ; tout le reste → null
function stringList(value: unknown): string[] | null {
  const list = typeof value === 'string' ? [value] : value
  if (!Array.isArray(list) || list.length === 0 || !list.every(item => typeof item === 'string' && item !== '')) return null
  return [...list]
}

// clés des options de vérification — toute autre est refusée, avec la plus proche en suggestion
const VERIFY_KEYS: readonly string[] = ['audience', 'issuer', 'clockTolerance']

/** audience ou issuer d'un réglage : une chaîne non vide ou une liste non vide de chaînes non vides → la liste ;
 *  `undefined` = non donné (`null`) ; toute autre valeur lève, c'est une erreur de réglage — une chaîne vide comme le
 *  secret vide (variable d'environnement définie mais vide). Aide commune aux vérificateurs et à accountsPackage, qui
 *  en marque ses jetons */
export function checkClaimList(option: 'audience' | 'issuer', value: unknown, fn: string): string[] | null {
  if (value === undefined) return null
  const list = stringList(value)
  if (!list) throw new Error(t(option === 'audience' ? 'ws.token.audience-invalide' : 'ws.token.issuer-invalide', { fn, received: shown(value) }))
  return list
}

/** clé d'options hors de `known` : lève dès la construction, avec la plus proche en suggestion et la liste des options
 *  valides — même une clé mal écrite sans valeur. Aide commune aux vérificateurs et à accountsPackage */
export function checkOptionKeys(opts: object, known: readonly string[], fn: string): void {
  for (const key of Object.keys(opts)) {
    if (known.includes(key)) continue
    const suggestion = suggestKey(key, known)
    throw new Error(t('ws.token.option-inconnue', { fn, key, hint: suggestion ? t('ws.token.option-inconnue-suggestion', { suggestion }) : '', known: known.join(', ') }))
  }
}

// options de vérification, validées une fois : une clé inconnue ou une valeur invalide lève dès la construction
function checkRules(opts: unknown, fn: string): TokenRules {
  if (!opts || typeof opts !== 'object' || Array.isArray(opts)) throw new Error(t('ws.token.options-invalides', { fn, received: shown(opts) }))
  checkOptionKeys(opts, VERIFY_KEYS, fn)
  const { audience, issuer, clockTolerance = 0 } = opts as Record<string, unknown>
  const audiences = checkClaimList('audience', audience, fn)
  const issuers   = checkClaimList('issuer', issuer, fn)
  if (typeof clockTolerance !== 'number' || !Number.isFinite(clockTolerance) || clockTolerance < 0) throw new Error(t('ws.token.tolerance-invalide', { fn, received: shown(clockTolerance) }))
  return { audience: audiences, issuer: issuers, clockTolerance }
}

// `aud` du jeton, chaîne ou liste (RFC 7519 §4.1.3) : l'un des sites attendus doit y être, casse comprise
function audienceMatches(aud: unknown, expected: readonly string[]): boolean {
  const list = Array.isArray(aud) ? aud : [aud]
  return list.some(item => typeof item === 'string' && expected.includes(item))
}

/** Vérifie un jeton HS256 — `null` sur tout format/signature/échéance invalide, ou un site (`aud`) ou un émetteur (`iss`) qui n'est pas celui attendu (jamais un throw pour un jeton) ; secret absent ou vide, option invalide ou inconnue : lève, c'est une erreur de réglage. */
export function verifyToken(token: string, secret: string, opts: VerifyTokenOpts = {}): Record<string, unknown> | null {
  checkSecret(secret, 'verifyToken')
  return verifyWith(token, secret, checkRules(opts, 'verifyToken'))
}

// le cœur de verifyToken, sur des options déjà validées (jwtAuth les valide une fois, à sa construction)
function verifyWith(token: string, secret: string, rules: TokenRules): Record<string, unknown> | null {
  if (typeof token !== 'string' || token === '') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, sigB64] = parts

  let header: any
  try { header = JSON.parse(b64urlDecode(headerB64).toString('utf8')) }
  catch { return null }
  if (!header || header.alg !== 'HS256') return null   // jamais 'none' — faille classique
  if (header.typ !== undefined && (typeof header.typ !== 'string' || header.typ.toUpperCase() !== 'JWT')) return null   // typ facultatif (RFC 7519 §5.1) : la gem jwt ne l'écrit pas

  const expected = b64url(createHmac('sha256', secret).update(headerB64 +'.'+ payloadB64).digest())
  if (!safeEqual(expected, sigB64)) return null

  let payload: any
  try { payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) }
  catch { return null }
  const now = Math.floor(Date.now() / 1000)
  if (payload && payload.exp !== undefined && (!Number.isFinite(payload.exp) || now >= payload.exp + rules.clockTolerance)) return null   // expiré, ou échéance illisible : jamais un jeton éternel
  if (payload && payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || now + rules.clockTolerance < payload.nbf)) return null   // pas encore valable, ou date illisible
  if (rules.audience && !audienceMatches(payload?.aud, rules.audience)) return null   // fait pour un autre site
  if (rules.issuer && !(typeof payload?.iss === 'string' && rules.issuer.includes(payload.iss))) return null   // émis par un autre
  return payload
}

// --- aide prête pour opts.auth --------------------------------------------------------------

/**
 * `jwtAuth(secret, opts?)` → fonction directement branchable sur `opts.auth` de mjsWs() : lit
 * `hello.auth.token` (ou `hello.auth` si c'est DIRECTEMENT une chaîne), vérifie, et pose
 * `client.identity = payload` (avec `id = payload.id ?? payload.sub` — compatible des
 * jetons émis par une gem/lib tierce qui n'utilise que `sub`). Jeton absent/invalide/expiré/pas
 * encore valable, fait pour un autre site (`opts.audience`) ou émis par un autre (`opts.issuer`)
 * → `false` (µ:denied côté client, via le mécanisme auth existant de core.ts). Secret absent ou vide,
 * option invalide ou inconnue : lève dès la construction, pas au premier hello.
 */
export function jwtAuth(secret: string, opts: VerifyTokenOpts = {}): (hello: MjsWsHelloPayload, meta: MjsWsRemoteInfo) => unknown {
  checkSecret(secret, 'jwtAuth')
  const rules = checkRules(opts, 'jwtAuth')
  return (hello: MjsWsHelloPayload) => {
    const raw   = hello?.auth as unknown
    const token = typeof raw === 'string' ? raw : (raw && typeof raw === 'object' ? (raw as any).token : undefined)
    if (typeof token !== 'string' || token === '') return false
    const payload = verifyWith(token, secret, rules)
    if (!payload) return false
    const id = (payload as any).id ?? (payload as any).sub
    return { ...payload, id }
  }
}
