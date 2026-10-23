// mjs-server/util — aides internes partagées par les fichiers du serveur de jeu, jamais exportées par le paquet : le message
// d'une clé inconnue (resolveGameDef, opts.persist). La suggestion orthographique qu'il porte et le journal par défaut sur la
// console, préfixé par son émetteur (l'application, chaque adaptateur de persistance), sont ceux de MJS WS
// (mjs-ws/package-helpers.ts::suggestKey, ::consoleLog), livrés dans le même dist/mjs-server.js

import { t } from '../messages/index.js'
import { suggestKey } from '../mjs-ws/package-helpers.js'

export function keyUnknown(prefix: string, k: string, known: Iterable<string>): Error {
  const suggestion = suggestKey(k, known)
  const hint = suggestion ? t('serveur.cle-inconnue-suggestion', { suggestion: suggestion }) : ''
  return new Error(t('serveur.cle-inconnue', { prefix: prefix, k: k, hint: hint, clesValides: Array.from(known).join(', ') }))
}
