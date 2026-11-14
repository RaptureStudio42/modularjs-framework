// un gestionnaire, un rappel de transition ou un gestionnaire de <@window> écrits sur plusieurs lignes : un `unless` en fin de
// dernière ligne ne prend que la dernière instruction (`$a = 1` puis `$b = 2 unless $c` : `$a = 1` s'exécute toujours), comme en
// Civet et en CoffeeScript écrits à la main — tout le corps passait sous la condition, ou le gestionnaire se compilait vide ; une
// première ligne collée à `{` et les suivantes en retrait (`@click={$a = 1⏎    $b = 2}`) se lisent comme quand l'accolade est seule
// en fin de ligne — la ligne d'après devenait l'argument de la première (`1(…)`) ; `return unless $v; $x = 2` écrit sur une ligne
// se construit dans un rappel. Une première ligne collée qui ouvre un bloc, puis une ligne moins en retrait que son corps : cette
// ligne est hors du bloc (le code produit était faux, sans erreur) ; `unless` dans le corps d'une flèche écrite sur sa ligne ne prend
// que ce corps (`z is not defined` au clic) ; `x unless c; y` se construit sur toute ligne du corps et dans un gestionnaire de
// <@window> (refusé par Civet, ou « parse error »). Chaque gestionnaire est joué tel que compilé, contre un état, dans les deux
// langues des gestionnaires

import assert from 'node:assert/strict'
import * as acorn from 'acorn'
import { transpile } from '../src/transpiler/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, attendre } from './helpers/coeur-monter.js'

type Etat = Record<string, unknown>

const LANGUES = [['Civet', {}]] as const

