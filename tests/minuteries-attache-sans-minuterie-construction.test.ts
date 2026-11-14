// une appli qui a une attache (`@attach`) et aucune minuterie se construit, en développement comme en production : le code
// d'une attache n'appelle la fin de passage des minuteries (module des minuteries, absent du cœur de cette appli) que si une
// minuterie a été posée pendant l'attache ; le cœur de développement n'embarque ce module qu'avec une minuterie ; avec une
// minuterie, celle qu'une attache pose s'arrête quand la balise est détachée
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s.replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '').replace(/\bexport\s+default\s+/g, '').replace(/\bexport\s+/g, '').replace(/import\.meta\.url/g, "'http://localhost/'")
const attendre = (ms: number) => new Promise(r => setTimeout(r, ms))
const COFFEE   = (gabarit: string, ...l: string[]) => [gabarit, '<script lang="coffee">', '$x = 0', ...l, '</script>'].join('\n')
const fenetres: any[] = []
let rang = 0

const APPLIS: [string, string][] = [
  ['attache qui reçoit la balise', COFFEE("<p :attach={(n) -> n.title = 'a'}>a</p>")],
  ['attache écrite avec el', COFFEE("<p :attach={el.title = 'a'}>a</p>")],
  ['attache .once', COFFEE("<p :attach.once={(n) -> n.title = 'a'}>a</p>")],
  ['attache et µafter dans µmount', COFFEE("<p :attach={(n) -> n.title = 'a'}>a</p>", 'µmount -> µafter 10, -> $x = 1')],
]

async function construire(source: string, env?: string): Promise<{ outDir: string, nom: string }> {
  const nom    = 'attsm' + 'abcdefghijklmnopqrstuvwxyz'[rang++]
  const root   = mjsTmp('minuteries-attache-sans-minuterie-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, nom + '.mjs'), source)
  const stats = await new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...(env ? { env } : {}) } as any).compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => String(e.message)).join('\n'))
  return { outDir, nom }
}

function monter(outDir: string, nom: string): { win: any, el: any } {
  const win: any = new Window({ url: 'http://localhost/' })
  fenetres.push(win)
  const fichiers = readdirSync(outDir)
  const coeur    = fichiers.find(f => /^mjs_core(?:-[^.]*)?\.js$/.test(f))
  const comp     = fichiers.find(f => new RegExp('^' + nom + '(?:-[^.]*)?\\.js$').test(f))
  assert.ok(coeur && comp, 'cœur et composant construits : ' + fichiers.join(', '))
  win.eval(stripEsm(readFileSync(join(outDir, coeur!), 'utf-8')) + '\nglobalThis.µ = µ;\n' + stripEsm(readFileSync(join(outDir, comp!), 'utf-8')))
  const el: any = win.document.createElement('mjs-' + nom)
  win.document.body.appendChild(el)
  return { win, el }
}

describe('attache sans minuterie : construction et marche sans le module des minuteries', function () {
  this.timeout(120000)
  after(async () => {
    for (const w of fenetres) await w.happyDOM?.close?.()
    await terminateSharedWorkerPool()
  })

  for (const env of ['dev', 'prod']) {
    for (const [cas, source] of APPLIS) {
      it(`${cas} — se construit (${env})`, async () => {
        const { outDir } = await construire(source, env)
        const coeur       = readdirSync(outDir).find(f => /^mjs_core.*\.js$/.test(f))
        assert.ok(coeur, 'cœur construit')
        if (env === 'dev') assert.equal(readFileSync(join(outDir, coeur), 'utf-8').includes('everyInit'), /µafter/.test(source), 'module des minuteries au cœur seulement avec une minuterie')
      })
    }
  }


  it('une minuterie posée par une attache tourne, puis s\'arrête quand la balise est détachée', async () => {
    const source      = COFFEE('{if $montre}<p :attach={attacher}>a</p>{end}', '$montre = true', 'window.__cacher = -> $montre = false', 'attacher = (n) ->', '  µevery 20, immediate: false, -> window.__attTirs = (window.__attTirs or 0) + 1', '  null')
    const { outDir, nom } = await construire(source)
    const { win, el }     = monter(outDir, nom)
    await attendre(130)
    assert.ok((win.__attTirs ?? 0) > 0, 'la minuterie de l\'attache tire')
    win.__cacher()
    await attendre(40)
    const n = win.__attTirs ?? 0
    await attendre(200)
    assert.equal((win.__attTirs ?? 0) - n, 0, 'plus aucun tir une fois la balise détachée')
    assert.equal(el._mjs_minuteries?.size ?? 0, 0, 'registre vide')
  })
})
