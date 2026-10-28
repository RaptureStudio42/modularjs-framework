// {for} sans `by` : un objet est suivi par son identité, une valeur simple par sa position (docs/05-blocs.md, « Suivi keyé »).
// Un objet retiré emporte sa ligne et les autres gardent la leur ; un objet recopié est une ligne neuve ; une valeur simple
// retirée en tête décale les valeurs d'une ligne et c'est la dernière ligne qui disparaît

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const CORPS = [
  '<script lang="coffee">',
  '$things = [{ id: 1, name: \'a\' }, { id: 2, name: \'b\' }, { id: 3, name: \'c\' }]',
  '$mots = [\'x\', \'y\', \'z\']',
  'retirer = -> $things.shift()',
  'recopier = -> $things = $things.map((t) -> { ...t })',
  'retirerMot = -> $mots.shift()',
  '</script>',
  '<ul class="obj">{for thing in $things}<li>{thing.name}</li>{end}</ul>',
  '<ul class="val">{for mot in $mots}<li>{mot}</li>{end}</ul>',
  '<button id="r" @click={retirer()}>r</button><button id="c" @click={recopier()}>c</button><button id="m" @click={retirerMot()}>m</button>'
].join('\n')

const tic = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)) }

describe('{for} sans `by` — objet suivi par identité, valeur simple par position', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('retrait, recopie, valeur simple', async () => {
    const root = mjsTmp('for-sans-cle')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'sanscle.mjs'), CORPS)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const win: any = new Window({ url: 'http://localhost/' })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const coeur = files.find((f) => /^mjs_core-/.test(f))!
    win.eval(files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8'))) + '\nglobalThis.µ = µ;')
    win.document.body.innerHTML = '<mjs-sanscle></mjs-sanscle>'
    const el = win.document.body.firstElementChild
    await tic()
    const ombre = el._shadow || el.shadowRoot
    const lis = (cls: string) => Array.from(ombre.querySelectorAll(`ul.${cls} > li`)) as any[]
    const clic = async (id: string) => { ombre.querySelector('#' + id).dispatchEvent(new win.Event('click', { bubbles: true })); await tic() }

    const [a, b, c] = lis('obj')
    await clic('r')
    assert.deepEqual(lis('obj').map((n) => n.textContent), ['b', 'c'])
    assert.ok(lis('obj')[0] === b && lis('obj')[1] === c, 'objet retiré : sa ligne part, les autres gardent la leur')
    assert.ok(!a.isConnected, 'la ligne de l\'objet retiré est sortie du document')

    await clic('c')
    assert.deepEqual(lis('obj').map((n) => n.textContent), ['b', 'c'])
    assert.ok(lis('obj')[0] !== b && lis('obj')[1] !== c, 'objets recopiés : lignes neuves')

    const [x, y, z] = lis('val')
    await clic('m')
    assert.deepEqual(lis('val').map((n) => n.textContent), ['y', 'z'])
    assert.ok(lis('val')[0] === x && lis('val')[1] === y, 'valeur simple : chaque ligne garde sa place et affiche la valeur suivante')
    assert.ok(!z.isConnected, 'la dernière ligne disparaît')
    win.close?.()
  })
})
