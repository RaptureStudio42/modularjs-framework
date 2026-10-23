// `<@@sortable>` avec un vrai `*crossfade(key: …)` posé par l'appli sur les lignes : une ligne qui change de liste vole de sa place de départ à sa place
// d'arrivée (au clavier, à la souris, au doigt, ou par un bouton de l'appli qui réécrit les listes liées) ; une seule ligne se voit à chaque image
// (pas de double, pas de clignotement de la ligne tenue au lâcher), la ligne ne saute pas, les voisines ne sautent pas ; « réduire les animations »
// coupe le vol ; un réordre dans une même liste ne fait voler personne. Les images sont relevées APRÈS la peinture de chaque image.
// Vrais clics, vraies touches, vrai navigateur : Chromium et Firefox, build de développement et build de production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const STYLE = `<style>
  :host
    display: block
  .cols
    display: flex
    gap: 60px
  .la
    width: 220px
  .lb
    width: 220px
  .groupe
    box-sizing: border-box
    margin-bottom: 6px
    padding: 4px 8px
    border: 1px solid #666
    background: #eef
  .titre
    height: 28px
    margin: 0
    font-size: 14px
    line-height: 28px
  .lignes
    min-height: 24px
    padding-left: 24px
  .cadre
    position: relative
    box-sizing: border-box
    height: 360px
    overflow-y: auto
    border: 1px solid #999
  .ligne
    box-sizing: border-box
    height: 40px
    margin-bottom: 6px
    padding: 0 10px
    border: 1px solid #999
    background: #fff
    line-height: 38px
</style>`

const ligne = (en = '', reglage = '') => `<div class="ligne" data-id={et.id} @transition=*crossfade(key: et.id${reglage})${en}><span class="t">{et.titre}</span></div>`

const A3 = '[{ id: 1, titre: \'A1\' }, { id: 2, titre: \'A2\' }, { id: 3, titre: \'A3\' }]'
const B2 = '[{ id: 4, titre: \'B1\' }, { id: 5, titre: \'B2\' }]'
const S5 = '[{ id: 1, titre: \'S1\' }, { id: 2, titre: \'S2\' }, { id: 3, titre: \'S3\' }, { id: 4, titre: \'S4\' }, { id: 5, titre: \'S5\' }]'
const liste = (de: number, n: number, p: string) => '[' + Array.from({ length: n }, (_, i) => `{ id: ${de + i}, titre: '${p}${i + 1}' }`).join(', ') + ']'
const MENU = '[{ id: \'e1\', nom: \'Pain\' }, { id: \'m1\', sec: true, nom: \'Entrées\', lignes: [{ id: \'l11\', nom: \'Soupe\' }, { id: \'l12\', nom: \'Salade\' }] }, { id: \'m2\', sec: true, nom: \'Plats\', lignes: [{ id: \'l21\', nom: \'Pâtes\' }, { id: \'l22\', nom: \'Riz\' }, { id: \'l23\', nom: \'Poulet\' }] }, { id: \'m3\', sec: true, nom: \'Desserts\', lignes: [] }]'

// deux listes d'un même groupe, deux boutons de l'appli qui réécrivent les listes liées (la 1re de A en 2e place de B, la 1re de B en 2e place de A)
const deuxListes = (en: string, reglage = '') => `<script>
  $a = ${A3}
  $b = ${B2}
  $sorts = 0
  ids = (l)-> l.map((x)-> x.id).join(',')
  versB = ->
    item = $a[0]
    $a = $a.slice(1)
    $b = [$b[0], item].concat($b.slice(1))
  versA = ->
    item = $b[0]
    $b = $b.slice(1)
    $a = [$a[0]].concat([item], $a.slice(1))
</script>
<div class="cols">
  <@@sortable class="la" value=!{$a} group="g" @sort={$sorts++}>
    {for et in $a by id}
      ${ligne(en, reglage)}
    {end}
  </@@sortable>
  <@@sortable class="lb" value=!{$b} group="g" @sort={$sorts++}>
    {for et in $b by id}
      ${ligne(en, reglage)}
    {end}
  </@@sortable>
