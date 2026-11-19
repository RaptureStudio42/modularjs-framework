// `µ$panier` est un seul objet pour toute la page : l'en-tête qui le tient (`$p = µ$panier`, puis `{$p.n}`) suit ce qu'y écrit la fiche
// — `µ$panier.n++` dans un gestionnaire, `$q.n++` par sa variable, un champ profond (`µ$panier.lignes.push(x)`), une fonction exportée par
// le fichier d'un module —, le reffet d'un troisième composant (`µeffect -> $n = µ$panier.n`) se rejoue, et un en-tête monté après les
// écritures montre la valeur courante ; en développement et en production, avec l'enveloppe et sous `proxy: false`, dans les trois
// moteurs. Le compte des opérations d'une écriture que nul autre composant ne suit est relevé (MJS_UNIVERSEL_COMPTE=1), sans seuil

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const PANIER = 'µ$panier = { n: 0, lignes: [] }\n'
const SOURCES: Record<string, string> = {
  'c-entete.mjs':             `<script>\n${PANIER}$p = µ$panier\n</script>\n<p class="t">{$p.n} {$p.lignes.length}</p>\n`,
  'c-fiche.mjs':              `@import ajouter 'panier.module.civet.mjs'\n\n<script>\n${PANIER}$q = µ$panier\n@plus = -> µ$panier.n++\n@plusParVariable = -> $q.n++\n@ligne = -> µ$panier.lignes.push('x')\n@parModule = -> ajouter()\n</script>\n<p class="t">{$q.n}</p>\n<button class="plus" @click={@plus()}>+</button>\n<button class="variable" @click={@plusParVariable()}>+</button>\n<button class="ligne" @click={@ligne()}>+</button>\n<button class="module" @click={@parModule()}>+</button>\n`,
  'c-reffet.mjs':             `<script>\n${PANIER}µeffect -> $n = µ$panier.n\n</script>\n<p class="t">{$n}</p>\n`,
  'c-seul.mjs':               `<script>\nµ$compte = { n: 0 }\n$c = µ$compte\n@plus = -> µ$compte.n++\n</script>\n<p class="t">{$c.n}</p>\n<button class="plus" @click={@plus()}>+</button>\n`,
  'panier.module.civet.mjs':  `${PANIER}export ajouter = -> µ$panier.n++\n`
}

// outils de la page, posés avant le cœur ; `__ops` compte les appels aux tables du navigateur (Map, Set, WeakMap, WeakSet)
const OUTILS = `window.__ops = 0;
for (const T of [Map, Set, WeakMap, WeakSet]) for (const m of ['get', 'set', 'has', 'add', 'delete']) { const f = T.prototype[m]; if (f) T.prototype[m] = function (...a) { window.__ops++; return f.apply(this, a) } }
window.__pause = (ms = 200) => new Promise((f) => setTimeout(f, ms));
window.__ecran = (e) => { const t = e && e._shadow && e._shadow.querySelector('.t'); return t ? t.textContent : null };
window.__clic  = (e, c) => e._shadow.querySelector('.' + c).click();
window.__pose  = (tag) => document.body.appendChild(document.createElement(tag));`

type Scene = { nom: string, tag: string, code: string, attendu: unknown }
const SCENES: Scene[] = [
  { nom: 'l\'en-tête, la fiche et le reffet suivent chaque écriture ; un en-tête monté après montre la valeur courante', tag: 'mjs-c-entete', attendu: ['0 0 / 0 / 0', '1 0 / 1 / 1', '2 0 / 2 / 2', '2 1 / 2 / 2', '3 1 / 3 / 3', '3 1'], code: `
    const f = __pose('mjs-c-fiche'), r = __pose('mjs-c-reffet'); await __pause(400);
    const vus = [], lire = () => vus.push([__ecran(p), __ecran(f), __ecran(r)].join(' / '));
    lire();
    for (const c of ['plus', 'variable', 'ligne', 'module']) { __clic(f, c); await __pause(); lire() }
    const tard = __pose('mjs-c-entete'); await __pause(400); vus.push(__ecran(tard));
    return vus` },
  { nom: 'une écriture que nul autre composant ne suit', tag: 'mjs-c-seul', attendu: '1', code: `
    await __pause(); const avant = __ops; __clic(p, 'plus'); await __pause(); window.__compte = __ops - avant;
    return __ecran(p)` }
]

