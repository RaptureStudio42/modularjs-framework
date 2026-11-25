// `css: "split"` : une feuille partagée retouchée change l'adresse du composant qui la déclare, pas l'empreinte de ceux qui
// l'importent (elle suit leurs sources). Le cache de la même instance (celui du rechargement de `mjs dev`) reprenait alors
// l'importeur tel quel : il citait l'ancienne adresse du composant, retirée de la sortie. L'importeur est recompilé, il cite la
// nouvelle adresse, et chaque adresse citée existe

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const composant = (nom: string, enfant: string | null, css = ''): string => `${enfant ? `@import default Enfant '${enfant}.mjs'\n\n` : ''}<div class="${nom}">${nom}${enfant ? `\n  <@${enfant}></@${enfant}>` : ''}\n</div>\n${css}`

// chaque adresse `.js` sous le préfixe, citée par un module de la sortie, qui n'y est pas
function absents(out: string): string[] {
  const vus: string[] = []
  for (const nom of readdirSync(out).filter(f => f.endsWith('.js'))) {
    for (const m of readFileSync(join(out, nom), 'utf-8').matchAll(/\/modularjs\/([\w.-]+\.js)(?=["'`?#])/g)) if (!existsSync(join(out, m[1]))) vus.push(`${nom} → ${m[1]}`)
  }
  return vus
}

describe('css split : une feuille retouchée, les composants qui importent celui qui la déclare citent sa nouvelle adresse', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const env of ['dev', 'prod'] as const) {
    it(`${env} : b.scss retouchée, déclarée par c1, importé par p, lui-même importé par q`, async () => {
      const root   = mjsTmp(`split-importeurs-${env}`)
      const src    = join(root, 'src')
      const styles = join(root, 'styles')
      const out    = join(root, 'out')
      mkdirSync(src, { recursive: true })
      mkdirSync(styles, { recursive: true })
      writeFileSync(join(styles, 'b.scss'), '.b { color: blue; }\n')
      writeFileSync(join(src, 'c1.mjs'), composant('c1', null, '<style :css="b">\n</style>\n'))
      writeFileSync(join(src, 'p.mjs'), composant('p', 'c1'))
      writeFileSync(join(src, 'q.mjs'), composant('q', 'p'))
      const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), stylesheetsDir: styles, css: 'split', urlPrefix: '/modularjs', env })
      assert.deepEqual((await b.compile()).errors.map(e => e.message), [])
      assert.deepEqual(absents(out), [], 'premier tour')
      writeFileSync(join(styles, 'b.scss'), '.b { color: green; }\n')
      assert.deepEqual((await b.compile()).errors.map(e => e.message), [])
      assert.deepEqual(absents(out), [], 'après la retouche de b.scss : p et q citent les adresses de ce tour')
      await b.close()
    })
  }
})
