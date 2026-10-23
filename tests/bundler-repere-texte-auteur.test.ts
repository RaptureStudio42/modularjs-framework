// Le repère interne d'empreinte n'est reconnu que sous sa forme complète (`<préfixe>/<nom>-ZZZZZ.js|.css`) : un texte
// de l'auteur qui contient `-ZZZZZ.` (format de clé, modèle d'URL d'image) se construit sans erreur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('texte de l\'auteur qui ressemble au repère d\'empreinte', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const env of ['dev', 'prod'] as const) {
    for (const texte of ['Format de clé : ABCDE-ZZZZZ.', 'Modèle : /assets/photo-ZZZZZ.jpg']) {
      it(`${env} — ${texte}`, async () => {
        const root = mjsTmp('repere-auteur')
        const src = join(root, 'src')
        mkdirSync(src, { recursive: true })
        writeFileSync(join(src, 'promo.mjs'), `<script>\n  $x = 1\n</script>\n<p>{$x} ${texte}</p>\n`)
        const out = join(root, 'out')
        const s = await new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env }).compile()
        assert.equal(s.errors.length, 0, s.errors.map(e => e.message).join('\n'))
        assert.ok(s.manifest.promo, 'promo doit rester au manifeste')
        const fichier = readFileSync(join(out, s.manifest.promo.split('/').pop()!), 'utf-8')
        assert.ok(fichier.includes('-ZZZZZ.'), 'le texte de l\'auteur reste intact')
      })
    }
  }
})
