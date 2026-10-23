// bin/mjs charge dist/cli.js dès qu'il existe, sinon src/cli.ts : un banc navigateur qui compile sa
// fixture par bin/mjs teste donc le compilateur de dist/, tel qu'il était au dernier
// `npm run build:self` — une syntaxe neuve y casse le build, un correctif de src/ n'y est pas, et un
// banc vert peut ne rien dire du code courant. D'où ce refus : dist/ plus ancien qu'un fichier de
// src/ = banc arrêté, avec le geste qui répare.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function plusRecent(dir: string): { fichier: string; date: number } {
  let meilleur = { fichier: '', date: 0 }
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    const r = e.isDirectory() ? plusRecent(p) : { fichier: p, date: statSync(p).mtimeMs }
    if (r.date > meilleur.date) meilleur = r
  }
  return meilleur
}

export function assertDistFrais(root: string): void {
  const cli = join(root, 'dist', 'cli.js')
  if (!existsSync(cli)) return
  const src = plusRecent(join(root, 'src'))
  if (src.date > statSync(cli).mtimeMs) {
    throw new Error(`dist/ est plus ancien que src/ (${src.fichier.slice(root.length + 1)} modifié après dist/cli.js) : bin/mjs compilerait avec l'ancien compilateur — lance \`npm run build:self\` avant le banc navigateur.`)
  }
}
