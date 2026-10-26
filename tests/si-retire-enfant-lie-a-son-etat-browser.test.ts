// Un `{if}` qui monte un composant enfant dont une prop est l'état même que lit le `{if}` (`{if $dialog}<@c-x dialog={$dialog}>{end}`) :
// fermer, c'est-à-dire remettre l'état à `null`, retire l'enfant sans jamais lui livrer `null` (l'enfant lit `$dialog.id` sans `?.`), et
// rouvrir le remonte. Vrais clics, en navigateur réel, en développement (parents définis avant ou après leurs enfants) et en production
// (un seul fichier ou fichiers séparés), y compris :
// - deux écritures dans le même geste : une autre variable de bloc, une autre prop, la même variable deux fois, dans les deux ordres ;
// - plusieurs fermetures rapides : ouvrir et fermer deux fois dans un geste, un double clic, quatre clics enchaînés ;
// - une liaison du parent qui lit `$game.who` quand deux variables de bloc changent ensemble (le bloc passe avant ses liaisons) ;
// - une fermeture demandée par l'enfant, par un événement ou par une liaison à deux sens ;
// - une sortie animée (`@out`) sur une enveloppe du parent, une fermeture pendant l'entrée, une réouverture pendant la sortie ;
// - des attaches de l'enfant qui rendent un nombre (`requestAnimationFrame`) ou un objet au lieu d'une fonction de nettoyage ;
// - un composant proche d'une vraie fenêtre de saisie (`<@window>`, `{if}` interne, fond et carte animés, enfant imbriqué, Échap).
// Chromium et WebKit dans les quatre modes, Firefox en développement et en production en un seul fichier.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const J = 'journal = (what) -> (globalThis.__journal ||= []).push(what)'

// deux boutons dans chaque parent : `.open` écrit l'objet, `.close` (ou `.close2`) le remet à null
const boutons = (...autres: string[]) => ['<button class="open" type="button" @click={@open()}>Ouvrir</button>', '<button class="close" type="button" @click={@close()}>Fermer</button>', ...autres].join('\n')

