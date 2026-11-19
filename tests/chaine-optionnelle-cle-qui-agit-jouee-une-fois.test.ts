// `$l[$i++]?.push(1)` : une clé qui agit (ici `$i++`) dans une chaîne optionnelle est jouée une seule fois, comme en JavaScript ;
// l'élément qu'elle vise reçoit la valeur, et l'écran le montre. Vraie construction, mode strict

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterStrict } from './helpers/construction-stricte.js'
import { attendreEgal } from './helpers/attendre.js'

const CHAINE = `<script lang="js">
$l = [[], []];
$i = 0;
this.f = function() { $l[$i++]?.push(1); };
</script>
<p>{$i}-{$l[0].length}-{$l[1].length}</p>
`

describe('clé qui agit dans une chaîne optionnelle (`$l[$i++]?.push(1)`) : jouée une fois, le bon élément écrit', function () {
  this.timeout(120000)
  let page: any

  before(async () => {
    page = await monterStrict('chaine-cle-qui-agit', { 'chaine-cle': CHAINE })
  })

  after(async () => {
    await page?.window.happyDOM.close()
    await terminateSharedWorkerPool()
  })

  it('un appel : `$i` vaut 1, le premier élément reçoit la valeur, le second reste vide, l\'écran le montre', async () => {
    const e = page.window.document.querySelector('mjs-chaine-cle')
    assert.equal(e._shadow.querySelector('p').textContent, '0-0-0')
    e.f()
    await attendreEgal(() => ({ i: e._state.i, l: JSON.stringify(e._state.l), ecran: e._shadow.querySelector('p').textContent }), { i: 1, l: '[[1],[]]', ecran: '1-1-0' }, 'clé jouée une fois, puis écran', 2000)
  })
})
