// Une liste imbriquée dans la ligne d'une liste relit la ligne PARENTE telle qu'elle est au rendu,
// et non telle qu'elle était quand ses propres lignes sont nées. Cas réel : un tableau
// d'administration rechargé depuis le serveur — objets neufs, mêmes `id`, valeurs changées. La
// ligne parente se mettait bien à jour, mais chaque ligne de la liste intérieure gardait la
// fonction de mise à jour de sa création, fermée sur l'ANCIEN objet : champs, textes et attributs
// de la boucle intérieure restaient sur les valeurs d'avant le rechargement, avec ou sans clé sur
// la boucle intérieure. Même cause, deux autres visages : un `{const}` de la ligne parente lu dans
// la boucle intérieure restait figé, et après un tri de la liste parente, un clic dans la boucle
// intérieure agissait sur la ligne qui occupait AVANT cette place.

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

// la ligne parente porte son propre texte (témoin : lui se met toujours à jour) ; dedans, une
// boucle à clé (texte, attribut, champ) et une boucle sans clé sur des chaînes (texte, attribut)
const LIGNE_RECHARGEE = `<script>
  $rows = [{id: 1, nom: 'Alice', fr: 'Bonjour', en: 'Hello'}, {id: 2, nom: 'Bruno', fr: 'Merci', en: 'Thanks'}]
  LANGS = [{code: 'fr'}, {code: 'en'}]
  CODES = ['fr', 'en']
</script>

{for r in $rows by id}
  <div class="row" data-id={r.id}>
    <b class="nom">{r.nom}</b>
    {for l in LANGS by code}<label class="k" title={r.nom}>{r.nom}<input data-lang={l.code} value={r[l.code]}></label>{end}
    {for c in CODES}<span class="s" data-v={r[c]}>{r.nom}:{r[c]}</span>{end}
  </div>
{end}
<button class="reload" @click={$rows = [{id: 1, nom: 'Alicia', fr: 'Salut', en: 'Hi'}, {id: 2, nom: 'Bruno', fr: 'Merci bien', en: 'Thanks a lot'}]}>relit</button>
`

const LIGNE_CONST = `<script>
  $rows = [{id: 1, fr: 'Bonjour', en: 'Hello'}]
  LANGS = [{code: 'fr'}, {code: 'en'}]
</script>

{for r in $rows by id}
  {const total = r.fr + ' / ' + r.en}
  <div class="row"><b class="t">{total}</b>{for l in LANGS by code}<i class="c">{l.code}={total}</i>{end}</div>
{end}
<button class="reload" @click={$rows = [{id: 1, fr: 'Salut', en: 'Hi'}]}>relit</button>
`

const LIGNE_INVERSEE = `<script>
  $rows   = [{id: 1, nom: 'Alice'}, {id: 2, nom: 'Bruno'}]
  $picked = ''
  LANGS   = [{code: 'fr'}, {code: 'en'}]
</script>

{for r in $rows by id}
  <div class="row"><b class="nom">{r.nom}</b>{for l in LANGS by code}<button class="pick" @click={$picked = r.nom + ':' + l.code}>{l.code}</button>{end}</div>
{end}
<p class="picked">{$picked}</p>
<button class="reverse" @click={$rows = [...$rows].reverse()}>inverse</button>
`

