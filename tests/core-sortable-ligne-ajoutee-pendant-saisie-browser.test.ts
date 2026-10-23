// `<@@sortable>` : pendant une saisie au clavier, la page ajoute ou retire une ligne AU-DESSUS de la ligne tenue. La place d'arrivée suit la
// ligne : Espace sans avoir bougé la pose où elle est, l'ordre ne change pas et `sort` ne part pas ; une flèche, ensuite, la déplace d'une place
// depuis sa place réelle. Vraies touches, vrai navigateur (Chromium, Firefox, WebKit), build de développement.

import assert from 'node:assert/strict'
import { NAVIGATEURS, navigateurPresent, lancer, fermer, construire, essayer, STYLE, texte, sorts, focaliser, repos } from './helpers/sortable-navigateur.js'

const SOURCES: Record<string, string> = {
  'sa-page.mjs': `<script>
  $etapes = [{ id: 1, titre: 'Alpha' }, { id: 2, titre: 'Bravo' }, { id: 3, titre: 'Charlie' }]
  $sorts = []
  ids = (l)-> l.map((x)-> x.id).join(',')
  keep = (e)-> $sorts = $sorts.concat([JSON.stringify({ from: e.data.from, to: e.data.to, item: e.data.item?.id ?? null })])
  µmount ->
    window.__ajouter = (id)-> $etapes = [{ id: id, titre: 'Neuve ' + id }, ...$etapes]
    window.__retirer = (id)-> $etapes = $etapes.filter((x)-> x.id != id)
</script>
<@@sortable class="liste" value=!{$etapes} @sort={keep(e)}>
  {for et in $etapes by id}
    <div class="ligne" data-id={et.id}><span class="t">{et.titre}</span></div>
  {end}
</@@sortable>
<p class="ordre">{ids($etapes)}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`
}

for (const nom of NAVIGATEURS) {
  describe(`<@@sortable> : une ligne ajoutée ou retirée au-dessus pendant une saisie au clavier (${nom} réel)`, function () {
    this.timeout(120000)
    let browser: any = null
    let built: any   = null

    before(async function () {
      if (!(await navigateurPresent(nom))) return this.skip()
      built   = await construire('sortable-ligne-ajoutee', SOURCES, false)
      browser = await lancer(nom)
    })

    after(async () => {
      await browser?.close()
      await fermer()
    })

    it('ligne ajoutée au-dessus, Espace sans bouger : rien ne change, `sort` ne part pas', async function () {
      await essayer(browser, built, false, 'mjs-sa-page', async (page, tag) => {
        await focaliser(page, tag, '.ligne[data-id="1"]')
        await page.keyboard.press('Space')
        await page.waitForTimeout(100)
        await page.evaluate(() => (window as any).__ajouter(9))
        await page.waitForTimeout(250)
        assert.equal(await texte(page, tag, 'ordre'), '9,1,2,3')
        await page.keyboard.press('Space')
        await repos(page, tag, 'aucune marque ne reste')
        assert.equal(await texte(page, tag, 'ordre'), '9,1,2,3', 'la ligne reste à sa place')
        assert.deepEqual(await sorts(page, tag), [])
      })
    })

    it('ligne retirée au-dessus, Espace sans bouger : rien ne change ; une flèche ensuite part de la place réelle', async function () {
      await essayer(browser, built, false, 'mjs-sa-page', async (page, tag) => {
        await page.evaluate(() => (window as any).__ajouter(9))
        await page.waitForTimeout(150)
        await focaliser(page, tag, '.ligne[data-id="2"]')
        await page.keyboard.press('Space')
        await page.waitForTimeout(100)
        await page.evaluate(() => (window as any).__retirer(9))
        await page.waitForTimeout(250)
        assert.equal(await texte(page, tag, 'ordre'), '1,2,3')
        await page.keyboard.press('Space')
        await repos(page, tag, 'aucune marque ne reste')
        assert.equal(await texte(page, tag, 'ordre'), '1,2,3', 'la ligne reste à sa place')
        assert.deepEqual(await sorts(page, tag), [])
        await focaliser(page, tag, '.ligne[data-id="2"]')
        await page.keyboard.press('Space')
        await page.waitForTimeout(100)
        await page.evaluate(() => (window as any).__ajouter(8))
        await page.waitForTimeout(250)
        await page.keyboard.press('ArrowDown')
        await page.waitForTimeout(100)
        await page.keyboard.press('Space')
        await repos(page, tag, 'aucune marque ne reste')
        assert.equal(await texte(page, tag, 'ordre'), '8,1,3,2', 'la flèche déplace la ligne d\'une place depuis sa place réelle')
        assert.deepEqual(await sorts(page, tag), [{ from: 2, to: 3, item: 2 }])
      })
    })
  })
}
