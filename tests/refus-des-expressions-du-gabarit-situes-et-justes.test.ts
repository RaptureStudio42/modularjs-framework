// une expression du gabarit refusée à la construction : le message cite le fichier, la ligne et la colonne où elle est écrite
// (comme une faute de Civet), et dit ce qu'il faut écrire sans rien de trop
import assert from 'node:assert/strict'
import { monterHote } from './helpers/coeur-monter.js'

const ETAT = "<script>\n$x = 1\n$l = [{n: 1}]\nµ$count = 3\n</script>\n"

async function refus(gabarit: string, prefixe: string): Promise<string> {
  let message = ''
  await assert.rejects(monterHote(ETAT + gabarit + '\n', prefixe), (e: any) => {
    message = String(e?.message ?? e)
    return true
  })
  return message
}

describe('refus des expressions du gabarit : situés et justes', () => {
  const situes: [string, string][] = [
    ['<p>{µ$count}</p>', 'hote.mjs:6:5'],
    ['<p>{{µread: 1}}</p>', 'hote.mjs:6:6'],
    ['<p>{$x + Ꞩy + §z}</p>', 'hote.mjs:6:5'],
  ]
  situes.forEach(([gabarit, place], i) => {
    it(`${gabarit} : refus à sa ligne et sa colonne`, async function () {
      this.timeout(60000)
      const m = await refus(gabarit, `refus-situe-${i}`)
      assert.ok(m.includes(place), m)
    })
  })

  it('{$x := 2} : l\'écriture proposée est « $x = 2 », sans crochet', async function () {
    this.timeout(60000)
    const m = await refus('<p>{$x := 2}</p>', 'refus-declare')
    assert.ok(m.includes('« $x = 2 »') && !m.includes('2]'), m)
  })

  it('un objet écrit comme corps de flèche : le refus dit d\'entourer l\'objet de parenthèses', async function () {
    this.timeout(60000)
    const m = await refus('<p>{$l.map((r) -> { ...r }).length}</p>', 'refus-objet-fleche')
    assert.ok(m.includes('(r) -> ({ ...r })'), m)
  })
})
