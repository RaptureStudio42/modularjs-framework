// une valeur qui attend parcourue par `for x from $r` en CoffeeScript avant sa première réponse : le chapitre 3 dit qu'une boucle
// `for … of` lit une liste vide, et CoffeeScript l'écrit `for … from`. Elle parcourt une liste vide, sans TypeError, à chaque lecture, en
// développement comme en production. En développement, un seul avis, qui cite la boucle telle qu'écrite en CoffeeScript :
// `for … from ($r or [])`, jamais `for … of`, qui y parcourt les clés (happy-dom, vraie construction)
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monter } from './helpers/derivee-await-banc.js'

const SOURCES: Record<string, string> = {
  'depuis.mjs': '<script lang="coffee">\n  f  = (q) -> fetch("/api/t-#{q}").then((r) -> r.json())\n  $r = await f(1)\n  @lit = ->\n    a = []\n    a.push(x) for x from $r\n    a.length\n</script>\n<i>x</i>\n',
}

describe('boucle for … from de CoffeeScript sur une valeur qui attend, avant sa première réponse', function () {
  this.timeout(200000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const env of ['dev', 'prod'] as const) {
    describe(env === 'dev' ? 'en développement' : 'en production', () => {
      let w: any
      const rendus: string[] = []
      const avis = (): string[] => [...w.__avis].filter((a: string) => a.includes('<mjs-depuis>') && /lit \$r avant sa première réponse/.test(a))

      before(async () => {
        w = await monter('boucle-coffee-' + env, SOURCES, '<mjs-depuis></mjs-depuis>', env)
        for (let i = 0; i < 2; i++) {
          try { rendus.push('rend ' + JSON.stringify(w.document.querySelector('mjs-depuis').lit())) }
          catch (e: any) { rendus.push('lève ' + String(e?.message)) }
        }
      })
      after(() => { w?.close() })

      it('for x from $r : une liste vide, sans erreur, à chaque lecture', () => {
        assert.deepEqual(rendus, ['rend 0', 'rend 0'])
      })

      if (env === 'dev') {
        it('for x from $r : un seul avis, qui cite for … from, son conseil for … from ($r or []), jamais for … of', () => {
          const a = avis()
          assert.equal(a.length, 1, a.join('\n'))
          assert.ok(a[0].includes('for … from $r lit $r') && a[0].includes('Écrivez for … from ($r or [])'), a[0])
          assert.ok(!a[0].includes('for … of'), a[0])
        })
      }
    })
  }
})
