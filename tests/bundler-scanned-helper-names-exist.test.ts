// le relevé des signaux du build (src/bundler/) cherche les aides du cœur dans le code compilé par des expressions régulières, dont certaines
// partagent un début de nom (`\._mjs_deep(?:Safe|Key|Name|Meme)\(`) : chaque nom que ces alternances forment est écrit dans le cœur ou dans
// le compilateur. Un nom changé d'un seul côté y passe inaperçu : le module qui porte l'aide n'est plus pris, et la construction de production
// refuse un cœur incomplet (exemple : une appli qui lit `$[$k]`), ou garde un bloc pour rien

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src', import.meta.url))

const files = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    const path = join(dir, f)
    if (statSync(path).isDirectory()) files(path, out)
    else if (/\.(?:ts|mjs)$/.test(f)) out.push(path)
  }
  return out
}

describe('construction : les noms d\'aides que le relevé cherche par morceaux existent', () => {
  it('chaque nom formé par une alternance `_mjs_<début>(?:a|b)<fin>` de src/bundler/ est écrit dans le cœur ou le compilateur', () => {
    const written = ['runtime', 'generator', 'transpiler', 'core-modules'].flatMap((d) => files(join(SRC, d))).map((p) => readFileSync(p, 'utf-8')).join('\n')
    const formed  = new Map<string, string[]>()
    for (const path of files(join(SRC, 'bundler'))) {
      readFileSync(path, 'utf-8').split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/_mjs_([A-Za-z0-9]*)\(\?:([A-Za-z0-9_|]+)\)([A-Za-z0-9]*)/g)) {
          for (const alt of m[2].split('|')) {
            const name = '_mjs_' + m[1] + alt + m[3]
            formed.set(name, [...formed.get(name) ?? [], relative(SRC, path) + ':' + (i + 1)])
          }
        }
      })
    }
    assert.ok(formed.size >= 20, `relevé trop maigre : ${formed.size} noms formés`)
    const missing = [...formed].filter(([name]) => !new RegExp(`\\b${name}\\b`).test(written)).map(([name, where]) => `${name} (${where.join(', ')})`)
    assert.deepEqual(missing, [], 'noms formés par le relevé, écrits nulle part dans le cœur ni le compilateur')
  })
})
