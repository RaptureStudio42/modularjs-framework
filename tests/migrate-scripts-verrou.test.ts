// Scripts de migration fr→en (scripts/migrate-accounts-fr-to-en.mjs, scripts/migrate-games-fr-to-en.mjs)
// — verrou exclusif contre un second run du MÊME script sur le MÊME dossier (deux migrations
// lancées par erreur, ou une reprise après crash) : un fichier `.mjs-migration.lock` posé par
// écriture EXCLUSIVE ('wx'), le PID d'un run mort est détecté et repris automatiquement, un PID
// vivant refuse (sauf --force explicite). Chaque script est lancé POUR DE VRAI (spawn node), comme
// tests/mjs-server-migration-ids.test.ts : c'est un outil qu'un utilisateur exécute à la main.
//
// Limite assumée, ARRÊTE le serveur avant de migrer : ce verrou protège contre un second run de CE
// script, pas contre un mjs-server/mjs-ws déjà vivant sur ce dossier — ces serveurs n'exposent
// aujourd'hui aucun fichier de verrou à lire.

import assert from 'node:assert/strict'
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsTmp } from './helpers/tmp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOCK_NAME = '.mjs-migration.lock'

const SCRIPTS = {
  accounts: { path: join(__dirname, '../scripts/migrate-accounts-fr-to-en.mjs'), fichier: 'compte1.json', contenu: () => JSON.stringify({ pseudo: 'p', sel: 's', cree: 1, vu: 2, id: 'i', hash: 'h', roles: [], meta: {} }) },
  games:    { path: join(__dirname, '../scripts/migrate-games-fr-to-en.mjs'),   fichier: 'partie1.json', contenu: () => JSON.stringify({ id: 'partie1', type: 'duel', code: null, state: {}, phase: null, turn: null, seq: 0, journal: [], seats: [] }) },
}

function lancer(script: string, dir: string, ...args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [script, dir, ...args], { encoding: 'utf8' })
}

// PID garanti mort à la résolution (process lancé puis attendu jusqu'à sa fin) — bien plus fiable
// qu'un nombre deviné, sans dépendre d'aucun mock (test d'intégration par process séparé)
function pidMort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', '0'])
    if (!p.pid) return reject(new Error('spawn sans pid'))
    const pid = p.pid
    p.on('exit', () => resolve(pid))
  })
}

for (const [nom, { path: script, fichier, contenu }] of Object.entries(SCRIPTS)) {
  describe(`migrate-${nom}-fr-to-en.mjs — verrou contre un second run`, function () {
    this.timeout(20000)

    it('mode réel sans verrou concurrent : migre normalement, ne laisse aucun verrou derrière lui', () => {
      const dir = mjsTmp('migr-lock-'+ nom)
      writeFileSync(join(dir, fichier), contenu())

      const r = lancer(script, dir)

      assert.equal(r.status, 0, `le script doit réussir — ${r.stderr}`)
      assert.equal(existsSync(join(dir, LOCK_NAME)), false, 'le verrou doit être retiré à la fin')
    })

    it("verrou déjà posé par un PID VIVANT (le process de test lui-même) → refuse, rien n'est migré", () => {
      const dir = mjsTmp('migr-lock-'+ nom)
      writeFileSync(join(dir, fichier), contenu())
      writeFileSync(join(dir, LOCK_NAME), String(process.pid))

      const r = lancer(script, dir)

      assert.notEqual(r.status, 0, "AVANT le fix : aucun verrou du tout — un second run migrait en même temps qu'un premier, sans jamais refuser")
      assert.equal(JSON.parse(readFileSync(join(dir, fichier), 'utf8')).id ?? 'ok', JSON.parse(contenu()).id ?? 'ok', 'le fichier ne doit pas avoir bougé — refus AVANT toute écriture')
      assert.equal(readFileSync(join(dir, LOCK_NAME), 'utf8'), String(process.pid), "le verrou du process vivant n'est jamais écrasé")
    })

    it('verrou orphelin (PID mort) → repris automatiquement, migration normale', async () => {
      const dir = mjsTmp('migr-lock-'+ nom)
      writeFileSync(join(dir, fichier), contenu())
      writeFileSync(join(dir, LOCK_NAME), String(await pidMort()))

      const r = lancer(script, dir)

      assert.equal(r.status, 0, `un verrou orphelin doit être récupéré, pas bloquer — ${r.stderr}`)
      assert.equal(existsSync(join(dir, LOCK_NAME)), false, 'le verrou repris doit être retiré à la fin du run')
    })

    it('--force reprend un verrou vivant et migre quand même', () => {
      const dir = mjsTmp('migr-lock-'+ nom)
      writeFileSync(join(dir, fichier), contenu())
      writeFileSync(join(dir, LOCK_NAME), String(process.pid))

      const r = lancer(script, dir, '--force')

      assert.equal(r.status, 0, `--force doit passer outre le verrou vivant — ${r.stderr}`)
      assert.equal(existsSync(join(dir, LOCK_NAME)), false, 'le verrou repris par --force est retiré à la fin')
    })

    it('--dry-run ne pose aucun verrou (rien n\'est écrit)', () => {
      const dir = mjsTmp('migr-lock-'+ nom)
      writeFileSync(join(dir, fichier), contenu())

      const r = lancer(script, dir, '--dry-run')

      assert.equal(r.status, 0, `--dry-run doit réussir — ${r.stderr}`)
      assert.equal(existsSync(join(dir, LOCK_NAME)), false, 'un dry-run ne doit jamais poser de verrou — il ne migre rien')
    })
  })
}
