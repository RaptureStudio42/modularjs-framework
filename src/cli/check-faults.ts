// cli/check-faults — `mjs check` liste toutes les fautes de chaque fichier en échec, pas seulement la première que donne la
// construction : pour un composant, des passes qui relisent le fichier, chaque faute corrigée comme son message le dit
// (Bundler.nextFaults). Rangées par fichier ; dans un fichier, la faute de la construction d'abord, puis les suivantes par
// ligne, et celle où la lecture s'arrête en dernier, suivie de sa note. Le texte et `mjs check --json` portent la même liste.
// Une place (ligne, colonne) n'est donnée que sûre : celle de la correction, ou celle que le message cite dans ce fichier

import { relative, sep } from 'node:path'
import type { Bundler } from '../bundler/index.js'
import { paintError } from '../diagnostics.js'
import { t } from '../messages/index.js'
import { componentFiles, toDiagnostic, type DiagnosticContext } from './check-json.js'

export interface ListedFault { message: string, line: number | null, column: number | null }

export interface FileFaults {
  /** relatif à la racine du projet, séparateur `/` ; `null` : une erreur qui ne nomme aucun fichier */
  file:   string | null
  faults: ListedFault[]
  /** `complete` : toutes les fautes du fichier ; `unread` : la suite du fichier n'est pas lue ; `limit` : borne atteinte */
  stop:   'complete' | 'unread' | 'limit' | null
}

export class FaultListing {
  /** fautes listées au plus par fichier : au-delà, la suite du fichier n'est pas lue */
  static readonly MAX = 50

  readonly files:  FileFaults[]
  readonly passes: number

  constructor(files: FileFaults[], passes: number) {
    this.files  = files
    this.passes = passes
  }

  /** toutes les fautes, dans l'ordre de la liste */
  get faults(): ListedFault[] {
    return this.files.flatMap((f) => f.faults)
  }

  /** la place de chaque faute, dans l'ordre de `faults` (pour `mjs check --json`) */
  places(): { file: string | null, line: number | null, column: number | null }[] {
    return this.files.flatMap((f) => f.faults.map((fault) => ({ file: f.file, line: fault.line, column: fault.column })))
  }

  /** ce que `mjs check --json` ajoute : les passes de compilation, et pour chaque fichier son nombre de fautes et la fin de sa liste */
  summary(): { passes: number, files: { file: string | null, faults: number, stop: string | null }[] } {
    return { passes: this.passes, files: this.files.map((f) => ({ file: f.file, faults: f.faults.length, stop: f.stop })) }
  }

  static async collect(bundler: Bundler, errors: Error[], root: string): Promise<FaultListing> {
    const ctx    = { root, files: componentFiles(bundler.sourceDir) }
    const groups = new Map<string | null, FileFaults>()
    let passes   = 0
    for (const error of errors) {
      const own  = bundler.failedComponentOf(error)
      const file = own === undefined ? toDiagnostic(error.message, 'error', ctx).file : relative(root, own).split(sep).join('/')
      if (!groups.has(file)) groups.set(file, { file, faults: [], stop: null })
      const entry = groups.get(file)!
      if (own === undefined) {
        entry.faults.push(FaultListing.placed(error.message, null, null, file, ctx))
        // hors des composants, la suite du fichier n'est pas cherchée
        if (file !== null) entry.stop = 'unread'
        continue
      }
      const r      = await bundler.nextFaults(own, error, FaultListing.MAX)
      const found  = r.next.map((f) => FaultListing.placed(f.message, f.line, f.column, file, ctx))
      const last   = r.stop === 'unread' && found.length > 0 ? [found.pop()!] : []
      const byLine = (a: ListedFault, b: ListedFault) => (a.line ?? Infinity) - (b.line ?? Infinity) || (a.column ?? Infinity) - (b.column ?? Infinity) || 0
      passes      += r.passes
      entry.faults.push(FaultListing.placed(error.message, r.at?.line ?? null, r.at?.column ?? null, file, ctx), ...found.sort(byLine), ...last)
      entry.stop = r.stop
    }
    const files = [...groups.values()].sort((a, b) => (a.file === null ? 1 : b.file === null ? -1 : a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    return new FaultListing(files, passes)
  }

  // une faute et sa place : celle de sa correction, sinon celle que son message cite dans ce même fichier, sinon aucune
  private static placed(message: string, line: number | null, column: number | null, file: string | null, ctx: DiagnosticContext): ListedFault {
    if (line !== null) return { message, line, column }
    const d = toDiagnostic(message, 'error', ctx)
    return d.file !== null && d.file === file ? { message, line: d.line, column: d.column } : { message, line: null, column: null }
  }

  /** la liste au terminal : chaque fichier et son nombre de fautes, chaque faute avec sa place quand elle est sûre, la note
   *  de fin de liste ; puis le total et les passes de compilation */
  print(colors: boolean): void {
    console.error(t('cli.errors-compilation', { count: this.faults.length }))
    for (const f of this.files) {
      if (f.file === null) {
        for (const fault of f.faults) console.error('  ', paintError(fault.message, colors))
        continue
      }
      console.error(t('cli.check-faults-file', { file: f.file, count: f.faults.length }))
      for (const fault of f.faults) {
        const place = fault.line === null ? '' : `${f.file}:${fault.line}${fault.column === null ? '' : `:${fault.column}`}  `
        console.error(`     ${place}${paintError(fault.message, colors)}`)
      }
      if (f.stop === 'unread') console.error(t('cli.check-rest-not-read'))
      if (f.stop === 'limit') console.error(t('cli.check-bound', { count: FaultListing.MAX }))
    }
    if (this.passes > 0) console.error(t('cli.check-faults-total', { count: this.faults.length, files: this.files.filter((f) => f.file !== null).length, passes: this.passes }))
  }
}
