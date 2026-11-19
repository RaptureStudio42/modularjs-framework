// `µafter (d), fn`, `µevery (d), fn` et `µtoggle ($x), 'a'` : une espace avant la parenthèse, puis une virgule juste après la
// parenthèse fermante. Civet et CoffeeScript lisent cette virgule comme un séparateur des arguments de la rune (`µafter((d), fn)`) ;
// le compilateur lisait la parenthèse comme celle de l'appel (`µafter(d), fn`) : la fonction sortait de l'appel, sans un mot. La
// forme se lit de deux façons : la construction la refuse, dans le <script> en Civet et en CoffeeScript comme dans un gestionnaire
// du gabarit, avec sa ligne et les deux écritures sans doute. Toute autre forme garde sa lecture, citée ici telle que le compilateur
// la sort : la parenthèse suivie d'autre chose qu'une virgule (`.then`, `and`, `if`, un calcul), la parenthèse seule, collée, sans
// parenthèse, les deux arguments dans la parenthèse ; une chaîne, un commentaire, une regex qui citent la forme ; un script en
// JavaScript ou en TypeScript.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

// le <script> d'un composant : la première ligne essayée tombe à la ligne 6 du fichier
const script = (lang: string, lignes: string[]) => `<p>{$a}</p>\n<script${lang ? ` lang="${lang}"` : ''}>\n$a = ''\nd = 20\ngo = ->\n${lignes.map(l => '  ' + l).join('\n')}\n  null\n</script>\n`
// un gestionnaire du gabarit, écrit à la ligne 2
const gestionnaire = (code: string) => `<p>{$a}</p>\n<button @click={-> ${code}}>b</button>\n<script>\n$a = ''\nd = 20\n</script>\n`
// un script en JavaScript ou en TypeScript, et son gestionnaire
const js = (lang: string, code: string, gabarit = '<p>{$a}</p>') => `${gabarit}\n<script lang="${lang}">\n$a = '';\nconst d = 20;\nconst go = () => {\n  ${code}\n};\n</script>\n`

const compiler = (source: string) => transpile(source, { moduleName: 'essai', devWarnings: true })

// nom, source, rune, ligne citée, dans un gestionnaire
const REFUSEES: [string, string, string, number, boolean][] = [
  ['µafter (d), fn', script('', ['µafter (d), -> $a = 1']), 'µafter', 6, false],
  ['une espace avant la virgule', script('', ['µafter (d) , -> $a = 1']), 'µafter', 6, false],
  ['[µafter (d), p]', script('', ["Promise.race [µafter (d), fetch('/x')]"]), 'µafter', 6, false],
  ['f(µafter (d), x)', script('', ['console.log(µafter (d), 1)']), 'µafter', 6, false],
  ['{ t: µafter (d), n: 1 }', script('', ['o = { t: µafter (d), n: 1 }']), 'µafter', 6, false],
  ['une chaîne dans la parenthèse', script('', ["µafter (parseInt(')5')), -> $a = 1"]), 'µafter', 6, false],
  ['sur plusieurs lignes', script('', ['µafter (', '    d', '  ), -> $a = 1']), 'µafter', 6, false],
  ['µevery (d), options, fn', script('', ['µevery (d), times: 2, -> $a = 1']), 'µevery', 6, false],
  ["µtoggle ($a), 'x'", script('', ["µtoggle ($a), 'x'"]), 'µtoggle', 6, false],
  ['f(µtoggle ($a), 1)', script('', ['console.log(µtoggle ($a), 1)']), 'µtoggle', 6, false],
  ['CoffeeScript : µafter (d), fn', script('coffee', ['µafter (d), -> $a = 1']), 'µafter', 6, false],
  ['CoffeeScript : [µafter (d), p]', script('coffee', ["Promise.race [µafter (d), fetch('/x')]"]), 'µafter', 6, false],
  ['gestionnaire : µafter (d), fn', gestionnaire('µafter (d), -> $a = 1'), 'µafter', 2, true],
  ['gestionnaire : [µafter (d), p]', gestionnaire("Promise.race [µafter (d), fetch('/x')]"), 'µafter', 2, true]
]

