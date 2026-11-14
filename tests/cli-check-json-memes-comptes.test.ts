// `mjs check --json` rend autant d'entrées que le terminal en montre : la même faute dans trois fichiers donne trois erreurs,
// une par fichier, le même avertissement dans deux fichiers en donne deux, et le même avertissement deux fois sur une même
// ligne d'un fichier (deux champs sans étiquette) en donne deux aussi. Les nombres attendus sont lus dans la sortie de
// `mjs check` sur le même projet : le bilan « N erreurs de compilation », les lignes d'avertissement étiquetées
// `[lint.<type>]`, et le bilan « N avertissement(s) », qui compte les mêmes — celles écrites avant lui, pendant la
// compilation, comprises. `components` ne porte que les composants du projet : ni classe globale, ni module de script, ni partiel

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { componentFiles, diagnosticsOf, type Diagnostic } from '../src/cli/check-json.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const DEUX_STYLES = '<p>x</p>\n<style>\np { color: red }\n</style>\n<style>\np { margin: 0 }\n</style>\n'
const FICHIERS: Record<string, string> = {
  'alpha.mjs':        DEUX_STYLES,
  'beta.mjs':         DEUX_STYLES,
  'gamma.mjs':        DEUX_STYLES,
  'image-un.mjs':     '<img src="a.png">\n',
  'image-deux.mjs':   '<img src="a.png">\n',
  'lien-un.mjs':      '<mjs-nulle-part></mjs-nulle-part>\n<p>un</p>\n',
  'lien-deux.mjs':    '<mjs-nulle-part></mjs-nulle-part>\n<p>deux</p>\n',
  'sain.mjs':         '<p>sain</p>\n',
  // deux champs sans étiquette sur la même ligne : le même avertissement deux fois, mot pour mot
  'champs.mjs':       '<div>\n  <input name="a"><input name="b">\n</div>\n',
  '_entete.mjs':      '<header>entête</header>\n',
  'avec-partiel.mjs': '<@include entete>\n<p>corps</p>\n',
  'Outils.class.mjs': 'class Outils\n  un = -> 1\n',
  'calcul.civet.mjs': 'export double := (n) => n * 2\n',
}

// le même projet, écrit deux fois : chaque commande compile le sien, sans rien devoir au cache de l'autre
function projet(): string {
  const root = mjsTmp('check-json-comptes')
  mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js' }))
  for (const [nom, source] of Object.entries(FICHIERS)) writeFileSync(join(root, 'app', 'modularjs', nom), source)
  return root
}

function check(root: string, ...options: string[]) {
  return spawnSync(join(repoRoot, 'node_modules', '.bin', 'tsx'), [join(repoRoot, 'src', 'cli.ts'), 'check', ...options, '--root', root], { cwd: repoRoot, encoding: 'utf-8', maxBuffer: 1 << 26, env: { ...process.env, NO_COLOR: '1' } })
}

