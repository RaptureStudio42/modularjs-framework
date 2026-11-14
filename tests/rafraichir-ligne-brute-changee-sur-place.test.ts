// `µrefresh($rows)` redessine aussi une ligne brute changée sur place : pendant la redite que déclenche `µrefresh`, la liste qui affiche
// la variable ne saute aucune ligne. Ligne marquée une à une, liste marquée avec `µraw(liste, true)`, liste déjà affichée puis notée ;
// développement, production sans aucune prop passée à un enfant, production avec une prop, et réglage `proxy: false`. Hors `µrefresh`, le saut des lignes brutes tient : sans `µrefresh` la ligne
// changée sur place reste telle quelle, `µrefresh` d'une autre variable ne relit pas la liste, et la passe d'après la redite saute de nouveau

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { attendre, pause } from './helpers/coeur-monter.js'

const HOST = `<script lang="js">
  $rows  = µ.raw([]);
  $live  = [];
  $other = 0;
  @fill         = function(a) { $rows = a; };
  @markAll      = function(a) { return µ.raw(a, true); };
  @change       = function(f) { $rows = f($rows); };
  @refresh      = function() { µrefresh($rows); };
  @refreshOther = function() { µrefresh($other); };
  @fillLive     = function(a) { $live = a; };
  @markLive     = function() { $live = µ.raw($live, true); };
  @refreshLive  = function() { µrefresh($live); };
</script>
<ul class="k">{for r in $rows by id}<li>{r.id}:{r.label}</li>{end}</ul>
<ul class="u">{for r in $rows}<li>{r.label}</li>{end}</ul>
<ul class="l">{for r in $live by id}<li>{r.label}</li>{end}</ul>
<p class="o">{$other}</p>
`
// le même hôte qui passe une prop à un enfant
const HOST_PROP = HOST + '<@enfant v={$other}>\n'
const CHILD     = '<b>{$v}</b>\n'

async function mount(opts: Record<string, unknown>): Promise<{ window: any, host: any, µ: any }> {
  const root   = mjsTmp('rafraichir-ligne-brute')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), opts.prop ? HOST_PROP : HOST)
  writeFileSync(join(srcDir, 'enfant.mjs'), CHILD)
  const { prop: _prop, ...rest } = opts
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...rest } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const out   = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const order = [...out.filter((f) => f.startsWith('mjs_')), ...out.filter((f) => !f.startsWith('mjs_'))]
  const code  = order.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(`${code}\nglobalThis.µ = µ;`)
  window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
  const host = window.document.querySelector('mjs-hote')
  await attendre(() => !!host._shadow)
  await pause(120)
  return { window, host, µ: window.µ }
}

const tick = async () => { await pause(0); await pause(0); await pause(0) }

const ENVS: [string, Record<string, unknown>][] = [['dev', {}], ['prod', { env: 'prod', minify: false }], ['prodProp', { env: 'prod', minify: false, prop: true }], ['sansProxy', { proxy: false }]]

describe('µrefresh($rows) redessine une ligne brute changée sur place', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [env, opts] of ENVS) {
    for (const mode of ['rows', 'list'] as const) {
      it(`${env}, ${mode === 'rows' ? 'lignes marquées une à une' : 'µraw(liste, true)'} : redessinée par µrefresh, sautée sans lui`, async () => {
        const { host, µ } = await mount(opts)
        const lis  = (cls: string): string[] => Array.from(host._shadow.querySelectorAll(`ul.${cls} > li`)).map((li: any) => li.textContent)
        const item = (x: any) => mode === 'rows' ? µ.raw(x) : x
        const mark = (a: any[]) => mode === 'list' ? host.markAll(a) : µ.raw(a)
        const a    = ['a', 'b', 'c'].map((label, i) => item({ id: i + 1, label }))
        host.fill(mark(a))
        await tick()
        // sans µrefresh : la liste repasse (tableau neuf, mêmes objets), la ligne brute changée sur place est sautée
        a[1].label = 'B'
        host.change((cur: any[]) => mark(cur.slice()))
        await tick()
        assert.deepEqual(lis('k'), ['1:a', '2:b', '3:c'], 'sans µrefresh, le saut tient')
        // µrefresh d'une autre variable : la liste n'est pas relue
        host.refreshOther()
        await tick()
        assert.deepEqual(lis('k'), ['1:a', '2:b', '3:c'], 'µrefresh($other) ne relit pas la liste')
        // µrefresh($rows) : toutes les lignes relues, à clé comme sans clé
        host.refresh()
        await tick()
        assert.deepEqual(lis('k'), ['1:a', '2:B', '3:c'], 'µrefresh($rows), liste à clé')
        assert.deepEqual(lis('u'), ['a', 'B', 'c'], 'µrefresh($rows), liste sans clé')
        // la passe d'après la redite saute de nouveau
        a[2].label = 'C'
        host.change((cur: any[]) => mark(cur.slice()))
        await tick()
        assert.deepEqual(lis('k'), ['1:a', '2:B', '3:c'], 'après la redite, le saut revient')
      })
    }

    it(`${env}, liste déjà affichée puis notée par true : redessinée par µrefresh`, async () => {
      const { host } = await mount(opts)
      const lis = (): string[] => Array.from(host._shadow.querySelectorAll('ul.l > li')).map((li: any) => li.textContent)
      const src = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }]
      host.fillLive(src)
      await tick()
      host.markLive()
      await tick()
      src[1].label = 'R'
      host.refreshLive()
      await tick()
      assert.deepEqual(lis(), ['a', 'R'])
    })
  }
})
