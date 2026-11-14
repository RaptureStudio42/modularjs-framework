// reader/expression — une expression du gabarit lue par le vrai Civet puis par acorn, ses raccourcis de MJS réécrits sur
// l'arbre ESTree du JavaScript produit : `$x` → `$.x` (un nom importé reste tel quel), `$$x` → `µ.store.x`, `§x` et `§§x`
// (lecture du contexte), `@@x` → `_mjsThis.x`, `&id` → `µ.url.params.id`, les runes `µx` des formes courtes, de la langue,
// du thème et de la mise en page ; `@x`, `isnt` et la grammaire de Civet sont lus par Civet lui-même
// une seule compilation par texte (cache du lecteur) ; la carte de Civet situe chaque nom dans le texte écrit, ce qui
// sépare exactement le code de ses chaînes. Une écriture dont Civet donnerait une autre sortie que sur le texte de
// l'ancienne lecture (nom en clé ou lié, comparaison chaînée, rune à forme, expression illisible) est rendue en texte
// réécrit : chaque nom remplacé, à la place que l'arbre lui trouve. Une écriture que l'arbre ne sait pas situer revient à
// l'ancienne lecture du générateur, avec sa raison : la sortie ne change pas d'une lecture à l'autre, sauf
// où l'ancienne lecture prenait du code pour du texte (expression régulière qui contient `}`, `{`, un guillemet ou un
// accent grave dans le `${…}` d'un gabarit de texte, chaîne à trois guillemets) : elle refusait l'expression ou y
// laissait un nom sans le réécrire, l'arbre la lit juste

import * as acorn from 'acorn'
import { originalPositionFor } from '@jridgewell/trace-mapping'
import { compilerTexte } from './code.js'
import { LETTRES_RESERVEES } from './disguise.js'
import { MU_HOOKS, MU_LANG_OUT, MU_THEME_OUT, importedSingletonError, vaultRemovedError } from '../sigils.js'
import { maskInertSameLength } from '../lexer/index.js'
import { t } from '../messages/index.js'

// même grammaire que la compilation de l'ancienne lecture : `==` lu `===` (option coffeeEq), `isnt` lu `is not` (coffeeIsnt)
const DIRECTIVE = '"civet coffeeEq coffeeIsnt"\n'
// un `isnt` que l'ancienne lecture laisse en nom (ISNT_LAISSE) : lu sans coffeeIsnt, Civet le garde en nom comme elle
const DIRECTIVE_ISNT_NOM = '"civet coffeeEq"\n'
// un gestionnaire du dialecte, lu dans la grammaire du lot des gestionnaires : `#` et `### ###` y sont des commentaires (le lot les
// change en commentaires, applyCivetDialectSugar) ; la même grammaire dit la faute d'un gestionnaire illisible (generator/utils.ts)
export const DIRECTIVE_GESTIONNAIRE = '"civet coffeeComment coffeeEq coffeeIsnt"\n'
// la raison d'un gestionnaire du dialecte que Civet ne lit pas : une vraie faute de syntaxe, dite sur le texte écrit (generator/utils.ts)
export const GESTIONNAIRE_ILLISIBLE = 'fragment du dialecte : illisible par Civet'

// `§`, `@@` et `&id` déguisés à longueur égale en lettres d'un nom (reader/disguise.ts), `&id` aux seules places où l'ancienne
// lecture le lisait (ni après un opérande, ni suivi d'un `;` : `&amp;` reste du texte) ; une lettre de déguisement restée
// dans le JavaScript produit (chaîne, propriété, `§` nu) rend l'expression à l'ancienne lecture
const PARAGRAPHE  = LETTRES_RESERVEES['§']
const AROBASE     = LETTRES_RESERVEES['@@']
const ESPERLUETTE = LETTRES_RESERVEES['&']
const RE_LETTRE   = new RegExp(`[${Object.values(LETTRES_RESERVEES).join('')}]`)

