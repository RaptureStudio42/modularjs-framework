// une clé des tables de messages (fr et en) que plus aucun code ne cite est une clé morte : un texte traduit pour rien, que la
// relecture des messages croit encore servi. Chaque clé est citée quelque part dans src/, bin/ ou script/, hors des tables.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fr } from '../src/messages/fr.js'
import { en } from '../src/messages/en.js'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')

function sources(dossier: string, out: string[] = []): string[] {
  for (const f of readdirSync(dossier)) {
    const p = join(dossier, f)
    if (statSync(p).isDirectory()) {
      if (f !== 'node_modules') sources(p, out)
    }
    else if (/\.(?:ts|mts|js|mjs|cjs)$/.test(f) && !p.includes(join('src', 'messages') + '/')) out.push(p)
  }
  return out
}

describe('messages : aucune clé morte', function () {
  this.timeout(60000)
  const code  = [...sources(join(RACINE, 'src')), ...sources(join(RACINE, 'bin')), ...sources(join(RACINE, 'script'))].map(f => readFileSync(f, 'utf8')).join('\n')
  // les textes entre guillemets ou accents graves du code, relevés une fois ; une clé absente de ce relevé est cherchée telle quelle
  // les visionneuses (server/*-viewer.mjs) citent `viewer.<cle>` par un repère ⟪cle⟫, cf. server/viewer-page.ts
  const cites = new Set([...[...code.matchAll(/['"`]([^'"`\s]+)['"`]/g)].map(m => m[1]), ...[...code.matchAll(/\u27ea([a-z0-9.-]+)\u27eb/g)].map(m => 'viewer.' + m[1])])
  const mortes = (cles: string[], texte: string) => cles.filter(k => !cites.has(k) && !texte.includes(`'${k}'`) && !texte.includes(`"${k}"`) && !texte.includes('`' + k + '`'))

  it('la garde voit une clé jamais citée', () => {
    assert.deepEqual(mortes(['effets.cle-jamais-citee', 'effets.inconnu'], code), ['effets.cle-jamais-citee'])
  })

  it('chaque clé de fr est citée par le code', () => {
    assert.deepEqual(mortes(Object.keys(fr), code), [])
  })

  it('chaque clé de en est citée par le code', () => {
    assert.deepEqual(mortes(Object.keys(en), code), [])
  })
})
