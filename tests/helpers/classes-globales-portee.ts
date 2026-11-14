// sources partagées des tests de la portée d'une classe globale : dans son corps, un membre se lit et s'écrit par son nom, sans `@`
// (constantes, membre initialisé par un autre, méthode qui en appelle une autre, état), un paramètre ou une variable déclarée du même
// nom le cache, une clé, une propriété, une chaîne ou le texte d'un gabarit n'en sont pas ; dehors, `µ.App.x` se lit comme avant, et
// une méthode détachée (`liste.map(µ.App.fullName)`) garde la classe

export const APP = [
  'class App',
  "  NAME   = 'Heartwork'",
  "  SLOGAN = 'Love, Deeper.'",
  "  FULL   = NAME + ' ' + SLOGAN",
  '  count  = 0',
  '',
  "  fullName   = -> NAME + ' — ' + SLOGAN",
  '  shout      = -> fullName().toUpperCase()',
  '  inc        = -> count += 1',
  '  read       = -> count',
  '  reset      = ->',
  '    count = 0',
  '    count',
  '  hide       = (count) -> count',
  '  nested     = (count) -> [1].map(-> count)[0]',
  '  inner      = ->',
  '    f = (count) -> count',
  '    f(6)',
  '  byDefault  = (n = count) -> n',
  '  ownDefault = (count = 4) -> count',
  '  destr      = ({ count }) -> count',
  '  keys       = ->',
  '    o     = { NAME: 1 }',
  '    x     = { NAME: 2 }',
  "    s     = 'NAME'",
  '    g     = "texte NAME #{NAME}"',
  '    short = { NAME }',
  '    [o.NAME, x.NAME, s, g, short.NAME]',
  '  plus       = (liste) -> liste.map (x) -> x + count',
  "  card       = -> µCard.TITLE + ' ' + NAME",
  '  raw        = -> µraw({ n: count })',
  '  assign     = ->',
  '    { count } = { count: 3 }',
  '    count',
  '  declared   = ->',
  '    count := 1',
  '    count',
  '  # un commentaire qui cite @NAME ne compte pas',
  "  mail       = -> 'contact@heartwork.test'",
  '  isMail     = (s) -> /^[^@]+@[^@]+$/.test(s)',
].join('\n') + '\n'

export const CARD = "class Card\n  TITLE = 'Carte'\n"

// lu dehors, dans l'ordre : l'état passe d'une ligne à l'autre
export const SEQUENCE = [
  'µ.App.NAME',
  'µ.App.FULL',
  'µ.App.fullName()',
  'µ.App.shout()',
  '[1, 2].map(µ.App.fullName)',
  '((f) => f())(µ.App.fullName)',
  '(µ.App.inc(), µ.App.inc(), µ.App.count)',
  '(µ.App.count = 5, µ.App.read())',
  '[µ.App.reset(), µ.App.count]',
  'µ.App.hide(7)',
  'µ.App.nested(8)',
  'µ.App.inner()',
  '[µ.App.byDefault(), µ.App.byDefault(3)]',
  '[µ.App.ownDefault(), µ.App.ownDefault(2)]',
  'µ.App.destr({ count: 9 })',
  'µ.App.keys()',
  '(µ.App.count = 10, µ.App.plus([1, 2]))',
  'µ.App.card()',
  'µ.App.raw().n',
  '[µ.App.assign(), µ.App.count]',
  '[µ.App.declared(), µ.App.count]',
  'µ.App.mail()',
  "µ.App.isMail('a@b')",
  "Object.keys(µ.App).includes('count')",
]

export const ATTENDU = [
  'Heartwork',
  'Heartwork Love, Deeper.',
  'Heartwork — Love, Deeper.',
  'HEARTWORK — LOVE, DEEPER.',
  ['Heartwork — Love, Deeper.', 'Heartwork — Love, Deeper.'],
  'Heartwork — Love, Deeper.',
  2,
  5,
  [0, 0],
  7,
  8,
  6,
  [0, 3],
  [4, 2],
  9,
  [1, 2, 'NAME', 'texte NAME Heartwork', 'Heartwork'],
  [11, 12],
  'Carte Heartwork',
  10,
  [3, 3],
  [1, 3],
  'contact@heartwork.test',
  true,
  true,
]

// la même suite, lue par un module JavaScript que le composant importe (son nom le range avant le composant dans le développement
// assemblé du harnais)
export const SONDE = `export const run = () => [\n${SEQUENCE.map(e => '  ' + e).join(',\n')}\n]\n`

export const SOURCES: Record<string, string> = {
  'App.class.mjs':  APP,
  'Card.class.mjs': CARD,
  'lecture.js.mjs': SONDE,
  'p-home.mjs':     ["@import { run } 'lecture.js.mjs'", '<script>', '$r = JSON.stringify(run())', '</script>', '<p class="r">{$r}</p>'].join('\n') + '\n',
}
