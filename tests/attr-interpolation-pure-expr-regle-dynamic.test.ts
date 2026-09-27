// `interpolation()` (generator/attributes/index.ts) — une valeur d'attribut
// ENTRE GUILLEMETS réduite à UNE SEULE expression (`attr="{expr}"`, rien
// d'autre dans la chaîne : cas `isPureExpr`) est évaluée comme la forme sans
// guillemets `attr={expr}` — expression BRUTE (booléenne, `null`…), jamais
// convertie en texte. `disabled="{$flag}"` avec `$flag` à `false` retire donc
// l'attribut (au lieu du texte `"false"`) ; `href="{$x}"` avec `$x` à
// `null`/`undefined` retire l'attribut (au lieu du texte `"null"`/
// `"undefined"`). `0` et `''` restent des valeurs POSÉES (ni `false`, ni
// `null`, ni `undefined`) : jamais retirées. Dès que la valeur quotée mélange
// du texte et une expression (ou en enchaîne plusieurs), le résultat reste
// une chaîne assemblée par concaténation — comportement inchangé, non
// couvert ici.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string): string => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

async function build(files: Record<string, string>, tag: string): Promise<string> {
  const root   = mjsTmp('attr-pure-expr-' + tag)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(srcDir, rel), content)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return outDir
}

function mountAll(outDir: string, hostTag: string) {
  const win: any      = new Window({ url: 'http://localhost/' })
  const document: any = win.document
  const files    = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const coreFile = files.find((f) => /^mjs_core-/.test(f))!
  const code = files
    .filter((f) => f !== coreFile)
    .reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coreFile), 'utf-8')))
  win.eval(`${code}\nglobalThis.µ = µ;`)
  document.body.innerHTML = `<${hostTag}></${hostTag}>`
  return { win, document, el: document.body.firstElementChild }
}

const tick  = () => new Promise((r) => setTimeout(r, 0))
const ticks = async (n = 2) => { for (let i = 0; i < n; i++) await tick() }

