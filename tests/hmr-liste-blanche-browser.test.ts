// `mjs dev` réel et trois navigateurs : n'est échangé à chaud que le script prouvé sans effet. Chaque forme qui cacherait un effet ou
// fausserait l'état gardé (appel, accesseur, coercition, étalement, constante changée, variable ordinaire, reffet…) recharge la page
// entière ; un composant simple (compteur, champ lié, liste `$`) reste à chaud et garde son état, même revenu à un texte déjà chargé ;
// une erreur annulée (composant ou feuille partagée) et une sauvegarde sans changement ne rechargent rien ; le terminal ne dit « état
// gardé » que pour un échange que la page a fait.

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
const ETAT_GARDE    = /mjs-simple — rechargé à chaud, état gardé/g

const simple = (titre: string) => [
  '<script>',
  '$count = 0',
  '$nom = \'\'',
  '$items = [\'a\']',
  '$n = $items.length',
  'inc = -> $count++',
  'ajoute = -> $items = [...$items, \'x\']',
  '</script>',
  '',
  `<h2 class="titre">${titre}</h2>`,
  '<button class="plus" @click={inc}>+</button>',
  '<button class="ajoute" @click={ajoute}>a</button>',
  '<span class="val">{$count} {$n}</span>',
  '<input class="nom" aria-label="nom" value=!{$nom}>',
].join('\n')

const avecCorps = (corps: string[], texte: string, gabarit = '') => ['<script>', '$count = 0', ...corps, 'inc = -> $count++', '</script>', '', '<button class="plus" @click={inc}>+</button>', `<p class="t">${texte} {$count}</p>`, gabarit].join('\n')

const ecoute = ['ecoute = (n) ->', '  document.addEventListener(\'mjs-x\', (-> window.__x = 1))', '  n']

