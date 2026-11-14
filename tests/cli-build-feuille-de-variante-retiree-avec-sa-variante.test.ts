// une feuille `<module>.<nom>.css` que la construction écrit pour un `<style name>` part avec sa variante : six étapes construites sur
// place (un composant changé, la variante retirée, un composant supprimé, un thème changé, rien de changé), dans les trois modes `css`,
// donnent chacune à l'octet la sortie d'une construction neuve des mêmes sources — `mjs build` comme `mjs build --cache=verifier`, qui
// ne signale aucun écart. Restée sur place, la feuille passait pour une feuille déposée à la main : le cœur gardait le module des
// variantes, et tout ce qui l'importe changeait de nom

import assert from 'node:assert/strict'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, gaps, write } from './helpers/construction-cache.js'

const SOURCES: Record<string, string> = {
  'app/titre.mjs':               '<h1 class="t">Titre</h1>\n<p class="p">petit</p>\n<style>\n  .t\n    font-size: 41.5px\n  .p\n    font-size: 12px\n</style>\n<style name="bandeau">\n  .t\n    font-size: 33px\n</style>\n<theme>\n  font-size: 30px\n</theme>\n',
  'app/carte.mjs':               '<p class="x">carte</p>\n<p class="y">grand</p>\n<style lang="css">\n  .x {\n    /* gros titre */\n    font-size: 36px;\n  }\n  .y { color: red; /* sous-titre */ font-size: 44px; }\n  .z { font-size: 45px; }\n</style>\n',
  'app/styles/base.css':         '/* feuille partagee */\n.b {\n  /* note */\n  font-size: 50px;\n}\n.c { font-size: 52px; }\n',
  'app/styles/mjs_root.scss':    '.grand { font-size: 64px; }\n',
  'app/themes/sombre.theme.mjs': '<theme>\n  font-size: 70px\n</theme>\n'
}

// chaque étape change les sources de l'appli construite sur place
const STEPS: [string, (root: string) => void][] = [
  ['construction à froid', () => {}],
  ['un composant changé', root => write(join(root, 'app/carte.mjs'), '<p class="x">carte</p>\n<style lang="css">\n  .x { font-size: 36px; }\n  .w { font-size: 77px; }\n</style>\n')],
  ['la variante retirée', root => write(join(root, 'app/titre.mjs'), '<h1 class="t">Titre</h1>\n<style>\n  .t\n    font-size: 2rem\n</style>\n')],
  ['un composant supprimé', root => rmSync(join(root, 'app/carte.mjs'))],
  ['un thème changé', root => write(join(root, 'app/themes/sombre.theme.mjs'), '<theme>\n  font-size: 80px\n</theme>\n')],
  ['rien de changé', () => {}]
]

function project(prefix: string, css: string): string {
  const root = mjsTmp(prefix)
  for (const [rel, data] of Object.entries(SOURCES)) write(join(root, rel), data)
  write(join(root, 'mjs.config.json'), `${JSON.stringify({ sourceDir: 'app', outputDir: 'public/m', manifestPath: 'public/m/bundle.js', urlPrefix: '/m', stylesheetsDir: 'app/styles', css }, null, 2)}\n`)
  mkdirSync(join(root, 'node_modules'))
  return root
}

describe('mjs build sur place : la feuille d\'une variante retirée part, la sortie reste celle d\'une construction neuve', function () {
  this.timeout(300_000)

  for (const css of ['bundle', 'split', 'lazy']) {
    it(`css: '${css}' : six étapes, sans le cache et sous --cache=verifier`, function () {
      const checked = project('variante-retiree-verifier', css)
      const plain   = project('variante-retiree-sans', css)
      for (const [i, [step, change]] of STEPS.entries()) {
        change(checked)
        change(plain)
        const served = build(checked, i === 0 ? ['--cache'] : ['--cache=verifier'])
        assert.equal(served.status, 0, `${step} : ${served.out}`)
        if (i > 0) assert.match(served.out, /^cache vérifié : /m, `${step} : ${served.out}`)
        const again = build(plain, [])
        assert.equal(again.status, 0, `${step} : ${again.out}`)
        // la référence : les mêmes sources construites dans un dossier neuf
        const fresh = mjsTmp('variante-retiree-neuf')
        cpSync(join(plain, 'app'), join(fresh, 'app'), { recursive: true })
        cpSync(join(plain, 'mjs.config.json'), join(fresh, 'mjs.config.json'))
        const ref = build(fresh, [])
        assert.equal(ref.status, 0, `${step} : ${ref.out}`)
        assert.deepEqual(gaps(join(checked, 'public'), join(fresh, 'public')), [], `${step} (--cache=verifier) : ${served.out}`)
        assert.deepEqual(gaps(join(plain, 'public'), join(fresh, 'public')), [], `${step} (sans le cache) : ${again.out}`)
        // la feuille retirée est annoncée comme les autres retraits
        if (step === 'la variante retirée') for (const out of [served.out, again.out]) assert.match(out, /^ {3}– titre\.bandeau\.css$/m, out)
        rmSync(fresh, { recursive: true, force: true })
      }
    })
  }
})
