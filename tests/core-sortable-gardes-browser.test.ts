// `<@@sortable>` : les gardes du geste, une à une. Tab pendant une saisie au clavier (le focus quitte la ligne et ses éléments : la saisie est annulée),
// le clic qui suit un lâcher est avalé, Espace sur une poignée-bouton ne la clique ni à la saisie ni à la pose, Échap annule sans remonter aux
// ancêtres, gauche et droite pendant une saisie ne font pas défiler la page, le mouvement réduit (aucun glissement, aucune transition), et une ligne
// que la page fait sortir avec `@out` ne compte plus comme une ligne de la liste (le geste garde son `item` et ses places).
// Aucune liste n'écrit `group` : en production le module est celui des listes simples.
// Vrais clics, vraies touches, vrai navigateur : Chromium, Firefox et WebKit, build de développement et build de production.

import assert from 'node:assert/strict'
import { NAVIGATEURS, navigateurPresent, lancer, fermer, construire, essayer, STYLE, marquees, texte, sorts, centre, actif, focaliser, style, repos } from './helpers/sortable-navigateur.js'

const DONNEES = '[{ id: 1, titre: \'Alpha\' }, { id: 2, titre: \'Bravo\' }, { id: 3, titre: \'Charlie\' }, { id: 4, titre: \'Delta\' }, { id: 5, titre: \'Echo\' }]'

const SOURCES: Record<string, string> = {
  'sg-page.mjs': `<script>
  $etapes = ${DONNEES}
  $sorts = []
  $clics = 0
  ids = (l)-> l.map((x)-> x.id).join(',')
  keep = (e)-> $sorts = $sorts.concat([JSON.stringify({ from: e.data.from, to: e.data.to, item: e.data.item?.id ?? null })])
</script>
<@@sortable class="liste" value=!{$etapes} @sort={keep(e)}>
  {for et in $etapes by id}
    <div class="ligne" data-id={et.id} @click={$clics++}><span class="t">{et.titre}</span> <button class="bt">ok</button></div>
  {end}
</@@sortable>
<input class="apres" aria-label="après la liste">
<div class="large"></div>
<p class="ordre">{ids($etapes)}</p>
<p class="sorts">{$sorts.join('|')}</p>
<p class="clics">{$clics}</p>
${STYLE}
`,
  'sh-page.mjs': `<script>
  $etapes = ${DONNEES}
  $clics = 0
  ids = (l)-> l.map((x)-> x.id).join(',')
</script>
<@@sortable class="liste" value=!{$etapes} handle=".grip">
  {for et in $etapes by id}
    <div class="ligne" data-id={et.id}><button class="grip" @click={$clics++}>⠿</button><span class="t">{et.titre}</span></div>
  {end}
</@@sortable>
<p class="ordre">{ids($etapes)}</p>
<p class="clics">{$clics}</p>
${STYLE}
`,
  'su-page.mjs': `<script>
  $vue = [{ id: 2, titre: 'Bravo' }, { id: 4, titre: 'Delta' }, { id: 6, titre: 'Foxtrot' }]
  $sorts = []
  ids = (l)-> l.map((x)-> x.id).join(',')
  refuse = (e)->
    $sorts = $sorts.concat([JSON.stringify({ from: e.data.from, to: e.data.to, item: e.data.item?.id ?? null })])
    $vue = $vue.slice()
</script>
<@@sortable class="liste" value={$vue} @sort={refuse(e)}>
  {for et in $vue by id}
    <div class="ligne" data-id={et.id}><span class="t">{et.titre}</span></div>
  {end}
</@@sortable>
<p class="ordre">{ids($vue)}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`,
  'sd-page.mjs': `<script>
  $etapes = ${DONNEES}
  $sorts = []
  ids = (l)-> l.map((x)-> x.id).join(',')
  retire = (id)-> $etapes = $etapes.filter((x)-> x.id isnt id)
  keep = (e)-> $sorts = $sorts.concat([JSON.stringify({ from: e.data.from, to: e.data.to, item: e.data.item?.id ?? null })])
</script>
<@@sortable class="liste" value=!{$etapes} @sort={keep(e)}>
  {for et in $etapes by id}
    <div class="ligne" data-id={et.id} @out=*fade(duration: 1500ms)><span class="t">{et.titre}</span> <button class="bt" @click={retire(et.id)}>x</button></div>
  {end}
</@@sortable>
<p class="ordre">{ids($etapes)}</p>
<p class="sorts">{$sorts.join('|')}</p>
${STYLE}
`
}