export function deguiserExpression(texte: string): string {
  return texte.replace(/§/g, PARAGRAPHE).replace(/@@/g, AROBASE + AROBASE).replace(/(?<![\w)\]"'`&.])&(?=[a-zA-Z_]\w*(?![\w;]))/g, ESPERLUETTE)
}

// une lettre de déguisement écrite dans un texte qui a aussi un signe à déguiser : elle y serait lue pour ce signe
export function lettreReserveeEcrite(texte: string): boolean {
  return RE_LETTRE.test(texte) && deguiserExpression(texte) !== texte
}

// les signes de MJS repris à la place de leurs lettres de déguisement (message de Civet sur le texte déguisé)
// une expression qui commence par une regex (`/abc/.test($t)`) : Civet lit `(/abc/…)` comme une section d'opérateur, une fonction
// à l'écran ; elle se compile sans parenthèses, la regex reste une regex et son texte reste celui écrit
const REGEX_EN_TETE = /^\s*\/(?![/*])/

export function enveloppe(texte: string): string {
  if (!REGEX_EN_TETE.test(texte)) return `(${texte})`
  // sans parenthèses, Civet lit un programme : un `if` ou un `unless` placé derrière (`/b/.test($t) if $a`) en fait une instruction,
  // qui casse le code produit (seules les aides de Civet, `var modulo = …`, peuvent précéder l'expression) ; entre parenthèses, ce mot défait la section d'opérateur, l'expression se lit comme avant
  const corps = (compilerTexte(DIRECTIVE + texte, 'expression').ast as any)?.body
  const lue   = (n: any, i: number) => i === corps.length - 1 ? n.type === 'ExpressionStatement' : n.type === 'VariableDeclaration'
  return !corps || (corps.length > 0 && corps.every(lue)) ? texte : `(${texte})`
}

export function signesRepris(texte: string): string {
  return texte.replaceAll(AROBASE + AROBASE, '@@').replaceAll(PARAGRAPHE, '§').replaceAll(ESPERLUETTE, '&')
}

// relevé pour l'outil de comparaison : expressions lues par l'arbre, refusées par lui et pourquoi ; `fragments` :
// les fragments de JavaScript (liaisons, corps des gestionnaires) lus par acorn
export const compteursExpressions = { arbre: 0, relues: 0, fragments: 0, derniere: '', raisons: new Map<string, number>() }

function relire(raison: string, nom = ''): null {
  compteursExpressions.relues++
  compteursExpressions.derniere = nom ? `« ${nom} » : ${raison}` : raison
  compteursExpressions.raisons.set(raison, (compteursExpressions.raisons.get(raison) ?? 0) + 1)
  return null
}

// écritures réécrites par l'ancienne lecture avant Civet (`=:`, `:=`, `&$x` refusé) et runes réécrites selon ce qui les suit :
// cherchées dans tout le texte, chaînes comprises (une expression rendue de trop ne change rien)
export const RACCOURCIS_HORS_CIVET = /=:|:=|&\$/
export const RUNES_A_FORME  = /µ\s*\.?\s*(?:read|write|refresh|inspect|toggle|import|every|after|derived|minmax)|mjsimport/
// `isnt` que l'ancienne lecture laisse en nom (devant `:`, `)`, `]`, `}`, `,`, `;`, cf. compileGrammarViaCivet) et que Civet, avec
// coffeeIsnt, lirait en opérateur : `(isnt)`, `($a isnt)` y deviennent des fonctions
const ISNT_LAISSE           = /(?<![\w.$])isnt(?![\w$])(?=\s*[:)\]},;])/
const RUNES_DU_SCRIPT       = new Set(['every', 'after', 'derived', ...MU_HOOKS.split('|')])
const RE_DOLLAR             = /^\$([a-zA-Z_][a-zA-Z0-9_$]*)$/
const RE_STORE              = /^\$\$([a-zA-Z_][a-zA-Z0-9_$]*)$/
const RE_MU                 = /^µ([a-zA-Z]\w*)$/
const RE_CHEMIN             = /^[\w$µ]+(?:\.[\w$]+)+$/
const MOTS_DU_DIALECTE      = new Set(['not', 'and', 'or', 'is', 'isnt', 'unless'])
const RE_CONTEXTE           = new RegExp(`^${PARAGRAPHE}([a-zA-Z_]\\w*)$`)
const RE_CONTEXTE_REACTIF   = new RegExp(`^${PARAGRAPHE}${PARAGRAPHE}([a-zA-Z_][a-zA-Z0-9_$]*)$`)
const RE_COMPOSANT          = new RegExp(`^${AROBASE}${AROBASE}([\\w$]+)$`)
const RE_PARAMETRE_ROUTE    = new RegExp(`^${ESPERLUETTE}([a-zA-Z_]\\w*)$`)
// noms dont l'ancienne lecture réécrivait aussi la forme écrite après deux points (`...$x`, `[1..§n]`)
const RE_DEUX_POINTS        = new RegExp(`^[$${PARAGRAPHE}${AROBASE}]`)

type Place = 'reference' | 'abrege' | 'propriete' | 'cle' | 'lie' | 'etiquette'

// ce que devient un nom du code : son écriture JavaScript, null s'il reste tel quel, false s'il revient à l'ancienne lecture
function reecriture(nom: string, externes: readonly string[], runes: { pending: boolean, signal: boolean }, expression = false): string | null | false {
  if (nom[0] === '$') {
    // `$$$x` : l'ancienne lecture réécrit le `$$x` qui suit le premier `$` (`$µ.store.x`)
    const triple = /^\$\$\$([a-zA-Z_][a-zA-Z0-9_$]*)$/.exec(nom)
    if (triple && expression) return externes.includes(`$${triple[1]}`) ? false : `$µ.store.${triple[1]}`
    if (/^\${3,}[a-zA-Z_]/.test(nom)) return false
    const store = RE_STORE.exec(nom)
    if (store) return externes.includes(`$${store[1]}`) ? false : `µ.store.${store[1]}`
    const variable = RE_DOLLAR.exec(nom)
    if (variable) return externes.includes(nom) ? null : `$.${variable[1]}`
    // `$prénom` : l'ancienne lecture réécrit la partie ASCII du nom (`$pr`), la suite reste collée (`$.prénom`)
    const accentue = /^\$([a-zA-Z_][a-zA-Z0-9_]*)([^\x00-\x7f][^$]*)$/.exec(nom)
    if (accentue && expression) return externes.includes(`$${accentue[1]}`) ? null : `$.${accentue[1]}${accentue[2]}`
    return /^[\w$]*$/.test(nom) ? null : false
  }
  if (nom[0] === 'µ') {
    // `µ$$x` dans une chaîne interpolée (hors chaîne, la pré-passe du transpileur l'a déjà réécrit) : `$x` s'il est importé,
    // sinon refusé ; `µ$x` refusé ; `µ$`, `µ$1` restent tels quels
    if (expression && nom[1] === '$') {
      const singleton = /^µ\$\$([a-zA-Z0-9_]+)$/.exec(nom)
      if (singleton) {
        if (externes.includes(`$${singleton[1]}`)) return `$${singleton[1]}`
        throw new Error(t('transpiler.singleton-sans-import', { nom: singleton[1] }))
      }
      // `µ$x`, l'état universel, n'est déclaré que dans le <script> : le gabarit l'affichait en `µ$.x`, qui levait à l'affichage
      const universel = /^µ\$([a-zA-Z_][a-zA-Z0-9_$]*)$/.exec(nom)
      if (universel) throw Object.assign(new Error(t('reader.expression-etat-universel', { nom: universel[1], place: '' })), { etatUniversel: universel[1] })
      return null
    }
    const rune = RE_MU.exec(nom)
    if (!rune) return nom === 'µ' ? null : false
    const r = rune[1]
    if (RUNES_DU_SCRIPT.has(r)) return false
    if (r === 'lang') return MU_LANG_OUT
    if (r === 'theme') return MU_THEME_OUT
    if (r === 'layout') return `(${externes.includes('$layout') ? '$layout' : '$.layout'} || 'default')`
    if (r === 'pending' && runes.pending) return '_mjs_pnd'
    if (r === 'signal' && runes.signal) return '_mjs_sig'
    return `µ.${r}`
  }
  if (RE_LETTRE.test(nom[0])) {
    const reactif = RE_CONTEXTE_REACTIF.exec(nom)
    if (reactif) return `this._mjs_getRCtx('${reactif[1]}')`
    const contexte = RE_CONTEXTE.exec(nom)
    if (contexte) return `this._mjs_getContext('${contexte[1]}')`
    const composant = RE_COMPOSANT.exec(nom)
    if (composant) return `_mjsThis.${composant[1]}`
    const parametre = RE_PARAMETRE_ROUTE.exec(nom)
    return parametre ? `µ.url.params.${parametre[1]}` : false
  }
  return /[^\w$]/.test(nom) ? false : null
}

// chaque nœud de l'arbre avec son parent, la clé qui y mène et s'il est dans un motif qui déclare (paramètre, `let`)
type Visite = (n: any, parent: any, cle: string, lie: boolean) => void

function lieSous(parent: any, cle: string, lie: boolean): boolean {
  switch (parent.type) {
    case 'FunctionExpression': case 'ArrowFunctionExpression': case 'FunctionDeclaration': return cle === 'params' || cle === 'id'
    case 'ClassExpression': case 'ClassDeclaration': return cle === 'id'
    case 'VariableDeclarator': return cle === 'id'
    case 'CatchClause': return cle === 'param'
    case 'ObjectPattern': case 'ArrayPattern': case 'RestElement': return lie
    case 'AssignmentPattern': return lie && cle === 'left'
    case 'Property': return lie && cle === 'value'
    default: return false
  }
}

function parcourir(n: any, parent: any, cle: string, lie: boolean, visite: Visite): void {
  visite(n, parent, cle, lie)
  for (const k of Object.keys(n)) {
    if (k === 'loc') continue
    const v = n[k]
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x.type === 'string') parcourir(x, n, k, lieSous(n, k, lie), visite)
    }
    else if (v && typeof v === 'object' && typeof v.type === 'string') parcourir(v, n, k, lieSous(n, k, lie), visite)
  }
}

function placeDe(parent: any, cle: string, lie: boolean): Place | null {
  if (parent.type === 'MemberExpression' && cle === 'property' && !parent.computed) return 'propriete'
  if (parent.type === 'Property' && cle === 'key' && !parent.computed) return parent.shorthand ? null : 'cle'
  if (parent.type === 'Property' && cle === 'value' && parent.shorthand) return lie ? 'lie' : 'abrege'
  if ((parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && cle === 'key' && !parent.computed) return 'cle'
  if (parent.type === 'MetaProperty') return 'cle'
  if (cle === 'label') return 'etiquette'
  return lie ? 'lie' : 'reference'
}

// un fragment du gabarit que le générateur réécrit sans le compiler (liaison `:value={$x.y}`, corps d'un gestionnaire, valeur
// d'un `{const}` relue par un gestionnaire, attache) : quand il est du JavaScript, acorn le lit tel qu'écrit
// et ses raccourcis sont réécrits à leur place dans le texte, comme ceux d'une expression ; sinon (Civet ou CoffeeScript :
// `@x`, flèche `->`, appel sans parenthèses, mots `not`, `and`, `or`, `is`, `isnt`, `unless` que l'ancienne lecture traduisait
// aussi), le fragment est lu par Civet (fragmentDuDialecte, cf. gestionnaireDuDialecte, generator/utils.ts). Aucune compilation
// Civet ici : le fragment est compilé plus loin, avec les autres
export function fragmentParLArbre(texte: string, externes: readonly string[], runes: { pending: boolean, signal: boolean }, dialecte = false): string | null {
  // code Civet ou CoffeeScript : une barre collée à ce qui la suit après un nom et une espace ouvre une expression régulière passée
  // en argument (`$v.replace /[$x-z]/g, ''`, regexEnArgument), qu'acorn lirait en division et dont il réécrirait le dedans
  if (dialecte && /[\w$]\s+\/(?!\s|=\s)/.test(texte)) return relire('fragment : barre que Civet lit en expression régulière passée en argument')
  if (RACCOURCIS_HORS_CIVET.test(texte)) return relire('fragment : écriture réécrite avant Civet par l\'ancienne lecture (=:, :=, &$x refusé)')
  if (RUNES_A_FORME.test(texte)) return relire('fragment : rune réécrite selon ce qui la suit')
  if (RE_LETTRE.test(texte)) return relire('fragment : lettre de déguisement écrite')
  const commentaires: acorn.Comment[] = []
  let ast: acorn.Program
  try {
    ast = acorn.parse(deguiserExpression(texte), { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, onComment: commentaires })
  }
  catch {
    return relire('fragment : pas du JavaScript (Civet, CoffeeScript)')
  }
  if (commentaires.length > 0) return relire('fragment : commentaire')
  const editions: [number, number, string][] = []
  let raison: string | null = null
  parcourir(ast, null, '', false, (n, parent, cle, lie) => {
    if (raison !== null || n.type !== 'Identifier' || parent === null) return
    if (MOTS_DU_DIALECTE.has(n.name)) {
      raison = 'fragment : mot que l\'ancienne lecture traduisait (not, and, or, is, isnt, unless)'
      return
    }
    const place = placeDe(parent, cle, lie)
    const r     = place === null ? null : reecriture(n.name, externes, runes)
    if (r === null) return
    const apresPoint = texte[n.start - 1] === '.' && (!RE_DEUX_POINTS.test(n.name) || texte[n.start - 2] !== '.')
    if (place === 'propriete') {
      if (!apresPoint) raison = 'fragment : propriété écrite sans point devant'
    }
    else if (r === false || place !== 'reference' || apresPoint) raison = `fragment : nom ${place === 'reference' ? 'rendu à l\'ancienne lecture' : 'hors d\'une lecture'}`
    else if ((n.name === 'µlayout' || n.name[0] === PARAGRAPHE) && ((parent.type === 'AssignmentExpression' && cle === 'left') || parent.type === 'UpdateExpression')) raison = 'fragment : écriture de contexte ou de µlayout'
    else editions.push([n.start, n.end, r])
  })
  if (raison !== null) return relire(raison)
  editions.sort((a, b) => a[0] - b[0])
  let js      = ''
  let curseur = 0
  for (const [debut, fin, ecrit] of editions) {
    js     += texte.slice(curseur, debut) + ecrit
    curseur = fin
  }
  js += texte.slice(curseur)
  if (RE_LETTRE.test(js)) return relire('fragment : lettre de déguisement restée dans la sortie')
  compteursExpressions.fragments++
  return js
}

// les raisons de fragmentDuDialecte qui refusent un gestionnaire (generator/utils.ts), avec leur message ; un gestionnaire que Civet ne
// lit pas est une vraie faute de syntaxe (GESTIONNAIRE_ILLISIBLE)
export const REFUS_DU_GESTIONNAIRE = new Map<string, Parameters<typeof t>[0]>([
  ['fragment du dialecte : nom non situé', 'reader.expression-nom-non-situe'],
  ['fragment du dialecte : nom rendu à l\'ancienne lecture', 'reader.expression-nom-non-lu'],
  ['fragment du dialecte : écriture de contexte ou de µlayout', 'reader.expression-contexte-ecrit'],
  ['fragment du dialecte : signe resté dans le texte', 'reader.expression-signe-sans-nom'],
  ['fragment du dialecte : raccourci à une place que le gabarit ne lit pas', 'reader.expression-raccourci-place'],
  ['fragment du dialecte : nom en clé', 'reader.expression-illisible']
])

// `&$x` et `$x := v` refusés, `$x =: v` écrit `$x = µ.snap(v)`, avec les mots de l'ancienne lecture, quand le texte n'a ni chaîne
// ni commentaire (elle les cherchait dans le code seul) ; null : le texte revient à elle, avec sa raison
function raccourcisReecrits(texte: string, externes: readonly string[]): string | null {
  if (maskInertSameLength(texte) !== texte) return relire(t('reader.expression-raccourci-avec-chaine'))
  const coffre = /(?<![\w.])&\$([a-zA-Z_][a-zA-Z0-9_$]*)/.exec(texte)
  if (coffre) throw vaultRemovedError(coffre[1])
  const reecrit = texte.replace(/(?<![\w$]|(?<!\.)\.)\$([a-zA-Z0-9_]+)[ \t]*=:[ \t]*(.+?)(?=\n|;|$)/g, (_m, nom, valeur) => `$${nom} = µ.snap(${valeur})`)
  refuserDeclaration(reecrit, externes)
  return RACCOURCIS_HORS_CIVET.test(reecrit) ? relire(t('reader.expression-raccourci-place')) : reecrit
}

// `$x := v` refusé (`:=` déclare, un `$x` l'est déjà), sauf pour un singleton importé ; la valeur citée s'arrête au `;`, à la fin de
// la ligne ou à une fermante que l'expression n'ouvre pas
export function refuserDeclaration(texte: string, externes: readonly string[]): void {
  for (const m of texte.matchAll(/(?<!\w|(?<!\.)\.)\$([a-zA-Z_][a-zA-Z0-9_$]*)[ \t]*:=/g)) {
    const varName = `$${m[1]}`
    if (externes.includes(varName)) continue
    let preview = texte.slice(m.index + m[0].length).match(/^[ \t]*([^\n;]*)/)?.[1]?.trim() || '...'
    // une fermante que l'expression n'ouvre pas (`[$x := 2]`, la liste qui l'entoure) n'est pas de la valeur
    while (/[\])}]$/.test(preview) && (preview.match(/[[({]/g)?.length ?? 0) < (preview.match(/[\])}]/g)?.length ?? 0)) preview = preview.slice(0, -1).trimEnd()
    throw new Error(t('lexer.symbole-declare-civet', { varName, preview }))
  }
}

// `$x =: v` d'un gestionnaire écrit `$x = µ.snap(v)`, lu dans le code seul (chaînes et commentaires masqués), sa valeur prise dans le
// texte écrit jusqu'au `;`, à la fin de la ligne ou du texte : une chaîne y reste entière (`$x =: "a"`) ; `&$x` et `$x :=` sont
// refusés avant (generator/utils.ts), un `a := v` reste à Civet ; null : un `=:` reste à une place que le gabarit ne lit pas
function snapsDuGestionnaire(texte: string): string | null {
  const masque = maskInertSameLength(texte)
  let reecrit  = ''
  let curseur  = 0
  for (const m of masque.matchAll(/(?<![\w$]|(?<!\.)\.)\$([a-zA-Z0-9_]+)[ \t]*=:/g)) {
    // les blancs qui suivent `=:` comptés dans le texte écrit : masquée, une chaîne n'est que des blancs
    let debut = m.index + m[0].length
    while (texte[debut] === ' ' || texte[debut] === '\t') debut++
    const fin = debut + (/\n|;/.exec(masque.slice(debut))?.index ?? masque.length - debut)
    if (m.index < curseur || fin === debut) continue
    reecrit += `${texte.slice(curseur, m.index)}$${m[1]} = µ.snap(${texte.slice(debut, fin)})`
    curseur  = fin
  }
  reecrit += texte.slice(curseur)
  return maskInertSameLength(reecrit).includes('=:') ? relire('fragment du dialecte : raccourci à une place que le gabarit ne lit pas') : reecrit
}

// une regex étendue (`///…///`), que le lot des gestionnaires lit en expression régulière et Civet seul en commentaire : remplacée, le
// temps de la lecture, par une regex de même longueur (par un gabarit, écrite sur plusieurs lignes) ; ses noms restent tels qu'écrits
function heregexMasquees(texte: string): string {
  return texte.replace(/\/\/\/[\s\S]*?\/\/\/[a-z]*/g, (h) => h.includes('\n') ? `\`${h.slice(1, -1).replace(/[^\n]/g, 'x')}\`` : `/${'x'.repeat(h.length - 2)}/`)
}

// un gestionnaire du dialecte (Civet, CoffeeScript : `@x`, `->`, `not`, appel sans parenthèses, commentaire `#`), ses runes à forme,
// ses écritures de contexte et ses `unless` déjà réécrits dans le texte : lu par Civet dans la grammaire du lot des gestionnaires,
// ses noms situés par la carte et remplacés à leur place dans le texte écrit, comme l'ancienne lecture les écrivait (un nom après un
// point reste tel quel, `@x` devient `this.x`, un commentaire reste tel qu'écrit) ; une lettre de déguisement écrite, sans signe à
// déguiser, reste le nom écrit. Le texte rendu reste du dialecte, compilé plus loin avec les autres. null : le gestionnaire revient
// à l'ancienne lecture (illisible, nom qu'elle seule écrit, nom non situé, écriture de contexte qui reste)
export function fragmentDuDialecte(texte: string, externes: readonly string[], runes: { pending: boolean, signal: boolean }): string | null {
  if (RACCOURCIS_HORS_CIVET.test(texte)) {
    const reecrit = snapsDuGestionnaire(texte)
    if (reecrit === null) return null
    texte = reecrit
  }
  const lettresEcrites = RE_LETTRE.test(texte)
  const lisible        = texte.includes('///') ? heregexMasquees(texte) : texte
  let c = compilerTexte(DIRECTIVE_GESTIONNAIRE + deguiserExpression(lisible), 'gestionnaire')
  // un `#` dans la partie calculée d'un gabarit (`${ a # b }`) : le lot des gestionnaires le laisse au code, Civet dans cette grammaire
  // y voit un commentaire qui avale la fin du gabarit ; relu comme le lot le lit
  if ((c.erreur || !c.ast) && /\$\{[^}`]*#/.test(lisible)) c = compilerTexte(DIRECTIVE + deguiserExpression(lisible), 'gestionnaire')
  if (c.erreur || !c.ast || c.js === null || !c.trace) return relire(GESTIONNAIRE_ILLISIBLE)
  const debuts = [0]
  for (let i = texte.indexOf('\n'); i !== -1; i = texte.indexOf('\n', i + 1)) debuts.push(i + 1)
  // indice dans `texte` d'une position du JavaScript produit ; ligne 1 : la directive
  const situer = (loc: { line: number, column: number }): number | null => {
    const o = originalPositionFor(c.trace!, { line: loc.line, column: loc.column })
    if (o.line === null || o.line < 2 || o.line - 2 >= debuts.length) return null
    let p = debuts[o.line - 2] + o.column
    while (texte[p] === ' ' || texte[p] === '\t') p++
    return p
  }
  // chaque nom réécrit, à sa place dans le texte écrit (début → longueur, écriture)
  const noms = new Map<number, [number, string]>()
  let raison: string | null = null
  parcourir(c.ast, null, '', false, (n, parent, cle, lie) => {
    if (raison !== null || parent === null) return
    // `@x` : `this.x`, comme l'ancienne lecture, qui réécrivait un `@` suivi d'une lettre (ni `@$x`, ni `@` seul, ni après un point)
    if (n.type === 'ThisExpression') {
      const p = situer(n.loc.start)
      if (p !== null && texte[p] === '@' && /[a-zA-Z_]/.test(texte[p + 1] ?? '') && !/[\w@]/.test(texte[p - 1] ?? '') && (texte[p - 1] !== '.' || texte[p - 2] === '.')) noms.set(p, [1, 'this.'])
      return
    }
    if (n.type !== 'Identifier') return
    // `µimport` est réécrit après, sur le texte rendu (rewriteMuImport), comme pour une expression ; une lettre écrite reste le nom écrit
    if (placeDe(parent, cle, lie) === null || n.name === 'µimport' || (lettresEcrites && RE_LETTRE.test(n.name[0]))) return
    // un nom sans signe de ModularJS en tête (`calculé`, `aµb`) reste tel qu'écrit, comme dans l'ancienne lecture
    if (!/^[$µ]/.test(n.name) && !RE_LETTRE.test(n.name[0])) return
    // `$$$x`, `$prénom`, `µ$$X` lus comme dans une expression (l'état universel `µ$x` y est refusé)
    const r = reecriture(n.name, externes, runes, true)
    if (r === null) return
    const p = situer(n.loc.start)
    if (p === null || !deguiserExpression(texte.slice(p, p + n.name.length + 1)).startsWith(n.name)) {
      raison = 'fragment du dialecte : nom non situé'
      return
    }
    // l'ancienne lecture laissait un nom écrit après un point, jamais après deux (`...$x`, `[1..$n]`)
    if (texte[p - 1] === '.' && (!RE_DEUX_POINTS.test(n.name) || texte[p - 2] !== '.')) return
    if (r === false) raison = 'fragment du dialecte : nom rendu à l\'ancienne lecture'
    else if ((n.name === 'µlayout' || n.name[0] === PARAGRAPHE) && ((parent.type === 'AssignmentExpression' && cle === 'left') || parent.type === 'UpdateExpression')) raison = 'fragment du dialecte : écriture de contexte ou de µlayout'
    // réécrit en clé d'objet ou en étiquette (`{$x: 1}` → `{$.x: 1}`), le nom n'en serait plus une : refusé sur le texte écrit
    else if (r !== n.name && (placeDe(parent, cle, lie) === 'cle' || placeDe(parent, cle, lie) === 'etiquette')) raison = 'fragment du dialecte : nom en clé'
    else noms.set(p, [n.name.length, r])
  })
  if (raison !== null) return relire(raison)
  let reecrit = ''
  let curseur = 0
  for (const [debut, [longueur, ecrit]] of [...noms].sort((a, b) => a[0] - b[0])) {
    reecrit += texte.slice(curseur, debut) + ecrit
    curseur  = debut + longueur
  }
  reecrit += texte.slice(curseur)
  if (/(?<![.§])§|@@|(?<![\w.&)\]])&(?=[a-zA-Z_$])/.test(maskInertSameLength(reecrit))) return relire('fragment du dialecte : signe resté dans le texte')
  compteursExpressions.fragments++
  return reecrit
}

// le JavaScript de l'expression, avant les retouches de fin du générateur (point-virgule, parenthèses autour), ou null
// quand elle revient à l'ancienne lecture ; `texte` : l'expression écrite, ses interpolations `#{…}` déjà converties
// ou `{ reecrit }` : le texte écrit, ses noms réécrits à la place que l'arbre leur trouve, que le générateur compile comme le
// texte de l'ancienne lecture (comparaison chaînée, nom en clé ou en paramètre, objet abrégé qui n'est pas un chemin, signe
// resté après un point, lettre de déguisement écrite, runes à forme déjà réécrites dans le texte : `runesEcrites`) ; une
// expression illisible sans aucun raccourci y est rendue telle quelle, pour le message de Civet sur ce même texte
export function expressionParLArbre(texte: string, externes: readonly string[], runes: { pending: boolean, signal: boolean }, runesEcrites = false): string | { reecrit: string } | null {
  if (RACCOURCIS_HORS_CIVET.test(texte)) {
    const reecrit = raccourcisReecrits(texte, externes)
    if (reecrit === null) return null
    texte = reecrit
  }
  if (!runesEcrites && RUNES_A_FORME.test(texte)) return relire(t('reader.expression-rune-place'))
  const isntNom = ISNT_LAISSE.test(texte)
  if (isntNom && (texte.match(/(?<![\w.$])isnt(?![\w$])/g) ?? []).length > 1) return relire(t('reader.expression-deux-isnt'))
  // une lettre de déguisement écrite dans un texte sans aucun signe à déguiser reste le nom écrit (`Ꞩy`), lu par le texte réécrit
  const lettresEcrites = RE_LETTRE.test(texte)
  if (lettreReserveeEcrite(texte)) return relire(t('reader.expression-lettre-reservee-ecrite'))
  const parLeTexte = runesEcrites || lettresEcrites
  const deguisee   = deguiserExpression(texte)
  const enveloppee = enveloppe(deguisee)
  const c          = compilerTexte((isntNom ? DIRECTIVE_ISNT_NOM : DIRECTIVE) + enveloppee, 'expression')
  const ouvrante   = enveloppee === deguisee ? 0 : 1
  if (c.erreur || !c.ast || c.js === null || !c.trace) {
    // un objet écrit comme corps de flèche (`(r) -> { ...r }`) : Civet y lit un bloc
    if (/(?:->|=>)\s*\{\s*\.\.\./.test(texte)) return relire(t('reader.expression-objet-corps-de-fleche'))
    if (/[$§@µ]/.test(texte) || deguiserExpression(texte) !== texte) return relire(t('reader.expression-illisible'))
    compteursExpressions.arbre++
    return { reecrit: texte }
  }
  const debuts = [0]
  for (let i = texte.indexOf('\n'); i !== -1; i = texte.indexOf('\n', i + 1)) debuts.push(i + 1)
  // indice dans `texte` d'une position du JavaScript produit ; ligne 1 : la directive, ligne 2 : la parenthèse ouvrante, sauf regex en tête
  const situer = (loc: { line: number, column: number }): number | null => {
    const o = originalPositionFor(c.trace, { line: loc.line, column: loc.column })
    if (o.line === null || o.line < 2 || o.line - 2 >= debuts.length) return null
    let p = o.line === 2 ? o.column - ouvrante : debuts[o.line - 2] + o.column
    while (texte[p] === ' ' || texte[p] === '\t') p++
    return p
  }
  const editions: [number, number, string][] = []
  const places  = new Set<number>()
  const dollars: any[] = []
  const gauches = new Set<number>()
  // l'expression entière, sous ses parenthèses : la seule écriture de contexte lue par l'arbre
  const racine  = (c.ast as any).body?.[0]?.expression
  // chaque nom réécrit, à sa place dans le texte écrit (début → longueur, écriture) ; `recompiler` : la raison de passer par
  // le texte réécrit
  const noms = new Map<number, [number, string]>()
  let raison: string | null = null
  let recompiler: string | null = null
  let ecritContexte = false
  let fautif = ''
  parcourir(c.ast, null, '', false, (n, parent, cle, lie) => {
    if (raison !== null || n.type !== 'Identifier' || parent === null) return
    const place = placeDe(parent, cle, lie)
    if (place === null) return
    // `µimport` est réécrit après l'arbre, sur le texte réécrit ; une lettre écrite reste le nom écrit
    if ((runesEcrites && n.name === 'µimport') || (lettresEcrites && RE_LETTRE.test(n.name[0]))) return
    // le paramètre `$` que Civet donne à une fonction abrégée (`&.prix > $min`, `.fait`) : `$.min`, réécrit dedans, y lirait
    // l'élément ; l'ancienne lecture, qui écrit `$.min` avant Civet, lui fait nommer ce paramètre `$1`
    if (n.name === '$') {
      dollars.push(n)
      return
    }
    if (n.name === 'isnt' && place === 'reference' && !isntNom) {
      recompiler ??= '`isnt` (normalisé en `is not` par l\'ancienne lecture)'
      return
    }
    const r = reecriture(n.name, externes, runes, true)
    if (r === null) return
    const p = situer(n.loc.start)
    if (p === null || !deguiserExpression(texte.slice(p, p + n.name.length + 1)).startsWith(n.name)) {
      raison = t('reader.expression-nom-non-situe')
      return
    }
    // l'ancienne lecture laissait un nom écrit après un point (`obj.$x`, `a?.$x`, un `µx` après tout point), jamais après
    // deux (`...$liste`) : une propriété autrement écrite (`@$x`, `a::$x`) ou un nom lu après un point revient à elle
    const apresPoint = texte[p - 1] === '.' && (!RE_DEUX_POINTS.test(n.name) || texte[p - 2] !== '.')
    if (place === 'propriete') {
      // `@$x`, `a::$x` : l'ancienne lecture réécrivait le nom, Civet en fait une propriété (`this.$.x`)
      if (apresPoint || r === null) return
      if (r === false) raison = t('reader.expression-propriete-sans-point')
      else {
        editions.push([n.start, n.end, r])
        noms.set(p, [n.name.length, r])
      }
      return
    }
    // l'ancienne lecture laissait le nom écrit après un point (`[1..µmax]`)
    if (apresPoint && place === 'reference') return
    fautif = texte.slice(p, p + n.name.length)
    const singleton = r === false ? RE_STORE.exec(n.name) : null
    if (singleton && externes.includes(`$${singleton[1]}`)) throw importedSingletonError(singleton[1])
    // un signe seul (`/§/.test($t)`) : déguisé, Civet lit la barre en division et la lettre en nom ; le texte réécrit garde
    // l'expression régulière écrite
    if (r === false && n.name.length === 1 && RE_LETTRE.test(n.name)) {
      recompiler ??= 'signe seul que Civet lit autrement une fois déguisé'
      return
    }
    if (r === false) {
      raison = t('reader.expression-nom-non-lu')
      return
    }
    if (place === 'cle' || place === 'lie' || place === 'etiquette') {
      recompiler ??= `nom en ${place === 'cle' ? 'clé' : place === 'lie' ? 'paramètre ou nom lié' : 'étiquette'}`
      noms.set(p, [n.name.length, r])
      return
    }
    if (apresPoint) {
      raison = t('reader.expression-nom-apres-point')
      return
    }
    if (n.name === 'µlayout' && ((parent.type === 'AssignmentExpression' && cle === 'left') || parent.type === 'UpdateExpression')) throw new Error(t('lexer.mu-layout-ecrit'))
    if (n.name[0] === PARAGRAPHE && ((parent.type === 'AssignmentExpression' && cle === 'left') || parent.type === 'UpdateExpression')) {
      // `§x = v`, `§§x = v`, toute l'expression : l'appel du setter, comme l'ancienne lecture (`this._mjs_setContext('x', v)`)
      const reactif = RE_CONTEXTE_REACTIF.exec(n.name)
      const simple  = RE_CONTEXTE.exec(n.name)
      if (parent.type === 'AssignmentExpression' && parent.operator === '=' && racine === parent && (reactif || simple)) {
        editions.push([parent.start, parent.right.start, `this.${reactif ? '_mjs_setRCtx' : '_mjs_setContext'}('${(reactif ?? simple)![1]}', `])
        editions.push([parent.right.end, parent.right.end, ')'])
        places.add(p)
        ecritContexte = true
        return
      }
      raison = t('reader.expression-contexte-ecrit')
      return
    }
    // `$x |>= f` : Civet recopie la cible d'une affectation dans sa valeur (`$.x = f($.x)`, comme l'ancienne lecture) ; une
    // comparaison chaînée, elle, prend une variable `ref` sur un membre seulement
    if (places.has(p) && gauches.has(p)) {
      editions.push([n.start, n.end, r as string])
      return
    }
    if (parent.type === 'AssignmentExpression' && cle === 'left') gauches.add(p)
    if (places.has(p)) {
      recompiler ??= 'nom recopié par Civet (lu deux fois : comparaison chaînée, affectation conditionnelle)'
      return
    }
    places.add(p)
    noms.set(p, [n.name.length, r as string])
    if (place === 'abrege') {
      if (!RE_CHEMIN.test(r as string)) recompiler ??= 'objet abrégé dont la valeur n\'est pas un chemin'
      else editions.push([parent.start, parent.end, `${(r as string).slice((r as string).lastIndexOf('.') + 1)}: ${r}`])
      return
    }
    editions.push([n.start, n.end, r as string])
  })
  if (raison !== null) return relire(raison, fautif)
  // le texte écrit, chaque nom remplacé par son écriture : ce que l'ancienne lecture donnait à Civet (un commentaire reste tel
  // qu'écrit, elle en réécrivait aussi les noms) ; une écriture de contexte ou un signe de MJS resté dans le code sont refusés
  const parNoms = (_pourquoi: string): { reecrit: string } | null => {
    if (ecritContexte) return relire(t('reader.expression-contexte-et-reecriture'))
    let reecrit = ''
    let curseur = 0
    for (const [debut, [longueur, ecrit]] of [...noms].sort((a, b) => a[0] - b[0])) {
      reecrit += texte.slice(curseur, debut) + ecrit
      curseur  = debut + longueur
    }
    reecrit += texte.slice(curseur)
    if (/(?<![.§])§|@@/.test(maskInertSameLength(reecrit))) return relire(t('reader.expression-signe-sans-nom'))
    compteursExpressions.arbre++
    return { reecrit }
  }
  if (recompiler !== null || parLeTexte) return parNoms(recompiler ?? 'rune à forme ou lettre de déguisement écrite')
  // le `$` qu'une fonction abrégée (`&.prix`, `.fait`) reçoit de Civet : l'ancienne lecture, qui écrivait `$.x` avant Civet,
  // lui faisait nommer ce paramètre `$1` ; un `$` écrit dans l'expression (`$[$k]`) passe par le texte réécrit, où Civet nomme
  // ses paramètres comme sur celui de l'ancienne lecture
  if (dollars.length > 0) {
    if (/(?<![\w$])\$(?![\w$])|(?<![\w$])\$1(?![\w$])/.test(texte)) return parNoms('`$` écrit dans l\'expression, que Civet donne aussi à une fonction abrégée')
    if (editions.some((e) => /(?<![\w$])\$\./.test(e[2]))) for (const n of dollars) editions.push([n.start, n.end, '$1'])
  }
  // une lettre de déguisement restée dans le JavaScript produit : dans une chaîne, un gabarit de texte, une expression
  // régulière ou un commentaire, elle reprend son signe (l'ancienne lecture laissait ce texte tel quel) ; ailleurs, l'expression
  // revient à l'ancienne lecture
  if (RE_LETTRE.test(c.js)) {
    const textes: [number, number][] = [...c.commentaires.map((k): [number, number] => [k.start, k.end]), ...editions.map((e): [number, number] => [e[0], e[1]])]
    parcourir(c.ast, null, '', false, (n) => {
      if (n.type === 'Literal' || n.type === 'TemplateElement') textes.push([n.start, n.end])
    })
    for (const m of c.js.matchAll(new RegExp(RE_LETTRE.source, 'g'))) {
      if (!textes.some(([debut, fin]) => m.index >= debut && m.index < fin)) return parNoms('lettre de déguisement restée dans la sortie (propriété, raccourci nu)')
    }
  }
  editions.sort((a, b) => a[0] - b[0])
  let js      = ''
  let curseur = 0
  for (const [debut, fin, ecrit] of editions) {
    js     += c.js.slice(curseur, debut) + ecrit
    curseur = fin
  }
  js += c.js.slice(curseur)
  if (RE_LETTRE.test(js)) js = signesRepris(js)
  if (RE_LETTRE.test(js)) return relire(t('reader.expression-lettre-reservee-restee'))
  compteursExpressions.arbre++
  return js
}
