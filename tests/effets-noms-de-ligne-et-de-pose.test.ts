// Le code que le compilateur écrit pour poser un effet ne déclare aucun nom que l'auteur pourrait écrire : la balise y porte un nom
// réservé (préfixe `_mjs`), jamais `node` ni `_node`. Une ligne de `{for}` ou un `{const}` nommé `_node` ou `node` est donc lu tel quel
// par le réglage d'un effet (`*tilt(max: node.n)`, `@in=*scramble(speed: _node.n)`), et le bundler reconnaît toujours les effets posés
// pour n'envoyer que leurs fichiers.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// un réglage lu dans la ligne (`max: x.n`) ou dans un `{const}` : dynamique, donc évalué à côté du nom de la balise
const SOURCES: Record<string, string> = {
  'nom-ligne-souligne': '<script>\n$items = [{ n: 7 }]\n</script>\n{for _node in $items}\n<span class="a" *tilt(max: _node.n)>x</span>\n{end}\n',
  'nom-ligne-node':     '<script>\n$items = [{ n: 7 }]\n</script>\n{for node in $items}\n<span class="a" *tilt(max: node.n)>x</span>\n{end}\n',
  'nom-const-souligne': '<script>\n$items = [{ n: 7 }]\n</script>\n{for item in $items}\n{const _node = item}\n<span class="a" *tilt(max: _node.n)>x</span>\n{end}\n',
  'nom-const-node':     '<script>\n$items = [{ n: 7 }]\n</script>\n{for item in $items}\n{const node = item}\n<span class="a" *tilt(max: node.n)>x</span>\n{end}\n',
  'nom-vie-souligne':   '<script>\n$items = [{ n: 7 }]\n</script>\n{for _node in $items}\n<p class="b" @in.global=*scramble(speed: _node.n)>x</p>\n{end}\n',
  'nom-vie-node':       '<script>\n$items = [{ n: 7 }]\n</script>\n{for node in $items}\n<p class="b" @in.global=*scramble(speed: node.n)>x</p>\n{end}\n'
}

// les identifiants qu'un motif de déstructuration lie
function lies(motif: any, sortie: Set<string>): void {
  switch (motif?.type) {
    case 'Identifier': sortie.add(motif.name); break
    case 'ObjectPattern': for (const p of motif.properties) lies(p.type === 'RestElement' ? p.argument : p.value, sortie); break
    case 'ArrayPattern': for (const x of motif.elements) lies(x, sortie); break
    case 'AssignmentPattern': lies(motif.left, sortie); break
    case 'RestElement': lies(motif.argument, sortie); break
  }
}

// ce que le code émis déclare (variables, constantes, paramètres) et la balise que chaque pose d'effet reçoit ; la sortie du transpileur garde
// `µ.asset('…')` là où le bundler pose un chemin : un texte pour l'analyseur
function lire(js: string) {
  const arbre     = acorn.parse(js.replace(/µ\.asset\(['"]([^'"]+)['"]\)/g, "'/__placeholder/$1'"), { ecmaVersion: 'latest', sourceType: 'module' })
  const declares  = new Set<string>()
  const balises: string[] = []
  walk.full(arbre, (n: any) => {
    if (n.type === 'VariableDeclarator') lies(n.id, declares)
    else if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression') {
      if (n.id) lies(n.id, declares)
      for (const p of n.params) lies(p, declares)
    }
    else if (n.type === 'ArrowFunctionExpression') for (const p of n.params) lies(p, declares)
    else if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && ['_mjs_fx', '_mjs_fxSet', '_mjs_fxLife'].includes(n.callee.property.name)) {
      const balise = n.arguments[n.callee.property.name === '_mjs_fxSet' ? 0 : 1]
      balises.push(balise.type === 'Identifier' ? balise.name : '(' + balise.type + ')')
    }
  })
  return { declares, balises }
}

