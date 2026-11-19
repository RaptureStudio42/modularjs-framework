// `mjs check` liste toutes les fautes de chaque fichier en échec, pas seulement la première que donne la construction : des
// passes relisent le composant, chaque faute corrigée comme son message le dit. La première listée est celle de la
// construction ; les autres sont celles que la construction donne une fois les précédentes corrigées (prouvé ici en les
// corrigeant à la main, une à une, construction après construction) ; une faute de syntaxe clôt la liste, avec une note ; un
// projet sain ne change pas ; `mjs build` donne toujours la première seule, et son résumé renvoie à `mjs check`. Quand
// `mjs check` ajoute le bloc MJS à un `AGENTS.md` déjà là, une ligne dit comment l'empêcher

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// cinq sortes de fautes d'un passage de la 3.1 à la 4.0 : import par défaut entre accolades, import sur deux lignes (puis sa
// virgule), minuterie, ancienne écriture `@mot` (deux fois), expression qui finit par un opérateur
const FAUTES = ["@import default { d } 'lib/a.civet'", '@import { a,', "  b } 'lib/a.civet'", '<script>', '$x = false', '$a = 1', 'go = -> setTimeout (-> 1), 500', '</script>', '<div @lightDom>x</div>', '<p @disabled={$x}>y</p>', '{if $a ==}z{end}', ''].join('\n')

// ce que le développeur écrit à la lecture de chaque message de la construction (les lignes du fichier gardées)
const CORRECTIONS: [RegExp, (src: string) => string][] = [
  [/un export par défaut se nomme sans accolades/, (s) => s.replace("@import default { d } 'lib/a.civet'", "@import default d 'lib/a.civet'")],
  [/@import écrit sur plusieurs lignes/, (s) => s.replace("@import { a,\n  b } 'lib/a.civet'", "@import { a, b } 'lib/a.civet'\n")],
  [/virgule interdite entre les noms/, (s) => s.replace("@import { a, b } 'lib/a.civet'", "@import { a b } 'lib/a.civet'")],
  [/« setTimeout » est refusé/, (s) => s.replace('setTimeout (-> 1), 500', 'µafter 500, -> 1')],
  [/« @lightDom »/, (s) => s.replace('@lightDom', ':lightDom')],
  [/« @disabled=\{\$x\} »/, (s) => s.replace('@disabled={$x}', ':disabled={$x}')],
  [/finit par l'opérateur « == »/, (s) => s.replace('{if $a ==}', '{if $a}')]
]

function projet(fichiers: Record<string, string>): string {
  const root = mjsTmp('check-toutes')
  for (const [nom, texte] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(root, nom)), { recursive: true })
    writeFileSync(join(root, nom), texte)
  }
  return root
}

function mjs(root: string, ...args: string[]) {
  const r = spawnSync('npx', ['tsx', 'src/cli.ts', ...args, '--root', root], { cwd: repoRoot, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } })
  return { status: r.status, out: r.stdout, err: r.stderr }
}

// les fautes d'un fichier dans une sortie : `[bundler] <chemin>: …` jusqu'au bout de la ligne, et ce qui la précède (sa place)
function fautes(sortie: string, fichier: string): { place: string, message: string }[] {
  return sortie.split('\n').filter((l) => l.includes(`[bundler] ${fichier}:`)).map((l) => ({ place: l.slice(0, l.indexOf('[bundler]')).trim(), message: l.slice(l.indexOf('[bundler]')) }))
}

