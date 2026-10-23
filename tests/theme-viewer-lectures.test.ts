// theme-viewer — une variable que des composants LISENT avec un défaut (`read: true` au registre) n'est pas une
// déclaration : l'atelier la range à part, la nomme pour ce qu'elle est et ne dit plus rien de faux sur elle.
//
// Ce que la suite tient :
//   1. le compte en tête sépare les déclarations des valeurs par défaut de composants ;
//   2. une lecture a son groupe (nommé, en lecture seule), que les déclarations du même composant ne partagent pas ;
//   3. sa ligne dit « par défaut » et non « ligne 0 », sans « +N ailleurs » pour de simples lectures ;
//   4. son détail dit qui la lit, d'où vient le défaut et comment la régler ; plus d'« Aucun lecteur », de cascade ni de
//      cible « fichier:0 » qui ne la concernent pas ;
//   5. une déclaration que des composants lisent a ses lecteurs ; une que personne ne lit garde son « Aucun lecteur » ;
//   6. choisir une couleur sur une lecture repeint les pages ouvertes et n'écrit JAMAIS dans un fichier, même armé.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { localizeViewerSource } from '../src/server/viewer-page.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const ICI    = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(ICI, '..', 'src', 'server', 'theme-viewer.mjs')

// `check-color` : lue par une case, déclarée par personne. `check-pad` : lue deux fois par un radio, avec deux défauts
// (son CSS de base et celui d'un modèle). `check-size` : lue par une case et un radio, ET déclarée par l'application.
// `gap` : déclarée par l'application, lue par personne.
const REGISTRE = {
  'check-color': {
    declarations: [
      { value: '#fff', declaredBy: 'core-checkbox', kind: 'module', variant: '', file: 'src/core-modules/checkbox.mjs', line: 0, doc: '', read: true },
    ],
    readBy: ['core-checkbox'],
  },
  'check-pad': {
    declarations: [
      { value: '4px', declaredBy: 'core-radio', kind: 'module', variant: '', file: 'src/core-modules/radio.mjs', line: 0, doc: '', read: true },
      { value: '8px', declaredBy: 'core-radio', kind: 'module', variant: '', file: 'src/core-modules/radio.mjs', line: 0, doc: '', read: true },
    ],
    readBy: ['core-radio'],
  },
  'check-size': {
    declarations: [
      { value: '20px', declaredBy: 'core-checkbox', kind: 'module', variant: '', file: 'src/core-modules/checkbox.mjs', line: 0, doc: '', read: true },
      { value: '20px', declaredBy: 'core-radio',    kind: 'module', variant: '', file: 'src/core-modules/radio.mjs',    line: 0, doc: '', read: true },
      { value: '30px', declaredBy: 'hote',          kind: 'module', variant: '', file: 'src/hote.mjs',                  line: 3, doc: '' },
    ],
    readBy: ['core-checkbox', 'core-radio'],
  },
  gap: {
    declarations: [
      { value: '12px', declaredBy: 'hote', kind: 'module', variant: '', file: 'src/hote.mjs', line: 2, doc: '' },
    ],
    readBy: [],
  },
}

