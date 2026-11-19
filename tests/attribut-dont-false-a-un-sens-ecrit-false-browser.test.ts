// `draggable`, `spellcheck`, `contenteditable` et `writingsuggestions` calculés à `false` s'écrivent « false », comme un `aria-*` : retiré,
// l'attribut rendait au navigateur sa valeur par défaut — une image redevenait glissable, Chromium vérifiait l'orthographe. Dans un {for}
// (valeur filtrée par la ligne choisie) et hors boucle, au premier rendu puis false → true → false, dans Chromium et dans Firefox ; le HTML du
// rendu serveur porte `draggable="false"` ; écrits avec des majuscules (`contentEditable`, `spellCheck`), comme en HTML, le nom ne compte
// pas sa casse ; un `data-*` à `false` reste retiré — vraie construction (production, un seul fichier), mode strict
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const attrs  = (v: string) => `draggable={${v}} spellcheck={${v}} contenteditable={${v}} writingsuggestions={${v}} data-on={${v}}`
const SOURCE = `<ul>{for t in $l by id}<li class="l" ${attrs('t.id is $sel')}>{t.id}</li><img class="l" alt="l" draggable={t.id is $sel}><i class="l" contentEditable={t.id is $sel} spellCheck={t.id is $sel}>m</i>{end}</ul>
<p class="h" ${attrs('$on')}>h</p><img class="h" alt="h" draggable={$on}><i class="h" contentEditable={$on} spellCheck={$on}>m</i>
<script>
  $l = [{ id: 1 }, { id: 2 }]
  $sel = 1
  $on = false
  @versDeux = ->
    $sel = 2
    $on = true
  @versUn = ->
    $sel = 1
    $on = false
</script>
`
// ce que lit chaque balise : l'attribut écrit et la propriété du navigateur ; `data-on` en dernier (retiré à false)
const FAUX = { li: ['false', false, 'false', false, 'false', false, 'false', null], img: ['false', false], i: ['false', 'false'] }
const VRAI = { li: ['true', true, 'true', true, 'true', true, 'true', 'true'], img: ['true', true], i: ['true', 'true'] }

describe('attribut dont false a un sens (draggable, spellcheck, contenteditable, writingsuggestions) : false s\'écrit « false »', function () {
  this.timeout(200000)
  let root: string
  let code: string

  before(async () => {
    root = mjsTmp('attribut-false-a-un-sens')
    const src = join(root, 'src')
    const out = join(root, 'out')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'faux-sens.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle', minify: false } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    code = '"use strict";\n' + readFileSync(join(out, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const moteur of ['chromium', 'firefox'] as const) {
    it(`${moteur} : la ligne non choisie et la balise hors boucle, au premier rendu puis false → true → false`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      const navigateur = await playwright[moteur].launch()
      try {
        const page = await navigateur.newPage()
        await page.setContent('<!doctype html><html><head></head><body></body></html>')
        await page.addScriptTag({ content: code })
        const vus = await page.evaluate(async () => {
          document.body.innerHTML = '<mjs-faux-sens></mjs-faux-sens>'
          const hote: any = document.querySelector('mjs-faux-sens')
          const ombre = () => hote._shadow || hote.shadowRoot || hote
          for (let i = 0; i < 100 && ombre().querySelectorAll('li.l, img.l, i.l, .h').length < 9; i++) await new Promise((r) => setTimeout(r, 20))
          if (ombre().querySelectorAll('li.l, img.l, i.l, .h').length < 9) return ombre().innerHTML
          const lire = (x: any) => x.tagName === 'I' ? [x.getAttribute('contenteditable'), x.getAttribute('spellcheck')] : x.tagName === 'IMG' ? [x.getAttribute('draggable'), x.draggable] : [x.getAttribute('draggable'), x.draggable, x.getAttribute('spellcheck'), x.spellcheck, x.getAttribute('contenteditable'), x.isContentEditable, x.getAttribute('writingsuggestions'), x.getAttribute('data-on')]
          // la seconde ligne (choisie au milieu seulement) et la balise hors boucle
          const releve = () => ({ ligne: [lire(ombre().querySelectorAll('li.l')[1]), lire(ombre().querySelectorAll('img.l')[1]), lire(ombre().querySelectorAll('i.l')[1])], hors: [lire(ombre().querySelector('p.h')), lire(ombre().querySelector('img.h')), lire(ombre().querySelector('i.h'))] })
          const etapes = [releve()]
          hote.versDeux()
          await new Promise((r) => setTimeout(r, 120))
          etapes.push(releve())
          hote.versUn()
          await new Promise((r) => setTimeout(r, 120))
          etapes.push(releve())
          return etapes
        })
        await page.close()
        const faux = { ligne: [FAUX.li, FAUX.img, FAUX.i], hors: [FAUX.li, FAUX.img, FAUX.i] }
        const vrai = { ligne: [VRAI.li, VRAI.img, VRAI.i], hors: [VRAI.li, VRAI.img, VRAI.i] }
        assert.deepEqual(vus, [faux, vrai, faux])
      }
      finally { await navigateur.close() }
    })
  }

  it('rendu serveur : le HTML porte draggable="false" et les trois autres, hors boucle et sur la ligne non choisie ; data-on retiré', async () => {
    const rendeur = await createSSRRenderer({ sourceDir: join(root, 'src'), outputDir: join(root, 'out-serveur') })
    let html = ''
    try { html = (await rendeur.renderToString('mjs-faux-sens', {})).html }
    finally { await rendeur.close() }
    const compte = (re: RegExp) => (html.match(re) ?? []).length
    assert.deepEqual(
      { draggable: compte(/draggable="false"/g), spellcheck: compte(/spellcheck="false"/g), contenteditable: compte(/contenteditable="false"/g), writingsuggestions: compte(/writingsuggestions="false"/g), dataOn: compte(/data-on="false"/g) },
      { draggable: 4, spellcheck: 4, contenteditable: 4, writingsuggestions: 2, dataOn: 0 }
    )
  })
})
