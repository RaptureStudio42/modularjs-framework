// mjs-ws/comptes — paquet COMPTES & IDENTITÉS v1. MÊME patron que packages.ts::paquetEcho et
// chat.ts::chatPackage (definirPaquet + installer composé SUR l'API PUBLIQUE app.serve — jamais par
// accès à l'interne de core.ts) : accountsPackage(opts) déclare 3 trames (préfixe `account:`)
// utilisables APRÈS un hello anonyme, pour qu'une appli MJS autonome (SANS back Rails) puisse créer
// des comptes, se connecter, rester connectée — et que les AUTRES paquets (chat/jeu/lobby) reçoivent
// une identité STABLE + des rôles.
//
//   import { mjsWs, accountsPackage, accountsAuth } from 'modularjs-framework/ws'
//   const SECRET = process.env.MJS_COMPTES_SECRET!
//   app = mjsWs({ auth: accountsAuth(SECRET) })   // PAS jwtAuth(SECRET) nu — cf. « Élévation » ci-dessous
//   app.use(accountsPackage({ secret: SECRET }))
//   await app.listen()
//
// Protocole (préfixe 'account:' — simple CONVENTION de nommage, comme 'chat:', PAS une réservation
// façon µgame:) — utilisable dès le hello anonyme (aucun `auth` requis à la CONNEXION) :
//   account:create       CLIENT→SERVEUR (requête, µ:ack)  { pseudo, secret }  → { ok, jeton } (création
//                       + connexion immédiate) ; refus : 'account-name-invalid' (format), 'account-
//                       secret-short' (< 8), 'account-name-taken' (unicité, casse-insensible — donnée
//                       seulement APRÈS la limite de contrôles par IP, cf. « Anti-DoS création »),
//                       'account-throttled' (limite de contrôles PAR IP, ou seau anti-DoS PAR IP épuisé
//                       juste avant le hachage scrypt, cf. « Anti-DoS création » plus bas — durci : accessible
//                       en hello ANONYME + scrypt coûteux, aucune limite jusque-là), 'account-limit-reached'
//                       (opts.maxComptes atteint), 'account-load-failed' (chargement initial des
//                       comptes déjà persistés en échec — rien créé, retenté au prochain appel).
//   account:login   CLIENT→SERVEUR (requête, µ:ack)  { pseudo, secret }  → { ok, jeton } ; refus
//                       'account-denied' (message IDENTIQUE pseudo inexistant OU secret faux OU secret
//                       qui n'est pas une chaîne — jamais d'énumération de comptes) ; 'account-throttled'
//                       (budget d'échecs épuisé, ou réservé par des essais en vol).
//   account:logout CLIENT→SERVEUR (requête, µ:ack)  {}  → { ok: true } — ferme la connexion
//                       authentifiée courante (cf. « Déconnexion » plus bas), no-op sur une identité
//                       déjà anonyme.
//
// Élévation invité→compte — `account:create`/`account:login` ne font que MINTER un jeton
// (signToken, cf. token.ts) : un paquet n'a AUCUN moyen d'écrire `client.identity` directement
// (lecture seule dans l'API publique MjsWsClient, cf. core.ts). L'élévation RÉELLE de la connexion
// N'EST PAS `µ:refresh`/`sock.refresh(jeton)`, contrairement à l'intuition de départ :
// `handleRefresh` (core.ts) réinvoque `authFn` mais REFUSE tout changement
// d'`identityIdOf` — passer d'anonyme (aucun `id`) à un compte (`id` généré) EST un tel changement,
// donc TOUJOURS `refresh-denied`, quel que soit le jeton (invariant « une session ne change jamais
// d'identité en vol », core.ts). L'élévation passe donc par une
// RECONNEXION contrôlée côté client (`sock.close()` + `sock.connect()` avec le jeton en `auth`) —
// un hello FRAIS n'a AUCUNE identité antérieure à comparer, cf. `src/runtime/mjs_accounts.ts`
// (`sock.account`, fonction `_compteElever`) qui l'orchestre. Ce qui NE change PAS : `opts.secret`
// DOIT être le MÊME secret que celui donné à `mjsWs({ auth })` (le hello, lui, vérifie bien le
// jeton via `authFn`) ; `jwtAuth(secret)` NU refuserait la connexion anonyme elle-même (renvoie
// `false` pour tout hello SANS jeton) — cf. `accountsAuth(secret)` ci-dessous, le wrapper qui
// autorise l'anonyme ET vérifie le jeton compte quand il est présent.
//
// Déconnexion — v1 sans état (jetons JWT sans dépendance, cf. token.ts) : il n'existe PAS de liste de
// révocation par jeton (aucun `jti`, aucun magasin de sessions à sa taille). `account:logout` fait
// donc la seule chose RÉELLEMENT révocable en v1 : fermer la connexion authentifiée courante
// (`client.close`, APRÈS l'envoi de l'accusé — jamais avant, cf. son commentaire) — l'identité élevée
// ne survit donc jamais à la fermeture. Le CLIENT (mjs_accounts.ts) purge son jeton local en parallèle :
// une reconnexion ultérieure repart anonyme (sous réserve qu'aucune AUTRE copie du jeton ne traîne
// ailleurs — onglet/appareil distinct —, cf. docs/27-accounts.md « Limites »).
//
// Persistance — CONTRAT PROPRE à ce fichier (`MjsWsAccountsPersistAdapter`), PAS un réemploi de
// `mjs-server/persist.ts` : ce dernier est typé 1:1 sur `MjsServerPartieSnapshot` (état de PARTIE,
// cf. son en-tête) — l'importer aurait entraîné tout le module jeu (matchmaking/partie) pour un
// enregistrement de compte SANS RAPPORT. MÊME FORME duck-typée (load/save/remove/flush?), MÊME
// philosophie (mémoire fournie ICI comme défaut dev, adaptateurs réels — fichier ICI, Redis/SQL/pont
// HTTP maison — au choix de l'appli hôte) : cf. docs/27-accounts.md.
//
// Anti-force-brute — seau d'échecs PAR ADRESSE (capacité `bruteForce` ; une IPv6 compte pour tout son
// préfixe /56, cf. `ipDe`) et budget PAR PSEUDO toutes adresses confondues (la même capacité), MÊME
// PATRON que mjs-ws/bridge.ts (createBridgeRateLimiter) mais COPIÉ plutôt qu'importé : bridge.ts est le
// pont HTTP (pas une dépendance saine pour un paquet WS pur). Budget du pseudo dépensé, il ne ferme pas
// le compte à tous : une adresse qui a déjà raté ce compte pendant la fenêtre est arrêtée, une adresse
// qui n'a encore rien raté essaie encore, une fois (`failuresByPair` ; une IPv6 compte alors pour tout son /48, cf.
// `reseauDe`) — des échecs envoyés d'ailleurs ne verrouillent donc jamais le titulaire qui se connecte depuis une
// adresse propre, et tout un /48 ne gagne qu'un essai par minute sur un compte dont le budget est dépensé. Seul un plafond
// dur par pseudo, dix fois plus haut, arrête une attaque répartie sur beaucoup d'adresses (et tout le
// monde avec elle tant qu'il est atteint). Chaque essai RÉSERVE sa place dans chaque budget AVANT tout
// calcul de hachage — y compris le hachage FACTICE anti-énumération ci-dessous : des essais lancés en
// parallèle ne passent jamais tous le contrôle avant que le premier échec ne soit compté, et un essai
// au-delà du budget n'a payé aucun hachage (cf. FailureBucket::reserve).
//
// Anti-DoS création (durci : `account:create` n'avait AUCUNE limite
// de débit jusque-là, alors qu'il est accessible en hello ANONYME et déclenche le MÊME scrypt coûteux
// que ci-dessus : DoS CPU + croissance mémoire/disque non bornée depuis une seule IP) — seau SÉPARÉ
// (`createFailuresByIp`, MÊME classe FailureBucket, jamais partagé avec `failuresByIp`/`failuresByName`
// ci-dessus), clé = IP SEULE (le pseudo diffère à CHAQUE tentative pour un attaquant qui en génère
// des nouveaux, une clé pseudo ne contiendrait donc rien). `recordFailure` est appelé JUSTE AVANT
// le calcul scrypt, APRÈS les refus bon marché (format/unicité, AUCUN hachage) : ceux-ci ne consomment
// PAS le seau, seule une tentative qui atteindrait le hachage compte — exactement le chemin visé par
// le défaut (DoS CPU via scrypt), sans pénaliser un client qui enchaîne des essais de format invalide
// (ex. validation côté formulaire). La tentative qui fait déborder le seau n'a donc payé AUCUN
// hachage. Clé de repli 'inconnue' si l'IP n'est pas exposée par le transport (cf. `ipDe`) — jamais
// un accès non limité. Défaut CONSERVATEUR (création = action rare, plus stricte que forceBrute car
// scrypt coûte plus cher qu'une comparaison) : cf. `DEFAULT_CREATION_CAPACITY`/`opts.creationParIp`.
// La réponse « pseudo déjà pris », elle, dirait gratuitement qu'un compte existe : elle ne se donne
// qu'après une limite de contrôles PAR IP (`nameChecksByIp`, `opts.nameCheckPerIp`), que chaque
// demande arrivée au contrôle d'unicité consomme, pseudo pris ou libre ; une IP déjà arrêtée par le
// seau de création reçoit 'account-throttled' quel que soit le pseudo.
//
// Secret — hachage scrypt de Node (crypto.scrypt, sel aléatoire PAR COMPTE, comparaison
// timingSafeEqual) — AUCUNE dépendance externe (MÊME ethos que token.ts), AUCUN secret en clair
// nulle part (ni logs, ni erreurs, ni le jeton lui-même qui ne porte que id/pseudo/roles).

