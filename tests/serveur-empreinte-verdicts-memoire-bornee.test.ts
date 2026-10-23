// Le verdict « ce nom porte l'empreinte de son contenu » (cache d'un an, cf. isBuildFingerprinted) est gardé par fichier tant que
// ce fichier garde sa taille et sa date. Cette mémoire n'avait pas de borne : pendant une longue session `mjs dev`, elle gagnait
// une entrée par nom à empreinte demandé. Elle garde désormais au plus 4096 verdicts, comme celle des fichiers servis : le plus
// ancien sort, et se vérifie de nouveau à sa demande suivante.

import { strict as assert } from 'node:assert'
import fs, { writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { isBuildFingerprinted } from '../src/server/render-server.js'
import { mjsTmp } from './helpers/tmp.js'

describe('isBuildFingerprinted — la mémoire des verdicts est bornée', function () {
  this.timeout(60000)

  it('au-delà de 4096 fichiers vérifiés, le plus ancien verdict sort et se vérifie de nouveau', () => {
    const dir     = mjsTmp('empreinte-verdicts-borne')
    const premier = join(dir, 'premier-0a1b2c3d.js')
    const autres  = Array.from({ length: 4096 }, (_, i) => join(dir, 'f' + i + '-' + i.toString(16).padStart(8, '0') + '.js'))
    writeFileSync(premier, 'console.log(0)')
    autres.forEach((f, i) => writeFileSync(f, String(i)))
    // compte les lectures du premier fichier : une lecture = une vérification sur son contenu
    const vrai   = fs.readFileSync
    let lectures = 0
    ;(fs as any).readFileSync = (p: any, o?: any) => { if (String(p) === premier) lectures++; return vrai(p, o) }
    syncBuiltinESMExports()
    try {
      isBuildFingerprinted(premier)
      isBuildFingerprinted(premier)
      assert.equal(lectures, 1, 'gardé : la seconde demande ne relit pas le fichier')
      for (const f of autres) isBuildFingerprinted(f)
      isBuildFingerprinted(premier)
      assert.equal(lectures, 2, 'le plus ancien verdict est sorti de la mémoire : vérifié de nouveau')
    }
    finally {
      ;(fs as any).readFileSync = vrai
      syncBuiltinESMExports()
    }
  })
})
