// l'attribut `layout` / `template` laissé à la variable du même nom, quand un composant déclare `$layout` ou `$template` : ce garde
// n'entre au cœur de production que si une unité de ce build déclare l'une de ces variables. Sans elle, l'attribut choisit le modèle de
// style comme avant et le cœur ne porte pas l'aide qui le lit ; en développement, elle est toujours là (un composant recompilé à chaud
// peut déclarer la variable)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SANS: Record<string, string> = {
  'carte-simple.mjs': ['<script>', '$titre = \'Bonjour\'', '</script>', '<p>{$titre}</p>'].join('\n')
}
const AVEC_LAYOUT: Record<string, string> = {
  'carte-modele.mjs': ['<script>', '$layout = \'compact\'', '</script>', '<p>{$layout}</p>'].join('\n')
}
const AVEC_TEMPLATE: Record<string, string> = {
  'carte-gabarit.mjs': ['<script>', '$template = \'large\'', '</script>', '<p>{$template}</p>'].join('\n')
}

// l'aide du garde (sa définition et ses appels) ; la ligne d'avant, quand l'attribut choisit le modèle sans garde
const AIDE    = '_mjs_layAttr('
const AVANT   = /this\.getAttribute\(['"]layout['"]\) \|\| this\.getAttribute\(['"]template['"]\)/

async function coeur(nom: string, sources: Record<string, string>, env: 'dev' | 'prod'): Promise<string> {
  const root   = mjsTmp('modele-variable-' + nom + '-' + env)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, s] of Object.entries(sources)) writeFileSync(join(srcDir, f), s + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), runtime: 'core', js: 'bundle', env, minify: false } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
}

describe('attribut layout / template laissé à la variable du même nom : au cœur seulement si une unité la déclare', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('production, aucune unité ne déclare $layout ni $template : l\'aide n\'est pas au cœur, l\'attribut choisit le modèle comme avant', async () => {
    const c = await coeur('sans', SANS, 'prod')
    assert.equal(c.includes(AIDE), false, 'l\'aide qui laisse l\'attribut à la variable est au cœur d\'une appli qui ne déclare pas la variable')
    assert.match(c, AVANT)
  })

  it('production, une unité déclare $layout : l\'aide est au cœur', async () => {
    const c = await coeur('layout', AVEC_LAYOUT, 'prod')
    assert.ok(c.includes(AIDE), 'l\'aide manque au cœur d\'une appli qui déclare $layout')
    assert.doesNotMatch(c, AVANT)
  })

  it('production, une unité déclare $template : l\'aide est au cœur', async () => {
    const c = await coeur('template', AVEC_TEMPLATE, 'prod')
    assert.ok(c.includes(AIDE), 'l\'aide manque au cœur d\'une appli qui déclare $template')
  })

  it('développement, sans la variable : l\'aide reste au cœur', async () => {
    const c = await coeur('sans', SANS, 'dev')
    assert.ok(c.includes(AIDE), 'l\'aide manque au cœur de développement')
  })
})
