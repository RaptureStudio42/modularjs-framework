// Le minifieur raccourcit tout champ `_mjs_*` écrit dans le code (production, développement minifié), jamais le texte d'une
// chaîne ni d'une expression régulière : un nom interne que le cœur chercherait par son texte ne trouve plus rien une fois le code
// minifié. Une classe basculée par `@class{…}` s'est perdue ainsi au premier rendu : le cœur retrouvait les bascules actives d'une
// balise par le nom de leur garde ; le suivi du chargement cherchait de même ses passes sur le prototype, et ne les trouvait plus.
// Formes relevées, dans tout le cœur (`src/runtime`, sous-dossiers compris) : une chaîne ou un morceau de gabarit qui contient
// `_mjs_` en tête d'un nom, une expression régulière qui le contient, un morceau qui finit par `_mjs` collé à une concaténation ou à
// un gabarit. Un message (texte libre, avec des espaces) n'est pas un nom ; un nom en `__mjs_` (identifiant d'une balise du document)
// n'est jamais raccourci ; les marqueurs de données réservés (`DATA_MARKER_NAMES`, jamais raccourcis) se lisent par leur texte.
// Le panneau de développement ne filtre plus les clés `_mjs_` de l'état d'un composant : aucune clé de l'état ne porte ce préfixe,
// l'état ne reçoit que les variables du composant.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { DATA_MARKER_NAMES } from '../src/bundler/minify.js'

const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'runtime')

// chaînes admises, chacune avec sa raison
const ADMIS: Record<string, string> = {
  'mjs_easing.ts « _mjs_anim_keyframes »': 'identifiant d\'une balise <style> du document, jamais un champ : le minifieur ne réécrit pas les chaînes',
  // l'échange à chaud cherche l'appel dans le texte de la fonction compilée du composant : juste tant que ce code n'est pas minifié
  'mjs_hotswap.ts « µ._mjs_setComputed »': 'appel cherché dans le texte du code compilé par l\'échange à chaud du développement'
}

// `_mjs_` en tête d'un nom (ni lettre, ni chiffre, ni `_`, ni `$` devant) : le seul que le minifieur raccourcit
const TETE = /(^|[^\w$])_mjs/

// chaque nom interne lu par son texte dans le code `texte` du fichier `fichier` : « fichier:ligne « texte » »
function releve(fichier: string, texte: string): string[] {
  const source  = ts.createSourceFile(fichier, texte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const trouves: string[] = []
  const voir = (n: ts.Node): void => {
    const morceau = ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)
    const t       = morceau || ts.isRegularExpressionLiteral(n) ? (n as ts.LiteralLikeNode).text : ''
    const colle   = (ts.isTemplateHead(n) || ts.isTemplateMiddle(n)) || (!!n.parent && ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)
    const nom     = morceau && !/\s/.test(t) && !DATA_MARKER_NAMES.includes(t) && (/(^|[^\w$])_mjs_/.test(t) || (colle && /(^|[^\w$])_mjs$/.test(t)))
    if (nom || (ts.isRegularExpressionLiteral(n) && TETE.test(t))) trouves.push(`${fichier}:${source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1} « ${t} »`)
    ts.forEachChild(n, voir)
  }
  voir(source)
  return trouves
}

const sansLigne = (r: string): string => r.replace(/:\d+ /, ' ')

describe('cœur : aucun nom interne `_mjs_*` lu par son texte (le minifieur le raccourcit)', function () {
  it('aucune chaîne, expression régulière, concaténation ni gabarit qui nomme un champ `_mjs_` dans src/runtime, hors marqueurs réservés', function () {
    const fichiers = (readdirSync(RUNTIME, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts'))
    assert.ok(fichiers.length > 50, `fichiers du cœur trouvés : ${fichiers.length}`)
    assert.ok(fichiers.some((f) => f.includes(sep)), 'les sous-dossiers du cœur sont lus')
    const releves = fichiers.flatMap((f) => releve(f, readFileSync(join(RUNTIME, f), 'utf-8')))
    assert.deepEqual(releves.filter((r) => !(sansLigne(r) in ADMIS)), [])
    // une chaîne admise qui n'existe plus quitte la liste
    assert.deepEqual(Object.keys(ADMIS).filter((a) => !releves.some((r) => sansLigne(r) === a)), [])
  })

  it('le relevé voit chaque forme (témoin) : chaîne, préfixe, expression régulière, RegExp, concaténation coupée, gabarit, appel pointé ; ni un message, ni un marqueur réservé, ni un identifiant en `__mjs_`', function () {
    const code = [
      "a.indexOf('_mjs_cl_')",
      "b['_mjs_x']",
      '/^_mjs_cl_/.test(k)',
      "new RegExp('^_mjs_cl_')",
      "'_mjs' + '_cl_' + c",
      '`_mjs_${c}`',
      '`_mjs${c}`',
      "x('µ._mjs_y')",
      "d('texte _mjs_ libre')",
      "e('_mjs_c')",
      "document.getElementById('__mjs_store')"
    ]
    assert.deepEqual(code.map((ligne) => releve('t.ts', ligne).map(sansLigne)), [
      ['t.ts « _mjs_cl_ »'],
      ['t.ts « _mjs_x »'],
      ['t.ts « /^_mjs_cl_/ »'],
      ['t.ts « ^_mjs_cl_ »'],
      ['t.ts « _mjs »'],
      ['t.ts « _mjs_ »'],
      ['t.ts « _mjs »'],
      ['t.ts « µ._mjs_y »'],
      [],
      [],
      []
    ])
  })
})
