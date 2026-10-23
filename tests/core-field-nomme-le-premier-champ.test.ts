// <@@field> nomme le PREMIER CHAMP de son corps — input, select, textarea ou composant de saisie du cœur —
// et non le premier élément : un texte d'aide ou une icône posés avant le champ recevaient l'identifiant du
// <label for> et le libellé en aria-label, et le vrai <input> restait sans nom (« textbox "" » dans l'arbre
// d'accessibilité).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { attendre, pause } from './helpers/coeur-monter.js'
import { mjsTmp } from './helpers/tmp.js'

const HOTE = [
  '<@@field class="aide" label="Autre"><span class="aide">€</span><input name="autre"></@@field>',
  '<@@field class="titre" label="Pays"><p class="intro">Choisissez</p><@@select name="pays"><@@option value="fr">France</@@option></@@select></@@field>',
  '<@@field class="enveloppe" label="Prix"><div class="w"><span>€</span><input name="prix"></div></@@field>',
  '<@@field class="tete" label="Nom"><input name="nom"><input name="second"></@@field>',
  '',
].join('\n')

async function monter(prefixe: string): Promise<{ window: any; hote: any; erreurs: string[] }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
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
  await pause(200)
  return { window, hote, erreurs: window.eval('globalThis.__erreurs') }
}

describe('mjs-core-field — le champ nommé est le premier champ du corps', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('une aide devant l\'<input> : le libellé et l\'identifiant vont sur l\'<input>, pas sur l\'aide', async () => {
    const { window, hote, erreurs } = await monter('field-premier-champ-aide')
    const champ     = hote._shadow.querySelector('.aide')
    const aide      = hote._shadow.querySelector('span.aide')
    const input     = hote._shadow.querySelector('input[name="autre"]')
    const etiquette = champ._shadow.querySelector('label.label')
    assert.ok(input && aide && etiquette, 'le champ, l\'aide et l\'étiquette sont rendus')
    assert.ok(input.id, 'le vrai <input> reçoit un identifiant')
    assert.equal(etiquette.getAttribute('for'), input.id, 'le <label for> vise l\'<input>')
    assert.equal(input.getAttribute('aria-label'), 'Autre', 'le libellé nomme l\'<input>')
    assert.equal(aide.hasAttribute('aria-label'), false, 'l\'aide ne reçoit pas le libellé')
    assert.equal(aide.id, '', 'l\'aide ne reçoit pas d\'identifiant')
    assert.equal(erreurs.length, 0, 'le nom de chaque champ se déduit de son <input> : aucune erreur — ' + erreurs.join(' | '))
    window.close()
  })

  it('un paragraphe devant un composant de saisie du cœur : le libellé va sur la liste, pas sur le paragraphe', async () => {
    const { window, hote } = await monter('field-premier-champ-liste')
    const liste     = hote._shadow.querySelector('mjs-core-select')
    const intro     = hote._shadow.querySelector('p.intro')
    const etiquette = hote._shadow.querySelector('.titre')._shadow.querySelector('label.label')
    assert.ok(liste && intro && etiquette, 'le champ, le paragraphe et la liste sont rendus')
    assert.equal(liste.getAttribute('aria-label'), 'Pays', 'le libellé nomme la liste')
    assert.equal(etiquette.getAttribute('for'), liste.id, 'le <label for> vise la liste')
    assert.equal(intro.hasAttribute('aria-label'), false, 'le paragraphe ne reçoit pas le libellé')
    assert.equal(intro.id, '', 'le paragraphe ne reçoit pas d\'identifiant')
    window.close()
  })

  it('inchangé : le champ dans un conteneur, le premier de deux champs', async () => {
    const { window, hote } = await monter('field-premier-champ-inchange')
    const prix = hote._shadow.querySelector('input[name="prix"]')
    assert.equal(prix.getAttribute('aria-label'), 'Prix', 'le champ d\'un conteneur (icône, affixe) est nommé')
    assert.equal(hote._shadow.querySelector('.w').hasAttribute('aria-label'), false, 'le conteneur ne l\'est pas')
    const nom    = hote._shadow.querySelector('input[name="nom"]')
    const second = hote._shadow.querySelector('input[name="second"]')
    assert.equal(nom.getAttribute('aria-label'), 'Nom', 'le premier de deux champs est nommé')
    assert.equal(second.hasAttribute('aria-label'), false, 'le second ne l\'est pas')
    window.close()
  })
})
