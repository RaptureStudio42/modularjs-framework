// `<@@sortable group="…">` : les groupes. Deux listes du même groupe s'échangent leurs lignes : deux listes sœurs côte à côte, ou deux
// niveaux (une ligne entre dans un groupe, en sort). À la souris, au doigt (appui long simulé) et au clavier (droite et gauche).
// Les deux `value` sont remises à jour (même objet), `sort` part UNE fois par geste, de la liste d'arrivée, avec `source` ; groupes
// différents ou absents : aucun échange ; une liste vide reste une cible ; une section ne plonge pas dans les listes des autres ;
// un appui dans la liste intérieure ne saisit que la ligne intérieure ; défilement au bord d'une liste à l'autre ; annonces fr / en.
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
  .lc
    width: 220px
  .vide
    min-height: 60px
    border: 1px dashed #999
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
  .ligne
    box-sizing: border-box
    height: 40px
    margin-bottom: 6px
    padding: 0 10px
    border: 1px solid #999
    background: #fff
    line-height: 38px
  .espace
    height: 700px
  .petit
    height: 30px
  .cadre
    box-sizing: border-box
    height: 220px
    overflow-y: auto
    border: 1px solid #999
</style>`

const KEEP = 'keep = (e)-> $sorts = $sorts.concat([JSON.stringify({ from: e.data.from, to: e.data.to, item: e.data.item, order: e.data.order, source: e.data.source?.dataset?.id ?? e.data.source?.classList[0] ?? null, on: e.target.dataset?.id ?? e.target.classList[0], a: ids($a), b: ids($b) })])'

const LIGNE = '<div class="ligne" data-id={et.id}><span class="t">{et.titre}</span></div>'

const A3 = '[{ id: 1, titre: \'A1\' }, { id: 2, titre: \'A2\' }, { id: 3, titre: \'A3\' }]'
const B2 = '[{ id: 4, titre: \'B1\' }, { id: 5, titre: \'B2\' }]'
const C2 = '[{ id: 6, titre: \'C1\' }, { id: 7, titre: \'C2\' }]'
const MENU = '[{ id: \'e1\', nom: \'Pain\' }, { id: \'m1\', sec: true, nom: \'Entrées\', lignes: [{ id: \'l11\', nom: \'Soupe\' }, { id: \'l12\', nom: \'Salade\' }] }, { id: \'m2\', sec: true, nom: \'Plats\', lignes: [{ id: \'l21\', nom: \'Pâtes\' }, { id: \'l22\', nom: \'Riz\' }, { id: \'l23\', nom: \'Poulet\' }] }, { id: \'m3\', sec: true, nom: \'Desserts\', lignes: [] }]'

const SOURCES: Record<string, string> = {
  'gs-page.mjs': `<script>
  $a = ${A3}
  $b = ${B2}
  $sorts = []
  ids = (l)-> l.map((x)-> x.id).join(',')
  keep = (e)->
    e.data.item.marque = 'vu'
    $sorts = $sorts.concat([JSON.stringify({ from: e.data.from, to: e.data.to, item: e.data.item, order: e.data.order, source: e.data.source?.dataset?.id ?? e.data.source?.classList[0] ?? null, on: e.target.dataset?.id ?? e.target.classList[0], a: ids($a), b: ids($b), meme: $b.some((x)-> x.marque is 'vu') })])
</script>
<div class="cols">
  <@@sortable class="la" value=!{$a} group="g" @sort={keep(e)}>
    {for et in $a by id}
      ${LIGNE}
    {end}
  </@@sortable>
  <@@sortable class="lb" value=!{$b} group="g" @sort={keep(e)}>
    {for et in $b by id}
      ${LIGNE}
    {end}
  </@@sortable>
</div>
<p class="ordre">{ids($a)}|{ids($b)}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`,
  'gd-page.mjs': `<script>
  $a = ${A3}
  $b = ${B2}
  $c = ${C2}
  $sorts = []
  ids = (l)-> l.map((x)-> x.id).join(',')
  ${KEEP}
</script>
<div class="cols">
  <@@sortable class="la" value=!{$a} group="x" @sort={keep(e)}>
    {for et in $a by id}
      ${LIGNE}
    {end}
  </@@sortable>
  <@@sortable class="lb" value=!{$b} group="y" @sort={keep(e)}>
    {for et in $b by id}
      ${LIGNE}
    {end}
  </@@sortable>
  <@@sortable class="lc" value=!{$c} @sort={keep(e)}>
    {for et in $c by id}
      ${LIGNE}
    {end}
  </@@sortable>
</div>
<p class="ordre">{ids($a)}|{ids($b)}|{ids($c)}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`,
  'gc-page.mjs': `<script>
  $cols = { a: ${A3}, b: ${B2} }
  $sorts = []
  ids = (c)-> c.a.map((x)-> x.id).join(',') + '|' + c.b.map((x)-> x.id).join(',')
  moved = (to, e)->
    src  = e.data.source?.dataset?.k ?? to
    next = { a: $cols.a.slice(), b: $cols.b.slice() }
    item = next[src].splice(e.data.from, 1)[0]
    next[to].splice(e.data.to, 0, item)
    $cols = next
    $sorts = $sorts.concat([JSON.stringify({ from: e.data.from, to: e.data.to, item: e.data.item, src: src, dst: to })])
</script>
<div class="cols">
  <@@sortable class="la" data-k="a" group="g" @sort={moved('a', e)}>
    {for et in $cols.a by id}
      ${LIGNE}
    {end}
  </@@sortable>
  <@@sortable class="lb" data-k="b" group="g" @sort={moved('b', e)}>
    {for et in $cols.b by id}
      ${LIGNE}
    {end}
  </@@sortable>
</div>
<p class="ordre">{ids($cols)}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`,
  'ge-page.mjs': `<script>
  $a = ${A3}
  $b = []
  $c = []
  $sorts = []
  ids = (l)-> l.map((x)-> x.id).join(',')
  ${KEEP}
</script>
<@@sortable class="la" value=!{$a} group="g" @sort={keep(e)}>
  {for et in $a by id}
    ${LIGNE}
  {end}
</@@sortable>
<@@sortable class="lb" value=!{$b} group="g" @sort={keep(e)}>
  {for et in $b by id}
    ${LIGNE}
  {end}
