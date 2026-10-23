// theme-viewer — les variables que le composant POSE lui-même (`set: true` au registre) ont un groupe à part, replié ;
// et quelques détails que l'atelier disait de travers.
//
// Ce que la suite tient :
//   1. une source dont des variables sont posées a, en plus de son groupe ordinaire, un groupe « posées par le composant »,
//      replié, en lecture seule, sans sélecteur de couleur, qui dit ce qu'il en est ;
//   2. un composant qui a des lectures ET des déclarations a deux groupes, jamais un groupe mélangé ;
//   3. les compteurs de l'en-tête et le bouton « Rétablir » s'accordent au singulier ;
//   4. une déclaration de CSS brut, dont la ligne est inconnue, ne dit ni « ligne 0 » ni « fichier:0 » ;
//   5. deux déclarations d'un même nom dans un même fichier sont deux lignes, que l'on déplie une à une.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { localizeViewerSource } from '../src/server/viewer-page.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ICI    = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(ICI, '..', 'src', 'server', 'theme-viewer.mjs')

const decl = (declaredBy: string, file: string, value: string, line: number, extra: object = {}) => ({ value, declaredBy, kind: 'module', variant: '', file, line, doc: '', ...extra })

const CAROUSEL = 'src/core-modules/carousel.mjs'
const FIELD    = 'src/core-modules/field.mjs'

// le carrousel lit une ombre (valeur par défaut) et pose ses positions ; le cube pose un indice sur un élément interne ;
// le champ lit une couleur ET déclare un espacement dans son propre CSS ; l'application déclare `gap` (ligne 2) et une
// variable de CSS brut (ligne inconnue)
const REGISTRE = {
  'carousel-shadow': { declarations: [decl('core-carousel', CAROUSEL, '0 0 50px red', 0, { read: true })], readBy: ['core-carousel'] },
  'carousel-x':      { declarations: [decl('core-carousel', CAROUSEL, '0', 0, { read: true, set: true })], readBy: ['core-carousel'] },
  'carousel-z':      { declarations: [decl('core-carousel', CAROUSEL, '1', 0, { read: true, set: true })], readBy: ['core-carousel'] },
  'cube-i':          { declarations: [decl('core-cube', 'src/core-modules/cube.mjs', '1', 0, { set: true })], readBy: ['core-cube'] },
  'field-ok-color':  { declarations: [decl('core-field', FIELD, '#2e9e5b', 0, { read: true })], readBy: ['core-field'] },
  'field-pad':       { declarations: [decl('core-field', FIELD, '8px', 12)], readBy: [] },
  gap:               { declarations: [decl('hote', 'src/hote.mjs', '12px', 2)], readBy: [] },
  'sans-ligne':      { declarations: [decl('hote', 'src/hote.mjs', '3px', 0)], readBy: [] },
}

// un seul nom déclaré trois fois dans le même fichier (les trois règles d'un module du framework)
const REGISTRE_TROIS = {
  'toast-color': {
    declarations: [
      { value: '#111', declaredBy: 'framework', kind: 'framework', variant: '', file: 'mjs_modal.ts', line: 10, doc: '' },
      { value: '#222', declaredBy: 'framework', kind: 'framework', variant: '', file: 'mjs_modal.ts', line: 20, doc: '' },
      { value: '#333', declaredBy: 'framework', kind: 'framework', variant: '', file: 'mjs_modal.ts', line: 30, doc: '' },
    ],
    readBy: [],
  },
}

// une seule variable, déclarée par l'application : ni valeur par défaut ni lecteur
const REGISTRE_SEUL = { gap: { declarations: [decl('hote', 'src/hote.mjs', '12px', 2)], readBy: [] } }

// un seul nom déclaré par l'application, un seul lu par un composant
const REGISTRE_UN = {
  ton:           { declarations: [decl('hote', 'src/hote.mjs', '#3b82f6', 2)], readBy: [] },
  'check-color': { declarations: [decl('core-checkbox', 'src/core-modules/checkbox.mjs', '#ffffff', 0, { read: true })], readBy: ['core-checkbox'] },
}

function projetTemporaire(): string {
  const root   = mjsTmp('theme-viewer-posees')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'tst-thpo-atelier.mjs'), localizeViewerSource(readFileSync(SOURCE, 'utf-8')))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

