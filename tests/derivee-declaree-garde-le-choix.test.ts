// valeur dérivée écrite à la main : une dérivée implicite (`$x = expr`) devient une variable ordinaire ; une dérivée déclarée
// par `µderived $x = expr, $a` garde le choix jusqu'à l'écriture d'une dépendance nommée, puis se recalcule. Les deux, en
// développement et en production, appli montée dans happy-dom
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  // tutoriel du site : une valeur de départ qui devient un compteur
  'dc-tuto.mjs': `<script>
  $todos = [
    { id: 1, done: false, description: 'a' }
    { id: 2, done: false, description: 'b' }
    { id: 3, done: true,  description: 'c' }
  ]
  $uid     = $todos.length + 1
  @add = (val) ->
    $todos = [...$todos, { id: $uid++, done: false, description: val }]
  @remove = (todo) ->
    $todos = $todos.filter (t)-> t isnt todo
</script>
<ul>{for todo in $todos by id}<li class="t">{todo.id}:{todo.description}</li>{end}</ul>
`,
  // familles ouvertes de l'éditeur d'effets : la valeur de départ suit la famille, puis vit sa vie
  'dc-effets.mjs': `<script>
$famille = 'text'
$ouvertes = ',' + $famille + ','
@basculer = (f) ->
  marque = ',' + f + ','
  $ouvertes = if $ouvertes.includes(marque) then $ouvertes.replace(marque, ',') else $ouvertes + f + ','
@ouvrirFamille = (f) -> $ouvertes += f + ',' unless $ouvertes.includes(',' + f + ',')
@ouvrirEffet = (f) ->
  $famille = f
  @ouvrirFamille(f)
@ouvrirCategorie = (f) -> $famille = f
</script>
<p class="o">{$ouvertes}</p>
`,
  // écriture au premier niveau du script
  'dc-haut.mjs': `<script>
$a = 1
$x = $a * 2
$x += 10
@setA = (v) -> $a = v
</script>
<p class="x">{$x}</p>
`,
  // maître-détail : l'élément choisi reste choisi
  'dc-maitre.mjs': `<script>
$items = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
$sel   = $items[0]
@choisir  = (i) -> $sel = $items[i]
@renommer = (n) -> $sel.name = n
@ajouter  = -> $items = [...$items, { name: 'd' }]
</script>
<p class="sel">{$sel.name}</p>
`,
  // dérivée implicite écrite, puis copiée
  'dc-implicite.mjs': `<script>
products = [{name: 'A', sizes: ['S', 'M', 'L']}, {name: 'B', sizes: ['XS', 'XL']}]
$product = products[0]
$size    = $product.sizes[0]
@pick    = (s) -> $size = s
@next    = -> $product = products[(products.findIndex((p) -> p.name is $product.name) + 1) % products.length]
@copie   = -> µ.clone(this)
</script>
<p class="taille">Taille : {$size}</p>
`,
  // la fiche produit : taille choisie gardée tant que le produit ne change pas
  'dc-fiche.mjs': `<script>
products = [{name: 'A', sizes: ['S', 'M', 'L']}, {name: 'B', sizes: ['XS', 'XL']}]
$product = products[0]
$query   = ''
µderived $size = $product.sizes[0], $product
@pick    = (s) -> $size = s
@next    = -> $product = products[(products.findIndex((p) -> p.name is $product.name) + 1) % products.length]
@taper   = (q) -> $query = q
@copie   = -> µ.clone(this)
</script>
<p class="taille">Taille : {$size}</p>
<button class="m" @click={$size = 'M'}>M</button>
`,
  // `µderived` jamais écrite : son code ne change pas
  'dc-lue.mjs': `<script>
$n = 1
µderived $double = $n * 2, $n
@setN = (v) -> $n = v
</script>
<p class="d">{$double}</p>
`
}

const pause = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 15)) }
const texte = (el: any, c: string) => el._shadow.querySelector(c).textContent