type Bati = { nom: string, prod: boolean, proxy: boolean }
const BATIS: Bati[] = [
  { nom: 'développement, enveloppe',    prod: false, proxy: true },
  { nom: 'développement, proxy: false', prod: false, proxy: false },
  { nom: 'production, enveloppe',       prod: true,  proxy: true },
  { nom: 'production, proxy: false',    prod: true,  proxy: false }
]

async function construire(b: Bati): Promise<Map<string, Buffer>> {
  const root = mjsTmp('universel')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  for (const [nom, code] of Object.entries(SOURCES)) writeFileSync(join(src, nom), code)
  const options: any = { sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', js: b.prod ? 'bundle' : 'split', env: b.prod ? 'prod' : 'dev' }
  if (!b.proxy) options.proxy = false
  const bundler = new Bundler(options)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const fichiers = new Map<string, Buffer>()
  for (const n of readdirSync(out)) if (/\.(js|json)$/.test(n)) fichiers.set(n, readFileSync(join(out, n)))
  return fichiers
}

describe('état universel changé par un composant : tous ceux qui le tiennent le voient (trois moteurs)', function () {
  this.timeout(280000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const b of BATIS) {
    it(b.nom, async function () {
      const playwright: any = await import('playwright')
      const fichiers         = await construire(b)
      const ecarts: string[] = []
      let joues              = 0
      for (const moteur of ['chromium', 'firefox', 'webkit']) {
        if (!existsSync(playwright[moteur].executablePath())) continue
        const navigateur = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        joues++
        try {
          for (const sc of SCENES) {
            const page = await navigateur.newPage()
            const erreurs: string[] = []
            let vu: unknown
            page.on('pageerror', (e: any) => erreurs.push(String(e && e.message || e).slice(0, 200)))
            try {
              await page.addInitScript(OUTILS)
              await page.route('http://universel.test/**', async (route: any) => {
                const chemin = new URL(route.request().url()).pathname
                if (!chemin.startsWith('/out/')) return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><body><${sc.tag} id="premier"></${sc.tag}><script type="module" src="/out/bundle.js"></script></body>` })
                const corps = fichiers.get(chemin.slice(5))
                return route.fulfill(corps ? { status: 200, contentType: chemin.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps } : { status: 404, body: '' })
              })
              await page.goto('http://universel.test/page')
              await page.waitForFunction('(() => { const e = document.getElementById("premier"); return !!e && !!e._shadow })()', null, { timeout: 30000 })
              await page.waitForTimeout(300)
              vu = await page.evaluate(`(async () => { const p = document.getElementById('premier'); ${sc.code} })()`)
              if (process.env.MJS_UNIVERSEL_COMPTE && sc.tag === 'mjs-c-seul') console.log(`COMPTE§ ${b.nom} · ${moteur} : ${await page.evaluate('window.__compte')} appels aux tables pour une écriture`)
            }
            catch (e: any) {
              vu = 'scène en échec : ' + String(e && e.message || e).slice(0, 300)
            }
            finally {
              await page.close()
            }
            if (JSON.stringify(vu) !== JSON.stringify(sc.attendu)) ecarts.push(`${moteur} · ${sc.nom} : ${JSON.stringify(vu)}, attendu ${JSON.stringify(sc.attendu)}`)
            if (erreurs.length) ecarts.push(`${moteur} · ${sc.nom} : erreur dans la page — ${erreurs[0]}`)
          }
        }
        finally {
          await navigateur.close()
        }
      }
      if (!joues) return this.skip()
      assert.deepEqual(ecarts, [])
    })
  }
})
