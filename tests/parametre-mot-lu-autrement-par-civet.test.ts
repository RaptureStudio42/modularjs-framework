// un paramètre nommé `readonly` (mot réservé de TypeScript) : Civet ne le refuse pas, il lit `(t, readonly) -> t` comme
// l'appel `(t, readonly)(function() { return t })` — construction verte, composant mort au montage (« t is not defined »).
// Même lecture silencieuse pour `loop` (une boucle sans fin), `undefined` (une affectation de `undefined`) et les mots de
// Civet `until`, `unless`, `not`, `is`, `and`, `or` dans une décomposition. La construction s'arrête sur un message qui
// nomme le paramètre et la ligne du fichier ; le même mot dans une chaîne, un commentaire, une clé, une propriété, un champ
// de classe, un attribut du gabarit ou un appel voulu (`(readonly)(1)`) ne déclenche rien

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { getAdapter } from '../src/languages/index.js'
import { parametreLuAutrement } from '../src/languages/civet-parametres.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { compileServerFile } from '../src/cli/server-entry.js'
import { ligneDuManifeste } from '../src/bundler/index.js'

const composant = (script: string) => `<script>\n$n = 0\n${script}\n</script>\n<p>{$n}</p>\n`
const avecModule = (module: string) => `<script module>\nzz = 1\n${module}\n</script>\n<script>\n$n = 0\n</script>\n<p>{$n}</p>\n`

async function refuse(source: string, nom: string, ligne: number) {
  await assert.rejects(transpile(source, { moduleName: 'mot-lu' }), (e: any) => {
    assert.match(e.message, new RegExp(`le paramètre « ${nom} »`), e.message)
    assert.match(e.message, new RegExp(`mot-lu\\.mjs:${ligne}:\\d+`), e.message)
    assert.match(e.message, /Renommez le paramètre\./, e.message)
    return true
  })
}

