// Références numériques que le parseur HTML ne rend pas telles quelles (standard HTML, fin d'une référence numérique) :
// `&#0;` et une demi-paire de substitution (`&#xD800;` à `&#xDFFF;`) deviennent U+FFFD ; `&#128;` à `&#159;` se lisent
// par la table windows-1252 (`&#128;` → €, `&#150;` → –), sauf les cinq codes qu'elle ne définit pas, gardés tels
// quels ; avec ou sans `;`. Le décodage du générateur (texte et attribut posés par la voie impérative, qui ne passent
// pas par le parseur du navigateur) rendait le caractère du code tel quel : U+0000, une demi-paire seule, un caractère
// de contrôle au lieu de €. Le test compare à la table du standard, puis au parseur de Chromium (`innerHTML`, puis
// `textContent` et `getAttribute`) quand il est installé.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { decodeHtmlEntities } from '../src/generator/utils.js'

// brut → ce que le standard HTML en fait
const CAS: Array<[string, string]> = [
  ['&#0;', '�'],
  ['&#0', '�'],
  ['&#x0;', '�'],
  ['a&#00b', 'a�b'],
  ['&#xD800;', '�'],
  ['&#xD800', '�'],
  ['&#55296;', '�'],
  ['&#xDFFF;', '�'],
  ['&#xD83D;&#xDE00;', '��'],
  ['&#128;', '€'],
  ['&#128', '€'],
  ['&#x80;', '€'],
  ['&#130;', '‚'],
  ['&#150; &#151;', '– —'],
  ['&#x9F;', 'Ÿ'],
  ['&#159', 'Ÿ'],
  ['&#129;', '\x81'],
  ['&#x8D;', '\x8D'],
  ['&#157;', '\x9D'],
  ['&#127;', '\x7F'],
  ['&#160;', '\xA0'],
  ['&#x1F600;', '\u{1F600}'],
  ['&#1114112;', '�'],
]

// les points de code d'une chaîne, lisibles dans un message d'échec
const codes = (s: string | null): string => s === null ? 'null' : [...s].map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(' ')

describe('références numériques comme le parseur HTML du navigateur', function () {
  this.timeout(60000)

  describe('table du standard', () => {
    for (const [brut, attendu] of CAS) {
      it(`${brut} → ${codes(attendu)}`, () => {
        assert.equal(codes(decodeHtmlEntities(brut, true)), codes(attendu), 'dans un texte')
        assert.equal(codes(decodeHtmlEntities(brut)), codes(attendu), 'dans un attribut')
      })
    }
  })

  describe('Chromium réel', function () {
    let browser: any = null
    let page: any = null

    before(async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright.chromium.executablePath())) {
        console.log('  ℹ️  chromium non installé, comparaison au navigateur sautée. Activer : `npx playwright install chromium`')
        this.skip()
      }
      browser = await playwright.chromium.launch()
      page    = await browser.newPage()
      await page.setContent('<!doctype html><html><body></body></html>')
    })

    after(async () => {
      if (browser) await browser.close()
    })

    it('texte et attribut : le générateur décode chaque cas comme le navigateur', async () => {
      const lus = await page.evaluate(`${JSON.stringify(CAS.map(([brut]) => brut))}.map((s) => {
        const d = document.createElement('div')
        d.innerHTML = s
        const texte = d.textContent
        d.innerHTML = '<p title="' + s + '"></p>'
        return [texte, d.firstChild.getAttribute('title')]
      })`) as Array<[string, string]>
      const ecarts: string[] = []
      CAS.forEach(([brut], i) => {
        const [texte, attribut] = lus[i]
        if (decodeHtmlEntities(brut, true) !== texte) ecarts.push(`texte ${brut} : navigateur ${codes(texte)}, générateur ${codes(decodeHtmlEntities(brut, true))}`)
        if (decodeHtmlEntities(brut) !== attribut) ecarts.push(`attribut ${brut} : navigateur ${codes(attribut)}, générateur ${codes(decodeHtmlEntities(brut))}`)
      })
      assert.deepEqual(ecarts, [])
    })
  })
})
