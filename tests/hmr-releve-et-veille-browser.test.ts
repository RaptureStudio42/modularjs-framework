// `mjs dev` réel et trois navigateurs : le relevé de la garde est pris à la vraie fin de la construction, et la veille des plantages
// couvre les promesses rejetées et les minuteries de délai 0 des crochets rejoués. Un champ posé par l'appli entre la construction et
// l'entrée dans la page (`document.createElement` puis `e.fmt = …`) recharge la page ; un champ de l'appli au nom qui ressemble à un
// interne (`@_mjsFmt`, `@_gl_1`) est gardé comme les autres : réécrit, il recharge la page, jamais réécrit, il reste à chaud ; un
// `µmount` qui rend une promesse rejetée ou pose une minuterie de délai 0 qui lève recharge la page, à chaque tour, et la même version
// sans plantage reste à chaud.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')
const TOURS    = Number(process.env.MJS_HMR_TOURS) || 10

const PREMIER_BUILD = /✅ \d+ fichiers en \d+ms/

const cfg = (v: number) => ['<script>', '$n = 0', '@fmt = (x) -> "A#{x}"', 'inc = -> $n++', '</script>', '', '<button class="ci" @click={inc}>+</button>', `<p class="cf">F v${v} {$n + ':' + @fmt(1)}</p>`].join('\n')
const interne = (v: number, nom: string) => ['<script>', '$mode = \'A\'', `@${nom} = (x) -> "A#{x}"`, 'bascule = ->', '  moi = this', `  moi.${nom} = (x) -> "B#{x}"`, '  $mode = \'B\'', '</script>', '', '<button class="bs" @click={bascule}>b</button>', `<p class="rd">I v${v} {$mode + ':' + @${nom}(1)}</p>`].join('\n')
// `µmount` inchangé d'une version à l'autre, seule la fonction qu'il appelle change
const montage = (v: number, corps: string[]) => ['<script>', '$n = 0', 'inc = -> $n++', 'demarre = ->', ...corps.map(l => '  ' + l), 'µmount ->', '  demarre()', '</script>', '', '<button class="mi" @click={inc}>+</button>', `<p class="mn">K v${v} {$n}</p>`].join('\n')
const SAIN   = ['0']
const REJET  = ['Promise.reject(new Error(\'promesse rejetée\'))']
const MINUTE = ['window.__lever()', '0']

