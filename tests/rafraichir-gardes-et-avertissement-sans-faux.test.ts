// `µrefresh($x)` et le contrôle des valeurs précises en développement, sur leurs bords :
// - deux objets neufs de même contenu au-delà de 6 niveaux (ou qui se contiennent eux-mêmes) ne font pas conclure à une
//   différence : aucun avertissement quand rien n'a été changé hors de MJS ;
// - `µrefresh` dans le PARENT : l'enfant qui reçoit l'objet est prévenu quand le parent le lui repose, sa valeur dérivée se
//   refait et son écran suit, avec ou sans la précision ;
// - un objet donné à deux composants et changé hors de MJS : la valeur précise qui le lit est à l'horloge, elle suit à
//   l'écriture suivante du composant, sans avertissement ;
// - refusés à la construction : plusieurs arguments (`µrefresh $a, $b` compris), une valeur dérivée, une variable que le
//   composant ne déclare pas, et `µrefresh` dans le gabarit hors d'un gestionnaire d'événement (le redessin qu'il demande
//   relirait l'expression qui l'appelle : une boucle de rendu)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  // le parent donne l'objet à l'enfant par une liaison, puis signale un changement fait hors de MJS
  'rafp-parent.mjs': `<script>
$x = { n: 1, l: [1] }
@choisir = (o) -> $x = o
@raf = -> µrefresh($x)
</script>
<p class="v">{$x.n}</p>
<mjs-rafp-enfant x=!{$x}></mjs-rafp-enfant>
`,
  'rafp-enfant.mjs': `<script>
$x = { n: 0, l: [1] }
$k = 0
$fois = $x.l.map((v) -> v * $x.n).join(',')
@inck = -> $k += 1
@lire = -> $fois
</script>
<p class="e">{$x.n + '|' + $fois + '|' + $k}</p>
`,
  // des objets neufs à chaque calcul, plus profonds que la comparaison, ou qui se contiennent eux-mêmes
  'rafp-profond.mjs': `<script>
$rows = []
$k = 0
$profond = $rows.map((r) -> {a: {b: {c: {d: {e: {f: {g: r.id}}}}}}})
$cycle = $rows.map((r) -> ((o) -> Object.assign(o, {moi: o}))({id: r.id}))
@choisir = (x) -> $rows = x
@inck = -> $k += 1
</script>
<p class="p">{$profond.length + '|' + $cycle.length + '|' + $k}</p>
`,
  // le même objet donné à deux instances
  'rafp-deux.mjs': `<script>
$sel = { n: 1, l: [1, 2] }
$k = 0
$fois = $sel.l.map((x) -> x * $sel.n).join(',')
@choisir = (o) -> $sel = o
@inck = -> $k += 1
</script>
<p class="d">{$fois + '|' + $k}</p>
`,
}

// avertissements du cœur, relevés avant son chargement
const RELEVE = `window.__W = [];
(function () {
  var w = console.warn;
  console.warn = function () { window.__W.push(Array.prototype.map.call(arguments, String).join(' ')); return w.apply(console, arguments); };
})();`

const SCENARIO = `(async () => {
  const R = {}
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const neuf = async (tag, cls) => { const el = document.createElement(tag); document.body.appendChild(el); await attendre(() => el._shadow?.querySelector('.' + cls)); await pause(200); return el }
  const txt = (el, cls) => el._shadow.querySelector('.' + cls).textContent
  const pas = async (f) => { f(); await pause(200) }
  const p = await neuf('mjs-rafp-parent', 'v')
  await attendre(() => p._shadow.querySelector('mjs-rafp-enfant')?._shadow?.querySelector('.e'))
  await pause(200)
  const e = p._shadow.querySelector('mjs-rafp-enfant')
  const ecrans = []
  const o = { n: 1, l: [1, 2] }
  await pas(() => p.choisir(o)); ecrans.push(txt(p, 'v') + '/' + txt(e, 'e'))
  await pas(() => { o.n = 5; e.inck() }); ecrans.push(txt(p, 'v') + '/' + txt(e, 'e'))
  await pas(() => { o.n = 6; p.raf() }); ecrans.push(txt(p, 'v') + '/' + txt(e, 'e'))
  R.lu = e.lire()
  await pas(() => e.inck()); ecrans.push(txt(p, 'v') + '/' + txt(e, 'e'))
  R.ecrans = ecrans
  const w = await neuf('mjs-rafp-profond', 'p')
  await pas(() => w.choisir([{ id: 1 }, { id: 2 }])); await pas(() => w.inck()); await pas(() => w.inck())
  R.profond = txt(w, 'p')
  const d1 = await neuf('mjs-rafp-deux', 'd')
  const d2 = await neuf('mjs-rafp-deux', 'd')
  const o2 = { n: 1, l: [1, 2] }
  await pas(() => { d1.choisir(o2); d2.choisir(o2) })
  await pas(() => { o2.n = 4; d1.inck() })
  R.deux = txt(d1, 'd') + '/' + txt(d2, 'd')
  R.avertissements = window.__W.filter((x) => x.includes('µrefresh') || x.includes('10 000'))
  return R
})()`