describe('effets — le code émis pour poser un effet ne déclare aucun nom de l\'auteur', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('une pose réglée par une variable, une pose réglée par la ligne et un effet de cycle de vie : ni `node` ni `_node` n\'est déclaré, la balise porte un nom réservé', async () => {
    const source = '<script>\n$items = [{ n: 7 }]\n$t = 3\n</script>\n<div class="r" *tilt(max: $t)>x</div>\n{for l in $items}\n<span class="a" *tilt(max: l.n)>x</span>\n<p class="b" @in.global=*scramble(speed: l.n)>x</p>\n{end}\n'
    const { declares, balises } = lire((await transpile(source, { moduleName: 'effets-noms-emis' })).output)
    assert.deepEqual([...declares].filter((nom) => nom === 'node' || nom === '_node'), [], 'ni `node` ni `_node` n\'est déclaré par le code émis')
    assert.ok(balises.length >= 4, `les poses sont dans le code émis : ${balises.join(', ')}`)
    assert.deepEqual(balises.filter((nom) => !nom.startsWith('_mjs')), [], 'la balise de chaque pose porte un nom réservé')
  })

  it('`e` et `el`, les noms que le gabarit donne aux gestionnaires, restent refusés comme nom de ligne et de {const} ; `node` est accepté', async () => {
    const ligne = (nom: string) => `<script>\n$items = [1]\n</script>\n{for ${nom} in $items}<i>{${nom}}</i>{end}\n`
    const fixe  = (nom: string) => `<script>\n$items = [1]\n</script>\n{for l in $items}{const ${nom} = l}<i>{${nom}}</i>{end}\n`
    for (const nom of ['e', 'el']) {
      await assert.rejects(transpile(ligne(nom), { moduleName: 'effets-noms-refuses' }), /RÉSERVÉ|RESERVED/, `{for ${nom} in …}`)
      await assert.rejects(transpile(fixe(nom), { moduleName: 'effets-noms-refuses' }), /RÉSERVÉ|RESERVED/, `{const ${nom} = …}`)
    }
    await transpile(ligne('node'), { moduleName: 'effets-noms-refuses' })
    await transpile(fixe('node'), { moduleName: 'effets-noms-refuses' })
  })
})

describe('effets — une ligne de {for} ou un {const} nommé `_node` ou `node` est lu par le réglage d\'un effet', function () {
  this.timeout(120000)
  let window: any
  let fichiers: string[] = []
  const appels: any[][] = []

  before(async () => {
    const root   = mjsTmp('effets-noms-de-ligne')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom + '.mjs'), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    fichiers    = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...fichiers].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    // les poses sont relevées sans être jouées : seuls leurs arguments comptent
    for (const nom of ['_mjs_fx', '_mjs_fxLife']) {
      assert.equal(typeof window.µ[nom], 'function', `${nom} fait partie de ce que le bundler envoie`)
      window.µ[nom] = (...args: any[]) => { appels.push([nom, ...args]); return undefined }
    }
  })

  after(() => { window?.close?.() })

  it('le bundler envoie les fichiers des effets posés', () => {
    for (const effet of ['tilt', 'scramble']) assert.ok(fichiers.some((f) => f.includes('fx_' + effet)), `le fichier de *${effet} est envoyé : ${fichiers.join(', ')}`)
  })

  for (const [nom, balise, effet, reglage, element] of [
    ['nom-ligne-souligne', 'mjs-nom-ligne-souligne', 'tilt', 'max', 'span'],
    ['nom-ligne-node', 'mjs-nom-ligne-node', 'tilt', 'max', 'span'],
    ['nom-const-souligne', 'mjs-nom-const-souligne', 'tilt', 'max', 'span'],
    ['nom-const-node', 'mjs-nom-const-node', 'tilt', 'max', 'span'],
    ['nom-vie-souligne', 'mjs-nom-vie-souligne', 'scramble', 'speed', 'p'],
    ['nom-vie-node', 'mjs-nom-vie-node', 'scramble', 'speed', 'p']
  ]) {
    it(`${nom} : le réglage ${reglage} de *${effet} lit la variable de l'auteur (7), la pose reçoit la balise <${element}>`, async () => {
      const avant = appels.length
      window.document.body.innerHTML = `<${balise}></${balise}>`
      const hote = window.document.querySelector(balise)
      const fin  = Date.now() + 3000
      while (appels.length === avant && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
      const poses = appels.slice(avant).filter((a) => a[3] === effet)
      assert.ok(poses.length > 0, `*${effet} est posé (${appels.slice(avant).map((a) => a[0] + ':' + a[3]).join(', ')}) — ${hote?.innerHTML ?? ''}`)
      const [, , balisePosee, , , dyn] = poses[0]
      assert.equal(dyn?.[reglage], 7, `le réglage lit la variable de l'auteur, pas la balise (${JSON.stringify(dyn)})`)
      assert.equal(balisePosee?.localName, element, 'la pose reçoit la balise de l\'effet')
    })
  }
})
