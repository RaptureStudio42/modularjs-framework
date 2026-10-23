// <@@select sticky> dans Chromium, Firefox et WebKit réels : dans le panneau ouvert, l'option choisie reste toujours visible.
// - quand on fait défiler la liste et qu'elle sort par le haut, elle reste collée en haut (sous le champ de recherche s'il y en a un) ; quand elle est plus bas
//   que la vue, elle reste collée en bas ; avec ou sans recherche, avec ou sans groupes (le titre d'un groupe garde sa place) ;
// - elle garde un fond plein, reste cliquable et garde aria-selected ;
// - au clavier, la ligne active ne se cache jamais sous l'option collée ;
// - sans `sticky`, ou avec `multiple`, rien ne colle et rien ne change ; l'accessibilité des groupes (role="group", nom) reste celle du navigateur (arbre d'accessibilité de Chromium).
// Toutes les mesures sont des rectangles lus dans la page (aucun test de vitesse).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const options = (prefix: string, key: string, count: number) => Array.from({ length: count }, (_, i) => `<@@option value="${key}${i + 1}">${prefix}${i + 1}</@@option>`).join('')

const LONG   = options('Option ', 'o', 90)
const GROUPS = ['A', 'B', 'C'].map((g) => `<@@optgroup label="Groupe ${g}">${options(g, g.toLowerCase(), 20)}</@@optgroup>`).join('')

const PAGE = `<div class="zone z1"><@@select class="simple" name="simple" sticky value="o40">${LONG}</@@select></div>
<div class="zone z2"><@@select class="search" name="search" search sticky value="o40">${LONG}</@@select></div>
<div class="zone z3"><@@select class="groups" name="groups" search sticky value="b10">${GROUPS}</@@select></div>
<div class="zone z4"><@@select class="multi" name="multi[]" multiple sticky value={['o40']}>${LONG}</@@select></div>
<div class="zone z5"><@@select class="plain" name="plain" search value="o40">${LONG}</@@select></div>

<style>
  body
    margin: 0
  .zone
    position: fixed
    top: 20px
    width: 200px
  .z1
    left: 20px
  .z2
    left: 240px
  .z3
    left: 460px
  .z4
    left: 680px
  .z5
    left: 900px
</style>
`

let compile: Promise<string> | null = null

