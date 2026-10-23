// <@@select other> dans Chromium et Firefox réels : ce que happy-dom ne montre pas.
// - le rendu : la ligne « Autre… » est la dernière, séparée des autres par un filet de la couleur --mjs-select-border, même quand
//   la recherche ne trouve rien ; la jauge de largeur compte son libellé, pas les réponses libres ;
// - le focus et la frappe : le champ prend le vrai focus, Espace écrit une espace, Début/Fin/flèches déplacent le curseur du champ
//   (la liste ne les retient pas), maxlength coupe la frappe ; Échap rend le focus au bouton ou au champ de recherche ; en choix
//   multiple, le clic de la souris sur ✔ rend le focus au champ ;
// - le clavier de bout en bout sans souris, aria-activedescendant qui suit, le formulaire (FormData) et form.reset() ;
// - l'arbre d'accessibilité (Chromium) : « Autre… » est une option, le champ a pour nom son invite et pour description l'indice.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const PAYS = '<@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option><@@option value="us">États-Unis</@@option>'
const LAIT = '<@@option value="lait">Lait</@@option><@@option value="oeuf">Oeuf</@@option><@@option value="noix">Noix</@@option>'
const AB   = '<@@option value="a">A</@@option><@@option value="b">B</@@option>'

const PAGE = `<form id="f" @noUJS>
  <@@select class="s1" name="groupe" other value="fr">${PAYS}</@@select>
  <@@select class="s2" name="profil[groupe]" search other>${PAYS}</@@select>
  <@@select class="s3" name="g3" other>${PAYS}</@@select>
  <@@select class="libre" name="libre" other>${PAYS}</@@select>
  <@@select class="court" name="court" other="5">${PAYS}</@@select>
  <@@select class="multi" name="allergies[]" multiple other="12">${LAIT}</@@select>
  <@@select class="multi2" name="m2[]" multiple other>${LAIT}</@@select>
  <@@select class="ax" name="ax" other>${PAYS}</@@select>
  <button type="reset" class="rz">Remise à zéro</button>
</form>
<div class="ligne"><@@select class="mesure" name="mesure" other other-label="Une autre réponse assez longue">${AB}</@@select></div>
<div class="ligne"><@@select class="temoin" name="temoin" other other-label="x">${AB}</@@select></div>
`

let compile: Promise<string> | null = null

