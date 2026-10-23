// suites d'opérations tirées au sort (variables, promesse tenue, rejetée, relancée, retirée) sur un composant dont les branches {await} portent texte, attributs, `{if}`, `{key}`, `{const}`
// et une liste `{for}` sous un `{if}` : après chaque comparaison, le DOM est celui qu'un modèle calculé à la main prévoit, et le composant n'a jamais planté.
// Les graines sont fixes : ce sont celles dont l'histoire plantait le composant (une liste de branche retirée rappelée par sa variable, ses repères réattribués par le pool de nœuds
// texte), chacune coupée peu après le pas fautif. En développement, l'histoire finie, le pool est vidé nœud par nœud : chaque nœud servi est propre, il ne porte plus rien d'un ancien
// usage (ni le choix d'un `{if}`, ni la clé d'un `{key}`, ni aucune autre propriété `_mjs…` à valeur).
// Les trois modes (développement, production en fichiers séparés, production en un seul fichier) en navigateur réel, Chromium puis Firefox quand il est installé.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const BALISE = 'mjs-histoires-au-hasard'

const SOURCES: Record<string, string> = {
  'histoires-au-hasard.mjs': `<script>
  $a = 'a0'
  $b = 'b0'
  $m = 'x'
  $k = 1
  $o = { n: 1 }

  fin = null
  ko  = null
  armer = (res, rej) ->
    fin = res
    ko  = rej
  nouvelle = ->
    p = new Promise(armer)
    p.catch((e) -> e)
    p
  $p = nouvelle()

  @finir    = (x) -> fin(x)
  @echouer  = -> ko(new Error('non'))
  @relancer = -> $p = nouvelle()
  @retirer  = -> $p = null
  @ra = (x) -> $a = x
  @rb = (x) -> $b = x
  @rm = (x) -> $m = x
  @rk = (x) -> $k = x
  @ro = (x) -> $o = x
</script>
<u class="hors">{$a}</u>
{await $p}
  <i class="att" title={$a + $b}>w:{$a}/{$b}</i>
  {if $m is 'x'}<s class="aw1">{$b}</s>{else}<s class="aw2">{$a}</s>{end}
{success v}
  {const c = $o}
  <b class="ok" title={v.t + $a}>S:{v.t}/{$a}/{c.n}</b>
  {if $m is 'x'}<u class="m1">{v.t}{$a}</u>{elsif $m is 'y'}<u class="m2">{$b}{c.n}</u>{else}<u class="m3">z{v.t}</u>{end}
  {key $k}<s class="key">k{$k}{$b}</s>{end}
  {if $k > 1}<div class="ext">{if $m is 'x'}<em class="in1">{$a}</em>{else}<em class="in2">{v.t}{$b}</em>{end}<ul class="ul">{for x in v.items}<li>{x}{$a}</li>{end}</ul></div>{end}
{error err}
  <b class="ko" title={$b}>E:{err.message}/{$a}</b>
  {if $m is 'x'}<u class="m1">{$b}</u>{else}<u class="m2">{err.message}{$a}</u>{end}
{end}
`
}

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, [BALISE]))
  return cibles.get(mode)!
}

// [graine, nombre de pas] : le pas fautif d'avant la correction est le dernier ou l'avant-dernier
const GRAINES: Array<[number, number]> = [[29, 10], [12, 16], [35, 24], [13, 30]]

type Etat = { a: string, b: string, m: string, k: number, n: number, p: { kind: 'pending' | 'success' | 'error' | 'none', val?: { t: string, items: string[] } } }

// ce que le gabarit montre pour cet état
function attendu(s: Etat): string[] {
  const out: string[] = []
  const el = (tag: string, cls: string, texte: string, titre = '') => out.push(`${tag}.${cls}:${texte}|${titre}`)
  if (s.p.kind === 'pending') {
    el('i', 'att', `w:${s.a}/${s.b}`, s.a + s.b)
    if (s.m === 'x') el('s', 'aw1', s.b)
    else el('s', 'aw2', s.a)
  }
  else if (s.p.kind === 'success') {
    const v = s.p.val!
    el('b', 'ok', `S:${v.t}/${s.a}/${s.n}`, v.t + s.a)
    if (s.m === 'x') el('u', 'm1', v.t + s.a)
    else if (s.m === 'y') el('u', 'm2', s.b + s.n)
    else el('u', 'm3', 'z' + v.t)
    el('s', 'key', `k${s.k}${s.b}`)
    if (s.k > 1) {
      const dedans = s.m === 'x' ? s.a : v.t + s.b
      const lis    = v.items.map((x) => x + s.a)
      el('div', 'ext', dedans + lis.join(''))
      if (s.m === 'x') el('em', 'in1', s.a)
      else el('em', 'in2', v.t + s.b)
      el('ul', 'ul', lis.join(''))
      for (const l of lis) el('li', '', l)
    }
  }
  else if (s.p.kind === 'error') {
    el('b', 'ko', `E:non/${s.a}`, s.b)
    if (s.m === 'x') el('u', 'm1', s.b)
    else el('u', 'm2', 'non' + s.a)
  }
  return out
}

const signature = (page: any): Promise<string[]> => page.evaluate(`(() => {
  const h  = document.querySelector('${BALISE}')
  const sh = h._shadow
  if (h.classList.contains('mjs-error') || sh.querySelector('.mjs-fatal-error')) return ['PLANTÉ']
  return [...sh.querySelectorAll('i,b,u,s,em,div,ul,li')].filter((n) => n.className !== 'hors').map((n) => n.localName + '.' + n.className + ':' + n.textContent + '|' + (n.getAttribute('title') ?? ''))
})()`)

