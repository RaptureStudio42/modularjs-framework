// les expressions du gabarit lues par l'arbre : une seule compilation Civet du texte écrit, puis les raccourcis de MJS
// (`$x`, `$$x`, `µx`) réécrits sur l'arbre ESTree du JavaScript produit ; la sortie est celle de l'ancienne lecture au
// caractère près (relevée avant son retrait), et une écriture que l'arbre ne sait pas lire est refusée à la construction

import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { cleanJs, cleanJsExpr, cleanJsHandler, runesAwait } from '../src/generator/utils.js'
import { readFileSync as lireFige } from 'node:fs'
import { expressionCounters } from '../src/reader/expression.js'

type LectureDesExpressions = 'ancienne' | 'arbre'
// sorties et messages de l'ancienne lecture des expressions, relevés avant son retrait
const COMPOSANTS = JSON.parse(lireFige(new URL('./fixtures/composants-ancienne-lecture.json', import.meta.url), 'utf-8')) as Record<string, string>
// (dans l'ordre des lectures du test : une même écriture se lit autrement dans une branche de {await})
const ANCIENNE = (JSON.parse(lireFige(new URL('./fixtures/expressions-ancienne-lecture.json', import.meta.url), 'utf-8')) as Record<string, { expr: string, externes: string[] }[]>)['lecture-des-expressions']
let rang = 0
// sorties de l'ancienne lecture des fragments, relevées avant son retrait (`fragment` : cleanJs(code, ['$Panier']) ; `gestionnaire
// civet`, `gestionnaire js` : cleanJsGestionnaire(code, [], gabarit) ; `erreur : …` pour un refus)
const FRAGMENTS = JSON.parse(lireFige(new URL('./fixtures/fragments-ancienne-lecture.json', import.meta.url), 'utf-8')) as Record<string, string>
function ancienneLecture(sorte: string, code: string): string {
  const fige = FRAGMENTS[`${sorte} ${JSON.stringify(code)}`]
  if (fige === undefined) throw new Error(`sortie de l'ancienne lecture non relevée : ${sorte} ${code}`)
  return fige
}
import { codeCounters } from '../src/reader/code.js'
import { RESERVED_LETTERS } from '../src/reader/disguise.js'
import { transpile } from '../src/transpiler/index.js'

interface Lu { js?: string, erreur?: string, arbre: number, relues: number, raison: string }

function lire(expr: string, lecture: LectureDesExpressions, externes: string[] = []): Lu {
  if (lecture === 'ancienne') {
    const fige = ANCIENNE[rang++]
    if (!fige || fige.expr !== expr || JSON.stringify(fige.externes) !== JSON.stringify(externes)) throw new Error(`sortie de l'ancienne lecture non relevée : ${expr}`)
    return { ...fige, arbre: 0, relues: 0, raison: '' } as any
  }
  const arbre  = expressionCounters.tree
  const relues = expressionCounters.reread
  try {
    return { js: cleanJsExpr(expr, externes, 'essai'), arbre: expressionCounters.tree - arbre, relues: expressionCounters.reread - relues, raison: expressionCounters.last }
  }
  catch (e) {
    return { erreur: (e as Error).message, arbre: expressionCounters.tree - arbre, relues: expressionCounters.reread - relues, raison: expressionCounters.last }
  }
}

// lue par l'arbre, même sortie que l'ancienne lecture
function parLArbre(expr: string, attendu: string, externes: string[] = []): void {
  const a = lire(expr, 'ancienne', externes)
  const b = lire(expr, 'arbre', externes)
  assert.equal(a.js, attendu, `ancienne lecture de ${expr}`)
  assert.equal(b.js, attendu, `arbre pour ${expr}`)
  assert.equal(b.arbre, 1, `${expr} doit être lue par l'arbre (raison du refus : ${b.raison})`)
}

// lue par l'arbre, même sortie ou même message que l'ancienne lecture
function commeLAncienne(expr: string, externes: string[] = []): void {
  const a = lire(expr, 'ancienne', externes)
  const b = lire(expr, 'arbre', externes)
  assert.equal(b.relues, 0, `${expr} doit être lue par l'arbre (raison du refus : ${b.raison})`)
  assert.equal(b.js, a.js, expr)
  assert.equal(b.erreur, a.erreur, expr)
}

