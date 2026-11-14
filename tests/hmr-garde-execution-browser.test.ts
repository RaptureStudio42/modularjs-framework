// `mjs dev` réel et trois navigateurs : la garde à l'exécution de l'échange à chaud. Un champ de l'instance réécrit, retiré ou ajouté
// depuis sa construction, par n'importe quel chemin (`@['fmt'] =`, alias, Object.defineProperty, Object.assign, Reflect, gabarit),
// recharge la page au lieu de garder un état faux ; à l'échange, l'état `$` passe tel quel et une dérivée dont le texte n'a pas changé
// garde sa valeur (aucun `valueOf`, aucune trappe de Proxy rappelés) ; seule une dérivée modifiée se recalcule, une fois ; un plantage
// pendant l'échange, même pris par le rendu, recharge la page ; un composant simple reste à chaud.

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

// réécriture déguisée d'une fonction posée sur l'instance (@fmt), par un gestionnaire ou par le gabarit
const REDEF: [string, string[], string, string][] = [
  ['@[\'fmt\'] =', ['@[\'fmt\'] = (x) -> "B#{x}"'], '', 'B:B1'],
  ['alias local', ['moi = this', 'moi.fmt = (x) -> "B#{x}"'], '', 'B:B1'],
  ['Object.defineProperty', ['Object.defineProperty(this, \'fmt\', { value: ((x) -> "B#{x}"), writable: true, configurable: true })'], '', 'B:B1'],
  ['Object.assign', ['Object.assign(this, { fmt: (x) -> "B#{x}" })'], '', 'B:B1'],
  ['Reflect.set', ['Reflect.set(this, \'fmt\', (x) -> "B#{x}")'], '', 'B:B1'],
  ['@fmt = (témoin)', ['@fmt = (x) -> "B#{x}"'], '', 'B:B1'],
  ['@[…] dans le gabarit', [], '<i class="g" @click={@[\'fmt\'] = (x) -> "B#{x}"}>g</i>', 'B:B1'],
  ['champ retiré (Reflect.deleteProperty)', ['Reflect.deleteProperty(this, \'fmt\')', '@__proto__.fmt = (x) -> "B#{x}"'], '', 'B:B1'],
  ['accesseur ajouté', ['Object.defineProperty(this, \'neuf\', { get: (-> 1), configurable: true })'], '', 'B:A1'],
]
const redef = (i: number, v: number) => {
  const [, ecr, gab] = REDEF[i]
  return ['<script>', '$mode = \'A\'', '@fmt = (x) -> "A#{x}"', 'bascule = ->', ...ecr.map(l => '  ' + l), '  $mode = \'B\'', '</script>', '', '<button class="bs" @click={bascule}>b</button>', gab, `<p class="rd">R v${v} {$mode + ':' + @fmt(1)}</p>`].join('\n')
}

// objet dont `valueOf` ouvre une minuterie, Proxy dont la trappe de `.length` compte ses appels, rangés dans l'état par un gestionnaire
const coerce = (v: number, facteur = 2) => [
  '<script>',
  '$p = 0',
  '$r = []',
  'arme = ->',
  '  $p = { valueOf() { window.__vo = (window.__vo || 0) + 1; window.__fuite(); return 2 } }',
  '  $r = new Proxy([], { get(t, k) { if (k === \'length\') { window.__px = (window.__px || 0) + 1 }; return t[k] } })',
  `$t = $p * ${facteur}`,
  '$m = $r.length',
  '</script>',
  '',
  '<button class="ar" @click={arme}>a</button>',
  `<p class="co">C v${v} {$t} {$m}</p>`,
].join('\n')

// le gabarit v2 lit `$o.a` alors que l'état gardé tient `$o` à null : le rendu plante pendant l'échange
const leve = (v: number, e: string) => ['<script>', '$o = { a: 1 }', 'vide = -> $o = null', '</script>', '', '<button class="vd" @click={vide}>v</button>', `<p class="lv">L v${v} {${e}}</p>`].join('\n')

