// passes de masques du compilateur sur des constructions jamais fermées (`<!--` sans fin, `<pre x` ou `<code x` sans `>`,
// `<pre>` ou `<code>` sans fermante) : la fin absente se cherche une fois, jamais jusqu'à la fin du texte depuis chaque
// ouverture ; lu par des rapports de temps (la même construction fermée pour témoin, ou deux tailles), jamais par une durée
// fixe : sûr sous charge

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { maskDocBlocks } from '../src/transpiler/lint.js'
import { maskHtmlComments, readHtmlComment } from '../src/mask.js'

const N      = 16000
const SCRIPT = '<script>\n$n = 0\n$s = "x"\n</script>\n'

// construction jamais fermée, et son témoin : la même fermée, au même compte (tout le travail de masque, sans relecture)
const FORMES: Record<string, [string, string]> = {
  '<!-- sans fin':        ['<!-- a\n', '<!-- a -->\n'],
  '<!-- <code> sans fin': ['<!-- <code>\n', '<!-- <code> -->\n'],
  '<pre x sans >':        ['<pre x', '<pre x>a</pre>'],
  '<code x sans >':       ['<code x', '<code x>a</code>'],
  '<pre> sans </pre>':    ['<pre>a\n', '<pre>a</pre>\n'],
  '<code> sans </code>':  ['<code>a\n', '<code>a</code>\n'],
}

// gabarit entier aux commentaires jamais fermés : refusé, le temps est payé avant le refus
const GABARITS: Record<string, (n: number) => string> = {
  '<!-- sans fin': (n) => SCRIPT + '<!-- a\n'.repeat(n) + '<p>{$n}</p>\n',
}

// meilleure durée de `fois` appels, en millisecondes
function duree(f: () => unknown, fois = 5): number {
  let best = Infinity
  for (let k = 0; k < fois; k++) {
    const debut = performance.now()
    f()
    best = Math.min(best, performance.now() - debut)
  }
  return best
}

// rapport entre la construction jamais fermée et son témoin fermé : au plus 1 ou 2 quand la fin absente ne se cherche
// qu'une fois, plusieurs dizaines avec une relecture depuis chaque ouverture
function rapport(f: (s: string) => unknown, [ouverte, fermee]: [string, string]): number {
  const lent   = ouverte.repeat(N)
  const temoin = fermee.repeat(N)
  f(lent)
  f(temoin)
  return duree(() => f(lent), 3) / duree(() => f(temoin))
}

// meilleure durée de trois compilations, une compilation refusée comprise
async function dureeCompile(src: string): Promise<number> {
  let best = Infinity
  for (let k = 0; k < 3; k++) {
    const debut = performance.now()
    try {
      await transpile(src, { moduleName: 'cas' })
    }
    catch {
      // gabarit refusé : seul le temps compte
    }
    best = Math.min(best, performance.now() - debut)
  }
  return best
}

// lit le commentaire ouvert à chaque `<!--` du texte, comme les passes qui avancent de commentaire en commentaire
function lireCommentaires(s: string): void {
  for (let i = s.indexOf('<!--'); i !== -1; i = s.indexOf('<!--', i + 1)) readHtmlComment(s, i)
}

describe('masques du compilateur : une construction jamais fermée se lit en temps linéaire', function () {
  this.timeout(60000)

  for (const [nom, forme] of Object.entries(FORMES)) {
    it(`maskDocBlocks, ${nom} : pas plus lent que la même fermée`, () => {
      const r = rapport(maskDocBlocks, forme)
      assert.ok(r < 4, `rapport ${r.toFixed(1)}`)
    })
  }

  it('maskHtmlComments, <!-- sans fin : pas plus lent que la même fermée', () => {
    const r = rapport(maskHtmlComments, FORMES['<!-- sans fin'])
    assert.ok(r < 4, `rapport ${r.toFixed(1)}`)
  })

  it('readHtmlComment à chaque <!-- du texte, sans fin : pas plus lent que la même fermée', () => {
    const r = rapport(lireCommentaires, FORMES['<!-- sans fin'])
    assert.ok(r < 4, `rapport ${r.toFixed(1)}`)
  })

  // quatre fois plus de texte : quatre fois plus de temps en lecture linéaire, seize avec une relecture par ouverture
  for (const [nom, gabarit] of Object.entries(GABARITS)) {
    it(`compilation entière, ${nom} : quatre fois plus de texte, moins de huit fois plus de temps`, async () => {
      await dureeCompile(gabarit(2000))
      const petit = await dureeCompile(gabarit(2000))
      const grand = await dureeCompile(gabarit(8000))
      assert.ok(grand < 8 * petit, `${petit.toFixed(0)} ms puis ${grand.toFixed(0)} ms`)
    })
  }
})
