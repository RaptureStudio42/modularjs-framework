// Cases, interrupteurs et boutons radio du cœur (<@@checkbox>, <@@switch>, <@@radio>) dans un navigateur réel.
// - `change` : chaque geste de l'utilisateur qui CHANGE la valeur (souris, clavier, doigt) s'annonce par un
//   événement `change` qui remonte (bubbles, composed), comme celui de <@@select> : `e.data` = l'état coché
//   (booléen) pour la case et l'interrupteur, la valeur du bouton qui vient d'être coché pour le radio, émis
//   par ce bouton. La variable liée (`checked=!{…}`, `group=!{…}`) est déjà à jour quand l'écouteur joue.
//   Rien pour `form.reset()`, rien quand la page change elle-même l'état, rien quand on rechoisit le bouton
//   déjà coché. Le champ caché du formulaire est lui aussi à jour : `new FormData(form)`, lu dans le gestionnaire
//   (posé sur la balise ou `<form @change>`), montre l'état d'après le geste. Un `<form @change>` ne reçoit
//   l'événement que si le module n'a pas son propre `@change` (le plus proche gagne), sauf avec `.propagate` ;
//   sur `e.target`, la balise du module, `checked`, `value`, `name` et `type` ne se lisent pas.
// - Variables de thème : `--mjs-check-*` et `--mjs-switch-*` agissent posées sur un ancêtre, dans le bloc
//   `<theme>` de l'application, sur `:root` ou sur la balise elle-même ; `--mjs-accent` et `--mjs-border`
//   restent lus ; le modèle `glow` de l'interrupteur pose ses valeurs plus bas et garde la main, le modèle `triangle` garde sa
//   taille et son boîtier mais ses deux couleurs, `--mjs-switch-off` et `--mjs-switch-on` (celles du triangle, des
//   libellés `Off` et `On` et de leurs halos), se règlent comme les autres.
// - Anneau de focus clavier : sa couleur se règle par `--mjs-check-focus` (case, radio) et `--mjs-switch-focus`
//   (interrupteur), son épaisseur (3 px) et sa couleur par défaut ne bougent pas ; la voie `::part()` +
//   `:focus-within` marche sur les trois.
// Chromium et Firefox réels : de vrais clics, de vraies touches, les styles calculés par le navigateur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const VARIABLES_CASE = [
  '--mjs-check-size: 40px',
  '--mjs-check-radius: 50%',
  '--mjs-check-color: red',
  '--mjs-check-accent: lime',
  '--mjs-check-border: purple',
  '--mjs-switch-width: 90px',
  '--mjs-switch-height: 40px',
  '--mjs-switch-accent: lime',
  '--mjs-switch-color: red',
  '--mjs-switch-border: purple'
]

// les deux couleurs du modèle triangle
const VARIABLES_TRIANGLE = [
  '--mjs-switch-off: blue',
  '--mjs-switch-on: yellow'
]

