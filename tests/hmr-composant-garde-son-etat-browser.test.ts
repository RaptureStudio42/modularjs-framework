// `mjs dev` réel et trois navigateurs : un composant modifié se redessine dans la page sans la recharger, et chacune de ses instances
// garde son état (variables, saisie d'un champ lié, étape d'un formulaire routé). Gabarit, gestionnaire, style, plusieurs instances, un
// enfant dans un parent, des lignes d'un {for}, un composant sous un {if}, un composant routé, une erreur de compilation puis sa
// correction, dix modifications de suite (ni écouteur ni instance en trop). Un µmount modifié recharge la page entière.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

const PREMIER_BUILD = /✅ \d+ fichiers en \d+ms/

const compteur = (o: { titre?: string, pas?: string, montage?: string, couleur?: string, casse?: boolean, neuves?: boolean } = {}) => [
  '<script>',
  '$count = 0',
  '$nom = \'\'',
  ...(o.neuves ? ['$neuve = \'départ\'', '$double = $count * 2'] : []),
  `inc = -> ${o.pas ?? '$count++'}`,
  `µmount -> window.__montages = (window.__montages or 0) + ${o.montage ?? '1'}`,
  '</script>',
  '',
  '<div class="carte">',
  `  <h2 class="titre">${o.titre ?? 'Compteur v1'}</h2>`,
  '  <button class="plus" @click={inc}>+</button>',
  '  <span class="val">{$count}</span>',
  ...(o.neuves ? ['  <b class="neuve">{$neuve}</b>', '  <i class="double">{$double}</i>'] : []),
  '  <input class="nom" aria-label="nom" value=!{$nom}>',
  o.casse ? '  {if $count > 2}<em>beaucoup</em>' : '  {if $count > 2}<em class="beaucoup">beaucoup</em>{end}',
  '</div>',
  '',
  '<style>',
  '.titre',
  `  color: ${o.couleur ?? 'red'}`,
  '</style>',
].join('\n')

const carte = (texte: string) => `<script>\n$ouverte = false\nbascule = -> $ouverte = not $ouverte\n</script>\n\n<button class="texte" @click={bascule}>${texte} {$ouverte}</button>\n`

const ligne = (texte: string) => `<script>\n$label = ''\n$coche = false\ncoche = -> $coche = not $coche\n</script>\n\n<button class="l" @click={coche}>${texte} {$label} {$coche}</button>\n`

const parent = [
  '<script>',
  '$items = [\'a\', \'b\']',
  '$montre = true',
  '</script>',
  '',
  '<div class="parent">',
  '  <mjs-carte class="fixe"></mjs-carte>',
  '  {for item in $items}<mjs-ligne label={item}></mjs-ligne>{end}',
  '  {if $montre}<mjs-carte class="sous-if"></mjs-carte>{end}',
  '</div>',
].join('\n')

const app = '<routes target="vue">\n  /      accueil\n  /form  formulaire\n</routes>\n\n<@view vue>\n'

const formulaire = (titre: string) => [
  '<script>',
  '$etape = 1',
  '$email = \'\'',
  'suivant = -> $etape++',
  '</script>',
  '',
  `<h3 class="f">${titre} {$etape}</h3>`,
  '<input class="email" aria-label="email" value=!{$email}>',
  '<button class="suivant" @click={suivant}>suivant</button>',
].join('\n')

function projet(): { root: string, src: string } {
  const root = mjsTmp('hmr-composant-etat')
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js' }))
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-compteur id="a"></mjs-compteur><mjs-compteur id="b"></mjs-compteur><mjs-parent></mjs-parent></body></html>')
  writeFileSync(join(root, 'routage.html'), '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-app></mjs-app></body></html>')
  writeFileSync(join(src, 'compteur.mjs'), compteur())
  writeFileSync(join(src, 'carte.mjs'), carte('Carte v1'))
  writeFileSync(join(src, 'ligne.mjs'), ligne('Ligne v1'))
  writeFileSync(join(src, 'parent.mjs'), parent)
  writeFileSync(join(src, 'app.page.mjs'), app)
  writeFileSync(join(src, 'accueil.mjs'), '<p>accueil</p>\n')
  writeFileSync(join(src, 'formulaire.mjs'), formulaire('Étape'))
  return { root, src }
}

