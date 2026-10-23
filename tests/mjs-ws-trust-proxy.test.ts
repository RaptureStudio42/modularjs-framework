// Option `trustProxy` de MJS-WS : l'analyse des adresses et des en-têtes de proxy (src/mjs-ws/trust-proxy.ts).
// Derrière nginx, la socket ne voit que l'adresse du proxy : sans cette option, les bornes par adresse
// (verrou des codes de partie, connexions par adresse, mise au banc par adresse) deviennent globales. Ici, les
// fonctions pures : à quels pairs on croit, quelle entrée de X-Forwarded-For donne le visiteur, ce qui arrive
// sur un en-tête malformé. La chaîne réelle (serveur derrière un faux proxy) est dans
// tests/mjs-ws-trust-proxy-chaine-reelle.test.ts.

import assert from 'node:assert/strict'
import { resolveTrustProxy, visitorAddress, proxyHeadersFromLocalPeer, createAddressResolver } from '../src/mjs-ws/trust-proxy.js'
import { setMessagesLang } from '../src/messages/index.js'

type Headers = Record<string, string | string[] | undefined>

// l'adresse retenue pour un pair et des en-têtes donnés, sous un réglage donné
const via = (trust: unknown, peer: string | undefined, headers: Headers = {}): string | undefined => visitorAddress(peer, headers, resolveTrustProxy(trust))

describe('trustProxy : lecture de l\'option', () => {
  afterEach(() => setMessagesLang('fr'))

  it('absente, false ou null : personne n\'est cru ; une liste vide ne désigne personne', () => {
    assert.equal(resolveTrustProxy(undefined), null)
    assert.equal(resolveTrustProxy(false), null)
    assert.equal(resolveTrustProxy(null), null)
    assert.equal(resolveTrustProxy([]), null)
  })

  it('true est refusé (trop large) : le message donne les deux formes valides, en français puis en anglais', () => {
    for (const lang of ['fr', 'en'] as const) {
      setMessagesLang(lang)
      assert.throws(() => resolveTrustProxy(true), (err: Error) => {
        assert.match(err.message, /trustProxy/, lang)
        assert.ok(err.message.includes('\'loopback\''), `${lang} : la forme 'loopback' manque : ${err.message}`)
        assert.ok(err.message.includes('[\'10.0.0.0/8\', \'192.168.1.5\']'), `${lang} : la forme liste manque : ${err.message}`)
        return true
      })
    }
  })

  it('toute autre valeur est refusée en clair, y compris les valeurs fausses qui ne sont pas false (0, chaîne vide)', () => {
    for (const bad of ['oui', 'Loopback', 'proxy', '', 1, 0, {}, () => true]) {
      assert.throws(() => resolveTrustProxy(bad), /trustProxy/, `valeur ${String(bad)}`)
    }
  })

  it('une valeur qui ne se sérialise pas (BigInt, structure circulaire) est refusée par le même message, pas par une autre erreur', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    for (const bad of [10n, circular, [10n], [circular]]) {
      assert.throws(() => resolveTrustProxy(bad), (err: Error) => err.message.includes('trustProxy') && !(err instanceof TypeError))
    }
  })

  it('une entrée de liste qui n\'est ni une adresse ni une plage est refusée, et le message la nomme', () => {
    const faulty = ['abc', '', ' ', '999.1.1.1', '1.2.3', '010.0.0.1', '10.0.0.0/33', '10.0.0.0/', '10.0.0.0/-1', '10.0.0.0/8/8', '10.0.0.0/x', 'fd00::/129', 'fe80::1%eth0', 'example.com', 'loopback', 42, null, ['10.0.0.1']]
    for (const entry of faulty) {
      assert.throws(() => resolveTrustProxy(['192.168.1.5', entry]), (err: Error) => {
        assert.ok(err.message.includes(JSON.stringify(entry)), `l'entrée ${JSON.stringify(entry)} doit figurer dans : ${err.message}`)
        assert.ok(err.message.includes('trustProxy'), err.message)
        return true
      })
    }
  })

  it('une plage /0 couvre toutes les adresses : refusée comme true', () => {
    for (const entry of ['0.0.0.0/0', '::/0', '10.0.0.0/0']) {
      assert.throws(() => resolveTrustProxy(['192.168.1.5', entry]), (err: Error) => err.message.includes(entry) && err.message.includes('trustProxy'), entry)
    }
  })
})

