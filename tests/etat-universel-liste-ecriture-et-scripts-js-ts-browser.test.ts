// `µ$x` à l'écran, dans les trois moteurs, en développement et en production : une liste (`µ$l = [1, 2]`) reste une liste suivie,
// partagée par deux composants (`push` levait « push is not a function » : la liste était copiée dans un objet) ; `µ$x = 10` seul
// sur sa ligne dans une méthode, une flèche ou un rappel, ou dans une fonction exportée par un module, est une écriture, en Civet,
// CoffeeScript, JavaScript et TypeScript (elle était lue comme une déclaration, sans effet quand la valeur est là), la déclaration du
// niveau du script gardant la valeur déjà là, sous un `if`, un `try`, script tout en retrait, tabulation ou suite de ligne moins en retrait ;
// `export µ$x = …;` d'un `<script module lang="js">` ou `lang="ts"` se construit, sur une ligne ou sur plusieurs (`?=` et `export $x =`
// n'étaient pas du JavaScript), et le `<script>` du composant lit ce magasin (il lisait l'état de la page : `µ$x.a` levait) ; une méthode
// `@plus = function() { … }` d'un `<script lang="ts">` se construit, avec ou sans `µ$x` (esbuild lisait le script comme un module
// CommonJS et posait un `export default` au milieu du composant)

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