</div>
<button class="ab" @click={versB()}>A vers B</button>
<button class="ba" @click={versA()}>B vers A</button>
<p class="ordre">{ids($a)}|{ids($b)}</p>
<p class="sorts">{$sorts}</p>
${STYLE}
`

const SOURCES_GROUPES: Record<string, string> = {
  'fa-page.mjs': deuxListes(''),
  'ff-page.mjs': deuxListes(' @flip=200'),
  'fd-page.mjs': deuxListes('', ', duration: 1500ms'),
  'fc-page.mjs': `<script>
  $a = ${liste(1, 12, 'A')}
  $b = ${liste(21, 12, 'B')}
  $sorts = 0
  ids = (l)-> l.map((x)-> x.id).join(',')
</script>
<div class="cadre">
  <div class="cols">
    <@@sortable class="la" value=!{$a} group="g" @sort={$sorts++}>
      {for et in $a by id}
        ${ligne()}
      {end}
    </@@sortable>
    <@@sortable class="lb" value=!{$b} group="g" @sort={$sorts++}>
      {for et in $b by id}
        ${ligne()}
      {end}
    </@@sortable>
  </div>
</div>
<p class="ordre">{ids($a)}|{ids($b)}</p>
<p class="sorts">{$sorts}</p>
${STYLE}
`,
  'fo-page.mjs': deuxListes('', '').replace(/@transition=\*crossfade\(key: et\.id\)/g, '@out=*fade'),
  'fn-page.mjs': `<script>
  $menu = ${MENU}
  $sorts = 0
  layout = (l)-> l.map((x)-> if x.sec then x.id + ':' + x.lignes.map((y)-> y.id).join(',') else x.id).join(' ')
</script>
<@@sortable class="menu" value=!{$menu} group="menu" @sort={$sorts++}>
  {for d in $menu by id}
    {if d.sec}
      <section class="groupe" data-id={d.id}>
        <h3 class="titre">{d.nom}</h3>
        <@@sortable class="lignes" data-id={d.id} value=!{d.lignes} group="menu" @sort.propagate={$sorts++}>
          {for l in d.lignes by id}
            <div class="ligne" data-id={l.id} @transition=*crossfade(key: l.id)><span class="t">{l.nom}</span></div>
          {end}
        </@@sortable>
      </section>
    {else}
      <div class="ligne solo" data-id={d.id}><span class="t">{d.nom}</span></div>
    {end}
  {end}
</@@sortable>
<p class="ordre">{layout($menu)}</p>
<p class="sorts">{$sorts}</p>
${STYLE}
`
}

// une seule liste, sans `group` : le fondu sur les lignes ne change rien à un réordre (la clé reconnaît la ligne, elle ne sort pas)
const SOURCES_SIMPLE: Record<string, string> = {
  'fs-page.mjs': `<script>
  $a = ${S5}
  $sorts = 0
  ids = (l)-> l.map((x)-> x.id).join(',')
  remonte = ->
    $a = [$a[3]].concat($a.slice(0, 3), $a.slice(4))
</script>
<@@sortable class="la" value=!{$a} @sort={$sorts++}>
  {for et in $a by id}
    ${ligne('')}
  {end}
