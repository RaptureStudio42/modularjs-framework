// déclarations des variables du script, tranchées par l'arbre de Civet, jamais par un motif sur le texte. Civet compile le
// script sans `autoVar` ni `autoLet` : ModularJS déclare lui-même, avec la portée d'`autoVar` (la fonction entière). Sa passe
// ligne par ligne (applyCivetDialectSugar) déclare la forme courante, `nom = valeur` sur une ligne : `.=` à la place du `=`
// quand l'affectation est une instruction du corps de la fonction, sinon `nom .= undefined` devant la première instruction de
// ce corps. Elle note chaque déclaration qu'elle pose (ligne, noms) ; l'arbre de Civet tranche ensuite ce que le texte ne dit
// pas. Une déclaration de la passe que l'arbre contredit est défaite : un `.=` posé dans un bloc (`do`, `then`), où il
// n'existerait que pour ce bloc, ou après une affectation du même nom plus haut dans la fonction, qu'il lierait avant son
// tour, redevient `=` ; un `nom .= undefined` qu'aucune affectation de sa fonction n'utilise (champ de classe, quelle que
// soit la forme de l'en-tête : `new class`, `f class`, classe rendue par une fonction…, même quand le même nom est affecté
// dans une autre fonction ; variable du corps d'une `function` ou d'une méthode, que la passe ne lit pas comme une fonction
// et déclare dans la portée qui l'entoure) ou qui double une déclaration écrite à côté est retiré. Puis un nom qu'aucune déclaration ne lie là où se
// trouve l'affectation (dans son bloc, sa fonction ou au-dessus :
// paramètre, `catch`, `for`, `:=`, `.=`, `let`, import, nom de fonction ou de classe, variable du `<script module>`) est
// déclaré comme la passe le déclare, à sa première affectation : `o =` suivi de la valeur à la ligne d'après, affectation
// dans une expression (`String(o = 1)`, `if m = re.exec(s)`), nom que la déclaration défaite liait. Civet note elle-même, sur
// chaque affectation, les noms qu'elle lie (champ `names`, celui de son `autoVar`). Un nom lié dans un bloc (variable d'une
// boucle ou d'un `catch`, `if x := …`, motif d'un `switch`, classe ou fonction écrite dans un `if`) n'existe que dans ce
// bloc ; `var` vaut pour toute la fonction. Le script garde ses lignes, rien de ce qu'il déclare lui-même n'est retiré, et
// il n'est relu par Civet que s'il a changé. Une chaîne, un commentaire, un champ de classe, un membre (`o.x =`, `@x =`) ou
// une affectation composée (`+=`, `||=`) ne déclarent rien

import { nomsLies, estNomInterdit } from './civet-noms-interdits.js'

type Noeud = any

interface Portee {
  parente: Portee | null
  // fonction (ou script entier) qui contient la portée : là se pose une déclaration ajoutée
  fonction: Portee
  // corps de la fonction, ou du script entier ; `null` pour le bloc d'une instruction
  bloc: Noeud
  declares: Set<string>
  // noms que le script déclare lui-même, jamais la passe ligne par ligne
  ecrits: Set<string>
}

interface Modification {
  pos: number
  longueur: number
  texte: string
}

// affectation simple (`=`) sans déclaration, ou `nom .= valeur` posé par la passe ligne par ligne (`rendue` une fois
// défaite) ; `pos` : la position de son signe
interface Affectation {
  noeud: Noeud
  portee: Portee
  pos: number
  noms: string[]
  passe?: 'enPlace' | 'rendue'
}

// `nom .= undefined` posé par la passe ligne par ligne
interface Hissage {
  noeud: Noeud
  portee: Portee
  nom: string
}

export interface DeclarationsAjoutees {
  // script relu, aux mêmes lignes
  source: string
  // noms déclarés par `nom .= undefined` : le contrôle des noms de variable ne compte pas cette déclaration
  hisses: string[]
}

// déclarations posées par la passe ligne par ligne, par ligne du texte (0 pour la première) : `nom = …` devenu `nom .= …`
// (enPlace), `nom .= undefined` ajouté (hisses) ; tête de `µ$x =` réécrite, sa valeur restant à entourer de `µ.state(…)` (etats)
export interface DeclarationsDeLaPasse {
  enPlace: Map<number, string[]>
  hisses: Map<number, string[]>
  etats: Map<number, EtatDeLaPasse>
}

