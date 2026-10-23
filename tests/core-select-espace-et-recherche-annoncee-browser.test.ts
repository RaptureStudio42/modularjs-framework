// <@@select> en vrai navigateur, vraies touches : liste ouverte, Espace choisit la ligne active (le relâchement de la touche ne clique pas le
// bouton derrière : la liste reste fermée) et, en `multiple`, la coche en laissant la liste ouverte. Dans Chromium, l'arbre d'accessibilité :
// avec `search`, le nœud qui a le focus (le champ de recherche) annonce la ligne active.

import assert from 'node:assert/strict'
import { MOTEURS, ouvrir } from './helpers/editeur-riche.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCE = `<form class="f" @noUJS>
  <@@select class="simple" name="s"><@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option><@@option value="it">Italie</@@option></@@select>
  <@@select class="multi" name="m" multiple><@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option></@@select>
  <@@select class="cherche" name="c" search><@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option><@@option value="it">Italie</@@option></@@select>
</form>`

const PAGE = {
  source:  SOURCE,
  cle:     'select-espace-recherche',
  attente: `(() => { const h = document.querySelector('mjs-hote'); return !!(h && h._shadow && [...h._shadow.querySelectorAll('mjs-core-select')].every((s) => s._shadow?.querySelector('.select-btn'))) })()`,
  aides:   `window.__S = (c) => document.querySelector('mjs-hote')._shadow.querySelector('.' + c)`
}

for (const nom of MOTEURS) {
  describe(`<@@select> : Espace sur la liste ouverte, recherche annoncée (${nom} réel)`, function () {
    this.timeout(120000)
    let s: any = null

    before(async function () {
      s = await ouvrir(nom, 'dev', PAGE)
      if (!s) this.skip()
    })

    after(async () => {
      await s?.fermer()
      await terminateSharedWorkerPool()
    })

    const ev = (f: string) => s.page.evaluate(f)

    it('Espace choisit la ligne active, la liste reste fermée après le relâchement', async () => {
      await ev(`__S('simple')._shadow.querySelector('.select-btn').focus()`)
      await s.page.keyboard.press('ArrowDown')
      await s.page.keyboard.press('ArrowDown')
      await s.page.waitForTimeout(80)
      await s.page.keyboard.press('Space')
      await s.page.waitForTimeout(150)
      assert.equal(await ev(`__S('simple')._state.value`), 'de')
      assert.equal(await ev(`!!__S('simple')._shadow.querySelector('.select-panel')`), false, 'la liste est fermée')
      assert.deepEqual(await ev(`Array.from(new FormData(document.querySelector('mjs-hote')._shadow.querySelector('form'))).filter((p) => p[0] === 's')`), [['s', 'de']])
    })

    it('en `multiple`, Espace coche et la liste reste ouverte', async () => {
      await ev(`__S('multi')._shadow.querySelector('.select-btn').focus()`)
      await s.page.keyboard.press('ArrowDown')
      await s.page.waitForTimeout(80)
      await s.page.keyboard.press('Space')
      await s.page.waitForTimeout(150)
      assert.deepEqual(await ev(`Array.from(__S('multi')._state.value ?? [])`), ['fr'])
      assert.equal(await ev(`!!__S('multi')._shadow.querySelector('.select-panel')`), true, 'la liste reste ouverte')
      await s.page.keyboard.press('Escape')
    })

    if (nom === 'chromium') {
      it('avec `search`, le nœud focalisé de l\'arbre d\'accessibilité annonce la ligne active', async () => {
        await ev(`__S('cherche')._shadow.querySelector('.select-btn').focus()`)
        await s.page.keyboard.press('ArrowDown')
        await s.page.waitForTimeout(80)
        await s.page.keyboard.press('ArrowDown')
        await s.page.waitForTimeout(80)
        const cdp  = await s.ctx.newCDPSession(s.page)
        const arbre = await cdp.send('Accessibility.getFullAXTree')
        const prop = (n: any, k: string) => n.properties?.find((p: any) => p.name === k)?.value
        const focalise = arbre.nodes.find((n: any) => prop(n, 'focused')?.value === true && n.role?.value !== 'RootWebArea')
        assert.ok(focalise, 'un nœud a le focus')
        assert.equal(focalise.role?.value, 'combobox')
        const actif = prop(focalise, 'activedescendant')
        assert.ok(actif?.relatedNodes?.length, 'le nœud focalisé porte activedescendant')
        const cible = arbre.nodes.find((n: any) => n.backendDOMNodeId === actif.relatedNodes[0].backendDOMNodeId)
        assert.equal(cible?.name?.value, 'Allemagne')
        await s.page.keyboard.press('Escape')
      })
    }
  })
}
