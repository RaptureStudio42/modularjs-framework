#!/usr/bin/env node
// Migration des comptes persistés — champs français → anglais.
//
// Le paquet COMPTES est devenu ACCOUNTS et ses champs stockés ont suivi. Un dossier écrit par
// l'ancienne version (`FileAccountsPersistAdapter`) contient des enregistrements dont quatre clés
// ont changé de nom — ce script les réécrit en place, un fichier à la fois, sans toucher au reste :
//
//   pseudo → name        (casse d'origine conservée, comme avant)
//   sel    → salt
//   cree   → createdAt
//   vu     → seenAt
//
// `id`, `hash`, `roles` et `meta` sont INCHANGÉS : les secrets restent vérifiables tels quels,
// personne n'a à se reconnecter.
//
//   node scripts/migrate-accounts-fr-to-en.mjs <dossier>            # migre
//   node scripts/migrate-accounts-fr-to-en.mjs <dossier> --dry-run  # montre, n'écrit rien
//   node scripts/migrate-accounts-fr-to-en.mjs <dossier> --force    # reprend un verrou vivant
//
// Idempotent : un enregistrement déjà migré est laissé tel quel (compté « déjà à jour »).
// Écriture atomique (fichier temporaire + rename), même geste que l'adaptateur lui-même — une
// coupure de courant en cours de migration ne laisse jamais un compte à moitié écrit.
//
// Verrou EXCLUSIF (.mjs-migration.lock, PID du run) contre un SECOND run de CE script sur le même
// dossier (deux migrations lancées par erreur, ou une reprise après crash) — jamais posé en
// --dry-run, rien n'y est écrit. Ne protège PAS un serveur (mjs-ws FileAccountsPersistAdapter) déjà
// vivant sur ce dossier : il n'expose aujourd'hui aucun fichier de verrou à lire — ARRÊTE-le avant
// de migrer.

import { readdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const CHAMPS    = [['pseudo', 'name'], ['sel', 'salt'], ['cree', 'createdAt'], ['vu', 'seenAt']]
const LOCK_NAME = '.mjs-migration.lock'

// vivant ? — EPERM = vivant mais pas signalable (autre utilisateur), ESRCH/autre = mort
function isAlive(pid) {
  try { process.kill(pid, 0); return true }
  catch (err) { return err.code === 'EPERM' }
}

// écriture EXCLUSIVE ('wx') : élimine la fenêtre de course pour le cas dominant (aucun verrou
// existant) ; un verrou orphelin repris garde une fenêtre résiduelle entre l'unlink et le
// ré-essai, assumée pour un outil lancé à la main (même limite que cli/dev-lock.ts)
async function acquireLock(dir, force) {
  const lockPath = join(dir, LOCK_NAME)
  try {
    await writeFile(lockPath, String(process.pid), { flag: 'wx' })
    return lockPath
  } catch (err) {
    if (err.code !== 'EEXIST') throw err
  }
  const pid = Number((await readFile(lockPath, 'utf8')).trim())
  if (Number.isFinite(pid) && isAlive(pid) && !force) {
    console.error(`refus : verrou déjà posé par le process ${pid} (encore vivant) — ${lockPath}`)
    console.error(`si ce n'est pas un autre run de cette migration en cours : relance avec --force`)
    process.exit(1)
  }
  console.warn(`⚠️  verrou orphelin repris (ancien pid ${Number.isFinite(pid) ? pid : '?'}${force ? ', --force' : ''})`)
  await unlink(lockPath).catch(() => {})
  await writeFile(lockPath, String(process.pid), { flag: 'wx' })
  return lockPath
}

const args   = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force  = args.includes('--force')
const dir    = args.find(a => !a.startsWith('--'))

if (!dir) {
  console.error('usage : node scripts/migrate-accounts-fr-to-en.mjs <dossier> [--dry-run] [--force]')
  process.exit(1)
}

let fichiers
try { fichiers = await readdir(dir) }
catch (err) { console.error(`dossier illisible : ${dir} — ${err.message}`); process.exit(1) }

const lockPath = dryRun ? null : await acquireLock(dir, force)

let migres = 0, aJour = 0, ignores = 0

try {
  for (const fichier of fichiers) {
    if (!fichier.endsWith('.json') || fichier.endsWith('.tmp.json')) continue
    const chemin = join(dir, fichier)

    let record
    try { record = JSON.parse(await readFile(chemin, 'utf8')) }
    catch (err) { console.warn(`⚠️  illisible, ignoré : ${fichier} — ${err.message}`); ignores++; continue }

    const aTraduire = CHAMPS.filter(([fr]) => Object.hasOwn(record, fr))
    if (aTraduire.length === 0) { aJour++; continue }

    for (const [fr, en] of aTraduire) {
      if (!Object.hasOwn(record, en)) record[en] = record[fr]   // jamais écraser une clé déjà anglaise
      delete record[fr]
    }

    if (dryRun) {
      console.log(`→ ${fichier} : ${aTraduire.map(([fr, en]) => `${fr}→${en}`).join(', ')}`)
      migres++
      continue
    }

    const tmp = join(dir, fichier.replace(/\.json$/, '') + '.' + randomBytes(4).toString('hex') + '.tmp.json')
    try {
      await writeFile(tmp, JSON.stringify(record))
      await rename(tmp, chemin)
      migres++
    } catch (err) {
      console.error(`❌ échec sur ${fichier} — ${err.message}`)
      await unlink(tmp).catch(() => {})
      process.exitCode = 1
    }
  }
} finally {
  if (lockPath) await unlink(lockPath).catch(() => {})
}

console.log(dryRun
  ? `\n${migres} compte(s) à migrer, ${aJour} déjà à jour, ${ignores} ignoré(s) — rien n'a été écrit.`
  : `\n${migres} compte(s) migré(s), ${aJour} déjà à jour, ${ignores} ignoré(s).`)
