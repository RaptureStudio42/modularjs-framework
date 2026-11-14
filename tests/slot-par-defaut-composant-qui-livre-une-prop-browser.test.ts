// Un composant qui écrit un `<@slot>` par défaut hors de tout bloc ET passe une prop dynamique à un composant de sa racine : mis à
// niveau dans une page déjà là, son contenu attend hors de l'ombre la reprise de ses props, et son constructeur n'y voit encore aucun
// slot. Le rangement des slots doit pourtant se décider une seule fois, comme pour le même composant sans prop dynamique : une recherche
// du slot par défaut, à l'entrée du contenu, puis plus aucune — pas une par rendu structurel, à chaque instance. Rien de visible ne
// change : l'enfant projeté est dans le slot par défaut, sans index. Le slot par défaut écrit dans un bloc et les slots indexés d'une
// boucle gardent leur rangement et leur nombre de passes, ceux du témoin sans prop dynamique. Composant posé dans la page, ou dans
// l'ombre d'un parent ; développement et production en un fichier ; Chromium, Firefox et WebKit réels.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const BASCULE = '<button class="t" @click={$on = !$on}>t</button>\n'
const boite   = (prop: string) => "<script>\n  $g  = 'prefer'\n  $on = false\n</script>\n<div class=\"b\"><@slot></div>{if $on}<i class=\"i\">i</i>{end}<@c-k game=" + prop + '></@c-k>\n' + BASCULE
const volet   = (prop: string) => "<script>\n  $g  = 'prefer'\n  $on = false\n</script>\n{if $on}<div class=\"b\"><@slot></div>{end}<@c-k game=" + prop + '></@c-k>\n' + BASCULE
const onglets = (prop: string) => "<script>\n  $g    = 'prefer'\n  $on   = false\n  $tabs = ['a', 'b']\n</script>\n{for i, t in $tabs}<div class=\"tab\"><@slot {i}/></div>{end}{if $on}<i class=\"i\">i</i>{end}<@c-k game=" + prop + '></@c-k>\n' + BASCULE

// `…0` : le témoin, même composant dont la prop de l'enfant est fixe (rien n'attend, le constructeur voit son contenu)
const SOURCES: Record<string, string> = {
  'c-k.mjs': "<script>\n  $game = ''\n</script>\n<p class=\"vu\">{$game}</p>\n",
  'p-boite.mjs': boite('{$g}'),
  'p-boite0.mjs': boite('"prefer"'),
  'p-dedans.mjs': boite('{$g}'),
  'p-dedans0.mjs': boite('"prefer"'),
  'p-page.mjs': '<@p-dedans><span class="in">A</span></@p-dedans><@p-dedans0><span class="in">A</span></@p-dedans0>\n',
  'p-volet.mjs': volet('{$g}'),
  'p-volet0.mjs': volet('"prefer"'),
  'p-onglets.mjs': onglets('{$g}'),
  'p-onglets0.mjs': onglets('"prefer"')
}

const UN    = '<span class="in">A</span>'
const DEUX  = '<span class="in">A</span><span class="in">B</span>'
const CORPS = `<mjs-p-boite>${UN}</mjs-p-boite><mjs-p-boite0>${UN}</mjs-p-boite0><mjs-p-page></mjs-p-page><mjs-p-volet>${UN}</mjs-p-volet><mjs-p-volet0>${UN}</mjs-p-volet0><mjs-p-onglets>${DEUX}</mjs-p-onglets><mjs-p-onglets0>${DEUX}</mjs-p-onglets0>`

// recherches du slot par défaut faites sur une ombre, comptées par balise d'hôte
const COMPTE = `window.__sl = {};
(function () {
  var q = DocumentFragment.prototype.querySelector;
  DocumentFragment.prototype.querySelector = function (s) {
    if (s === 'slot:not([name])' && this.host) window.__sl[this.host.localName] = (window.__sl[this.host.localName] || 0) + 1;
    return q.apply(this, arguments);
  };
})();`

const HOTES = ['p-boite', 'p-boite0', 'p-dedans', 'p-dedans0', 'p-volet', 'p-volet0', 'p-onglets', 'p-onglets0']

