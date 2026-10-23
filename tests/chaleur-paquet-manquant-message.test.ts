// *heatmap sur un serveur qui n'a pas le paquet heatmapPackage : le serveur répond « type inconnu », l'effet le dit une
// fois en console, avec la ligne à ajouter — qui doit marcher : heatmapPackage() sans `origins` refuse de démarrer,
// le conseil porte donc la liste des origines. *follow de même : followPackage() sans `canLead` donne un serveur où
// personne ne mène, le conseil dit donc qui peut mener. Les autres paquets (cursorsPackage…) gardent leur conseil
// sans réglage.

import assert from 'node:assert/strict'
import { visite, attendre, tick, lire } from './helpers/chaleur-visite.js'

describe('*heatmap — le paquet heatmapPackage manque côté serveur', function () {
  this.timeout(20000)

  it('l\'effet le dit une fois, avec app.use(heatmapPackage({ origins: [\'https://monsite.fr\'] }))', async () => {
    const v = await visite({ sansPaquet: true })
    v.pose(v.el)
    v.clic(0)
    await attendre(() => v.erreurs.length > 0, 3000)
    assert.equal(v.erreurs.length, 1, JSON.stringify(v.erreurs))
    assert.match(v.erreurs[0], /\*heatmap[\s\S]*heatmap:point[\s\S]*heatmapPackage/)
    assert.ok(v.erreurs[0].includes('app.use(heatmapPackage({ origins: [\'https://monsite.fr\'] }))'), v.erreurs[0])
    assert.ok(!v.erreurs[0].includes('heatmapPackage())'), 'plus le conseil qui lève : ' + v.erreurs[0])
    await tick(150)
    v.clic(1)
    await tick(300)
    assert.equal(v.erreurs.length, 1, 'une seule fois')
    await v.fermer()
  })

  it('*follow : le conseil dit qui peut mener — app.use(followPackage({ canLead: (client) => … }))', async () => {
    const v = await visite({ sansPaquet: true })
    new Function('µ', 'document', 'location', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', lire('mjs_fx_follow.ts'))(v.µ, v.document, { pathname: '/', hash: '' }, v.window, () => 0, () => {})
    const stop = v.µ._mjs_fxDefs.follow.setup(v.el, { sock: v.sock })
    v.sock.send('follow:at', { room: '/', a: [0], y: 0 })
    await attendre(() => v.erreurs.length > 0, 3000)
    await tick(50)
    assert.equal(v.erreurs.length, 1, JSON.stringify(v.erreurs))
    assert.match(v.erreurs[0], /\*follow[\s\S]*follow:[\s\S]*followPackage/)
    assert.ok(v.erreurs[0].includes('app.use(followPackage({ canLead: (client) => … }))'), v.erreurs[0])
    assert.ok(!v.erreurs[0].includes('followPackage())'), 'plus le conseil où personne ne mène : ' + v.erreurs[0])
    stop()
    await v.fermer()
  })

  it('un autre paquet garde son conseil sans réglage : app.use(cursorsPackage())', async () => {
    const v = await visite({ sansPaquet: true })
    v.µ._mjs_fxPackage(v.sock, 'cursors:', '*cursors', 'cursorsPackage')
    v.sock.connect()
    await tick(10)
    v.sock.send('cursors:move', { room: '/', p: null })
    await attendre(() => v.erreurs.length > 0, 3000)
    assert.equal(v.erreurs.length, 1)
    assert.ok(v.erreurs[0].includes('app.use(cursorsPackage())'), v.erreurs[0])
    await v.fermer()
  })
})