const SOURCES: Record<string, string> = {
  // le motif rapporté, tel quel
  'rs-motif.mjs': `<script>
  $dialog = null

  @open  = -> $dialog = { id: 7 }
  @close = -> $dialog = null
</script>

${boutons()}
{if $dialog}
  <@c-motif dialog={$dialog}>
{end}
`,
  'c-motif.mjs': `<script>
  $dialog = null
</script>

<div class="win">{$dialog.id}</div>
`,

  // une autre variable de bloc écrite dans le même geste, avant ou après la fermeture
  'rs-deux-blocs.mjs': `<script>
  $dialog = null
  $busy   = false

  @open = ->
    $busy   = true
    $dialog = { id: 7 }
  @close = ->
    $busy   = false
    $dialog = null
  @close2 = ->
    $dialog = null
    $busy   = false
</script>

${boutons('<button class="close2" type="button" @click={@close2()}>Fermer 2</button>')}
{if $busy}<p class="busy">occupé</p>{end}
{if $dialog}
  <@c-motif dialog={$dialog}>
{end}
`,

  // une autre prop écrite dans le même geste, avant ou après la fermeture
  'rs-deux-props.mjs': `<script>
  $dialog = null
  $row    = 0

  @open = ->
    $row    = 3
    $dialog = { id: 7 }
  @close = ->
    $dialog = null
    $row    = 0
  @close2 = ->
    $row    = 0
    $dialog = null
</script>

${boutons('<button class="close2" type="button" @click={@close2()}>Fermer 2</button>')}
{if $dialog}
  <@c-deux-props dialog={$dialog} row={$row}>
{end}
`,
  'c-deux-props.mjs': `<script>
  $dialog = null
  $row    = 0
</script>

<div class="win">{$dialog.id}-{$row}</div>
`,

  // la variable du {if} écrite deux fois dans le même geste, fenêtre ouverte
  'rs-deux-ecritures.mjs': `<script>
  $dialog = null

  @open  = -> $dialog = { id: 7 }
  @close = ->
    $dialog = Object.assign({}, $dialog, { id: 8 })
    $dialog = null
</script>

${boutons()}
{if $dialog}
  <@c-motif dialog={$dialog}>
{end}
`,

  // plusieurs fermetures rapides : ouvrir et fermer deux fois dans un même geste, fermer puis rouvrir puis fermer
  'rs-rafale.mjs': `<script>
  $dialog = null

  @open  = -> $dialog = { id: 7 }
  @close = -> $dialog = null
  @rafale = ->
    $dialog = { id: 1 }
    $dialog = null
    $dialog = { id: 2 }
    $dialog = null
  @rafale2 = ->
    $dialog = null
    $dialog = { id: 3 }
    $dialog = null
</script>

${boutons('<button class="rafale" type="button" @click={@rafale()}>Rafale</button>', '<button class="rafale2" type="button" @click={@rafale2()}>Rafale 2</button>')}
{if $dialog}
  <@c-motif dialog={$dialog}>
{end}
`,

  // deux variables de bloc dans le même geste, et une liaison du parent qui lit $game.who sans garde
  'rs-poker.mjs': `<script>
  $game  = null
  $phase = 'jeu'

  @open = ->
    $phase = 'jeu'
    $game  = { who: 'ana', id: 7 }
  @close = ->
    $phase = 'fin'
    $game  = null
  @close2 = ->
    $game  = null
    $phase = 'fin'
</script>

${boutons('<button class="close2" type="button" @click={@close2()}>Fermer 2</button>')}
{if $phase is 'fin'}<p class="fin">fin</p>{end}
{if $game}
  <@c-poker who={$game.who} dialog={$game}>
{end}
`,
  'c-poker.mjs': `<script>
  $who    = ''
  $dialog = null
</script>

<div class="win">{$who}-{$dialog.id}</div>
`,

  // l'enfant demande la fermeture par un événement, puis écrit encore son propre état
  'rs-evenement.mjs': `<script>
  $dialog = null

  @open  = -> $dialog = { id: 7 }
  @close = -> $dialog = null
</script>

${boutons()}
{if $dialog}
  <@c-evenement dialog={$dialog} @fermeture={@close()}>
{end}
`,
  'c-evenement.mjs': `<script>
  $dialog = null
  $typed  = ''

  @fermer = ->
    µemit 'fermeture'
    $typed = ''
</script>

<div class="win">{$dialog.id}<button class="x" type="button" @click={@fermer()}>x</button></div>
`,

  // l'enfant ferme par une liaison à deux sens
  'rs-deux-sens.mjs': `<script>
  $dialog = null

  @open  = -> $dialog = { id: 7 }
  @close = -> $dialog = null
</script>

${boutons()}
{if $dialog}
  <@c-deux-sens dialog=!{$dialog}>
{end}
`,
  'c-deux-sens.mjs': `<script>
  $dialog = null

  @fermer = -> $dialog = null
</script>

<div class="win">{$dialog?.id}<button class="x" type="button" @click={@fermer()}>x</button></div>
`,

  // des attaches qui rendent un nombre ou un objet : rien n'est pris pour un nettoyage, le démontage va au bout
  'rs-attaches.mjs': `<script>
  $dialog = null

  @open  = -> $dialog = { id: 7 }
  @close = -> $dialog = null
</script>

${boutons()}
{if $dialog}
  <@c-attaches dialog={$dialog}>
{end}
`,
  'c-attaches.mjs': `<script>
  $dialog = null
  ${J}
  focusNode = (node) ->
    journal('focus')
    requestAnimationFrame(-> node.focus({ preventScroll: true }))
  objet = (node) ->
    journal('objet')
    { a: 1 }
  fabrique = (node) -> 42
  garde = (n) -> -> journal('nettoyage ' + $dialog.id)

  µdestroy ->
    journal('destroy ' + $dialog.id)
</script>

<div class="win" tabindex="-1" @attach={focusNode(_node)}>{$dialog.id}</div>
<b class="obj" @attach={objet(_node)}>o</b>
<i class="fab" @attach={fabrique}>f</i>
<s class="garde" @attach={garde}>g</s>
`,

  // sortie animée sur une enveloppe du parent, entrée et sortie dans l'enfant
  'rs-sortie.mjs': `<script>
  $dialog = null

  @open  = -> $dialog = { id: 7 }
  @close = -> $dialog = null
</script>

${boutons()}
{if $dialog}
  <div class="wrap" @in=*fade(duration: 300ms) @out=*fade(duration: 300ms)><@c-sortie dialog={$dialog}></div>
{end}
`,
  'c-sortie.mjs': `<script>
  $dialog = null
</script>

{if $dialog}
  <div class="win" @in=*fly(duration: 220ms) @out=*fade(duration: 300ms)>{$dialog.id}</div>
{end}
`,

  // proche d'une vraie fenêtre de saisie
  'rs-fenetre.mjs': `<script>
  $dialog = null
  $row    = 0

  @open = ->
    $row    = 4
    $dialog = { id: 7, remove: false }
  @close = ->
    $dialog = null
</script>

${boutons()}
{if $dialog}
  <@c-fenetre dialog={$dialog} rowId={$row} @done={@close()}>
{end}
`,
  'c-fenetre.mjs': `<script>
  $dialog = null
  $rowId  = 0
  $typed  = null
  focused = null

  $x = $typed ?? ('n' + $dialog.id + '/' + $rowId)

  @editing = -> $rowId > 0

  @close = ->
    $typed = null
    µemit 'done'

  @onKey = (e) ->
    return unless e.key is 'Escape' and $dialog
    @close()

  focusNode = (node) ->
    return if focused is node
    focused = node
    requestAnimationFrame(-> (node.querySelector('input') or node).focus({ preventScroll: true }))
</script>

<@window @keydown={@onKey(e)}>

{if $dialog}
<button type="button" class="backdrop" @transition=*fade(duration: 160ms) @click={@close()}>fond</button>
<div class="win" role="dialog" tabindex="-1" @in=*fly(duration: 220ms) @out=*fade(duration: 130ms) @attach={focusNode(_node)}>
  <b>{@editing() ? 'modifier' : 'ajouter'} {$dialog.id}</b>
  <input aria-label="x" value={$x} @input={$typed = e.target.value}>
  <@c-champ value={$dialog.id}>
  <button type="button" class="x" @click={@close()}>x</button>
</div>
{end}
`,
  'c-champ.mjs': `<script>
  $value = 0
</script>

<span class="champ">{$value + 1}</span>
`
}
const BALISES = Object.keys(SOURCES).filter((f) => f.startsWith('rs-')).map((f) => 'mjs-' + f.replace('.mjs', ''))