describe('cli.ts — mjs check liste toutes les fautes de chaque fichier', function () {
  this.timeout(240000)

  const sources = { 'app/modularjs/faute.mjs': FAUTES, 'app/modularjs/lib/a.civet': 'export a := 1\nexport b := 2\nexport default 3\n', 'app/modularjs/lib/b.civet': 'export f := -> µafter 1, -> 2\n' }

  it('cinq sortes de fautes : toutes listées, la première est celle de la construction, chaque suivante celle de la construction une fois les précédentes corrigées', () => {
    const root    = projet(sources)
    const fichier = join(root, 'app/modularjs/faute.mjs')
    const check   = mjs(root, 'check')
    assert.equal(check.status, 1)
    const liste = fautes(check.err, fichier)
    assert.equal(liste.length, 7, check.err)
    assert.match(check.err, /app\/modularjs\/faute\.mjs — 7 fautes :/)
    assert.match(check.err, /app\/modularjs\/lib\/b\.civet — 1 faute :/)
    assert.match(check.err, /❌ 8 erreurs de compilation :/)
    assert.match(check.err, /8 fautes dans 2 fichiers, trouvées en 8 passes de compilation\./)
    // la place de chaque faute : sa ligne et sa colonne dans le fichier tel qu'il est
    assert.deepEqual(liste.map((f) => f.place), ['app/modularjs/faute.mjs:1:1', 'app/modularjs/faute.mjs:2:1', 'app/modularjs/faute.mjs:2:1', 'app/modularjs/faute.mjs:7:9', 'app/modularjs/faute.mjs:9:6', 'app/modularjs/faute.mjs:10:4', 'app/modularjs/faute.mjs:11:5'])
    // corrigées à la main, une à une, comme chaque message le dit : la construction donne chaque fois une faute de la liste
    let src     = FAUTES
    const vues  = [] as string[]
    for (let tour = 0; tour < 10; tour++) {
      const build = mjs(root, 'build')
      const une   = fautes(build.err, fichier)
      if (une.length === 0) break
      assert.equal(une.length, 1, 'la construction donne la première faute seule')
      vues.push(une[0].message)
      const correction = CORRECTIONS.find(([re]) => re.test(une[0].message))
      assert.ok(correction, `correction connue pour : ${une[0].message}`)
      src = correction[1](src)
      writeFileSync(fichier, src)
    }
    assert.equal(vues[0], liste[0].message, 'la première listée est celle de la construction')
    assert.deepEqual([...vues].sort(), liste.map((f) => f.message).sort(), 'aucune faute inventée, aucune oubliée')
    assert.equal(readFileSync(fichier, 'utf-8').includes('setTimeout'), false)
  })

  it('--json : les mêmes fautes, avec leur place, et la fin de la liste de chaque fichier', () => {
    const root   = projet(sources)
    const r      = spawnSync('npx', ['tsx', 'src/cli.ts', 'check', '--json', '--root', root], { cwd: repoRoot, encoding: 'utf-8' })
    const report = JSON.parse(r.stdout)
    const miennes = report.errors.filter((e: any) => e.file === 'app/modularjs/faute.mjs')
    assert.equal(miennes.length, 7)
    assert.deepEqual(miennes.map((e: any) => [e.line, e.column]), [[1, 1], [2, 1], [2, 1], [7, 9], [9, 6], [10, 4], [11, 5]])
    assert.ok(miennes.every((e: any) => e.severity === 'error' && e.type === null))
    assert.deepEqual(report.listing, { passes: 8, files: [{ file: 'app/modularjs/faute.mjs', faults: 7, stop: 'complete' }, { file: 'app/modularjs/lib/b.civet', faults: 1, stop: 'unread' }] })
  })

  it('une faute de syntaxe au milieu : la liste s\'arrête là, avec la note', () => {
    // les directives se lisent avant le <script>, le <script> avant le gabarit : la faute du gabarit n'est pas lue
    const root    = projet({ 'app/modularjs/syntaxe.mjs': "@import default { d } 'lib/a.civet'\n<script>\nx := (\n</script>\n<p @disabled={$x}>y</p>\n", 'app/modularjs/lib/a.civet': 'export default 3\n' })
    const fichier = join(root, 'app/modularjs/syntaxe.mjs')
    const check   = mjs(root, 'check')
    const liste   = fautes(check.err, fichier)
    assert.equal(liste.length, 2, check.err)
    assert.match(liste[0].message, /un export par défaut se nomme sans accolades/)
    assert.match(liste[1].message, /Failed to parse/)
    // la place que cite le message du compilateur (la fin inattendue du script, à la ligne du </script>)
    assert.equal(liste[1].place, 'app/modularjs/syntaxe.mjs:4:1')
    assert.doesNotMatch(check.err, /@disabled/)
    assert.match(check.err, /↳ la suite du fichier n'est pas lue : d'autres fautes peuvent suivre celle-ci\. Corrigez-la, puis relancez mjs check\./)
    const json = JSON.parse(spawnSync('npx', ['tsx', 'src/cli.ts', 'check', '--json', '--root', root], { cwd: repoRoot, encoding: 'utf-8' }).stdout)
    assert.equal(json.listing.files[0].stop, 'unread')
    assert.equal(json.listing.files[0].faults, 2)
    assert.equal(json.listing.passes, 2)
  })

  it('projet sain : rien de changé, ni en texte ni en JSON', () => {
    const root  = projet({ 'app/modularjs/bon.mjs': '<p>ok</p>\n' })
    const check = mjs(root, 'check')
    assert.equal(check.status, 0)
    assert.doesNotMatch(check.err + check.out, /passes? de compilation|fautes? :/)
    const json = JSON.parse(spawnSync('npx', ['tsx', 'src/cli.ts', 'check', '--json', '--root', root], { cwd: repoRoot, encoding: 'utf-8' }).stdout)
    assert.deepEqual(Object.keys(json).sort(), ['components', 'errors', 'format', 'mjs', 'ok', 'root', 'warnings'])
  })

  it('mjs build : la première faute seule, et une ligne qui renvoie à mjs check', () => {
    const root  = projet(sources)
    const build = mjs(root, 'build')
    assert.equal(build.status, 1)
    assert.equal(fautes(build.err, join(root, 'app/modularjs/faute.mjs')).length, 1)
    assert.match(build.err, /👉 mjs check liste toutes les fautes de chaque fichier en échec, et non la première seule\./)
  })

  it('AGENTS.md déjà là : le bloc ajouté le dit, et dit comment l\'empêcher ; rien de plus quand rien ne change', () => {
    const root  = projet({ 'app/modularjs/bon.mjs': '<p>ok</p>\n', 'AGENTS.md': '# Mon appli\n' })
    const une   = mjs(root, 'check')
    assert.match(une.out, /📝 AGENTS\.md : bloc MJS \S+ ajouté en fin de fichier/)
    assert.match(une.out, /Pour que MJS n'écrive plus dans AGENTS\.md, ajoutez-y la ligne « <!-- modularjs-agent-rules: off --> » : le fichier restera tel quel\./)
    const deux = mjs(root, 'check')
    assert.doesNotMatch(deux.out, /AGENTS\.md/)
  })
})
