// Rendu serveur (happy-dom) — les props passées à `renderToString` (`props`) gardent leur type, comme celles qu'un parent
// pose (`<@x a={5}>`) : un nombre reste un nombre, `$a + $b` vaut 12 et non « 57 », une chaîne `'true'` reste une
// chaîne. Le texte d'un attribut ne dit pas « nombre » : la valeur typée voyage en plus dans l'attribut `mjs-props` (JSON)
// de la balise racine, relu au montage, sur le serveur comme dans le navigateur. Chaque prop garde son attribut
// habituel. En développement et en production, dans les quatre modes de reprise, et par le rendu à la demande (`mjs serve`).
// Un nom de prop en kebab-case (`user-id`) ou en camelCase (`userId`) arrive dans la variable que lit le composant
// (`$userId`), typé, sans clé parasite (`user-id`, `userid`) dans l'état ; `data-*` n'est jamais une prop.
// La reprise par le client et le moteur navigateur : ssr-props-racine-typees-browser.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { startRenderServer } from '../src/server/render-server.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const MODES = ['replace', 'markers', 'positional', 'diff'] as const
const ENVS  = ['dev', 'prod'] as const

// les valeurs par défaut du script, écrasées par les props
const SOMME = `<script>
  $a = 1
  $b = 2
  $somme = $a + $b
</script>

<p class="s">{$somme}</p>
<p class="t">{typeof $a}/{typeof $b}/{typeof $c}/{typeof $o}/{typeof $l}/{typeof $n}</p>
<p class="v">{JSON.stringify($o)}|{$l}|{$titre}</p>
`

const TYPEE = `<vars>
  $a int
  $b int
</vars>

<script>
  $a = 0
  $b = 0
  $somme = $a + $b
</script>

<p class="s">{$somme}</p>
<p class="t">{typeof $a}/{typeof $b}</p>
`

const PARENT = `<@pt-somme a={5} b={7} c={true} o={{ k: 1 }} l={'true'} n={null}></@pt-somme>
`

// noms composés : `.v` liste les clés parasites de l'état (aucune attendue)
const NOMS = `<script>
  $userId = 1
  $nbArticles = 2
  $total = $userId + $nbArticles
</script>

<p class="s">{$total}</p>
<p class="t">{typeof $userId}/{typeof $nbArticles}</p>
<p class="v">{Object.keys($).filter((k) => ['user-id', 'userid', 'nb-articles', 'nbarticles', 'data-n', 'dataN'].includes(k)).join(',') || 'aucune'}</p>
`

// le texte d'un nœud repéré par sa classe, marqueurs de reprise ôtés
function texte(html: string, classe: string): string {
  const m = html.match(new RegExp(`<p class="${classe}"[^>]*>(.*?)</p>`))
  return m ? m[1].replace(/<!--[^>]*-->/g, '') : 'absent'
}

// la balise ouvrante de la racine
function balise(html: string, tag: string): string {
  const m = html.match(new RegExp(`<${tag}[^>]*>`))
  return m ? m[0] : 'absente'
}

