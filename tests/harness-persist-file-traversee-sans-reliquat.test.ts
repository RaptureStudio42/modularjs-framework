// garde du HARNAIS, pas du produit : un test qui fabrique un fichier le rend, même quand il échoue. Le test de
// traversée de chemin du stockage fichier (tests/mjs-server-persist-file-traversee-chemin.test.ts) posait un
// « cible-hors-dossier-<n>.json » dans le dossier temporaire de la machine et ne le retirait jamais : le balai du
// harnais ne reconnaît que les dossiers « mjs-… », le fichier restait, un de plus à chaque run, sans que personne
// sache d'où il venait. Chaque cas lance un vrai mocha enfant sur ce test, dans un TMPDIR à lui (rien d'ici ne
// touche au /tmp des runs voisins), et regarde ce qu'il y laisse. Le cas qui échoue fait mentir load() pour que le
// test du lien symbolique tombe sur son assertion : le fichier doit partir quand même.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const TEST     = join(repoRoot, 'tests', 'mjs-server-persist-file-traversee-chemin.test.ts')
const SOURCE   = pathToFileURL(join(repoRoot, 'src', 'mjs-server', 'persist-file.ts')).href

// préchargé dans le mocha enfant : load() rend toujours une entrée, le test du lien symbolique (qui en attend zéro) échoue
const LOAD_MENTEUR = [
  `import { FilePersistAdapter } from '${SOURCE}'`,
  "FilePersistAdapter.prototype.load = async function () { return [{ id: 'x', data: { id: 'x' } }] }",
].join('\n')

// mocha enfant sur le test de traversée de chemin, TMPDIR isolé, aucune config implicite (jamais la suite entière)
function runChild(tmp: string, preload?: string) {
  const args = [join(repoRoot, 'node_modules', 'mocha', 'bin', 'mocha.js'), '--no-config', '--no-package', '--require', 'tsx/esm']
  if (preload) {
    const file = join(mjsTmp('harness-traversee-prechargement'), 'precharge.mjs')
    writeFileSync(file, preload)
    args.push('--require', file)
  }
  args.push('--exit', TEST)
  const r = spawnSync(process.execPath, args, { cwd: repoRoot, env: { ...process.env, TMPDIR: tmp }, encoding: 'utf-8', timeout: 60000 })
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

// ce que le dossier temporaire du mocha enfant contient encore, hors les caches de tsx et de Node eux-mêmes
const reliquats = (tmp: string): string[] => readdirSync(tmp).filter((n) => !/^(tsx-\d+|node-compile-cache)$/.test(n))

describe('harnais — le test de traversée de chemin rend ce qu\'il crée', function () {
  this.timeout(120000)

  it('un run qui réussit ne laisse rien derrière lui dans le dossier temporaire', function () {
    const tmp = mjsTmp('harness-traversee-reussi')
    const r   = runChild(tmp)
    assert.equal(r.code, 0, r.out)
    assert.deepEqual(reliquats(tmp), [], 'le test doit retirer le fichier qu\'il a posé hors du dossier de stockage')
  })

  it('un run où le test du lien symbolique échoue sur son assertion ne laisse rien non plus', function () {
    const tmp = mjsTmp('harness-traversee-echoue')
    const r   = runChild(tmp, LOAD_MENTEUR)
    assert.notEqual(r.code, 0, 'sanity : le test doit bien échouer dans ce cas\n'+ r.out)
    assert.match(r.out, /\d+\) load\(\) ignore un LIEN SYMBOLIQUE/, 'sanity : c\'est bien le test du lien symbolique qui échoue\n'+ r.out)
    assert.deepEqual(reliquats(tmp), [], 'le fichier doit être retiré même quand le test échoue avant la fin')
  })
})
