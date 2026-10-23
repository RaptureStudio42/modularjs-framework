// Un partiel inclus (`<@include morceau>`) ne porte aucun bloc de déclaration : ni <vars>, ni <types>
// (déjà refusés), ni <effects>. Ce dernier était découpé du HTML puis jamais lu — ses effets perdus
// sans un mot, build vert ; il est refusé comme les deux autres, le message dit où il va.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('un partiel inclus ne porte pas de <effects>', () => {
  it('refusé : le message cite l\'include, le bloc, et le fichier *.effects.mjs', async () => {
    const dir = mjsTmp('partiel-effects')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '_avec-effets.mjs'), '<effects>\n  lueur  *neon(#0ff)\n</effects>\n<p class="partiel">texte</p>\n')
    await assert.rejects(
      transpile('<div>\n  <@include avec-effets>\n</div>\n', { moduleName: 'inclut-effets', baseDir: dir }),
      (err: any) => err.message.includes('<@include avec-effets>') && err.message.includes('<effects>') && err.message.includes('*.effects.mjs')
    )
  })

  it('un partiel sans bloc de déclaration reste inclus', async () => {
    const dir = mjsTmp('partiel-simple')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '_simple.mjs'), '<p class="partiel">texte</p>\n')
    const { output } = await transpile('<div>\n  <@include simple>\n</div>\n', { moduleName: 'inclut-simple', baseDir: dir })
    assert.match(output, /partiel/)
  })
})
