// Code inaccessible : une substitution de texte avait laissé un `return` seul au milieu d'une méthode
// Civet. Le développement gardait la suite (Civet la recopie), la production la retirait SANS RIEN DIRE
// (esbuild minifie avec treeShaking) : `this.deleteRule=function(){let n=u.editId}`, construction verte.
// La construction avertit désormais (`[lint.unreachable]`), en développement comme en production,
// quand une instruction suit, dans le même bloc, un `return`, un `throw`, un `break` ou un `continue` —
// avec le fichier et la ligne du SOURCE. Ni une fonction remontée, ni un autre bloc, ni le `return`
// implicite de Civet ou de CoffeeScript, ni le code généré par le cadre ne sont signalés.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// les seules lignes `[lint.unreachable]` écrites pendant un appel (console.warn espionné)
async function captured(run: () => Promise<unknown>): Promise<string[]> {
  const orig   = console.warn
  const lignes: string[] = []
  console.warn = (...a: unknown[]) => { const s = String(a[0]); if (s.includes('[lint.unreachable]')) lignes.push(s) }
  try { await run() } finally { console.warn = orig }
  return lignes
}

const unreachable = (src: string, moduleName: string, opts: Record<string, unknown> = {}) => captured(() => transpile(src, { moduleName, ...opts }))

// le cas réel, en Civet (ligne 6 du .mjs : `rule = …`, la première instruction jamais exécutée)
const REEL_CIVET = [
  '<script>',
  '$editId = null',
  '@deleteRule = ->',
  '  id = $editId',
  '  return',
  '  rule = ($$rulesData or []).find (r) -> r.id is id',
  '  µlog rule',
  '</script>',
  '<p>{$editId}</p>',
].join('\n')

