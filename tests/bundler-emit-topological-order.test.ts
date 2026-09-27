// Verrou de comportement — émission topologique de emitPendingUnits()/emitSingleFile()
// (src/bundler/index.ts) : la boucle de Kahn re-parcourt TOUTE la file d'unités 'cold' à
// chaque ronde tant qu'au moins une a progressé, un schéma O(n²) sur une longue chaîne de
// dépendances (chaque ronde ne résout qu'une seule unité de plus dans le pire cas).
//
// Ces tests figent l'ordre d'émission OBSERVABLE (position = ordre alphabétique des stems,
// celui que sortedPending impose déjà), la détection de cycle et la cascade d'erreur d'une
// unité en échec au milieu d'une chaîne — AVANT toute optimisation de la boucle elle-même,
// pour qu'une réécriture en tri topologique linéaire puisse s'y mesurer sans changer une
// seule sortie observable.
//
// Le tri topologique qui a remplacé cette boucle O(n²) calcule un numéro de « ronde » par
// parcours en profondeur — un premier passage l'a implémenté avec la pile d'appels JS ELLE-MÊME
// (récursion), qui plonge à une profondeur proportionnelle au nombre d'unités sur une longue
// chaîne dont l'ordre alphabétique s'oppose à l'ordre de dépendance (le pire cas ci-dessus,
// justement) : `RangeError: Maximum call stack size exceeded` au-delà de quelques milliers
// d'unités, un échec total et silencieux de TOUT le tour de compilation, avec un message qui ne
// nomme aucune unité — pire que la boucle O(n²) remplacée, qui n'avait elle aucune limite de
// profondeur. Fix : pile EXPLICITE (tableau JS), aucune récursion — le test de volumétrie
// ci-dessous verrouille l'absence de toute limite de profondeur.
//
// Accès direct à emitPendingUnits()/emitSingleFile()/pendingUnits (membres TypeScript
// `private`, sans effet au runtime) : même méthode que bundler-dep-digest-racy-window.test.ts
// et bundler-ujsform-wiring.test.ts pour bundler.cache.

import assert from 'node:assert/strict'
import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

after(async () => { await terminateSharedWorkerPool() })

/** Unité 'cold' synthétique — `code` référence le REPÈRE (même forme que
 *  extractPlaceholderDeps/resolvePlaceholders) de chaque dépendance de `deps`, plus, si
 *  fourni, un repère `phantom` qui ne correspond à AUCUNE unité ni entrée initiale de
 *  finalPaths : il ne se résout donc JAMAIS, simulant une unité qui échoue à l'émission. */
function coldUnit(bundler: any, stem: string, deps: string[], phantom?: string): any {
  const imports = deps.map(d => `import '${bundler.placeholderPath(d, '.js')}'`).join('\n')
  const phantomLine = phantom ? `\nconst _p = '${bundler.placeholderPath(phantom, '.js')}'` : ''
  return {
    kind: 'cold',
    file: `/fake/${stem}.civet`,
    stem,
    ext: '.js',
    code: `${imports}\nexport const marker = '${stem}'${phantomLine}\n`,
    deps,
    features: [],
  }
}

function projet(prefix: string, opts: Record<string, unknown> = {}) {
  const root    = mjsTmp(prefix)
  const outDir  = join(root, 'out')
  mkdirSync(outDir, { recursive: true })
  const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...opts }) as any
  mkdirSync(bundler.sourceDir, { recursive: true })
  return bundler
}

/** Espionne writeHashed() (méthode publique) : rend le tableau des stems dans l'ordre RÉEL
 *  d'appel, sans perturber son comportement (délègue à l'original). */
function espionneEcriture(bundler: any): string[] {
  const ordre = [] as string[]
  const original = bundler.writeHashed.bind(bundler)
  bundler.writeHashed = (baseName: string, ext: string, content: string, map?: string) => {
    ordre.push(baseName)
    return original(baseName, ext, content, map)
  }
  return ordre
}

/** Même chose côté emitSingleFile() (mode bundle) : bundleVirtualSources.set()
 *  remplace writeHashed() comme point de sortie d'une unité. */
function espionneVirtuel(bundler: any): string[] {
  const ordre = [] as string[]
  const original = bundler.bundleVirtualSources.set.bind(bundler.bundleVirtualSources)
  bundler.bundleVirtualSources.set = (stem: string, code: string) => {
    if (!stem.startsWith('mjs_')) ordre.push(stem)   // ignore core/styles/anims, hors périmètre ici
    return original(stem, code)
  }
  return ordre
}

