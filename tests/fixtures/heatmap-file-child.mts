// fixture — process ENFANT de tests/heatmap-file-signal.test.ts. Installe le paquet carte de chaleur
// (fichier reçu en argv) sur une appli réduite à ce qu'il touche, y fait entrer UN point, puis
// s'arrête comme le dit argv[3] : `sigterm` (systemctl stop) ou `exit` (fin normale). La sauvegarde de
// la minute n'a jamais le temps de tourner : seul l'arrêt peut écrire le fichier. Le setInterval
// (jamais .unref()) garde le process en vie : seul l'arrêt demandé le termine. Extension .mts EXPRÈS :
// `mocha --recursive tests/ --extension ts` ne la charge jamais.

import { heatmapPackage } from '../../src/mjs-ws/heatmap.js'

const file     = process.argv[2]
const mode     = process.argv[3]
const handlers: Record<string, (p: unknown, c: unknown) => void> = {}
const app: any = { on(type: string, h: (p: unknown, c: unknown) => void) { handlers[type] = h }, stop: async () => {} }

heatmapPackage({ origins: ['https://site.fr'], file }).installer(app)
handlers['heatmap:point']({ url: 'https://site.fr/', ev: 'click', z: [['document', 0.5, 0.25, 1280, 3000]] }, { meta: { origin: 'https://site.fr' } })

setInterval(() => {}, 1000)
if (mode === 'exit') process.exit(0)
else process.kill(process.pid, 'SIGTERM')
