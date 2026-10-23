// des effets en double ont été fondus dans un autre avant la 3.0 : *aurora dans *mesh, *shimmer dans *shine, *wiggle dans
// *attention, *lens dans *filter. Leur ancien nom, avec ou sans réglages, arrête la construction sur un message qui donne l'alias du même rendu (en
// français et en anglais, sur une balise comme sur <@document>) ; le catalogue et les modules du cœur ne les portent plus.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transpile } from '../src/transpiler/index.js'
import { parseEffect, EFFECTS } from '../src/effects/catalog.js'
import { setMessagesLang } from '../src/messages/index.js'

const ICI = dirname(fileURLToPath(import.meta.url))

// l'ancien nom, l'alias qui le remplace, une écriture avec réglages
const FONDUS: Array<[string, string, string]> = [
  ['aurora', '*mesh.aurora', '*aurora(opacity: .3, blur: 60)'],
  ['shimmer', '*shine.shimmer', '*shimmer(speed: 3s, color: #999)'],
  ['wiggle', '*attention.wiggle', '*wiggle(angle: 20, on: click)'],
  ['lens', '*filter.lens', '*lens(size: 50, blur: 4)'],
]

describe('effets fondus dans un autre : l\'ancien nom donne le nouveau', () => {
  afterEach(() => setMessagesLang('fr'))

  for (const [nom, alias, regle] of FONDUS) {
    it(`*${nom} : ni dans le catalogue, ni dans le cœur`, () => {
      assert.ok(!(nom in EFFECTS), 'plus de ligne `' + nom + '` dans EFFECTS')
      assert.ok(!existsSync(join(ICI, '../src/runtime/mjs_fx_' + nom + '.ts')), 'plus de module mjs_fx_' + nom)
    })

    for (const ecrit of ['*' + nom, regle]) {
      it(`${ecrit} sur une balise : la construction s'arrête, le message donne ${alias}`, async () => {
        await assert.rejects(transpile(`<div ${ecrit}>x</div>`, { moduleName: 'fondu-' + nom }), (e: Error) => {
          assert.ok(e.message.includes('*' + nom + ' n\'existe plus'), e.message)
          assert.ok(e.message.includes('écrivez ' + alias), e.message)
          return true
        })
      })
    }

    it(`*${nom} sur <@document> : le même message`, async () => {
      const { data } = await transpile(`<@document *${nom}></@document>\n<p>x</p>\n`, { moduleName: 'fondu-doc-' + nom })
      assert.equal(data.macroErrors.length, 1, JSON.stringify(data.macroErrors))
      assert.ok(data.macroErrors[0].includes('écrivez ' + alias), data.macroErrors[0])
    })

    it(`*${nom} en anglais : write ${alias}, sans tutoyer`, () => {
      setMessagesLang('en')
      assert.throws(() => parseEffect(nom, ''), (e: Error) => e.message.includes('*' + nom + ' no longer exists') && e.message.includes('write ' + alias) && !/\b(tu|ton|ta|tes|toi|your)\b/i.test(e.message))
    })
  }

  it('*shimmer : le message dit le nouveau nom des réglages qui en changent', () => {
    assert.throws(() => parseEffect('shimmer', ''), /speed: v → duration: v, every: v · color → ink · shine → color/)
  })

  it('*lens : le message dit que le rayon `size` devient le diamètre `spot`, le double', () => {
    assert.throws(() => parseEffect('lens', ''), (e: Error) => e.message.includes('size: s → spot: 2 × s'))
    assert.throws(() => parseEffect('lens', 'size: 100'), (e: Error) => e.message.includes('écrivez *filter.lens(spot: 200)'))
  })

})
