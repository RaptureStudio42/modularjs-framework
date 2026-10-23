// une fonction que le <script> appelle avec new (ou avec un autre this : call, apply, bind) pose ses
// propriétés sur l'objet construit, pas sur la balise du composant : « @addEventListener = … » dedans
// n'est pas refusé ; appelée nue, ou avec le composant lui-même (f.call @), elle écrit sur la balise :
// refusée comme avant

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

// le <script> compilé en silence (le coffee avertit qu'il est déprécié)
async function compile(lang: string, script: string): Promise<void> {
  const orig = console.warn
  console.warn = () => {}
  try { await transpile(`<script lang="${lang}">\n${script}\n</script>\n<p>x</p>\n`, { moduleName: 'carte' }) } finally { console.warn = orig }
}

const refus = (nom: string) => (e: Error) => e.message.includes(`@${nom} = …`) && e.message.includes(`${nom}()`) && e.message.includes('Renommez')

describe('<script> — une fonction construite avec new n\'écrit pas sur la balise du composant', () => {
  const F = '(n, v) -> 1'
  const libres: Array<[string, string, string]> = [
    ['civet', 'une fonction fléchée, puis new', 'Fake .= (url) ->\n  @addEventListener = -> url\n  return\nf := new Fake 1'],
    ['civet', 'function Emitter() puis new', 'function Emitter()\n  @dispatchEvent = -> 1\n  return\ne := new Emitter'],
    ['civet', 'function à accolades avec this', 'function Emitter() { this.dispatchEvent = function() { return 1 } }\ne := new Emitter()'],
    ['js', 'function Emitter() puis new', 'function Emitter() { this.dispatchEvent = function() { return 1 } }\nvar e = new Emitter()'],
    ['coffee', 'Emitter = -> puis new', 'Emitter = ->\n  @querySelector = -> 1\n  return\nnew Emitter'],
    ['civet', 'f.call(autre objet)', `init .= ->\n  @setAttribute = ${F}\n  return\nobj := {}\ninit.call obj`],
    ['civet', 'f.apply(autre objet)', `init .= ->\n  @setAttribute = ${F}\n  return\nobj := {}\ninit.apply obj, []`],
    ['civet', 'f.bind(autre objet)', `init .= ->\n  @setAttribute = ${F}\n  return\nobj := {}\ng := init.bind obj`],
    ['civet', 'une méthode du composant construite par new @Emitter', '@Emitter = (url) ->\n  @addEventListener = -> url\n  return\ne := new @Emitter 1'],
  ]
  for (const [lang, nom, script] of libres) {
    it(`${lang} : ${nom} : compile`, async () => {
      await compile(lang, script)
    })
  }
})

describe('<script> — ce qui écrit vraiment sur la balise reste refusé', () => {
  const F = '(n, v) -> 1'
  const refusees: Array<[string, string, string]> = [
    ['civet', 'une fonction appelée nue', `brancher = ->\n  @setAttribute = ${F}\nbrancher()`],
    ['coffee', 'une fonction appelée nue', `brancher = ->\n  @setAttribute = ${F}\nbrancher()`],
    ['civet', 'f.call @ : le composant lui-même', `init .= ->\n  @setAttribute = ${F}\n  return\ninit.call @`],
    ['civet', 'une autre fonction construite ne couvre pas celle-ci', `Fake .= ->\n  return\nf := new Fake()\nbrancher = ->\n  @setAttribute = ${F}\nbrancher()`],
    ['civet', 'en tête du <script>, malgré un new ailleurs', `Fake .= ->\n  return\nf := new Fake()\n@setAttribute = ${F}`],
  ]
  for (const [lang, nom, script] of refusees) {
    it(`${lang} : ${nom} : refusé comme @setAttribute = f`, async () => {
      await assert.rejects(compile(lang, script), refus('setAttribute'))
    })
  }
})
