// un reffet (`µeffect`) arrêté par sa main : la minuterie posée par son dernier passage s'arrête avec lui, que ce passage
// rende un nettoyage ou non, quel que soit son rang (le premier passage qui pose une minuterie n'est pas toujours le
// premier) ; chaque nettoyage rendu joue une fois ; `always: true` part quand même ; au retrait du composant, plus rien ne tire
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s.replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '').replace(/\bexport\s+default\s+/g, '').replace(/\bexport\s+/g, '').replace(/import\.meta\.url/g, "'http://localhost/'")
const attendre = (ms: number) => new Promise(r => setTimeout(r, ms))
const fenetres: any[] = []

async function monter(nom: string, source: string): Promise<{ win: any, el: any }> {
  const root   = mjsTmp('minuteries-reffet-arrete-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, nom + '.mjs'), source)
  const stats = await new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }).compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => String(e.message)).join('\n'))
  const win: any = new Window({ url: 'http://localhost/' })
  fenetres.push(win)
  const fichiers = readdirSync(outDir)
  const coeur    = fichiers.find(f => /^mjs_core(?:-[^.]*)?\.js$/.test(f))!
  const comp     = fichiers.find(f => new RegExp('^' + nom + '(?:-[^.]*)?\\.js$').test(f))!
  win.eval(stripEsm(readFileSync(join(outDir, coeur), 'utf-8')) + '\nglobalThis.µ = µ;\n' + stripEsm(readFileSync(join(outDir, comp), 'utf-8')))
  const el: any = win.document.createElement('mjs-' + nom)
  win.document.body.appendChild(el)
  await attendre(20)
  return { win, el }
}

const UN   = (k: string) => 'window.' + k + ' = (window.' + k + ' or 0) + 1'
const REP  = (k: string) => '  µevery 20, immediate: false, -> ' + UN(k)
const DEP  = ['$dep = 0', 'window.__changer = -> $dep++']
const S    = (...l: string[]) => ['<p>{$x}</p>', '<script lang="coffee">', '$x = 0', ...l, 'window.__retirer = -> arret()', '</script>'].join('\n')
const N    = (w: any, k: string): number => w[k] ?? 0
const T    = (el: any): number => el._mjs_timers?.size ?? 0
const tirs = async (w: any, k: string, ms: number): Promise<number> => {
  const a = N(w, k)
  await attendre(ms)
  return N(w, k) - a
}

// composant, compteur, cas, corps du <script>, relances avant l'arrêt, nettoyages joués en tout
const CAS: [string, string, string, string[], number, number][] = [
  ['rpremier', '__r1', 'premier passage, qui rend son nettoyage', ['arret = µeffect ->', REP('__r1'), '  -> ' + UN('__r1n')], 0, 1],
  ['rnul', '__r2', 'premier passage, qui ne rend rien', ['arret = µeffect ->', REP('__r2'), '  null'], 0, 0],
  ['rderniere', '__r3', 'premier passage, main d\'arrêt en dernière ligne', ['arret = µeffect ->', REP('__r3')], 0, 0],
  ['rrelance', '__r4', 'passage relancé, qui rend son nettoyage', [...DEP, 'arret = µeffect ->', '  $dep', REP('__r4'), '  -> ' + UN('__r4n')], 1, 2],
  ['rsecond', '__r5', 'deuxième passage, le premier à poser une minuterie, qui rend son nettoyage', [...DEP, 'arret = µeffect ->', '  if $dep > 0', '  ' + REP('__r5'), '  -> ' + UN('__r5n')], 1, 2],
  ['rtroisieme', '__r6', 'troisième passage, le premier à poser une minuterie, qui rend son nettoyage', [...DEP, 'arret = µeffect ->', '  if $dep > 1', '  ' + REP('__r6'), '  -> ' + UN('__r6n')], 2, 3],
  ['rsecondnul', '__r7', 'deuxième passage, le premier à poser une minuterie, qui ne rend rien', [...DEP, 'arret = µeffect ->', '  if $dep > 0', '  ' + REP('__r7'), '  null'], 1, 0],
]

describe('reffet arrêté par sa main : la minuterie de son passage s\'arrête avec lui', function () {
  this.timeout(120000)
  after(async () => {
    for (const w of fenetres) await w.happyDOM?.close?.()
    await terminateSharedWorkerPool()
  })

  for (const [nom, k, cas, corps, relances, nettoyages] of CAS) {
    it(cas, async () => {
      const { win, el } = await monter(nom, S(...corps))
      for (let i = 0; i < relances; i++) {
        win.__changer()
        await attendre(40)
      }
      assert.equal(T(el), 1, 'une minuterie vivante avant l\'arrêt')
      assert.ok(await tirs(win, k, 100) > 0, 'elle tire avant l\'arrêt')
      win.__retirer()
      await attendre(30)
      assert.equal(await tirs(win, k, 200), 0, 'plus aucun tir après l\'arrêt du reffet')
      assert.equal(T(el), 0, 'registre vide après l\'arrêt du reffet')
      assert.equal(N(win, k + 'n'), nettoyages, 'nettoyages joués')
      el.remove()
    })
  }

  it('always: true posé par un passage part quand même après l\'arrêt du reffet', async () => {
    const { win, el } = await monter('ralways', S('arret = µeffect ->', '  µafter 60, always: true, -> ' + UN('__ra'), '  null'))
    win.__retirer()
    await attendre(150)
    assert.equal(N(win, '__ra'), 1, 'le tir always est parti, une fois')
    el.remove()
  })

  it('retrait du composant : la minuterie du passage s\'arrête', async () => {
    const { win, el } = await monter('rretrait', S('arret = µeffect ->', REP('__rr'), '  -> ' + UN('__rrn')))
    assert.ok(await tirs(win, '__rr', 100) > 0, 'elle tire')
    el.remove()
    await attendre(30)
    assert.equal(await tirs(win, '__rr', 200), 0, 'plus aucun tir après le retrait')
    assert.equal(T(el), 0, 'registre vide')
  })
})