for (const env of ENVS) describe(`rendu serveur happy-dom : props de la racine typées (${env})`, function () {
  this.timeout(60000)
  let renderer: any

  before(async function () {
    const root   = mjsTmp('ssr-props-racine-typees-' + env)
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'pt-somme.mjs'), SOMME)
    writeFileSync(join(srcDir, 'pt-typee.mjs'), TYPEE)
    writeFileSync(join(srcDir, 'pt-parent.mjs'), PARENT)
    writeFileSync(join(srcDir, 'pt-noms.mjs'), NOMS)
    renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: join(root, 'out'), env, bundlerOpts: { runtime: ['hydrate'] } } as any)
  })

  after(async () => {
    if (renderer) await renderer.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of MODES) {
    it(`« ${mode} » : un nombre reste un nombre, $a + $b vaut 12`, async () => {
      const r = await renderer.renderToString('mjs-pt-somme', { ssrMode: mode, props: { a: 5, b: 7 } })
      assert.equal(texte(r.html, 's'), '12', `la somme rendue — HTML : ${r.html}`)
      assert.equal(texte(r.html, 't'), 'number/number/undefined/undefined/undefined/undefined', 'les types reçus')
    })

    it(`« ${mode} » : booléen, objet, null et chaîne gardent leur type`, async () => {
      const r = await renderer.renderToString('mjs-pt-somme', { ssrMode: mode, props: { a: 5, b: 7, c: true, o: { k: 1 }, l: 'true', n: null, titre: 'Stylo' } })
      assert.equal(texte(r.html, 't'), 'number/number/boolean/object/string/object', `les types reçus — HTML : ${r.html}`)
      assert.equal(texte(r.html, 'v'), '{"k":1}|true|Stylo', 'les valeurs reçues')
    })
  }

  for (const [nom, props] of [['kebab-case', { 'user-id': 5, 'nb-articles': 7, 'data-n': 5 }], ['camelCase', { userId: 5, nbArticles: 7 }]] as const) {
    for (const mode of MODES) {
      it(`« ${mode} », noms en ${nom} : la variable du composant, typée, sans clé parasite`, async () => {
        const r = await renderer.renderToString('mjs-pt-noms', { ssrMode: mode, props })
        assert.equal(texte(r.html, 's'), '12', `la somme rendue — HTML : ${r.html}`)
        assert.equal(texte(r.html, 't'), 'number/number', 'les types reçus')
        assert.equal(texte(r.html, 'v'), 'aucune', 'clés parasites dans l\'état')
        // un nom d'attribut ne garde pas sa casse : `userId` s'écrit `user-id`, que la balise relit `userId`
        assert.match(balise(r.html, 'mjs-pt-noms'), / user-id="5" nb-articles="7"/, 'attributs en kebab-case')
      })
    }
  }

  it('la balise porte chaque prop dans son attribut habituel, et en plus dans `mjs-props` ce que le texte ne sait pas dire', async () => {
    const r   = await renderer.renderToString('mjs-pt-somme', { props: { a: 5, b: 7, c: true, o: { k: 1 }, l: 'true', titre: 'Stylo' } })
    const tag = balise(r.html, 'mjs-pt-somme')
    const m   = tag.match(/ mjs-props="([^"]*)"/)
    assert.ok(m, `l'attribut mjs-props est posé — balise : ${tag}`)
    assert.deepEqual(JSON.parse(m![1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&')), { a: 5, b: 7, l: 'true' }, 'mjs-props ne porte que ce que le texte ne sait pas dire')
    assert.match(tag, / titre="Stylo"/, 'une chaîne garde son attribut')
    assert.match(tag, / c="true"/, 'un booléen garde son attribut')
    assert.match(tag, / o="\{&quot;k&quot;:1\}"/, 'un objet garde son attribut JSON')
    assert.match(tag, / a="5" b="7"/, 'un nombre garde aussi son attribut texte')
    assert.match(tag, / l="true"/, 'une chaîne que la balise relirait autrement garde aussi son attribut')
  })

  it('aucune prop typée : pas d\'attribut `mjs-props`', async () => {
    const r = await renderer.renderToString('mjs-pt-somme', { props: { titre: 'Stylo', c: false } })
    assert.doesNotMatch(balise(r.html, 'mjs-pt-somme'), /mjs-props/, 'rien à typer, rien d\'ajouté')
  })

  it('le texte d\'un nombre et le JSON d\'une chaîne échappés dans la balise', async () => {
    const r   = await renderer.renderToString('mjs-pt-somme', { props: { a: 5, b: 7, o: { k: 1 }, l: '{"x":"<b>&"}', titre: 'T' } })
    const tag = balise(r.html, 'mjs-pt-somme')
    assert.doesNotMatch(tag, /<b>/, `aucun « < » brut dans la balise : ${tag}`)
    assert.equal(texte(r.html, 'v').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'), '{"k":1}|{"x":"<b>&"}|T', 'la chaîne arrive telle quelle')
  })

  it('prop typée par `<vars>` (`$a int`) : 12', async () => {
    const r = await renderer.renderToString('mjs-pt-typee', { props: { a: 5, b: 7 } })
    assert.equal(texte(r.html, 's'), '12', `la somme rendue — HTML : ${r.html}`)
    assert.equal(texte(r.html, 't'), 'number/number', 'les types reçus')
  })

  it('parent qui passe des nombres (`<@pt-somme a={5} b={7}>`) : 12, sans attribut sur l\'enfant', async () => {
    const r = await renderer.renderToString('mjs-pt-parent', { ssrMode: 'markers' })
    assert.equal(texte(r.html, 's'), '12', `la somme rendue — HTML : ${r.html}`)
    assert.equal(texte(r.html, 't'), 'number/number/boolean/object/string/object', 'les types reçus')
    assert.doesNotMatch(balise(r.html, 'mjs-pt-somme'), / a=|mjs-props/, 'les props d\'un parent ne passent pas par la balise')
  })
})

describe('rendu à la demande (`mjs serve`) : props du chargeur `.server.mjs` typées', function () {
  this.timeout(60000)

  it('un chargeur qui rend des nombres : 12 dans la page servie, `mjs-props` sur la balise', async () => {
    const root   = mjsTmp('ssr-props-racine-typees-serve')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'pt-somme.mjs'), SOMME)
    writeFileSync(join(root, 'serve.server.mjs'), `export default {
  props: {
    '/': (params, req) -> { a: 5, b: 7, titre: 'Stylo' }
  }
}
`)
    const config  = { sourceDir: 'src', outputDir: 'out', render: { routes: { '/': { component: 'mjs-pt-somme', mode: 'ssr' as const } } } }
    const running = await startRenderServer(config as any, root, { port: 0 })
    try {
      const res  = await fetch(`http://127.0.0.1:${running.port}/`)
      const html = await res.text()
      assert.equal(res.status, 200)
      assert.equal(texte(html, 's'), '12', `la somme rendue — HTML : ${html.slice(0, 600)}`)
      assert.equal(texte(html, 't'), 'number/number/undefined/undefined/undefined/undefined', 'les types reçus')
      assert.match(balise(html, 'mjs-pt-somme'), / mjs-props="/, 'les nombres voyagent typés jusqu\'au client')
    } finally {
      await running.close()
      await terminateSharedWorkerPool()
    }
  })
})
