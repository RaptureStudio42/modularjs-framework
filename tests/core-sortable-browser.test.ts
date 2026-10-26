// `<@@sortable>` : la liste triable par glisser. Souris (seuil de 5 px, écartement des lignes, ordre final, `value=!{}`
// réordonnée, `sort` émis une fois avec sa charge), doigt (appui long de 250 ms, tolérance de 10 px), clavier (Espace,
// flèches, Espace, Échap ; focus gardé ; annonces en français et en anglais), annulation (hors de la liste, Échap),
// poignée, clic avalé, boutons liens et champs qui gardent leur clic, défilement au bord, liste calculée (seul `sort`),
// hauteur qui change en plein geste, retrait du module en plein geste, rien qui tourne au repos.
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
  .ligne
    display: flex
    align-items: center
    gap: 8px
    box-sizing: border-box
    height: 44px
    margin-bottom: 6px
    padding: 0 10px
    border: 1px solid #999
    background: #fff
  .t
    flex: 1
  .grip
    cursor: grab
    padding: 0 6px
  .cadre
    height: 220px
    overflow-y: auto
    border: 1px solid #999
</style>`

const LIGNE = '<div class="ligne" data-id={et.id}><span class="t">{et.titre}</span> <button class="bt" @click={$clics++}>+</button> <input class="champ" value="champ" aria-label="champ"> <a class="lien" href="#lien">lien</a> <img class="img" alt="" width="16" height="16" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></div>'

const DONNEES = '[{ id: 1, titre: \'Alpha\' }, { id: 2, titre: \'Bravo\' }, { id: 3, titre: \'Charlie\' }, { id: 4, titre: \'Delta\' }, { id: 5, titre: \'Echo\' }]'

const SOURCES: Record<string, string> = {
  'sx-page.mjs': `<script>
  $etapes = ${DONNEES}
  $sorts = []
  $clics = 0
  ids = (l)-> l.map((x)-> x.id).join(',')
  keep = (e)-> $sorts = $sorts.concat([JSON.stringify(e.data)])
</script>
<@@sortable class="liste" value=!{$etapes} @sort={keep(e)}>
  {for et in $etapes by id}
    ${LIGNE}
  {end}
</@@sortable>
<p class="ordre">{ids($etapes)}</p>
<p class="sorts">{$sorts.join('|')}</p>
<p class="clics">{$clics}</p>
${STYLE}
`,
  'sh-page.mjs': `<script>
  $etapes = ${DONNEES}
  $sorts = []
  ids = (l)-> l.map((x)-> x.id).join(',')
  keep = (e)-> $sorts = $sorts.concat([JSON.stringify(e.data)])
</script>
<@@sortable class="liste" value=!{$etapes} handle=".grip" @sort={keep(e)}>
  {for et in $etapes by id}
    <div class="ligne" data-id={et.id}><span class="grip">⠿</span><span class="t">{et.titre}</span></div>
  {end}
</@@sortable>
<p class="ordre">{ids($etapes)}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`,
  'sc-page.mjs': `<script>
  $items = [{ id: 1, n: 'Alpha' }, { id: 2, n: 'Bravo' }, { id: 3, n: 'Charlie' }, { id: 4, n: 'Delta' }, { id: 5, n: 'Echo' }, { id: 6, n: 'Foxtrot' }]
  $sorts = []
  pairs = (l)-> l.filter((x)-> x.id % 2 is 0)
  $vue = pairs($items)
  ids = (l)-> l.map((x)-> x.id).join(',')
  deplace = (from, to)->
    $sorts = $sorts.concat([from + '>' + to])
    ordre = $vue.slice()
    ordre.splice(to, 0, ordre.splice(from, 1)[0])
    k = 0
    $items = $items.map((x)-> if x.id % 2 is 0 then ordre[k++] else x)
</script>
<@@sortable class="liste" @sort={deplace(e.data.from, e.data.to)}>
  {for et in $vue by id}
    <div class="ligne" data-id={et.id}><span class="t">{et.n}</span></div>
  {end}
</@@sortable>
<p class="ordre">{ids($items)}</p>
<p class="vue">{ids($vue)}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`,
  'sn-page.mjs': `<script>
  $items = [{ id: 1, n: 'Alpha' }, { id: 2, n: 'Bravo' }, { id: 3, n: 'Charlie' }]
  $sorts = []
  ids = (l)-> l.map((x)-> x.id).join(',')
  keep = (e)-> $sorts = $sorts.concat([JSON.stringify(e.data)])
</script>
<@@sortable class="liste" @sort={keep(e)}>
  {for et in $items by id}
    <div class="ligne" data-id={et.id}><span class="t">{et.n}</span></div>
  {end}
</@@sortable>
<p class="ordre">{ids($items)}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`,
  'sl-page.mjs': `<script>
  $etapes = Array.from({ length: 40 }, (_, i)-> { id: i + 1, titre: 'Ligne ' + (i + 1) })
  $sorts = []
  ids = (l)-> l.map((x)-> x.id).join(',')
  keep = (e)-> $sorts = $sorts.concat([JSON.stringify(e.data)])
</script>
<@@sortable class="liste" value=!{$etapes} @sort={keep(e)}>
  {for et in $etapes by id}
    <div class="ligne" data-id={et.id}><span class="t">{et.titre}</span></div>
  {end}
</@@sortable>
<p class="ordre">{ids($etapes)}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`,
  'sv-page.mjs': `<script>
  $etapes = Array.from({ length: 20 }, (_, i)-> { id: i + 1, titre: 'Ligne ' + (i + 1) })
  $sorts = []
  ids = (l)-> l.map((x)-> x.id).join(',')
  keep = (e)-> $sorts = $sorts.concat([JSON.stringify(e.data)])