// le script de la page (cœur, modules, hôte, libellés), compilé une fois pour les deux navigateurs
function script(): Promise<string> {
  compile ??= (async () => {
    const root   = mjsTmp('select-autre-browser')
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

for (const nom of ['chromium', 'firefox'] as const) describe(`<@@select other> — réponse libre (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any

  const coque = (c: string) => `__q('.${c}')._shadow`
  const lire  = (expr: string) => page.evaluate(`(() => { return ${expr} })()`)
  const attendre = (expr: string) => page.waitForFunction(`(() => { return ${expr} })()`, null, { timeout: 30000 })

  const ouvert    = (c: string) => `${coque(c)}.querySelector('.select-btn').getAttribute('aria-expanded') === 'true'`
  const champ     = (c: string) => `${coque(c)}.querySelector('.select-other-input')`
  const focus     = (c: string) => lire(`${coque(c)}.activeElement && ${coque(c)}.activeElement.className`)
  const libelles  = (c: string) => lire(`[...${coque(c)}.querySelectorAll('.select-option')].map((l) => l.querySelector('.select-option-label').textContent)`)
  const actives   = (c: string) => lire(`[...${coque(c)}.querySelectorAll('.select-option.active')].map((l) => l.querySelector('.select-option-label').textContent)`)
  const donnees   = async () => JSON.parse(await page.evaluate(`JSON.stringify([...new FormData(__q('#f')).entries()])`)) as Array<[string, string]>
  const donnee    = async (cle: string) => (await donnees()).filter(([k]) => k === cle).map(([, v]) => v)

  async function ouvrir(c: string) {
    if (!(await lire(ouvert(c)))) await page.evaluate(`${coque(c)}.querySelector('.select-btn').click()`)
    await attendre(`${ouvert(c)} && ${coque(c)}.querySelector('.select-panel')`)
  }

  async function ouvrirChamp(c: string) {
    await ouvrir(c)
    await page.evaluate(`${coque(c)}.querySelector('.select-other').click()`)
    await attendre(`${champ(c)} && ${coque(c)}.activeElement === ${champ(c)}`)
  }

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    const code = await script()
    browser = await playwright[nom].launch()
    page    = await browser.newPage({ viewport: { width: 900, height: 900 } })
    await page.addInitScript('window.__name = (f) => f')
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${code}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('.temoin')?._shadow?.querySelector('.select-btn'), null, { timeout: 60000 })
    await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)`)
    await page.waitForTimeout(500)
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('la ligne « Autre… » est la dernière, séparée des autres par un filet de la couleur --mjs-select-border', async function () {
    if (!present) { this.skip(); return }
    await page.evaluate(`__q('.s1').style.setProperty('--mjs-select-border', 'rgb(255, 0, 0)')`)
    await ouvrir('s1')
    const m = await lire(`(() => {
      const rows = [...${coque('s1')}.querySelectorAll('.select-option')]
      const last = rows[rows.length - 1], prev = rows[rows.length - 2]
      const cs = getComputedStyle(last)
      return {
        derniere: last.querySelector('.select-option-label').textContent,
        nombre:   rows.length,
        filet:    [cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor].join(' '),
        autres:   rows.slice(0, -1).map((r) => getComputedStyle(r).borderTopWidth),
        dessous:  last.getBoundingClientRect().top >= prev.getBoundingClientRect().bottom - 0.5
      }
    })()`)
    assert.equal(m.derniere, 'Autre…')
    assert.equal(m.nombre, 4)
    assert.equal(m.filet, '1px solid rgb(255, 0, 0)')
    assert.deepEqual(m.autres, ['0px', '0px', '0px'], 'les autres lignes n\'ont pas de filet')
    assert.equal(m.dessous, true, 'la ligne est sous les autres')
  })

  it('la ligne reste visible, sous le message « Aucun résultat », quand la recherche ne trouve rien', async function () {
    if (!present) { this.skip(); return }
    await ouvrir('s2')
    await page.keyboard.type('zzzz')
    await attendre(`${coque('s2')}.querySelector('.select-empty')`)
    const m = await lire(`(() => {
      const vide = ${coque('s2')}.querySelector('.select-empty'), autre = ${coque('s2')}.querySelector('.select-other')
      return { autre: autre && autre.getBoundingClientRect().height > 0, ordre: vide.getBoundingClientRect().bottom <= autre.getBoundingClientRect().top + 0.5, nombre: ${coque('s2')}.querySelectorAll('.select-option').length }
    })()`)
    assert.deepEqual(m, { autre: true, ordre: true, nombre: 1 })
  })

  it('le champ prend le vrai focus ; Espace écrit une espace ; Début, Fin et flèches déplacent le curseur du champ, la liste ne les retient pas', async function () {
    if (!present) { this.skip(); return }
    await ouvrirChamp('libre')
    assert.equal(await focus('libre'), 'select-other-input')
    await page.keyboard.type('a b')
    assert.equal(await lire(`${champ('libre')}.value`), 'a b', 'la frappe, espace comprise')
    assert.equal((await lire(`${coque('libre')}.querySelector('.select-other-count').textContent.trim()`)), '3 / 80')
    const curseur = () => lire(`${champ('libre')}.selectionStart`)
    await page.keyboard.press('Home')
    assert.equal(await curseur(), 0, 'Début déplace le curseur')
    await page.keyboard.press('End')
    assert.equal(await curseur(), 3, 'Fin aussi')
    await page.keyboard.press('ArrowLeft')
    assert.equal(await curseur(), 2, 'et la flèche gauche')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowUp')
    assert.equal(await lire(`!!${champ('libre')}`), true, 'le champ est toujours là')
    const annonce = await lire(`${coque('libre')}.querySelector('.select-btn').getAttribute('aria-activedescendant')`)
    assert.equal(annonce, null, 'le champ est hors de la liste : aucune ligne active annoncée')
    assert.equal(await lire(`${coque('libre')}.querySelector('.select-btn').getAttribute('aria-expanded')`), 'true')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await attendre(`!(${ouvert('libre')})`)
  })

  it('maxlength coupe la frappe : other="5" accepte cinq caractères, le compteur dit « 5 / 5 »', async function () {
    if (!present) { this.skip(); return }
    await ouvrirChamp('court')
    await page.keyboard.type('abcdefgh')
    assert.equal(await lire(`${champ('court')}.value`), 'abcde')
    assert.equal(await lire(`${coque('court')}.querySelector('.select-other-count').textContent.trim()`), '5 / 5')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await attendre(`!(${ouvert('court')})`)
  })

  it('clavier seul, de bout en bout : ouvrir, Fin, Entrée, écrire, Entrée ; aria-activedescendant suit ; le focus revient au bouton ; le formulaire porte g3_other', async function () {
    if (!present) { this.skip(); return }
    await page.evaluate(`${coque('s3')}.querySelector('.select-btn').focus()`)
    await page.keyboard.press('ArrowDown')
    await attendre(ouvert('s3'))
    const suit = async () => lire(`(() => { const a = ${coque('s3')}.querySelector('.select-option.active'); return !!a && ${coque('s3')}.querySelector('.select-btn').getAttribute('aria-activedescendant') === a.id })()`)
    assert.equal(await suit(), true, 'ouverte : la ligne active est annoncée')
    await page.keyboard.press('End')
    await attendre(`${coque('s3')}.querySelector('.select-other.active')`)
    assert.deepEqual(await actives('s3'), ['Autre…'])
    assert.equal(await suit(), true, 'sur « Autre… » aussi')
    await page.keyboard.press('Home')
    await attendre(`${coque('s3')}.querySelector('.select-option.active') && !${coque('s3')}.querySelector('.select-other.active')`)
    assert.deepEqual(await actives('s3'), ['France'])
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await attendre(`${champ('s3')} && ${coque('s3')}.activeElement === ${champ('s3')}`)
    await page.keyboard.type('Zed')
    await page.keyboard.press('Enter')
    await attendre(`!(${ouvert('s3')})`)
    assert.equal(await focus('s3'), 'select-btn', 'le focus est revenu au bouton')
    assert.equal(await lire(`${coque('s3')}.querySelector('.select-btn').textContent.trim()`), 'Zed')
    assert.deepEqual(await donnee('g3_other'), ['Zed'])
    assert.deepEqual(await donnee('g3'), [], 'la réponse libre ne se mêle pas au champ des options')
  })

  it('Échap revient à la liste (focus au champ de recherche), « Autre… » redevient la ligne active ; un second Échap ferme et rend le focus au bouton', async function () {
    if (!present) { this.skip(); return }
    await ouvrir('s2')
    await page.keyboard.type('zzzz')
    await page.keyboard.press('Enter')
    await attendre(`${champ('s2')} && ${coque('s2')}.activeElement === ${champ('s2')}`)
    await page.keyboard.type('brouillon')
    await page.keyboard.press('Escape')
    await attendre(`!${champ('s2')}`)
    assert.equal(await focus('s2'), 'select-search', 'le focus retourne au champ de recherche')
    assert.deepEqual(await actives('s2'), ['Autre…'])
    assert.equal(await lire(`${coque('s2')}.querySelector('.select-btn').getAttribute('aria-expanded')`), 'true', 'la liste est toujours ouverte')
    assert.deepEqual(await donnee('profil[groupe]'), [])
    assert.deepEqual(await donnee('profil[groupe_other]'), [], 'rien n\'a été validé')
    await page.keyboard.press('Escape')
    await attendre(`!(${ouvert('s2')})`)
    assert.equal(await focus('s2'), 'select-btn')
  })

  it('multiple : Entrée ajoute, le champ garde le focus et se vide ; les champs cachés allergies_other[] suivent ; une ligne cochée se retire', async function () {
    if (!present) { this.skip(); return }
    await ouvrirChamp('multi')
    await page.keyboard.type('Kiwi')
    await page.keyboard.press('Enter')
    await attendre(`${coque('multi')}.querySelectorAll('.select-option').length === 4`)
    await page.keyboard.type('Mangue')
    await page.keyboard.press('Enter')
    await attendre(`${coque('multi')}.querySelectorAll('.select-option').length === 5`)
    assert.equal(await focus('multi'), 'select-other-input', 'le champ garde le focus')
    assert.equal(await lire(`${champ('multi')}.value`), '')
    assert.deepEqual(await libelles('multi'), ['Lait', 'Oeuf', 'Noix', 'Kiwi', 'Mangue'])
    assert.deepEqual(await donnee('allergies_other[]'), ['Kiwi', 'Mangue'])
    assert.deepEqual(await donnee('allergies[]'), [])
    await page.keyboard.press('Escape')
    await attendre(`!${champ('multi')}`)
    assert.deepEqual(await libelles('multi'), ['Lait', 'Oeuf', 'Noix', 'Kiwi', 'Mangue', 'Autre…'])
    await page.evaluate(`[...${coque('multi')}.querySelectorAll('.select-option')][3].click()`)
    await attendre(`${coque('multi')}.querySelectorAll('.select-option').length === 5`)
    assert.deepEqual(await donnee('allergies_other[]'), ['Mangue'])
    await page.keyboard.press('Escape')
    await attendre(`!(${ouvert('multi')})`)
  })

  it('multiple : le clic de la souris sur ✔ rend le focus au champ (vide) : la frappe suivante s\'écrit, qu\'il y ait ajout ou non', async function () {
    if (!present) { this.skip(); return }
    const clicOk = async () => {
      const p = await page.evaluate(`(() => { const r = ${coque('multi2')}.querySelector('.select-other-ok').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
      await page.mouse.click(p.x, p.y)
    }
    await ouvrirChamp('multi2')
    await page.keyboard.type('premier')
    await clicOk()
    await attendre(`${coque('multi2')}.querySelectorAll('.select-option').length === 4`)
    assert.equal(await focus('multi2'), 'select-other-input', 'le focus est revenu dans le champ')
    assert.equal(await lire(`${champ('multi2')}.value`), '', 'le champ est vide')
    await page.keyboard.type('second')
    assert.equal(await lire(`${champ('multi2')}.value`), 'second', 'la frappe suivante s\'écrit')
    await clicOk()
    await attendre(`${coque('multi2')}.querySelectorAll('.select-option').length === 5`)
    assert.equal(await focus('multi2'), 'select-other-input')
    await page.keyboard.type('second')
    await clicOk()
    await attendre(`${champ('multi2')}.value === ''`)
    assert.equal(await focus('multi2'), 'select-other-input', 'un texte déjà donné n\'ajoute rien, le champ garde le focus')
    assert.equal(await lire(`${coque('multi2')}.querySelectorAll('.select-option').length`), 5)
    assert.deepEqual(await donnee('m2_other[]'), ['premier', 'second'])
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await attendre(`!(${ouvert('multi2')})`)
  })

  it('la jauge de largeur compte le libellé de « Autre… » (la liste est plus large) mais pas une longue réponse libre', async function () {
    if (!present) { this.skip(); return }
    const largeur = (c: string) => lire(`__q('.${c}').getBoundingClientRect().width`)
    const mesure = await largeur('mesure')
    const temoin = await largeur('temoin')
    assert.ok(mesure > temoin + 60, `libellé long : ${mesure} px contre ${temoin} px pour le libellé court`)
    await ouvrirChamp('temoin')
    await page.keyboard.type('x'.repeat(70))
    await page.keyboard.press('Enter')
    await attendre(`!(${ouvert('temoin')})`)
    assert.equal(await lire(`${coque('temoin')}.querySelector('.select-btn').textContent.trim().length`), 70)
    const apres = await largeur('temoin')
    assert.ok(Math.abs(apres - temoin) < 1, `une réponse libre de 70 caractères ne change pas la largeur : ${temoin} px puis ${apres} px`)
  })

  it('arbre d\'accessibilité : « Autre… » est une option, le champ a pour nom son invite et pour description l\'indice', async function () {
    if (!present) { this.skip(); return }
    if (nom !== 'chromium') { this.skip(); return }
    await ouvrir('ax')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Accessibility.enable')
    const lire1 = async () => (await cdp.send('Accessibility.getFullAXTree')).nodes.filter((n: any) => !n.ignored)
    const options = (await lire1()).filter((n: any) => n.role?.value === 'option').map((n: any) => n.name?.value)
    assert.ok(options.includes('Autre…'), `options : ${JSON.stringify(options)}`)
    await page.evaluate(`${coque('ax')}.querySelector('.select-other').click()`)
    await attendre(`${champ('ax')}`)
    await page.waitForTimeout(200)
    const champs = (await lire1()).filter((n: any) => n.role?.value === 'textbox' && n.name?.value === 'Précisez')
    assert.equal(champs.length, 1, 'un champ nommé par son invite')
    assert.equal(champs[0].description?.value, 'Entrée pour valider · Échap pour revenir')
    const boutons = (await lire1()).filter((n: any) => n.role?.value === 'button' && n.name?.value === 'Valider')
    assert.equal(boutons.length, 1, 'le bouton de validation est nommé')
    await cdp.detach()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await attendre(`!(${ouvert('ax')})`)
  })

  it('form.reset() : la réponse libre donnée est oubliée, le formulaire revient à son départ', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await donnee('groupe'), ['fr'])
    await ouvrirChamp('s1')
    await page.keyboard.type('Zed')
    await page.keyboard.press('Enter')
    await attendre(`!(${ouvert('s1')})`)
    assert.deepEqual(await donnee('groupe_other'), ['Zed'])
    assert.deepEqual(await donnee('groupe'), [])
    await page.evaluate(`__q('.rz').click()`)
    await attendre(`${coque('s1')}.querySelector('.select-btn').textContent.trim() === 'France'`)
    assert.deepEqual(await donnee('groupe'), ['fr'])
    assert.deepEqual(await donnee('groupe_other'), [])
  })
})
