// découpage d'une balise ouverte (lints a11y et <form>) : une accolade jamais refermée n'empoisonne pas la lecture
// des balises suivantes, un `/*` jamais refermé ne coûte pas un parcours du texte par commentaire, une pile de
// `${` imbriqués ne fait pas de dépassement de pile, et `i++ / 2` est une division, pas un littéral regex

import assert from 'node:assert/strict'
import { tagReader } from '../src/transpiler/tag-reader.js'
import { checkA11y } from '../src/transpiler/a11y.js'
import { checkUjsForm } from '../src/transpiler/ujs-form.js'

// lecture de référence, sans aucun mémo : chaque appel repart de zéro
const AVANT = '(,=:[!&|?{};+-*%<>~^'

function reference(s: string) {
  const chaine = (d: number): number => {
    const q = s[d]
    for (let i = d + 1; i < s.length; i++) {
      if (s[i] === '\\') i++
      else if (s[i] === q) return i
      else if (s[i] === '\n') return -1
    }
    return -1
  }
  const regex = (d: number): number => {
    let classe = false
    for (let i = d + 1; i < s.length; i++) {
      const c = s[i]
      if (c === '\\') i++
      else if (c === '\n') return -1
      else if (c === '[') classe = true
      else if (c === ']') classe = false
      else if (c === '/' && !classe) return i
    }
    return -1
  }
  const gabarit = (d: number): number => {
    for (let i = d + 1; i < s.length; i++) {
      const c = s[i]
      if (c === '\\') i++
      else if (c === '`') return i
      else if (c === '$' && s[i + 1] === '{') {
        const fin = accolade(i + 2)
        if (fin === -1) return -1
        i = fin
      }
    }
    return -1
  }
  const accolade = (d: number): number => {
    let prof  = 1
    let avant = ''
    for (let i = d; i < s.length; i++) {
      const c = s[i]
      if (c === '"' || c === '\'') {
        const fin = chaine(i)
        if (fin !== -1) i = fin
        avant = 'a'
      }
      else if (c === '`') {
        const fin = gabarit(i)
        if (fin !== -1) i = fin
        avant = 'a'
      }
      else if (c === '/') {
        const suite = s[i + 1]
        if (suite === '/') {
          const fin = s.indexOf('\n', i)
          i = fin === -1 ? s.length : fin
        }
        else if (suite === '*') {
          const fin = s.indexOf('*/', i + 2)
          if (fin !== -1) i = fin + 1
        }
        else if (avant === '' || AVANT.includes(avant)) {
          const fin = regex(i)
          if (fin !== -1) i = fin
          avant = 'a'
        }
        else avant = '/'
      }
      else if ((c === '+' || c === '-') && s[i + 1] === c) {
        i++
        avant = 'a'
      }
      else if (c === '{') { prof++; avant = c }
      else if (c === '}') {
        if (--prof === 0) return i
        avant = c
      }
      else if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') avant = c
    }
    return -1
  }
  const balise = (d: number): number => {
    for (let i = d; i < s.length; i++) {
      const c = s[i]
      if (c === '"' || c === '\'') {
        const fin = s.indexOf(c, i + 1)
        if (fin !== -1) i = fin
      }
      else if (c === '{') {
        const fin = accolade(i + 1)
        if (fin !== -1) i = fin
      }
      else if (c === '>') return i
    }
    return -1
  }
  return { braceEnd: accolade, tagEnd: balise }
}

// générateur déterministe
function alea(graine: number) {
  let x = graine
  return () => {
    x ^= x << 13; x >>>= 0
    x ^= x >>> 17
    x ^= x << 5; x >>>= 0
    return x / 4294967296
  }
}

const MORCEAUX = ['<a ', '<b ', '<p v={', '<i w={', '{', '{', '}', '}', ' ', ' ', '>', '>', '\n', '"', '\'', '`', '${', '/*', '*/', '//', '/', '[', ']', '\\', 'a', 'x ', '= ', 'i++ ', '-- ', ' > ', '</b>', 't', '(', ')']

function ms(f: () => void): number {
  const t0 = performance.now()
  f()
  return performance.now() - t0
}

describe('balises : lecture partagée du découpage d\'une balise ouverte', () => {
  it('une accolade jamais refermée n\'empoisonne pas la balise suivante', () => {
    const s = '<a v={x { y } z>\n<b w={a > b}>t</b>'
    const debut = s.indexOf('<b')
    assert.equal(tagReader(s).tagEnd(0), s.indexOf('>', 0))
    const lecteur = tagReader(s)
    lecteur.tagEnd(0)
    assert.equal(lecteur.tagEnd(debut), s.indexOf('b}>') + 2, 'la 2e balise finit au `>` qui suit son accolade')
    assert.equal(lecteur.tagEnd(debut), reference(s).tagEnd(debut))
  })

  it('10 000 documents mal formés : aucun écart avec la lecture sans mémo', function () {
    this.timeout(600000)
    const rnd = alea(20261003)
    let ecarts = 0
    let premier = ''
    for (let n = 0; n < (Number(process.env.FUZZ_BALISES) || 10000); n++) {
      const len = 5 + Math.floor(rnd() * (Number(process.env.FUZZ_BALISES) ? 120 : 40))
      let s = ''
      for (let k = 0; k < len; k++) s += MORCEAUX[Math.floor(rnd() * MORCEAUX.length)]
      const lecteur = tagReader(s)
      for (let i = 0; i < s.length; i++) {
        if (s[i] !== '<' && s[i] !== '{') continue
        const attendu = s[i] === '<' ? reference(s).tagEnd(i) : reference(s).braceEnd(i + 1)
        const obtenu  = s[i] === '<' ? lecteur.tagEnd(i) : lecteur.braceEnd(i + 1)
        if (attendu !== obtenu) { ecarts++; premier ||= JSON.stringify({ s, i, attendu, obtenu }) }
      }
    }
    assert.equal(ecarts, 0, `${ecarts} écarts, le premier : ${premier}`)
  })

  it('des milliers d\'accolades ouvertes jamais refermées : lecture linéaire', function () {
    this.timeout(20000)
    const s = '<p v={ ' + '{ a '.repeat(40000) + '>'
    const t = ms(() => tagReader(s).tagEnd(0))
    assert.ok(t < 1000, `${Math.round(t)} ms`)
  })

  it('un `/*` jamais refermé, répété 40 000 fois : moins de 100 ms', () => {
    const s = '<p v={ ' + '/* a '.repeat(40000)
    const t = ms(() => tagReader(s).tagEnd(0))
    assert.ok(t < 100, `${Math.round(t)} ms`)
  })

  it('12 000 `${` imbriqués : aucune exception, ni dans le découpage ni dans les lints', () => {
    const s = '<p v={`' + '${`'.repeat(12000) + '}>t</p>'
    assert.doesNotThrow(() => tagReader(s).tagEnd(0))
    assert.doesNotThrow(() => checkA11y(s, 'x.mjs'))
    assert.doesNotThrow(() => checkUjsForm(s, 'x.mjs'))
  })

  it('`i++ / 2` et `i-- / 2` : une division, le `>` après reste vu', () => {
    for (const op of ['++', '--']) {
      const s = `<a v={i${op} / 2}>t<b w={x / 3}>`
      assert.equal(tagReader(s).tagEnd(0), s.indexOf('2}>') + 2, `i${op} / 2`)
    }
  })
})
