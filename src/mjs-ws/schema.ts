// mjs-ws/schema — « µschema » côté serveur : BRANCHE le registre pur (src/schema/core.ts) au
// protocole µ: — MÊME esprit que rooms.ts/streams.ts/sessions.ts (moteur autonome, core.ts le
// branche aux points du cycle de vie SANS réimplémenter sa logique, cf. l'en-tête de core.ts).
//
// Trois modes `ws.codec` (résolus ICI, cf. resolveCodec) :
//   'auto'   (défaut) — un type applicatif avec schéma déclaré part en BINAIRE, le reste en JSON.
//   'binary' — STRICT : un type applicatif SANS schéma est un refus (assertSendable jette à
//              l'envoi, rejectIfStrictText rejette à la réception) — jamais de fuite JSON pour
//              du texte applicatif. Les trames de contrôle µ: restent TOUJOURS JSON (bootstrap du
//              hello) : isControlType() les exempte partout dans ce fichier.
//   'json'   — coupe-circuit débogage : encodeOutbound() retourne toujours null (jamais de binaire),
//              même pour un type schématisé.
//
// Enveloppe fil [u8 id][charge] (réservée à une évolution future du format) — encode/decode viennent de schema/core.ts,
// AUCUN décodage/encodage réinventé ici, juste le CHOIX du format + le routage des erreurs (µ:error
// throttlé, compteurs stats.messages.binaryIgnored/textRejected).
//
// Exclusion des deltas de flux (streams.ts) — un delta a TOUJOURS `seq` (cf. sa frame {t:nom,
// seq, p}), jamais un send()/broadcast()/room().send() applicatif : c'est core.ts (sendRaw) qui
// vérifie `frame.seq == null` AVANT d'appeler encodeOutbound, jamais ce fichier (il ne voit que
// `type`+`p`, pas la frame complète) — cf. son commentaire dans core.ts.

import { createRegistry, defineSchema, encode, decode, hashRegistry, serializeDefinitions } from '../schema/core.js'
import type { MjschemaFields, MjschemaRegistry, MjschemaDefinitionsJSON } from '../schema/core.js'
import { RATE_ERROR_THROTTLE_MS } from './guard.js'
import type { MjsWsClient, MjsWsLogFn } from './core.js'
import type { MjsWsStatsRegistry } from './stats.js'
import { t } from '../messages/index.js'

export type MjsWsCodec = 'auto' | 'binary' | 'json'

/** options BRUTES (cf. MjsWsOptions.codec/schemas, index.ts) — `schemas` = déclaration en masse,
 *  ÉQUIVALENT à autant d'appels `app.schema(name, fields)` avant .listen() (même garde ajout-seul). */
export interface MjsWsSchemaOptions {
  codec?: MjsWsCodec
  schemas?: Record<string, MjschemaFields>
}

export interface MjsWsResolvedSchema {
  codec: MjsWsCodec
  registry: MjschemaRegistry
}

/** validation STRICTE — utilisée par cli/ws.ts pour valider la config et afficher sa bannière */
export function resolveCodec(raw: unknown): MjsWsCodec {
  if (raw === undefined) return 'auto'
  if (raw === 'auto' || raw === 'binary' || raw === 'json') return raw
  throw new Error(t('ws.schema.codec-invalid', { raw: JSON.stringify(raw) }))
}

/** TOUJOURS un registre (vide si `schemas` absent) — la voie JSON existante reste byte-identique
 *  tant qu'aucun schéma n'est déclaré, cf. tests/mjs-ws-schema.test.ts « non-régression ». */
export function resolveSchemaOptions(raw: MjsWsSchemaOptions | undefined): MjsWsResolvedSchema {
  const registry = createRegistry()
  if (raw?.schemas) for (const name of Object.keys(raw.schemas)) defineSchema(registry, name, raw.schemas[name])
  return { codec: resolveCodec(raw?.codec), registry: registry }
}

/** trame de contrôle µ: — TOUJOURS JSON, jamais schématisable (cf. tête de fichier) */
function isControlType(t: string): boolean { return t.indexOf('µ:') === 0 }

export type MjsWsSchemaRawSend = (client: MjsWsClient, frame: Record<string, unknown>) => void

export interface MjsWsSchemaEngine {
  /** app.schema(name, fields) — délègue à defineSchema (garde ajout-seul, cf. src/schema/core.ts) */
  def(name: string, fields: MjschemaFields): void
  /**
   * Validation SORTANTE — appelée par les 4 points d'entrée publics (app.send/sendUser/broadcast/
   * room().send, cf. core.ts) AVANT tout envoi : jette IMMÉDIATEMENT si `ws.codec === 'binary'` et
   * que `type` (non µ:) n'a pas de schéma déclaré — erreur de dev claire, jamais un
   * silence qui laisserait croire que le message est parti. N'est PAS rappelée par sendRaw lui-même
   * (rejeu de session, réception cluster) : ces chemins ne portent que des frames DÉJÀ validées à
   * leur envoi d'origine (cf. commentaire de tête).
   */
  assertSendable(type: string): void
  /** `null` = rester JSON (type de contrôle, codec 'json', ou pas de schéma pour ce type) */
  encodeOutbound(type: string, p: unknown): Uint8Array | null
  /** décode une trame binaire ENTRANTE déjà authentifiée (cf. core.ts::handleBinaryRaw/_binaryHandler)
   *  — `null` = id inconnu ou trame corrompue, déjà comptée (binaryIgnored) et, en mode 'binary'
   *  seulement, déjà signalée par un µ:error throttlé (jamais en 'auto'/'json' — cf. tête de fichier :
   *  pas de canal de reconnaissance gratuit pour qui sonderait le protocole). */
  decodeInbound(client: MjsWsClient, bytes: Uint8Array): { t: string; p: unknown } | null
  /** `true` = REJETÉE (l'appelant ne doit alors PAS router vers routeAppMessage) — trame texte
   *  applicative reçue alors que `ws.codec === 'binary'` (strict) ; toujours `false` hors ce mode. */
  rejectIfStrictText(client: MjsWsClient, type: string): boolean
  /** hash courant du registre (FNV-1a hex, cf. src/schema/core.ts) — µ:welcome/µ:schema */
  hash(): string
  /** définitions sérialisées JSON-safe — charge de µ:schema (cf. loadDefinitions côté client) */
  definitions(): MjschemaDefinitionsJSON
  /** `false` = aucun schéma déclaré — le hash/µ:schema n'ont alors aucune raison d'apparaître au welcome */
  readonly hasSchemas: boolean
}

