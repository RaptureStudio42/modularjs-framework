// La documentation vouvoie, comme les messages et le tuto : aucun chapitre de `docs/`, ni les README, ni le
// CHANGELOG ne dit « tu » au lecteur. Relevé dans la prose seule — un exemple de code peut nommer une
// variable `$ton` — ; « le ton d'un message » est un nom, pas un possessif.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT  = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILES = [...readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).sort().map((f) => join('docs', f)), 'README.md', 'CHANGELOG.md', join('editors', 'vscode', 'README.md')]

// tu, te, toi, ta, tes, ton (sauf « le ton », « un ton »…), t' devant un mot, -toi, -tu
const TU = /(?<![\p{L}'’-])(tu|te|ta|tes)(?![\p{L}'’-])|(?<![\p{L}'’-])toi(?![\p{L}'’])|(?<![\p{L}'’-])(?<!(?<!\p{L})(?:le|un|ce|du|au|même)\s)ton(?![\p{L}'’-])|(?<!\p{L})t['’](?=\p{L})|-(?:toi|tu)(?!\p{L})/iu

// la prose d'un fichier Markdown, ligne par ligne : sans les blocs de code ni le code en ligne
function prose(text: string): [number, string][] {
  const out: [number, string][] = []
  let code = false
  text.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) code = !code
    else if (!code) out.push([i + 1, line.replace(/`[^`]*`/g, '`…`').replace(/<code>[\s\S]*?<\/code>/g, '…')])
  })
  return out
}

describe('documentation : vouvoiement', () => {
  for (const file of FILES) {
    it(`${file} ne tutoie pas`, () => {
      const hits = prose(readFileSync(join(ROOT, file), 'utf8')).filter(([, line]) => TU.test(line)).map(([n, line]) => `${n}: ${line.trim().slice(0, 100)}`)
      assert.deepEqual(hits, [])
    })
  }
})
