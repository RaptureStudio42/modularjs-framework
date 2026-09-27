// mjs-server/persist-file — adaptateur ZÉRO-DÉPENDANCE (node:fs seul) du contrat MjsServerPersistAdapter
// (cf. persist.ts) : un dossier, un fichier JSON par partie (`<id>.json`). Écriture ATOMIQUE (tmp
// à part + rename — jamais un fichier à moitié écrit, même si le process meurt en plein save) ;
// suffixe tmp ALÉATOIRE (pas juste `<id>.tmp.json`) pour qu'un save et un snapshotEvery concurrents
// sur la MÊME partie n'entrent jamais en collision sur le même fichier temporaire. `load()` relit
// tout le dossier au boot — un fichier corrompu (JSON invalide, coupure en plein write AVANT cette
// version atomique, disque abîmé…) est IGNORÉ + un warn (onLog), JAMAIS un crash du boot entier
// pour une seule entrée. Seuls les fichiers RÉGULIERS sont chargés (JAMAIS un lien symbolique
// déposé dans le dossier, ignoré sans être suivi) — le confinement de _chemin() protège save()/
// remove() contre un id malveillant, mais ne dit rien d'une entrée déjà présente sur disque.
// PAS de journal WAL en v1 (raffinement v2) — le débounce court
// de persist.ts (150 ms défaut) borne déjà la fenêtre de perte au tour par tour, jamais plus.
// Limite connue v1 : un `.tmp.json` abandonné après un crash EN PLEIN WRITE (avant le rename) est
// un déchet inoffensif — jamais chargé par load() (filtré), jamais nettoyé automatiquement. Idem
// pour un échec du mkdir initial (`_ready`, jamais réessayé) : warn à chaque écriture tant qu'il
// reste rejeté — limite connue v1, même choix que persist-sql.ts pour son CREATE TABLE.
//
//   import { mjsServer, FilePersistAdapter } from 'modularjs-framework/mjs-server'
//   app = mjsServer({ persist: new FilePersistAdapter({ dir: './saves' }) })

