// page servie : les composants que la première vue d'un hôte servi recrée au navigateur reprennent la valeur rangée par le serveur ;
// un composant que le navigateur crée ENSUITE sous ce même hôte (un clic), pendant qu'un composant servi de même clé attend encore son
// réveil, appelle sa fonction ; le servi réveillé tard prend la valeur, un composant créé hors de l'hôte appelle

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { servir, reprendre, appels } from './helpers/derivee-await-serveur.js'
import { pause } from './helpers/derivee-await-banc.js'

const SOURCES: Record<string, string> = {
  'x-fiche.mjs': `<script>
  charger = (id) ->
    (globalThis.__appels ||= []).push('f:' + id)
    Promise.resolve('N' + id + (if µ.server then '-serveur' else '-navigateur'))
  $fiche = await charger($num)
</script>
<i>{$fiche}</i>
`,
  'x-hote.mjs': `<script>
  $plus = false
</script>
<@x-fiche class="a" num="7"></@x-fiche>
<@x-fiche class="b" num="7"></@x-fiche>
<button @click={$plus = true}>plus</button>
{if $plus}<@x-fiche class="d" num="7"></@x-fiche>{end}
`,
  'x-tout.mjs': `<@x-hote></@x-hote>\n<@x-fiche class="c" num="7"></@x-fiche>\n`
}

const racine = (e: any) => e && (e._shadow || e.shadowRoot)
// le texte de chaque fiche de la page, par sa classe
function textes(w: any): Record<string, string> {
  const out: Record<string, string> = {}
  const fouille = (r: any) => r.querySelectorAll('*').forEach((e: any) => {
    if (e.localName === 'mjs-x-fiche') out[e.className] = racine(e)?.querySelector('i')?.textContent ?? '∅'
    if (racine(e)) fouille(racine(e))
  })
  fouille(w.document)
  return out
}

describe('dérivée qui attend — composant créé ensuite sous un hôte servi', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('la première vue reprend, le composant créé par un clic appelle, le servi réveillé tard reprend', async () => {
    const { graine } = await servir('await-hote-servi', SOURCES, 'mjs-x-tout')
    assert.ok(graine && Object.keys(graine).length === 1, 'une valeur rangée — ' + JSON.stringify(graine))
    const w = await reprendre('await-hote-servi-nav', SOURCES, graine, '<mjs-x-hote mjs-ssr></mjs-x-hote>')
    const vu: any = { premiere: textes(w), appels0: appels(w) }
    racine(w.document.querySelector('mjs-x-hote')).querySelector('button').click()
    await pause(150)
    vu.d = textes(w).d
    w.document.body.insertAdjacentHTML('beforeend', '<mjs-x-fiche class="c" num="7" mjs-ssr></mjs-x-fiche>')
    await pause(150)
    vu.c = textes(w).c
    w.document.body.insertAdjacentHTML('beforeend', '<mjs-x-fiche class="e" num="7"></mjs-x-fiche>')
    await pause(150)
    vu.e = textes(w).e
    vu.appels = appels(w)
    w.close()
    assert.deepEqual({ a: vu.premiere.a, b: vu.premiere.b, appels0: vu.appels0 }, { a: 'N7-serveur', b: 'N7-serveur', appels0: [] }, 'la première vue de l\'hôte servi reprend la valeur')
    assert.equal(vu.d, 'N7-navigateur', 'le composant créé par le clic appelle')
    assert.equal(vu.c, 'N7-serveur', 'le servi réveillé tard reprend la valeur')
    assert.equal(vu.e, 'N7-navigateur', 'le composant créé hors de l\'hôte appelle')
    assert.deepEqual(vu.appels, ['f:7', 'f:7'])
  })
})
