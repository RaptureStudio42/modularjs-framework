// µinspect($x.chemin) : la PREMIÈRE écriture du chemin suivi s'affiche, avec sa vraie valeur d'avant ; les suivantes comme
// toujours — un affichage par changement, aucun quand la valeur du chemin ne change pas. Défaut garanti absent : la valeur d'avant
// de la première écriture se lisait dans une copie qui partageait l'objet écrit, égale à la valeur d'après, et rien ne s'affichait ;
// écrite par un nom, elle se lisait dans la copie du seul objet écrit, et « From » manquait

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterInspect } from './helpers/inspect-console.js'

const SOURCES = {
  field:  '<script lang="js">\n$o = {a: {b: 1, z: 0}};\nµinspect($o.a.b);\n@first = function() { $o.a.b = 2; };\n@second = function() { $o.a.b = 3; };\n@same = function() { $o.a.b = 3; };\n@other = function() { $o.a.z = 5; };\n</script>\n<p>{$o.a.b} {$o.a.z}</p>\n',
  object: '<script lang="js">\n$o = {a: {b: {c: 0}}};\nµinspect($o.a.b);\n@first = function() { $o.a.b.c = 7; };\n@second = function() { $o.a.b.c = 8; };\n</script>\n<p>{$o.a.b.c}</p>\n',
  byname: '<script lang="js">\n$o = {a: {b: 1}};\nµinspect($o.a.b);\n@first = function() { const t = $o.a; t.b = 2; };\n@second = function() { const t = $o.a; t.b = 3; };\n</script>\n<p>{$o.a.b}</p>\n',
}

const G = '🔍 [MJS Inspect] o.a.b'
const J = JSON.stringify

describe('µinspect($x.chemin) — la première écriture du chemin s\'affiche', function () {
  this.timeout(60000)
  let page: any
  before(async () => { page = await monterInspect('inspect-chemin-premiere', SOURCES) })
  after(async () => {
    page?.window.close()
    await terminateSharedWorkerPool()
  })

  it('un champ : la première écriture, la suivante ; rien pour la même valeur ni pour un autre champ', async () => {
    assert.deepEqual(await page.jouer('field', 'first', 'second', 'same', 'other'), [G, 'From 1', 'To 2', G, 'From 2', 'To 3'])
  })

  it('un objet écrit en place sous le chemin : $o.a.b.c = 7 puis 8', async () => {
    assert.deepEqual(await page.jouer('object', 'first', 'second'), [G, 'From ' + J({ c: 0 }), 'To ' + J({ c: 7 }), G, 'From ' + J({ c: 7 }), 'To ' + J({ c: 8 })])
  })

  it('écrit par un nom : t = $o.a ; t.b = 2', async () => {
    assert.deepEqual(await page.jouer('byname', 'first', 'second'), [G, 'From 1', 'To 2', G, 'From 2', 'To 3'])
  })
})