const HOTE = `<script>
  $a       = true
  $b       = true
  $r       = 'x'
  $journal = []
  $lus     = []

  @noter = (qui, e, lie)->
    $journal = [...$journal, qui + ':' + e.data + ':' + lie]

  # ce que le formulaire enverrait, lu PENDANT le change
  @lire = (voie, e)->
    champs = Array.from(new FormData(e.target.closest('form'))).map((p)-> p[0] + '=' + p[1])
    sonde  = [e.target.checked, e.target.value, e.target.name, e.target.type].map((v)-> typeof v)
    $lus   = [...$lus, { voie, qui: e.target.className.split(' ')[0], data: e.data, champs, sonde }]

  @bascule = ->
    $a = false
    $b = false
    $r = 'y'
</script>

<form class="f" @noUJS>
  <div class="z-change">
    <@@checkbox class="cb" name="cb" checked=!{$a} @change={@noter('cb', e, $a)}>case</@@checkbox>
    <@@switch class="sw" name="sw" checked=!{$b} @change={@noter('sw', e, $b)}>interrupteur</@@switch>
    <@@radio class="r1" name="g" value="x" group=!{$r} @change={@noter('r1', e, $r)}>x</@@radio>
    <@@radio class="r2" name="g" value="y" group=!{$r} @change={@noter('r2', e, $r)}>y</@@radio>
    <@@radio class="r3" name="g" value="z" group=!{$r} @change={@noter('r3', e, $r)}>z</@@radio>
    <@@checkbox class="cb-off" name="off" disabled>inerte</@@checkbox>
  </div>
  <button type="reset" class="rz">remise à zéro</button>
</form>
<button type="button" class="page" @click={@bascule()}>la page change l'état</button>
<p class="journal">{$journal.join(',')}</p>

<form class="fd-balise" @noUJS>
  <@@checkbox class="cb" name="cb" @change={@lire('balise', e)}>case</@@checkbox>
  <@@checkbox class="cb-coche" name="cc" checked={true} @change={@lire('balise', e)}>cochée</@@checkbox>
  <@@switch class="sw" name="sw" @change={@lire('balise', e)}>interrupteur</@@switch>
  <@@radio class="r1" name="g" value="x" checked @change={@lire('balise', e)}>x</@@radio>
  <@@radio class="r2" name="g" value="y" @change={@lire('balise', e)}>y</@@radio>
  <@@radio class="r3" name="g" value="z" @change={@lire('balise', e)}>z</@@radio>
  <button type="reset" class="rz">remise à zéro</button>
</form>

<form class="fd-form" @noUJS @change={@lire('form', e)}>
  <@@checkbox class="cb" name="cb">case</@@checkbox>
  <@@checkbox class="cb-coche" name="cc" checked={true}>cochée</@@checkbox>
  <@@switch class="sw" name="sw">interrupteur</@@switch>
  <@@radio class="r1" name="g" value="x" checked>x</@@radio>
  <@@radio class="r2" name="g" value="y">y</@@radio>
  <@@radio class="r3" name="g" value="z">z</@@radio>
  <button type="reset" class="rz">remise à zéro</button>
</form>

<form class="fd-propage" @noUJS @change={@lire('form', e)}>
  <@@checkbox class="cb" name="cb" @change={@lire('balise', e)}>son gestionnaire</@@checkbox>
  <@@checkbox class="cb2" name="cb2" @change.propagate={@lire('balise-propage', e)}>.propagate</@@checkbox>
</form>

<div class="z-defaut">
  <@@checkbox class="cb" checked={true}>case</@@checkbox>
  <@@checkbox class="cb-off" name="a">décochée</@@checkbox>
  <@@switch class="sw" checked={true}>interrupteur</@@switch>
  <@@radio class="rd" name="d" value="x" checked>radio</@@radio>
  <@@switch class="swg" layout="glow" checked={true}></@@switch>
  <@@switch class="swg-off" layout="glow"></@@switch>
  <@@switch class="swt" layout="triangle" checked={true}></@@switch>
</div>

<div class="z-focus">
  <@@checkbox class="cb">case</@@checkbox>
  <@@switch class="sw">interrupteur</@@switch>
  <@@radio class="rd" name="i" value="x">radio</@@radio>
</div>

<div class="z-part">
  <@@checkbox class="cb">case</@@checkbox>
  <@@switch class="sw">interrupteur</@@switch>
  <@@radio class="rd" name="j" value="x">radio</@@radio>
</div>

<div class="z-ancetre">
  <@@checkbox class="cb" checked={true}>case</@@checkbox>
  <@@checkbox class="cb-off" name="b">décochée</@@checkbox>
  <@@switch class="sw" checked={true}>interrupteur</@@switch>
  <@@radio class="rd" name="e" value="x" checked>radio</@@radio>
  <@@switch class="swg" layout="glow" checked={true}></@@switch>
  <@@switch class="swg-off" layout="glow"></@@switch>
  <@@switch class="swt" layout="triangle" checked={true}></@@switch>
</div>

<div class="z-balise">
  <@@checkbox class="cb sur-balise" checked={true}>case</@@checkbox>
  <@@switch class="sw sur-balise" checked={true}>interrupteur</@@switch>
  <@@radio class="rd sur-balise" name="f" value="x" checked>radio</@@radio>
</div>

<div class="z-global">
  <@@checkbox class="cb" checked={true}>case</@@checkbox>
  <@@checkbox class="cb-off" name="c">décochée</@@checkbox>
  <@@switch class="sw" checked={true}>interrupteur</@@switch>
  <@@switch class="sw-off">éteint</@@switch>
  <@@radio class="rd" name="h" value="x" checked>radio</@@radio>
  <@@radio class="rd-off" name="n" value="x">décoché</@@radio>
</div>

<div class="z-tri-nu">
  <@@switch class="t-off" layout="triangle"></@@switch>
  <@@switch class="t-on" layout="triangle" checked={true}></@@switch>
</div>

<div class="z-tri-ancetre">
  <@@switch class="t-off" layout="triangle"></@@switch>
  <@@switch class="t-on" layout="triangle" checked={true}></@@switch>
</div>

<div class="z-tri-balise">
  <@@switch class="t-off tri-sur-balise" layout="triangle"></@@switch>
  <@@switch class="t-on tri-sur-balise" layout="triangle" checked={true}></@@switch>
</div>

<@zone-theme class="zt"></@zone-theme>

<style>
  .z-ancetre
    ${VARIABLES_CASE.join('\n    ')}
    --mjs-switch-off: blue
    --mjs-switch-on: yellow

  .sur-balise
    ${VARIABLES_CASE.join('\n    ')}

  .z-tri-ancetre
    ${VARIABLES_TRIANGLE.join('\n    ')}

  .tri-sur-balise
    ${VARIABLES_TRIANGLE.join('\n    ')}

  .z-global
    --mjs-accent: orange
    --mjs-border: purple

  .z-focus
    --mjs-check-focus: red
    --mjs-switch-focus: lime

  .z-part mjs-core-checkbox:focus-within::part(box), .z-part mjs-core-switch:focus-within::part(pill), .z-part mjs-core-radio:focus-within::part(dot)
    box-shadow: 0 0 0 4px red
</style>
`

const ZONE_THEME = `<theme>
  ${VARIABLES_CASE.join('\n  ')}
  ${VARIABLES_TRIANGLE.join('\n  ')}
</theme>

<div class="z-theme">
  <@@checkbox class="cb" checked={true}>case</@@checkbox>
  <@@switch class="sw" checked={true}>interrupteur</@@switch>
  <@@radio class="rd" name="k" value="x" checked>radio</@@radio>
</div>

<div class="z-theme-tri">
  <@@switch class="t-off" layout="triangle"></@@switch>
  <@@switch class="t-on" layout="triangle" checked={true}></@@switch>
</div>
`

