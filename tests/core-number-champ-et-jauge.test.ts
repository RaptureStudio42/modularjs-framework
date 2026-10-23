// `<@@number>` : un champ nombre — une pilule, « − » et « + » dans ses bords, la saisie au milieu, sans
// les flèches du navigateur. `<@@gauge>` : le compteur à jauge, un composant à part. Ce fichier garde le champ : pas,
// bornes (bouton grisé), frappe nettoyée et bornée à la sortie, flèches et Page haut / bas, vide permis
// avec un `placeholder`, pas décimal, `change` à la fin du geste, valeur soumise par `name`, `disabled`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const HOST = `<script>
$q = 3
$d = 1.5
$v = ''
$g = 7
$changes = []
note = (e) -> $changes = [...$changes, e.data]
$gauge = []
noteGauge = (e) -> $gauge = [...$gauge, e.data]
</script>
<@@number class="q" value=!{$q} min="0" max="20" label="Quantité" name="quantite" @change={note(e)}></@@number>
<@@number class="d" value=!{$d} min="-2" max="2" step="0.5"></@@number>
<@@number class="v" value=!{$v} placeholder="aucun"></@@number>
<@@number class="off" value="4" disabled name="fige"></@@number>
<@@gauge class="g" value=!{$g} max="10" warn="8" wheel name="places" @change={noteGauge(e)}></@@gauge>
<p class="etat">{JSON.stringify([$q, $d, $v, $g])}</p>
<p class="changes">{JSON.stringify($changes)}</p>
<p class="gauge">{JSON.stringify($gauge)}</p>`

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('<@@number> : le champ nombre ; <@@gauge> : le compteur à jauge', function () {
  this.timeout(60000)
  let window: any
  let host: any
  const inside = (sel: string, sub: string) => host._shadow.querySelector(sel)._shadow.querySelector(sub)
  const state  = () => host._shadow.querySelector('.etat').textContent
  const type   = async (sel: string, text: string) => {
    const input = inside(sel, '.input')
    input.value = text
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await wait(40)
  }
  const press  = async (sel: string, key: string) => {
    inside(sel, '.input').dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    inside(sel, '.input').dispatchEvent(new window.KeyboardEvent('keyup', { key, bubbles: true }))
    await wait(40)
  }
  // un clic de clavier sur un bouton (Entrée, Espace) : `detail` vaut 0
  const click  = async (sel: string, sub: string) => {
    inside(sel, sub).dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 0 }))
    await wait(40)
  }

  before(async () => {
    const root   = mjsTmp('core-number')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOST)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const code  = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<form><mjs-hote></mjs-hote></form>'
    host = window.document.querySelector('mjs-hote')
    for (let i = 0; i < 150 && !host._shadow?.querySelector('.g')?._shadow?.firstElementChild; i++) await wait(20)
    await wait(80)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('le champ : un groupe nommé, « − », la saisie, « + » ; pas de champ natif `type="number"`', () => {
    const field = inside('.q', '.field')
    assert.ok(field, 'la pilule du champ')
    assert.equal(field.getAttribute('aria-label'), 'Quantité')
    assert.deepEqual([...field.children].map((c: any) => c.className), ['step less', 'input', 'step more'])
    assert.equal(inside('.q', '.input').type, 'text')
    assert.equal(inside('.q', '.input').value, '3')
    assert.equal(inside('.q', '.input').getAttribute('aria-valuemax'), '20')
  })

  it('« + » et « − » au clavier : un pas, la page suit, `change` part', async () => {
    await click('.q', '.more')
    await click('.q', '.more')
    await click('.q', '.less')
    assert.equal(JSON.parse(state())[0], 4)
    assert.equal(host._shadow.querySelector('.changes').textContent, '[4,5,4]')
  })

  it('à la borne, le bouton est grisé et la valeur ne la passe pas', async () => {
    await type('.q', '0')
    inside('.q', '.input').dispatchEvent(new window.Event('blur'))
    await wait(40)
    assert.equal(inside('.q', '.less').disabled, true)
    assert.equal(inside('.q', '.more').disabled, false)
    await click('.q', '.less')
    assert.equal(JSON.parse(state())[0], 0)
  })

  it('frappe : les lettres sont retirées ; à la sortie, la valeur est ramenée dans les bornes', async () => {
    await type('.q', '9x9')
    assert.equal(inside('.q', '.input').value, '99')
    inside('.q', '.input').dispatchEvent(new window.Event('blur'))
    await wait(40)
    assert.equal(inside('.q', '.input').value, '20')
    assert.equal(JSON.parse(state())[0], 20)
    assert.equal(inside('.q', '.more').disabled, true)
  })

  it('flèches : un pas ; Page haut / bas : dix', async () => {
    await press('.q', 'ArrowDown')
    assert.equal(JSON.parse(state())[0], 19)
    await press('.q', 'PageDown')
    assert.equal(JSON.parse(state())[0], 9)
    await press('.q', 'ArrowUp')
    assert.equal(JSON.parse(state())[0], 10)
  })

  it('pas décimal et borne négative : « , » accepté, le signe aussi', async () => {
    await press('.d', 'ArrowUp')
    assert.equal(JSON.parse(state())[1], 2)
    await type('.d', '-0,5')
    assert.equal(JSON.parse(state())[1], -0.5)
    assert.equal(inside('.d', '.input').getAttribute('inputmode'), 'decimal')
  })

  it('vide permis avec un placeholder ; de vide à 0 la page suit', async () => {
    assert.equal(inside('.v', '.input').placeholder, 'aucun')
    await type('.v', '0')
    assert.equal(JSON.parse(state())[2], 0)
    await type('.v', '')
    assert.equal(JSON.parse(state())[2], '')
  })

  it('`name` : la valeur part avec le formulaire ; `disabled` : rien ne part, rien ne bouge', async () => {
    const hidden = (sel: string) => host._shadow.querySelector(sel).querySelector('input[type=hidden]')
    assert.equal(hidden('.q').name, 'quantite')
    assert.equal(hidden('.q').value, '10')
    assertAbsent(hidden('.off'), 'disabled : aucun champ caché, rien ne part avec le formulaire')
    assert.equal(inside('.off', '.input').disabled, true)
    await click('.off', '.more')
    assert.equal(inside('.off', '.input').value, '4')
  })

  it('<@@gauge> : le compteur à jauge, « + » ajoute un pas, rouge à partir de `warn`, valeur soumise par `name`', async () => {
    assert.equal(host._shadow.querySelector('.g').tagName.toLowerCase(), 'mjs-core-gauge')
    assert.ok(inside('.g', '.box .spinner output'))
    assertAbsent(inside('.g', '.field'), 'la jauge ne dessine pas le champ du nombre')
    const sent = host._shadow.querySelector('.g').querySelector('input[type=hidden]')
    assert.equal(sent.name, 'places')
    assert.equal(sent.value, '7')
    inside('.g', '.btn').click()
    await wait(60)
    assert.equal(inside('.g', 'output').textContent, '8')
    assert.ok(inside('.g', '.meter').classList.contains('hot'))
    assert.equal(JSON.parse(state())[3], 8)
  })

  // un geste = un `change`, comme le champ : la page suit chaque pas, l'événement attend la fin
  // le champ ne porte plus la jauge : ni son boîtier ni ses réglages
  it('<@@number> ne dessine plus de jauge', () => {
    for (const c of ['.q', '.d', '.v', '.off']) {
      assertAbsent(inside(c, '.box'), 'pas de boîtier de jauge dans '+ c)
      assertAbsent(inside(c, '.meter'), 'pas de jauge dans '+ c)
    }
  })

  it('<@@gauge> : `change` part à la fin du geste — une fois pour une flèche tenue, une fois pour une série de crans', async () => {
    const gauge   = () => JSON.parse(host._shadow.querySelector('.gauge').textContent)
    const spinner = inside('.g', '.spinner')
    assert.deepEqual(gauge(), [8])
    for (let i = 0; i < 3; i++) spinner.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await wait(60)
    assert.equal(JSON.parse(state())[3], 5)
    assert.deepEqual(gauge(), [8])
    spinner.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }))
    await wait(60)
    assert.deepEqual(gauge(), [8, 5])
    for (let i = 0; i < 3; i++) {
      const notch = new window.Event('wheel', { bubbles: true, cancelable: true })
      notch.deltaY    = -100
      notch.deltaMode = 0
      inside('.g', '.box').dispatchEvent(notch)
      await wait(30)
    }
    assert.equal(JSON.parse(state())[3], 8)
    assert.deepEqual(gauge(), [8, 5])
    await wait(320)
    assert.deepEqual(gauge(), [8, 5, 8])
  })
})