describe('expressions du gabarit lues par l\'arbre', () => {
  it('variables, `@x`, store, grammaire Civet : une compilation, réécriture sur l\'arbre', () => {
    parLArbre('$x + @y', '$.x + this.y')
    parLArbre('$x == 1 and not $y', '$.x === 1 && !$.y')
    parLArbre('$items.map (t) -> t.done', '$.items.map(function(t) { return t.done })')
    parLArbre('$$panier.total', 'µ.store.panier.total')
    parLArbre('[...$liste, $o[$k]]', '[...$.liste, $.o[$.k]]')
    parLArbre('if $a then $b else 2', '($.a? $.b : 2)')
    parLArbre('obj.$x + a?.$y', 'obj.$x + a?.$y')
  })

  it('objet abrégé : `{$x}` garde sa clé', () => {
    parLArbre('{$a, b: $$s, $$t}', '{a: $.a, b: µ.store.s, t: µ.store.t}')
    parLArbre('{µUrl}', '{Url: µ.Url}')
  })

  it('runes µ des formes courtes, langue, thème, mise en page', () => {
    parLArbre('µurl.path + µFoo', 'µ.url.path + µ.Foo')
    parLArbre('µfoo $x', 'µ.foo($.x)')
    parLArbre('µlang', 'µ.store.__mjsLang')
    parLArbre('µtheme is \'sombre\'', 'µ.store.__mjsTheme === \'sombre\'')
    parLArbre('µlayout', '($.layout || \'default\')')
  })

  it('chaînes, gabarits et interpolations : le texte reste tel quel, le code est réécrit', () => {
    parLArbre('\'$x et µfoo\' + $x', '\'$x et µfoo\' + $.x')
    parLArbre('"total #{$n} €"', '`total ${$.n} €`')
    parLArbre('`a ${$x} $y`', '`a ${$.x} $y`')
  })

  it('nom importé gardé tel quel, singleton importé lu en store refusé comme avant', () => {
    parLArbre('$Panier.total + $x', '$Panier.total + $.x', ['$Panier'])
    commeLAncienne('$$Panier', ['$Panier'])
  })

  it('`µpending` d\'une branche de `{await}`', () => {
    runesAwait.pending = true
    try {
      parLArbre('µpending', '_mjs_pnd')
    }
    finally {
      runesAwait.pending = false
    }
    parLArbre('µpending', 'µ.pending')
  })

  it('raccourcis que Civet ne lit pas, déguisés le temps de la compilation : contexte, composant, paramètre de route, `isnt`', () => {
    parLArbre('µt(§boutique) + §§lang', 'µ.t(_mjsThis._mjs_getContext(\'boutique\')) + _mjsThis._mjs_getRCtx(\'lang\')')
    parLArbre('@@total + [...§liste]', '_mjsThis.total + [..._mjsThis._mjs_getContext(\'liste\')]')
    parLArbre('&id', 'µ.url.params.id')
    parLArbre('if &id then &id else \'aucun\'', '(µ.url.params.id? µ.url.params.id : \'aucun\')')
    parLArbre('$a isnt 2 and $b', '$.a !== 2 && $.b')
  })

  it('lues par l\'arbre par le texte réécrit, comme l\'ancienne lecture : comparaison chaînée, runes à forme, nom en clé ou lié, lettre restée hors d\'un texte', () => {
    commeLAncienne('a < $x < b')
    commeLAncienne('µread $x')
    commeLAncienne('{$x: 1}')
    // un paramètre nommé `$x` est refusé (`$` est réservé à l'état) ; l'ancienne lecture écrivait l'état à chaque appel
    lire('($x) -> $x', 'ancienne')
    assert.match(lire('($x) -> $x', 'arbre').erreur ?? '', /ne nommez pas un paramètre « \$x »/)
    commeLAncienne('obj.§x')
  })

  it('lues par l\'arbre comme l\'ancienne lecture : `@$x`, commentaire, écriture de contexte, signe dans une chaîne, `&$x`, `=:`', () => {
    commeLAncienne('@$x')
    commeLAncienne('$a /* note */ + 1')
    commeLAncienne('§theme = \'sombre\'')
    commeLAncienne('\'§ 2\' + $x')
    commeLAncienne('&$panier')
    commeLAncienne('$v =: 2')
  })

  it('fragments de JavaScript (liaisons, corps des gestionnaires) : lus par acorn, réécrits sur l\'arbre, sans compilation', () => {
    const fragment = (code: string, gestionnaire = false): { js: string, lus: number } => {
      const lus = expressionCounters.fragments ?? 0
      return { js: gestionnaire ? cleanJsHandler(code, []) : cleanJs(code, ['$Panier']), lus: (expressionCounters.fragments ?? 0) - lus }
    }
    const civet = codeCounters.compilations
    for (const [code, attendu] of [['$form.nom', '$.form.nom'], ['$liste[$i].fait', '$.liste[$.i].fait'], ['$Panier.total + $$prix.ttc', '$Panier.total + µ.store.prix.ttc'], ['§§theme.couleur', '_mjsThis._mjs_getRCtx(\'theme\').couleur'], ['µUrl.path', 'µ.Url.path']]) {
      assert.equal(ancienneLecture('fragment', code), attendu)
      const b = fragment(code)
      assert.equal(b.js, attendu)
      assert.equal(b.lus, 1, `${code} doit être lu par acorn`)
    }
    for (const code of ['$n = $n + 1; $liste.push(\'$n\')', 'if ($a) { $b = `${$c} €` }']) {
      const b = fragment(code, true)
      assert.equal(b.js, ancienneLecture('gestionnaire civet', code))
      assert.equal(b.lus, 1, `${code} doit être lu par acorn`)
    }
    assert.equal(codeCounters.compilations, civet, 'aucune compilation Civet pour un fragment de JavaScript')
    // un gestionnaire du dialecte est lu par Civet (fragmentDuDialecte), même sortie, `({$x})`, un nom hors d'une lecture, compris
    for (const [code, lus] of [['@x', 1], ['$n++ unless $bloque', 1], ['not $ok', 1], ['({$x})', 1], ['µemit \'ok\'', 1], ['$a # note', 1]] as const) {
      const b = fragment(code, true)
      assert.equal(b.js, ancienneLecture('gestionnaire civet', code))
      assert.equal(b.lus, lus, `${code} : ${lus ? 'lu par Civet' : 'revient à l\'ancienne lecture'}`)
    }
    assert.equal(fragment('@x', true).js, 'this.x')
  })

  it('cache par texte : la même expression ne recompile pas', () => {
    const avant = codeCounters.compilations
    lire('$sondeCacheExpression7311 + 1', 'arbre')
    lire('$sondeCacheExpression7311 + 1', 'arbre')
    assert.equal(codeCounters.compilations - avant, 1)
  })

  it('un composant compilé : même sortie que l\'ancienne lecture', async () => {
    const src   = '<script>\n$liste = [1, 2]\n$n = 0\n</script>\n<p class="a {$n > 1 and \'b\'}" title={$n}>{$n * 2} {µlang}</p>\n{if $n is 0}<i>{"vide #{$n}"}</i>{elsif $n > 3}<b>{$liste.length}</b>{end}\n{for x in $liste.filter (v) -> v > $n}<span>{x}</span>{end}\n'
    const arbre = expressionCounters.tree
    const b     = (await transpile(src, { moduleName: 'lecture-expressions-essai' })).output
    assert.ok(expressionCounters.tree > arbre, 'les expressions du composant sont lues par l\'arbre')
    assert.equal(b, COMPOSANTS[src])
  })

  it('fonction abrégée de Civet (`&.x`, `.x`) : son paramètre s\'écrit `$1`, comme l\'ancienne lecture, quand un `$.x` est écrit dedans', () => {
    commeLAncienne('$liste.filter(&.prix > $min)')
    commeLAncienne('$liste.map &.n * $k')
    commeLAncienne('$liste.filter .fait')
    commeLAncienne('$liste.some(&.id is @@courant)')
    commeLAncienne('$$$x + 1')
  })

  it('gestionnaire en Civet : une expression régulière passée en argument sans parenthèses est lue par Civet, son dedans reste tel qu\'écrit', () => {
    const code = '$v = $v.replace /[$x-z]/g, \'\''
    const lus  = expressionCounters.fragments
    const js   = cleanJsHandler(code, [])
    assert.equal(ancienneLecture('gestionnaire civet', code), '$.v = $.v.replace /[$x-z]/g, \'\'')
    assert.equal(js, ancienneLecture('gestionnaire civet', code))
    assert.equal(expressionCounters.fragments - lus, 1)
  })

  it('`isnt` que l\'ancienne lecture laisse en nom (devant `)`, `]`, `}`, `,`, `;`, `:`) : lu sans coffeeIsnt, Civet le garde en nom comme elle', () => {
    for (const expr of ['(isnt)', '($a isnt)', '[1, 2].filter (isnt)', '[$a isnt]', '{k: $a isnt}']) commeLAncienne(expr)
    parLArbre('$l.some (x) -> x isnt $a', '$.l.some(function(x) { return x !== $.a })')
    parLArbre('$a.isnt + $isnt', '$.a.isnt + $.isnt')
  })

  it('chaque écriture que l\'arbre lisait autrement : même sortie ou même message que l\'ancienne lecture', () => {
    const lettre = RESERVED_LETTERS['§']
    // null : lue par l'arbre, même sortie ou même message
    const cas: [string, RegExp | null][] = [
      ['$v := 2', null],
      ['µtoggle $x', null],
      ['µimport(\'a.js\')', null],
      ['mjsimport(\'a.js\')', null],
      [`$x + ${lettre}y`, null],
      ['isnt + 1', null],
      ['((µ) -> µ.a)(1)', null],
      ['$prénom + 1', null],
      ['{a: 1, $b: 2}', null],
      ['[1..µmax]', null],
      ['µlayout = \'x\'', null],
      ['§§x = 1', null],
      ['{µlayout}', null],
      ['$x |>= f', null],
      ['\'$x $$y §z §§w @@v &id µr\'', null],
      ['"#{$x} §y"', null],
      ['`${§x} @@y`', null],
      ['$s.replace(/§|@@|&id/g, \'\')', null],
    ]
    for (const [expr] of cas) commeLAncienne(expr)
  })

  it('signes de MJS, chaînes, gabarits de texte, expressions régulières, `==`, `in` : lus par l\'arbre, sortie de l\'ancienne lecture', () => {
    parLArbre('§x + §§y + @@z + &id + $$s + µt(\'a\')', '_mjsThis._mjs_getContext(\'x\') + _mjsThis._mjs_getRCtx(\'y\') + _mjsThis.z + µ.url.params.id + µ.store.s + µ.t(\'a\')')
    parLArbre('\'$x $$y µr\' + $x', '\'$x $$y µr\' + $.x')
    parLArbre('"a#{$x}b#{$$y}"', '`a${$.x}b${µ.store.y}`')
    parLArbre('/\\$x/.test($s)', '/\\$x/.test($.s)')
    parLArbre('$a == $b and $c != $d', '$.a === $.b && $.c !== $.d')
    parLArbre('$x not in $l', '!($.x in $.l)')
  })

  it('gestionnaires : signes de MJS lus par acorn en JavaScript, chaque raison de les lire autrement', () => {
    const lu = (code: string, _gabarit: 'civet' | 'js'): { js: string, lus: number, relus: number, raison: string } => {
      const lus   = expressionCounters.fragments
      const relus = expressionCounters.reread
      let js: string
      try {
        js = cleanJsHandler(code, [], undefined, code)
      }
      catch (e) {
        js = `erreur : ${(e as Error).message}`
      }
      return { js, lus: expressionCounters.fragments - lus, relus: expressionCounters.reread - relus, raison: expressionCounters.last }
    }
    for (const code of ['$n++; $liste.push(\'§x @@y &id\')', 'µemit(\'ok\', §§t)', 'if (&id) { $a = @@b }', '$s = $s.replace(/\\$x/g, \'\')', '$a = $b == 1 ? $$c : µd']) {
      const b = lu(code, 'civet')
      assert.equal(b.js, ancienneLecture('gestionnaire js', code), code)
      assert.equal(b.lus, 1, `${code} doit être lu par acorn`)
    }
    // une vraie faute (`$a = is`, `$a. $b`) : rendue par acorn, puis illisible pour Civet (voie du dialecte), refusée par l'erreur de
    // Civet sur le texte écrit (`refus`)
    const cas: [string, 'civet' | 'js', RegExp, number?, boolean?][] = [
      ['$v =: 2', 'civet', /réécrite avant Civet/],
      ['µtoggle $x', 'civet', /rune réécrite/],
      [`$x = '${RESERVED_LETTERS['§']}'`, 'civet', /lettre de déguisement écrite/],
      ['$a = is', 'civet', /mot que l'ancienne lecture traduisait/, 2, true],
      ['$a. $b', 'civet', /propriété écrite sans point/, 2, true],
      ['§theme = \'x\'', 'civet', /écriture de contexte/],
    ]
    for (const [code, gabarit, raison, relus = 1, refus = false] of cas) {
      const vues = new Map(expressionCounters.reasons)
      const b    = lu(code, gabarit)
      if (refus) assert.match(b.js, /^erreur : .*handler inline : échec de compilation Civet(?![\s\S]*\$\.a)/s, code)
      else assert.equal(b.js, ancienneLecture(`gestionnaire ${gabarit}`, code), code)
      assert.equal(b.relus, relus, `${code} : lectures refusées`)
      assert.ok([...expressionCounters.reasons].some(([r, n]) => raison.test(r) && n > (vues.get(r) ?? 0)), `${code} : ${b.raison}`)
    }
  })

  it('un composant par langage de script (Civet, CoffeeScript, js, ts), et un gabarit `js` : même sortie que l\'ancienne lecture', async () => {
    const gabarit    = '<p class="a {$n > 1 and \'b\'}" title={$n}>{$n * 2} {µlang} {&id} {§§theme} {@@total} {\'$x §y @@z &id\'} {/\\$x/.test($s)}</p>\n{if $n isnt 0}<i>{"n #{$n}"}</i>{end}\n<button @click={-> $n++}>+</button>\n'
    const composants: [string, Record<string, unknown>][] = [
      [`<script>\n$n = 1\n$s = 'a'\ntotal = 3\n</script>\n${gabarit}`, {}],
      [`<script lang="coffee">\n$n = 1\n$s = 'a'\n@total = 3\n</script>\n${gabarit}`, {}],
      [`<script lang="js">\n$n = 1\n$s = 'a'\nconst total = 3\n</script>\n${gabarit}`, {}],
      [`<script lang="ts">\n$n = 1\n$s = 'a'\nconst total: number = 3\n</script>\n${gabarit}`, {}],
    ]
    for (const [src, options] of composants) {
      const lus = expressionCounters.tree + expressionCounters.fragments
      const r   = await transpile(src, { moduleName: 'lecture-des-langues', devWarnings: false, ...options })
      const b   = `${r.output}\n--- carte\n${r.sourceMap ?? ''}`
      assert.ok(expressionCounters.tree + expressionCounters.fragments > lus, `gabarit lu par l'arbre : ${src}`)
      assert.equal(b, COMPOSANTS[src], src)
    }
  })

  it('ce que l\'ancienne lecture prenait pour du texte, l\'arbre le lit en code : expression régulière qui contient `}`, `{`, un guillemet ou un accent grave dans le `${…}` d\'un gabarit de texte, chaîne à trois guillemets', () => {
    const cas: [string, string][] = [
      ['`${ $s.replace(/}/g, $t) }`', '`${ $.s.replace(/}/g, $.t) }`'],
      ['`${ $s.replace(/{/g, \'\') } ${$t}`', '`${ $.s.replace(/{/g, \'\') } ${$.t}`'],
      ['`${ $s.replace(/\'/g, \'\') }` + $t', '`${ $.s.replace(/\'/g, \'\') }` + $.t'],
      ['`${ $s.replace(/"/g, $t) }`', '`${ $.s.replace(/"/g, $.t) }`'],
      ['\'\'\'it\'s\'\'\' + $a', '`it\'s` + $.a'],
    ]
    for (const [expr, attendu] of cas) {
      assert.equal(lire(expr, 'arbre').js, attendu, expr)
      assert.notEqual(lire(expr, 'ancienne').js, attendu, `${expr} : l'ancienne lecture le refusait ou y laissait un nom sans le réécrire`)
    }
    assert.equal(cleanJsHandler('$s = `${ $s.replace(/}/g, $t) }`', []), '$.s = `${ $.s.replace(/}/g, $.t) }`')
  })

  it('l\'arbre seul : sans réglage, la compilation lit ses expressions et ses gestionnaires par l\'arbre ; le réglage de l\'ancienne lecture des fragments (MJS_LECTURE_FRAGMENTS) est retiré, sans effet', function () {
    this.timeout(60000)
    const module = (chemin: string): string => JSON.stringify(new URL(chemin, import.meta.url).href)
    const sonde  = `const e = await import(${module('../src/reader/expression.ts')}); const { transpile } = await import(${module('../src/transpiler/index.ts')}); await transpile('<p>{$n + 1}</p>\\n<button @click={$n = $n + 1}>+</button>\\n', { moduleName: 'sonde' }); process.stdout.write(JSON.stringify({ reglage: typeof e.lectureDesFragments, arbre: e.expressionCounters.tree, fragments: e.expressionCounters.fragments }))`
    const lue    = (valeur?: string): { reglage: string, arbre: number, fragments: number } => {
      const env = { ...process.env }
      delete env.MJS_LECTURE_FRAGMENTS
      if (valeur !== undefined) env.MJS_LECTURE_FRAGMENTS = valeur
      return JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', sonde], { env, encoding: 'utf-8' }))
    }
    for (const valeur of [undefined, 'ancienne']) {
      const lu = lue(valeur)
      assert.equal(lu.reglage, 'undefined', `réglage retiré (MJS_LECTURE_FRAGMENTS=${valeur ?? ''})`)
      assert.ok(lu.arbre > 0, `expressions du gabarit lues par l'arbre (MJS_LECTURE_FRAGMENTS=${valeur ?? ''})`)
      assert.ok(lu.fragments > 0, `gestionnaire de JavaScript lu par acorn (MJS_LECTURE_FRAGMENTS=${valeur ?? ''})`)
    }
  })
})
