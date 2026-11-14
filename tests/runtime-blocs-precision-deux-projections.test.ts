// fichiers du runtime à blocs `<precision>` / `<horloge>` : lus tels quels, ils donnent la version de l'option `derived: "precise"` ;
// le code par défaut (la règle de l'horloge) n'y est qu'en commentaire, et `npm run typecheck` exclut src/runtime. Chaque fichier est
// projeté dans les deux modes par la fonction du bundler (projeterPrecision) : chaque projection se lit (esbuild), sans marque de bloc
// restante, et ne nomme aucune variable introuvable que l'autre ne nomme pas — le runtime entier ne passe pas `tsc` (erreurs de type
// dans les deux modes) : seules les erreurs « nom introuvable » propres à un mode signalent un bloc cassé
// limite : la garde n'exécute rien — un nom de propriété faux dans un bloc (`el._sett(k, v)` pour `el._set(k, v)`) la laisse verte ;
// seule l'exécution de la version par défaut le montre (tests qui la lisent par tests/helpers/runtime-projete.ts)
import { describe, it } from 'mocha'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import ts from 'typescript'
import { projeterPrecision } from '../src/bundler/index.js'

const DOSSIER = fileURLToPath(new URL('../src/runtime/', import.meta.url))
const TOUS    = readdirSync(DOSSIER).filter((f) => f.endsWith('.ts')).sort()
const BLOC    = /^[ \t]*\/\/ <\/?(precision|horloge)>$/m
const A_BLOCS = TOUS.filter((f) => BLOC.test(readFileSync(join(DOSSIER, f), 'utf-8')))

function projection(f: string, precise: boolean): string {
  return projeterPrecision(readFileSync(join(DOSSIER, f), 'utf-8'), precise)
}

// noms introuvables (TS2304, TS2552) de chaque fichier à blocs, le runtime entier projeté dans un mode
function nomsInconnus(precise: boolean): Map<string, string[]> {
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: [], noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true }
  const hote    = ts.createCompilerHost(options)
  const lire    = hote.getSourceFile.bind(hote)
  hote.getSourceFile = (nom, langue, ...reste) => (nom.startsWith(DOSSIER) ? ts.createSourceFile(nom, projeterPrecision(readFileSync(nom, 'utf-8'), precise), langue) : lire(nom, langue, ...reste))
  const prog    = ts.createProgram(TOUS.map((f) => join(DOSSIER, f)), options, hote)
  const noms    = new Map<string, string[]>()
  for (const f of A_BLOCS) {
    const diags = prog.getSemanticDiagnostics(prog.getSourceFile(join(DOSSIER, f))).filter((d) => d.code === 2304 || d.code === 2552)
    noms.set(f, [...new Set(diags.map((d) => /'([^']+)'/.exec(ts.flattenDiagnosticMessageText(d.messageText, '\n'))?.[1] ?? String(d.code)))].sort())
  }
  return noms
}

describe('runtime — fichiers à blocs <precision> / <horloge> : les deux projections', function () {
  this.timeout(30000)

  it('trouve les fichiers à blocs du runtime (au moins les treize connus)', () => {
    assert.ok(A_BLOCS.length >= 13, `fichiers à blocs trouvés : ${A_BLOCS.join(', ') || 'aucun'}`)
  })

  for (const precise of [false, true]) {
    it(`projection ${precise ? 'avec l\'option' : 'par défaut (sans l\'option)'} : chaque fichier se lit (esbuild), sans marque de bloc restante`, () => {
      for (const f of A_BLOCS) {
        const texte = projection(f, precise)
        assert.doesNotMatch(texte, BLOC, `${f} : marque de bloc restée (bloc mal fermé ?)`)
        assert.doesNotThrow(() => transformSync(texte, { loader: 'ts', sourcefile: f }), `${f} ne se lit pas`)
      }
    })
  }

  it('typage : aucune projection ne nomme une variable introuvable que l\'autre ne nomme pas', () => {
    const sans = nomsInconnus(false)
    const avec = nomsInconnus(true)
    for (const f of A_BLOCS) assert.deepEqual(sans.get(f), avec.get(f), `${f} : noms introuvables, par défaut / avec l'option`)
  })
})
