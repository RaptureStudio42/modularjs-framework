// Une liste rangée DANS un objet d'état (`$o = {list: $items.filter(…)}`, `$o = {list: [...$items]}`, et plus bas
// encore) y est rangée telle quelle, avec l'objet : ni copiée ni parcourue, elle garde les enveloppes réactives qu'elle
// a reçues. Sa recherche par un élément (`indexOf`, `includes`, `lastIndexOf`) ne les y retrouve donc pas — limite
// écrite à la page 03 (réactivité) : on la cherche par une donnée (`(x) -> x.n == 'b'`) ou par l'élément relu dans la
// liste (`(x) -> x == $o.list[2]`). Une liste affectée à sa propre variable, elle, range ses éléments bruts et les
// retrouve. Gardes : l'objet de l'auteur n'est jamais modifié (il peut être gelé, il garde ce qu'il tenait), et une
// écriture faite par la liste rangée dans l'objet redessine toujours ce qui affiche la liste d'origine.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const LISTE = [
  '<script>',
  "$items = [{n: 'a'}, {n: 'b'}, {n: 'c'}]",
  '$o = null',
  '$o2 = null',
  '$o3 = null',
  '$o4 = null',
  '$l = null',
  '$r = {}',
  'filtre = ->',
  '  $o = {list: $items.filter(-> true)}',
  "  $r.f = [$o.list.indexOf($items[0]), $o.list.includes($items[1]), $o.list.lastIndexOf($items[2]), $o.list.indexOf($o.list[0])].join(',')",
  "  $r.d = [$o.list.findIndex((x) -> x.n == 'b'), $o.list.findIndex((x) -> x == $o.list[2]), $o.list.some((x) -> x == $items[0])].join(',')",
  'copie = ->',
  '  $o2 = {list: [...$items]}',
  "  $r.c = [$o2.list.indexOf($items[1]), $o2.list.findIndex((x) -> x.n == 'b')].join(',')",
  'profond = ->',
  '  $o3 = {a: {b: [$items[2]]}, n: 1}',
  "  $r.p = [$o3.a.b.indexOf($items[2]), $o3.a.b.findIndex((x) -> x == $items[2])].join(',')",
  'propre = ->',
  '  $l = $items.filter(-> true)',
  "  $r.l = [$l.indexOf($items[0]), $l.includes($items[1]), $l.lastIndexOf($items[2])].join(',')",
  'gele = ->',
  '  src = Object.freeze({list: Object.freeze($items.filter(-> true))})',
  '  $o4 = src',
  "  $r.g = [$o4.list.indexOf($items[1]), Object.isFrozen(src), src.list[1] == $items[1]].join(',')",
  'renommer = ->',
  "  $o.list[0].n = 'Z'",
  '</script>',
  "<ul>{for it in $items}<li>{it.n}</li>{end}</ul>",
  '<button class="f" @click={filtre()}>f</button><button class="c" @click={copie()}>c</button>',
  '<button class="p" @click={profond()}>p</button><button class="g" @click={gele()}>g</button>',
  '<button class="l" @click={propre()}>l</button>',
  '<button class="r" @click={renommer()}>r</button>',
].join('\n')

function projet(): string {
  const root = mjsTmp('liste-dans-objet')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'lo-liste.mjs'), LISTE + '\n')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
  return root
}

describe('état réactif — une liste rangée dans un objet garde les enveloppes reçues', function () {
  this.timeout(60000)
  let app: any
  before(async () => { app = await createHarness({ root: projet() }) })
  after(async () => { if (app) await app.destroy() })

  it('`{list: $items.filter(…)}` : indexOf, includes et lastIndexOf ne retrouvent pas l\'élément ; une donnée ou l\'élément relu, si', async () => {
    const c = await app.mount('lo-liste')
    try {
      await c.click('.f')
      assert.equal(c.state.r.f, '-1,false,-1,-1', 'la liste tient les enveloppes reçues, même l\'élément relu ne s\'y retrouve pas')
      assert.equal(c.state.r.d, '1,2,true', 'par une donnée, par l\'élément relu dans la liste')
    }
    finally {
      c.destroy()
    }
  })

  it('`{list: [...$items]}` et une liste rangée plus bas (`{a: {b: [x]}}`) : même règle', async () => {
    const c = await app.mount('lo-liste')
    try {
      await c.click('.c')
      await c.click('.p')
      assert.equal(c.state.r.c, '-1,1', '{list: [...$items]}')
      assert.equal(c.state.r.p, '-1,0', '{a: {b: [$items[2]]}}')
    }
    finally {
      c.destroy()
    }
  })

  it('une liste affectée à sa propre variable range ses éléments bruts et les retrouve', async () => {
    const c = await app.mount('lo-liste')
    try {
      await c.click('.l')
      assert.equal(c.state.r.l, '0,true,2')
    }
    finally {
      c.destroy()
    }
  })

  it('un objet gelé de l\'auteur est rangé sans erreur et reste tel quel', async () => {
    const c = await app.mount('lo-liste')
    try {
      await c.click('.g')
      assert.equal(c.state.r.g, '1,true,true')
    }
    finally {
      c.destroy()
    }
  })

  it('une écriture faite par la liste rangée dans l\'objet redessine la liste d\'origine', async () => {
    const c = await app.mount('lo-liste')
    try {
      await c.click('.f')
      await c.click('.r')
      assert.deepEqual(c.findAll('li').map((l: any) => l.textContent), ['Z', 'b', 'c'])
    }
    finally {
      c.destroy()
    }
  })
})