describe('code inaccessible — avertissement de construction [lint.unreachable]', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le cas réel en Civet : un avertissement, fichier et ligne du .mjs (celle du code mort)', async () => {
    const lignes = await unreachable(REEL_CIVET, 'reel-civet')
    assert.equal(lignes.length, 1, JSON.stringify(lignes))
    assert.match(lignes[0], /'reel-civet\.mjs' \(ligne 6\)/)
    assert.match(lignes[0], /« return »/)
    assert.match(lignes[0], /jamais exécuté/)
  })

  it('le cas réel en CoffeeScript : même avertissement, même ligne', async () => {
    const lignes = await unreachable(REEL_CIVET.replace('<script>', '<script lang="coffee">'), 'reel-coffee')
    assert.equal(lignes.length, 1, JSON.stringify(lignes))
    assert.match(lignes[0], /'reel-coffee\.mjs' \(ligne 6\)/)
  })

  it('un `throw` suivi de code : nommé dans le message, à la ligne du code mort', async () => {
    const src = ['<script>', '@check = (x) ->', "  throw new Error 'non'", '  x + 1', '</script>', '<p>x</p>'].join('\n')
    const lignes = await unreachable(src, 'jet')
    assert.equal(lignes.length, 1, JSON.stringify(lignes))
    assert.match(lignes[0], /\(ligne 4\)/)
    assert.match(lignes[0], /« throw »/)
  })

  it('`continue` et `break` dans des boucles, en Civet et en CoffeeScript : un avertissement par bloc, à sa ligne', async () => {
    for (const lang of ['civet', 'coffee']) {
      const src = [`<script lang="${lang}">`, '@walk = (list) ->', '  for x in list', '    continue', '    µlog x', '  for y in list', '    break', '    µlog y', '  null', '</script>', '<p>x</p>'].join('\n')
      const lignes = await unreachable(src, `boucles-${lang}`)
      assert.equal(lignes.length, 2, `${lang} : ${JSON.stringify(lignes)}`)
      assert.match(lignes[0], /\(ligne 5\).*« continue »/)
      assert.match(lignes[1], /\(ligne 8\).*« break »/)
    }
  })

  it('le <script module> du composant est lu aussi, à sa ligne du .mjs', async () => {
    const src = ['<script module>', 'helper := ->', '  return 1', '  2', '</script>', '<script>', '$n = helper()', '</script>', '<p>{$n}</p>'].join('\n')
    const lignes = await unreachable(src, 'bloc-module')
    assert.equal(lignes.length, 1, JSON.stringify(lignes))
    assert.match(lignes[0], /\(ligne 4\)/)
  })

  it('un gestionnaire en ligne : à la ligne de sa balise', async () => {
    const src = ['<script>', '$n = 0', '</script>', '<p>{$n}</p>', '<button @click={ return; $n++ }>+</button>'].join('\n')
    const lignes = await unreachable(src, 'gestionnaire')
    assert.equal(lignes.length, 1, JSON.stringify(lignes))
    assert.match(lignes[0], /\(ligne 5\)/)
  })

  it('lint.unreachable: false coupe l\'avertissement', async () => {
    assert.deepEqual(await unreachable(REEL_CIVET, 'reel-coupe', { lint: { unreachable: false } }), [])
  })

  it('aucun faux avertissement : fonction remontée, autre bloc, retour sous condition, retours implicites, code du cadre', async () => {
    const src = [
      '<script>',
      '$items = []',
      '$open = false',
      'run := ->',
      '  return helper()',
      '  function helper()',
      '    1',
      '@pick = (x) ->',
      '  if x',
      '    return',
      '  return if not x',
      '  throw new Error "vide" unless x',
      '  $open = true',
      '@kind = (x) ->',
      '  switch x',
      "    when 1 then 'a'",
      '    when 2',
      '      µlog x',
      "      'b'",
      "    else 'c'",
      '@double = (l) ->',
      '  for x in l',
      '    continue if x is 1',
      '    x * 2',
      '@safe = ->',
      '  try',
      '    run()',
      '  catch e',
      '    0',
      'µeffect ->',
      '  µlog $items.length',
      '</script>',
      '<ul>{for item in $items}<li @click={@pick(item)}>{item}</li>{end}</ul>',
      '<button @click.prevent.self={$open = not $open}>x</button>',
    ].join('\n')
    assert.deepEqual(await unreachable(src, 'sans-faux'), [])
    assert.deepEqual(await unreachable(src.replace('<script>', '<script lang="coffee">').replace('run := ->', 'run = ->').replace('  function helper()\n    1\n', ''), 'sans-faux-coffee'), [])
  })

  describe('modules .civet et .coffee importés', () => {
    async function moduleWarnings(nom: string, contenu: string, lint?: Record<string, boolean>): Promise<string[]> {
      const root = mjsTmp('code-inaccessible-module')
      const src  = join(root, 'src')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, nom), contenu)
      const b = new Bundler({ sourceDir: src, outputDir: join(root, 'out'), manifestPath: join(root, 'out', 'bundle.js'), lint })
      try {
        return await captured(() => b.compileScriptModule(join(src, nom), nom.endsWith('.civet') ? '.civet' : '.coffee'))
      }
      finally {
        await b.close()
      }
    }

    it('module .civet : le fichier et sa ligne', async () => {
      const lignes = await moduleWarnings('regles.civet', ['export total := (x) ->', '  return x * 2', '  x * 3', ''].join('\n'))
      assert.equal(lignes.length, 1, JSON.stringify(lignes))
      assert.match(lignes[0], /'regles\.civet' \(ligne 3\)/)
    })

    it('module .coffee : le fichier et sa ligne', async () => {
      const lignes = await moduleWarnings('regles.coffee', ['total = (x) ->', '  throw new Error "non"', '  x * 3', 'export { total }', ''].join('\n'))
      assert.equal(lignes.length, 1, JSON.stringify(lignes))
      assert.match(lignes[0], /'regles\.coffee' \(ligne 3\).*« throw »/)
    })

    it('module : lint.unreachable: false coupe aussi', async () => {
      assert.deepEqual(await moduleWarnings('coupe.civet', ['export total := (x) ->', '  return x * 2', '  x * 3', ''].join('\n'), { unreachable: false }), [])
    })

    it('module sans code mort : silencieux', async () => {
      assert.deepEqual(await moduleWarnings('propre.civet', ['export total := (x) ->', '  return 0 unless x', '  x * 2', ''].join('\n')), [])
    })
  })
})

// bout en bout : la vraie CLI depuis les sources (`bin/mjs` chargerait dist/), construction de
// production — les composants se compilent dans des threads de travail
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('code inaccessible — mjs build --prod', function () {
  this.timeout(180000)

  it('le terminal cite le composant et le module importé, chacun à sa ligne', () => {
    const root = mjsTmp('code-inaccessible-cli')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
    writeFileSync(join(root, 'src', 'regles.civet'), ['export total := (x) ->', '  return x * 2', '  x * 3', ''].join('\n'))
    writeFileSync(join(root, 'src', 'panier.mjs'), ["@import { total } 'regles.civet'", REEL_CIVET, ''].join('\n'))
    const r = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--prod', '--root', root], {
      cwd: repoRoot, encoding: 'utf-8', timeout: 150000, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: undefined },
    })
    const sortie = (r.stdout ?? '') + (r.stderr ?? '')
    assert.equal(r.status, 0, sortie)
    const lignes = sortie.split('\n').filter(l => l.includes('[lint.unreachable]'))
    assert.equal(lignes.length, 2, sortie)
    assert.ok(lignes.some(l => /'panier\.mjs' \(ligne 7\)/.test(l)), sortie)
    assert.ok(lignes.some(l => /'regles\.civet' \(ligne 3\)/.test(l)), sortie)
  })
})
