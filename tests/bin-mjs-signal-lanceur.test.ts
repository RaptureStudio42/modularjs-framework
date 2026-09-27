// bin/mjs — lanceur dev (spawn tsx) : un enfant tué par SIGNAL ressortait en code 0 (succès
// prétendu, une CI croirait le build réussi) et un SIGINT/SIGTERM reçu par le lanceur ne relayait
// rien à l'enfant, laissant tsx (et le process node qu'il charge en interne) orphelins. Reproduit
// sur le VRAI fichier bin/mjs, copié tel quel dans un projet jetable SANS dist/ (pour forcer la
// branche dev/tsx — dist/ présent court-circuite tout process enfant, cf. bin/mjs) avec un faux
// point d'entrée src/cli.ts à la place du compilateur réel.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, symlinkSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MJS_ROOT  = join(__dirname, '..')

after(() => sweepRegistered())

// projet jetable : bin/mjs copié verbatim (le VRAI fichier, lu au moment du test — toute
// régression future y est captée), node_modules partagé par lien (tsx doit être trouvable)
function fabriquerProjet(): string {
  const dir = mjsTmp('bin-mjs-signal')
  mkdirSync(join(dir, 'bin'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'bin', 'mjs'), readFileSync(join(MJS_ROOT, 'bin', 'mjs')))
  symlinkSync(join(MJS_ROOT, 'node_modules'), join(dir, 'node_modules'))
  return dir
}

// faux point d'entrée : écrit son PID dans le fichier reçu en 1er argument puis tourne
// indéfiniment — jamais un vrai build, juste de quoi observer sa survie
function ecrireFauxCli(dir: string): void {
  writeFileSync(join(dir, 'src', 'cli.ts'),
    "import { writeFileSync } from 'node:fs'\n"+
    'writeFileSync(process.argv[2], String(process.pid))\n'+
    'setInterval(() => {}, 1000)\n')
}

function attendreFichier(chemin: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const debut = Date.now()
    const tick = () => {
      if (existsSync(chemin)) return resolve()
      if (Date.now() - debut > timeoutMs) return reject(new Error('fichier PID jamais apparu : '+ chemin))
      setTimeout(tick, 20)
    }
    tick()
  })
}

function vivant(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

// PPID d'un process (Linux, champ 4 de /proc/<pid>/stat — coupé après le DERNIER ')' du nom, qui
// peut contenir espaces/parenthèses, même idiome que cli/dev-lock.ts) — bin/mjs spawn tsx
// DIRECTEMENT : c'est ce PID-là qu'il surveille et qu'il faut manipuler pour reproduire le bug
function ppidDe(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8')
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    const ppid = Number(rest[1])
    return Number.isInteger(ppid) ? ppid : null
  } catch { return null }
}

describe('bin/mjs — signal reçu par ou depuis le lanceur (mode dev, spawn tsx)', function () {
  this.timeout(15000)

  it('enfant tué par SIGKILL : le lanceur ne ressort jamais en 0 (128+signal, jamais un succès)', async function () {
    if (!existsSync('/proc/1/stat')) return this.skip()  // /proc requis (Linux)
    const dir     = fabriquerProjet()
    ecrireFauxCli(dir)
    const pidFile = join(dir, 'cli.pid')

    const wrapper  = spawn(process.execPath, [join(dir, 'bin', 'mjs'), pidFile], { stdio: 'ignore' })
    const securite = setTimeout(() => wrapper.kill('SIGKILL'), 10000)
    const sortie   = new Promise<{ code: number | null }>((resolve) => {
      wrapper.on('exit', (code) => { clearTimeout(securite); resolve({ code }) })
    })

    await attendreFichier(pidFile, 8000)
    const cliPid = Number(readFileSync(pidFile, 'utf-8'))
    const tsxPid = ppidDe(cliPid)
    assert.ok(tsxPid, 'PPID du faux cli (le process tsx spawné par bin/mjs) introuvable via /proc')
    process.kill(tsxPid!, 'SIGKILL')

    const { code } = await sortie
    assert.notEqual(code, 0, "AVANT le fix : child.on('exit', code => process.exit(code ?? 0)) ignore le signal — un enfant tué ressortait en 0 (succès), une CI croirait le build réussi")
    assert.equal(code, 137, 'code attendu 128+SIGKILL(9)=137 — le signal du vrai échec doit se lire dans le code de sortie')
  })

  it('SIGTERM reçu par le lanceur : relayé à tsx (et à son enfant interne), aucun orphelin', async function () {
    if (!existsSync('/proc/1/stat')) return this.skip()  // /proc requis (Linux)
    const dir     = fabriquerProjet()
    ecrireFauxCli(dir)
    const pidFile = join(dir, 'cli.pid')

    const wrapper  = spawn(process.execPath, [join(dir, 'bin', 'mjs'), pidFile], { stdio: 'ignore' })
    const securite = setTimeout(() => wrapper.kill('SIGKILL'), 10000)
    const sortie   = new Promise<void>((resolve) => { wrapper.on('exit', () => { clearTimeout(securite); resolve() }) })

    await attendreFichier(pidFile, 8000)
    const cliPid = Number(readFileSync(pidFile, 'utf-8'))
    assert.ok(vivant(cliPid), 'le faux cli devrait tourner avant le signal')
    assert.ok(wrapper.pid, 'PID du lanceur introuvable')

    process.kill(wrapper.pid!, 'SIGTERM')
    await sortie
    await new Promise((r) => setTimeout(r, 500))  // laisse le relais (s'il existe) atteindre l'enfant

    const encoreVivant = vivant(cliPid)
    if (encoreVivant) process.kill(cliPid, 'SIGKILL')  // jamais laisser un orphelin derrière le test
    assert.equal(encoreVivant, false,
      "AVANT le fix : aucun relais SIGINT/SIGTERM du lanceur vers l'enfant tsx — le process tsx ET le node qu'il charge en interne survivaient à la mort du lanceur, orphelins")
  })
})
