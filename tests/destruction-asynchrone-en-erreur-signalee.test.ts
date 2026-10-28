// un `µdestroy` asynchrone qui rejette est signalé comme un `µdestroy` qui lève : même message, même console (µ.warn), où que soit
// son composant — dans un `{if}`, un `{key}`, un contenu `{{…}}`, une ligne de `{for}`. Aucun rejet ne reste non géré

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { attendre, pause } from './helpers/coeur-monter.js'

const HOTE = `<script lang="js">
  $show = true;
  $k = 1;
  $html = '<mjs-fin-html></mjs-fin-html>';
  $l = [1];
  @setShow = function(v) { $show = v; };
  @setK = function(v) { $k = v; };
  @setHtml = function(v) { $html = v; };
  @setL = function(v) { $l = v; };
</script>
{if $show}<@fin-si>{end}
{key $k}<@fin-cle><@fin-sync>{end}
<div class="h">{{$html}}</div>
<ul>{for v in $l}<li><@fin-ligne></li>{end}</ul>
`

const FIN = (nom: string) => `<script>
µdestroy ->
  await Promise.resolve()
  throw new Error('${nom}')
</script>
<p class="${nom}">${nom}</p>
`

const SYNC = `<script>
µdestroy ->
  throw new Error('fin-sync')
</script>
<p class="fin-sync">fin-sync</p>
`

async function monter(): Promise<{ window: any; hote: any; signales: () => string[]; rejets: string[] }> {
  const root   = mjsTmp('destruction-asynchrone')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
  for (const nom of ['fin-si', 'fin-cle', 'fin-html', 'fin-ligne']) writeFileSync(join(srcDir, nom + '.mjs'), FIN(nom))
  writeFileSync(join(srcDir, 'fin-sync.mjs'), SYNC)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const code  = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(`${code}\nglobalThis.µ = µ;\nglobalThis.__sig = [];\nµ.error = function(...a) { globalThis.__sig.push('error ' + a.map(String).join(' ')); };\nµ.warn = function(...a) { globalThis.__sig.push('warn ' + a.map(String).join(' ')); };`)
  const rejets: string[] = []
  window.addEventListener('unhandledrejection', (e: any) => rejets.push(String(e.reason && e.reason.message)))
  window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
  const hote = window.document.querySelector('mjs-hote')
  await attendre(() => !!hote._shadow && !!hote._shadow.querySelector('mjs-fin-html') && !!hote._shadow.querySelector('mjs-fin-html')._shadow)
  await pause(120)
  return { window, hote, signales: () => Array.from(window.eval('globalThis.__sig.splice(0)')), rejets }
}

describe('µdestroy asynchrone qui rejette : signalé comme un µdestroy qui lève', function () {
  this.timeout(60000)

  let hote: any, signales: () => string[], rejets: string[]
  const rejetsNode: string[] = []
  const surRejet = (r: any) => { rejetsNode.push(String(r && r.message)) }
  // le message d'un µdestroy qui lève, relevé au changement de clé : la référence des rejets
  let reference = ''
  const attendu = (nom: string) => reference.replace('fin-sync', nom)

  before(async () => {
    process.on('unhandledRejection', surRejet)
    ;({ hote, signales, rejets } = await monter())
    assert.deepEqual(signales(), [])
  })

  after(async () => {
    process.off('unhandledRejection', surRejet)
    await terminateSharedWorkerPool()
  })

  it('{key} : le rejet est signalé, avec le message d\'un µdestroy qui lève', async () => {
    hote.setK(2)
    let vus: string[] = []
    await attendre(() => (vus = vus.concat(signales())).length >= 2)
    reference = vus.find((s) => s.includes('fin-sync')) || ''
    assert.ok(reference.startsWith('warn ') && reference.includes('Error: fin-sync'), `µdestroy qui lève : ${JSON.stringify(vus)}`)
    assert.deepEqual(vus.sort(), [attendu('fin-cle'), reference].sort())
  })

  it('{if} : le rejet est signalé', async () => {
    hote.setShow(false)
    let vus: string[] = []
    await attendre(() => (vus = vus.concat(signales())).length >= 1)
    assert.deepEqual(vus, [attendu('fin-si')])
  })

  it('contenu {{…}} : le rejet est signalé', async () => {
    hote.setHtml('<b>x</b>')
    let vus: string[] = []
    await attendre(() => (vus = vus.concat(signales())).length >= 1)
    assert.deepEqual(vus, [attendu('fin-html')])
  })

  it('ligne de {for} : le rejet est signalé', async () => {
    hote.setL([])
    let vus: string[] = []
    await attendre(() => (vus = vus.concat(signales())).length >= 1)
    assert.deepEqual(vus, [attendu('fin-ligne')])
  })

  it('aucun rejet non géré', async () => {
    await pause(50)
    assert.deepEqual(rejets, [])
    assert.deepEqual(rejetsNode, [])
  })
})
