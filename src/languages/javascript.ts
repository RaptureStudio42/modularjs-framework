// JavaScript adapter — `<script lang="js">`. Le code passe tel quel, après une lecture de sa syntaxe : une faute
// est levée sous la forme `<fichier>:<ligne>:<col>`, que le transpileur recale sur la ligne du `.mjs`
// (remapAdapterErrorLine) — sans elle, la première lecture venait de l'analyseur, à la ligne du script seul.

import * as acorn from 'acorn'
import type { LanguageAdapter, CompileSourceOpts, CompileResult } from './index.js'
import { t } from '../messages/index.js'

export const jsAdapter: LanguageAdapter = {
  name: 'js',
  compileToJs(source: string, opts: CompileSourceOpts = {}): CompileResult {
    try {
      acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true })
    } catch (err: any) {
      if (!err?.loc) throw err
      const fileName = opts.fileName ?? 'inline.js'
      const detail   = String(err.message).replace(/\s*\(\d+:\d+\)$/, '')
      throw new Error(`${fileName}:${err.loc.line}:${err.loc.column + 1}: ${t('languages.js-erreur-syntaxe', { detail })}`)
    }
    return { code: source }
  },
}
