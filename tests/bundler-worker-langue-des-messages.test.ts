// La langue des messages (clé `lang` de mjs.config.json) vaut AUSSI pour les erreurs de transpilation
// d'un gros projet. Au-delà de 40 fichiers, la transpilation passe par un pool de threads de travail ;
// chaque thread charge son propre exemplaire du catalogue des messages, qui reste en français tant que
// le processus principal ne lui transmet pas la langue : un projet en anglais lisait alors ses erreurs
// de transpilation en français dès son quarante et unième fichier, alors que les mêmes erreurs sortaient
// en anglais sur un petit projet.
//
// Trois niveaux : le Bundler dans le process du test (pool forcé par `inlineTranspileLimit`), puis
// `mjs build` et `mjs dev` (veille, recompilation après une sauvegarde) en sous-processus réels, sur de
// vrais projets de 5 et de 45 fichiers. Le fichier fautif écrit un effet inconnu : son message vient du
// transpileur, donc du thread de travail quand il y en a un.

import assert from 'node:assert/strict'
import { spawn, spawnSync, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin   = join(repoRoot, 'node_modules', '.bin', 'tsx')
const cliPath  = join(repoRoot, 'src', 'cli.ts')

const EN = 'unknown effect'
const FR = 'effet inconnu'

// petit projet : transpilé dans le processus principal ; gros projet : au-dessus du seuil de 40 fichiers, donc par le pool
const PETIT = 5
const GROS  = 45

const fautif = (nom: string) => `<p *${nom}>faute</p>\n`

function ecrireSources(root: string, nb: number, nomFautif: string): void {
  mkdirSync(join(root, 'src'), { recursive: true })
  for (let i = 2; i <= nb; i++) writeFileSync(join(root, 'src', `comp${i}.mjs`), `<p>comp${i}</p>\n`)
  writeFileSync(join(root, 'src', 'comp1.mjs'), fautif(nomFautif))
}

function projetCli(prefixe: string, lang: 'en' | 'fr' | null, nb: number): string {
  const root = mjsTmp(prefixe)
  ecrireSources(root, nb, 'zzzinconnu')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'public/modularjs', ...(lang ? { lang } : {}) }))
  return root
}

function construire(root: string): string {
  const r = spawnSync(tsxBin, [cliPath, 'build', '--root', root], { cwd: repoRoot, encoding: 'utf-8', timeout: 170000 })
  return `${r.stdout ?? ''}${r.stderr ?? ''}`
}

function verifier(sortie: string, lang: 'en' | 'fr', nomFautif = 'zzzinconnu'): void {
  assert.match(sortie, new RegExp(`\\*${nomFautif}`), `le fichier fautif doit être signalé :\n${sortie}`)
  const [voulu, autre] = lang === 'en' ? [EN, FR] : [FR, EN]
  assert.ok(sortie.includes(voulu), `« ${voulu} » attendu (projet en ${lang}) :\n${sortie}`)
  assert.ok(!sortie.includes(autre), `« ${autre} » ne doit pas apparaître (projet en ${lang}) :\n${sortie}`)
}

