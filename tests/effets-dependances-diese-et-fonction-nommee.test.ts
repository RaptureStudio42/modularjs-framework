// Dépendances d'une valeur du gabarit et d'un `µeffect` : elles doivent être les mêmes quelle que soit
// l'écriture, et les mêmes en production minifiée qu'en développement.
//
// Défauts garantis absents :
// - un `#` dans l'expression (`{@fmt($n) + ' #'}`) faisait perdre les lectures faites par la méthode : la
//   valeur ne suivait plus `$devise`, lue par `@fmt` ;
// - `µeffect compte` (fonction du script passée par son nom) n'avait aucune dépendance précalculée : minifié,
//   l'effet se relançait à chaque mutation de n'importe quelle variable.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const DIESE = [
  '<script>',
  '$n = 1',
  "$devise = 'EUR'",
  '@fmt = (n) -> n + $devise',
  "$go = -> $devise = 'USD'",
  '</script>',
  "<p class=\"a\">{@fmt($n) + ' #'}</p>",
  "<p class=\"b\">{@fmt($n) + ' -'}</p>",
  '<button class="g" @click={$go()}>go</button>',
]

const NOMMEE = [
  '<script>',
  '$n = 0',
  '$autre = 0',
  'globalThis.__edRuns = 0',
  'compte = ->',
  '  globalThis.__edRuns += 1',
  '  globalThis.__edN = $n',
  'µeffect compte',
  '$go = -> $autre += 1',
  '$go2 = -> $n += 1',
  '</script>',
  '<p class="n">{$n}|{$autre}</p>',
  '<button class="g" @click={$go()}>a</button>',
  '<button class="g2" @click={$go2()}>n</button>',
]

function projetTemporaire(minify: boolean): string {
  const root   = mjsTmp('effets-dependances')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'ed-diese.mjs'), DIESE.join('\n'))
  writeFileSync(join(srcDir, 'ed-nommee.mjs'), NOMMEE.join('\n'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', minify }, null, 2))
  return root
}

describe('dépendances des valeurs et des effets — même résultat quelle que soit l\'écriture', () => {
  it('`µeffect compte` reçoit la liste des variables lues par `compte`, comme un rappel écrit en ligne', async () => {
    const { output } = await transpile(NOMMEE.join('\n'), { moduleName: 'ed-nommee' })
    const m = output.match(/µ\.effect\(compte(?:,\s*(\[[^\]]*\]))?\)/)
    assert.ok(m, `appel µ.effect(compte…) introuvable dans :\n${output}`)
    assert.ok(m![1], `aucune dépendance précalculée : ${m![0]}`)
    assert.deepEqual(JSON.parse(m![1]), ['n'])
  })

  for (const minify of [false, true]) {
    describe(`composants montés${minify ? ' (minifiés)' : ''}`, function () {
      this.timeout(90000)
      let app: any

      before(async () => { app = await createHarness({ root: projetTemporaire(minify) }) })
      // minifié, le harnais ne sait pas démonter un composant seul (ses noms internes `_mjs_…` sont renommés) :
      // `app.destroy()` ferme tout à la fin
      const demonter = (c: any): void => { if (!minify) c.destroy() }
      after(async () => { if (app) await app.destroy() })

      it('`{@fmt($n) + \' #\'}` suit `$devise`, lue par la méthode, comme `{@fmt($n) + \' -\'}`', async () => {
        const c = await app.mount('ed-diese')
        try {
          await c.click('.g')
          await c.tick()
          assert.equal(c.text('.b'), '1USD -')
          assert.equal(c.text('.a'), '1USD #')
        }
        finally { demonter(c) }
      })

      it('`µeffect compte` ne se relance que sur `$n`, la variable que `compte` lit', async () => {
        const c = await app.mount('ed-nommee')
        try {
          const w = app.window
          await c.tick()
          const depart = w.__edRuns
          await c.click('.g')
          await c.tick()
          await c.click('.g')
          await c.tick()
          assert.equal(w.__edRuns, depart, '`$autre` n\'est pas lue par `compte`')
          await c.click('.g2')
          await c.tick()
          assert.equal(w.__edRuns, depart + 1)
          assert.equal(w.__edN, 1)
        }
        finally { demonter(c) }
      })
    })
  }
})
