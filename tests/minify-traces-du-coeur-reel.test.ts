// le réécrivain des traces du runtime (cutRuntimeTraces) est vérifié sur le cœur RÉEL, lu par acorn : chaque appel de
// trace que l'analyse de l'arbre relève est réécrit, aucun autre caractère du texte ne change, le code réécrit s'analyse
//
// deux formes d'appel de trace existent dans le runtime : `µ.log(…)` (le callee devient `MJS_TRACE?.`) et
// `µ._mjs_logger()?.(…)` (l'appelé interne devient `MJS_TRACE`). le test relève les appels dans l'arbre, applique ces
// deux remplacements au texte d'origine et compare au résultat du réécrivain : un autre écart, d'un seul caractère, est
// une réécriture à tort (une chaîne, un gabarit, une expression régulière, un commentaire) ou une trace oubliée
//
// une trace écrite sous une autre forme (`µ?.log(…)`, `µ.log?.(…)`, `µ['log'](…)`) resterait dans le code envoyé sans
// que rien ne le dise : le test refuse qu'une telle forme entre au runtime

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { cutRuntimeTraces } from '../src/bundler/minify.js'

const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/runtime')
const BLOC_AIDE   = /^\/\/ <trace-logger>\n[\s\S]*?^\/\/ <\/trace-logger>\n?/m

interface Remplacement { debut: number, fin: number, texte: string }

const analyser  = (code: string): any => acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' })
const estMu     = (n: any): boolean => n?.type === 'Identifier' && n.name === 'µ'
// `µ.<nom>` : accès pointé simple, sans `?.`
const estMembre = (n: any, nom: string): boolean => n?.type === 'MemberExpression' && !n.computed && !n.optional && estMu(n.object) && n.property.name === nom

// les traces de l'arbre : les remplacements attendus, et les appels écrits sous une forme que le réécrivain ne lit pas
function relever(code: string): { remplacements: Remplacement[], inconnues: string[] } {
  const remplacements: Remplacement[] = []
  const inconnues: string[]           = []
  walk.full(analyser(code), (n: any) => {
    if (n.type !== 'CallExpression') return
    const c = n.callee
    // µ.log(…)
    if (!n.optional && estMembre(c, 'log')) { remplacements.push({ debut: c.start, fin: c.end, texte: 'MJS_TRACE?.' }); return }
    // µ._mjs_logger()?.(…)
    if (n.optional && c.type === 'CallExpression' && c.arguments.length === 0 && estMembre(c.callee, '_mjs_logger')) { remplacements.push({ debut: c.start, fin: c.end, texte: 'MJS_TRACE' }); return }
    // les autres écritures d'un appel de trace : µ?.log(…), µ.log?.(…), µ['log'](…)
    if (c.type !== 'MemberExpression' || !estMu(c.object)) return
    const nom = c.computed ? (c.property.type === 'Literal' ? c.property.value : null) : c.property.name
    if (nom === 'log') inconnues.push(code.slice(n.start, Math.min(n.end, n.start + 60)))
  })
  return { remplacements, inconnues }
}

function appliquer(code: string, remplacements: Remplacement[]): string {
  let sortie  = ''
  let curseur = 0
  for (const r of [...remplacements].sort((a, b) => a.debut - b.debut)) {
    sortie += code.slice(curseur, r.debut) + r.texte
    curseur = r.fin
  }
  return sortie + code.slice(curseur)
}

// l'aide `µ._mjs_logger` part avec ses repères, lignes laissées vides : le texte attendu la retire de la même façon
const sansAide = (code: string): string => code.replace(BLOC_AIDE, (bloc) => bloc.replace(/[^\n]/g, ''))

// le premier caractère où deux textes diffèrent, avec ce qui l'entoure ; null s'ils sont identiques
function ecart(obtenu: string, attendu: string): string | null {
  if (obtenu === attendu) return null
  let i = 0
  while (i < obtenu.length && obtenu[i] === attendu[i]) i++
  return `écart à la position ${i} : obtenu « ${obtenu.slice(Math.max(0, i - 50), i + 50)} », attendu « ${attendu.slice(Math.max(0, i - 50), i + 50)} »`
}

const FICHIERS = readdirSync(RUNTIME_DIR).filter((n) => n.endsWith('.ts') && !n.endsWith('.d.ts')).sort().map((nom) => ({ nom, code: readFileSync(join(RUNTIME_DIR, nom), 'utf-8') }))

