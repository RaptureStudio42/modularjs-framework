// Les moments « réussite » et « échec » — `on: success`, `on: error` : un effet qui se joue (une fois,
// ou un tour pour un effet qui boucle, une transition posée directement) part à la fin de l'action de
// sa balise. L'action : une promesse rendue par un de ses gestionnaires (`@click={µsocket(url)
// .request(…)}`, une méthode qui rend une promesse, µ.optimistic) — réussie si elle tient sa parole et
// que sa valeur n'a pas `ok: false`, en échec sinon ; ou l'envoi du formulaire qui porte la balise (le
// formulaire lui-même, son bouton, un message dedans), réponse du serveur reçue ou non.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { extractMarked } from './helpers/extract-marked.js'
import { poserMessages } from './helpers/messages-stub.js'

const ICI      = dirname(fileURLToPath(import.meta.url))
const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output
const appels   = (js: string) => [...js.matchAll(/µ\._mjs_fx\(this, _mjs_fxn, "([a-z-]+)", (\{[^;]*?\})\);/g)].map(m => [m[1], JSON.parse(m[2])])

describe('réussite et échec — à la compilation', () => {
  it('un effet qui se joue, un effet qui boucle, une transition posée directement : on: success | error', async () => {
    const js = await compiler('<form action="/x" method="post" *shake(on: error)><button *confetti(on: success) *float(on: success)>ok</button><p *fade(on: success)>Merci</p></form>')
    assert.deepEqual(appels(js).sort(), [['confetti', { on: 'success' }], ['fade', { on: 'success' }], ['float', { on: 'success' }], ['shake', { on: 'error' }]])
  })

  it('un effet à état (allumé ou éteint) n\'a pas de moment : refusé, avec ce qui est permis', async () => {
    await assert.rejects(compiler('<p *neon(on: success)>x</p>'), /\*neon : on = success — permis : 'hover' \| 'view' \| 'click' \| 'always'/)
  })
})

