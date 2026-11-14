// Ce que ce test garantit : la ligne `<!-- modularjs-agent-rules: off -->`, écrite dans `AGENTS.md`, retire ce fichier à MJS.
// Aucune commande n'y écrit plus (`mjs init`, `mjs dev`, `mjs check`) : le bloc MJS n'est ni ajouté, ni mis à jour, ni retiré, un
// bloc déjà là reste tel quel à l'octet près. La ligne compte où qu'elle soit (dans une phrase, dans un bloc de code), sans égard
// à la casse ni aux espaces. La commande le dit en une ligne, sans erreur ni avertissement ; `mjs check --json` n'en porte aucune
// trace. Les refus d'avant demeurent (fichier qui n'est pas en UTF-8, lien qui mène hors du projet). Sans la ligne, rien ne change.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { AGENTS_BEGIN, AGENTS_END, agentsBlock, syncAgentsMd } from '../src/cli/agents-md.js'
import { runInit } from '../src/cli/init.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION  = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version as string
const OFF      = '<!-- modularjs-agent-rules: off -->'
const PERIME   = AGENTS_BEGIN + '\nun bloc d\'une autre version\n' + AGENTS_END + '\n'

// ce qu'une fonction écrit par console.log et par console.warn, et ce qu'elle rend
function dit<T>(fn: () => T): { rendu: T, log: string[], warn: string[] } {
  const saved = { log: console.log, warn: console.warn }
  const log   = [] as string[]
  const warn  = [] as string[]
  console.log  = (...a: unknown[]) => { log.push(a.join(' ')) }
  console.warn = (...a: unknown[]) => { warn.push(a.join(' ')) }
  try { return { rendu: fn(), log, warn } }
  finally { Object.assign(console, saved) }
}

// un projet d'un composant, avec cet AGENTS.md (`null` : sans)
function projet(agents: string | Buffer | null): string {
  const root = mjsTmp('agents-off')
  mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js' }))
  writeFileSync(join(root, 'app', 'modularjs', 'accueil.mjs'), '<p>accueil</p>\n')
  if (agents !== null) writeFileSync(join(root, 'AGENTS.md'), agents)
  return root
}