// monte l'atelier sur un registre, avec un `fetch` qui répond ce registre
async function monter(registre: object) {
  const app   = await createHarness({ root: projetTemporaire() })
  const avant = (globalThis as any).fetch
  const json  = (v: any) => ({ json: async () => v })
  const faux  = async (url: string, init?: any) => {
    if (url === '/__mjs/theme.json') return json(registre)
    if (url === '/__mjs/theme/edit') return json({ live: true, clients: 1 })
    if (url === '/__mjs/theme/write') return json({ written: true, file: JSON.parse(init.body).file, line: JSON.parse(init.body).line })
    throw new Error('URL inattendue : ' + url)
  }
  ;(globalThis as any).fetch = faux
  app.window.fetch = faux
  const c = await app.mount('tst-thpo-atelier')
  await c.tick()
  await c.tick()
  const fermer = async () => {
    ;(globalThis as any).fetch = avant
    c.destroy()
    await app.destroy()
  }
  return { c, fermer }
}

describe('theme-viewer.mjs — variables posées par le composant, singulier, ligne inconnue', function () {
  this.timeout(60000)

  describe('le registre des modules du cœur', () => {
    let c: any
    let fermer: () => Promise<void>
    const texte = (selecteur: string) => c.findAll(selecteur).map((n: any) => n.textContent)

    before(async () => { ({ c, fermer } = await monter(REGISTRE)) })
    after(async () => { await fermer() })

    it('le compte en tête met les variables posées à part', () => {
      assert.deepEqual(texte('.stat'), ['6 sources', '8 variables', '3 déclarations', '2 valeurs par défaut de composants', '3 variables posées par le composant', '5 variables lues par au moins un composant'])
    })

    it('chaque source a ses groupes : valeurs par défaut, posées, déclarations — les posées sont repliées, en lecture seule', () => {
      assert.deepEqual(texte('.tete .source'), ['core-carousel', 'core-carousel', 'core-cube', 'core-field', 'core-field', 'hote'])
      assert.deepEqual(texte('.tete .variante'), ['valeurs par défaut', 'posées par le composant', 'posées par le composant', 'valeurs par défaut'])
      assert.equal(c.findAll('.tete .lecture-seule').length, 4, 'les deux groupes de valeurs par défaut et les deux groupes de variables posées')
      assert.deepEqual(c.findAll('.tete .plier').map((n: any) => n.getAttribute('aria-expanded')), ['false', 'false'], 'seuls les groupes de variables posées se plient, repliés au départ')
      assert.deepEqual(texte('.variable .nom'), ['carousel-shadow', 'field-pad', 'field-ok-color', 'gap', 'sans-ligne'], 'les variables posées ne sont pas listées tant que leur groupe est replié')
    })

    it('un composant qui lit et déclare a deux groupes, jamais un groupe mélangé', () => {
      const groupes = c.findAll('.groupe').filter((g: any) => g.querySelector('.source').textContent === 'core-field')
      assert.equal(groupes.length, 2)
      const noms = groupes.map((g: any) => [...g.querySelectorAll('.nom')].map((n: any) => n.textContent))
      assert.deepEqual(noms, [['field-pad'], ['field-ok-color']])
      assert.deepEqual(groupes.map((g: any) => g.querySelector('.variante')?.textContent ?? ''), ['', 'valeurs par défaut'])
    })

    it('déplier un groupe de variables posées en montre les lignes, sans sélecteur de couleur, et dit qui les pose', async () => {
      await c.click('.groupes section:nth-child(2) .plier')
      assert.equal(c.find('.groupes section:nth-child(2) .plier').getAttribute('aria-expanded'), 'true')
      assert.deepEqual(c.findAll('.groupes section:nth-child(2) .nom').map((n: any) => n.textContent), ['carousel-x', 'carousel-z'])
      assert.deepEqual(c.findAll('.groupes section:nth-child(2) .ligne .emplacement').map((n: any) => n.textContent), ['par défaut', 'par défaut'])
      assert.equal(c.findAll('.groupes section:nth-child(2) input.pastille').length, 0, 'pas de sélecteur de couleur : le composant remet sa valeur')
      await c.click('.groupes section:nth-child(2) .variable:nth-child(1)')
      const detail = c.find('.groupes section:nth-child(2) .variable:nth-child(1) .detail')
      assert.match(detail.textContent, /core-carousel pose cette variable lui-même, dans son script, son gabarit ou son CSS : ce que vous déclarez dessus peut ne rien changer\./)
      assert.doesNotMatch(detail.textContent, /Aucun lecteur|Pour la régler/)
      assert.deepEqual([...detail.querySelectorAll('.lecteur')].map((n: any) => n.textContent), ['core-carousel'])
    })

    it('une variable posée sur un élément interne (une déclaration, pas une lecture) dit sa ligne inconnue', async () => {
      await c.click('.groupes section:nth-child(3) .plier')
      assert.deepEqual(c.findAll('.groupes section:nth-child(3) .ligne .emplacement').map((n: any) => n.textContent), ['ligne inconnue'])
    })

    it('une déclaration de CSS brut dit « ligne inconnue », jamais « ligne 0 », et sa cible d\'enregistrement n\'a pas de « :0 »', async () => {
      assert.deepEqual(texte('.groupes section:nth-child(6) .ligne .emplacement'), ['ligne 2', 'ligne inconnue'])
      c.find('.bascule input').checked = true
      await c.fire('.bascule input', 'change')
      await c.click('.groupes section:nth-child(6) .variable:nth-child(1)')
      await c.click('.groupes section:nth-child(6) .variable:nth-child(2)')
      const cibles = c.findAll('.groupes section:nth-child(6) .cible').map((n: any) => n.textContent)
      assert.deepEqual(cibles, ['Enregistrement vers src/hote.mjs:2', 'Enregistrement vers src/hote.mjs — ligne cherchée dans le fichier'])
    })

    it('la cible d\'une variable posée dit qu\'aucune écriture n\'est possible', async () => {
      await c.click('.groupes section:nth-child(3) .variable:nth-child(1)')
      assert.equal(c.find('.groupes section:nth-child(3) .cible').textContent, 'Aucune écriture possible : cette variable est posée par le composant.')
    })
  })

  describe('les compteurs au singulier', () => {
    let c: any
    let fermer: () => Promise<void>
    before(async () => { ({ c, fermer } = await monter(REGISTRE_UN)) })
    after(async () => { await fermer() })

    it('un seul de chaque : pas de « s » de trop', () => {
      assert.deepEqual(c.findAll('.stat').map((n: any) => n.textContent), ['2 sources', '2 variables', '1 déclaration', '1 valeur par défaut de composant', '1 variable lue par au moins un composant'])
    })

    it('une seule variable, rien d\'autre : « 1 variable », « 0 valeur par défaut de composant »', async () => {
      const seul = await monter(REGISTRE_SEUL)
      try {
        assert.deepEqual(seul.c.findAll('.stat').map((n: any) => n.textContent), ['1 source', '1 variable', '1 déclaration', '0 valeur par défaut de composant', '0 variable lue par au moins un composant'])
      }
      finally { await seul.fermer() }
    })

    it('« Rétablir » s\'accorde : une couleur modifiée, puis deux', async () => {
      await c.type('.groupes section:nth-child(1) input.pastille', '#ff0000')
      assert.equal(c.find('.retablir-tout').textContent.trim(), 'Rétablir la couleur modifiée')
      await c.type('.groupes section:nth-child(2) input.pastille', '#00ff00')
      assert.equal(c.find('.retablir-tout').textContent.trim(), 'Rétablir les 2 couleurs modifiées')
    })
  })

  describe('deux déclarations d\'un même nom dans un même fichier', () => {
    let c: any
    let fermer: () => Promise<void>
    before(async () => { ({ c, fermer } = await monter(REGISTRE_TROIS)) })
    after(async () => { await fermer() })

    it('sont trois lignes, que l\'on déplie une à une', async () => {
      assert.equal(c.findAll('.variable').length, 3)
      await c.click('.groupes section:nth-child(1) .variable:nth-child(2)')
      const ouverts = c.findAll('.variable').map((n: any) => n.querySelector('.detail') ? 'ouvert' : 'fermé')
      assert.deepEqual(ouverts, ['fermé', 'ouvert', 'fermé'], 'la ligne cliquée s\'ouvre, pas une autre')
      await c.click('.groupes section:nth-child(1) .variable:nth-child(3)')
      assert.deepEqual(c.findAll('.variable').map((n: any) => n.querySelector('.detail') ? 'ouvert' : 'fermé'), ['fermé', 'ouvert', 'ouvert'])
    })
  })
})