function projetTemporaire(): string {
  const root   = mjsTmp('theme-viewer-lectures')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'tst-thlc-atelier.mjs'), localizeViewerSource(readFileSync(SOURCE, 'utf-8')))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('theme-viewer.mjs — une variable lue avec un défaut est montrée pour ce qu\'elle est', function () {
  this.timeout(60000)

  let app: any
  let c: any
  let fetchOrigine: any
  const ecritures: any[] = []
  const apercus: any[]   = []

  const jsonOk = (v: any) => ({ json: async () => v })

  const faussaire = async (url: string, init?: any) => {
    if (url === '/__mjs/theme.json') return jsonOk(REGISTRE)
    if (url === '/__mjs/theme/edit') {
      if (init?.method === 'POST') apercus.push(JSON.parse(init.body))
      return jsonOk({ live: true, clients: 1 })
    }
    if (url === '/__mjs/theme/write') {
      const corps = JSON.parse(init.body)
      ecritures.push(corps)
      return jsonOk({ written: true, file: corps.file, line: corps.line })
    }
    throw new Error('URL inattendue : ' + url)
  }

  const texte = (selecteur: string) => c.findAll(selecteur).map((n: any) => n.textContent)

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
    fetchOrigine = (globalThis as any).fetch
    ;(globalThis as any).fetch = faussaire
    app.window.fetch = faussaire
    c = await app.mount('tst-thlc-atelier')
    await c.tick()
    await c.tick()
  })

  after(async () => {
    ;(globalThis as any).fetch = fetchOrigine
    if (c) c.destroy()
    if (app) await app.destroy()
  })

  it('le compte en tête sépare les déclarations des valeurs par défaut de composants', () => {
    assert.deepEqual(texte('.stat'), ['3 sources', '4 variables', '2 déclarations', '5 valeurs par défaut de composants', '3 variables lues par au moins un composant'])
  })

  it('une lecture a son groupe, nommé et en lecture seule, hors du groupe des déclarations', () => {
    assert.deepEqual(texte('.tete .source'), ['core-checkbox', 'core-radio', 'hote'])
    assert.deepEqual(texte('.tete .variante'), ['valeurs par défaut', 'valeurs par défaut'])
    assert.equal(c.findAll('.tete .lecture-seule').length, 2, 'les deux groupes de lectures, pas celui de l\'application')
    assert.deepEqual(texte('.tete .compte'), ['2 variables', '3 variables', '2 variables'])
  })

  it('la ligne d\'une lecture dit « par défaut » et non « ligne 0 », sans « ailleurs » pour de simples lectures', () => {
    assert.deepEqual(texte('.ligne .emplacement'), ['par défaut', 'par défaut', 'par défaut', 'par défaut', 'par défaut', 'ligne 3', 'ligne 2'])
    assert.deepEqual(texte('.ligne .ailleurs'), [], 'les autres entrées de check-size sont des lectures : rien n\'est déclaré ailleurs')
  })

  it('un composant qui lit un même nom avec deux défauts a une ligne pour chacun', () => {
    assert.deepEqual(texte('.groupes section:nth-child(2) .ligne .nom'), ['check-pad', 'check-pad', 'check-size'])
    assert.deepEqual(texte('.groupes section:nth-child(2) .ligne .valeur'), ['4px', '8px', '20px'])
  })

  it('déplier une lecture dit qui la lit, d\'où vient le défaut et comment la régler', async () => {
    await c.click('.groupes section:nth-child(1) .variable:nth-child(1)')
    const detail = c.find('.groupes section:nth-child(1) .variable:nth-child(1) .detail')
    assert.ok(detail, 'le détail est ouvert')
    assert.match(detail.textContent, /core-checkbox lit cette variable avec ce défaut, écrit dans son CSS\./)
    assert.match(detail.textContent, /déclarez-la dans le thème de l'application, sur :root ou sur un ancêtre du composant/)
    assert.deepEqual([...detail.querySelectorAll('.lecteur')].map((n: any) => n.textContent), ['core-checkbox'])
    assert.doesNotMatch(detail.textContent, /Aucun lecteur|déclaré ailleurs|Enregistrement vers|:0/)
    assertAbsent(detail.querySelector('.cascade'), 'aucune déclaration de ce nom : pas de cascade à raconter')
  })

  it('une lecture dont le nom est aussi déclaré le dit, et ne liste que les déclarations', async () => {
    await c.click('.groupes section:nth-child(1) .variable:nth-child(2)')
    const detail = c.find('.groupes section:nth-child(1) .variable:nth-child(2) .detail')
    assert.match(detail.querySelector('.cascade').textContent, /^Des déclarations existent pour ce nom — la cascade s'applique, la plus proche du composant l'emporte sur ce défaut\.$/)
    const declarations = [...detail.querySelectorAll('.declaration')].map((n: any) => n.textContent.replace(/\s+/g, ' ').trim())
    assert.equal(declarations.length, 1, 'l\'application seule : la lecture du radio n\'est pas une déclaration')
    assert.match(declarations[0], /hote.*30px.*src\/hote\.mjs:3/)
    assert.deepEqual([...detail.querySelectorAll('.lecteur')].map((n: any) => n.textContent), ['core-checkbox', 'core-radio'])
  })

  it('une déclaration que des composants lisent a ses lecteurs, sans cascade ni « ailleurs » pour de simples lectures', async () => {
    await c.click('.groupes section:nth-child(3) .variable:nth-child(1)')
    const detail = c.find('.groupes section:nth-child(3) .variable:nth-child(1) .detail')
    assert.deepEqual([...detail.querySelectorAll('.lecteur')].map((n: any) => n.textContent), ['core-checkbox', 'core-radio'])
    assertAbsent(detail.querySelector('.cascade'), 'pas de cascade : les autres entrées sont des lectures')
    assertAbsent(detail.querySelector('.sans-lecteur'), 'ses lecteurs sont connus')
  })

  it('une déclaration que personne ne lit garde son « Aucun lecteur — déclaré mais jamais consommé. »', async () => {
    await c.click('.groupes section:nth-child(3) .variable:nth-child(2)')
    assert.equal(c.find('.groupes section:nth-child(3) .variable:nth-child(2) .sans-lecteur').textContent, 'Aucun lecteur — déclaré mais jamais consommé.')
  })

  it('armé, choisir une couleur sur une lecture repeint les pages mais n\'écrit rien, et le détail le dit', async () => {
    c.find('.bascule input').checked = true
    await c.fire('.bascule input', 'change')
    assert.ok(c.find('.precision.ecrit'), 'l\'interrupteur « Enregistrer dans le source » est allumé')
    await c.type('.groupes section:nth-child(1) .variable:nth-child(1) input.pastille', '#ff0000')
    assert.deepEqual(apercus.at(-1), { vars: { 'check-color': '#ff0000' } }, 'l\'aperçu en direct marche pour une lecture')
    assert.deepEqual(ecritures, [], 'une lecture n\'a pas de ligne où s\'écrire')
    const cible = c.find('.groupes section:nth-child(1) .variable:nth-child(1) .cible')
    assert.equal(cible.textContent, 'Aucune écriture possible : ce défaut n\'est pas une déclaration.')
  })
})
