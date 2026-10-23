// le HTML rendu par le serveur lit « false », quelle que soit sa casse, comme le navigateur après l'hydratation, pour la case,
// l'interrupteur, le radio, le bouton rotatif, la jauge et l'éditeur : `disabled="FALSE"` les laisse actifs et leur champ caché part avec
// la page servie, `required="FALSE"` ne rend obligatoire ni la case native de leur ombre ni la zone de l'éditeur (`aria-required`).
// Les mêmes attributs écrits vides restent vrais (témoins)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const PAGE = `<form class="fs" method="get" action="/envoi">
  <@@checkbox class="sc" name="sc" checked disabled="FALSE" required="FALSE">c</@@checkbox>
  <@@switch class="sw" name="sw" checked disabled="False" required="False">w</@@switch>
  <@@radio class="sr" name="sr" value="1" checked disabled="FALSE" required="FALSE">r</@@radio>
  <@@knob class="sk" name="sk" value="3" disabled="FALSE"></@@knob>
  <@@gauge class="sg" name="sg" value="3" disabled="False"></@@gauge>
  <@@checkbox class="tc" name="tc" checked disabled required>c</@@checkbox>
  <@@switch class="tw" name="tw" checked disabled required>w</@@switch>
  <@@radio class="tr" name="tr" value="1" checked disabled required>r</@@radio>
  <@@knob class="tk" name="tk" value="3" disabled></@@knob>
  <@@gauge class="tg" name="tg" value="3" disabled></@@gauge>
  <@@editor class="se" name="se" required="FALSE"></@@editor>
  <@@editor class="te" name="te" required></@@editor>
</form>
`

describe('rendu serveur : « false », toute casse, lu comme dans le navigateur (case, interrupteur, radio, bouton rotatif, jauge, éditeur)', function () {
  this.timeout(120000)
  let parts: Record<string, string> = {}

  before(async () => {
    const root = mjsTmp('rendu-serveur-faux-casse-cases')
    const src  = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'hote-ssr.mjs'), PAGE)
    const renderer = await createSSRRenderer({ sourceDir: src, outputDir: join(root, 'out'), bundlerOpts: { runtime: ['hydrate'] } } as any)
    try {
      const r = await renderer.renderToString('mjs-hote-ssr', { ssrMode: 'markers' } as any)
      // le HTML de chaque module, de sa balise à celle du module suivant
      for (const p of r.html.split(/(?=<mjs-core-(?:checkbox|switch|radio|knob|gauge|editor)\b)/)) {
        const c = (p.match(/^<mjs-core-[a-z]+ [^>]*class="([^"]+)"/) || [])[1]
        if (c) parts[c] = p
      }
    }
    finally {
      await renderer.close()
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  const corps   = (c: string) => parts[c].replace(/^<[^>]*>/, '')
  const natif   = (c: string) => (corps(c).match(/<input[^>]*class="native"[^>]*>/) || [''])[0]
  const porte   = (balise: string, a: string) => new RegExp(`\\s${a}(?=[\\s=>/])`).test(balise)
  const cache   = (c: string) => new RegExp(`<input(?=[^>]*type="hidden")(?=[^>]*name="${c}")[^>]*>`).test(corps(c))
  const inactif = (c: string) => (corps(c).match(/aria-disabled="true"/g) || []).length

  it('chaque module est rendu', () => {
    assert.deepEqual(Object.keys(parts).sort(), ['sc', 'se', 'sg', 'sk', 'sr', 'sw', 'tc', 'te', 'tg', 'tk', 'tr', 'tw'])
  })

  it('disabled="FALSE" (toute casse) : la case, l\'interrupteur et le radio restent actifs, cochés, leur champ caché écrit ; disabled écrit vide les désactive', () => {
    assert.deepEqual(['sc', 'sw', 'sr'].map((c) => [porte(natif(c), 'disabled'), porte(natif(c), 'checked'), cache(c)]), [[false, true, true], [false, true, true], [false, true, true]])
    assert.deepEqual(['tc', 'tw', 'tr'].map((c) => [porte(natif(c), 'disabled'), cache(c)]), [[true, false], [true, false], [true, false]])
  })

  it('required="FALSE" (toute casse) : la case native de la case, de l\'interrupteur et du radio n\'est pas obligatoire ; required écrit vide la rend obligatoire', () => {
    assert.deepEqual(['sc', 'sw', 'sr', 'tc', 'tw', 'tr'].map((c) => porte(natif(c), 'required')), [false, false, false, true, true, true])
  })

  it('disabled="FALSE" (toute casse) : le bouton rotatif et la jauge restent actifs et leur champ caché part avec la page servie ; disabled écrit vide les désactive', () => {
    assert.deepEqual(['sk', 'sg'].map((c) => [inactif(c), cache(c)]), [[0, true], [0, true]])
    assert.deepEqual(['tk', 'tg'].map((c) => [inactif(c) > 0, cache(c)]), [[true, false], [true, false]])
  })

  it('required="FALSE" : l\'éditeur ne dit pas aria-required ; required écrit vide le dit', () => {
    assert.deepEqual(['se', 'te'].map((c) => (corps(c).match(/aria-required="true"/g) || []).length), [0, 1])
  })
})
