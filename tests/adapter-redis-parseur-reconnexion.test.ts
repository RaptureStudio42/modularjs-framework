// adapter-redis.ts::RedisConnection — le RespParser n'était jamais réinitialisé à la reconnexion :
// un fragment retenu de l'ancienne connexion (trame RESP coupée en plein milieu) fusionnait avec la
// première réponse de la connexion SUIVANTE, corrompant silencieusement le protocole. Un parseur
// neuf est désormais posé à chaque _onClose() (avant la prochaine tentative de connexion).
import assert from 'node:assert/strict'
import { RedisConnection } from '../src/mjs-ws/adapter-redis.js'

describe('adapter-redis — le parseur RESP repart neuf à chaque reconnexion', () => {
  it('un fragment coupé avant la coupure NE contamine PLUS la 1re réponse de la connexion suivante', () => {
    const cmd = new RedisConnection({ host: 'x', port: 1, role: 'command', onLog: () => {}, onConnected: () => {} })
    ;(cmd as any)._socket = { write() {}, destroy() {}, on() {} }

    // une commande en attente AVANT la coupure — _onClose() la rejette normalement (comportement
    // PRÉEXISTANT, non concerné ici) ; seul le PARSEUR est en cause dans ce test
    ;(cmd as any)._pending.push({ resolve() {}, reject() {} })
    ;(cmd as any)._onData(Buffer.from('$5\r\nhe'))   // bulk annoncée 5 octets, 2 reçus — fragment retenu dans _parser

    ;(cmd as any)._onClose()   // coupure — DOIT jeter le parseur, pas seulement _socket/_ready/_pending

    let captured2: any = 'JAMAIS_RESOLU'
    ;(cmd as any)._pending.push({ resolve: (v: any) => { captured2 = v }, reject: (e: any) => { captured2 = e } })
    ;(cmd as any)._socket = { write() {}, destroy() {}, on() {} }
    ;(cmd as any)._onData(Buffer.from('+OK\r\n'))   // réponse COMPLÈTE de la nouvelle connexion

    assert.equal(captured2, 'OK', 'la réponse de la nouvelle connexion est lue PROPREMENT — aucun reliquat de "he"')
    assert.notEqual(captured2, 'he+OK', 'preuve directe : plus de fusion avec le fragment de l\'ancienne connexion')

    cmd.stop()   // annule le minuteur de reconnexion réel programmé par _onClose()
  })

  it('un fragment complet ET consommé avant la coupure n\'a de toute façon rien laissé (non-régression)', () => {
    const cmd = new RedisConnection({ host: 'x', port: 1, role: 'command', onLog: () => {}, onConnected: () => {} })
    ;(cmd as any)._socket = { write() {}, destroy() {}, on() {} }

    let captured: any = null
    ;(cmd as any)._pending.push({ resolve: (v: any) => { captured = v }, reject: () => {} })
    ;(cmd as any)._onData(Buffer.from('+PONG\r\n'))
    assert.equal(captured, 'PONG')

    ;(cmd as any)._onClose()
    let captured2: any = null
    ;(cmd as any)._pending.push({ resolve: (v: any) => { captured2 = v }, reject: () => {} })
    ;(cmd as any)._socket = { write() {}, destroy() {}, on() {} }
    ;(cmd as any)._onData(Buffer.from('+PONG2\r\n'))
    assert.equal(captured2, 'PONG2', 'aucune régression sur le cas sans fragment coupé')

    cmd.stop()
  })
})
