// `µajax '/app/rewards', type: Reward[]` dans un vrai navigateur : la réponse d'un vrai fetch, contrôlée une fois à son arrivée —
// convertie et complétée par ses valeurs de départ, ou refusée par une µTypeError qui nomme son chemin, sa règle et son composant
// moteurs exigés : chromium, firefox, webkit

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit, type Browser } from 'playwright'
import { parseTypesBlock, compileAjaxTypes, type RuleAst } from '../src/transpiler/var-types.js'

const ICI  = dirname(fileURLToPath(import.meta.url))
const lire = (f: string): string => readFileSync(join(ICI, '../src/runtime', f), 'utf-8')

const DEFS: Record<string, RuleAst> = {}
for (const d of parseTypesBlock(['', 'Reward', '  id int 1..', '  title string 1..80', '  price = 0 int 0..'].join('\n'), 1)) DEFS[d.name] = d.rule
const TYPE = /type: (µ\._mjs_tajax\(.*\))$/.exec(compileAjaxTypes("r = await µajax '/app/rewards', type: Reward[]", DEFS, true, 1, 'mjs-boutique').code)![1]

const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>window.µ = { warnings: [], log: function() {}, error: function() {}, warn: function(m) { µ.warnings.push(m) }, _typesMode: 'warn', _mjs_toRaw: function(x) { return x }, _mjs_interpolatorSet: new WeakSet(), _mjs_storeRaw: {}, _mjs_txt: function(k, v, f) { return f.replace(/\\{(\\w+)\\}/g, function(m, n) { return v && n in v ? v[n] : m }) } }; µ._mjs_msg = µ._mjs_txt;</script>
<script>${lire('mjs_types.ts')}</script>
<script>${lire('mjs_types_ajax.ts')}</script>
<script>${lire('mjs_ajax.ts')}</script>
</body></html>`

const REPONSES: Record<string, unknown> = {
  '/app/rewards?bon':     [{ id: '1', title: 'Thé' }],
  '/app/rewards?mauvais': [{ id: 1, title: 'Thé' }, { id: 'x', title: 'Café' }]
}

for (const [nom, moteur] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]] as const) {
  describe(`µajax '/url', type: — une vraie réponse, à son arrivée (${nom})`, function () {
    this.timeout(90000)
    let browser: Browser | null = null
    let server: Server | null = null
    let origin = ''

    before(async () => {
      browser = await moteur.launch()
      server  = createServer((req, res) => {
        const corps = REPONSES[req.url ?? '']
        res.writeHead(200, { 'content-type': corps === undefined ? 'text/html; charset=utf-8' : 'application/json' })
        res.end(corps === undefined ? PAGE : JSON.stringify(corps))
      })
      await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
      origin = 'http://127.0.0.1:' + (server!.address() as any).port
    })

    after(async () => {
      if (browser) await browser.close()
      if (server) await new Promise(resolve => server!.close(() => resolve(null)))
    })

    it('acceptée : convertie et complétée ; refusée : une µTypeError qui nomme le chemin, la règle et le composant', async () => {
      const page = await browser!.newPage()
      await page.goto(origin + '/')
      const r = await page.evaluate(`(async () => {
        const type = ${TYPE};
        const bon  = await µ._mjs_ajax('/app/rewards?bon', { type });
        let refus;
        await µ._mjs_ajax('/app/rewards?mauvais', { type }).catch(e => { refus = { nom: e.name, chemin: e.path, regle: e.rule, valeur: e.value, composant: e.component, erreur: e instanceof Error } });
        return { bon, refus, avertissements: µ.warnings.length };
      })()`)
      assert.deepEqual(r, { bon: [{ id: 1, title: 'Thé', price: 0 }], refus: { nom: 'µTypeError', chemin: '[1].id', regle: 'int 1..', valeur: 'x', composant: 'mjs-boutique', erreur: true }, avertissements: 0 })
      await page.close()
    })
  })
}