const ATTENDU = {
  // parent : µrefresh redessine le parent et l'enfant qui reçoit l'objet, dont la valeur dérivée se refait
  ecrans: ['1/1|1,2|0', '1/5|5,10|1', '6/6|6,12|1', '6/6|6,12|2'],
  lu: '6,12',
  profond: '2|2|2',
  deux: '4,8|1/1,2|0',
  avertissements: [] as string[],
}

async function construire(prod: boolean, precise: boolean, sources = SOURCES): Promise<{ code: string, erreurs: string[] }> {
  const root   = mjsTmp('rafraichir-gardes')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(sources)) writeFileSync(join(srcDir, nom), src)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js') }
  opts.derivedMode = precise ? 'precise' : 'clock'
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  const erreurs = stats.errors.map((e: any) => String(e.message))
  if (erreurs.length > 0) return { code: '', erreurs }
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const code  = prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  return { code, erreurs }
}

describe('`µrefresh($x)` et le contrôle de la précision : refus à la construction, enfant prévenu, aucun faux avertissement', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const precise of [false, true]) {
    for (const prod of [false, true]) {
      describe((precise ? 'précision' : 'horloge') + ', ' + (prod ? 'production' : 'développement'), function () {
        let code: string
        before(async () => {
          const b = await construire(prod, precise)
          assert.deepEqual(b.erreurs, [])
          code = b.code
        })

        it('happy-dom : enfant aligné sur l\'horloge, objets profonds et objet partagé sans avertissement', async () => {
          const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
          window.eval(RELEVE)
          window.eval(code)
          assert.deepEqual(JSON.parse(JSON.stringify(await window.eval(SCENARIO))), ATTENDU)
          await window.happyDOM.close()
        })

        if (!prod) return
        for (const moteur of ['chromium', 'firefox', 'webkit']) {
          it(`${moteur} : enfant aligné sur l'horloge, objets profonds et objet partagé sans avertissement`, async function () {
            const playwright: any = await import('playwright')
            if (!existsSync(playwright[moteur].executablePath())) return this.skip()
            const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
            try {
              const page = await browser.newPage()
              const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${RELEVE}</script><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
              await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
              await page.goto('http://mjs.test/')
              assert.deepEqual(await page.evaluate(SCENARIO), ATTENDU)
            }
            finally {
              await browser.close()
            }
          })
        }
      })
    }
  }

  // chaque faute, avec ce que son message doit nommer
  const fautes: Record<string, [string, string[]]> = {
    virgule: ['<script>\n$a = []\n$b = []\n@f = -> µrefresh $a, $b\n</script>\n<p>{$a.length + $b.length}</p>\n', ['µrefresh', 'variable']],
    virguleGestionnaire: ['<script>\n$a = []\n$b = []\n</script>\n<button @click={µrefresh $a, $b}>{$a.length + $b.length}</button>\n', ['µrefresh', 'variable']],
    derivee: ['<script>\n$a = { n: 1 }\n$d = $a.n * 2\n@f = -> µrefresh($d)\n</script>\n<p>{$d}</p>\n', ['µrefresh($d)', 'variable']],
    deriveeGestionnaire: ['<script>\n$a = { n: 1 }\n$d = $a.n * 2\n</script>\n<button @click={µrefresh($d)}>{$d}</button>\n', ['µrefresh($d)', 'variable']],
    inconnue: ['<script>\n$a = 1\n@f = -> µrefresh($inconnu)\n</script>\n<p>{$a}</p>\n', ['µrefresh($inconnu)', 'variable']],
    interpolation: ['<script>\n$a = { n: 1 }\n</script>\n<p>{(µrefresh($a) or \'\') + $a.n}</p>\n', ['µrefresh', '@click']],
    attribut: ['<script>\n$a = { n: 1 }\n</script>\n<p title={µrefresh($a)}>{$a.n}</p>\n', ['µrefresh', '@click']],
  }
  for (const precise of [false, true]) {
    describe('refusé à la construction (' + (precise ? 'précision' : 'horloge') + ')', function () {
      for (const [nom, [src, morceaux]] of Object.entries(fautes)) {
        it(nom, async () => {
          const b = await construire(false, precise, { 'rafp-faute.mjs': src })
          assert.ok(b.erreurs.some((e) => morceaux.every((m) => e.includes(m))), (b.erreurs.join('\n') || 'aucune erreur') + '\nattendu : ' + morceaux.join(', '))
        })
      }
    })
  }
})
