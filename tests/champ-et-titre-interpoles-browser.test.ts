// `<textarea>{$v}</textarea>` et `<title>{$v}</title>` : le navigateur lit le contenu de ces balises comme du texte, sans
// balise. L'interpolation se lie donc au texte de l'élément : la valeur au premier rendu, la nouvelle quand `$v` change,
// dans une ligne de `{for}` comme à la racine, et dans la page que rend le serveur.
//
// Défaut : l'interpolation y posait le marqueur de nœud texte des autres balises, que le navigateur écrivait tel quel :
// le champ affichait `<script type='mjs/marker' mjs-t='t1'></script>` au lieu de la valeur, avant comme après le
// changement, sans erreur. happy-dom lit ce marqueur comme une balise : seul un vrai navigateur montre le défaut.

import assert from 'node:assert/strict'
import { monterComposants, VISITER, type Composants } from './helpers/composants-navigateur.js'

const COMPOSANT = `<script>
$v = 'un'
$liste = ['a']
</script>
<div>
<textarea aria-label="a" class="ta">{$v}</textarea>
<textarea aria-label="c" class="tc">Bonjour &amp; {$v} !</textarea>
<title class="ti">{$v}</title>
{for x in $liste}<textarea aria-label="l" class="tl">{x}-{$v}</textarea>{end}
<button class="go" @click={-> $v = 'trois'}>go</button>
<p class="p">{$v}</p>
</div>
`

// valeur de chaque champ et texte du titre, ombres comprises
const LIRE = `${VISITER}
(() => {
  const r = {}
  visiter(document, (racine) => {
    for (const k of ['ta', 'tc', 'tl']) { const e = racine.querySelector('.' + k); if (e) r[k] = e.value }
    const t = racine.querySelector('.ti')
    if (t) r.ti = t.textContent
  })
  return r
})()`

describe('<textarea> et <title> : une interpolation se lie au texte de l\'élément (Chromium réel)', function () {
  this.timeout(180000)
  let composants: Composants | null = null

  before(async function () {
    composants = await monterComposants({ 'champ-titre': COMPOSANT })
    if (!composants) this.skip()
  })

  after(async () => {
    if (composants) await composants.fermer()
  })

  it('client seul : la valeur au premier rendu, puis la nouvelle après le changement', async function () {
    const p = await composants!.client('champ-titre', '.p')
    try {
      assert.deepEqual(await p.evaluate(LIRE), { ta: 'un', tc: 'Bonjour & un !', ti: 'un', tl: 'a-un' })
      await p.evaluate(`document.querySelector('mjs-champ-titre')._shadow.querySelector('.go').click()`)
      await p.waitForTimeout(120)
      assert.deepEqual(await p.evaluate(LIRE), { ta: 'trois', tc: 'Bonjour & trois !', ti: 'trois', tl: 'a-trois' })
    }
    finally { await p.close() }
  })

  for (const moteur of ['happy', 'navigateur'] as const) {
    it(`page rendue par le serveur (${moteur}) : la valeur, jamais le marqueur`, async function () {
      const html = composants!.serveur[moteur]['champ-titre']
      assert.doesNotMatch(html, /mjs\/marker[^>]*>(?:<\/script>|&lt;\/script&gt;)?\s*<\/(?:textarea|title)>/)
      const p = await composants!.photo(html)
      try {
        assert.deepEqual(await p.evaluate(LIRE), { ta: 'un', tc: 'Bonjour & un !', ti: 'un', tl: 'a-un' })
      }
      finally { await p.close() }
    })
  }
})