// tête de `µ$x =` réécrite par la passe : sa cible (`µ_state.x`), son texte d'origine (`avant`), le texte posé (`emis`) et le
// JavaScript à poser après la valeur (`suite` : l'export de `export µ$x =`)
export interface EtatDeLaPasse {
  cible: string
  avant: string
  emis: string
  suite: string
}

export const declarationsDeLaPasse = (): DeclarationsDeLaPasse => ({ enPlace: new Map(), hisses: new Map(), etats: new Map() })

// lignes ajoutées au texte à partir de la ligne `depuis` (0 pour la première), après que la passe a noté ses déclarations :
// chaque note de cette ligne ou d'en dessous descend d'autant
export function decaleLaPasse(passe: DeclarationsDeLaPasse, depuis: number, lignes: number): void {
  const decale = <T>(notes: Map<number, T>): void => {
    const decalees = [...notes].map(([ligne, note]): [number, T] => [ligne >= depuis ? ligne + lignes : ligne, note])
    notes.clear()
    for (const [ligne, note] of decalees) notes.set(ligne, note)
  }
  decale(passe.enPlace)
  decale(passe.hisses)
  decale(passe.etats)
}

const FONCTIONS = new Set(['FunctionExpression', 'ArrowFunction', 'MethodDefinition'])

// nœuds qui déclarent : leurs noms sont lus comme le contrôle des noms de variable les lit (motif, reste, paramètre, motif
// d'un `catch` que Civet change en déclaration)
const DECLARANTS = new Set(['Declaration', 'ForDeclaration', 'Parameters', 'CatchParameter', 'ClassExpression', 'EnumDeclaration'])

// instructions dont la tête lie un nom pour elles seules : variable d'une boucle `for`, d'un `catch`
const TETES = new Set(['ForStatement', 'CatchClause'])

const jeton = (x: Noeud): string | undefined => typeof x === 'string' ? x : x?.token

// cible que `.=` déclare telle quelle : un nom, ou un motif objet / tableau fait de noms seulement (jamais un membre)
function motifPur(m: Noeud): boolean {
  if (m == null || typeof m === 'string' || m.$loc) return true
  if (Array.isArray(m)) return m.every(motifPur)
  if (!m.type) return motifPur(m.children)
  switch (m.type) {
    case 'Identifier':
      return true
    case 'ObjectBindingPattern':
      return motifPur(m.properties)
    case 'ArrayBindingPattern':
      return motifPur(m.elements)
    case 'BindingProperty':
      return (m.value ?? m.identifier) != null && motifPur(m.value ?? m.identifier)
    case 'BindingElement':
    case 'BindingRestElement':
      return m.binding != null && motifPur(m.binding)
  }
  return false
}

// début du premier jeton et fin du dernier jeton réels d'un nœud dans le texte (le `let` que Civet tire d'un `.=` porte la
// position du signe, pas celle du nom : il ne compte pas)
function bornes(n: Noeud, source: string): [number, number] | null {
  let premier: number | null = null
  let dernier                = 0
  const pile                 = [n]
  while (pile.length) {
    const x = pile.pop()
    if (x == null || typeof x !== 'object') continue
    if (Array.isArray(x)) pile.push(...x)
    else if (x.$loc) {
      if (typeof x.token !== 'string' || !/\S/.test(x.token) || !source.startsWith(x.token, x.$loc.pos)) continue
      if (premier == null || x.$loc.pos < premier) premier = x.$loc.pos
      dernier = Math.max(dernier, x.$loc.pos + x.token.length)
    }
    else if (x.children) pile.push(x.children)
  }
  return premier == null ? null : [premier, dernier]
}

// position du `.=` d'une déclaration écrite `nom .= …` (son `let` porte la position du signe), sinon -1
function pointEgal(x: Noeud, source: string): number {
  const loc = x.decl?.$loc
  if (!loc) return -1
  const i = source.indexOf('.=', loc.pos)
  return i >= 0 && i < loc.pos + Math.max(loc.length, 2) ? i : -1
}

