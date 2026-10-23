// <@@select> : le texte d'attente (« Choisir… ») grisé, dans Chromium et Firefox réels : ce que happy-dom ne calcule pas.
// - la couleur calculée du texte d'attente est celle du texte de la liste à 62 % de sa force, donc différente de celle d'une valeur
//   choisie, qui garde la couleur normale ; en choix simple, en choix multiple, avec une valeur choisie puis retirée ;
// - la variable --mjs-select-placeholder règle cette couleur, lue depuis un ancêtre, depuis un bloc <theme>, depuis :root, depuis
//   la balise elle-même (propriété posée, ou règle de la page) : la valeur reçue n'est jamais masquée par le module ;
// - les deux champs internes (la recherche, la réponse libre) montrent leur invite du même gris, qui suit la même variable ;
// - le thème clair comme le thème sombre : le gris suit la couleur du texte, et reste lisible (contraste d'au moins 4,5 pour 1 sur le fond du bouton).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const PAYS = '<@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option><@@option value="us">États-Unis</@@option>'
const LAIT = '<@@option value="lait">Lait</@@option><@@option value="oeuf">Oeuf</@@option><@@option value="noix">Noix</@@option>'

const HOTE = `<form id="f" @noUJS><@@select class="reset" name="r">${PAYS}</@@select></form>
<div class="zone">
  <@@select class="vide" name="a">${PAYS}</@@select>
  <@@select class="choisi" name="b" value="fr">${PAYS}</@@select>
  <@@select class="multi" name="c[]" multiple>${LAIT}</@@select>
  <@@select class="multi-choisi" name="d[]" multiple value={['lait']}>${LAIT}</@@select>
  <@@select class="recherche" name="e" search>${PAYS}</@@select>
  <@@select class="autre" name="f" other>${PAYS}</@@select>
  <@@select class="desactive" name="g" disabled>${PAYS}</@@select>
  <@@select class="perso" name="h" placeholder="Votre pays…">${PAYS}</@@select>
</div>
<div class="ancetre">
  <@@select class="a-vide" name="i" search other>${PAYS}</@@select>
  <@@select class="a-choisi" name="j" value="fr">${PAYS}</@@select>
  <@@select class="a-multi" name="k[]" multiple>${LAIT}</@@select>
</div>
<@carte-theme></@carte-theme>
<@@select class="balise" name="l" search other>${PAYS}</@@select>
<@@select class="regle" name="m" search other>${PAYS}</@@select>
<@@select class="racine" name="n" search other>${PAYS}</@@select>

<style>
  .regle
    --mjs-select-placeholder: rgb(0, 128, 0)
</style>
`

const CARTE = `<theme>
  $$select-placeholder: rgb(0, 0, 255)
</theme>

<@@select class="t-vide" name="t" search other>${PAYS}</@@select>
<@@select class="t-choisi" name="u" value="fr">${PAYS}</@@select>
`

let compile: Promise<string> | null = null

