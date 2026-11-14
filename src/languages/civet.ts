// Civet adapter — par défaut pour les .mjs côté utilisateur en V2.
// https://civet.dev/

import type { LanguageAdapter, CompileSourceOpts, CompileResult } from './index.js'
import { parametreLuAutrement, ErreurParametreLuAutrement } from './civet-parametres.js'
import { nomInterdit, erreurNomInterdit } from './civet-noms-interdits.js'
import { declarationsManquantes, entoureLesEtats } from './civet-declarations.js'

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
    let texte    = source
    let declares = opts.nomsDeclaresParMjs
    if (opts.nomsDeVariables || opts.declarerAffectations) {
      // une seule lecture : l'arbre de Civet sert au contrôle des noms puis produit le JS, par les deux étapes mêmes de
      // `compile` (lecture, puis génération avec la carte de source) ; avec `CIVET_THREADS`, la lecture se fait dans les fils
      // de Civet, qui rendent l'arbre comme ils rendraient le JS d'une compilation ordinaire
      try {
        ast = await civet.compile(texte, { filename: fileName, js: true, ast: true } as any)
      }
      catch (e) {
        throw opts.retoucheArbre ? opts.retoucheArbre.relire(e) : e
      }
      opts.retoucheArbre?.verifier(ast, texte)
      // nom qu'une affectation lie sans déclaration (`o =` suivi de la valeur à la ligne d'après, affectation dans une
      // expression) : déclaré comme la passe de déclaration de ModularJS déclare la forme sur une ligne ; une déclaration de
      // cette passe que l'arbre contredit (champ de classe, bloc `do`, première affectation plus haut) est défaite ; le script
      // n'est relu par Civet que s'il a changé
      const ajout = opts.declarerAffectations ? declarationsManquantes(ast, texte, opts.nomsConnus, opts.declarationsDeLaPasse) : null
      if (ajout) {
        texte    = ajout.source
        declares = new Set([...(declares ?? []), ...ajout.hisses])
        ast      = await civet.compile(texte, { filename: fileName, js: true, ast: true } as any)
      }
      // valeur de `µ$x =` entourée de `µ.state(…)` dans l'arbre ; une tête que l'arbre ne lit pas comme cette affectation (texte
      // d'une chaîne `"""` qui la cite) reprend son texte, et le script est relu
      const repris = entoureLesEtats(ast, texte, opts.declarationsDeLaPasse)
      if (repris != null) {
        texte = repris
        ast   = await civet.compile(texte, { filename: fileName, js: true, ast: true } as any)
        entoureLesEtats(ast, texte, opts.declarationsDeLaPasse)
      }
      // raccourcis de ModularJS posés dans l'arbre : la carte de source se rapporte au texte qu'ils écrivent
      if (opts.retoucheArbre) texte = opts.retoucheArbre.retoucher(ast, texte)
      const generation: any = { filename: fileName, js: true, sourceMap: new civet.SourceMap(texte) }
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
    const fautif = parametreLuAutrement(code, () => sourceMap.json(fileName, `${fileName}.js`))
    if (fautif) throw new ErreurParametreLuAutrement(fautif, fileName, code)
    // variable nommée `eval`, `undefined`, d'un mot réservé… : refus, à sa ligne, au lieu d'une erreur obscure sur le
    // JavaScript produit, ou d'un composant qui casse sans rien dire
    const interdit = opts.nomsDeVariables ? nomInterdit(ast, texte, declares) : null
    if (interdit) throw erreurNomInterdit(interdit, fileName)
    return { code, map: JSON.stringify(sourceMap.json(fileName, `${fileName}.js`)) }
  },
}
