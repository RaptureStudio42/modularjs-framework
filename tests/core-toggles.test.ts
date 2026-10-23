// Modules cœur `checkbox`/`radio`/`switch` (<@@checkbox>, <@@radio>, <@@switch>,
// tags réels <mjs-core-checkbox>/<mjs-core-radio>/<mjs-core-switch>) : natif RÉEL dans le shadow
// (focus/clavier/sémantique gratuits), habillage par-dessus, participation formulaire par un
// <input type=hidden> maintenu dans le LIGHT DOM de l'hôte (stratégie primaire — sonde attachInternals
// négative : happy-dom 20.9.0 n'implémente pas `attachInternals`). Radio : coordination
// de groupe MANUELLE par name (décoche les autres <mjs-core-radio> du même name). Patron build+happy-dom
// calqué sur tests/mjs-modal-bundler-integration.test.ts:62-85.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

async function buildAndMount(hostSource: string, cores: string[]): Promise<{ window: any; document: any; hote: any; form: any }> {
  const root = mjsTmp('core-toggles')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), hostSource)

  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

  const files = readdirSync(outDir)
  const pick = (re: RegExp) => {
    const f = files.find((f) => re.test(f))
    assert.ok(f, `chunk attendu ${re} parmi ${files.join(', ')}`)
    return f!
  }
  const chunkFiles = [pick(/^mjs_core-/), ...cores.map((c) => pick(new RegExp(`^core-${c}-`))), pick(/^hote-/)]
  const code = chunkFiles.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')

  const window: any = new Window({ url: 'http://localhost/' })
  const document: any = window.document
  window.eval(`${code}\nglobalThis.µ = µ;`)
  document.body.innerHTML = '<mjs-hote></mjs-hote>'
  await new Promise((r) => setTimeout(r, 80))
  const hote = document.body.querySelector('mjs-hote')
  const form = hote._shadow.querySelector('form')
  return { window, document, hote, form }
}

function fireChange(window: any, nativeInput: any, checked: boolean): void {
  nativeInput.checked = checked
  nativeInput.dispatchEvent(new window.Event('change', { bubbles: true }))
}

describe('mjs-core-checkbox — construction', function () {
  this.timeout(30000)
  after(async () => { await terminateSharedWorkerPool() })

  it('build vert, tag <mjs-core-checkbox> réécrit dans le gabarit hôte', async () => {
    const root = mjsTmp('checkbox-build')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), '<@@checkbox name="a">Accepte</@@checkbox>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    assert.ok(stats.manifest['core-checkbox'])
    const files = readdirSync(outDir)
    const hote = files.find((f) => /^hote-/.test(f))!
    assert.match(readFileSync(join(outDir, hote), 'utf-8'), /<mjs-core-checkbox\b/)
  })
})

