// Dans un <svg> (ou un <math>), le contenu d'un bloc {for}/{if} est construit à part, hors de la
// balise englobante : il doit quand même naître dans l'espace de noms SVG (ou MathML). Le défaut :
// un élément placé APRÈS un {if} dans un {for} (ou un <a>, ou un contenu qui commence par un bloc)
// sortait en HTMLUnknownElement, ne se dessinait pas, et le build restait vert. happy-dom ne connaît
// pas l'espace de noms MathML (même un <math> écrit en dur y sort en HTML) : pour <math>, le test lit
// le code produit — la ligne du {for} se lit dans une balise <math>.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('SVG et MathML — le contenu d\'un bloc garde l\'espace de noms de sa balise', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('svg-espace-de-noms-sous-bloc')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'dessin.mjs'), [
      '<script>',
      '$vu = true',
      '$items = [{ id: 1, on: true }, { id: 2, on: false }]',
      '</script>',
      '<svg viewBox="0 0 10 10">',
      '  {for it in $items}',
      '    {if it.on}<circle class="rond" r="1"></circle>{end}',
      '    <rect class="apres-if" width="1" height="1"></rect>',
      '  {end}',
      '  {if $vu}<a href="#x" aria-label="lien"><rect class="dans-a" width="1" height="1"></rect></a>{end}',
      '  {if $vu}{if $vu}<circle class="rond2" r="1"></circle>{end}<line class="apres-if2" x2="1"></line>{end}',
      '</svg>',
    ].join('\n'))
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('un élément après un {if} dans un {for}, un <a>, un contenu qui ouvre sur un bloc : tous en SVG', async () => {
    window.document.body.innerHTML = '<mjs-dessin></mjs-dessin>'
    const comp = window.document.querySelector('mjs-dessin')
    await attendre(() => comp._shadow?.querySelectorAll('.apres-if2').length === 1)
    const espaces = (sel: string): string[] => [...comp._shadow.querySelectorAll(sel)].map((el: any) => el.namespaceURI)
    assert.deepEqual(espaces('.apres-if'), [SVG_NS, SVG_NS], 'le <rect> après le {if} de chaque ligne')
    assert.deepEqual(espaces('.rond'), [SVG_NS], 'le <circle> du {if}')
    assert.deepEqual(espaces('svg > a'), [SVG_NS], 'un <a> dans le <svg> est un lien SVG')
    assert.deepEqual(espaces('.dans-a'), [SVG_NS])
    assert.deepEqual(espaces('.rond2'), [SVG_NS])
    assert.deepEqual(espaces('.apres-if2'), [SVG_NS], 'un contenu qui ouvre sur un bloc')
  })

  it('un {for} dans <math> : la ligne se lit dans une balise <math>', async () => {
    const { output } = await transpile('<script>\n$items = [1, 2]\n</script>\n<math>{for it in $items}<mi>{it}</mi>{end}</math>\n', { moduleName: 'formule' })
    assert.match(output, /µ\._mjs_cloneTpl\("<math><mi>/, 'la ligne du {for} naît dans <math>')
  })
})
