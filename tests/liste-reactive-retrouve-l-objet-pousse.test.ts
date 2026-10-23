// Un objet poussé dans une liste réactive — variable d'un composant (`$list`), `µ.state`, `µ.Store` — y est
// retrouvé, qu'on le tienne brut (l'objet qu'on vient de pousser) ou par son enveloppe (l'élément relu dans la
// liste) : `indexOf`, `lastIndexOf`, `includes`. `findIndex` / `find` appellent leur prédicat une fois par élément,
// avec l'élément tel que la liste le rend (son enveloppe) : `x === b` (l'objet brut) n'y trouve rien, `x === l[2]` si.
// Défaut garanti absent : `indexOf` rendait -1, `includes` faux, et le geste courant `splice(indexOf(b), 1)`
// retirait le DERNIER élément au lieu de `b` — mauvaise donnée supprimée, sans un mot. Une affectation
// (`l = l.filter(…)`, `l = [...l, x]`) range la donnée brute, jamais une enveloppe (objets retrouvés ensuite).
// Vérifié en construction de développement et minifiée.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// `enveloppe(l)` : la donnée brute de la liste contient-elle une enveloppe ? (le symbole d'accès au brut se
// retrouve par sa description, nom court compris)
const SOURCE = `<script>
$list = []
$res = ''
a = { id: 1 }
b = { id: 2 }
c = { id: 3 }
RAW = Object.values(µ).find((v) -> typeof v === 'symbol' && v.description === 'mjs_raw')
enveloppe = (l) -> l[RAW].some((e) -> e != null && e[RAW] != null)
ids = (l) -> l.map((x) -> x.id).join(',')
cherche = (l, sel) -> [l.indexOf(b), l.includes(b), l.lastIndexOf(b), l.findIndex((x) -> x === b), l.indexOf(l[0]), l.findIndex((x) -> x === sel), l.find((x) -> x === b) === l[1]].join(' ')
essai = ->
  r = {}
  $list.push(a)
  $list.push(b)
  $list.push(c)
  r.local = cherche($list, $list[2])
  $list.splice($list.indexOf(b), 1)
  r.localRetrait = ids($list)
  $list = $list.filter((x) -> x.id !== 3)
  r.localFiltre = [enveloppe($list), $list.indexOf(a)].join(' ')
  $list = [...$list, c]
  r.localEtendu = [enveloppe($list), $list.indexOf(c)].join(' ')
  st = µ.state({ list: [] })
  st.list.push(a)
  st.list.push(b)
  st.list.push(c)
  r.etat = cherche(st.list, st.list[2])
  st.list.splice(st.list.indexOf(b), 1)
  r.etatRetrait = ids(st.list)
  st.list = st.list.filter((x) -> x.id !== 3)
  r.etatFiltre = [enveloppe(st.list), st.list.indexOf(a)].join(' ')
  st.list = [...st.list, c]
  r.etatEtendu = [enveloppe(st.list), st.list.indexOf(c)].join(' ')
  cat = µ.state({ articles: [{ id: 7 }, { id: 8 }] })
  st.list.push(cat.articles[1])
  r.etatAutreEtat = [enveloppe(st.list), st.list.indexOf(cat.articles[1])].join(' ')
  S = new µ.Store({ list: [] })
  S.data.list.push(a)
  S.data.list.push(b)
  S.data.list.push(c)
  r.store = cherche(S.data.list, S.data.list[2])
  S.data.list.splice(S.data.list.indexOf(b), 1)
  r.storeRetrait = ids(S.data.list)
  S.data.list = S.data.list.filter((x) -> x.id !== 3)
  r.storeFiltre = [enveloppe(S.data.list), S.data.list.indexOf(a)].join(' ')
  S.data.list = [...S.data.list, c]
  r.storeEtendu = [enveloppe(S.data.list), S.data.list.indexOf(c)].join(' ')
  $res = JSON.stringify(r)
</script>
<p class="res">{$res}</p>
<button class="go" @click={essai()}>go</button>
`

// indexOf(b), includes(b), lastIndexOf(b), findIndex(x === b), indexOf(l[0]), findIndex(x === l[2]), find(x === b) === l[1]
const TROUVE = '1 true 1 -1 0 2 false'

const ATTENDU = {
  local: TROUVE, localRetrait: '1,3', localFiltre: 'false 0', localEtendu: 'false 1',
  etat: TROUVE, etatRetrait: '1,3', etatFiltre: 'false 0', etatEtendu: 'false 1', etatAutreEtat: 'false 2',
  store: TROUVE, storeRetrait: '1,3', storeFiltre: 'false 0', storeEtendu: 'false 1',
}

function projet(etiquette: string, config: Record<string, unknown>) {
  const root = mjsTmp('liste-identite-' + etiquette)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', ...config }))
  writeFileSync(join(root, 'src', 'liste.mjs'), SOURCE)
  return root
}

describe('liste réactive (variable de composant, µ.state, µ.Store) : un objet poussé y est retrouvé', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [etiquette, config] of [['développement', {}], ['minifié', { minify: true }]] as const) {
    it(`${etiquette} : recherche par l'objet brut ou par son enveloppe, retrait du bon élément, affectation rangée brute`, async () => {
      const app = await createHarness({ root: projet(etiquette === 'minifié' ? 'minifie' : 'dev', config) })
      try {
        const c = await app.mount('liste')
        await c.click('.go')
        const texte = c.text('.res')
        assert.ok(texte, 'le geste a tourné jusqu’au bout (résultat écrit)')
        assert.deepEqual(JSON.parse(texte), ATTENDU)
      }
      finally {
        await app.destroy()
      }
    })
  }
})
