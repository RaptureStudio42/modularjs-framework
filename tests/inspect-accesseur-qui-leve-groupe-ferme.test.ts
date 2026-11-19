// µinspect($x) sur une valeur dont un accesseur lève, à deux niveaux sous la racine : « From » et « To » s'affichent avec l'erreur à la
// place de l'accesseur, et chaque groupe ouvert se ferme ; une erreur rangée dans l'état se montre telle quelle, avec son message. Défaut garanti absent : la copie profonde levait au milieu de l'affichage,
// après l'ouverture du groupe — rien d'affiché, et un groupe laissé ouvert à chaque écriture, où se rangeait toute la console d'après

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterInspect } from './helpers/inspect-console.js'

const SOURCES = {
  getter: "<script lang=\"js\">\n$o = {n: 0, err: new Error('e1'), a: {get boom() { throw new Error('boum'); }}};\nµinspect($o);\n@first = function() { $o.n = 1; };\n@second = function() { $o.n = 2; };\n</script>\n<p>{$o.n}</p>\n",
}

const G = '🔍 [MJS Inspect] o'

describe('µinspect($x) — un accesseur qui lève ne coupe pas l\'affichage', function () {
  this.timeout(60000)
  let page: any
  before(async () => {
    page = await monterInspect('inspect-accesseur-leve', SOURCES)
    page.window.eval('globalThis.__fins = 0; console.groupEnd = function() { __fins++; };')
  })
  after(async () => {
    page?.window.close()
    await terminateSharedWorkerPool()
  })

  it('deux écritures : deux groupes complets, deux fermés, l\'erreur à la place de l\'accesseur', async () => {
    const lu = await page.jouer('getter', 'first', 'second')
    assert.deepEqual(lu, [G, 'From {"n":0,"err":{},"a":{"boom":{}}}', 'To {"n":1,"err":{},"a":{"boom":{}}}', G, 'From {"n":1,"err":{},"a":{"boom":{}}}', 'To {"n":2,"err":{},"a":{"boom":{}}}'])
    assert.equal(page.window.eval('__fins'), 2)
    // l'erreur elle-même, lisible dans la console (son message, sa pile)
    assert.equal(page.window.eval("__inspect[1][1].a.boom.message + ' ' + typeof __inspect[1][1].a.boom.stack"), 'boum string')
    // une erreur rangée dans l'état est montrée telle quelle, pas en objet vide
    assert.equal(page.window.eval("__inspect[1][1].err.message + ' ' + __inspect[2][1].err.message"), 'e1 e1')
    assert.equal(page.window.eval("document.querySelector('mjs-getter')._state.o.n"), 2)
  })
})
