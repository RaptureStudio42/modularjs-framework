// `{for}` imbriqué dont la liste parente est identifiée par un champ qui vaut un OBJET (`by ref`,
// `ref` étant un objet ordinaire) : l'identifiant du cache de la liste interne recollait la clé du
// parent en texte — « [object Object] » pour toutes les lignes. Les listes internes de deux lignes
// différentes partageaient alors le même cache : les éléments de l'une passaient dans l'autre.
// La liste elle-même reconnaît un tel objet par son identité (docs/05-blocs.md) ; la liste
// interne doit faire de même. Une clé qui s'écrit elle-même (date) reste lue par son texte.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const CLE_OBJET = [
  '<script>',
  'a = { n: 1 }',
  'b = { n: 2 }',
  '$rows = [{ ref: a, enfants: ["x", "y"] }, { ref: b, enfants: ["z"] }]',
  'ajouter = -> $rows[1].enfants.push("w")',
  'inverser = -> $rows = [$rows[1], $rows[0]]',
  '</script>',
  '<button class="ajouter" @click={ajouter()}>+</button>',
  '<button class="inverser" @click={inverser()}>inverser</button>',
  '{for row in $rows by ref}',
  '  <ul class="r">{for nom in row.enfants}<li>{nom}</li>{end}</ul>',
  '{end}',
].join('\n')

const CLE_DATE = [
  '<script>',
  '$rows = [{ jour: new Date(0), enfants: ["x", "y"] }, { jour: new Date(86400000), enfants: ["z"] }]',
  'refaire = -> $rows = $rows.map((r) -> ({ jour: new Date(r.jour.getTime()), enfants: [...r.enfants, "n"] }))',
  '</script>',
  '<button class="refaire" @click={refaire()}>refaire</button>',
  '{for row in $rows by jour}',
  '  <ul class="r">{for nom in row.enfants}<li>{nom}</li>{end}</ul>',
  '{end}',
].join('\n')

const listes = (c: any): string[] => c.findAll('ul.r').map((ul: any) => [...ul.querySelectorAll('li')].map((li: any) => li.textContent).join(','))

describe('{for} imbriqué sous une liste identifiée par un objet (`by` sur un champ objet)', function () {
  this.timeout(60000)

  let root: string
  let app: any

  before(async () => {
    root = mjsTmp('for-cle-objet')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'cle-objet.mjs'), CLE_OBJET)
    writeFileSync(join(srcDir, 'cle-date.mjs'), CLE_DATE)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    app = await createHarness({ root })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('chaque ligne garde SES éléments au premier rendu', async () => {
    const c = await app.mount('cle-objet')
    try {
      assert.deepEqual(listes(c), ['x,y', 'z'])
    } finally {
      c.destroy()
    }
  })

  it('un ajout dans une ligne ne touche pas l\'autre', async () => {
    const c = await app.mount('cle-objet')
    try {
      await c.click('.ajouter')
      assert.deepEqual(listes(c), ['x,y', 'z,w'])
    } finally {
      c.destroy()
    }
  })

  it('les lignes réordonnées gardent chacune leurs éléments', async () => {
    const c = await app.mount('cle-objet')
    try {
      await c.click('.inverser')
      assert.deepEqual(listes(c), ['z', 'x,y'])
    } finally {
      c.destroy()
    }
  })

  it('clé date (lue par son texte) : nouveaux objets de même date, aucun élément en double', async () => {
    const c = await app.mount('cle-date')
    try {
      assert.deepEqual(listes(c), ['x,y', 'z'])
      await c.click('.refaire')
      assert.deepEqual(listes(c), ['x,y,n', 'z,n'])
    } finally {
      c.destroy()
    }
  })
})
