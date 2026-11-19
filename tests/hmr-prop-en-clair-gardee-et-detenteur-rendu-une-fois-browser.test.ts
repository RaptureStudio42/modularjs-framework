// `mjs dev` réel, Chromium et Firefox. Une prop écrite en clair (`titre="Bonjour"`) que le composant a changée garde sa valeur quand le
// composant est rechargé à chaud, comme quand il est déplacé ; un attribut changé ensuite est relu. Un enfant qui tient l'objet de son
// parent, après le rechargement du parent, n'est redessiné qu'une fois par écriture de son frère : l'avis de plus va à l'ancien enfant,
// sorti de la page avec l'ancien dessin du parent, qui ne se redessine pas et quitte la liste des détenteurs

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

const parent = (v: string) => ['<script lang="js">', '  $o = { a: { n: \'a\' } };', '</script>', `<b class="p">${v}{$o.a.n}</b><@hq-vu item={$o.a}></@hq-vu><@hq-ec item={$o.a}></@hq-ec>`].join('\n')
const vu     = '<script>\n$item = null\n</script>\n\n<em class="vu">{$item ? $item.n : \'-\'}</em>'
const ecrit  = ['<script lang="js">', '  $item = null;', '  @ecrire = function(v) { $item.n = v; };', '</script>', '<em class="ec">{$item ? $item.n : \'-\'}</em>'].join('\n')
const titre  = (v: string) => `<script>\n$titre = 'vide'\n@changer = -> $titre = 'Autre'\n</script>\n\n<i class="t">${v} {$titre}</i>`

