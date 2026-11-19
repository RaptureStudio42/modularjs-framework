// chaque bloc balisé du cœur (`// <nom>` … `// </nom>`, src/runtime/) est connu de la construction, et chaque nom de bloc que la
// construction emploie (src/bundler/, page compilée à la volée de server/viewer-page.ts) est balisé dans le cœur : un nom changé d'un seul
// côté laisse le bloc au cœur de production sans erreur ni avertissement, seul le poids des applis le montre. Exemple : l'objet atteint par
// plusieurs clés (`<shared-object>`, mjs_element.ts), retiré en production sans l'enveloppe de l'état (réglage `proxy: false`)

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { LONE_HELPERS } from '../src/bundler/features.js'

const SRC  = fileURLToPath(new URL('../src', import.meta.url))
const NAME = '([a-z][a-z0-9-]*)'

const files = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    const path = join(dir, f)
    if (statSync(path).isDirectory()) files(path, out)
    else if (f.endsWith('.ts')) out.push(path)
  }
  return out
}

// les blocs du cœur, par nom : leurs lieux (une ligne `// <nom>`, ou `// // <nom>` dans l'autre forme d'un bloc)
const coreBlocks = (): Map<string, string[]> => {
  const blocks = new Map<string, string[]>()
  for (const path of files(join(SRC, 'runtime'))) {
    readFileSync(path, 'utf-8').split('\n').forEach((line, i) => {
      const m = new RegExp(`^[ \\t]*(?:// )*// <${NAME}>\\s*$`).exec(line)
      if (m) blocks.set(m[1], [...blocks.get(m[1]) ?? [], relative(SRC, path) + ':' + (i + 1)])
    })
  }
  return blocks
}

// les noms de blocs que la construction emploie, par nom : leurs lieux. `generic` : les noms passés à projectBlocks, dont la forme `no-<nom>`
// se lit sans être nommée
const buildNames = (): { names: Map<string, string[]>, generic: Set<string> } => {
  const names   = new Map<string, string[]>()
  const generic = new Set<string>()
  const add     = (name: string, where: string, isGeneric = false) => {
    names.set(name, [...names.get(name) ?? [], where])
    if (isGeneric) generic.add(name)
  }
  const paths = [...files(join(SRC, 'bundler')), join(SRC, 'server', 'viewer-page.ts')]
  for (const path of paths) {
    let list: 'blocks' | 'helpers' | null = null
    readFileSync(path, 'utf-8').split('\n').forEach((line, i) => {
      const where = relative(SRC, path) + ':' + (i + 1)
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return
      for (const m of line.matchAll(new RegExp(`withoutBlock\\(\\s*[\\w.]+\\s*,\\s*'${NAME}'`, 'g'))) add(m[1], where)
      for (const m of line.matchAll(/projectBlocks\([^,]+,\s*\{([^}]*)\}/g)) for (const k of m[1].matchAll(new RegExp(`'${NAME}'\\s*:`, 'g'))) add(k[1], where, true)
      if (/VIEWER_BLOCKS_OFF[^=]*=\s*\{/.test(line)) for (const k of line.matchAll(new RegExp(`'${NAME}'\\s*:`, 'g'))) add(k[1], where, true)
      if (path.endsWith('viewer-page.ts')) for (const m of line.matchAll(new RegExp(`\\bblock:\\s*'${NAME}'`, 'g'))) add(m[1], where)
      // l'objet des blocs gardés selon l'appli (`const blocks`), la liste des aides d'écriture (`const helpers`)
      if (/^\s*const blocks: Record<string, boolean> = \{/.test(line)) list = 'blocks'
      else if (/^\s*const helpers: Array<\[string, string, RegExp\]> = \[/.test(line)) list = 'helpers'
      else if (list !== null && /^\s*[}\]]\s*$/.test(line)) list = null
      else if (list === 'blocks') for (const k of line.matchAll(new RegExp(`^\\s*'${NAME}'\\s*:`, 'g'))) add(k[1], where, true)
      else if (list === 'helpers') for (const k of line.matchAll(new RegExp(`^\\s*\\['${NAME}',`, 'g'))) add(k[1], where)
      // une marque écrite dans une expression régulière ou une chaîne : `\/\/ <nom>`, `<\/nom>`, `'// <nom>'`
      if (/\\\/\\\/ <|'\/\/ <|`\/\/ <|\^\/\/ </.test(line)) for (const m of line.matchAll(new RegExp(`<(?:\\\\\\/\\??|\\/)?${NAME}>`, 'g'))) add(m[1], where)
    })
  }
  for (const [block] of LONE_HELPERS) add(block, 'bundler/features.ts LONE_HELPERS')
  return { names, generic }
}

// le cœur assemblé, non minifié
const core = async (opts: Record<string, unknown>) => {
  const out     = mjsTmp('core-blocks-known')
  const bundler = new Bundler({ outputDir: out, manifestPath: join(out, 'bundle.js'), minify: false, ...opts } as any)
  const path    = await bundler.bundleRuntime(new Set<string>())
  return path === 'mjs:core' ? (bundler as any).bundleVirtualSources.get('mjs_core') as string : readFileSync(join(out, basename(path)), 'utf-8')
}

describe('construction : les blocs balisés du cœur et les noms que la construction leur donne sont les mêmes', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  it('chaque nom de bloc employé par la construction est balisé dans le cœur', () => {
    const blocks    = coreBlocks()
    const { names } = buildNames()
    assert.ok(blocks.size > 100 && names.size > 100, `relevé trop maigre : ${blocks.size} blocs, ${names.size} noms`)
    const unknown = [...names].filter(([name]) => !blocks.has(name)).map(([name, where]) => `${name} (${where.join(', ')})`)
    assert.deepEqual(unknown, [], 'noms de la construction absents du cœur')
  })

  it('chaque bloc balisé du cœur est nommé par la construction', () => {
    const blocks             = coreBlocks()
    const { names, generic } = buildNames()
    const unnamed            = [...blocks].filter(([name]) => !names.has(name) && !(name.startsWith('no-') && generic.has(name.slice(3)))).map(([name, where]) => `${name} (${where.join(', ')})`)
    assert.deepEqual(unnamed, [], 'blocs du cœur que la construction ne nomme pas')
  })

  it('production sans l\'enveloppe de l\'état : l\'objet atteint par plusieurs clés part du cœur, et l\'objet est rangé tel quel', async () => {
    const prod = await core({ env: 'prod', proxy: false })
    assert.ok(!prod.includes('parsed = this._mjs_wrapDeep(__raw, k);'), 'la fiche des clés d\'un objet est restée au cœur de production')
    assert.match(prod, /^\s*parsed = __raw;$/m, 'la forme sans fiche ne prend pas sa place')
    assert.doesNotMatch(prod, /^[ \t]*\/\/ <\/?(?:no-)?shared-object>$/m, 'une marque du bloc est restée seule')
  })

  it('développement sans l\'enveloppe de l\'état : la fiche des clés d\'un objet reste', async () => {
    const dev = await core({ proxy: false })
    assert.ok(dev.includes('parsed = this._mjs_wrapDeep(__raw, k);'), 'la fiche des clés d\'un objet manque en développement')
  })
})
