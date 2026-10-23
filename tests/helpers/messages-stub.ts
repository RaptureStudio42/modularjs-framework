// pose sur un µ de harnais (cœur remplacé par des doublures) les assistants de message du vrai
// mjs_init.ts : sans table des libellés, ils rendent le texte français de secours du code

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export function poserMessages(µ: any): void {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/runtime/mjs_init.ts'), 'utf-8')
  const debut = src.indexOf('µ._mjs_txt = function')
  const fin = src.indexOf('// ----', debut)
  if (debut < 0 || fin < 0) throw new Error('assistants de message introuvables dans mjs_init.ts')
  if (typeof µ._mjs_label !== 'function') µ._mjs_label = () => undefined
  new Function('µ', src.slice(debut, fin))(µ)
  // les traces du routeur passent par µ._mjs_logger()?.(…) : le harnais les laisse sortir par son propre µ.log
  if (typeof µ._mjs_logger !== 'function') µ._mjs_logger = () => µ.log
}
