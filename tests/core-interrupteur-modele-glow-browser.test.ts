// `<@@switch layout="glow">` : le modèle glow est celui de l'interrupteur, il quitte la case à cocher. Une piste en relief, un bouton qui glisse et
// un témoin qui s'allume, aux mesures qu'avait ce modèle sur la case : piste de 120 × 40 px, bouton de 80 px qui passe de 0 à 40 px, témoin de 4 px
// qui passe de 65 à 105 px et s'allume en bleu ; il reste un interrupteur : rôle `switch`, basculé à la souris comme au clavier (Espace), `change`
// et la variable liée, le champ du formulaire ; aucune variable `--mjs-switch-*` ne change ses mesures ni ses couleurs ; le mouvement réduit
// arrête ses glissements ; au clavier, son anneau de focus de 3 px se voit autour du relief, allumé comme éteint, sans rien retirer au relief.
// `<@@checkbox layout="glow">` n'a plus ce modèle : une case de 20 px, sa coche visible, et l'avertissement du variant introuvable le dit au
// développement. Chromium, Firefox et WebKit réels

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const MOTEURS = ['chromium', 'firefox', 'webkit'] as const

async function navigateurPresent(nom: typeof MOTEURS[number]): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const HOTE = `<script>
  $lumiere = false
  $journal = []

  @noter = (e)->
    $journal = [...$journal, e.data + ':' + $lumiere]
</script>

<form class="f" @noUJS>
  <@@switch class="g" name="lumiere" layout="glow" checked=!{$lumiere} @change={@noter(e)}>Lumière</@@switch>
</form>
<p class="journal">{$journal.join(' ')}</p>

<div class="poses">
  <@@switch class="g-on" layout="glow" checked={true} aria-label="allumé"></@@switch>
  <@@switch class="g-off" layout="glow" aria-label="éteint"></@@switch>
  <@@checkbox class="c" layout="glow" checked={true}>case</@@checkbox>
</div>

<div class="variables">
  <@@switch class="v-on" layout="glow" checked={true} aria-label="allumé sous les variables"></@@switch>
  <@@switch class="v-off" layout="glow" aria-label="éteint sous les variables"></@@switch>
</div>

<style>
  .variables
    --mjs-switch-width: 90px
    --mjs-switch-height: 30px
    --mjs-switch-accent: lime
    --mjs-switch-color: red
    --mjs-switch-border: purple
</style>
`

// ce que le navigateur calcule pour un interrupteur : la piste, le bouton (::before), le témoin (::after), le bouton rond d'origine, la case native
const MESURE = `window.__glow = (cls) => {
  const sh = document.querySelector('mjs-hote')._shadow.querySelector('.' + cls)._shadow
  const pill = sh && sh.querySelector('.pill')
  if (!pill) return null
  const cs  = (n, p) => getComputedStyle(n, p)
  const p   = cs(pill)
  const b   = cs(pill, '::before')
  const t   = cs(pill, '::after')
  const nat = sh.querySelector('input')
  return {
    glow:   sh.querySelector('.wrap').classList.contains('glow'),
    role:   nat.getAttribute('role'),
    type:   nat.type,
    natif:  { w: cs(nat).width, h: cs(nat).height },
    piste:  { w: p.width, h: p.height, rayon: p.borderTopLeftRadius, fond: p.backgroundImage, ombre: p.boxShadow, bord: p.borderTopColor },
    bouton: { content: b.content, left: b.left, top: b.top, w: b.width, h: b.height, rayon: b.borderTopLeftRadius, fond: b.backgroundImage, ombre: b.boxShadow, transform: b.transform },
    temoin: { content: t.content, left: t.left, w: t.width, h: t.height, fond: t.backgroundImage, couleur: t.backgroundColor, ombre: t.boxShadow },
    knob:   cs(sh.querySelector('.knob')).display,
    duree:  { bouton: b.transitionDuration, temoin: t.transitionDuration }
  }
}
window.__case = (cls) => {
  const sh = document.querySelector('mjs-hote')._shadow.querySelector('.' + cls)._shadow
  const box = sh.querySelector('.box')
  return { glow: sh.querySelector('.wrap').classList.contains('glow'), w: getComputedStyle(box).width, h: getComputedStyle(box).height, coche: getComputedStyle(sh.querySelector('.tick')).display, opacite: getComputedStyle(sh.querySelector('.tick')).opacity, sansBouton: ['none', 'normal'].includes(getComputedStyle(box, '::before').content) }
}`