describe('trustProxy : quel pair est un proxy de confiance', () => {
  it('\'loopback\' : 127.0.0.0/8, ::1, leurs formes IPv4 mappée ou développée, et la socket unix (aucune adresse)', () => {
    const proxies = resolveTrustProxy('loopback')!
    for (const address of ['127.0.0.1', '127.255.255.254', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1', '0:0:0:0:0:ffff:7f00:1', undefined]) {
      assert.equal(proxies.trusts(address), true, `${address} doit être de confiance`)
    }
    for (const address of ['128.0.0.1', '126.255.255.255', '10.0.0.1', '203.0.113.9', '::2', '2001:db8::1', '::ffff:10.0.0.1', 'abc', '']) {
      assert.equal(proxies.trusts(address), false, `${address} ne doit pas être de confiance`)
    }
  })

  it('une liste : seulement les adresses et plages nommées, la boucle locale n\'en fait pas partie', () => {
    const proxies = resolveTrustProxy(['10.0.0.0/8', '192.168.1.5', 'fd12::/16', '2001:DB8::1'])!
    for (const address of ['10.0.0.1', '10.255.255.255', '192.168.1.5', 'fd12:3456::1', '2001:db8::1', '2001:0db8:0:0:0:0:0:1', '::ffff:10.1.2.3']) {
      assert.equal(proxies.trusts(address), true, `${address} doit être de confiance`)
    }
    for (const address of ['11.0.0.1', '9.255.255.255', '192.168.1.6', '127.0.0.1', '::1', 'fe80::1', '2001:db8::2', 'abc', undefined]) {
      assert.equal(proxies.trusts(address), false, `${address} ne doit pas être de confiance`)
    }
  })

  it('une plage dont l\'adresse porte des bits d\'hôte reste lue comme sa plage', () => {
    const proxies = resolveTrustProxy(['10.9.9.9/8'])!
    assert.equal(proxies.trusts('10.1.2.3'), true)
    assert.equal(proxies.trusts('11.1.2.3'), false)
  })
})

describe('trustProxy : l\'adresse du visiteur', () => {
  it('sans confiance (option absente ou false) : l\'adresse de la socket, normalisée comme avant, en-têtes ignorés', () => {
    const headers = { 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '203.0.113.8' }
    assert.equal(via(undefined, '127.0.0.1', headers), '127.0.0.1')
    assert.equal(via(false, '::ffff:127.0.0.1', headers), '127.0.0.1')
    assert.equal(via(undefined, '2001:db8::1', headers), '2001:db8::1')
    assert.equal(via(undefined, undefined, headers), undefined)
  })

  it('un pair qui n\'est pas de confiance : ses en-têtes sont ignorés (un visiteur direct ne choisit pas son adresse)', () => {
    const headers = { 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '1.2.3.5' }
    assert.equal(via(['10.0.0.0/8'], '203.0.113.9', headers), '203.0.113.9')
    assert.equal(via(['10.0.0.0/8'], '127.0.0.1', headers), '127.0.0.1', 'la boucle locale n\'est pas dans la liste')
    assert.equal(via(['10.0.0.0/8'], undefined, headers), undefined, 'une socket unix n\'est pas dans une liste')
    assert.equal(via('loopback', '203.0.113.9', headers), '203.0.113.9')
  })

  it('un pair de confiance, une seule entrée : c\'est le visiteur', () => {
    assert.equal(via('loopback', '127.0.0.1', { 'x-forwarded-for': '203.0.113.7' }), '203.0.113.7')
    assert.equal(via('loopback', '::1', { 'x-forwarded-for': '203.0.113.7' }), '203.0.113.7')
    assert.equal(via('loopback', undefined, { 'x-forwarded-for': '203.0.113.7' }), '203.0.113.7', 'socket unix : le proxy est local par nature')
    assert.equal(via(['10.0.0.0/8'], '10.0.0.5', { 'x-forwarded-for': '203.0.113.7' }), '203.0.113.7')
  })

  it('on remonte la chaîne de droite à gauche : l\'entrée la plus à droite qui n\'est pas un proxy de confiance', () => {
    const list = ['10.0.0.0/8']
    assert.equal(via(list, '10.0.0.1', { 'x-forwarded-for': '203.0.113.7, 10.0.0.9' }), '203.0.113.7')
    assert.equal(via(list, '10.0.0.1', { 'x-forwarded-for': '1.2.3.4, 203.0.113.7, 10.0.0.9, 10.0.0.8' }), '203.0.113.7')
    assert.equal(via(list, '10.0.0.1', { 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }), '203.0.113.7', 'l\'entrée de gauche est celle que le visiteur a écrite lui-même')
  })

  it('un visiteur qui forge X-Forwarded-For ne choisit pas son adresse : le proxy ajoute la vraie, à droite', () => {
    assert.equal(via('loopback', '127.0.0.1', { 'x-forwarded-for': '10.9.9.9, 203.0.113.7' }), '203.0.113.7')
    assert.equal(via('loopback', '127.0.0.1', { 'x-forwarded-for': '127.0.0.1, 203.0.113.7' }), '203.0.113.7', 'même en se faisant passer pour un proxy')
    assert.equal(via(['10.0.0.0/8'], '10.0.0.1', { 'x-forwarded-for': '10.1.1.1, 10.2.2.2, 203.0.113.7' }), '203.0.113.7')
  })

  it('une chaîne de proxies de confiance de bout en bout : l\'entrée la plus à gauche, le début de la chaîne', () => {
    assert.equal(via(['10.0.0.0/8'], '10.0.0.1', { 'x-forwarded-for': '10.0.0.5, 10.0.0.6' }), '10.0.0.5')
    assert.equal(via('loopback', '127.0.0.1', { 'x-forwarded-for': '127.0.0.1' }), '127.0.0.1')
  })

  it('sans X-Forwarded-For, X-Real-IP ; les deux là, X-Real-IP s\'il désigne le même visiteur, sinon l\'adresse du pair', () => {
    assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': '203.0.113.8' }), '203.0.113.8')
    assert.equal(via('loopback', '127.0.0.1', { 'x-forwarded-for': '203.0.113.8', 'x-real-ip': '203.0.113.8' }), '203.0.113.8')
    assert.equal(via('loopback', '127.0.0.1', { 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '203.0.113.8' }), '127.0.0.1', 'les deux se contredisent : l\'un des deux vient du visiteur')
    assert.equal(via('loopback', '127.0.0.1', { 'x-forwarded-for': 'garbage', 'x-real-ip': '203.0.113.8' }), '127.0.0.1', 'un X-Forwarded-For illisible ne confirme pas X-Real-IP')
    assert.equal(via('loopback', '127.0.0.1', { 'x-forwarded-for': '', 'x-real-ip': '203.0.113.8' }), '203.0.113.8', 'un X-Forwarded-For vide est absent')
    assert.equal(via('loopback', '127.0.0.1', {}), '127.0.0.1')
    assert.equal(via('loopback', '::ffff:127.0.0.1', {}), '127.0.0.1', 'l\'adresse du pair reste normalisée comme avant')
    assert.equal(via('loopback', undefined, {}), undefined)
  })

  it('un en-tête malformé : l\'adresse du pair, sans lever', () => {
    const malformed = ['garbage', '203.0.113.7, garbage', '203.0.113.7:4711', '[2001:db8::1]:443', 'unknown', '_hidden', '999.1.1.1', '010.0.0.1', 'fe80::1%eth0', ', ,', '203.0.113.7,', ',203.0.113.7,']
    for (const value of malformed) {
      assert.equal(via('loopback', '127.0.0.1', { 'x-forwarded-for': value }), '127.0.0.1', `X-Forwarded-For ${JSON.stringify(value)}`)
    }
    assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': 'garbage' }), '127.0.0.1')
    assert.equal(via('loopback', '127.0.0.1', { 'x-forwarded-for': 'garbage', 'x-real-ip': 'garbage' }), '127.0.0.1', 'deux en-têtes illisibles : le pair')
  })

  it('une entrée illisible à gauche d\'une entrée valable n\'est jamais lue : on s\'arrête à la première qui n\'est pas un proxy', () => {
    assert.equal(via('loopback', '127.0.0.1', { 'x-forwarded-for': 'garbage, 203.0.113.7' }), '203.0.113.7')
  })

  it('IPv6 : écriture ramenée à la forme du système, IPv4 mappée ramenée en IPv4', () => {
    assert.equal(via('loopback', '127.0.0.1', { 'x-forwarded-for': '2001:db8::1' }), '2001:db8::1')
    assert.equal(via('loopback', '127.0.0.1', { 'x-forwarded-for': '2001:0DB8:0:0:0:0:0:1' }), '2001:db8::1')
    assert.equal(via('loopback', '127.0.0.1', { 'x-forwarded-for': '::ffff:203.0.113.7' }), '203.0.113.7')
    assert.equal(via('loopback', '127.0.0.1', { 'x-forwarded-for': '::ffff:cb00:7107' }), '203.0.113.7', 'la forme hexadécimale d\'une adresse mappée')
    assert.equal(via('loopback', '127.0.0.1', { 'x-real-ip': '2001:DB8::1' }), '2001:db8::1')
  })

  it('IPv6 et mappée dans la chaîne : un proxy de confiance écrit autrement reste un proxy', () => {
    assert.equal(via(['10.0.0.0/8', 'fd00::/16'], '10.0.0.1', { 'x-forwarded-for': '203.0.113.7, ::ffff:10.0.0.9, FD00::1' }), '203.0.113.7')
    assert.equal(via(['2001:db8::/32'], '2001:db8::5', { 'x-forwarded-for': '2001:4860::1, 2001:db8::9' }), '2001:4860::1')
  })

  it('un en-tête répété arrive en tableau : les valeurs se lisent dans l\'ordre, comme une seule', () => {
    assert.equal(via(['10.0.0.0/8'], '10.0.0.1', { 'x-forwarded-for': ['203.0.113.7', '10.0.0.9'] }), '203.0.113.7')
    assert.equal(via('loopback', '127.0.0.1', { 'x-forwarded-for': [] }), '127.0.0.1')
  })

  it('les espaces autour des entrées sont sans effet', () => {
    assert.equal(via('loopback', '127.0.0.1', { 'x-forwarded-for': '   203.0.113.7  ,   127.0.0.1 ' }), '203.0.113.7')
  })

  it('le pair lui-même illisible n\'est jamais de confiance', () => {
    assert.equal(via('loopback', 'abc', { 'x-forwarded-for': '203.0.113.7' }), 'abc')
  })
})

describe('trustProxy : l\'avertissement « derrière un proxy sans réglage »', () => {
  it('des en-têtes de proxy depuis un pair de boucle : à signaler (X-Forwarded-For ou X-Real-IP)', () => {
    for (const peer of ['127.0.0.1', '127.8.8.8', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:ffff:7f00:1', undefined]) {
      assert.equal(proxyHeadersFromLocalPeer(peer, { 'x-forwarded-for': '203.0.113.7' }), true, `${peer} + X-Forwarded-For`)
      assert.equal(proxyHeadersFromLocalPeer(peer, { 'x-real-ip': '203.0.113.7' }), true, `${peer} + X-Real-IP`)
    }
  })

  it('rien à signaler : pas d\'en-tête de proxy, en-têtes vides, ou pair qui n\'est pas de boucle', () => {
    assert.equal(proxyHeadersFromLocalPeer('127.0.0.1', {}), false)
    assert.equal(proxyHeadersFromLocalPeer('127.0.0.1', undefined), false)
    assert.equal(proxyHeadersFromLocalPeer('127.0.0.1', { 'x-forwarded-for': '', 'x-real-ip': '  ' }), false)
    assert.equal(proxyHeadersFromLocalPeer('127.0.0.1', { host: 'exemple.com', origin: 'https://exemple.com' }), false)
    assert.equal(proxyHeadersFromLocalPeer('203.0.113.9', { 'x-forwarded-for': '1.2.3.4' }), false)
    assert.equal(proxyHeadersFromLocalPeer('10.0.0.5', { 'x-forwarded-for': '1.2.3.4' }), false)
  })
})

describe('trustProxy : le résolveur d\'adresse des transports', () => {
  it('sans option ni avertisseur : exactement l\'adresse de la socket d\'avant, en-têtes ignorés', () => {
    const addressOf = createAddressResolver(undefined)
    const headers   = { 'x-forwarded-for': '203.0.113.7' }
    assert.equal(addressOf('::ffff:10.1.2.3', headers), '10.1.2.3')
    assert.equal(addressOf('2001:db8::1', headers), '2001:db8::1')
    assert.equal(addressOf('10.1.2.3', undefined), '10.1.2.3')
    assert.equal(addressOf(undefined, headers), undefined)
  })

  it('false : comme l\'absence de l\'option', () => {
    const addressOf = createAddressResolver(false)
    assert.equal(addressOf('127.0.0.1', { 'x-forwarded-for': '203.0.113.7' }), '127.0.0.1')
  })

  it('avec une valeur fausse : lève dès la construction, pas à la première connexion', () => {
    assert.throws(() => createAddressResolver(true), /trustProxy/)
    assert.throws(() => createAddressResolver(['abc']), /trustProxy/)
  })

  it('avec trustProxy : l\'adresse du visiteur, pour chaque connexion', () => {
    const addressOf = createAddressResolver('loopback')
    assert.equal(addressOf('127.0.0.1', { 'x-forwarded-for': '203.0.113.7' }), '203.0.113.7')
    assert.equal(addressOf('127.0.0.1', { 'x-forwarded-for': '203.0.113.8' }), '203.0.113.8')
    assert.equal(addressOf('127.0.0.1', undefined), '127.0.0.1')
    assert.equal(addressOf('203.0.113.9', { 'x-forwarded-for': '1.2.3.4' }), '203.0.113.9')
  })

  it('l\'avertisseur : appelé une seule fois, au premier en-tête de proxy venu d\'un pair de boucle, option non réglée', () => {
    let calls = 0
    const addressOf = createAddressResolver(undefined, () => { calls++ })
    addressOf('127.0.0.1', {})
    addressOf('203.0.113.9', { 'x-forwarded-for': '1.2.3.4' })
    assert.equal(calls, 0, 'ni sans en-tête de proxy, ni depuis un pair qui n\'est pas de boucle')
    addressOf('127.0.0.1', { 'x-forwarded-for': '203.0.113.7' })
    addressOf('127.0.0.1', { 'x-forwarded-for': '203.0.113.8' })
    addressOf(undefined, { 'x-real-ip': '203.0.113.8' })
    assert.equal(calls, 1)
  })

  it('l\'avertisseur n\'est jamais appelé quand trustProxy est réglé, même sur une liste qui n\'inclut pas le pair', () => {
    let calls = 0
    const warn = () => { calls++ }
    createAddressResolver('loopback', warn)('127.0.0.1', { 'x-forwarded-for': '203.0.113.7' })
    createAddressResolver(['10.0.0.0/8'], warn)('127.0.0.1', { 'x-forwarded-for': '203.0.113.7' })
    createAddressResolver(false, warn)('127.0.0.1', { 'x-forwarded-for': '203.0.113.7' })
    assert.equal(calls, 0)
  })

  it('un avertisseur qui lève ne casse jamais la résolution de l\'adresse', () => {
    const addressOf = createAddressResolver(undefined, () => { throw new Error('journal cassé') })
    assert.equal(addressOf('127.0.0.1', { 'x-forwarded-for': '203.0.113.7' }), '127.0.0.1')
    assert.equal(addressOf('127.0.0.1', { 'x-forwarded-for': '203.0.113.7' }), '127.0.0.1')
  })
})