// forme relevée par une vérification : corps de la v1, corps de la v2 (le même sinon), gabarit
const CAS: [string, string[], string[] | null, string][] = [
  ['dérivée : fonction qui pose un écouteur, appelée', [...ecoute, '$d = ecoute($count)'], null, ''],
  ['dérivée : la même passée par référence à map', [...ecoute, '$d = [$count].map(ecoute)'], null, ''],
  ['dérivée : la même passée à filter', [...ecoute, '$d = [$count].filter(ecoute)'], null, ''],
  ['dérivée : fonction qui écrit le magasin passée à map', ['ecrit = (n) ->', '  $$total = n', '  n', '$d = [$count].map(ecrit)'], null, ''],
  ['dérivée : magasin écrit directement', ['$d = ($$total = $count * 2)'], null, ''],
  ['dérivée : accesseur d\'un objet $', ['$o = { get n() { document.addEventListener("mjs-x", () => { window.__x = 1 }); return 1 } }', '$y = $o.n'], null, ''],
  ['dérivée qui étale une $', ['$liste = []', '$copie = [...$liste]'], null, ''],
  ['dérivée Array.from d\'une $', ['$liste = []', '$copie = Array.from($liste)'], null, ''],
  ['dérivée Object.entries d\'une $', ['$o = {}', '$e = Object.entries($o)'], null, ''],
  ['dérivée : rappel de filter qui écrit', ['$items = [{ n: 0 }]', '$d = $items.filter((x) -> x.n = 1)'], null, ''],
  ['dérivée : rappel de map qui appelle une fonction du composant', ['aide = (x) -> x', '$items = [1]', '$d = $items.map((x) -> aide(x))'], null, ''],
  ['dérivée : rappel de find écrit en bloc', ['$items = [1]', '$d = $items.find((x) ->', '  y = x * 2', '  y > 1)'], null, ''],
  ['dérivée : méthode qui modifie sa liste (sort)', ['$items = [2, 1]', '$d = $items.sort()'], null, ''],
  ['valeur de départ : appel', ['calcul = -> 1', '$x = calcul()'], null, ''],
  ['valeur de départ : new Date()', ['$d = new Date()'], null, ''],
  ['valeur de départ : accesseur d\'un objet extérieur', ['$w = window.__obj.compte'], null, ''],
  ['valeur de départ : µafter', ['$t = µafter 10, -> window.__k = 1'], null, ''],
  ['valeur de départ : queueMicrotask', ['$t = queueMicrotask(-> window.__k = 1)'], null, ''],
  ['valeur de départ : toString caché (coercition)', ['piege = { toString() { window.__fuite(); return "a" } }', '$t = "" + piege'], null, ''],
  ['valeur de départ : valueOf caché (arithmétique)', ['piege = { valueOf() { window.__vo = (window.__vo || 0) + 1; return 1 } }', '$t = piege * 2'], null, ''],
  ['valeur de départ : chaîne gabarit qui convertit un objet', ['piege = { toString() { window.__ts = 1; return "a" } }', '$t = "#{piege}"'], null, ''],
  ['valeur de départ : accesseur d\'une constante étalé', ['SRC = { get n() { window.__acc = (window.__acc || 0) + 1; return 1 } }', '$o = { ...SRC }'], null, ''],
  ['valeur de départ : constante à Symbol.iterator étalée', ['ITER = { [Symbol.iterator]: -> window.__it = (window.__it or 0) + 1; [1][Symbol.iterator]() }', '$a = [...ITER]'], null, ''],
  ['valeur de départ : générateur Symbol.iterator étalé', ['ITER = { *[Symbol.iterator]() { window.__it = (window.__it || 0) + 1; yield 1 } }', '$a = [...ITER]'], null, ''],
  ['constante changée lue par une valeur de départ', ['MAX = 10', '$limite = MAX * 2'], ['MAX = 20', '$limite = MAX * 2'], ''],
  ['constante changée de forme', ['VIDE = {}', '$sel = VIDE'], ['VIDE = []', '$sel = VIDE'], ''],
  ['variable ordinaire : accesseur d\'un objet extérieur', ['w = window.__obj.compte'], null, ''],
  ['variable ordinaire : new Map()', ['cache = new Map()'], null, ''],
  ['liste ordinaire remplie par un gestionnaire', ['liste = []', 'ajoute = ->', '  liste.push(1)', '  $count = liste.length'], null, ''],
  ['liste ordinaire remplie par une aide', ['liste = []', 'pousser = (tab, v) -> tab.push(v)', 'ajoute = ->', '  pousser(liste, 1)', '  $count = liste.length'], null, ''],
  ['liste ordinaire remplie par un alias local', ['liste = []', 'ajoute = ->', '  l = liste', '  l.push(1)', '  $count = liste.length'], null, ''],
  ['objets d\'une liste ordinaire modifiés par un rappel', ['cpt = [{ n: 0 }]', 'ajoute = ->', '  cpt.map((c) -> c.n++)', '  $count = cpt[0].n'], null, ''],
  ['liste ordinaire remplie par Array.prototype.push.call', ['liste = []', 'ajoute = ->', '  Array.prototype.push.call(liste, 1)', '  $count = liste.length'], null, ''],
  ['objet ordinaire réécrit par un gestionnaire', ['etat = { n: 0 }', 'ajoute = ->', '  etat.n += 1', '  $count = etat.n'], null, ''],
  ['liste ordinaire remplie par le gabarit', ['liste = []'], null, '<i @click={liste.push(1)}>x</i>'],
  ['compteur d\'identifiants dans un écouteur posé par µmount', ['$items = []', 'prochain = 1', 'btn = null', 'µmount ->', '  btn.addEventListener \'click\', ->', '    $items = [...$items, { id: prochain++ }]'], null, '<button :this=!{btn}>a</button>'],
  ['écouteur posé dans µawake qui écrit une variable ordinaire', ['n = 0', 'µawake ->', '  window.addEventListener \'mjs-k\', -> n++'], null, ''],
  ['reffet minuterie, même avec son nettoyage', ['µeffect ->', '  t = µevery 50, immediate: false, -> window.__rt = 1', '  -> t()'], null, ''],
]

