// `µrefresh($x)` signale un changement fait hors de MJS dans ce que tient `$x` (bibliothèque, script extérieur, objet gardé
// dans une variable sans `$`) : ce qui affiche `$x` se redessine et les valeurs dérivées qui le lisent se refont, avec ou sans
// la précision des valeurs calculées, sans relancer aucun `µeffect`. Avec la précision, en développement seulement, une valeur
// précise qui sert son dernier calcul alors que son recalcul donne autre chose est signalée par un avertissement, un par
// valeur et par composant, qui dit quoi écrire ; la valeur servie reste celle de la production. Aucun avertissement sur des
// valeurs que seul le composant change. `µrefresh` sur autre chose qu'une variable `$` du composant ou une clé du magasin est refusé à
// la construction

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  // un objet donné par la page, que la page change ensuite elle-même (`o.n = 4`) : un changement fait hors de MJS. Avec la
  // précision, `$fois` est précise (elle appelle des méthodes de liste) ; `$double`, un calcul simple, reste à l'horloge
  'raf-liste.mjs': `<script>
$sel = { n: 1, l: [1, 2] }
$k = 0
$double = $sel.n * 2
$fois = $sel.l.map((x) -> x * $sel.n).join(',')
µeffect ->
  window.__rafEff = (window.__rafEff or 0) + 1
  window.__rafEffN = $sel.n
@choisir = (o) -> $sel = o
@raf = -> µrefresh($sel)
@rafNu = -> µrefresh $sel
@rafK = -> µrefresh($k)
@inck = -> $k += 1
@lire = -> $fois
</script>
<p class="f">{$sel.n + '|' + $double + '|' + $fois + '|' + $k}</p>
<button class="b" @click={µrefresh($sel)}>r</button>
`,
  // des valeurs précises que seul le composant change : aucun avertissement
  'raf-calme.mjs': `<script>
$n = 1
$t = 0
$rows = [{ v: 1 }, { v: 2 }, { v: 3 }]
$double = $n * 2
$grands = $rows.filter((r) -> r.v > $n)
$obj = { a: $n, b: [$n] }
$quand = new Date(2020, 0, $n)
$fmt = new Intl.NumberFormat('fr-FR')
$fn = -> $n + 1
@inct = -> $t += 1
@incn = -> $n += 1
@pousse = -> $rows.push({ v: 9 })
@modif = -> $rows[0].v = 7
</script>
<p class="g">{$double + '|' + $grands.length + '|' + $obj.a + '|' + $quand.getDate() + '|' + $fmt.format(1) + '|' + $fn() + '|' + $t}</p>
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
  const a = await neuf('mjs-raf-liste', 'f')
  const ecrans = []
  window.__o = { n: 1, l: [1, 2] }
  await pas(() => a.choisir(window.__o)); ecrans.push(txt(a, 'f'))
  await pas(() => { window.__o.n = 4; a.inck() }); ecrans.push(txt(a, 'f'))
  const eff = window.__rafEff
  await pas(() => { window.__o.n = 5; a.raf() }); ecrans.push(txt(a, 'f'))
  await pas(() => a.inck()); ecrans.push(txt(a, 'f'))
  await pas(() => { window.__o.n = 6; a.rafNu() }); ecrans.push(txt(a, 'f'))
  await pas(() => { window.__o.n = 7; a._shadow.querySelector('.b').click() }); ecrans.push(txt(a, 'f'))
  // repassée à l'horloge pour toujours : la valeur suit le changement fait dehors à l'écriture suivante du composant
  await pas(() => { window.__o.n = 8; a.inck() }); ecrans.push(txt(a, 'f'))
  // une primitive : redessinée, rien ne change
  await pas(() => a.rafK()); ecrans.push(txt(a, 'f'))
  R.ecrans = ecrans
  R.lu = a.lire()
  R.effets = [eff, window.__rafEff, window.__rafEffN]
  const g = await neuf('mjs-raf-calme', 'g')
  await pas(() => g.inct()); await pas(() => g.inct()); await pas(() => g.incn())
  await pas(() => g.pousse()); await pas(() => g.modif()); await pas(() => g.inct())
  R.calme = txt(g, 'g')
  R.avertissements = window.__W.filter((w) => w.includes('µrefresh'))
  return R
})()`

