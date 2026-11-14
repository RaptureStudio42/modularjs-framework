// Ce que ce test garantit : `mjs check --json` trouve le fichier d'un avertissement qui commence par le nom de son composant dans
// les deux langues des messages — « carte (ligne 2) : … » en français, « carte (line 2): … » en anglais, où les deux-points sont
// collés
import assert from 'node:assert/strict'
import { toDiagnostic } from '../src/cli/check-json.js'

describe('cli/check-json — le fichier d\'un avertissement nommé par son composant', () => {
  const ctx = { root: '/projet', files: new Map<string, string | null>([['carte', '/projet/app/modularjs/carte.mjs']]) }

  it('« carte (line 2): … » rend le même fichier et la même ligne que « carte (ligne 2) : … »', () => {
    const fr = toDiagnostic('carte (ligne 2) : <input> sans étiquette associée [lint.a11y]', 'warning', ctx)
    const en = toDiagnostic('carte (line 2): <input> without an associated label [lint.a11y]', 'warning', ctx)
    assert.ok(fr.file !== null && fr.file.endsWith('carte.mjs'), `forme française : fichier trouvé (${fr.file})`)
    assert.equal(en.file, fr.file, 'forme anglaise : le même fichier')
    assert.equal(en.line, 2)
    assert.equal(en.type, 'a11y')
  })

  it('sans la ligne : « carte: … » comme « carte : … »', () => {
    const fr = toDiagnostic('carte : composant vide [lint.emptyComponent]', 'warning', ctx)
    const en = toDiagnostic('carte: empty component [lint.emptyComponent]', 'warning', ctx)
    assert.ok(fr.file !== null && fr.file.endsWith('carte.mjs'), `forme française : fichier trouvé (${fr.file})`)
    assert.equal(en.file, fr.file, 'forme anglaise : le même fichier')
  })

  it('un mot suivi de deux-points qui n\'est pas un composant du projet ne donne aucun fichier', () => {
    assert.equal(toDiagnostic('warning: something happened', 'warning', ctx).file, null)
  })
})
