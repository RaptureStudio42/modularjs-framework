// ============================================================================
// LES MOTS DE MJS SUR UNE BALISE
// ============================================================================
// `:mot` ou `:mot=valeur` : un mot de MJS ; `*nom` ou `*nom(réglages)` : un effet ; `@nom` ou `@nom=…` : un événement, et rien d'autre.
// Chaque mot garde sa forme (`:size="320x48"`, `:lightDom`, `:flip`, `:class{$on}="vif"`, `:in=*fly(up)`, `:disabled={$x}`) ; seul le
// signe le distingue. La seule table des mots, de leur signe et de leurs noms : le lecteur (parseAttrs), les passes du texte et les macros
// du transpileur, les blocs <style>, les messages la lisent — un nom ou le signe qui change se change ici. Passé le lecteur, le générateur
// reçoit l'attribut `@…` qu'il a toujours traité (`inner`) : `:size="320x48"` lui arrive en `@size`

// le signe des mots de MJS, et sa forme dans une expression régulière
export const SIGN    = ':'
export const SIGN_RE = SIGN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export interface MjsWord {
  inner: string   // le nom que reçoit le générateur, sans `@`
}

// les propriétés écrites par un mot (`:disabled={$off}`, `:disabled` nue)
export const MJS_BOOLEAN_PROPS = ['value', 'checked', 'disabled', 'open', 'readonly',
                                  'required', 'selected', 'hidden', 'multiple',
                                  'autofocus', 'muted', 'autoplay', 'loop', 'controls',
                                  'allowfullscreen', 'async', 'default', 'defer', 'formnovalidate',
                                  'inert', 'ismap', 'itemscope', 'nomodule', 'novalidate',
                                  'playsinline', 'reversed']

// nom écrit après le signe → le mot
export const MJS_WORDS: Record<string, MjsWord> = {
  group:           { inner: 'group' },
  html:            { inner: 'html' },
  text:            { inner: 'text' },
  this:            { inner: 'this' },
  style:           { inner: 'style' },
  class:           { inner: 'class' },
  flip:            { inner: 'flip' },
  attach:          { inner: 'attach' },
  childtransition: { inner: 'childtransition' },
  lightDom:        { inner: 'lightDom' },
  offscreen:       { inner: 'offscreen' },
  wake:            { inner: 'wake' },
  size:            { inner: 'size' },
  transition:      { inner: 'transition' },
  in:              { inner: 'in' },
  out:             { inner: 'out' },
  emit:            { inner: 'emit' },
  noUJS:           { inner: 'noUJS' },
  permanent:       { inner: 'permanent' },
  preload:         { inner: 'preload' },
  method:          { inner: 'method' },
  confirm:         { inner: 'confirm' },
  callback:        { inner: 'callback' },
  flash:           { inner: 'flash' },
  title:           { inner: 'title' },
  pageTransition:  { inner: 'pageTransition' },
  viewTransition:  { inner: 'viewTransition' },
  ...Object.fromEntries(MJS_BOOLEAN_PROPS.map((p) => [p, { inner: p }])),
}

// les attributs d'un bloc <style> (transpiler/sections.ts), du même signe : `<style :display="inline-block" :css="base">`
export const STYLE_WORDS = ['css', 'display', 'viewTransition', 'vt']

// nom interne → nom écrit
const BY_INNER = new Map(Object.entries(MJS_WORDS).map(([word, entry]) => [entry.inner, word]))

// l'écriture d'un mot d'après son nom interne : `written('size')` → `:size`
export const written = (inner: string): string => SIGN + (BY_INNER.get(inner) ?? inner)

// les mots de MJS, pour le message d'un mot inconnu
export const wordList = (): string => Object.keys(MJS_WORDS).map((w) => SIGN + w).join(', ')

export interface WordHit { word: string, entry: MjsWord, rest: string }

const own = (word: string): boolean => Object.prototype.hasOwnProperty.call(MJS_WORDS, word)

