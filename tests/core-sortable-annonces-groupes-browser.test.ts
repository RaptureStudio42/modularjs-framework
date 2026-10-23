// `<@@sortable group>` : ce qu'un lecteur d'écran entend quand une ligne passe d'une liste à l'autre au clavier. Chaque pas est annoncé, même quand
// le texte est celui du pas d'avant (la région vivante est vidée puis remplie, sans quoi rien n'est relu) ; un passage dit la liste où l'on arrive :
// son nom (`aria-labelledby`, sinon `aria-label`) s'il en a un, sinon sa place parmi les listes voisines. Une liste endormie ne reste pas une cible.
// Vrais touches, vrai navigateur : Chromium, Firefox et WebKit, build de développement et build de production.

import assert from 'node:assert/strict'
import { NAVIGATEURS, navigateurPresent, lancer, fermer, construire, essayer, STYLE, focaliser } from './helpers/sortable-navigateur.js'

const A3 = '[{ id: 1, titre: \'A1\' }, { id: 2, titre: \'A2\' }, { id: 3, titre: \'A3\' }]'
const B2 = '[{ id: 4, titre: \'B1\' }, { id: 5, titre: \'B2\' }]'

const LIGNE = '<div class="ligne" data-id={et.id}><span class="t">{et.titre}</span></div>'

// deux listes d'un même groupe, côte à côte ; `a` et `b` : les attributs de nom de chacune
const page = (a: string, b: string, avant = '') => `<script>
  $a = ${A3}
  $b = ${B2}
  ids = (l)-> l.map((x)-> x.id).join(',')
</script>
${avant}<div class="cols">
  <@@sortable class="la" value=!{$a} group="g"${a}>
    {for et in $a by id}
      ${LIGNE}
    {end}
  </@@sortable>
  <@@sortable class="lb" value=!{$b} group="g"${b}>
    {for et in $b by id}
      ${LIGNE}
    {end}
  </@@sortable>
</div>
<p class="ordre">{ids($a)}|{ids($b)}</p>
${STYLE}
`

const SOURCES: Record<string, string> = {
  'gs-page.mjs': page('', ''),
  'gn-page.mjs': page(' aria-labelledby="ta" aria-label="Ignorée"', ' aria-label="Terminées $&"', '<h3 id="ta">À faire</h3>\n'),
  'gm-page.mjs': page(' aria-label="Tâches"', ' aria-label="Tâches"')
}

const FR = {
  groupe: 'Ligne saisie, place 2 sur 3. Flèches haut et bas pour la déplacer, droite et gauche pour changer de groupe, Espace pour la poser, Échap pour annuler',
  simple: 'Ligne saisie, place 2 sur 3. Flèches haut et bas pour la déplacer, Espace pour la poser, Échap pour annuler'
}

