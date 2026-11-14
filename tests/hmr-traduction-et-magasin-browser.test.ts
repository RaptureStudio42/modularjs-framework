// `mjs dev` réel et trois navigateurs : une dérivée qui traduit (`µt`) ou lit le magasin (`$$x`) passe à chaud en gardant son état.
// Une dérivée dont le texte n'a pas changé garde sa valeur sans être recalculée (le `toString` d'une valeur passée à `µt` n'est pas
// rappelé) tant qu'aucune de ses sources — variables `$`, clés du magasin, langue — n'a changé depuis son dernier calcul ; une clé du
// magasin écrite sans rendu (`µwrite`) avant l'échange la fait recalculer ; une bascule de langue ou une écriture du magasin juste
// après l'échange la met à jour.

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

// traduction dans une dérivée, une variable `$` en valeur : `arme` y range un objet dont le `toString` compte ses appels
const trad = (v: number) => [
  '@i18n \'admin\'',
  '<script>',
  '$count = 0',
  '$p = 0',
  '$titre = µt(\'titre\', { n: $count })',
  '$nb = µt(\'nb\', { n: $p })',
  'inc = -> $count++',
  'arme = ->',
  '  $p = { toString() { window.__ts = (window.__ts || 0) + 1; return \'P\' } }',
  '</script>',
  '',
  '<button class="plus" @click={inc}>+</button>',
  '<button class="ar" @click={arme}>a</button>',
  `<p class="tr">T v${v} {$titre} | {$nb}</p>`,
].join('\n')

// magasin lu dans une dérivée
const mag = (v: number) => ['<script>', '$count = 1', '$total = ($$panier?.total ?? 0) * $count', 'inc = -> $count++', 'remplit = -> $$panier = { total: 3 }', '</script>', '', '<button class="plus" @click={inc}>+</button>', '<button class="rp" @click={remplit}>r</button>', `<p class="mg">M v${v} {$total}</p>`].join('\n')

// les deux : le magasin lu dans les valeurs d'une traduction
const lesDeux = (v: number) => ['@i18n \'admin\'', '<script>', '$n = 2', '$lib = µt(\'panier\', { n: ($$prix ?? 0) * $n })', '</script>', '', `<p class="ld">D v${v} {$lib}</p>`].join('\n')

