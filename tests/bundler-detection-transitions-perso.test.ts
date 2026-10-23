// une appli qui n'écrit que des transitions créées par `µanim.create` embarque le moteur des transitions
//
// `@in=*tourbillon`, où `tourbillon` n'est pas un effet du catalogue mais une transition créée par `µanim.create`,
// compile en `µ._mjs_fxAnimCustom(…)`. Ce n'est ni `_mjs_fxAnim` (le catalogue) ni `_mjs_fxLife` (un effet qui se joue
// une fois) : la détection des fichiers du cœur (features.ts) doit la reconnaître comme une transition écrite, sinon
// `runtime: 'core'` (ou une liste qui ne nomme pas `easing`) laisse la transition sans son moteur — « Cœur incomplet »
// à la construction, `_mjs_fxAnimCustom` introuvable

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const CREE = [
  '  µanim.create \'tourbillon\',',
  '    duration: 3000',
  '    css: (t, u)->',
  '      transform: "scale(#{t})"',
].join('\n')

// les écritures d'une transition perso, avec l'unique composant qui la porte
const TRANSITIONS: Record<string, string> = {
  '@in':         `<script>\n  $a = false\n${CREE}\n  @ta = -> $a = true\n</script>\n{if $a}<div class="ca" @in=*tourbillon(duration: 3s)>css-perso</div>{end}`,
  '@out':        `<script>\n  $a = true\n${CREE}\n</script>\n{if $a}<div class="ca" @out=*tourbillon(duration: 3s)>css-perso</div>{end}`,
  '@transition': `<script>\n  $a = true\n${CREE}\n</script>\n{if $a}<div class="ca" @transition=*tourbillon>css-perso</div>{end}`,
}

async function usedOf(source: string): Promise<Set<string>> {
  const { output, data } = await transpile(source, { moduleName: 'hop' })
  return scanCompiledFeatures(output, data)
}

describe('transitions créées par µanim.create — le moteur des transitions suit la transition écrite', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [titre, source] of Object.entries(TRANSITIONS)) {
    it(`le code compilé pose la transition par _mjs_fxAnimCustom (${titre})`, async () => {
      const { output } = await transpile(source, { moduleName: 'hop' })
      assert.match(output, /µ\._mjs_fxAnimCustom\(/)
    })

    it(`runtime 'core' + ${titre} d'une transition perso seule : le fichier des transitions et le moteur sont du cœur`, async () => {
      const files = new Bundler({ runtime: 'core' }).resolveRuntimeFiles(await usedOf(source)).files
      assert.ok(files.includes('mjs_fx_transition.ts'), `le fichier des transitions manque au cœur : ${files.join(' ')}`)
      assert.ok(files.includes('mjs_easing.ts'), `mjs_easing.ts manque au cœur : ${files.join(' ')}`)
    })

    it(`runtime ['router'] + ${titre} d'une transition perso seule : de même`, async () => {
      const files = new Bundler({ runtime: ['router'] }).resolveRuntimeFiles(await usedOf(source)).files
      assert.ok(files.includes('mjs_fx_transition.ts'), files.join(' '))
      assert.ok(files.includes('mjs_easing.ts'), files.join(' '))
    })
  }

  it('une appli sans transition ne prend ni le fichier des transitions ni le moteur', async () => {
    const files = new Bundler({ runtime: 'core' }).resolveRuntimeFiles(await usedOf('<p>x</p>')).files
    assert.equal(files.includes('mjs_fx_transition.ts'), false)
    assert.equal(files.includes('mjs_easing.ts'), false)
  })

  for (const env of ['dev', 'prod'] as const) {
    it(`construction réelle (runtime 'core', ${env}) : une transition perso seule se construit, le cœur porte _mjs_fxAnimCustom`, async () => {
      const root   = mjsTmp('transitions-perso')
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'essai-app.mjs'), TRANSITIONS['@in'] + '\n')
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), runtime: 'core', js: 'split', env } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => String(e.message)), [])
      // en développement les noms internes sont lisibles ; en production ils sont raccourcis, la définition garde son nom court dans le cœur
      const coeur = readFileSync(join(outDir, readdirSync(outDir).find((n) => /^mjs_core-/.test(n))!), 'utf-8')
      if (env === 'dev') assert.ok(coeur.includes('µ._mjs_fxAnimCustom = function'), 'la définition de la transition perso est au cœur')
      else assert.ok(coeur.length > 1000, 'le cœur est là')
    })
  }
})