import { randomBytes, scrypt } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { MjsWsClient, MjsWsHelloPayload, MjsWsLogFn } from './core.js'
import { definePackage } from './packages.js'
import type { MjsPackage } from './packages.js'
import { signToken, jwtAuth, checkClaimList, checkOptionKeys } from './token.js'
import type { VerifyTokenOpts } from './token.js'
import { identityIdOf } from './sessions.js'
import { addressForLimits, ipv6Prefix, normalizeRemoteAddress } from './transport.js'
import { defaultLogOf, safeEqual } from './package-helpers.js'
import type { MjsWsRemoteInfo } from './transport.js'
import { isIP } from 'node:net'
import { t } from '../messages/index.js'

// --- l'enregistrement compte ------------------------------------------------------------------

/** Un compte persisté — `hash`/`sel` ne quittent JAMAIS ce process (ni jeton, ni log, ni erreur). */
export interface MjsWsAccountRecord {
  /** stable, généré une fois pour toutes (cf. genId) — c'est CET id qui porte l'identité STABLE
   *  dans le jeton (élévation, sessionExclusive, quotas par identité — cf. tête de fichier). */
  id: string
  /** casse D'ORIGINE conservée (affichage) — unicité comparée EN MINUSCULES (cf. byName). */
  name: string
  /** scrypt(secret, sel) avec ses réglages, `$scrypt$ln=15,r=8,p=3$<hex>` — hex nu : réglages de Node par défaut
   *  (compte écrit avant que les réglages ne soient enregistrés, refait à sa connexion suivante) */
  hash: string
  /** sel aléatoire PAR COMPTE, hex */
  salt: string
  roles: string[]
  /** ms epoch — création */
  createdAt: number
  /** ms epoch — dernière connexion réussie (account:login) */
  seenAt: number
  /** libre — jamais interprété ici, extension applicative (cf. `opts.roles`) */
  meta: Record<string, unknown>
}

// --- le contrat de persistance (duck-typing STRICT, MÊME esprit que mjs-server/persist.ts — cf.
// tête de fichier pour le POURQUOI d'un contrat séparé plutôt qu'un réemploi) --------------------
//   load()            → Promise<MjsWsAccountRecord[]> — lu UNE FOIS, paresseusement, avant la
//                        première trame compte:* traitée (cf. assurerCharge plus bas)
//   save(id, compte)  → void | Promise<void> — écrit/remplace l'entrée, jamais attendue par le
//                        client (l'ack part dès que le jeton est signé, cf. accountsPackage)
//   remove(id)        → void | Promise<void> — aucune trame v1 ne l'appelle (pas de suppression de
//                        compte au protocole) ; présente pour la SYMÉTRIE du contrat et un usage
//                        direct par l'appli hôte (outillage admin), cf. docs/27-accounts.md « Limites »
//   flush()?          → void | Promise<void> — optionnel, jamais appelée par ce fichier (aucune
//                        notion d'arrêt de paquet — contrairement à mjs-server/persist.ts, un paquet
//                        n'a pas de cycle de vie stop() propre, cf. packages.ts)

export interface MjsWsAccountsPersistAdapter {
  load(): Promise<MjsWsAccountRecord[]>
  save(id: string, account: MjsWsAccountRecord): void | Promise<void>
  remove(id: string): void | Promise<void>
  flush?(): void | Promise<void>
}

// --- adaptateur mémoire (défaut) — DEV SEULEMENT, cf. accountsPackage (avertissement au boot) ----

export class MemoryAccountsPersistAdapter implements MjsWsAccountsPersistAdapter {
  private _store = new Map<string, MjsWsAccountRecord>()

  async load(): Promise<MjsWsAccountRecord[]> { return Array.from(this._store.values()) }
  save(id: string, account: MjsWsAccountRecord): void { this._store.set(id, account) }
  remove(id: string): void { this._store.delete(id) }
  flush(): void {}
}

// --- adaptateur fichier réel — MÊME technique que mjs-server/persist-file.ts (écriture ATOMIQUE
// tmp+rename, tolérance aux fichiers corrompus, suffixe tmp ALÉATOIRE), adaptée à
// MjsWsAccountRecord (fichier `<id>.json` par compte) — cf. son en-tête pour le détail des garanties
// (ENOENT idempotent, mkdir jamais réessayé si rejeté, PAS de WAL v1) : mêmes limites assumées ici. --

export interface FileAccountsPersistAdapterOpts {
  /** dossier de stockage — créé (récursif) s'il n'existe pas encore */
  dir: string
  /** défaut : console, préfixe '[mjs-ws:accounts:file]' */
  onLog?: MjsWsLogFn
}

const defaultLog     = defaultLogOf('accounts')
const fileDefaultLog = defaultLogOf('accounts:file')

function estENOENT(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
}

export class FileAccountsPersistAdapter implements MjsWsAccountsPersistAdapter {
  private _dir: string
  private _onLog: MjsWsLogFn
  private _pret: Promise<void>
  private _inFlight = new Set<Promise<void>>()

