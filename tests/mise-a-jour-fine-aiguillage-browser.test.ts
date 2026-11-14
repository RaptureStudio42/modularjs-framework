// mise à jour fine, au navigateur réel (Chromium, Firefox, WebKit) : les cas délicats joués pas à pas donnent l'écran qu'ils donnaient quand
// la variable entière était prévenue — objet tenu par une autre variable, champ de la clé, écriture avant le rendu de la liste, écriture
// par l'enveloppe, échange, boucle qui écrit plusieurs champs, ligne d'une liste cachée par son bloc, valeur refusée par `<vars>`

import assert from 'node:assert/strict'
import { MOTEURS, compilerScript, ouvrirPage } from './helpers/navigateurs-compiles.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const JUSTESSE = [
  '<script lang="js">',
  '  function pick(a) { return a[5]; }',
  '  $data = [];',
  '  $sel = { label: \'-\' };',
  '  $voir = true;',
  '  @run = function() { const a = []; for (let i = 0; i < 10; i++) a.push({ id: i + 1, label: \'r\' + (i + 1), n: 0 }); $data = a; };',
  '  @alias = function() { $sel = $data[3]; $data[3].label += \' A\'; };',
  '  @cle = function() { $data[2].id = 99; };',
  '  @avantRendu = function() { $data = $data.slice(); $data[0].label += \' C\'; };',
  '  @proxy = function() { const r = pick($data); r.label += \' D\'; };',
  '  @swap = function() { const t = $data[1]; $data[1] = $data[8]; $data[8] = t; };',
  '  @boucle = function() { for (let i = 0; i < $data.length; i += 3) { $data[i].label += \'!\'; $data[i].n += 1; } };',
  '  @cacher = function() { $voir = false; };',
  '  @cache = function() { $data[6].label += \' H\'; };',
  '  @montrer = function() { $voir = true; };',
  '</script>',
  '<p id="sel">{$sel.label}</p>',
  '{if $voir}',
  '<table><tbody>',
  '  {for row in $data by id}<tr><td>{row.id}</td><td>{row.label}</td><td>{row.n}</td></tr>{end}',
  '</tbody></table>',
  '{end}',
].join('\n')

const TYPES = '<types>\nLigne\n  id     int\n  label  string\n  n      int 0..10 strict\n</types>\n'

const TYPEE = [
  '<vars>',
  '  $lignes Ligne[]',
  '</vars>',
  '<script lang="js">',
  '  $lignes = [{ id: 1, label: \'a\', n: 1 }, { id: 2, label: \'b\', n: 2 }];',
  '  @refus = function() { $lignes[0].n = 50; };',
  '  @accord = function() { $lignes[0].n = 7; };',
  '</script>',
  '{for l in $lignes by id}<i>{l.label}{l.n}</i>{end}',
].join('\n')

const PAS: [string, string, string][] = [
  ['justesse', 'run', 'sel=- | 1r10 2r20 3r30 4r40 5r50 6r60 7r70 8r80 9r90 10r100'],
  ['justesse', 'alias', 'sel=r4 A | 1r10 2r20 3r30 4r4 A0 5r50 6r60 7r70 8r80 9r90 10r100'],
  ['justesse', 'cle', 'sel=r4 A | 1r10 2r20 99r30 4r4 A0 5r50 6r60 7r70 8r80 9r90 10r100'],
  ['justesse', 'avantRendu', 'sel=r4 A | 1r1 C0 2r20 99r30 4r4 A0 5r50 6r60 7r70 8r80 9r90 10r100'],
  ['justesse', 'proxy', 'sel=r4 A | 1r1 C0 2r20 99r30 4r4 A0 5r50 6r6 D0 7r70 8r80 9r90 10r100'],
  ['justesse', 'swap', 'sel=r4 A | 1r1 C0 9r90 99r30 4r4 A0 5r50 6r6 D0 7r70 8r80 2r20 10r100'],
  ['justesse', 'boucle', 'sel=r4 A! | 1r1 C!1 9r90 99r30 4r4 A!1 5r50 6r6 D0 7r7!1 8r80 2r20 10r10!1'],
  ['justesse', 'cacher', 'sel=r4 A! | '],
  ['justesse', 'cache', 'sel=r4 A! | '],
  ['justesse', 'montrer', 'sel=r4 A! | 1r1 C!1 9r90 99r30 4r4 A!1 5r50 6r6 D0 7r7! H1 8r80 2r20 10r10!1'],
  ['typee', 'refus', 'a1 b2'],
  ['typee', 'accord', 'a7 b2'],
]

// l'écran d'un composant : le texte de `#sel` et de chaque ligne, ou de chaque `<i>`
const ECRAN = `window.__ecran = (nom) => {
  const r = document.querySelector('mjs-' + nom)._shadow
  if (nom === 'typee') return Array.from(r.querySelectorAll('i')).map((x) => x.textContent).join(' ')
  return 'sel=' + r.querySelector('#sel').textContent + ' | ' + Array.from(r.querySelectorAll('tbody tr')).map((tr) => tr.textContent).join(' ')
}`

describe('mise à jour fine — même écran pas à pas (trois moteurs)', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  it('alias, clé, écriture avant le rendu, enveloppe, échange, boucle, liste cachée, valeur refusée', async () => {
    const script = await compilerScript('fine-aiguillage-nav', { 'justesse.mjs': JUSTESSE, 'typee.mjs': TYPEE, 'ligne.types.mjs': TYPES })
    for (const moteur of MOTEURS) {
      const { browser, page, erreurs } = await ouvrirPage(moteur, '<mjs-justesse></mjs-justesse><mjs-typee></mjs-typee>', script + '\n' + ECRAN)
      try {
        await page.waitForFunction(() => (document.querySelector('mjs-typee') as any)?._shadow?.querySelector('i') != null)
        const vus: string[] = []
        for (const [nom, geste] of PAS) {
          await page.evaluate(([n, g]: string[]) => (document.querySelector('mjs-' + n) as any)[g](), [nom, geste])
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
          vus.push(await page.evaluate((n: string) => (window as any).__ecran(n), nom))
        }
        assert.deepEqual(vus, PAS.map((p) => p[2]), moteur)
        assert.deepEqual(erreurs, [], moteur)
      }
      finally {
        await browser.close()
      }
    }
  })
})
