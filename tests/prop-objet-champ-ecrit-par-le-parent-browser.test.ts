// Un objet de l'état du parent, tenu par un enfant à qui le parent le passe par une prop simple (`item={r}`), dont le PARENT écrit un
// champ : l'enfant montre la valeur écrite, comme le parent. L'écriture compilée en chemin (`µ._mjs_deepSet`, sans passer par
// l'enveloppe de l'état) fait avancer l'époque de l'objet écrit, que l'enfant compare quand le parent lui repose le même objet ; sans
// elle, l'enfant prend la prop reposée pour un écho et garde l'ancienne valeur. Écritures jouées : par la variable d'une ligne de
// `{for}` (`r.nom = v`), par le chemin de la liste (`$rows[0].nom = v`), par une fonction du script, et un champ d'un objet que tient
// l'enfant hors d'une liste (`$o.p.nom = v`, l'enfant tient `$o.p`), une liste tenue par l'enfant modifiée par une méthode
// (`$o.l.push(v)`), un champ retiré (`delete $o.p.x`), la ligne qui ne lit que des champs de l'objet (mise à jour fine), et le champ écrit
// par un frère lié à la liste (`items=!{$rows}`, `$items[0].nom = v`). Développement et production, en navigateur réel (trois moteurs).
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'
import { playTogether } from './helpers/engines-together.js'

const enfant = "<script>\n  agir = -> µemit 'renomme', 'Z'\n</script>\n\n<p class=\"vu\">{JSON.stringify($item)}</p>\n<button class=\"x\" type=\"button\" @click={agir()}>x</button>\n"
const LIGNES = "<script>\n  $rows = [{ nom: 'a' }]\n"
const SOURCES: Record<string, string> = {
  'pe-alias.mjs':     LIGNES + "</script>\n\n{for r in $rows}\n  <@c-pe-enfant item={r} @renomme={r.nom = e.data}>\n{end}\n<p class=\"etat\">{$rows[0].nom}</p>\n",
  'pe-chemin.mjs':    LIGNES + "</script>\n\n{for r in $rows}\n  <@c-pe-enfant item={r} @renomme={$rows[0].nom = e.data}>\n{end}\n<p class=\"etat\">{$rows[0].nom}</p>\n",
  'pe-fonction.mjs':  LIGNES + "  renomme = (v) -> $rows[0].nom = v\n</script>\n\n{for r in $rows}\n  <@c-pe-enfant item={r} @renomme={renomme(e.data)}>\n{end}\n<p class=\"etat\">{$rows[0].nom}</p>\n",
  'pe-ligne.mjs':     LIGNES + "</script>\n\n{for r in $rows}\n  <@c-pe-enfant item={r} @renomme={r.nom = e.data}>\n  <p class=\"etat\">{r.nom}</p>\n{end}\n",
  'pe-objet.mjs':     "<script>\n  $o = { p: { nom: 'a' } }\n</script>\n\n<@c-pe-enfant item={$o.p} @renomme={$o.p.nom = e.data}>\n<p class=\"etat\">{$o.p.nom}</p>\n",
  'pe-appel.mjs':     "<script>\n  $o = { l: ['a'] }\n</script>\n\n<@c-pe-enfant item={$o.l} @renomme={$o.l.push(e.data)}>\n<p class=\"etat\">{$o.l.join(',')}</p>\n",
  'pe-retrait.mjs':   "<script>\n  $o = { p: { nom: 'a', x: 1 } }\n</script>\n\n<@c-pe-enfant item={$o.p} @renomme={delete $o.p.x}>\n<p class=\"etat\">{Object.keys($o.p).join(',')}</p>\n",
  'pe-frere.mjs':     LIGNES + "</script>\n\n{for r in $rows}\n  <@c-pe-enfant item={r}>\n{end}\n<@c-pe-editeur items=!{$rows}>\n<p class=\"etat\">{$rows[0].nom}</p>\n",
  'pe-ecrivain.mjs':  LIGNES + "  $sel = { nom: '-' }\n</script>\n\n{for r in $rows}\n  <@c-pe-enfant item={r}>\n{end}\n<@c-pe-redacteur items=!{$rows} first={$rows[0]}>\n<p class=\"etat\">{$rows[0].nom}|{$sel.nom}</p>\n<button class=\"s\" type=\"button\" @click={$sel = $rows[0]}>s</button>\n<button class=\"p\" type=\"button\" @click={$rows[0].nom = $rows[0].nom + 'Y'}>p</button>\n",
  'c-pe-enfant.mjs':  enfant,
  'c-pe-redacteur.mjs': "<script>\n  agir = -> $items[0].nom = 'Z'\n</script>\n\n<p class=\"vu\">{$items[0].nom}/{$first.nom}</p>\n<button class=\"x\" type=\"button\" @click={agir()}>x</button>\n",
  'c-pe-editeur.mjs': "<script>\n  agir = -> $items[0].nom = 'Z'\n</script>\n\n<p class=\"vu\">{$items[0].nom}</p>\n<button class=\"x\" type=\"button\" @click={agir()}>x</button>\n",
}
// ce que montrent l'enfant puis le parent, avant et après le clic
const ATTENDU: Record<string, [string[], string[]]> = {
  'mjs-pe-alias':    [['{"nom":"a"}', 'a'], ['{"nom":"Z"}', 'Z']],
  'mjs-pe-chemin':   [['{"nom":"a"}', 'a'], ['{"nom":"Z"}', 'Z']],
  'mjs-pe-fonction': [['{"nom":"a"}', 'a'], ['{"nom":"Z"}', 'Z']],
  'mjs-pe-ligne':    [['{"nom":"a"}', 'a'], ['{"nom":"Z"}', 'Z']],
  'mjs-pe-objet':    [['{"nom":"a"}', 'a'], ['{"nom":"Z"}', 'Z']],
  'mjs-pe-appel':    [['["a"]', 'a'], ['["a","Z"]', 'a,Z']],
  'mjs-pe-retrait':  [['{"nom":"a","x":1}', 'nom,x'], ['{"nom":"a"}', 'nom']],
  'mjs-pe-frere':    [['{"nom":"a"}', 'a'], ['{"nom":"Z"}', 'Z']],
}
const BALISES = Object.keys(ATTENDU)

