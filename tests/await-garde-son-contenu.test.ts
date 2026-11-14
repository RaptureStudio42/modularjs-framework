// {await.keep expr} : pendant une relecture (une variable citée change : la recherche tapée), la branche {success} reste à l'écran avec
// son ancienne valeur, `µpending` le dit, puis elle se met à jour sur place à l'arrivée — la liste à clé ne bouge que les lignes changées,
// un champ tapé dans une ligne gardée reste. `µsignal` : un AbortSignal par lecture, annulé quand la lecture suivante commence ou quand le
// composant quitte la page ; le rejet d'une lecture annulée n'ouvre jamais {error}. Une réponse dépassée n'écrase jamais la plus récente,
// avec ou sans `keep`, avec ou sans `µsignal`. Sans `keep`, la relecture repasse par l'attente, comme avant, et l'attente refaite
// reçoit ses attaches. Un `{const}` qui lit `µpending` suit la relecture comme `µpending` lui-même
// les réponses sont tenues par le test : chaque lecture appelle `window.__chercher(q, signal)`, qui rend une promesse que le test résout

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const SCRIPT = [
  '<script>',
  "  $q = 'a'",
  '  chercher = (q, signal) -> window.__chercher(q, signal)',
  '</script>',
  '<input aria-label="recherche" class="q" value=!{$q}>'
]

// la scène de la recherche à la frappe ; `option` : `'.keep'` ou rien
const recherche = (option: string, lecture = 'chercher($q, µsignal)') => [
  ...SCRIPT,
  `{await${option} ${lecture}}`,
  '  <p class="att">Chargement</p>',
  '{success membres}',
  '  <p class="busy" hidden={not µpending}>Mise à jour</p>',
  '  <p class="nb">{membres.length} membres</p>',
  '  <ul>',
  '  {for m in membres by id}',
  '    <li class="m">{m.pseudo}<input aria-label="note" class="note"></li>',
  '  {end}',
  '  </ul>',
  '{error err}',
  '  <p class="err">{err.message}</p>',
  '{end}'
].join('\n')

// sans option : l'attache réactive de l'attente, posée à la création de l'attente, à chaque relecture
const ATTACHE = `<script>
  $theme = 'clair'
  $p     = new Promise(->)
  window.__poses = []
  marque = (qui, th) -> (n) ->
    window.__poses.push('pose ' + qui + ' ' + th)
    n.setAttribute('data-marque', th)
    ->
      window.__poses.push('defait ' + qui + ' ' + th)
  @relancer = -> $p = new Promise(->)
  @habiller = (x) -> $theme = x
</script>
{await $p}
  <i class="att" :attach={marque('att', $theme)}>attente</i>
{success}
  <b class="ok" :attach={marque('ok', $theme)}>ok</b>
{end}
`

// `µpending` lu par un `{const}` de la branche gardée, à côté de `{if µpending}` et d'un `{const}` qui lit la valeur
const CONSTANTE = [
  ...SCRIPT,
  '{await.keep chercher($q, µsignal)}',
  '  <p class="att">Chargement</p>',
  '{success membres}',
  '  {const occupe = µpending}',
  '  {const nb = membres.length}',
  '  <p class="occ">[{occupe}] {nb}</p>',
  '  {if µpending}<p class="si">en cours</p>{end}',
  '{end}'
].join('\n')

const SOURCES: Record<string, string> = {
  'tst-agc-garde.mjs':       recherche('.keep'),
  'tst-agc-sans.mjs':        recherche(''),
  'tst-agc-sans-signal.mjs': recherche('.keep', 'chercher($q)'),
  'tst-agc-attache.mjs':     ATTACHE,
  'tst-agc-constante.mjs':   CONSTANTE
}

type Appel = { q: string, signal: any, resolve: (v: any) => void, reject: (e: any) => void }