// Firefox charge lentement les fichiers séparés de la production : un mode de développement et un de production lui suffisent
const NAVIGATEURS = ['chromium', 'firefox', 'webkit'] as const
const TOUS: Mode[] = ['dev-parents-avant', 'dev-enfants-avant', 'bundle', 'split']
const MODES_JOUES: Record<typeof NAVIGATEURS[number], Mode[]> = { chromium: TOUS, firefox: ['dev-parents-avant', 'bundle'], webkit: TOUS }

// une construction par mode, partagée par les trois navigateurs
const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

type Etat = { enfants: number, wins: string[], plante: boolean }

// ce que montre le parent : ses enfants `mjs-c-*`, le texte de leur `.win`, un plantage (classe `mjs-error`, lisible en production où les noms
// internes sont raccourcis) du parent ou d'un enfant
const lire = (page: any, balise: string): Promise<Etat> => page.evaluate(`(() => {
  const h = document.querySelector('${balise}')
  const sh = h && h._shadow
  const kids = sh ? Array.from(sh.querySelectorAll('*')).filter((c) => c.localName.startsWith('mjs-c-')) : []
  return {
    enfants: kids.length,
    wins: kids.map((c) => { const w = c._shadow && c._shadow.querySelector('.win'); return w ? w.textContent.trim() : '(sans .win)' }),
    plante: !!(h && h.classList.contains('mjs-error')) || kids.some((c) => c.classList.contains('mjs-error'))
  }
})()`)