describe('bundler — la langue des messages suit le projet jusque dans les threads de transpilation', function () {
  this.timeout(180000)

  describe('Bundler dans le process du test', () => {
    afterEach(async () => {
      setMessagesLang('fr')
      await terminateSharedWorkerPool()
    })

    function projetBundler(prefixe: string) {
      const root = mjsTmp(prefixe)
      ecrireSources(root, 3, 'zzzinconnu')
      return { srcDir: join(root, 'src'), outDir: join(root, 'out'), manifest: join(root, 'bundle.js') }
    }

    async function erreurs(p: ReturnType<typeof projetBundler>, limite: number): Promise<string[]> {
      const b = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, inlineTranspileLimit: limite })
      const stats = await b.compile()
      return stats.errors.map(e => e.message)
    }

    it('projet en anglais, transpilation en direct : l\'erreur sort en anglais (témoin)', async () => {
      setMessagesLang('en')
      const messages = await erreurs(projetBundler('langue-direct-en'), 999)
      assert.equal(messages.length, 1, messages.join('\n'))
      verifier(messages.join('\n'), 'en')
    })

    it('projet en anglais, transpilation par les threads : l\'erreur sort en anglais', async () => {
      setMessagesLang('en')
      const messages = await erreurs(projetBundler('langue-pool-en'), 0)
      assert.equal(messages.length, 1, messages.join('\n'))
      verifier(messages.join('\n'), 'en')
    })

    it('projet en français, transpilation par les threads : l\'erreur sort en français', async () => {
      setMessagesLang('fr')
      const messages = await erreurs(projetBundler('langue-pool-fr'), 0)
      assert.equal(messages.length, 1, messages.join('\n'))
      verifier(messages.join('\n'), 'fr')
    })

    it('le texte est le même par les threads et en direct, dans les deux langues', async () => {
      const p = projetBundler('langue-pool-direct')
      for (const lang of ['en', 'fr'] as const) {
        setMessagesLang(lang)
        const direct = await erreurs(p, 999)
        const pool   = await erreurs(p, 0)
        assert.deepEqual(pool, direct, `projet en ${lang} : le pool et le direct doivent dire la même chose`)
      }
    })

    it('la langue change entre deux compilations sur le MÊME pool : chaque erreur suit la langue du moment', async () => {
      const p = projetBundler('langue-pool-bascule')
      for (const lang of ['en', 'fr', 'en'] as const) {
        setMessagesLang(lang)
        verifier((await erreurs(p, 0)).join('\n'), lang)
      }
    })
  })

  describe('mjs build', () => {
    it('petit projet en anglais : l\'erreur sort en anglais (témoin)', () => {
      verifier(construire(projetCli('langue-build-5-en', 'en', PETIT)), 'en')
    })

    it('gros projet en anglais : l\'erreur sort en anglais', () => {
      verifier(construire(projetCli('langue-build-45-en', 'en', GROS)), 'en')
    })

    it('petit projet en français : l\'erreur sort en français', () => {
      verifier(construire(projetCli('langue-build-5-fr', 'fr', PETIT)), 'fr')
    })

    it('gros projet en français : l\'erreur sort en français', () => {
      verifier(construire(projetCli('langue-build-45-fr', 'fr', GROS)), 'fr')
    })

    it('gros projet sans clé lang : l\'erreur sort en français (la langue par défaut)', () => {
      verifier(construire(projetCli('langue-build-45-defaut', null, GROS)), 'fr')
    })
  })

  describe('mjs dev (veille)', () => {
    interface Dev {
      sortie(): string
      attendre(motif: RegExp, delaiMs: number): Promise<void>
      arreter(): Promise<void>
    }

    // `tsx <fichier>` lance un enfant Node qui exécute cli.ts : le signal doit viser cet enfant
    function pidEnfant(pidLanceur: number): number {
      const sortie = execSync(`ps --ppid ${pidLanceur} -o pid= --no-headers`).toString().trim()
      const pid = parseInt(sortie.split('\n')[0]?.trim() ?? '', 10)
      if (!Number.isFinite(pid)) throw new Error(`aucun process enfant pour le lanceur tsx (pid ${pidLanceur}) : ${JSON.stringify(sortie)}`)
      return pid
    }

    function lancerDev(root: string): Dev {
      const port = 20000 + Math.floor(Math.random() * 10000)
      const proc = spawn(tsxBin, [cliPath, 'dev', '--root', root, '--port', String(port)], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
      let sortie  = ''
      let ferme   = false
      let attentes: Array<() => void> = []
      const noter = (d: Buffer) => { sortie += String(d); attentes.forEach(f => f()) }
      proc.stdout!.on('data', noter)
      proc.stderr!.on('data', noter)
      proc.once('close', () => { ferme = true })
      return {
        sortie: () => sortie,
        attendre: (motif, delaiMs) => new Promise<void>((resolve, reject) => {
          const controle = () => {
            if (!motif.test(sortie)) return
            clearTimeout(minuterie)
            attentes = attentes.filter(f => f !== controle)
            resolve()
          }
          const minuterie = setTimeout(() => {
            attentes = attentes.filter(f => f !== controle)
            reject(new Error(`« ${motif} » n'est pas apparu en ${delaiMs} ms.\n--- sortie de mjs dev ---\n${sortie}`))
          }, delaiMs)
          attentes.push(controle)
          controle()
        }),
        arreter: () => new Promise<void>((resolve) => {
          if (ferme) return resolve()
          const filet = setTimeout(() => { try { proc.kill('SIGKILL') } catch {} }, 15000)
          proc.once('close', () => { clearTimeout(filet); resolve() })
          try { process.kill(pidEnfant(proc.pid!), 'SIGINT') } catch { proc.kill('SIGKILL') }
        }),
      }
    }

    // build initial avec le fichier fautif, puis une sauvegarde qui le remplace par une autre faute : les deux passes sortent dans la langue du projet
    // (la sauvegarde attend l'annonce de la veille : un petit projet finit son build avant que le guetteur de fichiers soit prêt)
    async function veiller(prefixe: string, lang: 'en' | 'fr', nb: number): Promise<string> {
      const root = projetCli(prefixe, lang, nb)
      const dev  = lancerDev(root)
      try {
        await dev.attendre(/\*zzzinconnu[^\n]*\n/, 120000)
        await dev.attendre(/👀/, 120000)
        writeFileSync(join(root, 'src', 'comp1.mjs'), fautif('yyyinconnu'))
        await dev.attendre(/\*yyyinconnu[^\n]*\n/, 120000)
        return dev.sortie()
      } finally {
        await dev.arreter()
      }
    }

    it('petit projet en anglais : le build initial et la recompilation sortent en anglais (témoin)', async () => {
      const sortie = await veiller('langue-dev-5-en', 'en', PETIT)
      verifier(sortie, 'en')
      verifier(sortie, 'en', 'yyyinconnu')
    })

    it('gros projet en anglais : le build initial et la recompilation sortent en anglais', async () => {
      const sortie = await veiller('langue-dev-45-en', 'en', GROS)
      verifier(sortie, 'en')
      verifier(sortie, 'en', 'yyyinconnu')
    })

    it('gros projet en français : le build initial et la recompilation sortent en français', async () => {
      const sortie = await veiller('langue-dev-45-fr', 'fr', GROS)
      verifier(sortie, 'fr')
      verifier(sortie, 'fr', 'yyyinconnu')
    })
  })
})
