// `µrefresh($x)` pendant un rendu ou le calcul d'une valeur dérivée : jamais ignoré, appliqué juste après
// - à l'exécution, l'appel d'un écouteur que le rendu déclenche (le blur ou le focusout du champ qu'il retire sous Chromium, le
//   focus ou le focusin d'un `el.focus()` dans `@attach`, un clic lancé par une fonction du gabarit) redessine juste après ce
//   rendu : gestionnaire du gabarit, `µon`, écouteur qu'une bibliothèque pose, même quand il déplace le focus avant de
//   l'appeler, deux écouteurs du même événement, un écouteur qui attend (`await`) avant de l'appeler ; le cœur ne pose aucun
//   écouteur de focus sur la fenêtre
// - un mauvais usage (une fonction du script lue par le gabarit, une valeur dérivée, un gabarit qui relance l'événement à chaque
//   rendu) relance le rendu à chaque appel : le détecteur de boucle coupe le composant, la page reste vivante ; en
//   développement, un avertissement nomme `µrefresh` et dit où l'écrire, la production coupe sans un mot
// - à la construction : refusé dans le gabarit hors d'un gestionnaire, par un message qui nomme le cas (`@attach`, condition d'un
//   `{if}`…) ; `@in:fade={…}` écoute l'événement nommé « in:fade » : un gestionnaire, où il est admis ; la forme sans parenthèses
//   suivie d'un opérateur ou d'une autre expression (`µrefresh $x or $y`, que Civet lirait `µrefresh($x or $y)`) est refusée ;
//   seule sur son instruction, elle reste admise

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  // une fonction du script, appelée par le gabarit, qui signale $x : chaque rendu l'appelle, chaque appel relance le rendu
  'rafr-gabarit.mjs': `<script>
$x = { n: 1 }
@g = ->
  window.__ng = (window.__ng or 0) + 1
  µrefresh($x)
  ''
</script>
<p class="g">{@g() + $x.n}</p>
`,
  // une valeur dérivée qui signale la variable qu'elle lit : appliqué à chaque calcul, sans boucle (son calcul ne se périme pas lui-même)
  'rafr-derivee.mjs': `<script>
compte = -> window.__nd = (window.__nd or 0) + 1
$x = { n: 1 }
$d = (µrefresh($x) or '') + $x.n + compte() * 0
</script>
<p class="d">{$d}</p>
`,
  // un gestionnaire que le rendu déclenche : le blur du champ que le rendu retire (Chromium seul l'émet), qui signale $items
  'rafr-flou.mjs': `<script>
brut = {v: 'a'}
$items = brut
$edit = true
@commit = ->
  window.__commit = (window.__commit or 0) + 1
  brut.v = 'b' + window.__commit
  µrefresh($items)
@fermer = -> $edit = false
</script>
<p class="v">{$items.v}</p>
{if $edit}<input class="i" aria-label="nom" @blur={@commit}>{end}
`,
  // un clic lancé par une fonction du gabarit, dont le gestionnaire signale $items
  'rafr-clic.mjs': `<script>
brut = {v: 'a'}
$items = brut
$t = 0
@clic = ->
  window.__clic = (window.__clic or 0) + 1
  brut.v = 'c' + window.__clic
  µrefresh($items)
@g = ->
  b = _mjsThis._shadow?.querySelector('.b')
  b.click() if b and $t > 0
  ''
@tick = -> $t = $t + 1
</script>
<p class="v">{$items.v}</p>
<p class="w">{@g()}{$t}</p>
<button class="b" @click={@clic}>b</button>
`,
  // le même clic, lancé à chaque rendu de ce que le gestionnaire redessine : une boucle, coupée par le détecteur de boucle
  'rafr-boucle.mjs': `<script>
$items = {v: 'a'}
$on = 0
@clic = ->
  window.__bc = (window.__bc or 0) + 1
  µrefresh($items)
@g = ->
  b = _mjsThis._shadow?.querySelector('.b')
  b.click() if b and $on
  ''
@go = -> $on = 1
</script>
<p class="v">{@g() + $items.v + $on}</p>
<button class="b" @click={@clic}>b</button>
`,
  // un écouteur posé par une bibliothèque (addEventListener dans @attach) que le rendu déclenche : le blur du champ qu'il retire
  'rafr-biblio.mjs': `<script>
brut = {v: 'a'}
$items = brut
$edit = true
@att = (el) ->
  el.addEventListener 'blur', ->
    window.__lb = (window.__lb or 0) + 1
    brut.v = 'l' + window.__lb
    µrefresh($items)
  undefined
@fermer = -> $edit = false
</script>
<p class="v">{$items.v}</p>
{if $edit}<input class="i" aria-label="nom" :attach={@att}>{end}
`,
  // des écouteurs µon que le rendu déclenche : un clic lancé par une fonction du gabarit, le focusout du champ qu'il retire
  'rafr-on.mjs': `<script>
brut = {v: 'a'}
$items = brut
$edit = true
$t = 0
µmount ->
  µon 'click', '.b', ->
    window.__oc = (window.__oc or 0) + 1
    brut.v = 'c' + window.__oc
    µrefresh($items)
  µon 'focusout', '.i', ->
    window.__of = (window.__of or 0) + 1
    brut.v = 'f' + window.__of
    µrefresh($items)
@g = ->
  b = _mjsThis._shadow?.querySelector('.b')
  b.click() if b and $t == 1 and not window.__ocf
  window.__ocf = 1 if $t == 1
  ''
@fermer = -> $edit = false
@tick = -> $t = $t + 1
</script>
<p class="v">{$items.v}</p>
<p class="w">{@g()}{$t}</p>
{if $edit}<input class="i" aria-label="nom">{end}
<button class="b">b</button>
`,
  // des écouteurs focusin et focusout qu'une bibliothèque pose dans l'arbre d'ombre, que le rendu déclenche : `el.focus()` dans
  // `@attach`, le champ qui a le focus et que le rendu retire (Chromium)
  'rafr-fs.mjs': `<script>
brut = {v: 'a'}
$items = brut
$edit = false
@att = (el) ->
  el.addEventListener 'focusin', ->
    window.__fi = (window.__fi or 0) + 1
    brut.v = 'i' + window.__fi
    µrefresh($items)
  el.addEventListener 'focusout', ->
    window.__fo = (window.__fo or 0) + 1
    brut.v = 'o' + window.__fo
    µrefresh($items)
  el.focus()
  undefined
@ouvrir = -> $edit = true
@fermer = -> $edit = false
</script>
<p class="v">{$items.v}</p>
{if $edit}<input class="i" aria-label="nom" :attach={@att}>{end}
`,
  // un écouteur de bibliothèque qui déplace le focus avant son µrefresh : le focus d'un champ que `@attach` focalise
  'rafr-nid.mjs': `<script>
brut = {v: 'a'}
$items = brut
$edit = false
@att = (el) ->
  el.addEventListener 'focus', ->
    window.__nid = (window.__nid or 0) + 1
    document.querySelector('mjs-rafr-nid')._shadow.querySelector('.autre').focus()
    brut.v = 'n' + window.__nid
    µrefresh($items)
  el.focus()
  undefined
@ouvrir = -> $edit = true
</script>
<p class="v">{$items.v}</p>
<input class="autre" aria-label="autre">
{if $edit}<input class="i" aria-label="nom" :attach={@att}>{end}
`,
  // le même, sur le blur du champ que le rendu retire (Chromium seul l'émet)
  'rafr-nidb.mjs': `<script>
brut = {v: 'a'}
$items = brut
$edit = true
@att = (el) ->
  el.addEventListener 'blur', ->
    window.__nidb = (window.__nidb or 0) + 1
    document.querySelector('mjs-rafr-nidb')._shadow.querySelector('.autre').focus()
    brut.v = 'b' + window.__nidb
    µrefresh($items)
  undefined
@fermer = -> $edit = false
</script>
<p class="v">{$items.v}</p>
<input class="autre" aria-label="autre">
{if $edit}<input class="i" aria-label="nom" :attach={@att}>{end}
`,
  // deux écouteurs du même événement de focus, chacun signale sa variable
  'rafr-deux.mjs': `<script>
ba = {v: 'a'}
bb = {v: 'b'}
$a = ba
$b = bb
$edit = false
@att = (el) ->
  el.addEventListener 'focus', ->
    window.__da = (window.__da or 0) + 1
    ba.v = 'A' + window.__da
    µrefresh($a)
  el.addEventListener 'focus', ->
    window.__db = (window.__db or 0) + 1
    bb.v = 'B' + window.__db
    µrefresh($b)
  el.focus()
  undefined
@ouvrir = -> $edit = true
</script>
<p class="v">{$a.v} | {$b.v}</p>
{if $edit}<input class="i" aria-label="nom" :attach={@att}>{end}
`,
  // un écouteur qui attend une microtâche avant son µrefresh
  'rafr-aw.mjs': `<script>
brut = {v: 'a'}
$items = brut
$edit = false
@att = (el) ->
  el.addEventListener 'focus', ->
    await Promise.resolve()
    window.__aw = (window.__aw or 0) + 1
    brut.v = 'w' + window.__aw
    µrefresh($items)
  el.focus()
  undefined
@ouvrir = -> $edit = true
</script>
<p class="v">{$items.v}</p>
{if $edit}<input class="i" aria-label="nom" :attach={@att}>{end}
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
  const neuf = async (tag, cls) => { const el = document.createElement(tag); document.body.appendChild(el); await attendre(() => el._shadow?.querySelector('.' + cls)); await pause(300); return el }
  const txt = (el, cls) => el._shadow.querySelector('.' + cls).textContent
  const pas = async (f) => { f(); await pause(300) }
  const stable = async (k) => { let n = -1; while (n !== window[k]) { n = window[k]; await pause(200) } return window[k] || 0 }
  const suivi = (n, el, attendu, sans) => !n ? sans : n > 1 ? n + ' appels' : txt(el, 'v') === attendu ? 'suivi' : 'périmé ' + txt(el, 'v')
  // mauvais usage : chaque appel relance le rendu, le détecteur de boucle coupe le composant ; la suite du scénario tourne
  await neuf('mjs-rafr-gabarit', 'g')
  const ng = await stable('__ng')
  R.gabarit = ng > 10000 && ng <= 10200 ? 'coupée' : ng + ' appels'
  await neuf('mjs-rafr-derivee', 'd')
  const nd = await stable('__nd')
  R.derivee = nd > 10000 && nd <= 10200 ? 'coupée' : nd + ' calculs'
  // un écouteur que le rendu déclenche : son µrefresh est appliqué juste après ce rendu, l'écran suit
  const f = await neuf('mjs-rafr-flou', 'i')
  f._shadow.querySelector('.i').focus()
  await pas(() => f.fermer())
  R.flou = suivi(window.__commit, f, 'b1', 'sans blur')
  const c = await neuf('mjs-rafr-clic', 'b')
  await pas(() => c.tick())
  R.clic = !window.__clic ? 'sans clic' : window.__clic > 3 ? window.__clic + ' clics' : txt(c, 'v') === 'c' + window.__clic ? 'suivi' : 'périmé ' + txt(c, 'v')
  const lb = await neuf('mjs-rafr-biblio', 'i')
  lb._shadow.querySelector('.i').focus()
  await pas(() => lb.fermer())
  R.biblio = suivi(window.__lb, lb, 'l1', 'sans blur')
  const on = await neuf('mjs-rafr-on', 'b')
  await pas(() => on.tick())
  R.onClic = suivi(window.__oc, on, 'c1', 'sans clic')
  on._shadow.querySelector('.i').focus()
  await pas(() => on.fermer())
  R.onFlou = suivi(window.__of, on, 'f1', 'sans blur')
  const fs = await neuf('mjs-rafr-fs', 'v')
  await pas(() => fs.ouvrir())
  R.fsIn = suivi(window.__fi, fs, 'i1', 'sans focusin')
  await pas(() => fs.fermer())
  R.fsOut = suivi(window.__fo, fs, 'o1', 'sans blur')
  const nid = await neuf('mjs-rafr-nid', 'v')
  await pas(() => nid.ouvrir())
  R.nid = suivi(window.__nid, nid, 'n1', 'sans focus')
  const nb = await neuf('mjs-rafr-nidb', 'i')
  nb._shadow.querySelector('.i').focus()
  await pas(() => nb.fermer())
  R.nidb = suivi(window.__nidb, nb, 'b1', 'sans blur')
  const dx = await neuf('mjs-rafr-deux', 'v')
  await pas(() => dx.ouvrir())
  R.deux = txt(dx, 'v')
  const aw = await neuf('mjs-rafr-aw', 'v')
  await pas(() => aw.ouvrir())
  R.attente = suivi(window.__aw, aw, 'w1', 'sans focus')
  // un gabarit qui relance l'événement à chaque rendu : coupé de même
  const b = await neuf('mjs-rafr-boucle', 'b')
  b.go()
  const nb2 = await stable('__bc')
  R.boucle = nb2 > 100 && nb2 <= 10200 ? 'coupée' : nb2 + ' clics'
  const nom = (x) => x.includes('µrefresh(') ? 'µrefresh ' + (x.match(/<mjs-rafr-[a-z0-9]+>/) || ['?'])[0] + (x.includes('gestionnaire') ? '' : ' sans conseil') : x.includes('10 000') ? 'boucle' : x.includes('Cycle') ? 'cycle' : x.slice(0, 80)
  R.avertissements = window.__W.filter((x) => x.includes('µrefresh') || x.includes('10 000') || x.includes('Cycle')).map(nom)
  return R
})()`
const attendu = (prod: boolean): Record<string, unknown> => ({
  // mauvais usage : boucle coupée par le détecteur
  gabarit: 'coupée',
  // une valeur dérivée qui l'appelle : appliqué, une écriture faite par son calcul ne le périme pas, aucune boucle
  derivee: '1 calculs',
  // écouteurs déclenchés par le rendu : l'écran suit leur µrefresh
  flou: 'suivi',
  clic: 'suivi',
  biblio: 'suivi',
  onClic: 'suivi',
  onFlou: 'suivi',
  fsIn: 'suivi',
  fsOut: 'suivi',
  nid: 'suivi',
  nidb: 'suivi',
  deux: 'A1 | B1',
  attente: 'suivi',
  boucle: 'coupée',
  // en développement : le détecteur, puis µrefresh nommé avec le conseil, une fois par composant et par variable
  avertissements: prod ? [] : ['boucle', 'µrefresh <mjs-rafr-gabarit>', 'boucle', 'µrefresh <mjs-rafr-boucle>'],
})
// hors de Chromium, le retrait du champ qui a le focus n'émet ni blur ni focusout : rien à suivre
const sansBlur = (r: any, moteur: string): any => {
  if (moteur === 'chromium') return r
  const s = { ...r }
  for (const k of ['flou', 'biblio', 'onFlou', 'fsOut', 'nidb']) if (s[k] === 'sans blur') s[k] = 'suivi'
  return s
}
// les écouteurs que le cœur pose en capture sur la fenêtre, relevés avant son chargement
const ECOUTES = `window.__ecoutes = [];
(function () {
  var a = window.addEventListener;
  window.addEventListener = function (t, f, o) { if (o === true || (o && o.capture)) window.__ecoutes.push(t); return a.apply(this, arguments); };
})();`