describe('cutRuntimeTraces — le cœur réel, lu par acorn', function () {
  this.timeout(60000)

  it('le runtime a des traces des deux formes (la lecture de l\'arbre trouve ce qu\'elle doit trouver)', () => {
    let directes = 0
    let gardees  = 0
    for (const { code } of FICHIERS) {
      const { remplacements } = relever(sansAide(code))
      directes += remplacements.filter((r) => r.texte === 'MJS_TRACE?.').length
      gardees  += remplacements.filter((r) => r.texte === 'MJS_TRACE').length
    }
    assert.ok(directes > 0, 'aucun µ.log(…) relevé')
    assert.ok(gardees > 0, 'aucun µ._mjs_logger()?.(…) relevé')
  })

  it('aucun fichier du runtime n\'écrit une trace sous une forme que le réécrivain ne lit pas', () => {
    const fautes: string[] = []
    for (const { nom, code } of FICHIERS) for (const inconnue of relever(sansAide(code)).inconnues) fautes.push(`${nom} : ${inconnue}`)
    assert.deepEqual(fautes, [], 'écrivez µ.log(…) ou µ._mjs_logger()?.(…) : toute autre forme reste dans le code envoyé')
  })

  for (const { nom, code } of FICHIERS) {
    it(`${nom} : chaque trace est réécrite, rien d'autre ne change, le résultat s'analyse`, () => {
      const obtenu = cutRuntimeTraces(code)
      assert.equal(ecart(obtenu, appliquer(sansAide(code), relever(sansAide(code)).remplacements)), null)
      assert.equal(obtenu.split('\n').length, code.split('\n').length, 'les lignes restent à leur place')
      assert.doesNotThrow(() => analyser(obtenu), `${nom} : le résultat ne s'analyse plus`)
      assert.deepEqual(relever(obtenu).remplacements, [], `${nom} : il reste des appels de trace`)
    })
  }

  it('le cœur assemblé (tous les fichiers, mjs_init en tête) : même contrôle sur le texte entier', () => {
    const ordre   = [...FICHIERS.filter((f) => f.nom === 'mjs_init.ts'), ...FICHIERS.filter((f) => f.nom !== 'mjs_init.ts')]
    const coeur   = ordre.map((f) => `// === ${f.nom} ===\n${f.code}`).join('\n')
    const releve  = relever(sansAide(coeur))
    const obtenu  = cutRuntimeTraces(coeur)
    assert.equal(ecart(obtenu, appliquer(sansAide(coeur), releve.remplacements)), null)
    assert.equal((obtenu.match(/MJS_TRACE/g) || []).length, releve.remplacements.length, 'autant de MJS_TRACE que de traces relevées')
    assert.doesNotThrow(() => analyser(obtenu))
    // les commentaires nomment encore l'aide : c'est le code qui ne doit plus la porter
    let noms = 0
    walk.full(analyser(obtenu), (n: any) => { if (n.type === 'Identifier' && n.name === '_mjs_logger') noms++ })
    assert.equal(noms, 0, 'l\'aide part avec les traces qu\'elle gardait')
  })
})

describe('cutRuntimeTraces — ce que le texte dit sans l\'appeler, ce qu\'il appelle sans que ça se voie', () => {
  it('une expression régulière qui dit µ.log( après `)` ne bouge pas, l\'appel qui suit est réécrit', () => {
    const texte = 'if (x) /µ.log(1)/.test(s)\nµ.log(2)'
    assert.equal(cutRuntimeTraces(texte), 'if (x) /µ.log(1)/.test(s)\nMJS_TRACE?.(2)')
  })

  it('une expression régulière qui dit µ.log( après `}` ne bouge pas, l\'appel qui suit est réécrit', () => {
    const texte = 'function f() {}\n/µ.log(3)/.test(s)\nµ.log(4)'
    assert.equal(cutRuntimeTraces(texte), 'function f() {}\n/µ.log(3)/.test(s)\nMJS_TRACE?.(4)')
  })

  it('une expression régulière après `)` ou `}` qui contient une quote ou un backtick ne décale pas ce qui suit', () => {
    const texte = 'if (x) /[\'"`]/.test(s)\nfunction g() {}\n/`µ.log(5)`/.test(s)\nµ.log(\'a\', `${µ.log(6)}`)'
    assert.equal(cutRuntimeTraces(texte), 'if (x) /[\'"`]/.test(s)\nfunction g() {}\n/`µ.log(5)`/.test(s)\nMJS_TRACE?.(\'a\', `${MJS_TRACE?.(6)}`)')
  })

  it('une division garde sa barre : l\'appel qui suit est réécrit, celui d\'une chaîne voisine ne l\'est pas', () => {
    const texte = 'var a = (b) / c; µ.log(7); var d = (e) / f; var s = \'µ.log(8)\''
    assert.equal(cutRuntimeTraces(texte), 'var a = (b) / c; MJS_TRACE?.(7); var d = (e) / f; var s = \'µ.log(8)\'')
  })

  it('une trace dans l\'expression `${…}` d\'un gabarit est réécrite, le texte du gabarit ne l\'est pas', () => {
    assert.equal(cutRuntimeTraces('var t = `µ.log(1) ${µ.log(2)} µ.log(3)`'), 'var t = `µ.log(1) ${MJS_TRACE?.(2)} µ.log(3)`')
    assert.equal(cutRuntimeTraces('var t = `a ${ `b ${ µ._mjs_logger()?.(4) }` } c`'), 'var t = `a ${ `b ${ MJS_TRACE?.(4) }` } c`')
  })

  it('un code que acorn ne lit pas retombe sur le masque du lexer : les chaînes et les commentaires restent intacts', () => {
    const texte = 'var a = \'µ.log(1)\'; // µ.log(2)\nµ.log(3); @@@'
    assert.equal(cutRuntimeTraces(texte), 'var a = \'µ.log(1)\'; // µ.log(2)\nMJS_TRACE?.(3); @@@')
  })
})
