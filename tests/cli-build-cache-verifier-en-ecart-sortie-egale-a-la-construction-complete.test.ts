// `mjs build --cache=verify` sur place, avec un écart (un fichier du cache faussé à la main) et un composant changé : la commande sort en
// code 1, et la sortie devient exactement celle de `mjs build` partie du même état — le .js d'un composant retiré purgé, pages
// prérendues refaites — en développement comme en production

import assert from 'node:assert/strict'
import { appendFileSync, cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, files, gaps, write } from './helpers/construction-cache.js'

const CONFIG  = {
  sourceDir:    'app/modularjs',
  outputDir:    'public/modularjs',
  manifestPath: 'public/modularjs/bundle.js',
  urlPrefix:    '/modularjs',
  render:       { outDir: 'public/pages', routes: { '/': { component: 'mjs-accueil' } }, engine: { prerender: 'happy-dom' } },
}
const SOURCES: Record<string, string> = {
  'accueil.mjs': '<h1 class="t">accueil</h1>\n<mjs-carte></mjs-carte>\n<mjs-pied></mjs-pied>\n',
  'carte.mjs':   '<div class="c">\n  <p>carte</p>\n</div>\n',
  'pied.mjs':    '<footer class="p">pied</footer>\n',
  'libre.mjs':   '<p class="l">libre</p>\n',
}

describe('mjs build --cache=verify : en écart, la sortie devient celle de la construction complète', function () {
  this.timeout(300_000)

  for (const mode of [[], ['--prod']]) {
    it(`${mode.length > 0 ? 'production' : 'développement'} : fichier en trop retiré, pages prérendues refaites, code 1`, function () {
      const root  = mjsTmp('cache-verifier-ecart')
      for (const [rel, data] of Object.entries(SOURCES)) write(join(root, 'app/modularjs', rel), data)
      write(join(root, 'mjs.config.json'), `${JSON.stringify(CONFIG, null, 2)}\n`)
      mkdirSync(join(root, 'node_modules'))
      const pub   = join(root, 'public')
      const state = join(root, 'etat')
      const init  = build(root, [...mode, '--cache'])
      assert.equal(init.status, 0, init.out)
      cpSync(pub, state, { recursive: true })
      const old   = [...files(join(pub, 'modularjs')).keys()].find(f => /^carte-\w+\.js$/.test(f))
      assert.ok(old !== undefined, init.out)
      const gone  = [...files(join(pub, 'modularjs')).keys()].find(f => /^libre-\w+\.js$/.test(f))
      assert.ok(gone !== undefined, init.out)
      // un composant changé (nouveau nom), un autre retiré (son .js reste à purger), et le .js gardé d'un troisième faussé : l'écart
      appendFileSync(join(root, 'app/modularjs/carte.mjs'), '<p>tour 2</p>\n')
      rmSync(join(root, 'app/modularjs/libre.mjs'))
      const cache = join(root, 'node_modules/.cache/mjs/build/files')
      const kept  = [...files(cache).keys()].find(f => /^pied-\w+\.js$/.test(f))
      assert.ok(kept !== undefined, init.out)
      appendFileSync(join(cache, kept), '\n// faussé à la main\n')
      const checked = build(root, [...mode, '--cache=verify'])
      assert.equal(checked.status, 1, checked.out)
      assert.match(checked.out, /cache jeté/, checked.out)
      renameSync(pub, join(root, 'verifie'))
      // la référence : `mjs build` parti du même état
      cpSync(state, pub, { recursive: true })
      const full = build(root, mode)
      assert.equal(full.status, 0, full.out)
      assert.ok(!existsSync(join(pub, 'modularjs', old)) && !existsSync(join(pub, 'modularjs', gone)), full.out)
      assert.deepEqual(gaps(join(root, 'verifie'), pub), [], checked.out)
      const pages = [...files(join(pub, 'pages'))].filter(([rel]) => rel.endsWith('.html'))
      assert.ok(pages.length > 0 && pages.every(([, data]) => data.toString('utf-8').includes('tour 2')), `pages : ${pages.map(([rel]) => rel).join(', ')}`)
      rmSync(state, { recursive: true, force: true })
    })
  }
})