describe('paramètre que Civet lit autrement, sans erreur', function () {
  this.timeout(30000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('readonly dans une méthode, seul, en premier, avec un défaut, sous une flèche grasse', async () => {
    await refuse(composant('@show = (t, readonly) -> t'), 'readonly', 3)
    await refuse(composant('f = (readonly) -> 1'), 'readonly', 3)
    await refuse(composant('g = (readonly, t) => t'), 'readonly', 3)
    await refuse(composant('h = (readonly = false) -> 1'), 'readonly', 3)
  })

  it('readonly dans une fonction du <script>, un rappel, une fonction async, un paramètre typé ou facultatif, plus bas dans le bloc', async () => {
    await refuse(composant('liste = [1].map (t, readonly) -> t'), 'readonly', 3)
    await refuse(composant('p = async (t, readonly) -> t'), 'readonly', 3)
    await refuse(composant('q = (t, readonly: boolean) -> t'), 'readonly', 3)
    await refuse(composant('o = (t, readonly?) -> t'), 'readonly', 3)
    await refuse(composant('a = 1\nb = 2\n@show = (t, readonly) -> t'), 'readonly', 5)
  })

  it('readonly dans un <script module>', async () => {
    await refuse(avecModule('f = (t, readonly) -> t'), 'readonly', 3)
  })

  it('readonly dans un module .civet partagé (même adaptateur que les modules importés)', async () => {
    await assert.rejects(getAdapter('civet').compileToJs('x = 1\nf = (t, readonly) -> t\n', { fileName: 'partage.civet.mjs' }), (e: any) => {
      assert.match(e.message, /partage\.civet\.mjs:2:\d+ : le paramètre « readonly »/, e.message)
      return true
    })
  })

  it('loop (boucle sans fin, typé, décomposé), undefined (nu, avec un défaut, en reste, dans un tableau), mots de Civet décomposés ou typés', async () => {
    await refuse(composant('@jouer = (son, loop) -> son'), 'loop', 3)
    await refuse(composant('f = (loop) -> 1'), 'loop', 3)
    await refuse(composant('@jouer = (son, loop: boolean) -> son'), 'loop', 3)
    await refuse(composant('k = ({loop}) -> loop'), 'loop', 3)
    await refuse(composant('f = (fenetre, undefined) -> fenetre'), 'undefined', 3)
    await refuse(composant('h = (fenetre, undefined = 0) -> fenetre'), 'undefined', 3)
    await refuse(composant('n = (t, ...undefined) -> t'), 'undefined', 3)
    await refuse(composant('k2 = ([undefined]) -> 1'), 'undefined', 3)
    await refuse(composant('k = ({unless}) -> 1'), 'unless', 3)
    await refuse(composant('q = (t, not: number) -> t'), 'not', 3)
  })

  it('aucun refus : le mot dans une chaîne, un commentaire, une regex, une clé, une propriété, un champ, le gabarit', async () => {
    const script = [
      "s = 'readonly'",
      'r = "(t, readonly) -> t"',
      '# (t, readonly) -> t',
      '### (t, readonly) -> t ###',
      're = /\\(t, readonly\\) ->/',
      'o = { readonly: true, loop: 1, undefined: 2 }',
      'o.readonly = false',
      'v = o.readonly',
      '@readonly = true',
      'class A',
      '  readonly x = 1',
      '  constructor(readonly y: number)',
      '    @z = y',
      'ro = outils.readonly(o)',
    ].join('\n')
    const source = `<script>\n$n = 0\n${script}\n</script>\n<input readonly aria-label="a"><input readonly={$n > 0} aria-label="b">\n`
    const r      = await transpile(source, { moduleName: 'mot-lu' })
    assert.match(r.output, /readonly/)
  })

  it('aucun refus : readonly lu comme un nom (décomposition, reste, appel), autres mots de TypeScript, appel voulu d\'une expression entre parenthèses', async () => {
    for (const script of ['k = ({readonly}) -> readonly', 'k2 = ([readonly]) -> 1', 'n = (t, ...readonly) -> t', 'ro = readonly(objet)\nx = readonly', 'f = (t, type, declare, module, abstract, override, namespace, infer, keyof, unique, asserts, satisfies, accessor) -> t', 'pick = (a) -> a\nh = (pick or null) -> 1', 'h2 = (if $n then Math.max else Math.min) -> 1']) {
      await transpile(composant(script), { moduleName: 'mot-lu' })
    }
  })

  it('aucun refus : appel voulu d\'une fonction nommée readonly, entre parenthèses, sans fonction pour argument', async () => {
    for (const script of ['readonly = (v) -> v + 1\nx = (readonly)(1)', 'readonly = (v) -> v + 1\nx = (readonly) 1', 'a = 1\nreadonly = (v) -> v\nx = (a, readonly)(2)', 'readonly = (v) -> v\nx = (readonly)?(1)', 'a = 1\nreadonly = (v) -> v\nl = [(a, readonly)(1)]']) {
      await transpile(composant(script), { moduleName: 'mot-lu' })
    }
    await transpile('<button @click={$n = (readonly)(1)}>x</button>\n<script>\n$n = 0\nreadonly = (v) -> v\n</script>\n', { moduleName: 'mot-lu' })
  })

  it('gestionnaire du gabarit : refusé à la ligne du .mjs de sa balise', async () => {
    const source = '<p>a</p>\n<p>b</p>\n<p>c</p>\n<p>d</p>\n<p>{$n}</p>\n<button @click={(e, readonly) -> $n = 1}>x</button>\n<script>\n$n = 0\n</script>\n'
    await assert.rejects(transpile(source, { moduleName: 'bouton' }), (e: any) => {
      assert.match(e.message, /bouton\.mjs:6 : le paramètre « readonly »/, e.message)
      return true
    })
  })

  it('module .civet qui commence par un @import : refusé à la ligne du fichier', async () => {
    const racine = mjsTmp('parametre-lu-autrement')
    const sources = join(racine, 'src')
    mkdirSync(sources, { recursive: true })
    writeFileSync(join(sources, 'b.module.civet.mjs'), "export hi = -> 'B'\n")
    writeFileSync(join(sources, 'a.module.civet.mjs'), "@import hi 'b.module.civet.mjs'\n\nx = 1\nexport f = (t, readonly) -> t\n")
    const bundler = new Bundler({ sourceDir: sources, outputDir: join(racine, 'out'), manifestPath: join(racine, 'bundle.js'), urlPrefix: '/out' })
    const stats   = await bundler.compile()
    await bundler.close()
    const messages = stats.errors.map((e: any) => e.message).join('\n')
    assert.match(messages, /a\.module\.civet\.mjs:4:\d+ : le paramètre « readonly »/, messages)
  })

  it('une très longue chaîne : le contrôle se tait, il ne lève jamais', () => {
    for (const n of [3000, 6000, 12000, 25000]) {
      const js = "s = 'readonly'\nx = " + Array(n).fill('a').join(' + ') + '\n'
      assert.doesNotThrow(() => parametreLuAutrement(js, () => null), `chaîne de ${n} termes`)
    }
  })

  it('aucun refus : appel voulu entre parenthèses dans un corps de fonction, l\'argument à la ligne suivante', async () => {
    const lit = 'readonly = (v) -> v + 1\n'
    for (const script of [
      lit + 'g = ->\n  (readonly)(\n    1\n  )\nx = g()',
      lit + 'function k()\n  (readonly)(\n    2)\nx = k()',
      lit + 'class A\n  m()\n    (readonly)(\n      3)\nx = (new A).m()',
      'a = 1\n' + lit + 'g = ->\n  (a, readonly)(\n    4)\nx = g()',
      lit + 'g = =>\n  (readonly)(\n    5)\nx = g()',
      lit + 'g = ->\n  return (readonly)(\n    7)\nx = g()',
      lit + 'g = -> (readonly)(\n  9)\nx = g()',
    ]) {
      await transpile(composant(script), { moduleName: 'mot-lu' })
    }
  })

  it('expressions du gabarit : refusées à la ligne du .mjs, sans refus pour l\'attribut readonly, le texte ou un appel voulu', async () => {
    const tete = '<script>\n$n = 0\n$l = [1]\n</script>\n'
    for (const [gabarit, nom] of [['<p>{[1].map((son, loop) -> son)}</p>', 'loop'], ['<p>{$l.map((x, readonly) -> x)}</p>', 'readonly'], ['<p title={((w, undefined) -> w)(1)}>a</p>', 'undefined']]) {
      await assert.rejects(transpile(`${tete}<div>\n${gabarit}\n</div>\n`, { moduleName: 'mot-lu' }), (e: any) => {
        assert.match(e.message, new RegExp(`mot-lu\\.mjs:6 : le paramètre « ${nom} »`), e.message)
        return true
      })
    }
    const r = await transpile('<script>\n$n = 0\nreadonly = (v) -> v\no = { readonly: 1 }\n</script>\n<input readonly aria-label="a"><input readonly={true} aria-label="b">\n<p>readonly (t, readonly) -> t</p>\n<p>{o.readonly} {(readonly)(1)} {$n}</p>\n', { moduleName: 'mot-lu' })
    assert.match(r.output, /readonly/)
  })

  it('entrée serveur qui commence par un ou deux @import : refusée à la ligne du fichier', async () => {
    const racine = mjsTmp('entree-serveur-lu-autrement')
    writeFileSync(join(racine, 'b.civet.mjs'), 'export hi = -> 1\n')
    writeFileSync(join(racine, 'c.civet.mjs'), 'export ho = -> 2\n')
    writeFileSync(join(racine, 'un.civet.mjs'), "@import hi './b.civet.mjs'\n\nx = 1\nf = (t, readonly) -> t\n")
    writeFileSync(join(racine, 'deux.civet.mjs'), "@import hi './b.civet.mjs'\n@import ho './c.civet.mjs'\nx = 1\nf = (t, readonly) -> t\n")
    for (const nom of ['un.civet.mjs', 'deux.civet.mjs']) {
      await assert.rejects(compileServerFile(join(racine, nom), racine), (e: any) => {
        assert.match(e.message, new RegExp(`${nom}:4:\\d+ : le paramètre « readonly »`), e.message)
        return true
      })
    }
  })

  it('manifeste : la ligne du fichier, directives #= require et lignes vides de tête retirées du texte compilé', () => {
    const contenu = '#= require a\n\n#= require_tree ./b\nx = 1\nf = (t, readonly) -> t\n'
    assert.equal(ligneDuManifeste(contenu, 1), 4)
    assert.equal(ligneDuManifeste(contenu, 2), 5)
    assert.equal(ligneDuManifeste('x = 1\n#= require a\nf = (t, readonly) -> t\n', 2), 3)
  })

  it('expression du gabarit : la ligne de l\'expression, pas celle d\'un commentaire, d\'un texte ou d\'un <pre> qui la recopient', async () => {
    const tete = '<script>\n$n = 0\n$l = [1]\n</script>\n'
    for (const [gabarit, ligne] of [
      ['<!-- {$l.map((x, readonly) -> x)} -->\n<p>b</p>\n<p>{$l.map((x, readonly) -> x)}</p>', 7],
      ['<p>Exemple : [1].map((x, readonly) -> x)</p>\n<p>{[1].map((x, readonly) -> x)}</p>', 6],
      ['<pre><code>$l.map((x, readonly) -> x)</code></pre>\n<p>{$l.map((x, readonly) -> x)}</p>', 6],
    ] as [string, number][]) {
      await assert.rejects(transpile(`${tete}${gabarit}\n`, { moduleName: 'mot-lu' }), (e: any) => {
        assert.match(e.message, new RegExp(`mot-lu\\.mjs:${ligne} : le paramètre « readonly »`), e.message)
        return true
      })
    }
  })

  it('expression d\'un partiel inclus : le message le dit, sans citer une ligne de l\'hôte', async () => {
    for (const hote of ['<p>a</p>\n<@include part>\n', '<p>Exemple : $l.map((x, readonly) -> x)</p>\n<@include part>\n']) {
      const racine  = mjsTmp('partiel-lu-autrement')
      const sources = join(racine, 'src')
      mkdirSync(sources, { recursive: true })
      writeFileSync(join(sources, 'x-part.mjs'), `<script>\n$n = 0\n$l = [1]\n</script>\n${hote}`)
      writeFileSync(join(sources, '_part.mjs'), '<p>b</p>\n<p>{$l.map((x, readonly) -> x)}</p>\n')
      const bundler  = new Bundler({ sourceDir: sources, outputDir: join(racine, 'out'), manifestPath: join(racine, 'bundle.js'), urlPrefix: '/out' })
      const stats    = await bundler.compile()
      await bundler.close()
      const messages = stats.errors.map((e: any) => e.message).join('\n')
      assert.match(messages, /x-part\.mjs \(dans un partiel inclus\) : le paramètre « readonly »/, messages)
    }
  })

  it('CoffeeScript : (t, readonly) -> reste une fonction, sans refus', async () => {
    const r = await transpile('<script lang="coffee">\n$n = 0\n@show = (t, readonly) -> t\n</script>\n<p>{$n}</p>\n', { moduleName: 'mot-lu' })
    assert.match(r.output, /function\s*\(t, readonly\)/)
  })
})
