// Gestionnaires et liaisons deux sens DANS un bloc du gabarit : les noms que ce bloc met en portée
// doivent y être lisibles — variable et index de `{for}`, `{const}` déjà rencontrés, valeur d'une
// branche `{success v}` / `{error err}`. Seules les boucles étaient recréées en tête de
// gestionnaire : un `{const}` ou la valeur d'un `{await}` levait « … is not defined » au clic, et
// une boucle sur la valeur chargée (`{success items}{for x in items}`) aussi, puisque la boucle se
// relit dans le gestionnaire. Pire, un homonyme du `<script>` était lu à la place, sans erreur.
//
// Réaffecter un de ces noms dans un gestionnaire (`x = 9`, `t = 9`, `v = 2`) n'écrivait qu'une
// copie locale, perdue aussitôt, sans un mot : c'est désormais une erreur de compilation qui dit
// quoi écrire à la place. Muter une propriété (`x.n = 9`) reste permis : l'objet est partagé.
//
// Harnais : compile + monte en happy-dom (calqué sur const-in-for.test.ts).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

async function monter(tag: string, component: string) {
  const root   = mjsTmp('locaux-gabarit')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, `${tag}.mjs`), component)
  const stats = await new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }).compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

  const win: any  = new Window({ url: 'http://localhost/' })
  const erreurs: string[] = []
  win.console.error = (...a: any[]) => { erreurs.push(a.map(String).join(' ')) }
  const files    = readdirSync(outDir)
  const coreFile = files.find((f: string) => /^mjs_core-/.test(f))
  const compFile = files.find((f: string) => new RegExp(`^${tag}-`).test(f))
  assert.ok(coreFile && compFile, 'core + composant compilés')
  win.eval(`${stripEsm(readFileSync(join(outDir, coreFile!), 'utf-8'))}\nglobalThis.µ = µ;\n${stripEsm(readFileSync(join(outDir, compFile!), 'utf-8'))}`)
  win.document.body.innerHTML = `<mjs-${tag}></mjs-${tag}>`
  const el: any = win.document.body.firstElementChild
  await new Promise(r => setTimeout(r, 120))
  return { win, el, erreurs }
}

async function cliquer(win: any, el: any, selecteur = 'button') {
  el._shadow.querySelector(selecteur).dispatchEvent(new win.Event('click', { bubbles: true, composed: true }))
  await new Promise(r => setTimeout(r, 60))
}

const vu = (el: any) => el._shadow.querySelector('.vu').textContent.trim()

const ENTETE = "<script>\n$list = [1, 2]\n$p = Promise.resolve([7, 8])\n$vu = 'rien'\n"

describe('gestionnaires : les noms du gabarit sont lisibles là où le bloc les met en portée', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('{const} lu dans un gestionnaire de son {for}', async () => {
    const { win, el, erreurs } = await monter('lc1', ENTETE + "</script>\n{for x in $list}{const t = x * 10}<button @click={$vu = t}>b</button>{end}<p class=\"vu\">{$vu}</p>\n")
    await cliquer(win, el)
    assert.equal(vu(el), '10', erreurs.join('\n'))
  })

  it('{const} imbriqués sur deux {for} : chacun relu dans l’ordre du gabarit', async () => {
    const { win, el, erreurs } = await monter('lc2', ENTETE + "$grille = [{cases: [3, 4]}]\n</script>\n{for l in $grille}{const cases = l.cases}{for c in cases}{const d = c * 2}<button @click={$vu = d}>b</button>{end}{end}<p class=\"vu\">{$vu}</p>\n")
    await cliquer(win, el)
    assert.equal(vu(el), '6', erreurs.join('\n'))
  })

  it('valeur {success v} lue dans un gestionnaire de sa branche', async () => {
    const { win, el, erreurs } = await monter('lc3', ENTETE + "</script>\n{await $p}…{success v}<button @click={$vu = v.length}>b</button>{end}<p class=\"vu\">{$vu}</p>\n")
    await cliquer(win, el)
    assert.equal(vu(el), '2', erreurs.join('\n'))
  })

  it('{for} sur la valeur chargée ({success items}{for x in items}) : le clic lit son élément', async () => {
    const { win, el, erreurs } = await monter('lc4', ENTETE + "</script>\n{await $p}…{success items}{for x in items}<button @click={$vu = x}>b</button>{end}{end}<p class=\"vu\">{$vu}</p>\n")
    await cliquer(win, el)
    assert.equal(vu(el), '7', erreurs.join('\n'))
  })

  it('erreur {error err} lue dans un gestionnaire de sa branche', async () => {
    const { win, el, erreurs } = await monter('lc5', ENTETE + "$ko = Promise.reject(new Error('boom'))\n</script>\n{await $ko}…{success v}ok{error err}<button @click={$vu = err.message}>b</button>{end}<p class=\"vu\">{$vu}</p>\n")
    await cliquer(win, el)
    assert.equal(vu(el), 'boom', erreurs.join('\n'))
  })

  it('{const} calculé depuis la valeur chargée', async () => {
    const { win, el, erreurs } = await monter('lc6', ENTETE + "</script>\n{await $p}…{success v}{const w = v.length * 2}<button @click={$vu = w}>b</button>{end}<p class=\"vu\">{$vu}</p>\n")
    await cliquer(win, el)
    assert.equal(vu(el), '4', erreurs.join('\n'))
  })

  it('un {const} masque la variable homonyme du <script> : le gestionnaire lit le {const}', async () => {
    const { win, el, erreurs } = await monter('lc7', ENTETE + "total = 100\n</script>\n{for x in $list}{const total = x}<button @click={$vu = total}>b</button>{end}<p class=\"vu\">{$vu}</p>\n")
    await cliquer(win, el)
    assert.equal(vu(el), '1', erreurs.join('\n'))
  })

  it('liaison deux sens sur la valeur chargée ({success fiche}<input value=!{fiche.nom}>)', async () => {
    const { win, el, erreurs } = await monter('lc8', "<script>\n$p = Promise.resolve({nom: 'Léa'})\n$vu = 'rien'\n</script>\n{await $p}…{success fiche}<input value=!{fiche.nom}><button @click={$vu = fiche.nom}>b</button>{end}<p class=\"vu\">{$vu}</p>\n")
    const champ = el._shadow.querySelector('input')
    champ.value = 'Zoé'
    champ.dispatchEvent(new win.Event('input', { bubbles: true, composed: true }))
    await new Promise(r => setTimeout(r, 30))
    await cliquer(win, el)
    assert.equal(vu(el), 'Zoé', erreurs.join('\n'))
  })

  it('muter une propriété de la variable de boucle reste permis et marche', async () => {
    const { win, el, erreurs } = await monter('lc9', "<script>\n$list = [{n: 1}]\n</script>\n{for x in $list}<button @click={x.n = 9}>b</button><p class=\"vu\">{x.n}</p>{end}\n")
    await cliquer(win, el)
    assert.equal(vu(el), '9', erreurs.join('\n'))
  })
})

