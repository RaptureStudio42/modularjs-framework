// `µeffect.root` à la construction : le refus d'un reffet écrit dans un rappel de la racine (forEach, minuterie) dit la règle de la
// racine et montre la forme qui marche, en français courant comme le refus hors racine ; deux reffets écrits sur la même ligne que la
// racine sont acceptés comme sur deux lignes (Civet, JavaScript) ; un reffet écrit après un `await` du rappel de la racine, qui ne lui
// appartiendrait plus, est refusé avec un message qui le dit, quand une attente dans une fonction écrite dans la racine ne gêne rien ;
// de même un reffet écrit dans une boucle de la racine qui attend (au tour suivant, il passe après l'attente). Une racine dont le rappel
// est affecté (`µeffect.root(cb = -> …)`) reste acceptée ; en CoffeeScript, `g = -> {a: 1}; µeffect(…)` met le reffet dans `g`.
// Les deux langues des messages

import assert from 'node:assert/strict'
import { lintEffectTopLevel } from '../src/transpiler/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const refus = (src: string, module = false, lang = 'civet'): string => {
  try {
    lintEffectTopLevel(src, module, 1, lang)
  }
  catch (e) {
    return String((e as Error).message)
  }
  return ''
}

describe('µeffect.root : refus justes, une ligne, attente', () => {
  afterEach(() => setMessagesLang('fr'))

  it('reffet dans un rappel écrit dans la racine : le refus dit la règle de la racine et montre la forme qui marche', () => {
    for (const src of ['@ouvrir = ->\n  arret = µeffect.root ->\n    liste.forEach (x) ->\n      µeffect -> µ.log x', '@o = function() { µeffect.root(() => { liste.forEach((x) => { µeffect(() => {}) }) }) }', '@f = -> µeffect.root -> liste.forEach((x) -> µeffect(-> x))', '@ouvrir = ->\n  µeffect.root ->\n    setTimeout (->\n      µeffect -> µ.log $n\n    ), 10']) {
      const m = refus(src)
      assert.match(m, /imbriqué \(ligne \d\)/, src)
      assert.match(m, /premier niveau de la racine/, src)
      assert.match(m, /µeffect\.root -> µeffect -> liste\.forEach \(x\) ->/, src)
      assert.doesNotMatch(m, /TOP-LEVEL|handler|hook|niveau racine du <script>/, src)
    }
  })

  it('hors racine : le refus parle français courant et cite toujours µeffect.root', () => {
    const m = refus('@go = ->\n  µeffect ->\n    $n++')
    assert.match(m, /« µeffect » imbriqué \(ligne 2\)/)
    assert.match(m, /µeffect\.root/)
    assert.doesNotMatch(m, /TOP-LEVEL|handler|hook|runtime/)
    assert.doesNotMatch(m, /premier niveau de la racine/)
    assert.doesNotMatch(refus('@check = ->\n  µinspect $n'), /TOP-LEVEL|handler|hook|runtime/)
  })

  it('en anglais : les mêmes refus, en anglais', () => {
    setMessagesLang('en')
    const racine = refus('@ouvrir = ->\n  arret = µeffect.root ->\n    liste.forEach (x) ->\n      µeffect -> µ.log x')
    assert.match(racine, /"µeffect" nested \(line 4\)/)
    assert.match(racine, /top level of the root/)
    assert.doesNotMatch(racine, /[«»]|TOP-LEVEL/)
    const hors = refus('@go = ->\n  µeffect ->\n    $n++')
    assert.match(hors, /"µeffect" nested \(line 2\)/)
    assert.doesNotMatch(hors, /[«»]|TOP-LEVEL|top level of the root/)
    assert.match(refus('@ouvrir = ->\n  µeffect.root ->\n    await attendre()\n    µeffect -> µ.log $a'), /after an await/)
  })

  it('deux reffets sur la ligne de la racine : acceptés comme sur deux lignes, Civet et JavaScript', () => {
    for (const src of ['@ouvrir = -> arret = µeffect.root -> µeffect(-> µ.log $a); µeffect(-> µ.log $b)', '@ouvrir = -> arret = µeffect.root -> µeffect(-> µ.log $a); µeffect.before(-> µ.log $b)', '@ouvrir = ->\n  arret = µeffect.root -> µeffect(-> µ.log $a); µeffect(-> µ.log $b)', '@o = function() { a = µeffect.root(() => { µeffect(() => { µ.log($a) }); µeffect(() => { µ.log($b) }) }) }', '@o = function() { a = µeffect.root(() => { µeffect(() => µ.log($a)); µeffect(() => µ.log($b)) }) }', '@o = function() { a = µeffect.root(() => (µeffect(() => µ.log($a)), µeffect(() => µ.log($b)))) }', '@o = -> µeffect.root -> l = [-> 1]; µeffect(-> µ.log $a)']) {
      assert.equal(refus(src), '', src)
    }
  })

  it('sur une ligne, ce qui n\'est pas dans la racine reste refusé', () => {
    assert.match(refus('@f = -> µeffect.root(-> µ.log 1); g = -> µeffect(-> µ.log $b)'), /imbriqué/)
    assert.match(refus('@f = -> µeffect.root -> liste.forEach((x) -> µeffect(-> x))'), /imbriqué/)
    assert.match(refus('@f = -> µeffect.root -> setTimeout (-> µeffect(-> 1)), 10'), /imbriqué/)
  })

  it('racine qui attend : un reffet écrit après un await du rappel de la racine est refusé, et le refus le dit', () => {
    for (const [src, ligne] of [['@ouvrir = ->\n  arret = µeffect.root ->\n    await attendre()\n    µeffect -> µ.log $a', 4], ['@ouvrir = -> arret = µeffect.root -> await attendre(); µeffect -> µ.log $a', 1], ['@o = async function() {\n  a = µeffect.root(async () => {\n    await attendre()\n    µeffect(() => { µ.log($a) })\n  })\n}', 4], ['@ouvrir = ->\n  µeffect.root ->\n    if x\n      await y\n    µeffect.before -> µ.log $a', 5], ['@ouvrir = ->\n  µeffect.root ->\n    µeffect -> µ.log $a\n    v = await y\n    µeffect -> µ.log $b', 5]] as const) {
      const m = refus(src)
      assert.match(m, new RegExp('après un await dans µeffect\\.root \\(ligne ' + ligne + '\\)'), src)
      assert.match(m, /avant le premier await/, src)
    }
  })

  it('racine qui attend : un reffet écrit avant l\'attente, ou une attente dans une fonction écrite dans la racine, ne gênent rien', () => {
    for (const src of ['@ouvrir = ->\n  µeffect.root ->\n    µeffect -> µ.log $a\n    await attendre()', '@ouvrir = ->\n  µeffect.root ->\n    charger = ->\n      await attendre()\n    µeffect -> µ.log $a', '@o = function() { µeffect.root(() => { const f = async () => { await x }; µeffect(() => {}) }) }', '@o = -> µeffect.root -> f = (-> await x); µeffect(-> µ.log $a)', '@ouvrir = ->\n  µeffect.root ->\n    µ.log "await"\n    µeffect -> µ.log $a', 'µeffect ->\n  v = await charger($n)\n  µ.log v']) {
      assert.equal(refus(src), '', src)
    }
  })

  it('racine dont le rappel est affecté (`cb = ->`, `@cb = ->`, `cb = () =>`, `this.cb = function`) : acceptée, comme sans affectation', () => {
    for (const src of ['@ouvrir = -> µeffect.root(cb = -> µeffect(-> µ.log $a))', '@ouvrir = ->\n  µeffect.root(cb = ->\n    µeffect -> µ.log $a\n  )', '@ouvrir = ->\n  arret = µeffect.root (cb = ->\n    µeffect -> µ.log $a)', '@ouvrir = ->\n  µeffect.root(@cb = ->\n    µeffect -> µ.log $a\n  )']) {
      assert.equal(refus(src), '', src)
      assert.equal(refus(src, false, 'coffee'), '', src)
    }
    for (const src of ['@o = function() { µeffect.root(cb = () => { µeffect(() => {}) }) }', '@o = function() {\n  µeffect.root(cb = function () {\n    µeffect(() => {})\n  })\n}', '@o = function() { µeffect.root(this.cb = async () => { µeffect(() => {}) }) }']) assert.equal(refus(src, false, 'js'), '', src)
    // une fonction passée à un autre appel n'est pas le rappel de la racine
    assert.match(refus('@ouvrir = -> µeffect.root(foo(-> µeffect(-> µ.log $a)))'), /imbriqué/)
    assert.match(refus('@ouvrir = -> µeffect.root(cb = foo(-> µeffect(-> µ.log $a)))'), /imbriqué/)
  })

  it('racine qui attend : un reffet écrit dans une boucle qui attend est refusé, et le refus le dit', () => {
    for (const [src, ligne] of [['@ouvrir = ->\n  µeffect.root ->\n    for x in liste\n      µeffect -> µ.log x\n      await attendre()', 4], ['@ouvrir = ->\n  µeffect.root ->\n    while $a\n      µeffect -> µ.log $a\n      await attendre()', 4], ['@ouvrir = ->\n  µeffect.root ->\n    for x in liste\n      µeffect -> µ.log x\n      if x\n        await attendre()', 4], ['@ouvrir = ->\n  µeffect.root ->\n    loop\n      µeffect -> µ.log 1\n      await y\n      break', 4], ['@ouvrir = ->\n  µeffect.root ->\n    for x in liste\n      µeffect -> µ.log x\n      µ.log await y', 4], ['@o = function() { µeffect.root(async () => {\n  for (const x of l) {\n    µeffect(() => x)\n    await y\n  }\n}) }', 3], ['@o = function() { µeffect.root(async () => {\n  while (go) {\n    µeffect(() => 1)\n    await y\n  }\n}) }', 3], ['@o = function() { µeffect.root(async () => { for (const x of l) { µeffect(() => x); await y } }) }', 1]] as const) {
      const m = refus(src)
      assert.match(m, new RegExp('dans une boucle qui attend, dans µeffect\\.root \\(ligne ' + ligne + '\\)'), src)
      assert.match(m, /avant la boucle/, src)
    }
    setMessagesLang('en')
    assert.match(refus('@ouvrir = ->\n  µeffect.root ->\n    for x in liste\n      µeffect -> µ.log x\n      await attendre()'), /"µeffect" in a loop that awaits, in µeffect\.root \(line 4\)/)
  })

  it('racine qui attend : boucle sans attente, attente après la boucle ou dans une fonction, racine ouverte dans une boucle : acceptées', () => {
    for (const src of ['@ouvrir = ->\n  µeffect.root ->\n    for x in liste\n      µeffect -> µ.log x\n    await attendre()', '@ouvrir = ->\n  µeffect.root ->\n    for x in liste\n      µeffect -> µ.log x\n    for y in autres\n      await y', '@ouvrir = ->\n  µeffect.root ->\n    for x in liste\n      µeffect -> µ.log x\n      f = -> await y', '@ouvrir = ->\n  for x in liste\n    µeffect.root ->\n      µeffect -> µ.log x\n      await attendre()', '@o = async function() { for (const x of l) { µeffect.root(async () => { µeffect(() => x); await y }) } }', '@o = function() { µeffect.root(async () => {\n  for (const x of l) {\n    µeffect(() => x)\n  }\n  await y\n}) }']) assert.equal(refus(src), '', src)
  })

  it('CoffeeScript : une fonction écrite sur la ligne de la racine continue après un `;`, le reffet qui suit y est refusé ; en Civet, elle se referme sur son objet', () => {
    const src = '@ouvrir = -> µeffect.root -> g = -> {a: 1}; µeffect(-> µ.log $b)'
    assert.match(refus(src, false, 'coffee'), /imbriqué/)
    assert.equal(refus(src), '')
    assert.equal(refus('@ouvrir = -> µeffect.root -> µeffect(-> µ.log $a); µeffect(-> µ.log $b)', false, 'coffee'), '')
  })
})