describe('bundler — ordre d\'émission topologique (emitPendingUnits)', function () {
  it('chaîne a→b→c→d→e (chacun dépend du SUIVANT, jamais résolu dans la même ronde) : ordre e,d,c,b,a', async function () {
    const bundler = projet('emit-topo-chaine')
    bundler.pendingUnits = new Map([
      ['a', coldUnit(bundler, 'a', ['b'])],
      ['b', coldUnit(bundler, 'b', ['c'])],
      ['c', coldUnit(bundler, 'c', ['d'])],
      ['d', coldUnit(bundler, 'd', ['e'])],
      ['e', coldUnit(bundler, 'e', [])],
    ])
    const ordre = espionneEcriture(bundler)
    const errors: Error[] = []
    const result = await bundler.emitPendingUnits(errors, [])
    assert.equal(errors.length, 0, errors.map((e: Error) => e.message).join('\n'))
    assert.equal(result.written, 5)
    assert.deepEqual(ordre, ['e', 'd', 'c', 'b', 'a'],
      'chaque unité ne peut résoudre son unique dépendance qu\'à LA RONDE SUIVANTE (son stem suit le sien) : une résolution par ronde, dans l\'ordre inverse de la chaîne')
  })

  it('diamant a→{b,c}→d (b et c dépendent de d, a dépend des deux) : ordre d,b,c,a', async function () {
    const bundler = projet('emit-topo-diamant')
    bundler.pendingUnits = new Map([
      ['a', coldUnit(bundler, 'a', ['b', 'c'])],
      ['b', coldUnit(bundler, 'b', ['d'])],
      ['c', coldUnit(bundler, 'c', ['d'])],
      ['d', coldUnit(bundler, 'd', [])],
    ])
    const ordre = espionneEcriture(bundler)
    const errors: Error[] = []
    const result = await bundler.emitPendingUnits(errors, [])
    assert.equal(errors.length, 0, errors.map((e: Error) => e.message).join('\n'))
    assert.equal(result.written, 4)
    assert.deepEqual(ordre, ['d', 'b', 'c', 'a'],
      'd résout seul à la 1ère ronde ; b et c (dont le dep d les précède en position) résolvent à la 2e, dans l\'ordre alphabétique ; a à la 3e')
  })

  it('cycle x↔y : aucune écriture, une erreur nommant chaque unité et sa dépendance jamais résolue', async function () {
    const bundler = projet('emit-topo-cycle')
    bundler.pendingUnits = new Map([
      ['x', coldUnit(bundler, 'x', ['y'])],
      ['y', coldUnit(bundler, 'y', ['x'])],
    ])
    const ordre = espionneEcriture(bundler)
    const errors: Error[] = []
    const result = await bundler.emitPendingUnits(errors, [])
    assert.equal(result.written, 0)
    assert.deepEqual(ordre, [], 'un cycle ne doit jamais écrire la moindre unité')
    assert.equal(errors.length, 2, errors.map((e: Error) => e.message).join('\n'))
    const messages = errors.map((e: Error) => e.message).join('\n')
    assert.match(messages, /'x'.*jamais résolue/)
    assert.match(messages, /'y'.*jamais résolue/)
  })

  it('unité en échec AU MILIEU d\'une chaîne (c porte un repère fantôme jamais résolu) : d et e réussissent, c échoue seule, a et b échouent en cascade', async function () {
    const bundler = projet('emit-topo-echec-milieu')
    bundler.pendingUnits = new Map([
      ['a', coldUnit(bundler, 'a', ['b'])],
      ['b', coldUnit(bundler, 'b', ['c'])],
      ['c', coldUnit(bundler, 'c', ['d'], 'fantome-jamais-la')],
      ['d', coldUnit(bundler, 'd', ['e'])],
      ['e', coldUnit(bundler, 'e', [])],
    ])
    const ordre = espionneEcriture(bundler)
    const errors: Error[] = []
    const result = await bundler.emitPendingUnits(errors, [])
    assert.deepEqual(ordre, ['e', 'd'], 'seules d et e (en amont de l\'échec) doivent être écrites')
    assert.equal(result.written, 2)
    assert.equal(errors.length, 3, errors.map((e: Error) => e.message).join('\n'))
    const messages = errors.map((e: Error) => e.message).join('\n')
    assert.match(messages, /'c'.*repère interne encore présent/, `c doit échouer sur son propre repère résiduel :\n${messages}`)
    assert.match(messages, /'b'.*jamais résolue.*\(c\)/, `b doit échouer en cascade, en nommant c :\n${messages}`)
    assert.match(messages, /'a'.*jamais résolue.*\(b\)/, `a doit échouer en cascade, en nommant b :\n${messages}`)
  })
})

