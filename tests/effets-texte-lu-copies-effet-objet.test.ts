// Le texte que lisent les effets, et ce qu'un effet imbriqué tenu par une variable écrit dans le CSS, vus dans happy-dom :
// - le texte lu ne compte jamais le calque d'un effet posé plus bas : `<p *stagger>Prix <b *count>42</b></p>` se lit « Prix 42 »,
//   pas « Prix 4242 » ;
// - les copies en pseudo-élément de *split, *glitch, *neon gardent le saut de ligne d'un <br>, et lui seul : un titre écrit sur
//   plusieurs lignes dans le gabarit n'y met aucun saut de ligne ;
// - `fx: $effet` donné en objet `{ fx, s }` : ses réglages qui vont dans le CSS (les variables CSS de l'effet imbriqué, ceux d'un
//   effet CSS de l'appli) passent le filtre des valeurs CSS — une adresse est écartée — et un texte de la page passe tel quel ;
//   la valeur reprise telle quelle (le bouton « rétablir » du panneau) est filtrée de même.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// les effets et leurs sections partent avec une page qui les écrit
const COMPOSANTS: Record<string, string> = {
  'texte-prix':    '<p *stagger(on: load)>Prix <b *count(on: load)>42</b></p>',
  'texte-copies':  '<h2 *split>Titre</h2>\n<h3 *glitch>Titre</h3>\n<h4 *neon(breathe: true)>Titre</h4>',
  'texte-objet':   '<span *delta(fx: $effet)>10</span>\n<i *glitch *scramble>a</i>\n<p *halo>b</p>\n<script>\n$effet = \'none\'\n</script>',
  'app.effects.mjs': '<effects>\n  *halo(color: #0ff) =\n    box-shadow: 0 0 4px $color\n</effects>'
}

const attendre = (ms = 30) => new Promise((r) => setTimeout(r, ms))

