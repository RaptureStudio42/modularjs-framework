// la passe des contrôles et des petits relevés du gabarit (compare-lecteur.ts --lints <ModularJS témoin>) : le témoin est
// un ModularJS d'avant leur passage sur l'arbre (une copie de l'arbre ou la version publiée), lu depuis ses sources.
// 1. chaque composant du corpus compilé par le témoin puis par ce ModularJS : sortie, données, erreur et messages de
//    console comparés au caractère près (avertissements d'accessibilité et du <form> sans action compris) ;
// 2. chaque source, partiels compris : les balises <@@img> (scanImgTags) et les réglages d'image des effets
//    (scanEffectImages), témoin contre arbre ; le témoin reçoit le texte masqué comme le bundler le masquait devant
//    scanImgTags, l'arbre le texte brut (il ne lit que le balisage) puis le même texte masqué ;
// 3. chaque composant, même un que la construction refuse avant ses contrôles (une appli pas encore passée à cette
//    version) : les contrôles d'accessibilité et du <form> sur sa source, sections blanchies à longueur égale.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { readFile } from '../src/reader/index.js'

export interface SourceDesLints { fichier: string, racine: string, nom: string, coeur: boolean, module: boolean }

type Transpile = (src: string, opts: Record<string, unknown>) => Promise<{ output?: string, data?: unknown, sourceMap?: string }>
type ScanImg   = (text: string) => unknown[]
type ScanEffet = (html: string) => unknown[]
type Controle  = (html: string, nom: string, premiere?: number) => string[]

interface Lecteurs { transpile: Transpile, scanImgTags: ScanImg, scanEffectImages: ScanEffet, checkA11y: Controle, checkUjsForm: Controle }

async function charger(modularjs: string): Promise<Lecteurs> {
  const dossier = join(modularjs, 'src', 'transpiler')
  return {
    transpile:        (await import(join(dossier, 'index.ts'))).transpile,
    scanImgTags:      (await import(join(dossier, 'img-tag.ts'))).scanImgTags,
    scanEffectImages: (await import(join(dossier, 'effect-images.ts'))).scanEffectImages,
    checkA11y:        (await import(join(dossier, 'a11y.ts'))).checkA11y,
    checkUjsForm:     (await import(join(dossier, 'ujs-form.ts'))).checkUjsForm,
  }
}

// le masque que le bundler posait devant scanImgTags (maskImgTagScanZones, bundler/index.ts), recopié ici tel quel : l'entrée
// du témoin
function masqueDuBundler(html: string): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ')
  return html
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, blank)
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, blank)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, blank)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, blank)
    .replace(/<!--(?:-?>|[\s\S]*?--!?>)/g, blank)
}

// la source d'un composant, ses sections (scripts, styles, <vars>…) et ses directives blanchies à longueur égale, sauts de
// ligne gardés : son gabarit, aux lignes du fichier
function gabaritSeul(src: string): string {
  let out = src
  for (const n of readFile(src, { compiler: false }).children) {
    if (n.kind === 'script' || n.kind === 'style' || n.kind === 'section' || n.kind === 'directive') out = out.slice(0, n.start) + out.slice(n.start, n.end).replace(/[^\n]/g, ' ') + out.slice(n.end)
  }
  return out
}

// la compilation d'un composant : sortie, données, carte (ou l'erreur), puis chaque message de console dans l'ordre
async function compiler(transpile: Transpile, src: string, options: Record<string, unknown>): Promise<string> {
  const garde    = { log: console.log, warn: console.warn, error: console.error }
  const messages: string[] = []
  console.log = console.warn = console.error = (...x: unknown[]) => { messages.push(x.map(String).join(' ')) }
  let texte  = ''
  let erreur = ''
  try {
    const r = await transpile(src, options)
    texte = JSON.stringify({ output: r.output ?? null, data: r.data ?? null, sourceMap: r.sourceMap ?? null })
  }
  catch (e) {
    erreur = String((e as Error).message ?? e)
  }
  finally {
    Object.assign(console, garde)
  }
  return `${texte}\n--- erreur\n${erreur}\n--- console\n${messages.join('\n')}`
}

function premierEcart(a: string, b: string): string {
  let k = 0
  while (k < a.length && k < b.length && a[k] === b[k]) k++
  const extrait = (x: string): string => JSON.stringify(x.slice(Math.max(0, k - 60), k + 80))
  return `au caractère ${k} : témoin ${extrait(a)} ; arbre ${extrait(b)}`
}