interface Dev { stdout(): string, kill(): Promise<void> }

function lancerDev(root: string, port: number): Promise<Dev> {
  return new Promise((resolve, reject) => {
    const proc = spawn(tsxBin, [cliPath, 'dev', '--root', root, '--port', String(port)], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    let sortie = ''
    let fini   = false
    const abandon = setTimeout(() => {
      if (fini) return
      fini = true
      proc.kill('SIGKILL')
      reject(new Error(`'mjs dev' n'a jamais fini son premier build.\n${sortie}`))
    }, 60000)
    proc.stdout!.on('data', (d) => {
      sortie += String(d)
      if (fini || !PREMIER_BUILD.test(sortie)) return
      fini = true
      clearTimeout(abandon)
      resolve({
        stdout: () => sortie,
        kill: () => new Promise((done) => {
          proc.once('close', () => done())
          proc.kill('SIGINT')
          setTimeout(() => proc.kill('SIGKILL'), 5000)
        }),
      })
    })
    proc.stderr!.on('data', (d) => { sortie += String(d) })
    proc.on('error', (e) => { if (!fini) { fini = true; clearTimeout(abandon); reject(e) } })
  })
}

// texte d'un nœud de l'ombre (fermée) d'un composant de la page : `chemin` = sélecteurs d'hôtes successifs, le dernier vise le nœud
const LIRE = `(chemin) => {
  let racine = document
  for (let i = 0; i < chemin.length - 1; i++) {
    const hote = racine.querySelector(chemin[i])
    if (!hote || !hote._shadow) return null
    racine = hote._shadow
  }
  const n = racine.querySelector(chemin[chemin.length - 1])
  return n ? n.textContent.trim() : null
}`

describe('mjs dev — un composant modifié se redessine en gardant son état (trois navigateurs)', function () {
  this.timeout(240000)

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    it(`${moteur} : gabarit, gestionnaire, style, instances, enfant, {for}, {if}, route, erreur, dix modifications, µmount`, async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      const { root, src } = projet()
      const port = 22000 + Math.floor(Math.random() * 8000)
      const dev  = await lancerDev(root, port)
      const browser = await playwright[moteur].launch()
      try {
        const page = await browser.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e) => erreurs.push(String(e)))
        const base = `http://127.0.0.1:${port}`
        const lire = (chemin: string[]) => page.evaluate(`(${LIRE})(${JSON.stringify(chemin)})`) as Promise<string | null>
        const attendre = async (chemin: string[], attendu: string | RegExp, quoi: string) => {
          const fin = Date.now() + 20000
          let vu: string | null = null
          while (Date.now() < fin) {
            // une lecture tombée pendant un rechargement complet (attendu à l'étape du µmount) se refait
            vu = await lire(chemin).catch(() => null)
            if (vu !== null && (typeof attendu === 'string' ? vu === attendu : attendu.test(vu))) return
            await new Promise(r => setTimeout(r, 50))
          }
          assert.fail(`${quoi} : attendu ${attendu}, vu ${vu}\n--- mjs dev ---\n${dev.stdout()}\n--- erreurs de la page ---\n${erreurs.join('\n')}`)
        }
        const etat = (sel: string, k: string) => page.evaluate(`document.querySelector(${JSON.stringify(sel)})._state[${JSON.stringify(k)}]`)
        const cliquer = (chemin: string[]) => page.evaluate(`(() => {
          let racine = document
          const c = ${JSON.stringify(chemin)}
          for (let i = 0; i < c.length - 1; i++) racine = racine.querySelector(c[i])._shadow
          racine.querySelector(c[c.length - 1]).click()
        })()`)
        const saisir = (chemin: string[], texte: string) => page.evaluate(`(() => {
          let racine = document
          const c = ${JSON.stringify(chemin)}
          for (let i = 0; i < c.length - 1; i++) racine = racine.querySelector(c[i])._shadow
          const champ = racine.querySelector(c[c.length - 1])
          champ.value = ${JSON.stringify(texte)}
          champ.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
        })()`)
        const sansRechargement = async (quoi: string) => assert.equal(await page.evaluate('window.__marque'), 1, `${quoi} : la page a été rechargée\n${dev.stdout()}`)

        await page.goto(base + '/')
        await attendre(['#a', '.titre'], 'Compteur v1', 'premier rendu')
        await attendre(['mjs-parent', 'mjs-ligne:nth-of-type(2)', '.l'], 'Ligne v1 b false', 'premier rendu des lignes')
        await page.evaluate('window.__marque = 1')
        await cliquer(['#a', '.plus'])
        await cliquer(['#a', '.plus'])
        await cliquer(['#b', '.plus'])
        await saisir(['#a', '.nom'], 'Zoé')
        assert.equal(await etat('#a', 'nom'), 'Zoé')
        const instances = await page.evaluate('µ.instances.size')

        // gabarit et gestionnaire au milieu d'un formulaire rempli, deux instances
        writeFileSync(join(src, 'compteur.mjs'), compteur({ titre: 'Compteur v2', pas: '$count += 10', neuves: true }))
        await attendre(['#a', '.titre'], 'Compteur v2', 'gabarit modifié (instance a)')
        await attendre(['#b', '.titre'], 'Compteur v2', 'gabarit modifié (instance b)')
        await sansRechargement('gabarit modifié')
        assert.equal(await etat('#a', 'count'), 2)
        assert.equal(await etat('#b', 'count'), 1)
        assert.equal(await lire(['#a', '.val']), '2')
        assert.equal(await etat('#a', 'nom'), 'Zoé')
        assert.equal(await page.evaluate('document.querySelector("#a")._shadow.querySelector(".nom").value'), 'Zoé', 'la saisie du champ lié revient dans le nouveau gabarit')
        assert.equal(await lire(['#a', '.neuve']), 'départ', 'une variable nouvelle prend sa valeur de départ')
        assert.equal(await lire(['#a', '.double']), '4', 'une dérivée nouvelle se calcule sur l\'état gardé')
        await cliquer(['#a', '.plus'])
        await attendre(['#a', '.val'], '12', 'le nouveau gestionnaire sert')
        await attendre(['#a', '.double'], '24', 'la dérivée suit')
        await attendre(['#a', '.beaucoup'], 'beaucoup', 'le {if} du gabarit suit l\'état gardé')

        // style et gabarit ensemble
        writeFileSync(join(src, 'compteur.mjs'), compteur({ titre: 'Compteur v3', pas: '$count += 10', couleur: 'blue' }))
        await attendre(['#a', '.titre'], 'Compteur v3', 'style et gabarit')
        assert.equal(await page.evaluate('getComputedStyle(document.querySelector("#a")._shadow.querySelector(".titre")).color'), 'rgb(0, 0, 255)')
        assert.equal(await etat('#a', 'count'), 12)
        assert.equal(await page.evaluate('"neuve" in document.querySelector("#a")._state'), false, 'une variable retirée disparaît')

        // style seul
        writeFileSync(join(src, 'compteur.mjs'), compteur({ titre: 'Compteur v3', pas: '$count += 10', couleur: 'green' }))
        const vert = Date.now() + 20000
        while (Date.now() < vert && await page.evaluate('getComputedStyle(document.querySelector("#b")._shadow.querySelector(".titre")).color') !== 'rgb(0, 128, 0)') await new Promise(r => setTimeout(r, 50))
        assert.equal(await page.evaluate('getComputedStyle(document.querySelector("#b")._shadow.querySelector(".titre")).color'), 'rgb(0, 128, 0)', 'style seul')
        await sansRechargement('style seul')

        // enfant dans un parent, et le même sous un {if}
        await cliquer(['mjs-parent', 'mjs-carte.fixe', '.texte'])
        await attendre(['mjs-parent', 'mjs-carte.fixe', '.texte'], 'Carte v1 true', 'clic sur la carte')
        writeFileSync(join(src, 'carte.mjs'), carte('Carte v2'))
        await attendre(['mjs-parent', 'mjs-carte.fixe', '.texte'], 'Carte v2 true', 'enfant modifié, état gardé')
        await attendre(['mjs-parent', 'mjs-carte.sous-if', '.texte'], 'Carte v2 false', 'enfant sous un {if}')
        assert.deepEqual(await etat('mjs-parent', 'items'), ['a', 'b'])

        // lignes d'un {for}
        await cliquer(['mjs-parent', 'mjs-ligne:nth-of-type(2)', '.l'])
        await attendre(['mjs-parent', 'mjs-ligne:nth-of-type(2)', '.l'], 'Ligne v1 b true', 'clic sur la ligne b')
        writeFileSync(join(src, 'ligne.mjs'), ligne('Ligne v2'))
        await attendre(['mjs-parent', 'mjs-ligne:nth-of-type(2)', '.l'], 'Ligne v2 b true', 'ligne modifiée, état et prop gardés')
        await attendre(['mjs-parent', 'mjs-ligne:nth-of-type(1)', '.l'], 'Ligne v2 a false', 'autre ligne')
        await sansRechargement('enfant, {if}, {for}')

        // erreur de compilation, puis correction
        writeFileSync(join(src, 'compteur.mjs'), compteur({ titre: 'Compteur v4', pas: '$count += 10', couleur: 'green', casse: true }))
        const finErreur = Date.now() + 20000
        while (Date.now() < finErreur && !(await page.evaluate('!!document.getElementById("__mjs_hmr_overlay")'))) await new Promise(r => setTimeout(r, 50))
        assert.ok(await page.evaluate('!!document.getElementById("__mjs_hmr_overlay")'), 'l\'erreur s\'affiche')
        assert.equal(await lire(['#a', '.titre']), 'Compteur v3', 'la dernière version valide reste')
        writeFileSync(join(src, 'compteur.mjs'), compteur({ titre: 'Compteur v4', pas: '$count += 10', couleur: 'green' }))
        await attendre(['#a', '.titre'], 'Compteur v4', 'erreur corrigée')
        assert.ok(await page.evaluate('!document.getElementById("__mjs_hmr_overlay")'), 'l\'erreur part')
        await sansRechargement('erreur puis correction')
        assert.equal(await etat('#a', 'count'), 12)

        // dix modifications de suite : ni écouteur ni instance en trop
        for (let v = 5; v <= 14; v++) {
          writeFileSync(join(src, 'compteur.mjs'), compteur({ titre: `Compteur v${v}`, pas: '$count += 10', couleur: 'green' }))
          await attendre(['#a', '.titre'], `Compteur v${v}`, `modification ${v}`)
        }
        await sansRechargement('dix modifications')
        assert.equal(await page.evaluate('µ.instances.size'), instances, 'aucune instance en trop')
        await cliquer(['#a', '.plus'])
        await attendre(['#a', '.val'], '22', 'un clic, un seul passage du gestionnaire')
        await new Promise(r => setTimeout(r, 200))
        assert.equal(await etat('#a', 'count'), 22)
        assert.equal(await etat('#a', 'nom'), 'Zoé')

        // µmount modifié : rechargement complet
        writeFileSync(join(src, 'compteur.mjs'), compteur({ titre: 'Compteur v15', pas: '$count += 10', couleur: 'green', montage: '2' }))
        await attendre(['#a', '.titre'], 'Compteur v15', 'µmount modifié')
        assert.equal(await page.evaluate('window.__marque'), undefined, 'un µmount modifié recharge la page')
        assert.equal(await etat('#a', 'count'), 0)

        // composant routé
        await page.goto(base + '/routage.html#/form')
        await attendre(['mjs-app', 'mjs-formulaire', '.f'], 'Étape 1', 'route')
        await page.evaluate('window.__marque = 1')
        await saisir(['mjs-app', 'mjs-formulaire', '.email'], 'z@x.fr')
        await cliquer(['mjs-app', 'mjs-formulaire', '.suivant'])
        await attendre(['mjs-app', 'mjs-formulaire', '.f'], 'Étape 2', 'étape suivante')
        writeFileSync(join(src, 'formulaire.mjs'), formulaire('Pas'))
        await attendre(['mjs-app', 'mjs-formulaire', '.f'], 'Pas 2', 'composant routé modifié, étape gardée')
        assert.equal(await page.evaluate('document.querySelector("mjs-app")._shadow.querySelector("mjs-formulaire")._shadow.querySelector(".email").value'), 'z@x.fr')
        await sansRechargement('composant routé')
        assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
      }
      finally {
        await browser.close()
        await dev.kill()
      }
    })
  }
})
