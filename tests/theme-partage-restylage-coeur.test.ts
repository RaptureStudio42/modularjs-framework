// `lint.themeShared` rappelle qu'une variable de thème déclarée par plusieurs composants cascade. Une variable de restylage
// d'un module du cœur — celle qu'il lit avec sa propre valeur par défaut, documentée avec lui (<@@number> :
// `--mjs-number-border`, `--mjs-number-step-bg`…) — se pose dans chaque composant de l'application qui veut habiller ce
// module : c'est l'usage prévu, aucun rappel. Une variable de l'application déclarée par deux de ses composants garde le sien.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('lint.themeShared : le restylage documenté d\'un module du cœur n\'est pas un partage', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  async function rappels(composants: Record<string, string>): Promise<string[]> {
    const root   = mjsTmp('theme-partage-restylage')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, texte] of Object.entries(composants)) writeFileSync(join(srcDir, nom + '.mjs'), texte)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    return stats.warnings.filter((w) => w.endsWith('[lint.themeShared]'))
  }

  const panier = (bordure: string) => ['<theme>', `  --mjs-number-border: ${bordure}`, '  --mjs-number-step-bg: #eee', '</theme>', '<@@number name="quantite" value="3"></@@number>'].join('\n')

  it('deux composants habillent chacun leur <@@number> : aucun rappel pour --mjs-number-border ni --mjs-number-step-bg', async () => {
    const lignes = await rappels({ 'rp-panier': panier('green'), 'rp-commande': panier('red') })
    assert.deepEqual(lignes.filter((w) => /number-(border|step-bg)/.test(w)), [], lignes.join('\n'))
  })

  it('$$theme : le restylage écrit en variable de thème non plus', async () => {
    const texte = (c: string) => ['<theme>', `  $$number-border: ${c}`, '</theme>', '<@@number value="1"></@@number>'].join('\n')
    const lignes = await rappels({ 'rp-un': texte('green'), 'rp-deux': texte('blue') })
    assert.deepEqual(lignes.filter((w) => /number-border/.test(w)), [], lignes.join('\n'))
  })

  it('une variable de l\'application déclarée par deux de ses composants : le rappel reste', async () => {
    const texte = (c: string) => ['<theme>', `  $$carte-fond: ${c}`, '</theme>', '<p class="c">x</p>', '<style>', '  .c', '    background: $$carte-fond', '</style>'].join('\n')
    const lignes = await rappels({ 'rp-carte': texte('white'), 'rp-fiche': texte('black') })
    assert.equal(lignes.filter((w) => /carte-fond/.test(w)).length, 1, lignes.join('\n'))
  })
})
