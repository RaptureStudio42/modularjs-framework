// valeur mêlée de texte fixe sur la balise d'un composant : `value` (`<@@option value="0{x.n}">`, `value="0{$a}"`) va à la prop d'un composant
// qui déclare `$value`, sans accesseur `value` propre, comme `value={…}` ; les autres attributs (titre, style, part, balise tierce) restent écrits en attribut, et la ligne de {for}
// garde sa garde
import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const P = "<script>\n$a = 1\n$n = 1\n$nom = 'Ana'\n$col = 'blue'\n$v = '05'\n$rows = [{ id: 1, n: 5 }]\n</script>\n"

async function code(src: string, nom: string): Promise<string> {
  const r: any = await transpile(P + src, { moduleName: nom })
  return String(r.output)
}

const GARDE_FOR = /if\(this\._mjs_chg\(\['rows'\]\)\) this\._mjs_updFor/

describe('valeur mêlée sur la balise d\'un composant', () => {
  it('<@@option value="0{$a}"> hors boucle : la valeur va à la prop de l\'option', async () => {
    const js = await code('<@@select name="pick" value={$v}><@@option value="0{$a}">M</@@option></@@select>', 'vm1')
    assert.match(js, /_set\('value', __mjsV\)/)
  })

  it('<@@option value="0{x.n}"> dans un {for} : la valeur va à la prop, la ligne garde sa garde', async () => {
    const js = await code('<@@select name="pick" value={$v}>{for x in $rows by id}<@@option value="0{x.n}">L</@@option>{end}</@@select>', 'vm2')
    assert.match(js, /_set\('value', __mjsV\)/)
    assert.match(js, GARDE_FOR)
  })

  it('VALUE en majuscules, value="{$a}" et value="$a" suivent la même règle que value="0{$a}"', async () => {
    for (const [nom, attr] of [['vm6', 'VALUE="0{$a}"'], ['vm7', 'value="{$a}"'], ['vm8', 'value="$a"']]) {
      const js = await code(`<@@select name="pick" value={$v}><@@option ${attr}>M</@@option></@@select>`, nom)
      assert.match(js, /_set\('value', __mjsV\)/, attr)
      assert.match(js, /µ\._mjs_updAttrNode\(_mjs_node, '(?:value|VALUE)', __mjsV(?:, 1)?\); if \(_mjs_node\?\.isConnected/, `${attr} : la propriété d'abord, la prop ensuite`)
      assert.match(js, /'value' in \(_mjs_node\._mjs_var_bits \|\| \{\}\) && !\('value' in Object\.getPrototypeOf\(_mjs_node\)\)/, attr)
    }
  })

  it('garde : titre, style, part et la balise mjs-… tierce restent des attributs', async () => {
    const js = await code('<@fiche titre="Bonjour {$nom}" style="color: {$col}" part="p{$n}"></@fiche><mjs-tiers label="a{$n}"></mjs-tiers>', 'vm3')
    for (const nom of ['titre', 'style', 'part', 'label']) assert.ok(js.includes(`'${nom}', \``), `${nom} écrit en attribut`)
    assert.doesNotMatch(js, /_set\('(?:titre|style|part|label)'/)
  })

  it('garde : la ligne de {for} d\'un composant à valeur mêlée garde sa garde', async () => {
    const js = await code('{for x in $rows by id}<@fiche titre="L{x.n}" id="l{x.id}"></@fiche>{end}', 'vm4')
    assert.match(js, GARDE_FOR)
    assert.doesNotMatch(js, /_set\('(?:titre|id)'/)
  })

  it('garde : une <option> native garde sa propriété value', async () => {
    const js = await code('<select>{for x in $rows by id}<option value="0{x.n}">L</option>{end}<option value="0{$a}">M</option></select>', 'vm5')
    assert.doesNotMatch(js, /_set\('value'/)
    assert.match(js, GARDE_FOR)
  })
})