describe('réussite et échec — la promesse d\'un gestionnaire', function () {
  this.timeout(60000)
  let window: any
  // une promesse rejetée reste une erreur non traitée, comme sans l'effet : on la laisse passer ici
  const avale = () => {}

  before(async () => {
    process.on('unhandledRejection', avale)
    const root   = mjsTmp('effets-reussite-echec')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-envoi.mjs'), '<script>\n$ok = true\n$recu = 0\n@envoyer = -> if $ok then Promise.resolve({ id: 1 }) else Promise.reject(new Error(\'refusé\'))\n@optimiste = -> Promise.resolve({ ok: false, error: { code: \'refus\' } })\n</script>\n<button class="b" *shake(on: success) @click={@envoyer()}>b</button>\n<button class="e" *shake(on: error) @click={@envoyer()}>e</button>\n<button class="o" *shake(on: error) @click={@optimiste()}>o</button>\n<button class="w" *float(on: success) @click={@envoyer()}>w</button>\n<button class="k" @click={$ok = false}>k</button>\n<button class="d" *shake(on: success) @click={@envoyer()} @mjs:success={(e) -> $recu = e.data.id}>d</button><b class="recu">{$recu}</b>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-fx-envoi></mjs-fx-envoi>'
    const comp = window.document.querySelector('mjs-fx-envoi')
    const fin = Date.now() + 3000
    while (!comp._shadow?.querySelector('.k') && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  })

  after(async () => {
    window?.close?.()
    process.off('unhandledRejection', avale)
    await terminateSharedWorkerPool()
  })

  const r      = () => window.document.querySelector('mjs-fx-envoi')._shadow
  const joue   = (el: any, nom: string) => (el.getAttribute('mjs-fx-play') ?? '').split(' ').includes(nom)
  const pause  = (ms = 30) => new Promise((res) => setTimeout(res, ms))
  // un tour d'un effet qui boucle : son animation relancée (la variable qui la coupe retirée), une fois
  const tourne = (el: any) => el.style.getPropertyValue('--mjs-fx-float-go') !== 'none'

  it('la promesse tient parole : on: success joue, on: error non', async () => {
    const b = r().querySelector('.b')
    assert.equal(joue(b, 'shake'), false)
    b.click()
    await pause()
    assert.equal(joue(b, 'shake'), true)
  })

  it('la valeur voyage avec l\'événement que reçoit la balise : @mjs:success={(e) -> …e.data…}', async () => {
    r().querySelector('.d').click()
    await pause()
    assert.equal(r().querySelector('.recu').textContent, '1')
  })

  it('un effet qui boucle fait un tour à la réussite', async () => {
    const w = r().querySelector('.w')
    assert.equal(tourne(w), false, 'au repos avant')
    w.click()
    await pause()
    assert.equal(tourne(w), true)
  })

  it('la promesse est rejetée : on: error joue', async () => {
    r().querySelector('.k').click()
    await pause()
    const e = r().querySelector('.e')
    e.click()
    await pause()
    assert.equal(joue(e, 'shake'), true)
  })

  it('une valeur ok: false (µ.optimistic refusé, réponse HTTP d\'erreur) : un échec', async () => {
    const o = r().querySelector('.o')
    o.click()
    await pause()
    assert.equal(joue(o, 'shake'), true)
  })
})

describe('réussite et échec — l\'envoi d\'un formulaire (UJS)', () => {
  const UJS_SRC = readFileSync(join(ICI, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')

  // l'envoi réel de µ._mjs_navDispatch, ses collaborateurs réseau et DOM factices : la réponse est
  // rendue à la main
  function envoyer() {
    const recus: string[] = []
    const form: any = { dispatchEvent(ev: any) { recus.push(ev.type); return true } }
    const win: any  = { location: { href: 'http://x/posts', origin: 'http://x' }, history: { pushState() {} } }
    const doc: any  = { getElementById: () => null }
    let reponse: any
    let refus: any
    const µ: any = {
      log() {}, warn() {}, error() {}, _mjs_navSeq: 0,
      _mjs_navEmitPaths: (u: string) => ({ path: u, url: u }), _mjs_navEmit: () => true,
      _mjs_navRequest: (_m: string, _u: string, _p: any, ok: any, ko: any) => { reponse = ok; refus = ko },
      _mjs_navReloadAsked: () => false, _mjs_navMethodOf: (m: any) => m || 'replace', _mjs_navDropHibernation() {},
      _mjs_fxTell: (el: any, ok: boolean) => el.dispatchEvent({ type: ok ? 'mjs:success' : 'mjs:error' }),
      pageCache: new Map(), _mjs_preloadCache: new Map(), _mjs_preloaded: new Set(),
      nav: { active: false, href: null },
    }
    class FD { append() {} get() { return null } }
    // une page réaffichée n'est pas analysée ici : l'envoi s'arrête là, l'échec déjà dit
    class DPArret { parseFromString(): any { throw new Error('arrêt du harnais') } }
    poserMessages(µ)
    new Function('µ', 'window', 'document', 'FormData', 'URL', 'DOMParser', 'URLSearchParams', extractMarked(UJS_SRC, '_mjs_navDispatch'))(µ, win, doc, FD, URL, DPArret, URLSearchParams)
    µ._mjs_navDispatch('http://x/posts', 'POST', new FD(), { el: form, form: form, restoreBusy() {} })
    return { recus, repondre: (...a: any[]) => reponse(...a), refuser: (e: any) => refus(e) }
  }

  it('le serveur accepte : mjs:success sur le formulaire', () => {
    const e = envoyer()
    e.repondre('', 'http://x/posts', undefined, { method: 'none' })
    assert.deepEqual(e.recus, ['mjs:success'])
  })

  it('le serveur refuse (422) ou ne répond pas : mjs:error, une seule fois', () => {
    const a = envoyer()
    a.refuser({ status: 422, body: { props: { errors: { nom: 'requis' } } } })
    assert.deepEqual(a.recus, ['mjs:error'])
    const b = envoyer()
    assert.throws(() => b.refuser({ status: 422, body: '<html><body>formulaire et ses erreurs</body></html>' }), /arrêt du harnais/)
    assert.deepEqual(b.recus, ['mjs:error'], 'la page d\'erreur réaffichée n\'est pas une réussite')
    const c = envoyer()
    c.refuser({})
    assert.deepEqual(c.recus, ['mjs:error'])
  })
})
