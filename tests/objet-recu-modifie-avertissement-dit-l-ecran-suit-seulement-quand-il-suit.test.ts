// l'avertissement « modifie un objet reçu » ne dit « l'écran suit » que quand l'écran du parent suit vraiment : le parent tient l'objet
// lui-même, ou le lit par un `µ.state` ou un `µ.Store` qui le tient. Sinon il dit que le parent n'en est pas prévenu : une ligne du magasin
// `$$` (lue directement, dans une boucle, ou par une variable `$rows = $$liste`), un objet lu à travers un objet gelé, un objet brut. Sans
// l'enveloppe (`proxy: false`), aucun parent ne suit et il le dit toujours, avec la façon de faire ; en production, rien n'est dit et
// l'écran fait la même chose qu'en développement. Le message est comparé mot pour mot, fin comprise
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { mjsTmp } from './helpers/tmp.js'

const tic = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
const js  = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')

// l'enfant écrit l'objet reçu ; chaque parent le lui passe d'une autre façon
const SOURCES: Record<string, string> = {
  'zc-ec':      js(['$item = null;', '@ecrire = function(v) { $item.n = v; };'], "<em>{$item ? $item.n : 'nul'}</em>"),
  'zc-tient':   js(["$o = { a: { n: 'a' } };"], '<b>{$o.a.n}</b><@zc-ec item={$o.a}></@zc-ec>'),
  'zc-etat':    js(["const st = window.__zcSt ||= µ.state({ o: { n: 'a' } });"], '<b>{st.o.n}</b><@zc-ec item={st.o}></@zc-ec>'),
  'zc-magasin': js(["const s = window.__zcMa ||= new µ.Store({ o: { n: 'a' } });"], '<b>{s.data.o.n}</b><@zc-ec item={s.data.o}></@zc-ec>'),
  'zc-stock':   js(["$$zcs = [{ n: 'a' }];"], '<b>{$$zcs[0].n}</b><@zc-ec item={$$zcs[0]}></@zc-ec>'),
  'zc-lect':    js(["$$zcl = [{ id: 1, n: 'a' }];"], '{for t in $$zcl by id}<@zc-ec item={t}></@zc-ec><i>{t.n}</i>{end}'),
  'zc-lect2':   js(["$$zcl2 = [{ id: 1, n: 'a' }];", '$rows = $$zcl2;'], '{for t in $rows by id}<@zc-ec item={t}></@zc-ec><i>{t.n}</i>{end}'),
  'zc-lect3':   js(["$$zcl3 = [{ id: 1, n: 'a' }];"], '{for t in $$zcl3}<@zc-ec item={t}></@zc-ec><i>{t.n}</i>{end}'),
  'zc-gel':     js(["$o = { f: Object.freeze({ inner: { n: 'a' } }) };"], '<b>{$o.f.inner.n}</b><@zc-ec item={$o.f.inner}></@zc-ec>'),
  'zc-gel2':    js(["$o = { a: Object.freeze({ n: 'a', x: { n: 'a' } }) };"], '<b>{$o.a.x.n}</b><@zc-ec item={$o.a.x}></@zc-ec>'),
  'zc-gel3':    js(["$o = Object.freeze({ inner: { n: 'a' } });"], '<b>{$o.inner.n}</b><@zc-ec item={$o.inner}></@zc-ec>'),
  'zc-brut':    js(["const P = window.__zcP ||= { n: 'a' };"], '<b>{P.n}</b><@zc-ec item={P}></@zc-ec>'),
}
// l'écran, parent puis enfant entre accolades, après l'écriture de « E » par l'enfant, avec l'enveloppe : les trois premiers parents suivent
const APRES: Record<string, string> = {
  'zc-tient': 'E { E }', 'zc-etat': 'E { E }', 'zc-magasin': 'E { E }',
  'zc-stock': 'a { E }', 'zc-lect': '{ E } a', 'zc-lect2': '{ E } a', 'zc-lect3': '{ E } a',
  'zc-gel': 'a { E }', 'zc-gel2': 'a { E }', 'zc-gel3': 'a { E }', 'zc-brut': 'a { E }',
}
const SUIT = ['zc-tient', 'zc-etat', 'zc-magasin']

