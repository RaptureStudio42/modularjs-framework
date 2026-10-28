// npm run check:publish [-- <dossier du paquet>] : contrôle avant `npm publish --ignore-scripts`. Cette publication saute
// prepack, donc build:types : sans un `npm run build:types` préalable, le paquet partirait sans ses déclarations, et npm
// n'en dirait rien. Le contrôle relit la liste que npm enverrait (`npm pack --dry-run --json --ignore-scripts` : sans
// --ignore-scripts, prepack émettrait les types et masquerait leur absence) et refuse, code 1, un paquet auquel manque
// une cible de package.json (bin, main, exports, types compris), une entrée de build:self, un morceau qu'une entrée
// charge, une déclaration qu'une autre importe ou un fichier que le dépôt suit sous les motifs « files » (le runtime, les
// modules du cœur, les images : le compilateur les lit chez l'utilisateur), dont un bin n'est pas exécutable, ou dont
// dist/ n'est plus ce que build:self tire des sources. Tout échec du contrôle lui-même (npm, git ou esbuild qui ne
// répondent pas, liste illisible) : code 2, jamais un paquet déclaré complet faute de preuve. Lancé par
// `node --import tsx` : le lanceur `tsx` ouvre une socket sous TMPDIR, que le noyau refuse au-delà de 107 octets

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT      = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOWN_MAX = 25   //problèmes écrits un par un, les suivants comptés

export interface PackageCheck {
  problems: string[]
  files: number
  declarations: number
}

// chaînes de `exports` à toute profondeur : sous-chemins et conditions (types, import…)
function exportTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (value && typeof value === 'object') return Object.values(value).flatMap(exportTargets)
  return []
}

// chemin d'un fichier du paquet tel que npm le liste : relatif à la racine, sans './' de tête
function packagePath(p: string): string {
  return posix.normalize(p.replace(/\\/g, '/')).replace(/^\.\//, '')
}

// entrées de build:self (`nom=src/….ts` … `--outdir=dist`) : les fichiers dist/<nom>.js qu'elle écrit
function buildEntries(script: string | undefined): string[] {
  if (!script) return []
  const words  = script.split(/\s+/)
  const outdir = words.find(w => w.startsWith('--outdir='))?.slice('--outdir='.length) ?? 'dist'
  return words.filter(w => /^[A-Za-z][\w-]*=\S+$/.test(w)).map(w => packagePath(outdir + '/' + w.split('=')[0] + '.js'))
}

// imports relatifs d'un fichier présent sur le disque, en chemins du paquet. Code d'esbuild : `from "./morceau.js"`,
// `import("./morceau.js")`, guillemets doubles seulement (les gabarits du compilateur citent des chemins entre simples) ;
// déclaration : `from './x.js'` se lit dans './x.d.ts', guillemets simples ou doubles
function relativeImports(dir: string, file: string): string[] {
  const path = join(dir, file)
  if (!existsSync(path)) return []
  const text        = readFileSync(path, 'utf8')
  const declaration = file.endsWith('.d.ts')
  const pattern     = declaration ? /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g : /(?:from|import)\s*\(?\s*"(\.\/[^"]+)"/g
  return [...text.matchAll(pattern)].map(m => {
    const target = posix.join(posix.dirname(file), m[1])
    return declaration ? target.replace(/\.js$/, '.d.ts') : target
  })
}

// fichiers atteints depuis `starts`, de proche en proche par leurs imports relatifs
function closure(dir: string, starts: string[]): string[] {
  const seen  = new Set<string>()
  const stack = [...starts]
  while (stack.length) {
    const file = stack.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    stack.push(...relativeImports(dir, file))
  }
  return [...seen]
}

// fichiers d'un dossier, chemins relatifs à lui
function listFiles(dir: string, sub = ''): string[] {
  return readdirSync(join(dir, sub), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? listFiles(dir, posix.join(sub, e.name)) : [posix.join(sub, e.name)])
}

// motif de la clé « files » : un chemin livre aussi tout ce qu'il contient ; `*` reste dans un nom, `**` traverse les dossiers
function filesPattern(p: string): RegExp {
  const body = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\0/g, '.*')
  return new RegExp(`^${body}(/.*)?$`)
}

