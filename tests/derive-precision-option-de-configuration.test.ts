// option d'appli `derived` de mjs.config.json : "precise" (défaut, le compilateur prouve des valeurs précises, qui suivent leurs
// sources, sauf quand elles repassent à l'horloge) ou "clock" (la règle de l'horloge : toute écriture du composant périme ses
// valeurs calculées) ;
// toute autre valeur est refusée avec un message qui donne les deux valeurs permises
import { describe, it } from 'mocha'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { mjsTmp } from './helpers/tmp.js'

function options(config: unknown) {
  const root  = mjsTmp('cfg-derived')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify(config))
  const found = findConfig(root)
  assert.ok(found, 'mjs.config.json trouvé')
  return resolveBundlerOpts(found!.config, root)
}

describe('mjs.config.json — option derived', () => {
  it('absente : rien n\'est transmis au bundler, qui prend la précision (défaut)', () => {
    assert.equal(options({}).derivedMode, undefined)
  })

  it('"precise" et "clock" sont acceptées et transmises au bundler', () => {
    assert.equal(options({ derived: 'precise' }).derivedMode, 'precise')
    assert.equal(options({ derived: 'clock' }).derivedMode, 'clock')
  })

  it('une valeur inconnue est refusée, dans la forme des messages voisins : la clé, « doit être », les deux valeurs permises, « reçu : » et la valeur reçue', () => {
    assert.throws(() => options({ derived: 'exact' }), (e: Error) => /^\[mjs\.config\.json\] derived doit être "precise" \(défaut : le compilateur prouve des valeurs précises, qui suivent leurs sources, sauf quand elles repassent à l'horloge, cf\. chapitre 3\) ou "clock" \(la règle de l'horloge : toute écriture du composant périme ses valeurs calculées, refaites à leur prochaine lecture\), reçu : "exact"$/.test(e.message), 'message attendu')
  })

  it('une valeur qui n\'est pas un texte est refusée de même', () => {
    assert.throws(() => options({ derived: true }), (e: Error) => /^\[mjs\.config\.json\] derived doit être .+, reçu : true$/.test(e.message))
  })
})