// Dans une branche `{await}`, les liaisons posent aussi un effet à la RACINE (hors de la fonction de
// la branche) : il ne voyait ni la valeur de la branche ni ses `{const}` — le composant entier
// tombait (« … is not defined »). Et un `{const}` de branche était déclaré APRÈS la création des
// éléments qui le lisent (interpolation, attribut), dans un bloc intérieur.
describe('branche {await} : chaque forme d’attribut lit sa valeur, directement ou par un {const}', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  const ENFANT = "<script>\n$val = 0\n</script>\n<p class=\"enfant\">{$val}</p>\n"
  const FORMES: [string, string][] = [
    ['attribut interpolé', '<p class={v.n}>x</p>'],
    ['texte', '<p>{v.n}</p>'],
    ['value=!{…}', '<input aria-label="n" value=!{v.nom}>'],
    ['média currentTime=!{…}', '<video currentTime=!{v.t}></video>'],
    ['contenu @html=!{…}', '<div contenteditable="true" @html=!{v.html}></div>'],
    ['groupe @group=!{…}', '<input aria-label="g" type="checkbox" value="a" @group=!{v.liste}>'],
    ['composant val=!{…}', '<@enfant-lg val=!{v.n}></@enfant-lg>'],
    ['spread {...v}', '<@enfant-lg {...v}></@enfant-lg>'],
    ['@attach réactif', '<div @attach={f(v, $tick)}>x</div>'],
    ['@emit réactif', '<div @emit.sel={[v.n, $tick]}>x</div>'],
  ]

  async function survit(tag: string, branche: string) {
    const root   = mjsTmp('locaux-await')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'enfant-lg.mjs'), ENFANT)
    writeFileSync(join(srcDir, `${tag}.mjs`), "<script>\n$p = Promise.resolve({n: 3, t: 1, html: '<b>x</b>', liste: ['a'], nom: 'Léa'})\nf = (o) -> (node) -> null\n$tick = 0\n</script>\n<button class=\"tick\" @click={$tick += 1}>t</button>{await $p}…{success v}" + branche + "{end}\n")
    const stats = await new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }).compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const win: any = new Window({ url: 'http://localhost/' })
    const erreurs: string[] = []
    win.console.error = (...a: any[]) => { erreurs.push(a.map(String).join(' ')) }
    const files = readdirSync(outDir)
    let code = stripEsm(readFileSync(join(outDir, files.find((f: string) => /^mjs_core-/.test(f))!), 'utf-8')) + '\nglobalThis.µ = µ;\n'
    for (const f of files.filter((f: string) => /^(enfant-lg|[a-z0-9]+)-[0-9a-f]+\.js$/.test(f))) code += stripEsm(readFileSync(join(outDir, f), 'utf-8')) + '\n'
    win.eval(code)
    win.document.body.innerHTML = `<mjs-${tag}></mjs-${tag}>`
    const el: any = win.document.body.firstElementChild
    await new Promise(r => setTimeout(r, 150))
    el._shadow?.querySelector('.tick')?.dispatchEvent(new win.Event('click', { bubbles: true, composed: true }))
    await new Promise(r => setTimeout(r, 60))
    return { el, erreurs }
  }

  FORMES.forEach(([nom, corps], i) => {
    it(`${nom} : le composant survit (valeur lue directement)`, async () => {
      const { el, erreurs } = await survit(`lgd${i}`, corps)
      assert.ok(el._shadow?.querySelector('.tick') && !/mjs-fatal-error/.test(el._shadow.innerHTML), erreurs.join('\n'))
      assert.deepEqual(erreurs, [])
    })
    it(`${nom} : le composant survit (valeur lue par un {const})`, async () => {
      const { el, erreurs } = await survit(`lgc${i}`, '{const w = v}' + corps.replace(/\bv\b/g, 'w'))
      assert.ok(el._shadow?.querySelector('.tick') && !/mjs-fatal-error/.test(el._shadow.innerHTML), erreurs.join('\n'))
      assert.deepEqual(erreurs, [])
    })
  })

  it('valeurs réellement posées : texte et attribut via {const}, champ lié', async () => {
    const { el } = await survit('lgv', "{const w = v}<p class=\"t\">{w.n}</p><p class={'c' + w.n}>x</p><input aria-label=\"n\" value=!{v.nom}>")
    assert.equal(el._shadow.querySelector('.t').textContent.trim(), '3')
    assert.ok(el._shadow.querySelector('.c3'), 'attribut calculé depuis le {const}')
    assert.equal(el._shadow.querySelector('input').value, 'Léa')
  })
})