async function monter(prod: boolean) {
  const root = mjsTmp('dc'), src = join(root, 'src'), out = join(root, 'out')
  mkdirSync(src, { recursive: true })
  for (const [f, c] of Object.entries(SOURCES)) writeFileSync(join(src, f), c)
  const opts: any = { sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js') }
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const b = new Bundler(opts)
  const stats = await b.compile()
  await b.close()
  assert.deepEqual(stats.errors.map((e: any) => String(e.message)), [])
  const fichiers = readdirSync(out).filter((f) => f.endsWith('.js'))
  const ordre    = [...fichiers.filter((f) => f.startsWith('mjs_')), ...fichiers.filter((f) => !f.startsWith('mjs_'))]
  const code     = prod
    ? readFileSync(join(out, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(out, f), 'utf-8'))).join('\n')
  const compile: Record<string, string> = {}
  if (!prod) for (const f of readdirSync(out, { recursive: true }) as string[]) {
    const nom = f.replace(/^.*\//, '').replace(/\..*$/, '').replace(/-[a-z0-9]+$/, '')
    if (nom.startsWith('dc-') && f.endsWith('.js')) compile[nom] = readFileSync(join(out, f), 'utf-8')
  }
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(code)
  const doc   = window.document
  const poser = async (tag: string) => { const e = doc.createElement(tag); doc.body.appendChild(e); await pause(); return e }
  return { doc, poser, compile, liste: readdirSync(out, { recursive: true }) as string[] }
}

describe('valeur dérivée écrite à la main : implicite ordinaire, µderived gardée jusqu\'à une dépendance nommée', function () {
  this.timeout(200000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    const mode = prod ? 'production' : 'développement'

    it(`${mode} — dérivées implicites : comme une variable ordinaire dès qu'on les écrit`, async () => {
      const m = await monter(prod)
      const tu = await m.poser('mjs-dc-tuto')
      tu.add('x'); await pause()
      tu.remove(tu._state.todos[0]); await pause()
      tu.add('y'); await pause()
      assert.deepEqual([...tu._state.todos].map((t: any) => t.id), [2, 3, 4, 5], 'identifiants sans doublon')
      assert.deepEqual([...tu._shadow.querySelectorAll('.t')].map((l: any) => l.textContent), ['2:b', '3:c', '4:x', '5:y'])
      const ef = await m.poser('mjs-dc-effets')
      ef.basculer('fx'); await pause()
      ef.ouvrirEffet('fx'); await pause()
      ef.ouvrirCategorie('text'); await pause()
      assert.deepEqual([ef._state.ouvertes, texte(ef, '.o')], [',text,fx,', ',text,fx,'], 'familles ouvertes gardées')
      const h = await m.poser('mjs-dc-haut')
      const x0 = h._state.x
      h.setA(5); await pause()
      assert.deepEqual([x0, h._state.x, texte(h, '.x')], [12, 12, '12'], 'écriture au premier niveau')
      const ma = await m.poser('mjs-dc-maitre')
      ma.choisir(2); await pause()
      ma.renommer('C'); await pause()
      ma.ajouter(); await pause()
      assert.deepEqual([ma._state.sel.name, texte(ma, '.sel')], ['C', 'C'], 'élément choisi gardé')
      const im = await m.poser('mjs-dc-implicite')
      im.pick('L'); await pause()
      const ci = im.copie(); m.doc.body.appendChild(ci); await pause()
      im.next(); await pause()
      assert.deepEqual([texte(ci, '.taille'), im._state.size, texte(im, '.taille')], ['Taille : L', 'L', 'Taille : L'], 'copie et original gardent le choix')
      if (!prod) {
        for (const nom of ['dc-tuto', 'dc-effets', 'dc-haut', 'dc-maitre', 'dc-implicite', 'dc-lue']) assert.ok(m.compile[nom] !== undefined && !m.compile[nom].includes('_mjs_computedSrc'), `${nom} : aucune table de dépendances nommées (${m.liste.join(" ")})`)
        assert.ok(m.compile['dc-fiche'] !== undefined && m.compile['dc-fiche'].includes('_mjs_computedSrc'), `dc-fiche : table de dépendances nommées (${Object.keys(m.compile).join(' ')})`)
      }
    })

    it(`${mode} — µderived : le choix tient jusqu'à l'écriture d'une dépendance nommée`, async () => {
      const m = await monter(prod)
      const fi = await m.poser('mjs-dc-fiche')
      const vu = () => [fi._state.size, texte(fi, '.taille')]
      fi.pick('L'); await pause()
      assert.deepEqual(vu(), ['L', 'Taille : L'], 'choix posé')
      fi.taper('robe'); await pause()
      assert.deepEqual(vu(), ['L', 'Taille : L'], 'écriture sans rapport : choix gardé')
      fi.next(); await pause()
      assert.deepEqual(vu(), ['XS', 'Taille : XS'], 'produit suivant : recalculée')
      fi._shadow.querySelector('.m').click(); await pause()
      assert.deepEqual(vu(), ['M', 'Taille : M'], 'écrite par un gestionnaire du gabarit')
      fi.next(); await pause()
      assert.deepEqual(vu(), ['S', 'Taille : S'], 'produit suivant : recalculée encore')
      fi.pick('XL'); await pause()
      const cp = fi.copie(); m.doc.body.appendChild(cp); await pause()
      assert.deepEqual([cp._state.size, texte(cp, '.taille')], ['XL', 'Taille : XL'], 'µclone garde le choix')
      cp.next(); await pause()
      assert.deepEqual([cp._state.size, texte(cp, '.taille')], ['XS', 'Taille : XS'], 'la copie suit sa dépendance nommée')
      assert.deepEqual(vu(), ['XL', 'Taille : XL'], 'l\'original garde son choix')
      const lu = await m.poser('mjs-dc-lue')
      lu.setN(4); await pause()
      assert.deepEqual([lu._state.double, texte(lu, '.d')], [8, '8'], 'µderived jamais écrite')
    })
  }
})
