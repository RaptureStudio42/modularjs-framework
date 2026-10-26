// La construction n'envoie le code des noms cachés des lignes à cocher de l'éditeur riche (<@@editor>) qu'aux applications qui s'en servent, avec les repères
// `@@` du fichier du module :
// - le mode « répondre » (attribut `answer`) : la lecture du nom d'une ligne (`data-key`), le choix du nom ou de la position qui désigne chaque ligne, la lecture de
//   `checked` en noms ; une page qui n'écrit pas `answer` n'en reçoit rien ;
// - l'outil des cases (`check`) : le nom neuf de chaque ligne de l'éditeur de l'auteur et le renommage des doublons ; une application dont aucune barre ne montre l'outil
//   n'en reçoit rien ;
// - le nom lu et réécrit sert aux deux : il part avec l'un ou avec l'autre, une seule fois quand les deux restent ;
// - une application qui n'écrit pas `answer` et n'affiche pas l'outil des cases reçoit exactement le code d'avant : aucun des noms des lignes nommées n'y figure.
// Le développement prend la même décision que la production. Statique, avec un Bundler réel, sur le texte non minifié (les noms du code y survivent).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SCRIPT = '<script>\n  $v = \'<p>x</p>\'\n  $c = [0]\n</script>\n'

// ce que chaque configuration laisse dans le code envoyé
const LECTURE  = ['isKey', 'keyOf', 'data-key']
const REPONDRE = ['keysOf', 'lineIds']
const SAISIE   = ['nameLines', 'hasText', 'newKey']
const TOUT     = [...LECTURE, ...REPONDRE, ...SAISIE]

async function construire(prefixe: string, source: string, options: Record<string, unknown> = { env: 'prod' }): Promise<string> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), js: 'split', minify: false, ...options } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
  const f = readdirSync(outDir).find((x) => /^core-editor-.*\.js$/.test(x))
  assert.ok(f, 'le morceau de l\'éditeur est produit')
  return readFileSync(join(outDir, f!), 'utf-8')
}

const pose = (code: string, marqueurs: string[], dit: string): void => {
  for (const m of marqueurs) assert.ok(code.includes(m), `${dit} : « ${m} » attendu`)
}

const absent = (code: string, marqueurs: string[], dit: string): void => {
  for (const m of marqueurs) assert.ok(!code.includes(m), `${dit} : « ${m} » ne devrait pas être envoyé`)
}

const fois = (code: string, motif: RegExp): number => (code.match(motif) ?? []).length

const page = (balises: string): string => SCRIPT + balises + '\n'

describe('éditeur riche : le code des noms cachés des lignes n\'est envoyé qu\'à qui s\'en sert', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('ni answer ni outil des cases (barre « gras italique ») : aucun des noms des lignes nommées', async () => {
    const c = await construire('noms-aucun', page('<@@editor name="e" toolbar="bold italic" value=!{$v}></@@editor>'))
    absent(c, TOUT, 'ni answer ni cases')
  })

  it('ni answer ni outil des cases (barre « lien » seule, barre séparée) : rien non plus', async () => {
    const c = await construire('noms-lien', page('<@@toolbar for="zz" tools="bold link"></@@toolbar><@@editor id="zz" name="e" toolbar="none" value=!{$v}></@@editor>'))
    absent(c, TOUT, 'lien seul')
  })

  it('l\'outil des cases sans answer (éditeur à barre complète) : le nom neuf et sa lecture, pas la lecture de checked', async () => {
    const c = await construire('noms-saisie', page('<@@editor name="e" value=!{$v}></@@editor>'))
    pose(c, [...LECTURE, ...SAISIE], 'cases sans answer')
    absent(c, REPONDRE, 'cases sans answer')
    assert.equal(fois(c, /\bkeyOf =/g), 1, 'keyOf défini une fois')
  })

  it('l\'outil des cases nommé dans une barre (toolbar="bold check") : même code', async () => {
    const c = await construire('noms-saisie-nommee', page('<@@editor name="e" toolbar="bold check" value=!{$v}></@@editor>'))
    pose(c, [...LECTURE, ...SAISIE], 'cases nommées')
    absent(c, REPONDRE, 'cases nommées')
  })

  it('answer sans aucun outil des cases : la lecture et checked en noms, pas le nom neuf ni le renommage', async () => {
    const c = await construire('noms-repondre', page('<@@editor name="e" answer value={$v} checked=!{$c}></@@editor>'))
    pose(c, [...LECTURE, ...REPONDRE], 'answer seul')
    absent(c, SAISIE, 'answer seul')
    assert.equal(fois(c, /\bkeyOf =/g), 1, 'keyOf défini une fois')
  })

  it('answer et un éditeur d\'auteur à barre restreinte : l\'éditeur de l\'auteur garde les noms du texte sans les créer', async () => {
    const c = await construire('noms-repondre-restreint', page('<@@editor name="e" answer value={$v} checked=!{$c}></@@editor><@@editor name="f" toolbar="bold italic" value=!{$v}></@@editor>'))
    pose(c, [...LECTURE, ...REPONDRE], 'answer et auteur restreint')
    absent(c, SAISIE, 'answer et auteur restreint')
  })

  it('answer et outil des cases dans la même application : tout, et chaque définition une seule fois', async () => {
    const c = await construire('noms-tout', page('<@@editor name="e" answer value={$v} checked=!{$c}></@@editor><@@editor name="f" value=!{$v}></@@editor>'))
    pose(c, TOUT, 'answer et cases')
    for (const motif of [/\bkeyOf =/g, /\bisKey =/g, /\bkeysOf =/g, /\bnameLines =/g, /\bhasText =/g]) assert.equal(fois(c, motif), 1, `${motif} défini une fois`)
  })

  it('le développement tranche comme la production : sans answer ni outil des cases, aucun des noms ; avec les deux, chaque définition une seule fois', async () => {
    const sans = await construire('noms-dev', page('<@@editor name="e" toolbar="bold italic" value=!{$v}></@@editor>'), { env: 'dev' })
    absent(sans, TOUT, 'développement, ni answer ni cases')
    const avec = await construire('noms-dev-tout', page('<@@editor name="e" answer value={$v} checked=!{$c}></@@editor><@@editor name="f" toolbar="bold check" value=!{$v}></@@editor>'), { env: 'dev' })
    pose(avec, TOUT, 'développement, answer et cases')
    for (const motif of [/\bkeyOf =/g, /\bisKey =/g, /\bkeysOf =/g, /\bnameLines =/g]) assert.equal(fois(avec, motif), 1, `${motif} défini une fois`)
  })
})