  constructor(opts: FileAccountsPersistAdapterOpts) {
    if (!opts.dir) throw new Error(t('ws.accounts.dir-manquant'))
    this._dir   = opts.dir
    this._onLog = opts.onLog ?? fileDefaultLog
    this._pret  = mkdir(this._dir, { recursive: true }).then(() => {})
  }

  private _chemin(id: string): string { return join(this._dir, id + '.json') }

  async load(): Promise<MjsWsAccountRecord[]> {
    await this._pret
    let fichiers: string[]
    try { fichiers = await readdir(this._dir) } catch { return [] }
    const résultats: MjsWsAccountRecord[] = []
    for (const fichier of fichiers) {
      if (!fichier.endsWith('.json') || fichier.endsWith('.tmp.json')) continue   // '.tmp.json' termine aussi par '.json' — l'exclusion doit passer en second
      try {
        const brut   = await readFile(join(this._dir, fichier), 'utf8')
        const account = JSON.parse(brut) as MjsWsAccountRecord
        résultats.push(account)
      } catch (err) {
        this._onLog('warn', t('ws.accounts.fichier-corrompu-ignore', { fichier }), { err: err instanceof Error ? err.message : String(err) })
      }
    }
    return résultats
  }

  // rend la promesse d'écriture — AVANT, `void` strict : un échec (disque plein, dossier
  // interdit…) était avalé par _ecrireAtomique et invisible du caller direct, `account-persist-
  // failed` (cf. accounts.ts, account:create) ne pouvait donc jamais se déclencher avec cet
  // adaptateur. `_suivre` reste le filet de sécurité (cf. son commentaire) pour un appelant qui
  // n'attendrait pas ce retour (usage admin direct de l'adaptateur, hors protocole).
  save(id: string, account: MjsWsAccountRecord): Promise<void> {
    const p = this._ecrireAtomique(id, account)
    this._suivre(p, `save('${id}')`)
    return p
  }

  remove(id: string): void {
    const p = unlink(this._chemin(id)).catch((err) => {
      if (estENOENT(err)) return
      this._onLog('warn', t('ws.accounts.remove-echoue', { id }), { err: err instanceof Error ? err.message : String(err) })
    })
    this._suivre(p, `remove('${id}')`)
  }

  async flush(): Promise<void> {
    await Promise.allSettled(Array.from(this._inFlight))
  }

  private _suivre(p: Promise<void>, label: string): void {
    this._inFlight.add(p)
    p.catch(err => this._onLog('warn', t('ws.accounts.rejet-non-intercepte', { label }), { err: err instanceof Error ? err.message : String(err) }))
      .finally(() => this._inFlight.delete(p))
  }

  private async _ecrireAtomique(id: string, account: MjsWsAccountRecord): Promise<void> {
    const tmp = join(this._dir, id + '.' + randomBytes(4).toString('hex') + '.tmp.json')
    try {
      await this._pret
      await writeFile(tmp, JSON.stringify(account))
      await rename(tmp, this._chemin(id))
    } catch (err) {
      this._onLog('warn', t('ws.accounts.save-echoue', { id }), { err: err instanceof Error ? err.message : String(err) })
      await unlink(tmp).catch(() => {})
      throw err   // propage — cf. save() ci-dessus, sans ce throw l'échec restait invisible du caller
    }
  }
}

// --- scrypt (secret de compte) — clé dérivée 64 octets, réglages écrits avec chaque hachage --------
// `$scrypt$ln=15,r=8,p=3$<hex>` (N = 2^ln). Réglages actuels : N = 2^15, r = 8, p = 3, une des combinaisons conseillées
// par l'OWASP — 32 Mio de mémoire par calcul (N = 2^17, p = 1, en demanderait 128, à multiplier par les connexions
// simultanées). Un hachage hexadécimal nu (compte écrit avant que les réglages ne soient enregistrés) vaut les réglages
// de Node par défaut (N = 2^14, r = 8, p = 1) : il se vérifie tel quel et se refait aux réglages actuels à la première
// connexion réussie (cf. verifierSecret). Coût réduit des essais (option `weakHashForTests`, jamais par défaut) : N = 2^10,
// r = 8, p = 1, le plus bas que readHash relise, environ cent fois moins de calcul — une suite qui crée des comptes en rafale
// tient sur une machine chargée

interface ScryptSettings { ln: number; r: number; p: number }

const SCRYPT_KEYLEN                  = 64
const SCRYPT_CURRENT: ScryptSettings = { ln: 15, r: 8, p: 3 }
const SCRYPT_LEGACY: ScryptSettings  = { ln: 14, r: 8, p: 1 }
const SCRYPT_TESTS: ScryptSettings   = { ln: 10, r: 8, p: 1 }
const SCRYPT_FORMAT                  = /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([0-9a-f]+)$/
// réglages lus avec un hachage : au plus un cran au-dessus de ceux qu'écrit le framework — N ≤ 2^16, r ≤ 8, p ≤ 4 —, et un coût
// total (N·r·p) d'au plus deux connexions aux réglages actuels ; scrypt exige en outre N < 2^(16·r). Au-delà, un enregistrement
// modifié à la main ou abîmé demanderait un calcul démesuré, ou que scrypt refuse : refus ordinaire
const SCRYPT_MAX_LN   = 16
const SCRYPT_MAX_R    = 8
const SCRYPT_MAX_P    = 4
const SCRYPT_MAX_COST = 2 * 2 ** SCRYPT_CURRENT.ln * SCRYPT_CURRENT.r * SCRYPT_CURRENT.p

function hacherSecret(secret: string, salt: Buffer, settings: ScryptSettings = SCRYPT_CURRENT): Promise<string> {
  const N = 2 ** settings.ln
  return new Promise((resolve, reject) => {
    // maxmem : 128·N·r octets de travail, plus que le plafond par défaut de Node (32 Mio) dès N = 2^15
    scrypt(secret, salt, SCRYPT_KEYLEN, { N, r: settings.r, p: settings.p, maxmem: 2 * 128 * N * settings.r }, (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey.toString('hex'))
    })
  })
}

function writeHash(settings: ScryptSettings, key: string): string {
  return '$scrypt$ln='+ settings.ln +',r='+ settings.r +',p='+ settings.p +'$'+ key
}

// hachage enregistré → ses réglages et sa clé ; réglages illisibles ou démesurés → null
function readHash(hash: string): { settings: ScryptSettings; key: string } | null {
  if (hash.charAt(0) !== '$') return { settings: SCRYPT_LEGACY, key: hash }
  const m = SCRYPT_FORMAT.exec(hash)
  if (!m) return null
  const settings = { ln: Number(m[1]), r: Number(m[2]), p: Number(m[3]) }
  if (settings.ln < 10 || settings.ln > SCRYPT_MAX_LN || settings.r < 1 || settings.r > SCRYPT_MAX_R || settings.p < 1 || settings.p > SCRYPT_MAX_P) return null
  if (settings.ln >= 16 * settings.r || 2 ** settings.ln * settings.r * settings.p > SCRYPT_MAX_COST) return null
  return { settings, key: m[4] }
}

// sel FIXE (jamais un compte réel) — hachage FACTICE d'un pseudo inexistant, MÊME coût CPU qu'un
// hachage réel : sans lui, répondre 'account-denied' pour un pseudo absent serait plus RAPIDE que
// pour un pseudo existant + mauvais secret — un oracle de timing qui révélerait l'existence d'un
// compte MALGRÉ le message identique (cf. tête de fichier « anti-énumération »).
const DUMMY_SALT = Buffer.from('0'.repeat(32), 'hex')

