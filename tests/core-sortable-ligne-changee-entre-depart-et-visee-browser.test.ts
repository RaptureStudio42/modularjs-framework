// `<@@sortable>` : pendant une saisie au clavier, la ligne tenue a déjà bougé, puis la page ajoute ou retire une ligne ENTRE sa place de départ
// et la place visée. La place visée se retient par sa voisine du dessus : Espace pose la ligne là où l'annonce l'a dite (entre les mêmes
// voisines), et `sort` dit cette place-là — jamais une place à côté. Vraies touches, vrai navigateur (Chromium, Firefox, WebKit), build de
// développement.

import assert from 'node:assert/strict'
import { NAVIGATEURS, navigateurPresent, lancer, fermer, construire, essayer, STYLE, texte, sorts, focaliser, repos } from './helpers/sortable-navigateur.js'

const SOURCES: Record<string, string> = {
  'sv-page.mjs': `<script>
  $etapes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]
  $sorts = []
  ids = (l)-> l.map((x)-> x.id).join(',')
  keep = (e)-> $sorts = $sorts.concat([JSON.stringify({ from: e.data.from, to: e.data.to, item: e.data.item?.id ?? null })])
  µmount ->
    window.__retirer = (id)-> $etapes = $etapes.filter((x)-> x.id != id)
    window.__inserer = (id, at)-> $etapes = [...$etapes.slice(0, at), { id: id }, ...$etapes.slice(at)]
</script>
<@@sortable class="liste" value=!{$etapes} @sort={keep(e)}>
  {for et in $etapes by id}
    <div class="ligne" data-id={et.id}><span class="t">{et.id}</span></div>
  {end}
</@@sortable>
<p class="ordre">{ids($etapes)}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`
}

for (const nom of NAVIGATEURS) {
  describe(`<@@sortable> : une ligne ajoutée ou retirée entre le départ et la place visée, au clavier (${nom} réel)`, function () {
    this.timeout(120000)
    let browser: any = null
    let built: any   = null

    before(async function () {
      if (!(await navigateurPresent(nom))) return this.skip()
      built   = await construire('sortable-entre-depart-et-visee', SOURCES, false)
      browser = await lancer(nom)
    })

    after(async () => {
      await browser?.close()
      await fermer()
    })

    // la ligne `id` saisie, `fleche` pressée `n` fois, la page change la liste, puis Espace : l'ordre et le `sort` reçus
    const deplacer = async (page: any, tag: string, id: string, fleche: string, n: number, changer: string) => {
      await focaliser(page, tag, `.ligne[data-id="${id}"]`)
      await page.keyboard.press('Space')
      await page.waitForTimeout(100)
      for (let i = 0; i < n; i++) {
        await page.keyboard.press(fleche)
        await page.waitForTimeout(100)
      }
      await page.evaluate(changer)
      await page.waitForTimeout(250)
      await page.keyboard.press('Space')
      await repos(page, tag, 'aucune marque ne reste')
      return { ordre: await texte(page, tag, 'ordre'), sorts: await sorts(page, tag) }
    }

    it('a descendue entre c et d, la page retire b : a se pose entre c et d', async function () {
      await essayer(browser, built, false, 'mjs-sv-page', async (page, tag) => {
        assert.deepEqual(await deplacer(page, tag, 'a', 'ArrowDown', 2, `__retirer('b')`), { ordre: 'c,a,d,e', sorts: [{ from: 0, to: 1, item: 'a' }] })
      })
    })

    it('a descendue entre c et d, la page insère z entre b et c : a se pose entre c et d', async function () {
      await essayer(browser, built, false, 'mjs-sv-page', async (page, tag) => {
        assert.deepEqual(await deplacer(page, tag, 'a', 'ArrowDown', 2, `__inserer('z', 2)`), { ordre: 'b,z,c,a,d,e', sorts: [{ from: 0, to: 3, item: 'a' }] })
      })
    })

    it('e montée entre b et c, la page retire d : e se pose entre b et c', async function () {
      await essayer(browser, built, false, 'mjs-sv-page', async (page, tag) => {
        assert.deepEqual(await deplacer(page, tag, 'e', 'ArrowUp', 2, `__retirer('d')`), { ordre: 'a,b,e,c', sorts: [{ from: 3, to: 2, item: 'e' }] })
      })
    })

    it('témoin : a descendue entre c et d, la page retire e (sous la visée) : a se pose entre c et d', async function () {
      await essayer(browser, built, false, 'mjs-sv-page', async (page, tag) => {
        assert.deepEqual(await deplacer(page, tag, 'a', 'ArrowDown', 2, `__retirer('e')`), { ordre: 'b,c,a,d', sorts: [{ from: 0, to: 2, item: 'a' }] })
      })
    })
  })
}
