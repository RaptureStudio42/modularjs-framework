// Les modules du cœur qui écrivent leur état de départ dans leur balise (<@@number>, <@@select>, <@@radio> lié à un groupe) quand la page est
// rendue par le serveur, sur les DEUX moteurs du rendu (happy-dom, navigateur) :
// - un état faux (`false`), une valeur vide (`''`) ou un objet ne laissent aucun attribut ; un zéro est écrit (`value="0"`, `group="0"`) ;
// - une liste à choix multiple n'écrit son `value` que pour un tableau de textes et de nombres (en JSON) : un tableau qui porte un objet
//   (même cyclique), un BigInt ou un mélange n'écrit rien, et le rendu de la page n'échoue jamais ; le HTML ne grossit pas d'un tableau d'objets.

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
  <@@number class="no" name="a1" value={$objet}></@@number>
  <@@number class="nf" name="a2" value={false}></@@number>
  <@@number class="nv" name="a3" value={''}></@@number>
  <@@number class="n0" name="a4" value={0}></@@number>
  <@@select class="so" name="b1" value={$objet}><@@option value="a">A</@@option></@@select>
  <@@select class="sf" name="b2" value={false}><@@option value="a">A</@@option></@@select>
  <@@select class="sv" name="b3" value={''}><@@option value="a">A</@@option></@@select>
  <@@select class="s0" name="b4" value={0}><@@option value="a">A</@@option></@@select>
  <@@radio class="gv" name="c1" value="a" group={''}>a</@@radio>
  <@@radio class="gf" name="c2" value="a" group={false}>a</@@radio>
  <@@radio class="go" name="c3" value="a" group={$objet}>a</@@radio>
  <@@radio class="g0" name="c4" value="a" group={0}>a</@@radio>
</form>
`

const HOTE_EXOTIQUE = `<script>
  $cycle = { id: 1 }
  $cycle.self = $cycle
  $liste = [$cycle]
  $grands = [1n, 2n]
  $gros = Array.from({ length: 300 }, (_, i) => ({ id: i, label: 'option numéro ' + i }))
</script>

<form @noUJS>
  <@@select class="mc" name="m1" multiple value={$liste}><@@option value="a">A</@@option></@@select>
  <@@select class="mb" name="m2" multiple value={$grands}><@@option value="a">A</@@option></@@select>
  <@@select class="mg" name="m3" multiple value={$gros}><@@option value="a">A</@@option></@@select>
  <@@select class="mm" name="m4" multiple value={['a', { x: 1 }]}><@@option value="a">A</@@option></@@select>
  <@@select class="mn" name="m5" multiple value={['a', 2]}><@@option value="a">A</@@option></@@select>
  <@@select class="mv" name="m6" multiple value={[]}><@@option value="a">A</@@option></@@select>
  <@@select class="mt" name="m7" multiple value={['a', 'c']}><@@option value="a">A</@@option></@@select>
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
  ['no', 'value', null],
  ['nf', 'value', null],
  ['nv', 'value', null],
  ['n0', 'value', '0'],
  ['so', 'value', null],
  ['sf', 'value', null],
  ['sv', 'value', null],
  ['s0', 'value', '0'],
  ['gv', 'group', null],
  ['gf', 'group', null],
  ['go', 'group', null],
  ['g0', 'group', '0']
]

const LISTES: Array<[string, string, string | null]> = [
  ['mc', 'value', null],
  ['mb', 'value', null],
  ['mg', 'value', null],
  ['mm', 'value', null],
  ['mn', 'value', '[&quot;a&quot;,2]'],
  ['mv', 'value', '[]'],
  ['mt', 'value', '[&quot;a&quot;,&quot;c&quot;]']
]

function verifier(html: string, attendus: Array<[string, string, string | null]>) {
  for (const [cls, attribute, attendu] of attendus) {
    const tag = openTag(html, cls)
    const m   = tag.match(new RegExp(`\\s${attribute}="([^"]*)"`))
    assert.equal(m ? m[1] : null, attendu, `.${cls} : ${attribute} dans la balise écrite par le serveur — ${tag.slice(0, 300)}`)
  }
}

function verifierListes(html: string) {
  assert.ok(!/mjs-fatal-error|Crash intercepted/.test(html), 'le rendu n\'a pas planté')
  verifier(html, LISTES)
  assert.ok(openTag(html, 'mg').length < 300, 'un tableau de 300 objets ne grossit pas la balise de la liste')
}

describe('modules à état de départ : états faux, vides, objets et listes exotiques dans la balise rendue par le serveur', function () {
  this.timeout(180000)
  let root = ''
  let renderer: any
  let nav: any

  before(async () => {
    root = mjsTmp('champs-etat-exotique')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'hote-etats.mjs'), HOTE_ETATS)
    writeFileSync(join(root, 'src', 'hote-exotique.mjs'), HOTE_EXOTIQUE)
    renderer = await createSSRRenderer({ sourceDir: join(root, 'src'), bundlerOpts: { runtime: ['hydrate'] } } as any)
  })

  after(async () => {
    await renderer?.close()
    await nav?.close()
    await terminateSharedWorkerPool()
  })

  const happy = async (page: string): Promise<string> => (await renderer.renderToString(page, { ssrMode: 'markers' } as any)).html

  // le moteur navigateur (Chromium), monté une seule fois ; null quand le navigateur manque
  async function navigateur(page: string): Promise<string | null> {
    const playwright = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) return null
    nav ??= await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out-navigateur' } as any, { configDir: root })
    return (await nav.renderPage(page, { ssrMode: 'markers' } as any)).html
  }

  it('moteur happy-dom : un état faux, une valeur vide ou un objet ne laissent aucun attribut, un zéro est écrit', async function () {
    verifier(await happy('mjs-hote-etats'), ETATS)
  })

  it('moteur navigateur : un état faux, une valeur vide ou un objet ne laissent aucun attribut, un zéro est écrit', async function () {
    const html = await navigateur('mjs-hote-etats')
    if (html === null) { this.skip(); return }
    verifier(html, ETATS)
  })

  it('moteur happy-dom : une liste à choix multiple exotique (objet cyclique, BigInt, trois cents objets, mélange) se rend sans échec, sans attribut', async function () {
    verifierListes(await happy('mjs-hote-exotique'))
  })

  it('moteur navigateur : une liste à choix multiple exotique (objet cyclique, BigInt, trois cents objets, mélange) se rend sans échec, sans attribut', async function () {
    const html = await navigateur('mjs-hote-exotique')
    if (html === null) { this.skip(); return }
    verifierListes(html)
  })
})
