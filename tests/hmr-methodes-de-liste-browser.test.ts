// `mjs dev` réel et trois navigateurs : une dérivée qui appelle des méthodes de liste qui ne modifient rien (`filter`, `map`, `find`,
// `some`…) avec des rappels simples, mêlées à la traduction (`µt`) et au magasin (`$$x`), passe à chaud en gardant son état ; une
// écriture du magasin et une bascule de langue juste après l'échange la mettent à jour. Une variable `$` qui tient un objet de l'appli
// porteur de sa propre méthode `filter` recharge la page avant le départ de l'ancienne instance : ni cette méthode ni l'ancien
// `µdestroy` ne jouent. Une écriture du magasin faite pendant l'échange (ancien `µsleep`, ancien `µdestroy`) refait les dérivées qui
// lisent la clé ; `?.` entre `µ`, `store` et la clé, ou sur `µ.t`, recharge la page.

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

// dérivées d'une liste de l'appli, du magasin et de la traduction ; `sep` : séparateur de `$noms` (une dérivée modifiée)
const liste = (v: number, sep = '-') => [
  '@i18n \'admin\'',
  '<script>',
  '$items = [{ id: 1, ok: true, n: 2, nom: \'a\' }, { id: 2, ok: false, n: 3, nom: \'b\' }]',
  '$sel = 1',
  '$vis = $items.filter((x) -> x.ok)',
  `$noms = $items.map((x) -> x.nom).join('${sep}')`,
  '$choisi = ($$listes or []).filter((l) -> l.id is $sel).map((l) -> l.nom).join(\'\')',
  '$gros = if $items.some((x) -> x.n > 4) then \'G\' else \'p\'',
  '$premier = $items.find((x) -> x.ok)',
  '$titre = µt(\'nb\', { n: $vis.length })',
  'ajoute = -> $items = [...$items, { id: 3, ok: true, n: 7, nom: \'c\' }]',
  'choisit = -> $sel = 2',
  '</script>',
  '',
  '<button class="aj" @click={ajoute}>+</button>',
  '<button class="ch" @click={choisit}>c</button>',
  `<p class="li">L v${v} {$vis.length}|{$noms}|{$choisi}|{$gros}|{$premier.nom}|{$titre}</p>`,
].join('\n')

// une variable `$` qui reçoit un objet de l'appli dont la méthode `filter` compte ses appels hors de la page (sessionStorage)
const piege = (v: number, rappel = '(x) -> x.ok') => [
  '<script>',
  '$items = [{ ok: true }]',
  `$vis = $items.filter(${rappel})`,
  'arme = -> $items = { filter: -> sessionStorage.setItem(\'__f\', String(Number(sessionStorage.getItem(\'__f\') or 0) + 1)); [] }',
  '</script>',
  '',
  '<button class="ar" @click={arme}>a</button>',
  `<p class="pg">P v${v} {$vis.length}</p>`,
].join('\n')

// l'ancien µsleep et l'ancien µdestroy écrivent des clés du magasin que lisent des dérivées gardées
const sorties = (v: number) => ['<script>', '$t = $$sorties', '$u = $$sommeils', 'µsleep ->', '  $$sommeils = ($$sommeils or 0) + 1', 'µdestroy ->', '  $$sorties = ($$sorties or 0) + 1', '</script>', '', `<p class="so">S v${v} {$t}|{$u}</p>`].join('\n')

// `?.` entre µ.store et la clé, puis sur µ.t : lectures que la page ne suivrait pas
const magasinOpt = (v: number) => ['<script>', '$t = µ.store?.total', '</script>', '', `<p class="op">O v${v} {$t}</p>`].join('\n')
const tradOpt    = (v: number) => ['@i18n \'admin\'', '<script>', '$count = 1', '$titre = µ?.t(\'nb\', { n: $count })', '</script>', '', `<p class="tr">T v${v} {$titre}</p>`].join('\n')

// objet de l'appli porteur de sa propre méthode filter, et un µdestroy qui compte ses appels hors de la page
const depart = (v: number, rappel = '(x) -> x.ok') => ['<script>', '$items = [{ ok: true }]', `$vis = $items.filter(${rappel})`, 'arme = -> $items = { filter: -> [] }', 'µdestroy ->', '  sessionStorage.setItem(\'__dd\', String(Number(sessionStorage.getItem(\'__dd\') or 0) + 1))', '</script>', '', '<button class="ar" @click={arme}>a</button>', `<p class="dd">D v${v} {$vis.length}</p>`].join('\n')

