// dossier privé de l'utilisateur dans le dossier temporaire que tous partagent : créé en 0700 s'il manque (sans ses parents : un dossier
// temporaire absent le reste), puis vérifié sans suivre de lien — un dossier, à l'utilisateur, que personne d'autre ne peut écrire — et
// ramené à 0700. Rend `false` pour un dossier refusé ; une création impossible jette. Sous Windows, ni propriétaire ni mode POSIX à vérifier.
// Seule définition de ces règles : cache des entrées serveur (cf. server-entry.ts) et cache de compilation de Node (cf. compile-cache.ts)
import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs'

export function privateTmpDir(dir: string): boolean {
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { mode: 0o700 }) } catch (err: any) { if (err?.code !== 'EEXIST') throw err }
  }
  const uid = process.getuid?.()
  if (uid === undefined) return true
  const st = lstatSync(dir)
  if (!st.isDirectory() || st.uid !== uid || (st.mode & 0o002) !== 0) return false
  if ((st.mode & 0o077) !== 0) chmodSync(dir, 0o700)
  return true
}
