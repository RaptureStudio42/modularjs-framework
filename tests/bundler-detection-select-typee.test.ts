// mjs_types_select.ts (la liaison d'une <@@select> à une variable de règle : µ._mjs_tpick, µ._mjs_tshow) et mjs_types_bind.ts (ce
// qu'écrit et ce que rend un champ lié à une variable de règle : µ._mjs_traw, µ._mjs_tback, que le garde `*guard` lit aussi) : une
// appli qui a des types sans <@@select> liée à une variable de règle n'en paie pas un octet ; une seule telle liste les fait venir
// tous les deux, une fois chacun, quelle que soit la sélection `runtime` ; un champ natif lié à une variable de règle, qui reçoit
// `*guard` d'office, ne fait venir que le second ; faits inconnus (API directe) : gardés.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const PICK = 'µ._mjs_tpick = function'
const SHOW = 'µ._mjs_tshow = function'
const RAW  = 'µ._mjs_traw = function'
const BACK = 'µ._mjs_tback = function'
const TSEL = 'µ._mjs_tsel = function'

async function construire(nom: string, conf: any, source: string): Promise<string> {
  const root   = mjsTmp('detect-select-typee-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), source + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...conf } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  // tout le JavaScript émis : le cœur (construction découpée) comme le fichier unique (`js: 'bundle'`)
  const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => join(outDir, f))
  fichiers.push(join(root, 'bundle.js'))
  return fichiers.map((f) => { try { return readFileSync(f, 'utf-8') } catch { return '' } }).join('\n')
}

const fois = (sortie: string, mark: string) => sortie.split(mark).length - 1

// des types, une <@@select> liée à une variable libre, la variable de règle montrée sans champ
const SANS = [
  '<vars>',
  '  $n int',
  '</vars>',
  '<script>',
  '$n = 1',
  '$c = \'a\'',
  '</script>',
  '<@@select name="c" value=!{$c}><@@option value="a">A</@@option><@@option value="b">B</@@option></@@select>',
  '<b>{$n}</b>',
].join('\n')
// la même appli, sa <@@select> liée à la variable de règle
const AVEC   = SANS.replace('value=!{$c}', 'value=!{$n}')
// la même appli, un champ natif lié à la variable de règle : une liste, qui reçoit le garde d'office, ou un champ au garde écrit
const NATIFS = {
  'la liste native': SANS + '\n<select name="n" value=!{$n}><option value="1">1</option><option value="2">2</option></select>',
  'le champ gardé':  SANS + '\n<input aria-label="n" value=!{$n} *guard>',
}

describe('<@@select> liée à une variable de règle : ses aides n\'entrent au cœur que si une telle liste existe (build réel)', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  it('des types sans <@@select> liée à une variable de règle : aucune de ses aides, en cœur nu, par défaut, en fichier unique', async () => {
    for (const [nom, conf] of [['core', { runtime: 'core' }], ['defaut', {}], ['bundle', { js: 'bundle' }]] as Array<[string, any]>) {
      const sortie = await construire('sans-' + nom, conf, SANS)
      assert.ok(sortie.includes(TSEL), nom + ' : les types sont là (la liste native liée à la variable de règle)')
      for (const mark of [PICK, SHOW, RAW, BACK]) assert.equal(sortie.includes(mark), false, nom + ' : ' + mark)
    }
  })

  it('une <@@select> liée à une variable de règle : ses aides, une seule fois chacune, quelle que soit la sélection', async () => {
    for (const [nom, conf] of [['core', { runtime: 'core' }], ['defaut', {}], ['tout', { runtime: 'all' }], ['bundle', { js: 'bundle' }]] as Array<[string, any]>) {
      const sortie = await construire('avec-' + nom, conf, AVEC)
      for (const mark of [PICK, SHOW, RAW, BACK]) assert.equal(fois(sortie, mark), 1, nom + ' : ' + mark)
    }
  })

  it('un champ natif lié à une variable de règle (garde d\'office ou écrit) : ce qu\'écrit et rend le champ, sans la liaison de la liste du cœur', async () => {
    for (const [nom, source] of Object.entries(NATIFS)) {
      const sortie = await construire('natif-' + nom.replace(/\W+/g, '-'), { runtime: 'core' }, source)
      for (const mark of [RAW, BACK]) assert.equal(fois(sortie, mark), 1, nom + ' : ' + mark)
      for (const mark of [PICK, SHOW]) assert.equal(sortie.includes(mark), false, nom + ' : ' + mark)
    }
  })

  it('runtime: [\'types_select\'] : ses aides, sans liste liée à une variable de règle', async () => {
    const sortie = await construire('force', { runtime: ['types_select'] }, SANS)
    for (const mark of [PICK, SHOW, RAW, BACK]) assert.equal(fois(sortie, mark), 1, mark)
  })

  describe('API directe (resolveRuntimeFiles)', () => {
    const FICHIERS = ['mjs_types_select.ts', 'mjs_types_bind.ts']

    it('faits inconnus : gardés', () => {
      const { files } = new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles()
      for (const f of FICHIERS) assert.ok(files.includes(f), f)
    })

    it('des types seuls : absents, en core comme en all', () => {
      for (const runtime of ['core', 'all']) {
        const { files } = new Bundler({ runtime } as any).resolveRuntimeFiles(new Set(['types']))
        assert.ok(files.includes('mjs_types.ts'), runtime)
        for (const f of FICHIERS) assert.equal(files.includes(f), false, runtime + ' : ' + f)
      }
    })

    it('le signal types_select : les deux, et les types qu\'ils lisent', () => {
      for (const runtime of ['core', 'all']) {
        const { files } = new Bundler({ runtime } as any).resolveRuntimeFiles(new Set(['types_select']))
        for (const f of ['mjs_types.ts', ...FICHIERS]) assert.ok(files.includes(f), runtime + ' : ' + f)
      }
    })

    it('le garde sur des types : le second seul ; le garde sans types : aucun', () => {
      const avec = new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles(new Set(['types', 'fx', 'fx_guard'])).files
      assert.ok(avec.includes('mjs_types_bind.ts'))
      assert.equal(avec.includes('mjs_types_select.ts'), false)
      const sans = new Bundler({ runtime: 'core' } as any).resolveRuntimeFiles(new Set(['fx', 'fx_guard'])).files
      for (const f of FICHIERS) assert.equal(sans.includes(f), false, f)
    })
  })
})
