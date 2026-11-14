// `AGENTS.md` : ce que `mjs check`, `mjs dev` et `mjs init` ne font jamais au fichier de l'auteur. Un fichier qui n'est pas en
// UTF-8 (Latin-1, UTF-16) n'est pas touché, pas un octet : décodé puis réécrit, ses accents deviendraient des caractères de
// remplacement. Un lien symbolique qui mène hors du projet n'est pas suivi pour écrire, ni une cible qui n'est pas un fichier
// ordinaire. Des marqueurs cités dans un bloc de code fermé sont un exemple de l'auteur, pas le bloc. Et les commandes que
// donnent le bloc, le serveur MCP et la doc n'installent jamais rien et gardent leurs options : `npx --no -- mjs …` (sans
// `--no`, hors d'un projet où le paquet est installé, npx irait chercher sur npm un paquet nommé « mjs » qui n'est pas
// ModularJS ; sans `--`, npx prend pour lui l'option écrite après le nom de la commande : `npx --no mjs --version` affiche la
// version de npm)

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { AGENTS_BEGIN, AGENTS_END, agentsBlock, syncAgentsMd, upsertAgentsBlock } from '../src/cli/agents-md.js'
import { runInit } from '../src/cli/init.js'
import { en } from '../src/messages/en.js'
import { fr } from '../src/messages/fr.js'
import { setMessagesLang } from '../src/messages/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION  = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version as string

function projet(): string {
  const root = mjsTmp('agents-garde')
  mkdirSync(join(root, 'app', 'modularjs'), { recursive: true })
  writeFileSync(join(root, 'app', 'modularjs', 'hello.mjs'), '<p>bonjour</p>\n')
  return root
}

// ce que la commande rend, et ce qu'elle dit (console.log et console.warn)
function dit<T>(fn: () => T): { rendu: T, lignes: string } {
  const { log, warn } = console
  const lignes        = [] as string[]
  console.log  = (...a: unknown[]) => { lignes.push(a.join(' ')) }
  console.warn = (...a: unknown[]) => { lignes.push(a.join(' ')) }
  try { return { rendu: fn(), lignes: lignes.join('\n') } }
  finally { Object.assign(console, { log, warn }) }
}

describe('AGENTS.md : un fichier qui n\'est pas en UTF-8 n\'est jamais réécrit', function () {
  this.timeout(90000)

  const LATIN1 = Buffer.from('# Consignes\n\nPréférer le français. Coût : 10 francs\n', 'latin1')
  const UTF16  = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('# Règles\r\nÉcrire en français\r\n', 'utf16le')])

  for (const [nom, octets] of [['Latin-1', LATIN1], ['UTF-16 avec BOM', UTF16]] as [string, Buffer][]) {
    it(`${nom} : pas un octet ne change, et la commande dit pourquoi`, () => {
      const root = projet()
      writeFileSync(join(root, 'AGENTS.md'), octets)
      const r = dit(() => syncAgentsMd(root, { create: false, version: VERSION }))
      assert.ok(readFileSync(join(root, 'AGENTS.md')).equals(octets), 'le fichier est intact, à l\'octet près')
      assert.equal(r.rendu, 'refused')
      assert.match(r.lignes, /UTF-8/)
      assert.doesNotMatch(r.lignes, /inchangé/, 'jamais « le reste du fichier est inchangé » quand rien n\'est écrit')
      assert.deepEqual(readdirSync(root).filter((f) => f.endsWith('.tmp')), [], 'aucun fichier temporaire laissé')
    })
  }

  it('mjs init : un AGENTS.md en Latin-1 déjà là reste intact', () => {
    const root = mjsTmp('agents-garde')
    writeFileSync(join(root, 'AGENTS.md'), LATIN1)
    dit(() => runInit(root))
    assert.ok(readFileSync(join(root, 'AGENTS.md')).equals(LATIN1), 'le fichier est intact, à l\'octet près')
  })

  it('mjs check (la commande entière) : fichier intact, avertissement, code 0', () => {
    const root = projet()
    writeFileSync(join(root, 'AGENTS.md'), LATIN1)
    const r = spawnSync(join(repoRoot, 'node_modules', '.bin', 'tsx'), [join(repoRoot, 'src', 'cli.ts'), 'check', '--root', root], { cwd: repoRoot, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } })
    assert.equal(r.status, 0, r.stderr)
    assert.ok(readFileSync(join(root, 'AGENTS.md')).equals(LATIN1), 'le fichier est intact, à l\'octet près')
    assert.match(r.stdout + r.stderr, /AGENTS\.md[^\n]*UTF-8/)
  })

  it('un BOM UTF-8 est gardé : le texte de l\'auteur reste devant le bloc, à l\'octet près', () => {
    const root   = projet()
    const octets = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Règles\n\nÉcrire en français.\n', 'utf-8')])
    writeFileSync(join(root, 'AGENTS.md'), octets)
    const r     = dit(() => syncAgentsMd(root, { create: false, version: VERSION }))
    const apres = readFileSync(join(root, 'AGENTS.md'))
    assert.equal(r.rendu, 'added')
    assert.ok(apres.subarray(0, octets.length).equals(octets), 'BOM et texte de l\'auteur intacts en tête')
    assert.ok(apres.toString('utf-8').includes(AGENTS_BEGIN), 'le bloc est ajouté')
  })

  it('un caractère de remplacement écrit par l\'auteur, en UTF-8 valide, ne fait pas refuser le fichier', () => {
    const root  = projet()
    const texte = '# Notes\n\nCe signe ' + String.fromCharCode(0xfffd) + ' vient d\'un vieux fichier.\n'
    writeFileSync(join(root, 'AGENTS.md'), texte)
    const r = dit(() => syncAgentsMd(root, { create: false, version: VERSION }))
    assert.equal(r.rendu, 'added')
    assert.ok(readFileSync(join(root, 'AGENTS.md'), 'utf-8').startsWith(texte), 'le texte de l\'auteur reste en tête')
  })
})

