// µafter dans les trois moteurs réels, en production, quand l'appli n'écrit aucun appel : son seul accès est un alias de la
// rune (`a = µafter`). Le module des minuteries entre quand même au cœur : l'appel par l'alias part, et deux poses par
// l'alias sous un même nom n'en font tirer qu'une
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, ouvrir, type Page, type Session } from './helpers/editeur-riche.js'

// aucun autre code dans l'appli, ni module cœur (l'éditeur écrit des minuteries, il ferait entrer le module) : `morceaux: false`
const SOURCE = `<p class="etat">{$go}</p>
<button class="seul" @click={-> seul()}>seul</button>
<button class="deux" @click={-> deux()}>deux</button>
<button class="go" @click={-> $go = $go + 1}>go</button>

<script>
  window.__j = window.__j or []
  $go = 0
  a = µafter
  seul = ->
    try
      a 30, -> window.__j.push('s')
    catch e
      window.__err = String(e)
  deux = ->
    try
      a 30, { id: 'x' }, -> window.__j.push('x')
      a 30, { id: 'x' }, -> window.__j.push('x')
    catch e
      window.__err = String(e)
</script>
`
const PAGE: Page = {
  cle:      'acces-indirect',
  morceaux: false,
  attente:  `(() => { const h = document.querySelector('mjs-hote'); return !!(h && h._shadow && h._shadow.querySelector('button.go')) })()`,
  aides:    `window.__clic = (cls) => document.querySelector('mjs-hote')._shadow.querySelector('button.' + cls).click(); window.__compte = (x) => (window.__j || []).filter((y) => y === x).length; 0`,
  source:   SOURCE,
}
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

for (const nom of MOTEURS) describe(`µafter — alias de la rune, sans appel écrit dans l'appli (prod, ${nom} réel)`, function () {
  this.timeout(60000)
  let s: Session | null = null
  const E = (expr: string): Promise<any> => s!.page.evaluate(expr)
  before(async function () {
    s = await ouvrir(nom, 'prod', PAGE)
    if (!s) this.skip()
  })
  after(async () => {
    if (s) await s.fermer()
    s = null
    await terminateSharedWorkerPool()
  })

  it('l\'appel par l\'alias part : le module des minuteries est au cœur', async () => {
    await E('__clic("seul")')
    await dormir(250)
    const n = await E('__compte("s")')
    assert.equal(n, 1, `${n} tir ; erreur : ${await E('window.__err || ""')} ; console : ${JSON.stringify(s!.logs.slice(-6))}`)
  })

  it('deux poses par l\'alias sous un même nom : une seule tire', async () => {
    await E('__clic("deux")')
    await dormir(250)
    const n = await E('__compte("x")')
    assert.equal(n, 1, `${n} tirs sous le nom x ; erreur : ${await E('window.__err || ""')} ; console : ${JSON.stringify(s!.logs.slice(-6))}`)
  })
})
