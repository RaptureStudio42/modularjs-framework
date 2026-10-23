// `el` dans un `@attach` : l'expression qui lit `el` sans que rien ne le lie reçoit la balise (mode direct, comme avec `_node`) ; le `el` de l'auteur garde
// la main et le mode ne change pas quand l'expression le lie elle-même (paramètre d'une fonction), quand il n'est qu'une chaîne ou une propriété, ou quand
// le script de l'auteur le déclare (variable, fonction, `@this=!{el}`)

import assert from 'node:assert/strict'
import * as acorn from 'acorn'
import { transpile } from '../src/transpiler/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SCRIPT = `<script>
  $plays = [{ key: 'a' }]
  $p     = Promise.resolve({ n: 1 })
  dessiner = (n, p) -> n.dataset.d = p
  marque   = (txt) -> (n) -> n.dataset.d = txt
</script>`

// le JS émis, vérifié syntaxiquement : un `const el` posé deux fois dans le même bloc, ou à côté d'un autre `el`, ne se parserait pas
async function emis(corps: string, script = SCRIPT): Promise<string> {
  const sortie = (await transpile(`${script}\n${corps}\n`, { moduleName: 'attache-el' })).output
  acorn.parse(sortie.replace(/µ\.asset\(['"]([^'"]+)['"]\)/g, "'/__placeholder/$1'"), { ecmaVersion: 'latest', sourceType: 'module' })
  return sortie
}

const POSE = 'const el = _node;'

describe('@attach : `el`, second nom de la balise', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const posees: Array<[string, string]> = [
    ['à la racine',                  `<canvas @attach={dessiner(el, 'r')}></canvas>`],
    ['à la racine, .once',           `<canvas @attach.once={dessiner(el, 'r')}></canvas>`],
    ['dans une ligne de {for}',      `{for p in $plays by key}<canvas @attach={dessiner(el, p.key)}></canvas>{end}`],
    ['dans une ligne de {for}, .once', `{for p in $plays by key}<canvas @attach.once={dessiner(el, p.key)}></canvas>{end}`],
    ['dans {success}',               `{await $p}<i>attente</i>{success v}<canvas @attach={dessiner(el, v.n)}></canvas>{end}`],
    ['dans {success}, .once',        `{await $p}<i>attente</i>{success v}<canvas @attach.once={dessiner(el, v.n)}></canvas>{end}`],
    ['dans {success}, lisant aussi une variable', `{await $p}<i>attente</i>{success v}<canvas @attach={dessiner(el, $plays)}></canvas>{end}`],
    ['dans l\'attente',              `{await $p}<canvas @attach.once={dessiner(el, 'a')}></canvas>{success v}<b>{v.n}</b>{end}`],
    ['dans {error}',                 `{await $p}<i>attente</i>{success v}<b>{v.n}</b>{error err}<canvas @attach.once={dessiner(el, err.message)}></canvas>{end}`],
    ['avec `_node` dans la même expression', `<canvas @attach={dessiner(el, _node)}></canvas>`],
    ['avec un `el` propriété à côté', `{for p in $plays by key}<canvas @attach={dessiner(el, p.el)}></canvas>{end}`]
  ]
  for (const [nom, corps] of posees) {
    it(`${nom} : mode direct, la balise est posée sous le nom \`el\``, async () => {
      const js = await emis(corps)
      assert.ok(js.includes('(mode direct)'), 'mode direct')
      assert.ok(!js.includes('(mode factory)'), 'pas de mode fabrique')
      assert.ok(js.includes(POSE), `la balise est posée : ${POSE}`)
      assert.ok(js.includes('const _mjs_clean = dessiner(el,'), 'l\'expression est la valeur du nettoyage, comme avec `_node`')
    })
  }

  const gardees: Array<[string, string, string?]> = [
    ['paramètre d\'une fonction en ligne',   `<canvas @attach={(el) -> el.dataset.d = 'x'}></canvas>`],
    ['paramètre d\'une fonction, .once',     `<canvas @attach.once={(el) -> el.dataset.d = 'x'}></canvas>`],
    ['paramètre d\'une fonction, dans une ligne de {for}', `{for p in $plays by key}<canvas @attach={(el) -> el.dataset.d = p.key}></canvas>{end}`],
    ['chaîne',                               `<canvas @attach={marque('el')}></canvas>`],
    ['propriété',                            `{for p in $plays by key}<canvas @attach={marque(p.el)}></canvas>{end}`],
    ['fabrique',                             `<canvas @attach={marque('x')}></canvas>`],
    ['le script déclare une variable `el`',  `<canvas @attach={marque(el)}></canvas>`, `<script>\n  el = { nom: 'mien' }\n  marque = (v) -> (n) -> n.dataset.d = v.nom\n</script>`],
    ['le script déclare `el`, .once',        `<canvas @attach.once={marque(el)}></canvas>`, `<script>\n  el = { nom: 'mien' }\n  marque = (v) -> (n) -> n.dataset.d = v.nom\n</script>`],
    ['le script déclare `el`, ligne de {for}', `{for p in $plays by key}<canvas @attach={marque(el)}></canvas>{end}`, `<script>\n  $plays = [{ key: 'a' }]\n  el = { nom: 'mien' }\n  marque = (v) -> (n) -> n.dataset.d = v.nom\n</script>`],
    ['le script déclare `el`, branche {success}', `{await $p}<i>attente</i>{success v}<canvas @attach={marque(el)}></canvas>{end}`, `<script>\n  $p = Promise.resolve(1)\n  el = { nom: 'mien' }\n  marque = (v) -> (n) -> n.dataset.d = v.nom\n</script>`],
    ['le script déclare une fonction `el`',  `<canvas @attach={marque(el(1))}></canvas>`, `<script>\n  el = (x) -> { nom: 'f' + x }\n  marque = (v) -> (n) -> n.dataset.d = v.nom\n</script>`],
    ['le script déclare `el` en JavaScript', `<canvas @attach={marque(el)}></canvas>`, `<script lang="js">\n  var el = { nom: 'mien' }\n  const marque = (v) => (n) => { n.dataset.d = v.nom }\n</script>`],
    ['la balise est liée à `el` par @this',  `<canvas @this=!{el} @attach={marque(el)}></canvas>`, `<script>\n  marque = (v) -> (n) -> n.dataset.d = String(v)\n</script>`]
  ]
  for (const [nom, corps, script] of gardees) {
    it(`${nom} : mode fabrique, aucun \`el\` n'est posé`, async () => {
      const js = await emis(corps, script)
      assert.ok(js.includes('(mode factory)'), 'mode fabrique')
      assert.ok(!js.includes('(mode direct)'), 'pas de mode direct')
      assert.ok(!js.includes(POSE), 'la balise n\'est pas posée sous le nom `el`')
    })
  }
})
