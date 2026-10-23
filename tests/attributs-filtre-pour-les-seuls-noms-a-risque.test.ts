// Le filtre des attributs calculés (`µ._mjs_safeAttr` : gestionnaires `on…`, `srcdoc`, adresses `javascript:`…) ne court plus
// que pour un nom qu'il peut refuser. Le nom d'un attribut écrit dans le gabarit est connu à la compilation : pour `title`,
// `data-id`, `aria-label`…, l'écriture compilée le dit au runtime (dernier argument `1`), qui pose la valeur sans le filtre ;
// `class` et un `aria-*` à `false` ne le traversent plus non plus. Un nom à risque (`href`, `src`, `xlink:href`, `action`,
// `formaction`, `poster`, `ping`, `background`, `data`, `codebase`, `srcdoc`, `on…`), quelle que soit sa casse, et un nom
// calculé (étalement `{...attrs}`) gardent le filtre : même sûreté, en développement comme en production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCE = `<script lang="coffee">
$u = 'javascript:alert(1)'
$c = 'actif'
$d = 7
$a = 'etiquette'
$t = 'titre'
$o = 'alert(2)'
$s = '<script>alert(3)</script>'
$lignes = [{id: 1, u: 'javascript:alert(4)', d: 8, c: 'ligne'}]
$etale = {onclick: 'alert(5)', 'data-x': 'x'}
</script>
<a id="lien" href={$u} class={$c} data-id={$d} aria-label={$a} title={$t} onclick={$o} onMouseOver={$o} srcdoc={$s} formaction={$u} poster={$u} ping={$u} background={$u}>x</a>
<img class="image" src={$u} alt={$t}>
<object class="objet" data={$u} codebase={$u}></object>
<p class="etale" {...$etale}>e</p>
<ul>{for l in $lignes by id}<li class={l.c} data-id={l.d} title={l.c}><a href={l.u}>l</a></li>{end}</ul>
`

const SURS     = ['data-id', 'aria-label', 'title', 'alt']
const A_RISQUE = ['href', 'onclick', 'onMouseOver', 'srcdoc', 'formaction', 'poster', 'ping', 'background', 'src', 'data', 'codebase']

async function construire(prefixe: string, prod: boolean): Promise<{ code: string, composant: string }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'attr-sur.mjs'), SOURCE)
  const opts: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  if (prod) return { code: readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, ''), composant: '' }
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  const comp  = files.find((f) => f.startsWith('attr-sur'))!
  return { code: files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n'), composant: readFileSync(join(outDir, comp), 'utf-8') }
}

async function monter(code: string, prod: boolean, espion?: string[]) {
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(prod ? code : `${code}\nglobalThis.µ = µ;`)
  if (espion) {
    const avant = window.µ._mjs_safeAttr
    window.µ._mjs_safeAttr = function (this: any, ...args: any[]) { espion.push(args[1]); return avant.apply(this, args) }
  }
  window.document.body.innerHTML = '<mjs-attr-sur></mjs-attr-sur>'
  const el  = window.document.querySelector('mjs-attr-sur')
  const fin = Date.now() + 3000
  while (!el._shadow?.querySelector('li') && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  await new Promise((r) => setTimeout(r, 30))
  return { window, sh: el._shadow }
}

// ce que la page porte : les valeurs dangereuses n'y sont pas, les autres y sont
function verifierPage(sh: any): void {
  const a = sh.querySelector('#lien')
  for (const nom of ['href', 'formaction', 'ping']) assert.notEqual(a.getAttribute(nom), 'javascript:alert(1)', nom + ' : adresse javascript: refusée')
  for (const nom of ['onclick', 'onmouseover']) assert.notEqual(a.getAttribute(nom), 'alert(2)', nom + ' : gestionnaire refusé')
  assert.notEqual(a.getAttribute('srcdoc'), '<script>alert(3)</script>', 'srcdoc refusé')
  assert.notEqual(sh.querySelector('img').getAttribute('src'), 'javascript:alert(1)')
  assert.notEqual(sh.querySelector('object').getAttribute('data'), 'javascript:alert(1)', 'data d\'un <object> : adresse refusée')
  assert.notEqual(sh.querySelector('li a').getAttribute('href'), 'javascript:alert(4)', 'ligne de {for} : adresse refusée')
  assert.notEqual(sh.querySelector('p.etale').getAttribute('onclick'), 'alert(5)', 'nom calculé (étalement) : gestionnaire refusé')
  assert.equal(sh.querySelector('p.etale').getAttribute('data-x'), 'x')
  assert.equal(a.getAttribute('class'), 'actif')
  assert.equal(a.getAttribute('data-id'), '7')
  assert.equal(a.getAttribute('aria-label'), 'etiquette')
  assert.equal(a.getAttribute('title'), 'titre')
  assert.equal(sh.querySelector('img').getAttribute('alt'), 'titre')
  const li = sh.querySelector('li')
  assert.deepEqual([li.getAttribute('class'), li.getAttribute('data-id'), li.getAttribute('title')], ['ligne', '8', 'ligne'])
}

describe('attributs calculés : le filtre pour les seuls noms à risque, connus du compilateur', function () {
  this.timeout(120000)
  const builds: Record<string, { code: string, composant: string }> = {}

  before(async function () {
    this.timeout(240000)
    builds.dev  = await construire('attr-sur', false)
    builds.prod = await construire('attr-sur-prod', true)
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('code compilé : un nom sans risque porte `1`, un nom à risque n\'en porte pas', () => {
    const appels = builds.dev.composant.match(/_mjs_updAttr(?:Node)?\([^;]*?\)/g) ?? []
    const dit = (nom: string): string[] => appels.filter((x) => x.includes(`'${nom}', `))
    for (const nom of SURS) {
      assert.ok(dit(nom).length > 0, nom + ' : écriture trouvée')
      for (const x of dit(nom)) assert.ok(x.endsWith(', 1)'), nom + ' sans risque : ' + x)
    }
    for (const nom of A_RISQUE) {
      assert.ok(dit(nom).length > 0, nom + ' : écriture trouvée')
      for (const x of dit(nom)) assert.ok(!x.endsWith(', 1)'), nom + ' à risque, le filtre reste : ' + x)
    }
  })

  it('développement : le filtre ne voit que les noms à risque ; la page ne porte aucune valeur dangereuse', async () => {
    const vus: string[] = []
    const m = await monter(builds.dev.code, false, vus)
    verifierPage(m.sh)
    const noms = [...new Set(vus)]
    for (const nom of ['href', 'onclick', 'srcdoc', 'src', 'data']) assert.ok(noms.includes(nom), nom + ' passe par le filtre : ' + noms.join(','))
    for (const nom of ['class', 'data-id', 'aria-label', 'title', 'alt']) assert.ok(!noms.includes(nom), nom + ' ne paie plus le filtre : ' + noms.join(','))
    assert.ok(noms.includes('onclick') && noms.includes('data-x'), 'l\'étalement (nom calculé) garde le filtre : ' + noms.join(','))
  })

  it('production : même page, aucune valeur dangereuse posée', async () => {
    const m = await monter(builds.prod.code, true)
    verifierPage(m.sh)
  })
})
