// Un objet écrit par un composant qui ne l'a pas rangé lui-même dans une variable `$` (atteint par une valeur dérivée, ou pris par
// `µwrite`) fait suivre celui qui le tient, pendant qu'un AUTRE objet de la page est tenu par deux composants.
// La forme courante : une liste à lignes-composants, la ligne choisie par `$sel = $rows.find(…)` puis écrite par `$sel.label = v` —
// la ligne se refait aussitôt. La même ligne tenue par un autre composant : il voit l'écriture aussitôt, comme tout composant qui
// tient le même objet (avec l'enveloppe, le défaut), et la garde quand la ligne lui est redonnée.
// La forme rare : un objet pris par `µwrite` par un second composant, appli sans valeur dérivée — celui qui l'a rangé d'abord voit
// l'écriture du second aussitôt, et la garde quand l'objet lui est redonné, en développement comme en production.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const TIENT = '<script>\n$d = { label: \'\' }\n@poser = (o) -> $d = o\n</script>\n<p class="t">{$d.label}</p>\n'
const SOURCES: Record<string, Record<string, string>> = {
  // sans valeur dérivée : l'objet pris par `µwrite`
  brut:   { 'z-brut.mjs': '<script>\n$d = { label: \'\', meta: { n: 0 } }\n@poser = (o) -> $d = o\n@prendre = (o) -> µwrite $d, o\n@ecrire = (v) -> $d.label = v\n</script>\n<p class="t">{$d.label}</p>\n' },
  choix:  {
    'z-choix.mjs': '<script>\n$rows = []\n$id = 0\n$sel = $rows.find((r) => r.id == $id)\n@poser = (l) -> $rows = l\n@choisir = (i) -> $id = i\n@ecrire = (v) -> $sel.label = v\n</script>\n<p class="t">{$sel ? $sel.label : \'-\'}</p>\n',
    'z-tient.mjs': TIENT
  },
  liste:  {
    'z-liste.mjs': '<script>\n$rows = []\n$id = 0\n$sel = $rows.find((r) => r.id == $id)\n@poser = (l) -> $rows = l\n@choisir = (i) -> $id = i\n@ecrire = (v) -> $sel.label = v\n</script>\n<ul>{for r in $rows by id}<li><@z-item item={r}></@z-item></li>{end}</ul>\n<p class="t">{$sel ? $sel.label : \'-\'}</p>\n',
    'z-item.mjs':  '<p class="t">{$item ? $item.label : \'-\'}</p>\n',
    'z-tient.mjs': TIENT
  }
}

const OUTILS = `window.__data  = Array.from({ length: 3 }, (_, i) => ({ id: i, label: 'x' + i }));
window.__pause  = (ms = 150) => new Promise((f) => setTimeout(f, ms));
window.__ecran  = (e) => { const t = e && e._shadow && e._shadow.querySelector('.t'); return t ? t.textContent : null };
window.__pose   = (tag) => document.body.appendChild(document.createElement(tag));
window.__objet  = () => ({ id: 1, label: 'a', meta: { n: 1 } });
window.__lignes = async (p, n) => { for (let i = 0; i < 100; i++) { const l = p._shadow.querySelectorAll('mjs-z-item'); if (l.length === n && (l[n - 1]._shadow && l[n - 1]._shadow.querySelector('.t'))) break; await window.__pause(50) } await window.__pause(200) };
window.__ligne  = (p, i) => window.__ecran(p._shadow.querySelectorAll('mjs-z-item')[i]);`

// l'autre objet de la page, tenu par deux composants
const AUTRE = (tag: string): string => `const autre = __objet(), x = __pose('${tag}'), y = __pose('${tag}'); await __pause(200); x.poser(autre); y.poser(autre); await __pause(200);`

