// Un composant dont le réveil attend la fin de la réconciliation de sa liste (enfant d'une ligne qui porte une directive qui lit sa balise
// dans le document, ou d'un `{if}` de ligne refait dans une ligne déjà dans la page : bloc `<reveils-retenus>` de runtime/mjs_for.ts) garde
// des propriétés rapides pour V8, comme l'enfant d'une ligne sans directive. Une propriété posée sur l'élément le temps de l'attente puis
// effacée le ferait passer en dictionnaire : chaque lecture de son état, à chaque mise à jour de sa ligne, en paierait le prix toute sa vie.
// Lu par `%HasFastProperties`, dans un Node à part (drapeau de V8), sur le runtime de développement tel que le construit le Bundler, monté
// dans happy-dom ; chaque enfant montre aussi sa ligne, preuve que l'attente a eu lieu et lui a livré ses props

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const RACINE = fileURLToPath(new URL('..', import.meta.url))
const MOTEUR = `Node ${process.version}, V8 ${process.versions.v8}`
const N      = 30

// trois parents, la même ligne : sans directive (témoin), avec `@attach`, l'enfant dans un `{if}` de ligne
const LIGNE   = '<@c-item n=!{r.n} lib={r.id}></@c-item>'
const SCRIPT  = '<script>\n  $l = []\n  noter = (el) -> el\n</script>\n'
const SOURCES: Record<string, string> = {
  'c-item.mjs': '<p>{$lib}:{$n}</p>\n',
  'p-plat.mjs': `${SCRIPT}{for r in $l by id}<div>${LIGNE}</div>{end}\n`,
  'p-attach.mjs': `${SCRIPT}{for r in $l by id}<div :attach={noter(el)}>${LIGNE}</div>{end}\n`,
  'p-si.mjs': `${SCRIPT}{for r in $l by id}<div>{if r.ok}${LIGNE}{end}</div>{end}\n`
}

// dans le Node à part : la page montée, les lignes posées, puis, pour le `{if}`, la condition qui retombe et se relève partout
const BANC = `
import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
const rapide = new Function('o', 'return %HasFastProperties(o)')
const window = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } })
window.eval(readFileSync(process.env.MJS_FORME_APP, 'utf8') + '\\nglobalThis.µ = µ;')
const µ = window.µ
const doc = window.document
const NOMS = ['plat', 'attach', 'si']
doc.body.innerHTML = NOMS.map((n) => '<mjs-p-' + n + '></mjs-p-' + n + '>').join('')
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const attendre = async (cond) => { for (let i = 0; i < 400 && !cond(); i++) await pause(10) }
const parent = (n) => doc.querySelector('mjs-p-' + n)
const enfants = (n) => parent(n)._shadow ? Array.from(parent(n)._shadow.querySelectorAll('mjs-c-item')) : []
const vu = (c) => c._shadow ? c._shadow.textContent.trim() : '(absent)'
const montes = (n, k) => enfants(n).length === k && enfants(n).every((c, i) => vu(c) === 'r' + i + ':' + i)
const releve = (n) => { const l = enfants(n); return { enfants: l.length, rapides: l.filter((c) => rapide(c)).length, vus: l.every((c, i) => vu(c) === 'r' + i + ':' + i), premier: l.length ? vu(l[0]) : '' } }
const lignes = (ok) => Array.from({ length: ${N} }, (_, i) => ({ id: 'r' + i, n: i, ok }))
await attendre(() => NOMS.every((n) => parent(n)._shadow))
const res = { temoin: rapide(doc.createElement('div')) }
for (const n of NOMS) µ._set(parent(n), 'l', lignes(true))
await attendre(() => NOMS.every((n) => montes(n, ${N})))
for (const n of NOMS) res[n + '/creer'] = releve(n)
µ._set(parent('si'), 'l', lignes(false))
await attendre(() => enfants('si').length === 0)
res['si/eteindre'] = { enfants: enfants('si').length }
µ._set(parent('si'), 'l', lignes(true))
await attendre(() => montes('si', ${N}))
res['si/rallumer'] = releve('si')
console.log(JSON.stringify(res))
await window.happyDOM.close()
`

// le runtime de développement et les composants, dans un seul fichier : le cœur d'abord, puis le reste du runtime, l'enfant, les parents
async function construire(): Promise<string> {
  const root   = mjsTmp('reveils-forme')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  const rang  = (f: string) => /^mjs_core/.test(f) ? 0 : f.startsWith('mjs_') ? 1 : f.startsWith('c-') ? 2 : 3
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
  const code  = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  assert.ok(code.includes('µ._mjs_waitRow = function'), 'les réveils retenus sont au cœur de cette appli')
  const app = join(root, 'app.js')
  writeFileSync(app, code)
  return app
}

type Releve = { enfants: number, rapides: number, vus: boolean, premier: string }

describe('réveils retenus des lignes : l\'enfant qui attend garde des propriétés rapides (V8)', function () {
  this.timeout(180000)
  let res: Record<string, any>

  before(async function () {
    const app = await construire()
    const r   = spawnSync(process.execPath, ['--allow-natives-syntax', '--input-type=module', '-e', BANC], { cwd: RACINE, encoding: 'utf8', env: { ...process.env, MJS_FORME_APP: app }, timeout: 120000 })
    assert.equal(r.status, 0, `le banc de V8 n'a pas tourné (${MOTEUR}) : drapeau ou fonction native de V8 disparus, ou erreur ci-dessous — le test est alors à mettre à jour, le runtime n'est pas en cause\n${r.stderr}`)
    res = JSON.parse(r.stdout.trim().split('\n').pop()!)
    assert.equal(res.temoin, true, `un élément neuf n'a pas de propriétés rapides (${MOTEUR}) : la lecture de V8 ne dit plus rien ici`)
  })

  after(async () => { await terminateSharedWorkerPool() })

  const verifier = (cle: string, quoi: string) => {
    const r: Releve = res[cle]
    assert.ok(r && r.enfants === N, `${quoi} : ${N} enfants montés (${JSON.stringify(r)})`)
    assert.ok(r.vus, `${quoi} : chaque enfant montre sa ligne, ses props reçues (premier : « ${r.premier} »)`)
    assert.equal(r.rapides, N, `${quoi} : enfants aux propriétés rapides (${MOTEUR})`)
  }

  it('témoin : l\'enfant d\'une ligne sans directive, qui n\'attend pas', () => {
    verifier('plat/creer', 'ligne sans directive')
  })

  it('ligne qui porte @attach : l\'enfant attend la fin de la réconciliation, puis garde sa forme', () => {
    verifier('attach/creer', 'ligne qui porte @attach')
  })

  it('{if} de ligne : créé avec sa ligne, puis refait dans une ligne déjà dans la page (condition qui retombe et se relève)', () => {
    verifier('si/creer', '{if} de ligne, à la création')
    assert.equal(res['si/eteindre'].enfants, 0, 'condition retombée : plus aucun enfant')
    verifier('si/rallumer', '{if} de ligne, branche refaite')
  })
})
