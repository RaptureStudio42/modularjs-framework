// `mjs check --json` : la même vérification que `mjs check`, rendue en UN document JSON sur la sortie standard (rien d'autre
// n'y passe) — pour un assistant d'IA ou un outil. Forme stable : `format`, `mjs`, `ok`, `root`, `components`, `errors`,
// `warnings` ; chaque erreur ou avertissement porte `severity`, `type` (le `[lint.<type>]` de la ligne, `null` pour une
// erreur), `file` (relatif à la racine), `line`, `column`, `message` et `fix` (ce qu'il faut écrire, quand le message le dit) ;
// `null` quand le message ne le donne pas. Code de sortie inchangé : 1 dès qu'une erreur, y compris un refus avant compilation

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION  = JSON.parse(spawnSync('node', ['-p', 'JSON.stringify(require("./package.json").version)'], { cwd: repoRoot, encoding: 'utf-8' }).stdout)

const REPORT_KEYS     = ['components', 'errors', 'format', 'mjs', 'ok', 'root', 'warnings']
const DIAGNOSTIC_KEYS = ['column', 'file', 'fix', 'line', 'message', 'severity', 'type']

interface Diagnostic { severity: string, type: string | null, file: string | null, line: number | null, column: number | null, message: string, fix: string | null }

function projet(fichiers: Record<string, string>): string {
  const root = mjsTmp('check-json')
  mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
  for (const [nom, texte] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(root, 'app', 'modularjs', nom)), { recursive: true })
    writeFileSync(join(root, 'app', 'modularjs', nom), texte)
  }
  return root
}

function checkJson(root: string, ...options: string[]) {
  const r    = spawnSync('npx', ['tsx', 'src/cli.ts', 'check', '--json', ...options, '--root', root], { cwd: repoRoot, encoding: 'utf-8' })
  let report = null as any
  try { report = JSON.parse(r.stdout) } catch { /* sortie illisible : assert plus bas */ }
  assert.ok(report !== null, `la sortie standard est un seul document JSON :\n${r.stdout}\n--- stderr ---\n${r.stderr}`)
  return { status: r.status, stderr: r.stderr, report }
}

