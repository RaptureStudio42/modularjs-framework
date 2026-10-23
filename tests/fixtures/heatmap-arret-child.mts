// fixture — process ENFANT de tests/mjs-ws-heatmap-arret.test.ts. Installe le paquet carte de chaleur
// (fichier reçu en argv) sur une appli réduite à ce qu'il touche, y fait entrer UN point, puis rejoue
// un arrêt comme le dit argv[3] — `marque` (argv[4]) est le fichier où l'appli laisse la trace de son
// arrêt propre :
//   fond           une sauvegarde de fond à moitié écrite quand SIGTERM arrive (la moitié du texte est sur le
//                  disque, la suite ne vient jamais) ;
//   once-avant     l'appli a posé process.once('SIGTERM') AVANT le paquet : son arrêt propre dure 300 ms ;
//   once-apres     le même, posé APRÈS le paquet ;
//   on             un gestionnaire permanent de l'appli : combien de fois a-t-il reçu le signal ?
//   stop-puis-exit app.stop() puis la fin normale du process : plus aucune écriture.
// Le setInterval (jamais .unref()) garde le process en vie : seul l'arrêt demandé le termine. Extension
// .mts EXPRÈS : `mocha --recursive tests/ --extension ts` ne la charge jamais.

import { writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import fsp from 'node:fs/promises'

const file   = process.argv[2]
const mode   = process.argv[3]
const marque = process.argv[4]

// l'écriture de fond s'arrête en route : la moitié du texte, puis le signal, puis plus rien
if (mode === 'fond') {
  const vrai = fsp.writeFile
  ;(fsp as any).writeFile = async (chemin: any, donnees: any, ...reste: any[]) => {
    if (!String(chemin).endsWith('.fond.tmp')) return (vrai as any)(chemin, donnees, ...reste)
    await (vrai as any)(chemin, String(donnees).slice(0, 40), ...reste)
    process.kill(process.pid, 'SIGTERM')
    await new Promise(() => {})
  }
  syncBuiltinESMExports()
}

const { heatmapPackage } = await import('../../src/mjs-ws/heatmap.js')
const handlers: Record<string, (p: unknown, c: unknown) => void> = {}
const app: any = { on(type: string, h: (p: unknown, c: unknown) => void) { handlers[type] = h }, stop: async () => {} }
const point = () => handlers['heatmap:point']({ url: 'https://site.fr/', ev: 'click', z: [['document', 0.5, 0.25, 1280, 3000]] }, { meta: { origin: 'https://site.fr' } })

const arretPropre = () => setTimeout(() => { writeFileSync(marque, 'arret-propre'); process.exit(0) }, 300)
if (mode === 'once-avant') process.once('SIGTERM', arretPropre)
if (mode === 'on') {
  let appels = 0
  process.on('SIGTERM', () => { appels++; setTimeout(() => { writeFileSync(marque, String(appels)); process.exit(0) }, 300) })
}

const pkg: any = heatmapPackage({ file, origins: ['https://site.fr'], onLog: () => {} })
pkg.installer(app)
if (mode === 'once-apres') process.once('SIGTERM', arretPropre)
point()

setInterval(() => {}, 1000)
if (mode === 'fond') pkg._saveLater()
else if (mode === 'stop-puis-exit') {
  await app.stop()
  point()
  writeFileSync(file, 'SENTINELLE')
  process.exit(0)
}
else process.kill(process.pid, 'SIGTERM')
