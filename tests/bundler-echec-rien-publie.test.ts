// Une construction en échec n'écrit rien de cassé : quand le cœur ne se construit pas (fichier du runtime absent, contrat
// rompu…), aucune unité n'est écrite avec un import vide à sa place et `bundle.js` n'est pas réécrit, en développement comme
// en build ; en build, un composant en échec ne fait pas non plus republier le manifeste. Le site déjà servi depuis ce
// dossier reste celui de la dernière construction réussie, l'erreur est rendue normalement.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const simple = (texte: string) => ['<script>', '  $x = 1', '</script>', `<p>{$x} ${texte}</p>`].join('\n')
const liste  = (ferme: boolean) => ['<script>', ferme ? '  $items = [1, 2]' : '  $items = [1, 2', '</script>', '<ul>{for i in $items}<li>{i}</li>{end}</ul>'].join('\n')

// contenu de chaque fichier servi du dossier de sortie (les fichiers de travail en point exclus)
function instantane(dir: string): Record<string, string> {
  const r: Record<string, string> = {}
  for (const f of readdirSync(dir).sort()) if (!f.startsWith('.')) r[f] = readFileSync(join(dir, f), 'utf-8')
  return r
}

function projet(prefixe: string) {
  const root = mjsTmp(prefixe)
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'a.mjs'), simple('a'))
  writeFileSync(join(src, 'b.mjs'), liste(true))
  return { src, out, man: join(out, 'bundle.js') }
}

describe('une construction en échec ne publie rien de cassé', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('build : le cœur échoue au 2e build → bundle.js et les fichiers servis restent ceux du 1er, à l\'octet', async () => {
    const { src, out, man } = projet('echec-coeur-build')
    const s1 = await new Bundler({ sourceDir: src, outputDir: out, manifestPath: man, keepFailedComponents: false }).compile()
    assert.deepEqual(s1.errors.map(e => e.message), [])
    const avant = instantane(out)

    writeFileSync(join(src, 'a.mjs'), simple('a modifié'))
    const s2 = await new Bundler({ sourceDir: src, outputDir: out, manifestPath: man, keepFailedComponents: false, runtimeDir: mjsTmp('echec-coeur-runtime-vide') }).compile()
    assert.equal(s2.errors.length, 1, s2.errors.map(e => e.message).join('\n'))
    assert.deepEqual(instantane(out), avant, 'rien de réécrit, rien d\'ajouté, rien de retiré')
  })

  it('développement : le cœur échoue en cours de session → bundle.js intact, aucune unité n\'importe un cœur vide', async () => {
    const { src, out, man } = projet('echec-coeur-dev')
    const b  = new Bundler({ sourceDir: src, outputDir: out, manifestPath: man })
    const s1 = await b.compile()
    assert.deepEqual(s1.errors.map(e => e.message), [])
    const avant = instantane(out)

    writeFileSync(join(src, 'a.mjs'), simple('a modifié'))
    ;(b as any).bundleRuntime = async () => { throw new Error('cœur en panne (simulée)') }
    const s2 = await b.compile()
    assert.deepEqual(s2.errors.map(e => e.message), ['cœur en panne (simulée)'])
    assert.deepEqual(instantane(out), avant, 'rien de réécrit, rien d\'ajouté, rien de retiré')
  })

  it('build : un composant en échec au 2e build → bundle.js identique à l\'octet, les fichiers qu\'il nomme toujours là', async () => {
    const { src, out, man } = projet('echec-composant-build')
    const o  = { sourceDir: src, outputDir: out, manifestPath: man, keepFailedComponents: false, env: 'prod' as const }
    const s1 = await new Bundler(o).compile()
    assert.deepEqual(s1.errors.map(e => e.message), [])
    const manifesteAvant = readFileSync(man, 'utf-8')
    const fichiersAvant  = readdirSync(out).filter(f => f.endsWith('.js'))

    writeFileSync(join(src, 'a.mjs'), simple('a modifié'))
    writeFileSync(join(src, 'b.mjs'), liste(false))
    const s2 = await new Bundler(o).compile()
    assert.equal(s2.errors.length, 1, s2.errors.map(e => e.message).join('\n'))
    assert.equal(readFileSync(man, 'utf-8'), manifesteAvant, 'bundle.js non republié')
    const apres = readdirSync(out)
    assert.deepEqual(fichiersAvant.filter(f => !apres.includes(f)), [], 'aucun fichier du build servi n\'est retiré')
  })
})
