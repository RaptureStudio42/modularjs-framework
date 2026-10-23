// Les modules du cœur qui gardent un état de départ pour `form.reset()` (<@@checkbox>, <@@switch>, <@@radio>, <@@number>, <@@gauge>, <@@knob>, <@@select>)
// écrivent cet état dans LEUR balise quand la page est rendue par le serveur, même quand la page le pose par expression
// (`checked={true}`, `value={3}`, `group={$h}`), sur les DEUX moteurs du rendu (happy-dom, navigateur). Un module chargé avant
// la page se monte sur cette balise : il relit son état à son montage, au lieu de partir de l'état vide (le serveur n'écrit en
// dur que les attributs posés en dur) ; la remise à zéro du formulaire y revient.
// Un état faux ou vide ne laisse aucun attribut, un zéro est écrit (sauf pour la jauge, dont c'est la valeur par défaut : la balise sans `value` la dit déjà).

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'

const HOST = `<script>
  $h = 'b'
</script>

<form @noUJS>
  <@@checkbox class="cb1" name="a" checked={true}>a</@@checkbox>
  <@@checkbox class="cb0" name="b" checked={false}>b</@@checkbox>
  <@@switch class="sw1" name="c" checked={true}>c</@@switch>
  <@@switch class="sw0" name="d" checked={false}>d</@@switch>
  <@@radio class="r1" name="g" value="x" checked={true}>x</@@radio>
  <@@radio class="r0" name="g" value="y" checked={false}>y</@@radio>
  <@@radio class="g1" name="h" value="a" group={$h}>a</@@radio>
  <@@radio class="g2" name="h" value="b" group={$h}>b</@@radio>
  <@@number class="n3" name="n" value={3}></@@number>
  <@@number class="n0" name="z" value={0}></@@number>
  <@@number class="nv" name="v" value={''}></@@number>
  <@@gauge class="ga3" name="ga" value={3}></@@gauge>
  <@@gauge class="ga0" name="gz" value={0}></@@gauge>
  <@@gauge class="gav" name="gy" value={''}></@@gauge>
  <@@knob class="kn3" name="kn" value={30}></@@knob>
  <@@knob class="kn0" name="kz" value={0}></@@knob>
  <@@knob class="knv" name="ky" value={''}></@@knob>
  <@@select class="s1" name="s" value={'b'}>
    <@@option value="a">A</@@option>
    <@@option value="b">B</@@option>
  </@@select>
  <@@select class="sm" name="m" multiple value={['a', 'c']}>
    <@@option value="a">A</@@option>
    <@@option value="b">B</@@option>
    <@@option value="c">C</@@option>
  </@@select>
</form>
`

// la balise ouvrante du module de cette classe, avec ses attributs
const openTag = (html: string, cls: string): string => {
  const m = html.match(new RegExp(`<mjs-core-[a-z]+[^>]*class="${cls}"[^>]*>`))
  assert.ok(m, `la balise de .${cls} est dans le HTML du serveur`)
  return m[0]
}

// ce que le serveur dit de chaque module : l'attribut, ou rien
const EXPECTED: Array<[string, string, string | null]> = [
  ['cb1', 'checked', 'true'],
  ['cb0', 'checked', null],
  ['sw1', 'checked', 'true'],
  ['sw0', 'checked', null],
  ['r1',  'checked', 'true'],
  ['r0',  'checked', null],
  ['g1',  'group',   'b'],
  ['g2',  'group',   'b'],
  ['n3',  'value',   '3'],
  ['n0',  'value',   '0'],
  ['nv',  'value',   null],
  ['ga3', 'value',   '3'],
  ['ga0', 'value',   null],
  ['gav', 'value',   null],
  ['kn3', 'value',   '30'],
  ['kn0', 'value',   '0'],
  ['knv', 'value',   null],
  ['s1',  'value',   'b'],
  ['sm',  'value',   '[&quot;a&quot;,&quot;c&quot;]']
]

function check(html: string) {
  for (const [cls, attribute, expected] of EXPECTED) {
    const tag = openTag(html, cls)
    const m   = tag.match(new RegExp(`\\s${attribute}="([^"]*)"`))
    assert.equal(m ? m[1] : null, expected, `.${cls} : ${attribute} dans la balise écrite par le serveur — ${tag}`)
  }
}

describe('modules à état de départ : la balise rendue par le serveur dit leur état', function () {
  this.timeout(120000)
  let root = ''
  after(async () => { await terminateSharedWorkerPool() })

  before(() => {
    root = mjsTmp('champs-etat-balise')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'hote-etat.mjs'), HOST)
  })

  it('moteur happy-dom : chaque module écrit son état dans sa balise', async function () {
    const renderer = await createSSRRenderer({ sourceDir: join(root, 'src'), bundlerOpts: { runtime: ['hydrate'] } } as any)
    try {
      const { html } = await renderer.renderToString('mjs-hote-etat', { ssrMode: 'markers' } as any)
      check(html)
    } finally {
      await renderer.close()
    }
  })

  it('moteur navigateur : chaque module écrit son état dans sa balise', async function () {
    const playwright = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) { this.skip(); return }
    const nav = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out-navigateur' } as any, { configDir: root })
    try {
      const { html } = await nav.renderPage('mjs-hote-etat', { ssrMode: 'markers' } as any)
      check(html)
    } finally {
      await nav.close()
    }
  })
})
