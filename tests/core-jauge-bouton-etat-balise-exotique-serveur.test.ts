// La jauge et le bouton rotatif du cœur (<@@gauge>, <@@knob>) écrivent leur valeur de départ dans leur balise quand la page est rendue par
// le serveur, sur les DEUX moteurs du rendu (happy-dom, navigateur), comme le nombre :
// - un état faux (`false`), une valeur vide (`''`) ou un objet ne laissent aucun attribut ;
// - un zéro est écrit pour le bouton rotatif (`value="0"`) ;
// - la valeur par défaut du module (0 pour la jauge, 50 pour le bouton rotatif), posée ou non par la page, n'écrit rien : la balise sans `value` la dit
//   déjà, et l'écrire avant que la page ait posé la sienne la ferait relire par-dessus ;
// - une valeur posée en dur dans la balise de la page reste ce qu'elle est.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'

const HOTE_ETATS = `<script>
  $objet = { a: 1 }
</script>

<form @noUJS>
  <@@gauge class="go" name="a1" value={$objet}></@@gauge>
  <@@gauge class="gf" name="a2" value={false}></@@gauge>
  <@@gauge class="gv" name="a3" value={''}></@@gauge>
  <@@gauge class="g0" name="a4" value={0}></@@gauge>
  <@@gauge class="gd" name="a5"></@@gauge>
  <@@gauge class="gl" name="a6" value="7"></@@gauge>
  <@@knob class="ko" name="b1" value={$objet}></@@knob>
  <@@knob class="kf" name="b2" value={false}></@@knob>
  <@@knob class="kv" name="b3" value={''}></@@knob>
  <@@knob class="k0" name="b4" value={0}></@@knob>
  <@@knob class="kd" name="b5"></@@knob>
  <@@knob class="k5" name="b7" value={50}></@@knob>
  <@@knob class="kl" name="b6" value="70"></@@knob>
</form>
`

// la balise ouvrante du module de cette classe, avec ses attributs
const openTag = (html: string, cls: string): string => {
  const m = html.match(new RegExp(`<mjs-core-[a-z]+[^>]*class="${cls}"[^>]*>`))
  assert.ok(m, `la balise de .${cls} est dans le HTML du serveur`)
  return m[0]
}

// ce que le serveur dit de chaque module : l'attribut, ou rien
const ETATS: Array<[string, string, string | null]> = [
  ['go', 'value', null],
  ['gf', 'value', null],
  ['gv', 'value', null],
  ['g0', 'value', null],
  ['gd', 'value', null],
  ['gl', 'value', '7'],
  ['ko', 'value', null],
  ['kf', 'value', null],
  ['kv', 'value', null],
  ['k0', 'value', '0'],
  ['kd', 'value', null],
  ['k5', 'value', null],
  ['kl', 'value', '70']
]

function verifier(html: string) {
  assert.ok(!/mjs-fatal-error|Crash intercepted/.test(html), 'le rendu n\'a pas planté')
  for (const [cls, attribute, attendu] of ETATS) {
    const tag = openTag(html, cls)
    const m   = tag.match(new RegExp(`\\s${attribute}="([^"]*)"`))
    assert.equal(m ? m[1] : null, attendu, `.${cls} : ${attribute} dans la balise écrite par le serveur — ${tag.slice(0, 300)}`)
  }
}

describe('jauge et bouton rotatif : la balise rendue par le serveur dit leur valeur de départ', function () {
  this.timeout(180000)
  let root = ''
  let renderer: any
  let nav: any

  before(async () => {
    root = mjsTmp('jauge-bouton-balise')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'hote-etats.mjs'), HOTE_ETATS)
    renderer = await createSSRRenderer({ sourceDir: join(root, 'src'), bundlerOpts: { runtime: ['hydrate'] } } as any)
  })

  after(async () => {
    await renderer?.close()
    await nav?.close()
    await terminateSharedWorkerPool()
  })

  it('moteur happy-dom : un état faux, une valeur vide, un objet ou la valeur par défaut du module ne laissent aucun attribut', async function () {
    verifier((await renderer.renderToString('mjs-hote-etats', { ssrMode: 'markers' } as any)).html)
  })

  it('moteur navigateur : un état faux, une valeur vide, un objet ou la valeur par défaut du module ne laissent aucun attribut', async function () {
    const playwright = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) { this.skip(); return }
    nav = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out-navigateur' } as any, { configDir: root })
    verifier((await nav.renderPage('mjs-hote-etats', { ssrMode: 'markers' } as any)).html)
  })
})
