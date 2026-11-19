// l'atelier des thèmes (/__mjs/theme) montre le texte d'un refus d'écriture par le motif que le serveur renvoie (`reason`) : sa table
// des motifs (REASONS, theme-viewer.mjs) doit porter exactement les motifs que le serveur émet (rewriteThemeValue, theme-write.ts, et
// le point d'écriture, server/index.ts) ; un motif que la table ne connaît pas s'affiche tel quel, en code, à la place du texte

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rewriteThemeValue } from '../src/server/theme-write.js'
import { t, getMessagesLang, setMessagesLang } from '../src/messages/index.js'

const SERVER = new URL('../src/server/', import.meta.url)
const VIEWER = readFileSync(new URL('theme-viewer.mjs', SERVER), 'utf8')

// les clés de la table REASONS de la visionneuse, avec le libellé que chacune nomme (`⟪theme.pattern-…⟫`)
function viewerReasons(): Map<string, string> {
  const block = /^REASONS := \{\n([\s\S]*?)\n\}/m.exec(VIEWER)
  assert.ok(block, 'table REASONS introuvable dans theme-viewer.mjs')
  const out = new Map<string, string>()
  for (const line of block[1].split('\n')) {
    const m = /^\s*'?([\w-]+)'?:\s*⟪([\w.-]+)⟫\s*$/.exec(line)
    assert.ok(m, `ligne illisible de REASONS : « ${line} »`)
    out.set(m[1], m[2])
  }
  return out
}

// les motifs que le serveur peut renvoyer : ceux de la réécriture (type de son résultat) et ceux du point d'écriture
function serverReasons(): Set<string> {
  const write = readFileSync(new URL('theme-write.ts', SERVER), 'utf8')
  const union = /^\s*reason: ((?:'[\w-]*'(?: \| )?)+)\s*$/m.exec(write)
  assert.ok(union, 'type des motifs introuvable dans theme-write.ts')
  const index = readFileSync(new URL('index.ts', SERVER), 'utf8')
  const all   = [...union[1].matchAll(/'([\w-]*)'/g), ...index.matchAll(/written: false, reason: '([\w-]+)'/g)].map(m => m[1]).filter(r => r !== '')
  assert.ok(all.length >= 6, `garde muette : le serveur émet plusieurs motifs (${all.join(', ')})`)
  return new Set(all)
}

describe('atelier des thèmes : la visionneuse connaît chaque motif de refus que le serveur renvoie', () => {
  it('mêmes motifs des deux côtés, chacun avec son texte en français et en anglais', () => {
    const viewer = viewerReasons()
    const server = serverReasons()
    assert.deepEqual([...server].filter(r => !viewer.has(r)).sort(), [], 'motifs du serveur sans texte dans la visionneuse')
    assert.deepEqual([...viewer.keys()].filter(r => !server.has(r)).sort(), [], 'motifs de la visionneuse que le serveur n\'émet pas')
    const lang = getMessagesLang()
    try {
      for (const l of ['fr', 'en']) {
        setMessagesLang(l)
        for (const [reason, label] of viewer) {
          const text = t('viewer.' + label)
          assert.ok(text !== '' && text !== 'viewer.' + label, `${reason} (${l}) : libellé viewer.${label} sans texte`)
        }
      }
    }
    finally {
      setMessagesLang(lang)
    }
  })

  it('une déclaration absente du fichier : le motif renvoyé a son texte dans la visionneuse', () => {
    const out = rewriteThemeValue(':root {\n  --mjs-autre: #000;\n}\n', 'accent', 'mjs', '#fff')
    assert.equal(out.ok, false)
    assert.ok(viewerReasons().has(out.reason), `motif « ${out.reason} » inconnu de la visionneuse`)
  })
})