type Groupe = { nom: string, tag: string, sources: Record<string, string>, code: string, attendu: unknown }
const GROUPES: Groupe[] = [
  {
    nom: 'une liste reste une liste : push, length, {for}, dans deux composants qui la partagent',
    tag: 'mjs-c-liste',
    sources: {
      'c-liste.mjs':  '<script>\nµ$zl = [1, 2]\n$l = µ$zl\nµeffect -> $n = µ$zl.length\n@plus = -> µ$zl.push(3)\n</script>\n<p class="t">{$n}:{for v in $l}{v},{end}</p>\n<button class="plus" @click={@plus()}>+</button>\n',
      'c-liste2.mjs': '<script>\nµ$zl = [7]\n$l = µ$zl\nµeffect -> $n = µ$zl.length\n</script>\n<p class="t">{$n}:{for v in $l}{v},{end}</p>\n'
    },
    attendu: ['2:1,2, 2:1,2,', '3:1,2,3, 3:1,2,3,'],
    code: `
      const a = __pose('mjs-c-liste2'); await __pause(400);
      const vus = [], lire = () => vus.push(__ecran(p) + ' ' + __ecran(a));
      lire();
      __clic(p, 'plus'); await __pause(); lire();
      return vus`
  },
  {
    nom: 'µ$x = 10 seul sur sa ligne dans une méthode, une flèche ou un rappel : une écriture (Civet, CoffeeScript, JavaScript)',
    tag: 'mjs-c-ecrit',
    sources: {
      'c-ecrit.mjs':        '<script>\n@import razm \'etat-ecrit.civet.mjs\'\nµ$zw = 0\nµeffect -> $n = µ$zw\n@raz = ->\n  µ$zw = 10\n@rappel = ->\n  [1].forEach (v) ->\n    µ$zw = 20 + v\n@razm = -> razm()\n</script>\n<p class="t">{$n}</p>\n<button class="raz" @click={@raz()}>0</button>\n<button class="rappel" @click={@rappel()}>1</button>\n<button class="razm" @click={@razm()}>m</button>\n',
      'etat-ecrit.civet.mjs': 'µ$zw = 0\nexport razm = ->\n  µ$zw = 30\n',
      'c-ecrit2.mjs':       '<script>\nµ$zw = 5\nµeffect -> $n = µ$zw\n</script>\n<p class="t">{$n}</p>\n',
      'c-ecrit-coffee.mjs': '<script lang="coffee">\nµ$zc = 0\nµeffect -> $n = µ$zc\n@raz = ->\n  µ$zc = 10\n</script>\n<p class="t">{$n}</p>\n<button class="raz" @click={@raz()}>0</button>\n',
      'c-ecrit-js.mjs':     '<script lang="js">\nµ$zj = 0;\nµeffect(() => { $n = µ$zj; });\n@raz = function() {\n  µ$zj = 10;\n};\n@fleche = () => {\n  [1].forEach((v) => {\n    µ$zj = 20 + v;\n  });\n};\n</script>\n<p class="t">{$n}</p>\n<button class="raz" @click={@raz()}>0</button>\n<button class="fleche" @click={@fleche()}>1</button>\n'
    },
    attendu: ['0 0 0 0', '10 10 0 0', '21 21 0 0', '21 21 10 0', '21 21 10 10', '21 21 10 21', '30 30 10 21'],
    code: `
      const a = __pose('mjs-c-ecrit2'), c = __pose('mjs-c-ecrit-coffee'), j = __pose('mjs-c-ecrit-js'); await __pause(400);
      const vus = [], lire = () => vus.push([p, a, c, j].map(__ecran).join(' '));
      lire();
      for (const [e, b] of [[p, 'raz'], [p, 'rappel'], [c, 'raz'], [j, 'raz'], [j, 'fleche'], [p, 'razm']]) { __clic(e, b); await __pause(); lire() }
      return vus`
  },
  {
    nom: 'export µ$x = …; dans un <script module lang="js"> ou "ts" se construit, sur une ligne ou sur plusieurs, lu par le module et par le <script>',
    tag: 'mjs-c-module-js',
    sources: {
      'c-module-js.mjs':    '<script module lang="js">\nexport µ$zmj = { a: 7 };\nexport const a7 = µ$zmj.a;\n</script>\n<script lang="js">\n$n = a7 + µ$zmj.a;\n</script>\n<p class="t">{$n}</p>\n',
      'c-module-civet.mjs': '<script module>\nexport µ$zmc = { a: 8 }\nexport a8 := µ$zmc.a\n</script>\n<script>\n$n = a8 + µ$zmc.a\n</script>\n<p class="t">{$n}</p>\n',
      'c-module-js-m.mjs':  '<script module lang="js">\nexport µ$zmm = {\n  a: 9, // champ\n  b: [1,\n    2]\n}; // départ\nexport const a9 = µ$zmm.a;\n</script>\n<script lang="js">\n$n = a9 + µ$zmm.b.length;\n</script>\n<p class="t">{$n}</p>\n',
      'c-module-ts-m.mjs':  '<script module lang="ts">\nexport µ$zmt = {\n  a: 4,\n  b: [1, 2]\n};\nexport const a4: number = µ$zmt.a;\n</script>\n<script lang="ts">\n$n = a4 + µ$zmt.b.length;\n</script>\n<p class="t">{$n}</p>\n'
    },
    attendu: ['14 16 11 6'],
    code: `
      const a = __pose('mjs-c-module-civet'), m = __pose('mjs-c-module-js-m'), t = __pose('mjs-c-module-ts-m'); await __pause(400);
      return [[p, a, m, t].map(__ecran).join(' ')]`
  },
  {
    nom: 'le niveau du script déclare, quelle que soit sa forme : try/catch Civet, if JavaScript, script en retrait, tabulation, suite de ligne',
    tag: 'mjs-c-r',
    sources: {
      'c-r.mjs':  '<script>\ntry\n  µ$zr = JSON.parse(localStorage.getItem("zr") ?? "0")\ncatch e\n  µ$zr = 0\nµeffect -> $n = µ$zr\n@plus = -> µ$zr++\n</script>\n<p class="t">{$n}</p>\n<button class="plus" @click={@plus()}>+</button>\n',
      'c-j1.mjs': '<script lang="js">\nµ$zj1 = 1;\nµeffect(() => { $n = µ$zj1; });\n@plus = function() { µ$zj1++; };\n</script>\n<p class="t">{$n}</p>\n<button class="plus" @click={@plus()}>+</button>\n',
      'c-j2.mjs': '<script lang="js">\nif (typeof window !== "undefined") {\n  µ$zj1 = 1;\n}\nµeffect(() => { $n = µ$zj1; });\n</script>\n<p class="t">{$n}</p>\n',
      'c-t.mjs':  '<script lang="js">\n    µ$zt1 = { n: 1 };\n    $o = µ$zt1;\n    @plus = function() {\n\t  µ$zt1.n++;\n    };\n</script>\n<p class="t">{$o.n}</p>\n<button class="plus" @click={@plus()}>+</button>\n',
      'c-s.mjs':  '<script lang="js">\n    µ$zs = { n: 1 };\n    $o = µ$zs;\n    const t = "a" +\n"b";\n    @plus = function() { µ$zs.n++; };\n</script>\n<p class="t">{$o.n}</p>\n<button class="plus" @click={@plus()}>+</button>\n'
    },
    attendu: ['2 2', '2 2', '2 2', '2 2', '3 3'],
    code: `
      const vus = [], deux = async (tag, a) => { __clic(a, 'plus'); await __pause(); const b = __pose(tag); await __pause(400); vus.push(__ecran(a) + ' ' + __ecran(b)); return b };
      __clic(p, 'plus'); await deux('mjs-c-r', p);
      const j1 = __pose('mjs-c-j1'); await __pause(400); __clic(j1, 'plus'); await __pause(); const j2 = __pose('mjs-c-j2'); await __pause(400); vus.push(__ecran(j1) + ' ' + __ecran(j2));
      const t1 = __pose('mjs-c-t'); await __pause(400); await deux('mjs-c-t', t1);
      const s1 = __pose('mjs-c-s'); await __pause(400); const s2 = await deux('mjs-c-s', s1);
      __clic(s1, 'plus'); await __pause(); vus.push(__ecran(s1) + ' ' + __ecran(s2));
      return vus`
  },
  {
    nom: 'TypeScript : une méthode @plus = function() { … } se construit, avec ou sans µ$x ; µ$x = 10 dans une méthode écrit',
    tag: 'mjs-c-ts',
    sources: {
      'c-ts.mjs':    '<script lang="ts">\nµ$zt = 0;\nµeffect(() => { $n = µ$zt; });\n@plus = function(): void { µ$zt++; };\n@ajoute = function(): void { µ$zt += 2; };\n@raz = function(): void {\n  µ$zt = 10;\n};\n</script>\n<p class="t">{$n}</p>\n<button class="plus" @click={@plus()}>+</button>\n<button class="ajoute" @click={@ajoute()}>+</button>\n<button class="raz" @click={@raz()}>0</button>\n',
      'c-ts-nu.mjs': '<script lang="ts">\n$n = 0;\n@plus = function(): void { $n++; };\n</script>\n<p class="t">{$n}</p>\n<button class="plus" @click={@plus()}>+</button>\n'
    },
    attendu: ['0 0', '1 0', '3 0', '10 0', '10 1'],
    code: `
      const a = __pose('mjs-c-ts-nu'); await __pause(400);
      const vus = [], lire = () => vus.push(__ecran(p) + ' ' + __ecran(a));
      lire();
      for (const [e, b] of [[p, 'plus'], [p, 'ajoute'], [p, 'raz'], [a, 'plus']]) { __clic(e, b); await __pause(); lire() }
      return vus`
  }
]

