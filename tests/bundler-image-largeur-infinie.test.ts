// Test de régression : `resolveOneImage` (src/bundler/index.ts) laissait passer une largeur
// NON FINIE jusqu'à `generateVariants`/sharp dès que le format de l'image n'était pas reconnu
// par `readImageSize` — `taille` vaut alors `null`, et le filtre `!taille || w <= taille.width`
// laisse TOUT passer, `Infinity` compris (`widths="… 999…9(400 chiffres) …"` → `Number(...)`
// rend `Infinity`). Le build tombait alors sur le message INTERNE de sharp, en anglais, sans
// nommer ni l'image ni la largeur fautive.
//
// Fix : toute largeur non finie est refusée AU NIVEAU DU BUNDLER, avec un message ModularJS
// clair qui nomme l'image et la largeur — la garde ne dépend d'aucune validation faite ailleurs
// (`<@img widths="…">` a la sienne, dans le transpiler).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

describe('bundler — µimage() avec une largeur non finie : erreur ModularJS claire, jamais le message brut de sharp', function () {
  this.timeout(15000)
  after(async () => { await terminateSharedWorkerPool() })

  it('image de format NON reconnu + largeur démesurée (→ Infinity) : erreur nommant image et largeur', async () => {
    const root   = mjsTmp('image-largeur-infinie')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    // format délibérément NON reconnu par readImageSize (aucune signature PNG/GIF/WebP/AVIF/
    // SVG/JPEG) : taille native = null, le filtre de largeur laisse tout passer.
    writeFileSync(join(srcDir, 'hero.bin'), Buffer.from('FORMAT-JAMAIS-RECONNU-PAR-READIMAGESIZE'))
    const largeurEnorme = '9'.repeat(400)
    writeFileSync(join(srcDir, 'accueil.mjs'), [
      '<script>',
      `$photo = µimage('hero.bin', ${largeurEnorme})`,
      '</script>',
      '<p>x</p>',
    ].join('\n'))

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()

    assert.equal(stats.errors.length, 1, `une seule erreur ModularJS attendue : ${stats.errors.map(e => e.message).join(' | ')}`)
    const msg = stats.errors[0].message
    assert.match(msg, /hero\.bin/, `l'erreur doit nommer l'image : ${msg}`)
    // `Number('9'.repeat(400))` déborde en Infinity — le message NOMME cette valeur convertie
    // (lisible), pas les 400 chiffres du texte source.
    assert.match(msg, /Infinity/, `l'erreur doit nommer la largeur fautive : ${msg}`)
    assert.equal(/positive integer between/i.test(msg), false, 'jamais le message interne brut de sharp')
  })
})