describe('mjs-core-checkbox — cocher/décocher, hidden, disabled', function () {
  this.timeout(30000)
  after(async () => { await terminateSharedWorkerPool() })

  const HOST = [
    '<form>',
    '  <@@checkbox name="terms" checked=!{$accepted}>J\'accepte les conditions</@@checkbox>',
    '  <@@checkbox name="premium" value="yes" checked=!{$premium}>Offre premium</@@checkbox>',
    '  <@@checkbox name="locked" checked=!{$locked} disabled={true}>Verrouillé</@@checkbox>',
    '</form>',
  ].join('\n')

  it('clic → input natif coché + hidden posé (name/value par défaut "on") + FormData le reflète', async () => {
    const { window, form } = await buildAndMount(HOST, ['checkbox'])
    const cb = form.querySelectorAll('mjs-core-checkbox')[0]
    const native = cb._shadow.querySelector('input.native')
    assert.equal(native.checked, false, 'décoché au départ')
    fireChange(window, native, true)
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(native.checked, true)
    const hidden = cb.querySelector('input[type=hidden]')
    assert.ok(hidden, 'hidden doit être posé')
    assert.equal(hidden.name, 'terms')
    assert.equal(hidden.value, 'on')
    const fd = new window.FormData(form)
    assert.equal(fd.get('terms'), 'on')
    window.close?.()
  })

  it('value personnalisée respectée sur le hidden', async () => {
    const { window, form } = await buildAndMount(HOST, ['checkbox'])
    const cb = form.querySelectorAll('mjs-core-checkbox')[1]
    const native = cb._shadow.querySelector('input.native')
    fireChange(window, native, true)
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(cb.querySelector('input[type=hidden]').value, 'yes')
    window.close?.()
  })

  it('décoché de nouveau → hidden retiré, absent de FormData', async () => {
    const { window, form } = await buildAndMount(HOST, ['checkbox'])
    const cb = form.querySelectorAll('mjs-core-checkbox')[0]
    const native = cb._shadow.querySelector('input.native')
    fireChange(window, native, true)
    await new Promise((r) => setTimeout(r, 50))
    assert.ok(cb.querySelector('input[type=hidden]'))
    fireChange(window, native, false)
    await new Promise((r) => setTimeout(r, 50))
    assertAbsent(cb.querySelector('input[type=hidden]'))
    const fd = new window.FormData(form)
    assert.equal(fd.get('terms'), null)
    window.close?.()
  })

  it('disabled : input natif désactivé, jamais de hidden même si forcé coché', async () => {
    const { window, form } = await buildAndMount(HOST, ['checkbox'])
    const cb = form.querySelectorAll('mjs-core-checkbox')[2]
    const native = cb._shadow.querySelector('input.native')
    assert.equal(native.disabled, true)
    fireChange(window, native, true)
    await new Promise((r) => setTimeout(r, 50))
    assertAbsent(cb.querySelector('input[type=hidden]'), 'un champ désactivé ne participe jamais au formulaire')
    window.close?.()
  })

  it('liaison two-way réelle : le clic met à jour la variable du PARENT ($accepted)', async () => {
    const HOST2 = [
      '<script>',
      '  $accepted = false',
      '</script>',
      '<form>',
      '  <@@checkbox name="terms" checked=!{$accepted}>Accepte</@@checkbox>',
      '</form>',
      '<p class="probe">{String($accepted)}</p>',
    ].join('\n')
    const { window, hote } = await buildAndMount(HOST2, ['checkbox'])
    const cb = hote._shadow.querySelector('mjs-core-checkbox')
    const native = cb._shadow.querySelector('input.native')
    assert.equal(hote._shadow.querySelector('.probe').textContent, 'false')
    fireChange(window, native, true)
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(hote._shadow.querySelector('.probe').textContent, 'true', 'la variable parent doit suivre le clic (mjs-bind:checked)')
    window.close?.()
  })

  it('liaison two-way réelle : un set externe (venant du parent, _set) répercute sur l\'input natif', async () => {
    const HOST2 = [
      '<script>',
      '  $accepted = false',
      '</script>',
      '<form>',
      '  <@@checkbox name="terms" checked=!{$accepted}>Accepte</@@checkbox>',
      '</form>',
      '<button type="button" class="flip" @click={$accepted = true}>flip</button>',
    ].join('\n')
    const { window, hote } = await buildAndMount(HOST2, ['checkbox'])
    const cb = hote._shadow.querySelector('mjs-core-checkbox')
    const native = cb._shadow.querySelector('input.native')
    assert.equal(native.checked, false)
    hote._shadow.querySelector('.flip').click()
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(native.checked, true, 'écrire $accepted côté parent doit cocher visuellement le natif')
    assert.ok(cb.querySelector('input[type=hidden]'), 'le hidden doit aussi apparaître')
    window.close?.()
  })
})

describe('mjs-core-radio — construction', function () {
  this.timeout(30000)
  after(async () => { await terminateSharedWorkerPool() })

  it('build vert, tag <mjs-core-radio> réécrit dans le gabarit hôte', async () => {
    const root = mjsTmp('radio-build')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), '<@@radio name="size" value="s">S</@@radio>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    assert.ok(stats.manifest['core-radio'])
    const files = readdirSync(outDir)
    const hote = files.find((f) => /^hote-/.test(f))!
    assert.match(readFileSync(join(outDir, hote), 'utf-8'), /<mjs-core-radio\b/)
  })
})

