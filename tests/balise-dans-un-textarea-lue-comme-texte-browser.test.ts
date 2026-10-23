// Dans un <textarea> (ou un <title> HTML), le navigateur ne lit que du texte jusqu'à la fermante :
// `<textarea><b x={$v}>hé</b> fin</textarea>` y affiche `<b x={$v}>hé</b> fin`. Le compilateur y créait un élément
// `<b>` et une liaison sur `x` ; la balise est désormais un texte, gardé tel qu'écrit, comme dans le navigateur

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { transpile } from '../src/transpiler/index.js'

const CHAMP = '<textarea aria-label="t"><b x={$v}>hé</b> fin</textarea>'

const compiler = async (html: string) => transpile(`<script>\n$v = 1\n</script>\n<div>${html}<p>{$v}</p></div>\n`, { moduleName: 'champ-balise' })

const gabarit = async (html: string): Promise<string> => {
  const m = /_mjs_cloneTpl\("((?:[^"\\]|\\.)*)"\)/.exec((await compiler(html)).output)
  assert.ok(m, 'gabarit introuvable')
  return JSON.parse(`"${m![1]}"`)
}

describe('balise écrite dans un textarea ou un title : un texte', function () {
  this.timeout(120000)

  it('ni élément ni liaison dans le champ ; la valeur qui suit le champ reste lue', async () => {
    const r = await compiler(CHAMP)
    assert.doesNotMatch(r.output, /_mjs_updAttr\('[^']+', 'x'/)
    assert.match(r.output, /_mjs_updText\('t\d+', \$\.v\)/)
    assert.match(await gabarit('<title><b x={$v}>t</b></title>'), /<title>(?:<|&lt;)b x=\{\$v\}(?:>|&gt;)t(?:<|&lt;)\/b(?:>|&gt;)<\/title>/)
  })

  it('le texte du champ est celui que Chromium lit dans la même source', async function () {
    let playwright: any
    try { playwright = await import('playwright') } catch { this.skip() }
    if (!existsSync(playwright.chromium.executablePath())) this.skip()
    const html = await gabarit(CHAMP)
    const navigateur = await playwright.chromium.launch()
    try {
      const page = await navigateur.newPage()
      const [compile, natif] = await page.evaluate(([a, b]: string[]) => {
        const lire = (h: string) => { const t = document.createElement('template'); t.innerHTML = h; return [t.content.querySelector('textarea')!.value, t.content.querySelectorAll('b').length] }
        return [lire(a), lire(b)]
      }, [html, CHAMP])
      assert.deepEqual(compile, natif)
    }
    finally { await navigateur.close() }
  })
})
