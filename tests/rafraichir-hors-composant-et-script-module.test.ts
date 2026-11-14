// `µrefresh` hors d'un composant, et `$$x = $$x` refusé dans le `<script module>`. Le `<script module>` et un module importé (le fichier d'un
// magasin compris) n'appartiennent à aucun composant : `µrefresh($x)` et `µrefresh(µ$$x)` y sont refusés à la construction, à leur
// ligne, par un message propre à ce lieu (français et anglais) — construits, ils levaient `_mjsThis is not defined` à l'appel ;
// `µrefresh($$x)` y reste accepté. Le message dit quoi écrire pour l'état de module, vérifié ici : une nouvelle valeur dans la clé
// touchée (`µ$$x.lignes = [...µ$$x.lignes]` dans le `<script module>`, `µ$x.lignes = [...µ$x.lignes]` dans le fichier du magasin, où
// l'objet ne se remplace pas). `µrefresh($$x)` écrit dans le `<script module>` fait ce qu'il fait dans le script, un
// gestionnaire ou le fichier d'un magasin : ce qui lit la clé se redessine, ses valeurs dérivées se refont, aucun reffet ne repart ;
// `$$x = $$x` y est refusé à sa place.
// L'avertissement de développement d'une valeur dérivée précise dit `µrefresh($$x)` pour une clé du magasin, comme `µrefresh($x)` pour
// une variable. Développement et production ; happy-dom, Chromium

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { setMessagesLang, getMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  // l'objet du magasin changé hors de MJS (`µ._mjs_toRaw`, comme une bibliothèque qui garde l'objet brut), puis signalé par une
  // nouvelle valeur écrite dans la clé touchée, depuis ce fichier
  'rh-mag.module.civet.mjs': `export µ$$rhp = { lignes: [1] }

window.__rhDehors  = -> µ._mjs_toRaw(µ$rhp).lignes.push(9)
window.__rhFichier = -> µ$rhp.lignes = [...µ$rhp.lignes]
`,
  // la clé changée hors de MJS par `µread`, puis signalée par le `<script module>` ; l'état de module signalé de même
  'rh-sm.mjs': `<script module>
window.__rhReecrit = ->
  µrefresh($$rhk)
  null
window.__rhRune = ->
  µrefresh($$rhk)
  null
window.__rhModule = ->
  µ$$rhp.lignes = [...µ$$rhp.lignes]
  null
</script>
<script>
@import µ$$rhp 'rh-mag.module.civet.mjs'
$$rhk = {n: 1}
$d = $$rhk.n * 2
µeffect ->
  window.__rhE = (window.__rhE or 0) + 1
  window.__rhV = $$rhk.n
@brut = -> µread($$rhk).n += 1
</script>
<p class="s">{$$rhk.n + '/' + $d + '/' + µ$$rhp.lignes.length}</p>
`,
  // une valeur dérivée précise qui lit une variable dont l'objet est changé hors de MJS : l'avertissement de développement dit
  // quoi écrire, pour chacune de ses sources
  'rh-av.mjs': `<script>
$rows = [1, 2]
$t = 0
$somme = $rows.map((v) -> v * 2).join(',')
@choisir = (o) -> $rows = o
@inct = -> $t += 1
</script>
<p class="s">{$somme + '|' + $t}</p>
`,
}

// avertissements du cœur, relevés avant son chargement
const RELEVE = `window.__W = [];
(function () {
  var w = console.warn;
  console.warn = function () { window.__W.push(Array.prototype.map.call(arguments, String).join(' ')); return w.apply(console, arguments); };
})();`

const SCENARIO = `(async () => {
  const pause    = (ms) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { for (let i = 0; i < 300 && !f(); i++) await pause(10) }
  const racine   = (el) => el._shadow || el.shadowRoot || el
  const txt      = (el) => { const n = el && racine(el).querySelector('.s'); return n ? n.textContent : '?' }
  const neuf     = async (tag) => { const el = document.createElement(tag); document.body.appendChild(el); await attendre(() => txt(el) !== '?'); return el }
  const r   = {}
  const m   = await neuf('mjs-rh-sm')
  await pause(50)
  const e0  = window.__rhE
  const s   = ['départ ' + txt(m)]
  const pas = async (nom, f) => { f(); await pause(30); s.push(nom + ' ' + txt(m)) }
  await pas('brut', () => m.brut())
  await pas('réécrit', () => window.__rhReecrit())
  await pas('brut', () => m.brut())
  await pas('rune', () => window.__rhRune())
  s.push('reffets ' + (window.__rhE - e0) + ' lu ' + window.__rhV)
  await pas('dehors', () => window.__rhDehors())
  await pas('module', () => window.__rhModule())
  await pas('dehors', () => window.__rhDehors())
  await pas('fichier', () => window.__rhFichier())
  r.scriptModule = s.join(' → ')
  const a = await neuf('mjs-rh-av')
  await pause(50)
  // aucune valeur précise ne lit aujourd'hui une clé du magasin (le compilateur la laisse à l'horloge) : la source $$rhn est
  // posée à la main, pour lire le remède que l'avertissement en donne
  const v = a._mjs_computeds && a._mjs_computeds.somme
  if (v && v._mjs_src) v._mjs_src.push('$rhn')
  window.__rhRows = [1, 2]
  a.choisir(window.__rhRows); await pause(30)
  window.__rhRows.push(3)
  a.inct(); await pause(30)
  r.avertissement = window.__W.filter((w) => w.includes('µrefresh') || w.includes('$$rhn = $$rhn'))
  return r
})()`