// le script de la page (cœur, modules, hôte, libellés), compilé une fois pour les trois navigateurs
function script(): Promise<string> {
  compile ??= (async () => {
    const root   = mjsTmp('select-sticky')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), PAGE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    return ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  })()
  return compile
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@select sticky> — l'option choisie reste visible (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  const errors: string[] = []

  const coque    = (c: string) => `__q('.${c}')._shadow`
  const lire     = (expr: string) => page.evaluate(`(() => { return ${expr} })()`)
  const attendre = (expr: string) => page.waitForFunction(`(() => { return ${expr} })()`, null, { timeout: 30000 })
  const panneau  = (c: string) => `${coque(c)}.querySelector('.select-panel')`

  // les rectangles utiles, en pixels de la page : la partie visible du panneau (sous le champ de recherche collant), la ligne choisie et la ligne active
  const mesure = (c: string) => lire(`(() => {
    const sh = ${coque(c)}, pan = sh.querySelector('.select-panel'), rech = sh.querySelector('.select-search')
    const pr = pan.getBoundingClientRect(), k = pr.height / pan.offsetHeight
    const visTop = pr.top + (pan.clientTop + (rech ? rech.offsetHeight : 0)) * k, visBottom = pr.top + (pan.clientTop + pan.clientHeight) * k
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, text: el.querySelector('.select-option-label').textContent.trim() } }
    return { scrollTop: pan.scrollTop, scrollMax: pan.scrollHeight - pan.clientHeight, visTop, visBottom, sel: box(sh.querySelector('.select-option.selected')), act: box(sh.querySelector('.select-option.active')) }
  })()`)

  async function ouvrir(c: string) {
    await page.evaluate(`${coque(c)}.querySelector('.select-btn').focus()`)
    await page.keyboard.press('ArrowDown')
    await attendre(`!!${panneau(c)} && !!${coque(c)}.querySelector('.select-option.active')`)
    await page.waitForTimeout(150)
  }

  async function fermerTout() {
    await page.mouse.click(1150, 690)
    await page.waitForFunction(`Array.from(document.querySelector('mjs-hote')._shadow.querySelectorAll('mjs-core-select')).every((s) => s._shadow && !s._shadow.querySelector('.select-panel'))`, null, { timeout: 30000 })
  }

  // le défilement du panneau à une place précise, sans pointeur sur les lignes
  async function defiler(c: string, top: number) {
    await page.evaluate(`${panneau(c)}.scrollTop = ${top}`)
    await page.waitForTimeout(80)
  }

  const colleEnHaut = (m: any) => Math.abs(m.sel.top - m.visTop) < 1.5
  const colleEnBas  = (m: any) => Math.abs(m.visBottom - m.sel.bottom) < 1.5

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    const code = await script()
    browser = await playwright[nom].launch()
    page    = await browser.newPage({ viewport: { width: 1200, height: 700 } })
    await page.addInitScript('window.__name = (f) => f')
    page.on('pageerror', (e: any) => errors.push(String(e.message).slice(0, 200)))
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${code}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('.plain')?._shadow?.querySelector('.select-btn'), null, { timeout: 60000 })
    await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)`)
    await page.waitForTimeout(500)
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  afterEach(async function () {
    if (!present) return
    await fermerTout()
    assert.deepEqual(errors, [], 'aucune erreur de page')
  })

  for (const c of ['simple', 'search', 'groups']) {
    it(`${c} : sortie par le haut, l'option choisie colle en haut ; plus bas que la vue, elle colle en bas ; elle reste visible, pleine, cliquable`, async function () {
      if (!present) { this.skip(); return }
      await ouvrir(c)
      const depart = await mesure(c)
      assert.ok(depart.sel.top >= depart.visTop - 1.5 && depart.sel.bottom <= depart.visBottom + 1.5, `${c} : choisie en vue à l'ouverture — ${JSON.stringify(depart)}`)
      // vers le bas : la liste défile jusqu'au bout, la choisie est sortie par le haut
      await defiler(c, depart.scrollMax)
      const bas = await mesure(c)
      assert.ok(bas.scrollTop > depart.scrollTop, `${c} : la liste a défilé vers le bas`)
      assert.ok(colleEnHaut(bas), `${c} : collée en haut, sous la recherche — ${JSON.stringify(bas)}`)
      // vers le haut : la liste revient en haut, la choisie est plus bas que la vue
      await defiler(c, 0)
      const haut = await mesure(c)
      assert.ok(colleEnBas(haut), `${c} : collée en bas — ${JSON.stringify(haut)}`)
      // elle garde son fond, son aria-selected et reste sous le pointeur
      const etat = await lire(`(() => {
        const sh = ${coque(c)}, row = sh.querySelector('.select-option.selected'), r = row.getBoundingClientRect()
        const hit = sh.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        const bg = getComputedStyle(row).backgroundColor, m = bg.match(/rgba?\\(([^)]+)\\)/), parts = m ? m[1].split(/[ ,\\/]+/).filter(Boolean) : []
        return { hit: hit && hit.closest('.select-option') === row, aria: row.getAttribute('aria-selected'), alpha: parts.length > 3 ? Number(parts[3]) : 1, bg: bg, position: getComputedStyle(row).position }
      })()`)
      assert.equal(etat.hit, true, `${c} : l'option collée reçoit le pointeur`)
      assert.equal(etat.aria, 'true')
      assert.equal(etat.alpha, 1, `${c} : fond plein — ${etat.bg}`)
      assert.equal(etat.position, 'sticky')
    })
  }

  it('à la molette : l\'option choisie colle en haut puis en bas', async function () {
    if (!present) { this.skip(); return }
    await ouvrir('search')
    const depart = await mesure('search')
    await page.mouse.move(280, depart.visTop + 60)
    // un cran de molette ne fait défiler qu'une partie de la liste (Firefox borne chaque cran) : on tourne jusqu'au bout
    for (let k = 0; k < 40 && (await lire(`${panneau('search')}.scrollTop`)) < depart.scrollMax - 1; k++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(40) }
    await attendre(`${panneau('search')}.scrollTop > ${depart.scrollTop + 20}`)
    await page.waitForTimeout(150)
    const bas = await mesure('search')
    assert.ok(colleEnHaut(bas), `collée en haut après la molette — ${JSON.stringify(bas)}`)
    for (let k = 0; k < 40 && (await lire(`${panneau('search')}.scrollTop`)) > 0; k++) { await page.mouse.wheel(0, -600); await page.waitForTimeout(40) }
    await attendre(`${panneau('search')}.scrollTop === 0`)
    await page.waitForTimeout(150)
    const haut = await mesure('search')
    assert.ok(colleEnBas(haut), `collée en bas après la molette — ${JSON.stringify(haut)}`)
  })

  it('avec des groupes : le titre du groupe garde sa place dans sa section et la choisie colle au-delà', async function () {
    if (!present) { this.skip(); return }
    await ouvrir('groups')
    const info = await lire(`(() => {
      const sh = ${coque('groups')}, pan = sh.querySelector('.select-panel'), sel = sh.querySelector('.select-option.selected')
      const sec = sel.closest('.select-section'), label = sec.querySelector('.select-group-label')
      return { disp: getComputedStyle(sec).display, role: sec.getAttribute('role'), nom: sec.getAttribute('aria-label'), titre: label && label.textContent.trim(), sectionsDirectes: Array.from(pan.querySelector('[role=listbox]').children).filter((e) => e.classList.contains('select-section')).length }
    })()`)
    assert.equal(info.role, 'group')
    assert.equal(info.nom, 'Groupe B')
    assert.equal(info.titre, 'Groupe B')
    assert.equal(info.sectionsDirectes, 3)
    // au bout de la liste (groupe C) puis au début (groupe A) : la choisie du groupe B colle, hors de sa section
    const m = await mesure('groups')
    await defiler('groups', m.scrollMax)
    assert.ok(colleEnHaut(await mesure('groups')), 'collée en haut depuis le groupe C')
    await defiler('groups', 0)
    assert.ok(colleEnBas(await mesure('groups')), 'collée en bas depuis le groupe A')
    // les titres restent des lignes de la liste, à leur place
    const titres = await lire(`Array.from(${coque('groups')}.querySelectorAll('.select-group-label')).map((t) => t.textContent.trim())`)
    assert.deepEqual(titres, ['Groupe A', 'Groupe B', 'Groupe C'])
  })

  it('à l\'ouverture, le panneau défile jusqu\'à la place naturelle de la choisie : sa voisine du dessus se voit', async function () {
    if (!present) { this.skip(); return }
    await ouvrir('search')
    const voisine = await lire(`(() => {
      const sh = ${coque('search')}, pan = sh.querySelector('.select-panel'), rows = Array.from(sh.querySelectorAll('.select-option'))
      const i = rows.findIndex((r) => r.classList.contains('selected')), v = rows[i - 1].getBoundingClientRect(), p = pan.getBoundingClientRect()
      return { text: rows[i - 1].textContent.trim(), dedans: v.top >= p.top && v.bottom <= p.bottom }
    })()`)
    assert.equal(voisine.text, 'Option 39')
    assert.equal(voisine.dedans, true, 'la voisine du dessus est dans le panneau')
  })

  // la ligne active ne se cache jamais sous l'option collée : elle est visible et ne la recouvre pas
  const claire = (m: any, dit: string) => {
    assert.ok(m.act, `${dit} : une ligne active`)
    assert.ok(m.act.top >= m.visTop - 1.5 && m.act.bottom <= m.visBottom + 1.5, `${dit} : la ligne active est hors de la partie visible — ${JSON.stringify(m)}`)
    if (m.act.text !== m.sel.text) {
      const recouvre = Math.min(m.act.bottom, m.sel.bottom) - Math.max(m.act.top, m.sel.top)
      assert.ok(recouvre <= 1, `${dit} : la ligne active est sous l'option collée — ${JSON.stringify(m)}`)
    }
  }

  for (const c of ['simple', 'search', 'groups']) {
    it(`${c} : flèche bas depuis le haut de la liste, la ligne active ne se cache pas sous l'option collée en bas`, async function () {
      if (!present) { this.skip(); return }
      await ouvrir(c)
      await defiler(c, 0)
      await page.keyboard.press('Home')
      for (let k = 0; k < 40; k++) {
        await page.keyboard.press('ArrowDown')
        await page.waitForTimeout(25)
        claire(await mesure(c), `${c}, flèche bas ${k + 1}`)
      }
    })

    it(`${c} : flèche haut depuis le bas de la liste, la ligne active ne se cache pas sous l'option collée en haut`, async function () {
      if (!present) { this.skip(); return }
      await ouvrir(c)
      await page.keyboard.press('End')
      await page.waitForTimeout(60)
      for (let k = 0; k < 60; k++) {
        await page.keyboard.press('ArrowUp')
        await page.waitForTimeout(25)
        claire(await mesure(c), `${c}, flèche haut ${k + 1}`)
      }
    })
  }

  it('sans sticky, ou avec multiple : rien ne colle', async function () {
    if (!present) { this.skip(); return }
    for (const c of ['plain', 'multi']) {
      await ouvrir(c)
      const m = await mesure(c)
      await defiler(c, m.scrollMax)
      const apres = await mesure(c)
      const etat = await lire(`(() => { const sh = ${coque(c)}, row = sh.querySelector('.select-option.selected'), sec = row.closest('.select-section'); return { position: getComputedStyle(row).position, section: getComputedStyle(sec).display } })()`)
      assert.equal(etat.position, 'static', `${c} : la choisie ne colle pas`)
      assert.equal(etat.section, 'block', `${c} : la section garde sa boîte`)
      assert.ok(apres.sel.bottom < apres.visTop, `${c} : la choisie est sortie par le haut — ${JSON.stringify(apres)}`)
      await fermerTout()
    }
  })

  it('panneau très petit (une ligne et demie sous la recherche) : sans la place d\'une ligne en plus de la recherche et de l\'option collée, l\'option ne colle pas et la ligne active reste visible', async function () {
    if (!present) { this.skip(); return }
    await ouvrir('search')
    const gabarit = await lire(`(() => { const sh = ${coque('search')}; return { search: sh.querySelector('.select-search').offsetHeight, ligne: sh.querySelector('.select-option').offsetHeight, bas: sh.querySelector('.select-btn').getBoundingClientRect().bottom } })()`)
    await fermerTout()
    await page.setViewportSize({ width: 1200, height: Math.ceil(gabarit.bas + 12 + gabarit.search + gabarit.ligne * 1.5 + 2) })
    try {
      await ouvrir('search')
      const haut = await mesure('search')
      assert.ok(haut.visBottom - haut.visTop > 0, `panneau mesuré : ${JSON.stringify(haut)}`)
      for (const touche of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'End', 'ArrowUp', 'Home']) {
        await page.keyboard.press(touche)
        await page.waitForTimeout(60)
        const m = await mesure('search')
        const dessous = m.act.top < m.visTop - 1.5 || m.act.bottom > m.visBottom + 1.5
        assert.equal(dessous, false, `${touche} : la ligne active sort de la partie visible — ${JSON.stringify(m)}`)
        if (m.sel && m.sel.text !== m.act.text) {
          const chevauche = m.sel.top < m.act.bottom - 1.5 && m.sel.bottom > m.act.top + 1.5
          assert.equal(chevauche, false, `${touche} : l\'option collée cache la ligne active — ${JSON.stringify(m)}`)
        }
      }
    } finally {
      await page.setViewportSize({ width: 1200, height: 700 })
    }
  })

  it('accessibilité : les groupes gardent role="group" et leur nom dans l\'arbre d\'accessibilité (Chromium)', async function () {
    if (!present || nom !== 'chromium') { this.skip(); return }
    await ouvrir('groups')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Accessibility.enable')
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')
    const parId = new Map(nodes.map((n: any) => [n.nodeId, n]))
    const groupes = nodes.filter((n: any) => n.role?.value === 'group' && /^Groupe [ABC]$/.test(n.name?.value ?? '')).map((n: any) => n.name.value).sort()
    assert.deepEqual(groupes, ['Groupe A', 'Groupe B', 'Groupe C'])
    const choisie = nodes.find((n: any) => n.role?.value === 'option' && n.name?.value === 'B10')
    assert.ok(choisie, 'l\'option choisie est dans l\'arbre')
    const pere: any = parId.get(choisie.parentId)
    assert.equal(pere.name?.value, 'Groupe B', 'l\'option est toujours rangée dans son groupe')
    assert.ok(choisie.properties.some((p: any) => p.name === 'selected' && p.value.value === true), 'aria-selected est exposé')
    await cdp.detach()
  })
})