describe('effets : le texte lu sans les calques, les copies et le <br>, l\'effet imbriqué en objet', function () {
  this.timeout(90000)
  let window: any
  let doc: any
  let µ: any
  const avis: string[] = []

  before(async () => {
    const root   = mjsTmp('effets-texte-lu-copies')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom.endsWith('.mjs') ? nom : nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    doc = window.document
    µ = window.µ
    µ._typesMode = 'warn'
    µ.warn = (m: string) => { avis.push(String(m)) }
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  const balise = (tag: string, html: string) => {
    const el = doc.createElement(tag)
    el.innerHTML = html
    doc.body.appendChild(el)
    return el
  }

  it('le texte lu ne compte pas le calque d\'un effet posé dans la balise : « Prix 42 », pas « Prix 4242 »', () => {
    const p = balise('p', 'Prix <b>42</b>')
    const b = p.querySelector('b')
    const compte = µ._mjs_fx(null, b, 'count', { on: 'load', duration: '0s' })
    const lettres = µ._mjs_fx(null, p, 'stagger', { on: 'load' })
    const lu = µ._mjs_fxOwnText(p)
    const mots = [...p.querySelectorAll(':scope > [mjs-fx-layer="text"] [mjs-fx-word]')].map((m: any) => m.textContent)
    lettres()
    compte()
    p.remove()
    assert.equal(lu, 'Prix 42')
    assert.deepEqual(mots, ['Prix', '42'])
  })

  it('*split, *glitch, *neon : leurs copies gardent le saut de ligne du <br> seul, jamais celui de la mise en forme', () => {
    const vu: Record<string, string> = {}
    for (const [nom, tag, attr, s] of [['split', 'h2', 'mjs-fx-split-text', {}], ['glitch', 'h3', 'mjs-fx-glitch-text', { mode: 'text' }], ['neon', 'h4', 'mjs-fx-neon-text', { breathe: true }]] as Array<[string, string, string, any]>) {
      const br = balise(tag, 'Ligne un<br>Ligne deux')
      const forme = balise(tag, '\n  Ligne un<br>\n  Ligne deux\n')
      const titre = balise(tag, '\n  Un titre\n  sur deux lignes du gabarit\n')
      const offs = [br, forme, titre].map((el: any) => µ._mjs_fx(null, el, nom, s))
      vu[nom + ' br'] = br.getAttribute(attr)
      vu[nom + ' forme'] = forme.getAttribute(attr)
      vu[nom + ' titre'] = titre.getAttribute(attr)
      offs.forEach((off: any) => off())
      for (const el of [br, forme, titre]) el.remove()
    }
    for (const nom of ['split', 'glitch', 'neon']) {
      assert.equal(vu[nom + ' br'], 'Ligne un\nLigne deux', nom + ' : ' + JSON.stringify(vu))
      // les sauts de ligne de la mise en forme deviennent des espaces (repliés à l'écran) : un seul \n, celui du <br>
      assert.equal(vu[nom + ' forme'].split('\n').length, 2, nom + ' : ' + JSON.stringify(vu))
      assert.equal(vu[nom + ' forme'].trim().split('\n').map((x: string) => x.trim()).join('|'), 'Ligne un|Ligne deux', nom + ' : ' + JSON.stringify(vu))
      assert.ok(!vu[nom + ' titre'].includes('\n'), nom + ' : ' + JSON.stringify(vu))
    }
  })

  // *delta joue l'effet de `fx` sur son nombre à chaque changement : on lit ce qu'il a posé
  const joue = async (effet: any) => {
    const el = balise('span', '10')
    const off = µ._mjs_fx(null, el, 'delta', {}, { fx: effet }, { fx: ['e', 'effet'] })
    await attendre()
    el.firstChild.data = '20'
    await attendre()
    const val = el.querySelector('[mjs-fx-delta-val]')
    return { el, off, val }
  }

  it('fx: $effet en objet : une adresse dans une variable CSS de l\'effet imbriqué est écartée, le reste passe', async () => {
    avis.length = 0
    const { el, off, val } = await joue({ fx: 'glitch', s: { color: 'url(http://evil.test/c.png)', color2: 'red', glow: '0 0 1px red) url(http://evil.test/f.svg#x' } })
    const vu = { color: val.style.getPropertyValue('--mjs-glitch-color'), color2: val.style.getPropertyValue('--mjs-glitch-color2'), glow: val.style.getPropertyValue('--mjs-glitch-glow'), pose: val.hasAttribute('mjs-fx') }
    off()
    el.remove()
    assert.equal(vu.pose, true, 'l\'effet imbriqué est joué : ' + JSON.stringify(vu))
    assert.equal(vu.color, '', JSON.stringify(vu))
    assert.equal(vu.glow, '', JSON.stringify(vu))
    assert.equal(vu.color2, 'red', JSON.stringify(vu))
    assert.ok(avis.some((m) => m.includes('glitch') && m.includes('color')), 'un avis en développement : ' + JSON.stringify(avis))
  })

  it('fx: $effet en objet : les réglages d\'un effet CSS de l\'appli sont filtrés, un texte de la page passe tel quel', async () => {
    µ._mjs_fxCustom('halo', { params: [['color', '#0ff']], decls: [['box-shadow', '0 0 4px $color']], keyframes: [] })
    const a = await joue({ fx: 'halo', s: { color: 'url(http://evil.test/h.png)' } })
    const halo = { color: a.val.style.getPropertyValue('--mjs-halo-color'), pose: a.val.hasAttribute('mjs-fx') }
    a.off()
    a.el.remove()
    const b = await joue({ fx: 'scramble', s: { chars: 'a;b{c}\\d' } })
    const chars = b.val._mjs_fxOff?.scramble?._s?.chars
    b.off()
    b.el.remove()
    assert.equal(halo.pose, true, JSON.stringify(halo))
    assert.equal(halo.color, '', JSON.stringify(halo))
    assert.equal(chars, 'a;b{c}\\d')
  })

  it('fx: $effet en objet : la valeur reprise telle quelle (le bouton « rétablir » du panneau) est filtrée de même', async () => {
    const { el, off, val } = await joue({ fx: 'glitch', s: { color: 'url(http://evil.test/c.png)', color2: 'red' } })
    const avant = Object.assign({}, el._mjs_fxOff.delta._s)
    µ._mjs_fxSet(el, 'delta', { fx: { fx: 'glitch', s: { color2: 'blue' } } }, { fx: ['e', 'effet'] })
    µ._mjs_fxSet(el, 'delta', { fx: avant.fx }, { fx: ['e', 'effet'] })
    el.firstChild.data = '30'
    await attendre()
    const v2 = el.querySelector('[mjs-fx-delta-val]')
    const vu = { color: v2.style.getPropertyValue('--mjs-glitch-color'), color2: v2.style.getPropertyValue('--mjs-glitch-color2'), fx: el._mjs_fxOff.delta._s.fx.fx }
    // une relance a pu remplacer la poignée : les deux partent
    el._mjs_fxOff?.delta?.()
    off()
    el.remove()
    assert.ok(val, 'premier nombre')
    assert.deepEqual(vu, { color: '', color2: 'red', fx: 'glitch' })
  })
})
