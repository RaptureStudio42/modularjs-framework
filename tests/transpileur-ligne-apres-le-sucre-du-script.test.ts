// la ligne citée par un avertissement du <script> est celle du fichier : quand le compilateur a ajouté
// des lignes au script avant de le compiler (la déclaration de `µ$u`, une variable posée dans les deux
// branches d'un if/else, hissée en tête), la carte de source ne dit plus la ligne écrite ; la ligne n'est
// alors pas citée plutôt que fausse

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

// la ligne citée par l'avertissement `[lint.naming]` d'un `@title = …` : un numéro, ou null sans ligne
async function ligneCitee(script: string): Promise<number | null> {
  const orig = console.warn
  const vus: string[] = []
  console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
  try { await transpile(`<script>\n${script}\n</script>\n<p>x</p>\n`, { moduleName: 'carte' }) } finally { console.warn = orig }
  const naming = vus.filter(m => m.includes('[lint.naming]'))
  assert.equal(naming.length, 1, naming.join(' | '))
  const m = /\(ligne (\d+)\)/.exec(naming[0])
  return m ? Number(m[1]) : null
}

describe('ligne citée quand le compilateur a ajouté des lignes au script', () => {
  it('µ$u = 1 avant @title : la ligne 4 du fichier, ou aucune — jamais la 5', async () => {
    assert.ok([null, 4].includes(await ligneCitee('µ$u = 1\n$a = 1\n@title = \'x\'')))
  })

  it('une variable posée dans les deux branches d\'un if/else : la ligne 7 du fichier, ou aucune — jamais la 8', async () => {
    assert.ok([null, 7].includes(await ligneCitee('$a = 1\nif $a\n  v = 1\nelse\n  v = 2\n@title = \'x\'')))
  })

  it('sans ligne ajoutée, la ligne du fichier est citée', async () => {
    assert.equal(await ligneCitee('$n = 1\n$m = 2\n@title = \'x\''), 4)
    assert.equal(await ligneCitee('# un commentaire\n\n$n = 1\n@title = \'x\''), 5)
  })
})
