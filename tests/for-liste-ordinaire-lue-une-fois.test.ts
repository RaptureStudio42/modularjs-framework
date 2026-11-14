// {for … by id} d'une liste ordinaire (objets de l'état, sous leur enveloppe) : chaque élément se lit une fois par passe, par l'enveloppe
// de la liste, et le reste de la passe relit ce qu'elle a lu. Le travail se compte en appels de fonctions du script de la page (1 000 lignes :
// modifier une sur dix, échanger, retirer, ajouter), sans aucun temps. Puis ce que la passe voit quand lire un élément a un effet (accesseur
// de la liste, `Proxy` de la page, élément d'une liste du magasin), quand la liste change pendant la passe (attache d'une ligne, µeffect),
// et quand un élément est remplacé pendant la lecture des clés : l'écran est le même qu'avant cette passe plus courte. MJS_OBS=<fichier> : les
// observations y sont écrites en JSON

import assert from 'node:assert/strict'
import { Session } from 'node:inspector/promises'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const SCRIPT = `<script lang="js">
  $rows = [];
  @poser = function(a) { $rows = a; };
  @muter = function(f) { return f($rows); };
  @grow  = function(n, r) { if (r.id === 2 && $rows.length < 4) $rows.push({ id: 90 + $rows.length, label: 'g' }); };
  µeffect(() => { if ($rows.length === 5 && $rows[0].label === 'e') $rows.push({ id: 80, label: 'f' }); });
</script>
`
const SOURCES: Record<string, string> = {
  'ord-simple.mjs':  SCRIPT + '<ul>{for r in $rows by id}<li><span class="lab">{r.label}</span><i>{r.n}</i></li>{end}</ul>\n',
  'ord-attache.mjs': SCRIPT + '<ul>{for r in $rows by id}<li :attach={@grow(_node, r)}><span class="lab">{r.label}</span></li>{end}</ul>\n',
  'ord-magasin.mjs': '<script lang="js">\n  $$liste = [];\n</script>\n<ul>{for r in $$liste by id}<li><span class="lab">{r.label}</span></li>{end}</ul>\n'
}
const tic   = async () => { for (let k = 0; k < 3; k++) await new Promise((r) => setTimeout(r, 0)) }
const N     = 1000
// appels de fonctions du script de la page, au plus, par épreuve (1 000 lignes, liste ordinaire)
const BORNES: Record<string, number> = { 'modifier une sur dix': 11000, 'échanger': 9000, 'retirer': 30000, 'ajouter 1000': 40000 }

