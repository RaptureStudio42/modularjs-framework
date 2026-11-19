// rendu serveur d'un `<@element $t>` ou d'un `<@module $c>` dont le nom vient de l'état : le document du serveur ne contrôle pas le nom et
// l'écrivait tel quel dans la page — « img src=x onerror=… » y devenait une balise qui exécute son gestionnaire dans le navigateur. Le nom
// passe au serveur le contrôle du navigateur : aucune balise piégée dans la page, un nom valide passe, la suite du composant est rendue
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { resolveBundlerOpts } from '../src/bundler/config.js'
import { mjsTmp } from './helpers/tmp.js'

const DYN = `<script>
  $t = 'img src=x onerror=window.__xss=1'
  $v = 'svg/onload=window.__xss=2'
  $u = 'h 3'
  $m = 'img src=y onerror=window.__xss=3'
  $ok = 'h3'
</script>

<@element $t>un</@element>
<@element $v>deux</@element>
<@element $u>trois</@element>
<@module $m></@module>
<@element $ok>quatre</@element>
<p class="fin">fin</p>
`

describe('<@element> et <@module> au rendu serveur : un nom piégé venu de l\'état', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('« img src=x onerror=… », « svg/onload=… » et « h 3 » ne sortent pas en balise ; « h3 » passe ; la suite est rendue', async () => {
    const root = mjsTmp('dyn-nom-serveur')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'dyn.mjs'), DYN)
    const renderer = await createSSRRenderer({ sourceDir: join(root, 'src'), outputDir: join(root, 'public/out'), bundlerOpts: resolveBundlerOpts({ sourceDir: 'src', outputDir: 'public/out' } as any, root) } as any)
    let html = ''
    try { html = (await renderer.renderToString('mjs-dyn', { ssrMode: 'markers' } as any)).html } finally { await renderer.close() }
    const corps = html.slice(html.indexOf('<mjs-dyn'))
    const vu    = { img: /<img[\s/]/.test(corps), svg: /<svg[\s/]/.test(corps), espace: /<h 3/.test(corps), h3: /<h3[\s>]/.test(corps), fin: corps.includes('<p class="fin">fin</p>') }
    assert.deepEqual(vu, { img: false, svg: false, espace: false, h3: true, fin: true }, corps.slice(0, 600))
  })
})
