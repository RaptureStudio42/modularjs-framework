// Test de régression : `autoDeclareTopLevelBareAssignments` (src/bundler/index.ts) ne
// reconnaissait comme « déjà déclaré » qu'un identifiant collé après `var`/`let`/`const`
// (`const width = …`) — jamais un identifiant LIÉ PAR DÉSTRUCTURATION (`const {width, height}
// = getSize()`, la forme que Civet compile pour `{width, height} := getSize()`).
//
// Premier bug (fixé) : une réaffectation bare top-level de l'un des noms liés (`width = 10`)
// était prise pour une PREMIÈRE assignation et recevait un `var` en trop — double déclaration du
// même identifiant dans le même scope, `SyntaxError` au chargement.
//
// Second bug, révélé une fois le premier corrigé : `width` reste lié par un `const` (Civet
// compile `:=` en `const`, `.=` en `let`) — sa réaffectation nue n'en devient pas légitime pour
// autant. Le build restait pourtant vert (aucune erreur annoncée) et le module publié levait un
// `TypeError: Assignment to constant variable` AU CHARGEMENT, silencieusement. Fix : la
// réaffectation nue (simple ou composée, `+=` etc.) d'un identifiant lié par `const` au même
// niveau (top-level) refuse désormais de COMPILER — erreur nommant l'identifiant, la ligne et la
// solution (`.=` au lieu de `:=` pour un identifiant qu'on compte réaffecter). Une affectation de
// PROPRIÉTÉ (`renamed.x = 1`) ou un identifiant lié par `.=` restent des réaffectations
// légitimes, jamais concernées — vérifié plus bas par EXÉCUTION réelle du module produit.

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { autoDeclareTopLevelBareAssignments } from '../src/bundler/index.js'
import { getAdapter } from '../src/languages/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('bundler — autoDeclareTopLevelBareAssignments (déstructuration top-level, identifiant mutable)', function () {
  it('objet en raccourci : {w, h} = f() puis w = 10 — pas de second var', function () {
    const input = ['let {w, h} = f()', 'w = 10', 'console.log(w, h)'].join('\n')
    const output = autoDeclareTopLevelBareAssignments(input)
    assert.equal(output, input, 'w est déjà lié par la déstructuration — aucun var ne doit être ajouté')
  })

  it('tableau : [a, b] = f() puis a = 1 — pas de second var', function () {
    const input = ['let [a, b] = f()', 'a = 1', 'console.log(a, b)'].join('\n')
    const output = autoDeclareTopLevelBareAssignments(input)
    assert.equal(output, input, 'a est déjà lié par la déstructuration de tableau')
  })

  it('imbriquée : {a: {b, c}} = f() puis b = 1 — pas de second var', function () {
    const input = ['let {a: {b, c}} = f()', 'b = 1', 'console.log(b, c)'].join('\n')
    const output = autoDeclareTopLevelBareAssignments(input)
    assert.equal(output, input, 'b est lié via le motif imbriqué {a: {b, c}}')
  })

  it('renommage : {a: renomme} = f() puis renomme = 1 — pas de second var', function () {
    const input = ['let {a: renomme} = f()', 'renomme = 1'].join('\n')
    const output = autoDeclareTopLevelBareAssignments(input)
    assert.equal(output, input, 'seule la cible renommée est liée, pas la clé "a"')
  })

  it('valeur par défaut : {a = 1} = f() puis a = 2 — pas de second var', function () {
    const input = ['let {a = 1} = f()', 'a = 2'].join('\n')
    const output = autoDeclareTopLevelBareAssignments(input)
    assert.equal(output, input, 'a reste lié malgré sa valeur par défaut')
  })

  it('reste objet : {...rest} = f() puis rest = 1 — pas de second var', function () {
    const input = ['let {...rest} = f()', 'rest = 1'].join('\n')
    const output = autoDeclareTopLevelBareAssignments(input)
    assert.equal(output, input)
  })

  it('reste tableau : [a, ...rest] = f() puis rest = 1 et a = 1 — ni l\'un ni l\'autre ne reçoit de var', function () {
    const input = ['let [a, ...rest] = f()', 'rest = 1', 'a = 2'].join('\n')
    const output = autoDeclareTopLevelBareAssignments(input)
    assert.equal(output, input)
  })

  it('témoin — un identifiant SEULEMENT cité dans la valeur par défaut n\'est PAS considéré comme lié', function () {
    // `compute` n'est jamais lié par {a = compute()} = f() — une réaffectation top-level
    // BARE et SANS RAPPORT de `compute` doit continuer à recevoir son `var`, comme avant.
    const input = ['const {a = compute()} = f()', 'compute = 5'].join('\n')
    const output = autoDeclareTopLevelBareAssignments(input)
    assert.equal(output.split('\n')[1], 'var compute = 5', 'compute n\'est pas lié par la déstructuration : comportement inchangé')
  })

  it('une déstructuration INDENTÉE (dans une fonction) reste hors de portée — comportement inchangé', function () {
    const input = ['function f() {', '  const {w} = g()', '  return w', '}', 'w = 1'].join('\n')
    const output = autoDeclareTopLevelBareAssignments(input)
    assert.equal(output.split('\n')[4], 'var w = 1', 'w local à f() ne doit pas masquer la bare top-level homonyme')
  })
})

