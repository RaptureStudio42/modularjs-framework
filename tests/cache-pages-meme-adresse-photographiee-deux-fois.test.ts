// Cache des pages (`µ.LRUCache`, `µ.pageCache`) : une adresse photographiée une seconde fois (formulaire GET renvoyé
// vers l'adresse courante, par exemple) remplace la photo précédente. Défaut garanti absent : l'ancienne page sortait
// du cache sans être détruite — ses composants gardaient leurs minuteries pour toute la session, injoignables.
// Le remplacement passe donc par `onEvict`, comme une éviction, sauf pour ce que la nouvelle photo garde : une page
// revenue du cache puis photographiée de nouveau (mêmes nœuds, liste neuve) reste vivante et parquée.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { monterHote, pause, attendre } from './helpers/coeur-monter.js'

// valeur venue de la fenêtre happy-dom (autre contexte JS) : recopiée en objets ordinaires pour la comparaison
const brut = (x: any) => JSON.parse(JSON.stringify(x))

const ICI = dirname(fileURLToPath(import.meta.url))
const RT  = join(ICI, '../src/runtime/')

const PAGE = `
<script>
@n = 0
µevery 20, ->
  @n = @n + 1
</script>
<p>page</p>
`

describe('cache des pages — une adresse photographiée deux fois', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    ({ window } = await monterHote(PAGE, 'cache-meme-adresse'))
    if (!window.eval('typeof µ.LRUCache === "function"')) window.eval(readFileSync(RT + 'mjs_page_cache.ts', 'utf-8'))
    if (!window.eval('typeof µ._mjs_navHibernate === "function"')) window.eval(readFileSync(RT + 'mjs_ujs.ts', 'utf-8'))
  })

  it('LRUCache.set sur une clé prise : onEvict reçoit l’ancienne valeur, moins ce que la nouvelle garde', () => {
    const r = window.eval(`(function() {
      var ev = [];
      var c = new µ.LRUCache(10);
      c.onEvict = function(k, v) { ev.push(k + '=' + JSON.stringify(v)); };
      c.set('k', 'x'); c.set('k', 'y');
      c.set('/p', ['a', 'b']); c.set('/p', ['a', 'c']);
      var meme = ['z']; c.set('/m', meme); c.set('/m', meme);
      var avantDelete = ev.slice();
      c.delete('/p');
      return { avantDelete: avantDelete, apresDelete: ev.slice(avantDelete.length), taille: c.size };
    })()`)
    assert.deepEqual(brut(r), { avantDelete: ['k="x"', '/p=["b"]'], apresDelete: ['/p=["a","c"]'], taille: 2 })
  })

  it('la page photographiée la première fois est détruite quand la même adresse est photographiée de nouveau', async () => {
    const doc  = window.document
    const zone = doc.createElement('div')
    doc.body.appendChild(zone)
    zone.innerHTML = '<mjs-hote></mjs-hote>'
    const page = zone.firstElementChild
    await attendre(() => page.n > 0)
    window.µ._mjs_navHibernate(zone, '/p')          // départ : la page est photographiée
    zone.replaceChildren(doc.createElement('p'))    // la réponse remplace le contenu, la page est parquée
    await pause(60)
    window.µ._mjs_navHibernate(zone, '/p')          // nouveau départ depuis la même adresse
    zone.replaceChildren(doc.createElement('p'))
    await pause(40)
    const fige = page.n
    await pause(150)
    assert.equal(window.µ.pageCache.get('/p').indexOf(page), -1, 'la première photo a quitté le cache')
    assert.equal(page.n, fige, `la minuterie de la page sortie du cache est arrêtée (${fige} → ${page.n})`)
  })

  it('une page revenue du cache puis photographiée de nouveau reste vivante et parquée', async () => {
    const doc  = window.document
    const zone = doc.createElement('div')
    doc.body.appendChild(zone)
    zone.innerHTML = '<mjs-hote></mjs-hote>'
    const page = zone.firstElementChild
    await attendre(() => page.n > 0)
    window.µ._mjs_navHibernate(zone, '/r')          // départ de /r
    zone.replaceChildren(doc.createElement('p'))
    await pause(40)
    const photo = window.µ.pageCache.get('/r')      // retour sur /r : la page revient telle quelle, sa photo reste
    zone.replaceChildren(...photo)
    for (const n of photo) if (n.nodeType === 1) n._mjs_page_cached = false
    await pause(40)
    window.µ._mjs_navHibernate(zone, '/r')          // nouveau départ de /r : mêmes nœuds, liste neuve
    zone.replaceChildren(doc.createElement('p'))
    await pause(60)
    const avant = page.n
    await pause(150)
    assert.ok(window.µ.pageCache.get('/r').indexOf(page) >= 0, 'la page est toujours dans le cache')
    assert.equal(page._mjs_page_cached, true, 'la page reste marquée comme parquée')
    assert.ok(page.n > avant, `la page parquée n’est pas détruite : sa minuterie tourne (${avant} → ${page.n})`)
  })
})