// la ligne `.vu` de l'enfant, puis la ligne `.etat` du parent
const ECRANS = (balise: string) => `(() => {
  const sh = document.querySelector('${balise}')._shadow
  const e = sh.querySelector('mjs-c-pe-enfant'), etat = sh.querySelector('.etat')
  return [e && e._shadow && e._shadow.querySelector('.vu') ? e._shadow.querySelector('.vu').textContent : '?', etat ? etat.textContent : '?']
})()`
// le bouton de l'enfant qui écrit : l'éditeur lié pour le frère, sinon l'enfant qui demande l'écriture au parent
const CLIC = (balise: string) => `document.querySelector('${balise}')._shadow.querySelector('${balise === 'mjs-pe-frere' ? 'mjs-c-pe-editeur' : 'mjs-c-pe-enfant'}')._shadow.querySelector('.x').click()`

// développement : les notifications de chaque composant, par variable (`_mjs_notifyMutation`), comptées à partir de la pose ; puis ce que
// montrent l'enfant de la ligne, l'éditeur et le parent
const COMPTER = `(() => {
  const P = globalThis['µ'].Element.prototype, n = P._mjs_notifyMutation
  window.__n = {}
  P._mjs_notifyMutation = function (k, ...a) { const c = this.localName.slice(4) + '.' + k; window.__n[c] = (window.__n[c] || 0) + 1; return n.call(this, k, ...a) }
})()`
const VUS_ECRIVAIN = `(() => {
  const sh = document.querySelector('mjs-pe-ecrivain')._shadow
  return [sh.querySelector('mjs-c-pe-enfant')._shadow.querySelector('.vu').textContent, sh.querySelector('mjs-c-pe-redacteur')._shadow.querySelector('.vu').textContent, sh.querySelector('.etat').textContent]
})()`
const SH_ECRIVAIN = "document.querySelector('mjs-pe-ecrivain')._shadow"

const NAVIGATEURS = ['chromium', 'firefox', 'webkit'] as const
const MODES: Mode[] = ['dev-parents-avant', 'bundle']
const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

for (const nav of NAVIGATEURS) playTogether(describe(`prop objet : un champ écrit par le parent se voit chez l'enfant qui tient l'objet (${nav} réel)`, function () {
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

  for (const mode of MODES) for (const balise of BALISES) it(`${balise.slice(7)} (${mode}) : l'enfant montre ce que le parent a écrit`, async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible(mode), balise)
    try {
      await attendre(o.page, balise, 1)
      assert.deepEqual(await o.page.evaluate(ECRANS(balise)), ATTENDU[balise][0], 'enfant puis parent, avant le clic')
      await o.page.evaluate(CLIC(balise))
      await o.page.waitForTimeout(150)
      assert.deepEqual(await o.page.evaluate(ECRANS(balise)), ATTENDU[balise][1], 'enfant puis parent, après le clic')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })

  // l'écrivain lui-même ne repasse pas : l'éditeur lié qui écrit le champ tient aussi l'objet écrit par une prop simple (`first={$rows[0]}`),
  // que le parent lui repose tel quel ; le parent qui a écrit le champ réécrit le même objet dans une autre variable (`$sel = $rows[0]`).
  // Ces deux variables ont repassé avec l'écriture : l'objet qui leur revient est un écho
  if (MODES.includes('dev-parents-avant')) it('écrivain (dev-parents-avant) : celui qui écrit le champ ne repasse pas quand l\'objet écrit lui revient par une autre variable', async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible('dev-parents-avant'), 'mjs-pe-ecrivain')
    try {
      await attendre(o.page, 'mjs-pe-ecrivain', 2)
      await o.page.evaluate(COMPTER)
      const geste = async (clic: string) => {
        await o.page.evaluate('window.__n = {}')
        await o.page.evaluate(clic)
        await o.page.waitForTimeout(150)
        return o.page.evaluate('window.__n')
      }
      const n1 = await geste(`${SH_ECRIVAIN}.querySelector('mjs-c-pe-redacteur')._shadow.querySelector('.x').click()`)
      assert.deepEqual(await o.page.evaluate(VUS_ECRIVAIN), ['{"nom":"Z"}', 'Z/Z', 'Z|-'], 'la ligne, l\'éditeur et le parent après l\'écriture de l\'éditeur')
      assert.equal(n1['c-pe-redacteur.first'], 1, 'la prop first de l\'éditeur, prévenue par son écriture, ne l\'est pas une seconde fois : ' + JSON.stringify(n1))
      await geste(`${SH_ECRIVAIN}.querySelector('.s').click()`)
      await geste(`${SH_ECRIVAIN}.querySelector('.p').click()`)
      assert.deepEqual(await o.page.evaluate(VUS_ECRIVAIN), ['{"nom":"ZY"}', 'ZY/ZY', 'ZY|ZY'], 'la ligne, l\'éditeur et le parent après l\'écriture du parent')
      const n2 = await geste(`${SH_ECRIVAIN}.querySelector('.s').click()`)
      assert.equal(n2['pe-ecrivain.sel'], undefined, 'le même objet réécrit par le parent qui vient d\'en écrire le champ reste muet : ' + JSON.stringify(n2))
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })
}))
