// Un ancien mot de MJS en `@` (`@class{$on}="vif"`, `@this=!{ref}`) n'est refusé que là où il agit : écrit dans un commentaire — du gabarit
// (`<!-- … -->`), du script (`#`, `###…###`, `//`, `/* … */` selon la langue) ou de la feuille de style —, il ne compte pas, comme tout ce
// qu'un commentaire porte ; le même mot hors commentaire est refusé, la nouvelle écriture dans le message. Un module du cœur garde en
// commentaire l'autre forme d'une ligne qui existe avec et sans un attribut (`!other` de <@@select>, `!answer` de <@@editor>) : la
// construction la réveille quand aucune page n'écrit l'attribut, elle s'écrit donc comme le reste du gabarit, et les 25 modules du cœur,
// écrits sans aucun attribut, se construisent en développement et en production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ANCIEN = '<div @class{$on}="vif" @this=!{ref}></div>'
const SCRIPT = (corps = '') => `<script>\n$on = true\nref = null\n${corps}</script>\n`

// le message de l'erreur levée par la construction, '' si elle passe
async function refus(src: string): Promise<string> {
  try {
    await transpile(src + '\n', { moduleName: 'motArobaseCommentaire' })
    return ''
  }
  catch (e: any) {
    return String(e?.message ?? e)
  }
}

describe('un ancien mot de MJS en @ écrit dans un commentaire ne compte pas', () => {
  it('hors commentaire, il est refusé avec la nouvelle écriture dans le message', async () => {
    assert.match(await refus(SCRIPT() + ANCIEN), /écrivez « :class\{\$on\}="vif" »/)
  })

  it('dans un commentaire du gabarit, sur une ligne ou sur plusieurs', async () => {
    assert.equal(await refus(SCRIPT() + `<!-- ${ANCIEN} -->\n<p>x</p>`), '')
    assert.equal(await refus(SCRIPT() + `<p>x</p>\n<!--\n  ${ANCIEN}\n  <span @this=!{ref}></span>\n-->`), '')
  })

  it('dans un commentaire du script : `#` et `###…###` (Civet, CoffeeScript), `//` et `/* … */` (JavaScript, TypeScript)', async () => {
    const diese = `# ${ANCIEN}\n###\n${ANCIEN}\n###\n`
    const barre = `// ${ANCIEN}\n/* ${ANCIEN} */\n/*\n${ANCIEN}\n*/\n`
    assert.equal(await refus(SCRIPT(diese) + '<p>x</p>'), '', 'Civet')
    assert.equal(await refus(`<script lang="coffee">\n${diese}</script>\n<p>x</p>`), '', 'CoffeeScript')
    assert.equal(await refus(`<script lang="js">\n${barre}</script>\n<p>x</p>`), '', 'JavaScript')
    assert.equal(await refus(`<script lang="ts">\n${barre}</script>\n<p>x</p>`), '', 'TypeScript')
  })

  it('dans un commentaire de la feuille de style', async () => {
    assert.equal(await refus(SCRIPT() + `<p class="a">x</p>\n<style>\n// ${ANCIEN}\n/* ${ANCIEN} */\n.a\n  color: red\n</style>`), '')
  })
})

describe('les 25 modules du cœur, écrits sans aucun attribut, se construisent', () => {
  const COEUR   = fileURLToPath(new URL('../src/core-modules/', import.meta.url))
  const MODULES = readdirSync(COEUR).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4))

  after(async () => { await terminateSharedWorkerPool() })

  for (const [env, nom] of [['dev', 'développement'], ['prod', 'production']]) {
    it(`en ${nom} : l'autre forme réveillée (sans « Autre » de <@@select>, sans « répondre » de <@@editor>) passe`, async function () {
      this.timeout(180000)
      assert.equal(MODULES.length, 25)
      const root   = mjsTmp('coeur-sans-attribut-' + env)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'page.mjs'), MODULES.map((m) => `<@@${m}></@@${m}>`).join('\n') + '\n')
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), js: 'split', minify: false, env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
      const sorties = readdirSync(outDir)
      assert.deepEqual(['select', 'editor'].filter((m) => !sorties.some((f) => f.startsWith(`core-${m}`))), [], 'les deux modules à autre forme sont compilés')
    })
  }
})
