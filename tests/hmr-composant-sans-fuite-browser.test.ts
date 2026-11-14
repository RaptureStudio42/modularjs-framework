// `mjs dev` réel et trois navigateurs : le rechargement à chaud ne laisse ni fuite ni état faux. Un composant dont le corps du script
// ouvre quelque chose (minuterie, écouteur de document) recharge la page au lieu de rejouer ce corps ; une valeur de départ qui change de
// type recharge ; une sauvegarde sans changement ne fait rien ; deux sauvegardes rapprochées gardent l'état ; un composant gardé par le
// routeur pendant qu'on est ailleurs revient avec le nouveau code et son état ; un enfant qui gagne une prop ne lève aucun avertissement ;
// la console nomme les composants rechargés ; une dérivée modifiée reste à chaud, recalculée ; un `<@window>` garde un seul écouteur ;
// une erreur annulée en revenant au texte d'avant retire son affichage sans recharger ; une liste ordinaire remplie en place recharge.

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

const corps      = (v: number) => `<script>\n$x = 0\nwindow.__corps = (window.__corps or 0) + 1\ndocument.addEventListener('mjs-ping', -> window.__pings = (window.__pings or 0) + 1)\nµevery 50, immediate: false, -> window.__ct = (window.__ct or 0) + 1\n</script>\n\n<p class="c">Corps v${v}</p>\n`
const minuteur   = (v: number) => `<script>\n$n = 0\n$t = 0\nµmount ->\n  window.__actifs = (window.__actifs or 0) + 1\n  $t = µevery 50, immediate: false, -> window.__ticks = (window.__ticks or 0) + 1\nµdestroy ->\n  window.__actifs = window.__actifs - 1\n  $t()\nµevery 50, immediate: false, ->\n  window.__ev = (window.__ev or 0) + 1\n</script>\n\n<p class="m">Minuteur v${v}</p>\n`
const typee      = (objet: boolean) => objet ? '<script>\n$sel = { id: 7 }\n</script>\n\n<span class="s">{$sel.id}</span>\n' : '<script>\n$sel = 0\n</script>\n\n<span class="s">{$sel}</span>\n'
const compteur   = (v: number) => `<script>\n$count = 0\ninc = -> $count++\n</script>\n\n<h2 class="titre">Compteur v${v}</h2>\n<button class="plus" @click={inc}>+</button>\n<span class="val">{$count}</span>\n`
const enfant     = (prop: boolean) => prop ? '<script>\n$a = 0\n$n = 0\n</script>\n\n<p class="e">E v2 {$n}</p>\n' : '<script>\n$a = 0\n</script>\n\n<p class="e">E v1</p>\n'
const hote       = '<script>\n$k = 1\n</script>\n\n<mjs-enfant n={$k}></mjs-enfant>\n'
const derivee    = (n: number) => `<script>\n$count = 0\n$d = $count * ${n}\ninc = -> $count++\n</script>\n\n<button class="plus" @click={inc}>+</button>\n<p class="d">D v${n} {$d}</p>\n`
const fenetre    = (v: number) => `<script>\n$n = 0\nf = -> $n++\n</script>\n\n<@window @resize={f()}>\n<p class="w">W v${v} {$n}</p>\n`
const liste      = (v: number) => `<script>\n$count = 0\nliste = []\najoute = ->\n  liste.push(1)\n  $count = liste.length\n</script>\n\n<button class="aj" @click={ajoute}>+</button>\n<p class="l">L v${v} {$count}</p>\n`
const app        = '<routes target="vue">\n  /      accueil\n  /form  formulaire\n</routes>\n\n<@view vue>\n'
const formulaire = (titre: string) => `<script>\n$etape = 1\n$email = ''\nsuivant = -> $etape++\n</script>\n\n<h3 class="f">${titre} {$etape}</h3>\n<input class="email" aria-label="email" value=!{$email}>\n<button class="suivant" @click={suivant}>suivant</button>\n`