// le code affecté à la cible (`this._mjs_inline`, `_mjs_node._mjs_cb_introend`, `this._gl_0`) dans la sortie, lu sur son arbre
function affecte(sortie: string, cible: string): string {
  const texte = sortie.replace(/µ\.asset\(('[^']+')\)/g, '$1')
  const trouve: string[] = []
  const visite = (n: any): void => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(visite)
    if (n.type === 'AssignmentExpression' && texte.slice(n.left.start, n.left.end) === cible) trouve.push(texte.slice(n.right.start, n.right.end))
    for (const k of Object.keys(n)) if (k !== 'type' && typeof n[k] === 'object') visite(n[k])
  }
  visite(acorn.parse(texte, { ecmaVersion: 'latest', sourceType: 'module' }))
  return trouve[0] ?? ''
}

// la fonction compilée jouée contre `etat` : `µ._set` y écrit, `$` le lit ; `args` : l'événement et la balise ; `_mjs_lq` et `_mjs_lqF`
// : le lot des écritures d'un appel qui boucle (`forEach`)
function joue(fonction: string, etat: Etat, ...args: unknown[]): void {
  const µ = { _set: (_c: unknown, k: string, v: unknown) => (etat[k] = v), _mjs_lq: 0, _mjs_lqF: () => {} }
  new Function('µ', '$', '_mjsThis', `return (${fonction})`)(µ, etat, {})(...args)
}

const SCRIPT = '<script>\n$a = 0\n$b = 0\n$c = true\n$v = true\n</script>\n'

async function gestionnaire(corps: string, etat: Etat, opts: Record<string, unknown>, ...args: unknown[]): Promise<Etat> {
  const sortie = String(((await transpile(`${SCRIPT}<button @click={${corps}}>a</button>\n`, { moduleName: 'plusieurs-lignes', ...opts } as any)) as any).output)
  const liste  = affecte(sortie, 'this._mjs_inline')
  assert.ok(liste.startsWith('['), `tableau des gestionnaires introuvable :\n${sortie.slice(0, 600)}`)
  // un seul gestionnaire : une ligne sortie du corps en deviendrait un second, exécuté à la construction du tableau, jamais au clic
  const nombre = (acorn.parseExpressionAt(liste, 0, { ecmaVersion: 'latest' }) as any).elements.length
  assert.equal(nombre, 1, `un gestionnaire attendu, ${nombre} produits :\n${liste}`)
  joue(`${liste}[0]`, etat, ...args)
  return etat
}

async function rappel(corps: string, etat: Etat, opts: Record<string, unknown>): Promise<Etat> {
  const sortie = String(((await transpile(`${SCRIPT}<p :transition=*fade @introend={${corps}}>x</p>\n`, { moduleName: 'plusieurs-lignes', ...opts } as any)) as any).output)
  const f      = affecte(sortie, '_mjs_node._mjs_cb_introend')
  assert.ok(f !== '', `rappel introuvable :\n${sortie.slice(0, 600)}`)
  joue(f, etat)
  return etat
}

async function fenetre(corps: string, etat: Etat): Promise<Etat> {
  const sortie = String(((await transpile(`${SCRIPT}<@window @resize={${corps}} />\n<p>{$a}</p>\n`, { moduleName: 'plusieurs-lignes' } as any)) as any).output)
  const f      = affecte(sortie, 'this._gl_0')
  assert.ok(f !== '', `gestionnaire de <@window> introuvable :\n${sortie.slice(0, 600)}`)
  joue(f, etat, {}, {})
  return etat
}

// [nom, corps, état de départ, état attendu après le gestionnaire]
const GESTIONNAIRES: Array<[string, string, Etat, Etat]> = [
  ['`unless` final, accolade seule, condition vraie', '\n  $a = 1\n  $b = 2 unless $c\n', { a: 0, b: 0, c: true }, { a: 1, b: 0 }],
  ['`unless` final, accolade seule, condition fausse', '\n  $a = 1\n  $b = 2 unless $c\n', { a: 0, b: 0, c: false }, { a: 1, b: 2 }],
  ['`unless` final après un bloc `if`', '\n  if $a == 0\n    $a = 5\n  $b = 2 unless $c\n', { a: 0, b: 0, c: true }, { a: 5, b: 0 }],
  ['`unless` final dans un bloc `if`', '\n  $a = 1\n  if $a == 1\n    $b = 2 unless $c\n', { a: 0, b: 0, c: false }, { a: 1, b: 2 }],
  ['`unless` final dans un bloc `if`, condition vraie', '\n  $a = 1\n  if $a == 1\n    $b = 2 unless $c\n', { a: 0, b: 0, c: true }, { a: 1, b: 0 }],
  ['instruction sur deux lignes (opérateur en fin de ligne) sous la condition', '\n  $a = 1\n  $b = $a +\n    2 unless $c\n', { a: 0, b: 0, c: false }, { a: 1, b: 3 }],
  ['instruction sur deux lignes sous la condition, condition vraie', '\n  $a = 1\n  $b = $a +\n    2 unless $c\n', { a: 0, b: 0, c: true }, { a: 1, b: 0 }],
  ['ligne qui finit sur une chaîne, puis `unless` final', "\n  $a = 'x'\n  $b = 2 unless $c\n", { a: 0, b: 0, c: true }, { a: 'x', b: 0 }],
  ['commentaires entre les lignes, puis `unless` final', '\n  $a = 1 # un mot\n  # une ligne de commentaire\n  $b = 2 unless $c\n', { a: 0, b: 0, c: true }, { a: 1, b: 0 }],
  ['appel chaîné à la ligne, puis `unless` final', '\n  $a = [3, 1]\n    .length\n  $b = 2 unless $c\n', { a: 0, b: 0, c: true }, { a: 2, b: 0 }],
  ['deux `unless` de suite, sur deux lignes', '\n  $a = 1 unless $c\n  $b = 2 unless $v\n', { a: 0, b: 0, c: false, v: false }, { a: 1, b: 2 }],
  ['chaîne d\'appels, rappel en bloc, `unless` sur sa dernière ligne, condition vraie', '\n  $a = [1, 2, 3]\n    .map (z) ->\n      z * 2\n    .length unless $c\n', { a: 0, c: true }, { a: 0 }],
  ['chaîne d\'appels, rappel en bloc, `unless` sur sa dernière ligne, condition fausse', '\n  $a = [1, 2, 3]\n    .map (z) ->\n      z * 2\n    .length unless $c\n', { a: 0, c: false }, { a: 3 }],
  ['chaîne d\'appels, deux rappels en bloc, `unless` final', '\n  $a = [1]\n    .map (z) ->\n      z + 1\n    .filter (z) ->\n      z > 0\n    .length unless $c\n', { a: 0, c: false }, { a: 1 }],
  ['`;` dans un rappel en bloc, chaîne continuée, `unless` final', '\n  $a = [1, 2]\n    .map (z) ->\n      q = z; q * 2\n    .length unless $c\n', { a: 0, c: false }, { a: 2 }],
  ['regex à drapeau en tête de la condition (Civet y lisait une section d\'opérateur), vraie', '$b = 2 unless /x/i.test(String($a))', { a: 'X', b: 0 }, { b: 0 }],
  ['regex à drapeau en tête de la condition (Civet y lisait une section d\'opérateur), fausse', '$b = 2 unless /x/i.test(String($a))', { a: 'y', b: 0 }, { b: 2 }],
  ['première ligne collée à `{`, la suite en retrait', '$a = 1\n    $b = 2', { a: 0, b: 0 }, { a: 1, b: 2 }],
  ['première ligne collée, la suite au retrait du HTML', '$a = 1\n  $b = 2\n  $c = 3', { a: 0, b: 0, c: 0 }, { a: 1, b: 2, c: 3 }],
  ['première ligne collée, un bloc en retrait ensuite', '$a = 1\n    if $c\n      $b = 2', { a: 0, b: 0, c: true }, { a: 1, b: 2 }],
  ['première ligne collée et `unless` final', '$a = 1\n    $b = 2 unless $c', { a: 0, b: 0, c: true }, { a: 1, b: 0 }],
  ['contre-cas : première ligne collée qui ouvre un bloc', 'if $c\n    $a = 1', { a: 0, c: true }, { a: 1 }],
  ['contre-cas : première ligne collée qui ouvre un bloc, condition fausse', 'if $c\n    $a = 1', { a: 0, c: false }, { a: 0 }],
  ['contre-cas : première ligne collée continuée par un appel chaîné', '$a = [1, 2]\n    .length', { a: 0 }, { a: 2 }],
  ['contre-cas : `unless` sur une ligne', '$b = 2 unless $c', { b: 0, c: false }, { b: 2 }],
  ['contre-cas : `unless` sur une ligne, condition vraie', '$b = 2 unless $c', { b: 0, c: true }, { b: 0 }],
  ['`is` dans la condition (CoffeeScript refusait `===`)', '$b = 2 if $a is 0', { a: 0, b: 0 }, { b: 2 }],
  ['`isnt` dans la condition', '$b = 3 if $a isnt 0', { a: 1, b: 0 }, { b: 3 }],
  ['`is not` dans la condition', '$b = 4 if $a is not true', { a: false, b: 0 }, { b: 4 }],
  ['première ligne collée qui ouvre un bloc (flèche), la ligne d\'après moins en retrait que son corps', '[1, 2, 3].forEach (z) ->\n      $a += z\n    $b = 2', { a: 0, b: 0 }, { a: 6, b: 2 }],
  ['première ligne collée `if`, la ligne d\'après hors du bloc, condition fausse', 'if $c\n      $a = 1\n    $b = 2', { a: 0, b: 0, c: false }, { a: 0, b: 2 }],
  ['première ligne collée `if`, la ligne d\'après hors du bloc, condition vraie', 'if $c\n      $a = 1\n    $b = 2', { a: 0, b: 0, c: true }, { a: 1, b: 2 }],
  ['première ligne collée `if`, `else` au niveau de la première', 'if $c\n      $a = 1\n    else\n      $a = 2\n    $b = 3', { a: 0, b: 0, c: false }, { a: 2, b: 3 }],
  ['première ligne collée `try`, `catch` au niveau de la première', 'try\n      $a = 1\n    catch err\n      $a = 2\n    $b = 2', { a: 0, b: 0 }, { a: 1, b: 2 }],
  ['contre-cas : première ligne collée qui ouvre un bloc, son corps sur deux lignes au même retrait', 'if $c\n    $a = 1\n    $b = 2', { a: 0, b: 0, c: false }, { a: 0, b: 0 }],
  ['`unless` dans le corps d\'une flèche écrite sur sa ligne (la condition lit son paramètre)', '[1, 2, 3].forEach (z) -> $a += z unless z == 2', { a: 0 }, { a: 4 }],
  ['`unless` dans le corps d\'une flèche, un `;` dans ce corps', '[1, 2, 3].forEach (z) -> $a += z unless z == 2; $b += 1', { a: 0, b: 0 }, { a: 4, b: 3 }],
  ['`unless` dans le corps d\'une flèche, après une instruction et un `;`', '$b = 5; [1, 2, 3].forEach (z) -> $a += z unless z == 2', { a: 0, b: 0 }, { a: 4, b: 5 }],
  ['`return unless` dans le corps d\'une flèche, suivi d\'un `;`', '[1, 2, 3].forEach (z) -> return unless z == 2; $a += z', { a: 0 }, { a: 2 }],
  ['contre-cas : flèche refermée avant `unless`, condition fausse', '$a = [1, 2].map((z) -> z * 2).length unless $c', { a: 0, c: false }, { a: 2 }],
  ['contre-cas : flèche refermée avant `unless`, condition vraie', '$a = [1, 2].map((z) -> z * 2).length unless $c', { a: 0, c: true }, { a: 0 }],
  ['`x unless c; y` sur une ligne qui n\'est pas la dernière, condition vraie', '\n  $a = 1 unless $c; $b = 2\n  $v = 3\n', { a: 0, b: 0, c: true, v: 0 }, { a: 0, b: 2, v: 3 }],
  ['`x unless c; y` sur une ligne qui n\'est pas la dernière, condition fausse', '\n  $a = 1 unless $c; $b = 2\n  $v = 3\n', { a: 0, b: 0, c: false, v: 0 }, { a: 1, b: 2, v: 3 }],
  ['`return unless $v; $x = 2` sur une ligne qui n\'est pas la dernière, condition vraie', '\n  return unless $v; $a = 2\n  $b = 3\n', { a: 0, b: 0, v: true }, { a: 2, b: 3 }],
  ['`return unless $v; $x = 2` sur une ligne qui n\'est pas la dernière, condition fausse', '\n  return unless $v; $a = 2\n  $b = 3\n', { a: 0, b: 0, v: false }, { a: 0, b: 0 }],
  ['contre-cas : `unless` sans `;` sur une ligne qui n\'est pas la dernière', '\n  $a = 1 unless $c\n  $b = 2\n', { a: 0, b: 0, c: false }, { a: 1, b: 2 }],
  ['un `else` referme la flèche (`if $v then -> 1 else 2`) : `unless` prend toute l\'instruction', '$a = if $v then -> 1 else 2 unless $c', { a: 0, c: false, v: false }, { a: 2 }],
  ['contre-cas : `return x unless c; y` dans une flèche, la valeur de `y` rendue', '$a = [1, 2, 3].find (z) -> return false unless z > 1; true', { a: 0 }, { a: 2 }],
  ['première ligne collée `if … then …` qui finit son bloc : la ligne d\'après s\'exécute toujours, condition fausse', 'if $c then $a = 1\n    $b = 2', { a: 0, b: 0, c: false }, { a: 0, b: 2 }],
  ['première ligne collée `if … then …` qui finit son bloc, condition vraie', 'if $c then $a = 1\n    $b = 2', { a: 0, b: 0, c: true }, { a: 1, b: 2 }],
  ['première ligne collée `if … then … else …`, la ligne d\'après hors du bloc', 'if $c then $a = 1 else $a = 2\n    $b = 3', { a: 0, b: 0, c: false }, { a: 2, b: 3 }],
  ['première ligne collée `while … then …`, la ligne d\'après hors de la boucle', 'while $a < 3 then $a++\n    $b = $a', { a: 0, b: 0 }, { a: 3, b: 3 }],
  ['contre-cas : première ligne collée qui finit sur `else`, son corps en retrait', 'if $c then $a = 1 else\n      $a = 2\n    $b = 3', { a: 0, b: 0, c: false }, { a: 2, b: 3 }]
]

describe('gestionnaires et rappels sur plusieurs lignes : `unless` final, première ligne collée à `{`', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  for (const [langue, opts] of LANGUES) {
    for (const [nom, corps, depart, attendu] of GESTIONNAIRES) {
      it(`gestionnaire (${langue}) : ${nom}`, async () => {
        const etat = await gestionnaire(corps, { ...depart }, opts)
        for (const [k, v] of Object.entries(attendu)) assert.equal(etat[k], v, `$${k} après ${JSON.stringify(corps)}`)
      })
    }

    it(`gestionnaire (${langue}) : contre-cas, première ligne collée qui appelle sans parenthèses un objet en retrait`, async () => {
      const recu: unknown[] = []
      await gestionnaire('e.push\n    id: 1', {}, opts, recu, {})
      assert.deepEqual(recu, [{ id: 1 }])
    })

    for (const [nom, corps, depart, attendu] of [
      ['`return unless $v; $x = 2` sur une ligne, condition vraie', 'return unless $v; $a = 2', { a: 0, v: true }, { a: 2 }],
      ['`return unless $v; $x = 2` sur une ligne, condition fausse', 'return unless $v; $a = 2', { a: 0, v: false }, { a: 0 }],
      ['`unless` final, accolade seule', '\n  $a = 1\n  $b = 2 unless $c\n', { a: 0, b: 0, c: true }, { a: 1, b: 0 }],
      ['première ligne collée à `{`, la suite en retrait', '$a = 1\n    $b = 2', { a: 0, b: 0 }, { a: 1, b: 2 }],
      ['première ligne collée et `unless` final', '$a = 1\n    $b = 2 unless $c', { a: 0, b: 0, c: true }, { a: 1, b: 0 }],
      ['première ligne collée qui ouvre un bloc, la ligne d\'après hors du bloc', 'if $c\n      $a = 1\n    $b = 2', { a: 0, b: 0, c: false }, { a: 0, b: 2 }],
      ['`unless` dans le corps d\'une flèche écrite sur sa ligne', '[1, 2, 3].forEach (z) -> $a += z unless z == 2', { a: 0 }, { a: 4 }],
      ['`return unless $v; $x = 2` sur une ligne qui n\'est pas la dernière', '\n  return unless $v; $a = 2\n  $b = 3\n', { a: 0, b: 0, v: false }, { a: 0, b: 0 }],
      ['première ligne collée `if … then …` qui finit son bloc : la ligne d\'après s\'exécute toujours', 'if $c then $a = 1\n    $b = 2', { a: 0, b: 0, c: false }, { a: 0, b: 2 }]
    ] as Array<[string, string, Etat, Etat]>) {
      it(`rappel de transition (${langue}) : ${nom}`, async () => {
        const etat = await rappel(corps, { ...depart }, opts)
        for (const [k, v] of Object.entries(attendu)) assert.equal(etat[k], v, `$${k} après ${JSON.stringify(corps)}`)
      })
    }
  }

  for (const [nom, corps, depart, attendu] of [
    ['`unless` final, accolade seule', '\n  $a = 1\n  $b = 2 unless $c\n', { a: 0, b: 0, c: true }, { a: 1, b: 0 }],
    ['première ligne collée à `{`, la suite en retrait', '$a = 1\n    $b = 2', { a: 0, b: 0 }, { a: 1, b: 2 }],
    ['première ligne collée qui ouvre un bloc, la ligne d\'après hors du bloc', 'if $c\n      $a = 1\n    $b = 2', { a: 0, b: 0, c: false }, { a: 0, b: 2 }],
    ['`return unless $v; $x = 2` sur une ligne, condition vraie', 'return unless $v; $a = 2', { a: 0, v: true }, { a: 2 }],
    ['`return unless $v; $x = 2` sur une ligne, condition fausse', 'return unless $v; $a = 2', { a: 0, v: false }, { a: 0 }],
    ['`x unless c; y` sur une ligne', '$a = 1 unless $c; $b = 2', { a: 0, b: 0, c: true }, { a: 0, b: 2 }],
    ['`x unless c; y` sur une ligne qui n\'est pas la dernière', '\n  $a = 1 unless $c; $b = 2\n  $v = 3\n', { a: 0, b: 0, c: false, v: 0 }, { a: 1, b: 2, v: 3 }],
    ['`return unless` dans le corps d\'une flèche, suivi d\'un `;`', '[1, 2, 3].forEach (z) -> return unless z == 2; $a += z', { a: 0 }, { a: 2 }],
    ['contre-cas : `unless` final sans `;`', '$a = 1 unless $c', { a: 0, c: false }, { a: 1 }],
    ['`return x unless c; y` dans une flèche écrite sur sa ligne : la valeur de `y` est rendue', '$a = [1, 2, 3].find (z) -> return false unless z > 1; true', { a: 0 }, { a: 2 }],
    ['`return x unless c; y` dans le corps en bloc d\'une flèche : la valeur de `y` est rendue', '\n  $a = [1, 2, 3].find (z) ->\n    return false unless z > 1; true\n  $b = 1\n', { a: 0, b: 0 }, { a: 2, b: 1 }],
    ['regex à drapeau en tête de la condition d\'un saut suivi d\'un `;`, vraie', 'return unless /x/i.test(String($a)); $b = 2', { a: 'X', b: 0 }, { b: 2 }],
    ['regex à drapeau en tête de la condition d\'un saut suivi d\'un `;`, fausse', 'return unless /x/i.test(String($a)); $b = 2', { a: 'y', b: 0 }, { b: 0 }],
    ['contre-cas : une virgule referme la flèche (`reduce (s, z) -> s + z, 0`)', '$a = [1, 2, 3].reduce (s, z) -> s + z, 0 unless $c', { a: 0, c: false }, { a: 6 }],
    ['première ligne collée `if … then …` qui finit son bloc : la ligne d\'après s\'exécute toujours', 'if $c then $a = 1\n    $b = 2', { a: 0, b: 0, c: false }, { a: 0, b: 2 }]
  ] as Array<[string, string, Etat, Etat]>) {
    it(`gestionnaire de <@window> : ${nom}`, async () => {
      const etat = await fenetre(corps, { ...depart })
      for (const [k, v] of Object.entries(attendu)) assert.equal(etat[k], v, `$${k} après ${JSON.stringify(corps)}`)
    })
  }

  // Civet seul : CoffeeScript ne lit pas `f (s, z) -> s + z, 0` sans parenthèses
  for (const [nom, corps, depart, attendu] of [
    ['une virgule referme la flèche (`reduce (s, z) -> s + z, 0`) : `unless` prend tout l\'appel, condition fausse', '$a = [1, 2, 3].reduce (s, z) -> s + z, 0 unless $c', { a: 0, c: false }, { a: 6 }],
    ['une virgule referme la flèche : `unless` prend tout l\'appel, condition vraie', '$a = [1, 2, 3].reduce (s, z) -> s + z, 0 unless $c', { a: 0, c: true }, { a: 0 }],
    ['deux flèches, la seconde refermée par une virgule', '$a = [[1, 2], [3]].map((t) -> t.length).reduce (s, z) -> s + z, 10 unless $c', { a: 0, c: false }, { a: 13 }],
    ['un `else` referme la flèche, condition vraie', '$a = if $v then -> 1 else 2 unless $c', { a: 0, c: true, v: false }, { a: 0 }],
    ['contre-cas : un `else` ouvert par un `then` du corps de la flèche', '[1, 2, 3].forEach (z) -> $a += (if z > 1 then z else 0) unless z == 3', { a: 0 }, { a: 2 }]
  ] as Array<[string, string, Etat, Etat]>) {
    it(`gestionnaire (Civet) : ${nom}`, async () => {
      const etat = await gestionnaire(corps, { ...depart }, {})
      for (const [k, v] of Object.entries(attendu)) assert.equal(etat[k], v, `$${k} après ${JSON.stringify(corps)}`)
    })
    it(`rappel de transition (Civet) : ${nom}`, async () => {
      const etat = await rappel(corps, { ...depart }, {})
      for (const [k, v] of Object.entries(attendu)) assert.equal(etat[k], v, `$${k} après ${JSON.stringify(corps)}`)
    })
  }

  for (const [nom, corps] of [['`unless` final, accolade seule', '\n    $a = 1\n    $b = 2 unless $c\n  '], ['première ligne collée et `unless` final', '$a = 1\n    $b = 2 unless $c']]) {
    it(`au clic, dans la page (${nom}) : la première instruction s'exécute, la dernière reste sous sa condition`, async () => {
      const { window, hote, erreurs } = await monterHote(`<script>\n$a = 0\n$b = 0\n$c = true\n</script>\n<div>\n  <button @click={${corps}}>{$a}-{$b}</button>\n</div>`, 'plusieurs-lignes-clic')
      try {
        const bouton = hote._shadow.querySelector('button')
        assert.equal(bouton?.textContent, '0-0')
        bouton.click()
        await attendre(() => bouton.textContent !== '0-0')
        assert.equal(bouton.textContent, '1-0')
        assert.equal(erreurs.length, 0, erreurs.join('\n'))
      }
      finally {
        await window.happyDOM.close()
      }
    })
  }

  for (const [nom, corps, attendu] of [['`unless` dans le corps d\'une flèche écrite sur sa ligne', '[1, 2, 3].forEach (z) -> $a += z unless z == 2', '4-0'], ['première ligne collée qui ouvre un bloc, la ligne d\'après hors du bloc', 'if $c\n      $a = 1\n    $b = 2', '1-2']]) {
    it(`au clic, dans la page (${nom}) : le gestionnaire s'exécute sans erreur`, async () => {
      const { window, hote, erreurs } = await monterHote(`<script>\n$a = 0\n$b = 0\n$c = true\n</script>\n<div>\n  <button @click={${corps}}>{$a}-{$b}</button>\n</div>`, 'plusieurs-lignes-clic')
      try {
        const bouton = hote._shadow.querySelector('button')
        assert.equal(bouton?.textContent, '0-0')
        bouton.click()
        await attendre(() => bouton.textContent !== '0-0' || erreurs.length > 0)
        assert.equal(erreurs.length, 0, erreurs.join('\n'))
        assert.equal(bouton.textContent, attendu)
      }
      finally {
        await window.happyDOM.close()
      }
    })
  }
})
