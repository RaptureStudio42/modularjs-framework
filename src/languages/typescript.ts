// TypeScript adapter — `<script lang="ts">`. Strippe les types via esbuild.

import type { LanguageAdapter, CompileSourceOpts, CompileResult } from './index.js'

export const tsAdapter: LanguageAdapter = {
  name: 'ts',

  async compileToJs(source: string, opts: CompileSourceOpts = {}): Promise<CompileResult> {
    const esbuild = await import('esbuild')
    const result = await esbuild.transform(source, {
      loader: 'ts',
      // le `<script>` d'un composant garde son `this` : aucune conversion de module (CompileSourceOpts.dansLeComposant)
      ...(opts.inComponent ? {} : { format: 'esm' as const }),
      target: 'es2022',
      // `µ` et les accents écrits tels quels, comme dans un script Civet ou JavaScript : sans `charset`, esbuild les échappe
      // (`µ.t("x")`) et les passes qui suivent, qui cherchent `µ` en clair (préfixe de la section sous `@i18n`), ne le voient plus
      charset: 'utf8',
      sourcefile: opts.fileName ?? 'inline.ts',
      sourcemap: true,  // carte v3 remontée jusqu'à `transpile()`
    })
    return { code: result.code, map: result.map }
  },
}