function projet(): { root: string, src: string } {
  const root = mjsTmp('hmr-traduction-magasin')
  const src  = join(root, 'src')
  for (const l of ['fr', 'en']) mkdirSync(join(src, 'i18n', l), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', i18n: { default: 'fr' } }))
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-trad id="t"></mjs-trad><mjs-mag id="m"></mjs-mag><mjs-lesdeux id="d"></mjs-lesdeux></body></html>')
  writeFileSync(join(src, 'i18n', 'fr.yml'), 'accueil: Accueil\n')
  writeFileSync(join(src, 'i18n', 'en.yml'), 'accueil: Home\n')
  writeFileSync(join(src, 'i18n', 'fr', 'admin.yml'), 'titre: "Titre %{n}"\nnb: "Nb %{n}"\npanier: "Panier %{n}"\n')
  writeFileSync(join(src, 'i18n', 'en', 'admin.yml'), 'titre: "Title %{n}"\nnb: "Count %{n}"\npanier: "Cart %{n}"\n')
  writeFileSync(join(src, 'trad.mjs'), trad(1))
  writeFileSync(join(src, 'mag.mjs'), mag(1))
  writeFileSync(join(src, 'lesdeux.mjs'), lesDeux(1))
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

describe('mjs dev — dérivées qui traduisent ou lisent le magasin : à chaud, état gardé, langue et magasin suivis (trois navigateurs)', function () {
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
      const voir     = async (chemin: string[], attendu: string) => {
        const fin = Date.now() + 20000
        let vu: string | null = null
        while (Date.now() < fin) {
          vu = await lire(chemin)
          if (vu === attendu) return vu
          await pause(50)
        }
        return vu
      }
      const attendre = async (chemin: string[], attendu: string, quoi: string) => {
        const vu = await voir(chemin, attendu)
        if (vu !== attendu) assert.fail(`${quoi} : attendu ${attendu}, vu ${vu}\n--- mjs dev ---\n${sortie()}`)
      }
      const garde   = async (quoi: string) => assert.equal(await marque(), 1, `${quoi} : la page a été rechargée\n--- mjs dev ---\n${sortie()}`)
      const cliquer = (hote: string, sel: string) => page.evaluate(`document.querySelector(${JSON.stringify(hote)})._shadow.querySelector(${JSON.stringify(sel)}).click()`)
      const langue  = (l: string) => page.evaluate(`window.µ.store.__mjsLang = ${JSON.stringify(l)}`)

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
        await attendre(['#t', '.tr'], 'T v1 Titre 0 | Nb 0', 'premier rendu')
        await page.evaluate('window.__marque = 1')
      })

      after(async () => {
        if (browser) await browser.close()
        if (dev) await dev.kill()
      })

      it('traduction dans une dérivée : à chaud, état gardé, rien de recalculé ; langue changée juste après l\'échange', async () => {
        await cliquer('#t', '.plus')
        await cliquer('#t', '.plus')
        await cliquer('#t', '.ar')
        await attendre(['#t', '.tr'], 'T v1 Titre 2 | Nb P', 'clics')
        const ts = await fenetre('__ts')
        writeFileSync(join(src, 'trad.mjs'), trad(2))
        await attendre(['#t', '.tr'], 'T v2 Titre 2 | Nb P', 'échange v2')
        await garde('échange v2')
        assert.equal(await fenetre('__ts'), ts, 'dérivée inchangée recalculée à l\'échange (toString rappelé)')
        await langue('en')
        await attendre(['#t', '.tr'], 'T v2 Title 2 | Count P', 'langue changée juste après l\'échange')
        const ts2 = await fenetre('__ts')
        writeFileSync(join(src, 'trad.mjs'), trad(3))
        await attendre(['#t', '.tr'], 'T v3 Title 2 | Count P', 'échange v3, en anglais')
        await garde('échange v3')
        assert.equal(await fenetre('__ts'), ts2, 'dérivée inchangée recalculée au second échange')
        await cliquer('#t', '.plus')
        await attendre(['#t', '.tr'], 'T v3 Title 3 | Count P', 'clic après l\'échange')
        await langue('fr')
        await attendre(['#t', '.tr'], 'T v3 Titre 3 | Nb P', 'retour au français')
      })

      it('magasin lu dans une dérivée : à chaud, état gardé ; écrit juste après l\'échange, ou écrit sans rendu (µwrite) juste avant', async () => {
        await cliquer('#m', '.rp')
        await cliquer('#m', '.plus')
        await attendre(['#m', '.mg'], 'M v1 6', 'clics')
        writeFileSync(join(src, 'mag.mjs'), mag(2))
        await attendre(['#m', '.mg'], 'M v2 6', 'échange v2')
        await garde('échange v2')
        await page.evaluate('window.µ.store.panier = { total: 5 }')
        await attendre(['#m', '.mg'], 'M v2 10', 'magasin écrit juste après l\'échange')
        // écriture sans rendu : la dérivée est périmée, l'affichage ne bouge pas
        await page.evaluate('window.µ._mjs_storeRawWrite.panier = { total: 7 }')
        await pause(300)
        assert.equal(await lire(['#m', '.mg']), 'M v2 10')
        writeFileSync(join(src, 'mag.mjs'), mag(3))
        await attendre(['#m', '.mg'], 'M v3 14', 'échange après une écriture sans rendu : la dérivée se recalcule')
        await garde('échange v3')
      })

      it('les deux, magasin lu dans les valeurs d\'une traduction : à chaud ; magasin puis langue changés juste après l\'échange', async () => {
        await page.evaluate('window.µ.store.prix = 4')
        await attendre(['#d', '.ld'], 'D v1 Panier 8', 'départ')
        writeFileSync(join(src, 'lesdeux.mjs'), lesDeux(2))
        await attendre(['#d', '.ld'], 'D v2 Panier 8', 'échange v2')
        await garde('échange v2')
        await page.evaluate('window.µ.store.prix = 5')
        await attendre(['#d', '.ld'], 'D v2 Panier 10', 'magasin écrit juste après l\'échange')
        await langue('en')
        await attendre(['#d', '.ld'], 'D v2 Cart 10', 'langue changée après l\'échange')
        writeFileSync(join(src, 'lesdeux.mjs'), lesDeux(3))
        await attendre(['#d', '.ld'], 'D v3 Cart 10', 'échange v3, en anglais')
        await garde('échange v3')
        await langue('fr')
        await attendre(['#d', '.ld'], 'D v3 Panier 10', 'retour au français')
        assert.match(sortie(), /mjs-lesdeux — rechargé à chaud, état gardé/)
      })
    })
  }
})