// Reproduction avec le VRAI compilateur Civet (pas un texte JS écrit à la main) : preuve que la
// réaffectation nue d'un identifiant CONST (`:=`) est refusée à la COMPILATION plutôt que de
// planter au chargement. Compile directement le source Civet (sans passer par le reste du
// pipeline bundler, qui a SA PROPRE détection de déclaration en amont, côté transpiler — hors
// périmètre ici) : `autoDeclareTopLevelBareAssignments` est la SEULE passe testée, exactement
// comme le fait déjà bundler-auto-declare-scope-shadow.test.ts — elle délègue en interne à un
// contrôle par résolution de portée (pas seulement ligne à ligne) : les cas ci-dessous couvrent
// aussi bien une réaffectation au même niveau qu'une réaffectation dans un bloc indenté ou une
// fonction imbriquée SANS homonyme local, et l'incrément/décrément (`++`/`--`).
describe('bundler — autoDeclareTopLevelBareAssignments : réaffectation d\'un IDENT lié par `:=` (const) — erreur de compilation', function () {
  this.timeout(10000)

  const cas: { nom: string; lignes: string[]; identifiant: string }[] = [
    { nom: 'identifiant simple : x := 0 puis x = 10', identifiant: 'x',
      lignes: ['x := 0', 'x = 10', 'export final = x'] },
    { nom: 'déstructuration objet en raccourci : {w, h} := f() puis w = 10', identifiant: 'w',
      lignes: ['export getSize = -> {w: 3, h: 4}', '{w, h} := getSize()', 'w = 10', 'export final = w'] },
    { nom: 'déstructuration tableau : [premier, second] := f() puis premier = 99', identifiant: 'premier',
      lignes: ['export getPaire = -> [10, 20]', '[premier, second] := getPaire()', 'premier = 99', 'export somme = premier'] },
    { nom: 'clé entre apostrophes : {\'a-b\': renamed} := f() puis renamed = 99', identifiant: 'renamed',
      lignes: ["export getObj = -> {'a-b': 1}", "{'a-b': renamed} := getObj()", 'renamed = 99', 'export final = renamed'] },
    { nom: 'clé entre guillemets doubles : {"a-b": renamed} := f() puis renamed = 99', identifiant: 'renamed',
      lignes: ['export getObj = -> {"a-b": 1}', '{"a-b": renamed} := getObj()', 'renamed = 99', 'export final = renamed'] },
    { nom: 'clé calculée : {[cle]: renamed} := f() puis renamed = 99', identifiant: 'renamed',
      lignes: ['export cle = "a-b"', 'export getObj = -> {[cle]: 1}', '{[cle]: renamed} := getObj()', 'renamed = 99', 'export final = renamed'] },
    { nom: 'clé numérique : {1: renamed} := f() puis renamed = 99', identifiant: 'renamed',
      lignes: ['export getObj = -> {1: 1}', '{1: renamed} := getObj()', 'renamed = 99', 'export final = renamed'] },
    { nom: 'affectation composée : x := 0 puis x += 10', identifiant: 'x',
      lignes: ['x := 0', 'x += 10', 'export final = x'] },
    { nom: 'incrément postfixe top-level : x := 0 puis x++', identifiant: 'x',
      lignes: ['x := 0', 'x++', 'export final = x'] },
    { nom: 'décrément préfixe top-level : x := 0 puis --x', identifiant: 'x',
      lignes: ['x := 0', '--x', 'export final = x'] },
    { nom: 'bloc indenté SANS fonction : accumulateur for...of sur une constante', identifiant: 'total',
      lignes: ['total := 0', 'for x of [1, 2, 3]', '  total += x', 'export final = total'] },
    { nom: 'fonction imbriquée SANS homonyme local : réaffectation depuis l\'intérieur', identifiant: 'x',
      lignes: ['x := 1', 'inner = ->', '  x = 6', '  return x', 'export final = inner() + x'] },
  ]

  for (const { nom, lignes, identifiant } of cas) {
    it(`${nom} — refus à la compilation, jamais un TypeError silencieux au chargement`, async function () {
      const civetSrc = lignes.join('\n')
      const { code } = await getAdapter('civet').compileToJs(civetSrc, { fileName: 'cas.civet', bare: true })
      assert.throws(
        () => autoDeclareTopLevelBareAssignments(code, 'cas.civet'),
        (err: unknown) => {
          assert.ok(err instanceof Error, 'doit lever une vraie Error')
          assert.match(err.message, new RegExp(`'${identifiant}'`), 'nomme l\'identifiant fautif')
          assert.match(err.message, /ligne \d+/, 'nomme la ligne fautive')
          assert.match(err.message, /:=.*constante.*\.=/, 'indique la solution : `.=` pour pouvoir réaffecter')
          return true
        }
      )
    })
  }
})