describe('cli.ts — mjs check --json : autant d\'entrées que le terminal', function () {
  this.timeout(180000)

  let lignes: string[]
  let doc: { ok: boolean, components: string[], errors: Diagnostic[], warnings: Diagnostic[] }

  before(() => {
    const texte = check(projet())
    lignes      = (texte.stdout + '\n' + texte.stderr).replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim())
    doc         = JSON.parse(check(projet(), '--json').stdout)
  })

  it('la même erreur dans trois fichiers : trois entrées, une par fichier, le compte du bilan du terminal', () => {
    const bilan = lignes.map((l) => /^❌ (\d+) erreurs? de compilation/.exec(l)).find((m) => m !== null)
    assert.ok(bilan, lignes.join('\n'))
    assert.equal(Number(bilan![1]), 3)
    assert.equal(doc.errors.length, 3, JSON.stringify(doc.errors, null, 2))
    assert.deepEqual(doc.errors.map((e) => e.file).sort(), ['app/modularjs/alpha.mjs', 'app/modularjs/beta.mjs', 'app/modularjs/gamma.mjs'])
    for (const e of doc.errors) assert.match(e.message, /2 balises <style>/)
  })

  it('le même avertissement dans deux fichiers : deux entrées ; par type, les comptes des lignes étiquetées du terminal', () => {
    const parType = (types: (string | null)[]) => {
      const comptes = {} as Record<string, number>
      for (const type of types) if (type !== null) comptes[type] = (comptes[type] ?? 0) + 1
      return comptes
    }
    const terminal = parType(lignes.map((l) => /\[lint\.([A-Za-z0-9]+)\]$/.exec(l)?.[1] ?? null))
    assert.deepEqual(parType(doc.warnings.map((w) => w.type)), terminal, JSON.stringify(doc.warnings, null, 2))
    const liens = doc.warnings.filter((w) => w.type === 'tagAlias').map((w) => w.file).sort()
    assert.deepEqual(liens, ['app/modularjs/lien-deux.mjs', 'app/modularjs/lien-un.mjs'])
    assert.equal(terminal.componentFailure, 3)
  })

  it('le même avertissement deux fois sur une même ligne d\'un fichier : deux lignes au terminal, deux entrées', () => {
    const auTerminal = lignes.filter((l) => /champs \(ligne 2\).*\[lint\.a11y\]$/.test(l))
    assert.equal(auTerminal.length, 2, lignes.join('\n'))
    assert.equal(auTerminal[0], auTerminal[1], 'la même ligne, mot pour mot')
    const entrees = doc.warnings.filter((w) => w.file === 'app/modularjs/champs.mjs')
    assert.equal(entrees.length, 2, JSON.stringify(doc.warnings, null, 2))
    assert.deepEqual(entrees[0], entrees[1])
    assert.equal(entrees[0].line, 2)
  })

  it('le bilan du terminal annonce le nombre du document : chaque ligne d\'avertissement, celles écrites avant lui comprises', () => {
    const etiquetee = (l: string) => /\[lint\.[A-Za-z0-9]+\]$/.test(l)
    const iBilan    = lignes.findIndex((l) => /^⚠️\s+\d+ avertissement\(s\)/.test(l))
    assert.ok(iBilan >= 0, lignes.join('\n'))
    const bilan     = /^⚠️\s+(\d+) avertissement\(s\), dont (\d+) écrits? plus haut :$/.exec(lignes[iBilan])
    assert.ok(bilan, lignes[iBilan])
    assert.equal(Number(bilan![1]), lignes.filter(etiquetee).length, 'le bilan compte chaque ligne d\'avertissement du terminal')
    assert.equal(Number(bilan![1]), doc.warnings.length, 'et le document en rend autant')
    assert.equal(Number(bilan![2]), lignes.filter((l, i) => i < iBilan && etiquetee(l)).length, 'dont celles écrites avant le bilan')
    assert.ok(Number(bilan![2]) >= 4, 'les avertissements d\'accessibilité sont écrits pendant la compilation')
  })

  it('components : les composants du projet qui ont compilé — ni classe globale, ni module de script, ni partiel', () => {
    assert.deepEqual(doc.components, ['avec-partiel', 'champs', 'image-deux', 'image-un', 'lien-deux', 'lien-un', 'sain'])
  })
})