</@@sortable>
<button class="monte" @click={remonte()}>monte</button>
<p class="ordre">{ids($a)}</p>
<p class="sorts">{$sorts}</p>
${STYLE}
`
}

type Build = { root: string, script: string }

async function construire(prod: boolean, nom: string, sources: Record<string, string>): Promise<Build> {
  const root   = mjsTmp(`sortable-fondu-${nom}-` + (prod ? 'prod' : 'dev'))
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [n, source] of Object.entries(sources)) writeFileSync(join(srcDir, n), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(prod ? outDir : root, 'bundle.js'), ...(prod ? { env: 'prod', js: 'split', urlPrefix: '/out' } : {}) } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  if (prod) return { root, script: '' }
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  return { root, script: [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js')) }
}

// le relevé des images : lu APRÈS la peinture de chaque image (un setTimeout posé dans le rappel de l'image), pour voir ce que l'écran a montré
const ENREG = `window.__enreg = (tag, ms) => {
  const racine = document.querySelector(tag)._shadow
  window.__frames = []
  const t0 = performance.now()
  const lire = () => {
    window.__frames.push({ t: Math.round(performance.now() - t0), rows: [...racine.querySelectorAll('.ligne, .groupe')].map((n) => {
      const r = n.getBoundingClientRect()
      const cs = getComputedStyle(n)
      return { id: n.dataset.id, list: (n.parentElement.className || '').split(' ')[0], top: Math.round(r.top * 10) / 10, left: Math.round(r.left * 10) / 10, op: Math.round(+cs.opacity * 100) / 100, mark: n.getAttribute('mjs-sortable'), pos: cs.position, st: n.getAttribute('style') }
    }) })
    if (performance.now() - t0 < ms) requestAnimationFrame(boucle)
  }
  const boucle = () => setTimeout(lire, 0)
  requestAnimationFrame(boucle)
}`

type Rang  = { id: string, list: string, top: number, left: number, op: number, mark: string | null, pos: string, st: string | null }
type Image = { t: number, rows: Rang[] }
type Pas   = { t: number, n: number, somme: number, top: number, left: number }

// la ligne `id` vue à l'écran : ses exemplaires (l'ancienne qui sort, la neuve qui entre), leurs opacités ajoutées, leur place pondérée par l'opacité
const trace = (images: Image[], id: string): Pas[] => images.map((f) => {
  const c     = f.rows.filter((r) => r.id === id)
  const somme = c.reduce((a, r) => a + r.op, 0)
  return { t: f.t, n: c.length, somme, top: somme ? c.reduce((a, r) => a + r.op * r.top, 0) / somme : NaN, left: somme ? c.reduce((a, r) => a + r.op * r.left, 0) / somme : NaN }
})

// une seule ligne se voit à chaque image : au plus deux exemplaires, leurs opacités font un (ni double, ni trou, ni clignotement)
function uneSeule(images: Image[], id: string) {
  for (const p of trace(images, id)) {
    assert.ok(p.n >= 1 && p.n <= 2, `ligne ${id} : ${p.n} exemplaire(s) à ${p.t} ms`)
    const vu = images.find((f) => f.t === p.t)!.rows.filter((r) => r.id === id).map((r) => `${r.list}@${r.top},${r.left} o${r.op} ${r.pos}${r.mark ? ' ' + r.mark : ''}`).join(' + ')
    assert.ok(p.somme > 0.95 && p.somme < 1.05, `ligne ${id} : opacités ajoutées ${p.somme} à ${p.t} ms (une seule ligne doit se voir) : ${vu}`)
  }
}

// la ligne reste sur son chemin : jamais hors de la boîte départ-arrivée (à tol près), et elle part de là où elle était
function chemin(images: Image[], id: string, tol = 3) {
  const tr = trace(images, id)
  const a  = tr[0]
  const z  = tr[tr.length - 1]
  for (const p of tr) {
    assert.ok(p.top >= Math.min(a.top, z.top) - tol && p.top <= Math.max(a.top, z.top) + tol, `ligne ${id} : haut ${p.top} à ${p.t} ms, hors de ${a.top} → ${z.top}`)
    assert.ok(p.left >= Math.min(a.left, z.left) - tol && p.left <= Math.max(a.left, z.left) + tol, `ligne ${id} : gauche ${p.left} à ${p.t} ms, hors de ${a.left} → ${z.left}`)
  }
}

// une voisine (ou une section) ne saute pas : elle reste dans sa boîte départ-arrivée (à tol près) et ne fait jamais, en une image, plus de `part` de son trajet
function voisine(images: Image[], id: string, tol: number, part = 0.6) {
  const tr = trace(images, id)
  const a  = tr[0]
  const z  = tr[tr.length - 1]
  const d  = Math.abs(z.top - a.top)
  for (let i = 0; i < tr.length; i++) {
    const p = tr[i]
    assert.ok(p.top >= Math.min(a.top, z.top) - tol && p.top <= Math.max(a.top, z.top) + tol, `voisine ${id} : haut ${p.top} à ${p.t} ms, hors de ${a.top} → ${z.top}`)
    if (i > 0) assert.ok(Math.abs(p.top - tr[i - 1].top) <= Math.max(part * d, tol), `voisine ${id} : saut de ${Math.abs(p.top - tr[i - 1].top)} px en une image à ${p.t} ms (trajet ${d} px)`)
  }
}

// à la fin : une seule ligne par clé, plus aucune marque ni style laissé par le module ou par le fondu
function aRepos(images: Image[]) {
  const dernier = images[images.length - 1]
  const ids     = dernier.rows.map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length, `une seule ligne par clé à la fin : ${ids.join(',')}`)
  for (const r of dernier.rows) {
    assert.equal(r.mark, null, `ligne ${r.id} : marque ${r.mark} restée`)
    assert.equal(r.st, null, `ligne ${r.id} : style ${r.st} resté`)
    assert.ok(r.op === 1, `ligne ${r.id} : opacité ${r.op} à la fin`)
  }
}

// le nombre d'images où une ligne est entre deux états (opacité entre les deux) : zéro en « réduire les animations »
const enVol = (images: Image[]) => images.filter((f) => f.rows.some((r) => r.op > 0.02 && r.op < 0.98)).length

for (const prod of [false, true]) {
  for (const nom of ['chromium', 'firefox'] as const) {
    describe(`<@@sortable> avec *crossfade sur les lignes (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
      this.timeout(240000)
      let present = false
      let groupes: Build = { root: '', script: '' }
      let simple: Build  = { root: '', script: '' }
      let browser: any   = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test du fondu sauté`)
          return
        }
        groupes = await construire(prod, 'groupes', SOURCES_GROUPES)
        simple  = await construire(prod, 'simple', SOURCES_SIMPLE)
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => {
        await browser?.close()
        await terminateSharedWorkerPool()
      })

      type Opts = { tag?: string, build?: Build, calme?: boolean, listes?: number }

      async function essai(fn: (page: any, tag: string) => Promise<void>, opts: Opts = {}) {
        const tag     = opts.tag ?? 'mjs-fa-page'
        const build   = opts.build ?? groupes
        const context = await browser.newContext({ viewport: { width: 800, height: 600 }, ...(opts.calme ? { reducedMotion: 'reduce' } : {}) })
        try {
          const page = await context.newPage()
          page.setDefaultTimeout(5000)
          page.setDefaultNavigationTimeout(30000)
          const erreurs: string[] = []
          const avis: string[] = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') avis.push(m.text().slice(0, 300)) })
          await page.addInitScript(ENREG)
          const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${build.script}</script>`
          await page.route('http://t.test/**', (route: any) => {
            const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
            if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0"><${tag}></${tag}>${charge}</body></html>` })
            const fichier = join(build.root, normalize(chemin))
            if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
            return route.fulfill({ status: 404, body: '' })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          try {
            await page.waitForFunction(([t, n]: any) => { const ls = (document.querySelector(t) as any)?._shadow?.querySelectorAll('mjs-core-sortable'); return !!ls && ls.length >= n && [...ls].every((l: any) => l._shadow?.querySelector('slot')) }, [tag, opts.listes ?? 2])
          } catch {
            throw new Error(`la page ${tag} ne démarre pas : ${erreurs.join(' | ') || 'aucune erreur de page'} / console : ${avis.join(' | ')}`)
          }
          await page.waitForTimeout(250)
          try {
            await fn(page, tag)
          } catch (e: any) {
            e.message += ` / erreurs de page : ${erreurs.join(' | ') || 'aucune'} / console : ${avis.join(' | ') || 'rien'}`
            throw e
          }
          assert.deepEqual(erreurs, [], 'aucune erreur de page')
        } finally {
          await context.close()
        }
      }

      const t       = (id: string) => `.ligne[data-id="${id}"] .t`
      const centre  = (page: any, tag: string, q: string) => page.evaluate(([tg, s]: string[]) => { const r = (document.querySelector(tg) as any)._shadow.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, [tag, q]) as Promise<{ x: number, y: number }>
      const texte   = (page: any, tag: string, cls: string) => page.evaluate(([tg, c]: string[]) => (document.querySelector(tg) as any)._shadow.querySelector('p.' + c).textContent as string, [tag, cls])
      const actif   = (page: any, tag: string) => page.evaluate((tg: string) => { const a = (document.querySelector(tg) as any)._shadow.activeElement; return a ? a.dataset.id + '@' + a.parentElement.className.split(' ')[0] + (a.isConnected ? '' : ' détachée') : null }, tag) as Promise<string | null>
      const focaliser = (page: any, tag: string, q: string) => page.evaluate(([tg, s]: string[]) => (document.querySelector(tg) as any)._shadow.querySelector(s).focus(), [tag, q])
      const touche  = async (page: any, ...ts: string[]) => { for (const k of ts) { await page.keyboard.press(k); await page.waitForTimeout(200) } }
      const clic    = (page: any, tag: string, q: string) => page.evaluate(([tg, s]: string[]) => (document.querySelector(tg) as any)._shadow.querySelector(s).click(), [tag, q])
      const images  = (page: any) => page.evaluate(() => (window as any).__frames) as Promise<Image[]>
      const suivre  = async (page: any, tag: string, ms = 1300) => { await page.evaluate(([tg, d]: any[]) => (window as any).__enreg(tg, d), [tag, ms]); await page.waitForTimeout(100) }
      const fin     = async (page: any, ms = 1500) => { await page.waitForTimeout(ms); return images(page) }

      // la souris tient la ligne `depart` au-dessus du point `vers`, puis le relevé commence ; l'appelant lâche
      async function tenir(page: any, tag: string, depart: string, vers: { x: number, y: number }) {
        const p = await centre(page, tag, depart)
        await page.mouse.move(p.x, p.y)
        await page.mouse.down()
        await page.mouse.move(p.x + 4, p.y + 8, { steps: 2 })
        await page.mouse.move(vers.x, vers.y, { steps: 14 })
        await page.waitForTimeout(250)
      }

      // pas de vrai doigt dans Firefox : des PointerEvent de type touch, joués DANS la page ; 'enreg' lance le relevé juste avant le lâcher
      const doigt = (page: any, tag: string, depart: string, pas: Array<[string, number, number, number]>) => page.evaluate(async ([tg, q, steps]: any[]) => {
        const el = (document.querySelector(tg) as any)._shadow.querySelector(q)
        const r  = el.getBoundingClientRect()
        const x0 = r.x + r.width / 2
        const y0 = r.y + r.height / 2
        for (const [ty, dx, dy, attente] of steps) {
          if (ty === 'enreg') {
            (window as any).__enreg(tg, 1300)
            await new Promise((res) => setTimeout(res, 100))
            continue
          }
          el.dispatchEvent(new PointerEvent(ty, { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, composed: true, clientX: x0 + dx, clientY: y0 + dy, button: ty === 'pointermove' ? -1 : 0, buttons: ty === 'pointerup' ? 0 : 1 }))
          if (attente) await new Promise((res) => setTimeout(res, attente))
        }
      }, [tag, depart, pas])

      describe('deux listes d\'un groupe', () => {
        it('souris : A1 lâchée dans B vole de là où elle a été lâchée à sa place, sans saut, sans double, les voisines immobiles', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const b2 = await centre(page, tag, t('5'))
            await tenir(page, tag, t('1'), { x: b2.x, y: b2.y - 10 })
            await suivre(page, tag)
            await page.mouse.up()
            const im = await fin(page)
            assert.equal(await texte(page, tag, 'ordre'), '2,3|4,1,5')
            assert.equal(await texte(page, tag, 'sorts'), '1')
            for (const id of ['1', '2', '3', '4', '5']) uneSeule(im, id)
            chemin(im, '1')
            for (const id of ['2', '3', '4', '5']) voisine(im, id, 2, 0.2)
            aRepos(im)
            assert.ok(enVol(im) > 0, 'le fondu joue : la ligne est entre deux états un moment')
          })
        })

        it('souris : B1 lâchée au début de A', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const a1 = await centre(page, tag, t('1'))
            await tenir(page, tag, t('4'), { x: a1.x, y: a1.y - 12 })
            await suivre(page, tag)
            await page.mouse.up()
            const im = await fin(page)
            assert.equal(await texte(page, tag, 'ordre'), '4,1,2,3|5')
            for (const id of ['1', '2', '3', '4', '5']) uneSeule(im, id)
            chemin(im, '4')
            for (const id of ['1', '2', '3', '5']) voisine(im, id, 2, 0.2)
            aRepos(im)
          })
        })

        it('doigt : appui long sur A1, lâcher dans B, même résultat qu\'à la souris', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const a = await centre(page, tag, t('1'))
            const b = await centre(page, tag, t('5'))
            const dx = b.x - a.x
            const dy = b.y - a.y - 10
            await doigt(page, tag, t('1'), [['pointerdown', 0, 0, 320], ['pointermove', 6, 6, 60], ['pointermove', dx / 2, dy / 2, 60], ['pointermove', dx, dy, 250], ['enreg', 0, 0, 0], ['pointerup', dx, dy, 0]])
            const im = await fin(page)
            assert.equal(await texte(page, tag, 'ordre'), '2,3|4,1,5')
            for (const id of ['1', '2', '3', '4', '5']) uneSeule(im, id)
            chemin(im, '1')
            for (const id of ['2', '3', '4', '5']) voisine(im, id, 2, 0.2)
            aRepos(im)
          })
        })

        it('clavier : Espace, droite, Espace — la ligne passe dans B, le focus la suit, rien ne saute', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, '.ligne[data-id="1"]')
            await touche(page, ' ', 'ArrowRight')
            await page.waitForTimeout(300)
            await suivre(page, tag)
            await page.keyboard.press(' ')
            const im = await fin(page)
            assert.equal(await texte(page, tag, 'ordre'), '2,3|1,4,5')
            for (const id of ['1', '2', '3', '4', '5']) uneSeule(im, id)
            chemin(im, '1')
            for (const id of ['2', '3', '4', '5']) voisine(im, id, 2, 0.2)
            aRepos(im)
            assert.equal(await actif(page, tag), '1@lb', 'le focus est sur la ligne neuve de B, pas sur l\'ancienne qui sortait')
          })
        })

        it('clavier : Espace, droite, bas, Espace — arrivée à la 2e place', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, '.ligne[data-id="2"]')
            await touche(page, ' ', 'ArrowRight', 'ArrowDown')
            await page.waitForTimeout(300)
            await suivre(page, tag)
            await page.keyboard.press(' ')
            const im = await fin(page)
            assert.equal(await texte(page, tag, 'ordre'), '1,3|4,5,2')
            for (const id of ['1', '2', '3', '4', '5']) uneSeule(im, id)
            chemin(im, '2')
            for (const id of ['1', '3', '4', '5']) voisine(im, id, 2, 0.2)
            aRepos(im)
            assert.equal(await actif(page, tag), '2@lb')
          })
        })

        it('bouton de l\'appli : A1 passe en 2e place de B, vole de l\'une à l\'autre, sans saut, sans double', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await suivre(page, tag)
            await clic(page, tag, 'button.ab')
            const im = await fin(page)
            assert.equal(await texte(page, tag, 'ordre'), '2,3|4,1,5')
            for (const id of ['1', '4', '5']) uneSeule(im, id)
            chemin(im, '1')
            const tr = trace(im, '1')
            assert.ok(tr[0].top === 0 && tr[0].left === 0, 'elle part de sa place')
            assert.ok(Math.abs(tr[tr.length - 1].top - 46) < 1 && Math.abs(tr[tr.length - 1].left - 280) < 1, 'et arrive à la sienne')
            voisine(im, '4', 2, 0.2)
            aRepos(im)
            assert.ok(enVol(im) > 0, 'elle vole')
          })
        })

        it('bouton de l\'appli, dans l\'autre sens : B1 passe en 2e place de A', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await suivre(page, tag)
            await clic(page, tag, 'button.ba')
            const im = await fin(page)
            assert.equal(await texte(page, tag, 'ordre'), '1,4,2,3|5')
            for (const id of ['1', '4', '5']) uneSeule(im, id)
            chemin(im, '4')
            aRepos(im)
          })
        })

        it('« réduire les animations » : la ligne passe d\'un coup, sans état intermédiaire (souris, clavier, bouton)', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const b2 = await centre(page, tag, t('5'))
            await tenir(page, tag, t('1'), { x: b2.x, y: b2.y - 10 })
            await suivre(page, tag, 900)
            await page.mouse.up()
            const im = await fin(page, 1100)
            assert.equal(await texte(page, tag, 'ordre'), '2,3|4,1,5')
            assert.equal(enVol(im), 0, 'souris : aucune image à moitié fondue')
            for (const id of ['1', '2', '3', '4', '5']) uneSeule(im, id)
            await focaliser(page, tag, '.ligne[data-id="2"]')
            await touche(page, ' ', 'ArrowRight')
            await suivre(page, tag, 900)
            await page.keyboard.press(' ')
            const ik = await fin(page, 1100)
            assert.equal(await texte(page, tag, 'ordre'), '3|2,4,1,5')
            assert.equal(enVol(ik), 0, 'clavier : aucune image à moitié fondue')
            await suivre(page, tag, 900)
            await clic(page, tag, 'button.ba')
            const ib = await fin(page, 1100)
            assert.equal(await texte(page, tag, 'ordre'), '3,2|4,1,5')
            assert.equal(enVol(ib), 0, 'bouton : aucune image à moitié fondue')
            aRepos(ib)
          }, { calme: true })
        })

        it('un geste pendant le vol d\'une ligne passée par un bouton : la ligne qui sort ne compte plus dans sa liste, les deux listes restent justes', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await clic(page, tag, 'button.ab')
            await page.waitForTimeout(60)
            const b1 = await centre(page, tag, t('4'))
            await tenir(page, tag, t('2'), { x: b1.x, y: b1.y - 4 })
            await page.mouse.up()
            await page.waitForTimeout(1500)
            assert.equal(await texte(page, tag, 'ordre'), '3|2,4,1,5')
            assert.equal(await texte(page, tag, 'sorts'), '1')
          }, { tag: 'mjs-fd-page' })
        })
      })

      describe('deux listes dans une zone qui défile', () => {
        it('souris : la zone est défilée et positionnée, la ligne lâchée vole de là où elle a été lâchée', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await page.evaluate((tg: string) => { (document.querySelector(tg) as any)._shadow.querySelector('.cadre').scrollTop = 100 }, tag)
            await page.waitForTimeout(150)
            const b7 = await centre(page, tag, t('27'))
            await tenir(page, tag, t('5'), { x: b7.x, y: b7.y - 10 })
            await suivre(page, tag)
            await page.mouse.up()
            const im = await fin(page)
            assert.equal(await texte(page, tag, 'ordre'), '1,2,3,4,6,7,8,9,10,11,12|21,22,23,24,25,26,5,27,28,29,30,31,32')
            uneSeule(im, '5')
            chemin(im, '5')
            aRepos(im)
          }, { tag: 'mjs-fc-page' })
        })
      })

      describe('deux listes d\'un groupe, lignes avec @out seul', () => {
        it('souris : l\'ancienne ligne s\'estompe là où elle a été lâchée, la neuve est à sa place d\'emblée, sans glisser', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const b2 = await centre(page, tag, t('5'))
            await tenir(page, tag, t('1'), { x: b2.x, y: b2.y - 10 })
            await suivre(page, tag)
            await page.mouse.up()
            const im = await fin(page)
            assert.equal(await texte(page, tag, 'ordre'), '2,3|4,1,5')
            const apres = im.filter((f) => f.rows.filter((r) => r.id === '1').length === 2)
            assert.ok(apres.length > 0, 'les deux exemplaires coexistent un moment')
            const vieille = apres.map((f) => f.rows.find((r) => r.id === '1' && r.list === 'la')!)
            const neuve   = apres.map((f) => f.rows.find((r) => r.id === '1' && r.list === 'lb')!)
            assert.ok(vieille.every((r) => Math.abs(r.top - vieille[0].top) < 1 && Math.abs(r.left - vieille[0].left) < 1), 'l\'ancienne reste où elle a été lâchée')
            assert.ok(vieille[vieille.length - 1].op < vieille[0].op, 'et s\'estompe')
            assert.ok(neuve.every((r) => r.op === 1 && Math.abs(r.top - 46) < 1 && Math.abs(r.left - 280) < 1), 'la neuve est à sa place, opaque, dès la première image')
            for (const id of ['2', '3', '4', '5']) voisine(im, id, 2, 0.2)
            aRepos(im)
          }, { tag: 'mjs-fo-page' })
        })
      })

      describe('deux listes d\'un groupe, lignes avec @flip', () => {
        it('souris : A1 lâchée dans B, la ligne vole sans saut ni double, les voisines glissent sans sauter', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const b2 = await centre(page, tag, t('5'))
            await tenir(page, tag, t('1'), { x: b2.x, y: b2.y - 10 })
            await suivre(page, tag)
            await page.mouse.up()
            const im = await fin(page)
            assert.equal(await texte(page, tag, 'ordre'), '2,3|4,1,5')
            for (const id of ['1', '2', '3', '4', '5']) uneSeule(im, id)
            chemin(im, '1')
            for (const id of ['2', '3', '4', '5']) voisine(im, id, 12, 0.2)
            aRepos(im)
          }, { tag: 'mjs-ff-page' })
        })

        it('bouton de l\'appli : A1 vole dans B, les voisines glissent', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await suivre(page, tag)
            await clic(page, tag, 'button.ab')
            const im = await fin(page)
            assert.equal(await texte(page, tag, 'ordre'), '2,3|4,1,5')
            for (const id of ['1', '4', '5']) uneSeule(im, id)
            chemin(im, '1')
            for (const id of ['2', '3', '5']) voisine(im, id, 12, 0.6)
            aRepos(im)
          }, { tag: 'mjs-ff-page' })
        })
      })

      describe('une seule liste, lignes avec *crossfade', () => {
        it('souris : un réordre ne fait voler personne, la ligne glisse à sa place', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const l4 = await centre(page, tag, t('4'))
            await tenir(page, tag, t('1'), { x: l4.x, y: l4.y + 8 })
            await suivre(page, tag)
            await page.mouse.up()
            const im = await fin(page)
            assert.equal(await texte(page, tag, 'ordre'), '2,3,4,1,5')
            for (const id of ['1', '2', '3', '4', '5']) {
              uneSeule(im, id)
              assert.ok(trace(im, id).every((p) => p.n === 1), `ligne ${id} : jamais deux exemplaires dans une liste seule`)
            }
            chemin(im, '1')
            for (const id of ['2', '3', '4', '5']) voisine(im, id, 2, 0.6)
            aRepos(im)
          }, { tag: 'mjs-fs-page', build: simple, listes: 1 })
        })

        it('clavier : Espace, bas, bas, Espace', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, '.ligne[data-id="1"]')
            await touche(page, ' ', 'ArrowDown', 'ArrowDown')
            await page.waitForTimeout(300)
            await suivre(page, tag)
            await page.keyboard.press(' ')
            const im = await fin(page)
            assert.equal(await texte(page, tag, 'ordre'), '2,3,1,4,5')
            for (const id of ['1', '2', '3', '4', '5']) {
              uneSeule(im, id)
              assert.ok(trace(im, id).every((p) => p.n === 1), `ligne ${id} : jamais deux exemplaires`)
            }
            aRepos(im)
            assert.equal(await actif(page, tag), '1@la')
          }, { tag: 'mjs-fs-page', build: simple, listes: 1 })
        })

        it('doigt : appui long, glissement, lâcher', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const a = await centre(page, tag, t('1'))
            const b = await centre(page, tag, t('4'))
            const dy = b.y - a.y + 8
            await doigt(page, tag, t('1'), [['pointerdown', 0, 0, 320], ['pointermove', 0, 8, 60], ['pointermove', 0, dy / 2, 60], ['pointermove', 0, dy, 250], ['enreg', 0, 0, 0], ['pointerup', 0, dy, 0]])
            const im = await fin(page)
            assert.equal(await texte(page, tag, 'ordre'), '2,3,4,1,5')
            for (const id of ['1', '2', '3', '4', '5']) uneSeule(im, id)
            aRepos(im)
          }, { tag: 'mjs-fs-page', build: simple, listes: 1 })
        })

        it('bouton de l\'appli qui réécrit la liste : la ligne qui change de place ne se double pas', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await suivre(page, tag)
            await clic(page, tag, 'button.monte')
            const im = await fin(page)
            assert.equal(await texte(page, tag, 'ordre'), '4,1,2,3,5')
            for (const id of ['1', '2', '3', '4', '5']) uneSeule(im, id)
            aRepos(im)
          }, { tag: 'mjs-fs-page', build: simple, listes: 1 })
        })
      })

      describe('deux niveaux : sections et lignes', () => {
        it('une ligne passe d\'une section dans une autre : les sections voisines ne sautent pas, la ligne vole', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const cible = await page.evaluate((tg: string) => { const r = (document.querySelector(tg) as any)._shadow.querySelector('.lignes[data-id="m3"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 12 } }, tag)
            await tenir(page, tag, t('l11'), cible)
            await suivre(page, tag)
            await page.mouse.up()
            const im = await fin(page)
            assert.equal(await texte(page, tag, 'ordre'), 'e1 m1:l12 m2:l21,l22,l23 m3:l11')
            uneSeule(im, 'l11')
            chemin(im, 'l11', 4)
            for (const id of ['m2', 'm3', 'l21', 'l22', 'l23']) voisine(im, id, 2, 0.5)
            voisine(im, 'l12', 2, 0.5)
            aRepos(im)
          }, { tag: 'mjs-fn-page', listes: 4 })
        })
      })
    })
  }
}
