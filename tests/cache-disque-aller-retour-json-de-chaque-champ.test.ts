// Cache sur disque (`mjs build --cache`) : chaque champ d'une entrée du cache (`CacheEntry`) revient tel quel de son passage par le
// fichier du cache (encodeDiskCache, puis decodeDiskCache). Les champs ne sont pas écrits à la main ici : ils sont lus dans la
// déclaration du type, et chacun reçoit un exemple construit d'après son type déclaré. Un champ ajouté plus tard dont la valeur ne
// survit pas au JSON (un Set, une Map hors de la marque, une fonction, un nombre entier long, une instance de classe) fait rougir ce
// test, au lieu de servir en silence une entrée amputée à la construction suivante.

import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { encodeDiskCache, decodeDiskCache } from '../src/bundler/index.js'

const SOURCE = fileURLToPath(new URL('../src/bundler/index.ts', import.meta.url))

// un exemple d'une valeur du type donné ; un type qu'aucune donnée JSON ne porte (fonction, classe) lève avec son nom
function sample(checker: ts.TypeChecker, type: ts.Type, at: ts.Node, depth: number): unknown {
  const shown = checker.typeToString(type)
  if (depth > 8) throw new Error(`type trop profond pour un exemple : ${shown}`)
  if (type.isUnion()) {
    const kept = type.types.filter(t => (t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) === 0)
    return sample(checker, kept[0], at, depth)
  }
  if (type.isStringLiteral() || type.isNumberLiteral()) return type.value
  if (type.flags & ts.TypeFlags.BooleanLiteral) return shown === 'true'
  if (type.flags & ts.TypeFlags.String) return `texte-${depth}`
  if (type.flags & ts.TypeFlags.Number) return 7 + depth
  if (type.flags & ts.TypeFlags.Boolean) return true
  if (type.flags & ts.TypeFlags.BigInt) return 7n
  if (checker.isArrayType(type) || checker.isTupleType(type)) return checker.getTypeArguments(type as ts.TypeReference).map(t => sample(checker, t, at, depth + 1))
  const name = type.getSymbol()?.getName()
  const args = ((type as ts.ObjectType).objectFlags ?? 0) & ts.ObjectFlags.Reference ? checker.getTypeArguments(type as ts.TypeReference) : []
  if (name === 'Set') return new Set([sample(checker, args[0], at, depth + 1)])
  if (name === 'Map') return new Map([[sample(checker, args[0], at, depth + 1), sample(checker, args[1], at, depth + 1)]])
  if ((type.flags & ts.TypeFlags.Object) === 0) throw new Error(`type sans exemple : ${shown}`)
  if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0) return () => shown
  const value: Record<string, unknown> = {}
  for (const info of checker.getIndexInfosOfType(type)) value[`cle-${depth}`] = sample(checker, info.type, at, depth + 1)
  for (const prop of type.getProperties()) {
    const propType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration ?? at)
    // une méthode : la valeur est une instance de classe, que le JSON rend en objet nu
    if (checker.getSignaturesOfType(propType, ts.SignatureKind.Call).length > 0 && prop.valueDeclaration && ts.isMethodSignature(prop.valueDeclaration)) throw new Error(`instance de classe, sans forme JSON : ${shown}`)
    value[prop.name] = sample(checker, propType, at, depth + 1)
  }
  return value
}

// les champs déclarés de CacheEntry, chacun avec son exemple
function cacheEntryFields(): Map<string, unknown> {
  const program = ts.createProgram([SOURCE], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, noEmit: true, skipLibCheck: true })
  const checker = program.getTypeChecker()
  const decl    = program.getSourceFile(SOURCE)!.statements.find((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === 'CacheEntry')
  assert.ok(decl, 'la déclaration de CacheEntry est introuvable dans src/bundler/index.ts')
  const fields = new Map<string, unknown>()
  for (const prop of checker.getTypeAtLocation(decl.name).getProperties()) fields.set(prop.name, sample(checker, checker.getTypeOfSymbolAtLocation(prop, decl), decl, 0))
  return fields
}

describe('cache sur disque : aller-retour JSON de chaque champ de CacheEntry', function () {
  this.timeout(120_000)

  it('chaque champ déclaré revient tel quel du fichier du cache', function () {
    const fields = cacheEntryFields()
    // la liste vient du type : elle n'est jamais vide, et porte les champs que le cache relit à coup sûr
    for (const known of ['hash', 'gen', 'hashedPath', 'importedModules', 'checks', 'tagRefs', 'embeds', 'code', 'mangleGen']) assert.ok(fields.has(known), `champ « ${known} » absent de la lecture du type`)
    const lost: string[] = []
    for (const [field, value] of fields) {
      let back: unknown
      try { back = decodeDiskCache(encodeDiskCache({ [field]: value })) }
      catch (e: any) { lost.push(`${field} : ${e?.message ?? e}`); continue }
      try { assert.deepStrictEqual(back, { [field]: value }) }
      catch { lost.push(`${field} : revient autrement`) }
    }
    assert.deepEqual(lost, [], `champs qui ne survivent pas au fichier du cache :\n${lost.join('\n')}`)
  })

  it('un Set et une Map (fichiers publiés et leurs variantes) gardent leur forme', function () {
    const published = new Map([['/projet/img/logo.png', { name: 'logo-abcde.png', variants: new Set(['logo-abcde-480.webp']) }]])
    assert.deepStrictEqual(decodeDiskCache(encodeDiskCache({ published })), { published })
  })
})
