// µafter / µevery dans les trois moteurs réels. En développement et en production : un `onStop` qui repose une minuterie
// sous son propre nom pendant que ce nom change de minuterie n'en laisse tourner qu'une, la neuve. En production : les
// minuteries d'un fichier `.js` importé par `µimport`, posées hors de tout composant actif, partent — le composant n'en pose
// aucune hors de lui, seule la lecture du `.js` fait entrer le niveau de la page au cœur — et leur nom vaut pour la page
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, ouvrir, type Page, type Session } from './helpers/editeur-riche.js'

// un module cœur dans la page : l'aide des navigateurs bâtit la production en un morceau par module
const SOURCE = `<p class="etat">{$go}</p>
<button class="chaine" @click={-> chaine()}>chaine</button>
<button class="js" @click={-> poserJs()}>js</button>
<button class="go" @click={-> $go = $go + 1}>go</button>
<@@editor class="g" name="g" toolbar="bold"></@@editor>

<script module>
  window.__x = 1
</script>

<script>
  window.__j = window.__j or []
  $go = 0
  chaine = -> µafter 30, id: 'c', onStop: (-> chaine() if window.__ch), -> window.__j.push('c')
  poserJs = ->
    try
      m = await µimport('./aide.js')
      m.poser(µ)
      m.poser(µ)
      m.page(µ)
    catch e
      window.__err = String(e)
</script>
`
// le .js reçoit µ de son appelant (en production, µ n'est pas une variable globale) et l'écrit en clair, `µ.after(`
const AIDE = "export const poser = (µ) => µ.after(30, { id: 'x' }, () => window.__j.push('x'))\nexport const page = (µ) => µ.after(30, () => window.__j.push('p'))\n"
const PAGE: Page = {
  cle:      'chaine-et-js',
  attente:  `(() => { const h = document.querySelector('mjs-hote'); return !!(h && h._shadow && h._shadow.querySelector('button.go')) })()`,
  aides:    `window.__clic = (cls) => document.querySelector('mjs-hote')._shadow.querySelector('button.' + cls).click(); window.__compte = (x) => window.__j.filter((y) => y === x).length; 0`,
  source:   SOURCE,
  fichiers: { 'aide.js': AIDE },
}
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

for (const build of ['dev', 'prod'] as const) for (const nom of MOTEURS) describe(`µafter / µevery — remplacement d'un nom, fichier .js importé (${build}, ${nom} réel)`, function () {
  this.timeout(60000)
  let s: Session | null = null
  const E = (expr: string): Promise<any> => s!.page.evaluate(expr)
  before(async function () {
    s = await ouvrir(nom, build, PAGE)
    if (!s) this.skip()
  })
  after(async () => {
    if (s) await s.fermer()
    s = null
    await terminateSharedWorkerPool()
  })

  it('un onStop qui repose une minuterie sous son propre nom pendant le remplacement : une seule minuterie de ce nom tire', async () => {
    await E(`__clic("chaine"); window.__ch = true; __clic("chaine"); window.__ch = false`)
    await dormir(250)
    const n = await E(`__compte("c")`)
    assert.equal(n, 1, `${n} tirs sous le nom c`)
  })

  if (build === 'prod') it('fichier .js importé, hors de tout composant actif : ses minuteries partent, deux poses du même nom n\'en font tirer qu\'une', async () => {
    await E(`__clic("js")`)
    await dormir(400)
    const x = await E(`__compte("x")`)
    const p = await E(`__compte("p")`)
    assert.deepEqual({ x, p }, { x: 1, p: 1 }, `tirs : ${x} sous le nom x, ${p} sans nom ; erreur : ${await E('window.__err || ""')} ; console : ${JSON.stringify(s!.logs.slice(-6))}`)
  })
})
