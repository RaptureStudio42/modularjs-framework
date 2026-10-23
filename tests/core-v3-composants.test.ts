// Modules cœur de la V3 — `<@@carousel>`, `<@@deck>`, `<@@tabs>`, `<@@menu>`, `<@@clock>`, `<@@knob>`,
// `<@@number>`, `<@@progress>`, `<@@cube>`, `<@@switch>`, `<@@checkbox>`, `<@@field>` : chacun
// compile, se monte, et répond à son geste principal (bouton, clic, clavier), avec sa valeur liée
// dans les deux sens quand il en a une. Leurs modèles se choisissent tous par `layout` (plus de
// `mode`, `look` ni `indicator`).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const HOTE = `<script>
$i     = 0
$tab   = 'b'
$open  = false
$k     = 50
$n     = 7
$p     = 40
</script>
<@@carousel class="car" index=!{$i}><div>1</div><div>2</div><div>3</div><div>4</div><div>5</div></@@carousel>
<p class="i">{$i}</p>
<@@deck class="deck"><div title="A">A</div><div title="B">B</div><div title="C">C</div></@@deck>
<@@tabs class="tabs" value=!{$tab}><span value="a">A</span><span value="b">B</span><span value="c">C</span></@@tabs>
<p class="tab">{$tab}</p>
<@@menu class="menu" open=!{$open}><a>1</a><a>2</a><a>3</a></@@menu>
<@@clock class="horloge"></@@clock>
<@@clock class="minuteur" layout="timer" seconds="30" running="false"></@@clock>
<@@knob class="knob" value=!{$k} min="0" max="100"></@@knob>
<p class="k">{$k}</p>
<@@gauge class="nombre" value=!{$n} max="10" warn="8"></@@gauge>
<@@progress class="prog" value={$p}></@@progress>
<@@cube class="cube">X</@@cube>
<@@switch class="sw" layout="triangle" on="Oui" off="Non">Mode</@@switch>
<@@checkbox class="cb" layout="glow">Lumière</@@checkbox>
<@@field class="fl" layout="float" label="Nom" icon="👤"><input name="nom" aria-label="Nom"></@@field>
<@@deck class="deck2" layout="spread"><div title="A">A</div><div title="B">B</div></@@deck>
<@@carousel class="car2" layout="flat"><div>1</div><div>2</div><div>3</div></@@carousel>
<@@menu class="menu2" layout="drawer"><a>1</a></@@menu>
<@@tabs class="tabs2" layout="curve"><span value="a">A</span><span value="b">B</span></@@tabs>`

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('modules cœur de la V3', function () {
  this.timeout(60000)
  let window: any
  let hote: any
  const sh = (sel: string) => hote._shadow.querySelector(sel)
  const dedans = (sel: string, sous: string) => sh(sel)._shadow.querySelector(sous)

  before(async () => {
    const root   = mjsTmp('core-v3')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const code  = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
    hote = window.document.querySelector('mjs-hote')
    await attendre(() => !!hote._shadow?.querySelector('.fl')?._shadow?.querySelector('.control'))
    await new Promise((r) => setTimeout(r, 60))
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('<@@carousel> : chaque vignette connaît son écart au centre ; « suivant » avance, la valeur suit', async () => {
    const items = [...sh('.car').children]
    assert.deepEqual(items.map((d: any) => d.getAttribute('mjs-carousel-pos')), ['0', '1', '2', '-2', '-1'])
    dedans('.car', '.next').click()
    await attendre(() => sh('.i').textContent === '1')
    assert.equal(sh('.i').textContent, '1')
    assert.equal(items[1].getAttribute('mjs-carousel-pos'), '0')
    assert.equal(items[0].style.getPropertyValue('--mjs-carousel-x'), '-150px')
  })

  it('<@@deck> : les cartes rangées autour du milieu du paquet', () => {
    const rangs = [...sh('.deck').children].map((d: any) => d.style.getPropertyValue('--mjs-deck-i'))
    assert.deepEqual(rangs, ['-1', '0', '1'])
  })

  it('<@@tabs> : l\'onglet de la valeur porte `active` ; un clic change d\'onglet, la valeur suit', async () => {
    const tabs = [...sh('.tabs').children]
    assert.ok(tabs[1].hasAttribute('active'))
    tabs[2].click()
    await attendre(() => sh('.tab').textContent === 'c')
    assert.equal(sh('.tab').textContent, 'c')
    await attendre(() => tabs[2].hasAttribute('active'))
    assert.ok(tabs[2].hasAttribute('active') && !tabs[1].hasAttribute('active'))
  })

  it('<@@menu> : le bouton ouvre et ferme', async () => {
    dedans('.menu', '.toggle').click()
    await attendre(() => !!dedans('.menu', '.radial.open'))
    assert.ok(dedans('.menu', '.radial.open'))
    assert.equal([...sh('.menu').children][2].style.getPropertyValue('--mjs-menu-i'), '2')
  })

  it('<@@clock> : trois cadrans de 60 traits ; le minuteur arrêté affiche 00', () => {
    assert.equal(sh('.horloge')._shadow.querySelectorAll('.dots').length, 3)
    assert.equal(sh('.horloge')._shadow.querySelectorAll('.tick').length, 180)
    assert.equal(sh('.horloge')._shadow.querySelectorAll('.tick.active').length, 3)
    assert.equal(dedans('.minuteur', '.number b').textContent, '00')
  })

  it('<@@knob> : la flèche monte la valeur d\'un pas, liée dans les deux sens', async () => {
    const k = dedans('.knob', '.knob')
    assert.equal(k.getAttribute('aria-valuenow'), '50')
    k.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    await attendre(() => sh('.k').textContent === '51')
    assert.equal(sh('.k').textContent, '51')
  })

  it('<@@gauge> : « + » ajoute un pas ; la jauge passe au rouge à partir de warn', async () => {
    assert.ok(!dedans('.nombre', '.meter').classList.contains('hot'))
    dedans('.nombre', '.btn').click()
    await attendre(() => dedans('.nombre', 'output').textContent === '8')
    assert.equal(dedans('.nombre', 'output').textContent, '8')
    assert.ok(dedans('.nombre', '.meter').classList.contains('hot'))
  })

  it('<@@progress> : le pourcentage écrit au centre', () => {
    assert.equal(dedans('.prog', 'text').textContent, '40%')
  })

  it('<@@cube> : le contenu passe sur le dessus du cube', () => {
    assert.ok(dedans('.cube', '.top slot'))
    assert.equal(dedans('.cube', '.box').children.length, 4)
  })

  it('layout : switch triangle, checkbox glow, field float', () => {
    assert.ok(dedans('.sw', '.wrap.triangle'))
    assert.equal(dedans('.sw', '.tri-on').textContent, 'Oui')
    assert.ok(dedans('.cb', '.wrap.glow'))
    assert.ok(dedans('.fl', '.field.float .control .float-label'))
    assert.equal(dedans('.fl', '.icon').textContent, '👤')
  })

  it('layout : horloge ou minuteur, éventail ou étalé, 3D ou à plat, rond ou tiroir, glissé ou courbe', () => {
    assert.ok(dedans('.horloge', '.dots') && !dedans('.horloge', '.timer'))
    assert.ok(dedans('.minuteur', '.timer') && !dedans('.minuteur', '.dots'))
    assert.ok(dedans('.deck', '.deck.fan') && dedans('.deck2', '.deck.spread'))
    assert.ok(!dedans('.car', '.carousel.flat') && dedans('.car2', '.carousel.flat'))
    assert.ok(dedans('.menu', '.radial') && dedans('.menu2', '.drawer'))
    assert.ok(dedans('.tabs', '.tabs.slide') && dedans('.tabs2', '.tabs.curve'))
  })
})

describe('modules cœur : les anciens noms des modèles', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  // `mode`, `look` et `indicator` n'ont jamais été publiés comme noms de modèle : ce sont des
  // attributs comme les autres, le build passe sans rien en dire
  it('mode, look, indicator : des attributs ordinaires, aucune erreur du build', async () => {
    const root   = mjsTmp('core-v3-anciens')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'un.mjs'), '<@@switch look="triangle"></@@switch>\n')
    writeFileSync(join(srcDir, 'deux.mjs'), '<@@clock mode="timer"></@@clock>\n')
    writeFileSync(join(srcDir, 'trois.mjs'), '<mjs-core-tabs indicator="curve"></mjs-core-tabs>\n')
    writeFileSync(join(srcDir, 'quatre.mjs'), '<@@carousel mode={$m}></@@carousel>\n')
    writeFileSync(join(srcDir, 'cinq.mjs'), '<@@deck mode="fan"></@@deck>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  })
})