let construit: Promise<{ script: string, erreurs: string[] }> | null = null

// le build et le script concaténé, une seule fois pour les trois navigateurs ; ses erreurs gardées pour le test qui les lit
function construire(): Promise<{ script: string, erreurs: string[] }> {
  construit ??= (async () => {
    const root   = mjsTmp('interrupteur-modele-glow')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
    return { script, erreurs: stats.errors.map((e: any) => String(e.message)) }
  })()
  return construit
}

describe('<@@switch layout="glow"> : la construction connaît le modèle', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('aucune erreur : glow est un modèle de l\'interrupteur, et la case sans modèle ne fait pas échouer la page', async () => {
    const { erreurs } = await construire()
    assert.deepEqual(erreurs, [])
  })
})

for (const nom of MOTEURS) describe(`<@@switch layout="glow"> : piste en relief, bouton qui glisse, témoin (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any
  const erreurs: string[] = []
  const avis: string[]    = []

  const attendre = (ms = 150) => page.waitForTimeout(ms)
  const glow     = (cls: string) => page.evaluate(`__glow('${cls}')`)
  const natif    = (cls: string) => `document.querySelector('mjs-hote')._shadow.querySelector('.${cls}')._shadow.querySelector('input')`
  const journal  = () => page.evaluate(`document.querySelector('mjs-hote')._shadow.querySelector('.journal').textContent`)
  const champs   = () => page.evaluate(`Array.from(new FormData(document.querySelector('mjs-hote')._shadow.querySelector('.f'))).map((p) => p[0] + '=' + p[1])`)

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) {
      console.log(`  ℹ️  ${nom} non installé, test du modèle glow de l'interrupteur sauté`)
      return
    }
    const { script } = await construire()
    browser = await (await import('playwright'))[nom].launch()
    page    = await browser.newPage()
    page.setDefaultTimeout(10000)
    page.on('pageerror', (e: any) => erreurs.push(String(e)))
    page.on('console', (m: any) => {
      if (m.type() === 'error') erreurs.push(m.text())
      if (m.type() === 'warning') avis.push(m.text())
    })
    await page.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${script}</script></body></html>`, { waitUntil: 'load' })
    await page.waitForFunction(() => !!(document.querySelector('mjs-hote') as any)?._shadow?.querySelector('.c')?._shadow?.querySelector('input'))
    await page.evaluate(MESURE)
    await attendre(800)
  })

  after(async () => {
    if (browser) await browser.close()
  })

  beforeEach(function () {
    if (!present) this.skip()
  })

  it('éteint : la piste sombre de 120 × 40 px, le bouton de 80 px à gauche, le témoin éteint à 65 px ; le bouton rond de l\'interrupteur n\'est pas montré', async () => {
    const m = await glow('g-off')
    assert.ok(m, 'l\'interrupteur a sa piste')
    assert.equal(m.glow, true, 'le modèle glow est posé')
    assert.deepEqual(m.natif, { w: '120px', h: '40px' }, 'la case native couvre toute la piste')
    assert.deepEqual([m.piste.w, m.piste.h, m.piste.rayon], ['120px', '40px', '20px'])
    assert.match(m.piste.fond, /^linear-gradient\(0deg, rgb\(51, 51, 51\), rgb\(0, 0, 0\)\)$/, 'piste : du gris au noir')
    assert.match(m.piste.ombre, /rgb\(53, 53, 53\) 0px 0px 0px 4px/, 'piste : l\'anneau en relief')
    assert.match(m.piste.ombre, /rgb\(62, 62, 62\) 0px 0px 0px 5px/)
    assert.doesNotMatch(m.piste.ombre, /rgb\(109, 209, 255\)/, 'éteint : pas de lueur bleue')
    assert.match(m.bouton.content, /^(""|'')$/, 'le bouton existe')
    assert.deepEqual([m.bouton.left, m.bouton.top, m.bouton.w, m.bouton.h, m.bouton.rayon], ['0px', '0px', '80px', '40px', '20px'])
    assert.match(m.bouton.fond, /^linear-gradient\(0deg, rgb\(0, 0, 0\), rgb\(107, 107, 107\)\)$/)
    assert.match(m.bouton.ombre, /^rgb\(35, 35, 35\) 0px 0px 0px 1px$/)
    assert.equal(m.bouton.transform, 'matrix(0.98, 0, 0, 0.96, 0, 0)')
    assert.match(m.temoin.content, /^(""|'')$/, 'le témoin existe')
    assert.deepEqual([m.temoin.left, m.temoin.w, m.temoin.h], ['65px', '4px', '4px'])
    assert.match(m.temoin.fond, /^linear-gradient\(0deg, rgb\(107, 107, 107\), rgb\(0, 0, 0\)\)$/, 'témoin éteint : gris')
    assert.equal(m.temoin.ombre, 'none')
    assert.equal(m.knob, 'none', 'le bouton rond de l\'interrupteur cède la place au bouton du modèle')
  })

  it('allumé : la piste bleue et sa lueur, le bouton glissé à 40 px, le témoin à 105 px, allumé', async () => {
    const m = await glow('g-on')
    assert.ok(m, 'l\'interrupteur a sa piste')
    assert.equal(m.glow, true)
    assert.deepEqual([m.piste.w, m.piste.h, m.piste.rayon], ['120px', '40px', '20px'])
    assert.match(m.piste.fond, /^linear-gradient\(0deg, rgb\(109, 209, 255\), rgb\(32, 183, 255\)\)$/, 'piste : bleue')
    assert.match(m.piste.ombre, /^rgb\(109, 209, 255\) 0px 0px 2px/, 'piste : la lueur bleue en premier')
    assert.equal(m.piste.bord, 'rgb(32, 183, 255)')
    assert.deepEqual([m.bouton.left, m.bouton.w], ['40px', '80px'])
    assert.equal(m.temoin.left, '105px')
    assert.equal(m.temoin.couleur, 'rgb(99, 205, 255)', 'témoin allumé : bleu clair')
    assert.equal(m.temoin.fond, 'none', 'témoin allumé : la couleur pleine remplace le dégradé gris')
    assert.match(m.temoin.ombre, /^rgb\(19, 179, 255\) 0px 0px 5px 0px, rgb\(19, 179, 255\) 0px 0px 15px 0px$/, 'témoin : son halo')
  })

  it('un interrupteur : la case native porte le rôle switch', async () => {
    const m = await glow('g')
    assert.ok(m, 'l\'interrupteur a sa piste')
    assert.equal(m.type, 'checkbox')
    assert.equal(m.role, 'switch')
  })

  it('à la souris : un clic sur la piste l\'allume puis l\'éteint, `change` et la variable liée suivent, et le formulaire envoie son champ', async () => {
    assert.deepEqual(await champs(), [], 'éteint : rien n\'est envoyé')
    const { x, y } = await page.evaluate(`(() => {
      const r = document.querySelector('mjs-hote')._shadow.querySelector('.g')._shadow.querySelector('.pill').getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await page.mouse.click(x, y)
    await attendre(800)
    assert.equal(await page.evaluate(`${natif('g')}.checked`), true)
    assert.equal(await journal(), 'true:true', 'change, la variable liée déjà à jour')
    assert.deepEqual(await champs(), ['lumiere=on'])
    const m = await glow('g')
    assert.deepEqual([m.bouton.left, m.temoin.left, m.temoin.couleur], ['40px', '105px', 'rgb(99, 205, 255)'], 'allumé : le bouton a glissé, le témoin s\'est allumé')
    await page.mouse.click(x, y)
    await attendre(800)
    assert.equal(await page.evaluate(`${natif('g')}.checked`), false)
    assert.equal(await journal(), 'true:true false:false')
    assert.deepEqual(await champs(), [])
    assert.deepEqual([(await glow('g')).bouton.left, (await glow('g')).temoin.left], ['0px', '65px'])
  })

  it('au clavier : Espace l\'allume puis l\'éteint, avec son `change`', async () => {
    await page.evaluate(`${natif('g')}.focus()`)
    await page.keyboard.press('Space')
    await attendre(800)
    assert.equal(await page.evaluate(`${natif('g')}.checked`), true)
    assert.deepEqual(await champs(), ['lumiere=on'])
    await page.keyboard.press('Space')
    await attendre(800)
    assert.equal(await page.evaluate(`${natif('g')}.checked`), false)
    assert.equal(await journal(), 'true:true false:false true:true false:false')
    assert.deepEqual(await champs(), [])
  })

  it('les variables --mjs-switch-* posées sur un ancêtre ne changent ni ses mesures ni ses couleurs, allumé comme éteint', async () => {
    const [on, off, vOn, vOff] = [await glow('g-on'), await glow('g-off'), await glow('v-on'), await glow('v-off')]
    assert.ok(on && off && vOn && vOff, 'les quatre interrupteurs ont leur piste')
    assert.deepEqual(vOn, on)
    assert.deepEqual(vOff, off)
  })

  it('le mouvement réduit arrête les glissements du bouton et du témoin (une demi-seconde sinon)', async () => {
    assert.deepEqual((await glow('g-off')).duree, { bouton: '0.5s', temoin: '0.5s' })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await attendre()
    try {
      assert.deepEqual((await glow('g-off')).duree, { bouton: '0s', temoin: '0s' })
    } finally {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
    }
  })

  it('au clavier, un anneau de focus de 3 px se voit autour du relief, allumé comme éteint, et le relief reste entier', async () => {
    const etat = (cls: string) => page.evaluate(`(() => {
      const sh   = document.querySelector('mjs-hote')._shadow.querySelector('.${cls}')._shadow
      const pill = sh.querySelector('.pill')
      const cs   = getComputedStyle(pill)
      const r    = pill.getBoundingClientRect()
      return { clavier: sh.querySelector('input').matches(':focus-visible'), style: cs.outlineStyle, largeur: cs.outlineWidth, ecart: cs.outlineOffset, ombre: cs.boxShadow, x: r.left, y: r.top, w: r.width }
    })()`)
    // une bande de 2 px au-dessus de la piste, de 6 à 8 px de son bord : hors des deux anneaux du relief (4 et 5 px), dans celui du focus
    const bande = async (cls: string) => {
      const e = await etat(cls)
      return page.screenshot({ clip: { x: Math.round(e.x) + 30, y: Math.round(e.y) - 8, width: Math.round(e.w) - 60, height: 2 } })
    }
    const repos = { 'g-on': await bande('g-on'), 'g-off': await bande('g-off') }
    try {
      await page.evaluate(`${natif('g')}.focus()`)
      for (const cls of ['g-on', 'g-off'] as const) {
        await page.keyboard.press('Tab')
        await attendre()
        const e = await etat(cls)
        assert.equal(e.clavier, true, `${cls} : le focus clavier est sur l'interrupteur`)
        assert.deepEqual([e.style, e.largeur], ['solid', '3px'], `${cls} : un anneau plein de 3 px`)
        assert.ok(parseFloat(e.ecart) >= 5, `${cls} : l'anneau passe hors du relief (écart ${e.ecart})`)
        assert.match(e.ombre, /rgb\(53, 53, 53\) 0px 0px 0px 4px/, `${cls} : le relief reste`)
        assert.match(e.ombre, /rgb\(62, 62, 62\) 0px 0px 0px 5px/, `${cls} : le relief reste`)
        if (cls === 'g-on') assert.match(e.ombre, /^rgb\(109, 209, 255\) 0px 0px 2px/, 'allumé : la lueur bleue reste')
        assert.notDeepEqual(await bande(cls), repos[cls], `${cls} : l'anneau se voit au-dessus de la piste`)
      }
    } finally {
      await page.evaluate(`${natif('g-off')}.blur()`)
    }
    assert.equal((await etat('g-off')).style, 'none', 'sans focus, aucun anneau')
  })

  it('<@@checkbox layout="glow"> n\'a plus ce modèle : une case de 20 px et sa coche, et l\'avertissement du variant introuvable le dit', async () => {
    const c = await page.evaluate(`__case('c')`)
    assert.deepEqual(c, { glow: false, w: '20px', h: '20px', coche: 'block', opacite: '1', sansBouton: true })
    assert.ok(avis.some((a) => a.includes('mjs-core-checkbox') && a.includes('\'glow\'')), `un avertissement cite la case et son modèle glow : ${avis.join(' | ')}`)
  })

  it('aucune erreur dans la page', async () => {
    assert.deepEqual(erreurs, [])
  })
})