function projetTemporaire(): string {
  const root   = mjsTmp('await-garde-son-contenu')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

const membres = (...l: Array<[number, string]>) => l.map(([id, pseudo]) => ({ id, pseudo }))

describe('{await.keep …} : le contenu gardé pendant une relecture, µpending, µsignal', function () {
  this.timeout(60000)

  let app: any
  let appels: Appel[] = []

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
    app.window.__chercher = (q: string, signal: any) => new Promise((resolve, reject) => { appels.push({ q, signal, resolve, reject }) })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  beforeEach(() => { appels = [] })

  const pseudos = (c: any) => c.findAll('.m').map((n: any) => n.textContent.trim()).join(',')

  it('la recherche à la frappe : la liste reste pendant la relecture, µpending la signale, les lignes gardées et leur champ restent', async () => {
    const c = await app.mount('tst-agc-garde')
    assert.equal(appels.length, 1, 'une lecture au premier affichage')
    assert.ok(c.find('.att'), 'premier affichage : la branche d\'attente')
    appels[0].resolve(membres([1, 'Ann'], [2, 'Bob']))
    await c.tick()
    assert.equal(pseudos(c), 'Ann,Bob')
    assert.equal(c.find('.busy').hidden, true, 'rien en vol : µpending faux')
    const bob = c.findAll('.m')[1]
    bob.querySelector('.note').value = 'à rappeler'

    await c.type('.q', 'b')
    assert.equal(appels.length, 2, 'la frappe relit l\'expression')
    assertAbsent(c.find('.att'), 'pendant la relecture, l\'attente ne revient pas')
    assert.equal(pseudos(c), 'Ann,Bob', 'pendant la relecture, l\'ancienne liste reste')
    assert.equal(c.find('.busy').hidden, false, 'relecture en vol : µpending vrai')

    appels[1].resolve(membres([2, 'Bob'], [3, 'Cyd']))
    await c.tick()
    assert.equal(pseudos(c), 'Bob,Cyd', 'à l\'arrivée, la liste suit la nouvelle valeur')
    assert.equal(c.text('.nb'), '2 membres')
    assert.ok(c.findAll('.m')[0] === bob, 'la ligne de Bob est la même balise, gardée sur place')
    assert.equal(bob.querySelector('.note').value, 'à rappeler', 'le champ tapé dans la ligne gardée reste')
    assert.equal(c.find('.busy').hidden, true, 'arrivée : µpending faux')
    c.destroy()
  })

  it('une requête dépassée qui arrive en dernier n\'écrase pas la plus récente ; son signal est annulé dès la lecture suivante', async () => {
    const c = await app.mount('tst-agc-garde')
    appels[0].resolve(membres([1, 'Ann']))
    await c.tick()
    await c.type('.q', 'b')
    await c.type('.q', 'bo')
    assert.equal(appels.length, 3)
    assert.equal(appels[1].signal?.aborted, true, 'la lecture dépassée a son signal annulé')
    assert.equal(appels[2].signal?.aborted, false, 'la lecture en cours garde le sien')
    appels[2].resolve(membres([2, 'Bob']))
    await c.tick()
    appels[1].resolve(membres([9, 'Vieux']))
    await c.tick()
    assert.equal(pseudos(c), 'Bob', 'la réponse dépassée, arrivée en dernier, n\'écrase rien')
    c.destroy()
  })

  it('le rejet d\'une lecture annulée n\'ouvre pas {error}', async () => {
    const c = await app.mount('tst-agc-garde')
    appels[0].resolve(membres([1, 'Ann']))
    await c.tick()
    await c.type('.q', 'b')
    await c.type('.q', 'bo')
    appels[1].reject(Object.assign(new Error('annulée'), { name: 'AbortError' }))
    await c.tick()
    assertAbsent(c.find('.err'), 'aucune branche {error} pour une lecture annulée')
    assert.equal(pseudos(c), 'Ann', 'l\'ancienne liste reste')
    appels[2].resolve(membres([2, 'Bob']))
    await c.tick()
    assert.equal(pseudos(c), 'Bob')
    c.destroy()
  })

  it('une erreur pendant la relecture remplace le contenu par {error}', async () => {
    const c = await app.mount('tst-agc-garde')
    appels[0].resolve(membres([1, 'Ann']))
    await c.tick()
    await c.type('.q', 'b')
    appels[1].reject(new Error('serveur tombé'))
    await c.tick()
    assert.equal(c.text('.err'), 'serveur tombé')
    assert.equal(c.findAll('.m').length, 0, 'la liste est partie')
    c.destroy()
  })

  it('le composant qui quitte la page annule la lecture en vol', async () => {
    const c = await app.mount('tst-agc-garde')
    appels[0].resolve(membres([1, 'Ann']))
    await c.tick()
    await c.type('.q', 'b')
    assert.equal(appels[1].signal?.aborted, false)
    c.destroy()
    await new Promise((r) => setTimeout(r, 0))
    assert.equal(appels[1].signal?.aborted, true, 'retiré de la page : le signal de la lecture en vol est annulé')
  })

  it('keep sans µsignal : la liste reste, et la réponse dépassée arrivée en dernier n\'écrase rien', async () => {
    const c = await app.mount('tst-agc-sans-signal')
    assert.equal(appels[0].signal, undefined, 'sans µsignal, l\'expression ne reçoit rien')
    appels[0].resolve(membres([1, 'Ann']))
    await c.tick()
    await c.type('.q', 'b')
    assert.equal(pseudos(c), 'Ann')
    await c.type('.q', 'bo')
    appels[2].resolve(membres([2, 'Bob']))
    await c.tick()
    appels[1].resolve(membres([9, 'Vieux']))
    await c.tick()
    assert.equal(pseudos(c), 'Bob')
    c.destroy()
  })

  it('sans keep : la relecture repasse par l\'attente et refait la liste, et la réponse dépassée n\'écrase rien', async () => {
    const c = await app.mount('tst-agc-sans')
    appels[0].resolve(membres([1, 'Ann'], [2, 'Bob']))
    await c.tick()
    const bob = c.findAll('.m')[1]
    await c.type('.q', 'b')
    assert.ok(c.find('.att'), 'l\'attente revient')
    assert.equal(c.findAll('.m').length, 0, 'la liste est partie')
    await c.type('.q', 'bo')
    assert.equal(appels[1].signal?.aborted, true, 'µsignal sans keep : la lecture dépassée est annulée')
    appels[2].resolve(membres([2, 'Bob']))
    await c.tick()
    appels[1].resolve(membres([9, 'Vieux']))
    await c.tick()
    assert.equal(pseudos(c), 'Bob')
    assert.ok(c.findAll('.m')[0] !== bob, 'la liste est refaite à neuf')
    c.destroy()
  })

  it('sans keep : l\'attente refaite par une relecture reçoit son attache, qui suit ensuite ses variables', async () => {
    const c = await app.mount('tst-agc-attache')
    await c.tick()
    const marque = () => c.find('.att')?.getAttribute('data-marque') ?? 'aucune'
    assert.equal(marque(), 'clair', 'au montage')
    c.el.relancer()
    await c.tick()
    await c.tick()
    assert.equal(marque(), 'clair', 'l\'attente refaite par la relecture porte son attache')
    await c.el.habiller('sombre')
    await c.tick()
    assert.equal(marque(), 'sombre', 'puis l\'attache suit $theme')
    const poses = app.window.__poses as string[]
    assert.equal(poses.filter((j) => j.startsWith('pose att')).length - poses.filter((j) => j.startsWith('defait att')).length, 1, 'une seule attache vivante : ' + poses.join(', '))
    c.destroy()
  })

  it('keep : un {const} qui lit µpending suit la relecture, comme {if µpending} ; celui qui lit la valeur suit l\'arrivée', async () => {
    const c = await app.mount('tst-agc-constante')
    appels[0].resolve(membres([1, 'Ann']))
    await c.tick()
    assert.equal(c.text('.occ'), '[false] 1')
    assertAbsent(c.find('.si'), 'rien en vol')
    await c.type('.q', 'b')
    assert.equal(c.text('.occ'), '[true] 1', 'pendant la relecture : le {const} lit µpending vrai, l\'ancienne valeur reste')
    assert.ok(c.find('.si'), '{if µpending} suit aussi')
    appels[1].resolve(membres([2, 'Bob'], [3, 'Cyd']))
    await c.tick()
    assert.equal(c.text('.occ'), '[false] 2', 'à l\'arrivée : µpending faux, la nouvelle valeur')
    assertAbsent(c.find('.si'))
    c.destroy()
  })
})