describe('bundler — ordre d\'émission topologique (emitSingleFile, mode bundle)', function () {
  it('même chaîne a→b→c→d→e, mode bundle : même ordre e,d,c,b,a (miroir de emitPendingUnits)', async function () {
    const bundler = projet('emit-topo-bundle-chaine', { js: 'bundle' })
    bundler.pendingUnits = new Map([
      ['a', coldUnit(bundler, 'a', ['b'])],
      ['b', coldUnit(bundler, 'b', ['c'])],
      ['c', coldUnit(bundler, 'c', ['d'])],
      ['d', coldUnit(bundler, 'd', ['e'])],
      ['e', coldUnit(bundler, 'e', [])],
    ])
    const ordre = espionneVirtuel(bundler)
    const errors: Error[] = []
    const result = await bundler.emitSingleFile(errors, [])
    assert.equal(errors.length, 0, errors.map((e: Error) => e.message).join('\n'))
    assert.equal(result.written, 5)
    assert.deepEqual(ordre, ['e', 'd', 'c', 'b', 'a'])
  })

  it('unité en échec AU MILIEU d\'une chaîne, mode bundle : d et e réussissent, c échoue seule, a et b en cascade', async function () {
    const bundler = projet('emit-topo-bundle-echec-milieu', { js: 'bundle' })
    bundler.pendingUnits = new Map([
      ['a', coldUnit(bundler, 'a', ['b'])],
      ['b', coldUnit(bundler, 'b', ['c'])],
      ['c', coldUnit(bundler, 'c', ['d'], 'fantome-jamais-la')],
      ['d', coldUnit(bundler, 'd', ['e'])],
      ['e', coldUnit(bundler, 'e', [])],
    ])
    const ordre = espionneVirtuel(bundler)
    const errors: Error[] = []
    const result = await bundler.emitSingleFile(errors, [])
    assert.deepEqual(ordre, ['e', 'd'])
    assert.equal(result.written, 2)
    assert.equal(errors.length, 3, errors.map((e: Error) => e.message).join('\n'))
  })

  it('cycle x↔y en mode bundle : aucune unité virtuelle posée, une erreur par unité', async function () {
    const bundler = projet('emit-topo-bundle-cycle', { js: 'bundle' })
    bundler.pendingUnits = new Map([
      ['x', coldUnit(bundler, 'x', ['y'])],
      ['y', coldUnit(bundler, 'y', ['x'])],
    ])
    const ordre = espionneVirtuel(bundler)
    const errors: Error[] = []
    const result = await bundler.emitSingleFile(errors, [])
    assert.equal(result.written, 0)
    assert.deepEqual(ordre, [])
    assert.equal(errors.length, 2, errors.map((e: Error) => e.message).join('\n'))
  })
})

describe('bundler — chaîne longue (300 unités), non-régression fonctionnelle', function () {
  it('300 unités chaînées résolvent TOUTES, dans l\'ordre inverse exact de la chaîne', async function () {
    this.timeout(30000)
    const bundler = projet('emit-topo-longue-chaine')
    const n = 300
    const stems = Array.from({ length: n }, (_, i) => 'u' + String(i).padStart(4, '0'))
    const pending = new Map<string, any>()
    for (let i = 0; i < n; i++) {
      const deps = i < n - 1 ? [stems[i + 1]] : []
      pending.set(stems[i], coldUnit(bundler, stems[i], deps))
    }
    bundler.pendingUnits = pending
    const ordre = espionneEcriture(bundler)
    const errors: Error[] = []
    const result = await bundler.emitPendingUnits(errors, [])
    assert.equal(errors.length, 0, errors.map((e: Error) => e.message).join('\n'))
    assert.equal(result.written, n)
    assert.deepEqual(ordre, [...stems].reverse())
    const fichiers = readdirSync(bundler.outputDir)
    assert.equal(fichiers.length, n, 'un fichier hashé par unité, aucun manquant ni dupliqué')
  })
})

describe('bundler — ordre d\'émission topologique, volumétrie extrême (aucune limite de profondeur)', function () {
  it('20 000 unités chaînées en ordre alphabétique INVERSE de la dépendance : résolvent TOUTES, sans RangeError', async function () {
    this.timeout(120000)
    const bundler = projet('emit-topo-20000')
    const n = 20000
    const stems = Array.from({ length: n }, (_, i) => 'u' + String(i).padStart(5, '0'))
    const pending = new Map<string, any>()
    for (let i = 0; i < n; i++) {
      // u00000 dépend de u00001, qui dépend de u00002, etc. — le stem alphabétiquement PREMIER
      // (visité en premier par emitPendingUnits, cf. sortedPending) plonge donc immédiatement
      // dans la chaîne la plus longue possible : le pire cas pour un parcours récursif.
      const deps = i < n - 1 ? [stems[i + 1]] : []
      pending.set(stems[i], coldUnit(bundler, stems[i], deps))
    }
    bundler.pendingUnits = pending
    const ordre = espionneEcriture(bundler)
    const errors: Error[] = []
    const result = await bundler.emitPendingUnits(errors, [])
    assert.equal(errors.length, 0, errors.map((e: Error) => e.message).join('\n'))
    assert.equal(result.written, n)
    assert.deepEqual(ordre, [...stems].reverse())
  })
})
