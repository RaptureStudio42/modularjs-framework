// Interpolation d'attribut (`attr="pre-{expr}-post"`) : une accolade jamais
// refermée doit rester du texte littéral (comme le reste du compilateur le
// tolère déjà sur un bloc non fermé), jamais planter le composant au montage.
// Une accolade correctement fermée doit continuer à produire la VALEUR RÉELLE
// (exécutée, pas seulement le texte compilé) — objet littéral imbriqué compris.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string): string => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

async function mountFiles(files: Record<string, string>, rootTag: string): Promise<{ window: any; document: any; el: any }> {
  const root   = mjsTmp('interp-brace')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [name, src] of Object.entries(files)) writeFileSync(join(srcDir, name), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const window: any   = new Window({ url: 'http://localhost/' })
  const document: any = window.document
  const outFiles = readdirSync(outDir)
  const coreFile = outFiles.find((f: string) => /^mjs_core-/.test(f))!
  const jsFiles  = outFiles.filter((f: string) => f.endsWith('.js') && f !== coreFile && f !== 'bundle.js')
  const coreCode = stripEsm(readFileSync(join(outDir, coreFile), 'utf-8'))
  const compCode = jsFiles.map((f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  window.eval(`${coreCode}\nglobalThis.µ = µ;\n${compCode}`)
  document.body.insertAdjacentHTML('beforeend', `<${rootTag}></${rootTag}>`)
  const el = document.body.querySelector(rootTag)
  return { window, document, el }
}

describe('interpolation d\'attribut : accolade non équilibrée', function () {
  this.timeout(15000)
  after(async () => { await terminateSharedWorkerPool() })

  it('accolade jamais refermée (root) : texte littéral, aucun plantage au montage', async () => {
    const src = [
      '<script>', 'f = () -> 1', '</script>',
      '<div class="cible" title="Avant {f() Apres">contenu</div>',
    ].join('\n')
    const { el } = await mountFiles({ 'brace-unclosed-root.mjs': src }, 'mjs-brace-unclosed-root')
    await new Promise((r) => setTimeout(r, 30))
    assert.ok(!el.classList.contains('mjs-error'), 'le composant ne doit pas planter (accolade non fermée = texte littéral, pas une expression)')
    const cible = el._shadow.querySelector('.cible')
    assert.ok(cible, 'l\'élément doit être monté normalement')
    assert.equal(cible.getAttribute('title'), 'Avant {f() Apres', 'le texte doit rester littéral, accolade non fermée comprise')
  })

  it('accolade jamais refermée ({for}) : texte littéral par ligne, aucun plantage', async () => {
    const src = [
      '<script>', "$items = ['a', 'b']", '</script>',
      '{for item in $items}<li class="row" title="Nom {item Apres">{item}</li>{end}',
    ].join('\n')
    const { el } = await mountFiles({ 'brace-unclosed-for.mjs': src }, 'mjs-brace-unclosed-for')
    await new Promise((r) => setTimeout(r, 30))
    assert.ok(!el.classList.contains('mjs-error'), 'le composant ne doit pas planter en boucle {for} non plus')
    const rows = el._shadow.querySelectorAll('.row')
    assert.equal(rows.length, 2, 'les deux lignes doivent être montées')
    assert.equal(rows[0].getAttribute('title'), 'Nom {item Apres')
    assert.equal(rows[1].getAttribute('title'), 'Nom {item Apres')
  })

  it('accolade correctement fermée (root) : valeur RÉELLE, objet littéral imbriqué compris', async () => {
    const src = [
      '<script>', 'calc = (o) -> o.a + o.b', '</script>',
      '<div class="cible" title="Avant {calc({a: 1, b: 2})} Apres">contenu</div>',
    ].join('\n')
    const { el } = await mountFiles({ 'brace-closed-root.mjs': src }, 'mjs-brace-closed-root')
    await new Promise((r) => setTimeout(r, 30))
    const cible = el._shadow.querySelector('.cible')
    assert.equal(cible.getAttribute('title'), 'Avant 3 Apres', 'la valeur exécutée doit être correcte, pas seulement le texte compilé')
  })

  it('accolade correctement fermée ({for}) : valeur RÉELLE par ligne', async () => {
    const src = [
      '<script>', "$items = [{ nom: 'Ada' }, { nom: 'Grace' }]", '</script>',
      '{for item in $items}<li class="row" title="Bonjour {item.nom} !">{item.nom}</li>{end}',
    ].join('\n')
    const { el } = await mountFiles({ 'brace-closed-for.mjs': src }, 'mjs-brace-closed-for')
    await new Promise((r) => setTimeout(r, 30))
    const rows = el._shadow.querySelectorAll('.row')
    assert.equal(rows.length, 2)
    assert.equal(rows[0].getAttribute('title'), 'Bonjour Ada !')
    assert.equal(rows[1].getAttribute('title'), 'Bonjour Grace !')
  })
})