describe('check-json.ts — diagnosticsOf : une entrée par ligne d\'avertissement écrite', () => {
  const ctx   = { root: '/projet', files: new Map<string, string | null>([['champs', '/projet/app/modularjs/champs.mjs']]) }
  const ligne = '[ModularJS] ⚠️  champs (ligne 2) : <input> sans étiquette associée — ajoutez <label for="…">…</label> (ou aria-label="…"). [lint.a11y]'

  it('la même ligne écrite deux fois pendant la compilation : deux entrées', () => {
    const d = diagnosticsOf([{ stream: 'err', text: ligne }, { stream: 'err', text: ligne }], ctx, { errors: [], warnings: [] })
    assert.equal(d.warnings.length, 2, JSON.stringify(d.warnings, null, 2))
    assert.deepEqual(d.warnings[0], d.warnings[1])
    assert.equal(d.warnings[0].file, 'app/modularjs/champs.mjs')
    assert.equal(d.warnings[0].line, 2)
  })

  it('une ligne écrite pendant la compilation, la même au bilan : le terminal écrit les deux, le document aussi', () => {
    const d = diagnosticsOf([{ stream: 'err', text: ligne }], ctx, { errors: [], warnings: [ligne] })
    assert.equal(d.warnings.length, 2, JSON.stringify(d.warnings, null, 2))
  })

  it('sans résultat de compilation, un refus écrit deux fois reste une seule erreur', () => {
    const refus = '❌ [mjs] racine du projet introuvable (pas un dossier) : /nulle/part'
    const d     = diagnosticsOf([{ stream: 'err', text: refus }, { stream: 'err', text: refus }], ctx)
    assert.equal(d.errors.length, 1, JSON.stringify(d.errors, null, 2))
    assert.deepEqual(d.warnings, [])
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// LE BILAN DU TERMINAL : APRÈS LA DERNIÈRE LIGNE, ERREURS ET AVERTISSEMENTS COMPTÉS CHACUN PAR CE QUI EST ÉCRIT
// ---------------------------------------------------------------------------------------------------------------------

// un projet aux fichiers donnés (noms depuis le dossier source), avec des réglages de plus dans mjs.config.json
function projetDe(fichiers: Record<string, string>, config: Record<string, unknown> = {}): string {
  const root = mjsTmp('check-bilan')
  mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', ...config }))
  for (const [nom, source] of Object.entries(fichiers)) writeFileSync(join(root, 'app', 'modularjs', nom), source)
  return root
}

function build(root: string) {
  return spawnSync(join(repoRoot, 'node_modules', '.bin', 'tsx'), [join(repoRoot, 'src', 'cli.ts'), 'build', '--root', root], { cwd: repoRoot, encoding: 'utf-8', maxBuffer: 1 << 26, env: { ...process.env, NO_COLOR: '1' } })
}

// la sortie d'erreur du terminal : son bilan (« N avertissement(s), dont K écrit(s) plus haut »), le nombre de lignes d'un type écrites avant lui, après lui
const BILAN_RE = /(\d+) avertissement\(s\)(?:, dont (\d+) écrits? plus haut)? :$/
function terminal(stderr: string) {
  const lignes   = stderr.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean)
  const i        = lignes.findIndex((l) => BILAN_RE.test(l))
  const m        = i < 0 ? null : BILAN_RE.exec(lignes[i])
  const etiquete = (l: string, type: string) => l.endsWith(`[lint.${type}]`)
  return { bilan: m ? { nb: Number(m[1]), plusHaut: Number(m[2] ?? 0) } : null, avant: (type: string) => lignes.filter((l, j) => (i < 0 || j < i) && etiquete(l, type)).length, apres: (type: string) => (i < 0 ? 0 : lignes.filter((l, j) => j > i && etiquete(l, type)).length) }
}

describe('cli.ts — mjs check au-delà de 40 composants : le bilan s\'écrit après la dernière ligne des fils d\'exécution', function () {
  this.timeout(300000)

  // chaque composant : une balise inconnue (une ligne de la liste du bilan) et deux champs sans étiquette (deux lignes écrites pendant la compilation, par le fil d'exécution qui le compile)
  const SOURCE = '<div>\n  <mjs-nulle-part></mjs-nulle-part>\n  <input name="a"><input name="b">\n</div>\n'
  const NB     = 48
  let root: string

  before(() => {
    root = projetDe(Object.fromEntries(Array.from({ length: NB }, (_, i) => [`c${String(i).padStart(3, '0')}.mjs`, SOURCE])))
  })

  for (const passage of [1, 2, 3]) {
    it(`passage ${passage} : aucune ligne d'un fil après le bilan, qui annonce toutes les lignes écrites`, () => {
      const t = terminal(check(root).stderr)
      assert.equal(t.apres('a11y'), 0, 'lignes des fils d\'exécution écrites après le bilan')
      assert.equal(t.avant('a11y'), 2 * NB)
      assert.equal(t.apres('tagAlias'), NB)
      assert.deepEqual(t.bilan, { nb: 3 * NB, plusHaut: 2 * NB })
    })
  }

  it('le document de --json porte le nombre d\'avertissements que le bilan annonce', () => {
    assert.equal(JSON.parse(check(root, '--json').stdout).warnings.length, 3 * NB)
  })
})

describe('cli.ts — "lint": { "emptyComponent": "error" } : l\'erreur étiquetée est une erreur, jamais un avertissement du bilan', function () {
  this.timeout(240000)

  const CONFIG = { lint: { emptyComponent: 'error' } }
  const NOPE   = '<div>\n  <mjs-nulle-part></mjs-nulle-part>\n</div>\n'
  const CHAMP  = '<div>\n  <input name="a">\n</div>\n'
  const UNE    = { 'vide.mjs': '', 'a.mjs': NOPE }
  const DEUX   = { 'vide.mjs': '', 'creux.mjs': '', 'a.mjs': NOPE, 'b.mjs': CHAMP }

  it('une erreur étiquetée et un avertissement : « 1 erreur », « 1 avertissement(s) », autant dans le document', () => {
    const sortie = check(projetDe(UNE, CONFIG))
    assert.equal(sortie.status, 1)
    assert.match(sortie.stderr, /1 erreur de compilation/)
    assert.deepEqual(terminal(sortie.stderr).bilan, { nb: 1, plusHaut: 0 })
    const doc = JSON.parse(check(projetDe(UNE, CONFIG), '--json').stdout)
    assert.deepEqual([doc.errors.map((e: Diagnostic) => e.type), doc.warnings.map((w: Diagnostic) => w.type)], [['emptyComponent'], ['tagAlias']])
  })

  it('deux erreurs étiquetées, un avertissement écrit pendant la compilation, un au bilan : « 2 avertissement(s), dont 1 écrit plus haut »', () => {
    const sortie = check(projetDe(DEUX, CONFIG))
    assert.match(sortie.stderr, /2 erreurs de compilation/)
    assert.deepEqual(terminal(sortie.stderr).bilan, { nb: 2, plusHaut: 1 })
    const doc = JSON.parse(check(projetDe(DEUX, CONFIG), '--json').stdout)
    assert.deepEqual([doc.errors.length, doc.warnings.length], [2, 2])
  })

  it('mjs build écrit le même bilan que mjs check', () => {
    assert.deepEqual(terminal(build(projetDe(DEUX, CONFIG)).stderr).bilan, { nb: 2, plusHaut: 1 })
  })

  it('le même composant sans HTML en avertissement (défaut) compte au bilan ; coupé ("emptyComponent": false), il n\'y compte plus', () => {
    assert.deepEqual(terminal(check(projetDe(UNE)).stderr).bilan, { nb: 2, plusHaut: 0 })
    assert.deepEqual(terminal(check(projetDe(UNE, { lint: { emptyComponent: false } })).stderr).bilan, { nb: 1, plusHaut: 0 })
  })
})

describe('mjs check --json — un modèle en fichier est un composant du projet', function () {
  this.timeout(180000)

  const CHAMP = '<div>\n  <input name="a">\n</div>\n'

  it('components le porte sous le nom de son composant, son avertissement nomme son fichier', () => {
    const doc = JSON.parse(check(projetDe({ 'carte.mjs': '<p>carte</p>\n', 'carte.compacte.mjs': CHAMP, 'carte.large.page.mjs': CHAMP }), '--json').stdout)
    assert.deepEqual(doc.components, ['carte', 'carte--compacte', 'carte--large'])
    assert.deepEqual(doc.warnings.map((w: Diagnostic) => `${w.type} ${w.file}:${w.line}`).sort(), ['a11y app/modularjs/carte.compacte.mjs:2', 'a11y app/modularjs/carte.large.page.mjs:2'])
  })

  it('componentFiles : le nom que la construction donne au modèle ; ni modèle nommé « default », ni modèle sans son composant, ni règles, thème, effets, classe, module', () => {
    const root = projetDe({ 'carte.mjs': '<p>carte</p>\n', 'carte.compacte.mjs': CHAMP, 'carte.large.page.mjs': CHAMP, 'carte.default.mjs': CHAMP, 'seule.compacte.mjs': CHAMP, 'app.types.mjs': '', 'clair.theme.mjs': '', 'app.effects.mjs': '', 'Outils.class.mjs': 'class Outils\n  un = -> 1\n', 'calcul.civet.mjs': 'export double := (n) => n * 2\n' })
    const noms = componentFiles(join(root, 'app', 'modularjs'))
    assert.deepEqual([...noms.keys()].sort(), ['carte', 'carte--compacte', 'carte--large'])
    assert.equal(noms.get('carte--large'), join(root, 'app', 'modularjs', 'carte.large.page.mjs'))
  })
})