// vérifie `secret` contre le hachage du compte. Hachage aux réglages anciens : il est refait EN MÊME TEMPS aux réglages
// actuels, sur un sel neuf, et le nouveau n'est gardé (`redone`) que si le secret est le bon — la réponse prend le temps
// d'un calcul aux réglages actuels, comme pour un compte à jour ou un pseudo absent : l'âge d'un hachage ne se lit pas
// au chronomètre. Pseudo absent ou hachage illisible : hachage FACTICE de même coût (cf. DUMMY_SALT). `current` : réglages du
// paquet (coût réduit des essais sous `weakHashForTests`), qui ne refait jamais un hachage enregistré plus faible
async function verifierSecret(secret: string, account: MjsWsAccountRecord | undefined, current: ScryptSettings = SCRYPT_CURRENT): Promise<{ ok: boolean; redone?: { hash: string; salt: string } }> {
  const stored = account ? readHash(account.hash) : null
  if (!account || !stored) {
    await hacherSecret(secret, DUMMY_SALT, current)
    return { ok: false }
  }
  const salt = Buffer.from(account.salt, 'hex')
  const s    = stored.settings
  if (s.ln === current.ln && s.r === current.r && s.p === current.p) {
    return { ok: safeEqual(await hacherSecret(secret, salt, s), stored.key, 'hex') }
  }
  if (current !== SCRYPT_CURRENT) {
    const essai = await hacherSecret(secret, salt, s).catch(() => null)
    return { ok: essai !== null && safeEqual(essai, stored.key, 'hex') }
  }
  const newSalt         = randomBytes(16)
  // réglages enregistrés que scrypt refuserait malgré les bornes de readHash : refus ordinaire, jamais le message d'OpenSSL,
  // au temps du calcul aux réglages actuels mené de front
  const [essai, refait] = await Promise.all([hacherSecret(secret, salt, s).catch(() => null), hacherSecret(secret, newSalt)])
  if (essai === null || !safeEqual(essai, stored.key, 'hex')) return { ok: false }
  return { ok: true, redone: { hash: writeHash(SCRYPT_CURRENT, refait), salt: newSalt.toString('hex') } }
}

// --- anti-force-brute — seau d'échecs PAR CLÉ (IP ou pseudo), MÊME PATRON que
// mjs-ws/bridge.ts::createBridgeRateLimiter (copié — cf. tête de fichier pour le pourquoi d'un
// import évité) : seau à jetons au même calcul que TokenBucket (guard.ts), tenu ici parce que la
// réservation doit lire le solde (TokenBucket n'expose que `take`), verrou `blockedUntil` posé quand
// le budget est dépassé, éviction PARESSEUSE bornée (Map ordonnée par dernier accès). -----

const ECHEC_ENTRY_TTL_MS = 10 * 60 * 1000   // entrée intacte depuis > 10 min → purgée au passage
const ECHEC_SWEEP_MAX    = 8                // borne le coût d'un passage

interface EchecEntry { tokens: number; refilledAt: number; reserved: number; blockedUntil: number; lastSeen: number }

/**
 * Seau d'échecs — `isBlocked(cle)` / `recordFailure(cle)`, et `reserve(cle)` / `release(cle, échec)`
 * autour d'une vérification asynchrone. EXPORTÉE pour ses propres tests
 * unitaires (isolation de deux clés indépendantes) — MÊME raison que `TokenBucket` (guard.ts) :
 * une isolation IP-vs-pseudo n'est pas observable de bout en bout via MemoryTransport, qui n'expose
 * jamais d'adresse distincte en test (cf. tests/mjs-ws-accounts.test.ts pour le détail).
 */
export class FailureBucket {
  private _map = new Map<string, EchecEntry>()

  constructor(private _capacity: number, private _windowMs: number) {}

  private _touch(key: string, now: number): EchecEntry {
    let evicted = 0
    for (const [k, e] of this._map) {
      if (now - e.lastSeen <= ECHEC_ENTRY_TTL_MS) break   // Map ordonnée par ancienneté d'accès — le reste est plus récent
      this._map.delete(k)
      if (++evicted >= ECHEC_SWEEP_MAX) break
    }
    let entry = this._map.get(key)
    if (entry) {
      entry.lastSeen = now
      this._map.delete(key); this._map.set(key, entry)   // ré-insère en fin — ordre = ancienneté de dernier accès
    } else {
      entry = { tokens: this._capacity, refilledAt: Date.now(), reserved: 0, blockedUntil: 0, lastSeen: now }
      this._map.set(key, entry)
    }
    return entry
  }

  // jetons regagnés depuis le dernier passage — même calcul que TokenBucket::_refill (guard.ts)
  private _refill(entry: EchecEntry): void {
    const t       = Date.now()
    const elapsed = t - entry.refilledAt
    if (elapsed <= 0) return
    entry.tokens     = Math.min(this._capacity, entry.tokens + elapsed * this._capacity / this._windowMs)
    entry.refilledAt = t
  }

  /** true = clé actuellement en pénalité (trop d'échecs récents, verrouillée par un appel PRÉCÉDENT
   *  à `recordFailure` ou `reserve`) → refus immédiat, AUCUN calcul de hachage pour cette requête. */
  isBlocked(key: string, now = Date.now()): boolean { return now < this._touch(key, now).blockedUntil }

  /**
   * À appeler après un échec CONFIRMÉ — verrouille `windowMs` si le budget déborde, MÊME mécanique
   * que bridge.ts::recordFailure. Retourne `true` = encore DANS le budget (capacité RESTAIT > 0 avant
   * CET appel) ; `false` = ce même appel VIENT de faire déborder le seau : l'APPELANT reclasse alors
   * sa propre réponse en refus de débit. Compté APRÈS coup, il ne borne pas des essais lancés en
   * parallèle : une vérification asynchrone passe par `reserve`/`release`.
   */
  recordFailure(key: string, now = Date.now()): boolean {
    const entry = this._touch(key, now)
    this._refill(entry)
    const within = entry.tokens >= 1
    if (within) entry.tokens -= 1
    else entry.blockedUntil = now + this._windowMs
    return within
  }

  /**
   * Réserve une place du budget AVANT une vérification asynchrone (hachage) : des essais simultanés
   * ne passent jamais tous le contrôle avant que le premier échec ne soit compté. `false` = refus :
   * clé en pénalité, budget dépensé par des échecs (verrou de `windowMs`, comme `recordFailure`), ou
   * places restantes déjà prises par des essais en vol (sans verrou — ils peuvent réussir). Toute
   * réservation accordée se rend par UN appel à `release`.
   */
  reserve(key: string, now = Date.now()): boolean {
    const entry = this._touch(key, now)
    if (now < entry.blockedUntil) return false
    this._refill(entry)
    if (entry.tokens < 1) {
      entry.blockedUntil = now + this._windowMs
      return false
    }
    if (entry.tokens - entry.reserved < 1) return false
    entry.reserved++
    return true
  }

  /** Rend une place prise par `reserve` — `failed` : l'essai a échoué, sa place devient un échec compté. */
  release(key: string, failed: boolean, now = Date.now()): void {
    const entry = this._map.get(key)
    if (entry && entry.reserved > 0) entry.reserved--
    if (failed) this.recordFailure(key, now)
  }

