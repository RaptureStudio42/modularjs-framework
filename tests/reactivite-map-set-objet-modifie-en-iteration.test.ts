// Un objet rangé dans une Map ou un Set d'état, modifié pendant un `forEach` ou une itération (`values()`,
// `entries()`, `keys()` d'un Set, `for…of`, décomposition), redessine le composant. Défaut garanti absent : seul
// `Map.get` rendait l'objet enveloppé — par les autres voies, il sortait brut, et sa modification ne
// prévenait personne (l'écran gardait l'ancienne valeur).
// Gardes : un élément d'un Set obtenu par itération se retrouve par `has` et se retire par `delete` ; une clé
// objet d'une Map sort telle quelle (`get`, `has`, `delete` la retrouvent).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const CARTE = [
  '<script>',
  "$m = new Map([['a', {n: 1}]])",
  '$s = new Set([{n: 1}])',
  'bump = ->',
  '  $m.forEach (v) -> v.n++',
  '  $s.forEach (v) -> v.n++',
  '</script>',
  "<p class=\"m\">{$m.get('a').n}</p><p class=\"s\">{[...$s][0].n}</p>",
  '<button class="b" @click={bump()}>b</button>',
].join('\n')

const GARDES = [
  '<script>',
  '$s = new Set([{n: 1}, {n: 2}])',
  'cle = {id: 1}',
  '$mk = new Map([[cle, {n: 1}]])',
  '</script>',
  '<p class="taille">{$s.size}</p><p class="mk">{$mk.size}</p>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('map-set-iteration')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'ms-carte.mjs'), CARTE)
  writeFileSync(join(srcDir, 'ms-gardes.mjs'), GARDES)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('état réactif — objet rangé dans une Map ou un Set, modifié pendant une itération', function () {
  this.timeout(60000)

  let app: any

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('`forEach` du script, sur une Map puis un Set : l\'écran suit', async () => {
    const c = await app.mount('ms-carte')
    try {
      await c.click('.b')
      assert.equal(c.state.m.get('a').n, 2)
      assert.equal(c.text('.m'), '2', 'Map : objet modifié dans forEach')
      assert.equal(c.text('.s'), '2', 'Set : objet modifié dans forEach')
    } finally {
      c.destroy()
    }
  })

  it('Map : `values()`, `for…of`, `entries()`, `forEach` hors du script : l\'écran suit à chaque fois', async () => {
    const c = await app.mount('ms-carte')
    try {
      const m = c.state.m
      for (const v of m.values()) v.n++
      await c.tick()
      assert.equal(c.text('.m'), '2', 'values()')
      for (const [, v] of m) v.n++
      await c.tick()
      assert.equal(c.text('.m'), '3', 'for…of')
      for (const [, v] of m.entries()) v.n++
      await c.tick()
      assert.equal(c.text('.m'), '4', 'entries()')
      m.forEach((v: any) => { v.n++ })
      await c.tick()
      assert.equal(c.text('.m'), '5', 'forEach')
    } finally {
      c.destroy()
    }
  })

  it('Set : `for…of`, `values()`, `keys()`, `entries()`, décomposition : l\'écran suit à chaque fois', async () => {
    const c = await app.mount('ms-carte')
    try {
      const s = c.state.s
      for (const v of s) v.n++
      await c.tick()
      assert.equal(c.text('.s'), '2', 'for…of')
      for (const v of s.values()) v.n++
      await c.tick()
      assert.equal(c.text('.s'), '3', 'values()')
      for (const v of s.keys()) v.n++
      await c.tick()
      assert.equal(c.text('.s'), '4', 'keys()')
      for (const [v] of s.entries()) v.n++
      await c.tick()
      assert.equal(c.text('.s'), '5', 'entries()')
      ;[...s][0].n++
      await c.tick()
      assert.equal(c.text('.s'), '6', 'décomposition')
    } finally {
      c.destroy()
    }
  })

  it('garde : un élément de Set obtenu par itération se retrouve (`has`) et se retire (`delete`) ; une clé objet de Map sort telle quelle', async () => {
    const c = await app.mount('ms-gardes')
    try {
      const s = c.state.s
      const premier = [...s][0]
      assert.equal(s.has(premier), true, 'has trouve l\'élément rendu par l\'itération')
      for (const v of s) s.delete(v)
      await c.tick()
      assert.equal(s.size, 0, 'delete retire chaque élément rendu par l\'itération')
      assert.equal(c.text('.taille'), '0')
      const mk = c.state.mk
      let cles = 0
      mk.forEach((v: any, k: any) => { cles++; assert.equal(mk.get(k).n, 1, 'get retrouve la valeur par la clé du forEach'); assert.equal(v.n, 1) })
      assert.equal(cles, 1)
      for (const [k] of mk) assert.equal(mk.has(k), true, 'has retrouve la clé de l\'itération')
      for (const k of mk.keys()) mk.delete(k)
      await c.tick()
      assert.equal(mk.size, 0, 'delete retire par la clé de l\'itération')
      assert.equal(c.text('.mk'), '0')
    } finally {
      c.destroy()
    }
  })
})