// où poser `nom .= undefined` : devant la première instruction du corps, après les `import` / `export` du script entier.
// Un bloc `do` en tête ne se laisse pas précéder sur sa ligne (Civet en fait une accolade) : la déclaration se pose alors en
// `var` devant la première instruction du bloc, et vaut pour toute la fonction, comme avec `autoVar`
function pointDeHissage(bloc: Noeud, source: string): { pos: number; parVar: boolean } | null {
  for (const e of bloc.expressions ?? []) {
    const instruction = Array.isArray(e) ? e[1] : null
    if (instruction == null || (bloc.root && /^(?:Import|Export)/.test(instruction.type ?? ''))) continue
    if (instruction.type === 'DoStatement' && instruction.block) {
      const dedans = pointDeHissage(instruction.block, source)
      if (dedans) return { pos: dedans.pos, parVar: true }
      continue
    }
    const pos = premierJeton(instruction)
    if (pos != null) return { pos, parVar: false }
  }
  return null
}

// position du premier jeton d'une instruction, même quand Civet en change le texte : là commence l'instruction
function premierJeton(n: Noeud): number | null {
  let premier: number | null = null
  const pile                 = [n]
  while (pile.length) {
    const x = pile.pop()
    if (x == null || typeof x !== 'object') continue
    if (Array.isArray(x)) pile.push(...x)
    else if (x.$loc) {
      if (typeof x.token === 'string' && /\S/.test(x.token) && (premier == null || x.$loc.pos < premier)) premier = x.$loc.pos
    }
    else if (x.children) pile.push(x.children)
  }
  return premier
}

// portée d'une fonction, ou du script entier : elle reçoit elle-même les déclarations ajoutées
function porteeDeFonction(parente: Portee | null, bloc: Noeud, declares: Iterable<string> = []): Portee {
  const portee    = { parente, bloc, declares: new Set(declares), ecrits: new Set(declares) } as Portee
  portee.fonction = portee
  return portee
}

// portée d'un bloc ou d'une tête d'instruction, dans la fonction de sa parente
const porteeDeBloc = (parente: Portee): Portee => ({ parente, fonction: parente.fonction, bloc: null, declares: new Set(), ecrits: new Set() })

// fonction sans place où poser une déclaration : corps écrit sur la ligne de la flèche
const sansPlace = (fonction: Portee): boolean => !fonction.bloc || (fonction.bloc.bare && !fonction.bloc.root)

const declare = (portee: Portee | null, nom: string): boolean => {
  for (let p = portee; p; p = p.parente) if (p.declares.has(nom)) return true
  return false
}

// portée où le nom est déclaré, vue de `portee`
const resout = (portee: Portee | null, nom: string): Portee | null => {
  for (let p = portee; p; p = p.parente) if (p.declares.has(nom)) return p
  return null
}

// déclaration de la passe retirée : le nom n'est plus déclaré là, sauf si le script l'y déclare lui-même
const oublie = (portee: Portee, nom: string): void => {
  if (!portee.ecrits.has(nom)) portee.declares.delete(nom)
}

