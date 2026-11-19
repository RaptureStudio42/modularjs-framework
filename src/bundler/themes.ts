// bundler/themes — les fichiers `*.theme.mjs`, thèmes du DOCUMENT.
//
// Un fichier de thème n'est pas un composant : il ne produit aucun custom element,
// seulement un paquet de custom properties posé sur un sélecteur d'attribut. Son nom
// vient du fichier (`sombre.theme.mjs` → thème `sombre`), jamais d'un attribut.
//
// Le sélecteur émis n'exige PAS `:root` — c'est tout ce qui sépare « un interrupteur
// pour la page entière » de « des thèmes imbriqués à volonté » : n'importe quel élément
// portant l'attribut devient une racine de thème, et l'héritage des custom properties
// traverse les frontières shadow (mesuré Firefox + Chromium). Deux attributs sont visés :
// `data-mjs-theme`, posé sur `<html>` par la rune µtheme, et `theme`, ce que l'auteur
// d'une page écrit à la main sur une section.
//
// Un thème n'émet QUE ce qu'il déclare : le reste continue de descendre depuis au-dessus
// (c'est l'esprit CSS, des calques qui se superposent). Un thème « or » de trois lignes
// est donc un calque d'accent posable sur n'importe quel fond, sans rien déclarer d'autre.

import { basename } from 'node:path'

import { extractSections } from '../transpiler/sections.js'
import { compileCss } from '../transpiler/css.js'
import { rewriteStyleVars, wrapThemeBlock, type ThemeVar } from '../transpiler/style-vars.js'
import { rewriteFontSizes, type FontSizeSettings } from '../transpiler/font-size.js'
import { t } from '../messages/index.js'

export interface CompiledTheme {
  name:     string
  css:      string
  vars:     ThemeVar[]
  read:     string[]
  /** tailles du texte rendues adaptables (cf. transpiler/font-size) : le build pose leurs variables sur :root */
  sizes?:   string[]
}

export interface ThemeCompileOpts {
  varPrefix?:          string
  defaultTheme?:       string
  /** taille du texte adaptée à l'écran (cf. transpiler/font-size) ; absent = coupée */
  responsiveFontSize?: FontSizeSettings
}

/** `app/modularjs/themes/sombre.theme.mjs` → `sombre` */
export function themeNameOf(filePath: string): string {
  return basename(filePath, '.mjs').replace(/\.theme$/, '')
}

export function isThemeFile(filePath: string): boolean {
  return basename(filePath, '.mjs').endsWith('.theme')
}

const THEME_FILE_NAME_RE = /^[a-z][a-z0-9-]*$/

export function compileThemeFile(source: string, filePath: string, opts: ThemeCompileOpts = {}): CompiledTheme {
  const varPrefix    = opts.varPrefix ?? 'mjs'
  const defaultTheme = opts.defaultTheme ?? 'light'
  const name         = themeNameOf(filePath)
  if (!THEME_FILE_NAME_RE.test(name)) throw new Error(t('bundler.theme-name-file', { name, file: basename(filePath) }))

  const sections = extractSections(source)
  if (sections.themes.length === 0)      throw new Error(t('bundler.theme-file-no-block', { file: basename(filePath) }))
  // fichiers de thème — « le fichier ne contient QUE des blocs <theme> (+ commentaires) » : un
  // commentaire HTML (et le blanc autour) hors du bloc est toléré, le reste (balise, texte nu)
  // continue d'échouer avec le même message
  const usefulHtml = sections.html.replace(/<!--(?:-?>|[\s\S]*?--!?>)/g, '').trim()
  if (usefulHtml !== '')                  throw new Error(t('bundler.theme-file-impure', { file: basename(filePath), what: 'du HTML' }))
  if (sections.script.raw.trim() !== '') throw new Error(t('bundler.theme-file-impure', { file: basename(filePath), what: 'un <script>' }))
  if (sections.style.raw.trim() !== '')  throw new Error(t('bundler.theme-file-impure', { file: basename(filePath), what: 'un <style>' }))

  const block = sections.themes[0]
  if (sections.themes.length > 1) throw new Error(t('bundler.theme-file-multi', { file: basename(filePath) }))
  if (block.name !== '')           throw new Error(t('bundler.theme-file-name', { file: basename(filePath), name: block.name }))

  // le thème par défaut vaut AUSSI sans attribut : c'est lui que voit une page nue
  const targets = [`:where([data-mjs-theme='${name}'])`, `:where([theme='${name}'])`]
  if (name === defaultTheme) targets.unshift(':where(:root)')

  const rw  = rewriteStyleVars(block.raw, { prefix: varPrefix })
  const css = compileCss(wrapThemeBlock(targets.join(','), rw.code, block.lang), block.lang)
  // taille du texte en px rendue adaptable à l'écran, comme dans un <style> (cf. transpiler/font-size) : ses valeurs vont au bloc :root
  const fluid = opts.responsiveFontSize ? rewriteFontSizes(css, opts.responsiveFontSize) : { css, sizes: [] }

  return { name, css: fluid.css, vars: rw.declared.map(d => ({ name: d.name, variant: '', line: d.line, doc: d.doc })), read: rw.read, sizes: fluid.sizes }
}

/** Rend le CSS agrégé de TOUS les thèmes de document, dans un ordre stable. */
export function assembleThemes(themes: CompiledTheme[], defaultTheme = 'light'): string {
  // ORDRE — le thème par défaut D'ABORD, le reste alphabétique (ordre stable : un CSS
  // reproductible évite un rebuild fantôme à chaque compilation).
  // La position du défaut, elle, N'EST PAS cosmétique : lui seul émet aussi sur `:where(:root)`,
  // donc sa règle matche <html> même quand un AUTRE thème y est posé. Tous ces sélecteurs sont
  // en `:where()`, spécificité nulle : à égalité, c'est l'ORDRE DU TEXTE qui tranche. Émis en
  // dernier (l'alphabétique mettait `light` après `dark`), le défaut reprenait la main sur la
  // racine et `µtheme = 'dark'` ne repeignait plus la page — mesuré au navigateur, corrigé ici.
  // Comparaison par POINT DE CODE, jamais `localeCompare` : celui-ci dépend de la locale
  // de la machine — deux builds du même code sur deux postes rendraient un CSS différemment
  // ordonné, exactement ce que `writeManifest` interdit explicitement pour la même raison.
  const byCodePoint   = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  const defaultThemes = themes.filter(th => th.name === defaultTheme)
  const others        = themes.filter(th => th.name !== defaultTheme).sort((a, b) => byCodePoint(a.name, b.name))
  return [...defaultThemes, ...others].map(th => th.css).join('')
}
