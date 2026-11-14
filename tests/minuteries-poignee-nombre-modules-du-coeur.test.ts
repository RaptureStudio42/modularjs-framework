// une poignée de minuterie (la main d'arrêt de µafter / µevery) appelée par `poignee?.()` ne vaut jamais un nombre :
// l'appel optionnel ne protège que de null et undefined, `0?.()` jette (TypeError) — le geste de <@@sortable>, créé avec
// `timer: 0`, cassait chaque fin de geste. Lu sur le code compilé de chaque module du cœur
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as acorn from 'acorn'
import { transpile } from '../src/transpiler/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const DOSSIER = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core-modules')

// le nom appelé ou affecté : `x` → x, `a.b` → b
function nomDe(n: any): string | null {
  if (n?.type === 'Identifier') return n.name
  if (n?.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier') return n.property.name
  return null
}

const nombre = (n: any): boolean => n?.type === 'Literal' && typeof n.value === 'number'

// les noms appelés par `?.()` qui reçoivent aussi un nombre (affectation, déclaration, clé d'objet)
// (l'import du cœur, `from µ.asset('mjs_core.js')`, est résolu par le bundler : ramené à sa chaîne pour la lecture)
function poigneesANombre(js: string): string[] {
  const ast: any = acorn.parse(js.replace(/\bfrom\s+µ\.asset\(([^)]*)\)/g, 'from $1'), { ecmaVersion: 'latest', sourceType: 'module' })
  const appeles = new Set<string>()
  const nombres = new Set<string>()
  const visiter = (n: any): void => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'CallExpression' && n.optional && nomDe(n.callee)) appeles.add(nomDe(n.callee)!)
    if (n.type === 'AssignmentExpression' && nombre(n.right) && nomDe(n.left)) nombres.add(nomDe(n.left)!)
    if (n.type === 'VariableDeclarator' && nombre(n.init) && nomDe(n.id)) nombres.add(nomDe(n.id)!)
    if (n.type === 'Property' && !n.computed && nombre(n.value) && nomDe(n.key)) nombres.add(nomDe(n.key)!)
    for (const cle in n) {
      if (cle === 'type' || cle === 'start' || cle === 'end' || cle === 'loc') continue
      const v = n[cle]
      if (Array.isArray(v)) v.forEach(visiter)
      else if (v && typeof v === 'object') visiter(v)
    }
  }
  visiter(ast)
  return [...appeles].filter(nom => nombres.has(nom)).sort()
}

describe('poignée de minuterie : jamais un nombre devant `?.()` (modules du cœur)', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le relevé voit la forme fautive', () => {
    assert.deepEqual(poigneesANombre('var g = { timer: 0 }; g.timer?.(); var h = null; h?.(); var k = 0; k = 1; k?.()'), ['k', 'timer'])
  })

  it('<@@sortable> : le geste (souris et clavier) ne crée pas sa poignée à 0', async () => {
    const { output } = await transpile(readFileSync(join(DOSSIER, 'sortable.mjs'), 'utf-8'), { moduleName: 'sortable' })
    assert.deepEqual(poigneesANombre(output), [])
  })

  it('chaque module du cœur', async () => {
    const fautes: string[] = []
    for (const f of readdirSync(DOSSIER).filter(x => x.endsWith('.mjs')).sort()) {
      const { output } = await transpile(readFileSync(join(DOSSIER, f), 'utf-8'), { moduleName: f.replace(/\.mjs$/, '') })
      for (const nom of poigneesANombre(output)) fautes.push(`${f} : ${nom}`)
    }
    assert.deepEqual(fautes, [])
  })
})