export function createSchemaEngine(resolved: MjsWsResolvedSchema, rawSend: MjsWsSchemaRawSend, log: MjsWsLogFn, stats: MjsWsStatsRegistry): MjsWsSchemaEngine {
  const { registry: registry, codec } = resolved
  // throttle des µ:error de désaccord schéma — MÊME politique que RATE_ERROR_THROTTLE_MS (guard.ts,
  // rooms.ts::refuseJoin) : 1 message/s par CLIENT, jamais un par trame rejetée (sinon le throttle
  // lui-même spamme). RÉUTILISÉ tel quel pour le log interne de décodage (decodeInbound, cf. son
  // catch) via throttleActive ci-dessous — même fenêtre PARTAGÉE : un flood de trames invalides ne
  // doit jamais produire un travail de log non borné, y compris hors mode 'binary' (le log tourne
  // dans TOUS les codecs, contrairement au µ:error envoyé au client, réservé au mode strict). Faille
  // comblée — WeakMap (pas Map) : ce moteur n'a AUCUNE accroche onDisconnect (jamais appelé par
  // core.ts, cf. son contrat retourné), rien ne purgeait donc explicitement une entrée à la
  // déconnexion — une Map FORTE grossissait alors avec le nombre CUMULÉ de clients ayant un jour
  // déclenché une erreur throttlée, jamais avec le nombre de connexions ACTIVES. Une WeakMap laisse
  // le ramasse-miettes reprendre l'entrée dès que plus rien (que ce moteur) ne référence le client.
  const lastErrorAt = new WeakMap<MjsWsClient, number>()

  // vrai = fenêtre ENCORE active pour ce client (rien à faire, ni log ni envoi) ; faux = fenêtre
  // consommée — lastErrorAt mis à jour AVANT de rendre la main, porte UNIQUE partagée par
  // sendThrottledError ET le catch de decodeInbound (cf. leurs commentaires respectifs).
  function throttleActive(client: MjsWsClient): boolean {
    const now  = Date.now()
    const last = lastErrorAt.get(client)
    if (last != null && now - last <= RATE_ERROR_THROTTLE_MS) return true
    lastErrorAt.set(client, now)
    return false
  }

  function sendThrottledError(client: MjsWsClient, message: string): void {
    if (throttleActive(client)) return
    rawSend(client, { t: 'µ:error', p: { message } })
  }

  return {
    def(name, fields) { defineSchema(registry, name, fields) },

    assertSendable(type) {
      if (codec !== 'binary' || isControlType(type)) return
      if (!registry.byName.has(type)) {
        throw new Error(t('ws.schema.binary-strict-refused', { type }))
      }
    },

    encodeOutbound(type, p) {
      if (codec === 'json' || isControlType(type)) return null
      if (!registry.byName.has(type)) return null   // 'auto' sans schéma pour ce type — reste JSON
      return encode(registry, type, p as Record<string, unknown> | null | undefined)
    },

    decodeInbound(client, bytes) {
      if (bytes.byteLength < 1) { stats.messages.binaryIgnored++; return null }
      const id  = bytes[0]
      const def = registry.byId[id]
      if (!def) {
        stats.messages.binaryIgnored++
        if (codec === 'binary') sendThrottledError(client, t('ws.schema.id-unknown-desynced', { id }))
        return null
      }
      try {
        const { name, data } = decode(registry, bytes)
        return { t: name, p: data }
      } catch (err) {
        stats.messages.binaryIgnored++
        // MÊME throttle que sendThrottledError (throttleActive/lastErrorAt/RATE_ERROR_THROTTLE_MS
        // ci-dessus) — porte UNIQUE vérifiée une seule fois : sinon un flood de trames invalides
        // reste un travail de log non borné, y compris en codec 'auto'/'json' où le
        // µ:error ci-dessous ne part jamais.
        if (!throttleActive(client)) {
          log('warn', t('ws.schema.decoding-failed'), { err })
          if (codec === 'binary') rawSend(client, { t: 'µ:error', p: { message: t('ws.schema.frame-binary-corrupt') } })
        }
        return null
      }
    },

    rejectIfStrictText(client, type) {
      if (codec !== 'binary' || isControlType(type)) return false
      stats.messages.textRejected++
      sendThrottledError(client, t('ws.schema.text-strict-rejected', { type }))
      return true
    },

    hash()        { return hashRegistry(registry) },
    definitions() { return serializeDefinitions(registry) },
    get hasSchemas(): boolean { return registry.byId.length > 0 },
  }
}
