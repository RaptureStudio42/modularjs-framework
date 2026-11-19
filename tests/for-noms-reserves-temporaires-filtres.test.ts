// un item de `{for}` ne peut pas porter le nom d'un temporaire du chemin des liaisons filtrées (`__f`, `__k`, `__fe`, `__f0`, `__fns`) :
// le code émis pour `:class{$sel == item.id}` le redéclare dans la boucle (`const __fe = …`). Le nom est refusé à la compilation, avec
// la liste des noms réservés ; un nom voisin reste permis
import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const SOURCE = (nom: string) => `<script>\n  $l   ?= [{ id: 1 }, { id: 2 }]\n  $sel ?= 1\n</script>\n{for ${nom} in $l}<p :class{$sel == ${nom}.id}="on">{${nom}.id}</p>{end}\n`

describe('{for} : les temporaires des liaisons filtrées sont des noms réservés', function () {
  for (const nom of ['__f', '__k', '__fe', '__f0', '__fns']) {
    it(`un item nommé ${nom} est refusé à la compilation`, async () => {
      await assert.rejects(transpile(SOURCE(nom), { moduleName: 'forNomReserve' }), (e: any) => {
        const texte = String(e && e.message)
        assert.match(texte, /réservé|reserved/i, texte.slice(0, 300))
        assert.ok(texte.includes(`'${nom}'`) || texte.includes(`« ${nom} »`) || texte.includes(`\`${nom}\``) || texte.includes(` ${nom} `), texte.slice(0, 300))
        return true
      })
    })
  }

  it('un nom voisin (fe) reste permis', async () => {
    await assert.doesNotReject(transpile(SOURCE('fe'), { moduleName: 'forNomVoisin' }))
  })
})