function projet(): { root: string, src: string } {
  const root = mjsTmp('hmr-methodes-liste')
  const src  = join(root, 'src')
  for (const l of ['fr', 'en']) mkdirSync(join(src, 'i18n', l), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', i18n: { default: 'fr' } }))
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-liste id="l"></mjs-liste><mjs-sorties id="so"></mjs-sorties><mjs-magopt id="op"></mjs-magopt><mjs-tradopt id="tr"></mjs-tradopt><mjs-depart id="dd"></mjs-depart><mjs-piege id="p"></mjs-piege></body></html>')
  writeFileSync(join(src, 'i18n', 'fr.yml'), 'accueil: Accueil\n')
  writeFileSync(join(src, 'i18n', 'en.yml'), 'accueil: Home\n')
  writeFileSync(join(src, 'i18n', 'fr', 'admin.yml'), 'nb: "Nb %{n}"\n')
  writeFileSync(join(src, 'i18n', 'en', 'admin.yml'), 'nb: "Count %{n}"\n')
  writeFileSync(join(src, 'liste.mjs'), liste(1))
  writeFileSync(join(src, 'piege.mjs'), piege(1))
  for (const [n, f] of [['sorties', sorties], ['magopt', magasinOpt], ['tradopt', tradOpt], ['depart', depart]] as const) writeFileSync(join(src, `${n}.mjs`), (f as (v: number) => string)(1))
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

// texte d'un nœud de l'ombre d'un composant de la page
const LIRE = `(hote, sel) => {
  const h = document.querySelector(hote)
  const n = h && h._shadow ? h._shadow.querySelector(sel) : null
  return n ? n.textContent.trim() : null
}`

const pause = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('mjs dev — dérivées qui appellent des méthodes de liste avec des rappels simples : à chaud, état gardé ; receveur de l\'appli : rechargement (trois navigateurs)', function () {
  this.timeout(300000)

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    describe(moteur, function () {
      let dev: Dev | null = null
      let browser: any    = null
      let page: any       = null
      let src             = ''
      const lire     = (hote: string, sel: string) => page.evaluate(`(${LIRE})(${JSON.stringify(hote)}, ${JSON.stringify(sel)})`).catch(() => null) as Promise<string | null>
      const marque   = () => page.evaluate('window.__marque').catch(() => 'navigation')
      const sortie   = () => dev ? dev.stdout() : ''
      const attendre = async (hote: string, sel: string, attendu: string, quoi: string) => {
        const fin = Date.now() + 20000
        let vu: string | null = null
        while (Date.now() < fin) {
          vu = await lire(hote, sel)
          if (vu === attendu) return
          await pause(50)
        }
        assert.fail(`${quoi} : attendu ${attendu}, vu ${vu}\n--- mjs dev ---\n${sortie()}`)
      }
      const garde   = async (quoi: string) => assert.equal(await marque(), 1, `${quoi} : la page a été rechargée\n--- mjs dev ---\n${sortie()}`)
      const cliquer = (hote: string, sel: string) => page.evaluate(`document.querySelector(${JSON.stringify(hote)})._shadow.querySelector(${JSON.stringify(sel)}).click()`)
      const langue  = (l: string) => page.evaluate(`window.µ.store.__mjsLang = ${JSON.stringify(l)}`)
      // échange qui doit recharger la page : nouveau code affiché après le rechargement, page marquée de nouveau
      const rechargee = async (fichier: string, texte: string, hote: string, sel: string, debut: string, quoi: string) => {
        writeFileSync(join(src, fichier), texte)
        const fin = Date.now() + 20000
        while (Date.now() < fin && await marque() === 1) await pause(50)
        assert.notEqual(await marque(), 1, `${quoi} : la page devait se recharger\n--- mjs dev ---\n${sortie()}`)
        await attendre(hote, sel, debut, `${quoi} : après le rechargement`)
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
        await attendre('#l', '.li', 'L v1 1|a-b||p|a|Nb 1', 'premier rendu')
        await page.evaluate('window.µ.store.sorties = 0; window.µ.store.sommeils = 0; window.µ.store.total = 1')
        await page.evaluate('window.__marque = 1')
      })

      after(async () => {
        if (browser) await browser.close()
        if (dev) await dev.kill()
      })

      it('filter, map, find, some, join mêlés au magasin et à µt : à chaud, état gardé ; magasin puis langue changés juste après l\'échange ; dérivée modifiée recalculée sur l\'état gardé', async () => {
        await cliquer('#l', '.aj')
        await page.evaluate('window.µ.store.listes = [{ id: 1, nom: \'X\' }, { id: 2, nom: \'Y\' }]')
        await cliquer('#l', '.ch')
        await attendre('#l', '.li', 'L v1 2|a-b-c|Y|G|a|Nb 2', 'clics et magasin')
        writeFileSync(join(src, 'liste.mjs'), liste(2))
        await attendre('#l', '.li', 'L v2 2|a-b-c|Y|G|a|Nb 2', 'échange v2')
        await garde('échange v2')
        await page.evaluate('window.µ.store.listes = [{ id: 2, nom: \'Z\' }]')
        await attendre('#l', '.li', 'L v2 2|a-b-c|Z|G|a|Nb 2', 'magasin écrit juste après l\'échange')
        await langue('en')
        await attendre('#l', '.li', 'L v2 2|a-b-c|Z|G|a|Count 2', 'langue changée juste après l\'échange')
        writeFileSync(join(src, 'liste.mjs'), liste(3, '+'))
        await attendre('#l', '.li', 'L v3 2|a+b+c|Z|G|a|Count 2', 'échange v3, dérivée modifiée')
        await garde('échange v3')
        await langue('fr')
        await attendre('#l', '.li', 'L v3 2|a+b+c|Z|G|a|Nb 2', 'retour au français')
        assert.match(sortie(), /mjs-liste — rechargé à chaud, état gardé/)
      })

      it('magasin écrit pendant l\'échange par l\'ancien µsleep et l\'ancien µdestroy : les dérivées qui lisent ces clés sont refaites, à chaud', async () => {
        await attendre('#so', '.so', 'S v1 0|0', 'départ')
        writeFileSync(join(src, 'sorties.mjs'), sorties(2))
        await attendre('#so', '.so', 'S v2 1|1', 'échange : écritures du départ comptées')
        await garde('échange des sorties')
      })

      it('µ.store?.x et µ?.t(…) dans une dérivée : la page se recharge', async () => {
        await attendre('#op', '.op', 'O v1', 'départ')
        await page.evaluate('window.µ._mjs_storeRawWrite.total = 9')
        await rechargee('magopt.mjs', magasinOpt(2), '#op', '.op', 'O v2', 'µ.store?.total')
        await attendre('#tr', '.tr', 'T v1 Nb 1', 'départ de la traduction')
        await rechargee('tradopt.mjs', tradOpt(2), '#tr', '.tr', 'T v2 Nb 1', 'µ?.t')
      })

      it('objet de l\'appli porteur de sa propre méthode filter : la page se recharge avant le départ de l\'ancienne instance (µdestroy non joué)', async () => {
        await page.evaluate('sessionStorage.removeItem(\'__dd\')')
        await cliquer('#dd', '.ar')
        await attendre('#dd', '.dd', 'D v1 0', 'objet de l\'appli rangé dans $items')
        await rechargee('depart.mjs', depart(2, '(x) -> x.ok is true'), '#dd', '.dd', 'D v2 1', 'receveur de l\'appli')
        assert.equal(await page.evaluate('sessionStorage.getItem(\'__dd\')'), null, 'l\'ancien µdestroy a joué avant le rechargement')
      })

      it('variable $ qui tient un objet de l\'appli porteur de sa propre méthode filter : la page se recharge, l\'échange ne l\'a pas appelée', async () => {
        await cliquer('#p', '.ar')
        await attendre('#p', '.pg', 'P v1 0', 'objet de l\'appli rangé dans $items')
        const avant = await page.evaluate('sessionStorage.getItem(\'__f\')')
        assert.ok(Number(avant) >= 1, `la méthode de l'appli n'a pas servi au rendu (${avant})`)
        writeFileSync(join(src, 'piege.mjs'), piege(2, '(x) -> x.ok is true'))
        const fin = Date.now() + 20000
        while (Date.now() < fin && await marque() === 1) await pause(50)
        assert.notEqual(await marque(), 1, `la page devait se recharger\n--- mjs dev ---\n${sortie()}`)
        await attendre('#p', '.pg', 'P v2 1', 'page rechargée, nouveau code')
        assert.equal(await page.evaluate('sessionStorage.getItem(\'__f\')'), avant, 'l\'échange a appelé la méthode filter de l\'appli')
      })
    })
  }
})