// la vidange du pool (développement seulement, où les noms internes sont lisibles) : chaque nœud servi est relevé s'il porte une propriété `_mjs…` à valeur autre que son drapeau
const VIDER_POOL = `(() => {
  const sales = []
  while (µ._mjs_textPool.length > 0) {
    const n = µ._mjs_getTextNode('')
    const propres = Object.getOwnPropertyNames(n).filter((k) => k.startsWith('_mjs') && k !== '_mjs_pooled' && n[k] !== undefined)
    if (propres.length > 0 || n._mjs_pooled !== false) sales.push(propres.join(',') + (n._mjs_pooled !== false ? ' pooled=' + n._mjs_pooled : ''))
  }
  return sales
})()`

// générateur pseudo-aléatoire à graine
function prng(graine: number) {
  let x = graine * 2654435761 % 4294967296
  return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296 }
}

for (const moteur of ['chromium', 'firefox'] as const) for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`histoires tirées au sort sur un composant {await} (${mode}, ${moteur} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[moteur].executablePath())
    if (!present) { console.log(`  ℹ️  ${moteur} non installé, test des histoires tirées au sort sauté. Activer : \`npx playwright install ${moteur}\``); return }
    browser = await playwright[moteur].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('les composants se compilent', async function () {
    if (!present) { this.skip(); return }
    await cible(mode)
  })

  for (const [graine, pas] of GRAINES) it(`graine ${graine}, ${pas} pas`, async function () {
    if (!present) { this.skip(); return }
    const rnd  = prng(graine)
    const pick = <T>(l: T[]): T => l[Math.floor(rnd() * l.length)]
    const o    = await charger(browser, await cible(mode), BALISE)
    const ecarts: string[]   = []
    const histoire: string[] = []
    let s: Etat = { a: 'a0', b: 'b0', m: 'x', k: 1, n: 1, p: { kind: 'pending' } }
    let cpt = 0
    try {
      await o.page.waitForFunction(`!!document.querySelector('${BALISE}')?._shadow?.querySelector('.hors')`, null, { timeout: 10000 })
      await o.page.waitForTimeout(150)
      for (let i = 0; i < pas; i++) {
        const nb = 1 + Math.floor(rnd() * 3)
        const appels: string[] = []
        for (let j = 0; j < nb; j++) {
          const r = rnd()
          cpt++
          if (r < 0.14) { const v = 'a' + cpt; appels.push(`ra('${v}')`); s = { ...s, a: v } }
          else if (r < 0.28) { const v = 'b' + cpt; appels.push(`rb('${v}')`); s = { ...s, b: v } }
          else if (r < 0.40) { const v = pick(['x', 'y', 'z']); appels.push(`rm('${v}')`); s = { ...s, m: v } }
          else if (r < 0.50) { const v = pick([1, 2, 3]); appels.push(`rk(${v})`); s = { ...s, k: v } }
          else if (r < 0.58) { const v = 1 + Math.floor(rnd() * 3); appels.push(`ro({ n: ${v} })`); s = { ...s, n: v } }
          else if (r < 0.74) { appels.push('relancer()'); s = { ...s, p: { kind: 'pending' } } }
          else if (r < 0.88) {
            const val = { t: 'T' + cpt, items: [pick(['i', 'j']) + cpt, 'k' + cpt].slice(0, 1 + Math.floor(rnd() * 2)) }
            appels.push(`finir(${JSON.stringify(val)})`)
            if (s.p.kind === 'pending') s = { ...s, p: { kind: 'success', val } }
          }
          else if (r < 0.94) { appels.push('echouer()'); if (s.p.kind === 'pending') s = { ...s, p: { kind: 'error' } } }
          else { appels.push('retirer()'); s = { ...s, p: { kind: 'none' } } }
        }
        histoire.push(appels.join(' ; '))
        await o.page.evaluate(`(() => { const h = document.querySelector('${BALISE}'); ${appels.map((a) => `h.${a};`).join(' ')} return null })()`)
        const comparer = rnd() < 0.5 || i === pas - 1
        await o.page.waitForTimeout(comparer ? 140 : pick([0, 8, 40]))
        if (!comparer) continue
        let lue   = await signature(o.page)
        const voulu = attendu(s)
        if (JSON.stringify(lue) !== JSON.stringify(voulu)) {
          await o.page.waitForTimeout(400)
          lue = await signature(o.page)
        }
        if (JSON.stringify(lue) !== JSON.stringify(voulu)) {
          ecarts.push(`pas ${i} (${appels.join(' ; ')}) : attendu ${JSON.stringify(voulu)} ; lu ${JSON.stringify(lue)}`)
          break
        }
      }
      if (ecarts.length > 0) ecarts.push('histoire : ' + histoire.join(' | '))
      if (mode === 'dev-parents-avant') {
        const sales: string[] = await o.page.evaluate(VIDER_POOL)
        if (sales.length > 0) ecarts.push(`nœuds texte servis par le pool avec l'état d'un ancien usage : ${[...new Set(sales)].join(' ; ')}`)
      }
      assert.deepEqual([...ecarts, ...graves(o).map((g) => `erreur de la page : ${g}`)], [])
    } finally {
      await o.fermer()
    }
  })
})