// le slot de l'ombre qui reçoit chaque enfant projeté est lu du côté du slot : l'ombre est fermée, `assignedSlot` y est nul
const LIRE = `(() => {
  const hote = (n) => document.querySelector('mjs-' + n) || document.querySelector('mjs-p-page')._shadow.querySelector('mjs-' + n)
  const slotDe = (h, x) => { for (const s of h._shadow.querySelectorAll('slot')) if (s.assignedElements().includes(x)) return s.getAttribute('name') || 'défaut'; return null }
  const R = {}
  for (const n of ${JSON.stringify(HOTES)}) {
    const h = hote(n), ins = Array.from(h.querySelectorAll('.in')), k = h._shadow.querySelector('mjs-c-k')
    R[n] = { passes: window.__sl['mjs-' + n] || 0, index: ins.map((x) => x.getAttribute('slot')), slots: ins.map((x) => slotDe(h, x)), prop: k && k._shadow ? k._shadow.querySelector('.vu').textContent : null, erreurs: h._shadow.querySelectorAll('.mjs-error').length }
  }
  return R
})()`

const BASCULER = `(() => {
  for (const n of ${JSON.stringify(HOTES)}) (document.querySelector('mjs-' + n) || document.querySelector('mjs-p-page')._shadow.querySelector('mjs-' + n))._shadow.querySelector('.t').click()
})()`

type Hote = { passes: number, index: (string | null)[], slots: (string | null)[], prop: string | null, erreurs: number }

async function construire(prod: boolean): Promise<string> {
  const root   = mjsTmp('slot-defaut-prop-racine')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
  const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js') }
  if (prod) Object.assign(opts, { urlPrefix: '/out', env: 'prod', js: 'bundle' })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  if (prod) return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  return ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

describe('slot par défaut hors bloc d\'un composant qui livre une prop à sa racine : une seule passe de rangement (navigateurs)', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })
  const codes: Record<string, Promise<string>> = {}

  for (const moteur of ['chromium', 'firefox', 'webkit']) {
    it(`${moteur} : une recherche du slot par défaut, comme le témoin, au premier rendu et après trois bascules d'un {if}`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) return this.skip()
      const browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      try {
        for (const mode of ['développement', 'production']) {
          const code = await (codes[mode] ??= construire(mode === 'production'))
          const page = await browser.newPage()
          const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${CORPS}<script>${COMPTE}</script><script>${code.replace(/<\/script/g, '<\\/script')}</script></body></html>`
          await page.route('http://mjs.test/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
          await page.goto('http://mjs.test/')
          await page.waitForFunction(`(() => { const p = document.querySelector('mjs-p-page'), o = document.querySelector('mjs-p-onglets0'); return !!(p && p._shadow && p._shadow.querySelector('mjs-p-dedans0') && p._shadow.querySelector('mjs-p-dedans0')._shadow && o && o._shadow && o._shadow.querySelector('.t')) })()`)
          await page.waitForTimeout(300)
          const etapes: Record<string, Hote>[] = [await page.evaluate(LIRE)]
          for (let i = 0; i < 3; i++) {
            await page.evaluate(BASCULER)
            await page.waitForTimeout(120)
            etapes.push(await page.evaluate(LIRE))
          }
          await page.close()
          const ou = `${moteur}, ${mode}`
          etapes.forEach((e, i) => {
            const quand = i === 0 ? 'premier rendu' : `bascule ${i}`
            for (const n of HOTES) assert.deepEqual({ prop: e[n].prop, erreurs: e[n].erreurs }, { prop: 'prefer', erreurs: 0 }, `${ou}, ${quand}, ${n} : l'enfant de la racine a sa prop, aucun composant en erreur`)
            // slot par défaut hors bloc : rangement décidé une fois, enfant projeté dans le slot, sans index
            for (const n of ['p-boite', 'p-boite0', 'p-dedans', 'p-dedans0']) assert.deepEqual({ n, passes: e[n].passes, index: e[n].index, slots: e[n].slots }, { n, passes: 1, index: [null], slots: ['défaut'] }, `${ou}, ${quand} : une seule recherche du slot par défaut`)
            // slot par défaut dans un bloc, slots indexés d'une boucle : le rangement et le nombre de passes du témoin
            assert.deepEqual(e['p-volet'], e['p-volet0'], `${ou}, ${quand} : slot par défaut dans un bloc, comme le témoin`)
            assert.deepEqual(e['p-onglets'], e['p-onglets0'], `${ou}, ${quand} : slots indexés, comme le témoin`)
            assert.deepEqual({ index: e['p-volet'].index, slots: e['p-volet'].slots }, { index: [null], slots: [i % 2 === 1 ? 'défaut' : null] }, `${ou}, ${quand} : l'enfant projeté suit le bloc qui porte le slot par défaut`)
            assert.deepEqual({ index: e['p-onglets'].index, slots: e['p-onglets'].slots }, { index: ['0', '1'], slots: ['0', '1'] }, `${ou}, ${quand} : chaque enfant garde son slot indexé`)
          })
        }
      }
      finally {
        await browser.close()
      }
    })
  }
})