import { mkdir, readdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { MjsWsLogFn, MjsWsLogLevel } from '../mjs-ws/index.js'
import type { MjsServerPersistAdapter } from './persist.js'
import type { MjsServerGameSnapshot } from './game.js'
import { encodeSnapshot, decodeSnapshot } from './persist.js'
import { t } from '../messages/index.js'

export interface FilePersistAdapterOpts {
  /** dossier de stockage — créé (récursif) s'il n'existe pas encore */
  dir: string
  /** défaut : console, préfixe '[mjs-server:persist-file]' (même sobriété que mjs-ws/index.ts defaultLog) */
  onLog?: MjsWsLogFn
}

function defaultLog(level: MjsWsLogLevel, message: string, meta?: unknown): void {
  const line = `[mjs-server:persist-file] ${message}`
  if (level === 'error') console.error(line, meta ?? '')
  else if (level === 'warn') console.warn(line, meta ?? '')
  else console.log(line, meta ?? '')
}

function isENOENT(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
}

export class FilePersistAdapter implements MjsServerPersistAdapter {
  private _dir: string
  private _onLog: MjsWsLogFn
  private _ready: Promise<void>            // dossier créé — toute opération l'attend d'abord
  private _enVol = new Set<Promise<void>>() // écritures/suppressions en cours — flush() les attend

  constructor(opts: FilePersistAdapterOpts) {
    if (!opts.dir) throw new Error(t('serveur.persist-file-dir-manquant'))
    this._dir   = opts.dir
    this._onLog = opts.onLog ?? defaultLog
    this._ready  = mkdir(this._dir, { recursive: true }).then(() => {})
  }

  // confinement — un id qui contiendrait un séparateur de chemin, '..' ou un octet nul désignerait
  // sinon un fichier HORS de `this._dir` (traversée de chemin) : les ids normaux (gameN) ne sont
  // jamais concernés, seul un id restauré/fourni à la main l'est. Double garde : refus à l'avance
  // (blacklist, rapide) ET vérification du chemin RÉSOLU (couvre un cas exotique que la blacklist
  // aurait raté) — erreur claire dans les deux cas, jamais un accès disque hors du dossier configuré.
  private _chemin(id: string): string {
    if (!id || id.includes('/') || id.includes('\\') || id.includes('..') || id.includes('\0')) {
      throw new Error(t('serveur.persist-file-id-invalide', { id: id }))
    }
    const chemin = join(this._dir, id +'.json')
    const base   = resolve(this._dir) + sep
    if (!resolve(chemin).startsWith(base)) {
      throw new Error(t('serveur.persist-file-id-hors-dossier', { id: id }))
    }
    return chemin
  }

  async load(): Promise<Array<{ id: string; data: MjsServerGameSnapshot }>> {
    await this._ready
    let dirents: Dirent[]
    try { dirents = await readdir(this._dir, { withFileTypes: true }) } catch { return [] }
    const results: Array<{ id: string; data: MjsServerGameSnapshot }> = []
    for (const dirent of dirents) {
      // seuls les fichiers RÉGULIERS — `dirent.isFile()` porte sur l'entrée du dossier elle-même,
      // JAMAIS suivie (contrairement à readFile ci-dessous) : un lien symbolique déposé dans le
      // dossier de stockage désignerait sinon un fichier hors de `this._dir`, contournant le
      // confinement de _chemin() (qui ne protège que save()/remove(), jamais un symlink déjà là)
      if (!dirent.isFile()) continue
      const file = dirent.name
      if (!file.endsWith('.json') || file.endsWith('.tmp.json')) continue   // '.tmp.json' termine aussi par '.json' — l'exclusion doit passer en second
      try {
        const raw  = await readFile(join(this._dir, file), 'utf8')
        const data = decodeSnapshot(raw)
        results.push({ id: data.id, data })
      } catch (err) {
        this._onLog('warn', t('serveur.persist-file-fichier-corrompu', { fichier: file }), { err: err instanceof Error ? err.message : String(err) })
      }
    }
    return results
  }

  save(id: string, data: MjsServerGameSnapshot): void {
    const p = this._ecrireAtomique(id, data)
    this._suivre(p, `save('${id}')`)
  }

  remove(id: string): void {
    const p = this._retirer(id)
    this._suivre(p, `remove('${id}')`)
  }

  async flush(): Promise<void> {
    await Promise.allSettled(Array.from(this._enVol))
  }

  /** garde-fou : `p` ne devrait jamais arriver ici déjà vouée au rejet (save/remove
   *  catchent déjà tout en interne), mais le `.catch()` AVANT le `.finally()` évite qu'une promesse
   *  orpheline rejetée ne devienne un unhandledRejection (Node 20 tue le process dessus) — filet de
   *  sécurité, le correctif principal est côté appelant (cf. _ecrireAtomique, `_ready` dans le try). */
  private _suivre(p: Promise<void>, label: string): void {
    this._enVol.add(p)
    p.catch(err => this._onLog('warn', t('serveur.persist-backend-rejet-non-intercepte', { backend: 'file', label: label }), { err: err instanceof Error ? err.message : String(err) }))
      .finally(() => this._enVol.delete(p))
  }

  private async _ecrireAtomique(id: string, data: MjsServerGameSnapshot): Promise<void> {
    let cible: string
    try { cible = this._chemin(id) }   // valide l'id AVANT de construire quoi que ce soit (y compris `tmp`, ci-dessous — un id '../x' donnerait aussi un tmp hors dossier)
    catch (err) { this._onLog('warn', t('serveur.persist-backend-save-echouee', { backend: 'file', id: id }), { err: err instanceof Error ? err.message : String(err) }); return }
    const tmp = join(this._dir, id +'.'+ randomBytes(4).toString('hex') +'.tmp.json')
    try {
      await this._ready   // mkdir initial — DANS le try : un mkdir raté doit warn, jamais rejeter à sec
      await writeFile(tmp, encodeSnapshot(data))
      await rename(tmp, cible)
    } catch (err) {
      this._onLog('warn', t('serveur.persist-backend-save-echouee', { backend: 'file', id: id }), { err: err instanceof Error ? err.message : String(err) })
      await unlink(tmp).catch(() => {})   // best-effort — n'abandonne pas de débris si le rename lui-même a échoué
    }
  }

  /** id invalide (cf. _chemin) → warn, JAMAIS un throw synchrone depuis remove() (même politique que
   *  le reste du fichier : save()/remove() ne lèvent jamais à sec, cf. commentaire de tête). */
  private async _retirer(id: string): Promise<void> {
    let cible: string
    try { cible = this._chemin(id) }
    catch (err) { this._onLog('warn', t('serveur.persist-backend-remove-echouee', { backend: 'file', id: id }), { err: err instanceof Error ? err.message : String(err) }); return }
    await unlink(cible).catch((err) => {
      if (isENOENT(err)) return   // déjà absent — pas une erreur (remove idempotent, cf. contrat)
      this._onLog('warn', t('serveur.persist-backend-remove-echouee', { backend: 'file', id: id }), { err: err instanceof Error ? err.message : String(err) })
    })
  }
}
