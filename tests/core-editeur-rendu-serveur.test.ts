// Éditeur de texte riche du cœur (<@@editor>, <@@toolbar>) : le rendu serveur, avec le moteur de rendu du framework (happy-dom).
// Ce que le serveur écrit dans la page avant tout JavaScript : un visiteur sans script voit le texte, et un formulaire s'envoie avant même
// le démarrage du JavaScript.
// - la surface porte le HTML NETTOYÉ (le script absent, b devenu strong, la liste à cocher intacte), la barre est là (les libellés viennent du
//   manifeste, que ce moteur de rendu ne charge pas : ils sont vides, jamais « undefined ») ;
// - le champ du formulaire (`mjs-f`) porte la valeur propre sous `name` ; un éditeur désactivé n'en écrit aucun ;
// - mode « répondre » : les lignes à cocher sont des cases ARIA dont l'état dit les positions de `checked`, un champ par case cochée (lecture seule
//   comprise), pas de barre, aucun champ pour un éditeur désactivé.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const HOTE = `<script>
  $texte  = '<h2>Titre</h2><p>Un <b>mot</b><script>alert(1)<' + '/script></p><ul data-checklist><li data-checked>fait</li><li>à faire</li></ul>'
  $modele = '<p>Cochez</p><ul data-checklist><li>un</li><li data-checked>deux</li><li>trois</li></ul>'
  $coches = [0, 2]
</script>

<form @noUJS>
  <@@editor class="e" name="contrat" value={$texte}></@@editor>
  <@@editor class="r" name="reps[]" answer value={$modele} checked={$coches}></@@editor>
  <@@editor class="l" name="lecture[]" answer readonly value={$modele} checked={$coches}></@@editor>
  <@@editor class="d" name="inerte" disabled value={$texte}></@@editor>
</form>
`

const decoder = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&')

describe('éditeur riche : le rendu serveur (happy-dom)', function () {
  this.timeout(180000)
  let html = ''
  const parts: Record<string, string> = {}

  // les champs `mjs-f` d'une partie : « nom=valeur », la valeur décodée
  const champs = (p: string): string[] => (p.match(/<input\b(?:"[^"]*"|'[^']*'|[^'">])*>/g) ?? []).filter((t) => /\bmjs-f\b/.test(t)).map((t) => decoder((/name="([^"]*)"/.exec(t) ?? [])[1] ?? '') + '=' + decoder((/value="([^"]*)"/.exec(t) ?? [])[1] ?? ''))
  // les lignes à cocher d'une partie : l'état `aria-checked` de chacune
  const cases  = (p: string): string[] => (p.match(/<span[^>]*\bclass="line"[^>]*>/g) ?? []).map((t) => (/aria-checked="([^"]*)"/.exec(t) ?? [])[1] ?? '?')

  before(async () => {
    const root   = mjsTmp('editeur-serveur')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote-ssr.mjs'), HOTE)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: join(root, 'out'), bundlerOpts: { runtime: ['hydrate'] } } as any)
    try {
      html = (await renderer.renderToString('mjs-hote-ssr', { ssrMode: 'markers' } as any)).html
    } finally {
      await renderer.close()
    }
    for (const p of html.split(/(?=<mjs-core-editor class=")/)) {
      const m = /^<mjs-core-editor class="(\w+)"/.exec(p)
      if (m) parts[m[1]] = p
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('les quatre éditeurs sont écrits dans la page', function () {
    assert.deepEqual(Object.keys(parts).sort(), ['d', 'e', 'l', 'r'], html.slice(0, 600))
  })

  it('la surface porte le HTML nettoyé : script absent, b devenu strong, liste à cocher intacte', function () {
    assert.match(parts.e, /<h2>Titre<\/h2><p>Un <strong>mot<\/strong><\/p><ul data-checklist(="")?><li data-checked(="")?[^>]*>fait<\/li><li[^>]*>à faire<\/li><\/ul>/, parts.e.slice(0, 1500))
    assert.ok(!/alert\(1\)/.test(html), 'aucun script du texte ne passe dans la page')
  })

  it('le champ du formulaire porte la valeur propre sous son nom', function () {
    assert.deepEqual(champs(parts.e), ['contrat=<h2>Titre</h2><p>Un <strong>mot</strong></p><ul data-checklist><li data-checked>fait</li><li>à faire</li></ul>'])
  })

  it('la barre est écrite avec ses boutons ; sans manifeste (le moteur de rendu n\'en charge pas) les libellés sont vides, jamais « undefined »', function () {
    assert.match(parts.e, /<mjs-core-toolbar/, 'la barre intégrée')
    assert.match(parts.e, /data-tool="bold"/, 'ses boutons')
    assert.match(parts.e, /role="textbox"/, 'la zone de saisie')
    for (const [classe, p] of Object.entries(parts)) assert.ok(!/undefined/.test(p), `rien d'« undefined » dans l'éditeur ${classe} : ${(/.{40}undefined.{40}/s.exec(p) ?? [''])[0]}`)
  })

  it('un éditeur désactivé n\'écrit aucun champ', function () {
    assert.deepEqual(champs(parts.d), [])
  })

  it('mode « répondre » : les lignes à cocher sont des cases ARIA qui disent les positions de `checked`', function () {
    assert.deepEqual(cases(parts.r), ['true', 'false', 'true'], parts.r.slice(0, 1500))
    assert.match(parts.r, /role="group"/, 'la zone est un groupe')
    assert.ok(!/contenteditable="true"/.test(parts.r), 'rien à saisir')
  })

  it('mode « répondre » : un champ par case cochée, pas de barre', function () {
    assert.deepEqual(champs(parts.r), ['reps[]=0', 'reps[]=2'])
    assert.ok(!/<mjs-core-toolbar/.test(parts.r), 'pas de barre')
  })

  it('mode « répondre » en lecture seule : les cases se voient, les champs partent', function () {
    assert.deepEqual(cases(parts.l), ['true', 'false', 'true'])
    assert.deepEqual(champs(parts.l), ['lecture[]=0', 'lecture[]=2'])
    assert.match(parts.l, /aria-readonly="true"/)
  })
})
