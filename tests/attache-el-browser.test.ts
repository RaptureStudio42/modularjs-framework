// `el`, second nom de l'élément dans un `@attach` à côté de `_node` : `<canvas @attach.once={dessiner(el, p)}>` reçoit la balise, à la racine, dans une ligne
// de `{for}`, dans une branche de `{await}` (attente, `{success}`, `{error}`), en mode direct (`@attach={f(el)}`) comme avec `.once` ; chaque cas a son jumeau
// écrit avec `_node`, qui sert de témoin : la pose, la reprise et le retrait de `el` sont ceux de `_node`
// la forme fabrique (`marque('x')`, `(el) -> …`) ne change pas ; le `el` du script de l'auteur prime sur celui du framework (aucun masquage)
// les trois modes : développement, production en fichiers séparés, production en un seul fichier ; Chromium réel

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  // à la racine et dans un `{if}` de la racine ; le jumeau `_node` de la racine
  'ae-racine.mjs': `<script>
  $show = true
  journal = (what) -> (globalThis.__journal ||= []).push(what)
  marquer = (n, nom) ->
    n.setAttribute('data-vu', nom + ':' + n.localName)
    journal('pose ' + nom)
    -> journal('retrait ' + nom)

  @fermer = -> $show = false
</script>
<canvas class="hors" @attach={marquer(el, 'hors')}></canvas>
<canvas class="hors-node" @attach={marquer(_node, 'hors-node')}></canvas>
{if $show}
  <canvas class="dans" @attach={marquer(el, 'dans')}></canvas>
  <canvas class="dans-une-fois" @attach.once={marquer(el, 'dans-une-fois')}></canvas>
{end}
`,
  // les lignes d'un `{for}` : avec `.once` la balise n'est posée qu'une fois, sans `.once` l'attache qui lit sa ligne se rejoue quand la ligne se redessine
  // (ici le texte lit `$tick`) ; chaque forme a son jumeau `_node`
  'ae-ligne.mjs': `<script>
  $plays = [{ key: 'a' }, { key: 'b' }]
  $tick  = 0
  journal = (what) -> (globalThis.__journal ||= []).push(what)
  dessiner = (n, p, nom) ->
    n.setAttribute('data-' + nom, p.key + ':' + n.localName)
    journal('pose ' + nom + ' ' + p.key)
    -> journal('retrait ' + nom + ' ' + p.key)

  @avancer = -> $tick++
  @retirer = -> $plays = [{ key: 'b' }]
</script>
{for p in $plays by key}
  <canvas class="une-fois" @attach.once={dessiner(el, p, 'o')}>{$tick}</canvas>
  <canvas class="direct" @attach={dessiner(el, p, 'd')}>{$tick}</canvas>
  <canvas class="une-fois-node" @attach.once={dessiner(_node, p, 'on')}>{$tick}</canvas>
  <canvas class="direct-node" @attach={dessiner(_node, p, 'dn')}>{$tick}</canvas>
{end}
`,
  // les trois branches d'un `{await}` ; la forme réactive de `{success}` lit aussi `$theme` : l'attache est reprise quand il change
  'ae-attente.mjs': `<script>
  $theme = 'clair'
  fin    = null
  $p     = new Promise((res, rej) -> fin = [res, rej])
  journal = (what) -> (globalThis.__journal ||= []).push(what)
  marquer = (n, nom) ->
    n.setAttribute('data-vu', nom + ':' + n.localName)
    journal('pose ' + nom)
    -> journal('retrait ' + nom)

  @finir    = -> fin[0]({ n: 7 })
  @refuser  = -> fin[1](new Error('non'))
  @habiller = (x) -> $theme = x
</script>
{await $p}
  <i class="att" @attach.once={marquer(el, 'att')}>attente</i>
{success v}
  <b class="ok" @attach.once={marquer(el, 'ok' + v.n)}>{v.n}</b>
  <b class="ok-theme" @attach={marquer(el, $theme + v.n)}>{v.n}</b>
  <b class="ok-node" @attach.once={marquer(_node, 'oknode' + v.n)}>{v.n}</b>
{error err}
  <b class="ko" @attach.once={marquer(el, 'ko:' + err.message)}>{err.message}</b>
{end}
`,
  // la forme fabrique ne change pas : une fabrique appelée avec la balise, un paramètre qui s'appelle `el`, et une fabrique dans une ligne de `{for}`
  'ae-fabrique.mjs': `<script>
  $plays = [{ key: 'a' }, { key: 'b' }]
  journal = (what) -> (globalThis.__journal ||= []).push(what)
  marque = (nom) -> (n) ->
    n.setAttribute('data-vu', nom + ':' + n.localName)
    journal('pose ' + nom)
    -> journal('retrait ' + nom)
</script>
<canvas class="f1" @attach={marque('fab')}></canvas>
<canvas class="f2" @attach.once={marque('une-fois')}></canvas>
<canvas class="f3" @attach={(el) -> el.setAttribute('data-vu', 'param:' + el.localName)}></canvas>
{for p in $plays by key}<canvas class="f4" @attach.once={marque('ligne' + p.key)}></canvas>{end}
`,
  // le script de l'auteur déclare lui-même \`el\` : c'est le sien, la fabrique le reçoit ; la balise n'est pas \`el\`
  'ae-auteur.mjs': `<script>
  el = { nom: 'mien' }
  $plays = [{ key: 'a' }]
  fin    = null
  $p     = new Promise((res) -> fin = res)
  journal = (what) -> (globalThis.__journal ||= []).push(what)
  noter = (v) -> (n) ->
    n.setAttribute('data-vu', v.nom + ':' + n.localName)
    journal('pose ' + v.nom)
    -> journal('retrait ' + v.nom)

  @finir = -> fin('ok')
</script>
<canvas class="a1" @attach={noter(el)}></canvas>
<canvas class="a2" @attach.once={noter(el)}></canvas>
{for p in $plays by key}<canvas class="a3" @attach={noter(el)}></canvas>{end}
{await $p}
  <i class="att">attente</i>
{success v}
  <canvas class="a4" @attach={noter(el)}></canvas>
{end}
`
}
const BALISES = Object.keys(SOURCES).map((f) => 'mjs-' + f.replace('.mjs', ''))

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

