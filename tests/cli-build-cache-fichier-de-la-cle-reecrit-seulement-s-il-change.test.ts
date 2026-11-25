// `mjs build --cache` : le fichier de la clé du cache (`<clé>.json`) n'est réécrit que si son contenu change. Une construction sans
// changement le laisse tel quel (même fichier, même contenu) et avance seulement sa date, que l'élagage lit pour garder les clés servies
// le plus récemment ; la trace du dernier passage (`last.json`) reste écrite à chaque construction. Une entrée qui bouge (composant
// changé) le réécrit. La construction qui suit une construction complète peut le réécrire une fois, ce qu'elle garde n'étant pas tout
// à fait ce que la construction complète a noté (en production, la place de chaque fichier dans la suite des minifications ; les
// dépendances notées à froid), la suivante non

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, write } from './helpers/construction-cache.js'

const CONFIG = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs' }

// trois composants et un dossier node_modules (le cache s'y écrit)
function project(label: string): string {
  const root = mjsTmp(label)
  for (const name of ['accueil', 'carte', 'pied']) write(join(root, `app/modularjs/${name}.mjs`), `<script>\n$n = 1\n</script>\n<p class="${name}">${name} {$n}</p>\n`)
  write(join(root, 'mjs.config.json'), `${JSON.stringify(CONFIG, null, 2)}\n`)
  mkdirSync(join(root, 'node_modules'))
  return root
}

// le fichier de la clé (une seule clé ici) : son inode (un fichier réécrit est un temporaire renommé, d'un autre inode), sa date, son
// contenu ; et la date de last.json
function keyFile(root: string): { ino: number, mtime: number, text: string, last: number } {
  const dir  = join(root, 'node_modules/.cache/mjs/build')
  const keys = readdirSync(dir).filter(f => /^[0-9a-f]{16}\.json$/.test(f))
  assert.equal(keys.length, 1, keys.join(', '))
  const path = join(dir, keys[0])
  const stat = statSync(path)
  return { ino: stat.ino, mtime: stat.mtimeMs, text: readFileSync(path, 'utf-8'), last: statSync(join(dir, 'last.json')).mtimeMs }
}

describe('mjs build --cache : fichier de la clé réécrit seulement s\'il change', function () {
  this.timeout(300_000)

  for (const prod of [false, true]) {
    it(`${prod ? 'production' : 'développement'} : sans changement, même fichier et date avancée ; un composant changé le réécrit`, function () {
      const root = project(`cache-cle-reecrite${prod ? '-prod' : ''}`)
      const args = prod ? ['--prod', '--cache'] : ['--cache']
      for (const pass of ['à froid', 'repris une fois']) {
        const done = build(root, args)
        assert.equal(done.status, 0, `${pass} :\n${done.out}`)
      }
      const before = keyFile(root)
      const again  = build(root, args)
      assert.equal(again.status, 0, again.out)
      assert.match(again.out, /^cache : \d+ fichiers repris, 0 recompilé$/m, again.out)
      const same = keyFile(root)
      assert.equal(same.text, before.text, 'contenu du fichier de la clé changé sans aucun changement des sources')
      assert.equal(same.ino, before.ino, 'fichier de la clé réécrit alors que rien n\'a changé')
      assert.ok(same.mtime > before.mtime, `date du fichier de la clé non avancée (${before.mtime} puis ${same.mtime})`)
      assert.ok(same.last > before.last, 'last.json non écrit')
      const pied = join(root, 'app/modularjs/pied.mjs')
      writeFileSync(pied, readFileSync(pied, 'utf-8').replace('pied {$n}', 'pied changé {$n}'))
      const changed = build(root, args)
      assert.equal(changed.status, 0, changed.out)
      assert.match(changed.out, /^cache : \d+ fichiers repris, 1 recompilé$/m, changed.out)
      const moved = keyFile(root)
      assert.notEqual(moved.text, same.text, 'une entrée a bougé : le contenu doit changer')
      assert.notEqual(moved.ino, same.ino, 'une entrée a bougé : le fichier de la clé doit être réécrit')
    })
  }
})
