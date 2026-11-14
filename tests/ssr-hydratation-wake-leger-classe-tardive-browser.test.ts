// un composant léger par sa seule classe (champ, accesseur, héritage), ou par `@lightDom` (le témoin), défini par le navigateur après la reprise de la page, rendu par le
// moteur `happy-dom` du serveur (le défaut) (banc commun : helpers/leger-classe-tardive.ts)

import { suiteLegerClasseTardive } from './helpers/leger-classe-tardive.js'

suiteLegerClasseTardive('happy-dom', { champ: ['dev', 'prod'], accesseur: ['dev'], heritage: ['dev'], lightDom: ['dev'] })