describe('mjs-core-radio — coordination de groupe, hidden, disabled', function () {
  this.timeout(30000)
  after(async () => { await terminateSharedWorkerPool() })

  const HOST = [
    '<script>',
    '  $size = null',
    '</script>',
    '<form>',
    '  <@@radio name="size" value="s" group=!{$size}>S</@@radio>',
    '  <@@radio name="size" value="m" group=!{$size}>M</@@radio>',
    '  <@@radio name="size" value="l" group=!{$size}>L</@@radio>',
    '  <@@radio name="size" value="xl" group=!{$size} disabled={true}>XL</@@radio>',
    '</form>',
  ].join('\n')

  it('cocher un radio décoche les 3 autres du même name (propriété native + hidden)', async () => {
    const { window, form } = await buildAndMount(HOST, ['radio'])
    const radios = Array.from(form.querySelectorAll('mjs-core-radio')) as any[]
    const natives = radios.map((r) => r._shadow.querySelector('input.native'))

    fireChange(window, natives[0], true)
    await new Promise((r) => setTimeout(r, 60))
    assert.equal(natives[0].checked, true)
    assert.ok(radios[0].querySelector('input[type=hidden]'))

    fireChange(window, natives[1], true)
    await new Promise((r) => setTimeout(r, 60))
    assert.equal(natives[0].checked, false, 'le 1er doit être décoché')
    assert.equal(natives[1].checked, true)
    assertAbsent(radios[0].querySelector('input[type=hidden]'), 'hidden du 1er retiré')
    assert.ok(radios[1].querySelector('input[type=hidden]'), 'hidden du 2e posé')
    window.close?.()
  })

  it('coordination MANUELLE seule (SANS liaison group=!{}) : cocher l\'un décoche quand même les autres par name', async () => {
    const HOST2 = [
      '<form>',
      '  <@@radio name="plan" value="free">Gratuit</@@radio>',
      '  <@@radio name="plan" value="pro">Pro</@@radio>',
      '</form>',
    ].join('\n')
    const { window, form } = await buildAndMount(HOST2, ['radio'])
    const radios = Array.from(form.querySelectorAll('mjs-core-radio')) as any[]
    const natives = radios.map((r) => r._shadow.querySelector('input.native'))
    fireChange(window, natives[0], true)
    await new Promise((r) => setTimeout(r, 60))
    fireChange(window, natives[1], true)
    await new Promise((r) => setTimeout(r, 60))
    assert.equal(natives[0].checked, false, 'sans group=!{}, la coordination par name doit décocher seule le 1er')
    assert.equal(natives[1].checked, true)
    const fd = new window.FormData(form)
    assert.deepEqual(fd.getAll('plan'), ['pro'])
    window.close?.()
  })

  it('un seul hidden posté à la fois (FormData ne porte qu\'une seule valeur "size")', async () => {
    const { window, form } = await buildAndMount(HOST, ['radio'])
    const radios = Array.from(form.querySelectorAll('mjs-core-radio')) as any[]
    const natives = radios.map((r) => r._shadow.querySelector('input.native'))
    fireChange(window, natives[0], true)
    await new Promise((r) => setTimeout(r, 60))
    fireChange(window, natives[2], true)
    await new Promise((r) => setTimeout(r, 60))
    fireChange(window, natives[1], true)
    await new Promise((r) => setTimeout(r, 60))
    const fd = new window.FormData(form)
    assert.deepEqual(fd.getAll('size'), ['m'])
    window.close?.()
  })

  it('group (two-way) reflète la valeur sélectionnée côté parent', async () => {
    const HOST2 = [
      '<script>',
      '  $size = null',
      '</script>',
      '<form>',
      '  <@@radio name="size" value="s" group=!{$size}>S</@@radio>',
      '  <@@radio name="size" value="m" group=!{$size}>M</@@radio>',
      '</form>',
      '<p class="probe">{String($size)}</p>',
    ].join('\n')
    const { window, hote } = await buildAndMount(HOST2, ['radio'])
    const radios = Array.from(hote._shadow.querySelectorAll('mjs-core-radio')) as any[]
    assert.equal(hote._shadow.querySelector('.probe').textContent, 'null')
    fireChange(window, radios[1]._shadow.querySelector('input.native'), true)
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(hote._shadow.querySelector('.probe').textContent, 'm')
    window.close?.()
  })

  it('disabled : jamais coché ni posté, même en tentant de forcer le natif', async () => {
    const { window, form } = await buildAndMount(HOST, ['radio'])
    const radios = Array.from(form.querySelectorAll('mjs-core-radio')) as any[]
    const nativeXl = radios[3]._shadow.querySelector('input.native')
    assert.equal(nativeXl.disabled, true)
    fireChange(window, nativeXl, true)
    await new Promise((r) => setTimeout(r, 60))
    assertAbsent(radios[3].querySelector('input[type=hidden]'))
    window.close?.()
  })
})

