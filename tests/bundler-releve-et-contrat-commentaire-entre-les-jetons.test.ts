// Relevé des briques du cœur (src/bundler/features.ts) et contrat du cœur (src/bundler/core-contract.ts) : une écriture coupée
// par un commentaire entre ses jetons (`µ /* c */ .Store`, `µ.every /* c */ (…)`) est du code comme une autre. Le contrat la
// lisait sur les jetons dès qu'un autre nom public était écrit d'un seul tenant dans l'unité, le relevé ne la voyait pas : le
// build était refusé (fonction réclamée, cœur sans elle) ; seule dans son unité, ni l'un ni l'autre ne la voyait, et la page
// s'arrêtait à l'exécution. Les deux lisent maintenant ces écritures de la même façon ; une mention en chaîne ou en
// commentaire ne réclame toujours rien.

import assert from 'node:assert/strict'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { collectCoreCalls } from '../src/bundler/core-contract.js'

const BRIQUES = ['store', 'interpolate', 'ticker', 'every', 'inspect', 'play', 'effect']

function lectures(js: string): { briques: string[]; reclamees: string[] } {
  const used = scanCompiledFeatures(js)
  return {
    briques:   BRIQUES.filter(k => used.has(k)),
    reclamees: [...collectCoreCalls(js)].filter(n => n.startsWith('µ.')).sort(),
  }
}

describe('relevé des briques et contrat du cœur — commentaire entre les jetons', function () {
  it('seule dans son unité : la brique est relevée et le contrat la réclame', () => {
    const cas: Array<[string, string, string]> = [
      ['const Reserve = µ /* c */ .Store\nglobalThis.r = new Reserve({ n: 1 })', 'store', 'µ.Store'],
      ['const p = µ./* c */interpolate(0, 400)', 'interpolate', 'µ.interpolate'],
      ['µ // horloge\n  .Ticker.add(tache)', 'ticker', 'µ.Ticker'],
      ['µ.every /* c */ (1000, f)', 'every', 'µ.every'],
      ["µ /* c */ .inspect('n')", 'inspect', 'µ.inspect'],
      ["µ?./* c */play(noeud, 'pulse')", 'play', 'µ.play'],
      ['µ.effect // c\n  (() => 1)', 'effect', 'µ.effect'],
    ]
    for (const [js, brique, nom] of cas) {
      assert.deepEqual(lectures(js), { briques: [brique], reclamees: [nom] }, JSON.stringify(js))
    }
  })

  it('à côté d\'un nom public écrit d\'un seul tenant : le relevé voit ce que le contrat réclame', () => {
    const cas: Array<[string, string[]]> = [
      ['const R = µ /* c */ .Store\nµ.effect(() => 1)', ['µ.Store', 'µ.effect']],
      ["µ.play(noeud, 'pulse')\nµ /* c */ .inspect('n')", ['µ.inspect', 'µ.play']],
      ['µ.every(1000, f)\nµ.Ticker /* c */ .add(t)\nµ /* c */ .interpolate(0, 1)', ['µ.Ticker', 'µ.every', 'µ.interpolate']],
    ]
    for (const [js, noms] of cas) {
      const { briques, reclamees } = lectures(js)
      assert.deepEqual(reclamees, noms, JSON.stringify(js))
      assert.deepEqual(briques, BRIQUES.filter(k => noms.some(n => n.toLowerCase() === 'µ.' + k)), JSON.stringify(js))
    }
  })

  it('témoin : en chaîne ou en commentaire, rien n\'est réclamé ni embarqué', () => {
    const prose = [
      "const doc = 'µ /* c */ .Store et µ /* c */ .inspect (n)'",
      '// µ /* c */ .every (f) en commentaire',
      '/* µ // c\n .effect (f) */',
    ].join('\n')
    assert.deepEqual(lectures(prose), { briques: [], reclamees: [] })
  })
})