// ce que le navigateur calcule pour les modules d'une zone : taille, arrondi, fond, bordure, coche
const MESURE = `window.__mesure = (racine) => {
  const cs  = (n) => getComputedStyle(n)
  const vue = (n) => { const s = cs(n); return { w: s.width, h: s.height, rayon: s.borderTopLeftRadius, fond: s.backgroundColor, bord: s.borderTopColor } }
  const de  = (cls, part) => racine.querySelector('.' + cls)._shadow.querySelector(part)
  const out = {}
  if (racine.querySelector('.cb'))    out.case     = { ...vue(de('cb', '.box')), coche: cs(de('cb', '.tick')).color }
  if (racine.querySelector('.cb-off')) out.decoch  = vue(de('cb-off', '.box'))
  if (racine.querySelector('.sw'))    out.inter    = { ...vue(de('sw', '.pill')), bouton: cs(de('sw', '.knob')).backgroundColor, bouton_w: cs(de('sw', '.knob')).width }
  if (racine.querySelector('.rd'))    out.radio    = { ...vue(de('rd', '.ring')), point: cs(de('rd', '.dot')).backgroundColor }
  if (racine.querySelector('.swg'))   out.glow     = { ...vue(de('swg', '.pill')), ombre: cs(de('swg', '.pill')).boxShadow }
  if (racine.querySelector('.swg-off')) out.glowOff = { ...vue(de('swg-off', '.pill')), ombre: cs(de('swg-off', '.pill')).boxShadow }
  if (racine.querySelector('.sw-off')) out.interOff = { ...vue(de('sw-off', '.pill')), bouton: cs(de('sw-off', '.knob')).backgroundColor }
  if (racine.querySelector('.rd-off')) out.radioOff = vue(de('rd-off', '.ring'))
  if (racine.querySelector('.swt'))   out.triangle = { ...vue(de('swt', '.pill')), bouton: cs(de('swt', '.knob')).borderBottomColor, filtre: cs(de('swt', '.knob')).filter }
  return out
}`

// les couleurs d'un modèle triangle éteint (`.t-off`) et allumé (`.t-on`) : le triangle, les libellés « On » et « Off », et leurs halos
const MESURE_TRIANGLE = `window.__triangle = (racine) => {
  const cs  = (n) => getComputedStyle(n)
  const de  = (cls, part) => racine.querySelector('.' + cls)._shadow.querySelector(part)
  const vue = (cls) => ({
    triangle: cs(de(cls, '.knob')).borderBottomColor,
    halo:     cs(de(cls, '.knob')).filter,
    libOn:    cs(de(cls, '.tri-on')).color,
    haloOn:   cs(de(cls, '.tri-on')).filter,
    libOff:   cs(de(cls, '.tri-off')).color,
    haloOff:  cs(de(cls, '.tri-off')).filter
  })
  return { eteint: vue('t-off'), allume: vue('t-on') }
}`

// les variables VARIABLES_CASE, telles que le navigateur les calcule
const AVEC_VARIABLES = {
  case:   { w: '40px', h: '40px', rayon: '50%', fond: 'rgb(0, 255, 0)', bord: 'rgb(0, 255, 0)', coche: 'rgb(255, 0, 0)' },
  decoch: { w: '40px', h: '40px', rayon: '50%', fond: 'rgba(0, 0, 0, 0)', bord: 'rgb(128, 0, 128)' },
  inter:  { w: '90px', h: '40px', rayon: '20px', fond: 'rgb(0, 255, 0)', bord: 'rgb(0, 255, 0)', bouton: 'rgb(255, 0, 0)', bouton_w: '32px' },
  radio:  { w: '40px', h: '40px', rayon: '50%', fond: 'rgba(0, 0, 0, 0)', bord: 'rgb(0, 255, 0)', point: 'rgb(0, 255, 0)' }
}

// les défauts de toujours, sans aucune variable posée
const DEFAUTS = {
  case:   { w: '20px', h: '20px', rayon: '4px', fond: 'rgb(59, 130, 246)', bord: 'rgb(59, 130, 246)', coche: 'rgb(255, 255, 255)' },
  decoch: { w: '20px', h: '20px', rayon: '4px', fond: 'rgba(0, 0, 0, 0)', bord: 'rgb(208, 208, 208)' },
  inter:  { w: '40px', h: '22px', rayon: '11px', fond: 'rgb(59, 130, 246)', bord: 'rgb(59, 130, 246)', bouton: 'rgb(255, 255, 255)', bouton_w: '14px' },
  radio:  { w: '20px', h: '20px', rayon: '50%', fond: 'rgba(0, 0, 0, 0)', bord: 'rgb(59, 130, 246)', point: 'rgb(59, 130, 246)' }
}

let construit: Promise<string> | null = null

// le build et le script concaténé, une seule fois pour les deux navigateurs
function construire(): Promise<string> {
  construit ??= (async () => {
    const root   = mjsTmp('cases-change-et-theme')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
    writeFileSync(join(srcDir, 'zone-theme.mjs'), ZONE_THEME)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const order = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    return order.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })()
  return construit
}

