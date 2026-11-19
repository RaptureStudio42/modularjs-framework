// Coffee adapter — rétrocompat avec les .mjs V1.
//
// CoffeeScript reste pris en charge, sans avertissement : script de composant
// (`lang="coffee"`), fichier .coffee importé par `@import`, manifeste externe.
// Le défaut d'un projet reste Civet.

import type { LanguageAdapter, CompileSourceOpts, CompileResult } from './index.js'

export const coffeeAdapter: LanguageAdapter = {
  name: 'coffee',

  async compileToJs(source: string, opts: CompileSourceOpts = {}): Promise<CompileResult> {
    const fileName = opts.fileName ?? 'inline.coffee'
    const coffee = await import('coffeescript')
    try {
      const result = coffee.default.compile(source, {
        bare: opts.bare ?? true,
        filename: fileName,
        sourceMap: true,  // carte v3 remontée jusqu'à `transpile()`
      })
      if (typeof result === 'string') return { code: result }
      const r = result as any
      return { code: r.js, map: r.v3SourceMap }
    } catch (err: any) {
      // l'erreur BRUTE porte `.location` + un `.toString()` avec ligne/colonne/
      // caret, mais bundler/index.ts:1661 (`r.reason?.message`) ne relaie que le motif nu
      // (« missing " ») — position perdue. Reconstruit `.message` (ligne:colonne + ligne
      // source + caret) AVANT de relancer, pour que la position survive au relais. Préfixe `<fichier>:` : le
      // transpileur (remapAdapterErrorLine) recale alors la ligne sur celle du `.mjs`, comme pour Civet — sans lui,
      // la faute était annoncée à sa ligne dans le script seul
      if (err && err.location && typeof err.location.first_line === 'number') {
        const line   = err.location.first_line + 1
        const col    = (err.location.first_column ?? 0) + 1
        const raw    = String(err.toString?.() ?? '').split('\n')
        const detail = raw.slice(1).join('\n')  // ligne source + caret, fournis par CoffeeScript
        err.message  = `${fileName}:${line}:${col}: ${err.message}` + (detail ? `\n${detail}` : '')
      }
      throw err
    }
  },
}
