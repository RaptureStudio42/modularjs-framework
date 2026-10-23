// heatmapPackage({ file }) à l'arrêt, dans de VRAIS process enfants (tests/fixtures/heatmap-arret-child.mts) :
//   - un SIGTERM pendant la sauvegarde de fond ne laisse aucun fichier temporaire, la carte écrite est
//     complète ; au démarrage, ceux d'une écriture interrompue d'avant sont purgés ;
//   - l'arrêt propre d'une appli posé par process.once('SIGTERM') — avant ou après le paquet — n'est pas
//     coupé : le paquet n'écrit sa carte puis ne se renvoie le signal que si personne d'autre ne l'attend ;
//   - pas de double appel : un gestionnaire permanent de l'appli reçoit le signal une fois ; après
//     app.stop(), la fin du process n'écrit plus rien.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { heatmapPackage } from '../src/mjs-ws/index.js'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE   = join(__dirname, 'fixtures/heatmap-arret-child.mts')

after(() => sweepRegistered())

function dossier(nom: string) {
  const dir = mjsTmp(nom)
  mkdirSync(dir, { recursive: true })
  return { dir, file: join(dir, 'carte.json'), marque: join(dir, 'marque.txt') }
}

// `--import tsx` : UN SEUL process node, celui qui s'arrête est celui que `spawn()` rend ; la marque de l'appli
// vit dans un AUTRE dossier que la carte (la liste du dossier de la carte est ce qu'on regarde)
function lancer(file: string, mode: string, marque: string): Promise<{ code: number | null, signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const enfant   = spawn(process.execPath, ['--import', 'tsx', FIXTURE, file, mode, marque], { cwd: join(__dirname, '..'), stdio: 'ignore' })
    const securite = setTimeout(() => enfant.kill('SIGKILL'), 20000)
    enfant.on('error', (e) => { clearTimeout(securite); reject(e) })
    enfant.on('exit', (code, signal) => { clearTimeout(securite); resolve({ code, signal }) })
  })
}

describe('carte de chaleur — l\'arrêt du process (src/mjs-ws/heatmap.ts)', function () {
  this.timeout(60000)

  it('SIGTERM pendant la sauvegarde de fond : aucun fichier temporaire ne reste, la carte écrite est complète', async () => {
    const { dir, file } = dossier('heatmap-arret-fond')
    const { code, signal } = await lancer(file, 'fond', join(mjsTmp('heatmap-arret-fond-marque'), 'marque.txt'))
    assert.ok(signal === 'SIGTERM' || code === 143, `terminaison par SIGTERM attendue — code=${code} signal=${signal}`)
    assert.deepEqual(readdirSync(dir), ['carte.json'], 'aucun .tmp ne reste')
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).pages[0].zones[0].n, 1, 'la carte écrite est complète')
  })

  it('au démarrage, les fichiers temporaires d\'une écriture interrompue sont purgés', () => {
    const { dir, file } = dossier('heatmap-arret-purge')
    writeFileSync(file + '.tmp', '{"v":1,"pa')
    writeFileSync(file + '.fond.tmp', '{"v":1,"pa')
    const app: any = { on() {}, stop: async () => {} }
    ;(heatmapPackage({ file, origins: ['https://monsite.fr'], onLog: () => {} }) as any).installer(app)
    assert.deepEqual(readdirSync(dir), [], 'ni .tmp ni .fond.tmp')
  })

  it('l\'arrêt propre de l\'appli posé par process.once(\'SIGTERM\') AVANT le paquet n\'est pas coupé', async () => {
    const { file } = dossier('heatmap-arret-once-avant')
    const { marque } = dossier('heatmap-arret-once-avant-marque')
    const { code, signal } = await lancer(file, 'once-avant', marque)
    assert.equal(signal, null, 'le process ne meurt pas du signal : l\'appli décide')
    assert.equal(code, 0)
    assert.equal(readFileSync(marque, 'utf8'), 'arret-propre')
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).pages[0].url, 'https://site.fr/', 'la carte est écrite aussi')
  })

  it('l\'arrêt propre de l\'appli posé par process.once(\'SIGTERM\') APRÈS le paquet n\'est pas coupé non plus', async () => {
    const { file } = dossier('heatmap-arret-once-apres')
    const { marque } = dossier('heatmap-arret-once-apres-marque')
    const { code, signal } = await lancer(file, 'once-apres', marque)
    assert.equal(signal, null)
    assert.equal(code, 0)
    assert.equal(readFileSync(marque, 'utf8'), 'arret-propre')
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).pages[0].url, 'https://site.fr/')
  })

  it('pas de double appel : le gestionnaire permanent de l\'appli reçoit le signal UNE fois', async () => {
    const { file } = dossier('heatmap-arret-on')
    const { marque } = dossier('heatmap-arret-on-marque')
    const { code } = await lancer(file, 'on', marque)
    assert.equal(code, 0)
    assert.equal(readFileSync(marque, 'utf8'), '1', 'le signal n\'est pas renvoyé quand l\'appli l\'attend')
    assert.ok(existsSync(file), 'la carte est écrite')
  })

  it('pas de double appel : après app.stop(), la fin du process n\'écrit plus la carte', async () => {
    const { file } = dossier('heatmap-arret-stop')
    const { marque } = dossier('heatmap-arret-stop-marque')
    const { code } = await lancer(file, 'stop-puis-exit', marque)
    assert.equal(code, 0)
    assert.equal(readFileSync(file, 'utf8'), 'SENTINELLE', 'rien n\'a réécrit le fichier à la sortie')
  })
})
