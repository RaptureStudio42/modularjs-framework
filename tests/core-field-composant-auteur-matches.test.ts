// <@@field> cherche le champ qu'il enveloppe avec le `matches` de la balise, pas celui du composant :
// un composant d'auteur qui déclare `@matches` (un nom d'appli plausible : les profils compatibles
// d'un site de rencontres) masque la méthode de sa balise. Appelée à sa place, la méthode de l'auteur
// répondait « oui » (une liste non vide), le module prenait le composant pour le champ — l'identifiant
// du <label for> et le libellé en aria-label allaient sur la balise du composant, et le vrai <input>
// restait sans étiquette reliée.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { attendre, pause } from './helpers/coeur-monter.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  'saisie.mjs': [
    '<script>',
    '@matches = (profil) ->',
    '  [\'un profil\']',
    '</script>',
    '<slot></slot>',
  ].join('\n') + '\n',
  'hote.mjs': '<@@field label="Prix"><@saisie class="s"><input name="prix"></@saisie></@@field>\n',
}

async function monter(prefixe: string): Promise<{ window: any; hote: any; erreurs: string[] }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const code  = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(`${code}\nglobalThis.µ = µ;\nglobalThis.__erreurs = [];\nµ.error = function(...a) { globalThis.__erreurs.push(a.map(String).join(' ')); };`)
  window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
  const hote = window.document.querySelector('mjs-hote')
  await attendre(() => !!hote._shadow)
  await pause(150)
  return { window, hote, erreurs: window.eval('globalThis.__erreurs') }
}

describe('mjs-core-field — un composant d\'auteur qui déclare @matches', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le libellé et l\'identifiant vont sur le vrai <input>, pas sur la balise du composant', async () => {
    const { window, hote, erreurs } = await monter('field-matches-auteur')
    const champ     = hote._shadow.querySelector('mjs-core-field')
    const composant = hote._shadow.querySelector('mjs-saisie')
    const input     = hote._shadow.querySelector('input[name="prix"]')
    const etiquette = champ._shadow.querySelector('label.label')
    assert.ok(input && composant && etiquette, 'le champ, le composant et l\'étiquette sont rendus')
    assert.ok(input.id, 'le vrai <input> reçoit un identifiant')
    assert.equal(etiquette.getAttribute('for'), input.id, 'le <label for> vise le vrai <input>')
    assert.equal(input.getAttribute('aria-label'), 'Prix', 'le libellé nomme le vrai <input>')
    assert.equal(composant.hasAttribute('aria-label'), false, 'la balise du composant ne reçoit pas le libellé')
    assert.equal(composant.id, '', 'la balise du composant ne reçoit pas d\'identifiant')
    assert.equal(erreurs.length, 0, 'le nom du champ se déduit de l\'<input> : aucune erreur')
    window.close()
  })
})
