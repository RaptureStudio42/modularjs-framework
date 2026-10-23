// Types et valeurs permises — la compilation d'un composant : le bloc <vars> (toujours avant le
// <script>) devient la table des règles de ses variables et props (`this._mjs_types`), et celle de
// ses stores (`µ._mjs_storeTypes({...})` au chargement du module). Un <types> n'a sa place que
// dans un fichier *.types.mjs ; ses règles nommées arrivent au transpileur par `typeDefs`.

import assert from 'node:assert/strict'
import { extractSections } from '../src/transpiler/sections.js'
import { transpile } from '../src/transpiler/index.js'
import { parseRule } from '../src/transpiler/var-types.js'

const DEFS = { Percent: parseRule('int 0..100', { bloc: '<types>', ligne: 1 }) }

describe('types — le bloc <vars> dans un composant', () => {
  it('extractSections : le bloc, sa première ligne, et rien de lui dans le HTML', () => {
    const src = ['<vars>', '  $volume  int 0..100', '</vars>', '<script>', '  $volume = 5', '</script>', '<p>{$volume}</p>'].join('\n')
    const s = extractSections(src)
    // même convention que <script> : le contenu commence juste après la balise ouvrante (ligne 1),
    // son retour à la ligne compris — la 1re règle est donc bien citée ligne 2
    assert.equal(s.vars?.raw, '\n$volume  int 0..100\n')
    assert.equal(s.vars?.startLine, 1)
    assert.doesNotMatch(s.html, /vars|int 0/)
    assert.deepEqual(s.types, [])
  })

  it('un seul <vars>, sans attribut, toujours avant le <script>', () => {
    assert.throws(() => extractSections('<vars>\n$a int\n</vars>\n<vars>\n$b int\n</vars>\n<p></p>'), /<vars>/)
    assert.throws(() => extractSections('<vars lang="x">\n$a int\n</vars>\n<p></p>'), /<vars>/)
    assert.throws(() => extractSections('<script>\n$a = 1\n</script>\n<vars>\n$a int\n</vars>\n<p></p>'), /avant/)
  })

  it('un <vars> mis en commentaire HTML reste inerte', () => {
    const s = extractSections('<!--\n<vars>\n$a int\n</vars>\n-->\n<p></p>')
    assert.equal(s.vars, null)
  })

  it('un <types> dans un composant est refusé : sa place est un fichier *.types.mjs', async () => {
    await assert.rejects(transpile('<types>\nPercent int 0..100\n</types>\n<p></p>', { moduleName: 'types-dans-composant' }), /\*\.types\.mjs/)
  })

  it('compile : la table des règles, posée sur l’instance avant le script', async () => {
    const src = ['<vars>', '  $volume  Percent', "  $color   'red' | 'green'", '</vars>', '<script>', '  $volume = 50', "  $color = 'red'", '</script>', '<p>{$volume} {$color}</p>'].join('\n')
    const { output, data } = await transpile(src, { moduleName: 'types-volume', typeDefs: DEFS })
    assert.match(output, /const _mjs_T_\w+ = \{volume:\{t:'i',a:0,b:100,d:"Percent"\},color:\{t:'l',v:\["red","green"\],d:"'red' \| 'green'"\}\};/)
    assert.match(output, /this\._mjs_types = _mjs_T_\w+;/)
    assert.ok(output.indexOf('this._mjs_types =') < output.indexOf('this.init($)'), 'posée avant le script : la valeur de départ passe la règle')
    assert.equal(data.usesNamedTypes, true)
    assert.doesNotMatch(output, /_mjs_storeTypes/)
  })

  it('stores : leurs règles partent au chargement du module, et le build les reçoit pour les comparer', async () => {
    const src = ['<vars>', '  $$cart  { quantity: int 1..99 }', '</vars>', '<script>', '  $$cart = { quantity: 1 }', '</script>', '<p>{$$cart.quantity}</p>'].join('\n')
    const { output, data } = await transpile(src, { moduleName: 'types-store' })
    assert.match(output, /µ\._mjs_storeTypes\(\{cart:\{t:'o',f:\{quantity:\{t:'i',a:1,b:99,d:"int 1\.\.99"\}\},d:"\{ quantity: int 1\.\.99 \}"\}\}\);/)
    assert.doesNotMatch(output, /this\._mjs_types =/)
    assert.deepEqual(data.storeTypes, { cart: '{ quantity: int 1..99 }' })
    assert.equal(data.usesNamedTypes, false)
  })

  it('production : sans le texte des règles', async () => {
    const { output } = await transpile('<vars>\n$volume int 0..100\n</vars>\n<p>{$volume}</p>', { moduleName: 'types-prod', typesText: false })
    assert.match(output, /\{volume:\{t:'i',a:0,b:100\}\}/)
  })

  it('une règle nommée inconnue est refusée, avec la ligne du fichier et une suggestion', async () => {
    await assert.rejects(transpile('<vars>\n$volume Percnt\n</vars>\n<p>{$volume}</p>', { moduleName: 'types-inconnue', typeDefs: DEFS }), /ligne 2[\s\S]*Percent/)
  })

  it('un composant sans <vars> ne change pas d’un octet', async () => {
    const { output } = await transpile('<script>\n$a = 1\n</script>\n<p>{$a}</p>', { moduleName: 'types-sans' })
    assert.doesNotMatch(output, /_mjs_types|_mjs_T_|_mjs_storeTypes/)
    assert.match(output, /this\._mjs_var_bits = \{[^\n]*\};\n    this\._mjs_computedDeps/, 'la ligne suivante suit directement, sans ligne vide ajoutée')
  })

  // un ressort (µspring, µinterpolate) a déjà ses bornes (`µspring(v, raideur, amortissement, min,
  // max)`) : une règle dans <vars> ferait doublon — le build le refuse et dit où mettre les bornes
  it('une variable qui reçoit un µspring ou un µinterpolate ne va pas dans <vars>', async () => {
    for (const [rune, appel] of [['µspring', 'µspring(0, 0.1, 0.5)'], ['µinterpolate', 'µinterpolate(0, 400)'], ['µspring', 'µ.spring(0)']]) {
      const src = `<vars>\n$x float 0..1\n</vars>\n<script>\n$x = ${appel}\n</script>\n<p>{$x.current}</p>`
      await assert.rejects(transpile(src, { moduleName: 'types-ressort' }), new RegExp(`\\$x[\\s\\S]*${rune}[\\s\\S]*min, max[\\s\\S]*<vars>`), appel)
    }
    const gestionnaire = '<vars>\n$x float 0..1\n</vars>\n<button @click={$x = µspring(1)}>b</button>'
    await assert.rejects(transpile(gestionnaire, { moduleName: 'types-ressort-gestionnaire' }), /µspring/)
    const store = '<vars>\n$$x float 0..1\n</vars>\n<script>\n$$x = µspring(0)\n</script>\n<p>{$$x.current}</p>'
    await assert.rejects(transpile(store, { moduleName: 'types-ressort-store' }), /\$\$x[\s\S]*µspring/)
  })

  it('un ressort sur une variable hors <vars>, ou cité en commentaire, reste permis', async () => {
    await assert.doesNotReject(transpile('<vars>\n$y int\n</vars>\n<script>\n$x = µspring(0)\n$y = 1\n</script>\n<p>{$x.current} {$y}</p>', { moduleName: 'types-ressort-ailleurs' }))
    await assert.doesNotReject(transpile("<vars>\n$x float\n</vars>\n<script>\n# jamais $x = µspring(0) ici\n$x = 0.5\nt = '$x = µspring(0)'\n</script>\n<p>{$x}</p>", { moduleName: 'types-ressort-cite' }))
  })

  it('un partiel <@include> ne porte pas de <vars>', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { mjsTmp } = await import('./helpers/tmp.js')
    const dir = mjsTmp('types-partiel')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '_morceau.mjs'), '<vars>\n$a int\n</vars>\n<p>{$a}</p>')
    await assert.rejects(transpile('<@include morceau>\n', { moduleName: 'types-inclut', baseDir: dir }), /<@include morceau>[\s\S]*<vars>/)
  })
})