function projet(): { root: string, src: string } {
  const root = mjsTmp('hmr-garde-execution')
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js' }))
  const balises = REDEF.map((_c, i) => `<mjs-redef${i} id="r${i}"></mjs-redef${i}>`).join('')
  // la minuterie à la main vient de la page (un composant ne le peut pas) : chaque appel de valueOf la lance, un appel de trop se voit aux tics
  writeFileSync(join(root, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><script>window.__fuite = () => setInterval(() => { window.__ct = (window.__ct || 0) + 1 }, 100)</script><script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-simple id="s"></mjs-simple><mjs-coerce id="co"></mjs-coerce><mjs-leve id="lv"></mjs-leve>${balises}</body></html>`)
  writeFileSync(join(src, 'simple.mjs'), simple('Simple v1'))
  writeFileSync(join(src, 'coerce.mjs'), coerce(1))
  writeFileSync(join(src, 'leve.mjs'), leve(1, '$o?.a'))
  REDEF.forEach((_c, i) => writeFileSync(join(src, `redef${i}.mjs`), redef(i, 1)))
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

describe('mjs dev — garde à l\'exécution : champ réécrit, plantage pendant l\'échange, rien de rejoué qui n\'a pas changé (trois navigateurs)', function () {
  this.timeout(300000)

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    describe(moteur, function () {
      let dev: Dev | null = null
      let browser: any    = null
      let page: any       = null
      let src             = ''
      const lire     = (chemin: string[]) => page.evaluate(`(${LIRE})(${JSON.stringify(chemin)})`).catch(() => null) as Promise<string | null>
      const marque   = () => page.evaluate('window.__marque').catch(() => 'navigation')
      const fenetre  = (k: string) => page.evaluate(`window.${k} || 0`).catch(() => -1) as Promise<number>
      const sortie   = () => dev ? dev.stdout() : ''
      const voir     = async (chemin: string[], attendu: RegExp) => {
        const fin = Date.now() + 20000
        let vu: string | null = null
        while (Date.now() < fin) {
          vu = await lire(chemin)
          if (vu !== null && attendu.test(vu)) return vu
          await pause(50)
        }
        return vu
      }
      const attendre = async (chemin: string[], attendu: string, quoi: string) => {
        const vu = await voir(chemin, new RegExp('^' + attendu.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'))
        if (vu !== attendu) assert.fail(`${quoi} : attendu ${attendu}, vu ${vu}\n--- mjs dev ---\n${sortie()}`)
      }
      const cliquer = (hote: string, sel: string) => page.evaluate(`document.querySelector(${JSON.stringify(hote)})._shadow.querySelector(${JSON.stringify(sel)}).click()`)
      const etat    = (k: string) => page.evaluate(`document.querySelector('#s')._state[${JSON.stringify(k)}]`)
      const gardes  = (nom: string) => (sortie().match(new RegExp(`${nom} — rechargé à chaud, état gardé`, 'g')) ?? []).length
      const ticks   = () => page.evaluate('new Promise(r => { const c = window.__ct || 0; setTimeout(() => r((window.__ct || 0) - c), 1000) })') as Promise<number>
      const pret    = async () => {
        await attendre(['#s', '.titre'], 'Simple v3', 'page prête')
        await page.evaluate('window.__marque = 1')
      }

      before(async function () {
        const playwright = await import('playwright')
        if (!existsSync(playwright[moteur].executablePath())) this.skip()
        const p    = projet()
        src        = p.src
        const port = 22000 + Math.floor(Math.random() * 8000)
        dev        = await lancerDev(p.root, port)
        browser    = await playwright[moteur].launch()
        page       = await browser.newPage()
        await page.goto(`http://127.0.0.1:${port}/`)
        await attendre(['#s', '.titre'], 'Simple v1', 'premier rendu')
        await page.evaluate('window.__marque = 1')
      })

      after(async () => {
        if (browser) await browser.close()
        if (dev) await dev.kill()
      })

      it('composant simple et fonction de l\'instance jamais réécrite : à chaud, état gardé', async () => {
        await cliquer('#s', '.plus')
        await cliquer('#s', '.plus')
        await cliquer('#s', '.ajoute')
        await page.evaluate(`(() => { const c = document.querySelector('#s')._shadow.querySelector('.nom'); c.value = 'Zoé'; c.dispatchEvent(new Event('input', { bubbles: true, composed: true })) })()`)
        await attendre(['#s', '.val'], '2 2', 'clics')
        for (const titre of ['Simple v2', 'Simple v3']) {
          writeFileSync(join(src, 'simple.mjs'), simple(titre))
          await attendre(['#s', '.titre'], titre, `gabarit « ${titre} »`)
          assert.equal(await marque(), 1, `gabarit « ${titre} » : la page a été rechargée\n${sortie()}`)
          assert.equal(await etat('count'), 2, `gabarit « ${titre} » : état perdu`)
          assert.equal(await etat('nom'), 'Zoé', `gabarit « ${titre} » : saisie perdue`)
          assert.equal(await lire(['#s', '.val']), '2 2')
        }
        writeFileSync(join(src, 'redef3.mjs'), redef(3, 2))
        await attendre(['#r3', '.rd'], 'R v2 A:A1', 'champ jamais réécrit')
        assert.equal(await marque(), 1, `champ jamais réécrit : la page a été rechargée\n${sortie()}`)
      })

      it('valueOf qui ouvre une minuterie, trappe .length d\'un Proxy : rien de rappelé par deux échanges, une fois par la dérivée modifiée', async () => {
        await pret()
        await cliquer('#co', '.ar')
        await attendre(['#co', '.co'], 'C v1 4 0', 'objets piégés rangés dans l\'état')
        const vo0 = await fenetre('__vo')
        const px0 = await fenetre('__px')
        assert.ok(vo0 >= 1 && px0 >= 1, `valueOf et la trappe appelés par le calcul de départ (vo=${vo0}, px=${px0})`)
        for (const v of [2, 3]) {
          writeFileSync(join(src, 'coerce.mjs'), coerce(v))
          await attendre(['#co', '.co'], `C v${v} 4 0`, `échange ${v - 1} sans toucher la dérivée`)
          await pause(300)
          assert.equal(await marque(), 1, `échange ${v - 1} : la page a été rechargée\n${sortie()}`)
          assert.equal(await fenetre('__vo'), vo0, `échange ${v - 1} : valueOf rappelé`)
          assert.equal(await fenetre('__px'), px0, `échange ${v - 1} : trappe .length rappelée`)
        }
        const t2 = await ticks()
        assert.ok(t2 >= 5 && t2 <= 15, `une seule minuterie après deux échanges (${t2} tics par seconde)`)
        writeFileSync(join(src, 'coerce.mjs'), coerce(4, 3))
        await attendre(['#co', '.co'], 'C v4 6 0', 'dérivée modifiée')
        await pause(300)
        assert.equal(await marque(), 1, `dérivée modifiée : la page a été rechargée\n${sortie()}`)
        assert.equal(await fenetre('__vo'), vo0 + 1, 'dérivée modifiée : recalculée une fois')
        assert.equal(await fenetre('__px'), px0, 'dérivée modifiée : l\'autre dérivée n\'est pas recalculée')
      })

      it('échange qui lève dans le rendu : rechargement, puis la page montre la v2', async () => {
        await pret()
        await cliquer('#lv', '.vd')
        await attendre(['#lv', '.lv'], 'L v1', '$o mis à null')
        writeFileSync(join(src, 'leve.mjs'), leve(2, '$o.a'))
        const vu = await voir(['#lv', '.lv'], /^L v2 1$/)
        assert.notEqual(await marque(), 1, `échange qui lève : la page ne s'est pas rechargée (vu ${vu})\n${sortie()}`)
        assert.equal(vu, 'L v2 1', 'v2 après le rechargement')
        assert.equal(gardes('mjs-leve'), 0, `échange qui lève : « état gardé » écrit\n${sortie()}`)
      })

      it('champ réécrit, retiré ou ajouté depuis la construction, par n\'importe quel chemin : la page se recharge', async () => {
        const fautes: string[] = []
        for (let i = 0; i < REDEF.length; i++) {
          const [quoi, , gab, apres] = REDEF[i]
          await pret()
          if (gab) await cliquer(`#r${i}`, '.g')
          await cliquer(`#r${i}`, '.bs')
          const v = i === 3 ? 2 : 1
          await attendre([`#r${i}`, '.rd'], `R v${v} ${apres}`, `« ${quoi} » : réécriture faite`)
          writeFileSync(join(src, `redef${i}.mjs`), redef(i, 3))
          const vu = await voir([`#r${i}`, '.rd'], /^R v3 /)
          const m  = await marque()
          if (m === 1 || vu !== 'R v3 A:A1') fautes.push(`« ${quoi} » : ${m === 1 ? 'échangé à chaud' : 'rechargé'}, vu ${vu}`)
        }
        assert.deepEqual(fautes, [], `${fautes.join('\n')}\n--- mjs dev ---\n${sortie()}`)
      })

      it('le terminal ne dit « état gardé » que pour les six échanges faits', async () => {
        await pret()
        const fin = Date.now() + 5000
        while (Date.now() < fin && gardes('mjs-coerce') < 3) await pause(50)
        assert.equal(gardes('mjs-simple'), 2, `deux échanges du composant simple\n${sortie()}`)
        assert.equal(gardes('mjs-redef3'), 1, `un échange du champ jamais réécrit\n${sortie()}`)
        assert.equal(gardes('mjs-coerce'), 3, `trois échanges des objets piégés\n${sortie()}`)
        assert.equal((sortie().match(/état gardé/g) ?? []).length, 6, `« état gardé » seulement pour les six échanges faits\n${sortie()}`)
      })
    })
  }
})
