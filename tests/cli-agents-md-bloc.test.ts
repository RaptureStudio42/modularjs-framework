// Le bloc MJS de l'`AGENTS.md` d'une appli : entre deux marqueurs, il dit aux assistants d'IA la version de MJS installée et
// où lire sa doc. `mjs init` le crée ; `mjs check` et `mjs dev` le rétablissent (version à jour, bloc retiré remis en fin de
// fichier) sans toucher au reste du fichier, à l'octet près. Un fichier dont le bloc est mal fermé (marqueur de début sans
// marqueur de fin, ou l'inverse, ou deux blocs) n'est jamais réécrit : la commande le dit. Sans `AGENTS.md`, `mjs check` et
// `mjs dev` n'en créent pas. Remplacé d'un seul coup, sur la cible : un `AGENTS.md` qui est un lien symbolique (vers
// `CLAUDE.md`) le reste, et deux écrivains en même temps ne perdent jamais le texte de l'auteur

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { AGENTS_BEGIN, AGENTS_END, agentsBlock, syncAgentsMd, upsertAgentsBlock } from '../src/cli/agents-md.js'
import { runInit } from '../src/cli/init.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION  = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version as string

function projet(agents?: string): string {
  const root = mjsTmp('agents-md')
  mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
  writeFileSync(join(root, 'app', 'modularjs', 'hello.mjs'), '<p>bonjour</p>\n')
  if (agents !== undefined) writeFileSync(join(root, 'AGENTS.md'), agents)
  return root
}

function check(root: string) {
  return spawnSync('npx', ['tsx', 'src/cli.ts', 'check', '--root', root], { cwd: repoRoot, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } })
}

function silencieux<T>(fn: () => T): T {
  const log = console.log
  console.log = () => {}
  try { return fn() } finally { console.log = log }
}

function portLibre(): Promise<number> {
  return new Promise((ok, ko) => {
    const s = createServer()
    s.on('error', ko)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => ok(port))
    })
  })
}

const MOI = '# Mes consignes\n\nÉcrivez les commentaires en français.\n'