// compte les glissements que le module joue à la pose (une animation de `translate`)
const ESPION = 'window.__glides = 0; const animer = Element.prototype.animate; Element.prototype.animate = function (k, o) { if (JSON.stringify(k).includes(\'translate\')) window.__glides++; return animer.call(this, k, o) };'

// compte les Échap qui arrivent au document, en remontée (les liaisons `@keydown` d'une page écoutent à la capture : elles verraient tout)
const ECOUTE_ECHAP = 'window.__echap = 0; document.addEventListener(\'keydown\', (e) => { if (e.key === \'Escape\') window.__echap++ });'

for (const prod of [false, true]) {
  for (const nom of NAVIGATEURS) {
    describe(`<@@sortable> : les gardes du geste (${nom} réel, ${prod ? 'production' : 'développement'})`, function () {
      this.timeout(240000)
      let present = false
      let built   = { root: '', script: '' }
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, essais des gardes sautés`)
          return
        }
        built   = await construire('sortable-gardes', SOURCES, prod)
        browser = await lancer(nom)
      })

      after(async () => {
        await browser?.close()
        await fermer()
      })

      const essai = (fn: (page: any, tag: string) => Promise<void>, opts: { reducedMotion?: boolean, script?: string } = {}, tag = 'mjs-sg-page') => essayer(browser, built, prod, tag, fn, opts)
      const glides = (page: any) => page.evaluate(() => (window as any).__glides) as Promise<number>
      const echaps = (page: any) => page.evaluate(() => (window as any).__echap) as Promise<number>
      const ordre  = (page: any, tag: string) => texte(page, tag, 'ordre')

      // saisit la ligne `de` au pointeur et l'amène sur le titre de la ligne `vers` : la souris reste enfoncée
      async function amener(page: any, tag: string, de: number, vers: number) {
        const a = await centre(page, tag, `.ligne[data-id="${de}"] .t`)
        const b = await centre(page, tag, `.ligne[data-id="${vers}"] .t`)
        await page.mouse.move(a.x, a.y)
        await page.mouse.down()
        await page.mouse.move(a.x, a.y + 8, { steps: 2 })
        await page.mouse.move(b.x, b.y + 5, { steps: 8 })
      }

      describe('Tab pendant une saisie au clavier', () => {
        it('le focus passe de la ligne à son bouton : la saisie continue ; il passe à la ligne suivante : elle est annulée', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, '.ligne[data-id="1"]')
            await page.keyboard.press('Space')
            await page.waitForTimeout(100)
            assert.deepEqual(await marquees(page, tag), ['1:held'], 'la ligne 1 est saisie')
            await page.keyboard.press('Tab')
            await page.waitForTimeout(100)
            assert.equal(await actif(page, tag), 'bt', 'le focus est sur le bouton de la ligne')
            assert.deepEqual(await marquees(page, tag), ['1:held'], 'le focus est encore dans la ligne : la saisie continue')
            await page.keyboard.press('Tab')
            await page.waitForTimeout(100)
            assert.equal(await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.activeElement?.closest('.ligne')?.dataset.id, tag), '2', 'le focus est dans la ligne 2, sur son bouton (une seule ligne de la liste est un arrêt de tabulation)')
            await repos(page, tag, 'le focus a quitté la ligne et son bouton : la saisie est annulée')
            await page.keyboard.press('ArrowDown')
            await page.waitForTimeout(100)
            await repos(page, tag, 'les flèches ne déplacent plus rien')
            assert.equal(await ordre(page, tag), '1,2,3,4,5')
            assert.deepEqual(await sorts(page, tag), [], 'aucun déplacement émis')
          })
        })

        it('le focus sort de la liste : la saisie est annulée', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, '.ligne[data-id="1"]')
            await page.keyboard.press('Space')
            await page.waitForTimeout(100)
            let tabs = 0
            while ((await actif(page, tag)) !== 'apres' && tabs++ < 14) await page.keyboard.press('Tab')
            assert.equal(await actif(page, tag), 'apres', 'le focus est sorti de la liste')
            await repos(page, tag, 'la saisie est annulée')
            assert.equal(await ordre(page, tag), '1,2,3,4,5')
            assert.deepEqual(await sorts(page, tag), [])
          })
        })
      })

      describe('clic après un lâcher', () => {
        it('lâcher la ligne sur elle-même n\'envoie pas de clic à la ligne ; un clic franc, ensuite, passe', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            const p = await centre(page, tag, '.ligne[data-id="2"] .t')
            await page.mouse.move(p.x, p.y)
            await page.mouse.down()
            await page.mouse.move(p.x, p.y + 20, { steps: 4 })
            await page.mouse.move(p.x, p.y, { steps: 4 })
            await page.mouse.up()
            await page.waitForTimeout(100)
            assert.equal(await texte(page, tag, 'clics'), '0', 'le clic qui suit le lâcher est avalé')
            assert.deepEqual(await sorts(page, tag), [], 'la ligne est revenue à sa place : rien n\'est émis')
            await page.waitForTimeout(450)
            await page.mouse.click(p.x, p.y)
            assert.equal(await texte(page, tag, 'clics'), '1', 'un clic franc passe de nouveau')
          })
        })
      })

      describe('Espace sur une poignée-bouton', () => {
        it('ni la saisie ni la pose ne cliquent la poignée', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, '.ligne[data-id="1"] .grip')
            await page.keyboard.press('Space')
            await page.waitForTimeout(100)
            assert.deepEqual(await marquees(page, tag), ['1:held'], 'la ligne 1 est saisie par sa poignée')
            assert.equal(await texte(page, tag, 'clics'), '0', 'la saisie ne clique pas la poignée')
            await page.keyboard.press('ArrowDown')
            await page.keyboard.press('Space')
            await page.waitForTimeout(150)
            assert.equal(await ordre(page, tag), '2,1,3,4,5', 'la ligne est posée une place plus bas')
            assert.equal(await texte(page, tag, 'clics'), '0', 'la pose ne clique pas la poignée')
          }, {}, 'mjs-sh-page')
        })
      })

      describe('relâchement d\'Espace', () => {
        it('est annulé sur une poignée et pendant une saisie, jamais ailleurs ni pour une autre touche', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            // vrai si le relâchement a été annulé (l'activation d'un bouton ou d'une case n'a pas lieu)
            const annule = (q: string, key: string) => page.evaluate(([t, s, k]: string[]) => !(document.querySelector(t) as any)._shadow.querySelector(s).dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true, composed: true })), [tag, q, key]) as Promise<boolean>
            assert.equal(await annule('.ligne[data-id="1"] .grip', ' '), true, 'sur la poignée')
            assert.equal(await annule('.ligne[data-id="1"] .t', ' '), false, 'ailleurs dans la ligne, qui n\'est ni la ligne ni la poignée : la touche garde son effet')
            assert.equal(await annule('.ligne[data-id="1"] .grip', 'Enter'), false, 'une autre touche')
            await focaliser(page, tag, '.ligne[data-id="1"] .grip')
            await page.keyboard.press('Space')
            assert.equal(await annule('.ligne[data-id="1"] .t', ' '), true, 'pendant une saisie, partout dans la liste')
          }, {}, 'mjs-sh-page')
        })
      })

      describe('Échap', () => {
        it('annule la saisie sans remonter aux ancêtres ; sans saisie il remonte', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, '.ligne[data-id="1"]')
            await page.keyboard.press('Space')
            await page.waitForTimeout(100)
            await page.keyboard.press('Escape')
            await repos(page, tag, 'la saisie est annulée')
            assert.equal(await echaps(page), 0, 'l\'Échap qui annule ne remonte pas au document (une fenêtre autour de la liste resterait ouverte)')
            await page.keyboard.press('Escape')
            assert.equal(await echaps(page), 1, 'sans saisie, l\'Échap remonte')
          }, { script: ECOUTE_ECHAP })
        })
      })

      describe('gauche et droite pendant une saisie', () => {
        it('la page ne défile pas ; hors saisie, elle défile', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, '.ligne[data-id="2"]')
            await page.keyboard.press('Space')
            for (const k of ['ArrowRight', 'ArrowRight', 'ArrowLeft']) {
              await page.keyboard.press(k)
              await page.waitForTimeout(100)
            }
            await page.waitForTimeout(500)
            assert.equal(await page.evaluate(() => window.scrollX), 0, 'la page n\'a pas défilé pendant la saisie')
            await page.keyboard.press('Escape')
            await page.keyboard.press('ArrowRight')
            // WebKit ne fait pas défiler la page à la flèche dans ce banc : le contrôle n'y prouve rien
            if (nom !== 'webkit') await page.waitForFunction(() => window.scrollX > 0, null, { timeout: 4000 })
          })
        })
      })

      describe('mouvement réduit', () => {
        it('le lâcher fait glisser les lignes, sauf quand la préférence est posée', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await amener(page, tag, 1, 3)
            await page.mouse.up()
            await repos(page, tag, 'la pose est finie')
            assert.equal(await ordre(page, tag), '2,3,1,4,5')
            assert.ok((await glides(page)) > 0, 'sans la préférence, la pose joue un glissement')
          }, { script: ESPION })
          await essai(async (page, tag) => {
            await amener(page, tag, 1, 3)
            await page.mouse.up()
            await repos(page, tag, 'la pose est finie')
            assert.equal(await ordre(page, tag), '2,3,1,4,5')
            assert.equal(await glides(page), 0, 'avec la préférence, la pose ne joue aucun glissement')
          }, { script: ESPION, reducedMotion: true })
        })

        it('les lignes écartées et la ligne tenue au clavier n\'ont plus de transition quand la préférence est posée', async function () {
          if (!present) { this.skip(); return }
          for (const reduit of [false, true]) {
            await essai(async (page, tag) => {
              await amener(page, tag, 1, 2)
              assert.equal(await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.ligne[data-id="2"]').getAttribute('mjs-sortable'), tag), 'shift', 'la ligne 2 est écartée')
              assert.equal(await style(page, tag, '.ligne[data-id="2"]', 'transition-duration'), reduit ? '0s' : '0.15s', 'transition de la ligne écartée' + (reduit ? ' (réduite)' : ''))
              await page.keyboard.press('Escape')
              await page.waitForTimeout(100)
              await page.mouse.up()
              await focaliser(page, tag, '.ligne[data-id="1"]')
              await page.keyboard.press('Space')
              await page.keyboard.press('ArrowDown')
              await page.waitForTimeout(100)
              assert.equal(await style(page, tag, '.ligne[data-id="1"]', 'transition-duration'), reduit ? '0s' : '0.15s', 'transition de la ligne tenue au clavier' + (reduit ? ' (réduite)' : ''))
              await page.keyboard.press('Escape')
            }, { reducedMotion: reduit })
          }
        })
      })

      describe('liaison à sens unique', () => {
        it('une page qui refuse le déplacement réaffecte sa liste : le geste suivant garde le bon item', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await focaliser(page, tag, '.ligne[data-id="2"]')
            await page.keyboard.press('Space')
            await page.keyboard.press('ArrowDown')
            await page.keyboard.press('ArrowDown')
            await page.keyboard.press('Space')
            await page.waitForTimeout(400)
            assert.equal(await ordre(page, tag), '2,4,6', 'la page a refusé : son ordre ne change pas')
            await focaliser(page, tag, '.ligne[data-id="4"]')
            await page.keyboard.press('Space')
            await page.keyboard.press('ArrowUp')
            await page.keyboard.press('Space')
            await page.waitForTimeout(400)
            assert.deepEqual(await sorts(page, tag), [{ from: 0, to: 2, item: 2 }, { from: 1, to: 0, item: 4 }], 'le second geste porte la ligne qui bouge, pas une ligne de l\'ordre refusé')
          }, {}, 'mjs-su-page')
        })
      })

      describe('une ligne qui sort avec @out', () => {
        const retirer = (page: any, tag: string, id: number) => page.evaluate(([t, i]: any[]) => ((document.querySelector(t) as any)._shadow.querySelector(`.ligne[data-id="${i}"] .bt`) as HTMLElement).click(), [tag, id])

        it('à la souris : le geste garde son item et ses places pendant la sortie', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await retirer(page, tag, 2)
            await page.waitForTimeout(200)
            assert.equal(await page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelectorAll('.ligne').length, tag), 5, 'la ligne 2 est encore dans le DOM, le temps de sa sortie')
            await amener(page, tag, 1, 3)
            await page.mouse.up()
            await page.waitForTimeout(400)
            assert.deepEqual(await sorts(page, tag), [{ from: 0, to: 1, item: 1 }], 'la ligne 1 passe sous la ligne 3, avec son item')
            assert.equal(await ordre(page, tag), '3,1,4,5')
          }, {}, 'mjs-sd-page')
        })

        it('au clavier : le geste garde son item et ses places pendant la sortie', async function () {
          if (!present) { this.skip(); return }
          await essai(async (page, tag) => {
            await retirer(page, tag, 2)
            await page.waitForTimeout(200)
            await focaliser(page, tag, '.ligne[data-id="1"]')
            await page.keyboard.press('Space')
            await page.keyboard.press('ArrowDown')
            await page.keyboard.press('Space')
            await page.waitForTimeout(400)
            assert.deepEqual(await sorts(page, tag), [{ from: 0, to: 1, item: 1 }], 'la ligne 1 passe sous la ligne 3, avec son item')
            assert.equal(await ordre(page, tag), '3,1,4,5')
          }, {}, 'mjs-sd-page')
        })
      })
    })
  }
}
