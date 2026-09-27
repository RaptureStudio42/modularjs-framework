// theme-viewer — l'atelier promet « fermez l'onglet et tout revient » (aucune écriture disque
// tant que « Enregistrer dans le source » est au repos) sans jamais rien nettoyer : une couleur
// prévisualisée restait diffusée aux AUTRES pages ouvertes (canal HMR theme-vars) même après la
// fermeture de l'onglet de l'atelier. La fermeture doit remettre à zéro chaque variable encore en
// aperçu — même mécanisme que le bouton « Rétablir tout » (valeur vide = retrait de la surcharge),
// déclenché par l'évènement 'pagehide' (fiable au déchargement, contrairement à un simple fetch).

import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ICI    = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(ICI, '..', 'src', 'server', 'theme-viewer.mjs')

const REGISTRE = {
  accent: {
    declarations: [{ value: '#3b82f6', declaredBy: 'app_theme', kind: 'theme', variant: '', file: 'src/app.theme.mjs', line: 4, doc: '' }],
    readBy: [],
  },
}

function projetTemporaire(nomFichier: string): string {
  const root   = mjsTmp('theme-viewer-reset')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  copyFileSync(SOURCE, join(srcDir, nomFichier + '.mjs'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('theme-viewer.mjs — remise à zéro des variables diffusées à la fermeture de l\'onglet', function () {
  this.timeout(60000)

  it('pagehide envoie un beacon qui remet à zéro chaque variable encore en aperçu', async () => {
    const app = await createHarness({ root: projetTemporaire('tst-thrf-un') })
    const fetchOrigine = (globalThis as any).fetch
    const beacons: Array<{ url: string, blob: any }> = []
    const faussaire = async (url: string) => {
      if (url === '/__mjs/theme.json') return { json: async () => REGISTRE }
      if (url === '/__mjs/theme/edit') return { json: async () => ({ live: true, clients: 1 }) }
      throw new Error('URL inattendue : ' + url)
    }
    ;(globalThis as any).fetch = faussaire
    app.window.fetch = faussaire
    app.window.navigator.sendBeacon = (url: string, blob: any) => { beacons.push({ url, blob }); return true }
    let c: any
    try {
      c = await app.mount('tst-thrf-un')
      await c.tick()
      await c.tick()
      await c.type('.groupes input.pastille', '#ff0000')
      assert.equal(beacons.length, 0, 'rien avant la fermeture — seul le canal HMR (envoyer) est sollicité')
      app.window.dispatchEvent(new app.window.Event('pagehide'))
      assert.equal(beacons.length, 1, 'la fermeture doit déclencher UN beacon de remise à zéro')
      assert.equal(beacons[0].url, '/__mjs/theme/edit')
      const texte = await beacons[0].blob.text()
      assert.deepEqual(JSON.parse(texte), { vars: { accent: '' } }, 'valeur vide = retrait de la surcharge, même contrat que "Rétablir"')
    } finally {
      (globalThis as any).fetch = fetchOrigine
      if (c) c.destroy()
      await app.destroy()
    }
  })

  it('aucune variable en aperçu : la fermeture n\'envoie aucun beacon — non-régression', async () => {
    const app = await createHarness({ root: projetTemporaire('tst-thrf-deux') })
    const fetchOrigine = (globalThis as any).fetch
    const beacons: any[] = []
    const faussaire = async (url: string) => {
      if (url === '/__mjs/theme.json') return { json: async () => REGISTRE }
      if (url === '/__mjs/theme/edit') return { json: async () => ({ live: true, clients: 1 }) }
      throw new Error('URL inattendue : ' + url)
    }
    ;(globalThis as any).fetch = faussaire
    app.window.fetch = faussaire
    app.window.navigator.sendBeacon = (url: string, blob: any) => { beacons.push({ url, blob }); return true }
    let c: any
    try {
      c = await app.mount('tst-thrf-deux')
      await c.tick()
      await c.tick()
      app.window.dispatchEvent(new app.window.Event('pagehide'))
      assert.equal(beacons.length, 0, 'rien à remettre à zéro : aucune requête inutile')
    } finally {
      (globalThis as any).fetch = fetchOrigine
      if (c) c.destroy()
      await app.destroy()
    }
  })

  it('hors mode direct ($live faux, "mjs serve") : la fermeture n\'envoie rien non plus', async () => {
    const app = await createHarness({ root: projetTemporaire('tst-thrf-trois') })
    const fetchOrigine = (globalThis as any).fetch
    const beacons: any[] = []
    // etatDirect() : `/__mjs/theme/edit` en GET échoue → $live reste false (cf. .catch(-> $live = false))
    const faussaire = async (url: string) => {
      if (url === '/__mjs/theme.json') return { json: async () => REGISTRE }
      if (url === '/__mjs/theme/edit') throw new Error('non disponible en mjs serve')
      throw new Error('URL inattendue : ' + url)
    }
    ;(globalThis as any).fetch = faussaire
    app.window.fetch = faussaire
    app.window.navigator.sendBeacon = (url: string, blob: any) => { beacons.push({ url, blob }); return true }
    let c: any
    try {
      c = await app.mount('tst-thrf-trois')
      await c.tick()
      await c.tick()
      assert.equal(c.findAll('.pastille.vive').length, 0, 'lecture seule : aucun sélecteur de couleur en direct')
      app.window.dispatchEvent(new app.window.Event('pagehide'))
      assert.equal(beacons.length, 0)
    } finally {
      (globalThis as any).fetch = fetchOrigine
      if (c) c.destroy()
      await app.destroy()
    }
  })
})
