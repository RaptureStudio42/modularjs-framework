// transpiler/ujs-form — lint « <form> sans action ni méthode, intercepté quand même
// par UJS » (lint.ujsForm : le contrat « UJS intercepte
// TOUT <form> » reste entier, mais avec un avertissement). Cf. le point de
// consommation dans transpiler/index.ts, juste après le lint a11y, même famille :
// simple AVERTISSEMENT console, jamais bloquant, jamais une erreur de build.
//
// Un `@submit.prevent` retient l'envoi : la navigation lit la soumission à la REMONTÉE, une fois
// les gestionnaires du composant joués (src/runtime/mjs_ujs.ts, µ._mjs_ujsShadowAttach), comme pour
// un lien — le formulaire est alors local, rien à signaler.
//
// RÈGLE ZÉRO — même motif que transpiler/a11y.ts (et STYLE_INERT_RE, transpiler/
// sections.ts) : les zones <pre>…</pre> et <code>…</code> sont neutralisées avant
// analyse, `\n` préservés pour garder les numéros de ligne justes. Sans ça, le site
// de doc — qui MONTRE des <form> en exemple — reçoit des dizaines de fausses alertes.

import { t } from '../messages/index.js'
import { tagReader } from './tag-reader.js'

// neutralise un bloc (espaces même longueur, `\n` gardés) — les numéros de ligne
// restent justes quel que soit le masque appliqué
function maskBlocks(html: string, re: RegExp): string {
  return html.replace(re, m => m.replace(/[^\n]/g, ' '))
}

const PRE_RE  = /<pre\b[^>]*\/>|<pre\b[^>]*>[\s\S]*?<\/pre>/gi
const CODE_RE = /<code\b[^>]*\/>|<code\b[^>]*>[\s\S]*?<\/code>/gi

// RÈGLE ZÉRO — <pre> ET <code> neutralisés avant la recherche de balises <form>
function maskExamples(html: string): string {
  return maskBlocks(maskBlocks(html, PRE_RE), CODE_RE)
}

// début de chaque ligne de `text` (index du premier caractère), calculé une fois : la ligne d'un index se cherche
// ensuite par dichotomie, sans reparcourir le texte à chaque balise
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return starts
}

// numéro de ligne (1-based) du caractère à `index` ; `firstLine` : la ligne du fichier où commence le texte (le
// HTML d'un composant est rogné en tête, ses lignes vides ne se comptent plus)
function lineOfIndex(starts: number[], index: number, firstLine = 1): number {
  let low  = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (starts[mid] <= index) low = mid
    else high = mid - 1
  }
  return firstLine + low
}

// les attributs lus par un vrai découpage : le contenu d'une accolade est vidé (accolades gardées), celui d'une
// valeur entre guillemets aussi (guillemets gardés si `keep`, vidés sinon) — longueur identique. Un mot écrit
// dans un `title="… action …"` ou dans une expression n'est pas une directive, seuls les noms des attributs se lisent
function withoutValues(attrs: string, keep = true): string {
  const reader = tagReader(attrs)
  const blank = (text: string): string => text.replace(/[^\n]/g, ' ')
  let out = ''
  let quote = ''
  for (let i = 0; i < attrs.length; i++) {
    const c = attrs[i]
    if (quote) {
      if (c === quote) {
        out += keep ? c : ' '
        quote = ''
      }
      else out += c === '\n' ? c : ' '
    }
    else if (c === '"' || c === '\'') {
      quote = c
      out += keep ? c : ' '
    }
    else if (c === '{') {
      const end = reader.braceEnd(i + 1)
      if (end === -1) {
        out += '{' + blank(attrs.slice(i + 1))
        break
      }
      out += '{' + blank(attrs.slice(i + 1, end)) + '}'
      i = end
    }
    else out += c
  }
  return out
}

// action="…" (littérale non vide) ou action={…} (dynamique) — action="" compte comme
// ABSENTE : c'est exactement le piège, le navigateur y remet l'URL courante. Espaces tolérés
// autour du `=` (`action = ""`) : sans eux, cette forme ratait ce 1er test et retombait sur le
// 2e (repli « jeton présent »), qui la comptait à tort comme une action VALIDE — avertissement manqué.
function hasAction(attrs: string): boolean {
  const names = withoutValues(attrs)
  const m     = names.match(/(?:^|\s)@?action[ \t]*=[ \t]*["']([^"']*)["']/i)
  if (m) return m[1] !== ''
  return /(?:^|\s)@?action(?=[\s=/>]|$)/i.test(names)
}

// verbe HTTP déclaré : @method (directive source, avant compilation) ou mjs-method
// (forme déjà compilée, si la doc montre directement le HTML de sortie). Le simple
// method="post" NATIF ne compte volontairement PAS ici : la trappe reste entière
// (l'action manque toujours) — seul le marqueur MJS vaut acquiescement délibéré
function hasMethodDirective(attrs: string): boolean {
  const names = withoutValues(attrs)
  return /(?:^|\s)@method(?=[\s=/>]|$)/i.test(names) || /(?:^|\s)mjs-method(?=[\s=/>]|$)/i.test(names)
}

// opt-out explicite — tiret optionnel, comme le reconnaît le transpiler pour la
// directive elle-même (transpiler/index.ts, @no-?ujs). LA FORME COMPILÉE COMPTE
// AUTANT : ce lint tourne APRÈS la réécriture des directives d'attribut, le HTML
// analysé porte donc déjà `mjs-no-ujs` — sans elle, tout formulaire correctement
// opté dehors était signalé (prouvé au build du site : 3 faux positifs sur 3)
function hasNoUjs(attrs: string): boolean {
  return /(?:^|\s)(?:@no-?ujs|mjs-no-ujs)(?=[\s=/>]|$)/i.test(withoutValues(attrs))
}

// envoi retenu par le composant : `@submit` porte `.prevent` parmi ses modificateurs — ceux d'avant
// `.emit.<nom>`, qui clôt la liste (`@submit.emit.prevent` émet un événement nommé `prevent`). Les valeurs
// entre guillemets sont masquées avant la recherche : `title="astuce @submit.prevent ici"` n'est pas une directive
function hasSubmitPrevent(attrs: string): boolean {
  const directives = withoutValues(attrs, false)
  for (const m of directives.matchAll(/(?:^|\s)@submit((?:\.[\w-]+)+)/gi)) {
    const mods = m[1].slice(1).split('.')
    const end  = mods.indexOf('emit')
    if ((end === -1 ? mods : mods.slice(0, end)).includes('prevent')) return true
  }
  return false
}

/**
 * Lint « <form> sans action ni méthode » au build — fonction pure, testable seule.
 * Rend la liste des messages d'alerte (déjà traduits, via le catalogue) ; le
 * transpiler (transpiler/index.ts) fait un `console.warn` par message.
 */
export function checkUjsForm(html: string, file: string, firstLine = 1): string[] {
  const masked             = maskExamples(html)
  const messages: string[] = []
  const starts             = lineStarts(masked)
  const reader             = tagReader(masked)

  const re = /<form\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(masked))) {
    const start = m.index + m[0].length
    const end   = reader.tagEnd(start)
    if (end === -1) break
    const attrs = masked.slice(start, end)
    re.lastIndex = end
    if (hasAction(attrs) || hasMethodDirective(attrs) || hasNoUjs(attrs) || hasSubmitPrevent(attrs)) continue
    messages.push(t('transpiler.lint.ujs-form', { file, ligne: lineOfIndex(starts, m.index, firstLine) }))
  }

  return messages
}