describe('liste imbriquée : la boucle intérieure relit la ligne parente du rendu en cours', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('boucle-imbriquee-ligne-rechargee')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'ligne-rechargee.mjs'), LIGNE_RECHARGEE)
    writeFileSync(join(srcDir, 'ligne-const.mjs'), LIGNE_CONST)
    writeFileSync(join(srcDir, 'ligne-inversee.mjs'), LIGNE_INVERSEE)
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

  it('lignes rechargées par des objets neufs de même clé : champ, texte et attribut de la boucle intérieure suivent, avec ou sans clé', async () => {
    window.document.body.innerHTML = '<mjs-ligne-rechargee></mjs-ligne-rechargee>'
    const comp = window.document.querySelector('mjs-ligne-rechargee')
    await attendre(() => (comp._shadow?.querySelectorAll('input').length ?? 0) === 4)
    const sh    = comp._shadow
    const ligne = (id: number) => sh.querySelector(`.row[data-id="${id}"]`)
    const etat  = (id: number) => {
      const row = ligne(id)
      return JSON.stringify({
        nom: row.querySelector('b.nom').textContent,
        avecCle: [...row.querySelectorAll('label.k')].map((k: any) => [k.textContent, k.getAttribute('title'), k.querySelector('input').value]),
        sansCle: [...row.querySelectorAll('span.s')].map((s: any) => [s.textContent, s.getAttribute('data-v')])
      })
    }
    assert.equal(etat(1), JSON.stringify({ nom: 'Alice', avecCle: [['Alice', 'Alice', 'Bonjour'], ['Alice', 'Alice', 'Hello']], sansCle: [['Alice:Bonjour', 'Bonjour'], ['Alice:Hello', 'Hello']] }), 'état de départ')
    const premiere = ligne(1)
    const champ    = premiere.querySelector('input')
    sh.querySelector('button.reload').click()
    await attendre(() => ligne(1)?.querySelector('b.nom')?.textContent === 'Alicia')
    await pause(20)
    assert.ok(ligne(1) === premiere, 'même clé : la ligne parente est gardée, pas recréée')
    assert.ok(ligne(1).querySelector('input') === champ, 'même clé intérieure : le champ est gardé, pas recréé')
    assert.equal(etat(1), JSON.stringify({ nom: 'Alicia', avecCle: [['Alicia', 'Alicia', 'Salut'], ['Alicia', 'Alicia', 'Hi']], sansCle: [['Alicia:Salut', 'Salut'], ['Alicia:Hi', 'Hi']] }), 'ligne 1 après rechargement')
    assert.equal(etat(2), JSON.stringify({ nom: 'Bruno', avecCle: [['Bruno', 'Bruno', 'Merci bien'], ['Bruno', 'Bruno', 'Thanks a lot']], sansCle: [['Bruno:Merci bien', 'Merci bien'], ['Bruno:Thanks a lot', 'Thanks a lot']] }), 'ligne 2 après rechargement')
  })

  it('un {const} de la ligne parente, lu dans la boucle intérieure, suit la ligne rechargée', async () => {
    window.document.body.innerHTML = '<mjs-ligne-const></mjs-ligne-const>'
    const comp = window.document.querySelector('mjs-ligne-const')
    await attendre(() => (comp._shadow?.querySelectorAll('i.c').length ?? 0) === 2)
    const sh   = comp._shadow
    const etat = () => JSON.stringify([sh.querySelector('b.t').textContent, ...[...sh.querySelectorAll('i.c')].map((i: any) => i.textContent)])
    assert.equal(etat(), JSON.stringify(['Bonjour / Hello', 'fr=Bonjour / Hello', 'en=Bonjour / Hello']), 'état de départ')
    sh.querySelector('button.reload').click()
    await attendre(() => sh.querySelector('b.t')?.textContent === 'Salut / Hi')
    await pause(20)
    assert.equal(etat(), JSON.stringify(['Salut / Hi', 'fr=Salut / Hi', 'en=Salut / Hi']), 'après rechargement')
  })

  it('liste parente inversée : un clic dans la boucle intérieure agit sur la ligne affichée', async () => {
    window.document.body.innerHTML = '<mjs-ligne-inversee></mjs-ligne-inversee>'
    const comp = window.document.querySelector('mjs-ligne-inversee')
    await attendre(() => (comp._shadow?.querySelectorAll('button.pick').length ?? 0) === 4)
    const sh     = comp._shadow
    const choisi = () => sh.querySelector('p.picked').textContent
    sh.querySelector('.row button.pick').click()
    await attendre(() => choisi() !== '')
    assert.equal(choisi(), 'Alice:fr', 'avant l\'inversion')
    sh.querySelector('button.reverse').click()
    await attendre(() => sh.querySelector('.row b.nom')?.textContent === 'Bruno')
    await pause(20)
    sh.querySelector('.row button.pick').click()
    await attendre(() => choisi() !== 'Alice:fr')
    assert.equal(choisi(), 'Bruno:fr', 'la première ligne affichée est celle de Bruno')
    const derniere = [...sh.querySelectorAll('.row')].pop()
    derniere.querySelectorAll('button.pick')[1].click()
    await attendre(() => choisi() !== 'Bruno:fr')
    assert.equal(choisi(), 'Alice:en', 'la dernière ligne affichée est celle d\'Alice')
  })
})