</@@sortable>
<div class="petit"></div>
<@@sortable class="lc vide" value=!{$c} group="g" @sort={keep(e)}>
  {for et in $c by id}
    ${LIGNE}
  {end}
</@@sortable>
<p class="ordre">{ids($a)}|{ids($b)}|{ids($c)}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`,
  'gv-page.mjs': `<script>
  $a = ${A3}
  $b = ${B2}
  $sorts = []
  ids = (l)-> l.map((x)-> x.id).join(',')
  ${KEEP}
</script>
<@@sortable class="la" value=!{$a} group="g" @sort={keep(e)}>
  {for et in $a by id}
    ${LIGNE}
  {end}
</@@sortable>
<div class="espace"></div>
<@@sortable class="lb" value=!{$b} group="g" @sort={keep(e)}>
  {for et in $b by id}
    ${LIGNE}
  {end}
</@@sortable>
<p class="ordre">{ids($a)}|{ids($b)}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`,
  'gf-page.mjs': `<script>
  $a = ${A3}
  $b = ${B2}
  $sorts = []
  ids = (l)-> l.map((x)-> x.id).join(',')
  ${KEEP}
</script>
<div class="cadre">
  <@@sortable class="la" value=!{$a} group="g" @sort={keep(e)}>
    {for et in $a by id}
      ${LIGNE}
    {end}
  </@@sortable>
  <div class="espace"></div>
  <@@sortable class="lb" value=!{$b} group="g" @sort={keep(e)}>
    {for et in $b by id}
      ${LIGNE}
    {end}
  </@@sortable>
</div>
<p class="ordre">{ids($a)}|{ids($b)}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`,
  'gr-page.mjs': `<script>
  $on = true
  $a = ${A3}
  $b = ${B2}
  $sorts = []
  ids = (l)-> l.map((x)-> x.id).join(',')
  ${KEEP}
</script>
<div class="cols">
  <@@sortable class="la" value=!{$a} group="g" @sort={keep(e)}>
    {for et in $a by id}
      ${LIGNE}
    {end}
  </@@sortable>
  {if $on}
    <@@sortable class="lb" value=!{$b} group="g" @sort={keep(e)}>
      {for et in $b by id}
        ${LIGNE}
      {end}
    </@@sortable>
  {end}
</div>
<button class="bascule" @click={$on = not $on}>bascule</button>
<p class="ordre">{ids($a)}|{ids($b)}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`,
  'gn-page.mjs': `<script>
  $menu = ${MENU}
  $sorts = []
  $inner = 0
  layout = (l)-> l.map((x)-> if x.sec then x.id + ':' + x.lignes.map((y)-> y.id).join(',') else x.id).join(' ')
  keep = (e)-> $sorts = $sorts.concat([JSON.stringify({ from: e.data.from, to: e.data.to, item: e.data.item, order: e.data.order, source: e.data.source?.dataset?.id ?? e.data.source?.classList[0] ?? null, on: e.target.dataset?.id ?? e.target.classList[0] })])
</script>
<@@sortable class="menu" value=!{$menu} group="menu" @sort={keep(e)}>
  {for d in $menu by id}
    {if d.sec}
      <section class="groupe" data-id={d.id}>
        <h3 class="titre">{d.nom}</h3>
        <@@sortable class="lignes" data-id={d.id} value=!{d.lignes} group="menu" @sort.propagate={$inner++}>
          {for l in d.lignes by id}
            <div class="ligne" data-id={l.id}><span class="t">{l.nom}</span></div>
          {end}
        </@@sortable>
      </section>
    {else}
      <div class="ligne solo" data-id={d.id}><span class="t">{d.nom}</span></div>
    {end}
  {end}
</@@sortable>
<p class="ordre">{layout($menu)}</p>
<p class="inner">{$inner}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`
}

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
})();`

const FR = {
  saisie:  (n: number, t: number) => `Ligne saisie, place ${n} sur ${t}. Flèches haut et bas pour la déplacer, Espace pour la poser, Échap pour annuler`,
  groupe:  (n: number, t: number) => `Ligne saisie, place ${n} sur ${t}. Flèches haut et bas pour la déplacer, droite et gauche pour changer de groupe, Espace pour la poser, Échap pour annuler`,
  deplace: (n: number, t: number) => `Déplacée en place ${n} sur ${t}`,
  posee:   (n: number, t: number) => `Ligne posée en place ${n} sur ${t}`,
  annule:  (n: number) => `Déplacement annulé, ligne remise en place ${n}`,
  saut:    (liste: string, n: number, t: number) => `Déplacée dans ${liste}, place ${n} sur ${t}`,
  entree:  (liste: string, n: number, t: number) => `Entrée dans ${liste}, place ${n} sur ${t}`,
  sortie:  (liste: string, n: number, t: number) => `Sortie vers ${liste}, place ${n} sur ${t}`
}

const EN = {
  groupe:  (n: number, t: number) => `Row grabbed, position ${n} of ${t}. Up and down arrows move it, left and right arrows change group, Space drops it, Escape cancels`,
  posee:   (n: number, t: number) => `Row dropped at position ${n} of ${t}`,
  annule:  (n: number) => `Move cancelled, row back at position ${n}`,
  entree:  (liste: string, n: number, t: number) => `Entered ${liste}, position ${n} of ${t}`,
  sortie:  (liste: string, n: number, t: number) => `Moved out to ${liste}, position ${n} of ${t}`
}

