// chaque appel de src/ qui passe une clé littérale du catalogue et un objet littéral de variables donne au message toutes les
// variables qu'il lit, en français comme en anglais, et aucune qu'il ne lit pas : MsgVars est un Record<string, …>, une
// variable renommée d'un seul côté ou oubliée à l'appel donnerait un texte faux (« undefined ») sans erreur de compilation.
// Une variable que le message ne lit que sous condition (`x ? … : ''`, `x && …`, valeur par défaut, aide comme `place`
// qui la teste) peut manquer à l'appel ; un objet étalé (`...v`) ou un nom calculé n'est pas lu : l'appel est compté à part

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

interface MessageVars { all: Set<string>, required: Set<string> }
type Catalog = Map<string, MessageVars>

const LOGICAL = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken])

function isPropertyNamePosition(n: ts.Identifier): boolean {
  const p = n.parent
  return (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || (ts.isBindingElement(p) && p.propertyName === n)
}

// paramètre MsgVars d'une fonction du catalogue : ses variables, et celles qu'il lit sans condition
function messageVars(fn: ts.SignatureDeclaration & { body?: ts.Node }, helpers: Map<string, MessageVars>): MessageVars | null {
  const param = fn.parameters[0]
  if (!param || !param.type || param.type.getText() !== 'MsgVars' || !fn.body) return null
  const all      = new Set<string>()
  const required = new Set<string>()
  const locals   = new Map<string, string>()
  if (ts.isObjectBindingPattern(param.name)) {
    for (const e of param.name.elements) {
      const prop = (e.propertyName ?? e.name).getText()
      all.add(prop)
      if (!e.initializer && ts.isIdentifier(e.name)) locals.set(e.name.text, prop)
    }
  }
  // une lecture sans condition : aucun test, aucune branche, aucune fonction interne entre elle et le corps
  const unconditional = (ref: ts.Node): boolean => {
    for (let c: ts.Node = ref, p = ref.parent; p && p !== fn; c = p, p = p.parent) {
      if (ts.isConditionalExpression(p) || ts.isIfStatement(p) || ts.isTypeOfExpression(p) || ts.isFunctionLike(p)) return false
      if (ts.isBinaryExpression(p) && LOGICAL.has(p.operatorToken.kind)) return false
      if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) return false
      if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && helpers.has(p.expression.text) && c !== p.expression) {
        const holder = ref.parent
        const prop   = ts.isShorthandPropertyAssignment(holder) ? holder.name.text : ts.isPropertyAssignment(holder) && holder.initializer === ref ? holder.name.getText() : null
        if (prop === null || !helpers.get(p.expression.text)!.required.has(prop)) return false
      }
    }
    return true
  }
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(param.name) && ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === param.name.text) {
      all.add(n.name.text)
      if (unconditional(n)) required.add(n.name.text)
    }
    else if (ts.isIdentifier(n) && locals.has(n.text) && !isPropertyNamePosition(n) && unconditional(n)) required.add(locals.get(n.text)!)
    ts.forEachChild(n, visit)
  }
  visit(fn.body)
  return { all, required }
}

function readCatalog(file: string): Catalog {
  const sf      = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const out     = new Map<string, MessageVars>()
  const helpers = new Map<string, MessageVars>()
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue
    for (const d of st.declarationList.declarations) {
      if (!d.initializer || !ts.isIdentifier(d.name)) continue
      // `{ … } satisfies Record<…>` : l'objet du catalogue est sous l'expression
      const init = ts.isSatisfiesExpression(d.initializer) || ts.isAsExpression(d.initializer) ? d.initializer.expression : d.initializer
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        const v = messageVars(init, helpers)
        if (v) helpers.set(d.name.text, v)
      }
      else if (ts.isObjectLiteralExpression(init)) {
        for (const p of init.properties) {
          if (!ts.isPropertyAssignment(p) || !ts.isStringLiteral(p.name)) continue
          const entry = p.initializer
          const vars  = ts.isArrowFunction(entry) || ts.isFunctionExpression(entry) ? messageVars(entry, helpers) : null
          out.set(p.name.text, vars ?? { all: new Set(), required: new Set() })
        }
      }
    }
  }
  return out
}

function sources(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) {
      if (f !== 'node_modules' && f !== 'messages') sources(p, out)
    }
    else if (/\.(?:ts|mts|cts)$/.test(f) && !f.endsWith('.d.ts')) out.push(p)
  }
  return out
}

interface Report { checked: number, skipped: number, missing: string[], unknown: string[] }