async function construire(prod: boolean, precise: boolean, sources = SOURCES): Promise<{ code: string, erreurs: string[] }> {
  const root   = mjsTmp('rafraichir-garde-rendu')
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

describe('`µrefresh($x)` pendant un rendu ou un calcul : appliqué juste après, mauvais usage coupé par le détecteur de boucle ; formes refusées à la construction', function () {
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
        it('happy-dom : écouteurs déclenchés par le rendu appliqués juste après, mauvais usage coupé', async () => {
          const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
          window.eval(RELEVE)
          window.eval(code)
          assert.deepEqual(sansBlur(JSON.parse(JSON.stringify(await window.eval(SCENARIO))), 'happy-dom'), attendu(prod))
          await window.happyDOM.close()
        })
        // aucun écouteur de focus du cœur sur la fenêtre, avec ou sans la rune
        if (!prod) it('happy-dom : aucun écouteur de focus posé par le cœur sur la fenêtre, avec ou sans µrefresh', async () => {
          const sans = await construire(false, precise, { 'rafr-sans.mjs': '<script>\n$n = 1\n</script>\n<p>{$n}</p>\n' })
          assert.deepEqual(sans.erreurs, [])
          const ecoutes = async (c: string): Promise<string[]> => {
            const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
            window.eval(ECOUTES)
            window.eval(c)
            const r = window.__ecoutes.filter((t: string) => ['blur', 'focus', 'focusin', 'focusout'].includes(t)).sort()
            await window.happyDOM.close()
            return [...r]
          }
          assert.deepEqual({ avec: await ecoutes(code), sans: await ecoutes(sans.code) }, { avec: [], sans: [] })
        })
        if (!prod) return
        for (const moteur of ['chromium', 'firefox', 'webkit']) {
          it(`${moteur} : écouteurs déclenchés par le rendu appliqués juste après, mauvais usage coupé`, async function () {
            const playwright: any = await import('playwright')
            if (!existsSync(playwright[moteur].executablePath())) return this.skip()
            const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
            try {
              const page = await browser.newPage()
              const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${RELEVE}</script><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
              await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
              await page.goto('http://mjs.test/')
              assert.deepEqual(sansBlur(await page.evaluate(SCENARIO), moteur), attendu(prod))
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
  const SCRIPT = '<script>\n$x = { n: 1 }\n$y = 1\n'
  const fautes: Record<string, [string, string[]]> = {
    attache: [SCRIPT + '</script>\n<p :attach={(n) -> µrefresh($x)}>{$x.n}</p>\n', ['µrefresh', '@click', ':attach']],
    condition: [SCRIPT + '</script>\n{if µrefresh($x) or $y}<p>{$x.n}</p>{end}\n', ['µrefresh', '@click', '{if}']],
    nueOu: [SCRIPT + '@f = -> µrefresh $x or $y\n</script>\n<p>{$x.n}</p>\n', ['µrefresh($x)', 'parenthèses']],
    nueEt: [SCRIPT + '@f = -> µrefresh $x and $y\n</script>\n<p>{$x.n}</p>\n', ['µrefresh($x)', 'parenthèses']],
    nuePlus: [SCRIPT + '@f = -> µrefresh $x + $y\n</script>\n<p>{$x.n}</p>\n', ['µrefresh($x)', 'parenthèses']],
    nueTernaire: [SCRIPT + '@f = -> µrefresh $x ? 1 : 2\n</script>\n<p>{$x.n}</p>\n', ['µrefresh($x)', 'parenthèses']],
    nueSuffixe: [SCRIPT + '@f = -> µrefresh $x if $y\n</script>\n<p>{$x.n}</p>\n', ['µrefresh($x)', 'parenthèses']],
    nueGestionnaire: [SCRIPT + '</script>\n<button @click={µrefresh $x or $y}>{$x.n}</button>\n', ['µrefresh($x)', 'parenthèses']],
  }
  // la forme sans parenthèses, seule sur son instruction
  const admis: Record<string, string> = {
    seuleScript: SCRIPT + '@f = -> µrefresh $x\n@h = -> $y\n</script>\n<p>{$x.n}</p>\n',
    seuleCommentaire: SCRIPT + '@f = -> µrefresh $x # juste après le changement\n</script>\n<p>{$x.n}</p>\n',
    seuleBloc: SCRIPT + '@f = ->\n  o = 1\n  µrefresh $x\n  o\n</script>\n<p>{$x.n}</p>\n',
    seuleGestionnaire: SCRIPT + '</script>\n<button @click={µrefresh $x}>{$x.n}</button>\n',
    // `@in:fade={…}` écoute l'événement nommé « in:fade » (une transition s'écrit `:in=*fade(…)`) : un gestionnaire
    evenementIn: SCRIPT + '</script>\n<p @in:fade={µrefresh($x)}>{$x.n}</p>\n',
    evenementOut: SCRIPT + '</script>\n<p @out:fade={-> µrefresh($x)}>{$x.n}</p>\n',
    evenementTransition: SCRIPT + '</script>\n<p @transition:fade={µrefresh($x)}>{$x.n}</p>\n',
  }
  for (const precise of [false, true]) {
    describe('construction (' + (precise ? 'précision' : 'horloge') + ')', function () {
      for (const [nom, [src, morceaux]] of Object.entries(fautes)) {
        it('refusé : ' + nom, async () => {
          const b = await construire(false, precise, { 'rafr-faute.mjs': src })
          assert.ok(b.erreurs.some((e) => morceaux.every((m) => e.includes(m))), (b.erreurs.join('\n') || 'aucune erreur') + '\nattendu : ' + morceaux.join(', '))
        })
      }
      for (const [nom, src] of Object.entries(admis)) {
        it('admis : ' + nom, async () => {
          const b = await construire(false, precise, { 'rafr-admis.mjs': src })
          assert.deepEqual(b.erreurs, [])
        })
      }
    })
  }
})
