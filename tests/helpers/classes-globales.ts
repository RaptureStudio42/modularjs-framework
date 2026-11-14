// sources partagées des tests des classes globales `Nom.class.mjs` : deux classes (l'une lit l'autre), un module qui lit une classe, un
// composant qui les lit partout (gabarit, script, module importé, forme pointée `µ.App`) et un composant qui n'en lit aucune

export const APP = ['class App', "  NAME   = 'Heartwork'", "  SLOGAN = 'Love, Deeper.'", '', "  fullName = -> NAME + ' — ' + SLOGAN"].join('\n') + '\n'

export const SOURCES: Record<string, string> = {
  'App.class.mjs':  APP,
  'Card.class.mjs': ['class Card', "  title = -> 'Carte ' + µApp.NAME"].join('\n') + '\n',
  'brand.civet.mjs':    "export const brandLine = -> 'Marque ' + µApp.fullName()\n",
  'p-home.mjs':     ["@import { brandLine } 'brand.civet.mjs'", '<script>', "$s = µApp.NAME + '!'", '</script>', '<p class="a">{µApp.NAME}</p>', '<p class="b">{µApp.fullName()}</p>', '<p class="c">{$s}</p>', '<p class="d">{brandLine()}</p>', '<p class="e">{µCard.title()}</p>', '<p class="f">{µ.App.SLOGAN}</p>'].join('\n') + '\n',
  'other.mjs':      '<p class="z">autre</p>\n',
}

// ce que montre le composant, ligne par ligne (`classe=texte`)
export const ATTENDU = ['a=Heartwork', 'b=Heartwork — Love, Deeper.', 'c=Heartwork!', 'd=Marque Heartwork — Love, Deeper.', 'e=Carte Heartwork', 'f=Love, Deeper.']