// appels d'un fichier : clé littérale (ou ternaire de deux clés), puis le premier objet littéral qui la suit ; `t('k')` nu compte
// comme un objet vide
function checkCalls(file: string, text: string, catalogs: Catalog[], report: Report): void {
  const sf     = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const isKey  = (n: ts.Node): boolean => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && catalogs[0].has(n.text)
  const keysOf = (n: ts.Expression): string[] => {
    if (ts.isParenthesizedExpression(n)) return keysOf(n.expression)
    if (isKey(n)) return [(n as ts.StringLiteral).text]
    if (ts.isConditionalExpression(n) && isKey(n.whenTrue) && isKey(n.whenFalse)) return [(n.whenTrue as ts.StringLiteral).text, (n.whenFalse as ts.StringLiteral).text]
    return []
  }
  // aide locale qui ajoute ses variables à celles qu'elle reçoit : `const refuse = (key, …, vars) => t(key, { ...vars, call: … })`
  const wrappers = new Map<string, string[]>()
  const scan = (n: ts.Node): void => {
    const fn   = ts.isVariableDeclaration(n) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) ? n.initializer : ts.isFunctionDeclaration(n) ? n : null
    const name = ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) ? n.name.text : ts.isFunctionDeclaration(n) && n.name ? n.name.text : null
    if (fn && name) {
      const params = new Set(fn.parameters.map(p => p.name.getText()))
      const look = (m: ts.Node): void => {
        if (ts.isObjectLiteralExpression(m) && ts.isCallExpression(m.parent) && ts.isIdentifier(m.parent.expression) && m.parent.expression.text === 't' && m.properties.some(p => ts.isSpreadAssignment(p) && params.has(p.expression.getText()))) {
          wrappers.set(name, m.properties.filter(p => !ts.isSpreadAssignment(p) && p.name !== undefined).map(p => p.name!.getText()))
        }
        ts.forEachChild(m, look)
      }
      look(fn)
    }
    ts.forEachChild(n, scan)
  }
  scan(sf)
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const i = n.arguments.findIndex(a => keysOf(a).length > 0)
      if (i >= 0) {
        const keys  = keysOf(n.arguments[i])
        const after = n.arguments.slice(i + 1)
        const obj   = after.find(ts.isObjectLiteralExpression)
        const added = ts.isIdentifier(n.expression) ? wrappers.get(n.expression.text) : undefined
        const bare  = !obj && (added !== undefined || (after.length === 0 && ts.isIdentifier(n.expression) && n.expression.text === 't'))
        if (obj && obj.properties.some(p => ts.isSpreadAssignment(p) || (p.name !== undefined && ts.isComputedPropertyName(p.name)))) report.skipped++
        else if (obj || bare) {
          report.checked++
          // les variables de trop se comptent sur l'objet de l'appel seul, les deux clés d'un ternaire ensemble
          const own   = (obj?.properties ?? []).map(p => p.name!.getText().replace(/^['"]|['"]$/g, ''))
          const names = new Set([...own, ...(added ?? [])])
          const at    = `${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`
          const read  = new Set<string>()
          for (const key of keys) {
            catalogs.forEach((cat, lang) => {
              const v = cat.get(key)!
              v.all.forEach(x => read.add(x))
              const lost = [...v.required].filter(x => !names.has(x))
              if (lost.length) report.missing.push(`${at} ${key} (${lang === 0 ? 'fr' : 'en'}) : ${lost.join(', ')}`)
            })
          }
          const extra = own.filter(x => !read.has(x))
          if (extra.length) report.unknown.push(`${at} ${keys.join(' | ')} : ${extra.join(', ')}`)
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
}

describe('messages : les variables passées à chaque appel du catalogue', function () {
  this.timeout(120000)
  const catalogs = [readCatalog(join(ROOT, 'src/messages/fr.ts')), readCatalog(join(ROOT, 'src/messages/en.ts'))]
  const report: Report = { checked: 0, skipped: 0, missing: [], unknown: [] }
  for (const f of sources(join(ROOT, 'src'))) checkCalls(f, readFileSync(f, 'utf8'), catalogs, report)

  it('la garde voit une variable qui manque et une variable de trop', () => {
    const key          = [...catalogs[0]].find(([k, v]) => v.required.size > 0 && catalogs[1].get(k)!.required.size > 0)![0]
    const seen: Report = { checked: 0, skipped: 0, missing: [], unknown: [] }
    checkCalls(join(ROOT, 'src/sample.ts'), `t('${key}', { notAVariable: 1 })`, catalogs, seen)
    assert.equal(seen.checked, 1)
    assert.equal(seen.missing.length, 2, 'la variable manque en français et en anglais')
    assert.equal(seen.unknown.length, 1)
  })

  it('la garde lit assez d\'appels pour compter', () => {
    assert.ok(report.checked > 1500, `appels lus : ${report.checked}`)
  })

  it('chaque appel donne au message toutes les variables qu\'il lit sans condition (fr et en)', () => {
    assert.deepEqual(report.missing, [])
  })

  it('aucun appel ne passe une variable que le message ne lit ni en français ni en anglais', () => {
    assert.deepEqual(report.unknown, [])
  })
})