// ce que npm écarte de lui-même, et ce qu'il livre toujours (package.json, README, LICENSE à la racine)
const NPM_SKIPPED = /(^|\/)(\.git|\.svn|\.hg|CVS|node_modules)(\/|$)|(^|\/)(\.npmignore|\.gitignore|\.npmrc|\.DS_Store|npm-debug\.log|\.lock-wscript|\._[^/]*|\.[^/]*\.swp|[^/]*\.orig)$|^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/
const NPM_ALWAYS  = /^(package\.json|readme(\.[^/]*)?|licen[cs]e(\.[^/]*)?)$/i

// un chemin du paquet est-il livré d'après « files » (`!motif` retire) ; sans la clé, tout l'est
function shippedBy(files: unknown): (path: string) => boolean {
  const list = Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string').map((f) => f.replace(/^\.\//, '').replace(/\/+$/, '')) : ['**']
  const keep = list.filter((f) => !f.startsWith('!')).map(filesPattern)
  const drop = list.filter((f) => f.startsWith('!')).map((f) => filesPattern(f.slice(1).replace(/^\.\//, '')))
  return (path) => !NPM_SKIPPED.test(path) && (NPM_ALWAYS.test(path) || keep.some((r) => r.test(path))) && !drop.some((r) => r.test(path))
}

// fichiers du paquet que suit son dépôt : un fichier effacé du disque y reste tant que son retrait n'est pas validé, et la
// liste suit d'elle-même chaque fichier ajouté au runtime, aux modules du cœur ou aux images. Hors d'un dépôt, ou dans un
// dépôt qui ne suit pas ce paquet : erreur (code 2), jamais une liste vide qui laisserait tout passer
function trackedFiles(dir: string): string[] {
  const ls = spawnSync('git', ['ls-files', '-z', '--', '.'], { cwd: dir, encoding: 'utf8' })
  if (ls.status !== 0) throw new Error(`git ne répond pas dans ${dir} (${(ls.stderr || ls.error?.message || `code ${ls.status}`).trim()}) : la liste des fichiers que le paquet doit porter se lit dans son dépôt`)
  const files = ls.stdout.split('\0').filter(Boolean)
  if (!files.includes('package.json')) throw new Error(`le dépôt git ne suit pas ${join(dir, 'package.json')} : la liste des fichiers que le paquet doit porter se lit dans son dépôt (lancez le contrôle depuis le dépôt du paquet)`)
  return files
}

// dist/ face à ses sources : la commande esbuild de build:self, rejouée dans un dossier temporaire, puis comparée à l'octet
// (le nom d'un morceau porte l'empreinte de son contenu : une source changée change aussi le texte des entrées). Une date
// de fichier ne prouverait rien : une copie, une extraction ou un `git checkout` la réécrivent. Un fichier déjà dit
// manquant n'est pas compté deux fois
function staleBuild(dir: string, script: string | undefined, modes: Map<string, number>, reported: Set<string>): string[] {
  const command = script?.split('&&').map((s) => s.trim()).find((s) => /^esbuild\s/.test(s))
  if (!command) return []
  const words  = command.split(/\s+/).slice(1)
  const outdir = packagePath(words.find((w) => w.startsWith('--outdir='))?.slice('--outdir='.length) ?? 'dist')
  const bin    = [join(dir, 'node_modules/.bin/esbuild'), join(ROOT, 'node_modules/.bin/esbuild')].find((b) => existsSync(b))
  if (!bin) throw new Error(`esbuild introuvable, ni dans ${dir} ni dans ${ROOT} : la fraîcheur de ${outdir}/ ne se vérifie pas`)
  const tmp = mkdtempSync(join(tmpdir(), 'mjs-check-publish-'))
  try {
    const built = spawnSync(bin, [...words.filter((w) => !w.startsWith('--outdir=')), `--outdir=${tmp}`, '--log-level=error'], { cwd: dir, encoding: 'utf8' })
    if (built.error) throw new Error(`esbuild ne se lance pas : ${built.error.message}`)
    if (built.status !== 0) return [`${outdir}/ ne se reconstruit pas depuis ses sources (\`npm run build:self\` échouerait) : ${built.stderr.trim()}`]
    const fresh   = listFiles(tmp)
    const changed = fresh.filter((f) => {
      const file = `${outdir}/${f}`
      return !reported.has(file) && (!modes.has(file) || !readFileSync(join(dir, file)).equals(readFileSync(join(tmp, f))))
    }).map((f) => `${outdir}/${f}`)
    const extra   = [...modes.keys()].filter((p) => posix.dirname(p) === outdir && p.endsWith('.js') && !fresh.includes(p.slice(outdir.length + 1)))
    const all     = [...changed, ...extra]
    if (!all.length) return []
    return [`${outdir}/ ne correspond plus à ses sources : ${all.length} fichier${all.length > 1 ? 's' : ''} n'${all.length > 1 ? 'y sont' : 'y est'} pas ce que \`npm run build:self\` en tirerait aujourd'hui (${all.slice(0, 4).join(', ')}${all.length > 4 ? ', …' : ''}) : lancez \`npm run build:self\``]
  }
  finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export function checkPackage(dir: string): PackageCheck {
  const pkg  = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const pack = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, encoding: 'utf8' })
  if (pack.status !== 0) throw new Error(`npm pack --dry-run a échoué (code ${pack.status}) :\n${pack.stderr}`)
  const listed = JSON.parse(pack.stdout)[0]?.files
  if (!Array.isArray(listed) || !listed.length) throw new Error(`npm pack --dry-run n'a rendu aucune liste de fichiers :\n${pack.stdout}`)
  const modes    = new Map<string, number>(listed.map((f: { path: string, mode: number }) => [f.path, f.mode]))
  const bins     = (typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {}) as string[]).map(packagePath)
  const targets  = [...bins, ...[pkg.main, pkg.types, pkg.typings].filter(Boolean), ...exportTargets(pkg.exports)].map(packagePath)
  const code     = closure(dir, [...buildEntries(pkg.scripts?.['build:self']), ...targets.filter(t => t.endsWith('.js'))])
  const types    = closure(dir, targets.filter(t => t.endsWith('.d.ts')))
  const problems = [] as string[]
  const reported = new Set<string>()
  const missing  = (file: string, why: string) => {
    if (reported.has(file)) return
    reported.add(file)
    problems.push(`${file} manque : ${why}`)
  }
  for (const file of new Set([...targets, ...code, ...types])) {
    if (modes.has(file)) continue
    if (file.endsWith('.d.ts')) missing(file, 'lancez `npm run build:types` (`npm publish --ignore-scripts` saute prepack, qui émet les déclarations)')
    else if (code.includes(file) && file.startsWith('dist/')) missing(file, 'lancez `npm run build:self`')
    else missing(file, 'la clé « files » de package.json ne le livre pas, ou le fichier n\'existe pas')
  }
  const shipped = shippedBy(pkg.files)
  for (const file of trackedFiles(dir)) {
    if (modes.has(file) || !shipped(file)) continue
    if (existsSync(join(dir, file))) missing(file, 'le dépôt le suit, mais un .npmignore ou un .gitignore l\'écarte du paquet')
    else missing(file, `le dépôt le suit, mais il n'est plus sur le disque : \`git checkout -- ${file}\` le remet (\`git rm ${file}\` s'il doit partir)`)
  }
  for (const bin of bins) {
    const mode = modes.get(bin)
    if (mode !== undefined && (mode & 0o111) === 0) problems.push(`${bin} n'est pas exécutable (mode ${mode.toString(8)}) : lancez \`chmod +x ${bin}\``)
  }
  problems.push(...staleBuild(dir, pkg.scripts?.['build:self'], modes, reported))
  return { problems, files: modes.size, declarations: [...modes.keys()].filter(f => f.endsWith('.d.ts')).length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? ROOT)
  try {
    const { problems, files, declarations } = checkPackage(dir)
    if (problems.length) {
      console.error(`Ne publiez pas : le paquet que \`npm publish --ignore-scripts\` enverrait depuis ${dir} est incomplet (${problems.length} problème${problems.length > 1 ? 's' : ''}).`)
      for (const p of problems.slice(0, SHOWN_MAX)) console.error(`  - ${p}`)
      if (problems.length > SHOWN_MAX) console.error(`  … et ${problems.length - SHOWN_MAX} autre${problems.length - SHOWN_MAX > 1 ? 's' : ''}`)
      console.error('Corrigez, puis relancez `npm run check:publish`.')
      process.exitCode = 1
    }
    else console.log(`Paquet complet : ${files} fichiers, dont ${declarations} déclarations de types. Vous pouvez publier (\`npm publish --ignore-scripts\`).`)
  }
  catch (e) {
    console.error(`Contrôle avant publication impossible : ${(e as Error)?.message ?? e}`)
    process.exitCode = 2
  }
}
