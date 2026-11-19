// le déballage des enveloppes (`µ._mjs_toRaw`) jusqu'à la cible brute : une enveloppe de l'appli qui se rend elle-même
// (`new Proxy({}, { get: () => p })`), ou deux qui se rendent l'une l'autre, en ligne d'une liste de l'état, figeaient la page au montage
// (le déballage ne finissait jamais). Défaut garanti absent : arrêt quand la valeur ne change plus, et huit pas au plus ; la page se monte,
// les lignes ordinaires de la même liste comprises (en production ; en développement, un contrôle du développement appelle une méthode
// de la ligne, que ce piège rend comme une enveloppe : erreur interceptée, la page vit). Les lectures du piège sont comptées au montage (au-delà de 100 000, le piège lève : la
// page figée, sans figer le test). Développement et production (un seul fichier)
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// les pièges, posés avant le cœur : chacun rend une enveloppe à chaque lecture, et compte ses lectures
const PIEGES = `
  globalThis.__lus = 0;
  globalThis.__fige = 0;
  var __lire = function(rendu) {
    return function() {
      if (++__lus > 100000) { __fige = 1; throw new Error('piège : page figée'); }
      return rendu();
    };
  };
  var __seul = new Proxy({}, { get: __lire(function() { return __seul; }) });
  var __a = new Proxy({}, { get: __lire(function() { return __b; }) });
  var __b = new Proxy({}, { get: __lire(function() { return __a; }) });
  globalThis.__pieges = { seul: __seul, paire: __a };
`

const LISTE = `<script>
  $l = [globalThis.__pieges[globalThis.__cas], { n: 2 }]
</script>
<p class="ok">{$l.length}</p><ul>{for x in $l}<li>{typeof x}</li>{end}</ul>
`

async function construire(env: 'dev' | 'prod'): Promise<string> {
  const root = mjsTmp('deballage-borne-' + env)
  const out  = join(root, 'out')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'liste.mjs'), LISTE)
  const prod      = env === 'prod'
  const opts: any = { sourceDir: join(root, 'src'), outputDir: out, manifestPath: join(prod ? out : root, 'bundle.js') }
  if (prod) Object.assign(opts, { env: 'prod', js: 'bundle', minify: false })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(out).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  return prod ? readFileSync(join(out, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '') : ordre.map((f) => stripEsm(readFileSync(join(out, f), 'utf-8'))).join('\n')
}

describe('déballage des enveloppes : borné, une enveloppe qui se rend elle-même ne fige plus la page', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const env of ['dev', 'prod'] as const) {
    for (const cas of ['seul', 'paire'] as const) {
      it(`${env} : ${cas === 'seul' ? 'une enveloppe qui se rend elle-même' : 'deux enveloppes qui se rendent l\'une l\'autre'}, en ligne d'une liste`, async () => {
        const code = await construire(env)
        const w: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
        const avis: string[] = []
        w.console = { log() {}, info() {}, debug() {}, warn() {}, error: (...a: any[]) => avis.push(a.map(String).join(' ').slice(0, 300)) }
        w.eval(PIEGES + `globalThis.__cas = '${cas}';\n` + code + '\nglobalThis.µ = µ;')
        w.document.body.innerHTML = '<mjs-liste></mjs-liste>'
        await pause(150)
        const el    = w.document.querySelector('mjs-liste')
        const vu    = { fige: w.__fige, ok: el._shadow?.querySelector('.ok')?.textContent, lignes: [...(el._shadow?.querySelectorAll('li') ?? [])].map((li: any) => li.textContent).join(',') }
        const lus   = w.__lus
        assert.equal(vu.fige, 0, `page figée — lectures du piège au montage : ${lus}`)
        assert.ok(lus <= 200, `lectures du piège au montage : ${lus}`)
        // production : la liste se rend. Développement : un contrôle du développement appelle une méthode de la ligne, que ce piège rend
        // comme une enveloppe (« object is not a function ») — le composant s'arrête sur une erreur interceptée, la page vit
        if (env === 'prod') assert.deepEqual({ ok: vu.ok, lignes: vu.lignes, avis }, { ok: '2', lignes: 'object,object', avis: [] })
        else assert.ok(avis.length === 1 && avis[0].includes('object is not a function'), avis.join(' | '))
        w.close?.()
      })
    }
  }
})