describe('mjs-core-switch', function () {
  this.timeout(30000)
  after(async () => { await terminateSharedWorkerPool() })

  const HOST = [
    '<form>',
    '  <@@switch name="alerts" checked=!{$alerts}>Recevoir les alertes</@@switch>',
    '  <@@switch name="locked" checked=!{$locked} disabled={true}>Verrouillé</@@switch>',
    '</form>',
  ].join('\n')

  it('build vert, tag <mjs-core-switch> réécrit dans le gabarit hôte', async () => {
    const root = mjsTmp('switch-build')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), '<@@switch name="a">Alertes</@@switch>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    assert.ok(stats.manifest['core-switch'])
  })

  it('role="switch" présent sur l\'input natif', async () => {
    const { hote } = await buildAndMount(HOST, ['switch'])
    const sw = hote._shadow.querySelector('mjs-core-switch')
    assert.equal(sw._shadow.querySelector('input.native').getAttribute('role'), 'switch')
  })

  it('bascule ON → hidden posé (name/value "on" par défaut) ; bascule OFF → hidden retiré', async () => {
    const { window, form } = await buildAndMount(HOST, ['switch'])
    const sw = form.querySelectorAll('mjs-core-switch')[0]
    const native = sw._shadow.querySelector('input.native')
    fireChange(window, native, true)
    await new Promise((r) => setTimeout(r, 50))
    const hidden = sw.querySelector('input[type=hidden]')
    assert.ok(hidden)
    assert.equal(hidden.name, 'alerts')
    assert.equal(hidden.value, 'on')
    fireChange(window, native, false)
    await new Promise((r) => setTimeout(r, 50))
    assertAbsent(sw.querySelector('input[type=hidden]'))
    window.close?.()
  })

  it('disabled : jamais de hidden même forcé', async () => {
    const { window, form } = await buildAndMount(HOST, ['switch'])
    const sw = form.querySelectorAll('mjs-core-switch')[1]
    const native = sw._shadow.querySelector('input.native')
    assert.equal(native.disabled, true)
    fireChange(window, native, true)
    await new Promise((r) => setTimeout(r, 50))
    assertAbsent(sw.querySelector('input[type=hidden]'))
    window.close?.()
  })
})

