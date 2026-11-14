// la taille du texte adaptable : après une taille en px, une longue file de commentaires suivie d'une valeur (`50px /* … */
// solid`) ne fige plus la construction et reste telle quelle ; suivie de `!important`, la taille se convertit ; une valeur
// écrite entre deux commentaires (`50px /* a */ x /* b */`) reste telle quelle

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { write } from './helpers/construction-cache.js'
import { fontSizeSettings, rewriteFontSizes } from '../src/transpiler/font-size.js'

const MJS      = fileURLToPath(new URL('../bin/mjs', import.meta.url))
const reglages = fontSizeSettings(true)!
const FILE     = '/* note */ '.repeat(4000)

// tout le texte du dossier de sortie
function sorties(dir: string): string {
  let text = ''
  for (const rel of readdirSync(dir, { recursive: true }) as string[]) {
    const path = join(dir, rel)
    if (statSync(path).isFile()) text += readFileSync(path, 'utf-8')
  }
  return text
}

describe('taille du texte adaptée à l\'écran — file de commentaires après une taille', function () {
  this.timeout(280_000)

  it('4 000 commentaires puis une valeur : la construction finit, rien de converti', () => {
    const root = mjsTmp('taille-texte-file-commentaires')
    const conf = { sourceDir: 'app', outputDir: 'public/m', manifestPath: 'public/m/bundle.js', urlPrefix: '/m', stylesheetsDir: 'app/styles' }
    write(join(root, 'mjs.config.json'), `${JSON.stringify(conf, null, 2)}\n`)
    write(join(root, 'app/carte.mjs'), '<p class="c">carte</p>\n')
    write(join(root, 'app/styles/mjs_root.css'), `.a{font-size:50px ${FILE}solid;color:red}\n.b{font-size:64px}\n`)
    // tué au bout de 60 s : une construction figée rend la main au test
    const run = spawnSync(process.execPath, [MJS, 'build', '--root', root, '--prod'], { encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' }, timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 })
    assert.equal(run.status, 0, `construction arrêtée (signal ${run.signal})\n${run.stdout}${run.stderr}`)
    const out = sorties(join(root, 'public/m'))
    assert.ok(out.includes('var(--mjs-fs-64)'), 'la feuille racine passe par la conversion')
    assert.ok(!out.includes('--mjs-fs-50'), 'une taille suivie d\'une valeur reste telle quelle')
  })

  it('4 000 commentaires puis !important : converti', () => {
    const css = `.a{font-size:50px ${FILE}!important}`
    assert.deepEqual(rewriteFontSizes(css, reglages), { css: css.replace('50px', 'var(--mjs-fs-50)'), sizes: ['50'] })
  })

  it('une valeur entre deux commentaires après une taille : non converti', () => {
    const css = '.a{font-size:50px /* a */ x /* b */;color:red}'
    assert.deepEqual(rewriteFontSizes(css, reglages), { css, sizes: [] })
  })
})
