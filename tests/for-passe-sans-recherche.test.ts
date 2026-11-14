// {for … by id} d'une liste µraw déjà affichée : sa passe se fait sans recherche. Les entrées des lignes restent rangées dans l'ordre de la
// liste (aucun `Map.get` par ligne), et une ligne pure dont l'objet a déjà été vu µraw est sautée sans le rechercher (ni `WeakSet.has`, ni
// `µ._mjs_toRaw`). La première revue d'une ligne cherche la marque de son objet une fois, dans la passe même : aucun objet brut demandé, pas
// un appel de fonction de plus que les passes suivantes. Le travail se compte, épreuve par épreuve — modifier une ligne sur dix, échanger, retirer, déplacer, ajouter, insérer,
// tout remplacer : il suit le nombre de lignes qui changent, jamais la longueur de la liste. Puis un tirage : après chaque écriture,
// l'écran montre la liste, ligne à ligne, et un clic lit l'élément de sa ligne (une entrée rangée au mauvais rang montrerait celui d'une autre)

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

// la même liste, sans puis avec l'indice à l'écran (une ligne qui montre son indice se rejoue quand elle glisse)
const corps = (indice: boolean) => [
  '<script lang="js">',
  '  $data = µ.raw([]);',
  '  $selected = -1;',
  '  @poser = function(a) { $data = a; };',
  '  @select = function(id) { $selected = id; };',
  '</script>',
  '<table><tbody>',
  indice ? '  {for i, row in $data by id}' : '  {for row in $data by id}',
  '    <tr :class{$selected === row.id}="danger">',
  indice ? '      <td class="ix">{i}</td>' : '',
  '      <td class="id">{row.id}</td>',
  '      <td class="lab"><a class="sel" @click={@select(row.id)}>{row.label}</a></td>',
  '    </tr>',
  '  {end}',
  '</tbody></table>'
].join('\n')

const tic = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) }
const N   = 200

