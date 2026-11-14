// `docs/llms.txt` : le sommaire de la documentation pour les assistants d'IA (format https://llmstxt.org/ : un titre `#`, un
// résumé `>`, des sections `##` de liens `- [titre](page): détail`), livré dans le paquet avec la doc de la version installée.
// Une page de `docs/` absente du sommaire, ou un lien vers une page qui n'existe plus, fait échouer ce test : le sommaire
// suit la doc. `docs/llms-small.txt`, sa version courte, ne lie que des pages du sommaire et reste plus court que lui

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DOCS  = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs')
const PAGES = readdirSync(DOCS).filter((f) => f.endsWith('.md')).sort()

// les liens `- [titre](page): détail` d'un fichier au format llms.txt, dans l'ordre
function links(text: string): { title: string, page: string, detail: string }[] {
  return [...text.matchAll(/^- \[([^\]]+)\]\(([^)\s#]+)(?:#[^)\s]*)?\)(?:: (.*))?$/gm)].map((m) => ({ title: m[1], page: m[2], detail: m[3] ?? '' }))
}

function read(name: string): string {
  const path = join(DOCS, name)
  assert.ok(existsSync(path), `docs/${name} existe`)
  return readFileSync(path, 'utf8')
}

describe('docs/llms.txt : le sommaire de la doc pour les assistants d\'IA', () => {
  it('suit le format llms.txt : un titre, un résumé, des sections de liens', () => {
    const text  = read('llms.txt')
    const lines = text.split('\n')
    assert.match(lines[0], /^# \S/, 'première ligne : le titre')
    assert.equal(lines.filter((l) => /^# /.test(l)).length, 1, 'un seul titre de niveau 1')
    const summary = lines.findIndex((l) => /^> \S/.test(l))
    const section = lines.findIndex((l) => /^## \S/.test(l))
    assert.ok(summary > 0 && section > summary, 'le résumé suit le titre, avant la première section')
    assert.ok(text.endsWith('\n'), 'saut de ligne final')
    for (const l of lines.slice(section)) {
      if (l.startsWith('- ')) assert.match(l, /^- \[[^\]]+\]\([^)\s]+\): \S/, `lien au format « - [titre](page): détail » : ${l}`)
    }
  })

  it('chaque page de docs/ y est, une seule fois', () => {
    const pages   = links(read('llms.txt')).map((l) => l.page)
    const absents = PAGES.filter((p) => !pages.includes(p))
    assert.deepEqual(absents, [], 'pages de docs/ absentes de llms.txt')
    const doubles = pages.filter((p, i) => pages.indexOf(p) !== i)
    assert.deepEqual(doubles, [], 'pages citées deux fois')
  })

  it('chaque lien mène à une page qui existe', () => {
    const morts = links(read('llms.txt')).map((l) => l.page).filter((p) => !PAGES.includes(p))
    assert.deepEqual(morts, [], 'liens vers une page absente de docs/')
  })

  it('llms-small.txt, la version courte : même format, des pages du sommaire seulement, plus courte', () => {
    const small = read('llms-small.txt')
    const full  = read('llms.txt')
    assert.match(small.split('\n')[0], /^# \S/, 'première ligne : le titre')
    assert.match(small, /^> \S/m, 'un résumé')
    const pages = links(small).map((l) => l.page)
    assert.ok(pages.length >= 5, `au moins cinq pages à lire d'abord (${pages.length})`)
    const horsSommaire = pages.filter((p) => p !== 'llms.txt' && !links(full).some((l) => l.page === p))
    assert.deepEqual(horsSommaire, [], 'pages de la version courte absentes du sommaire')
    assert.deepEqual(pages.filter((p) => p !== 'llms.txt' && !PAGES.includes(p)), [], 'liens morts')
    assert.ok(small.length < full.length / 2, `plus courte que la moitié du sommaire (${small.length} contre ${full.length} octets)`)
  })
})