function forme(d: Diagnostic): void {
  assert.deepEqual(Object.keys(d).sort(), DIAGNOSTIC_KEYS, `clés d'un diagnostic : ${JSON.stringify(d)}`)
  assert.ok(['error', 'warning', 'info'].includes(d.severity))
  assert.equal(typeof d.message, 'string')
  assert.doesNotMatch(d.message, /\x1b\[|\[lint\./, 'message sans couleur ni étiquette')
}

describe('cli.ts — mjs check --json', function () {
  this.timeout(120000)

  it('projet sain : ok, aucune erreur, la forme du rapport, code 0', () => {
    const root               = projet({ 'bon.mjs': '<p>ok</p>\n' })
    const { status, report } = checkJson(root)
    assert.equal(status, 0)
    assert.deepEqual(Object.keys(report).sort(), REPORT_KEYS)
    assert.equal(report.format, 1)
    assert.equal(report.mjs, VERSION)
    assert.equal(report.ok, true)
    assert.equal(report.root, root)
    assert.deepEqual(report.components, ['bon'])
    assert.deepEqual(report.errors, [])
    assert.deepEqual(report.warnings, [])
  })

  describe('un cas par sorte d\'erreur', () => {
    let res: ReturnType<typeof checkJson>
    const find = (liste: Diagnostic[], file: string, type: string | null = null) => liste.find((d) => d.file === file && d.type === type)

    before(() => {
      res = checkJson(projet({
        'casse.mjs': '<p>{if $x}oui</p>\n',
        'vieux.mjs': '<script>\n$n = 0\nµonUrlChange -> 1\n</script>\n<p>{$n}</p>\n',
        'civet.mjs': '<script>\n$a = (\n</script>\n<p>{$a}</p>\n',
        'image.mjs': '<img src="a.png">\n',
        'bon.mjs':   '<p>ok</p>\n',
      }))
    })

    it('code 1, ok faux, les composants compilés listés, chaque diagnostic à la même forme', () => {
      assert.equal(res.status, 1)
      assert.equal(res.report.ok, false)
      assert.deepEqual(res.report.components, ['bon', 'image'])
      for (const d of [...res.report.errors, ...res.report.warnings]) forme(d)
      assert.equal(res.report.errors.length, 3, JSON.stringify(res.report.errors, null, 2))
      for (const d of res.report.errors) assert.equal(d.severity, 'error')
    })

    it('erreur du gabarit (bloc non fermé) : fichier, ligne, et quoi écrire', () => {
      const d = find(res.report.errors, 'app/modularjs/casse.mjs')
      assert.ok(d, JSON.stringify(res.report.errors, null, 2))
      assert.equal(d.line, 1)
      assert.match(d.message, /\{if \$x\}/)
      assert.match(d.fix ?? '', /\{end\}/, `quoi écrire : ${d.fix}`)
    })

    it('erreur du script (crochet inconnu) : la ligne dans le fichier, et le bon nom', () => {
      const d = find(res.report.errors, 'app/modularjs/vieux.mjs')
      assert.ok(d, JSON.stringify(res.report.errors, null, 2))
      assert.equal(d.line, 3)
      assert.equal(d.column, 1)
      assert.equal(d.fix, 'µurlChange')
    })

    it('erreur de syntaxe Civet : la ligne et la colonne dans le fichier', () => {
      const d = find(res.report.errors, 'app/modularjs/civet.mjs')
      assert.ok(d, JSON.stringify(res.report.errors, null, 2))
      assert.equal(d.line, 3)
      assert.equal(d.column, 1)
      assert.match(d.message, /Failed to parse/)
    })

    it('avertissement étiqueté (a11y) : le type, le fichier, la ligne, quoi écrire', () => {
      const d = find(res.report.warnings, 'app/modularjs/image.mjs', 'a11y')
      assert.ok(d, JSON.stringify(res.report.warnings, null, 2))
      assert.equal(d.severity, 'warning')
      assert.equal(d.line, 1)
      assert.match(d.fix ?? '', /alt=/)
    })

    it('avertissement de fin de build (composant en échec) : le type et le fichier du composant', () => {
      const d = find(res.report.warnings, 'app/modularjs/casse.mjs', 'componentFailure')
      assert.ok(d, JSON.stringify(res.report.warnings, null, 2))
      assert.equal(d.line, null)
    })
  })

  it('refus avant compilation (aucun composant) : toujours un document JSON, ok faux, code 1', () => {
    const { status, report } = checkJson(projet({}))
    assert.equal(status, 1)
    assert.equal(report.ok, false)
    assert.deepEqual(report.components, [])
    assert.equal(report.errors.length, 1)
    forme(report.errors[0])
    assert.match(report.errors[0].message, /Aucun composant/)
  })

  it('--json --derived : le classement des dérivées en plus, dans le document', () => {
    const boutique           = '<script>\n$cart = 0\ndailyPrice .= 10\n$total = $cart * dailyPrice\n$double = $cart * 2\n$items = []\n$n = $items.filter((x) -> x > $cart).length\n@hausse = -> dailyPrice = 12\n</script>\n<p>{$total} {$double} {$n}</p>\n'
    const { status, report } = checkJson(projet({ 'boutique.mjs': boutique }), '--derived')
    assert.equal(status, 0)
    const total = report.derived.find((d: { name: string }) => d.name === 'total')
    assert.equal(total.class, 'clock')
    assert.equal(total.file, 'app/modularjs/boutique.mjs')
    assert.match(JSON.stringify(total.reasons), /dailyPrice/, 'la raison nomme la variable ordinaire lue')
    // un calcul simple garde l'ancienne règle : il se refait à sa lecture, moins cher que de suivre ses sources
    const double = report.derived.find((d: { name: string }) => d.name === 'double')
    assert.equal(double.class, 'clock')
    assert.deepEqual(double.reasons, [{ code: 'simple', name: '$double' }])
    assert.equal(report.derived.find((d: { name: string }) => d.name === 'n').class, 'precise')
  })

  it('--json hors de mjs check : dit ignoré', () => {
    const root = projet({ 'bon.mjs': '<p>ok</p>\n' })
    const r    = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--json', '--root', root], { cwd: repoRoot, encoding: 'utf-8' })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stderr, /--json ignoré/)
  })
})

describe('cli.ts — mjs check --json : la faute d\'une page cite son fichier', function () {
  this.timeout(120000)

  it('`accueil.page.mjs` : le fichier tel qu\'écrit, sa ligne et sa colonne', () => {
    const { report } = checkJson(projet({ 'accueil.page.mjs': '<p>a</p>\n<script>\nx = 1\nb = )\n</script>\n' }))
    const d          = report.errors.find((e: Diagnostic) => /Failed to parse/.test(e.message))
    assert.ok(d, JSON.stringify(report.errors))
    assert.deepEqual([d.file, d.line, d.column], ['app/modularjs/accueil.page.mjs', 4, 5], JSON.stringify(d))
    assert.match(d.message, /^accueil\.page\.mjs:4:5 /)
  })
})

describe('cli.ts — mjs check --json : la place écrite d\'une faute, partiel compris', function () {
  this.timeout(180000)

  const cas: Array<{ id: string, fichiers: Record<string, string>, motif: RegExp, attendu: [string, number, number | null] }> = [
    { id: 'code après un <@include> sur sa ligne', fichiers: { 'menu.mjs': '<@include bas><p>{1 + * 2}</p>\n', '_bas.mjs': '<p>b</p>\n' }, motif: /Failed to parse/, attendu: ['app/modularjs/menu.mjs', 1, 23] },
    { id: 'gestionnaire resté ouvert, refusé sur la fermeture du lot', fichiers: { 'menu.mjs': '<script>\n$x = 1\n</script>\n<p>a</p>\n<button @click={$x = 1 +}>b</button>\n' }, motif: /Failed to parse/, attendu: ['app/modularjs/menu.mjs', 5, 25] },
    { id: 'gestionnaire de <@window>', fichiers: { 'menu.mjs': '<script>\n$x = 1\n</script>\n<@window @resize={$x = * 2} />\n' }, motif: /Failed to parse/, attendu: ['app/modularjs/menu.mjs', 4, 24] },
    { id: 'balise mal fermée dans un partiel', fichiers: { 'menu.mjs': '<p>0</p>\n<@include haut>\n', '_haut.mjs': '<p>a</p>\n<div><span>x</div>\n' }, motif: /<span>/, attendu: ['app/modularjs/_haut.mjs', 2, null] },
    { id: 'balise mal fermée dans un partiel d\'un sous-dossier', fichiers: { 'menu.mjs': '<p>0</p>\n<@include sous/haut>\n', 'sous/_haut.mjs': '<p>a</p>\n<div><span>x</div>\n' }, motif: /<span>/, attendu: ['app/modularjs/sous/_haut.mjs', 2, null] },
    { id: 'balise mal fermée dans un partiel d\'un dossier voisin', fichiers: { 'pages/menu.mjs': '<p>0</p>\n<@include ../partiels/haut>\n', 'partiels/_haut.mjs': '<p>a</p>\n<div><span>x</div>\n' }, motif: /<span>/, attendu: ['app/modularjs/partiels/_haut.mjs', 2, null] },
    { id: 'balise ouverte dans le composant, fermante dans le partiel : la première ligne citée', fichiers: { 'menu.mjs': '<p>0</p>\n<div><span>x\n<@include fin>\n', '_fin.mjs': '</div>\n' }, motif: /<span>/, attendu: [null, 2, null] }
  ]
  for (const c of cas) {
    it(`${c.id} : ${c.attendu.join(':')}`, () => {
      const { report } = checkJson(projet(c.fichiers))
      const d          = [...report.errors, ...report.warnings].find((e: Diagnostic) => c.motif.test(e.message))
      assert.ok(d, JSON.stringify(report))
      assert.deepEqual([d.file, d.line, d.column], c.attendu, JSON.stringify(d))
    })
  }
})

describe('cli.ts — mjs check --json : le document entier, le message sans la pile', function () {
  this.timeout(120000)

  it('vers un tube : le document entier, même bien au-delà de 64 Kio', () => {
    const images = Array.from({ length: 400 }, (_, i) => `<img src="image-${i}.png">`).join('\n') + '\n'
    const root   = projet({ 'images.mjs': images })
    const tsx    = join(repoRoot, 'node_modules', '.bin', 'tsx')
    const r      = spawnSync('sh', ['-c', `"${tsx}" src/cli.ts check --json --root "${root}" | cat`], { cwd: repoRoot, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
    let report   = null as any
    try { report = JSON.parse(r.stdout) } catch { /* coupé : assert plus bas */ }
    assert.ok(report !== null, `un document JSON entier : ${r.stdout.length} o reçus, fin : ${JSON.stringify(r.stdout.slice(-60))}`)
    assert.ok(r.stdout.length > 2 * 65536, `le cas essayé dépasse bien deux fois le tampon d'un tube : ${r.stdout.length} car.`)
    assert.equal(report.warnings.length, 400)
  })

  it('mjs.config.json cassé ou à clé inconnue : le message seul, sans la pile, aux sept champs', () => {
    for (const config of ['{', JSON.stringify({ foo: 1 })]) {
      const root = projet({ 'bon.mjs': '<p>ok</p>\n' })
      writeFileSync(join(root, 'mjs.config.json'), config)
      const { status, report } = checkJson(root)
      assert.equal(status, 1)
      assert.equal(report.ok, false)
      assert.equal(report.errors.length, 1, JSON.stringify(report.errors))
      const e = report.errors[0]
      forme(e)
      assert.match(e.message, /^\[mjs\.config\.json\] /, config)
      assert.doesNotMatch(e.message, /^\s+at /m, `aucune ligne de pile : ${e.message}`)
    }
  })
})
