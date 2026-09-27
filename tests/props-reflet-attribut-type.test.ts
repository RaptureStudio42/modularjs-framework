// Une prop typée que le composant REFLÈTE en attribut garde son type.
//
// Défaut : chaque composant observe ses propres attributs (`_mjs_propObserver`) et les relit tous
// en props à chaque changement (`syncProps`). Un composant qui reflète sa prop en attribut — le
// module cœur `option` pose `value="18"` pour `value={18}` — se relisait donc lui-même : l'attribut
// texte « 18 » remplaçait le nombre 18 posé par le parent. Côté `<@select>`, la variable liée
// recevait « 18 » au lieu de 18 et un `includes` strict (choix multiple) ne retrouvait plus rien.
// Correctif : un attribut qui n'est que le reflet texte de la valeur courante (même texte) ne la
// remplace pas ; un attribut vraiment changé se relit comme avant.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const REFLET = [
  '<script>',
  '  µeffect =>',
  "    if $value == undefined then @removeAttribute('value') else @setAttribute('value', String($value))",
  '</script>',
  '',
  '<span class="t">{typeof $value}</span>',
].join('\n')

const HOTE = [
  '<script>',
  '  $n = 42',
  '</script>',
  '',
  '<@reflet value={$n}></@reflet>',
].join('\n')

// l'observateur d'attributs rend la main par micro-tâches ; sous charge (suite complète), un délai
// fixe ne suffit pas toujours : on attend la condition, borné à 3 s
async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('props — le reflet texte d\'une prop typée ne la remplace pas', function () {
  this.timeout(30000)
  after(async () => { await terminateSharedWorkerPool() })

  it('`value={42}` reflété `value="42"` : l\'état garde le nombre ; un attribut vraiment changé se relit', async () => {
    const root   = mjsTmp('props-reflet')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'reflet.mjs'), REFLET)
    writeFileSync(join(srcDir, 'hotereflet.mjs'), HOTE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

    const files = readdirSync(outDir)
    const pick  = (re: RegExp) => files.find((f) => re.test(f))!
    const code  = [pick(/^mjs_core-/), pick(/^reflet-/), pick(/^hotereflet-/)].map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-hotereflet></mjs-hotereflet>'
    const hote = window.document.body.querySelector('mjs-hotereflet')
    await attendre(() => hote._shadow?.querySelector('mjs-reflet')?.getAttribute('value') === '42')
    const reflet = hote._shadow.querySelector('mjs-reflet')
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(reflet.getAttribute('value'), '42', 'le composant a bien reflété sa prop')
    assert.strictEqual(reflet._state.value, 42, 'le reflet n\'a pas remplacé le nombre par son texte')
    assert.equal(reflet._shadow.querySelector('.t').textContent, 'number')

    hote._set('n', 7)
    await attendre(() => reflet.getAttribute('value') === '7')
    await new Promise((r) => setTimeout(r, 40))
    assert.strictEqual(reflet._state.value, 7, 'une nouvelle valeur du parent, reflétée à son tour, reste un nombre')

    reflet.setAttribute('value', 'autre')
    await attendre(() => reflet._state.value === 'autre')
    assert.strictEqual(reflet._state.value, 'autre', 'un attribut vraiment changé se relit comme avant')
    window.close?.()
  })
})
