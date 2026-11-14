// une ligne de `{for}` ne retient que l'élément qu'elle montre. Dans une liste µraw d'objets µraw, la passe note sur la ligne que son objet
// a été vu µraw, pour la sauter ensuite sans rien chercher : cette note ne garde aucun objet. Liste revue puis remplacée par des objets
// neufs de mêmes clés, lignes reprises de la réserve pour d'autres clés, liste à clé toute remplacée : les objets que plus aucune ligne
// ne montre partent au ramasse-miettes. Ils sont suivis par des liens faibles et comptés après un ramassage forcé — aucun temps mesuré

import assert from 'node:assert/strict'
import v8 from 'node:v8'
import { runInNewContext } from 'node:vm'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

// un ramasse-miettes complet, sans lancer node avec --expose-gc : le drapeau n'est levé que le temps de prendre la fonction
function collectGarbage(): void {
  v8.setFlagsFromString('--expose-gc')
  const gc = runInNewContext('gc')
  v8.setFlagsFromString('--no-expose-gc')
  gc()
}

const HOST = `<script lang="js">
  $data = µ.raw([]);
  @fill = function(a) { $data = a; };
  @review = function() { $data = µ.raw($data.slice()); };
</script>
<ul>{for row in $data by id}<li><a>{row.id}:{row.label}</a></li>{end}</ul>
`
const N = 200

describe('{for} — une ligne ne retient que l\'élément qu\'elle montre', function () {
  this.timeout(60000)
  let window: any, host: any, µ: any

  before(async () => {
    ({ window, hote: host } = await monterHote(HOST, 'for-rien-de-retenu'))
    µ = window.µ
  })
  after(async () => { await terminateSharedWorkerPool() })

  const tick  = async () => { await pause(0); await pause(0) }
  const shown = () => host._shadow.querySelectorAll('li').length
  // une génération de N objets µraw (clés `from + 1` à `from + N`) posée dans la liste : il n'en reste ici que des liens faibles
  const fill  = async (gen: number, from = 0): Promise<WeakRef<object>[]> => {
    const rows = Array.from({ length: N }, (_, i) => µ.raw({ id: from + i + 1, label: 'g' + gen + '-' + i, load: new Array(50).fill(gen) }))
    host.fill(µ.raw(rows))
    await tick()
    return rows.map((o) => new WeakRef(o))
  }
  // la liste relue sans avoir changé (les mêmes objets, dans un tableau neuf) : la passe note ses lignes
  const review = async () => { host.review(); await tick() }
  // objets encore en mémoire après ramassage ; les ramassages s'arrêtent dès que le compte attendu est atteint, vingt au plus
  const alive  = async (refs: WeakRef<object>[], expected: number): Promise<number> => {
    let n = refs.length
    for (let i = 0; i < 20; i++) {
      await pause(10)
      collectGarbage()
      n = refs.filter((r) => r.deref() !== undefined).length
      if (n === expected) break
    }
    return n
  }

  it('liste revue une fois, puis remplacée par des objets neufs de mêmes clés : les anciens objets partent', async () => {
    const gens = [await fill(0)]
    await review()
    for (let g = 1; g <= 5; g++) gens.push(await fill(g))
    assert.equal(shown(), N)
    for (let g = 0; g < 5; g++) assert.equal(await alive(gens[g], 0), 0, `génération ${g}, remplacée : objets encore en mémoire`)
    assert.equal(await alive(gens[5], N), N, 'la génération affichée reste tenue par ses lignes (témoin : la mesure voit un objet retenu)')
  })

  it('lignes reprises de la réserve pour d\'autres clés : les objets de leur ancien usage partent', async () => {
    const old = await fill(10)
    await review()
    host.fill(µ.raw([]))
    await tick()
    assert.equal(shown(), 0)
    const now = await fill(11, 1000)
    assert.equal(shown(), N)
    assert.equal(await alive(old, 0), 0, 'objets de l\'ancien usage des lignes reprises : encore en mémoire')
    assert.equal(await alive(now, N), N, 'la génération affichée reste tenue par ses lignes')
  })

  it('liste à clé toute remplacée, chaque clé neuve reprenant une ancienne ligne : les anciens objets partent', async () => {
    const old = await fill(20, 2000)
    await review()
    const now = await fill(21, 3000)
    assert.equal(shown(), N)
    assert.equal(await alive(old, 0), 0, 'objets des lignes d\'avant le remplacement : encore en mémoire')
    assert.equal(await alive(now, N), N, 'la génération affichée reste tenue par ses lignes')
  })
})
