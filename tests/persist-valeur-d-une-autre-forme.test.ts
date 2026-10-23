// `@persist` : une valeur stockée d'une autre forme que la valeur de départ (laissée par une version précédente de
// l'appli : un objet là où la variable attend une liste, une liste là où elle attend un objet, ou `null`) est
// ignorée — la variable garde sa valeur de départ. Défaut garanti absent : la garde ne comparait que `typeof`,
// qui vaut 'object' pour une liste, un objet et `null` ; l'objet était repris tel quel (la boucle parcourait ses
// valeurs, la longueur restait vide) et un `null` stocké faisait planter le composant au premier rendu.
// Inchangé : une variable partie de `null` (rien encore) reprend un objet ou une liste stockés.

import assert from 'node:assert/strict'
import { monterHote, pause } from './helpers/coeur-monter.js'

// valeur venue de la fenêtre happy-dom (autre contexte JS) : recopiée en objets ordinaires pour la comparaison
const brut = (x: any) => JSON.parse(JSON.stringify(x))

const SOURCE = `
<script>
$items = []
$cfg = {mode: 'a'}
$user = null
@persist $items $cfg $user
</script>
<p class="n">{$items.length}:{for t in $items}<i>{t}</i>{end}</p>
<p class="c">{$cfg.mode}</p>
<p class="u">{$user ? $user.nom : '-'}</p>
`

describe('@persist — valeur stockée d’une autre forme que la valeur de départ', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    ({ window } = await monterHote(SOURCE, 'persist-autre-forme'))
  })

  async function monterAvec(items: string, cfg: string, user: string) {
    window.eval('globalThis.__erreurs.length = 0')
    window.localStorage.setItem('mjs-hote:items', items)
    window.localStorage.setItem('mjs-hote:cfg', cfg)
    window.localStorage.setItem('mjs-hote:user', user)
    window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
    await pause(150)
    const sh = window.document.querySelector('mjs-hote')._shadow
    const lire = (sel: string) => sh ? sh.querySelector(sel)?.textContent : '(pas d’ombre)'
    return { n: lire('.n'), c: lire('.c'), u: lire('.u'), erreurs: window.eval('globalThis.__erreurs').slice() }
  }

  it('objet stocké pour une liste, liste stockée pour un objet : ignorés, valeurs de départ gardées', async () => {
    const r = await monterAvec('{"a":1,"b":2}', '["x"]', 'null')
    assert.deepEqual(brut(r), { n: '0:', c: 'a', u: '-', erreurs: [] })
  })

  it('null stocké pour une liste et pour un objet : ignoré, pas de plantage', async () => {
    const r = await monterAvec('null', 'null', 'null')
    assert.deepEqual(brut(r), { n: '0:', c: 'a', u: '-', erreurs: [] })
  })

  it('valeurs de la bonne forme : reprises ; une variable partie de null reprend un objet', async () => {
    const r = await monterAvec('["x","y"]', '{"mode":"b"}', '{"nom":"Ana"}')
    assert.deepEqual(brut(r), { n: '2:xy', c: 'b', u: 'Ana', erreurs: [] })
  })
})