for (const prod of [false, true]) {
  for (const nom of NAVIGATEURS) {
    describe(`<@@sortable group> : les annonces d'un passage d'une liste à l'autre (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
      this.timeout(240000)
      let present = false
      let built   = { root: '', script: '' }
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, essais des annonces sautés`)
          return
        }
        built   = await construire('sortable-annonces', SOURCES, prod)
        browser = await lancer(nom)
      })

      after(async () => {
        await browser?.close()
        await fermer()
      })

      const essai = (tag: string, fn: (page: any, tag: string) => Promise<void>, opts: { lang?: string } = {}) => essayer(browser, built, prod, tag, fn, { ...opts, listes: 2 })
      const live  = (page: any, tag: string, hote: string) => page.evaluate(([t, h]: string[]) => ((document.querySelector(t) as any)._shadow.querySelector(h)._shadow.querySelector('.live').textContent as string).trim(), [tag, hote]) as Promise<string>
      const touche = async (page: any, k: string) => {
        await page.keyboard.press(k)
        await page.waitForTimeout(400)
      }

      describe('le nom de la liste où l\'on arrive', () => {
        it('listes sans nom : la place de la liste parmi ses voisines, en français et en anglais', async function () {
          if (!present) { this.skip(); return }
          await essai('mjs-gs-page', async (page, tag) => {
            await focaliser(page, tag, '.la .ligne[data-id="2"]')
            await touche(page, 'Space')
            assert.equal(await live(page, tag, '.la'), FR.groupe)
            await touche(page, 'ArrowRight')
            assert.equal(await live(page, tag, '.la'), 'Déplacée dans la liste 2 sur 2, place 2 sur 3')
            await touche(page, 'ArrowLeft')
            assert.equal(await live(page, tag, '.la'), 'Déplacée dans la liste 1 sur 2, place 2 sur 3')
            await touche(page, 'Escape')
          })
          await essai('mjs-gs-page', async (page, tag) => {
            await focaliser(page, tag, '.la .ligne[data-id="2"]')
            await touche(page, 'Space')
            await touche(page, 'ArrowRight')
            assert.equal(await live(page, tag, '.la'), 'Moved to list 2 of 2, position 2 of 3')
            await touche(page, 'Escape')
          }, { lang: 'en' })
        })

        it('listes nommées : le nom (aria-labelledby avant aria-label), sinon aria-label, tel qu\'il est écrit', async function () {
          if (!present) { this.skip(); return }
          await essai('mjs-gn-page', async (page, tag) => {
            await focaliser(page, tag, '.la .ligne[data-id="2"]')
            await touche(page, 'Space')
            await touche(page, 'ArrowRight')
            assert.equal(await live(page, tag, '.la'), 'Déplacée dans la liste « Terminées $& », place 2 sur 3')
            await touche(page, 'ArrowLeft')
            assert.equal(await live(page, tag, '.la'), 'Déplacée dans la liste « À faire », place 2 sur 3', 'aria-labelledby passe avant aria-label')
            await touche(page, 'Escape')
          })
        })
      })

      describe('chaque pas est annoncé', () => {
        it('un texte identique à celui du pas d\'avant : la région est vidée puis remplie', async function () {
          if (!present) { this.skip(); return }
          await essai('mjs-gm-page', async (page, tag) => {
            // les textes successifs de la région vivante de la liste A, à chaque modification de son contenu
            await page.evaluate(([t]: string[]) => {
              const region = (document.querySelector(t) as any)._shadow.querySelector('.la')._shadow.querySelector('.live')
              ;(window as any).__live = []
              new MutationObserver(() => (window as any).__live.push(region.textContent.trim())).observe(region, { childList: true, characterData: true, subtree: true })
            }, [tag])
            const vus = () => page.evaluate(() => (window as any).__live.splice(0)) as Promise<string[]>
            await focaliser(page, tag, '.la .ligne[data-id="2"]')
            await touche(page, 'Space')
            await vus()
            const texte1 = 'Déplacée dans la liste « Tâches », place 2 sur 3'
            await touche(page, 'ArrowRight')
            assert.deepEqual(await vus(), [texte1], 'premier passage : un texte nouveau')
            await touche(page, 'ArrowLeft')
            assert.deepEqual(await vus(), ['', texte1], 'retour dans la liste de départ, même texte : vidé puis rempli')
            await touche(page, 'ArrowRight')
            assert.deepEqual(await vus(), ['', texte1], 'troisième passage, même texte encore : vidé puis rempli')
            assert.equal(await live(page, tag, '.la'), texte1)
            await touche(page, 'Escape')
          })
        })
      })

      describe('une liste endormie', () => {
        it('n\'est plus une cible : la saisie d\'une ligne de l\'autre liste ne parle pas de groupe', async function () {
          if (!present) { this.skip(); return }
          await essai('mjs-gs-page', async (page, tag) => {
            // le nœud se croit encore connecté : seul l'oubli de la liste, à son sommeil, la retire des cibles
            await page.evaluate(([t]: string[]) => {
              const hote = (document.querySelector(t) as any)._shadow.querySelector('.lb')
              hote.remove()
              Object.defineProperty(hote, 'isConnected', { configurable: true, get: () => true })
            }, [tag])
            await focaliser(page, tag, '.la .ligne[data-id="2"]')
            await touche(page, 'Space')
            assert.equal(await live(page, tag, '.la'), FR.simple)
            await touche(page, 'Escape')
          })
        })
      })
    })
  }
}