// script où chaque nom qu'une affectation lie sans déclaration est déclaré, et où chaque déclaration de la passe ligne par
// ligne que l'arbre contredit est défaite ; `null` quand il n'y a rien à changer. `connus` : noms déclarés hors du script
// (variables du `<script module>` pour le `<script>`), jamais redéclarés ; `passe` : déclarations posées par cette passe
export function declarationsManquantes(ast: Noeud, source: string, connus: readonly string[] = [], passe?: DeclarationsDeLaPasse): DeclarationsAjoutees | null {
  const racine                      = porteeDeFonction(null, null, connus)
  const affectations: Affectation[] = []
  const hissesDeLaPasse: Hissage[]  = []
  const vus                         = new Set<Noeud>()
  const pile: [Noeud, Portee][]     = [[ast, racine]]
  // ligne (0 pour la première) d'une position du texte
  const finsDeLigne: number[] = []
  if (passe) for (let i = source.indexOf('\n'); i >= 0; i = source.indexOf('\n', i + 1)) finsDeLigne.push(i)
  const ligneDe = (pos: number): number => {
    let bas  = 0
    let haut = finsDeLigne.length
    while (bas < haut) {
      const milieu = (bas + haut) >> 1
      if (finsDeLigne[milieu] < pos) bas = milieu + 1
      else haut = milieu
    }
    return bas
  }
  // déclaration `nom .= …` que la passe ligne par ligne a notée à sa ligne
  const poseeParLaPasse = (x: Noeud, noms: string[]): 'enPlace' | 'hisse' | null => {
    const pos = passe && noms.length ? pointEgal(x, source) : -1
    if (pos < 0) return null
    const ligne = ligneDe(pos)
    if (noms.every(nom => passe!.enPlace.get(ligne)?.includes(nom))) return 'enPlace'
    if (noms.length === 1 && passe!.hisses.get(ligne)?.includes(noms[0])) return 'hisse'
    return null
  }
  // première lecture : les noms que chaque portée déclare, où qu'ils soient dans son bloc, et les affectations dans l'ordre
  while (pile.length) {
    const [x, portee] = pile.pop()!
    if (x == null || typeof x !== 'object' || x.$loc || vus.has(x)) continue
    vus.add(x)
    if (Array.isArray(x)) {
      for (let i = x.length - 1; i >= 0; i--) pile.push([x[i], portee])
      continue
    }
    // nœud propre à TypeScript : absent du JavaScript produit
    if (x.ts) continue
    let suite = portee
    if (x.type === 'BlockStatement') {
      if (x.root && !portee.bloc) portee.bloc = x
      // bloc d'une instruction (`if`, boucle, `try`, classe…) : ce qu'il déclare n'existe que dans ce bloc
      else if (x !== portee.bloc) suite = porteeDeBloc(portee)
    }
    else if (TETES.has(x.type)) suite = porteeDeBloc(portee)
    else if (FONCTIONS.has(x.type)) {
      // ses paramètres sont lus dans ses enfants, dans sa propre portée
      suite = porteeDeFonction(portee, x.block)
      if (typeof x.id?.name === 'string') {
        for (const p of [portee, suite]) {
          p.declares.add(x.id.name)
          p.ecrits.add(x.id.name)
        }
      }
    }
    else if (DECLARANTS.has(x.type)) {
      // `var` vaut pour toute la fonction ; toute autre déclaration, pour son bloc
      const cible = x.type === 'Declaration' && /^var\b/.test(jeton(x.decl) ?? '') ? portee.fonction : portee
      // un nom lu deux fois (motif et champ `names`) compte une fois
      const noms  = [...new Set(nomsLies(x))]
      const sorte = x.type === 'Declaration' ? poseeParLaPasse(x, noms) : null
      for (const nom of noms) cible.declares.add(nom)
      if (sorte === 'enPlace') affectations.push({ noeud: x, portee: cible, pos: pointEgal(x, source), noms, passe: 'enPlace' })
      else if (sorte === 'hisse') hissesDeLaPasse.push({ noeud: x, portee: cible, nom: noms[0] })
      else for (const nom of noms) cible.ecrits.add(nom)
    }
    else if (x.type === 'AssignmentExpression') {
      const { lhs, names } = x
      // affectation simple seulement (`=`) : une affectation composée ne déclare rien, comme sur une ligne
      if (Array.isArray(lhs) && lhs.length && Array.isArray(names) && lhs.every(e => Array.isArray(e) && jeton(e[3]) === '=')) {
        const pos = lhs[0][3]?.$loc?.pos ?? bornes(lhs[0], source)?.[0] ?? -1
        affectations.push({ noeud: x, portee, pos, noms: [...new Set<string>(names.filter((nom: unknown) => typeof nom === 'string'))] })
      }
    }
    if (x.children) pile.push([x.children, suite])
  }
  const modifications: Modification[] = []
  // `.=` de la passe que l'arbre contredit : posé dans un bloc (`do`, `then`), ou après une affectation du même nom plus haut
  // dans la fonction qu'il lierait avant son tour (« Cannot access … before initialization ») ; il redevient `=`, et son nom
  // se déclare plus bas, à sa première affectation
  for (const a of affectations) {
    if (a.passe !== 'enPlace') continue
    const fonction    = a.portee.fonction
    const instruction = a.portee === fonction && (fonction.bloc?.expressions ?? []).some((e: Noeud) => Array.isArray(e) && e[1] === a.noeud)
    const devancee    = affectations.some(b => !b.passe && b.pos < a.pos && b.portee.fonction === fonction && b.noms.some(nom => a.noms.includes(nom) && resout(b.portee, nom) === a.portee))
    if (instruction && !devancee) continue
    modifications.push({ pos: a.pos, longueur: 1, texte: ' ' })
    for (const nom of a.noms) oublie(a.portee, nom)
    a.passe = 'rendue'
  }
  // `nom .= undefined` de la passe : retiré quand une déclaration écrite à côté le double, ou quand aucune affectation ne s'en
  // sert : champ de classe, que la passe prend pour une variable, même quand le même nom est affecté dans une autre fonction ;
  // variable du corps d'une `function` ou d'une méthode, que la passe ne lit pas comme une fonction et déclare dans la portée
  // qui l'entoure. Le nom y devient une variable de la fonction qui l'affecte, déclarée à sa première affectation, comme avec
  // `autoVar` ; le `; ` qui le séparait de la suite part avec lui. S'en servent : une affectation de sa fonction qui le lie ;
  // une affectation d'une autre fonction qui le lie quand cette fonction n'a pas de place où déclarer le nom (corps sur la
  // ligne de la flèche) ou que ce nom est interdit
  for (const h of hissesDeLaPasse) {
    const sert  = (a: Affectation): boolean => a.passe !== 'enPlace' && a.noms.includes(h.nom) && resout(a.portee, h.nom) === h.portee && (a.portee.fonction === h.portee.fonction || sansPlace(a.portee.fonction) || estNomInterdit(h.nom))
    const utile = !h.portee.ecrits.has(h.nom) && affectations.some(sert)
    const b     = utile ? null : bornes(h.noeud, source)
    if (!b) continue
    const fin = b[1] + (/^ *; */.exec(source.slice(b[1]))?.[0].length ?? 0)
    modifications.push({ pos: b[0], longueur: fin - b[0], texte: '' })
    oublie(h.portee, h.nom)
  }
  // seconde lecture : chaque nom neuf est déclaré une fois, dans la fonction qui contient sa première affectation
  const hisses = new Map<number, { noms: string[]; parVar: boolean }>()
  for (const a of affectations) {
    if (a.passe === 'enPlace') continue
    const { noeud, portee } = a
    // un nom interdit (`eval`, mot réservé…) reste au contrôle des noms, qui le refuse à sa ligne
    const neufs    = a.noms.filter(nom => !estNomInterdit(nom) && !declare(portee, nom))
    const fonction = portee.fonction
    const bloc     = fonction.bloc
    // corps écrit sur la ligne de la flèche : rien où poser une déclaration
    if (!neufs.length || sansPlace(fonction)) continue
    const lhs         = a.passe ? null : noeud.lhs
    const signe       = lhs?.[0][3]
    const instruction = (bloc.expressions ?? []).some((e: Noeud) => Array.isArray(e) && e[1] === noeud)
    if (lhs?.length === 1 && signe?.$loc && source.startsWith('=', signe.$loc.pos) && neufs.length === a.noms.length && instruction && motifPur(lhs[0][1])) {
      modifications.push({ pos: signe.$loc.pos, longueur: 1, texte: '.=' })
    }
    else {
      const point = pointDeHissage(bloc, source)
      if (point == null) continue
      hisses.set(point.pos, { noms: [...(hisses.get(point.pos)?.noms ?? []), ...neufs], parVar: point.parVar })
    }
    for (const nom of neufs) fonction.declares.add(nom)
  }
  for (const [pos, { noms, parVar }] of hisses) modifications.push({ pos, longueur: 0, texte: noms.map(nom => parVar ? `var ${nom}; ` : `${nom} .= undefined; `).join('') })
  if (!modifications.length) return null
  // de la fin vers le début ; à la même position, ce qui est retiré avant ce qui est posé
  let texte = source
  for (const m of modifications.sort((a, b) => b.pos - a.pos || b.longueur - a.longueur)) texte = texte.slice(0, m.pos) + m.texte + texte.slice(m.pos + m.longueur)
  return { source: texte, hisses: [...hisses.values()].flatMap(h => h.noms) }
}

