// les formes du cœur écrites en commentaire (`// <no-x>` … `// </no-x>`, blocs `<clock>` et `<no-redraw>`), que la construction reprend
// quand elle retire leur bloc, nomment les mêmes variables que le code actif : un nom changé dans le code actif et resté ancien dans sa
// forme en commentaire lève une ReferenceError dans le navigateur (le cœur est un module, en mode strict), et seul le cœur bâti avec cette
// forme le montre. Chaque fichier du cœur, toutes ses formes reprises comme le fait la construction, passe la règle `no-undef` du lint du
// cœur (globales du navigateur et de la concaténation, eslint.config.js)

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { projectBlocks, projectPrecision } from '../src/bundler/index.js'

const ROOT    = fileURLToPath(new URL('..', import.meta.url))
const RUNTIME = join(ROOT, 'src', 'runtime')

const files = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    const path = join(dir, f)
    if (statSync(path).isDirectory()) files(path, out)
    else if (f.endsWith('.ts') && !f.endsWith('.d.ts')) out.push(path)
  }
  return out
}

// les textes du fichier, une forme en commentaire reprise à la fois, comme le fait la construction : la règle de l'horloge sans le chemin
// qui redessine, que la construction ne prend qu'en production sans `µrefresh` ni mise à jour fine, donc sans leurs blocs `<refresh>` et
// `<fine-grained>` (bundler/index.ts) ; puis, pour chaque bloc `<x>` qui a une forme `<no-x>`, ce bloc retiré et sa forme reprise, avec les formes `<no-y>` que
// celle-ci contient (une passe de plus par niveau)
const noForms  = (text: string): Set<string> => new Set([...text.matchAll(/^[ \t]*\/\/ <no-([a-z][a-z0-9-]*)>$/gm)].map((m) => m[1]))
const variants = (text: string): Array<[string, string]> => {
  const out: Array<[string, string]> = [['<no-redraw>, <clock>', projectBlocks(projectPrecision(text, false, false), { 'refresh': false, 'fine-grained': false })]]
  const top                          = noForms(text)
  for (const name of top) {
    // `<no-redraw>` ne se reprend que par la projection de l'horloge, plus haut
    if (name === 'redraw') continue
    let variant = projectBlocks(text, { [name]: false })
    for (let pass = 0; pass < 3; pass++) {
      const inner = [...noForms(variant)].filter((n) => !top.has(n))
      if (inner.length === 0) break
      variant = projectBlocks(variant, Object.fromEntries(inner.map((n) => [n, false])))
    }
    out.push([`<no-${name}>`, variant])
  }
  return out.filter(([, variant]) => variant !== text)
}

describe('cœur : ses formes écrites en commentaire, reprises par la construction, ne nomment aucune variable inconnue', function () {
  this.timeout(180000)

  it('chaque fichier du cœur, chacune de ses formes reprise, passe la règle no-undef du lint du cœur', async () => {
    const eslint  = new ESLint({ cwd: ROOT })
    const unknown = [] as string[]
    let linted    = 0
    for (const path of files(RUNTIME)) {
      for (const [form, variant] of variants(readFileSync(path, 'utf-8'))) {
        linted++
        const [result] = await eslint.lintText(variant, { filePath: path })
        const lines    = variant.split('\n')
        for (const m of result.messages) if (m.ruleId === 'no-undef') unknown.push(`${relative(RUNTIME, path)} ${form} : ${m.message} — ${lines[m.line - 1].trim().slice(0, 160)}`)
      }
    }
    assert.ok(linted >= 30, `trop peu de formes en commentaire relues : ${linted}`)
    assert.deepEqual(unknown, [], 'noms inconnus dans les formes reprises')
  })
})