function projet(): { root: string, src: string } {
  const root = mjsTmp('hmr-prop-en-clair')
  const src  = join(root, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js' }))
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-hq-parent id="p"></mjs-hq-parent><mjs-hq-titre id="t" titre="Bonjour"></mjs-hq-titre><div id="ailleurs"></div></body></html>')
  writeFileSync(join(src, 'hq-parent.mjs'), parent(''))
  writeFileSync(join(src, 'hq-vu.mjs'), vu)
  writeFileSync(join(src, 'hq-ec.mjs'), ecrit)
  writeFileSync(join(src, 'hq-titre.mjs'), titre('v1'))
  return { root, src }
}

interface Dev { stdout(): string, kill(): Promise<void> }

function lancerDev(root: string, port: number): Promise<Dev> {
  return new Promise((resolve, reject) => {
    const proc = spawn(tsxBin, [cliPath, 'dev', '--root', root, '--port', String(port), '--host', '127.0.0.1'], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
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

// textes de l'écran et comptes de l'enfant détenteur (`hq-vu`) : avis reçus par chaque instance comptée, passes de rendu
const ECRAN = `(() => {
  const p = document.querySelector('#p'), t = document.querySelector('#t')
  const v = p && p._shadow ? p._shadow.querySelector('mjs-hq-vu') : null
  return {
    p: p && p._shadow && p._shadow.querySelector('b.p') ? p._shadow.querySelector('b.p').textContent : null,
    v: v && v._shadow && v._shadow.querySelector('em') ? v._shadow.querySelector('em').textContent : null,
    t: t && t._shadow && t._shadow.querySelector('i') ? t._shadow.querySelector('i').textContent : null
  }
})()`
// chaque instance de `hq-vu` comptée une fois : ses avis (`_mjs_claimNotice`, avec ce qu'il rend) et ses passes de rendu
const COMPTER = `(() => {
  const v = document.querySelector('#p')._shadow.querySelector('mjs-hq-vu')
  window.__avis = []
  window.__passes = new Map()
  if (!v.__compte) {
    v.__compte = 1
    const avis = v._mjs_claimNotice, passe = v._mjs_runEffectsV2
    v._mjs_claimNotice = function (...a) { const r = avis.apply(this, a); window.__avis.push({ courant: this === document.querySelector('#p')._shadow.querySelector('mjs-hq-vu'), relie: this.isConnected, rendu: r }); return r }
    v._mjs_runEffectsV2 = function (...a) { window.__passes.set(this, (window.__passes.get(this) || 0) + 1); return passe.apply(this, a) }
  }
  return 1
})()`
const BILAN = `(() => {
  const v = document.querySelector('#p')._shadow.querySelector('mjs-hq-vu')
  return { avis: window.__avis, passes: window.__passes.get(v) || 0 }
})()`

describe('mjs dev — prop écrite en clair gardée au rechargement, enfant détenteur redessiné une fois après le rechargement du parent', function () {
  this.timeout(240000)

  for (const moteur of ['chromium', 'firefox'] as const) {
    it(moteur, async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      const { root, src } = projet()
      const port    = 22000 + Math.floor(Math.random() * 8000)
      const dev     = await lancerDev(root, port)
      const browser = await playwright[moteur].launch()
      try {
        const page = await browser.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e) => erreurs.push(String(e)))
        const ecran = () => page.evaluate(ECRAN) as Promise<{ p: string | null, v: string | null, t: string | null }>
        const attendre = async (quoi: string, ok: (e: { p: string | null, v: string | null, t: string | null }) => boolean) => {
          const fin = Date.now() + 20000
          let e = null
          while (Date.now() < fin) {
            e = await ecran().catch(() => null)
            if (e && ok(e)) return
            await new Promise(r => setTimeout(r, 50))
          }
          assert.fail(`${quoi} : vu ${JSON.stringify(e)}\n--- mjs dev ---\n${dev.stdout()}\n--- erreurs de la page ---\n${erreurs.join('\n')}`)
        }
        const ecrire = async (x: string) => {
          await page.evaluate(COMPTER)
          await page.evaluate(`document.querySelector('#p')._shadow.querySelector('mjs-hq-ec').ecrire(${JSON.stringify(x)})`)
          await attendre(`écriture ${x}`, (e) => e.v === x)
          await new Promise(r => setTimeout(r, 200))
          return page.evaluate(BILAN) as Promise<{ avis: { courant: boolean, relie: boolean, rendu: boolean }[], passes: number }>
        }
        const sansRechargement = async (quoi: string) => assert.equal(await page.evaluate('window.__marque'), 1, `${quoi} : la page a été rechargée\n${dev.stdout()}`)

        await page.goto(`http://127.0.0.1:${port}/`)
        await attendre('premier rendu', (e) => e.p === 'a' && e.v === 'a' && e.t === 'v1 Bonjour')
        await page.evaluate('window.__marque = 1')

        // prop écrite en clair : changée par le composant, déplacée, puis rechargée — la valeur du composant reste
        await page.evaluate('document.querySelector("#t").changer()')
        await attendre('titre changé par le composant', (e) => e.t === 'v1 Autre')
        await page.evaluate('document.querySelector("#ailleurs").appendChild(document.querySelector("#t"))')
        await attendre('titre déplacé', (e) => e.t === 'v1 Autre')
        writeFileSync(join(src, 'hq-titre.mjs'), titre('v2'))
        await attendre('titre rechargé', (e) => e.t !== null && e.t.startsWith('v2 '))
        await sansRechargement('titre rechargé')
        assert.equal((await ecran()).t, 'v2 Autre', 'la prop écrite en clair garde la valeur que le composant y a écrite')
        // un attribut changé ensuite est relu
        await page.evaluate('document.querySelector("#t").setAttribute("titre", "Salut")')
        await attendre('attribut changé après le rechargement', (e) => e.t === 'v2 Salut')

        // enfant détenteur : une passe par écriture du frère, avant et après le rechargement du parent
        const avant = await ecrire('1')
        assert.equal(avant.passes, 1, `avant le rechargement du parent : ${JSON.stringify(avant)}`)
        writeFileSync(join(src, 'hq-parent.mjs'), parent('P'))
        await attendre('parent rechargé', (e) => e.p === 'P1')
        await sansRechargement('parent rechargé')
        const apres = await ecrire('5')
        assert.equal(apres.passes, 1, `après le rechargement du parent : ${JSON.stringify(apres)}`)
        assert.deepEqual(apres.avis.filter((a) => a.courant), [{ courant: true, relie: true, rendu: true }], 'un seul avis à l\'enfant de la page')
        assert.deepEqual(apres.avis.filter((a) => !a.courant), [{ courant: false, relie: false, rendu: false }], 'l\'ancien enfant, sorti de la page, ne se redessine pas')
        const ensuite = await ecrire('6')
        assert.deepEqual(ensuite, { avis: [{ courant: true, relie: true, rendu: true }], passes: 1 }, 'l\'ancien enfant a quitté la liste des détenteurs')
        assert.deepEqual(erreurs, [])
      }
      finally {
        await browser.close()
        await dev.kill()
      }
    })
  }
})
