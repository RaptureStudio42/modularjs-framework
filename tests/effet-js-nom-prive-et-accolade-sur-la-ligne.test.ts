// `<script lang="js">` (et "ts") : un nom privé de classe suivi d'une accolade sur sa ligne (`get n() { return this.#n }`,
// `#n = 1; get n() { … }`, `#n in o`) ne fait plus refuser le µeffect écrit après la classe (le `#` était lu comme un
// commentaire, l'accolade qui suit perdue) ; un µeffect écrit dans une méthode reste refusé

import assert from 'node:assert/strict'
import { lintEffectTopLevel } from '../src/transpiler/lint.js'

const lu = (src: string, lang: string): string => {
  try {
    lintEffectTopLevel(src, false, 2, lang)
    return 'accepté'
  }
  catch (e: any) {
    return 'refusé : ' + String(e?.message ?? e).slice(0, 120)
  }
}

describe('µeffect après une classe à noms privés, en JavaScript et en TypeScript', () => {
  const acceptes: Array<[string, string, string]> = [
    ['js', 'getter sur une ligne', 'class A {\n  #n = 1\n  get n() { return this.#n }\n}\nµeffect(() => { console.log($n) })'],
    ['js', 'champ sur la ligne de la classe', 'class A { #n = 1; get n() { return 1 } }\nµeffect(() => { console.log($n) })'],
    ['js', 'méthode privée', 'class A {\n  #calc() { return 1 }\n  v() { return this.#calc() }\n}\nµeffect(() => { console.log($n) })'],
    ['js', '#n in o', 'class A {\n  #n = 1\n  static est(o) { return #n in o }\n}\nµeffect(() => { console.log($n) })'],
    ['ts', 'getter typé sur une ligne', 'class A {\n  #n: number = 1\n  get n(): number { return this.#n }\n}\nµeffect(() => { console.log($n) })']
  ]
  for (const [lang, nom, src] of acceptes) {
    it(`${lang} — ${nom} : le µeffect de racine est accepté`, () => {
      assert.equal(lu(src, lang), 'accepté')
    })
  }

  it('js — µeffect dans une méthode : refusé', () => {
    assert.match(lu('class A {\n  #n = 1\n  m() { µeffect(() => { console.log(this.#n) }) }\n}', 'js'), /^refusé/)
  })
})