describe('AGENTS.md : le bloc MJS tenu à jour', function () {
  this.timeout(90000)

  describe('upsertAgentsBlock (le texte seul)', () => {
    const bloc = agentsBlock(VERSION)

    it('le bloc : les deux marqueurs, la version, le chemin de la doc', () => {
      const lignes = bloc.split('\n')
      assert.equal(lignes[0], AGENTS_BEGIN)
      assert.equal(lignes[lignes.length - 1], AGENTS_END)
      assert.ok(bloc.includes(VERSION), 'la version installée')
      assert.ok(bloc.includes('node_modules/modularjs-framework/docs/'), 'le dossier de la doc')
      assert.ok(bloc.includes('llms.txt'), 'le sommaire pour les IA')
    })

    it('création : pas de fichier → le bloc seul', () => {
      const r = upsertAgentsBlock(null, bloc)
      assert.equal(r.status, 'created')
      assert.equal(r.status !== 'refused' && r.text, bloc + '\n')
    })

    it('fichier sans bloc → bloc ajouté en fin, le reste intact à l\'octet près', () => {
      const r = upsertAgentsBlock(MOI, bloc)
      assert.equal(r.status, 'added')
      assert.ok(r.status !== 'refused' && r.text.startsWith(MOI), 'le texte d\'origine est un préfixe intact')
      assert.equal(r.status !== 'refused' && r.text, MOI + '\n' + bloc + '\n')
      const sansFin = upsertAgentsBlock('# Titre', bloc)
      assert.equal(sansFin.status !== 'refused' && sansFin.text, '# Titre\n\n' + bloc + '\n', 'dernière ligne sans saut de ligne : il est ajouté')
    })

    it('mise à jour : seul l\'intérieur des marqueurs change ; à jour → inchangé', () => {
      const avant = 'haut\n' + agentsBlock('0.0.1') + '\nbas\n'
      const r     = upsertAgentsBlock(avant, bloc)
      assert.equal(r.status, 'updated')
      assert.equal(r.status !== 'refused' && r.text, 'haut\n' + bloc + '\nbas\n')
      const encore = upsertAgentsBlock(r.status !== 'refused' ? r.text : '', bloc)
      assert.equal(encore.status, 'unchanged')
    })

    it('fins de ligne Windows gardées', () => {
      const avant = 'haut\r\n' + agentsBlock('0.0.1').split('\n').join('\r\n') + '\r\nbas\r\n'
      const r     = upsertAgentsBlock(avant, bloc)
      assert.equal(r.status !== 'refused' && r.text, 'haut\r\n' + bloc.split('\n').join('\r\n') + '\r\nbas\r\n')
    })

    it('fichier sans marqueur de fin, sans marqueur de début, ou à deux blocs → refusé, la ligne nommée', () => {
      const fin = upsertAgentsBlock('a\n' + AGENTS_BEGIN + '\nb\n', bloc)
      assert.deepEqual(fin, { status: 'refused', reason: 'missing-end', line: 2 })
      const debut = upsertAgentsBlock('a\nb\n' + AGENTS_END + '\n', bloc)
      assert.deepEqual(debut, { status: 'refused', reason: 'missing-begin', line: 3 })
      const deux = upsertAgentsBlock(bloc + '\n' + bloc + '\n', bloc)
      assert.equal(deux.status, 'refused')
      const inverse = upsertAgentsBlock(AGENTS_END + '\n' + AGENTS_BEGIN + '\n', bloc)
      assert.equal(inverse.status, 'refused')
    })

    it('un marqueur cité dans une phrase n\'est pas un marqueur', () => {
      const cite = 'Le bloc commence par `' + AGENTS_BEGIN + '`.\n'
      const r    = upsertAgentsBlock(cite, bloc)
      assert.equal(r.status, 'added')
    })
  })

  it('mjs init : crée AGENTS.md avec le bloc ; un AGENTS.md à soi reçoit le bloc en fin', () => {
    const vide = mjsTmp('agents-init')
    silencieux(() => runInit(vide))
    assert.equal(readFileSync(join(vide, 'AGENTS.md'), 'utf8'), agentsBlock(VERSION) + '\n')
    const plein = mjsTmp('agents-init-plein')
    writeFileSync(join(plein, 'AGENTS.md'), MOI)
    silencieux(() => runInit(plein))
    assert.equal(readFileSync(join(plein, 'AGENTS.md'), 'utf8'), MOI + '\n' + agentsBlock(VERSION) + '\n')
  })

  it('mjs check : met à jour une version périmée sans toucher au reste', () => {
    const root = projet(MOI + '\n' + agentsBlock('0.0.1') + '\n\n## Après le bloc\n')
    const r    = check(root)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), MOI + '\n' + agentsBlock(VERSION) + '\n\n## Après le bloc\n')
    assert.match(r.stdout, /AGENTS\.md/, 'la commande dit ce qu\'elle a écrit')
  })

  it('mjs check : remet le bloc retiré, à la fin', () => {
    const root = projet(MOI)
    assert.equal(check(root).status, 0)
    assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), MOI + '\n' + agentsBlock(VERSION) + '\n')
  })

  it('mjs check : marqueur de fin absent → fichier intact, avertissement qui nomme la ligne', () => {
    const casse = MOI + AGENTS_BEGIN + '\nMJS 0.0.1\n## La suite à moi\n'
    const root  = projet(casse)
    const r     = check(root)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), casse, 'rien n\'est réécrit')
    assert.match(r.stderr, /AGENTS\.md/)
    assert.match(r.stderr, /ligne 4/, `la ligne du marqueur de début :\n${r.stderr}`)
  })

  it('mjs check : sans AGENTS.md, n\'en crée pas', () => {
    const root = projet()
    assert.equal(check(root).status, 0)
    assert.equal(existsSync(join(root, 'AGENTS.md')), false)
  })

  it('mjs check : AGENTS.md lien symbolique vers CLAUDE.md → le lien reste, la cible reçoit le bloc', () => {
    const root = projet()
    writeFileSync(join(root, 'CLAUDE.md'), MOI)
    symlinkSync('CLAUDE.md', join(root, 'AGENTS.md'))
    assert.equal(check(root).status, 0)
    assert.ok(lstatSync(join(root, 'AGENTS.md')).isSymbolicLink(), 'AGENTS.md est toujours un lien')
    assert.equal(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), MOI + '\n' + agentsBlock(VERSION) + '\n')
  })

  it('mjs dev : met le bloc à jour au démarrage', async () => {
    const root  = projet(agentsBlock('0.0.1') + '\n')
    const port  = await portLibre()
    const child = spawn(join(repoRoot, 'node_modules', '.bin', 'tsx'), [join(repoRoot, 'src', 'cli.ts'), 'dev', '--root', root, '--port', String(port)], { cwd: repoRoot, env: { ...process.env, NO_COLOR: '1' }, stdio: 'ignore' })
    try {
      const fin = Date.now() + 60000
      while (Date.now() < fin && !readFileSync(join(root, 'AGENTS.md'), 'utf8').includes(VERSION)) await new Promise((r) => setTimeout(r, 200))
      assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), agentsBlock(VERSION) + '\n')
    }
    finally {
      child.kill('SIGTERM')
      await new Promise((r) => child.once('exit', r))
    }
  })
})