function projet(): { root: string, src: string } {
  const root = mjsTmp('hmr-releve-et-veille')
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js' }))
  // la balise témoin `c0` fait charger le composant ; `c1` est construit par l'appli, qui lui pose un champ avant de l'insérer
  const pose = 'customElements.whenDefined(\'mjs-cfg\').then(() => { const e = document.createElement(\'mjs-cfg\'); e.id = \'c1\'; e.fmt = (x) => \'EXT\' + x; document.getElementById(\'hote\').appendChild(e) })'
  // la minuterie qui lève vient de la page (un composant ne pose pas de minuterie à la main ; µafter rattraperait l'erreur, qui doit sortir dans la page)
  writeFileSync(join(root, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><script>window.__lever = () => setTimeout(() => { throw new Error('minuterie qui lève') }, 0)</script><script type="module" src="/modularjs/bundle.js"></script><script type="module">${pose}</script></head><body><mjs-cfg id="c0"></mjs-cfg><div id="hote"></div><mjs-int1 id="i1"></mjs-int1><mjs-int2 id="i2"></mjs-int2><mjs-int3 id="i3"></mjs-int3><mjs-mnt id="mn"></mjs-mnt></body></html>`)
  writeFileSync(join(src, 'cfg.mjs'), cfg(1))
  writeFileSync(join(src, 'int1.mjs'), interne(1, '_mjsFmt'))
  writeFileSync(join(src, 'int2.mjs'), interne(1, '_gl_1'))
  writeFileSync(join(src, 'int3.mjs'), interne(1, '_gl_1'))
  writeFileSync(join(src, 'mnt.mjs'), montage(1, SAIN))
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

describe('mjs dev — relevé à la fin de la construction, veille des promesses rejetées et des minuteries de délai 0 (trois navigateurs)', function () {
  this.timeout(300000)

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    describe(moteur, function () {
      let dev: Dev | null = null
      let browser: any    = null
      let page: any       = null
      let src             = ''
      const sortie   = () => dev ? dev.stdout() : ''
      const lire     = (chemin: string[]) => page.evaluate(`(${LIRE})(${JSON.stringify(chemin)})`).catch(() => null) as Promise<string | null>
      const marque   = () => page.evaluate('window.__marque').catch(() => 'navigation')
      const compte   = (re: string) => (sortie().match(new RegExp(re, 'g')) ?? []).length
      const gardes   = (balise: string) => compte(`${balise} — rechargé à chaud, état gardé`)
      const complets = (balise: string) => compte(`${balise} — échange à chaud impossible, la page s'est rechargée en entier`)
      const cliquer  = (chemin: string[]) => page.evaluate(`(${LIRE.replace('return n ? n.textContent.trim() : null', 'n.click()')})(${JSON.stringify(chemin)})`)
      const voir     = async (chemin: string[], attendu: string, quoi: string) => {
        const fin = Date.now() + 20000
        let vu: string | null = null
        while (Date.now() < fin) {
          vu = await lire(chemin)
          if (vu === attendu) return
          await pause(50)
        }
        assert.fail(`${quoi} : attendu ${attendu}, vu ${vu}\n--- mjs dev ---\n${sortie()}`)
      }
      // l'échange que la page mène à son terme : le terminal le dit d'après sa réponse, donnée à la fin de la veille
      const resultat = async (balise: string, g0: number, r0: number, quoi: string) => {
        const fin = Date.now() + 20000
        while (Date.now() < fin && gardes(balise) === g0 && complets(balise) === r0) await pause(50)
        return gardes(balise) > g0 ? 'gardé' : complets(balise) > r0 ? 'rechargé' : `aucune réponse (${quoi})`
      }
      const echange = async (fichier: string, texte: string, balise: string) => {
        const g0 = gardes(balise)
        const r0 = complets(balise)
        await page.evaluate('window.__marque = 1')
        writeFileSync(join(src, fichier), texte)
        return resultat(balise, g0, r0, fichier)
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
        await voir(['#c1', '.cf'], 'F v1 0:EXT1', 'premier rendu')
        await voir(['#mn', '.mn'], 'K v1 0', 'premier rendu')
      })

      after(async () => {
        if (browser) await browser.close()
        if (dev) await dev.kill()
      })

      it('champ posé par l\'appli après la construction, avant l\'entrée dans la page : la page se recharge', async () => {
        await cliquer(['#c1', '.ci'])
        await voir(['#c1', '.cf'], 'F v1 1:EXT1', 'clic')
        const r = await echange('cfg.mjs', cfg(2), 'mjs-cfg')
        assert.equal(r, 'rechargé', `gabarit seul changé : ${r}\n--- mjs dev ---\n${sortie()}`)
        await voir(['#c1', '.cf'], 'F v2 0:EXT1', 'après le rechargement')
        assert.notEqual(await marque(), 1, 'la page ne s\'est pas rechargée')
      })

      it('champ de l\'appli au nom d\'interne : jamais réécrit, à chaud ; réécrit par un alias, la page se recharge', async () => {
        await voir(['#i3', '.rd'], 'I v1 A:A1', 'page prête')
        const r3 = await echange('int3.mjs', interne(2, '_gl_1'), 'mjs-int3')
        assert.equal(r3, 'gardé', `@_gl_1 jamais réécrit : ${r3}\n--- mjs dev ---\n${sortie()}`)
        await voir(['#i3', '.rd'], 'I v2 A:A1', '@_gl_1 jamais réécrit')
        assert.equal(await marque(), 1, '@_gl_1 jamais réécrit : la page a été rechargée')
        for (const [hote, fichier, nom] of [['#i1', 'int1.mjs', '_mjsFmt'], ['#i2', 'int2.mjs', '_gl_1']]) {
          await cliquer([hote, '.bs'])
          await voir([hote, '.rd'], 'I v1 B:B1', `@${nom} réécrit`)
          const r = await echange(fichier, interne(2, nom), fichier === 'int1.mjs' ? 'mjs-int1' : 'mjs-int2')
          assert.equal(r, 'rechargé', `@${nom} réécrit par un alias : ${r}\n--- mjs dev ---\n${sortie()}`)
          await voir([hote, '.rd'], 'I v2 A:A1', `@${nom} : après le rechargement`)
          assert.notEqual(await marque(), 1, `@${nom} : la page ne s'est pas rechargée`)
        }
      })

      it(`µmount qui rend une promesse rejetée, minuterie de délai 0 qui lève : la page se recharge, ${TOURS} tours ; sans plantage : à chaud`, async () => {
        const fautes: string[] = []
        let v = 1
        for (let tour = 0; tour < TOURS; tour++) {
          for (const [quoi, corps] of [['promesse rejetée', REJET], ['minuterie de délai 0', MINUTE]] as const) {
            await voir(['#mn', '.mn'], `K v${v} 0`, `tour ${tour + 1} : page prête`)
            await cliquer(['#mn', '.mi'])
            await voir(['#mn', '.mn'], `K v${v} 1`, `tour ${tour + 1} : clic`)
            v++
            const sain = await echange('mnt.mjs', montage(v, SAIN), 'mjs-mnt')
            if (sain !== 'gardé') fautes.push(`tour ${tour + 1}, v${v} sans plantage : ${sain}`)
            await voir(['#mn', '.mn'], `K v${v} ${sain === 'gardé' ? 1 : 0}`, `tour ${tour + 1} : v${v}`)
            v++
            const r = await echange('mnt.mjs', montage(v, corps), 'mjs-mnt')
            if (r !== 'rechargé') fautes.push(`tour ${tour + 1}, v${v} ${quoi} : ${r}`)
            if (r === 'gardé') await page.reload()
          }
        }
        await voir(['#mn', '.mn'], `K v${v} 0`, 'dernier tour')
        assert.deepEqual(fautes, [], `${fautes.join('\n')}\n--- mjs dev ---\n${sortie()}`)
      })
    })
  }
})