function attendu(prod: boolean) {
  return {
    // `µrefresh($$rhk)`, appelé par deux fonctions, redessine la clé et refait la valeur dérivée, sans relancer le reffet ; l'état de
    // module changé hors de MJS suit la nouvelle valeur écrite dans sa clé, depuis le `<script module>` comme depuis son fichier
    scriptModule: 'départ 1/2/1 → brut 1/2/1 → réécrit 2/4/1 → brut 2/4/1 → rune 3/6/1 → reffets 0 lu 1 → dehors 3/6/1 → module 3/6/2 → dehors 3/6/2 → fichier 3/6/3',
    avertissement: prod ? [] : ['[ModularJS] La valeur dérivée « $somme » du composant <mjs-rh-av> a servi son dernier calcul alors que son recalcul donne autre chose : une donnée qu\'elle lit a sans doute été changée hors de MJS (bibliothèque, script extérieur, objet gardé dans une variable sans `$`). Juste après ce changement, écrivez `µrefresh($rows)`, `µrefresh($$rhn)`. Cet avertissement n\'existe qu\'en développement : la valeur servie reste celle de la production.'],
  }
}

async function construire(sources: Record<string, string>, prod = false): Promise<{ code: string, erreurs: string[], unites: Record<string, string> }> {
  const root   = mjsTmp('rafraichir-hors-composant')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(sources)) writeFileSync(join(srcDir, nom), src)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), derivedMode: 'precise' }
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  const erreurs = stats.errors.map((e: any) => String(e.message))
  if (erreurs.length > 0) return { code: '', erreurs, unites: {} }
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre  = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  // chaque unité sous son nom sans empreinte (`rh-id-79349.js` → `rh-id.js`), sans la ligne de sa carte des sources
  const unites = Object.fromEntries(files.filter((f) => !f.startsWith('mjs_')).map((f) => [f.replace(/-[a-z0-9]+\.js$/, '.js'), readFileSync(join(outDir, f), 'utf-8').replace(/\n\/\/# sourceMappingURL=.*$/gm, '')]))
  const code   = prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  return { code, erreurs, unites }
}

// le composant de la comparaison : la clé signalée par `forme` dans une fonction de son `<script module>`
function unite(lang: string, forme: string): string {
  const corps = lang === 'js' ? `window.__f = function() {\n  ${forme};\n  return null\n};` : `window.__f = ->\n  ${forme}\n  null`
  return `<script module${lang === 'civet' ? '' : ` lang="${lang}"`}>\n${corps}\n</script>\n<script>\n$$rhid = {n: 1}\n</script>\n<p>{$$rhid.n}</p>\n`
}

describe('`µrefresh` hors d\'un composant, et `$$x = $$x` refusé dans le `<script module>`', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('dans le `<script module>`, `µrefresh($$x)` donne son code et `$$x = $$x` est refusé à sa place, dans chaque langue', function () {
    for (const lang of ['civet', 'coffee', 'js']) {
      it(lang, async () => {
        const rune     = await construire({ 'rh-id.mjs': unite(lang, 'µrefresh($$rhid)') })
        const reecrite = await construire({ 'rh-id.mjs': unite(lang, '$$rhid = $$rhid') })
        assert.deepEqual(rune.erreurs, [])
        assert.ok((rune.unites['rh-id.js'] ?? '').includes('µ._mjs_storeRefresh("rhid")'), Object.keys(rune.unites).join(', '))
        assert.equal(reecrite.erreurs.length, 1, reecrite.erreurs.join('\n') || 'aucune erreur')
        assert.match(reecrite.erreurs[0], /rh-id\.mjs:3:3 \[ModularJS\] « \$\$rhid = \$\$rhid » est refusé/)
      })
    }
  })

  for (const prod of [false, true]) {
    describe(prod ? 'production' : 'développement', function () {
      let code: string
      before(async () => {
        const b = await construire(SOURCES, prod)
        assert.deepEqual(b.erreurs, [])
        code = b.code
      })

      it('happy-dom : `<script module>`, état de module et avertissement justes', async () => {
        const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
        window.eval(RELEVE)
        window.eval(code)
        const r = await window.eval(SCENARIO)
        assert.deepEqual(JSON.parse(JSON.stringify(r)), attendu(prod))
        await window.happyDOM.close()
      })

      it('chromium : `<script module>`, état de module et avertissement justes', async function () {
        const playwright: any = await import('playwright')
        if (!existsSync(playwright.chromium.executablePath())) return this.skip()
        const browser = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
        try {
          const page = await browser.newPage()
          const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${RELEVE}</script><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
          await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
          await page.goto('http://mjs.test/')
          assert.deepEqual(await page.evaluate(SCENARIO), attendu(prod))
        }
        finally {
          await browser.close()
        }
      })
    })
  }

  describe('refusés hors d\'un composant, à leur ligne, par le message de ce lieu', function () {
    const MAGASIN = 'export µ$$rhq = { v: 0 }\n'
    const fichier = (lang: string, ligne: string): Record<string, string> => ({ [`rh-f.module.${lang}.mjs`]: `${MAGASIN}\n${ligne}\n` })
    const module  = (ligne: string, lang = 'civet'): Record<string, string> => ({ 'rh-f.mjs': `<script>\n@import µ$$rhq 'rh-q.module.civet.mjs'\n$x = 1\n</script>\n<script module${lang === 'civet' ? '' : ` lang="${lang}"`}>\n\n${ligne}\n</script>\n<p>{$x} {µ$$rhq.v}</p>\n`, 'rh-q.module.civet.mjs': MAGASIN })
    // [sources, place citée, fragments du message en français, en anglais]
    const FICHIER = [['module importé', 'µ$x.lignes = [...µ$x.lignes]'], ['imported module', 'µ$x.items = [...µ$x.items]']]
    const SCRIPT  = [['<script module>', 'µ$$x.lignes = [...µ$$x.lignes]'], ['<script module>', 'µ$$x.items = [...µ$$x.items]']]
    const fautes: Record<string, [Record<string, string>, RegExp, string[][]]> = {
      fichierEtatDeModule: [fichier('civet', 'window.f = -> µrefresh(µ$$rhq)'), /rh-f\.module\.civet\.mjs:3:/, FICHIER],
      fichierObjetDuMagasin: [fichier('civet', 'window.f = -> µrefresh(µ$rhq)'), /rh-f\.module\.civet\.mjs:3:/, FICHIER],
      fichierVariable: [fichier('civet', 'window.f = -> µrefresh($x)'), /rh-f\.module\.civet\.mjs:3:/, FICHIER],
      fichierCoffee: [fichier('coffee', 'window.f = -> µrefresh(µ$$rhq)'), /rh-f\.module\.coffee\.mjs:3:/, FICHIER],
      scriptModuleVariable: [module('window.f = -> µrefresh($x)'), /rh-f\.mjs:7:15 /, SCRIPT],
      scriptModuleEtatDeModule: [module('window.f = -> µrefresh(µ$$rhq)'), /rh-f\.mjs:7:15 /, SCRIPT],
      scriptModuleJs: [module('window.f = function() { µrefresh($x) };', 'js'), /rh-f\.mjs:7:25 /, SCRIPT],
    }
    for (const [nom, [sources, place, [fr, en]]] of Object.entries(fautes)) {
      it(nom, async () => {
        const avant = getMessagesLang()
        try {
          for (const [langue, fragments] of [['fr', fr], ['en', en]] as const) {
            setMessagesLang(langue)
            const b = await construire(sources)
            assert.equal(b.erreurs.length, 1, b.erreurs.join('\n') || 'aucune erreur')
            assert.match(b.erreurs[0], place)
            for (const f of fragments) assert.ok(b.erreurs[0].includes(f), `${langue} : ${f}\n${b.erreurs[0]}`)
          }
        }
        finally {
          setMessagesLang(avant)
        }
      })
    }

    it('`µrefresh($$x)` y reste accepté', async () => {
      for (const sources of [fichier('civet', 'window.f = -> µrefresh($$rhk)'), module('window.g = -> µrefresh($$rhk)')]) assert.deepEqual((await construire(sources)).erreurs, [])
    })
  })

  it('l\'aide-mémoire dit que `µrefresh` accepte une clé du magasin', () => {
    const ligne = readFileSync(join(import.meta.dirname, '../docs/22-aide-memoire.md'), 'utf-8').split('\n').find((l) => l.startsWith('| `µrefresh($x)`')) ?? ''
    assert.ok(ligne.includes('`µrefresh($$x)`') && !ligne.includes('ni magasin'), ligne.slice(0, 200))
  })
})