// le geste d'un utilisateur sur la case ou l'interrupteur s'annonce par un `change` qui remonte, comme celui
// de <@@select> : `e.data` = l'état coché, la variable liée (checked=!{…}) est déjà à jour quand l'écouteur
// joue. Rien quand la valeur ne bouge pas, quand la page pose elle-même l'état, ni pour `form.reset()`.
describe('mjs-core-checkbox / mjs-core-switch — l\'événement change', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const HOST = `<script>
  $accepted = false
  $alerts   = false
  $echo     = []

  @note = (qui, e, lie)->
    $echo = [...$echo, qui + ':' + e.data + ':' + lie]
</script>

<form id="f" @noUJS>
  <@@checkbox id="cb" name="terms" checked=!{$accepted} @change={@note('cb', e, $accepted)}>Accepte</@@checkbox>
  <@@switch id="sw" name="alerts" checked=!{$alerts} @change={@note('sw', e, $alerts)}>Alertes</@@switch>
  <@@checkbox id="init" name="init" checked={true}>Départ coché</@@checkbox>
</form>
<button type="button" id="flip" @click={$accepted = true}>flip</button>
<p id="echo">{$echo.join(',')}</p>`

  type Recu = { qui: string; tag: string; type: string; data: any; bubbles: boolean; composed: boolean; accepted: any; alerts: any; champs: string[] }

  async function monter(): Promise<{ window: any; hote: any; form: any; recus: Recu[] }> {
    const { window, hote, form } = await buildAndMount(HOST, ['checkbox', 'switch'])
    const recus: Recu[] = []
    form.addEventListener('change', (e: any) => recus.push({
      qui: e.target.id, tag: e.target.tagName.toLowerCase(), type: e.type, data: e.data, bubbles: e.bubbles, composed: e.composed,
      accepted: hote._state.accepted, alerts: hote._state.alerts,
      champs: Array.from(new window.FormData(form).entries()).map((p: any) => p[0] + '=' + p[1])
    }))
    return { window, hote, form, recus }
  }

  const natif = (hote: any, id: string) => hote._shadow.querySelector('#' + id)._shadow.querySelector('input.native')
  const pause = (ms = 60) => new Promise((r) => setTimeout(r, ms))

  it('case : cocher puis décocher annonce chaque état, la variable liée est déjà à jour, la balise est la cible', async () => {
    const { window, hote, recus } = await monter()
    fireChange(window, natif(hote, 'cb'), true)
    await pause()
    fireChange(window, natif(hote, 'cb'), false)
    await pause()
    assert.deepEqual(recus.map((r) => [r.qui, r.tag, r.type, r.data, r.accepted, r.bubbles, r.composed]), [
      ['cb', 'mjs-core-checkbox', 'change', true, true, true, true],
      ['cb', 'mjs-core-checkbox', 'change', false, false, true, true]
    ])
    window.close?.()
  })

  it('case : le @change posé sur la balise lit la variable déjà à jour', async () => {
    const { window, hote } = await monter()
    fireChange(window, natif(hote, 'cb'), true)
    await pause()
    assert.equal(hote._shadow.querySelector('#echo').textContent, 'cb:true:true')
    window.close?.()
  })

  it('case : un change natif qui laisse l\'état tel quel n\'annonce rien', async () => {
    const { window, hote, recus } = await monter()
    fireChange(window, natif(hote, 'cb'), false)
    await pause()
    assert.deepEqual(recus, [])
    window.close?.()
  })

  it('case : la page qui pose elle-même l\'état n\'annonce rien (le natif suit)', async () => {
    const { window, hote, recus } = await monter()
    hote._shadow.querySelector('#flip').click()
    await pause(100)
    assert.equal(natif(hote, 'cb').checked, true, 'préalable : l\'état posé par la page est arrivé au natif')
    assert.deepEqual(recus, [])
    assert.equal(hote._shadow.querySelector('#echo').textContent, '')
    window.close?.()
  })

  it('interrupteur : même annonce, charge booléenne, variable liée à jour', async () => {
    const { window, hote, recus } = await monter()
    fireChange(window, natif(hote, 'sw'), true)
    await pause()
    fireChange(window, natif(hote, 'sw'), false)
    await pause()
    assert.deepEqual(recus.map((r) => [r.qui, r.tag, r.data, r.alerts, r.bubbles, r.composed]), [
      ['sw', 'mjs-core-switch', true, true, true, true],
      ['sw', 'mjs-core-switch', false, false, true, true]
    ])
    assert.equal(hote._shadow.querySelector('#echo').textContent, 'sw:true:true,sw:false:false')
    window.close?.()
  })

  it('interrupteur : un change natif qui laisse l\'état tel quel n\'annonce rien', async () => {
    const { window, hote, recus } = await monter()
    fireChange(window, natif(hote, 'sw'), false)
    await pause()
    assert.deepEqual(recus, [])
    window.close?.()
  })

  it('FormData lu pendant le change : déjà l\'état d\'après le geste, pour la case et pour l\'interrupteur', async () => {
    const { window, hote, recus } = await monter()
    fireChange(window, natif(hote, 'cb'), true)
    await pause()
    fireChange(window, natif(hote, 'sw'), true)
    await pause()
    fireChange(window, natif(hote, 'cb'), false)
    await pause()
    fireChange(window, natif(hote, 'init'), false)
    await pause()
    assert.deepEqual(recus.map((r) => [r.qui, r.champs]), [
      ['cb', ['terms=on', 'init=on']],
      ['sw', ['terms=on', 'alerts=on', 'init=on']],
      ['cb', ['alerts=on', 'init=on']],
      ['init', ['alerts=on']]
    ])
    window.close?.()
  })

  it('form.reset() ne annonce aucun change, case et interrupteur rendus à leur état de départ', async () => {
    const { window, hote, form, recus } = await monter()
    fireChange(window, natif(hote, 'cb'), true)
    fireChange(window, natif(hote, 'sw'), true)
    fireChange(window, natif(hote, 'init'), false)
    await pause()
    assert.equal(recus.length, 3, 'préalable : trois gestes, trois change')
    recus.length = 0
    form.reset()
    await pause(100)
    assert.deepEqual([natif(hote, 'cb').checked, natif(hote, 'sw').checked, natif(hote, 'init').checked], [false, false, true], 'les états de départ sont revenus')
    assert.deepEqual(recus, [])
    window.close?.()
  })
})