describe('attr="{expr}" (guillemets, une seule expression) suit la règle de attr={expr}', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('root — booléen vrai/faux : disabled="{$flag}" pose ou retire l\'attribut, jamais le texte "false"', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$flag = true',
      'toggle = -> $flag = not $flag',
      '</script>',
      '<input id="i" type="checkbox" disabled="{$flag}" />',
      '<button id="btn" @click={toggle}>t</button>',
    ].join('\n')

    const outDir = await build({ 'hotebool.mjs': HOTE }, 'bool')
    const { win, el } = mountAll(outDir, 'mjs-hotebool')
    await ticks()
    const shadow = el._shadow || el.shadowRoot
    const i: any = shadow.querySelector('#i')
    assert.equal(i.disabled, true, 'flag=true : disabled posé')
    assert.equal(i.hasAttribute('disabled'), true)

    shadow.querySelector('#btn').dispatchEvent(new win.Event('click', { bubbles: true }))
    await ticks()
    assert.equal(i.disabled, false, 'flag=false : disabled retiré, pas juste "désactivé visuellement"')
    assert.equal(i.hasAttribute('disabled'), false, 'AVANT le fix : l\'attribut restait posé avec le texte "false"')

    shadow.querySelector('#btn').dispatchEvent(new win.Event('click', { bubbles: true }))
    await ticks()
    assert.equal(i.disabled, true, 'retour à flag=true : reposé normalement')

    win.close?.()
  })

  it('root — non booléen, null/undefined : href="{$x}" retire l\'attribut, jamais le texte "null"/"undefined"', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$x = \'https://ok.example/\'',
      'setNull = -> $x = null',
      'setBack = -> $x = \'https://ok.example/\'',
      'setUndef = -> $x = undefined',
      '</script>',
      '<a id="a" href="{$x}">lien</a>',
      '<button id="btnNull" @click={setNull}>null</button>',
      '<button id="btnBack" @click={setBack}>back</button>',
      '<button id="btnUndef" @click={setUndef}>undef</button>',
    ].join('\n')

    const outDir = await build({ 'hotenull.mjs': HOTE }, 'null')
    const { win, el } = mountAll(outDir, 'mjs-hotenull')
    await ticks()
    const shadow = el._shadow || el.shadowRoot
    const a: any = shadow.querySelector('#a')
    assert.equal(a.getAttribute('href'), 'https://ok.example/', 'valeur initiale posée telle quelle')

    shadow.querySelector('#btnNull').dispatchEvent(new win.Event('click', { bubbles: true }))
    await ticks()
    assert.equal(a.hasAttribute('href'), false, 'AVANT le fix : le texte littéral "null" restait posé')

    shadow.querySelector('#btnBack').dispatchEvent(new win.Event('click', { bubbles: true }))
    await ticks()
    assert.equal(a.getAttribute('href'), 'https://ok.example/', 'reposé normalement après un retour à une valeur définie')

    shadow.querySelector('#btnUndef').dispatchEvent(new win.Event('click', { bubbles: true }))
    await ticks()
    assert.equal(a.hasAttribute('href'), false, 'AVANT le fix : le texte littéral "undefined" restait posé')

    win.close?.()
  })

  it('root — 0 et chaîne vide restent des valeurs POSÉES (ni false, ni null, ni undefined)', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$num = 5',
      '$str = \'x\'',
      'setZero = -> $num = 0',
      'setEmpty = -> $str = \'\'',
      '</script>',
      '<span id="n" data-n="{$num}"></span>',
      '<span id="s" data-s="{$str}"></span>',
      '<button id="btnZero" @click={setZero}>0</button>',
      '<button id="btnEmpty" @click={setEmpty}>empty</button>',
    ].join('\n')

    const outDir = await build({ 'hotezero.mjs': HOTE }, 'zero')
    const { win, el } = mountAll(outDir, 'mjs-hotezero')
    await ticks()
    const shadow = el._shadow || el.shadowRoot
    const n: any = shadow.querySelector('#n')
    const s: any = shadow.querySelector('#s')
    assert.equal(n.getAttribute('data-n'), '5')
    assert.equal(s.getAttribute('data-s'), 'x')

    shadow.querySelector('#btnZero').dispatchEvent(new win.Event('click', { bubbles: true }))
    shadow.querySelector('#btnEmpty').dispatchEvent(new win.Event('click', { bubbles: true }))
    await ticks()

    assert.equal(n.hasAttribute('data-n'), true, '0 numérique n\'est pas retiré comme false/null/undefined')
    assert.equal(n.getAttribute('data-n'), '0')
    assert.equal(s.hasAttribute('data-s'), true, 'une chaîne vide n\'est pas retirée comme false/null/undefined')
    assert.equal(s.getAttribute('data-s'), '')

    win.close?.()
  })

  it('{for} — booléen vrai/faux par ligne : disabled="{row.flag}" suit la même règle', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$rows = [',
      '  { id: 1, flag: true }',
      '  { id: 2, flag: false }',
      ']',
      'toggleRow1 = -> $rows[0].flag = false',
      '</script>',
      '<div>',
      '  {for row in $rows by id}',
      '    <input type="checkbox" class="dis" disabled="{row.flag}" />',
      '  {end}',
      '</div>',
      '<button id="btn" @click={toggleRow1}>t</button>',
    ].join('\n')

    const outDir = await build({ 'hoteforbool.mjs': HOTE }, 'forbool')
    const { win, el } = mountAll(outDir, 'mjs-hoteforbool')
    await ticks()
    const shadow = el._shadow || el.shadowRoot
    const rows: any[] = Array.from(shadow.querySelectorAll('input.dis'))
    assert.equal(rows.length, 2)
    assert.equal(rows[0].disabled, true, 'ligne 1 : flag=true')
    assert.equal(rows[1].disabled, false, 'ligne 2 : flag=false')
    assert.equal(rows[1].hasAttribute('disabled'), false)

    shadow.querySelector('#btn').dispatchEvent(new win.Event('click', { bubbles: true }))
    await ticks()
    assert.equal(rows[0].disabled, false, 'ligne 1 basculée à flag=false : attribut retiré')
    assert.equal(rows[0].hasAttribute('disabled'), false)

    win.close?.()
  })

  it('{for} — non booléen, null par ligne : href="{row.url}" retire l\'attribut, jamais le texte "null"', async () => {
    const HOTE = [
      '<script lang="coffee">',
      '$rows = [',
      '  { id: 1, url: \'https://a.example/\' }',
      '  { id: 2, url: null }',
      ']',
      '</script>',
      '<div>',
      '  {for row in $rows by id}',
      '    <a class="lk" href="{row.url}">x</a>',
      '  {end}',
      '</div>',
    ].join('\n')

    const outDir = await build({ 'hoteforurl.mjs': HOTE }, 'forurl')
    const { win, el } = mountAll(outDir, 'mjs-hoteforurl')
    await ticks()
    const shadow = el._shadow || el.shadowRoot
    const links: any[] = Array.from(shadow.querySelectorAll('a.lk'))
    assert.equal(links.length, 2)
    assert.equal(links[0].getAttribute('href'), 'https://a.example/')
    assert.equal(links[1].hasAttribute('href'), false,
      'AVANT le fix : le texte littéral "null" restait posé sur la ligne dont l\'url est null')

    win.close?.()
  })
})