// centre d'une balise atteinte dans les ombres fermées : `.open` dans le parent, `mjs-c-x >> .x` dans l'ombre de l'enfant
const centre = async (page: any, balise: string, chemin: string): Promise<{ x: number, y: number }> => {
  const fin = Date.now() + 3000
  for (;;) {
    const r = await page.evaluate(`(() => {
      let n = document.querySelector('${balise}')
      for (const s of ${JSON.stringify(chemin.split(' >> '))}) n = n && n._shadow && n._shadow.querySelector(s)
      if (!n) return null
      const b = n.getBoundingClientRect()
      return b.width > 0 ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null
    })()`)
    if (r) return r
    if (Date.now() > fin) throw new Error('balise introuvable : ' + chemin)
    await page.waitForTimeout(30)
  }
}
const clic = async (page: any, balise: string, chemin: string) => {
  const c = await centre(page, balise, chemin)
  await page.mouse.click(c.x, c.y)
}

// un geste puis l'état attendu : l'enfant présent (avec le texte voulu dans sa `.win`) ou retiré ; l'attente cède au bout du délai
type Geste = { quoi: string, faire: (page: any, b: string) => Promise<void>, attendu: 'present' | 'absent', texte?: string, delai?: number }

const ouvrir = (texte: string, delai?: number): Geste => ({ quoi: 'ouvrir', faire: (p, b) => clic(p, b, '.open'), attendu: 'present', texte, delai })
const fermer = (chemin = '.close', delai?: number): Geste => ({ quoi: 'fermer par ' + chemin, faire: (p, b) => clic(p, b, chemin), attendu: 'absent', delai })

const SCENARIOS: Record<string, Geste[]> = {
  'mjs-rs-motif': [ouvrir('7'), fermer(), ouvrir('7'), fermer()],
  'mjs-rs-deux-blocs': [ouvrir('7'), fermer(), ouvrir('7'), fermer('.close2'), ouvrir('7'), fermer()],
  'mjs-rs-deux-props': [ouvrir('7-3'), fermer(), ouvrir('7-3'), fermer('.close2'), ouvrir('7-3'), fermer()],
  'mjs-rs-deux-ecritures': [ouvrir('7'), fermer(), ouvrir('7'), fermer()],
  'mjs-rs-rafale': [
    { quoi: 'rafale ouvrir / fermer ×2 dans un geste', faire: (p, b) => clic(p, b, '.rafale'), attendu: 'absent' },
    ouvrir('7'),
    { quoi: 'rafale fermer / ouvrir / fermer dans un geste', faire: (p, b) => clic(p, b, '.rafale2'), attendu: 'absent' },
    ouvrir('7'),
    { quoi: 'double clic sur fermer', faire: async (p, b) => { const c = await centre(p, b, '.close'); await p.mouse.dblclick(c.x, c.y) }, attendu: 'absent' },
    { quoi: 'ouvrir, fermer, ouvrir, fermer dans la même tâche', faire: (p, b) => p.evaluate(`(() => { const sh = document.querySelector('${b}')._shadow; const o = sh.querySelector('.open'), f = sh.querySelector('.close'); o.click(); f.click(); o.click(); f.click() })()`), attendu: 'absent' },
    { quoi: 'quatre vrais clics enchaînés', faire: async (p, b) => { await clic(p, b, '.open'); await clic(p, b, '.close'); await clic(p, b, '.open'); await clic(p, b, '.close') }, attendu: 'absent' },
    ouvrir('7'), fermer()
  ],
  'mjs-rs-poker': [ouvrir('ana-7'), fermer(), ouvrir('ana-7'), fermer('.close2'), ouvrir('ana-7'), fermer()],
  'mjs-rs-evenement': [ouvrir('7x'), fermer('mjs-c-evenement >> .x'), ouvrir('7x'), fermer('mjs-c-evenement >> .x'), ouvrir('7x'), fermer()],
  'mjs-rs-deux-sens': [ouvrir('7x'), fermer('mjs-c-deux-sens >> .x'), ouvrir('7x'), fermer('mjs-c-deux-sens >> .x'), ouvrir('7x'), fermer()],
  'mjs-rs-attaches': [ouvrir('7'), fermer(), ouvrir('7'), fermer()],
  'mjs-rs-sortie': [
    ouvrir('7'), fermer('.close', 2500), ouvrir('7'), fermer('.close', 2500),
    { quoi: 'ouvrir puis fermer pendant l\'entrée', faire: async (p, b) => { await clic(p, b, '.open'); await p.waitForTimeout(60); await clic(p, b, '.close') }, attendu: 'absent', delai: 2500 },
    { quoi: 'rouvrir pendant la sortie', faire: async (p, b) => { await clic(p, b, '.open'); await p.waitForTimeout(450); await clic(p, b, '.close'); await p.waitForTimeout(80); await clic(p, b, '.open') }, attendu: 'present', texte: '7' },
    fermer('.close', 2500)
  ],
  'mjs-rs-fenetre': [
    ouvrir('modifier 7x'), fermer('.close', 2500),
    ouvrir('modifier 7x'), fermer('mjs-c-fenetre >> .x', 2500),
    ouvrir('modifier 7x'), fermer('mjs-c-fenetre >> .backdrop', 2500),
    ouvrir('modifier 7x'), { quoi: 'fermer par Échap', faire: async (p) => { await p.waitForTimeout(260); await p.keyboard.press('Escape') }, attendu: 'absent', delai: 2500 },
    ouvrir('modifier 7x'), { quoi: 'taper puis fermer', faire: async (p, b) => { await clic(p, b, 'mjs-c-fenetre >> input'); await p.keyboard.type('abc'); await clic(p, b, 'mjs-c-fenetre >> .x') }, attendu: 'absent', delai: 2500 }
  ]
}