const ombre = (el: any) => el._shadow || el.shadowRoot || el
const vue   = (el: any) => {
  const out: string[] = []
  const walk = (n: any) => {
    for (const c of Array.from(n.childNodes) as any[]) {
      if (c.nodeType === 3) {
        const t = String(c.textContent).trim()
        if (t) out.push(t)
      }
      else if (c.nodeType === 1) {
        if (c._shadow || c.shadowRoot) {
          out.push('{')
          walk(ombre(c))
          out.push('}')
        }
        else walk(c)
      }
    }
  }
  walk(ombre(el))
  return out.join(' ')
}
// le texte du dictionnaire, rempli pour l'enfant `@zc-ec` et le parent `parent`
const texte = (cle: string, parent: string) => '[ModularJS] ' + (RUNTIME_LABELS as any).fr.dev[cle].replace(/\{(\w+)\}/g, (m: string, n: string) => ({ tag: '@zc-ec', parent: '@' + parent, prop: 'item' } as Record<string, string>)[n] ?? m)

const batir = async (opts: any) => {
  const root = mjsTmp('avis-ecran-suit'), src = join(root, 'src'), out = join(root, 'out')
  mkdirSync(src, { recursive: true })
  for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(src, f + '.mjs'), s)
  const b  = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(root, 'bundle.js'), minify: false, ...opts } as any)
  const st = await b.compile()
  await b.close()
  assert.deepEqual(st.errors.map((e: any) => e.message), [], 'la construction réussit')
  const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  return readdirSync(out).filter((f) => f.endsWith('.js')).sort((a, c) => rang(a) - rang(c)).map((f) => stripEsm(readFileSync(join(out, f), 'utf-8'))).join('\n')
}
const fenetres: any[] = []
const monter = async (code: string, balise: string) => {
  const win: any = new Window({ url: 'http://localhost/' })
  fenetres.push(win)
  const erreurs: string[] = []
  win.addEventListener('error', (e: any) => erreurs.push(String(e.message || e.error)))
  win.eval(`${code}\nglobalThis.µ = µ;`)
  const avis: string[] = []
  win.µ.warn  = (...a: any[]) => { avis.push(String(a[0])) }
  win.µ.error = (...a: any[]) => { erreurs.push(a.map(String).join(' ')) }
  win.document.body.insertAdjacentHTML('beforeend', `<mjs-${balise}></mjs-${balise}>`)
  await tic()
  return { el: win.document.querySelector('mjs-' + balise), avis, erreurs }
}

for (const [mode, opts] of [['développement', {}], ['production', { env: 'prod' }], ['développement sans enveloppe', { proxy: false }]] as Array<[string, any]>) {
  describe(`objet reçu modifié : l'avertissement dit « l'écran suit » seulement quand l'écran du parent suit (${mode})`, function () {
    this.timeout(240000)
    let code = ''
    before(async () => { code = await batir(opts) })
    after(async () => {
      for (const w of fenetres.splice(0)) w.close?.()
      await terminateSharedWorkerPool()
    })
    for (const parent of Object.keys(APRES)) {
      const suit    = SUIT.includes(parent) && opts.proxy !== false
      const attendu = opts.env === 'prod' ? [] : [texte(opts.proxy === false ? 'propMutatedNoProxy' : suit ? 'propMutated' : 'propMutatedUnseen', parent)]
      const ecran   = opts.proxy === false ? APRES[parent].replace(/^E /, 'a ') : APRES[parent]
      it(`<@${parent}> : écran « ${ecran} », ${opts.env === 'prod' ? 'rien n\'est dit' : suit ? 'l\'avertissement dit que l\'écran suit' : 'l\'avertissement dit que le parent n\'en est pas prévenu'}`, async () => {
        const { el, avis, erreurs } = await monter(code, parent)
        const enfant = (Array.from(ombre(el).querySelectorAll('*')) as any[]).find((c) => c.tagName === 'MJS-ZC-EC')
        assert.ok(enfant, 'l\'enfant est dans la page')
        enfant.ecrire('E')
        await tic(20)
        assert.equal(vue(el), ecran, 'ce que montre l\'écran')
        assert.deepEqual(avis.filter((a) => / par sa prop « /.test(a)), attendu, 'l\'avertissement, mot pour mot')
        assert.deepEqual(erreurs, [], 'aucune erreur')
      })
    }
  })
}
