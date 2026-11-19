// Page servie : une valeur dérivée qui attend (`$resultats = await rechercher($q)`) dans des composants que la vue de l'hôte servi bâtit
// à plat, en boucle (`{for}`) ou sous condition (`{if}`). Au réveil, chaque enfant montre la valeur du serveur sans rappeler la fonction,
// quelle que soit la forme. Le relevé de la première vue de l'hôte se fait à son entrée dans la page : une invalidation `_awaits_` de
// l'hôte qui vient ensuite (un état de module, un `µ.Store`, `µload`, la langue) ne parcourt plus aucune vue — on compte les parcours.
// Méthode : le vrai rendu serveur (moteur happy-dom), puis la reprise dans happy-dom, la balise `#__mjs_store` du serveur posée avant le cœur.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { pause } from './helpers/derivee-await-banc.js'
import { servir, reprendre, appels, TARD } from './helpers/derivee-await-serveur.js'

const SERVI = TARD + `<script>
  $q         = 'ad'
  rechercher = (q) ->
    (globalThis.__appels ||= []).push(q)
    plusTard([{ id: 1, pseudo: 'x' }], 20)
  $resultats = await rechercher($q)
</script>
<ul>{for r in ($resultats or []) by id}<li>{r.pseudo}</li>{end}</ul>
`
const HOTES: Record<string, string> = {
  'à plat':         `<script>
  $x = 1
</script>
<@servi></@servi><@servi></@servi>
`,
  'en boucle':      `<script>
  $ids = [1, 2]
</script>
{for i in $ids}<@servi></@servi>{end}
`,
  'sous condition': `<script>
  $vrai = true
</script>
{if $vrai}<@servi></@servi><@servi></@servi>{end}
`,
}

// la page servie de chaque forme, reprise une fois : la valeur rangée par le serveur et la fenêtre du navigateur
const repris: Record<string, Promise<{ w: any, graine: any }>> = {}
const reprise = (forme: string, n: number) => repris[forme] ??= (async () => {
  const sources    = { 'servi.mjs': SERVI, 'hote.mjs': HOTES[forme] }
  const { graine } = await servir('aw-blocs-serveur-' + n, sources, 'mjs-hote')
  const w          = await reprendre('aw-blocs-nav-' + n, sources, graine, '<mjs-hote mjs-ssr></mjs-hote>')
  await pause(200)
  return { w, graine }
})()
const enfants = (w: any): any[] => Array.from(w.document.querySelector('mjs-hote')._shadow.querySelectorAll('mjs-servi'))
const lignes  = (w: any): string => enfants(w).map((e) => e._shadow.querySelectorAll('li').length).join(',')

describe('valeur dérivée qui attend — page servie : les enfants bâtis par la vue de l\'hôte reprennent la valeur du serveur', function () {
  this.timeout(120000)

  after(async () => {
    for (const p of Object.values(repris)) (await p).w.close()
    await terminateSharedWorkerPool()
  })

  Object.keys(HOTES).forEach((forme, n) => {
    it(`enfants ${forme} : aucun appel au navigateur, la valeur du serveur est montrée`, async () => {
      const { w, graine } = await reprise(forme, n)
      assert.deepEqual(graine, { 'mjs-servi|resultats|["ad"]': { v: [{ id: 1, pseudo: 'x' }], n: 2 } }, 'le serveur range la valeur, lue par deux composants')
      assert.deepEqual([enfants(w).length, appels(w), lignes(w)], [2, [], '1,1'], 'enfants, appels au navigateur, lignes montrées')
    })

    it(`enfants ${forme} : 100 invalidations _awaits_ de l'hôte après la reprise ne parcourent aucune vue`, async () => {
      const { w }  = await reprise(forme, n)
      const hote   = w.document.querySelector('mjs-hote')
      const proto  = Object.getPrototypeOf(hote._shadow)
      const vrai   = proto.querySelectorAll
      const compte = { parcours: 0 }
      proto.querySelectorAll = function(sel: string) {
        if (sel === '*') compte.parcours++
        return vrai.call(this, sel)
      }
      try {
        for (let i = 0; i < 100; i++) hote._mjs_invalidate('_awaits_')
        await pause(50)
      }
      finally {
        proto.querySelectorAll = vrai
      }
      assert.deepEqual([compte.parcours, appels(w), lignes(w)], [0, [], '1,1'], 'parcours de vue, appels au navigateur, lignes montrées')
    })
  })
})