  /** nombre de clés actuellement suivies — tests d'éviction uniquement. */
  get size(): number { return this._map.size }
}

// --- rôles — helper exporté, utilisable par les hooks des AUTRES paquets (ex. chat.moderateurs) --

/** `hasRole(identity, 'admin')` — `identity` = `client.identity` (duck-typé `{roles: string[]}`,
 *  forme posée par le jeton compte, cf. emettreJeton) : `false` pour toute forme inattendue, jamais
 *  un throw (identité anonyme, jeton d'un AUTRE mécanisme sans `roles`…). */
export function hasRole(identity: unknown, role: string): boolean {
  if (!identity || typeof identity !== 'object') return false
  const roles = (identity as Record<string, unknown>).roles
  return Array.isArray(roles) && roles.includes(role)
}

// --- validation pseudo ---------------------------------------------------------------------------
// 3-24 caractères, [a-z0-9_-] — `i` (insensible à la casse) : la casse D'ORIGINE reste acceptée et
// conservée pour l'affichage (cf. MjsWsAccountRecord.pseudo), seule la comparaison d'UNICITÉ est
// systématiquement faite en minuscules (cf. accountsPackage, byName).

const PSEUDO_RE = /^[a-z0-9_-]{3,24}$/i

function isValidName(name: unknown): name is string {
  return typeof name === 'string' && PSEUDO_RE.test(name)
}

// enregistrement relu par `persist.load()` — sans ces quatre chaînes (`{}`, champ renommé, édition à
// la main), l'indexer ferait échouer tout le chargement, et `account:create` avec lui, pour toujours
function isReadableRecord(c: unknown): c is MjsWsAccountRecord {
  if (!c || typeof c !== 'object') return false
  const r = c as Record<string, unknown>
  return typeof r.id === 'string' && typeof r.name === 'string' && typeof r.hash === 'string' && typeof r.salt === 'string'
}

// --- options ---------------------------------------------------------------------------------

export interface MjsWsAccountsOptions {
  /**
   * Secret HMAC des jetons de compte (signToken/token.ts) — DOIT être IDENTIQUE au secret donné à
   * `accountsAuth(secret)` posé en `mjsWs({ auth })` (cf. tête de fichier « Élévation ») : sans ce
   * jumelage, le hello de la RECONNEXION d'élévation (cf. `_compteElever`, mjs_accounts.ts) sera
   * TOUJOURS refusé (`µ:denied`), même après un `account:create`/`account:login` réussi — le
   * jeton fraîchement signé ne serait vérifiable par PERSONNE côté serveur. Requis — AUCUN défaut
   * (un secret par défaut serait une faille, cf. token.ts/bridge.ts, même exigence).
   */
  secret: string
  /** Stockage des comptes — défaut : `MemoryAccountsPersistAdapter` (DEV SEULEMENT, avertit au
   *  boot) ; `FileAccountsPersistAdapter`/adaptateur maison pour la prod, cf. docs/27-accounts.md. */
  persist?: MjsWsAccountsPersistAdapter
  /** Durée de vie du jeton émis, SECONDES (défaut 7 jours = 604800). */
  ttl?: number
  /** Site(s) pour lequel les jetons émis sont faits, posé en `aud` : une chaîne reste une chaîne, une liste part telle
   *  quelle (un `aud` peut être une liste). À donner AUSSI à `accountsAuth(secret, { audience })`, qui le vérifie : un
   *  jeton d'un autre site qui partage le même secret est alors refusé. Absent = jetons sans `aud`, comme avant. */
  audience?: string | string[]
  /** Émetteur des jetons émis, posé en `iss` ; une liste part par sa première valeur (un `iss` est une seule chaîne).
   *  À donner AUSSI à `accountsAuth(secret, { issuer })`. Absent = jetons sans `iss`, comme avant. */
  issuer?: string | string[]
  /** Enrichit/recalcule les rôles portés par le jeton à CHAQUE émission (creer ET connecter) — reçoit
   *  l'enregistrement PERSISTÉ (roles/meta inclus), retourne la liste EFFECTIVE du jeton. Absent =
   *  `compte.roles` tel que persisté. Cf. `hasRole` pour la lecture côté hooks (chat.moderateurs…). */
  roles?(account: MjsWsAccountRecord): string[] | Promise<string[]>
  /** Anti-force-brute (account:login SEULEMENT — cf. tête de fichier) — défaut 5 échecs/minute PAR
   *  ADRESSE (une IPv6 compte pour son /56) et 5 PAR PSEUDO toutes adresses confondues : au-delà, une
   *  adresse déjà fautive sur ce pseudo est arrêtée, une adresse neuve a un essai (une IPv6 : un par /48) ; dix fois `capacity`
   *  par pseudo ferment le compte à tous (cf. FailureBucket). */
  bruteForce?: { capacity?: number; windowMs?: number }
  /** Anti-DoS création (account:create SEULEMENT, PAR IP — cf. tête de fichier « Anti-DoS création »,
   *  durci) — défaut CONSERVATEUR, 3 créations/minute/IP (seau
   *  SÉPARÉ de `forceBrute`, MÊME mécanisme FailureBucket). */
  createPerIp?: { capacity?: number; windowMs?: number }
  /** Anti-énumération (account:create SEULEMENT, PAR IP — cf. tête de fichier « Anti-DoS création ») —
   *  défaut 10 contrôles de pseudo/minute/IP : chaque demande arrivée au contrôle d'unicité en
   *  consomme un, pseudo pris ou libre ; au-delà, 'account-throttled' AVANT toute réponse « pseudo
   *  déjà pris ». */
  nameCheckPerIp?: { capacity?: number; windowMs?: number }
  /** Plafond OPTIONNEL du nombre TOTAL de comptes — au-delà, account:create refuse avec
   *  'account-limit-reached'. Absent = illimité (v1 par défaut, comportement historique). */
  maxAccounts?: number
  /** ESSAIS SEULEMENT — `true` hache les secrets à un coût réduit (scrypt N = 2^10, r = 8, p = 1, environ cent fois moins de
   *  calcul) pour qu'une suite de tests qui crée des comptes en rafale tienne sur une machine chargée. Jamais en production : un
   *  tel hachage se casse d'autant plus vite. Sous l'option, un hachage déjà enregistré se vérifie tel quel et n'est jamais
   *  refait plus faible. Un avertissement le rappelle au démarrage, une fois par paquet (`onLog`, sinon la console). Absent ou
   *  toute autre valeur que `true` : coût de production (N = 2^15, r = 8, p = 3). */
  weakHashForTests?: boolean
  /** défaut : console, préfixe '[mjs-ws:accounts]' (même sobriété que mjs-ws/index.ts defaultLog) */
  onLog?: MjsWsLogFn
}

const DEFAULT_TTL                    = 7 * 24 * 3600   // 7 jours, secondes (signToken attend un ttl en secondes)
const DEFAULT_FORCE_BRUTE_CAPACITY   = 5
const DEFAULT_FORCE_BRUTE_WINDOW_MS  = 60000            // 1 minute
const DEFAULT_CREATION_CAPACITY      = 3                // créations/IP/fenêtre — conservateur (scrypt coûteux, hello anonyme)
const DEFAULT_CREATION_WINDOW_MS     = 60000            // 1 minute
const DEFAULT_NAME_CHECK_CAPACITY    = 10               // contrôles de pseudo/IP/fenêtre — au-dessus du seau de création
const DEFAULT_NAME_CHECK_WINDOW_MS   = 60000            // 1 minute
const NAME_FAILURES_FACTOR           = 10               // plafond dur par pseudo, toutes adresses confondues = capacité × 10

