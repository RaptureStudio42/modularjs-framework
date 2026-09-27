// errors-viewer — la visionneuse affichait « Aucune erreur — tout va bien » aussi bien quand le
// journal est réellement vide QUE quand le chargement a échoué (réseau coupé, serveur qui répond
// mal) : les deux cas rendaient EXACTEMENT le même message rassurant. Les deux sont désormais
// distingués : un chargement en échec affiche un message d'échec, jamais « tout va bien ».

import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ICI    = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(ICI, '..', 'src', 'server', 'errors-viewer.mjs')

function projetTemporaire(nomFichier: string): string {
  const root   = mjsTmp('errors-viewer-echec')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  copyFileSync(SOURCE, join(srcDir, nomFichier + '.mjs'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

async function monter(nomFichier: string, faussaire: (url: string) => Promise<any>) {
  const app = await createHarness({ root: projetTemporaire(nomFichier) })
  const fetchOrigine = (globalThis as any).fetch
  ;(globalThis as any).fetch = faussaire
  app.window.fetch = faussaire
  const c = await app.mount(nomFichier)
  await c.tick()
  await c.tick()
  return {
    c,
    async fermer() {
      (globalThis as any).fetch = fetchOrigine
      c.destroy()
      await app.destroy()
    },
  }
}

describe('errors-viewer.mjs — distingue « aucune erreur » de « chargement impossible »', function () {
  // chaque cas compile un projet neuf (harnais) : à froid et sur une machine chargée, bien au-delà
  // des 2 s par défaut de mocha — même délai que les autres tests qui montent un projet
  this.timeout(30000)
  // le faux `fetch` est rendu après CHAQUE cas, même abandonné en cours de route : laissé en place,
  // il faisait échouer les fichiers de test suivants du même processus (« URL inattendue »)
  const fetchDuProcessus = (globalThis as any).fetch
  afterEach(() => { (globalThis as any).fetch = fetchDuProcessus })

  it('journal réellement vide : « Aucune erreur — tout va bien »', async () => {
    const { c, fermer } = await monter('tst-evec-vide', async (url) => {
      if (url === '/__mjs/errors.json') return { json: async () => [] }
      throw new Error('URL inattendue : ' + url)
    })
    try {
      assert.match(c.text('.vide'), /Aucune erreur/)
      assert.equal(c.find('.vide.echec'), null)
    } finally { await fermer() }
  })

  it('chargement en échec (fetch qui rejette) : message d\'échec, JAMAIS « tout va bien »', async () => {
    const { c, fermer } = await monter('tst-evec-boom', async (url) => {
      if (url === '/__mjs/errors.json') throw new Error('réseau coupé')
      throw new Error('URL inattendue : ' + url)
    })
    try {
      assert.ok(c.find('.vide.echec'), 'un message d\'échec doit apparaître')
      assert.doesNotMatch(c.text('.vide.echec'), /tout va bien/, 'BUG confirmé si le message rassurant reste affiché malgré l\'échec')
    } finally { await fermer() }
  })

  it('réponse reçue mais pas du JSON valide (r.json() qui rejette) : même message d\'échec', async () => {
    const { c, fermer } = await monter('tst-evec-badjson', async (url) => {
      if (url === '/__mjs/errors.json') return { json: async () => { throw new Error('pas du JSON') } }
      throw new Error('URL inattendue : ' + url)
    })
    try {
      assert.ok(c.find('.vide.echec'))
    } finally { await fermer() }
  })

  it('un rafraîchissement qui réussit APRÈS un échec efface le message d\'échec — non-régression', async () => {
    let echoue = true
    const { c, fermer } = await monter('tst-evec-retry', async (url) => {
      if (url === '/__mjs/errors.json') {
        if (echoue) throw new Error('réseau coupé')
        return { json: async () => [] }
      }
      throw new Error('URL inattendue : ' + url)
    })
    try {
      assert.ok(c.find('.vide.echec'), 'échec au premier chargement')
      echoue = false
      await c.click('.actions button')   // bouton « Rafraîchir », premier de la barre d'actions
      assert.equal(c.find('.vide.echec'), null, 'le nouvel essai réussi doit effacer le message d\'échec')
      assert.match(c.text('.vide'), /Aucune erreur/)
    } finally { await fermer() }
  })
})
