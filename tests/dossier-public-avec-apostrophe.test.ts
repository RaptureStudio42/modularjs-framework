// Un préfixe d'adresse publique qui contient une apostrophe (`/l'atelier/`) donne un module JavaScript valide :
// avant, il était posé tel quel entre apostrophes dans le code du composant, et le module ne se chargeait pas.

import assert from 'node:assert/strict'
import * as acorn from 'acorn'
import { transpile } from '../src/transpiler/index.js'

const analysable = (code: string) => acorn.parse(code.replace("µ.asset('mjs_core.js')", "'x'"), { ecmaVersion: 'latest', sourceType: 'module' })

describe('dossier public avec une apostrophe', () => {
  it('le module produit se lit, le dossier est celui écrit', async () => {
    const r = await transpile('<p>x</p>', { moduleName: 'apostrophe', dirInject: "/l'atelier/" })
    assert.doesNotThrow(() => analysable(r.output))
    assert.match(r.output, /this\._mjs_dir = '\/l\\'atelier\/';/)
  })

  it('témoin : dossier sans caractère spécial, inchangé', async () => {
    const r = await transpile('<p>x</p>', { moduleName: 'apostrophe', dirInject: '/atelier/' })
    assert.match(r.output, /this\._mjs_dir = '\/atelier\/';/)
  })
})
