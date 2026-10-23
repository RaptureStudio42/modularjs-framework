// `{for}` imbriqué sous une liste dont la clé `by` est un objet GELÉ (`Object.freeze`), ou dont les éléments sont
// gelés : un objet gelé ne peut pas recevoir la marque qui l'identifie d'un rendu à l'autre, et il recevait un
// identifiant neuf à chaque passe. La liste interne changeait donc de cache à chaque rendu : ses éléments
// s'affichaient EN DOUBLE sous une clé gelée (« x,y,x,y »), et les lignes d'éléments gelés étaient refaites à
// chaque réaffectation de la liste. Un objet gelé garde maintenant le même identifiant, comme les autres.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const CLE_GELEE = [
  '<script>',
  'a = Object.freeze({ n: 1 })',
  'b = Object.freeze({ n: 2 })',
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

const ELEMENTS_GELES = [
  '<script>',
  '$rows = [Object.freeze({ nom: "a" }), Object.freeze({ nom: "b" })]',
  '$noms = ["x", "y"]',
  'refaire = -> $rows = [...$rows]',
  'ajouter = -> $noms.push("w")',
  '</script>',
  '<button class="refaire" @click={refaire()}>refaire</button>',
  '<button class="ajouter" @click={ajouter()}>+</button>',
  '{for row in $rows}',
  '  <ul class="r">{for nom in $noms}<li>{row.nom}{nom}</li>{end}</ul>',
  '{end}',
].join('\n')

const listes = (c: any): string[] => c.findAll('ul.r').map((ul: any) => [...ul.querySelectorAll('li')].map((li: any) => li.textContent).join(','))

describe('{for} imbriqué sous une clé `by` gelée ou des éléments gelés', function () {
  this.timeout(60000)

  let app: any

  before(async () => {
    const root   = mjsTmp('for-geles')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'cle-gelee.mjs'), CLE_GELEE)
    writeFileSync(join(srcDir, 'elements-geles.mjs'), ELEMENTS_GELES)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    app = await createHarness({ root })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('clé gelée : un ajout dans une ligne n\'affiche rien en double', async () => {
    const c = await app.mount('cle-gelee')
    try {
      assert.deepEqual(listes(c), ['x,y', 'z'])
      await c.click('.ajouter')
      assert.deepEqual(listes(c), ['x,y', 'z,w'])
      await c.click('.inverser')
      assert.deepEqual(listes(c), ['z,w', 'x,y'])
    } finally {
      c.destroy()
    }
  })

  it('éléments gelés : la liste réaffectée garde ses lignes, la liste interne suit', async () => {
    const c = await app.mount('elements-geles')
    try {
      const avant = c.findAll('ul.r')
      await c.click('.refaire')
      const apres = c.findAll('ul.r')
      assert.equal(apres.length, 2)
      assert.ok(avant[0] === apres[0] && avant[1] === apres[1], 'les lignes d\'éléments gelés ont été refaites')
      await c.click('.ajouter')
      assert.deepEqual(listes(c), ['ax,ay,aw', 'bx,by,bw'])
    } finally {
      c.destroy()
    }
  })
})