describe('gestionnaires : réaffecter un nom du gabarit est refusé à la compilation (écriture perdue)', () => {
  const refus = /réaffecte « (\w+) », posé par le gabarit/

  it('variable de boucle : {for x in $list}<button @click={x = 9}>', async () => {
    await assert.rejects(transpile("<script>\n  $list = [1]\n</script>\n{for x in $list}<button @click={x = 9}>b</button>{end}\n", { moduleName: 'card' }), (e: any) => refus.test(e.message) && /« x »/.test(e.message))
  })

  it('index de boucle, composé : {for i, x in $list}<button @click={i += 1}>', async () => {
    await assert.rejects(transpile("<script>\n  $list = [1]\n</script>\n{for i, x in $list}<button @click={i += 1}>b</button>{end}\n", { moduleName: 'card' }), (e: any) => refus.test(e.message) && /« i »/.test(e.message))
  })

  it('{const} : <button @click={t = 9}>', async () => {
    await assert.rejects(transpile("<script>\n  $list = [1]\n</script>\n{for x in $list}{const t = x}<button @click={t = 9}>b</button>{end}\n", { moduleName: 'card' }), (e: any) => refus.test(e.message) && /« t »/.test(e.message))
  })

  it('valeur {success v} : <button @click={v = 2}>', async () => {
    await assert.rejects(transpile("<script>\n  $p = Promise.resolve(1)\n</script>\n{await $p}…{success v}<button @click={v = 2}>b</button>{end}\n", { moduleName: 'card' }), (e: any) => refus.test(e.message) && /« v »/.test(e.message))
  })

  it('{const} homonyme d’une constante `:=` du <script> : refusé aussi (plus de contournement)', async () => {
    await assert.rejects(transpile("<script>\n  total := 0\n  $list = [1]\n</script>\n{for x in $list}{const total = 3}<button @click={total = 9}>b</button>{end}\n", { moduleName: 'card' }), (e: any) => /« total »/.test(e.message))
  })

  // la liaison deux sens réécrit sa cible à chaque saisie : sur une variable de boucle, cette
  // écriture partait dans la copie — la bonne forme vise la liste elle-même
  it('liaison deux sens sur la variable de boucle : refusée ; sur la liste elle-même : compile', async () => {
    await assert.rejects(transpile("<script>\n  $noms = ['a']\n</script>\n{for x in $noms}<input aria-label=\"n\" value=!{x}>{end}\n", { moduleName: 'card' }), (e: any) => refus.test(e.message) && /value=!\{\$liste\[index\]\}/.test(e.message))
    await transpile("<script>\n  $noms = ['a']\n</script>\n{for i, x in $noms}<input aria-label=\"n\" value=!{$noms[i]}>{end}\n", { moduleName: 'card' })
  })

  it('réaffectation depuis une fonction imbriquée du gestionnaire : refusée aussi', async () => {
    await assert.rejects(transpile("<script>\n  $list = [1]\n</script>\n{for x in $list}<button @click={setTimeout((-> x = 9), 0)}>b</button>{end}\n", { moduleName: 'card' }), (e: any) => refus.test(e.message))
  })

  it('jamais de faux refus : paramètre homonyme, propriété, comparaison, boucles imbriquées au même index', async () => {
    await transpile("<script>\n  $list = [1]\n  $vu = 0\n</script>\n{for x in $list}<button @click={[5].forEach((x) => x = 2)}>b</button><button @click={x.n = 3}>c</button><button @click={$vu = (x == 1)}>d</button>{end}\n", { moduleName: 'card' })
    await transpile("<script>\n  $g = [[1]]\n  $vu = 0\n</script>\n{for l in $g}{for c in l}<button @click={$vu = [index, c]}>b</button>{end}{end}\n", { moduleName: 'card' })
  })
})
