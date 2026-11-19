// construction de production, vrais navigateurs (Chromium, Firefox, WebKit) : une ligne de `{for}` n'est jamais reprise pour une autre
// donnée — quand toutes les clés changent, chaque nouvelle clé reçoit une ligne neuve, et le champ saisi, le `<details>` ouvert ou la vidéo
// d'une ligne retirée ne passent jamais à une autre clé

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, moteurPresent, ouvrirPage } from './helpers/navigateurs-compiles.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const A_ETAT = `<script lang="js">
  $champs = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }];
  $plis   = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }];
  $videos = [{ id: 1 }, { id: 2 }];
  @changer = function() {
    $champs = [{ id: 3, t: 'c' }, { id: 4, t: 'd' }];
    $plis   = [{ id: 3, t: 'c' }, { id: 4, t: 'd' }];
    $videos = [{ id: 3 }, { id: 4 }];
  };
</script>
<ul class="champs">
  {for r in $champs by id}
    <li><input class="libre" aria-label="libre"><input class="lie" aria-label="lie" value={r.t}></li>
  {end}
</ul>
<ul class="plis">
  {for r in $plis by id}
    <li><details><summary>{r.t}</summary>x</details></li>
  {end}
</ul>
<ul class="videos">
  {for r in $videos by id}
    <li><video muted></video>{r.id}</li>
  {end}
</ul>
<button class="changer" @click={@changer()}>changer</button>
`

// l'appli construite pour la production, en un seul fichier, minifiée (comme l'appli du banc)
async function construire(nom: string, source: string): Promise<string> {
  const root   = mjsTmp(nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'main.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env: 'prod', js: 'bundle', forceMinify: true, defaultScriptLang: 'js', lint: { a11y: false } } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(outDir, 'bundle.js'), 'utf-8')
}

// les lignes de chaque liste notées, la première saisie et ouverte, puis toutes les clés changées : ce que chaque liste montre ensuite
const SCENARIO = `(async () => {
  const hote = document.querySelector('mjs-main')
  const ombre = hote._shadow || hote
  const lignes = (ul) => [...ombre.querySelectorAll(ul + ' > li')]
  for (const ul of ['.champs', '.plis', '.videos']) for (const li of lignes(ul)) li.__before = 1
  const libre = ombre.querySelector('.champs .libre')
  if (libre) { libre.value = 'tapé'; libre.dispatchEvent(new Event('input', { bubbles: true })) }
  const pli = ombre.querySelector('.plis details')
  if (pli) pli.open = true
  ombre.querySelector('.changer').click()
  await new Promise((r) => setTimeout(r, 50))
  const rendu = (ul) => lignes(ul).map((li) => ({ reprise: li.__before === 1, texte: li.textContent.trim(), libre: li.querySelector('.libre')?.value, lie: li.querySelector('.lie')?.value, ouvert: li.querySelector('details')?.open }))
  return { champs: rendu('.champs'), plis: rendu('.plis'), videos: rendu('.videos') }
})()`

describe('état des lignes de {for} en production, vrais navigateurs', function () {
  this.timeout(180000)
  let aEtat = ''
  before(async () => {
    aEtat = await construire('etat-lignes-a-etat', A_ETAT)
  })
  after(() => terminateSharedWorkerPool())

  for (const moteur of MOTEURS) {
    it(`${moteur} : la saisie, le pli ouvert et la vidéo ne passent jamais à une autre clé`, async function () {
      if (!(await moteurPresent(moteur))) this.skip()
      const { browser, page, erreurs } = await ouvrirPage(moteur, '<mjs-main></mjs-main>', stripEsm(aEtat))
      try {
        await page.waitForFunction(() => { const h: any = document.querySelector('mjs-main'); return !!(h && (h._shadow || h).querySelector('.changer')) })
        const r = await page.evaluate(SCENARIO)
        assert.deepEqual(r.champs.map((l: any) => [l.reprise, l.libre, l.lie]), [[false, '', 'c'], [false, '', 'd']], `${moteur} : champs après le changement de clé ${JSON.stringify(r.champs)}`)
        assert.deepEqual(r.plis.map((l: any) => [l.reprise, l.ouvert]), [[false, false], [false, false]], `${moteur} : plis ${JSON.stringify(r.plis)}`)
        assert.deepEqual(r.videos.map((l: any) => [l.reprise, l.texte]), [[false, '3'], [false, '4']], `${moteur} : vidéos ${JSON.stringify(r.videos)}`)
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    })
  }
})
