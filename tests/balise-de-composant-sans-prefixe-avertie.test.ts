// Une balise de composant écrite sans préfixe (`<enfant-simple>` alors que le projet a `enfant-simple.mjs`) n'est
// jamais enregistrée par le navigateur : elle reste un élément vide, et le build ne disait rien. Il avertit maintenant,
// une fois par fichier et par nom, sous `[lint.tagAlias]` (coupable comme les autres), en donnant les deux écritures
// qui marchent, `<mjs-enfant-simple>` et `<@enfant-simple>`.
// Aucun faux positif : une balise HTML, un élément personnalisé d'une autre bibliothèque qui n'a pas de composant du même
// nom, un nom réservé par HTML (`<color-profile>` d'un SVG) ou les deux bonnes écritures ne déclenchent rien.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

async function construire(sources: Record<string, string>, lint?: Record<string, boolean>): Promise<string[]> {
  const root   = mjsTmp('balise-sans-prefixe')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(sources)) writeFileSync(join(srcDir, nom + '.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), ...(lint ? { lint } : {}) })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return stats.warnings
}

const nomment = (avertissements: string[], nom: string): string[] => avertissements.filter(w => w.includes(`<${nom}>`))

describe('balise de composant écrite sans préfixe — avertissement de build', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('`<enfant-simple>` alors que le composant existe : un avertissement par fichier, qui donne les deux écritures', async () => {
    const avertissements = await construire({
      'enfant-simple': '<p class="e">enfant</p>\n',
      parent:          '<div>\n  <enfant-simple></enfant-simple>\n  <enfant-simple>deux</enfant-simple>\n</div>\n',
      autre:           '<section><enfant-simple>x</enfant-simple></section>\n',
    })
    const vus = nomment(avertissements, 'enfant-simple')
    assert.equal(vus.length, 2, avertissements.join('\n'))
    for (const fichier of ['parent.mjs', 'autre.mjs']) {
      const ligne = vus.find(w => w.includes(fichier))
      assert.ok(ligne, `${fichier} est nommé : ${vus.join('\n')}`)
      assert.ok(ligne.includes('<mjs-enfant-simple>') && ligne.includes('<@enfant-simple>'), ligne)
      assert.ok(ligne.endsWith('[lint.tagAlias]'), ligne)
    }
  })

  it('aucun faux positif : balises HTML, élément d\'une autre bibliothèque, nom réservé par HTML, les deux bonnes écritures', async () => {
    const avertissements = await construire({
      'enfant-simple': '<p class="e">enfant</p>\n',
      'color-profile': '<i>profil</i>\n',
      page: [
        '<div><button>ok</button><table><tr><td>1</td></tr></table></div>',
        '<sl-button>bibliothèque</sl-button>',
        '<autre-chose></autre-chose>',
        '<svg viewBox="0 0 10 10"><color-profile></color-profile></svg>',
        '<mjs-enfant-simple></mjs-enfant-simple>',
        '<@enfant-simple></@enfant-simple>',
      ].join('\n') + '\n',
    })
    for (const nom of ['button', 'table', 'sl-button', 'autre-chose', 'color-profile', 'enfant-simple']) {
      assert.deepEqual(nomment(avertissements, nom), [], `<${nom}> : ${avertissements.join('\n')}`)
    }
  })

  it('`lint.tagAlias: false` coupe l\'avertissement', async () => {
    const avertissements = await construire({
      'enfant-simple': '<p class="e">enfant</p>\n',
      parent:          '<enfant-simple></enfant-simple>\n',
    }, { tagAlias: false })
    assert.deepEqual(nomment(avertissements, 'enfant-simple'), [])
  })
})
