// les mêmes cas rendus par le moteur `browser` du serveur (un vrai navigateur), et un composant `@lightDom` par ce moteur, une fois dans
// chaque navigateur du visiteur, en développement (banc commun : helpers/leger-classe-tardive.ts)

import { suiteLegerClasseTardive } from './helpers/leger-classe-tardive.js'

suiteLegerClasseTardive('browser', { champ: ['dev'], accesseur: ['dev'], heritage: ['dev'], lightDom: ['dev'] })