describe('AGENTS.md : rien n\'est écrit hors de la racine du projet', function () {
  this.timeout(90000)

  it('lien symbolique vers un fichier hors du projet : la cible n\'est pas touchée, la commande le dit', () => {
    const root   = projet()
    const dehors = mjsTmp('agents-dehors')
    const regles = '# Règles communes à tous mes projets\n'
    writeFileSync(join(dehors, 'REGLES.md'), regles)
    symlinkSync(join(dehors, 'REGLES.md'), join(root, 'AGENTS.md'))
    const r = dit(() => syncAgentsMd(root, { create: false, version: VERSION }))
    assert.equal(readFileSync(join(dehors, 'REGLES.md'), 'utf-8'), regles)
    assert.deepEqual(readdirSync(dehors), ['REGLES.md'])
    assert.equal(r.rendu, 'refused')
    assert.match(r.lignes, /hors du projet/)
    assert.ok(lstatSync(join(root, 'AGENTS.md')).isSymbolicLink(), 'le lien reste un lien')
  })

  it('mjs init : la cible d\'un lien cassé qui mène dehors n\'est pas créée', () => {
    const root   = mjsTmp('agents-garde')
    const dehors = mjsTmp('agents-dehors')
    symlinkSync(join(dehors, 'PAS-ENCORE-LA.md'), join(root, 'AGENTS.md'))
    const r = dit(() => runInit(root))
    assert.deepEqual(readdirSync(dehors), [])
    assert.match(r.lignes, /hors du projet/)
  })

  it('par un dossier du projet qui est lui-même un lien vers le dehors : refusé de même', () => {
    const root   = projet()
    const dehors = mjsTmp('agents-dehors')
    writeFileSync(join(dehors, 'X.md'), '# ailleurs\n')
    symlinkSync(dehors, join(root, 'liens'))
    symlinkSync(join('liens', 'X.md'), join(root, 'AGENTS.md'))
    const r = dit(() => syncAgentsMd(root, { create: false, version: VERSION }))
    assert.equal(readFileSync(join(dehors, 'X.md'), 'utf-8'), '# ailleurs\n')
    assert.deepEqual(readdirSync(dehors), ['X.md'])
    assert.equal(r.rendu, 'refused')
    assert.match(r.lignes, /hors du projet/)
  })

  it('lien vers un fichier du projet, même dans un sous-dossier : la cible reçoit le bloc, le lien reste un lien', () => {
    const root = projet()
    mkdirSync(join(root, 'docs'))
    writeFileSync(join(root, 'docs', 'IA.md'), '# Consignes\n')
    symlinkSync(join('docs', 'IA.md'), join(root, 'AGENTS.md'))
    const r     = dit(() => syncAgentsMd(root, { create: false, version: VERSION }))
    const texte = readFileSync(join(root, 'docs', 'IA.md'), 'utf-8')
    assert.equal(r.rendu, 'added')
    assert.ok(texte.startsWith('# Consignes\n') && texte.includes(AGENTS_BEGIN), texte)
    assert.ok(lstatSync(join(root, 'AGENTS.md')).isSymbolicLink(), 'le lien reste un lien')
  })

  it('une cible qui n\'est pas un fichier ordinaire (un dossier, /dev/null) est refusée, sans être lue ni remplacée', function () {
    if (process.platform === 'win32') this.skip()
    const root = projet()
    mkdirSync(join(root, 'docs'))
    symlinkSync('docs', join(root, 'AGENTS.md'))
    const dossier = dit(() => syncAgentsMd(root, { create: false, version: VERSION }))
    assert.equal(dossier.rendu, 'refused')
    assert.match(dossier.lignes, /fichier ordinaire/)
    const autre = projet()
    symlinkSync('/dev/null', join(autre, 'AGENTS.md'))
    const nul = dit(() => syncAgentsMd(autre, { create: false, version: VERSION }))
    assert.equal(nul.rendu, 'refused')
    assert.match(nul.lignes, /hors du projet|fichier ordinaire/)
  })
})