describe('{for … by id} — liste ordinaire : chaque élément lu une fois par passe', function () {
  this.timeout(120000)
  let win: any, µ: any
  const els: Record<string, any> = {}
  const obs: Record<string, unknown> = {}

  before(async () => {
    const root   = mjsTmp('for-ordinaire-une-fois')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    win = new Window({ url: 'http://localhost/' })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    const code  = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = '<mjs-ord-simple></mjs-ord-simple><mjs-ord-attache></mjs-ord-attache><mjs-ord-magasin></mjs-ord-magasin>'
    els.simple  = win.document.body.children[0]
    els.attache = win.document.body.children[1]
    els.magasin = win.document.body.children[2]
    µ = win.µ
    await tic()
  })
  after(async () => {
    if (process.env.MJS_OBS) writeFileSync(process.env.MJS_OBS, JSON.stringify(obs, null, 1) + '\n')
    win?.close?.()
    await terminateSharedWorkerPool()
  })

  const ombre = (el: any) => el._shadow || el.shadowRoot
  const ecran = (el: any) => Array.from(ombre(el).querySelectorAll('li .lab')).map((s: any) => s.textContent).join(' ')
  const rows  = (nb: number, de = 1) => Array.from({ length: nb }, (_, i) => ({ id: de + i, label: 'L' + (de + i), n: i }))

  it('1 000 lignes : modifier une sur dix, échanger, retirer, ajouter — appels de fonctions bornés', async () => {
    const session = new Session()
    session.connect()
    await session.post('Profiler.enable')
    await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: false })
    const appels = async (geste: () => void) => {
      await session.post('Profiler.takePreciseCoverage')
      geste()
      await tic()
      const { result } = await session.post('Profiler.takePreciseCoverage') as any
      const page = result.find((s: any) => s.functions.some((f: any) => f.functionName === '_mjs_updRows'))
      assert.ok(page, 'le script de la page est dans le relevé')
      return page.functions.reduce((m: number, f: any) => m + f.ranges[0].count, 0)
    }
    try {
      const el = els.simple
      await appels(() => el.poser(rows(N)))
      const vu: Record<string, number> = {}
      vu['modifier une sur dix'] = await appels(() => el.muter((x: any[]) => { for (let i = 0; i < x.length; i += 10) x[i].label += ' !' }))
      // seconde passe de la même épreuve : comptée pour les observations
      obs.modifierDeuxieme       = await appels(() => el.muter((x: any[]) => { for (let i = 0; i < x.length; i += 10) x[i].label += ' !' }))
      vu['échanger']             = await appels(() => el.muter((x: any[]) => { const t = x[1]; x[1] = x[998]; x[998] = t }))
      vu['retirer']              = await appels(() => el.muter((x: any[]) => { x.splice(3, 1) }))
      vu['ajouter 1000']         = await appels(() => el.muter((x: any[]) => { x.push(...rows(N, 5000)) }))
      obs.appels = vu
      assert.equal(ombre(el).querySelectorAll('li').length, 2 * N - 1, 'l\'écran montre toutes les lignes')
      for (const [k, nb] of Object.entries(vu)) assert.ok(nb <= BORNES[k], `${k} : ${nb} appels, ${BORNES[k]} au plus`)
    }
    finally {
      await session.post('Profiler.stopPreciseCoverage')
      session.disconnect()
    }
  })

  it('lire un élément a un effet : accesseur de la liste, `Proxy` de la page — l\'écran suit la liste', async () => {
    const el = els.simple
    el.poser([{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }])
    await tic()
    let lu = 0
    el.muter((x: any) => {
      const b = { id: 2, label: 'B' }
      Object.defineProperty(x, 1, { get() { lu++; return b }, configurable: true, enumerable: true })
    })
    await tic()
    obs.accesseur = ecran(el)
    obs.accesseurLu = lu > 0
    const cible = { id: 4, label: 'p' }
    const page  = new (win.eval('Proxy'))(cible, { get(t: any, k: any) { return k === 'label' ? t.label.toUpperCase() : t[k] } })
    el.muter((x: any) => { x.push(page) })
    await tic()
    obs.proxyDeLaPage = ecran(el)
    assert.deepEqual([obs.accesseur, obs.accesseurLu, obs.proxyDeLaPage], ['a B c', true, 'a B c P'])
  })

  it('élément d\'une liste du magasin écrit hors d\'un composant : la liste lue comme avant', async () => {
    const el = els.magasin
    µ.store.liste = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }]
    await tic()
    µ.store.liste[1].label = 'B'
    await tic()
    obs.magasin = ecran(el)
    assert.equal(obs.magasin, 'a b')
  })

  it('la liste change pendant la passe : attache d\'une ligne, µeffect — l\'écran est celui d\'avant le changement', async () => {
    const el = els.attache
    el.poser([{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }])
    await tic()
    obs.attache = ecran(el)
    el.poser([{ id: 1, label: 'e' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }, { id: 4, label: 'd' }, { id: 5, label: 'x' }])
    await tic()
    obs.effet = ecran(el)
    assert.deepEqual([obs.attache, obs.effet], ['a b c', 'e b c d x f'])
  })

  it('un élément remplacé pendant la lecture des clés : la passe montre l\'élément neuf, comme avant', async () => {
    const el = els.simple
    const autre = { id: 2, label: 'neuf' }
    let fait = false
    el.poser([{ id: 1, label: 'a' }, { id: 2, label: 'b' }])
    await tic()
    el.muter((x: any) => {
      const r = { label: 'b2' }
      Object.defineProperty(r, 'id', { get() { if (!fait) { fait = true; x[1] = autre } return 2 }, enumerable: true })
      x[1] = r
    })
    await tic()
    obs.remplace = ecran(el)
    el.muter((x: any) => { x[0].label = 'A' })
    await tic()
    obs.remplaceEnsuite = ecran(el)
    assert.deepEqual([obs.remplace, obs.remplaceEnsuite], ['a neuf', 'A neuf'])
  })
})
