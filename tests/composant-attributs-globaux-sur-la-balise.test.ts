// les attributs globaux écrits en valeur calculée (`id={…}`) sur la balise d'un composant (`<@x>`, module cœur `<@@x>`) arrivent sur SA balise,
// comme leur forme fixe et comme sur une balise HTML : `id`, `class`, `title`, `role`, `hidden`, `tabindex`, `lang`, `dir`, `slot`, à la racine,
// dans un {for} et dans un {if}. Ils suivent leur variable (null retire l'attribut, `hidden` est un booléen) et la prop reste livrée au composant.
// Un composant qui déclare lui-même une prop de ce nom la garde pour lui : la valeur calculée lui arrive en prop seulement, sans attribut sur sa
// balise (`hidden={['x']}` ne cache pas le composant, `title={…}` ne pose pas de bulle sur lui)

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

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const HOTE = [
  '<script>',
  "  $id     = 'ck-a'",
  "  $cls    = 'c1'",
  "  $tt     = 't1'",
  "  $role   = 'note'",
  '  $tab    = 0',
  "  $lang   = 'en'",
  "  $dir    = 'rtl'",
  "  $slot   = 's1'",
  '  $cache  = false',
  '  $ouvert = true',
  "  $liste  = [{ key: 'a' }, { key: 'b' }]",
  "  $series = ['x']",
  '</script>',
  '<@carte data-t="racine" id={$id} class={$cls} title={$tt} role={$role} tabindex={$tab} lang={$lang} dir={$dir} slot={$slot} hidden={$cache}></@carte>',
  "<@@editor data-t=\"coeur\" id={$id + '-c'} title={$tt} toolbar=\"none\"></@@editor>",
  "{for t in $liste by key}<@@editor data-t={'f-' + t.key} id={'ck-' + t.key} class={'k-' + t.key} toolbar=\"none\"></@@editor>{end}",
  "{if $ouvert}<@carte data-t=\"si\" id={$id + '-si'} title={$tt}></@carte>{end}",
  '<@fiche data-t="fiche" title={$tt} hidden={$series}></@fiche>',
  "<button class=\"go\" @click={$id = 'ck-z'; $tt = null; $cls = 'c2'; $cache = true; $tab = -1}>go</button>",
].join('\n')

const CARTE = '<p class="c">carte</p>\n'
const FICHE = "<script>\n  $title  = ''\n  $hidden = []\n</script>\n<p class=\"f\">{$title}</p>\n"

describe('attributs globaux calculés sur un composant : sur sa balise', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  let hote: any
  const el  = (t: string): any => hote._shadow.querySelector('[data-t="' + t + '"]')
  const att = (t: string, nom: string): string | null => {
    const n = el(t)
    return n ? n.getAttribute(nom) : '(balise absente)'
  }

  before(async () => {
    const root   = mjsTmp('attributs-globaux-composant')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
    writeFileSync(join(srcDir, 'carte.mjs'), CARTE)
    writeFileSync(join(srcDir, 'fiche.mjs'), FICHE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang   = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code   = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.insertAdjacentHTML('beforeend', '<mjs-hote></mjs-hote>')
    hote = window.document.body.querySelector('mjs-hote')
    await pause(400)
  })

  it('a. à la racine, sur un composant de l\'appli : chaque attribut global est sur la balise', () => {
    const vu = ['id', 'class', 'title', 'role', 'tabindex', 'lang', 'dir', 'slot'].map((n) => n + '=' + att('racine', n))
    assert.deepEqual(vu, ['id=ck-a', 'class=c1', 'title=t1', 'role=note', 'tabindex=0', 'lang=en', 'dir=rtl', 'slot=s1'])
    assert.equal(att('racine', 'hidden'), null, '`hidden={false}` : pas d\'attribut')
  })

  it('b. sur un module cœur, à la racine et dans un {for} : `id` (et `class`) calculés sont sur la balise', () => {
    assert.equal(att('coeur', 'id'), 'ck-a-c')
    assert.equal(att('coeur', 'title'), 't1')
    assert.deepEqual([att('f-a', 'id'), att('f-b', 'id')], ['ck-a', 'ck-b'])
    assert.deepEqual([att('f-a', 'class'), att('f-b', 'class')], ['k-a', 'k-b'])
    assert.ok(hote._shadow.getElementById('ck-b') === el('f-b'), 'getElementById trouve l\'éditeur de la ligne')
  })

  it('c. dans un {if} : sur la balise', () => {
    assert.equal(att('si', 'id'), 'ck-a-si')
    assert.equal(att('si', 'title'), 't1')
  })

  it('d. la prop reste livrée au composant', () => {
    assert.equal(el('racine')._state.id, 'ck-a')
    assert.equal(el('si')._state.title, 't1')
  })

  it('e. l\'attribut suit sa variable : null le retire, `hidden` vrai le pose', async () => {
    hote._shadow.querySelector('.go').click()
    await pause(200)
    assert.equal(att('racine', 'id'), 'ck-z')
    assert.equal(att('racine', 'class'), 'c2')
    assert.equal(att('racine', 'title'), null)
    assert.equal(att('racine', 'tabindex'), '-1')
    assert.equal(att('racine', 'hidden'), '')
    assert.equal(att('coeur', 'id'), 'ck-z-c')
    assert.equal(att('si', 'id'), 'ck-z-si')
    assert.equal(att('si', 'title'), null)
  })

  it('f. un composant qui déclare la prop la garde : prop livrée, aucun attribut sur sa balise', () => {
    assert.equal(att('fiche', 'title'), null, 'pas de bulle `title` sur la balise')
    assert.equal(att('fiche', 'hidden'), null, 'la balise n\'est pas cachée')
    assert.equal(JSON.stringify(el('fiche')._state.hidden), '["x"]')
    assert.equal(el('fiche')._shadow.querySelector('.f').textContent, '', 'title devenu null après le clic : la prop suit')
  })
})
