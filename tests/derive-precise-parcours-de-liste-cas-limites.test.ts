// Valeurs dérivées précises (option `derived: "precise"`) : un parcours de liste (`filter`, `map`, `find`…) lu pendant le
// calcul contrôlé d'une valeur précise rend ce que rend la règle de toujours (le même paquet bâti sans l'option), jusque
// dans les cas limites : liste `Proxy` de l'application dont les indices ne sont pas des données propres, liste gelée après
// coup, prototype de la liste changé après coup (tableau rendu : un `Array`), critère qui n'est pas une fonction (même
// erreur, au même moment), liste tenue par deux composants (la valeur de l'horloge, qui suit aussi ce que l'autre composant
// y change), trou d'une liste rempli par `Array.prototype`. Happy-dom en développement et en production ; Chromium, Firefox
// et WebKit en production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const LISTE = `<script>
$rows = []
$pos = {x: 0}
$seuil = -1
$vis = $rows.filter((r) -> r.sel)
$noms = $rows.map((r) -> r.l)
$premier = $rows.find((r) -> r.sel)
$au = $rows.filter((r) -> r.id > $seuil)
@choisir = (x) -> $rows = x
@bouger = (i) -> $pos = {x: i}
@seuiller = (s) -> $seuil = s
@editer = (i) -> $rows[i].sel = not $rows[i].sel
</script>
<p class="v">{$vis.length}|{$noms.length}|{$au.length}</p>
`

const CRITERE = `<script>
$rows = []
$crit = null
$pos = {x: 0}
$fc = $rows.filter($crit)
@choisir = (x) -> $rows = x
@bouger = (i) -> $pos = {x: i}
</script>
<p class="v">{$pos.x}</p>
`

const CORPS = ['proxy', 'gel', 'proto', 'partage-a', 'partage-b', 'trou'].map((i) => `<mjs-derive-limites-liste id="${i}"></mjs-derive-limites-liste>`).join('') + '<mjs-derive-limites-critere id="critere"></mjs-derive-limites-critere>'

const SCENARIO = `(async () => {
  const pause = () => new Promise((r) => setTimeout(r, 15))
  const R = {}
  const el = (id) => document.getElementById(id)
  const mk = (n) => Array.from({length: n}, (_, i) => ({id: i, l: 'l' + i, sel: i % 2 === 0}))
  const un = (x) => x == null ? '_' : typeof x === 'object' ? '#' + x.id : String(x)
  const fmt = (v) => Array.isArray(v) ? '[' + Array.from(v, un).join(',') + ']' : un(v)
  const lire = (m) => {
    try {
      const s = m._state
      return 'vis=' + fmt(s.vis) + ' noms=' + fmt(s.noms) + ' premier=' + fmt(s.premier) + ' au=' + fmt(s.au) + ' écran=' + m._shadow.querySelector('.v').textContent
    }
    catch (e) {
      return 'ERR ' + e.name + ' ' + e.message
    }
  }
  const proto = (v, L) => { const p = Object.getPrototypeOf(v); return p === Array.prototype ? 'Array' : p === L.prototype ? 'L' : 'autre' }
  const cas = async (nom, fn) => { try { await fn() } catch (e) { R[nom + ' !'] = 'EXC ' + e.message } }
  // liste Proxy de l'application : ses indices ne sont pas des données de la cible, elle change sans écriture du composant
  await cas('proxy', async () => {
    const m = el('proxy'), V = {n: 4, m: 2}
    const ix = (k) => typeof k === 'string' && /^[0-9]+$/.test(k)
    const virt = new Proxy([], {
      get: (t, k, r) => k === 'length' ? V.n : ix(k) ? (+k < V.n ? {id: +k, l: 'v' + k, sel: +k < V.m} : undefined) : Reflect.get(t, k, r),
      has: (t, k) => ix(k) ? +k < V.n : Reflect.has(t, k)
    })
    m.choisir(virt); await pause(); R['proxy.0 choisie'] = lire(m)
    m.bouger(1); await pause(); R['proxy.1 autre écriture'] = lire(m)
    V.m = 3; m.bouger(2); await pause(); R['proxy.2 changée dehors'] = lire(m)
    V.n = 6; V.m = 6; m.bouger(3); await pause(); R['proxy.3 allongée dehors'] = lire(m)
  })
  // liste gelée après sa première lecture : ses éléments se lisent bruts
  await cas('gel', async () => {
    const m = el('gel'), arr = mk(4)
    m.choisir(arr); await pause(); R['gel.0'] = lire(m)
    Object.freeze(arr); m.seuiller(0); await pause(); R['gel.1 gelée'] = lire(m)
    R['gel.1 premier brut'] = arr.includes(m._state.premier)
    m.editer(1); await pause(); R['gel.2 édition'] = lire(m)
    m.bouger(1); await pause(); R['gel.3 autre écriture'] = lire(m)
    arr[2].sel = !arr[2].sel; m.bouger(2); await pause(); R['gel.4 changée dehors'] = lire(m)
    m.seuiller(-1); await pause(); R['gel.5 seuil'] = lire(m)
  })
  // prototype de la liste changé après sa première lecture, puis une vraie écriture
  await cas('proto', async () => {
    const m = el('proto'), arr = mk(5)
    class L extends Array {}
    m.choisir(arr); await pause(); R['proto.0'] = lire(m) + ' vis:' + proto(m._state.vis, L)
    Object.setPrototypeOf(arr, L.prototype); m.editer(1); await pause()
    R['proto.1 prototype changé'] = lire(m) + ' vis:' + proto(m._state.vis, L) + ' noms:' + proto(m._state.noms, L)
  })
  // critère qui n'est pas une fonction : l'erreur de la méthode, liste vide comprise
  await cas('critere', async () => {
    const m = el('critere')
    const lc = () => { try { return fmt(m._state.fc) } catch (e) { return 'ERR ' + e.name + ' ' + e.message } }
    R['critere.0 liste vide'] = lc()
    m.choisir(mk(2)); await pause(); R['critere.1 deux lignes'] = lc()
    m.choisir([]); m.bouger(1); await pause(); R['critere.2 vide de nouveau'] = lc()
  })
  // liste tenue par deux composants, changée par le second
  await cas('partage', async () => {
    const a = el('partage-a'), b = el('partage-b'), arr = mk(5)
    a.choisir(arr); await pause(); R['partage.0 a'] = lire(a)
    b.choisir(arr); await pause(); R['partage.1 b'] = lire(b); R['partage.2 a'] = lire(a)
    b.editer(1); await pause(); R['partage.3 a après b.editer'] = lire(a); R['partage.4 b'] = lire(b)
    arr[2].sel = !arr[2].sel; a.bouger(1); await pause(); R['partage.5 a, autre écriture'] = lire(a)
  })
  // trou de la liste rempli par Array.prototype (retiré aussitôt, sa longueur rendue)
  await cas('trou', async () => {
    const m = el('trou'), arr = mk(3), P = {id: 66, l: 'proto', sel: true}, lg = Array.prototype.length
    delete arr[1]
    Array.prototype[1] = P
    try {
      m.choisir(arr); await pause(); R['trou.0 rempli par le prototype'] = lire(m)
      P.sel = false; m.bouger(1); await pause(); R['trou.1 changé dehors'] = lire(m)
    }
    finally {
      delete Array.prototype[1]
      Array.prototype.length = lg
    }
  })
  return R
})()`

async function construire(prod: boolean, precise: boolean): Promise<string> {
  const root   = mjsTmp('derive-limites')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'derive-limites-liste.mjs'), LISTE)
  writeFileSync(join(srcDir, 'derive-limites-critere.mjs'), CRITERE)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js') }
  opts.derivedMode = precise ? 'precise' : 'clock'
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  return prod
    ? readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    : ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

// tous les composants de la page dessinés
const PRETS = () => [...document.querySelectorAll('mjs-derive-limites-liste, mjs-derive-limites-critere')].every((e: any) => !!e._shadow?.querySelector('.v'))

async function jouerHappyDom(code: string): Promise<any> {
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(code)
  window.document.body.innerHTML = CORPS
  const fin = Date.now() + 5000
  while (![...window.document.querySelectorAll('mjs-derive-limites-liste, mjs-derive-limites-critere')].every((e: any) => !!e._shadow?.querySelector('.v')) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  // objets de la fenêtre de happy-dom : comparés par leur texte
  const r = JSON.parse(JSON.stringify(await window.eval(SCENARIO)))
  await window.happyDOM.close()
  return r
}

async function jouerMoteur(moteur: string, code: string): Promise<any> {
  const playwright: any = await import('playwright')
  const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  try {
    const page = await browser.newPage()
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${CORPS}<script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
    await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
    await page.goto('http://mjs.test/')
    await page.waitForFunction(PRETS)
    return await page.evaluate(SCENARIO)
  }
  finally {
    await browser.close()
  }
}

// la valeur précise rend ce que rend la règle de toujours ; repères : le scénario a joué jusqu'au bout, l'horloge rend ce
// qu'on attend d'elle. Firefox nomme dans le message d'un rappel invalide l'expression du code qui appelle la méthode : le
// paramètre du parcours d'une entrée (`o is not a function`), l'expression du paquet sans l'option (`n.crit is not a
// function`) — même erreur, au même moment, comparée sans ce nom
function verifier(precise: any, horloge: any, sansNom = false) {
  assert.ok(!Object.keys(horloge).some((k) => k.endsWith(' !')), JSON.stringify(horloge))
  assert.match(horloge['proxy.3 allongée dehors'], /^vis=\[#0,#1,#2,#3,#4,#5\]/)
  assert.equal(horloge['gel.1 premier brut'], true)
  assert.match(horloge['proto.1 prototype changé'], / vis:Array noms:Array$/)
  assert.match(horloge['critere.0 liste vide'], /^ERR TypeError /)
  assert.match(horloge['partage.3 a après b.editer'], /^vis=\[#0,#1,#2,#4\]/)
  assert.match(horloge['trou.1 changé dehors'], /^vis=\[#0,#2\]/)
  const nom = (r: any) => sansNom ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' ? v.replace(/^ERR TypeError [\w.$]+ is not a function$/, 'ERR TypeError … is not a function') : v])) : r
  assert.deepEqual(nom(precise), nom(horloge))
}

describe('valeurs dérivées précises : un parcours de liste rend le résultat de la règle de toujours, cas limites compris', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const prod of [false, true]) {
    describe(prod ? 'production' : 'développement', function () {
      let precise: string
      let horloge: string
      before(async () => {
        precise = await construire(prod, true)
        horloge = await construire(prod, false)
      })

      it('happy-dom : même résultat que sans l\'option', async () => {
        verifier(await jouerHappyDom(precise), await jouerHappyDom(horloge))
      })

      if (!prod) return
      for (const moteur of ['chromium', 'firefox', 'webkit']) {
        it(`${moteur} : même résultat que sans l'option`, async function () {
          const playwright: any = await import('playwright')
          if (!existsSync(playwright[moteur].executablePath())) return this.skip()
          verifier(await jouerMoteur(moteur, precise), await jouerMoteur(moteur, horloge), moteur === 'firefox')
        })
      }
    })
  }
})