// l'écriture du bloc ne perd jamais le texte de l'auteur : la cible (d'un lien, s'il en est un) est remplacée d'un seul coup,
// relue juste avant ; le BOM et les fins de ligne du fichier restent les siens
describe('AGENTS.md : écriture sûre (BOM, fins de ligne, relecture, écrivains concurrents)', function () {
  this.timeout(120000)

  const vieux = agentsBlock('0.0.1')
  const bloc  = agentsBlock('9.9.9')
  const tmps  = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.tmp'))

  it('un BOM en tête est gardé, que le bloc soit en tête ou non', () => {
    const r1 = upsertAgentsBlock('\ufeff' + vieux + '\n\n# Consignes\n', bloc) as { status: string, text: string }
    assert.equal(r1.status, 'updated')
    assert.equal(r1.text, '\ufeff' + bloc + '\n\n# Consignes\n')
    const r2 = upsertAgentsBlock('\ufeff# Consignes\n', bloc) as { status: string, text: string }
    assert.equal(r2.text, '\ufeff# Consignes\n\n' + bloc + '\n')
  })

  it('les fins de ligne du fichier : une ligne CRLF dans un fichier LF ne met pas le bloc en CRLF', () => {
    const mele = '# A\nligne windows\r\n# B\n'
    assert.equal((upsertAgentsBlock(mele, bloc) as { text: string }).text, mele + '\n' + bloc + '\n')
    const windows = '# A\r\nune ligne unix\n# B\r\nfin\r\n'
    assert.equal((upsertAgentsBlock(windows, bloc) as { text: string }).text, windows + '\r\n' + bloc.split('\n').join('\r\n') + '\r\n')
  })

  it('le fichier a changé depuis la lecture : rien n\'est écrit, aucun fichier temporaire laissé', async () => {
    const mod  = await import('../src/cli/agents-md.js') as Record<string, unknown>
    assert.equal(typeof mod.writeAgentsFile, 'function', 'writeAgentsFile exportée')
    const root = projet(MOI + 'écrit par l\'auteur pendant la mise à jour\n')
    const r    = (mod.writeAgentsFile as (p: string, lu: string | null, texte: string) => string)(join(root, 'AGENTS.md'), MOI, MOI + '\n' + bloc + '\n')
    assert.equal(r, 'changed')
    assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), MOI + 'écrit par l\'auteur pendant la mise à jour\n')
    assert.deepEqual(tmps(root), [])
  })

  it('deux écrivains en même temps (mjs check contre mjs dev) : le texte de l\'auteur reste, un seul bloc', async () => {
    const root   = projet(MOI + 'NE PAS PERDRE\n\n' + vieux + '\n')
    const script = join(mjsTmp('agents-course'), 'course.mts')
    writeFileSync(script, [
      'const [, , module, dir, version, tours, depart] = process.argv',
      'const { syncAgentsMd } = await import(module)',
      'console.log = () => {}',
      'console.warn = () => {}',
      'while (Date.now() < Number(depart)) { /* départ commun */ }',
      'for (let i = 0; i < Number(tours); i++) syncAgentsMd(dir, { create: false, version })',
    ].join('\n') + '\n')
    const depart = String(Date.now() + 6000)
    const tsx    = join(repoRoot, 'node_modules', '.bin', 'tsx')
    const module = join(repoRoot, 'src', 'cli', 'agents-md.ts')
    const fils   = ['1.0.0', '2.0.0'].map((v) => spawn(tsx, [script, module, root, v, '4000', depart], { cwd: repoRoot, stdio: 'ignore' }))
    const codes  = await Promise.all(fils.map((f) => new Promise((ok) => f.once('exit', ok))))
    assert.deepEqual(codes, [0, 0])
    const texte = readFileSync(join(root, 'AGENTS.md'), 'utf8')
    assert.ok(texte.startsWith(MOI + 'NE PAS PERDRE\n\n'), `le texte de l'auteur reste en tête : ${JSON.stringify(texte.slice(0, 120))}`)
    assert.equal(texte.split(AGENTS_BEGIN).length - 1, 1, 'un seul bloc')
    assert.deepEqual(tmps(root), [])
  })

  it('lien symbolique : la cible est remplacée d\'un coup, le lien reste un lien, ses droits restent les siens', () => {
    const root = projet()
    writeFileSync(join(root, 'CLAUDE.md'), MOI)
    chmodSync(join(root, 'CLAUDE.md'), 0o640)
    symlinkSync('CLAUDE.md', join(root, 'AGENTS.md'))
    assert.equal(silencieux(() => syncAgentsMd(root, { create: false, version: '9.9.9' })), 'added')
    assert.ok(lstatSync(join(root, 'AGENTS.md')).isSymbolicLink(), 'AGENTS.md est toujours un lien')
    assert.equal(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), MOI + '\n' + bloc + '\n')
    assert.equal(statSync(join(root, 'CLAUDE.md')).mode & 0o777, 0o640)
    assert.deepEqual(tmps(root), [])
  })

  it('un fichier en lecture seule, ou à plusieurs liens physiques, n\'est pas remplacé', () => {
    const seul = projet(MOI + '\n' + vieux + '\n')
    chmodSync(join(seul, 'AGENTS.md'), 0o444)
    try {
      assert.equal(silencieux(() => syncAgentsMd(seul, { create: false, version: '9.9.9' })), 'error')
      assert.equal(readFileSync(join(seul, 'AGENTS.md'), 'utf8'), MOI + '\n' + vieux + '\n')
    }
    finally {
      chmodSync(join(seul, 'AGENTS.md'), 0o644)
    }
    const double = projet(MOI + '\n' + vieux + '\n')
    linkSync(join(double, 'AGENTS.md'), join(double, 'CLAUDE.md'))
    assert.equal(silencieux(() => syncAgentsMd(double, { create: false, version: '9.9.9' })), 'refused')
    assert.equal(readFileSync(join(double, 'AGENTS.md'), 'utf8'), MOI + '\n' + vieux + '\n')
    assert.equal(statSync(join(double, 'AGENTS.md')).nlink, 2, 'les deux noms restent le même fichier')
  })
})