// clés des options du paquet, dans l'ordre de MjsWsAccountsOptions — toute autre lève dès la construction, avec la plus
// proche en suggestion (cf. accountsPackage). Une option lue par le paquet s'ajoute ici : un test garde l'accord entre
// cette liste et les lectures `opts.…` d'accountsPackage
const ACCOUNTS_OPTION_KEYS: readonly string[] = ['secret', 'persist', 'ttl', 'audience', 'issuer', 'roles', 'bruteForce', 'createPerIp', 'nameCheckPerIp', 'maxAccounts', 'weakHashForTests', 'onLog']

// clé de seau-échecs d'un nom qui n'est pas une chaîne ou dépasse NOM_CLE_MAX — un SEUL panier partagé par tout
// payload malformé (pas d'explosion de clés ni de clé de 60 Ko, cf. ECHEC_SWEEP_MAX) ; le seau par adresse reste, lui,
// TOUJOURS discriminant (cf. ipDe) — un payload malformé n'échappe donc jamais à la limite de débit. La recherche du
// compte, elle, se fait sur le nom tel quel (cf. account:login)
const ECHEC_CLE_INVALIDE = '\0invalide'
// un nom plus court a sa propre clé, même hors du format des pseudos : un compte persisté par un adaptateur maison
// (base reprise d'un autre système : point, accent, adresse de courriel) a ses budgets comme les autres
const NOM_CLE_MAX = 254

// adresse qui compte pour les budgets PAR ADRESSE — une IPv6 compte pour tout son préfixe /56, comme pour toutes les
// limites par adresse du serveur (cf. transport.ts::addressForLimits)
function ipDe(client: MjsWsClient): string {
  return addressForLimits(client.meta.address) ?? 'inconnue'
}

// réseau d'une source neuve sur un compte dont le budget est dépensé (cf. failuresByPair) — une IPv6 compte pour tout
// son /48, qu'un tunnel donne gratuitement : ses 256 préfixes /56 ne valent qu'un essai
function reseauDe(client: MjsWsClient): string {
  const adresse = normalizeRemoteAddress(client.meta.address)
  if (adresse === undefined) return 'inconnue'
  return isIP(adresse) === 6 ? ipv6Prefix(adresse, 48) : adresse
}

/**
 * Complément : `opts.auth`
 * d'une appli qui veut « connexion anonyme, puis élévation » (cf. tête de fichier) ne peut PAS être
 * `jwtAuth(secret)` NU — `jwtAuth` renvoie `false` (donc `µ:denied`) pour TOUT hello SANS jeton, ce
 * qui rejetterait la connexion anonyme elle-même, avant même de pouvoir appeler `account:create`.
 * `accountsAuth(secret)` est le wrapper minimal qui manque : hello SANS jeton → `undefined` (identité
 * anonyme, MÊME valeur que le champ `client.identity` avant toute auth, cf. core.ts) ; hello (ou
 * µ:refresh) AVEC jeton → délégué tel quel à `jwtAuth(secret, opts)` (`false` si invalide/expiré/signature
 * fausse, ou refusé par `opts.audience`/`opts.issuer`/`opts.clockTolerance`, mêmes options que jwtAuth,
 * validées dès la construction). Sans lui, ce paquet n'est PAS branchable tel que documenté en tête de
 * fichier — cf. docs/27-accounts.md « Démarrer ».
 */
export function accountsAuth(secret: string, opts: VerifyTokenOpts = {}): (hello: MjsWsHelloPayload, meta: MjsWsRemoteInfo) => unknown {
  const verifier = jwtAuth(secret, opts)
  return (hello, meta) => {
    const raw   = hello?.auth as unknown
    const token = typeof raw === 'string' ? raw : (raw && typeof raw === 'object' ? (raw as { token?: unknown }).token : undefined)
    if (typeof token !== 'string' || token === '') return undefined   // pas de jeton — anonyme AUTORISÉ
    return verifier(hello, meta)
  }
}

/** types de trame servis par le paquet comptes — avec le battement et le rafraîchissement, les seuls ouverts à un
 *  visiteur sans compte accueilli d'une adresse au banc (core.ts, refuseAuBanc). Un type servi en plus par le paquet
 *  s'ajoute ici : un test garde l'accord entre cette liste et les `serve('account:…')` ci-dessous */
export const ACCOUNTS_TYPES: readonly string[] = Object.freeze(['account:create', 'account:login', 'account:logout'])

/**
 * Paquet COMPTES & IDENTITÉS — `app.use(accountsPackage(opts))` (cf. tête de fichier pour le
 * protocole complet + le mécanisme d'élévation). `opts.secret` est REQUISE — lève IMMÉDIATEMENT
 * (avant même `app.use`, jamais un démarrage à moitié fait) si absente/vide, MÊME esprit que
 * bridge.ts (secret manquant) et FilePersistAdapter (opts.dir manquant) ; une clé inconnue aussi,
 * avec la plus proche en suggestion, comme pour jwtAuth.
 */
