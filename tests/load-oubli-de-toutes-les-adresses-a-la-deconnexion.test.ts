// `µload.clear()`, à la déconnexion : toutes les adresses gardées sont oubliées — lue par un composant, dans le cache de cinq minutes,
// pendant une relecture (annulée) — ; le composant monté qui en montrait une repasse à son attente, sans la donnée du compte d'avant, et
// la redemande. Comme avant, une relecture en erreur (401) garde la donnée. Une adresse écrite en argument (`µload.clear('/api/me')`) est
// dite en développement, et tout est oublié quand même. Le code n'entre au cœur que d'une appli qui écrit `µload.clear` : sans lui,
// `µ.load.clear` n'existe pas. Développement et production (un seul fichier)
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// le faux réseau, posé avant le cœur : chaque requête attend sa réponse
const RESEAU = `
  globalThis.__req = [];
  globalThis.fetch = function(url, o) {
    return new Promise(function(res, rej) {
      var r = { url: String(url), method: (o && o.method) || 'GET', aborted: false };
      r.reply = function(status, body) { res(new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } })); };
      if (o && o.signal) o.signal.addEventListener('abort', function() { r.aborted = true; rej(new DOMException('aborted', 'AbortError')); });
      __req.push(r);
    });
  };
`

const MOI = `<script>
  $me = µload('/api/me')
</script>
<p class="nom">{$me.pending ? 'attente' : $me.data?.pseudo}</p><button class="sortir" @click={µload.clear()}>s</button><button class="mal" @click={µload.clear('/api/me')}>m</button>
`

const SANS = `<script>
  $me = µload('/api/me')
</script>
<p class="nom">{$me.data?.pseudo}</p>
`

async function monter(prefixe: string, source: string, env: 'dev' | 'prod'): Promise<{ w: any; avis: string[] }> {
  const root = mjsTmp(prefixe + '-' + env)
  const out  = join(root, 'out')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'moi.mjs'), source)
  const prod      = env === 'prod'
  const opts: any = { sourceDir: join(root, 'src'), outputDir: out, manifestPath: join(prod ? out : root, 'bundle.js') }
  if (prod) Object.assign(opts, { env: 'prod', js: 'bundle', minify: false })
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(out).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const code  = prod ? readFileSync(join(out, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '') : ordre.map((f) => stripEsm(readFileSync(join(out, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  const avis: string[] = []
  window.console = { log() {}, info() {}, debug() {}, warn: (...a: any[]) => avis.push(a.map(String).join(' ')), error: (...a: any[]) => avis.push('error ' + a.map(String).join(' ')) }
  window.eval(RESEAU + code + '\nglobalThis.µ = µ;')
  window.µ.ajax.error = () => null
  window.document.body.innerHTML = '<mjs-moi></mjs-moi>'
  await pause(150)
  return { w: window, avis }
}

const requetes = (w: any, motif: string) => w.__req.filter((r: any) => (r.method + ' ' + r.url.replace('http://localhost', '')) === motif)
async function repondre(w: any, motif: string, status: number, body: any) {
  const r = requetes(w, motif).filter((x: any) => !x.repondue && !x.aborted)[0]
  assert.ok(r, 'aucune requête ouverte ' + motif + ' — vues : ' + w.__req.map((x: any) => x.method + ' ' + x.url).join(', '))
  r.repondue = true
  r.reply(status, body)
  await pause(60)
}

describe('µload.clear() — toutes les adresses gardées oubliées à la déconnexion', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const env of ['dev', 'prod'] as const) {
    it(`${env} : le composant repasse à son attente et redemande, sans la donnée d'avant ; cache, relecture en vol et relecture en 401`, async () => {
      const { w } = await monter('load-oubli', MOI, env)
      const el    = w.document.querySelector('mjs-moi')
      const nom   = () => el._shadow.querySelector('.nom').textContent.trim()
      assert.equal(typeof w.µ.load.clear, 'function', 'µload.clear() absent d\'une appli qui l\'écrit')
      await repondre(w, 'GET /api/me', 200, { pseudo: 'Ada' })
      assert.equal(nom(), 'Ada')
      // lue par un module, que plus rien ne lit : rangée dans le cache de cinq minutes
      const autre = w.µ.load('/api/autre')
      await repondre(w, 'GET /api/autre', 200, { n: 1 })
      // comme avant : une relecture en erreur garde la donnée
      w.µ.load.refresh('/api/me')
      await repondre(w, 'GET /api/me', 401, { error: 'non' })
      assert.equal(nom(), 'Ada')
      // une relecture en vol, la donnée d'avant gardée pendant ce temps, puis la déconnexion
      w.µ.load.refresh('/api/me')
      await pause(30)
      el._shadow.querySelector('button.sortir').click()
      await pause(60)
      const me = requetes(w, 'GET /api/me')
      assert.equal(me[2].aborted, true, 'la relecture en vol n\'est pas annulée')
      assert.equal(me.length, 4, 'l\'adresse oubliée n\'est pas redemandée')
      assert.equal(nom(), 'attente')
      await repondre(w, 'GET /api/me', 200, { pseudo: 'Zoé' })
      assert.equal(nom(), 'Zoé')
      // l'adresse du cache : redemandée à sa prochaine lecture, sans sa donnée d'avant
      assert.equal(autre.data, undefined)
      assert.equal(requetes(w, 'GET /api/autre').length, 2)
    })

    it(`${env} : une adresse écrite en argument est dite (développement) et tout est oublié ; sans µload.clear dans l'appli, le code n'y est pas`, async () => {
      const { w, avis } = await monter('load-oubli-arg', MOI, env)
      const el          = w.document.querySelector('mjs-moi')
      await repondre(w, 'GET /api/me', 200, { pseudo: 'Ada' })
      el._shadow.querySelector('button.mal').click()
      await pause(60)
      assert.equal(el._shadow.querySelector('.nom').textContent.trim(), 'attente')
      assert.equal(requetes(w, 'GET /api/me').length, 2)
      if (env === 'dev') assert.ok(avis.some((a) => a.includes('µload.clear()') && a.includes('/api/me')), 'aucun avertissement : ' + avis.join(' | '))
      const sans = await monter('load-oubli-sans', SANS, env)
      await repondre(sans.w, 'GET /api/me', 200, { pseudo: 'Ada' })
      assert.equal(typeof sans.w.µ.load.refresh, 'function')
      assert.equal(sans.w.µ.load.clear, undefined)
    })
  }
})
