// Une écriture profonde dont une clé est une expression régulière (`$$box[/a/] = 1`) ou un BigInt (`$box.o[5n] = 1`) : le chemin
// compilé porte la clé que le moteur lit, son texte (`'/a/gi'`, drapeaux dans l'ordre du moteur) ou ses chiffres en base dix (`'16'`
// pour `0x10n`). Une expression régulière disparaissait du chemin (l'écriture visait l'objet parent, voire la clé entière du
// magasin) ; un BigInt arrêtait la compilation (« Do not know how to serialize a BigInt »).

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const compiler = async (nom: string, ligne: string, etat = '$$box = {}') => (await transpile(`<script>\n  ${etat}\n  @f = -> ${ligne}\n</script>\n<p>ok</p>`, { moduleName: nom })).output

describe('écriture profonde : une clé expression régulière ou BigInt garde sa place dans le chemin', () => {
  it('magasin : écriture, suppression, appel', async () => {
    assert.match(await compiler('clechemin1', '$$box[/a/ig] = 1'), /µ\._mjs_storeDeepSet\("box", \["\/a\/gi"\], /)
    assert.match(await compiler('clechemin2', '$$box[0x10n] = 1'), /µ\._mjs_storeDeepSet\("box", \["16"\], /)
    assert.match(await compiler('clechemin3', 'delete $$box.a[/b/]'), /µ\._mjs_storeDeepDelete\("box", \["a", "\/b\/"\]\)/)
    assert.match(await compiler('clechemin4', '$$box.a[1n].push(2)'), /µ\._mjs_storeDeepCall\("box", \["a", "1"/)
  })

  it('état local : écriture profonde', async () => {
    assert.match(await compiler('clechemin5', '$box.o[/a/] = 1', '$box = { o: {} }'), /µ\._mjs_deepSet\(_mjsThis, \["box", "o", "\/a\/"\], 1\)/)
    assert.match(await compiler('clechemin6', '$box.o[5n] = 1', '$box = { o: {} }'), /µ\._mjs_deepSet\(_mjsThis, \["box", "o", "5"\], 1\)/)
  })

  it('la clé que le moteur lit est bien ce texte', () => {
    const o: Record<string, number> = {}
    o[/a/ig as any] = 1
    o[0x10n as any] = 2
    assert.deepEqual(Object.keys(o).sort(), ['/a/gi', '16'].sort())
  })
})