// nom, source, morceaux de la sortie (la lecture d'avant), texte absent de la sortie
const GARDEES: [string, string, string[], string?][] = [
  ['µafter(d, fn), collée', script('', ['µafter(d, -> $a = 1)']), ['µ.after(_mjsThis, d, function()']],
  ['µafter d, fn, sans parenthèse', script('', ['µafter d, -> $a = 1']), ['µ.after(_mjsThis, d, function()']],
  ['await µafter (d), seule', script('', ['await µafter (d)']), ['await µ.after(_mjsThis, d)']],
  ['µafter (d, fn), les deux dans la parenthèse', script('', ['µafter (d, -> $a = 1)']), ['µ.after(_mjsThis, d, function()']],
  ['µafter (d + 1) * 2, fn, un calcul après la parenthèse', script('', ['µafter (d + 1) * 2, -> $a = 1']), ['µ.after(_mjsThis, d + 1) * 2,( function()']],
  ['µafter (d).then(fn)', script('', ['µafter (d).then(-> $a = 1)']), ['µ.after(_mjsThis, d).then(function()']],
  ['µafter (d) if …', script('', ['µafter (d) if $a']), ['if ($.a) { µ.after(_mjsThis, d) }']],
  ['µafter (d) and …', script('', ['µafter (d) and $a = 1']), ['µ.after(_mjsThis, d) && (']],
  ['return µafter (d)', script('', ['return µafter (d)']), ['return µ.after(_mjsThis, d)']],
  ['µtoggle ($a), seule', script('', ['µtoggle ($a)']), ["µ._set(_mjsThis, 'a', !$.a)"]],
  ['chaînes', script('', ["s = 'µafter (d), x'", 't = "µafter (d), #{d}"', 'u = """', '    µafter (d), x', '  """', 'v = `µafter (d), ${d}`']), ["let s = 'µafter (d), x'", 'let t = `µafter (d), ${d}`', 'let u = `µafter (d), x`']],
  ['commentaires', script('', ['# µafter (d), x', '/* µafter (d), x */', 'x = 1 // µafter (d), x']), [], 'µ.after('],
  ['regex', script('', ['re = /µafter (\\d+), x/']), ['let re = /µafter (\\d+), x/']],
  ['CoffeeScript : µafter (d).then(fn)', script('coffee', ['µafter (d).then(-> $a = 1)']), ['µ.after(_mjsThis, d).then(function()']],
  ['CoffeeScript : chaînes, heregex, commentaire', script('coffee', ["s = '''µafter (d), x'''", 't = "#{d} µafter (d), x"', 'r = ///µafter (d), x///', '### µafter (d), x ###', 'j = `µafter (d), 1`']), ['s = `µafter (d), x`;', 't = `${d} µafter (d), x`;', 'r = /µafter(d),x/;']],
  ['gestionnaire : µafter (d).then fn', gestionnaire('µafter (d).then -> $a = 1'), ['return () => µ.after(_mjsThis, d).then(() =>']],
  ['gestionnaire : une chaîne', gestionnaire("$a = 'µafter (d), x'"), ["('µafter (d), x')"]],
  ['JavaScript : µafter (d), fn', js('js', 'µafter (d), () => 1;'), ['µ.after(_mjsThis, d), () => 1;']],
  ['JavaScript : µafter (d).then(fn)', js('js', 'µafter (d).then(() => 1);'), ['µ.after(_mjsThis, d).then(() => 1);']],
  ['JavaScript : [µafter (d), p]', js('js', 'Promise.race([µafter (d), 1]);'), ['Promise.race([µ.after(_mjsThis, d), 1]);']],
  ['JavaScript : gestionnaire', js('js', 'null;', '<p>{$a}</p><button @click={() => µafter (d).then(() => 1)}>b</button>'), ['return () => µ.after(_mjsThis, d).then(() => 1)']],
  ['TypeScript : µafter (d).then(fn)', js('ts', 'µafter (d).then((): number => 1);'), ['µ.after(_mjsThis, d).then(() => 1);']]
]

describe('µafter, µevery, µtoggle : une espace avant la parenthèse puis une virgule, refusée ; toute autre forme lue comme avant', function () {
  this.timeout(60000)

  for (const [nom, source, rune, ligne, dansGestionnaire] of REFUSEES) {
    it(`refusée : ${nom}`, async () => {
      await assert.rejects(compiler(source), (e: any) => {
        const message = String(e?.message ?? e)
        assert.ok(message.includes(`${rune} (…), …`), message)
        assert.match(message, new RegExp(`(?:ligne|line) ${ligne}\\b`), message)
        assert.equal(/gestionnaire d'événement|event handler/.test(message), dansGestionnaire, message)
        const ecritures = rune === 'µtoggle' ? ["µtoggle($x, 'a')", 'µtoggle($x), …'] : [`${rune}(d, fn)`, `${rune} d, fn`, `${rune}(d), …`]
        for (const ecriture of ecritures) assert.ok(message.includes(ecriture), `« ${ecriture} » attendu dans : ${message}`)
        return true
      })
    })
  }

  for (const [nom, source, morceaux, absent] of GARDEES) {
    it(`lue comme avant : ${nom}`, async () => {
      const sortie = String((await compiler(source)).output)
      const lignes = sortie.split('\n').filter(l => /after|µ\.|µafter|let [stuv] =|^\s*[str] =/.test(l)).join('\n')
      for (const morceau of morceaux) assert.ok(sortie.includes(morceau), `« ${morceau} » attendu dans :\n${lignes}`)
      if (absent) assert.ok(!sortie.includes(absent), `« ${absent} » inattendu dans :\n${lignes}`)
    })
  }
})
