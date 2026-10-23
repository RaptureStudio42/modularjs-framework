// une animation du runtime chargée comme le bundler l'émet (`µ.anim.<nom> = <le fichier>`), avec d'abord celles qu'elle appelle par µ.anim.<nom> et les pièces
// communes qu'elle appelle par µ._mjs_anim<Nom> (animations/shared/<nom>.ts : l'enveloppe de fade, fly… et la longueur de fly et blur) : les tests qui lisent
// un fichier d'animation avec un µ factice s'en servent
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'runtime', 'animations')

const evaluer = (source: string, µ: any) => new Function('µ', 'return (' + source.trim().replace(/;\s*$/, '') + ')')(µ)

export const sourceAnimation = (nom: string) => readFileSync(join(DIR, nom + '.ts'), 'utf-8')

export function chargerAnimation(nom: string, µ: any) {
  const source = sourceAnimation(nom)
  µ.anim = µ.anim ?? {}
  for (const m of source.matchAll(/µ\.anim\.([A-Za-z]\w*)/g)) {
    if (m[1] !== nom && !µ.anim[m[1]] && existsSync(join(DIR, m[1] + '.ts'))) chargerAnimation(m[1], µ)
  }
  for (const m of source.matchAll(/µ\._mjs_anim([A-Z]\w*)/g)) {
    const fichier = join(DIR, 'shared', m[1][0].toLowerCase() + m[1].slice(1) + '.ts')
    if (!µ['_mjs_anim' + m[1]] && existsSync(fichier)) µ['_mjs_anim' + m[1]] = evaluer(readFileSync(fichier, 'utf-8'), µ)
  }
  µ.anim[nom] = evaluer(source, µ)
  return µ.anim[nom]
}
