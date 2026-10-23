// Les avertissements qui relisent le HTML d'un composant citent la ligne du FICHIER, même quand il commence par des
// lignes vides (le HTML est rogné en tête avant d'être lu) : les contrôles d'accessibilité reçoivent la ligne où le
// HTML commence, et la silhouette d'un composant (squelette), qui réanalyse le gabarit, la passe au parseur.
// Sans lignes vides en tête, rien ne change : les lignes sont celles du HTML.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkA11y } from '../src/transpiler/a11y.js'
import { skeletonHtml } from '../src/parser/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// un défaut par contrôle, chacun sur sa ligne : 1 (img), 2 (iframe), 3 (tabindex), 4 (div cliquable), 5 (bouton), 6 (lien), 7 (champ)
const CORPS = [
  '<img src="a.png">',
  '<iframe src="/x"></iframe>',
  '<p tabindex="3">a</p>',
  '<div @click={a()}>b</div>',
  '<button></button>',
  '<a href="/x"></a>',
  '<input type="text">',
].join('\n')

const lignes = (messages: string[]) => messages.map(m => Number((m.match(/ligne (\d+)/i) ?? [])[1]))

describe('lignes vraies après des lignes vides en tête — contrôles d\'accessibilité', () => {
  it('sans ligne vide : les lignes du HTML', () => {
    assert.deepEqual(lignes(checkA11y(CORPS, 'm')), [1, 2, 3, 4, 5, 6, 7])
    assert.deepEqual(lignes(checkA11y(CORPS, 'm', 1)), [1, 2, 3, 4, 5, 6, 7])
  })

  it('trois lignes vides en tête (le HTML commence ligne 4) : les lignes du fichier', () => {
    assert.deepEqual(lignes(checkA11y(CORPS, 'm', 4)), [4, 5, 6, 7, 8, 9, 10])
  })
})

describe('lignes vraies après des lignes vides en tête — silhouette d\'un composant', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const GABARIT = '<div>\n<span>\na\n</div>\n'

  function espionner<T>(fn: () => T): { vus: string[], res: T } {
    const orig = console.warn
    const vus: string[] = []
    console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
    try { return { vus, res: fn() } } finally { console.warn = orig }
  }

  it('skeletonHtml sans première ligne : les lignes du gabarit', () => {
    const { vus } = espionner(() => skeletonHtml(GABARIT))
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /ouverte ligne 2\b.*rencontrée ligne 4\b/s)
  })

  it('skeletonHtml avec la ligne où commence le gabarit : les lignes du fichier', () => {
    const { vus } = espionner(() => skeletonHtml(GABARIT, 4))
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /ouverte ligne 5\b.*rencontrée ligne 7\b/s)
  })

  it('le build d\'un composant à squelette, trois lignes vides en tête : aucune ligne relative réimprimée', async () => {
    const root   = mjsTmp('lignes-vraies-squelette')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'carte.mjs'), '\n\n\n' + GABARIT)
    writeFileSync(join(srcDir, 'page.mjs'), '<@carte *skeleton></@carte>')
    const orig = console.warn
    const vus: string[] = []
    console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
    try {
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
      await bundler.compile()
      await bundler.close()
    }
    finally { console.warn = orig }
    const citees = vus.filter(m => m.includes('ouverte ligne'))
    assert.ok(citees.length >= 1, 'le défaut est signalé au moins une fois : ' + vus.join('\n'))
    for (const m of citees) assert.match(m, /ouverte ligne 5\b/, 'chaque rappel cite la ligne du fichier')
  })
})