export function accountsPackage(opts: MjsWsAccountsOptions): MjsPackage {
  // clé inconnue d'abord : mal écrite, elle passait sans un mot (`audiance` : jetons émis sans `aud`, que
  // accountsAuth(secret, { audience }) refusait ensuite en silence) ; `secrte` nomme ainsi `secret`, pas seulement son absence
  if (opts && typeof opts === 'object' && !Array.isArray(opts)) checkOptionKeys(opts, ACCOUNTS_OPTION_KEYS, 'accountsPackage')
  if (!opts || typeof opts.secret !== 'string' || opts.secret === '') {
    throw new Error(t('ws.accounts.secret-manquant'))
  }
  // site et émetteur posés dans les jetons émis (`aud`, `iss`) — mêmes validations que jwtAuth : une audience en liste
  // part telle quelle (verifyToken lit un `aud` en liste), un émetteur en liste part par sa première valeur (un `iss` est
  // une seule chaîne) ; sans ces options, les jetons ne changent pas
  const audiences = checkClaimList('audience', opts.audience, 'accountsPackage')
  const issuers   = checkClaimList('issuer', opts.issuer, 'accountsPackage')
  const claims: Record<string, unknown> = {}
  if (audiences) claims.aud = typeof opts.audience === 'string' ? opts.audience : audiences
  if (issuers) claims.iss = issuers[0]
  const onLog = opts.onLog ?? defaultLog
  const persist = opts.persist ?? new MemoryAccountsPersistAdapter()
  if (!opts.persist) {
    onLog('warn', t('ws.accounts.adaptateur-memoire-defaut'))
  }
  const ttl = opts.ttl ?? DEFAULT_TTL
  // coût du hachage des secrets : celui de la production, sauf `weakHashForTests: true` (essais seulement)
  const reglages = opts.weakHashForTests === true ? SCRYPT_TESTS : SCRYPT_CURRENT
  // l'option se voit : un avertissement au démarrage, une fois par paquet, par le journal du paquet (la console sans `onLog`)
  if (reglages === SCRYPT_TESTS) onLog('warn', t('ws.accounts.hachage-reduit-essais'))
  const forceBruteCapacity = opts.bruteForce?.capacity ?? DEFAULT_FORCE_BRUTE_CAPACITY
  const forceBruteWindowMs = opts.bruteForce?.windowMs ?? DEFAULT_FORCE_BRUTE_WINDOW_MS
  const failuresByIp     = new FailureBucket(forceBruteCapacity, forceBruteWindowMs)
  // budget d'un pseudo, toutes adresses confondues ; dépensé, seule une source sans échec récent sur ce pseudo essaie
  // encore, une fois (failuresByPair, par réseau : une IPv6 y compte pour son /48, cf. reseauDe) — des échecs venus
  // d'ailleurs ne verrouillent pas le titulaire (cf. tête de fichier)
  const failuresByName = new FailureBucket(forceBruteCapacity, forceBruteWindowMs)
  const failuresByPair = new FailureBucket(1, forceBruteWindowMs)
  // plafond dur d'une attaque répartie sur beaucoup d'adresses : au-delà, le compte est fermé à tous
  const nameCeiling    = new FailureBucket(forceBruteCapacity * NAME_FAILURES_FACTOR, forceBruteWindowMs)

  // anti-DoS création (account:create SEULEMENT, PAR IP — cf. tête de fichier « Anti-DoS création »)
  const creationCapacity = opts.createPerIp?.capacity ?? DEFAULT_CREATION_CAPACITY
  const creationWindowMs = opts.createPerIp?.windowMs ?? DEFAULT_CREATION_WINDOW_MS
  const createFailuresByIp = new FailureBucket(creationCapacity, creationWindowMs)
  // anti-énumération : contrôles de pseudo PAR IP, consommés AVANT la réponse « pseudo déjà pris »
  const nameChecksByIp = new FailureBucket(opts.nameCheckPerIp?.capacity ?? DEFAULT_NAME_CHECK_CAPACITY, opts.nameCheckPerIp?.windowMs ?? DEFAULT_NAME_CHECK_WINDOW_MS)

  // index EN MÉMOIRE pseudo(minuscule)→compte + id→compte, chargé PARESSEUSEMENT (1re trame
  // compte:* traitée) et tenu à jour à CHAQUE création — évite un load()/scan de l'adaptateur à
  // chaque tentative de connexion (cf. mjs-server/persist.ts, même esprit d'un index local devant
  // un adaptateur potentiellement lent/distant, ex. FileAccountsPersistAdapter/pont HTTP).
  const byName = new Map<string, MjsWsAccountRecord>()
  const byId     = new Map<string, MjsWsAccountRecord>()
  // pseudos RÉSERVÉS le temps d'une création EN COURS — consultée
  // EN PLUS de byName au contrôle d'unicité, posée AVANT l'await scrypt (cf. account:create) : sans
  // elle, deux créations concurrentes du MÊME pseudo passent TOUTES LES DEUX le contrôle synchrone
  // (race TOCTOU) et persistent chacune un compte distinct sous le même nom.
  const pendingNames = new Set<string>()
  // pseudos d'enregistrements relus mais illisibles (cf. assurerCharge) — consultée au contrôle
  // d'unicité : un compte abîmé qui porte encore son pseudo ne se reprend pas en recréant ce nom
  const damagedNames = new Set<string>()
  let charge: Promise<boolean> | null = null

  // rend `true` une fois les comptes déjà persistés chargés en mémoire, `false` si CET appel a
  // échoué (jamais un throw ici — account:login doit continuer à traiter le compte comme
  // introuvable, MÊME message qu'un pseudo absent, cf. tête de fichier « anti-énumération » ;
  // account:create, lui, lit ce retour et refuse explicitement, cf. plus bas).
  function assurerCharge(): Promise<boolean> {
    if (!charge) {
      charge = Promise.resolve(persist.load()).then(rows => {
        for (const c of rows) {
          if (isReadableRecord(c)) {
            byName.set(c.name.toLowerCase(), c); byId.set(c.id, c)
            continue
          }
          // écarté avec un avertissement, jamais bloquant ; son pseudo, s'il est lisible, reste pris —
          // ni hash ni sel au journal, seulement de quoi retrouver l'enregistrement
          const brut = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
          const name = typeof brut.name === 'string' ? brut.name : undefined
          if (name != null) damagedNames.add(name.toLowerCase())
          onLog('warn', t('ws.accounts.enregistrement-incomplet-ignore', { id: typeof brut.id === 'string' ? brut.id : '?' }), { name })
        }
        return true
      }).catch(err => {
        onLog('warn', t('ws.accounts.persist-load-echoue'), { err: err instanceof Error ? err.message : String(err) })
        // garde muette — SANS ça, `charge` restait posé (promesse
        // déjà réglée) même après un échec : une panne TRANSITOIRE (réseau, disque) rendait TOUS les
        // comptes déjà persistés invisibles à vie et autorisait des doublons de pseudo silencieux.
        // Retenté au PROCHAIN appel — jamais de retentative dans la foulée (pas de boucle serrée).
        charge = null
        return false
      })
    }
    return charge
  }

  // id de compte UNIQUE — revérifie `byId` (même patron que
  // sessions.ts::issue(), qui reboucle déjà tant que son registre connaît l'id tiré ; asymétrie
  // notée, collision négligeable en pratique à 64 bits d'aléa mais sans coût à
  // corriger). `draw` isolé en paramètre optionnel pour le SEUL test unitaire de la boucle — tout
  // appelant réel garde le tirage `randomBytes` par défaut, AUCUN changement de comportement.
  function genId(draw: () => string = () => randomBytes(8).toString('hex')): string {
    let id = draw()
    while (byId.has(id)) id = draw()
    return id
  }

  async function resoudreRoles(account: MjsWsAccountRecord): Promise<string[]> {
    return opts.roles ? await opts.roles(account) : account.roles
  }

  function emettreJeton(account: MjsWsAccountRecord, roles: string[]): string {
    return signToken({ id: account.id, name: account.name, roles, ...claims }, opts.secret, { ttl })
  }

  const pkg = definePackage('accounts', app => {

    app.serve('account:create', async (p, client) => {
      // le chargement initial DOIT avoir réussi avant toute création — sans ce refus, un load()
      // en échec laisse byName vide et la création se poursuit dessus : doublon de pseudo silencieux
      // dès que la panne se résorbe (cf. assurerCharge, `false` = CET appel a échoué). Rien n'est
      // créé, aucun index touché ; un appel ultérieur retente automatiquement le chargement.
      if (!(await assurerCharge())) throw new Error('account-load-failed')
      // le plafond compte aussi les réservations EN COURS (pendingNames) — sinon deux créations
      // concurrentes de pseudos DIFFÉRENTS passent toutes les DEUX ce contrôle synchrone avant que
      // l'une des deux n'ait eu le temps d'écrire dans byName (await scrypt derrière, cf. plus bas).
      if (opts.maxAccounts != null && (byName.size + pendingNames.size) >= opts.maxAccounts) throw new Error('account-limit-reached')
      const name = p?.name
      const secret = p?.secret
      if (!isValidName(name)) throw new Error('account-name-invalid')
      if (typeof secret !== 'string' || secret.length < 8) throw new Error('account-secret-short')
      // anti-énumération — « pseudo déjà pris » dirait gratuitement qu'un compte existe : la limite
      // PAR IP passe AVANT (un contrôle consommé, pseudo pris ou libre), et une IP déjà arrêtée par le
      // seau de création reçoit le même refus quel que soit le pseudo
      const ip = ipDe(client)
      if (createFailuresByIp.isBlocked(ip) || !nameChecksByIp.recordFailure(ip)) throw new Error('account-throttled')
      const key = name.toLowerCase()
      if (byName.has(key) || pendingNames.has(key) || damagedNames.has(key)) throw new Error('account-name-taken')

      // réserve le pseudo AVANT l'await scrypt (race TOCTOU — le
      // contrôle ci-dessus est synchrone, deux créations concurrentes du MÊME pseudo passaient donc
      // TOUTES LES DEUX) — libérée dans le `finally`, quelle que soit l'issue : sur succès, `byName`
      // porte déjà le compte réel avant la libération (le contrôle ci-dessus reste vrai ensuite).
      pendingNames.add(key)
      try {
        // anti-DoS création — PAR IP, JUSTE AVANT le calcul scrypt (coûteux, cf. tête de fichier
        // « Anti-DoS création ») : les refus bon marché ci-dessus (format/unicité, AUCUN hachage) ne
        // consomment PAS ce seau — seule une tentative qui atteindrait le hachage compte, exactement le
        // chemin que le défaut visait (DoS CPU via scrypt). MÊME shape d'erreur que account:login —
        // un client ne distingue pas les deux causes.
        if (!createFailuresByIp.recordFailure(ip)) throw new Error('account-throttled')

        const salt  = randomBytes(16)
        const hash = writeHash(reglages, await hacherSecret(secret, salt, reglages))
        const now = Date.now()
        const account: MjsWsAccountRecord = {
          id: genId(), name, hash, salt: salt.toString('hex'), roles: [], createdAt: now, seenAt: now, meta: {},
        }
        // n'inscrit dans byName/byId qu'après une sauvegarde RÉUSSIE —
        // AVANT, l'inscription précédait persist.save() : un échec de sauvegarde laissait un compte
        // FANTÔME en mémoire (jeton reçu valide), bloquant le pseudo pour toute création légitime
        // tout en restant, lui, à jamais injoignable par account:login (jamais écrit sur disque).
        try {
          await Promise.resolve(persist.save(account.id, account))
        } catch (err) {
          onLog('error', t('ws.accounts.persist-echec', { name }), { err: err instanceof Error ? err.message : String(err) })
          throw new Error('account-persist-failed')
        }
        byName.set(key, account); byId.set(account.id, account)

        const roles = await resoudreRoles(account)
        return { ok: true, token: emettreJeton(account, roles) }
      } finally {
        pendingNames.delete(key)
      }
    })

    app.serve('account:login', async (p, client) => {
      await assurerCharge()
      const name = p?.name
      const secret = p?.secret
      const ip      = ipDe(client)
      // recherche : le nom tel quel, en minuscules, comme à la création et au chargement — un compte persisté peut porter
      // un nom hors du format des pseudos ; seule la clé des budgets est bornée
      const nomMin  = typeof name === 'string' ? name.toLowerCase() : undefined
      const nameKey = nomMin !== undefined && nomMin.length <= NOM_CLE_MAX ? nomMin : ECHEC_CLE_INVALIDE

      // secret qui n'est pas une chaîne : refusé tout de suite, AVANT de chercher le compte — même
      // chemin et même temps (aucun hachage), que le pseudo existe ou non
      if (typeof secret !== 'string') throw new Error('account-denied')

      // anti-force-brute — une place RÉSERVÉE dans chaque budget AVANT tout calcul de hachage (y
      // compris factice, cf. tête de fichier) : des essais lancés ensemble ne passent jamais tous le
      // contrôle avant que le premier échec ne soit compté. Budget du pseudo dépensé : seule une adresse
      // sans échec récent sur ce pseudo essaie encore, une fois. Refus IDENTIQUE quel que soit le budget.
      const paire = reseauDe(client) + '\n' + nameKey
      if (!failuresByIp.reserve(ip)) throw new Error('account-throttled')
      if (!nameCeiling.reserve(nameKey)) {
        failuresByIp.release(ip, false)
        throw new Error('account-throttled')
      }
      const dansLeBudget = failuresByName.reserve(nameKey)
      if (!dansLeBudget && !failuresByPair.reserve(paire)) {
        failuresByIp.release(ip, false)
        nameCeiling.release(nameKey, false)
        throw new Error('account-throttled')
      }

      const account = nomMin !== undefined ? byName.get(nomMin) : undefined
      let ok = false
      let redone: { hash: string; salt: string } | undefined
      try {
        // pseudo absent : hachage FACTICE de même coût — anti-énumération par le temps (cf. verifierSecret)
        const verdict = await verifierSecret(secret, account, reglages)
        ok     = verdict.ok
        redone = verdict.redone
      } finally {
        // échec : chaque place devient un échec compté, et l'adresse devient fautive sur ce pseudo ;
        // réussite : les places sont rendues
        failuresByIp.release(ip, !ok)
        nameCeiling.release(nameKey, !ok)
        if (dansLeBudget) {
          failuresByName.release(nameKey, !ok)
          if (!ok) failuresByPair.recordFailure(paire)
        }
        else failuresByPair.release(paire, !ok)
      }
      if (!ok) throw new Error('account-denied')

      account.seenAt = Date.now()
      // hachage refait aux réglages actuels (cf. verifierSecret), écrit avec la date de connexion ; si l'écriture échoue,
      // l'ancien hachage enregistré reste valable
      if (redone) {
        account.hash = redone.hash
        account.salt = redone.salt
      }
      // la date de dernière connexion n'est qu'un renseignement : son écriture en échec (disque
      // plein, base indisponible) ne refuse pas un bon secret, et le message de l'adaptateur — chemin
      // serveur compris — reste au journal, jamais dans la réponse
      try {
        await Promise.resolve(persist.save(account.id, account))
      } catch (err) {
        onLog('warn', t('ws.accounts.date-connexion-echec', { name: account.name }), { err: err instanceof Error ? err.message : String(err) })
      }
      const roles = await resoudreRoles(account)
      return { ok: true, token: emettreJeton(account, roles) }
    })

    // v1 sans état (cf. tête de fichier « Déconnexion ») — rien à révoquer pour une identité déjà
    // anonyme (identityIdOf null) : no-op { ok: true }, jamais de fermeture gratuite d'une connexion
    // invité. Fermeture DIFFÉRÉE (setTimeout 0) : l'accusé de réception doit partir AVANT la coupure
    // (routeAppMessage envoie le µ:ack juste après le retour de ce handler, cf. core.ts) — fermer
    // SYNCHRONEMENT ici ferait courir le risque que l'ack ne parte jamais (client déjà 'closing').
    app.serve('account:logout', async (_p, client) => {
      if (identityIdOf(client.identity) != null) {
        setTimeout(() => client.close('deconnexion'), 0)
      }
      return { ok: true }
    })
  })

  // accès à l'état interne à des fins de TEST UNIQUEMENT — MÊME précédent que chat.ts (_buckets/
  // _mutedUntil) et lobby.ts (_presence/_listings) : aucune primitive publique n'expose `byId` ni
  // ne permet de piloter `genId()` (indispensable pour prouver la revérification de collision —
  // une collision réelle à 64 bits d'aléa n'est pas observable de bout en bout).
  ;(pkg as any)._byId  = byId
  ;(pkg as any)._genId = genId
  return pkg
}
