// mjs check : `<style @css="…">` (écriture de la 3.1) porte sa correction, `:css` ; la relecture continue après elle et liste
// la faute suivante du fichier, que la construction ne donne qu'une fois la première corrigée
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const CARTE    = ['<script>', 'go = -> setTimeout (-> 1), 500', '</script>', '<p>x</p>', '<style @css="commun">', '  p', '    color: red', '</style>', ''].join('\n')

function projet(): string {
  const root = mjsTmp('check-style-arobase')
  mkdirSync(join(root, 'app/modularjs'), { recursive: true })
  writeFileSync(join(root, 'app/modularjs/carte.mjs'), CARTE)
  return root
}

function mjs(root: string, ...args: string[]) {
  return spawnSync('npx', ['tsx', 'src/cli.ts', ...args, '--root', root], { cwd: repoRoot, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } })
}

describe('mjs check — `<style @css>` corrigé en `:css` le temps de la relecture', function () {
  this.timeout(240000)

  it('les deux fautes listées : `<style @css>` d\'abord (celle de la construction), puis la minuterie', () => {
    const root   = projet()
    const r      = mjs(root, 'check', '--json')
    const report = JSON.parse(r.stdout)
    const miennes = report.errors.filter((e: any) => e.file === 'app/modularjs/carte.mjs')
    assert.equal(miennes.length, 2, JSON.stringify(report.errors, null, 2))
    assert.match(miennes[0].message, /<style @css> : attribut inconnu — vouliez-vous dire « :css »/)
    assert.match(miennes[1].message, /« setTimeout » est refusé/)
    assert.deepEqual([miennes[0].line, miennes[0].column], [5, 8])
    const fichier = report.listing.files.find((f: any) => f.file === 'app/modularjs/carte.mjs')
    assert.equal(fichier.faults, 2)
    // la construction donne la première seule ; le fichier n'est pas touché
    const build = mjs(root, 'build')
    assert.match(build.stderr, /<style @css> : attribut inconnu/)
    assert.doesNotMatch(build.stderr, /« setTimeout » est refusé/)
  })
})
