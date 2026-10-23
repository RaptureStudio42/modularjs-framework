// rendu serveur (moteur happy-dom) : une valeur liée à UNE propriété de style n'ajoute jamais une déclaration au `style` écrit dans la
// page, quelle que soit la propriété. Le DOM simulé ne vérifie lui-même qu'une partie des propriétés (`color`, `width`, `background-image`…) :
// laissé seul, il écrit `red; background-image: url(…)` tel quel pour `transform`, `filter`, `content`, `mask-image`, `text-shadow`,
// `animation-name`, `view-transition-name`, `grid-template-areas`, `anchor-name` et toute variable CSS (`--x={…}`), et le navigateur qui
// reçoit la page applique la déclaration ajoutée. Le serveur refuse la valeur comme le navigateur : la propriété n'est pas écrite. Une
// vraie valeur passe (`";"`, `url("a;b.png")`, `translate(1px, 2px)`, une variable à virgules). Même résultat au premier rendu et dans le
// rendu préparé pour l'hydratation.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

// propriétés que le DOM simulé écrit sans les vérifier, puis celles qu'il vérifie déjà (témoins)
const PROPRIETES = ['transform', 'filter', 'content', 'mask-image', 'text-shadow', 'animation-name', 'view-transition-name', 'grid-template-areas', 'anchor-name', 'color', 'width', 'background-color', 'background-image', 'border-color']

// une déclaration ajoutée après un point-virgule, une règle ajoutée après une accolade
const ATTAQUES: Record<string, string> = {
  pv:  'red; background-image: url(http://pisteur.invalid/p.png)',
  acc: 'red} p{background-image: url(http://pisteur.invalid/q.png)',
}

// valeurs légitimes : propriété, valeur liée, texte attendu dans la balise
const LEGITIMES: [string, string, RegExp][] = [
  ['content', '";"', /content: (&quot;|");(&quot;|")/],
  ['background-image', 'url("a;b.png")', /background-image: url\((&quot;|")a;b\.png(&quot;|")\)/],
  ['transform', 'translate(1px, 2px)', /transform: translate\(1px, 2px\)/],
  ['--liste', 'a, b, c', /--liste: a, b, c/],
]

let script = '<script>\n'
for (const [cle, v] of Object.entries(ATTAQUES)) script += `  $${cle} = ${JSON.stringify(v)}\n`
LEGITIMES.forEach(([, v], i) => { script += `  $ok${i} = ${JSON.stringify(v)}\n` })
script += '</script>\n'
let gabarit = ''
for (const cle of Object.keys(ATTAQUES)) {
  for (const prop of PROPRIETES) gabarit += `<span class="a-${cle}-${prop}" @style.${prop}={$${cle}}></span>\n`
  gabarit += `<span class="a-${cle}-var" --x={$${cle}}></span>\n`
}
LEGITIMES.forEach(([prop], i) => {
  gabarit += prop.startsWith('--') ? `<span class="ok-${i}" ${prop}={$ok${i}}></span>\n` : `<span class="ok-${i}" @style.${prop}={$ok${i}}></span>\n`
})
const HOTE = script + gabarit

describe('rendu serveur — une valeur liée à une seule propriété de style n\'ajoute jamais de déclaration, quelle que soit la propriété', function () {
  this.timeout(120000)
  const pages: Record<string, string> = {}

  before(async () => {
    const root = mjsTmp('ssr-style-propriete-seule')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'hote-propriete.mjs'), HOTE)
    const renderer = await createSSRRenderer({ sourceDir: join(root, 'src'), bundlerOpts: { runtime: ['hydrate'] } } as any)
    try {
      pages.replace = (await renderer.renderToString('mjs-hote-propriete', {} as any)).html
      pages.markers = (await renderer.renderToString('mjs-hote-propriete', { ssrMode: 'markers' } as any)).html
    } finally {
      await renderer.close()
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  const balise = (html: string, nom: string) => (html.match(new RegExp(`<span class="${nom}"[^>]*>`)) || [''])[0]

  for (const mode of ['replace', 'markers']) {
    for (const cle of Object.keys(ATTAQUES)) {
      it(`${mode} · « ${ATTAQUES[cle]} » : la propriété n'est pas écrite, aucune balise ne nomme l'adresse`, () => {
        const html = pages[mode]
        assert.ok(balise(html, 'ok-2'), 'préalable : la page est rendue')
        const noms = [...PROPRIETES.map((p) => `a-${cle}-${p}`), `a-${cle}-var`]
        const fautives = noms.map((n) => balise(html, n)).filter((t) => !t || /style=|pisteur/.test(t))
        assert.deepEqual(fautives, [])
      })
    }

    it(`${mode} · une vraie valeur est écrite : « ; » dans une chaîne, url("a;b.png"), translate(1px, 2px), une variable à virgules`, () => {
      const html = pages[mode]
      LEGITIMES.forEach(([, , attendu], i) => assert.match(balise(html, `ok-${i}`), attendu))
    })
  }
})