// le mot d'un attribut écrit avec le signe (`:size`, `:in.global`, `:class{…}`) : son nom jusqu'au premier `.`, `{` ou `=`, s'il est exactement un
// mot ; null sinon (`:in:fade`, `:size-x`) ; `:noujs`, `:no-ujs` sont `:noUJS`
export function wordOf(name: string): WordHit | null {
  if (!name.startsWith(SIGN)) return null
  const m = /^([A-Za-z][\w-]*)([.{=][\s\S]*)?$/.exec(name.slice(SIGN.length))
  if (!m) return null
  const word = /^no-?ujs$/i.test(m[1]) ? 'noUJS' : m[1]
  return own(word) ? { word, entry: MJS_WORDS[word], rest: m[2] ?? '' } : null
}

// l'ancien mot d'un attribut écrit `@…` : son nom jusqu'au premier `.`, `{` ou `=`, s'il est exactement un mot ; null pour un événement, même
// quand son nom commence par un mot (`@input`, `@introstart`, `@transitionend`, `@in:fade`, `@title-change`) ; `@noUJS` s'écrivait
// aussi `@noujs`, `@no-ujs`, et `@permanent` sans égard à la casse
export function oldWordOf(name: string): WordHit | null {
  const m = /^@([A-Za-z][\w-]*)([.{=][\s\S]*)?$/.exec(name)
  if (!m) return null
  const head = /^no-?ujs$/i.test(m[1]) ? 'noUJS' : /^permanent$/i.test(m[1]) ? 'permanent' : m[1]
  const word = BY_INNER.get(head)
  return word ? { word, entry: MJS_WORDS[word], rest: m[2] ?? '' } : null
}

// la nouvelle écriture d'un ancien mot `@…` : le même mot, le même suffixe, la même valeur (`value`, telle qu'écrite : `"320x48"`, `{$o}`,
// `!{ref}` ; null pour la forme nue), seul le signe change. Le message du refus et l'outil de réécriture la donnent
export function colonWriting(name: string, value: string | null): string {
  if (!oldWordOf(name)) return name
  return SIGN + name.slice(1) + (value === null ? '' : `=${value}`)
}

// le nom d'un attribut tel que l'écrit l'appli, pour un message du générateur qui reçoit le nom interne : `@style.color` → `:style.color` ;
// un événement garde son `@`
export function shownName(name: string): string {
  const hit = oldWordOf(name)
  return hit ? `${SIGN}${hit.word}${hit.rest}` : name
}

// un mot de MJS écrit avec l'étoile d'un effet (`*size`, `*lightDom`) : son écriture, pour l'erreur « effet inconnu »
export function wordHint(effect: string): string | null {
  const m = /^([A-Za-z][\w-]*)/.exec(effect)
  return m && own(m[1]) ? SIGN + effect : null
}

// l'expression régulière d'un mot lu sur le texte d'une balise, avant le lecteur (liens, formulaires, navigation : transpiler/index.ts) :
// `wordRe('confirm', '=…')` → /\B:confirm=…/g, le signe pris ici. `name` : la forme du nom dans l'expression (`no-?ujs`). `\B` : un signe
// collé à un nom (`xlink:href`) n'ouvre aucun mot
export const wordRe = (name: string, tail: string, flags = 'g'): RegExp => new RegExp(String.raw`\B` + SIGN_RE + name + tail, flags)

// les modificateurs d'un événement (`@click.prevent`, `@click.emit.nom`) : un mot de MJS ne les prend pas, sauf les siens (`:attach.once`)
export const EVENT_MODIFIERS = ['propagate', 'prevent', 'stop', 'self', 'once', 'emit']

// les modificateurs propres à un mot (`:in.global`, `:attach.once`) ; `name` : un nom libre suit le mot (`:style.color`, `:group.x`,
// `:emit.choix`, `:viewTransition.hero`), jugé plus loin
const WORD_MODIFIERS: Record<string, string[] | 'name'> = {
  in:             ['global', 'shared'],
  out:            ['global', 'shared'],
  transition:     ['global', 'shared'],
  attach:         ['once'],
  style:          'name',
  group:          'name',
  emit:           'name',
  viewTransition: 'name',
}

// le modificateur qu'un mot ne prend pas (`:size.propagate` → `propagate`), null sinon : un mot sans modificateur à lui n'en prend aucun ;
// un autre refuse un modificateur d'événement qui n'est pas le sien (`:in.once`), le générateur juge le reste (`:in.fly`, `:attach.x`)
export function strayModifier(word: string, rest: string): string | null {
  if (!rest.startsWith('.')) return null
  const own = Object.prototype.hasOwnProperty.call(WORD_MODIFIERS, word) ? WORD_MODIFIERS[word] : undefined
  if (own === 'name') return null
  const segs = rest.slice(1).split('.')
  if (!own) return segs[0]
  return segs.find((s) => EVENT_MODIFIERS.includes(s) && !own.includes(s)) ?? null
}

// la forme d'un mot, pour un message qui la rappelle : drapeau nu (`:lightDom`), propriété calculée (`:open={…}`), transition
// (`:in=*effet(…)`), forme propre (`:html=!{…}`, `:class{…}="…"`, `:preload="hover"`), sinon une valeur (`:size="…"`)
const FLAG_WORDS = ['lightDom', 'noUJS', 'permanent']
const WORD_FORMS: Record<string, string> = {
  class:   '{…}="…"',
  style:   '.color={…}',
  group:   '.x=!{…}',
  emit:    '.x={…}',
  html:    '=!{…}',
  text:    '=!{…}',
  this:    '=!{ref}',
  attach:  '={…}',
  preload: '="hover"',
}
export function wordForm(word: string): string {
  if (FLAG_WORDS.includes(word)) return SIGN + word
  if (Object.prototype.hasOwnProperty.call(WORD_FORMS, word)) return SIGN + word + WORD_FORMS[word]
  if (MJS_BOOLEAN_PROPS.includes(word)) return `${SIGN}${word}={…}`
  if (['in', 'out', 'transition'].includes(word)) return `${SIGN}${word}=*effet(…)`
  return `${SIGN}${word}="…"`
}
