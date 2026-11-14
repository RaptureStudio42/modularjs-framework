// `mjs build` lancé sur un petit projet fabriqué par un test, et comparaison à l'octet de deux sorties (cache sur disque de
// `mjs build --cache`) : la ligne de bilan de la construction et celle du prérendu sont relevées

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MJS = fileURLToPath(new URL('../../bin/mjs', import.meta.url))

// image d'un pixel ; une image « changée » lui ajoute des octets après sa fin
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

export interface Counts { cold: number; served: number; reason: string }
export interface Build extends Counts { status: number; out: string; prerender: Counts | null }

// unités recompilées et reprises d'une ligne de bilan (`-1` sans ligne), ou la raison d'un cache écarté
function counts(out: string, prefix: string): Counts | null {
  const used = new RegExp(`^${prefix}cache : (\\d+) fichiers? repris, (\\d+) recompilés?$`, 'm').exec(out)
  const skip = new RegExp(`^${prefix}cache écarté — (.+) : construction complète \\((\\d+) fichiers? compilés?\\)$`, 'm').exec(out)
  if (used === null && skip === null) return null
  return { cold: Number(used?.[2] ?? skip?.[2]), served: Number(used?.[1] ?? 0), reason: skip?.[1] ?? '' }
}

export function build(root: string, args: string[]): Build {
  const run  = spawnSync(process.execPath, [MJS, 'build', '--root', root, ...args], { encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' }, maxBuffer: 64 * 1024 * 1024 })
  const out  = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
  const main = counts(out, '') ?? { cold: -1, served: 0, reason: '' }
  return { status: run.status ?? -1, out, ...main, prerender: counts(out, 'Prérendu — ') }
}

// chaque fichier d'un dossier, par chemin relatif, avec son contenu
export function files(dir: string): Map<string, Buffer> {
  const all = new Map<string, Buffer>()
  if (!existsSync(dir)) return all
  for (const rel of (readdirSync(dir, { recursive: true }) as string[]).sort()) {
    const path = join(dir, rel)
    if (statSync(path).isFile()) all.set(rel, readFileSync(path))
  }
  return all
}

// écarts à l'octet entre la sortie avec le cache et la sortie sans
export function gaps(withCache: string, without: string): string[] {
  const left  = files(withCache)
  const right = files(without)
  const found: string[] = []
  for (const [rel, data] of left) {
    if (!right.has(rel)) found.push(`seulement avec le cache : ${rel}`)
    else if (!data.equals(right.get(rel)!)) found.push(`différent : ${rel}`)
  }
  for (const rel of right.keys()) if (!left.has(rel)) found.push(`seulement sans le cache : ${rel}`)
  return found
}

export function write(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
}
