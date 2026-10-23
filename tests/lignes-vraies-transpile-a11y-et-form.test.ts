// Les avertissements d'accessibilité et de <form> sans action citent la ligne du FICHIER, même quand le HTML du
// composant commence après des lignes vides : `transpile` passe aux deux contrôles la ligne où le HTML commence.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

function avertissements(source: string): string[] {
  const vus: string[] = []
  const warn = console.warn
  console.warn = (...args: unknown[]) => { vus.push(args.map(String).join(' ')) }
  try { transpile(source, { moduleName: 'lv' }) }
  finally { console.warn = warn }
  return vus
}

describe('lignes vraies après des lignes vides en tête — transpile', () => {
  it('<img> sans alt à la ligne 4 : un seul [lint.a11y], qui cite la ligne 4', () => {
    const vus = avertissements('\n\n\n<img src="a.png">\n').filter(m => m.includes('[lint.a11y]'))
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /ligne 4/)
  })

  it('<form> sans action à la ligne 4 : un seul avertissement, qui cite la ligne 4 (lv:4)', () => {
    const vus = avertissements('\n\n\n<form></form>\n').filter(m => m.includes('[lint.ujsForm]'))
    assert.equal(vus.length, 1, vus.join('\n'))
    assert.match(vus[0], /lv:4\b/)
  })
})
