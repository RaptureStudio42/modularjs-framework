// Un gros message pub/sub (instantané de présence d'un gros groupe de processus, toutes les 15 s) arrive en
// dizaines de tronçons TCP : l'analyseur RESP les empile et ne recolle le tampon qu'une fois le corps annoncé
// arrivé en entier. Avant, chaque tronçon recopiait tout le tampon reçu et relançait l'analyse depuis l'octet 0 :
// coût quadratique (8 Mo en 129 tronçons : 164 ms, contre 3,5 ms d'un seul bloc).
import assert from 'node:assert/strict'
import { RespParser } from '../src/mjs-ws/adapter-redis.js'

const TRONCON = 65536

function trameMessage(corps: string): Buffer {
  return Buffer.from(`*3\r\n$7\r\nmessage\r\n$16\r\nmjs-ws:presence:\r\n$${Buffer.byteLength(corps)}\r\n${corps}\r\n`)
}

// compte les recopies de tampon (Buffer.concat) faites pendant `faire`
function recopies(faire: () => void): number {
  const origine = Buffer.concat
  let n = 0
  Buffer.concat = ((...args: Parameters<typeof Buffer.concat>) => { n++; return origine.apply(Buffer, args) }) as typeof Buffer.concat
  try { faire() } finally { Buffer.concat = origine }
  return n
}

describe('mjs-ws/adapter-redis — RespParser : un gros message en tronçons s\'analyse en temps linéaire', () => {
  it('8 Mo en 129 tronçons : une seule recopie du tampon, la valeur est intacte', () => {
    const corps = 'x'.repeat(8 * 1048576)
    const trame = trameMessage(corps)
    const p = new RespParser()
    const valeurs: unknown[] = []
    const n = recopies(() => { for (let i = 0; i < trame.length; i += TRONCON) valeurs.push(...p.push(trame.subarray(i, i + TRONCON))) })
    assert.equal(valeurs.length, 1)
    const [type, canal, recu] = valeurs[0] as string[]
    assert.equal(type, 'message')
    assert.equal(canal, 'mjs-ws:presence:')
    assert.equal(recu.length, corps.length)
    assert.ok(n <= 2, `${n} recopies du tampon pour ${Math.ceil(trame.length / TRONCON)} tronçons`)
  })

  it('deux messages collés, coupés n\'importe où : les deux sortent, dans l\'ordre, le reliquat est gardé', () => {
    const a = trameMessage('a'.repeat(200000)), b = trameMessage('b'.repeat(70000))
    const flux = Buffer.concat([a, b, Buffer.from('+OK\r\n')])
    const p = new RespParser()
    const valeurs: unknown[] = []
    for (let i = 0; i < flux.length; i += 777) valeurs.push(...p.push(flux.subarray(i, i + 777)))
    assert.equal(valeurs.length, 3)
    assert.equal((valeurs[0] as string[])[2], 'a'.repeat(200000))
    assert.equal((valeurs[1] as string[])[2], 'b'.repeat(70000))
    assert.equal(valeurs[2], 'OK')
  })

  it('un corps qui contient des caractères sur plusieurs octets, coupé au milieu d\'un caractère', () => {
    const corps = 'é'.repeat(50000)
    const trame = trameMessage(corps)
    const p = new RespParser()
    const valeurs: unknown[] = []
    for (let i = 0; i < trame.length; i += 4095) valeurs.push(...p.push(trame.subarray(i, i + 4095)))
    assert.equal((valeurs[0] as string[])[2], corps)
  })
})
