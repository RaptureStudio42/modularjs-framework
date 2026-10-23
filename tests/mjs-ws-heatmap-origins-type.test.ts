// heatmapPackage : le type TypeScript dit `origins` obligatoire — un appel sans elle ne compile pas, comme il ne
// démarre pas à l'exécution (la liste blanche des origines de vos pages : sans elle, n'importe qui remplirait la carte
// d'adresses de son choix). Le vrai compilateur, sur de vrais appels.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { mjsTmp } from './helpers/tmp.js'

const ICI    = dirname(fileURLToPath(import.meta.url))
const HEATMAP = join(ICI, '../src/mjs-ws/heatmap.js')

// les erreurs de compilation d'un petit fichier qui importe le paquet
function erreurs(corps: string): string[] {
  const dir = mjsTmp('heatmap-origins-type')
  mkdirSync(dir, { recursive: true })
  const fichier = join(dir, 'essai.ts')
  writeFileSync(fichier, `import { heatmapPackage } from '${HEATMAP}'\nimport type { MjsWsHeatmapOptions } from '${HEATMAP}'\n${corps}\n`)
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: false, noEmit: true, skipLibCheck: true, esModuleInterop: true, types: ['node'], typeRoots: [join(ICI, '../node_modules/@types')]
  }
  const programme = ts.createProgram([fichier], options)
  return ts.getPreEmitDiagnostics(programme, programme.getSourceFile(fichier)).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

describe('heatmapPackage — `origins` est obligatoire dans le type', function () {
  this.timeout(120000)

  it('avec origins : compile ; sans origins ou sans réglages : ne compile pas, et le message nomme `origins`', () => {
    assert.deepEqual(erreurs(`heatmapPackage({ origins: ['https://monsite.fr'], maxAge: 30, unit: 'day' })`), [])
    const sans = erreurs(`heatmapPackage({ maxAge: 30 })`)
    assert.ok(sans.length > 0 && sans.some((m) => /origins/.test(m)), 'sans origins : ' + JSON.stringify(sans))
    const rien = erreurs(`heatmapPackage()`)
    assert.ok(rien.length > 0, 'sans réglages : ' + JSON.stringify(rien))
    const type = erreurs(`const reglages: MjsWsHeatmapOptions = { maxAge: 3 }\nvoid reglages`)
    assert.ok(type.some((m) => /origins/.test(m)), 'le type d\'options : ' + JSON.stringify(type))
  })
})
