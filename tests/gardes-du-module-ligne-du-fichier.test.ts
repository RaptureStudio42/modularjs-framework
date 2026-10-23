// Les refus de `µeffect`/`µinspect` et de `µemit` dans `<script module>` citaient une ligne comptée depuis le
// début du bloc, pas celle du fichier. Ils citent désormais la ligne du `.mjs`.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function message(source: string): Promise<string> {
  try {
    await transpile(source, { moduleName: 'gardes' })
  }
  catch (e: any) {
    return String(e.message)
  }
  return assert.fail('construction acceptée')
}

const MODULE = (ligne: string): string => ['<p>x</p>', '<script module>', 'a = 1', '', ligne, '</script>', '<script>', '$n = 0', '</script>'].join('\n')

describe('gardes de <script module> : ligne du fichier', function () {
  this.timeout(30000)

  it('µeffect dans le module : ligne 5', async () => {
    assert.match(await message(MODULE('µeffect -> console.log a')), /« µeffect » dans <script module> \(ligne 5\)/)
  })

  it('µemit dans le module : ligne 5', async () => {
    assert.match(await message(MODULE("f = -> µemit 'x'")), /« µemit » dans <script module> \(ligne 5\)/)
  })
})