function attendu(precise: boolean, prod: boolean) {
  return {
    // la page a changé l'objet sans MJS : à l'horloge, une valeur suit à l'écriture suivante du composant ; précise, elle
    // garde son dernier calcul (développement comme production) ; `µrefresh` remet tout d'aplomb, sans relancer l'effet, et
    // la valeur précise repasse à l'horloge pour toujours
    ecrans: ['1|2|1,2|0', precise ? '4|8|1,2|1' : '4|8|4,8|1', '5|10|5,10|1', '5|10|5,10|2', '6|12|6,12|2', '7|14|7,14|2', '8|16|8,16|3', '8|16|8,16|3'],
    lu: '8,16',
    effets: [2, 2, 1],
    calme: '4|3|2|2|1|3|3',
    nombre: precise && !prod ? 1 : 0,
  }
}

async function construire(prod: boolean, precise: boolean, sources = SOURCES): Promise<{ code: string, erreurs: string[] }> {
  const root   = mjsTmp('rafraichir')
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

function verifier(r: any, precise: boolean, prod: boolean) {
  const a = attendu(precise, prod)
  assert.deepEqual({ ecrans: r.ecrans, lu: r.lu, effets: r.effets, calme: r.calme }, { ecrans: a.ecrans, lu: a.lu, effets: a.effets, calme: a.calme })
  assert.equal(r.avertissements.length, a.nombre, r.avertissements.join('\n'))
  if (a.nombre === 1) {
    const w = r.avertissements[0]
    for (const morceau of ['$fois', 'mjs-raf-liste', 'µrefresh($sel)', 'hors de MJS']) assert.ok(w.includes(morceau), 'il manque « ' + morceau + ' » : ' + w)
  }
}

describe('`µrefresh($x)` et l\'avertissement de la précision en développement', function () {
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

        it('happy-dom : écran redessiné, valeurs justes, aucun effet relancé, avertissements attendus', async () => {
          const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
          window.eval(RELEVE)
          window.eval(code)
          verifier(JSON.parse(JSON.stringify(await window.eval(SCENARIO))), precise, prod)
          await window.happyDOM.close()
        })

        if (!prod) return
        for (const moteur of ['chromium', 'firefox', 'webkit']) {
          it(`${moteur} : écran redessiné, valeurs justes, aucun effet relancé`, async function () {
            const playwright: any = await import('playwright')
            if (!existsSync(playwright[moteur].executablePath())) return this.skip()
            const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
            try {
              const page = await browser.newPage()
              const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${RELEVE}</script><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
              await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
              await page.goto('http://mjs.test/')
              verifier(await page.evaluate(SCENARIO), precise, prod)
            }
            finally {
              await browser.close()
            }
          })
        }
      })
    }
  }

  describe('refusé à la construction sur autre chose qu\'une variable `$` du composant ou une clé du magasin', function () {
    const fautes: Record<string, string> = {
      chemin: '<script>\n$a = { b: [] }\n@f = -> µrefresh($a.b)\n</script>\n<p>{$a.b.length}</p>\n',
      sansDollar: '<script>\nliste = []\n@f = -> µrefresh(liste)\n</script>\n<p>x</p>\n',
      vide: '<script>\n@f = -> µrefresh()\n</script>\n<p>x</p>\n',
      deux: '<script>\n$a = []\n$b = []\n@f = -> µrefresh($a, $b)\n</script>\n<p>{$a.length + $b.length}</p>\n',
      gabarit: '<script>\n$a = []\n</script>\n<button @click={µrefresh($a.length)}>{$a.length}</button>\n',
    }
    for (const [nom, src] of Object.entries(fautes)) {
      it(nom, async () => {
        const b = await construire(false, false, { 'raf-faute.mjs': src })
        assert.ok(b.erreurs.some((e) => e.includes('µrefresh') && e.includes('variable')), b.erreurs.join('\n') || 'aucune erreur')
      })
    }
  })
})