async function construire(prod: boolean): Promise<{ root: string, script: string }> {
  const root   = mjsTmp('sortable-groupes-' + (prod ? 'prod' : 'dev'))
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

type Marque = { top: number, left: number, height: number, etat: string | null, dy: string, dx: string, style: string | null }

for (const prod of [false, true]) {
  for (const nom of ['chromium', 'firefox'] as const) {
    describe(`<@@sortable group> : les groupes (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
      this.timeout(240000)
      let present = false
      let script  = ''
      let racine  = ''
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test des groupes sauté`)
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

      type Opts = { tag?: string, lang?: string, viewport?: { width: number, height: number }, sonde?: boolean, touch?: boolean, listes?: number }

      async function essai(fn: (page: any, tag: string) => Promise<void>, opts: Opts = {}) {
        const tag     = opts.tag ?? 'mjs-gs-page'
        const context = await browser.newContext({ viewport: opts.viewport ?? { width: 800, height: 600 }, ...(opts.touch ? { hasTouch: true } : {}) })
        try {
          const page = await context.newPage()
          page.setDefaultTimeout(5000)
          page.setDefaultNavigationTimeout(30000)
          const erreurs: string[] = []
          const avis: string[] = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') avis.push(m.text().slice(0, 300)) })
          if (opts.sonde) await page.addInitScript(SONDE)
          await page.addInitScript('window.__sortEvents = 0; document.addEventListener(\'sort\', () => { window.__sortEvents++ })')
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
            await page.waitForFunction(([t, n]: any) => { const ls = (document.querySelector(t) as any)?._shadow?.querySelectorAll('mjs-core-sortable'); return !!ls && ls.length >= n && [...ls].every((l: any) => l._shadow?.querySelector('slot')) }, [tag, opts.listes ?? 2])
          } catch (e: any) {
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

      const ligne  = (id: string) => `.ligne[data-id="${id}"]`
      const t      = (id: string) => `.ligne[data-id="${id}"] .t`
      const centre = (page: any, tag: string, q: string) => page.evaluate(([tg, s]: string[]) => { const r = (document.querySelector(tg) as any)._shadow.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.left, top: r.top, width: r.width, height: r.height } }, [tag, q]) as Promise<{ x: number, y: number, left: number, top: number, width: number, height: number }>
      const marques = (page: any, tag: string) => page.evaluate((tg: string) => Object.fromEntries([...(document.querySelector(tg) as any)._shadow.querySelectorAll('.ligne, .groupe')].map((n: any) => { const b = n.getBoundingClientRect(); return [n.dataset.id, { top: b.top, left: b.left, height: b.height, etat: n.getAttribute('mjs-sortable'), dy: n.style.getPropertyValue('--mjs-sortable-dy'), dx: n.style.getPropertyValue('--mjs-sortable-dx'), style: n.getAttribute('style') }] })), tag) as Promise<Record<string, Marque>>
      const repos   = (m: Record<string, Marque>) => Object.values(m).every((x) => x.etat === null && x.dy === '' && x.dx === '' && x.style === null)
      const listes  = (page: any, tag: string) => page.evaluate((tg: string) => Object.fromEntries([...(document.querySelector(tg) as any)._shadow.querySelectorAll('mjs-core-sortable')].map((h: any) => [h.dataset.id ?? h.className.split(' ')[0], [...h.children].map((c: any) => c.dataset.id).join(',')])), tag) as Promise<Record<string, string>>
      const texte   = (page: any, tag: string, cls: string) => page.evaluate(([tg, c]: string[]) => (document.querySelector(tg) as any)._shadow.querySelector('p.' + c).textContent as string, [tag, cls])
      const sorts   = async (page: any, tag: string) => { const s = await texte(page, tag, 'sorts'); return s === '' ? [] : s.split('|').map((x) => JSON.parse(x)) }
      const annonce = (page: any, tag: string, hote: string) => page.evaluate(([tg, h]: string[]) => ((document.querySelector(tg) as any)._shadow.querySelector(h)._shadow.querySelector('.live').textContent as string).trim(), [tag, hote]) as Promise<string>
      const actif   = (page: any, tag: string) => page.evaluate((tg: string) => (document.querySelector(tg) as any)._shadow.activeElement?.dataset?.id ?? null, tag) as Promise<string | null>
      const focaliser = (page: any, tag: string, q: string) => page.evaluate(([tg, s]: string[]) => (document.querySelector(tg) as any)._shadow.querySelector(s).focus(), [tag, q])
      const touche  = async (page: any, ...ts: string[]) => { for (const k of ts) { await page.keyboard.press(k); await page.waitForTimeout(200) } }
      const evenements = (page: any) => page.evaluate(() => (window as any).__sortEvents) as Promise<number>

      async function glisser(page: any, tag: string, depart: string, vers: { x: number, y: number }) {
        const p = await centre(page, tag, depart)
        await page.mouse.move(p.x, p.y)
        await page.mouse.down()
        await page.mouse.move(p.x + 4, p.y + 8, { steps: 2 })
        await page.mouse.move(vers.x, vers.y, { steps: 14 })
        return p
      }

      // pas de vrai doigt dans Firefox : des PointerEvent de type touch, joués DANS la page avec leurs attentes (les 250 ms d'appui ne dépendent pas de la charge)
      const geste = (page: any, tag: string, depart: string, pas: Array<[string, number, number, number]>) => page.evaluate(async ([tg, q, steps]: any[]) => {
        const el = (document.querySelector(tg) as any)._shadow.querySelector(q)
        const r = el.getBoundingClientRect()
        const x0 = r.x + r.width / 2
        const y0 = r.y + r.height / 2
        const marquees = () => [...(document.querySelector(tg) as any)._shadow.querySelectorAll('.ligne, .groupe')].filter((n: any) => n.hasAttribute('mjs-sortable')).length
        const lectures: number[] = []
        for (const [ty, dx, dy, attente] of steps) {
          if (ty === 'lire') { lectures.push(marquees()); continue }
          el.dispatchEvent(new PointerEvent(ty, { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, composed: true, clientX: x0 + dx, clientY: y0 + dy, button: ty === 'pointermove' ? -1 : 0, buttons: ty === 'pointerup' ? 0 : 1 }))
          if (attente) await new Promise((res) => setTimeout(res, attente))
        }
        return lectures
      }, [tag, depart, pas]) as Promise<number[]>

      describe('souris : deux listes sœurs', () => {
        it('une ligne passe de A à B : A se referme, B s\'ouvre, les deux value changent (même objet), sort part une fois, de B, avec source', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const avant = await marques(page, tag)
            const b2 = await centre(page, tag, t('5'))
            const p = await glisser(page, tag, t('1'), { x: b2.x, y: b2.y - 10 })
            await page.waitForTimeout(300)
            const m = await marques(page, tag)
            const pas = avant['2'].top - avant['1'].top
            assert.equal(m['1'].etat, 'held')
            assert.ok(Math.abs(m['2'].top - (avant['2'].top - pas)) < 2, `A2 remonte, la liste de départ se referme (${m['2'].top} / ${avant['2'].top - pas})`)
            assert.ok(Math.abs(m['3'].top - (avant['3'].top - pas)) < 2, 'A3 remonte')
            assert.ok(Math.abs(m['4'].top - avant['4'].top) < 1, 'B1 reste')
            assert.ok(Math.abs(m['5'].top - (avant['5'].top + pas)) < 2, `B2 descend, la liste d'arrivée s'ouvre (${m['5'].top} / ${avant['5'].top + pas})`)
            assert.ok(Math.abs(m['1'].left - (avant['1'].left + (b2.x - p.x))) < 2, 'la ligne tenue suit le pointeur aussi à l\'horizontale')
            assert.ok(Math.abs((m['1'].top + m['1'].height / 2) - (b2.y - 10)) < 3, 'et à la verticale')
            assert.equal(await texte(page, tag, 'ordre'), '1,2,3|4,5', 'rien n\'est rendu avant le lâcher')
            await page.mouse.up()
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), '2,3|4,1,5')
            assert.deepEqual(await listes(page, tag), { la: '2,3', lb: '4,1,5' }, 'les lignes aussi')
            const s = await sorts(page, tag)
            assert.equal(s.length, 1, 'sort part une seule fois')
            assert.equal(await evenements(page), 1, 'un seul événement sort pour tout le geste, au niveau du document')
            assert.deepEqual(s[0], { from: 0, to: 1, item: { id: 1, titre: 'A1', marque: 'vu' }, source: 'la', on: 'lb', a: '2,3', b: '4,1,5', meme: true }, 'les deux value sont déjà à jour quand sort part, et la ligne arrivée dans B est le même objet que celui de A')
            assert.ok(repos(await marques(page, tag)), 'plus aucune marque')
          })
        })

        it('de B vers le début de A, puis de B vers la fin de A : chaque pose change les deux listes', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const a1 = await centre(page, tag, t('1'))
            await glisser(page, tag, t('4'), { x: a1.x, y: a1.y - 12 })
            await page.mouse.up()
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), '4,1,2,3|5')
            const a3 = await centre(page, tag, t('3'))
            await glisser(page, tag, t('5'), { x: a3.x, y: a3.y + 30 })
            await page.mouse.up()
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), '4,1,2,3,5|')
            const s = await sorts(page, tag)
            assert.equal(s.length, 2)
            assert.deepEqual([s[0].from, s[0].to, s[0].source, s[0].on], [0, 0, 'lb', 'la'])
            assert.deepEqual([s[1].from, s[1].to, s[1].source, s[1].on], [0, 4, 'lb', 'la'])
          })
        })

        it('revenir sur la place de départ avant le lâcher, ou lâcher hors de toute liste, ou Échap : rien ne bouge, rien ne part', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const avant = await marques(page, tag)
            const b2 = await centre(page, tag, t('5'))
            const p = await glisser(page, tag, t('1'), { x: b2.x, y: b2.y - 10 })
            await page.mouse.move(p.x, p.y, { steps: 10 })
            await page.waitForTimeout(300)
            const m = await marques(page, tag)
            assert.ok(['2', '3', '4', '5'].every((id) => Math.abs(m[id].top - avant[id].top) < 1.5), 'de retour sur sa place, les autres lignes aussi')
            await page.mouse.up()
            await page.waitForTimeout(300)
            assert.equal(await texte(page, tag, 'ordre'), '1,2,3|4,5')
            assert.deepEqual(await sorts(page, tag), [])
            await glisser(page, tag, t('2'), { x: b2.x, y: b2.y - 10 })
            await page.mouse.move(700, 560, { steps: 8 })
            await page.waitForTimeout(300)
            const loin = await marques(page, tag)
            assert.ok(['1', '3', '4', '5'].every((id) => Math.abs(loin[id].top - avant[id].top) < 1.5), 'hors de toute liste les autres reprennent leur place')
            await page.mouse.up()
            await page.waitForTimeout(300)
            assert.equal(await texte(page, tag, 'ordre'), '1,2,3|4,5', 'lâcher hors de toute liste : annulé')
            assert.deepEqual(await sorts(page, tag), [])
            await glisser(page, tag, t('3'), { x: b2.x, y: b2.y - 10 })
            await page.keyboard.press('Escape')
            await page.waitForTimeout(300)
            await page.mouse.up()
            await page.waitForTimeout(200)
            assert.equal(await texte(page, tag, 'ordre'), '1,2,3|4,5', 'Échap : annulé')
            assert.deepEqual(await sorts(page, tag), [])
            assert.ok(repos(await marques(page, tag)), 'plus aucune marque')
          })
        })

        it('une liste vide est une cible, même sans hauteur ; elle reçoit la ligne comme seule ligne', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const zb = await page.evaluate((tg: string) => { const r = (document.querySelector(tg) as any)._shadow.querySelector('.lb').getBoundingClientRect(); return { x: r.x + 60, y: r.y, h: r.height } }, tag)
            assert.ok(zb.h < 2, `la liste B n'a aucune hauteur (${zb.h})`)
            await glisser(page, tag, t('1'), { x: zb.x, y: zb.y + 2 })
            await page.mouse.up()
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), '2,3|1|')
            const c = await centre(page, tag, '.lc')
            await glisser(page, tag, t('2'), { x: c.x, y: c.y })
            await page.mouse.up()
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), '3|1|2')
            assert.deepEqual(await listes(page, tag), { la: '3', lb: '1', lc: '2' })
            const s = await sorts(page, tag)
            assert.deepEqual(s.map((x: any) => [x.from, x.to, x.source, x.on]), [[0, 0, 'la', 'lb'], [0, 0, 'la', 'lc']])
            assert.ok(repos(await marques(page, tag)))
          }, { tag: 'mjs-ge-page', listes: 3 })
        })
      })

      describe('souris : groupes différents ou absents', () => {
        it('aucun échange : ni vers un autre groupe, ni vers une liste sans groupe ; le tri dans sa propre liste marche', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const avant = await marques(page, tag)
            const b2 = await centre(page, tag, t('5'))
            await glisser(page, tag, t('1'), { x: b2.x, y: b2.y - 10 })
            await page.waitForTimeout(300)
            const m = await marques(page, tag)
            assert.ok(['4', '5'].every((id) => m[id].etat === null), 'l\'autre groupe ne s\'ouvre pas')
            assert.ok(['2', '3'].every((id) => Math.abs(m[id].top - avant[id].top) < 1.5), 'la liste de départ ne se referme pas')
            await page.mouse.up()
            await page.waitForTimeout(300)
            const c2 = await centre(page, tag, t('7'))
            await glisser(page, tag, t('2'), { x: c2.x, y: c2.y - 10 })
            await page.mouse.up()
            await page.waitForTimeout(300)
            assert.equal(await texte(page, tag, 'ordre'), '1,2,3|4,5|6,7', 'rien n\'a changé de liste')
            assert.deepEqual(await sorts(page, tag), [])
            const a3 = await centre(page, tag, t('3'))
            await glisser(page, tag, t('1'), { x: a3.x, y: a3.y + 5 })
            await page.mouse.up()
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), '2,3,1|4,5|6,7')
            const s = await sorts(page, tag)
            assert.equal(s.length, 1)
            assert.equal(s[0].source, null, 'sort d\'une liste seule : pas de source')
            assert.deepEqual(s[0].order, [1, 2, 0])
          }, { tag: 'mjs-gd-page', listes: 3 })
        })
      })

      describe('souris : deux niveaux', () => {
        it('une ligne entre dans le groupe voisin (au milieu de ses lignes) : sort part une fois, de la liste d\'arrivée, et l\'extérieure l\'entend une fois', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const l22 = await centre(page, tag, t('l22'))
            await glisser(page, tag, t('l11'), { x: l22.x, y: l22.y - 10 })
            await page.waitForTimeout(300)
            await page.mouse.up()
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), 'e1 m1:l12 m2:l21,l11,l22,l23 m3:')
            assert.deepEqual(await listes(page, tag), { menu: 'e1,m1,m2,m3', m1: 'l12', m2: 'l21,l11,l22,l23', m3: '' })
            const s = await sorts(page, tag)
            assert.equal(s.length, 1, 'l\'extérieure entend un seul sort')
            assert.equal(await evenements(page), 1, 'un seul événement sort pour tout le geste, au niveau du document')
            assert.deepEqual(s[0], { from: 0, to: 1, item: { id: 'l11', nom: 'Soupe' }, source: 'm1', on: 'm2' })
            assert.equal(await texte(page, tag, 'inner'), '1', 'la liste d\'arrivée l\'entend une fois')
            assert.ok(repos(await marques(page, tag)))
          }, { tag: 'mjs-gn-page', listes: 4 })
        })

        it('une ligne entre dans un groupe vide', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const z = await centre(page, tag, '.lignes[data-id="m3"]')
            await glisser(page, tag, t('l23'), { x: z.x, y: z.y })
            await page.mouse.up()
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), 'e1 m1:l11,l12 m2:l21,l22 m3:l23')
            const s = await sorts(page, tag)
            assert.deepEqual(s.map((x: any) => [x.from, x.to, x.source, x.on]), [[2, 0, 'm2', 'm3']])
          }, { tag: 'mjs-gn-page', listes: 4 })
        })

        it('une ligne sort de son groupe vers la liste extérieure : elle devient une ligne de premier niveau, avant le groupe survolé', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const titre = await centre(page, tag, '.groupe[data-id="m2"] .titre')
            await glisser(page, tag, t('l12'), { x: titre.x, y: titre.y })
            await page.waitForTimeout(300)
            await page.mouse.up()
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), 'e1 m1:l11 l12 m2:l21,l22,l23 m3:')
            const s = await sorts(page, tag)
            assert.equal(s.length, 1)
            assert.deepEqual(s[0], { from: 1, to: 2, item: { id: 'l12', nom: 'Salade' }, source: 'm1', on: 'menu' })
            assert.equal(await texte(page, tag, 'inner'), '0', 'aucune liste intérieure ne l\'entend')
            assert.ok(repos(await marques(page, tag)))
          }, { tag: 'mjs-gn-page', listes: 4 })
        })

        it('un appui dans la liste intérieure ne saisit que la ligne intérieure ; un appui sur l\'en-tête saisit le groupe, qui se range sans plonger dans les listes des autres', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const l21 = await centre(page, tag, t('l21'))
            await page.mouse.move(l21.x, l21.y)
            await page.mouse.down()
            await page.mouse.move(l21.x, l21.y + 20, { steps: 4 })
            const m = await marques(page, tag)
            assert.equal(m.l21.etat, 'held')
            assert.equal(Object.entries(m).filter(([id, x]) => x.etat === 'held').length, 1, 'une seule ligne tenue')
            assert.equal(m.m2.etat, null, 'le groupe n\'est pas saisi')
            await page.keyboard.press('Escape')
            await page.mouse.up()
            await page.waitForTimeout(300)
            assert.deepEqual(await sorts(page, tag), [])
            const m1 = await centre(page, tag, '.groupe[data-id="m1"]')
            const m2 = await centre(page, tag, '.groupe[data-id="m2"]')
            const titre = await centre(page, tag, '.groupe[data-id="m1"] .titre')
            const cible = m2.top + m2.height / 2 + 10
            await glisser(page, tag, '.groupe[data-id="m1"] .titre', { x: titre.x, y: cible + (titre.y - m1.y) })
            await page.waitForTimeout(300)
            const pendant = await marques(page, tag)
            assert.equal(pendant.m1.etat, 'held', 'le groupe est tenu')
            assert.ok(['l11', 'l12', 'l21', 'l22', 'l23'].every((id) => pendant[id].etat === null), 'aucune ligne n\'est marquée : le groupe ne plonge pas dans les listes')
            await page.mouse.up()
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), 'e1 m2:l21,l22,l23 m1:l11,l12 m3:', 'chaque groupe garde ses lignes')
            assert.deepEqual(await listes(page, tag), { menu: 'e1,m2,m1,m3', m1: 'l11,l12', m2: 'l21,l22,l23', m3: '' })
            const s = await sorts(page, tag)
            assert.equal(s.length, 1)
            assert.deepEqual([s[0].from, s[0].to, s[0].source, s[0].on], [1, 2, null, 'menu'])
            assert.equal(await texte(page, tag, 'inner'), '0')
            assert.equal(await evenements(page), 1)
          }, { tag: 'mjs-gn-page', listes: 4 })
        })

        it('le tri dans sa propre liste intérieure : sort part de cette liste et remonte une fois à l\'extérieure', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const l23 = await centre(page, tag, t('l23'))
            await glisser(page, tag, t('l21'), { x: l23.x, y: l23.y + 5 })
            await page.mouse.up()
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), 'e1 m1:l11,l12 m2:l22,l23,l21 m3:')
            const s = await sorts(page, tag)
            assert.equal(s.length, 1)
            assert.deepEqual(s[0], { from: 0, to: 2, item: { id: 'l21', nom: 'Pâtes' }, order: [1, 2, 0], on: 'm2', source: null })
            assert.equal(await texte(page, tag, 'inner'), '1')
          }, { tag: 'mjs-gn-page', listes: 4 })
        })
      })

      describe('doigt (simulé)', () => {
        it('un appui long saisit la ligne, on la porte dans la liste sœur, on lève le doigt : elle y est', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const p = await centre(page, tag, t('1'))
            const b2 = await centre(page, tag, t('5'))
            const dx = b2.x - p.x
            const dy = b2.y - 10 - p.y
            const lu = await geste(page, tag, t('1'), [['pointerdown', 0, 0, 0], ['pointermove', 0, 3, 330], ['lire', 0, 0, 0], ['pointermove', dx / 2, dy / 2, 60], ['pointermove', dx, dy, 120], ['pointerup', dx, dy, 0]])
            assert.ok(lu[0] > 0, 'après 250 ms la ligne est saisie')
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), '2,3|4,1,5')
            const s = await sorts(page, tag)
            assert.equal(s.length, 1)
            assert.deepEqual([s[0].from, s[0].to, s[0].source, s[0].on], [0, 1, 'la', 'lb'])
          })
        })

        it('deux niveaux : une ligne portée au doigt entre dans le groupe voisin', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const p = await centre(page, tag, t('l11'))
            const c = await centre(page, tag, t('l22'))
            const dx = c.x - p.x
            const dy = c.y - 10 - p.y
            await geste(page, tag, t('l11'), [['pointerdown', 0, 0, 0], ['pointermove', 0, 3, 330], ['pointermove', dx / 2, dy / 2, 60], ['pointermove', dx, dy, 120], ['pointerup', dx, dy, 0]])
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), 'e1 m1:l12 m2:l21,l11,l22,l23 m3:')
            assert.equal((await sorts(page, tag)).length, 1)
          }, { tag: 'mjs-gn-page', listes: 4 })
        })
      })

      describe('clavier : deux listes sœurs', () => {
        it('Droite passe à l\'autre liste, Bas règle la place, Gauche revient, Droite puis Espace pose : annonces, focus gardé, value des deux listes', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, ligne('2'))
            await touche(page, 'Space')
            assert.equal(await annonce(page, tag, '.la'), FR.groupe(2, 3))
            await touche(page, 'ArrowRight')
            assert.equal(await annonce(page, tag, '.la'), FR.saut('la liste 2 sur 2', 2, 3), 'dans l\'autre liste, à la même place')
            const m = await marques(page, tag)
            const zb = await centre(page, tag, '.lb')
            assert.equal(m['2'].etat, 'held')
            assert.ok(Math.abs(m['2'].left - zb.left) < 3, `la ligne tenue est passée dans la colonne de B (${m['2'].left} / ${zb.left})`)
            assert.ok(m['5'].dy !== '' && parseFloat(m['5'].dy) > 40, 'B2 s\'écarte pour lui faire place')
            await touche(page, 'ArrowDown', 'ArrowDown')
            assert.equal(await annonce(page, tag, '.la'), FR.deplace(3, 3), 'la dernière place est la borne')
            await touche(page, 'ArrowLeft')
            assert.equal(await annonce(page, tag, '.la'), FR.saut('la liste 1 sur 2', 3, 3), 'de retour dans A, au bout')
            await touche(page, 'ArrowRight')
            assert.equal(await texte(page, tag, 'ordre'), '1,2,3|4,5', 'rien n\'est posé avant Espace')
            assert.deepEqual(await sorts(page, tag), [])
            await touche(page, 'Space')
            await page.waitForTimeout(400)
            assert.equal(await annonce(page, tag, '.la'), FR.posee(3, 3))
            assert.equal(await texte(page, tag, 'ordre'), '1,3|4,5,2')
            const s = await sorts(page, tag)
            assert.equal(s.length, 1)
            assert.deepEqual(s[0], { from: 1, to: 2, item: { id: 2, titre: 'A2', marque: 'vu' }, source: 'la', on: 'lb', a: '1,3', b: '4,5,2', meme: true })
            assert.equal(await actif(page, tag), '2', 'le focus est sur la ligne arrivée dans B')
            assert.ok(repos(await marques(page, tag)))
          })
        })

        it('Échap après un passage dans l\'autre liste : rien ne bouge, rien ne part, la ligne garde le focus', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, ligne('1'))
            await touche(page, 'Space', 'ArrowRight', 'Escape')
            await page.waitForTimeout(300)
            assert.equal(await annonce(page, tag, '.la'), FR.annule(1))
            assert.equal(await texte(page, tag, 'ordre'), '1,2,3|4,5')
            assert.deepEqual(await sorts(page, tag), [])
            assert.equal(await actif(page, tag), '1')
            assert.ok(repos(await marques(page, tag)))
          })
        })

        it('groupes différents ou absents : Droite ne fait rien, et l\'annonce de saisie ne parle pas de groupe', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, ligne('2'))
            await touche(page, 'Space')
            assert.equal(await annonce(page, tag, '.la'), FR.saisie(2, 3))
            await touche(page, 'ArrowRight')
            assert.equal(await annonce(page, tag, '.la'), FR.saisie(2, 3), 'aucune annonce de plus')
            assert.equal((await marques(page, tag))['2'].dx, '', 'la ligne n\'a pas bougé de colonne')
            await touche(page, 'Space')
            assert.equal(await texte(page, tag, 'ordre'), '1,2,3|4,5|6,7')
            assert.deepEqual(await sorts(page, tag), [])
          }, { tag: 'mjs-gd-page', listes: 3 })
        })

        it('deux listes calculées sans value : la charge de sort suffit pour ranger soi-même (de, vers, source), souris et clavier', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const b2 = await centre(page, tag, t('5'))
            await glisser(page, tag, t('1'), { x: b2.x, y: b2.y - 10 })
            await page.mouse.up()
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), '2,3|4,1,5')
            let s = await sorts(page, tag)
            assert.equal(s.length, 1)
            assert.deepEqual(s[0], { from: 0, to: 1, src: 'a', dst: 'b' }, 'pas d\'item sans value')
            await focaliser(page, tag, ligne('5'))
            await touche(page, 'Space', 'ArrowLeft', 'ArrowDown', 'Space')
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), '2,3,5|4,1')
            s = await sorts(page, tag)
            assert.equal(s.length, 2)
            assert.deepEqual(s[1], { from: 2, to: 2, src: 'b', dst: 'a' })
          }, { tag: 'mjs-gc-page' })
        })
      })

      describe('clavier : deux niveaux', () => {
        it('Gauche sort du groupe (annonce), Droite entre dans le groupe qui suit (annonce), Espace pose : value des trois listes, sort une fois', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, ligne('l12'))
            await touche(page, 'Space')
            assert.equal(await annonce(page, tag, '.lignes[data-id="m1"]'), FR.groupe(2, 2))
            await touche(page, 'ArrowLeft')
            assert.equal(await annonce(page, tag, '.lignes[data-id="m1"]'), FR.sortie('la liste 1 sur 1', 3, 5))
            await touche(page, 'ArrowRight')
            assert.equal(await annonce(page, tag, '.lignes[data-id="m1"]'), FR.entree('la liste 2 sur 3', 1, 4))
            assert.equal(await texte(page, tag, 'ordre'), 'e1 m1:l11,l12 m2:l21,l22,l23 m3:', 'rien n\'est posé avant Espace')
            await touche(page, 'Space')
            await page.waitForTimeout(500)
            assert.equal(await annonce(page, tag, '.lignes[data-id="m1"]'), FR.posee(1, 4))
            assert.equal(await texte(page, tag, 'ordre'), 'e1 m1:l11 m2:l12,l21,l22,l23 m3:')
            const s = await sorts(page, tag)
            assert.equal(s.length, 1)
            assert.deepEqual(s[0], { from: 1, to: 0, item: { id: 'l12', nom: 'Salade' }, source: 'm1', on: 'm2' })
            assert.equal(await actif(page, tag), 'l12', 'le focus est sur la ligne arrivée dans le groupe')
            assert.equal(await evenements(page), 1, 'un seul événement sort pour tout le geste')
            assert.ok(repos(await marques(page, tag)))
          }, { tag: 'mjs-gn-page', listes: 4 })
        })

        it('une ligne du premier niveau entre dans le groupe qui la suit, et en sort juste après lui', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, ligne('e1'))
            await touche(page, 'Space', 'ArrowRight')
            assert.equal(await annonce(page, tag, '.menu'), FR.entree('la liste 1 sur 3', 1, 3))
            await touche(page, 'Space')
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), 'm1:e1,l11,l12 m2:l21,l22,l23 m3:')
            await focaliser(page, tag, ligne('e1'))
            await touche(page, 'Space', 'ArrowLeft')
            assert.equal(await annonce(page, tag, '.lignes[data-id="m1"]'), FR.sortie('la liste 1 sur 1', 2, 4))
            await touche(page, 'Space')
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), 'm1:l11,l12 e1 m2:l21,l22,l23 m3:')
            const s = await sorts(page, tag)
            assert.deepEqual(s.map((x: any) => [x.from, x.to, x.source, x.on]), [[0, 0, 'menu', 'm1'], [0, 1, 'm1', 'menu']])
          }, { tag: 'mjs-gn-page', listes: 4 })
        })

        it('Droite sans groupe à entrer ne fait rien ; Échap après être sorti annule tout ; un groupe tenu ne descend pas dans les autres', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, ligne('l12'))
            await touche(page, 'Space', 'ArrowRight')
            assert.equal(await annonce(page, tag, '.lignes[data-id="m1"]'), FR.groupe(2, 2), 'aucune annonce de plus')
            await touche(page, 'ArrowLeft', 'Escape')
            await page.waitForTimeout(300)
            assert.equal(await annonce(page, tag, '.lignes[data-id="m1"]'), FR.annule(2))
            assert.equal(await texte(page, tag, 'ordre'), 'e1 m1:l11,l12 m2:l21,l22,l23 m3:')
            assert.deepEqual(await sorts(page, tag), [])
            assert.equal(await actif(page, tag), 'l12')
            assert.ok(repos(await marques(page, tag)))
            await focaliser(page, tag, '.groupe[data-id="m2"]')
            await touche(page, 'Space')
            assert.equal(await annonce(page, tag, '.menu'), FR.saisie(3, 4), 'un groupe n\'a aucun autre groupe où entrer')
            await touche(page, 'ArrowRight', 'ArrowLeft')
            assert.equal(await annonce(page, tag, '.menu'), FR.saisie(3, 4))
            await touche(page, 'ArrowDown')
            assert.equal(await annonce(page, tag, '.menu'), FR.deplace(4, 4))
            await touche(page, 'Space')
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), 'e1 m1:l11,l12 m3: m2:l21,l22,l23', 'chaque groupe garde ses lignes')
            assert.deepEqual(await listes(page, tag), { menu: 'e1,m1,m3,m2', m1: 'l11,l12', m2: 'l21,l22,l23', m3: '' })
          }, { tag: 'mjs-gn-page', listes: 4 })
        })

        it('annonces en anglais', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, ligne('l12'))
            await touche(page, 'Space')
            assert.equal(await annonce(page, tag, '.lignes[data-id="m1"]'), EN.groupe(2, 2))
            await touche(page, 'ArrowLeft')
            assert.equal(await annonce(page, tag, '.lignes[data-id="m1"]'), EN.sortie('list 1 of 1', 3, 5))
            await touche(page, 'ArrowRight')
            assert.equal(await annonce(page, tag, '.lignes[data-id="m1"]'), EN.entree('list 2 of 3', 1, 4))
            await touche(page, 'Space')
            assert.equal(await annonce(page, tag, '.lignes[data-id="m1"]'), EN.posee(1, 4))
            await page.waitForTimeout(400)
            await focaliser(page, tag, ligne('l12'))
            await touche(page, 'Space', 'ArrowLeft', 'Escape')
            assert.equal(await annonce(page, tag, '.lignes[data-id="m2"]'), EN.annule(1))
          }, { tag: 'mjs-gn-page', listes: 4, lang: 'en' })
        })
      })

      describe('défilement et registre', () => {
        it('près du bord bas la page défile seule pendant que la ligne passe d\'une liste à l\'autre ; on la pose dans B', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const p = await centre(page, tag, t('1'))
            const b20 = await centre(page, tag, t('5'))
            await page.mouse.move(p.x, p.y)
            await page.mouse.down()
            await page.mouse.move(p.x, p.y + 8, { steps: 2 })
            await page.mouse.move(p.x, 396, { steps: 10 })
            await page.waitForFunction(() => window.scrollY > 450, null, { timeout: 8000 })
            await page.waitForTimeout(600)
            const max = await page.evaluate(() => document.scrollingElement!.scrollHeight - window.innerHeight)
            const y = await page.evaluate(() => window.scrollY)
            assert.ok(y <= max + 1, `la page ne défile pas au-delà de sa fin (${y} pour ${max})`)
            await page.mouse.move(p.x, b20.y - y - 10, { steps: 8 })
            await page.waitForTimeout(300)
            const y1 = await page.evaluate(() => window.scrollY)
            await page.mouse.up()
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), '2,3|4,1,5')
            const s = await sorts(page, tag)
            assert.equal(s.length, 1)
            assert.deepEqual([s[0].from, s[0].to, s[0].source, s[0].on], [0, 1, 'la', 'lb'])
            const apres = await page.evaluate(() => window.scrollY)
            assert.ok(apres <= y1 + 60, 'la page ne s\'emballe pas')
            await page.waitForTimeout(300)
            assert.equal(await page.evaluate(() => window.scrollY), apres, 'plus de défilement après le lâcher')
          }, { tag: 'mjs-gv-page', viewport: { width: 800, height: 420 } })
        })

        it('dans une zone qui défile qui porte les deux listes, c\'est elle qui défile près du bord, pas la page ; on pose la ligne dans B', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const cadre = () => page.evaluate((tg: string) => (document.querySelector(tg) as any)._shadow.querySelector('.cadre').scrollTop as number, tag)
            const p = await centre(page, tag, t('1'))
            const b20 = await centre(page, tag, t('5'))
            await page.mouse.move(p.x, p.y)
            await page.mouse.down()
            await page.mouse.move(p.x, p.y + 8, { steps: 2 })
            await page.mouse.move(p.x, 205, { steps: 10 })
            await page.waitForFunction(([tg]: string[]) => (document.querySelector(tg) as any)._shadow.querySelector('.cadre').scrollTop > 600, [tag], { timeout: 8000 })
            await page.waitForTimeout(600)
            const haut = await cadre()
            assert.equal(await page.evaluate(() => window.scrollY), 0, 'la page n\'a pas bougé')
            await page.mouse.move(p.x, b20.y - haut - 10, { steps: 8 })
            await page.waitForTimeout(300)
            await page.mouse.up()
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), '2,3|4,1,5')
            const s = await sorts(page, tag)
            assert.deepEqual(s.map((x: any) => [x.from, x.to, x.source, x.on]), [[0, 1, 'la', 'lb']])
            const apres = await cadre()
            await page.waitForTimeout(300)
            assert.equal(await cadre(), apres, 'plus de défilement après le lâcher')
          }, { tag: 'mjs-gf-page', viewport: { width: 800, height: 500 } })
        })

        it('une liste retirée de la page n\'est plus une cible, une liste remise l\'est de nouveau', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await page.evaluate((tg: string) => (document.querySelector(tg) as any)._shadow.querySelector('button.bascule').click(), tag)
            await page.waitForTimeout(300)
            assert.equal((await page.evaluate((tg: string) => (document.querySelector(tg) as any)._shadow.querySelectorAll('mjs-core-sortable').length, tag)), 1)
            await focaliser(page, tag, ligne('2'))
            await touche(page, 'Space', 'ArrowRight')
            assert.equal(await annonce(page, tag, '.la'), FR.saisie(2, 3), 'plus de liste sœur : l\'annonce ne parle pas de groupe, Droite ne fait rien')
            await touche(page, 'Escape')
            await page.evaluate((tg: string) => (document.querySelector(tg) as any)._shadow.querySelector('button.bascule').click(), tag)
            await page.waitForFunction((tg: string) => (document.querySelector(tg) as any)._shadow.querySelectorAll('mjs-core-sortable').length === 2 && !!(document.querySelector(tg) as any)._shadow.querySelectorAll('mjs-core-sortable')[1]._shadow?.querySelector('slot'), tag)
            await page.waitForTimeout(250)
            const b2 = await centre(page, tag, t('5'))
            await glisser(page, tag, t('1'), { x: b2.x, y: b2.y - 10 })
            await page.mouse.up()
            await page.waitForTimeout(500)
            assert.equal(await texte(page, tag, 'ordre'), '2,3|4,1,5', 'la liste remise reçoit de nouveau')
          }, { tag: 'mjs-gr-page', listes: 2 })
        })

        it('après un passage d\'une liste à l\'autre, aucun écouteur de window ni de document ne reste', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const repos0 = await page.evaluate(() => (window as any).__vivants())
            const b2 = await centre(page, tag, t('5'))
            await glisser(page, tag, t('1'), { x: b2.x, y: b2.y - 10 })
            const pendant = await page.evaluate(() => (window as any).__vivants())
            assert.ok(pendant.length > repos0.length, 'des écouteurs sont posés pendant le geste')
            await page.mouse.up()
            await page.waitForTimeout(700)
            assert.deepEqual(await page.evaluate(() => (window as any).__vivants()), repos0)
            await focaliser(page, tag, ligne('4'))
            await touche(page, 'Space', 'ArrowLeft', 'Space')
            await page.waitForTimeout(400)
            assert.deepEqual(await page.evaluate(() => (window as any).__vivants()), repos0)
          }, { sonde: true })
        })
      })
    })
  }
}