</script>
<div class="cadre">
  <@@sortable class="liste" value=!{$etapes} @sort={keep(e)}>
    {for et in $etapes by id}
      <div class="ligne" data-id={et.id}><span class="t">{et.titre}</span></div>
    {end}
  </@@sortable>
</div>
<p class="ordre">{ids($etapes)}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`,
  'sa-page.mjs': `<script>
  $on = true
  $etapes = ${DONNEES}
  $sorts = []
  ids = (l)-> l.map((x)-> x.id).join(',')
  keep = (e)-> $sorts = $sorts.concat([JSON.stringify(e.data)])
</script>
{if $on}
  <@@sortable class="liste" value=!{$etapes} @sort={keep(e)}>
    {for et in $etapes by id}
      <div class="ligne" data-id={et.id}><span class="t">{et.titre}</span></div>
    {end}
  </@@sortable>
{end}
<button class="retire" @click={$on = false}>retirer</button>
<p class="ordre">{ids($etapes)}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`
}

// les écouteurs de window et de document encore posés, les minuteries et les observateurs : de quoi prouver qu'un geste ne laisse rien
const SONDE = `(() => {
  const ids = new WeakMap(); let n = 0;
  const id = (f) => { if (!f) return 'null'; let v = ids.get(f); if (!v) { v = ++n; ids.set(f, v); } return v; };
  const vivants = new Map();
  const cible = (t) => t === window ? 'window' : t === document ? 'document' : null;
  const cap = (o) => typeof o === 'object' && o ? !!o.capture : !!o;
  const ajoute = EventTarget.prototype.addEventListener;
  const retire = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (t, f, o) { const k = cible(this); if (k) vivants.set(k + '|' + t + '|' + id(f) + '|' + cap(o), k + ' ' + t); return ajoute.call(this, t, f, o); };
  EventTarget.prototype.removeEventListener = function (t, f, o) { const k = cible(this); if (k) vivants.delete(k + '|' + t + '|' + id(f) + '|' + cap(o)); return retire.call(this, t, f, o); };
  window.__vivants = () => [...vivants.values()].sort();
  window.__raf = 0; window.__timers = 0; window.__intervals = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (f) => { window.__raf++; return raf(f); };
  const st = window.setTimeout.bind(window);
  window.setTimeout = (...a) => { window.__timers++; return st(...a); };
  const si = window.setInterval.bind(window);
  window.setInterval = (...a) => { window.__intervals++; return si(...a); };
  window.__ro = new Set();
  if (window.ResizeObserver) {
    const o = ResizeObserver.prototype.observe, d = ResizeObserver.prototype.disconnect;
    ResizeObserver.prototype.observe = function (...a) { window.__ro.add(this); return o.apply(this, a); };
    ResizeObserver.prototype.disconnect = function () { window.__ro.delete(this); return d.call(this); };
  }
})();`

const FR = {
  saisie:  (n: number, t: number) => `Ligne saisie, place ${n} sur ${t}. Flèches haut et bas pour la déplacer, Espace pour la poser, Échap pour annuler`,
  deplace: (n: number, t: number) => `Déplacée en place ${n} sur ${t}`,
  posee:   (n: number, t: number) => `Ligne posée en place ${n} sur ${t}`,
  annule:  (n: number) => `Déplacement annulé, ligne remise en place ${n}`
}

const EN = {
  saisie:  (n: number, t: number) => `Row grabbed, position ${n} of ${t}. Up and down arrows move it, Space drops it, Escape cancels`,
  deplace: (n: number, t: number) => `Moved to position ${n} of ${t}`,
  posee:   (n: number, t: number) => `Row dropped at position ${n} of ${t}`,
  annule:  (n: number) => `Move cancelled, row back at position ${n}`
}

// développement : les fichiers du build bout à bout dans la page ; production : le build tel qu'il part, en modules servis sous /out
async function construire(prod: boolean): Promise<{ root: string, script: string }> {
  const root   = mjsTmp('sortable-' + (prod ? 'prod' : 'dev'))
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [n, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, n), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(prod ? outDir : root, 'bundle.js'), ...(prod ? { env: 'prod', js: 'split', urlPrefix: '/out' } : {}) } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  if (prod) return { root, script: '' }
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  return { root, script: [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js')) }
}

for (const prod of [false, true]) {
  for (const nom of ['chromium', 'firefox'] as const) {
    describe(`<@@sortable> : la liste triable (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
      this.timeout(180000)
      let present = false
      let script  = ''
      let racine  = ''
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test de la liste triable sauté`)
          return
        }
        const b = await construire(prod)
        script  = b.script
        racine  = b.root
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => {
        await browser?.close()
        await terminateSharedWorkerPool()
      })

      type Opts = { tag?: string, lang?: string, viewport?: { width: number, height: number }, sonde?: boolean, touch?: boolean }

      async function essai(fn: (page: any, tag: string) => Promise<void>, opts: Opts = {}) {
        const tag     = opts.tag ?? 'mjs-sx-page'
        const context = await browser.newContext({ viewport: opts.viewport ?? { width: 800, height: 600 }, ...(opts.touch ? { hasTouch: true } : {}) })
        try {
          const page = await context.newPage()
          page.setDefaultTimeout(5000)
          page.setDefaultNavigationTimeout(30000)
          page.setDefaultNavigationTimeout(30000)
          const erreurs: string[] = []
          const avis: string[] = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') avis.push(m.text().slice(0, 300)) })
          if (opts.sonde) await page.addInitScript(SONDE)
          const charge = prod ? '<script type="module" src="/out/bundle.js"></script>' : `<script>${script}</script>`
          await page.route('http://t.test/**', (route: any) => {
            const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
            if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${opts.lang ?? 'fr'}"><head><meta charset="utf-8"></head><body style="margin:0"><${tag}></${tag}>${charge}</body></html>` })
            const fichier = join(racine, normalize(chemin))
            if (prod && chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
            return route.fulfill({ status: 404, body: '' })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          try {
            await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('mjs-core-sortable')?._shadow?.querySelector('slot'), tag)
          } catch {
            throw new Error(`la page ${tag} ne démarre pas : ${erreurs.join(' | ') || 'aucune erreur de page'} / console : ${avis.join(' | ')}`)
          }
          await page.waitForTimeout(200)
          await fn(page, tag)
          assert.deepEqual(erreurs, [], 'aucune erreur de page')
        } finally {
          await context.close()
        }
      }

      // lecture de la page, toujours dans l'ombre du composant de la page
      const lignes = (page: any, tag: string) => page.evaluate((t: string) => [...(document.querySelector(t) as any)._shadow.querySelectorAll('.ligne')].map((n: any) => {
        const b = n.getBoundingClientRect()
        return { id: n.dataset.id as string, top: b.top as number, height: b.height as number, etat: n.getAttribute('mjs-sortable') as string | null, dy: n.style.getPropertyValue('--mjs-sortable-dy') as string, style: n.getAttribute('style') as string | null }
      }), tag) as Promise<Array<{ id: string, top: number, height: number, etat: string | null, dy: string, style: string | null }>>
      const texte  = (page: any, tag: string, cls: string) => page.evaluate(([t, c]: string[]) => (document.querySelector(t) as any)._shadow.querySelector('p.' + c).textContent as string, [tag, cls])
      const ordre  = (page: any, tag: string) => texte(page, tag, 'ordre')
      const sorts  = async (page: any, tag: string) => { const s = await texte(page, tag, 'sorts'); return s === '' ? [] : s.split('|').map((x) => JSON.parse(x)) }
      const domIds = async (page: any, tag: string) => (await lignes(page, tag)).map((l) => l.id).join(',')
      const centre = (page: any, tag: string, i: number, sel = '.t') => page.evaluate(([t, k, s]: any[]) => { const r = (document.querySelector(t) as any)._shadow.querySelectorAll('.ligne')[k].querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, [tag, i, sel]) as Promise<{ x: number, y: number }>
      const annonce = (page: any, tag: string) => page.evaluate((t: string) => ((document.querySelector(t) as any)._shadow.querySelector('mjs-core-sortable')._shadow.querySelector('.live').textContent as string).trim(), tag) as Promise<string>
      const actif  = (page: any, tag: string) => page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.activeElement?.dataset?.id ?? null, tag) as Promise<string | null>
      const focaliser = (page: any, tag: string, i: number) => page.evaluate(([t, k]: any[]) => (document.querySelector(t) as any)._shadow.querySelectorAll('.ligne')[k].focus(), [tag, i])

      // saisit la ligne i (au milieu de son titre) et la suit jusqu'à y : la souris reste enfoncée
      async function saisir(page: any, tag: string, i: number, vers: number) {
        const p = await centre(page, tag, i)
        await page.mouse.move(p.x, p.y)
        await page.mouse.down()
        await page.mouse.move(p.x, p.y + Math.sign(vers - p.y) * 8, { steps: 2 })
        await page.mouse.move(p.x, vers, { steps: 10 })
        return p
      }

      describe('souris', () => {
        it('sous 5 px rien ne part, au-delà la ligne se saisit ; un lâcher sans changement n\'émet rien', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const p = await centre(page, tag, 1)
            await page.mouse.move(p.x, p.y)
            await page.mouse.down()
            await page.mouse.move(p.x, p.y + 3)
            assert.ok((await lignes(page, tag)).every((l) => l.etat === null), 'sous le seuil : aucune ligne marquée')
            await page.mouse.move(p.x, p.y + 6)
            const l = await lignes(page, tag)
            assert.equal(l[1].etat, 'held', 'au-delà du seuil la ligne est saisie')
            assert.ok(l.filter((x, i) => i !== 1).every((x) => x.etat === null || x.dy === '0px'), 'les autres ne bougent pas')
            await page.mouse.move(p.x, p.y)
            await page.mouse.up()
            await page.waitForTimeout(250)
            assert.equal(await ordre(page, tag), '1,2,3,4,5')
            assert.deepEqual(await sorts(page, tag), [], 'aucun sort')
            assert.ok((await lignes(page, tag)).every((x) => x.etat === null && x.dy === ''), 'plus aucune marque')
          })
        })

        it('glisser la première ligne sous la troisième : les lignes s\'écartent, l\'ordre final, value réordonnée, sort émis une fois', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const avant = await lignes(page, tag)
            const cible = await centre(page, tag, 2)
            await saisir(page, tag, 0, cible.y + 5)
            await page.waitForTimeout(300)
            const pendant = await lignes(page, tag)
            const pas = avant[1].top - avant[0].top
            assert.equal(pendant[0].etat, 'held')
            assert.ok(Math.abs(pendant[1].top - (avant[1].top - pas)) < 1.5, `la 2e remonte d\'un pas : ${pendant[1].top} / ${avant[1].top - pas}`)
            assert.ok(Math.abs(pendant[2].top - (avant[2].top - pas)) < 1.5, 'la 3e remonte d\'un pas')
            assert.ok(Math.abs(pendant[3].top - avant[3].top) < 1, 'la 4e reste')
            assert.ok(Math.abs(pendant[4].top - avant[4].top) < 1, 'la 5e reste')
            assert.ok(Math.abs((pendant[0].top + pendant[0].height / 2) - (cible.y + 5)) < 2, 'la ligne tenue suit le pointeur')
            assert.equal(await ordre(page, tag), '1,2,3,4,5', 'rien n\'est rendu avant le lâcher')
            await page.mouse.up()
            await page.waitForTimeout(400)
            assert.equal(await ordre(page, tag), '2,3,1,4,5', '$etapes remise dans le nouvel ordre')
            assert.equal(await domIds(page, tag), '2,3,1,4,5', 'les lignes aussi')
            const s = await sorts(page, tag)
            assert.equal(s.length, 1, 'sort émis une seule fois')
            assert.deepEqual(s[0], { from: 0, to: 2, item: { id: 1, titre: 'Alpha' }, order: [1, 2, 0, 3, 4] })
            const apres = await lignes(page, tag)
            assert.ok(apres.every((l, i) => l.etat === null && l.dy === '' && l.style === null && Math.abs(l.top - avant[i].top) < 1), 'plus de marque ni de style, chaque ligne à sa place')
          })
        })

        it('vers le haut : de la quatrième à la deuxième place', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const cible = await centre(page, tag, 1)
            await saisir(page, tag, 3, cible.y - 5)
            await page.mouse.up()
            await page.waitForTimeout(400)
            assert.equal(await ordre(page, tag), '1,4,2,3,5')
            const s = await sorts(page, tag)
            assert.equal(s.length, 1)
            assert.deepEqual(s[0], { from: 3, to: 1, item: { id: 4, titre: 'Delta' }, order: [0, 3, 1, 2, 4] })
          })
        })

        it('lâcher hors de la liste (au-delà de 24 px) annule ; Échap annule : ordre inchangé, rien d\'émis, plus de marque', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const avant = await lignes(page, tag)
            await saisir(page, tag, 0, 420)
            await page.waitForTimeout(350)
            const loin = await lignes(page, tag)
            assert.ok(loin.slice(1).every((l, i) => Math.abs(l.top - avant[i + 1].top) < 1), 'hors de la liste les autres reprennent leur place : on voit que le lâcher annule')
            await page.mouse.up()
            await page.waitForTimeout(300)
            assert.equal(await ordre(page, tag), '1,2,3,4,5')
            assert.deepEqual(await sorts(page, tag), [])
            assert.ok((await lignes(page, tag)).every((l) => l.etat === null && l.dy === ''))
            const cible = await centre(page, tag, 3)
            await saisir(page, tag, 0, cible.y)
            assert.equal((await lignes(page, tag))[0].etat, 'held')
            await page.keyboard.press('Escape')
            await page.waitForTimeout(300)
            await page.mouse.up()
            await page.waitForTimeout(200)
            assert.equal(await ordre(page, tag), '1,2,3,4,5', 'Échap : ordre inchangé')
            assert.deepEqual(await sorts(page, tag), [], 'Échap : rien d\'émis')
            assert.ok((await lignes(page, tag)).every((l) => l.etat === null && l.dy === ''))
          })
        })

        it('le clic qui suit un glisser est avalé ; un clic ordinaire ensuite compte', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const cible = await centre(page, tag, 2)
            const bt = await centre(page, tag, 2, '.bt')
            await saisir(page, tag, 0, cible.y + 5)
            await page.mouse.move(bt.x, cible.y + 5)
            await page.mouse.up()
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'clics'), '0', 'le lâcher sur un bouton ne le clique pas')
            const b = await centre(page, tag, 0, '.bt')
            await page.mouse.click(b.x, b.y)
            await page.waitForTimeout(100)
            assert.equal(await texte(page, tag, 'clics'), '1', 'un clic ordinaire garde son effet')
          })
        })

        it('une image dans la ligne ne lance pas le glisser natif du navigateur', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const img = await centre(page, tag, 2, '.img')
            const cible = await centre(page, tag, 4)
            await page.mouse.move(img.x, img.y)
            await page.mouse.down()
            await page.mouse.move(img.x, img.y + 8, { steps: 2 })
            await page.mouse.move(img.x, cible.y + 5, { steps: 8 })
            assert.equal((await lignes(page, tag))[2].etat, 'held', 'la ligne est saisie par son image')
            await page.mouse.up()
            await page.waitForTimeout(400)
            assert.equal(await ordre(page, tag), '1,2,4,5,3')
          })
        })

        it('boutons, liens et champs gardent leur clic et ne saisissent pas', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const b = await centre(page, tag, 1, '.bt')
            await page.mouse.move(b.x, b.y)
            await page.mouse.down()
            await page.mouse.move(b.x, b.y + 40, { steps: 6 })
            assert.ok((await lignes(page, tag)).every((l) => l.etat === null), 'un bouton ne saisit pas la ligne')
            await page.mouse.up()
            const c = await centre(page, tag, 2, '.champ')
            await page.mouse.move(c.x - 20, c.y)
            await page.mouse.down()
            await page.mouse.move(c.x + 20, c.y + 30, { steps: 6 })
            assert.ok((await lignes(page, tag)).every((l) => l.etat === null), 'un champ ne saisit pas la ligne')
            await page.mouse.up()
            const lien = await centre(page, tag, 3, '.lien')
            await page.mouse.click(lien.x, lien.y)
            await page.waitForTimeout(100)
            assert.equal(await page.evaluate(() => location.hash), '#lien', 'le lien garde son clic')
            await page.mouse.click(b.x, b.y)
            await page.waitForTimeout(100)
            assert.equal(await texte(page, tag, 'clics'), '1', 'le bouton garde son clic')
            await page.mouse.click(c.x, c.y)
            await page.keyboard.type('Z')
            assert.match(await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelectorAll('.champ')[2].value as string, tag), /Z/, 'on tape dans le champ')
            assert.equal(await ordre(page, tag), '1,2,3,4,5')
            assert.deepEqual(await sorts(page, tag), [])
          })
        })

        it('la ligne tenue garde le focus et la liste reste utilisable après le lâcher', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const cible = await centre(page, tag, 3)
            await saisir(page, tag, 0, cible.y + 5)
            await page.mouse.up()
            await page.waitForTimeout(400)
            assert.equal(await ordre(page, tag), '2,3,4,1,5')
            assert.equal(await actif(page, tag), '1', 'le focus est resté sur la ligne déplacée')
            const c2 = await centre(page, tag, 0)
            await saisir(page, tag, 0, (await centre(page, tag, 2)).y + 5)
            await page.mouse.up()
            await page.waitForTimeout(400)
            assert.equal(await ordre(page, tag), '3,4,2,1,5', 'un second geste enchaîne')
            assert.equal((await sorts(page, tag)).length, 2)
            assert.ok(c2.y > 0)
          })
        })
      })

      describe('doigt', () => {
        // pas de vrai doigt dans Firefox : des PointerEvent de type touch, envoyés comme le navigateur les enverrait ;
        // la chronologie se joue DANS la page (les attentes aussi), pour que la charge de la machine ne dérègle pas les 250 ms
        const geste = (page: any, tag: string, i: number, pas: Array<[string, number, number, number]>) => page.evaluate(async ([t, k, steps]: any[]) => {
          const el = (document.querySelector(t) as any)._shadow.querySelectorAll('.ligne')[k].querySelector('.t')
          const r = el.getBoundingClientRect()
          const x0 = r.x + r.width / 2
          const y0 = r.y + r.height / 2
          const marques = () => [...(document.querySelector(t) as any)._shadow.querySelectorAll('.ligne')].filter((n: any) => n.hasAttribute('mjs-sortable')).length
          const lectures: number[] = []
          for (const [ty, dx, dy, attente] of steps) {
            if (ty === 'lire') { lectures.push(marques()); continue }
            el.dispatchEvent(new PointerEvent(ty, { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, composed: true, clientX: x0 + dx, clientY: y0 + dy, button: ty === 'pointermove' ? -1 : 0, buttons: ty === 'pointerup' ? 0 : 1 }))
            if (attente) await new Promise((res) => setTimeout(res, attente))
          }
          return lectures
        }, [tag, i, pas]) as Promise<number[]>

        it('un balayage de plus de 10 px avant 250 ms laisse le défilement ; un appui long saisit la ligne', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const balayage = await geste(page, tag, 1, [['pointerdown', 0, 0, 0], ['pointermove', 0, 30, 400], ['pointermove', 0, 40, 0], ['lire', 0, 0, 0], ['pointerup', 0, 40, 0]])
            assert.deepEqual(balayage, [0], 'un balayage rapide ne saisit rien')
            await page.waitForTimeout(100)
            const appui = await geste(page, tag, 1, [['pointerdown', 0, 0, 0], ['pointermove', 0, 4, 120], ['lire', 0, 0, 0], ['pointermove', 0, 4, 330], ['lire', 0, 0, 0], ['pointermove', 0, 110, 0], ['pointerup', 0, 110, 0]])
            assert.equal(appui[0], 0, 'avant 250 ms rien ne part')
            assert.ok(appui[1] > 0, 'après 250 ms la ligne est saisie')
            await page.waitForTimeout(500)
            assert.equal(await ordre(page, tag), '1,3,4,2,5')
            const s = await sorts(page, tag)
            assert.equal(s.length, 1)
            assert.equal(s[0].from, 1)
            assert.equal(s[0].to, 3)
          })
        })

        it('vrai doigt (Chromium) : appui long puis glisser, la page ne défile pas', async function () {
          if (!present || nom !== 'chromium') { this.skip(); return }
          await essai(async (page, tag) => {
            const cdp = await page.context().newCDPSession(page)
            const p = await centre(page, tag, 0)
            const touche = (type: string, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y, id: 1 }] })
            await touche('touchStart', p.y)
            await page.waitForTimeout(400)
            await touche('touchMove', p.y + 60)
            await touche('touchMove', p.y + 110)
            await page.waitForTimeout(100)
            await touche('touchEnd', p.y + 110)
            await page.waitForTimeout(500)
            assert.equal(await ordre(page, tag), '2,3,1,4,5')
            assert.equal(await page.evaluate(() => window.scrollY), 0, 'la page n\'a pas défilé')
          }, { touch: true, viewport: { width: 800, height: 260 } })
        })
      })

      describe('clavier', () => {
        it('Espace saisit, les flèches déplacent, Espace pose : annonces, focus gardé, ordre, un seul sort', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, 1)
            await page.keyboard.press('Space')
            await page.waitForTimeout(150)
            assert.equal(await annonce(page, tag), FR.saisie(2, 5))
            assert.equal((await lignes(page, tag))[1].etat, 'held')
            await page.keyboard.press('ArrowDown')
            await page.waitForTimeout(150)
            assert.equal(await annonce(page, tag), FR.deplace(3, 5))
            assert.equal(await actif(page, tag), '2', 'le focus reste sur la ligne déplacée')
            await page.keyboard.press('ArrowDown')
            await page.waitForTimeout(150)
            assert.equal(await annonce(page, tag), FR.deplace(4, 5))
            await page.keyboard.press('ArrowUp')
            await page.waitForTimeout(150)
            assert.equal(await annonce(page, tag), FR.deplace(3, 5))
            assert.equal(await ordre(page, tag), '1,2,3,4,5', 'rien n\'est posé avant Espace')
            assert.deepEqual(await sorts(page, tag), [])
            await page.keyboard.press('Space')
            await page.waitForTimeout(400)
            assert.equal(await annonce(page, tag), FR.posee(3, 5))
            assert.equal(await ordre(page, tag), '1,3,2,4,5')
            const s = await sorts(page, tag)
            assert.equal(s.length, 1)
            assert.deepEqual(s[0], { from: 1, to: 2, item: { id: 2, titre: 'Bravo' }, order: [0, 2, 1, 3, 4] })
            assert.equal(await actif(page, tag), '2', 'le focus est gardé après la pose')
            assert.ok((await lignes(page, tag)).every((l) => l.etat === null && l.dy === ''))
          })
        })

        it('aux extrémités les flèches s\'arrêtent ; Échap annule : ordre inchangé, rien d\'émis, focus gardé', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, 0)
            await page.keyboard.press('Space')
            await page.keyboard.press('ArrowUp')
            await page.keyboard.press('ArrowDown')
            await page.keyboard.press('ArrowDown')
            await page.waitForTimeout(150)
            assert.equal(await annonce(page, tag), FR.deplace(3, 5))
            await page.keyboard.press('Escape')
            await page.waitForTimeout(300)
            assert.equal(await annonce(page, tag), FR.annule(1))
            assert.equal(await ordre(page, tag), '1,2,3,4,5')
            assert.deepEqual(await sorts(page, tag), [])
            assert.equal(await actif(page, tag), '1')
            assert.ok((await lignes(page, tag)).every((l) => l.etat === null && l.dy === ''))
            await page.keyboard.press('Space')
            for (let k = 0; k < 7; k++) await page.keyboard.press('ArrowDown')
            await page.keyboard.press('Space')
            await page.waitForTimeout(400)
            assert.equal(await ordre(page, tag), '2,3,4,5,1', 'la dernière place est la borne')
            assert.equal((await sorts(page, tag))[0].to, 4)
          })
        })

        it('une pose à la place de départ n\'émet rien ; les flèches hors geste ne déplacent rien', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, 2)
            await page.keyboard.press('ArrowDown')
            await page.waitForTimeout(100)
            assert.equal(await ordre(page, tag), '1,2,3,4,5')
            await page.keyboard.press('Space')
            await page.keyboard.press('ArrowDown')
            await page.keyboard.press('ArrowUp')
            await page.keyboard.press('Space')
            await page.waitForTimeout(300)
            assert.equal(await ordre(page, tag), '1,2,3,4,5')
            assert.deepEqual(await sorts(page, tag), [])
          })
        })

        it('une touche Espace tenue saisit la ligne sans la reposer aussitôt', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, 1)
            await page.keyboard.down('Space')
            await page.keyboard.down('Space')
            await page.keyboard.down('Space')
            await page.keyboard.up('Space')
            await page.waitForTimeout(200)
            assert.equal(await annonce(page, tag), FR.saisie(2, 5))
            assert.equal((await lignes(page, tag))[1].etat, 'held', 'la ligne est toujours saisie')
            await page.keyboard.press('Escape')
          })
        })

        it('une touche tapée dans un champ de la ligne reste au champ', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const c = await centre(page, tag, 1, '.champ')
            await page.mouse.click(c.x, c.y)
            await page.keyboard.press('Space')
            await page.waitForTimeout(100)
            assert.ok((await lignes(page, tag)).every((l) => l.etat === null), 'Espace dans un champ ne saisit pas la ligne')
            assert.match(await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelectorAll('.champ')[1].value as string, tag), /champ /)
          })
        })

        it('annonces en anglais quand la page est en anglais', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, 1)
            await page.keyboard.press('Space')
            await page.waitForTimeout(150)
            assert.equal(await annonce(page, tag), EN.saisie(2, 5))
            await page.keyboard.press('ArrowDown')
            await page.waitForTimeout(150)
            assert.equal(await annonce(page, tag), EN.deplace(3, 5))
            await page.keyboard.press('Space')
            await page.waitForTimeout(300)
            assert.equal(await annonce(page, tag), EN.posee(3, 5))
            await page.keyboard.press('Space')
            await page.keyboard.press('Escape')
            await page.waitForTimeout(200)
            assert.equal(await annonce(page, tag), EN.annule(3))
          }, { lang: 'en' })
        })

        it('le dictionnaire du projet passe avant les textes du module (mjs.core.sortableGrab)', async function () {
          if (!present || prod) { this.skip(); return }
          await essai(async (page, tag) => {
            await page.evaluate(() => { (window as any).µ._mjs_i18nLookup = (k: string) => k === 'mjs.core.sortableGrab' ? 'Saisi : {n} sur {total}' : undefined })
            await focaliser(page, tag, 1)
            await page.keyboard.press('Space')
            await page.waitForTimeout(150)
            assert.equal(await annonce(page, tag), 'Saisi : 2 sur 5')
            await page.keyboard.press('ArrowDown')
            await page.waitForTimeout(150)
            assert.equal(await annonce(page, tag), FR.deplace(3, 5), 'les autres textes restent ceux du module')
          })
        })

        it('la liste porte le rôle list, les lignes sont des éléments de liste focalisables', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const a = await page.evaluate((t: string) => ({ liste: (document.querySelector(t) as any)._shadow.querySelector('mjs-core-sortable')._shadow.querySelector('[role="list"]') !== null, lignes: [...(document.querySelector(t) as any)._shadow.querySelectorAll('.ligne')].map((n: any) => [n.getAttribute('role'), n.getAttribute('tabindex')]) }), tag)
            assert.ok(a.liste, 'la liste porte le rôle list')
            assert.deepEqual(a.lignes, [['listitem', '0'], ...Array(4).fill(['listitem', '-1'])], 'une seule ligne dans l\'ordre de tabulation')
          })
        })
      })

      describe('poignée', () => {
        it('avec handle, seule la poignée saisit à la souris ; le reste de la ligne garde le clic', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const t = await centre(page, tag, 0, '.t')
            await page.mouse.move(t.x, t.y)
            await page.mouse.down()
            await page.mouse.move(t.x, t.y + 60, { steps: 6 })
            assert.ok((await lignes(page, tag)).every((l) => l.etat === null), 'le titre ne saisit pas')
            await page.mouse.up()
            const g = await centre(page, tag, 0, '.grip')
            const cible = await centre(page, tag, 2)
            await page.mouse.move(g.x, g.y)
            await page.mouse.down()
            await page.mouse.move(g.x, g.y + 8, { steps: 2 })
            await page.mouse.move(g.x, cible.y + 5, { steps: 10 })
            assert.equal((await lignes(page, tag))[0].etat, 'held', 'la poignée saisit')
            await page.mouse.up()
            await page.waitForTimeout(400)
            assert.equal(await ordre(page, tag), '2,3,1,4,5')
            assert.equal((await sorts(page, tag)).length, 1)
          }, { tag: 'mjs-sh-page' })
        })
      })

      describe('liste calculée', () => {
        it('sans liaison, seul sort part, avec from et to : la page range sa liste', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            assert.equal(await texte(page, tag, 'vue'), '2,4,6')
            const cible = await centre(page, tag, 2)
            await saisir(page, tag, 0, cible.y + 5)
            await page.mouse.up()
            await page.waitForTimeout(400)
            assert.equal(await texte(page, tag, 'sorts'), '0>2', 'un seul sort, avec from et to')
            assert.equal(await texte(page, tag, 'ordre'), '1,4,3,6,5,2')
            assert.equal(await texte(page, tag, 'vue'), '4,6,2')
            assert.equal(await domIds(page, tag), '4,6,2')
          }, { tag: 'mjs-sc-page' })
        })

        it('sans liaison, si la page ne range rien, les lignes reviennent à leur place', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const cible = await centre(page, tag, 2)
            await saisir(page, tag, 0, cible.y + 5)
            await page.mouse.up()
            await page.waitForTimeout(400)
            assert.equal((await sorts(page, tag)).length, 1, 'sort part quand même')
            assert.equal(await domIds(page, tag), '1,2,3', 'ici le gestionnaire ne range rien : l\'ordre ne bouge pas')
            assert.ok((await lignes(page, tag)).every((l) => l.etat === null && l.dy === ''))
          }, { tag: 'mjs-sn-page' })
        })
      })

      describe('défilement au bord', () => {
        it('près du bord bas, la page défile seule ; on pose la ligne tout en bas', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const max0 = await page.evaluate(() => document.scrollingElement!.scrollHeight - window.innerHeight)
            const p = await centre(page, tag, 0)
            await page.mouse.move(p.x, p.y)
            await page.mouse.down()
            await page.mouse.move(p.x, p.y + 8, { steps: 2 })
            await page.mouse.move(p.x, 380, { steps: 8 })
            await page.waitForTimeout(900)
            const y = await page.evaluate(() => window.scrollY)
            assert.ok(y > 100, `la page a défilé seule (scrollY ${y})`)
            assert.ok(y <= max0 + 1, `elle ne défile pas au-delà de la fin de la page, que la ligne tenue ne doit pas rallonger (${y} pour ${max0})`)
            await page.mouse.up()
            await page.waitForTimeout(500)
            const ids = (await ordre(page, tag)).split(',')
            assert.ok(ids.indexOf('1') > 5, `la ligne 1 est descendue de plusieurs places (${ids.indexOf('1')})`)
            const s = await sorts(page, tag)
            assert.equal(s.length, 1)
            assert.equal(s[0].from, 0)
            assert.equal(s[0].to, ids.indexOf('1'))
            const apres = await page.evaluate(() => window.scrollY)
            await page.waitForTimeout(300)
            assert.equal(await page.evaluate(() => window.scrollY), apres, 'plus de défilement après le lâcher')
          }, { tag: 'mjs-sl-page', viewport: { width: 800, height: 420 } })
        })
      })

      describe('cadre qui défile', () => {
        it('dans une zone qui défile, c\'est elle qui défile près du bord, pas la page ; on pose la ligne plus bas', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const cadre = () => page.evaluate((t: string) => { const c = (document.querySelector(t) as any)._shadow.querySelector('.cadre'); const r = c.getBoundingClientRect(); return { haut: c.scrollTop as number, bas: r.bottom as number, x: r.x + 60, max: (c.scrollHeight - c.clientHeight) as number } }, tag)
            const c0 = await cadre()
            const p = await centre(page, tag, 0)
            await page.mouse.move(p.x, p.y)
            await page.mouse.down()
            await page.mouse.move(p.x, p.y + 8, { steps: 2 })
            await page.mouse.move(p.x, c0.bas - 20, { steps: 8 })
            await page.waitForTimeout(900)
            const c1 = await cadre()
            assert.ok(c1.haut > 100, `la zone a défilé seule (scrollTop ${c1.haut})`)
            assert.ok(c1.haut <= c0.max + 1, `elle ne défile pas au-delà de la fin de la liste, que la ligne tenue ne doit pas rallonger (${c1.haut} pour ${c0.max})`)
            assert.equal(await page.evaluate(() => window.scrollY), 0, 'la page n\'a pas bougé')
            await page.mouse.up()
            await page.waitForTimeout(500)
            const ids = (await ordre(page, tag)).split(',')
            assert.ok(ids.indexOf('1') > 5, `la ligne 1 est descendue de plusieurs places (${ids.indexOf('1')})`)
            const s = await sorts(page, tag)
            assert.equal(s.length, 1)
            assert.equal(s[0].to, ids.indexOf('1'))
            assert.equal(await domIds(page, tag), ids.join(','))
          }, { tag: 'mjs-sv-page', viewport: { width: 800, height: 600 } })
        })
      })

      describe('robustesse', () => {
        it('une ligne qui change de hauteur en plein geste : les places sont relues, l\'ordre final reste juste', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const cible = await centre(page, tag, 3)
            await saisir(page, tag, 0, cible.y + 5)
            await page.evaluate((t: string) => { (document.querySelector(t) as any)._shadow.querySelectorAll('.ligne')[1].style.height = '120px' }, tag)
            await page.waitForTimeout(300)
            const ls = await lignes(page, tag)
            await page.mouse.move(cible.x ?? 100, ls[4].top + 5, { steps: 6 })
            await page.waitForTimeout(200)
            await page.mouse.up()
            await page.waitForTimeout(400)
            const apres = await ordre(page, tag)
            assert.equal(apres, '2,3,4,1,5', `l'ordre suit les nouvelles hauteurs (${apres})`)
            assert.equal((await sorts(page, tag)).length, 1)
          })
        })

        it('retrait du module en plein geste : aucun écouteur, aucune minuterie, aucun observateur ne reste', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const repos = await page.evaluate(() => (window as any).__vivants())
            const ro0   = await page.evaluate(() => (window as any).__ro.size)
            const cible = await centre(page, tag, 3)
            await saisir(page, tag, 0, cible.y)
            const pendant = await page.evaluate(() => (window as any).__vivants())
            assert.ok(pendant.length > repos.length, 'des écouteurs sont posés pendant le geste')
            await page.evaluate((t: string) => { (window as any).__lignes = [...(document.querySelector(t) as any)._shadow.querySelectorAll('.ligne')] }, tag)
            const marquees = await page.evaluate(() => (window as any).__lignes.filter((n: any) => n.hasAttribute('mjs-sortable')).length)
            assert.ok(marquees > 0, 'des lignes portent leur marque pendant le geste')
            await page.evaluate((t: string) => { (document.querySelector(t) as any)._shadow.querySelector('button.retire').click() }, tag)
            await page.waitForTimeout(400)
            assert.equal(await page.evaluate((t: string) => !!(document.querySelector(t) as any)._shadow.querySelector('mjs-core-sortable'), tag), false, 'le module est retiré')
            const restes = await page.evaluate(() => (window as any).__lignes.map((n: any) => n.getAttributeNames().filter((a: string) => /^(mjs-sortable|style|role|tabindex|aria-roledescription|aria-description)/.test(a))))
            assert.deepEqual(restes, Array(5).fill([]), 'les lignes ne portent plus ni marque, ni style, ni rôle, ni tabindex, ni description posés par le module')
            assert.deepEqual(await page.evaluate(() => (window as any).__vivants()), repos, 'les écouteurs de window et document sont retirés')
            assert.equal(await page.evaluate(() => (window as any).__ro.size), ro0, 'aucun observateur de taille ne reste')
            await page.evaluate(() => { (window as any).__raf = 0; (window as any).__timers = 0 })
            await page.mouse.move(cible.x, 590, { steps: 4 })
            await page.mouse.up()
            await page.waitForTimeout(600)
            assert.equal(await page.evaluate(() => (window as any).__raf), 0, 'aucune image demandée après le retrait')
            assert.equal(await page.evaluate(() => (window as any).__timers), 0, 'aucune minuterie après le retrait')
            assert.deepEqual(await sorts(page, tag), [], 'rien d\'émis')
          }, { tag: 'mjs-sa-page', sonde: true })
        })

        it('au repos, et après un geste terminé, rien ne tourne', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const repos = await page.evaluate(() => (window as any).__vivants())
            const ro0   = await page.evaluate(() => (window as any).__ro.size)
            await page.evaluate(() => { (window as any).__raf = 0; (window as any).__timers = 0; (window as any).__intervals = 0 })
            await page.waitForTimeout(700)
            assert.equal(await page.evaluate(() => (window as any).__raf), 0, 'au repos : aucune image demandée')
            assert.equal(await page.evaluate(() => (window as any).__timers), 0, 'au repos : aucune minuterie')
            assert.equal(await page.evaluate(() => (window as any).__intervals), 0, 'au repos : aucun intervalle')
            const cible = await centre(page, tag, 2)
            await saisir(page, tag, 0, cible.y + 5)
            await page.mouse.up()
            await page.waitForTimeout(600)
            await page.evaluate(() => { (window as any).__raf = 0; (window as any).__timers = 0; (window as any).__intervals = 0 })
            await page.waitForTimeout(700)
            assert.deepEqual(await page.evaluate(() => (window as any).__vivants()), repos, 'après le geste : mêmes écouteurs qu\'avant')
            assert.equal(await page.evaluate(() => (window as any).__ro.size), ro0, 'après le geste : aucun observateur')
            assert.equal(await page.evaluate(() => (window as any).__raf), 0, 'après le geste : aucune image demandée')
            assert.equal(await page.evaluate(() => (window as any).__timers), 0, 'après le geste : aucune minuterie')
            assert.equal(await page.evaluate(() => (window as any).__intervals), 0, 'après le geste : aucun intervalle')
          }, { sonde: true })
        })
      })
    })
  }
}