describe('{for … by id} — passe d\'une liste µraw sans recherche', function () {
  this.timeout(120000)
  let win: any, µ: any
  const els: Record<string, any> = {}
  const n = { get: 0, vu: 0, brut: 0, rejoue: 0 }
  let compte         = false
  let jeton          = 0
  let donnees: any[] = []
  let prochain       = 1

  before(async () => {
    const root   = mjsTmp('for-sans-recherche')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'passesans.mjs'), corps(false))
    writeFileSync(join(srcDir, 'passeindice.mjs'), corps(true))
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    win = new Window({ url: 'http://localhost/' })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    const code  = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
    win.eval(`${code}\nglobalThis.µ = µ;`)
    win.document.body.innerHTML = '<mjs-passesans></mjs-passesans><mjs-passeindice></mjs-passeindice>'
    els.sans   = win.document.body.children[0]
    els.indice = win.document.body.children[1]
    µ = win.µ
    await tic()
    // recherches comptées pendant la seule réconciliation : la marque µraw de l'objet d'une ligne cherchée (`WeakSet.has` ; celle de la liste
    // elle-même, lue une fois par passe, ne compte pas) et l'objet brut demandé (`µ._mjs_toRaw`)
    const marques = µ._mjs_rawSet
    const has     = marques.has
    marques.has   = function(x: any) { if (compte && !Array.isArray(x)) n.vu++; return has.call(this, x) }
    const brut    = µ._mjs_toRaw
    µ._mjs_toRaw  = function(x: any) { if (compte) n.brut++; return brut.call(this, x) }
    for (const el of Object.values(els)) {
      const rec = el._mjs_reconcileList
      el._mjs_reconcileList = function(...x: any[]) { compte = true; try { return rec.apply(this, x) } finally { compte = false } }
    }
  })
  after(async () => { win?.close?.(); await terminateSharedWorkerPool() })

  const ombre  = (el: any) => el._shadow || el.shadowRoot
  const ligne  = (label?: string) => { const id = prochain++; return µ.raw({ id, label: label ?? 'L' + id }) }
  const lignes = (nb: number) => Array.from({ length: nb }, () => ligne())
  const ecran  = (el: any) => Array.from(ombre(el).querySelectorAll('tbody > tr')).map((tr: any) => [+tr.querySelector('.id').textContent, tr.querySelector('.lab').textContent, tr.querySelector('.ix') ? +tr.querySelector('.ix').textContent : -1])

  // pose la liste et compte le travail de sa passe ; le cache de la liste et les lignes déjà là sont espionnés (lectures du cache par clé,
  // lignes qui se rejouent), puis l'écran est comparé à la liste : identifiant, libellé, et indice quand la ligne le montre
  async function operer(el: any, a: any[]) {
    jeton++
    const cid   = Object.keys(el._mjs_list_cache || {})[0]
    const cache = cid && el._mjs_list_cache[cid]
    if (cache) {
      if (!cache._espion) {
        const get  = cache.get
        cache.get  = function(k: any) { if (compte) n.get++; return get.call(this, k) }
        cache._espion = true
      }
      for (const en of cache.values()) {
        en._jeton = jeton
        if (en._mjs_updFn && !en._mjs_updFn._espion) {
          const f = en._mjs_updFn
          en._mjs_updFn = function(...x: any[]) { if (en._jeton === jeton) n.rejoue++; return f.apply(this, x) }
          en._mjs_updFn._espion = true
        }
      }
    }
    for (const k of Object.keys(n)) (n as any)[k] = 0
    donnees = a
    el.poser(µ.raw(a))
    await tic()
    const vus = new Set()
    const att = a.filter((d) => !vus.has(d.id) && vus.add(d.id))
    assert.deepEqual(ecran(el), att.map((d) => [d.id, d.label, el === els.indice ? a.indexOf(d) : -1]), 'l\'écran montre la liste')
    return { ...n }
  }
  const rien = (c: any, quoi: string) => assert.deepEqual([c.get, c.vu, c.brut], [0, 0, 0], quoi + ' — lectures du cache, marques cherchées, objets bruts demandés : ' + JSON.stringify(c))

  it('la liste créée, une ligne revue une première fois est notée : chaque passe suivante la saute sans rien chercher', async () => {
    await operer(els.sans, lignes(N))
    // première revue : la marque de chaque objet est cherchée une fois, dans la passe même (aucun objet brut demandé, aucune ligne rejouée)
    const p = await operer(els.sans, donnees.slice())
    assert.deepEqual([p.get, p.vu, p.brut, p.rejoue], [0, N, 0, 0], 'première revue : ' + JSON.stringify(p))
    const c = await operer(els.sans, donnees.slice())
    assert.ok(c.vu <= N && c.brut <= N, 'la marque de chaque objet est cherchée une fois au plus : ' + JSON.stringify(c))
    assert.equal(c.get, 0, 'aucune lecture du cache par clé : ' + JSON.stringify(c))
    for (let k = 0; k < 3; k++) {
      const d = await operer(els.sans, donnees.slice())
      rien(d, 'passe sans changement')
      assert.equal(d.rejoue, 0, 'aucune ligne ne se rejoue')
    }
  })

  it('première revue d\'une liste : aucune fonction n\'est appelée une fois par ligne de plus qu\'aux passes suivantes', async () => {
    const session = new Session()
    session.connect()
    await session.post('Profiler.enable')
    await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: false })
    // appels de fonctions du script de la page (le cœur et les composants, reconnu à sa passe des liaisons) pendant une écriture, par fonction
    const appels = async (a: any[]) => {
      await session.post('Profiler.takePreciseCoverage')
      await operer(els.sans, a)
      const { result } = await session.post('Profiler.takePreciseCoverage') as any
      const page = result.find((s: any) => s.functions.some((f: any) => f.functionName === '_mjs_updRows'))
      assert.ok(page, 'le script de la page est dans le relevé')
      const par = new Map<string, number>()
      for (const f of page.functions) if (f.ranges[0].count > 0) par.set(f.functionName || '(anonyme)', (par.get(f.functionName || '(anonyme)') || 0) + f.ranges[0].count)
      return par
    }
    try {
      await operer(els.sans, lignes(N))
      const premiere = await appels(donnees.slice())
      const suivante = await appels(donnees.slice())
      assert.ok((premiere.get('_mjs_updRows') || 0) >= 1 && (suivante.get('_mjs_updRows') || 0) >= 1, 'la passe des liaisons est dans les deux relevés')
      const enTrop   = [...premiere].filter(([k, nb]) => nb - (suivante.get(k) || 0) >= N).map(([k, nb]) => `${k} ${nb} / ${suivante.get(k) || 0}`)
      assert.deepEqual(enTrop, [], 'fonctions appelées une fois par ligne de plus à la première revue (première / suivante)')
    }
    finally {
      await session.post('Profiler.stopPreciseCoverage')
      session.disconnect()
    }
  })

  it('modifier une ligne sur dix : les seules lignes changées se rejouent, rien n\'est cherché pour les autres', async () => {
    const a = donnees.map((d, i) => i % 10 === 0 ? µ.raw({ id: d.id, label: d.label + ' !' }) : d)
    const c = await operer(els.sans, a)
    rien(c, 'modifier une sur dix')
    assert.equal(c.rejoue, N / 10, 'lignes rejouées')
    // les lignes changées, revues à la passe suivante, sont notées à leur tour, et elles seules
    const d = await operer(els.sans, donnees.slice())
    assert.deepEqual([d.get, d.vu, d.brut, d.rejoue], [0, N / 10, 0, 0], 'passe suivante : ' + JSON.stringify(d))
    rien(await operer(els.sans, donnees.slice()), 'passe d\'après')
  })

  it('échanger, déplacer, retirer : aucune recherche, quelle que soit la longueur de la liste', async () => {
    let a = donnees.slice(); [a[1], a[N - 2]] = [a[N - 2], a[1]]
    let c = await operer(els.sans, a)
    rien(c, 'échanger deux lignes éloignées')
    assert.equal(c.rejoue, 0, 'les lignes échangées ne se rejouent pas')
    a = donnees.slice(); a.splice(150, 0, a.splice(7, 1)[0])
    rien(await operer(els.sans, a), 'déplacer une ligne vers le bas')
    a = donnees.slice(); a.splice(12, 0, a.splice(170, 1)[0])
    rien(await operer(els.sans, a), 'déplacer une ligne vers le haut')
    a = donnees.slice(); a.splice(3, 1)
    c = await operer(els.sans, a)
    rien(c, 'retirer une ligne')
    assert.equal(c.rejoue, 0, 'les lignes qui glissent ne se rejouent pas')
    rien(await operer(els.sans, donnees.slice()), 'passe d\'après')
  })

  it('ajouter en fin, insérer au milieu, tout remplacer : aucune lecture du cache par clé', async () => {
    let c = await operer(els.sans, donnees.concat(lignes(10)))
    rien(c, 'ajouter dix lignes en fin')
    // les lignes neuves, revues une première fois à la passe suivante, sont notées à leur tour, et elles seules
    c = await operer(els.sans, donnees.slice())
    assert.deepEqual([c.get, c.vu, c.brut], [0, 10, 0], 'passe d\'après l\'ajout : ' + JSON.stringify(c))
    const a = donnees.slice(); a.splice(40, 0, ...lignes(5))
    rien(await operer(els.sans, a), 'insérer cinq lignes au milieu')
    c = await operer(els.sans, donnees.slice())
    assert.deepEqual([c.get, c.vu, c.brut], [0, 5, 0], 'passe d\'après l\'insertion : ' + JSON.stringify(c))
    c = await operer(els.sans, lignes(donnees.length))
    assert.equal(c.get, 0, 'tout remplacer : chaque ancienne ligne est lue dans l\'ordre, pas par sa clé : ' + JSON.stringify(c))
    await operer(els.sans, donnees.slice())
    rien(await operer(els.sans, donnees.slice()), 'les lignes reprises, notées à leur tour')
  })

  it('une ligne notée qui reçoit un objet ordinaire perd sa note : modifié sur place, il se relit à chaque passe', async () => {
    const a = donnees.slice()
    const o = { id: a[3].id, label: 'ordinaire' }
    a[3]    = o
    let c   = await operer(els.sans, a)
    assert.equal(c.rejoue, 1, 'la ligne qui change d\'objet se rejoue : ' + JSON.stringify(c))
    o.label = 'modifié sur place'
    c       = await operer(els.sans, a.slice())
    assert.deepEqual([c.get, c.vu, c.brut, c.rejoue], [0, 1, 0, 1], 'l\'objet ordinaire, jamais noté, se relit : ' + JSON.stringify(c))
    // un objet µraw remis à sa place : rejoué, noté à la passe suivante, puis sauté sans rien chercher
    a[3] = µ.raw({ id: o.id, label: 'brut' })
    await operer(els.sans, a.slice())
    c = await operer(els.sans, a.slice())
    assert.deepEqual([c.get, c.vu, c.brut, c.rejoue], [0, 1, 0, 0], 'l\'objet µraw, noté à son tour : ' + JSON.stringify(c))
    rien(await operer(els.sans, a.slice()), 'passe d\'après')
  })

  it('une ligne qui montre son indice se rejoue quand elle glisse, sans que rien soit cherché', async () => {
    const el = els.indice
    await operer(el, lignes(30))
    await operer(el, donnees.slice())
    await operer(el, donnees.slice())
    rien(await operer(el, donnees.slice()), 'passe sans changement')
    const a = donnees.slice(); a.splice(4, 1)
    const c = await operer(el, a)
    rien(c, 'retirer une ligne')
    assert.equal(c.rejoue, 25, 'les lignes qui glissent se rejouent : leur indice change')
  })

  // générateur à graine : le tirage se rejoue à l'identique
  const hasard = (graine: number) => () => { graine = (graine * 1103515245 + 12345) & 0x7fffffff; return graine / 0x7fffffff }

  for (const nom of ['sans', 'indice']) {
    it(`tirage, liste ${nom === 'sans' ? 'sans' : 'avec'} indice : après chaque écriture l'écran montre la liste, et un clic lit l'élément de sa ligne`, async () => {
      const el = els[nom]
      for (const graine of [7, 31, 2026]) {
        const r   = hasard(graine)
        const au  = (max: number) => Math.floor(r() * max)
        await operer(el, lignes(12))
        for (let tour = 0; tour < 60; tour++) {
          let a    = donnees.slice()
          const g  = au(13)
          const nb = a.length
          if (g === 0 && nb > 1) { const i = au(nb), j = au(nb); [a[i], a[j]] = [a[j], a[i]] }
          else if (g === 1 && nb > 1) a.splice(au(nb), 0, a.splice(au(nb), 1)[0])
          else if (g === 2 && nb) a.splice(au(nb), 1 + au(3))
          else if (g === 3) a.splice(au(nb + 1), 0, ...lignes(1 + au(4)))
          else if (g === 4) a = a.concat(lignes(1 + au(5)))
          else if (g === 5) a = a.map((d) => r() < 0.3 ? µ.raw({ id: d.id, label: d.label + '+' }) : d)
          else if (g === 6) a.reverse()
          else if (g === 7 && nb) a.push(a.shift())
          else if (g === 8) a.sort(() => r() - 0.5)
          else if (g === 9) a = lignes(1 + au(15))
          else if (g === 10) a = r() < 0.5 ? [] : a.slice(0, au(nb + 1))
          // ajouts et retraits mêlés dans la même écriture, puis une clé en double (seule la première occurrence est montrée)
          else if (g === 11 && nb > 2) { a.splice(au(nb), 1); a.splice(au(a.length), 0, ligne()); a.splice(au(a.length), 1); a.push(ligne()) }
          else if (g === 12 && nb) a.splice(au(nb + 1), 0, µ.raw({ id: a[au(nb)].id, label: 'double' }))
          await operer(el, a)
          if (donnees.length) {
            const vus  = new Set()
            const att  = donnees.filter((d) => !vus.has(d.id) && vus.add(d.id))
            const rang = au(att.length)
            ombre(el).querySelectorAll('tbody > tr')[rang].querySelector('a.sel').click()
            await tic()
            assert.equal(el._state.selected, att[rang].id, `graine ${graine}, tour ${tour} : le clic lit l'élément de sa ligne`)
            assert.equal(ombre(el).querySelectorAll('tr.danger').length, 1, `graine ${graine}, tour ${tour} : une seule ligne choisie`)
          }
        }
        await operer(el, [])
      }
    })
  }
})
