// Une adresse écrite dans le texte d'un gabarit — `https://…`, `http://…`, `//cdn…`, dans la prose ou dans un attribut sans
// guillemets — ne cache pas la lecture d'un singleton importé qui la suit sur sa ligne : `{$Boite.a}` y est refusé comme ailleurs
// (« se consomme avec µ$$Boite »). Le texte d'un gabarit n'a pas de commentaire `//`, pas plus que `#` : seul `<!-- … -->` en est
// un. Les vrais commentaires d'un script restent ignorés (`// …` et `/* … */` en JavaScript, `# …` en Civet), comme ses chaînes, et
// ceux d'un bloc <style> aussi (`// …` et `/* … */` en SASS et en SCSS).
//
// Défaut : le refus des singletons lisait `//` comme un commentaire jusque dans la prose du gabarit ; la fin de la ligne devenait
// invisible, et une lecture `$Boite` écrite après une adresse compilait sans un mot.
//
// Construction réelle (Bundler) : un composant par écriture, l'erreur de chacun dans `stats.errors`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const IMPORT = `@import µ$$Boite 'stores/boite.module.civet'\n`
const REFUS  = 'Le singleton importé « Boite » se consomme avec « µ$$Boite »'

// un projet : le module qui déclare le singleton et un composant par gabarit (`cas-<n>.mjs`) ; les messages d'erreur de la construction
async function construire(prefixe: string, gabarits: string[]): Promise<string[]> {
  const racine  = mjsTmp(prefixe)
  const sources = join(racine, 'src')
  mkdirSync(join(sources, 'stores'), { recursive: true })
  writeFileSync(join(sources, 'stores', 'boite.module.civet'), 'export µ$$Boite = { a: 1 }\n')
  gabarits.forEach((g, n) => writeFileSync(join(sources, `cas-${n}.mjs`), IMPORT + g + '\n'))
  const bundler = new Bundler({ sourceDir: sources, outputDir: join(racine, 'out'), manifestPath: join(racine, 'bundle.js') })
  try {
    const stats = await bundler.compile()
    return stats.errors.map((e: Error) => e.message)
  }
  finally {
    await bundler.close()
  }
}

describe('une adresse dans le texte du gabarit ne cache pas la lecture d\'un singleton importé', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('`https://`, `http://`, `//cdn`, dans la prose ou un attribut sans guillemets : `{$Boite.a}` refusé, comme sans adresse', async () => {
    const gabarits = [
      '<p>voir {$Boite.a}</p>',
      '<p>voir https://exemple.fr {$Boite.a}</p>',
      '<p>voir http://exemple.fr/page {$Boite.a}</p>',
      '<p>la feuille //cdn.exemple.fr/x.css et {$Boite.a}</p>',
      '<p><a href=https://exemple.fr>le site</a> {$Boite.a}</p>',
      '<p>l\'adresse https://exemple.fr et {$Boite.a}</p>',
    ]
    const erreurs = await construire('singleton-apres-adresse', gabarits)
    const muets   = gabarits.filter((_g, n) => !erreurs.some((e) => e.includes(`cas-${n}.mjs`) && e.includes(REFUS)))
    assert.deepEqual(muets, [], erreurs.join('\n'))
    assert.equal(erreurs.length, gabarits.length, erreurs.join('\n'))
  })

  it('témoins : la forme juste après une adresse, et les commentaires d\'un script qui citent `$Boite`, compilent', async () => {
    const erreurs = await construire('singleton-apres-adresse-temoins', [
      '<p>voir https://exemple.fr et //cdn.exemple.fr : {µ$$Boite.a}</p>\n<a href=https://exemple.fr>{µ$$Boite.a}</a>',
      '<script lang="js">\n  // ancien : $Boite.a\n  /* ancien : $Boite.a */\n  const lien = \'https://exemple.fr\'\n</script>\n<p>{µ$$Boite.a}</p>',
      '<script>\n  # ancien : $Boite.a\n  lien = "https://exemple.fr"\n</script>\n<p>{µ$$Boite.a}</p>',
    ])
    assert.deepEqual(erreurs, [])
  })

  it('les commentaires d\'un bloc <style> qui citent `$Boite` (`// …`, `/* … */`, en SASS comme en SCSS) compilent', async () => {
    const erreurs = await construire('singleton-commentaire-style', [
      '<p>{µ$$Boite.a}</p>\n<style>\n  // même teinte que $Boite, sans le lire\n  p\n    color: red\n</style>',
      '<p>{µ$$Boite.a}</p>\n<style lang="scss">\n  p { color: red; } // $Boite ne se lit pas ici\n  /* ni $Boite ici */\n</style>',
      '<style>\n  // la teinte de $Boite\n</style>\n<p>voir https://exemple.fr {µ$$Boite.a}</p>',
    ])
    assert.deepEqual(erreurs, [])
  })

  it('après un bloc <style>, une adresse dans la prose ne cache toujours pas la lecture : `{$Boite.a}` refusé', async () => {
    const erreurs = await construire('singleton-style-puis-adresse', ['<style>\n  // commentaire\n  p\n    color: red\n</style>\n<p>voir https://exemple.fr {$Boite.a}</p>'])
    assert.equal(erreurs.length, 1, erreurs.join('\n'))
    assert.ok(erreurs[0].includes(REFUS), erreurs[0])
  })
})