// Réaffectations LÉGITIMES : `.=` (let), affectation de PROPRIÉTÉ sur un objet lié par `:=`, et
// homonyme déclaré par une fonction IMBRIQUÉE — aucune ne doit être refusée. Preuve par
// EXÉCUTION RÉELLE du module produit (import ESM natif du fichier émis, pas une simple lecture du
// texte compilé) : un `const` non détecté correctement lèverait un `TypeError` masqué par une
// assertion textuelle, jamais par une vraie exécution.
describe('bundler — autoDeclareTopLevelBareAssignments : réaffectation légitime — exécution réelle du module produit', function () {
  this.timeout(10000)

  async function compileEtExecute(nom: string, civetSrc: string): Promise<Record<string, unknown>> {
    const { code } = await getAdapter('civet').compileToJs(civetSrc, { fileName: nom + '.civet', bare: true })
    const after = autoDeclareTopLevelBareAssignments(code, nom + '.civet')
    const dir  = mjsTmp('auto-declare-exec')
    const file = join(dir, nom + '.mjs')
    writeFileSync(file, after + '\n')
    return import(pathToFileURL(file).href)
  }

  it('identifiant simple lié par `.=` : x .= 0 puis x = 10 — exécution reflète la réaffectation', async function () {
    const mod = await compileEtExecute('dotassign-simple', ['x .= 0', 'x = 10', 'export final = x'].join('\n'))
    assert.equal(mod.final, 10)
  })

  it('déstructuration liée par `.=` : {w, h} .= f() puis w = 10 — exécution reflète la réaffectation', async function () {
    const mod = await compileEtExecute('dotassign-destructure', [
      'export getSize = -> {w: 3, h: 4}',
      '{w, h} .= getSize()',
      'w = 10',
      'export final = w + h',
    ].join('\n'))
    assert.equal(mod.final, 14, 'w réaffecté à 10 (h=4 inchangé) : 10 + 4 = 14')
  })

  it('affectation de PROPRIÉTÉ sur un objet lié par `:=` (jamais une réaffectation de l\'identifiant lui-même) — exécution correcte', async function () {
    const mod = await compileEtExecute('propriete-sur-const', [
      'renamed := {x: 1}',
      'renamed.x = 5',
      'export final = renamed.x',
    ].join('\n'))
    assert.equal(mod.final, 5)
  })

  it('une fonction imbriquée qui déclare son PROPRE homonyme n\'est jamais confondue avec le `:=` top-level — exécution correcte', async function () {
    const mod = await compileEtExecute('homonyme-imbrique', [
      'x := 1',
      'inner = ->',
      '  x .= 5',
      '  x = 6',
      '  return x',
      'export final = inner() + x',
    ].join('\n'))
    assert.equal(mod.final, 7, 'inner() retourne 6 (son propre x local, mutable), x top-level reste 1 : 6 + 1 = 7')
  })

  it('un paramètre de fonction homonyme d\'un `:=` top-level n\'est jamais confondu avec lui — exécution correcte', async function () {
    const mod = await compileEtExecute('parametre-homonyme', [
      'x := 1',
      'f = (x) ->',
      '  x = 99',
      '  return x',
      'export final = f(5) + x',
    ].join('\n'))
    assert.equal(mod.final, 100, 'f(5) réaffecte SON paramètre (99), x top-level reste 1 : 99 + 1 = 100')
  })

  it('le paramètre d\'un `catch` homonyme d\'un `:=` top-level n\'est jamais confondu avec lui — exécution correcte', async function () {
    const mod = await compileEtExecute('catch-homonyme', [
      'e := 1',
      'try',
      '  throw new Error("boom")',
      'catch e',
      '  e = 5',
      'export final = e',
    ].join('\n'))
    assert.equal(mod.final, 1, 'le `catch (e)` a sa PROPRE liaison, mutable et locale au bloc : le `:=` top-level survit')
  })

  it('for (const x of …) homonyme d\'un `:=` top-level, lecture seule — jamais une réaffectation externe', async function () {
    const mod = await compileEtExecute('forconst-homonyme', [
      'x := 1',
      'result = []',
      'for x of [10, 20, 30]',
      '  result.push x',
      'export final = result',
      'export outer = x',
    ].join('\n'))
    assert.deepEqual(mod.final, [10, 20, 30])
    assert.equal(mod.outer, 1, 'la liaison `x` de la boucle est fraîche à chaque tour, jamais le `:=` top-level')
  })
})