for (const nom of ['chromium', 'firefox'] as const) describe(`cases, interrupteurs, radios : change et variables de thème (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let script  = ''
  let page: any

  const attendre = (ms = 150) => page.waitForTimeout(ms)
  const recus    = async () => await page.evaluate('window.__rec')
  const journal  = async () => await page.evaluate(`__q('.journal').textContent`)
  const natif    = (zone: string, cls: string) => `__q('${zone} .${cls}')._shadow.querySelector('input')`
  const mesure   = (racine: string) => page.evaluate(`__mesure(${racine})`)

  // la page toute fraîche : une instance neuve de l'application, l'enregistreur de `change` posé sur le formulaire
  async function recharger(contexte: any = page) {
    await contexte.setContent(`<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script>${script}</script></body></html>`, { waitUntil: 'load' })
    await contexte.waitForFunction(() => {
      const h: any = document.querySelector('mjs-hote')
      const zt: any = h?._shadow?.querySelector('.zt')
      return !!(h?._shadow?.querySelector('.z-change .cb')?._shadow?.querySelector('input') && h._shadow.querySelector('.z-part .rd')?._shadow?.querySelector('input') && zt?._shadow?.querySelector('.cb')?._shadow?.querySelector('input'))
    })
    await contexte.evaluate(`window.__q = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)`)
    await contexte.evaluate(MESURE)
    await contexte.evaluate(MESURE_TRIANGLE)
    await contexte.evaluate(`(() => {
      window.__rec = []
      const hote = document.querySelector('mjs-hote')
      __q('.f').addEventListener('change', (e) => window.__rec.push({
        qui: e.target.className.split(' ')[0], tag: e.target.tagName.toLowerCase(), type: e.type, data: e.data, bubbles: e.bubbles, composed: e.composed,
        lie: { a: hote._state.a, b: hote._state.b, r: hote._state.r },
        etats: [__q('.r1')._state.checked, __q('.r2')._state.checked, __q('.r3')._state.checked]
      }))
    })()`)
    await contexte.waitForTimeout(400)
  }

  // le centre d'une pièce visible d'un module (la case, la pastille, l'anneau), pour de vrais clics
  async function cliquer(zone: string, cls: string, piece: string) {
    const { x, y } = await page.evaluate(`(() => {
      const r = __q('${zone} .${cls}')._shadow.querySelector('${piece}').getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await page.mouse.click(x, y)
    await attendre()
  }

  // Tab jusqu'à ce que le focus tombe sur le natif visé : un focus venu du clavier (donc :focus-visible)
  async function tabulerJusqua(zone: string, cls: string) {
    for (let i = 0; i < 60; i++) {
      const atteint = await page.evaluate(`(() => { let n = document.activeElement; while (n && n._shadow && n._shadow.activeElement) n = n._shadow.activeElement; return n === ${natif(zone, cls)} })()`)
      if (atteint) { await attendre(80); return }
      await page.keyboard.press('Tab')
      await page.waitForTimeout(30)
    }
    assert.fail(`le focus clavier n'a pas atteint ${zone} .${cls}`)
  }

  // l'ombre que le navigateur calcule pour une déclaration écrite à la main (aucune chaîne en dur)
  const reference = (valeur: string) => page.evaluate(`(() => { const d = document.createElement('div'); document.body.appendChild(d); d.style.setProperty('box-shadow', '${valeur}'); const v = getComputedStyle(d).getPropertyValue('box-shadow'); d.remove(); return v })()`)
  const anneau    = (zone: string, cls: string, piece: string) => page.evaluate(`getComputedStyle(__q('${zone} .${cls}')._shadow.querySelector('${piece}')).boxShadow`)

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      script  = await construire()
      browser = await playwright[nom].launch()
      page    = await browser.newPage({ viewport: { width: 1100, height: 900 } })
      await page.addInitScript('window.__name = (f) => f')
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  describe('change', function () {
    beforeEach(async function () {
      if (!present) { this.skip(); return }
      await recharger()
    })

    it('case, souris : un change par clic, e.data = l\'état coché, la variable liée déjà à jour, remonte jusqu\'au formulaire', async function () {
      if (!present) { this.skip(); return }
      await cliquer('.z-change', 'cb', '.box')
      await cliquer('.z-change', 'cb', '.box')
      assert.deepEqual((await recus()).map((r: any) => [r.qui, r.tag, r.type, r.data, r.lie.a, r.bubbles, r.composed]), [
        ['cb', 'mjs-core-checkbox', 'change', false, false, true, true],
        ['cb', 'mjs-core-checkbox', 'change', true, true, true, true]
      ])
      assert.equal(await journal(), 'cb:false:false,cb:true:true', 'le @change posé sur la balise lit déjà la variable à jour')
    })

    it('case, clavier : Espace sur la case focalisée annonce le change', async function () {
      if (!present) { this.skip(); return }
      await page.evaluate(`${natif('.z-change', 'cb')}.focus()`)
      await page.keyboard.press('Space')
      await attendre()
      assert.deepEqual((await recus()).map((r: any) => [r.qui, r.data, r.lie.a]), [['cb', false, false]])
      await page.keyboard.press('Space')
      await attendre()
      assert.deepEqual((await recus()).map((r: any) => [r.qui, r.data, r.lie.a]), [['cb', false, false], ['cb', true, true]])
    })

    it('interrupteur, souris puis clavier : même annonce', async function () {
      if (!present) { this.skip(); return }
      await cliquer('.z-change', 'sw', '.pill')
      await page.evaluate(`${natif('.z-change', 'sw')}.focus()`)
      await page.keyboard.press('Space')
      await attendre()
      assert.deepEqual((await recus()).map((r: any) => [r.qui, r.tag, r.data, r.lie.b]), [
        ['sw', 'mjs-core-switch', false, false],
        ['sw', 'mjs-core-switch', true, true]
      ])
      assert.equal(await journal(), 'sw:false:false,sw:true:true')
    })

    it('radio, souris : le bouton qui vient d\'être coché annonce SA valeur, la variable liée et les voisins déjà à jour', async function () {
      if (!present) { this.skip(); return }
      await cliquer('.z-change', 'r2', '.ring')
      assert.deepEqual((await recus()).map((r: any) => [r.qui, r.tag, r.data, r.lie.r, r.etats, r.bubbles, r.composed]), [
        ['r2', 'mjs-core-radio', 'y', 'y', [false, true, false], true, true]
      ])
      await cliquer('.z-change', 'r3', '.ring')
      assert.deepEqual((await recus()).map((r: any) => [r.qui, r.data]), [['r2', 'y'], ['r3', 'z']], 'un seul change par choix, jamais pour le bouton qui se décoche')
      assert.equal(await journal(), 'r2:y:y,r3:z:z')
    })

    it('radio, clavier : la flèche coche le voisin, qui annonce sa valeur', async function () {
      if (!present) { this.skip(); return }
      await page.evaluate(`${natif('.z-change', 'r1')}.focus()`)
      await page.keyboard.press('ArrowDown')
      await attendre()
      assert.deepEqual((await recus()).map((r: any) => [r.qui, r.data, r.lie.r]), [['r2', 'y', 'y']])
      await page.keyboard.press('ArrowUp')
      await attendre()
      assert.deepEqual((await recus()).map((r: any) => [r.qui, r.data, r.lie.r]), [['r2', 'y', 'y'], ['r1', 'x', 'x']])
    })

    it('radio : rechoisir le bouton déjà coché n\'annonce rien', async function () {
      if (!present) { this.skip(); return }
      await cliquer('.z-change', 'r1', '.ring')
      assert.deepEqual(await recus(), [])
      assert.equal(await journal(), '')
    })

    it('case désactivée : un clic ne change rien et n\'annonce rien', async function () {
      if (!present) { this.skip(); return }
      await cliquer('.z-change', 'cb-off', '.box')
      assert.deepEqual(await recus(), [])
    })

    it('rien quand la page change elle-même l\'état lié', async function () {
      if (!present) { this.skip(); return }
      await page.evaluate(`__q('.page').click()`)
      await attendre(300)
      const vu = await page.evaluate(`({ a: ${natif('.z-change', 'cb')}.checked, b: ${natif('.z-change', 'sw')}.checked, r1: ${natif('.z-change', 'r1')}.checked, r2: ${natif('.z-change', 'r2')}.checked })`)
      assert.deepEqual(vu, { a: false, b: false, r1: false, r2: true }, 'préalable : la page a bien changé les trois états')
      assert.deepEqual(await recus(), [])
      assert.equal(await journal(), '')
    })

    it('rien pour la remise à zéro du formulaire, qui rend pourtant les états de départ', async function () {
      if (!present) { this.skip(); return }
      await cliquer('.z-change', 'cb', '.box')
      await cliquer('.z-change', 'sw', '.pill')
      await cliquer('.z-change', 'r3', '.ring')
      assert.equal((await recus()).length, 3, 'préalable : trois gestes, trois change')
      await page.evaluate(`window.__rec.length = 0; __q('.rz').click()`)
      await attendre(300)
      const vu = await page.evaluate(`({ a: ${natif('.z-change', 'cb')}.checked, b: ${natif('.z-change', 'sw')}.checked, r1: ${natif('.z-change', 'r1')}.checked, r3: ${natif('.z-change', 'r3')}.checked })`)
      assert.deepEqual(vu, { a: true, b: true, r1: true, r3: false }, 'les états de départ sont revenus')
      assert.deepEqual(await recus(), [], 'aucun change pour la remise à zéro')
    })
  })

  describe('change, un <form @change>', function () {
    beforeEach(async function () {
      if (!present) { this.skip(); return }
      await recharger()
    })

    it('ne reçoit l\'évènement que si le module n\'a pas son propre @change : le gestionnaire le plus proche gagne, sauf avec .propagate', async function () {
      if (!present) { this.skip(); return }
      await cliquer('.fd-propage', 'cb', '.box')
      await cliquer('.fd-propage', 'cb2', '.box')
      const vus = await page.evaluate(`document.querySelector('mjs-hote')._state.lus`)
      assert.deepEqual(vus.map((l: any) => [l.voie, l.qui]), [['balise', 'cb'], ['balise-propage', 'cb2'], ['form', 'cb2']])
    })

    it('sur e.target, la balise du module, checked, value, name et type ne se lisent pas : la valeur est dans e.data', async function () {
      if (!present) { this.skip(); return }
      await cliquer('.fd-form', 'cb', '.box')
      await cliquer('.fd-form', 'sw', '.pill')
      await cliquer('.fd-form', 'r2', '.ring')
      const vus = await page.evaluate(`document.querySelector('mjs-hote')._state.lus`)
      assert.deepEqual(vus.map((l: any) => [l.qui, l.data, l.sonde.join()]), [
        ['cb', true, 'undefined,undefined,undefined,undefined'],
        ['sw', true, 'undefined,undefined,undefined,undefined'],
        ['r2', 'y', 'undefined,undefined,undefined,undefined']
      ])
    })
  })

  describe('change, au doigt', function () {
    it('un appui du doigt sur la case puis sur le radio annonce le change', async function () {
      if (!present) { this.skip(); return }
      const tactile = await browser.newContext({ viewport: { width: 1100, height: 900 }, hasTouch: true })
      const mobile  = await tactile.newPage()
      try {
        await mobile.addInitScript('window.__name = (f) => f')
        await recharger(mobile)
        const point = async (cls: string, piece: string) => await mobile.evaluate(`(() => { const r = __q('.z-change .${cls}')._shadow.querySelector('${piece}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
        let p = await point('cb', '.box')
        await mobile.touchscreen.tap(p.x, p.y)
        await mobile.waitForTimeout(250)
        p = await point('r3', '.ring')
        await mobile.touchscreen.tap(p.x, p.y)
        await mobile.waitForTimeout(250)
        const vus = await mobile.evaluate('window.__rec')
        assert.deepEqual(vus.map((r: any) => [r.qui, r.data, r.lie.a, r.lie.r]), [['cb', false, false, 'x'], ['r3', 'z', false, 'z']])
      } finally {
        await tactile.close()
      }
    })
  })

  // le champ caché de la case, de l'interrupteur et du radio est à jour AVANT que `change` parte : un gestionnaire
  // posé sur la balise, comme un `<form @change>`, lit dans `new FormData(form)` l'état d'après le geste
  describe('FormData pendant le change', function () {
    beforeEach(async function () {
      if (!present) { this.skip(); return }
      await recharger()
    })

    const lus    = async () => await page.evaluate(`document.querySelector('mjs-hote')._state.lus`)
    const champs = async (formulaire: string) => await page.evaluate(`Array.from(new FormData(__q('${formulaire}'))).map((p) => p[0] + '=' + p[1])`)

    for (const [voie, zone] of [['balise', '.fd-balise'], ['form', '.fd-form']] as const) {
      it(`${voie} : cocher et décocher la case, allumer et éteindre l'interrupteur, changer de radio : FormData montre déjà l'état d'après`, async function () {
        if (!present) { this.skip(); return }
        await cliquer(zone, 'cb', '.box')
        await cliquer(zone, 'cb', '.box')
        await cliquer(zone, 'cb-coche', '.box')
        await cliquer(zone, 'sw', '.pill')
        await cliquer(zone, 'sw', '.pill')
        await cliquer(zone, 'r2', '.ring')
        await cliquer(zone, 'r3', '.ring')
        assert.deepEqual((await lus()).map((l: any) => [l.voie, l.qui, l.data, l.champs]), [
          [voie, 'cb', true, ['cb=on', 'cc=on', 'g=x']],
          [voie, 'cb', false, ['cc=on', 'g=x']],
          [voie, 'cb-coche', false, ['g=x']],
          [voie, 'sw', true, ['sw=on', 'g=x']],
          [voie, 'sw', false, ['g=x']],
          [voie, 'r2', 'y', ['g=y']],
          [voie, 'r3', 'z', ['g=z']]
        ])
      })

      it(`${voie} : form.reset() rend les champs de départ et n'annonce aucun change`, async function () {
        if (!present) { this.skip(); return }
        await cliquer(zone, 'cb', '.box')
        await cliquer(zone, 'sw', '.pill')
        await cliquer(zone, 'r3', '.ring')
        assert.deepEqual(await champs(zone), ['cb=on', 'cc=on', 'sw=on', 'g=z'], 'préalable : trois gestes faits')
        const avant = (await lus()).length
        await page.evaluate(`__q('${zone} .rz').click()`)
        await attendre(300)
        assert.deepEqual(await champs(zone), ['cc=on', 'g=x'])
        assert.equal((await lus()).length, avant, 'aucun change pour la remise à zéro')
      })
    }
  })

  describe('variables de thème', function () {
    beforeEach(async function () {
      if (!present) { this.skip(); return }
      await recharger()
    })

    it('sans aucune variable : les défauts de toujours (taille, arrondi, accent, bordure, coche)', async function () {
      if (!present) { this.skip(); return }
      const m = await mesure(`__q('.z-defaut')`)
      assert.deepEqual({ case: m.case, decoch: m.decoch, inter: m.inter, radio: m.radio }, DEFAUTS)
      assert.equal(m.glow.w, '120px')
      assert.equal(m.glow.h, '40px')
      assert.equal(m.triangle.w, '120px')
      assert.equal(m.triangle.h, '60px')
      assert.equal(m.triangle.bouton, 'rgb(255, 0, 0)', 'triangle coché : le triangle "on" est rouge')
    })

    it('posées sur un ancêtre des modules : elles agissent, sur la case, l\'interrupteur et le radio', async function () {
      if (!present) { this.skip(); return }
      const m = await mesure(`__q('.z-ancetre')`)
      assert.deepEqual({ case: m.case, decoch: m.decoch, inter: m.inter, radio: m.radio }, AVEC_VARIABLES)
    })

    it('posées dans le bloc <theme> de l\'application (un composant qui contient les modules) : elles agissent', async function () {
      if (!present) { this.skip(); return }
      const m = await mesure(`__q('.zt')._shadow.querySelector('.z-theme')`)
      assert.deepEqual(m, { case: AVEC_VARIABLES.case, inter: AVEC_VARIABLES.inter, radio: AVEC_VARIABLES.radio })
    })

    it('posées sur :root, comme l\'exemple de la doc : --mjs-check-accent change la case et le radio, --mjs-switch-accent l\'interrupteur', async function () {
      if (!present) { this.skip(); return }
      await page.addStyleTag({ content: ':root { --mjs-check-accent: #e5484d; --mjs-switch-accent: #e5484d }' })
      await attendre(500)
      const m = await mesure(`__q('.z-defaut')`)
      assert.equal(m.case.fond, 'rgb(229, 72, 77)')
      assert.equal(m.case.bord, 'rgb(229, 72, 77)')
      assert.equal(m.inter.fond, 'rgb(229, 72, 77)')
      assert.equal(m.radio.bord, 'rgb(229, 72, 77)')
      assert.equal(m.radio.point, 'rgb(229, 72, 77)')
      assert.equal(m.case.w, '20px', 'le reste des défauts ne bouge pas')
    })

    it('posées sur la balise du module elle-même : elles agissent encore', async function () {
      if (!present) { this.skip(); return }
      const m = await mesure(`__q('.z-balise')`)
      assert.deepEqual(m, { case: AVEC_VARIABLES.case, inter: AVEC_VARIABLES.inter, radio: AVEC_VARIABLES.radio })
    })

    it('--mjs-accent et --mjs-border (le thème général) sont toujours lus par défaut', async function () {
      if (!present) { this.skip(); return }
      const m = await mesure(`__q('.z-global')`)
      assert.equal(m.case.fond, 'rgb(255, 165, 0)', 'accent orange')
      assert.equal(m.inter.fond, 'rgb(255, 165, 0)')
      assert.equal(m.radio.bord, 'rgb(255, 165, 0)')
      assert.equal(m.radio.point, 'rgb(255, 165, 0)', 'le point du radio coché suit l\'accent')
      assert.equal(m.decoch.bord, 'rgb(128, 0, 128)', 'bordure violette de la case décochée')
      assert.equal(m.interOff.bord, 'rgb(128, 0, 128)', 'bordure violette de l\'interrupteur éteint')
      assert.equal(m.interOff.bouton, 'rgb(128, 0, 128)', 'bouton violet de l\'interrupteur éteint')
      assert.equal(m.radioOff.bord, 'rgb(128, 0, 128)', 'bordure violette du radio décoché')
      assert.equal(m.case.w, '20px')
    })

    it('un modèle qui pose ses valeurs plus bas garde la main : le glow et le boîtier du triangle ne changent pas sous les mêmes variables', async function () {
      if (!present) { this.skip(); return }
      const nu   = await mesure(`__q('.z-defaut')`)
      const pose = await mesure(`__q('.z-ancetre')`)
      assert.deepEqual(pose.glow, nu.glow, 'glow allumé : taille, arrondi, fond, bordure, ombre')
      assert.deepEqual(pose.glowOff, nu.glowOff, 'glow éteint : taille, arrondi, fond, bordure, ombre')
      assert.equal(pose.glow.bord, 'rgb(32, 183, 255)', 'glow allumé sous --mjs-switch-accent : la bordure garde le bleu du modèle, pas l\'accent')
      const boitier = (t: any) => ({ w: t.w, h: t.h, rayon: t.rayon, fond: t.fond })
      assert.deepEqual(boitier(pose.triangle), boitier(nu.triangle), 'triangle : taille, arrondi et fond du boîtier ; seules ses deux couleurs suivent --mjs-switch-off/on (voir « modèle triangle »)')
    })
  })

  // les deux couleurs du modèle triangle : celles du triangle, des libellés « Off » et « On » et de leurs halos
  describe('modèle triangle : --mjs-switch-off et --mjs-switch-on', function () {
    beforeEach(async function () {
      if (!present) { this.skip(); return }
      await recharger()
      await page.waitForFunction(() => {
        const h: any  = document.querySelector('mjs-hote')
        const pret    = (n: any) => !!n?._shadow?.querySelector('.knob')
        const theme   = h?._shadow?.querySelector('.zt')?._shadow
        return pret(h?._shadow?.querySelector('.z-tri-nu .t-on')) && pret(h?._shadow?.querySelector('.z-tri-ancetre .t-on')) && pret(h?._shadow?.querySelector('.z-tri-balise .t-on')) && pret(theme?.querySelector('.z-theme-tri .t-on'))
      })
    })

    // la valeur qu'un navigateur calcule pour une déclaration écrite à la main (aucune chaîne en dur)
    const calculee = (propriete: string, valeur: string) => page.evaluate(`(() => { const d = document.createElement('div'); document.body.appendChild(d); d.style.setProperty('${propriete}', '${valeur}'); const v = getComputedStyle(d).getPropertyValue('${propriete}'); d.remove(); return v })()`)

    // ce que le navigateur doit calculer pour un couple de couleurs, interrupteur éteint puis allumé
    async function attendu(off: string, on: string) {
      const c = { off: await calculee('color', off), on: await calculee('color', on) }
      const h = { off: await calculee('filter', `drop-shadow(0 0 10px ${off}) drop-shadow(0 0 30px ${off})`), on: await calculee('filter', `drop-shadow(0 0 10px ${on}) drop-shadow(0 0 30px ${on})`) }
      return {
        eteint: { triangle: c.off, halo: h.off, libOn: c.on, haloOn: h.on, libOff: c.off, haloOff: h.off },
        allume: { triangle: c.on, halo: h.on, libOn: c.on, haloOn: h.on, libOff: c.off, haloOff: h.off }
      }
    }

    // le triangle glisse en 0,5 s : on relève ses couleurs jusqu'à ce qu'elles soient celles attendues (3 s au plus), puis on compare
    async function verifier(racine: string, off: string, on: string, message?: string) {
      const voulu = await attendu(off, on)
      let vu: any
      for (let i = 0; i < 30; i++) {
        vu = await page.evaluate(`__triangle(${racine})`)
        if (JSON.stringify(vu) === JSON.stringify(voulu)) break
        await attendre(100)
      }
      assert.deepEqual(vu, voulu, message)
      return vu
    }

    it('sans aucune variable : vert pour « Off » et le triangle éteint, rouge pour « On » et le triangle allumé, comme toujours', async function () {
      if (!present) { this.skip(); return }
      const m = await verifier(`__q('.z-tri-nu')`, '#0f0', '#f00', 'le triangle, les deux libellés et les halos, dans les deux états')
      assert.equal(m.eteint.triangle, 'rgb(0, 255, 0)', 'éteint : le triangle est vert')
      assert.equal(m.allume.triangle, 'rgb(255, 0, 0)', 'allumé : le triangle est rouge')
    })

    it('posées sur un ancêtre : le triangle, les deux libellés et leurs halos les suivent, éteint comme allumé', async function () {
      if (!present) { this.skip(); return }
      await verifier(`__q('.z-tri-ancetre')`, 'blue', 'yellow')
    })

    it('posées dans le bloc <theme> de l\'application (un composant qui contient les modules) : elles agissent', async function () {
      if (!present) { this.skip(); return }
      await verifier(`__q('.zt')._shadow.querySelector('.z-theme-tri')`, 'blue', 'yellow')
    })

    it('posées sur :root : chacune agit seule, l\'autre garde son défaut', async function () {
      if (!present) { this.skip(); return }
      await page.addStyleTag({ content: ':root { --mjs-switch-on: yellow }' })
      await verifier(`__q('.z-tri-nu')`, '#0f0', 'yellow', '--mjs-switch-on seule')
      await page.addStyleTag({ content: ':root { --mjs-switch-off: blue }' })
      await verifier(`__q('.z-tri-nu')`, 'blue', 'yellow', 'les deux')
    })

    it('posées sur la balise du module elle-même : elles agissent encore', async function () {
      if (!present) { this.skip(); return }
      await verifier(`__q('.z-tri-balise')`, 'blue', 'yellow')
    })
  })

  describe('anneau de focus clavier', function () {
    beforeEach(async function () {
      if (!present) { this.skip(); return }
      await recharger()
    })

    it('sans variable : le bleu translucide de 3 px de toujours, sur la case, l\'interrupteur et le radio', async function () {
      if (!present) { this.skip(); return }
      const attendu = await reference('0 0 0 3px rgba(59, 130, 246, .35)')
      await tabulerJusqua('.z-defaut', 'cb')
      assert.equal(await anneau('.z-defaut', 'cb', '.box'), attendu, 'case')
      await tabulerJusqua('.z-defaut', 'sw')
      assert.equal(await anneau('.z-defaut', 'sw', '.pill'), attendu, 'interrupteur')
      await tabulerJusqua('.z-defaut', 'rd')
      assert.equal(await anneau('.z-defaut', 'rd', '.ring'), attendu, 'radio')
    })

    it('--mjs-check-focus colore l\'anneau de la case et du radio, --mjs-switch-focus celui de l\'interrupteur ; l\'épaisseur reste de 3 px', async function () {
      if (!present) { this.skip(); return }
      const rouge = await reference('0 0 0 3px red')
      const vert  = await reference('0 0 0 3px lime')
      await tabulerJusqua('.z-focus', 'cb')
      assert.equal(await anneau('.z-focus', 'cb', '.box'), rouge, 'case')
      await tabulerJusqua('.z-focus', 'sw')
      assert.equal(await anneau('.z-focus', 'sw', '.pill'), vert, 'interrupteur')
      await tabulerJusqua('.z-focus', 'rd')
      assert.equal(await anneau('.z-focus', 'rd', '.ring'), rouge, 'radio')
    })

    it('la voie ::part() + :focus-within règle aussi l\'anneau, sur les trois modules', async function () {
      if (!present) { this.skip(); return }
      const attendu = await reference('0 0 0 4px red')
      await tabulerJusqua('.z-part', 'cb')
      assert.equal(await anneau('.z-part', 'cb', '.box'), attendu, 'case, part box')
      await tabulerJusqua('.z-part', 'sw')
      assert.equal(await anneau('.z-part', 'sw', '.pill'), attendu, 'interrupteur, part pill')
      await tabulerJusqua('.z-part', 'rd')
      assert.equal(await anneau('.z-part', 'rd', '.ring'), attendu, 'radio, part dot')
    })
  })
})
