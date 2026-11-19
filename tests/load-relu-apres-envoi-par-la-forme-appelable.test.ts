// un envoi réussi par la forme appelable (`µajax url, method: 'POST'`, celle du chapitre des types) relit les adresses lues par `µload`
// sous son chemin, comme `µ.ajax.post` ; un GET par la même forme, ou un envoi en erreur, ne relit rien
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
  @renommer = -> µajax '/api/me', method: 'POST', data: { pseudo: 'Zoé' }
  @corriger = -> µajax '/api/me', method: 'patch', data: { pseudo: 'Zoé' }
  @lire     = -> µajax '/api/me/avatar'
</script>
<p class="nom">{$me.data?.pseudo}</p>
`

async function monter(prefixe: string): Promise<any> {
  const root = mjsTmp(prefixe)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'moi.mjs'), MOI)
  const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(join(root, 'out')).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const code  = ordre.map((f) => stripEsm(readFileSync(join(root, 'out', f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(RESEAU + code + '\nglobalThis.µ = µ;')
  window.µ.ajax.error = () => null
  window.document.body.innerHTML = '<mjs-moi></mjs-moi>'
  await pause(150)
  return window
}

// les requêtes vues pour `GET /api/me`, et la réponse donnée à la première qui attend encore
const requetes = (w: any, motif: string) => w.__req.filter((r: any) => (r.method + ' ' + r.url.replace('http://localhost', '')) === motif)
async function repondre(w: any, motif: string, status: number, body: any) {
  const r = requetes(w, motif).filter((x: any) => !x.repondue && !x.aborted)[0]
  assert.ok(r, 'aucune requête ouverte ' + motif + ' — vues : ' + w.__req.map((x: any) => x.method + ' ' + x.url).join(', '))
  r.repondue = true
  r.reply(status, body)
  await pause(60)
}

describe('µload — relu après un envoi par la forme appelable de µajax', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('µajax url, method: \'POST\' réussi relit l\'adresse lue, et la page montre la donnée relue', async () => {
    const w  = await monter('load-appel-post')
    const el = w.document.querySelector('mjs-moi')
    await repondre(w, 'GET /api/me', 200, { pseudo: 'Ada' })
    el.renommer()
    await repondre(w, 'POST /api/me', 200, {})
    assert.equal(requetes(w, 'GET /api/me').length, 2, 'POST /api/me par µajax ne relit pas /api/me')
    await repondre(w, 'GET /api/me', 200, { pseudo: 'Zoé' })
    assert.equal(el._shadow.querySelector('.nom').textContent.trim(), 'Zoé')
  })

  it('une méthode écrite en minuscules (method: \'patch\') relit de même', async () => {
    const w  = await monter('load-appel-patch')
    const el = w.document.querySelector('mjs-moi')
    await repondre(w, 'GET /api/me', 200, { pseudo: 'Ada' })
    el.corriger()
    const envoi = w.__req.find((r: any) => r.method.toUpperCase() === 'PATCH')
    assert.ok(envoi, 'aucun envoi PATCH vu')
    envoi.repondue = true
    envoi.reply(200, {})
    await pause(60)
    assert.equal(requetes(w, 'GET /api/me').length, 2)
  })

  it('un envoi en erreur et un GET par la même forme ne relisent rien', async () => {
    const w  = await monter('load-appel-sans')
    const el = w.document.querySelector('mjs-moi')
    await repondre(w, 'GET /api/me', 200, { pseudo: 'Ada' })
    el.renommer()
    await repondre(w, 'POST /api/me', 500, { error: 'non' })
    el.lire()
    await repondre(w, 'GET /api/me/avatar', 200, {})
    assert.equal(requetes(w, 'GET /api/me').length, 1)
    assert.equal(el._shadow.querySelector('.nom').textContent.trim(), 'Ada')
  })

  it('témoin : le même envoi par µ.ajax.post relit', async () => {
    const w = await monter('load-appel-temoin')
    await repondre(w, 'GET /api/me', 200, { pseudo: 'Ada' })
    w.µ.ajax.post('/api/me', { pseudo: 'Zoé' })
    await repondre(w, 'POST /api/me', 200, {})
    assert.equal(requetes(w, 'GET /api/me').length, 2)
  })
})
