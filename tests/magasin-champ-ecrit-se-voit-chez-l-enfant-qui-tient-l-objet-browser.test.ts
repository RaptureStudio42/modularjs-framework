// Un objet du magasin `$$`, tenu par un enfant à qui un composant le passe par une prop simple (`item={$$m[0]}`, `item={r}` d'une ligne de
// `{for r in $$m}`), dont un champ est écrit par le code compilé (`$$m[0].nom = v`, `r.nom = v`, sans passer par l'enveloppe de `µ.store`) :
// l'enfant montre la valeur écrite, comme le composant qui lit le magasin. L'écriture fait avancer l'époque de l'objet écrit, que l'enfant
// compare quand le composant lui repose le même objet ; sans elle, l'enfant prend la prop reposée pour un écho et garde l'ancienne valeur.
// Écritures jouées : par le chemin du magasin hors d'une liste, par la variable d'une ligne, par le chemin dans une ligne, par une fonction
// du script, une liste tenue par l'enfant modifiée par une méthode (`$$o.l.push(v)`), un champ retiré (`delete $$o.p.x`), la liste entière
// tenue par l'enfant (`item={$$m}`, `$$m.push(v)`), et le champ écrit par un autre composant qui ne tient pas l'objet. Développement et
// production, en navigateur réel (trois moteurs)
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'
import { playTogether } from './helpers/engines-together.js'

const enfant = "<script>\n  agir = -> µemit 'renomme', 'Z'\n</script>\n\n<p class=\"vu\">{JSON.stringify($item)}</p>\n<button class=\"x\" type=\"button\" @click={agir()}>x</button>\n"
const SOURCES: Record<string, string> = {
  'ma-chemin.mjs':   "<script>\n  $$ma1 = [{ nom: 'a' }]\n</script>\n\n<@c-ma-enfant item={$$ma1[0]} @renomme={$$ma1[0].nom = e.data}>\n<p class=\"etat\">{$$ma1[0].nom}</p>\n",
  'ma-ligne.mjs':    "<script>\n  $$ma2 = [{ nom: 'a' }]\n</script>\n\n{for r in $$ma2}\n  <@c-ma-enfant item={r} @renomme={r.nom = e.data}>\n{end}\n<p class=\"etat\">{$$ma2[0].nom}</p>\n",
  'ma-lignechemin.mjs': "<script>\n  $$ma3 = [{ nom: 'a' }]\n</script>\n\n{for r in $$ma3}\n  <@c-ma-enfant item={r} @renomme={$$ma3[0].nom = e.data}>\n{end}\n<p class=\"etat\">{$$ma3[0].nom}</p>\n",
  'ma-fonction.mjs': "<script>\n  $$ma4 = [{ nom: 'a' }]\n  renomme = (v) -> $$ma4[0].nom = v\n</script>\n\n<@c-ma-enfant item={$$ma4[0]} @renomme={renomme(e.data)}>\n<p class=\"etat\">{$$ma4[0].nom}</p>\n",
  'ma-appel.mjs':    "<script>\n  $$ma5 = { l: ['a'] }\n</script>\n\n<@c-ma-enfant item={$$ma5.l} @renomme={$$ma5.l.push(e.data)}>\n<p class=\"etat\">{$$ma5.l.join(',')}</p>\n",
  'ma-retrait.mjs':  "<script>\n  $$ma6 = { p: { nom: 'a', x: 1 } }\n</script>\n\n<@c-ma-enfant item={$$ma6.p} @renomme={delete $$ma6.p.x}>\n<p class=\"etat\">{Object.keys($$ma6.p).join(',')}</p>\n",
  'ma-racine.mjs':   "<script>\n  $$ma7 = ['a']\n</script>\n\n<@c-ma-enfant item={$$ma7} @renomme={$$ma7.push(e.data)}>\n<p class=\"etat\">{$$ma7.join(',')}</p>\n",
  'ma-autre.mjs':    "<script>\n  $$ma8 = [{ nom: 'a' }]\n</script>\n\n{for r in $$ma8}\n  <@c-ma-enfant item={r}>\n{end}\n<@c-ma-editeur>\n<p class=\"etat\">{$$ma8[0].nom}</p>\n",
  'c-ma-enfant.mjs': enfant,
  'c-ma-editeur.mjs': "<script>\n  agir = -> $$ma8[0].nom = 'Z'\n</script>\n\n<p class=\"vu\">-</p>\n<button class=\"x\" type=\"button\" @click={agir()}>x</button>\n",
}
// ce que montrent l'enfant puis le composant qui lit le magasin, avant et après le clic
const ATTENDU: Record<string, [string[], string[]]> = {
  'mjs-ma-chemin':      [['{"nom":"a"}', 'a'], ['{"nom":"Z"}', 'Z']],
  'mjs-ma-ligne':       [['{"nom":"a"}', 'a'], ['{"nom":"Z"}', 'Z']],
  'mjs-ma-lignechemin': [['{"nom":"a"}', 'a'], ['{"nom":"Z"}', 'Z']],
  'mjs-ma-fonction':    [['{"nom":"a"}', 'a'], ['{"nom":"Z"}', 'Z']],
  'mjs-ma-appel':       [['["a"]', 'a'], ['["a","Z"]', 'a,Z']],
  'mjs-ma-retrait':     [['{"nom":"a","x":1}', 'nom,x'], ['{"nom":"a"}', 'nom']],
  'mjs-ma-racine':      [['["a"]', 'a'], ['["a","Z"]', 'a,Z']],
  'mjs-ma-autre':       [['{"nom":"a"}', 'a'], ['{"nom":"Z"}', 'Z']],
}
const BALISES = Object.keys(ATTENDU)

// la ligne `.vu` de l'enfant, puis la ligne `.etat` du composant
const ECRANS = (balise: string) => `(() => {
  const sh = document.querySelector('${balise}')._shadow
  const e = sh.querySelector('mjs-c-ma-enfant'), etat = sh.querySelector('.etat')
  return [e && e._shadow && e._shadow.querySelector('.vu') ? e._shadow.querySelector('.vu').textContent : '?', etat ? etat.textContent : '?']
})()`
// le bouton qui écrit : l'autre composant pour la dernière scène, sinon l'enfant qui demande l'écriture
const CLIC = (balise: string) => `document.querySelector('${balise}')._shadow.querySelector('${balise === 'mjs-ma-autre' ? 'mjs-c-ma-editeur' : 'mjs-c-ma-enfant'}')._shadow.querySelector('.x').click()`

const NAVIGATEURS = ['chromium', 'firefox', 'webkit'] as const
const MODES: Mode[] = ['dev-parents-avant', 'bundle']
const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

for (const nav of NAVIGATEURS) playTogether(describe(`magasin : un champ écrit se voit chez l'enfant qui tient l'objet (${nav} réel)`, function () {
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

  for (const mode of MODES) for (const balise of BALISES) it(`${balise.slice(7)} (${mode}) : l'enfant montre ce que le magasin tient`, async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible(mode), balise)
    try {
      await attendre(o.page, balise, 1)
      assert.deepEqual(await o.page.evaluate(ECRANS(balise)), ATTENDU[balise][0], 'enfant puis composant, avant le clic')
      await o.page.evaluate(CLIC(balise))
      await o.page.waitForTimeout(150)
      assert.deepEqual(await o.page.evaluate(ECRANS(balise)), ATTENDU[balise][1], 'enfant puis composant, après le clic')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })
}))
