// Option `trustProxy` : une plage de confiance trop large est refusée à la construction. Croire les en-têtes d'un pair, c'est le laisser
// choisir l'adresse de ses visiteurs ; une plage qui contient des visiteurs directs (deux plages /1 qui se partagent tout IPv4, par
// exemple) revient à `true`, déjà refusé : tout visiteur direct choisirait l'adresse qu'il veut dans X-Forwarded-For et contournerait
// les bornes par adresse. Plus large que /8 en IPv4 ou que /16 en IPv6 : refusé, avec un message qui dit pourquoi. Une plage IPv6 qui
// contient l'espace IPv4 mappé (::ffff:0:0/96) est comptée comme une plage IPv4, car Node ne distingue pas les deux écritures d'une
// même adresse : `::/16` croirait tout pair IPv4.

import assert from 'node:assert/strict'
import { resolveTrustProxy, createAddressResolver } from '../src/mjs-ws/trust-proxy.js'
import { mjsWs, MemoryTransport } from '../src/mjs-ws/index.js'
import { mjsServer } from '../src/mjs-server/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const refuse = (entry: unknown): string | null => {
  try { resolveTrustProxy([entry]); return null } catch (err) { return (err as Error).message }
}

describe('trustProxy : les plages trop larges sont refusées', () => {
  afterEach(() => setMessagesLang('fr'))

  it('IPv4 plus large que /8 : refusé, de /1 à /7', () => {
    for (const entry of ['0.0.0.0/1', '128.0.0.0/1', '10.0.0.0/2', '10.0.0.0/4', '192.0.0.0/7', '10.9.9.9/7', ' 10.0.0.0/7 ']) {
      assert.notEqual(refuse(entry), null, `${entry} doit être refusée`)
    }
  })

  it('deux plages /1 qui se partagent tout IPv4 sont refusées (chacune l\'est), seules ou dans une liste', () => {
    assert.notEqual(refuse('0.0.0.0/1'), null)
    assert.notEqual(refuse('128.0.0.0/1'), null)
    assert.throws(() => resolveTrustProxy(['0.0.0.0/1', '128.0.0.0/1']), /trustProxy/)
    assert.throws(() => resolveTrustProxy(['10.0.0.0/8', '128.0.0.0/1']), /128\.0\.0\.0\/1/)
  })

  it('IPv6 plus large que /16 : refusé', () => {
    for (const entry of ['::/1', '8000::/1', '2000::/3', 'fc00::/7', 'fd00::/8', '2001::/15', 'fe80::/10']) {
      assert.notEqual(refuse(entry), null, `${entry} doit être refusée`)
    }
  })

  it('une plage IPv6 qui contient l\'espace IPv4 mappé compte comme une plage IPv4 : refusée si elle dépasse /8 en IPv4', () => {
    for (const entry of ['::/16', '::/48', '::/80', '::ffff:0.0.0.0/96', '::ffff:0:0/96', '::ffff:0.0.0.0/100', '::ffff:0:0/103']) {
      assert.notEqual(refuse(entry), null, `${entry} doit être refusée`)
    }
    const proxies = resolveTrustProxy(['::ffff:10.0.0.0/104'])!
    assert.equal(proxies.trusts('10.1.2.3'), true, 'une plage IPv4 mappée de la taille d\'un /8 reste permise')
    assert.equal(proxies.trusts('11.1.2.3'), false)
  })

  it('/8 en IPv4 et /16 en IPv6 sont les plus larges acceptées ; adresses seules et plages étroites passent', () => {
    for (const entry of ['10.0.0.0/8', '11.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '192.168.1.5', '192.168.1.5/32', '0.0.0.0/8', '2001::/16', 'fd00::/16', 'fd12:3456:789a::/48', '2001:db8::/32', '2001:db8::1', '2001:db8::1/128', '::1', '::/128']) {
      assert.equal(refuse(entry), null, `${entry} doit être acceptée : ${refuse(entry)}`)
    }
  })

  it('le message nomme la plage, la limite et la raison, en français puis en anglais', () => {
    const cas: Array<[string, string, string]> = [['0.0.0.0/1', 'IPv4', '/8'], ['10.0.0.0/7', 'IPv4', '/8'], ['2000::/3', 'IPv6', '/16'], ['::/48', 'IPv4', '/8']]
    for (const lang of ['fr', 'en'] as const) {
      setMessagesLang(lang)
      for (const [entry, famille, limite] of cas) {
        const message = refuse(entry)!
        assert.ok(message.includes('trustProxy'), `${lang} ${entry} : ${message}`)
        assert.ok(message.includes(entry), `${lang} : la plage ${entry} doit figurer dans : ${message}`)
        assert.ok(message.includes(famille) && message.includes(limite), `${lang} ${entry} : la famille ${famille} et la limite ${limite} doivent figurer dans : ${message}`)
        assert.ok(message.includes('X-Forwarded-For'), `${lang} ${entry} : la raison doit figurer dans : ${message}`)
        assert.ok(message.includes('10.0.0.0/8'), `${lang} ${entry} : l'exemple valable doit figurer dans : ${message}`)
      }
    }
    setMessagesLang('fr')
    assert.match(refuse('0.0.0.0/1')!, /Listez vos proxies/, 'le français parle à la forme de politesse')
    setMessagesLang('en')
    assert.match(refuse('0.0.0.0/1')!, /List your actual proxies/)
  })

  it('une plage de 0 bit garde son message propre (c\'est true sous un autre nom)', () => {
    assert.match(refuse('0.0.0.0/0')!, /true/)
    assert.match(refuse('::/0')!, /true/)
  })

  it('refusée à la construction du serveur, sans transport réseau : mjsWs(), mjsServer() et le résolveur d\'adresse', () => {
    const liste = ['0.0.0.0/1', '128.0.0.0/1']
    assert.throws(() => mjsWs({ transport: new MemoryTransport(), trustProxy: liste }), /0\.0\.0\.0\/1/)
    assert.throws(() => mjsServer({ transport: new MemoryTransport(), trustProxy: liste }), /0\.0\.0\.0\/1/)
    assert.throws(() => createAddressResolver(liste), /0\.0\.0\.0\/1/)
  })

  it('une plage valable reste lue comme avant : seules les adresses de la plage sont de confiance', () => {
    const proxies = resolveTrustProxy(['10.0.0.0/8', 'fd12::/16'])!
    assert.equal(proxies.trusts('10.20.30.40'), true)
    assert.equal(proxies.trusts('fd12:3456::1'), true)
    assert.equal(proxies.trusts('203.0.113.9'), false)
    assert.equal(proxies.trusts('fd13::1'), false)
  })
})