// les variables de thème de la case, du radio et de l'interrupteur se lisent là où elles servent
// (`var(--nom, défaut)`) : les modules n'en déclarent aucune sur leur balise, si bien qu'une valeur venue d'un
// ancêtre ou du bloc <theme> de l'application passe. Le build le sait : déclarer l'une d'elles dans une
// application n'accuse pas les modules du cœur dans le rappel `lint.themeShared`.
describe('modules cœur case, radio, interrupteur — variables de thème et lint.themeShared', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  async function construire(theme: string[]): Promise<string[]> {
    const root = mjsTmp('cases-theme-shared')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), [
      '<theme>',
      ...theme.map((l) => '  ' + l),
      '</theme>',
      '<@@checkbox name="a">A</@@checkbox>',
      '<@@checkbox name="g" layout="glow">G</@@checkbox>',
      '<@@radio name="b" value="x">B</@@radio>',
      '<@@switch name="c">C</@@switch>',
      '<@@switch name="t" layout="triangle">T</@@switch>'
    ].join('\n'))
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    return stats.warnings.filter((w) => w.endsWith('[lint.themeShared]'))
  }

  it('--mjs-check-* et --mjs-switch-* déclarés dans le <theme> de l\'application : aucune ligne themeShared ne cite un module du cœur', async () => {
    const lignes = await construire([
      '--mjs-check-size: 24px', '--mjs-check-radius: 50%', '--mjs-check-accent: #e5484d', '--mjs-check-color: #fff', '--mjs-check-border: #999', '--mjs-check-focus: #e5484d',
      '--mjs-switch-width: 48px', '--mjs-switch-height: 26px', '--mjs-switch-accent: #e5484d', '--mjs-switch-color: #fff', '--mjs-switch-border: #999', '--mjs-switch-focus: #e5484d'
    ])
    assert.deepEqual(lignes.filter((w) => /core-(checkbox|radio|switch)/.test(w)), [], `les modules du cœur ne déclarent aucune de ces variables : ${lignes.join('\n')}`)
  })
})
