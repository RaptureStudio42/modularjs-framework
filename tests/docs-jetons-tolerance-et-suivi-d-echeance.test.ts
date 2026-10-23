// Documentation des jetons : un exemple qui donne une tolérance d'horloge (`clockTolerance`, en secondes) à la vérification
// d'une appli mjsWs donne aussi au suivi de l'échéance (`token.slack`, en millisecondes) au moins la même. Sans elle, un
// jeton accepté de justesse au hello est fermé au balayage suivant (src/mjs-ws/core.ts, sweepExpiredTokens) : l'exemple
// recopié tel quel couperait des visiteurs. Relevé dans chaque bloc de code des chapitres de `docs/`.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT  = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILES = readdirSync(join(ROOT, 'docs')).filter(f => f.endsWith('.md')).sort()

// blocs de code d'un fichier Markdown, avec la ligne de leur ouverture
function blocks(text: string): Array<{ line: number; code: string }> {
  const out: Array<{ line: number; code: string }> = []
  let open: { line: number; lines: string[] } | null = null
  text.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      if (open) { out.push({ line: open.line, code: open.lines.join('\n') }); open = null }
      else open = { line: i + 1, lines: [] }
    }
    else if (open) open.lines.push(line)
  })
  return out
}

// un exemple mjsWs dont la tolérance d'horloge dépasse le suivi de l'échéance (`token.slack`, 5000 ms sans réglage)
function slackTooShort(code: string): boolean {
  const tolerance = /clockTolerance:\s*(\d+)/.exec(code)
  if (!tolerance || !/\bmjsWs\(/.test(code)) return false
  const slack = /\bslack:\s*(\d+)/.exec(code)
  return (slack ? Number(slack[1]) : 5000) < Number(tolerance[1]) * 1000
}

describe('documentation : tolérance d\'horloge et suivi de l\'échéance des jetons', () => {
  it('la garde voit un exemple sans token.slack, ou avec un slack trop court, et laisse passer un exemple juste', () => {
    assert.equal(slackTooShort('const app = mjsWs({\n  auth: jwtAuth(S, { clockTolerance: 30 }),\n})'), true)
    assert.equal(slackTooShort('const app = mjsWs({\n  auth:  jwtAuth(S, { clockTolerance: 30 }),\n  token: { slack: 10000 },\n})'), true)
    assert.equal(slackTooShort('const app = mjsWs({\n  auth:  jwtAuth(S, { clockTolerance: 30 }),\n  token: { slack: 30000 },\n})'), false)
    assert.equal(slackTooShort('const app = mjsWs({\n  auth: jwtAuth(S, { clockTolerance: 5 }),\n})'), false, 'dans le slack par défaut')
    assert.equal(slackTooShort('verifyToken(jeton, S, { clockTolerance: 30 })'), false, 'hors de mjsWs, aucun suivi d\'échéance')
  })

  it('chaque exemple mjsWs qui pose clockTolerance donne à token.slack au moins la même tolérance', () => {
    const hits: string[] = []
    for (const file of FILES) {
      for (const { line, code } of blocks(readFileSync(join(ROOT, 'docs', file), 'utf8'))) {
        if (slackTooShort(code)) hits.push(`docs/${file}:${line}`)
      }
    }
    assert.ok(FILES.includes('23-mjs-ws.md') && FILES.includes('27-accounts.md'), 'chapitres des jetons et des comptes relevés')
    assert.deepEqual(hits, [])
  })
})
