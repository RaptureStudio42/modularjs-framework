// Un objet GELÉ (`Object.freeze`) rangé dans l'état, qui contient un objet, un tableau ou une méthode : la règle des
// Proxy JavaScript veut qu'une propriété non modifiable et non configurable rende SA valeur à la lecture. L'enveloppe
// réactive rendait une enveloppe (ou une méthode liée) à la place : le moteur levait une erreur à la lecture, et le
// composant n'affichait rien, sans rien dire. Une propriété figée se lit maintenant brute, en lecture seule, que l'objet
// soit gelé avant d'entrer dans l'état ou après ; un objet scellé ou fermé aux ajouts, dont les propriétés restent
// modifiables, reste suivi comme avant.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string[]> = {
  'gel-elements': [
    '$rows = [Object.freeze({ nom: "a", enfants: ["x", "y"], info: { v: 1 } })]',
    '{for row in $rows}<p class="v">{row.nom}-{row.info.v}</p><ul>{for nom in row.enfants}<li>{nom}</li>{end}</ul>{end}',
  ],
  'gel-variable': [
    '$cfg = Object.freeze({ a: { b: 1 }, l: [1, 2] })',
    '<p class="v">{$cfg.a.b}</p><ul>{for x in $cfg.l}<li>{x}</li>{end}</ul>',
  ],
  'gel-liste': [
    '$l = Object.freeze([{ n: 1 }, { n: 2 }])',
    '<ul>{for x in $l}<li>{x.n}</li>{end}</ul>',
  ],
  'gel-methode': [
    '$o = Object.freeze({ n: 2, double() { return this.n * 2 } })',
    '<p class="v">{$o.double()}</p>',
  ],
  'gel-apres-coup': [
    '$o = { a: { b: 1 } }\n$n = 0\ngeler = -> Object.freeze($o)',
    '<p class="v">{$n + $o.a.b}</p><button class="g" @click={geler()}>g</button><button class="i" @click={$n++}>i</button>',
  ],
  'gel-propriete-figee': [
    '$d = Object.preventExtensions(Object.defineProperty({}, "a", { value: { b: 1 }, enumerable: true }))',
    '<p class="v">{$d.a.b}</p>',
  ],
  'gel-scelle': [
    '$s = Object.seal({ a: { b: 1 } })\nbump = (o) -> o.b++',
    '<p class="v">{$s.a.b}</p><button class="i" @click={bump($s.a)}>i</button>',
  ],
  'gel-ferme-aux-ajouts': [
    '$s = Object.preventExtensions({ a: { b: 1 } })\nbump = (o) -> o.b++',
    '<p class="v">{$s.a.b}</p><button class="i" @click={bump($s.a)}>i</button>',
  ],
}

// ce que montre le composant : les paragraphes `.v`, puis les éléments de liste
const vu = (c: any): string => c.findAll('p.v').map((p: any) => p.textContent).join('|') + ' / ' + c.findAll('li').map((li: any) => li.textContent).join(',')

describe('objet gelé dans l\'état d\'un composant', function () {
  this.timeout(60000)

  let app: any

  before(async () => {
    const root   = mjsTmp('objet-gele')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, [script, gabarit]] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom + '.mjs'), ['<script>', script, '</script>', gabarit].join('\n'))
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    app = await createHarness({ root })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  const monter = async (nom: string, jeu: (c: any) => Promise<void>) => {
    const c = await app.mount(nom)
    try {
      await jeu(c)
    } finally {
      c.destroy()
    }
  }

  it('éléments gelés d\'une liste : un champ profond et un `{for}` sur un tableau imbriqué s\'affichent', () => monter('gel-elements', async (c) => {
    assert.equal(vu(c), 'a-1 / x,y')
  }))

  it('variable d\'état gelée : objet et tableau imbriqués lus', () => monter('gel-variable', async (c) => {
    assert.equal(vu(c), '1 / 1,2')
  }))

  it('liste gelée : ses éléments s\'affichent', () => monter('gel-liste', async (c) => {
    assert.equal(vu(c), ' / 1,2')
  }))

  it('méthode d\'un objet gelé : appelée', () => monter('gel-methode', async (c) => {
    assert.equal(vu(c), '4 / ')
  }))

  it('objet gelé après son entrée dans l\'état : toujours lu au rendu suivant', () => monter('gel-apres-coup', async (c) => {
    assert.equal(vu(c), '1 / ')
    await c.click('.g')
    await c.click('.i')
    assert.equal(vu(c), '2 / ')
  }))

  it('objet fermé aux ajouts avec une propriété définie non modifiable : lue', () => monter('gel-propriete-figee', async (c) => {
    assert.equal(vu(c), '1 / ')
  }))

  for (const nom of ['gel-scelle', 'gel-ferme-aux-ajouts']) {
    it(`${nom === 'gel-scelle' ? 'objet scellé' : 'objet fermé aux ajouts'} : toujours suivi, même modifié par un alias`, () => monter(nom, async (c) => {
      assert.equal(vu(c), '1 / ')
      await c.click('.i')
      assert.equal(vu(c), '2 / ')
    }))
  }
})
