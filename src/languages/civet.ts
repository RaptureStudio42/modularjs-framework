// Civet adapter — par défaut pour les .mjs côté utilisateur en V2.
// https://civet.dev/

import type { LanguageAdapter, CompileSourceOpts, CompileResult } from './index.js'
import { paramReadOtherwise, ParamReadOtherwiseError } from './civet-params.js'
import { forbiddenName, forbiddenNameError } from './civet-forbidden-names.js'
import { missingDeclarations, wrapsStates } from './civet-declarations.js'

// Civet émet du JS DIRECT (`js: true` ci-dessous strippe les types) :
// pas de passe TS→esbuild (l'ancien commentaire décrivait un pipeline inexistant).

export const civetAdapter: LanguageAdapter = {
  name: 'civet',

  async compileToJs(source: string, opts: CompileSourceOpts = {}): Promise<CompileResult> {
    const civet    = await import('@danielx/civet')
    const fileName = opts.fileName ?? 'inline.civet'
    let ast: unknown
    let code: string
    let sourceMap: any
    let text     = source
    let declares = opts.mjsDeclaredNames
    if (opts.variableNames || opts.declareAssignments) {
      // une seule lecture : l'arbre de Civet sert au contrôle des noms puis produit le JS, par les deux étapes mêmes de
      // `compile` (lecture, puis génération avec la carte de source) ; avec `CIVET_THREADS`, la lecture se fait dans les fils
      // de Civet, qui rendent l'arbre comme ils rendraient le JS d'une compilation ordinaire
      try {
        ast = await civet.compile(text, { filename: fileName, js: true, ast: true } as any)
      }
      catch (e) {
        throw opts.treeFixup ? opts.treeFixup.reread(e) : e
      }
      opts.treeFixup?.check(ast, text)
      // nom qu'une affectation lie sans déclaration (`o =` suivi de la valeur à la ligne d'après, affectation dans une
      // expression) : déclaré comme la passe de déclaration de ModularJS déclare la forme sur une ligne ; une déclaration de
      // cette passe que l'arbre contredit (champ de classe, bloc `do`, première affectation plus haut) est défaite ; le script
      // n'est relu par Civet que s'il a changé
      const add = opts.declareAssignments ? missingDeclarations(ast, text, opts.knownNames, opts.passDeclarations) : null
      if (add) {
        text     = add.source
        declares = new Set([...(declares ?? []), ...add.hoisted])
        ast      = await civet.compile(text, { filename: fileName, js: true, ast: true } as any)
      }
      // valeur de `µ$x =` entourée de `µ.state(…)` dans l'arbre ; une tête que l'arbre ne lit pas comme cette affectation (texte
      // d'une chaîne `"""` qui la cite) reprend son texte, et le script est relu
      const resumed = wrapsStates(ast, text, opts.passDeclarations)
      if (resumed != null) {
        text = resumed
        ast  = await civet.compile(text, { filename: fileName, js: true, ast: true } as any)
        wrapsStates(ast, text, opts.passDeclarations)
      }
      // raccourcis de ModularJS posés dans l'arbre : la carte de source se rapporte au texte qu'ils écrivent
      if (opts.treeFixup) text = opts.treeFixup.fixup(ast, text)
      const generation: any = { filename: fileName, js: true, sourceMap: new civet.SourceMap(text) }
      code = civet.generate(ast, generation)
      // erreur relevée par Civet pendant la génération : la même que lancerait sa compilation ordinaire
      if (generation.errors?.length) throw new (civet as any).ParseErrors(generation.errors)
      sourceMap = generation.sourceMap
    }
    else {
      ({ code, sourceMap } = await civet.compile(source, {
        filename: fileName,
        js: true,          // émet du JS direct (pas du TS) — Civet strippe les types
        sourceMap: true,   // carte v3 remontée jusqu'à `transpile()`
      }))
    }
    // paramètre que Civet lit autrement sans rien dire (`(t, readonly) -> t` compilé en appel) : refus, à sa ligne, au lieu
    // d'un composant qui casse au montage
    const faulty = paramReadOtherwise(code, () => sourceMap.json(fileName, `${fileName}.js`))
    if (faulty) throw new ParamReadOtherwiseError(faulty, fileName, code)
    // variable nommée `eval`, `undefined`, d'un mot réservé… : refus, à sa ligne, au lieu d'une erreur obscure sur le
    // JavaScript produit, ou d'un composant qui casse sans rien dire
    const forbidden = opts.variableNames ? forbiddenName(ast, text, declares) : null
    if (forbidden) throw forbiddenNameError(forbidden, fileName)
    return { code, map: JSON.stringify(sourceMap.json(fileName, `${fileName}.js`)) }
  },
}
