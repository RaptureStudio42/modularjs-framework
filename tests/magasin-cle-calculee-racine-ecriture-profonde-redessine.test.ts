// écriture sous l'objet d'une clé calculée à la racine du magasin (`µ.store[k].sous.valeur = v`, `µ.store[k].l.push(x)`) : le composant
// qui écrit et celui qui lit la clé se redessinent, avec et sans l'enveloppe ; en développement, l'avertissement d'une écriture
// refusée nomme la vraie clé du magasin, jamais `$$null`. Vraie construction, mode strict

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterStrict } from './helpers/construction-stricte.js'

const ECRIT = `<script lang="js">
$$fiche = { valeur: '', sous: { valeur: '' }, l: [] };
this.sous = function(k, v) { µ.store[k].sous.valeur = v; };
this.pousse = function(k, v) { µ.store[k].l.push(v); };
this.poser = function(k, v) { µ.store[k].valeur = v; };
this.ctor = function(k, v) { µ.store[k].constructor.valeur = v; };
</script>
<p>{$$fiche.sous.valeur}-{$$fiche.l.length}</p>
`

const LIT = `<script lang="js">
this.rien = 1;
</script>
<p>{$$fiche.sous.valeur}-{$$fiche.l.length}</p>
`

// le texte des deux composants, celui qui écrit puis celui qui lit
const ecrans   = (w: any) => ['mjs-mag-ecrit', 'mjs-mag-lit'].map((b) => w.document.querySelector(b)._shadow.querySelector('p').textContent).join('/')
const attendre = () => new Promise((r) => setTimeout(r, 150))

describe('écriture sous l\'objet d\'une clé calculée à la racine du magasin (`µ.store[k].sous.valeur = v`, `µ.store[k].l.push(x)`) : celui qui écrit et celui qui lit se redessinent', function () {
  this.timeout(120000)
  const pages: any[] = []

  after(async () => {
    for (const p of pages) await p.window.happyDOM.close()
    await terminateSharedWorkerPool()
  })

  for (const [nom, reglages] of [['avec l\'enveloppe', {}], ['réglage `"proxy": false`', { proxy: false }]] as const) {
    it(`${nom} : \`sous.valeur = v\` puis \`l.push(x)\` se voient chez les deux composants`, async () => {
      const page = await monterStrict('mag-profond-' + ('proxy' in reglages ? 'sans' : 'avec'), { 'mag-ecrit': ECRIT, 'mag-lit': LIT }, reglages)
      pages.push(page)
      const e  = page.window.document.querySelector('mjs-mag-ecrit')
      const vu = [ecrans(page.window)]
      e.sous('fiche', 'so')
      await attendre()
      vu.push(ecrans(page.window))
      e.pousse('fiche', 1)
      await attendre()
      vu.push(ecrans(page.window))
      assert.deepEqual(vu, ['-0/-0', 'so-0/so-0', 'so-1/so-1'])
    })
  }

  it('en développement : une écriture refusée par une clé calculée à la racine nomme la vraie clé, jamais `$$null`', async () => {
    const page = await monterStrict('mag-profond-dev', { 'mag-ecrit': ECRIT, 'mag-lit': LIT }, { env: 'dev' })
    pages.push(page)
    const e = page.window.document.querySelector('mjs-mag-ecrit')
    e.poser('constructor', 'P')
    e.ctor('fiche', 'P')
    assert.deepEqual(page.console.filter((m: string) => m.includes('$$null')), [])
    assert.ok(page.console.some((m: string) => m.includes('« constructor »')), page.console.join('\n'))
    assert.ok(page.console.some((m: string) => m.includes('$$fiche.….valeur')), page.console.join('\n'))
  })
})