// l'attribut d'une ou plusieurs balises du composant, séparés par des virgules ; `absente` quand aucune balise ne correspond, `sans attribut` quand la balise n'en porte pas
const lus = (page: any, balise: string, sel: string, attribut: string): Promise<string> => page.evaluate(`(() => {
  const noeuds = Array.from(document.querySelector('${balise}')._shadow.querySelectorAll('${sel}'))
  return noeuds.length ? noeuds.map((n) => n.getAttribute('${attribut}') ?? 'sans attribut').join(',') : 'absente'
})()`)

// le journal des poses et des retraits que les attaches de la page ont écrit
const journal = (page: any): Promise<string[]> => page.evaluate('[...(globalThis.__journal ?? [])]')

// combien de fois une ligne du journal y est écrite
const compte = (j: string[], ligne: string) => j.filter((l) => l === ligne).length

// le composant est prêt quand sa première balise est dans l'ombre
const pret = async (page: any, balise: string, sel: string) => {
  await page.waitForFunction(`!!document.querySelector('${balise}')?._shadow?.querySelector('${sel}')`, null, { timeout: 10000 })
  await page.waitForTimeout(200)
}

// un appel sur le composant (`fermer()`, `avancer()`…), puis le temps de la mise à jour
const regler = async (page: any, balise: string, appel: string) => {
  await page.evaluate(`(() => { document.querySelector('${balise}').${appel}; return null })()`)
  await page.waitForTimeout(200)
}

// note un écart, sans arrêter le cas : tous les écarts d'un cas sont rendus ensemble
const verifier = (ecarts: string[], quoi: string, lu: unknown, attendu: unknown) => {
  if (lu !== attendu) ecarts.push(`${quoi} : attendu ${JSON.stringify(attendu)}, lu ${JSON.stringify(lu)}`)
}