describe('AGENTS.md — la ligne « modularjs-agent-rules: off » : MJS n\'y touche plus', function () {
  this.timeout(120000)

  const sync = (root: string) => dit(() => syncAgentsMd(root, { create: false, version: VERSION }))
  const lire = (root: string, nom = 'AGENTS.md') => readFileSync(join(root, nom))

  it('sans bloc : rien n\'est ajouté, le fichier reste à l\'octet près ; la commande le dit en une ligne, sans avertissement', () => {
    const texte = '# Mon appli\n\n' + OFF + '\n\nMes consignes.\n'
    const root  = projet(texte)
    const r     = sync(root)
    assert.equal(r.rendu, 'off')
    assert.ok(lire(root).equals(Buffer.from(texte)), 'fichier changé')
    assert.equal(r.log.length, 1, r.log.join('\n'))
    assert.match(r.log[0], /AGENTS\.md laissé tel quel/)
    assert.match(r.log[0], /ligne 3/)
    assert.deepEqual(r.warn, [])
  })

  for (const [cas, texte] of [
    ['un bloc d\'une autre version déjà là', '# Mon appli\n\n' + PERIME + '\n' + OFF + '\n'],
    ['un bloc mal fermé', AGENTS_BEGIN + '\nsans fin\n\n' + OFF + '\n'],
    ['la ligne collée, en majuscules', '<!--MODULARJS-AGENT-RULES:OFF-->\n'],
    ['la ligne entourée d\'espaces, des espaces dedans', '# Titre\n   <!--   modularjs-agent-rules :  Off   -->   \n'],
    ['la ligne dans une phrase', 'Pour couper : `<!-- modularjs-agent-rules: off -->` suffit.\n'],
    ['la ligne dans un bloc de code', '```html\n<!-- modularjs-agent-rules: off -->\n```\n'],
    ['des fins de ligne Windows', '# Mon appli\r\n' + OFF + '\r\n']
  ] as [string, string][]) {
    it(`${cas} : fichier laissé tel quel, à l'octet près, aucun avertissement`, () => {
      const root = projet(texte)
      const r    = sync(root)
      assert.equal(r.rendu, 'off')
      assert.ok(lire(root).equals(Buffer.from(texte)), 'fichier changé')
      assert.deepEqual(r.warn, [])
    })
  }

  for (const [cas, texte] of [['« on » au lieu de « off »', '# Mon appli\n<!-- modularjs-agent-rules: on -->\n'], ['les mots sans le commentaire', '# Mon appli\nmodularjs-agent-rules: off\n']] as [string, string][]) {
    it(`${cas} : ce n'est pas la ligne, le bloc est ajouté comme toujours`, () => {
      const root = projet(texte)
      assert.equal(sync(root).rendu, 'added')
      assert.equal(lire(root).toString('utf8'), texte + '\n' + agentsBlock(VERSION) + '\n')
    })
  }

  it('sans la ligne, rien ne change : le bloc est ajouté en fin de fichier, le reste intact', () => {
    const root = projet('# Mon appli\n')
    assert.equal(sync(root).rendu, 'added')
    assert.equal(lire(root).toString('utf8'), '# Mon appli\n\n' + agentsBlock(VERSION) + '\n')
  })

  it('mjs init : l\'AGENTS.md qui porte la ligne n\'est pas touché, une ligne le dit', () => {
    const texte = '# Mon appli\n' + OFF + '\n'
    const root  = projet(texte)
    const r     = dit(() => runInit(root))
    assert.ok(lire(root).equals(Buffer.from(texte)), 'fichier changé')
    assert.equal(r.log.filter((l) => l.includes('laissé tel quel')).length, 1, r.log.join('\n'))
  })

  it('AGENTS.md lien vers CLAUDE.md, qui porte la ligne : la cible n\'est pas touchée, le lien reste un lien', () => {
    const texte = '# Consignes\n\n' + PERIME + '\n' + OFF + '\n'
    const root  = projet(null)
    writeFileSync(join(root, 'CLAUDE.md'), texte)
    symlinkSync('CLAUDE.md', join(root, 'AGENTS.md'))
    assert.equal(sync(root).rendu, 'off')
    assert.ok(lire(root, 'CLAUDE.md').equals(Buffer.from(texte)), 'cible changée')
    assert.ok(lstatSync(join(root, 'AGENTS.md')).isSymbolicLink())
  })

  it('un fichier qui n\'est pas en UTF-8, un lien qui mène hors du projet : refusés comme sans la ligne, jamais réécrits', () => {
    const latin = Buffer.from('# Consignes à lire\n' + OFF + '\n', 'latin1')
    const root  = projet(latin)
    const r     = sync(root)
    assert.equal(r.rendu, 'refused')
    assert.match(r.warn.join('\n'), /UTF-8/)
    assert.ok(lire(root).equals(latin), 'fichier changé')
    const dehors = join(mjsTmp('agents-off-dehors'), 'CONSIGNES.md')
    const lie    = projet(null)
    writeFileSync(dehors, '# Partagé\n' + OFF + '\n')
    symlinkSync(dehors, join(lie, 'AGENTS.md'))
    const s = sync(lie)
    assert.equal(s.rendu, 'refused')
    assert.match(s.warn.join('\n'), /hors du projet/)
    assert.equal(readFileSync(dehors, 'utf8'), '# Partagé\n' + OFF + '\n')
  })

  it('mjs check (la commande entière) : code 0, une seule ligne le dit, fichier intact ; --json : ni erreur ni avertissement', () => {
    const texte = '# Mon appli\n\n' + PERIME + '\n' + OFF + '\n'
    const root  = projet(texte)
    const lance = (...options: string[]) => spawnSync(join(repoRoot, 'node_modules', '.bin', 'tsx'), [join(repoRoot, 'src', 'cli.ts'), 'check', ...options, '--root', root], { cwd: repoRoot, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } })
    const sortie = lance()
    assert.equal(sortie.status, 0, sortie.stderr)
    assert.equal(sortie.stdout.split('\n').filter((l) => l.includes('laissé tel quel')).length, 1, sortie.stdout)
    assert.doesNotMatch(sortie.stderr, /AGENTS/)
    const doc = JSON.parse(lance('--json').stdout)
    assert.deepEqual([doc.ok, doc.errors, doc.warnings], [true, [], []])
    assert.ok(lire(root).equals(Buffer.from(texte)), 'fichier changé')
  })
})
