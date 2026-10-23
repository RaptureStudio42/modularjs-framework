// Chapitre MJS-WS de la documentation (docs/23-mjs-ws.md), deux promesses fausses :
// · une trame plus grande que `limits.maxPayload` y fermait la connexion « code 1009 » quel que soit le transport ; avec
//   uWebSockets.js (`transport: 'uws'`), la connexion est coupée sans trame de fermeture et le client voit 1006 (seul `ws` envoie
//   1009). Le comportement de chaque transport est prouvé par tests/mjs-ws-trame-trop-grande-fermeture-par-transport.test.ts ;
// · le serveur relaie les identités et les clés au nom réservé (`__proto__`, `constructor`, `prototype`) : `GET /presence` ne
//   montre donc plus la présence « telle que la voit `sock.presence()` », qui les écarte, et `snapshot()` d'un flux porte
//   `__proto__` en clé propre, qu'une recopie par `Object.assign` ou `for…in` dans un objet ordinaire prend pour son prototype.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DOC    = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', '23-mjs-ws.md'), 'utf8')
const LIGNES = DOC.split('\n')

// texte d'une section, de son titre au titre suivant de même niveau
function section(titre: string): string {
  const debut = LIGNES.findIndex(l => l.startsWith(titre))
  assert.ok(debut >= 0, 'section trouvée : ' + titre)
  const niveau = titre.split(' ')[0]
  const fin    = LIGNES.findIndex((l, i) => i > debut && l.startsWith(niveau + ' '))
  return LIGNES.slice(debut, fin < 0 ? undefined : fin).join('\n')
}

describe('documentation MJS-WS : trame trop grande et noms relayés', () => {
  it('trame trop grande : chaque mention du code 1009 dit aussi ce que voit un client de uWebSockets.js (1006)', () => {
    const mentions = LIGNES.filter(l => l.includes('1009'))
    assert.ok(mentions.length > 0, 'le code 1009 reste documenté pour `ws`')
    for (const l of mentions) assert.match(l, /1006/, 'mention sans le cas uWebSockets.js : ' + l.slice(0, 120))
    const maxPayload = LIGNES.find(l => l.startsWith('| `limits.maxPayload`'))
    assert.ok(maxPayload, 'ligne de limits.maxPayload')
    assert.match(maxPayload, /`ws`/)
    assert.match(maxPayload, /'uws'|`uws`/)
    const uws = LIGNES.find(l => l.startsWith('| `maxPayloadLength`'))
    assert.ok(uws, 'ligne maxPayloadLength du chapitre uWebSockets.js')
    assert.match(uws, /1006/)
  })

  it('`GET /presence` : la présence telle que le serveur la tient, noms réservés compris', () => {
    const ligne = LIGNES.find(l => l.startsWith('**`GET /presence`**'))
    assert.ok(ligne, 'paragraphe GET /presence')
    assert.doesNotMatch(ligne, /telle que la voit `sock\.presence\(\)`/)
    assert.match(ligne, /`__proto__`/)
    assert.match(ligne, /`constructor`/)
    assert.match(ligne, /`prototype`/)
  })

  it('flux : `snapshot()` porte `__proto__` en clé propre, et la doc montre la recopie sûre', () => {
    const flux = section('## 5. Les flux qui se rattrapent')
    assert.match(flux, /`__proto__`/)
    assert.match(flux, /Object\.assign/)
    assert.match(flux, /Object\.create\(null\)/)
    assert.match(flux, /new Map\(/)
    assert.match(flux, /Object\.hasOwn\(/)
  })
})
