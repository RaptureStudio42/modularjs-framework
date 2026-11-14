// une expression du gabarit qui commence par une regex se lit comme une regex : Civet lisait `(/abc/.test(x))` comme une section
// d'opérateur (l'écran montrait le texte d'une fonction), et un signe de MJS écrit dans la regex (`&id`, `§x`, `@@x`) en faisait
// un nom réécrit ; le texte de la regex reste celui écrit, caractère pour caractère. Composant bâti, monté dans happy-dom
import assert from 'node:assert/strict'
import { monterHote } from './helpers/coeur-monter.js'

const ETAT = "<script>\n$t = 'xabcx'\n$u = 'zzz'\n$ua = 'Mozilla desktop'\n$s = 'a§x@@x&id'\n$x = 3\n$actif = true\n</script>\n"

// écrit dans le gabarit → texte attendu à l'écran
const CAS: [string, string][] = [
  ["<p>{/abc/.test($t) ? 'oui' : 'non'}</p>", 'oui'],
  ["<p>{/abc/.test($u) ? 'oui' : 'non'}</p>", 'non'],
  ["<p>{/&id/.test($t) ? 'oui' : 'non'}</p>", 'non'],
  ["<p>{/^x/.test($t) ? 'oui' : 'non'}</p>", 'oui'],
  ["<p>{$u.match(/abc/) ? 'oui' : 'non'}</p>", 'non'],
  ["<p>{/mobile/i.test($ua) ? 'petit' : 'grand'}</p>", 'grand'],
  ["<p>{/&id/.test($s) ? 'oui' : 'non'}</p>", 'oui'],
  ["<p>{/§x/.test($s) ? 'oui' : 'non'}</p>", 'oui'],
  ["<p>{/@@x/.test($s) ? 'oui' : 'non'}</p>", 'oui'],
  ['{if /abc/.test($t)}\n  <p>si</p>\n{end}', 'si'],
  // les `<` et le `$x` de la regex restent des caractères (une comparaison chaînée hors regex, `0 < $x < 5`, ne se construit pas
  // dans une accolade de texte : défaut à part)
  ['<p>{/a < $x < b/.test($t) or $x > 2}</p>', 'true'],
  ["<p>{/a < $x < b/.test('a < $x < b') ? 'oui' : 'non'}</p>", 'non'],
  // un `if` ou un `unless` de fin : l'expression entière reste une valeur
  ['<p>{/b/.test($t) if $actif}</p>', 'true'],
  ['<p>{/b/.test($t) unless $actif}</p>', ''],
]

// regex en tête suivie d'une instruction : refus placé dans la source (fichier, ligne, colonne), jamais dans le code produit
const REFUS: string[] = [
  "<p>{/b/.test($t); 'x'}</p>",
  '<p>{/b/.test($t)\n$x}</p>',
]

function ecran(r: any): string {
  const ombre = r.hote._shadow ?? r.hote.shadowRoot ?? r.hote
  return String(ombre.textContent ?? '').trim()
}

describe('regex en tête d\'une expression du gabarit', () => {
  CAS.forEach(([gabarit, attendu], i) => {
    it(`${gabarit} affiche ${attendu}`, async function () {
      this.timeout(60000)
      const r = await monterHote(ETAT + gabarit + '\n', `regex-tete-${i}`)
      assert.equal(ecran(r), attendu)
      assert.equal(r.erreurs.length, 0, String(r.erreurs))
    })
  })

  REFUS.forEach((gabarit, i) => {
    it(`${JSON.stringify(gabarit)} est refusé à sa place dans la source`, async function () {
      this.timeout(60000)
      await assert.rejects(monterHote(ETAT + gabarit + '\n', `regex-tete-refus-${i}`), (e: any) => {
        const texte = String(e?.message ?? e)
        assert.doesNotMatch(texte, /esm-check|_mjs_upd/, texte)
        assert.match(texte, /hote\.mjs:\d+:\d+/, texte)
        return true
      })
    })
  })

  it('dans un attribut calculé : title={/abc/.test($t) ? …}', async function () {
    this.timeout(60000)
    const r     = await monterHote(ETAT + "<p title={/abc/.test($t) ? 'oui' : 'non'}>a</p>\n", 'regex-tete-attribut')
    const ombre = r.hote._shadow ?? r.hote.shadowRoot ?? r.hote
    assert.equal(ombre.querySelector('p')?.getAttribute('title'), 'oui')
  })
})