// joue un geste puis attend l'état voulu (sondé toutes les 30 ms) ; rend l'écart lu, ou null
async function jouer(page: any, balise: string, g: Geste): Promise<string | null> {
  await g.faire(page, balise)
  const fin = Date.now() + (g.delai ?? 1500)
  let e = await lire(page, balise)
  const bon = (x: Etat) => !x.plante && (g.attendu === 'absent' ? x.enfants === 0 : x.enfants === 1 && x.wins[0] === g.texte)
  while (!bon(e) && Date.now() < fin) {
    await page.waitForTimeout(30)
    e = await lire(page, balise)
  }
  return bon(e) ? null : `« ${g.quoi} » : attendu ${g.attendu}${g.texte ? ' (' + g.texte + ')' : ''}, lu ${JSON.stringify(e)}`
}

for (const nav of NAVIGATEURS) for (const mode of MODES_JOUES[nav]) describe(`{if} qui retire un enfant lié à son état (${mode}, ${nav} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) { console.log(`  ℹ️  ${nav} non installé, test du {if} qui retire un enfant lié à son état sauté. Activer : \`npx playwright install ${nav}\``); return }
    browser = await playwright[nav].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const balise of BALISES) it(`${balise.slice(7)} : chaque fermeture retire l'enfant, chaque ouverture le remonte, sans erreur`, async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible(mode), balise)
    const ecarts: string[] = []
    try {
      await o.page.waitForFunction(`!!document.querySelector('${balise}')?._shadow?.querySelector('.open')`, null, { timeout: 10000 }).catch(() => { throw new Error(`le parent ne se monte pas, la page dit : ${graves(o).join(' ; ') || 'rien'}`) })
      for (const g of SCENARIOS[balise]) {
        const ecart = await jouer(o.page, balise, g)
        if (ecart) ecarts.push(ecart)
      }
      // une erreur dite un peu après le dernier geste compte aussi
      await o.page.waitForTimeout(150)
      if (balise === 'mjs-rs-attaches') {
        const j: string[] = await o.page.evaluate('[...(globalThis.__journal ?? [])]')
        assert.deepEqual(j.filter((l) => !['focus', 'objet'].includes(l)), ['nettoyage 7', 'destroy 7', 'nettoyage 7', 'destroy 7'], 'le démontage va au bout et lit encore la valeur montée')
      }
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
    assert.deepEqual(ecarts, [])
  })
})
