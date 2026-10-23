// mjs-ws/guard — « le videur » : protections de série contre un client qui
// dérape (débit, taille, contre-pression) et contre un handler applicatif qui
// plante. Primitives pures/réutilisables, sans dépendance au transport ni au
// protocole µ: — core.ts les branche mais n'en réimplémente aucune.

import { t } from '../messages/index.js'
import type { MsgKey } from '../messages/index.js'

/** Seau à jetons — rate/burst par connexion (refill continu, pas de fenêtre fixe). */
export class TokenBucket {
  private _tokens: number
  private _lastRefill: number

  constructor(private _capacity: number, private _refillPerSecond: number) {
    this._tokens     = _capacity
    this._lastRefill = Date.now()
  }

  /** consomme `cost` jeton(s) ; false si le seau est vide (message à rejeter) */
  take(cost = 1): boolean {
    this._refill()
    if (this._tokens < cost) return false
    this._tokens -= cost
    return true
  }

  /** rend `cost` jeton(s) pris par take(), jamais au-delà de la capacité */
  give(cost = 1): void {
    this._refill()
    this._tokens = Math.min(this._capacity, this._tokens + cost)
  }

  private _refill(): void {
    const now     = Date.now()
    const elapsed = (now - this._lastRefill) / 1000
    if (elapsed <= 0) return
    this._tokens     = Math.min(this._capacity, this._tokens + elapsed * this._refillPerSecond)
    this._lastRefill = now
  }
}

/** Minuteur d'inactivité — se réarme à chaque pet(), déclenche onTimeout si aucun pet() avant `ms`. `ms <= 0` = désactivé. */
export class Watchdog {
  private _timer: ReturnType<typeof setTimeout> | null = null

  constructor(private _ms: number, private _onTimeout: () => void) {}

  // appelé à chaque trame reçue : le minuteur existant est rafraîchi (`refresh()`, qui réarme aussi un
  // minuteur déjà déclenché) plutôt qu'un minuteur neuf créé par message
  pet(): void {
    if (this._ms <= 0) return
    if (this._timer) this._timer.refresh()
    else this._timer = setTimeout(this._onTimeout, this._ms)
  }

  stop(): void {
    if (this._timer) { clearTimeout(this._timer); this._timer = null }
  }
}

// kick au-delà de N drops de contre-pression CONSÉCUTIFS — constante fixe (pas
// dans `limits`, hors du contrat resolveé par index.ts) : au-delà, la connexion
// est jugée irrécupérable (le pair ne vide plus jamais son buffer).
export const MAX_CONSECUTIVE_DROPS = 50

// throttle des µ:error de dépassement de débit — UN message par fenêtre, pas un
// par trame jetée (sinon le throttle lui-même spamme le client en retour).
export const RATE_ERROR_THROTTLE_MS = 1000

// un dépassement de débit s'oublie après ce délai sans nouveau dépassement : seul un flot continu
// mène à l'expulsion (`limits.kickAfter`), plus la somme des débordements de toute une session
export const VIOLATIONS_FORGET_MS = 10000

/** true si le message DOIT être jeté (buffer du transport déjà trop plein). */
export function isBackpressured(bufferedAmount: number, maxBuffered: number): boolean {
  return bufferedAmount > maxBuffered
}

/** message lisible depuis un throw/reject quelconque (Error ou non). */
export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

// noms que porte Object.prototype au chargement de ce module (`constructor`, `toString`, `hasOwnProperty`, `__proto__`…), rangés
// par longueur : une clé ordinaire n'est comparée qu'aux noms de sa longueur, souvent à aucun (0 à 2 ns de plus par clé, mesuré)
const NOMS_DU_PROTOTYPE: string[][] = []
for (const nom of Object.getOwnPropertyNames(Object.prototype)) (NOMS_DU_PROTOTYPE[nom.length] ??= []).push(nom)

// range une donnée sous une clé venue du réseau (une identité, une clé de flux) dans un objet ordinaire que le serveur construit
// pour l'envoi : une clé au nom d'une propriété d'Object.prototype y est définie en propriété propre, jamais affectée —
// l'affectation `o['__proto__'] = v` changerait le prototype de l'objet au lieu d'y ranger la donnée, et `o['constructor'] = v`
// lève quand l'appli gèle Object.prototype (`Object.freeze`, `node --frozen-intrinsics`, `lockdown()` de SES). Aucun nom n'est
// écarté ici : le client qui reçoit ces objets trie seul, au plus près de son état, ce qu'il en garde (ses magasins réactifs
// refusent `__proto__`, `constructor` et `prototype`, cf. le piège de µ.state, runtime/mjs_state.ts). Inutile pour une Map
// (insensible à ce risque) ou un spread ({...a, ...b} : CreateDataProperty, pas le setter `__proto__`).
export function putOwn(o: Record<string, unknown>, k: string, v: unknown): void {
  const noms = NOMS_DU_PROTOTYPE[k.length]
  if (noms !== undefined && noms.includes(k)) Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true })
  else o[k] = v
}

// --- réglages numériques de mjsWs() — vérifiés à la construction (index.ts, sessions.ts) -----------------------

/** règle d'un réglage numérique — cf. checkSetting */
export type MjsWsSettingRule = 'nombre' | 'plafond' | 'entier'

const ATTENDU: Record<MjsWsSettingRule, MsgKey> = {
  nombre:  'ws.index.nombre-positif-ou-nul',
  plafond: 'ws.index.nombre-positif-ou-nul-ou-null',
  entier:  'ws.index.entier-positif',
}

/** une valeur fausse telle que le message la montre — NaN et Infinity tels quels (JSON.stringify les écrirait `null`) */
export function showSetting(v: unknown): string {
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  try { return JSON.stringify(v) ?? String(v) }
  catch { return String(v) }
}

/**
 * Vérifie un réglage numérique de mjsWs() (`limits.*`, `heartbeat`, `token.*`, `resume.*`) et lève tout de suite, en
 * clair, sur une valeur fausse : NaN (une variable d'environnement absente passée à Number()), négatif, infini ou
 * mauvais type coupaient sinon la protection en silence (seau à jetons, borne de taille, chien d'inactivité).
 * `'nombre'` : nombre fini ≥ 0 ; `'plafond'` : le même, ou `null` (illimité) ; `'entier'` : entier ≥ 1. `undefined`
 * (réglage absent) reste à l'appelant : c'est le défaut.
 */
export function checkSetting(cle: string, v: unknown, regle: MjsWsSettingRule): void {
  if (regle === 'plafond' && v === null) return
  const ok = typeof v === 'number' && Number.isFinite(v) && (regle === 'entier' ? Number.isInteger(v) && v >= 1 : v >= 0)
  if (!ok) throw new Error(t('ws.index.reglage-invalide', { cle, raw: showSetting(v), attendu: t(ATTENDU[regle]) }))
}
