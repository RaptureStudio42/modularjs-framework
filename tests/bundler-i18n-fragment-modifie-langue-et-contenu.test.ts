// Trois défauts de la lecture des dictionnaires (scanI18n) :
// - un fragment de section (`i18n/<langue>/<section>.json`) dont le nom de sortie ne change pas (développement,
//   ou `i18n.hash: false`) n'était jamais réécrit quand son texte changeait : l'écriture sautait dès que le fichier
//   existait, la page servait l'ancien texte jusqu'à suppression du dossier de sortie à la main
// - un dossier `i18n/__proto__/` posait ses sections sur Object.prototype du processus de construction
// - un fichier de traduction qui vaut `null` faisait tomber la construction sur un TypeError brut sans nom de fichier
//   (avec `i18n.source`) ; un fichier YAML vide reste un dictionnaire vide

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

function projet(nom: string, fichiers: Record<string, string>) {
  const root = mjsTmp(nom)
  const src  = join(root, 'src')
  for (const [rel, texte] of Object.entries(fichiers)) {
    const p = join(src, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, texte)
  }
  return { root, src, out: join(root, 'out'), man: join(root, 'out', 'bundle.js') }
}

describe('scanI18n — fragment modifié, nom de langue, contenu qui n\'est pas un dictionnaire', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [libelle, hash] of [['développement (nom clair)', undefined], ['i18n.hash: false', false]] as const) {
    it(`fragment modifié entre deux constructions, ${libelle} : le nouveau texte est servi`, async () => {
      const p = projet('i18n-fragment-modifie', {
        'accueil.mjs':          "<p>{µt('titre')}</p>\n",
        'i18n/fr.json':         JSON.stringify({ titre: 'Bonjour' }),
        'i18n/fr/section.json': JSON.stringify({ k: 'ANCIEN' }),
      })
      const i18n: any = { default: 'fr' }
      if (hash !== undefined) i18n.hash = hash
      const opts = { sourceDir: p.src, outputDir: p.out, manifestPath: p.man, i18n } as any
      const frag = join(p.out, 'i18n', 'fr', 'section.json')
      const b    = new Bundler(opts)
      const s1   = await b.compile()
      assert.equal(s1.errors.length, 0, s1.errors.map((e: any) => e.message).join('\n'))
      assert.equal(readFileSync(frag, 'utf-8'), '{"k":"ANCIEN"}')
      writeFileSync(join(p.src, 'i18n/fr/section.json'), JSON.stringify({ k: 'NOUVEAU' }))
      const s2 = await b.compile()
      assert.equal(s2.errors.length, 0)
      assert.equal(readFileSync(frag, 'utf-8'), '{"k":"NOUVEAU"}', 'même instance : le fragment doit porter le nouveau texte')
      await b.close()
      writeFileSync(join(p.src, 'i18n/fr/section.json'), JSON.stringify({ k: 'TROISIEME' }))
      const b2 = new Bundler(opts)
      const s3 = await b2.compile()
      assert.equal(s3.errors.length, 0)
      assert.equal(readFileSync(frag, 'utf-8'), '{"k":"TROISIEME"}', 'nouvelle instance (second « mjs build ») : idem')
      await b2.close()
    })
  }

  it('dossier i18n/__proto__/ : construction refusée, Object.prototype intact', async () => {
    const p = projet('i18n-langue-proto', {
      'accueil.mjs':               "<p>{µt('titre')}</p>\n",
      'i18n/fr.json':              JSON.stringify({ titre: 'Bonjour' }),
      'i18n/__proto__/admin.json': JSON.stringify({ k: 'x' }),
    })
    const b = new Bundler({ sourceDir: p.src, outputDir: p.out, manifestPath: p.man, i18n: { default: 'fr' } } as any)
    let messages: string[] = []
    try {
      const s = await b.compile()
      messages = s.errors.map((e: any) => e.message)
    }
    catch (e: any) {
      messages = [e.message]
    }
    const pollue = ({} as any).admin
    delete (Object.prototype as any).admin
    await b.close()
    assert.equal(pollue, undefined, 'Object.prototype ne doit recevoir aucune section')
    assert.ok(messages.some(m => m.includes('__proto__') && m.includes('i18n')), `erreur attendue qui nomme le dossier : ${JSON.stringify(messages)}`)
  })

  it('i18n.source et traduction qui vaut null : erreur qui nomme le fichier', async () => {
    const p = projet('i18n-traduction-null', {
      'accueil.mjs':  "<p>{µt('titre')}</p>\n",
      'i18n/fr.json': JSON.stringify({ titre: 'Bonjour' }),
      'i18n/en.json': 'null',
    })
    const b = new Bundler({ sourceDir: p.src, outputDir: p.out, manifestPath: p.man, i18n: { default: 'fr', source: 'fr' } } as any)
    const s = await b.compile()
    await b.close()
    const messages = s.errors.map((e: any) => e.message)
    assert.equal(messages.length, 1, JSON.stringify(messages))
    assert.ok(!messages[0].includes('TypeError') && messages[0].includes(join('i18n', 'en.json')), messages[0])
  })

  it('fichier YAML vide : dictionnaire vide, aucune erreur', async () => {
    const p = projet('i18n-yaml-vide', {
      'accueil.mjs':  "<p>{µt('titre')}</p>\n",
      'i18n/fr.json': JSON.stringify({ titre: 'Bonjour' }),
      'i18n/en.yml':  '',
    })
    const b = new Bundler({ sourceDir: p.src, outputDir: p.out, manifestPath: p.man, i18n: { default: 'fr' } } as any)
    const s = await b.compile()
    await b.close()
    assert.equal(s.errors.length, 0, s.errors.map((e: any) => e.message).join('\n'))
  })
})
