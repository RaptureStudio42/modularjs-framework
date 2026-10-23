// Trois listes l'une dans l'autre : la plus profonde relit la ligne de CHACUNE de ses deux parentes
// telle qu'elle est au rendu en cours, pas telle qu'elle était à sa naissance. Un tableau rechargé
// depuis le serveur (objets neufs, mêmes `id`, valeurs changées) met à jour les trois étages — avec ou
// sans clé sur le plus bas — et un clic après un tri agit sur la ligne affichée à cette place. Le cas à
// deux étages ne suffit pas : une correction qui s'arrête au deuxième laisserait les listes du
// troisième sur les valeurs d'avant.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// étage 1 : la ligne (nom) ; étage 2 : ses groupes (nom) ; étage 3 : les éléments du groupe, à clé
// (texte, attribut, champ) et sans clé sur des chaînes (texte, attribut) — chacun lit les trois étages
const TROIS = `<script>
  $rows = [
    {id: 1, nom: 'Alice', groupes: [{id: 10, nom: 'g1', items: [{id: 100, v: 'a'}, {id: 101, v: 'b'}], codes: ['x', 'y']}]},
    {id: 2, nom: 'Bruno', groupes: [{id: 20, nom: 'g2', items: [{id: 200, v: 'c'}], codes: ['z']}]}
  ]
  $picked = ''
</script>

{for r in $rows by id}
  <div class="r" data-id={r.id}>
    <b class="rn">{r.nom}</b>
    {for g in r.groupes by id}
      <section class="g">
        <i class="gn">{r.nom}/{g.nom}</i>
        {for it in g.items by id}<span class="it" title={r.nom + '/' + g.nom + '/' + it.v}><s class="t">{r.nom}/{g.nom}/{it.v}</s><input value={r.nom + g.nom + it.v}><button class="pick" @click={$picked = r.nom + ':' + g.nom + ':' + it.v}>p</button></span>{end}
        {for c in g.codes}<em class="c" data-c={r.nom + '/' + g.nom + '/' + c}>{r.nom}-{g.nom}-{c}</em>{end}
      </section>
    {end}
  </div>
{end}
<p class="picked">{$picked}</p>
<button class="reload" @click={$rows = [
  {id: 1, nom: 'Alicia', groupes: [{id: 10, nom: 'G1', items: [{id: 100, v: 'A'}, {id: 101, v: 'B'}], codes: ['X', 'Y']}]},
  {id: 2, nom: 'Bruno', groupes: [{id: 20, nom: 'G2', items: [{id: 200, v: 'C'}], codes: ['Z']}]}
]}>relit</button>
<button class="reverse" @click={$rows = [...$rows].reverse()}>inverse</button>
`

describe('trois listes imbriquées : la plus profonde relit les lignes de ses deux parentes', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('boucle-imbriquee-trois-niveaux')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'trois-niveaux.mjs'), TROIS)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function ouvrir() {
    window.document.body.innerHTML = '<mjs-trois-niveaux></mjs-trois-niveaux>'
    const comp = window.document.querySelector('mjs-trois-niveaux')
    await attendre(() => (comp._shadow?.querySelectorAll('span.it').length ?? 0) === 3 && (comp._shadow?.querySelectorAll('em.c').length ?? 0) === 3)
    return comp
  }

  // tout ce que les trois étages affichent, ligne par ligne
  const etat = (sh: any) => JSON.stringify([...sh.querySelectorAll('.r')].map((r: any) => [
    r.querySelector('b.rn').textContent,
    r.querySelector('i.gn').textContent,
    [...r.querySelectorAll('span.it')].map((s: any) => [s.querySelector('s.t').textContent, s.getAttribute('title'), s.querySelector('input').value]),
    [...r.querySelectorAll('em.c')].map((e: any) => [e.textContent, e.getAttribute('data-c')])
  ]))

  it('lignes rechargées par des objets neufs de même clé : les trois étages suivent, avec ou sans clé au plus bas', async () => {
    const comp = await ouvrir()
    const sh   = comp._shadow
    assert.equal(etat(sh), JSON.stringify([
      ['Alice', 'Alice/g1', [['Alice/g1/a', 'Alice/g1/a', 'Aliceg1a'], ['Alice/g1/b', 'Alice/g1/b', 'Aliceg1b']], [['Alice-g1-x', 'Alice/g1/x'], ['Alice-g1-y', 'Alice/g1/y']]],
      ['Bruno', 'Bruno/g2', [['Bruno/g2/c', 'Bruno/g2/c', 'Brunog2c']], [['Bruno-g2-z', 'Bruno/g2/z']]]
    ]), 'état de départ')
    const champ = sh.querySelector('span.it input')
    sh.querySelector('button.reload').click()
    await attendre(() => sh.querySelector('b.rn')?.textContent === 'Alicia')
    await pause(30)
    assert.ok(sh.querySelector('span.it input') === champ, 'même clé aux trois étages : le champ est gardé, pas recréé')
    assert.equal(etat(sh), JSON.stringify([
      ['Alicia', 'Alicia/G1', [['Alicia/G1/A', 'Alicia/G1/A', 'AliciaG1A'], ['Alicia/G1/B', 'Alicia/G1/B', 'AliciaG1B']], [['Alicia-G1-X', 'Alicia/G1/X'], ['Alicia-G1-Y', 'Alicia/G1/Y']]],
      ['Bruno', 'Bruno/G2', [['Bruno/G2/C', 'Bruno/G2/C', 'BrunoG2C']], [['Bruno-G2-Z', 'Bruno/G2/Z']]]
    ]), 'après rechargement')
  })

  it('liste du premier étage inversée : un clic au troisième agit sur la ligne affichée à cette place', async () => {
    const comp = await ouvrir()
    const sh     = comp._shadow
    const choisi = () => sh.querySelector('p.picked').textContent
    sh.querySelector('button.reverse').click()
    await attendre(() => sh.querySelector('.r b.rn')?.textContent === 'Bruno')
    await pause(30)
    sh.querySelector('.r span.it button.pick').click()
    await attendre(() => choisi() !== '')
    assert.equal(choisi(), 'Bruno:g2:c', 'la première ligne affichée est celle de Bruno')
    const dernier = [...sh.querySelectorAll('.r')].pop().querySelectorAll('span.it button.pick')[1]
    dernier.click()
    await attendre(() => choisi() !== 'Bruno:g2:c')
    assert.equal(choisi(), 'Alice:g1:b', 'la dernière ligne affichée est celle d\'Alice')
  })
})
