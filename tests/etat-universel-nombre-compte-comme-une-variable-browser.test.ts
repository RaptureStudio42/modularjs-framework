// `µ$nb = 0` tient un nombre, le même pour toute la page : `µ$nb++`, `µ$nb--`, `++µ$nb` et `µ$nb += 1` le comptent comme une variable
// (la valeur de départ était rangée dans un objet `{ value: 0 }`, que `µ$nb++` changeait en NaN), la première déclaration exécutée
// pose la valeur de départ, et l'écran de chaque composant qui le copie par un reffet (`µeffect -> $n = µ$nb`) suit ; une ligne
// `µ$x = 0;` d'un `<script lang="js">` se construit et compte de même ; en développement et en production, dans les trois moteurs

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

type Groupe = { nom: string, tag: string, sources: Record<string, string>, code: string, attendu: unknown }
const GROUPES: Groupe[] = [
  {
    nom: 'Civet : ++, --, ++ devant, += ; un second composant qui déclare le même nombre le voit et suit',
    tag: 'mjs-c-compte',
    sources: {
      'c-compte.mjs': '<script>\nµ$znb = 0\nµeffect -> $n = µ$znb\n@plus = -> µ$znb++\n@moins = -> µ$znb--\n@avant = -> ++µ$znb\n@ajoute = -> µ$znb += 1\n</script>\n<p class="t">{$n}</p>\n<button class="plus" @click={@plus()}>+</button>\n<button class="moins" @click={@moins()}>-</button>\n<button class="avant" @click={@avant()}>+</button>\n<button class="ajoute" @click={@ajoute()}>+</button>\n',
      'c-autre.mjs':  '<script>\nµ$znb = 5\nµeffect -> $n = µ$znb\n</script>\n<p class="t">{$n}</p>\n'
    },
    attendu: ['0 0', '1 1', '0 0', '1 1', '2 2'],
    code: `
      const a = __pose('mjs-c-autre'); await __pause(400);
      const vus = [], lire = () => vus.push(__ecran(p) + ' ' + __ecran(a));
      lire();
      for (const c of ['plus', 'moins', 'avant', 'ajoute']) { __clic(p, c); await __pause(); lire() }
      return vus`
  },
  {
    nom: 'JavaScript : `µ$zjs = 0;` se construit, ++ et += comptent',
    tag: 'mjs-c-js',
    sources: {
      'c-js.mjs': '<script lang="js">\nµ$zjs = 0;\nµeffect(() => { $n = µ$zjs; });\n@plus = function() { µ$zjs++; };\n@ajoute = function() { µ$zjs += 2; };\n</script>\n<p class="t">{$n}</p>\n<button class="plus" @click={@plus()}>+</button>\n<button class="ajoute" @click={@ajoute()}>+</button>\n'
    },
    attendu: ['0', '1', '3'],
    code: `
      const vus = [__ecran(p)];
      for (const c of ['plus', 'ajoute']) { __clic(p, c); await __pause(); vus.push(__ecran(p)) }
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
  const root = mjsTmp('universel-nombre')
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

describe('état universel : un nombre compte comme une variable (trois moteurs)', function () {
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
          await page.route('http://universel-nombre.test/**', async (route: any) => {
            const chemin = new URL(route.request().url()).pathname
            if (!chemin.startsWith('/out/')) return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><body><${g.tag} id="premier"></${g.tag}><script type="module" src="/out/bundle.js"></script></body>` })
            const corps = fichiers.get(chemin.slice(5))
            return route.fulfill(corps ? { status: 200, contentType: chemin.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps } : { status: 404, body: '' })
          })
          await page.goto('http://universel-nombre.test/page')
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
