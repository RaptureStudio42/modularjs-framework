// `µ.store[k].valeur = v`, la forme que la page des magasins conseille pour une clé calculée : comme `µ.store.fiche.valeur = v`, elle
// redessine le composant qui écrit et ceux qui lisent la clé ; `++` aussi. Avec et sans l'enveloppe, vraie construction, mode strict

import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterStrict } from './helpers/construction-stricte.js'
import { attendreEgal } from './helpers/attendre.js'

const ECRIT = `<script lang="js">
$$fiche = { valeur: '', n: 0 };
this.poser = function(k, v) { µ.store[k].valeur = v; };
this.plusUn = function(k) { µ.store[k].n++; };
this.direct = function(v) { µ.store.fiche.valeur = v; };
</script>
<p>{$$fiche.valeur}-{$$fiche.n}</p>
`

const LIT = `<script lang="js">
this.rien = 1;
</script>
<p>{$$fiche.valeur}-{$$fiche.n}</p>
`

for (const [nom, reglages] of [['avec l\'enveloppe', {}], ['réglage `"proxy": false`', { proxy: false }]] as const) {
  describe(`magasin, clé calculée à la racine (\`µ.store[k].x = v\`), ${nom} : l'écran de qui écrit et de qui lit suit`, function () {
    this.timeout(120000)
    let page: any

    before(async () => {
      page = await monterStrict('magasin-cle-lecteurs', { 'mag-ecrit': ECRIT, 'mag-lit': LIT }, reglages)
    })

    after(async () => {
      await page?.window.happyDOM.close()
      await terminateSharedWorkerPool()
    })

    const ecrans = () => ['mjs-mag-ecrit', 'mjs-mag-lit'].map((b) => page.window.document.querySelector(b)._shadow.querySelector('p').textContent).join(' ')

    it('`µ.store[\'fiche\'].valeur = \'ok\'` puis `µ.store[\'fiche\'].n++` : les deux écrans montrent `ok-1` ; `µ.store.fiche.valeur = \'d\'` : `d-1`', async () => {
      const e = page.window.document.querySelector('mjs-mag-ecrit')
      await attendreEgal(ecrans, '-0 -0', 'écrans au départ', 2000)
      e.poser('fiche', 'ok')
      e.plusUn('fiche')
      await attendreEgal(ecrans, 'ok-1 ok-1', 'clé calculée', 2000)
      e.direct('d')
      await attendreEgal(ecrans, 'd-1 d-1', 'clé écrite en clair', 2000)
    })
  })
}