for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`@attach avec \`el\` (${mode}, Chromium réel)`, function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test de `el` dans @attach sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // ouvre le composant, joue le scénario, puis exige qu'aucune erreur n'ait été dite par la page
  const jouer = async (balise: string, sel: string, scenario: (page: any) => Promise<void>) => {
    const o = await charger(browser, await cible(mode), balise)
    try {
      // un composant tombé au montage n'atteint jamais son état prêt : l'erreur que la page a dite est alors la cause à lire
      await pret(o.page, balise, sel).catch(() => { throw new Error(`le composant ne se monte pas, la page dit : ${graves(o).join(' ; ') || 'rien'}`) })
      await scenario(o.page)
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  }

  it('les composants se compilent', async function () {
    if (!present) { this.skip(); return }
    await cible(mode)
  })

  it('racine et {if} : `el` est la balise, posée une fois ; le {if} fermé retire les siennes, comme `_node`', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-ae-racine'
    const ecarts = [] as string[]
    await jouer(B, '.hors', async (page) => {
      assert.equal(await lus(page, B, '.hors-node', 'data-vu'), 'hors-node:canvas', 'le jumeau `_node` est faux : le test lui-même est à revoir')
      verifier(ecarts, 'racine, balise reçue', await lus(page, B, '.hors', 'data-vu'), 'hors:canvas')
      verifier(ecarts, '{if}, balise reçue', await lus(page, B, '.dans', 'data-vu'), 'dans:canvas')
      verifier(ecarts, '{if} .once, balise reçue', await lus(page, B, '.dans-une-fois', 'data-vu'), 'dans-une-fois:canvas')
      const poses = await journal(page)
      for (const nom of ['hors', 'hors-node', 'dans', 'dans-une-fois']) verifier(ecarts, `pose de ${nom}`, compte(poses, 'pose ' + nom), 1)
      await regler(page, B, 'fermer()')
      const apres = await journal(page)
      verifier(ecarts, 'retrait de dans', compte(apres, 'retrait dans'), 1)
      verifier(ecarts, 'retrait de dans-une-fois', compte(apres, 'retrait dans-une-fois'), 1)
      verifier(ecarts, 'retrait de hors (resté dans la page)', compte(apres, 'retrait hors'), 0)
    })
    assert.deepEqual(ecarts, [])
  })

  it('ligne de {for} : `el` est la balise de chaque ligne ; `.once` ne reprend jamais, la forme directe reprend comme `_node`', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-ae-ligne'
    const ecarts = [] as string[]
    await jouer(B, '.une-fois', async (page) => {
      assert.equal(await lus(page, B, '.une-fois-node', 'data-on'), 'a:canvas,b:canvas', 'le jumeau `_node` est faux : le test lui-même est à revoir')
      verifier(ecarts, 'ligne .once, balises reçues', await lus(page, B, '.une-fois', 'data-o'), 'a:canvas,b:canvas')
      verifier(ecarts, 'ligne directe, balises reçues', await lus(page, B, '.direct', 'data-d'), 'a:canvas,b:canvas')
      const poses = await journal(page)
      for (const [nom, cle] of [['o', 'a'], ['o', 'b'], ['d', 'a'], ['d', 'b'], ['on', 'a'], ['on', 'b'], ['dn', 'a'], ['dn', 'b']]) verifier(ecarts, `pose de ${nom} ${cle}`, compte(poses, `pose ${nom} ${cle}`), 1)
      for (let i = 0; i < 3; i++) await regler(page, B, 'avancer()')
      const apres = await journal(page)
      verifier(ecarts, '.once, reprise après 3 redessins', compte(apres, 'retrait o a') + compte(apres, 'retrait o b'), 0)
      verifier(ecarts, '.once, pose après 3 redessins', compte(apres, 'pose o a') + compte(apres, 'pose o b'), 2)
      verifier(ecarts, 'forme directe, reprises comme son jumeau `_node`', compte(apres, 'retrait d a'), compte(apres, 'retrait dn a'))
      assert.ok(compte(apres, 'retrait dn a') >= 1, 'le jumeau `_node` reprend à chaque redessin : le test lui-même est à revoir')
      await regler(page, B, 'retirer()')
      const fin = await journal(page)
      verifier(ecarts, 'ligne retirée, retrait .once', compte(fin, 'retrait o a'), 1)
      verifier(ecarts, 'ligne retirée, retrait .once du jumeau', compte(fin, 'retrait on a'), 1)
      verifier(ecarts, 'ligne gardée, aucun retrait .once', compte(fin, 'retrait o b'), 0)
    })
    assert.deepEqual(ecarts, [])
  })

  it('{await} : `el` est la balise de l\'attente, de {success} (une fois, ou reprise quand `$theme` change) et de {error}', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-ae-attente'
    const ecarts = [] as string[]
    await jouer(B, '.att', async (page) => {
      verifier(ecarts, 'attente, balise reçue', await lus(page, B, '.att', 'data-vu'), 'att:i')
      await regler(page, B, 'finir()')
      verifier(ecarts, '{success} .once, balise reçue', await lus(page, B, '.ok', 'data-vu'), 'ok7:b')
      verifier(ecarts, '{success} reprise, balise reçue', await lus(page, B, '.ok-theme', 'data-vu'), 'clair7:b')
      verifier(ecarts, '{success} jumeau `_node`', await lus(page, B, '.ok-node', 'data-vu'), 'oknode7:b')
      await regler(page, B, 'habiller(\'sombre\')')
      verifier(ecarts, '{success} reprise après $theme, balise reçue', await lus(page, B, '.ok-theme', 'data-vu'), 'sombre7:b')
      const j = await journal(page)
      verifier(ecarts, '{success} .once, une seule pose', compte(j, 'pose ok7'), 1)
      verifier(ecarts, '{success} .once, aucun retrait', compte(j, 'retrait ok7'), 0)
      verifier(ecarts, '{success} reprise, ancien retrait', compte(j, 'retrait clair7'), 1)
    })
    await jouer(B, '.att', async (page) => {
      await regler(page, B, 'refuser()')
      verifier(ecarts, '{error} .once, balise reçue', await lus(page, B, '.ko', 'data-vu'), 'ko:non:b')
    })
    assert.deepEqual(ecarts, [])
  })

  it('forme fabrique : la fabrique reçoit la balise, un paramètre qui s\'appelle `el` reste le sien, une ligne de {for} aussi', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-ae-fabrique'
    const ecarts = [] as string[]
    await jouer(B, '.f1', async (page) => {
      verifier(ecarts, 'fabrique', await lus(page, B, '.f1', 'data-vu'), 'fab:canvas')
      verifier(ecarts, 'fabrique .once', await lus(page, B, '.f2', 'data-vu'), 'une-fois:canvas')
      verifier(ecarts, 'paramètre `el` de l\'auteur', await lus(page, B, '.f3', 'data-vu'), 'param:canvas')
      verifier(ecarts, 'fabrique dans une ligne', await lus(page, B, '.f4', 'data-vu'), 'lignea:canvas,ligneb:canvas')
      const j = await journal(page)
      for (const nom of ['fab', 'une-fois', 'lignea', 'ligneb']) verifier(ecarts, `pose de ${nom}`, compte(j, 'pose ' + nom), 1)
    })
    assert.deepEqual(ecarts, [])
  })

  it('le script de l\'auteur déclare `el` : c\'est le sien, à la racine, dans une ligne, dans {success}, avec ou sans `.once`', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-ae-auteur'
    const ecarts = [] as string[]
    await jouer(B, '.a1', async (page) => {
      await regler(page, B, 'finir()')
      verifier(ecarts, 'racine', await lus(page, B, '.a1', 'data-vu'), 'mien:canvas')
      verifier(ecarts, 'racine .once', await lus(page, B, '.a2', 'data-vu'), 'mien:canvas')
      verifier(ecarts, 'ligne de {for}', await lus(page, B, '.a3', 'data-vu'), 'mien:canvas')
      verifier(ecarts, '{success}', await lus(page, B, '.a4', 'data-vu'), 'mien:canvas')
      verifier(ecarts, 'quatre poses, une par balise', compte(await journal(page), 'pose mien'), 4)
    })
    assert.deepEqual(ecarts, [])
  })
})
