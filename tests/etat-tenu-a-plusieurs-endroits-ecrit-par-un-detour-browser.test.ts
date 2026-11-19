// Un objet de l'état tenu à plusieurs endroits, écrit par un détour, en navigateur réel : l'objet commun à deux lignes écrit par une autre
// variable ou par le chemin d'une ligne, l'enfant qui écrit l'objet qu'il tient (le parent et le frère le montrent), le magasin écrit par
// la variable d'une boucle ou par un élément trouvé (l'enfant de la ligne le montre). Chaque affichage de l'objet montre la valeur écrite,
// comme après l'écriture par le chemin direct. Développement et production, Chromium et Firefox
// moteurs exigés : chromium firefox
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'
import { playTogether } from './helpers/engines-together.js'

const js = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
const SOURCES: Record<string, string> = {
  'zb-cat.mjs':     js(['$item = null;'], "<em>{$item ? $item.cat.nom : 'nul'}</em>"),
  'zb-ec.mjs':      js(['$item = null;', "@ecrire = function(v) { $item.n = 'E' + v; };"], "<em>{$item ? $item.n : 'nul'}</em>"),
  'zb-vu.mjs':      js(['$item = null;'], "<em>{$item ? $item.n : 'nul'}</em>"),
  'zb-adr.mjs':     js(['$item = null;'], "<em>{$item ? $item.adresse.ville : 'nul'}</em>"),
  'zb-commun.mjs':  js(["const chat = { nom: 'a' };", '$cats = [chat];', '$rows = [{ id: 1, cat: chat }, { id: 2, cat: chat }];', "@parAutre = function(v) { $cats[0].nom = 'A' + v; };", "@direct = function(v) { $rows[0].cat.nom = 'D' + v; };"], '{for r in $rows by id}<@zb-cat item={r}></@zb-cat>{end}'),
  'zb-enfant.mjs':  js(["$o = { a: { n: 'a' } };"], '<b>{$o.a.n}</b><@zb-ec item={$o.a}></@zb-ec><@zb-vu item={$o.a}></@zb-vu>'),
  'zb-magasin.mjs': js(["$$zbliste = [{ id: 1, adresse: { ville: 'a' } }, { id: 2, adresse: { ville: 'b' } }];", "@parBoucle = function(v) { for (const t of $$zbliste) if (t.id === 2) t.adresse.ville = 'B' + v; };", "@parTrouve = function(v) { $$zbliste.find((t) => t.id === 2).adresse.ville = 'T' + v; };"], '{for t in $$zbliste by id}<@zb-adr item={t}></@zb-adr><i>{t.adresse.ville}</i>{end}'),
}
// cas : [balise, geste joué dans la page, ce que montrent les enfants, les `<b>` et les `<i>` du composant]
const CAS: Array<[string, string, string, string[]]> = [
  ['un objet commun à deux lignes, écrit par une autre variable (`$cats[0].nom = v`) : les enfants qui tiennent les lignes le montrent', 'mjs-zb-commun', 'el.parAutre(1)', ['A1 A1', '', '']],
  ['un objet commun à deux lignes, écrit par le chemin d\'une ligne (`$rows[0].cat.nom = v`) : l\'enfant qui tient l\'autre ligne le montre', 'mjs-zb-commun', 'el.direct(1)', ['D1 D1', '', '']],
  ['un enfant écrit l\'objet qu\'il tient (`$item.n = v`) : le parent et le frère qui tient le même objet le montrent', 'mjs-zb-enfant', "el._shadow.querySelector('mjs-zb-ec').ecrire(1)", ['E1 E1', 'E1', '']],
  ['magasin écrit plus bas par la variable d\'une boucle : la ligne et son enfant le montrent', 'mjs-zb-magasin', 'el.parBoucle(1)', ['a B1', '', 'a B1']],
  ['magasin écrit plus bas par un élément trouvé (`$$liste.find(f).adresse.ville = v`) : la ligne et son enfant le montrent', 'mjs-zb-magasin', 'el.parTrouve(1)', ['a T1', '', 'a T1']],
]
const BALISES = [...new Set(CAS.map(([, b]) => b))]
// le texte de l'`<em>` de chaque composant enfant, puis les `<b>` et les `<i>` du composant
const LIRE = (balise: string) => `(() => {
  const sh = document.querySelector('${balise}')._shadow
  const kids = Array.from(sh.querySelectorAll('*')).filter((n) => n.tagName.startsWith('MJS-')).map((k) => { const e = k._shadow && k._shadow.querySelector('em'); return e ? e.textContent : '?' })
  const own = (s) => Array.from(sh.querySelectorAll(s)).map((n) => n.textContent).join(' ')
  return [kids.join(' '), own('b'), own('i')]
})()`

const NAVIGATEURS = ['chromium', 'firefox'] as const
const MODES: Mode[] = ['dev-parents-avant', 'bundle']
const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

for (const nav of NAVIGATEURS) playTogether(describe(`objet de l'état tenu à plusieurs endroits, écrit par un détour (${nav} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) { console.log(`  ℹ️  ${nav} non installé, test sauté. Activer : \`npx playwright install ${nav}\``); return }
    browser = await playwright[nav].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of MODES) for (const [titre, balise, geste, attendu] of CAS) it(`${titre} (${mode})`, async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible(mode), balise)
    try {
      await attendre(o.page, balise, 1)
      await o.page.evaluate(`(() => { const el = document.querySelector('${balise}'); ${geste} })()`)
      await o.page.waitForTimeout(150)
      assert.deepEqual(await o.page.evaluate(LIRE(balise)), attendu, 'enfants, `<b>` et `<i>` du composant, après le geste')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    }
    finally {
      await o.fermer()
    }
  })
}))
