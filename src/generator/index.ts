// generator — entrypoint qui réexporte la fonction compile principale.
// La logique est dans compile.ts.

export { compile, preprocess, walk, closeSelfClosedComponents } from './compile.js'
export { state, reset, genId, dedent, getEffectVars, registerEffect, CompilerState } from './state.js'
export { cleanJs, cleanJsExpr, parseMixedString } from './utils.js'