function projet(): { root: string, src: string } {
  const root = mjsTmp('hmr-sans-fuite')
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  const tete = '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body>'
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js' }))
  writeFileSync(join(root, 'index.html'), tete + '<mjs-minuteur id="mi"></mjs-minuteur><mjs-corps id="co"></mjs-corps><mjs-typee id="ty"></mjs-typee><mjs-compteur id="b"></mjs-compteur><mjs-hote id="ho"></mjs-hote><mjs-derivee id="de"></mjs-derivee><mjs-fenetre id="fe"></mjs-fenetre><mjs-liste id="li"></mjs-liste></body></html>')
  writeFileSync(join(root, 'routage.html'), tete + '<mjs-app></mjs-app></body></html>')
  const fichiers: Record<string, string> = { 'corps.mjs': corps(1), 'minuteur.mjs': minuteur(1), 'typee.mjs': typee(false), 'compteur.mjs': compteur(1), 'enfant.mjs': enfant(false), 'hote.mjs': hote, 'app.page.mjs': app, 'accueil.mjs': '<p class="acc">accueil</p>\n', 'formulaire.mjs': formulaire('Étape'), 'derivee.mjs': derivee(2), 'fenetre.mjs': fenetre(1), 'liste.mjs': liste(1) }
  for (const [nom, code] of Object.entries(fichiers)) writeFileSync(join(src, nom), code)
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

// nœud de l'ombre (fermée) d'un composant de la page : `chemin` = sélecteurs d'hôtes successifs, le dernier vise le nœud
const NOEUD = `(chemin) => {
  let racine = document
  for (let i = 0; i < chemin.length - 1; i++) {
    const hote = racine.querySelector(chemin[i])
    if (!hote || !hote._shadow) return null
    racine = hote._shadow
  }
  return racine.querySelector(chemin[chemin.length - 1])
}`

const pause = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('mjs dev — rechargement à chaud sans fuite ni état faux (trois navigateurs)', function () {
  this.timeout(240000)

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    it(`${moteur} : corps qui ouvre, type changé, sauvegarde identique, sauvegardes rapprochées, prop gagnée, dérivée modifiée, <@window>, erreur annulée, liste remplie en place, cache du routeur, console`, async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      const { root, src } = projet()
      const port = 22000 + Math.floor(Math.random() * 8000)
      const dev  = await lancerDev(root, port)
      const browser = await playwright[moteur].launch()
      const ecarts: string[] = []
      const ecart = (ok: boolean, quoi: string) => { if (!ok) ecarts.push(quoi) }
      try {
        const page = await browser.newPage()
        const erreurs: string[] = []
        const avertissements: string[] = []
        page.on('pageerror', (e) => erreurs.push(String(e)))
        page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') avertissements.push(m.text()) })
        const base   = `http://127.0.0.1:${port}`
        const ecrire = (nom: string, code: string) => writeFileSync(join(src, nom), code)
        const eval_  = (js: string) => page.evaluate(js).catch(() => null) as Promise<any>
        const lire   = (chemin: string[]) => eval_(`(() => { const n = (${NOEUD})(${JSON.stringify(chemin)}); return n ? n.textContent.trim() : null })()`) as Promise<string | null>
        const agir   = (chemin: string[], js: string) => eval_(`(() => { const n = (${NOEUD})(${JSON.stringify(chemin)}); ${js} })()`)
        const attendre = async (chemin: string[], attendu: string | RegExp, ms = 20000): Promise<boolean> => {
          const fin = Date.now() + ms
          while (Date.now() < fin) {
            const vu = await lire(chemin)
            if (vu !== null && (typeof attendu === 'string' ? vu === attendu : attendu.test(vu))) return true
            await pause(50)
          }
          return false
        }
        const marque   = () => eval_('window.__marque')
        const echanges = () => (dev.stdout().match(/♻️/g) ?? []).length
        const attendreEchange = async (avant: number) => {
          const fin = Date.now() + 20000
          while (Date.now() < fin && echanges() <= avant) await pause(50)
          await pause(400)
        }

        await page.goto(base + '/')
        for (const c of [['#mi', '.m'], ['#co', '.c'], ['#ty', '.s'], ['#b', '.titre'], ['#ho', 'mjs-enfant', '.e'], ['#de', '.d'], ['#fe', '.w'], ['#li', '.l']]) assert.ok(await attendre(c, /./), `premier rendu ${c.join(' ')}`)
        await eval_('window.__marque = 1')

        // µmount et µdestroy tiennent une minuterie, µevery une autre, le corps ne fait que déclarer : à chaud, une seule de chaque
        ecrire('minuteur.mjs', minuteur(2))
        ecart(await attendre(['#mi', '.m'], 'Minuteur v2'), 'minuteur : nouveau gabarit')
        ecart(await marque() === 1, 'minuteur : la page ne se recharge pas')
        ecart(await eval_('window.__actifs') === 1, `minuteur : une seule minuterie active (vu ${await eval_('window.__actifs')})`)
        const tops = await eval_('new Promise(r => { const a = window.__ev || 0; setTimeout(() => r((window.__ev || 0) - a), 1000) })')
        ecart(tops > 5 && tops < 30, `minuteur : une seule minuterie µevery (vu ${tops} tops par seconde pour 20 attendus)`)

        // corps du script qui ouvre une minuterie et un écouteur de document : la page se recharge, rien ne s'ouvre deux fois
        ecrire('corps.mjs', corps(2))
        ecart(await attendre(['#co', '.c'], 'Corps v2'), 'corps : nouveau gabarit')
        await pause(300)
        ecart(await marque() === undefined, 'corps qui ouvre : la page se recharge au lieu de rejouer le corps')
        ecart(await eval_('window.__corps') === 1, `corps qui ouvre : joué une fois (vu ${await eval_('window.__corps')})`)
        const pings = await eval_('(() => { const a = window.__pings || 0; document.dispatchEvent(new Event("mjs-ping")); return (window.__pings || 0) - a })()')
        ecart(pings === 1, `corps qui ouvre : écouteur de document appelé une fois (vu ${pings})`)
        await eval_('window.__marque = 1')

        // valeur de départ qui change de type : la page se recharge et montre la valeur nouvelle
        ecrire('typee.mjs', typee(true))
        ecart(await attendre(['#ty', '.s'], '7', 15000), `type changé : la valeur nouvelle s'affiche (vu « ${await lire(['#ty', '.s'])} »)`)
        await eval_('window.__marque = 1')

        // sauvegarde sans changement : rien ne bouge
        for (let i = 0; i < 3; i++) await agir(['#b', '.plus'], 'n.click()')
        ecrire('compteur.mjs', compteur(1))
        await pause(2500)
        ecart(await marque() === 1, 'sauvegarde identique : la page ne se recharge pas')
        ecart(await eval_('document.querySelector("#b")._state.count') === 3, 'sauvegarde identique : état gardé')

        // deux sauvegardes à 120 ms : la dernière version, l'état gardé, la console nomme le composant
        ecrire('compteur.mjs', compteur(2))
        await pause(120)
        ecrire('compteur.mjs', compteur(3))
        ecart(await attendre(['#b', '.titre'], 'Compteur v3'), 'sauvegardes rapprochées : dernière version')
        await pause(1500)
        ecart(await marque() === 1, 'sauvegardes rapprochées : la page ne se recharge pas')
        ecart(await eval_('document.querySelector("#b")._state.count') === 3, 'sauvegardes rapprochées : état gardé')
        ecart(/♻️ +mjs-compteur — /.test(dev.stdout()), 'console : le nom du composant rechargé')
        ecart(!/\{noms\}/.test(dev.stdout()), 'console : aucun {noms} laissé tel quel')

        // enfant qui gagne une prop que le parent lui passe déjà : aucun avertissement
        const avant = avertissements.length
        ecrire('enfant.mjs', enfant(true))
        ecart(await attendre(['#ho', 'mjs-enfant', '.e'], 'E v2 1'), `prop gagnée : la valeur du parent (vu « ${await lire(['#ho', 'mjs-enfant', '.e'])} »)`)
        await pause(300)
        ecart(await marque() === 1, 'prop gagnée : la page ne se recharge pas')
        const parasites = avertissements.slice(avant).filter(a => /écrit sa prop/.test(a))
        ecart(parasites.length === 0, `prop gagnée : aucun avertissement (vu ${JSON.stringify(parasites)})`)

        // dérivée modifiée qui reste sans risque : à chaud, recalculée par le nouveau code sur l'état gardé
        for (let i = 0; i < 2; i++) await agir(['#de', '.plus'], 'n.click()')
        ecart(await attendre(['#de', '.d'], 'D v2 4'), 'dérivée : départ')
        ecrire('derivee.mjs', derivee(3))
        ecart(await attendre(['#de', '.d'], 'D v3 6'), `dérivée modifiée : recalculée sur l'état gardé (vu « ${await lire(['#de', '.d'])} »)`)
        ecart(await marque() === 1, 'dérivée modifiée : la page ne se recharge pas')

        // <@window> et son écouteur : à chaud, un seul écouteur après l'échange
        ecrire('fenetre.mjs', fenetre(2))
        ecart(await attendre(['#fe', '.w'], 'W v2 0'), '<@window> : nouveau gabarit')
        ecart(await marque() === 1, '<@window> : la page ne se recharge pas')
        await eval_('window.dispatchEvent(new Event("resize"))')
        await pause(300)
        ecart(await lire(['#fe', '.w']) === 'W v2 1', `<@window> : un seul écouteur après l'échange (vu « ${await lire(['#fe', '.w'])} »)`)

        // erreur puis retour au texte d'avant : l'affichage de l'erreur part, la page ne se recharge pas, l'état reste
        const affichage = async (vu: boolean): Promise<boolean> => {
          const fin = Date.now() + 15000
          while (Date.now() < fin) {
            if (await eval_('!!document.getElementById("__mjs_hmr_overlay")') === vu) return true
            await pause(50)
          }
          return false
        }
        ecrire('compteur.mjs', compteur(3).replace('inc = -> $count++', 'inc = -> $count++ )('))
        ecart(await affichage(true), 'erreur : affichée par-dessus la page')
        ecrire('compteur.mjs', compteur(3))
        ecart(await affichage(false), 'erreur annulée : son affichage part')
        await pause(800)
        ecart(await marque() === 1, 'erreur annulée en revenant au texte d\'avant : la page ne se recharge pas')
        ecart(await eval_('document.querySelector("#b")._state.count') === 3, 'erreur annulée : état gardé')

        // liste ordinaire remplie en place par un gestionnaire : la page se recharge, l'état gardé serait faux
        for (let i = 0; i < 3; i++) await agir(['#li', '.aj'], 'n.click()')
        ecart(await attendre(['#li', '.l'], 'L v1 3'), 'liste : départ')
        ecrire('liste.mjs', liste(2))
        ecart(await attendre(['#li', '.l'], 'L v2 0'), `liste remplie en place : la page se recharge (vu « ${await lire(['#li', '.l'])} »)`)
        ecart(await marque() === undefined, 'liste remplie en place : rechargement complet')

        // composant gardé par le routeur pendant qu'on est ailleurs : il revient avec le nouveau code et son état
        await page.goto(base + '/routage.html#/form')
        assert.ok(await attendre(['mjs-app', 'mjs-formulaire', '.f'], 'Étape 1'), 'route')
        await eval_('window.__marque = 1')
        await agir(['mjs-app', 'mjs-formulaire', '.email'], 'n.value = "z@x.fr"; n.dispatchEvent(new Event("input", { bubbles: true, composed: true }))')
        await agir(['mjs-app', 'mjs-formulaire', '.suivant'], 'n.click()')
        assert.ok(await attendre(['mjs-app', 'mjs-formulaire', '.f'], 'Étape 2'), 'étape suivante')
        await eval_('location.hash = "#/"')
        assert.ok(await attendre(['mjs-app', 'mjs-accueil', '.acc'], 'accueil'), 'page d\'accueil')
        const n0 = echanges()
        ecrire('formulaire.mjs', formulaire('Pas'))
        await attendreEchange(n0)
        await eval_('location.hash = "#/form"')
        ecart(await attendre(['mjs-app', 'mjs-formulaire', '.f'], 'Pas 2', 8000), `cache du routeur : nouveau gabarit, étape gardée (vu « ${await lire(['mjs-app', 'mjs-formulaire', '.f'])} »)`)
        ecart(await eval_('document.querySelector("mjs-app")._shadow.querySelector("mjs-formulaire")._shadow.querySelector(".email").value') === 'z@x.fr', 'cache du routeur : saisie gardée')
        ecart(await marque() === 1, 'cache du routeur : la page ne se recharge pas')
        await agir(['mjs-app', 'mjs-formulaire', '.suivant'], 'n.click()')
        ecart(await attendre(['mjs-app', 'mjs-formulaire', '.f'], 'Pas 3', 5000), 'cache du routeur : le gestionnaire sert au retour')
        ecart(erreurs.length === 0, `aucune erreur dans la page (vu ${JSON.stringify(erreurs)})`)
        assert.deepEqual(ecarts, [], `écarts :\n${ecarts.join('\n')}\n--- mjs dev ---\n${dev.stdout()}`)
      }
      finally {
        await browser.close()
        await dev.kill()
      }
    })
  }
})