const THEME = '.carte { color: red; }\n'

function projet(): { root: string, src: string } {
  const root = mjsTmp('hmr-liste-blanche')
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  mkdirSync(join(root, 'styles'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', stylesheetsDir: 'styles' }))
  writeFileSync(join(root, 'styles', 'theme.scss'), THEME)
  // la page pose la minuterie à la main (un composant ne le peut pas) : le toString caché du cas « coercition » la lance
  const amorce = '<script>window.__obj = { get compte() { return 1 } }; window.__fuite = () => setInterval(() => { window.__ct = (window.__ct || 0) + 1 }, 50)</script>'
  const balises = CAS.map((_c, i) => `<mjs-cas${i} id="c${i}"></mjs-cas${i}>`).join('')
  writeFileSync(join(root, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">${amorce}<script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-simple id="s"></mjs-simple>${balises}</body></html>`)
  writeFileSync(join(src, 'simple.mjs'), simple('Simple v1'))
  CAS.forEach(([, corps, , gabarit], i) => writeFileSync(join(src, `cas${i}.mjs`), avecCorps(corps, 'v1', gabarit)))
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
    }, 90000)
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

// texte d'un nœud de l'ombre d'un composant de la page : `chemin` = sélecteurs d'hôtes successifs, le dernier vise le nœud
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

const pause = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('mjs dev — liste blanche : dans le doute la page se recharge, un composant simple reste à chaud (trois navigateurs)', function () {
  this.timeout(300000)

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    it(`${moteur} : composant simple à chaud, erreurs annulées sans rechargement, chaque forme relevée recharge la page`, async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      const { root, src } = projet()
      const port = 22000 + Math.floor(Math.random() * 8000)
      const dev  = await lancerDev(root, port)
      const browser = await playwright[moteur].launch()
      try {
        const page     = await browser.newPage()
        const base     = `http://127.0.0.1:${port}`
        const lire     = (chemin: string[]) => page.evaluate(`(${LIRE})(${JSON.stringify(chemin)})`).catch(() => null) as Promise<string | null>
        const marque   = () => page.evaluate('window.__marque').catch(() => 'navigation')
        const attendre = async (chemin: string[], attendu: string, quoi: string) => {
          const fin = Date.now() + 20000
          let vu: string | null = null
          while (Date.now() < fin) {
            vu = await lire(chemin)
            if (vu === attendu) return
            await pause(50)
          }
          assert.fail(`${quoi} : attendu ${attendu}, vu ${vu}\n--- mjs dev ---\n${dev.stdout()}`)
        }
        const cliquer         = (sel: string) => page.evaluate(`document.querySelector('#s')._shadow.querySelector(${JSON.stringify(sel)}).click()`)
        const etat            = (k: string) => page.evaluate(`document.querySelector('#s')._state[${JSON.stringify(k)}]`)
        const overlay         = () => page.evaluate('!!document.getElementById("__mjs_hmr_overlay")').catch(() => false)
        const attendreOverlay = async (voulu: boolean, quoi: string) => {
          const fin = Date.now() + 20000
          while (Date.now() < fin && (await overlay()) !== voulu) await pause(50)
          assert.equal(await overlay(), voulu, `${quoi} : affichage de l'erreur ${voulu ? 'attendu' : 'resté'}\n${dev.stdout()}`)
        }
        const garde = async (quoi: string) => {
          assert.equal(await marque(), 1, `${quoi} : la page a été rechargée\n${dev.stdout()}`)
          assert.equal(await etat('count'), 2, `${quoi} : état perdu`)
          assert.equal(await etat('nom'), 'Zoé', `${quoi} : saisie perdue`)
        }

        await page.goto(base + '/')
        await attendre(['#s', '.titre'], 'Simple v1', 'premier rendu')
        await page.evaluate('window.__marque = 1')
        await cliquer('.plus')
        await cliquer('.plus')
        await cliquer('.ajoute')
        await page.evaluate(`(() => { const c = document.querySelector('#s')._shadow.querySelector('.nom'); c.value = 'Zoé'; c.dispatchEvent(new Event('input', { bubbles: true, composed: true })) })()`)
        await attendre(['#s', '.val'], '2 2', 'clics')

        // composant simple : à chaud, état gardé, y compris revenu à un texte déjà chargé (le module se rejoue)
        for (const titre of ['Simple v2', 'Simple v1', 'Simple v3']) {
          writeFileSync(join(src, 'simple.mjs'), simple(titre))
          await attendre(['#s', '.titre'], titre, `gabarit « ${titre} »`)
          await garde(`gabarit « ${titre} »`)
          assert.equal(await lire(['#s', '.val']), '2 2')
        }
        const fin = Date.now() + 10000
        while (Date.now() < fin && (dev.stdout().match(ETAT_GARDE) ?? []).length < 3) await pause(50)
        assert.equal((dev.stdout().match(ETAT_GARDE) ?? []).length, 3, `trois échanges faits, trois « état gardé »\n${dev.stdout()}`)

        // erreurs annulées : l'affichage part, la page reste
        const v3 = simple('Simple v3')
        for (const [quoi, casse] of [['erreur de syntaxe', v3.replace('inc = -> $count++', 'inc = -> $count++ )(')], ['module cœur introuvable', v3 + '\n<@@inexistant></@@inexistant>']]) {
          writeFileSync(join(src, 'simple.mjs'), casse)
          await attendreOverlay(true, quoi)
          writeFileSync(join(src, 'simple.mjs'), v3)
          await attendreOverlay(false, `${quoi} annulée`)
          await pause(1200)
          await garde(`${quoi} annulée`)
        }
        writeFileSync(join(root, 'styles', 'theme.scss'), '.carte { color: red;\n')
        await attendreOverlay(true, 'feuille partagée en erreur')
        writeFileSync(join(root, 'styles', 'theme.scss'), THEME)
        await attendreOverlay(false, 'feuille partagée revenue au texte d\'avant')
        await pause(1200)
        await garde('feuille partagée revenue au texte d\'avant')
        writeFileSync(join(root, 'styles', 'theme.scss'), THEME)
        writeFileSync(join(src, 'simple.mjs'), v3)
        await pause(2500)
        await garde('sauvegardes sans changement')
        assert.equal((dev.stdout().match(ETAT_GARDE) ?? []).length, 3, `aucun « état gardé » de plus\n${dev.stdout()}`)

        // chaque forme relevée par les vérifications : la page se recharge
        for (let i = 0; i < CAS.length; i++) {
          const [quoi, corps, corps2, gabarit] = CAS[i]
          await attendre(['#s', '.titre'], 'Simple v3', `page prête avant « ${quoi} »`)
          await page.evaluate('window.__marque = 1')
          writeFileSync(join(src, `cas${i}.mjs`), avecCorps(corps2 ?? corps, 'v2', gabarit))
          const finCas   = Date.now() + 20000
          let m: unknown = 1
          while (Date.now() < finCas) {
            m = await marque()
            if (m !== 1) break
            const t = await lire([`#c${i}`, '.t'])
            assert.ok(!t || !t.startsWith('v2'), `« ${quoi} » : échangé à chaud au lieu de recharger la page\n${dev.stdout()}`)
            await pause(50)
          }
          assert.notEqual(m, 1, `« ${quoi} » : la page ne s'est pas rechargée\n${dev.stdout()}`)
        }
        await attendre(['#s', '.titre'], 'Simple v3', 'page prête après le dernier cas')
        assert.equal((dev.stdout().match(/état gardé/g) ?? []).length, 3, `le terminal ne dit jamais « état gardé » pour une page rechargée\n${dev.stdout()}`)
      }
      finally {
        await browser.close()
        await dev.kill()
      }
    })
  }
})