// les partiels `_x.mjs` posés à côté des composants du corpus : le bundler les relève aussi
function partiels(composants: SourceDesLints[]): SourceDesLints[] {
  const vus = new Map<string, SourceDesLints>()
  for (const s of composants) {
    const dossier = dirname(s.fichier)
    if (!existsSync(dossier)) continue
    for (const n of readdirSync(dossier).sort()) if (n.startsWith('_') && n.endsWith('.mjs') && !vus.has(join(dossier, n))) vus.set(join(dossier, n), { ...s, fichier: join(dossier, n) })
  }
  return [...vus.values()]
}

export async function comparerLints(liste: SourceDesLints[], racine: string, temoin: string, optionsDe: (s: SourceDesLints) => Record<string, unknown>, nomCourt: (s: SourceDesLints) => string): Promise<number> {
  const avant      = await charger(temoin)
  const apres      = await charger(racine)
  const composants = liste.filter(s => !s.module)
  const ecarts: string[] = []
  const bilan      = { compiles: 0, avertissements: 0, erreurs: 0, images: 0, effets: 0, controles: 0 }

  // 1. compilations
  for (const s of composants) {
    const src = readFileSync(s.fichier, 'utf8')
    const a   = await compiler(avant.transpile, src, optionsDe(s))
    const b   = await compiler(apres.transpile, src, optionsDe(s))
    bilan.compiles++
    bilan.avertissements += (b.split('\n--- console\n')[1].match(/⚠/g) ?? []).length
    if (/\n--- erreur\n./.test(b)) bilan.erreurs++
    if (a !== b) ecarts.push(`${nomCourt(s)} : compilation, ${premierEcart(a, b)}`)
  }

  // 2. relevés du bundler, partiels compris
  for (const s of [...composants, ...partiels(composants)]) {
    const src     = readFileSync(s.fichier, 'utf8')
    const masque  = masqueDuBundler(src)
    const temoinI = JSON.stringify(avant.scanImgTags(masque))
    const brutI   = JSON.stringify(apres.scanImgTags(src))
    const masqueI = JSON.stringify(apres.scanImgTags(masque))
    bilan.images += (avant.scanImgTags(masque)).length
    if (temoinI !== brutI) ecarts.push(`${nomCourt(s)} : <@@img> sur le texte brut, ${premierEcart(temoinI, brutI)}`)
    if (temoinI !== masqueI) ecarts.push(`${nomCourt(s)} : <@@img> sur le texte masqué, ${premierEcart(temoinI, masqueI)}`)
    const temoinE = JSON.stringify(avant.scanEffectImages(src))
    const arbreE  = JSON.stringify(apres.scanEffectImages(src))
    bilan.effets += (avant.scanEffectImages(src)).length
    if (temoinE !== arbreE) ecarts.push(`${nomCourt(s)} : réglages d'image des effets, ${premierEcart(temoinE, arbreE)}`)
  }

  // 3. contrôles sur la source de chaque composant
  for (const s of composants) {
    const src = readFileSync(s.fichier, 'utf8')
    if (src.includes('\r') || src.charCodeAt(0) === 0xfeff) continue
    const g   = gabaritSeul(src)
    const nom = basename(s.fichier, '.mjs')
    for (const quoi of ['checkA11y', 'checkUjsForm'] as const) {
      const a = JSON.stringify(avant[quoi](g, nom))
      const b = JSON.stringify(apres[quoi](g, nom))
      bilan.controles += avant[quoi](g, nom).length
      if (a !== b) ecarts.push(`${nomCourt(s)} : ${quoi} sur la source, ${premierEcart(a, b)}`)
    }
  }

  console.log(`compare-lecteur --lints : ${bilan.compiles} composants compilés par le témoin et par l'arbre (${bilan.erreurs} refusés, ${bilan.avertissements} avertissements chez l'arbre, tous contrôles confondus), ${bilan.images} balises <@@img> et ${bilan.effets} réglages d'image relevés par le témoin, ${bilan.controles} avertissements des contrôles sur les sources chez le témoin ; ${ecarts.length} écart(s)`)
  for (const e of ecarts) console.log(`  ${e}`)
  return ecarts.length === 0 ? 0 : 1
}