// outils de la page, posés avant le cœur
const OUTILS = `window.__pause = (ms = 200) => new Promise((f) => setTimeout(f, ms));
window.__ecran = (e) => { const t = e && e._shadow && e._shadow.querySelector('.t'); return t ? t.textContent : null };
window.__clic  = (e, c) => e._shadow.querySelector('.' + c).click();
window.__pose  = (tag) => document.body.appendChild(document.createElement(tag));`

const BATIS = [
  { nom: 'développement', prod: false },
  { nom: 'production',    prod: true }
]

async function construire(prod: boolean, sources: Record<string, string>): Promise<Map<string, Buffer>> {
  const root = mjsTmp('universel-liste-ecriture')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  for (const [nom, code] of Object.entries(sources)) writeFileSync(join(src, nom), code)
  const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', js: prod ? 'bundle' : 'split', env: prod ? 'prod' : 'dev' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const fichiers = new Map<string, Buffer>()
  for (const n of readdirSync(out)) if (/\.(js|json)$/.test(n)) fichiers.set(n, readFileSync(join(out, n)))
  return fichiers
}

describe('état universel : une liste, une écriture dans une fonction, les scripts JavaScript et TypeScript (trois moteurs)', function () {
  this.timeout(280000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const b of BATIS) for (const g of GROUPES) {
    it(`${b.nom} · ${g.nom}`, async function () {
      const playwright: any = await import('playwright')
      const fichiers         = await construire(b.prod, g.sources)
      const ecarts: string[] = []
      let joues              = 0
      for (const moteur of ['chromium', 'firefox', 'webkit']) {
        if (!existsSync(playwright[moteur].executablePath())) continue
        const navigateur = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        joues++
        const page = await navigateur.newPage()
        const erreurs: string[] = []
        let vu: unknown
        page.on('pageerror', (e: any) => erreurs.push(String(e && e.message || e).slice(0, 200)))
        try {
          await page.addInitScript(OUTILS)
          await page.route('http://universel-liste.test/**', async (route: any) => {
            const chemin = new URL(route.request().url()).pathname
            if (!chemin.startsWith('/out/')) return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><body><${g.tag} id="premier"></${g.tag}><script type="module" src="/out/bundle.js"></script></body>` })
            const corps = fichiers.get(chemin.slice(5))
            return route.fulfill(corps ? { status: 200, contentType: chemin.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps } : { status: 404, body: '' })
          })
          await page.goto('http://universel-liste.test/page')
          await page.waitForFunction('(() => { const e = document.getElementById("premier"); return !!e && !!e._shadow })()', null, { timeout: 30000 })
          await page.waitForTimeout(300)
          vu = await page.evaluate(`(async () => { const p = document.getElementById('premier'); ${g.code} })()`)
        }
        catch (e: any) {
          vu = 'scène en échec : ' + String(e && e.message || e).slice(0, 300)
        }
        finally {
          await page.close()
          await navigateur.close()
        }
        if (JSON.stringify(vu) !== JSON.stringify(g.attendu)) ecarts.push(`${moteur} : ${JSON.stringify(vu)}, attendu ${JSON.stringify(g.attendu)}`)
        if (erreurs.length) ecarts.push(`${moteur} : erreur dans la page — ${erreurs[0]}`)
      }
      if (!joues) return this.skip()
      assert.deepEqual(ecarts, [])
    })
  }
})
