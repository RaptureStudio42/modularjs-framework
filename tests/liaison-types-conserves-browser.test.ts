// La variable que le parent lie à un enfant à deux sens (`x=!{$v}`) garde son TYPE : 7 reste un nombre, 0 aussi, une date reste une date, un
// booléen, une chaîne vide, un objet, `null` et `undefined` arrivent tels quels — chez l'enfant comme chez le parent.
// Un enfant pas encore défini quand son parent le traite (fichiers séparés, ordre des fichiers en développement, rendu serveur, ligne de
// `{for}` clonée dans un gabarit inerte) recevait la valeur du parent en attribut, donc en TEXTE, la relisait à sa mise à niveau et la renvoyait
// au parent : 7 devenait "7", une date une chaîne entre guillemets. La valeur du parent arrive maintenant typée, par le registre des props en attente.
// Chaque cas se joue à la racine du parent, dans un `{if}` et dans un `{for}`, dans cinq modes de chargement (développement avec les parents
// définis avant ou après les enfants, production en un fichier ou en fichiers séparés, rendu serveur puis hydratation), dans Chromium et Firefox
// réels ; les modules du cœur à valeur numérique (knob, number, gauge, carousel) y sont liés dans les modes sans rendu serveur.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MODES, variantes, SHOW, construire, charger, attendre, lire, lever, graves, parent, enfant } from './helpers/liaison-navigateur.js'
import type { Cible, Liaison, Lecture, Mode, Ouverture } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  'c-zero.mjs': enfant('  $x = 0\n'),
  'c-five.mjs': enfant('  $x = 5\n'),
  'c-none.mjs': enfant('')
}

// chaque valeur, l'enfant à qui elle est liée (son défaut n'est jamais la valeur du parent) et ce que la page doit en montrer
const CAS: Array<{ enfant: string, valeur: string, vu: string }> = [
  { enfant: 'c-zero', valeur: '7',            vu: '7 <number>' },
  { enfant: 'c-five', valeur: '0',            vu: '0 <number>' },
  { enfant: 'c-none', valeur: 'false',        vu: 'false <boolean>' },
  { enfant: 'c-none', valeur: "''",           vu: '"" <string>' },
  { enfant: 'c-none', valeur: '{ a: 1 }',     vu: '{"a":1} <object>' },
  { enfant: 'c-none', valeur: 'new Date(0)',  vu: '"1970-01-01T00:00:00.000Z" <Date>' },
  { enfant: 'c-five', valeur: '7',            vu: '7 <number>' },
  { enfant: 'c-five', valeur: 'null',         vu: 'null <null>' },
  { enfant: 'c-five', valeur: 'undefined',    vu: 'undefined <undefined>' }
]
const LIAISONS: Liaison[] = CAS.map((c) => ({ enfant: c.enfant, valeur: c.valeur }))
const ENFANTS  = CAS.map((c) => `${c.enfant}=${c.vu}`)
const REMONTES = CAS.map((c) => `${c.enfant}.x=${c.vu}`)

// les modules du cœur à valeur numérique : le parent garde ses nombres
const COEUR = `<script>
  $vol = 30
  $q = 4
  $g = 6
  $ix = 2
  ${SHOW}
</script>
<@@knob value=!{$vol} min="0" max="100"></@@knob>
<@@number value=!{$q}></@@number>
<@@gauge value=!{$g}></@@gauge>
<@@carousel index=!{$ix}><div>1</div><div>2</div><div>3</div></@@carousel>
<p class="p0">{show($vol)}</p><p class="p1">{show($q)}</p><p class="p2">{show($g)}</p><p class="p3">{show($ix)}</p>
`

for (const lieu of ['racine', 'si', 'pour'] as const) SOURCES['p-' + lieu + '.mjs'] = parent(lieu, LIAISONS)
SOURCES['p-coeur.mjs'] = COEUR

const BALISES_SSR = ['mjs-p-racine', 'mjs-p-si', 'mjs-p-pour']

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES_SSR))
  return cibles.get(mode)!
}

const titre = (mode: Mode, variante: string) => mode + (variante ? ` (${variante})` : '')

function verifier(lu: Lecture, o: Ouverture, contexte: string) {
  assert.deepEqual(graves(o), [], `${contexte} : aucune erreur, aucun plantage de composant`)
  const attendu: Record<string, string> = {}
  CAS.forEach((c, i) => { attendu['p' + i] = c.vu })
  assert.deepEqual(lu.ps, attendu, `${contexte} : le parent garde ses valeurs ET leur type`)
  assert.deepEqual(lu.enf, ENFANTS, `${contexte} : chaque enfant reçoit la valeur de son parent avec son type, jamais son défaut`)
  assert.deepEqual(lu.binds.filter((b) => !REMONTES.includes(b)), [], `${contexte} : rien d'autre que la valeur du parent ne remonte (ni défaut, ni valeur changée en texte)`)
}

for (const nom of ['chromium', 'firefox'] as const) describe(`types d'une variable liée à deux sens (${nom} réel)`, function () {
  this.timeout(300000)
  let present = false
  let browser: any

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) { console.log(`  ℹ️  ${nom} non installé, test des types liés sauté. Activer : \`npx playwright install ${nom}\``); return }
    browser = await playwright[nom].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const lieu of ['racine', 'si', 'pour'] as const) {
    const lieux = { racine: 'à la racine du parent', si: 'dans un {if}', pour: 'dans un {for}' }
    for (const mode of MODES) for (const variante of variantes(mode)) {
      it(`${lieux[lieu]}, ${titre(mode, variante)} : 7, 0, false, '', objet, date, null et undefined gardent leur type`, async function () {
        if (!present) { this.skip(); return }
        const balise = 'mjs-p-' + lieu
        const o = await charger(browser, await cible(mode), balise, variante)
        try {
          if (lieu === 'si') {
            await attendre(o.page, balise, 0)
            await lever(o.page, balise)
          }
          await attendre(o.page, balise, LIAISONS.length)
          verifier(await lire(o.page, balise), o, `${lieux[lieu]}, ${titre(mode, variante)}`)
        } finally {
          await o.fermer()
        }
      })
    }
  }

  // les modules du cœur, sans rendu serveur
  for (const mode of MODES.filter((m) => m !== 'ssr')) {
    it(`modules du cœur à valeur numérique (knob, number, gauge, carousel), ${mode} : le parent garde ses nombres`, async function () {
      if (!present) { this.skip(); return }
      const o = await charger(browser, await cible(mode), 'mjs-p-coeur')
      try {
        await attendre(o.page, 'mjs-p-coeur', 4)
        const lu = await lire(o.page, 'mjs-p-coeur')
        assert.deepEqual(graves(o), [], 'aucune erreur, aucun plantage de composant')
        assert.deepEqual(lu.ps, { p0: '30 <number>', p1: '4 <number>', p2: '6 <number>', p3: '2 <number>' }, 'le parent garde ses valeurs ET leur type')
        assert.deepEqual(lu.mods.filter((m) => /^core-(knob|gauge|carousel)=/.test(m)), ['core-knob={"value":30}', 'core-gauge={"value":6}', 'core-carousel={"index":2}'], 'chaque module a la valeur du parent, en nombre')
      } finally {
        await o.fermer()
      }
    })
  }
})