// le script de la page (cœur, modules, hôte, carte, libellés), compilé une fois pour les deux navigateurs
function script(): Promise<string> {
  compile ??= (async () => {
    const root   = mjsTmp('select-attente-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
    writeFileSync(join(srcDir, 'carte-theme.mjs'), CARTE)
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

// les aides de la page : la liste d'après sa classe (dans l'hôte ou dans la carte), son libellé, sa couleur calculée ; une couleur de
// référence est calculée par le navigateur lui-même (même moteur, même écriture : les chaînes se comparent)
const AIDES = `
window.__h   = () => document.querySelector('mjs-hote')._shadow
window.__sel = (c) => __h().querySelector('.' + c) || __h().querySelector('mjs-carte-theme')._shadow.querySelector('.' + c)
window.__co  = (c) => __sel(c)._shadow
window.__lib = (c) => __co(c).querySelector('.select-label')
window.__bt  = (c) => __co(c).querySelector('.select-btn')
window.__couleur = (el, pseudo) => getComputedStyle(el, pseudo || null).color
window.__calcule = (ecrit) => { const d = document.createElement('div'); d.style.color = ecrit; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v }
window.__gris = (fg, pct) => __calcule('color-mix(in srgb, ' + fg + ' ' + (pct || 62) + '%, transparent)')
window.__sur = (fg, fond) => { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = fond; x.fillRect(0, 0, 1, 1); x.fillStyle = fg; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3) }
window.__lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]) }
window.__contraste = (a, b) => { const la = __lum(a), lb = __lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) }
`

const TEXTE = 'rgb(34, 34, 34)'

for (const nom of ['chromium', 'firefox'] as const) describe(`<@@select> — le texte d'attente grisé (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any

  const lire     = (expr: string) => page.evaluate(`(() => { return ${expr} })()`)
  const attendre = (expr: string) => page.waitForFunction(`(() => { return ${expr} })()`, null, { timeout: 30000 })

  const gris   = (c: string) => lire(`__couleur(__lib('${c}'))`)
  const ouvrir = async (c: string) => {
    if (!(await lire(`!!__co('${c}').querySelector('.select-panel')`))) await page.evaluate(`__bt('${c}').click()`)
    await attendre(`!!__co('${c}').querySelector('.select-panel')`)
  }
  const fermer = async (c: string) => {
    if (await lire(`!!__co('${c}').querySelector('.select-panel')`)) await page.evaluate(`__bt('${c}').click()`)
    await attendre(`!__co('${c}').querySelector('.select-panel')`)
  }
  const ligne  = (c: string, libelle: string) => `[...__co('${c}').querySelectorAll('.select-option')].find((l) => l.querySelector('.select-option-label').textContent.trim() === '${libelle}')`
  const choisir = async (c: string, libelle: string) => {
    await ouvrir(c)
    await page.evaluate(`${ligne(c, libelle)}.click()`)
    await page.waitForTimeout(80)
  }
  const invite = (c: string, champ: string) => lire(`__couleur(__co('${c}').querySelector('${champ}'), '::placeholder')`)

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    const code = await script()
    browser = await playwright[nom].launch()
    page    = await browser.newPage({ viewport: { width: 1000, height: 900 } })
    await page.addInitScript('window.__name = (f) => f')
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${code}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('.racine')?._shadow?.querySelector('.select-btn'), null, { timeout: 60000 })
    await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('mjs-carte-theme')?._shadow?.querySelector('.t-choisi')?._shadow?.querySelector('.select-btn'), null, { timeout: 60000 })
    await page.evaluate(AIDES)
    await page.waitForTimeout(500)
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('par défaut, le texte d\'attente est le texte de la liste à 62 % de sa force ; une valeur choisie garde la couleur normale', async function () {
    if (!present) { this.skip(); return }
    assert.equal(await lire(`__lib('vide').textContent.trim()`), 'Choisir…')
    assert.equal(await lire(`__lib('choisi').textContent.trim()`), 'France')
    assert.equal(await gris('choisi'), TEXTE, 'la valeur choisie : la couleur normale')
    assert.equal(await lire(`__couleur(__bt('vide'))`), TEXTE, 'le bouton garde sa couleur')
    const attente = await gris('vide')
    assert.notEqual(attente, TEXTE, 'le texte d\'attente n\'a pas la couleur d\'un vrai choix')
    assert.equal(attente, await lire(`__gris('${TEXTE}')`), 'le texte de la liste à 62 %')
  })

  it('un texte d\'attente de l\'auteur (placeholder="…") est grisé de la même façon', async function () {
    if (!present) { this.skip(); return }
    assert.equal(await lire(`__lib('perso').textContent.trim()`), 'Votre pays…')
    assert.equal(await gris('perso'), await lire(`__gris('${TEXTE}')`))
  })

  it('choix multiple : grisé tant que rien n\'est coché, couleur normale dès qu\'une option l\'est', async function () {
    if (!present) { this.skip(); return }
    const attente = await lire(`__gris('${TEXTE}')`)
    assert.equal(await gris('multi'), attente, 'rien de coché')
    assert.equal(await lire(`__lib('multi-choisi').textContent.trim()`), 'Lait')
    assert.equal(await gris('multi-choisi'), TEXTE, 'une option cochée')
  })

  it('choix multiple : cocher puis décocher ramène le gris', async function () {
    if (!present) { this.skip(); return }
    const attente = await lire(`__gris('${TEXTE}')`)
    await choisir('multi', 'Oeuf')
    assert.equal(await lire(`__lib('multi').textContent.trim()`), 'Oeuf')
    assert.equal(await gris('multi'), TEXTE, 'une option cochée')
    await choisir('multi', 'Oeuf')
    assert.equal(await lire(`__lib('multi').textContent.trim()`), 'Choisir…')
    assert.equal(await gris('multi'), attente, 'plus rien de coché : retour au gris')
    await fermer('multi')
  })

  it('choix simple : choisir une option rend la couleur normale, remettre le formulaire à zéro ramène le gris', async function () {
    if (!present) { this.skip(); return }
    const attente = await lire(`__gris('${TEXTE}')`)
    assert.equal(await gris('reset'), attente, 'au départ')
    await choisir('reset', 'Allemagne')
    assert.equal(await lire(`__lib('reset').textContent.trim()`), 'Allemagne')
    assert.equal(await gris('reset'), TEXTE, 'valeur choisie')
    await page.evaluate(`__h().querySelector('#f').reset()`)
    await attendre(`__lib('reset').textContent.trim() === 'Choisir…'`)
    assert.equal(await gris('reset'), attente, 'valeur retirée : retour au gris')
  })

  it('l\'attribut disabled, que le module ne lit pas, ne change pas le gris du texte d\'attente', async function () {
    if (!present) { this.skip(); return }
    assert.equal(await gris('desactive'), await lire(`__gris('${TEXTE}')`))
  })

  it('l\'invite du champ de recherche et celle du champ de réponse libre sont du même gris ; le texte tapé garde la couleur normale', async function () {
    if (!present) { this.skip(); return }
    const attente = await lire(`__gris('${TEXTE}')`)
    await ouvrir('recherche')
    assert.equal(await invite('recherche', '.select-search'), attente, 'la recherche')
    assert.equal(await lire(`__couleur(__co('recherche').querySelector('.select-search'))`), TEXTE, 'le texte tapé dans la recherche')
    await fermer('recherche')
    await ouvrir('autre')
    await page.evaluate(`__co('autre').querySelector('.select-other').click()`)
    await attendre(`!!__co('autre').querySelector('.select-other-input')`)
    assert.equal(await invite('autre', '.select-other-input'), attente, 'la réponse libre')
    assert.equal(await lire(`__couleur(__co('autre').querySelector('.select-other-input'))`), TEXTE, 'le texte tapé dans le champ')
    await fermer('autre')
  })

  describe('la variable --mjs-select-placeholder', () => {
    async function champs(c: string): Promise<{ recherche: string; reponse: string }> {
      await ouvrir(c)
      const recherche = await invite(c, '.select-search')
      await page.evaluate(`__co('${c}').querySelector('.select-other').click()`)
      await attendre(`!!__co('${c}').querySelector('.select-other-input')`)
      const reponse = await invite(c, '.select-other-input')
      await fermer(c)
      return { recherche, reponse }
    }

    it('posée sur un ancêtre : elle règle le texte d\'attente et les deux champs, jamais une valeur choisie', async function () {
      if (!present) { this.skip(); return }
      await page.evaluate(`__h().querySelector('.ancetre').style.setProperty('--mjs-select-placeholder', 'rgb(200, 0, 0)')`)
      const voulu = await lire(`__calcule('rgb(200, 0, 0)')`)
      assert.equal(await gris('a-vide'), voulu, 'le texte d\'attente')
      assert.equal(await gris('a-multi'), voulu, 'le choix multiple vide')
      assert.equal(await gris('a-choisi'), TEXTE, 'une valeur choisie garde la couleur normale')
      assert.deepEqual(await champs('a-vide'), { recherche: voulu, reponse: voulu }, 'la recherche et la réponse libre')
    })

    it('posée dans le bloc <theme> d\'un composant : la liste qu\'il contient la lit', async function () {
      if (!present) { this.skip(); return }
      const voulu = await lire(`__calcule('rgb(0, 0, 255)')`)
      assert.equal(await gris('t-vide'), voulu, 'le texte d\'attente')
      assert.equal(await gris('t-choisi'), TEXTE, 'une valeur choisie garde la couleur normale')
      assert.deepEqual(await champs('t-vide'), { recherche: voulu, reponse: voulu })
    })

    it('posée sur la balise elle-même (propriété) : elle règle le texte d\'attente et les deux champs', async function () {
      if (!present) { this.skip(); return }
      await page.evaluate(`__sel('balise').style.setProperty('--mjs-select-placeholder', 'rgb(255, 0, 255)')`)
      const voulu = await lire(`__calcule('rgb(255, 0, 255)')`)
      assert.equal(await gris('balise'), voulu)
      assert.deepEqual(await champs('balise'), { recherche: voulu, reponse: voulu })
    })

    it('posée sur la balise par une règle de la page : même effet', async function () {
      if (!present) { this.skip(); return }
      const voulu = await lire(`__calcule('rgb(0, 128, 0)')`)
      assert.equal(await gris('regle'), voulu)
      assert.deepEqual(await champs('regle'), { recherche: voulu, reponse: voulu })
    })

    it('posée sur :root : elle règle les listes que rien de plus proche ne règle', async function () {
      if (!present) { this.skip(); return }
      await page.evaluate(`document.documentElement.style.setProperty('--mjs-select-placeholder', 'rgb(128, 0, 128)')`)
      try {
        const voulu = await lire(`__calcule('rgb(128, 0, 128)')`)
        assert.equal(await gris('racine'), voulu, 'une liste sans réglage plus proche')
        assert.equal(await gris('vide'), voulu, 'une autre')
        assert.equal(await gris('choisi'), TEXTE, 'une valeur choisie')
        assert.deepEqual(await champs('racine'), { recherche: voulu, reponse: voulu })
        assert.equal(await gris('regle'), await lire(`__calcule('rgb(0, 128, 0)')`), 'la valeur la plus proche gagne')
      } finally {
        await page.evaluate(`document.documentElement.style.removeProperty('--mjs-select-placeholder')`)
      }
      assert.equal(await gris('vide'), await lire(`__gris('${TEXTE}')`), 'la variable retirée, le gris par défaut revient')
    })

    it('une variable retirée de l\'ancêtre rend le gris par défaut', async function () {
      if (!present) { this.skip(); return }
      await page.evaluate(`__h().querySelector('.ancetre').style.removeProperty('--mjs-select-placeholder')`)
      assert.equal(await gris('a-vide'), await lire(`__gris('${TEXTE}')`))
    })
  })

  describe('thème clair et thème sombre', () => {
    it('le gris suit la couleur du texte : à 62 % de celle du thème sombre quand la page est sombre', async function () {
      if (!present) { this.skip(); return }
      await page.evaluate(`document.documentElement.setAttribute('data-mjs-theme', 'dark')`)
      try {
        await page.waitForTimeout(150)
        const texte = await lire(`__couleur(__bt('vide'))`)
        assert.notEqual(texte, TEXTE, 'le thème sombre change la couleur du texte')
        assert.equal(await gris('choisi'), texte, 'une valeur choisie : la couleur du thème')
        assert.equal(await gris('vide'), await lire(`__gris('${texte}')`), 'le texte d\'attente : 62 % de cette couleur')
      } finally {
        await page.evaluate(`document.documentElement.removeAttribute('data-mjs-theme')`)
      }
    })

    for (const [theme, attribut] of [['clair', ''], ['sombre', 'dark']] as const) {
      it(`le texte d'attente reste lisible sur le fond du bouton (thème ${theme}) : contraste d'au moins 4,5 pour 1`, async function () {
        if (!present) { this.skip(); return }
        if (attribut) await page.evaluate(`document.documentElement.setAttribute('data-mjs-theme', '${attribut}')`)
        try {
          await page.waitForTimeout(150)
          const m = await lire(`(() => {
            const fond = getComputedStyle(__bt('vide')).backgroundColor
            const sur  = __sur(getComputedStyle(__lib('vide')).color, fond)
            const nu   = __sur(fond, fond)
            return { sur: sur, fond: nu, ratio: __contraste(sur, nu) }
          })()`)
          assert.ok(m.ratio >= 4.5, `contraste ${m.ratio.toFixed(2)} (texte ${m.sur} sur ${m.fond})`)
        } finally {
          if (attribut) await page.evaluate(`document.documentElement.removeAttribute('data-mjs-theme')`)
        }
      })
    }
  })
})