type Scene = { nom: string, sources: string, tag: string, code: string, attendu: unknown }
const SCENES: Scene[] = [
  { nom: 'liste à lignes-composants : la ligne choisie par une valeur dérivée, puis écrite par elle', sources: 'liste', tag: 'mjs-z-tient', attendu: { choisi: 'frais', lignes: ['x0', 'frais', 'x2'], brut: 'frais' }, code: `
    const data = __data, a = __pose('mjs-z-liste'); await __pause(200); a.poser(data); await __lignes(a, 3); a.choisir(1); await __pause(200);
    ${AUTRE('mjs-z-tient')}
    a.ecrire('frais'); await __pause(300);
    return { choisi: __ecran(a), lignes: [0, 1, 2].map((i) => __ligne(a, i)), brut: data[1].label }` },
  { nom: 'b tient la ligne, a l\'atteint par une valeur dérivée et l\'écrit : b suit aussitôt ; la ligne redonnée à b', sources: 'choix', tag: 'mjs-z-tient', attendu: { aussitot: ['frais', 'frais'], redonne: 'frais', brut: 'frais' }, code: `
    const data = __data, b = __pose('mjs-z-tient'), a = __pose('mjs-z-choix'); await __pause(200); b.poser(data[1]); a.poser(data); await __pause(200); a.choisir(1); await __pause(200);
    ${AUTRE('mjs-z-tient')}
    a.ecrire('frais'); await __pause(200); const aussitot = [__ecran(a), __ecran(b)]; b.poser(data[1]); await __pause(200);
    return { aussitot, redonne: __ecran(b), brut: data[1].label }` },
  { nom: 'a range o, w le prend par µwrite et l\'écrit : a suit aussitôt ; o redonné à a', sources: 'brut', tag: 'mjs-z-brut', attendu: { aussitot: ['frais', 'frais'], redonne: 'frais', brut: 'frais' }, code: `
    const o = __objet(), a = __pose('mjs-z-brut'), w = __pose('mjs-z-brut'); await __pause(200); a.poser(o); await __pause(200); w.prendre(o); await __pause(200);
    ${AUTRE('mjs-z-brut')}
    w.ecrire('frais'); await __pause(200); const aussitot = [__ecran(a), __ecran(w)]; a.poser(o); await __pause(200);
    return { aussitot, redonne: __ecran(a), brut: o.label }` }
]

type Bati = { nom: string, prod: boolean }
const BATIS: Bati[] = [
  { nom: 'développement', prod: false },
  { nom: 'production',    prod: true }
]

async function construire(b: Bati, jeu: string): Promise<Map<string, Buffer>> {
  const root = mjsTmp('ecrit')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  for (const [nom, code] of Object.entries(SOURCES[jeu])) writeFileSync(join(src, nom), code)
  const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', js: b.prod ? 'bundle' : 'split', env: b.prod ? 'prod' : 'dev' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const fichiers = new Map<string, Buffer>()
  for (const n of readdirSync(out)) if (/\.(js|json)$/.test(n)) fichiers.set(n, readFileSync(join(out, n)))
  return fichiers
}

describe('objet écrit par un composant qui ne l\'a pas rangé : celui qui le tient suit (Chromium)', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const b of BATIS) {
    it(b.nom, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright.chromium.executablePath())) return this.skip()
      const navigateur = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
      const ecarts: string[] = []
      try {
        for (const sc of SCENES) {
          const fichiers = await construire(b, sc.sources)
          const page     = await navigateur.newPage()
          const erreurs: string[] = []
          let vu: unknown
          page.on('pageerror', (e: any) => erreurs.push(String(e && e.message || e).slice(0, 200)))
          try {
            await page.addInitScript(OUTILS)
            await page.route('http://ecrit.test/**', async (route: any) => {
              const chemin = new URL(route.request().url()).pathname
              if (!chemin.startsWith('/out/')) return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><body><${sc.tag} id="premier"></${sc.tag}><script type="module" src="/out/bundle.js"></script></body>` })
              const corps = fichiers.get(chemin.slice(5))
              return route.fulfill(corps ? { status: 200, contentType: chemin.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps } : { status: 404, body: '' })
            })
            await page.goto('http://ecrit.test/page')
            await page.waitForFunction('(() => { const e = document.getElementById("premier"); return !!e && !!e._shadow })()', null, { timeout: 30000 })
            await page.waitForTimeout(300)
            vu = await page.evaluate(`(async () => { ${sc.code} })()`)
          }
          catch (e: any) {
            vu = 'scène en échec : ' + String(e && e.message || e).slice(0, 300)
          }
          finally {
            await page.close()
          }
          if (JSON.stringify(vu) !== JSON.stringify(sc.attendu)) ecarts.push(`${sc.nom} : ${JSON.stringify(vu)}, attendu ${JSON.stringify(sc.attendu)}`)
          if (erreurs.length) ecarts.push(`${sc.nom} : erreur dans la page — ${erreurs[0]}`)
        }
      }
      finally {
        await navigateur.close()
      }
      assert.deepEqual(ecarts, [])
    })
  }
})