// signe d'une affectation de l'arbre : `=`, ou `??=` pour le `?=` du texte, que Civet change
const signe = (op: Noeud): string | undefined => jeton(op) ?? (Array.isArray(op?.children) ? jeton(op.children[0]) : undefined)

// `valeur` entourée de `µ.state(…)` là où elle se trouve dans `liste` (à toute profondeur de tableaux) ; faux si elle n'y est pas
function entoure(liste: Noeud[], valeur: Noeud): boolean {
  const i = valeur == null ? -1 : liste.indexOf(valeur)
  if (i >= 0) liste[i] = ['µ.state(', valeur, ')']
  return i >= 0 || liste.some(e => Array.isArray(e) && entoure(e, valeur))
}

// valeur de `µ$x =` dont la passe ligne par ligne n'a réécrit que la tête (`µ_state.x ?= `, notée à sa ligne) : la valeur, telle
// que Civet la lit (sur la ligne, écrite dessous en retrait, liste ou objet sur plusieurs lignes, suite en `.` au retrait de la
// tête…), est entourée de `µ.state(…)` dans l'arbre même, juste avant la génération du JavaScript, jamais sur le texte ; l'export
// de `export µ$x =` suit la valeur (`; export var $x = µ_state.x`, relu par le getter de `µ_state`, comme sur une ligne). Une tête notée que l'arbre ne lit pas comme cette affectation (texte d'une chaîne `"""` qui cite `µ$x =`)
// reprend son texte d'origine et quitte les notes : rend le script ainsi repris, à relire par Civet, sinon `null`
export function entoureLesEtats(ast: Noeud, source: string, passe?: DeclarationsDeLaPasse): string | null {
  if (!passe?.etats.size) return null
  const debuts = [0]
  for (let i = source.indexOf('\n'); i >= 0; i = source.indexOf('\n', i + 1)) debuts.push(i + 1)
  const entourees = new Set<number>()
  const vus       = new Set<Noeud>()
  const pile      = [ast]
  while (pile.length) {
    const x = pile.pop()
    if (x == null || typeof x !== 'object' || x.$loc || vus.has(x)) continue
    vus.add(x)
    if (Array.isArray(x)) {
      pile.push(...x)
      continue
    }
    if (x.type === 'AssignmentExpression' && x.lhs?.length === 1 && signe(x.lhs[0][3]) === '??=' && Array.isArray(x.children)) {
      const b   = bornes(x.lhs[0][1], source)
      let ligne = 0
      while (b && ligne + 1 < debuts.length && debuts[ligne + 1] <= b[0]) ligne++
      const note = b ? passe.etats.get(ligne) : undefined
      if (note && !entourees.has(ligne) && source.slice(b![0], b![1]) === note.cible) {
        // la valeur elle-même, là où elle se trouve parmi les enfants ; à défaut, tout ce qui suit la cible et son signe
        if (!entoure(x.children, x.expression)) {
          const [cible, ...valeur] = x.children
          x.children               = [cible, 'µ.state(', valeur, ')']
        }
        if (note.suite) x.children.push(note.suite)
        entourees.add(ligne)
      }
    }
    if (x.children) pile.push(x.children)
  }
  let texte = source
  // de la dernière ligne vers la première : les positions d'au-dessus ne bougent pas
  for (const [ligne, note] of [...passe.etats].sort((a, b) => b[0] - a[0])) {
    if (entourees.has(ligne)) continue
    passe.etats.delete(ligne)
    const retrait     = /[ \t]*/y
    retrait.lastIndex = debuts[ligne] ?? source.length
    retrait.exec(source)
    if (debuts[ligne] != null && source.startsWith(note.emis, retrait.lastIndex)) texte = texte.slice(0, retrait.lastIndex) + note.avant + texte.slice(retrait.lastIndex + note.emis.length)
  }
  return texte === source ? null : texte
}