describe('AGENTS.md : des marqueurs cités dans un bloc de code ne sont pas le bloc', () => {
  const bloc    = agentsBlock(VERSION)
  const exemple = (cloture: string) => '# Mes consignes\n\nLe bloc de MJS ressemble à ceci :\n\n' + cloture + 'md\n' + AGENTS_BEGIN + '\n(mon exemple, mes mots à moi)\n' + AGENTS_END + '\n' + cloture + '\n'

  for (const cloture of ['```', '~~~', '````']) {
    it(`exemple de l'auteur entre deux ${cloture} : intact, le bloc est ajouté en fin de fichier, puis laissé tel quel`, () => {
      const avant = exemple(cloture)
      const r     = upsertAgentsBlock(avant, bloc)
      assert.equal(r.status, 'added')
      assert.equal(r.status !== 'refused' && r.text, avant + '\n' + bloc + '\n')
      assert.equal(upsertAgentsBlock(avant + '\n' + bloc + '\n', bloc).status, 'unchanged')
    })
  }

  it('exemple dans un bloc de code, puis le vrai bloc périmé : seul le vrai bloc est mis à jour', () => {
    const r = upsertAgentsBlock(exemple('```') + '\n' + agentsBlock('0.0.1') + '\nfin\n', bloc)
    assert.equal(r.status, 'updated')
    assert.equal(r.status !== 'refused' && r.text, exemple('```') + '\n' + bloc + '\nfin\n')
  })

  it('bloc de code resté ouvert avant le bloc : le bloc reste reconnu, jamais ajouté une seconde fois', () => {
    const r = upsertAgentsBlock('# Notes\n\n```\ncode jamais refermé\n\n' + agentsBlock('0.0.1') + '\n', bloc)
    assert.equal(r.status, 'updated')
    const texte = r.status !== 'refused' ? r.text : ''
    assert.equal(texte.split(AGENTS_BEGIN).length - 1, 1, 'un seul bloc')
    assert.equal(upsertAgentsBlock(texte, bloc).status, 'unchanged')
  })
})

describe('les commandes données aux assistants n\'installent jamais rien et gardent leurs options : npx --no -- mjs', () => {
  afterEach(() => setMessagesLang('fr'))

  // `npx mjs …`, `npx --yes mjs …`, `npx --no mjs …` : tout sauf `npx --no -- mjs …`
  const SANS_GARDE = /npx (?!--no -- mjs\b)(?:-\S+ )*mjs\b/

  it('le bloc de AGENTS.md, en français et en anglais', () => {
    for (const lang of ['fr', 'en']) {
      setMessagesLang(lang)
      const bloc = agentsBlock(VERSION)
      assert.match(bloc, /`npx --no -- mjs check --json`/, lang)
      assert.match(bloc, /`npx --no -- mjs mcp`/, lang)
      assert.doesNotMatch(bloc, SANS_GARDE, lang)
    }
  })

  it('les messages du serveur MCP, lus par les assistants', () => {
    for (const [lang, catalogue] of [['fr', fr], ['en', en]] as [string, Record<string, unknown>][]) {
      for (const [cle, entree] of Object.entries(catalogue)) {
        if (!cle.startsWith('cli.mcp.') && !cle.startsWith('cli.agents-md.')) continue
        const texte = typeof entree === 'function' ? String(entree({})) : String(entree)
        assert.doesNotMatch(texte, SANS_GARDE, `${lang} · ${cle}`)
      }
    }
  })

  it('la doc : aucune page ne donne `npx … mjs` sans `--no --`, la déclaration du serveur MCP non plus', () => {
    const docs   = join(repoRoot, 'docs')
    const fautes = [] as string[]
    for (const f of readdirSync(docs).filter((n) => n.endsWith('.md') || n.endsWith('.txt')).map((n) => join(docs, n))) {
      readFileSync(f, 'utf-8').split('\n').forEach((l, i) => {
        if (SANS_GARDE.test(l) || /"npx", "args": \[(?!"--no", "--", "mjs")/.test(l)) fautes.push(`${basename(f)}:${i + 1} ${l.trim().slice(0, 90)}`)
      })
    }
    assert.deepEqual(fautes, [])
    assert.match(readFileSync(join(docs, '40-travailler-avec-une-ia.md'), 'utf-8'), /"command": "npx", "args": \["--no", "--", "mjs", "mcp"\]/)
  })
})
