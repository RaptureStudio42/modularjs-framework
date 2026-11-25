// Une <select> liée à une variable (`value={$x}`, `value=!{$x}`) choisit l'option qui porte sa valeur quand la valeur des options est
// CALCULÉE (`<option value={µPas.JOUR}>`, une constante du script, une variable, une ligne de `{for}`), en navigateur réel. Défauts
// garantis absents :
// - liste VIDE au premier affichage, aucune option choisie : la valeur de la liste s'écrit avant celle de ses options (options du
//   gabarit encore à `value=''`), à la racine, dans un `{if}` ouvert dès le départ ou dans une ligne de `{for}`, en développement, en
//   production et au rendu du serveur, dans Chromium et Firefox ;
// - option qui reçoit après coup la valeur de la liste sans être choisie (variable qui change, valeur de la liste inchangée) ;
// - option sans `value` dont le texte est calculé (`<option>{nom}</option>`) pas choisie quand ce texte s'écrit après la valeur de
//   la liste, au premier affichage ou ensuite ;
// - au rendu du serveur, liste liée à un nombre dont le HTML montre la première option au lieu de la sienne (la page du serveur
//   compare la valeur aux options sans la mettre en texte).
// Le choix de l'utilisateur reste quand la valeur d'une option change ensuite, et rechoisir n'écrit aucun attribut : les seules
// écritures d'un changement de valeur d'option sont celles des options
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, attendre, variantes } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const TEXTES  = ['auto', 'jour', 'semaine']
const options = (valeurs: string[], textes = TEXTES) => valeurs.map((v, i) => `<option value={${v}}>${textes[i]}</option>`).join('')
const CLASSE  = options(['µPas.AUTO', 'µPas.JOUR', 'µPas.SEMAINE'])
const SCRIPT  = options(['AUTO', 'JOUR', 'SEMAINE'])
const MOBILES = options(['$va', '$vb', 'SEMAINE'], ['a', 'b', 'semaine'])

// le cas relevé par une appli : des constantes d'une classe globale, à la racine, dans un `{if}` ouvert dès le départ et dans chaque
// ligne d'un `{for}` (liée à la ligne), la deuxième option (1) pour ne pas prendre la première, choisie d'office, pour un succès, et la
// première (0)
const S_CLASSE = [
  '<script>',
  '  $pas    = 1',
  '  $zero   = 0',
  '  $ouvert = true',
  '  $rangs  = [{ k: 1 }, { k: 0 }]',
  '</script>',
  '<form>',
  `<select name="r1" aria-label="r1" value={$pas}>${CLASSE}</select>`,
  `<select name="r0" aria-label="r0" value={$zero}>${CLASSE}</select>`,
  '{if $ouvert}',
  `  <select name="i1" aria-label="i1" value={$pas}>${CLASSE}</select>`,
  `  <select name="i0" aria-label="i0" value={$zero}>${CLASSE}</select>`,
  '{end}',
  '{for g in $rangs}',
  `  <select name={'g' + g.k} aria-label="g" value={g.k}>${CLASSE}</select>`,
  '{end}',
  '</form>'
].join('\n') + '\n'

// constantes du script, options dont la valeur est une variable (`v` suit, `u` garde le choix de l'utilisateur), choix multiples,
// `{for}`, double sens, variable typée, `{if}` ouvert plus tard
const S_SCRIPT = [
  '<vars>',
  '  $entier int',
  '</vars>',
  '<script>',
  '  AUTO    = 0',
  '  JOUR    = 1',
  '  SEMAINE = 2',
  '  $pas       = 1',
  '  $plusTard  = false',
  '  $va        = 2',
  '  $vb        = 1',
  '  $plusieurs = [1, 2]',
  "  $opts      = [{ v: AUTO, t: 'auto' }, { v: JOUR, t: 'jour' }, { v: SEMAINE, t: 'semaine' }]",
  '  $deux      = 1',
  '  $entier    = 1',
  '  echange = ->',
  '    $va = 1',
  '    $vb = 3',
  '</script>',
  '<form>',
  `<select name="r" aria-label="r" value={$pas}>${SCRIPT}</select>`,
  `<select name="v" aria-label="v" value={$pas}>${MOBILES}</select>`,
  `<select name="u" aria-label="u" value={$pas}>${MOBILES}</select>`,
  `<select name="m" aria-label="m" multiple value={$plusieurs}>${SCRIPT}</select>`,
  '<select name="p" aria-label="p" value={$pas}>{for o in $opts}<option value={o.v}>{o.t}</option>{end}</select>',
  `<select name="d" aria-label="d" value=!{$deux}>${SCRIPT}</select>`,
  `<select name="t" aria-label="t" value=!{$entier}>${SCRIPT}</select>`,
  '{if $plusTard}',
  `  <select name="l" aria-label="l" value={$pas}>${SCRIPT}</select>`,
  '{end}',
  '</form>',
  '<p class="deux">{$deux}</p>',
  '<p class="entier">{$entier}</p>',
  '<button class="echange" @click={echange()}>échange</button>',
  '<button class="ouvre" @click={$plusTard = true}>ouvre</button>'
].join('\n') + '\n'

// options sans `value` : leur valeur est leur texte, calculé (constantes du script, variables) ; `tv` n'a d'abord aucune option qui
// porte sa valeur, puis l'une la prend
const S_TEXTE = [
  '<script>',
  "  A   = 'auto'",
  "  B   = 'jour'",
  "  $t  = 'jour'",
  "  $ta = 'auto'",
  "  $tb = 'x'",
  '  change = ->',
  "    $tb = 'jour'",
  '</script>',
  '<form>',
  '<select name="tx" aria-label="tx" value={$t}><option>{A}</option><option>{B}</option></select>',
  '<select name="tv" aria-label="tv" value={$t}><option>{$ta}</option><option>{$tb}</option></select>',
  '</form>',
  '<button class="change" @click={change()}>change</button>'
].join('\n') + '\n'

const SOURCES = {
  'Pas.class.mjs': ['class Pas', '  AUTO    = 0', '  JOUR    = 1', '  SEMAINE = 2'].join('\n') + '\n',
  's-classe.mjs':  S_CLASSE,
  's-script.mjs':  S_SCRIPT,
  's-texte.mjs':   S_TEXTE
}

const MODES_JOUES: Mode[] = ['dev-parents-avant', 'bundle', 'split', 'ssr']

// chaque liste par son nom : `valeur indice texte de l'option affichée` (choix multiples : `valeur:texte` de chaque option choisie),
// puis ce qu'envoie le formulaire et les lignes `<p class="…">`
const lire = (balise: string) => `(() => {
  const sh = document.querySelector('${balise}')._shadow
  const vu = {}
  for (const s of sh.querySelectorAll('select')) vu[s.name] = s.multiple ? [...s.selectedOptions].map((o) => o.value + ':' + o.text).join(' ') : s.value + ' ' + s.selectedIndex + ' ' + (s.options[s.selectedIndex]?.text ?? '')
  vu.form = [...new FormData(sh.querySelector('form'))].map(([k, v]) => k + '=' + v).join('&')
  for (const p of sh.querySelectorAll('p[class]')) vu[p.className] = p.textContent
  return vu
})()`

// le choix de l'utilisateur : l'option `i`, puis `input` et `change`, comme le navigateur les envoie
const choisir = (balise: string, nom: string, i: number) => `(() => {
  const s = document.querySelector('${balise}')._shadow.querySelector('select[name=${nom}]')
  s.selectedIndex = ${i}
  s.dispatchEvent(new Event('input', { bubbles: true }))
  s.dispatchEvent(new Event('change', { bubbles: true }))
})()`

const cliquer = (balise: string, classe: string) => `document.querySelector('${balise}')._shadow.querySelector('.${classe}').click()`

// toute écriture d'attribut dans le composant, à partir d'ici
const ecouter = (balise: string) => `(() => {
  window.__attrs = []
  new MutationObserver((l) => window.__attrs.push(...l.map((r) => r.target.localName + '.' + r.attributeName))).observe(document.querySelector('${balise}')._shadow, { attributes: true, subtree: true })
})()`

const ATTENDU_CLASSE = { r1: '1 1 jour', r0: '0 0 auto', i1: '1 1 jour', i0: '0 0 auto', g1: '1 1 jour', g0: '0 0 auto', form: 'r1=1&r0=0&i1=1&i0=0&g1=1&g0=0' }
const DEPART = { r: '1 1 jour', v: '1 1 b', u: '1 1 b', m: '1:jour 2:semaine', p: '1 1 jour', d: '1 1 jour', t: '1 1 jour', form: 'r=1&v=1&u=1&m=1&m=2&p=1&d=1&t=1', deux: '1', entier: '1' }
const TEXTE_DEPART = { tx: 'jour 1 jour', tv: ' -1 ', form: 'tx=jour' }
const TEXTE_FIN    = { tx: 'jour 1 jour', tv: 'jour 1 jour', form: 'tx=jour&tv=jour' }

// la valeur de l'option que montre le HTML du serveur dans la liste `nom` : celle marquée `selected`, sinon la première, que le
// navigateur montre quand aucune ne l'est ; null sans liste
const affichee = (html: string, nom: string) => {
  const liste  = html.match(new RegExp(`<select[^>]*name="${nom}"[^>]*>([\\s\\S]*?)</select>`))?.[1] ?? ''
  const option = liste.match(/<option\b[^>]*\bselected\b[^>]*>/)?.[0] ?? liste.match(/<option\b[^>]*>/)?.[0] ?? ''
  return option.match(/\bvalue="([^"]*)"/)?.[1] ?? null
}

const FIN    = { r: '1 1 jour', v: '1 0 a', u: '2 2 semaine', m: '1:jour 2:semaine', p: '1 1 jour', d: '0 0 auto', t: '1 1 jour', l: '1 1 jour', form: 'r=1&v=1&u=2&m=1&m=2&p=1&d=0&t=1&l=1', deux: '0', entier: '1' }

describe('<select> liée : ses options à valeur calculée sont choisies dès le premier rendu, et quand leur valeur change', function () {
  this.timeout(240000)
  const cibles: Partial<Record<Mode, Cible>> = {}

  before(async () => {
    for (const mode of MODES_JOUES) cibles[mode] = await construire(mode, SOURCES, ['mjs-s-classe', 'mjs-s-script', 'mjs-s-texte'])
  })

  after(async () => { await terminateSharedWorkerPool() })

  // chaque mode (et chaque reprise du rendu serveur) dans un navigateur : les écarts de la scène, préfixés du mode
  async function parcourir(nom: string, balise: string, scene: (page: any) => Promise<string[]>): Promise<string[]> {
    const playwright: any = await import('playwright')
    const browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    const ecarts: string[] = []
    try {
      for (const mode of MODES_JOUES) for (const variante of variantes(mode)) {
        const o = await charger(browser, cibles[mode]!, balise, variante)
        try {
          await attendre(o.page, balise, 0)
          for (const e of [...await scene(o.page), ...o.erreurs]) ecarts.push(`${mode}${variante ? '/' + variante : ''} ${e}`)
        }
        finally {
          await o.fermer()
        }
      }
    }
    finally {
      await browser.close()
    }
    return ecarts
  }

  for (const nom of ['chromium', 'firefox']) it(`${nom} : constantes d'une classe globale, à la racine, dans un {if} ouvert dès le départ, dans une ligne de {for}`, async function () {
    const ecarts = await parcourir(nom, 'mjs-s-classe', async (page) => {
      const vu = await page.evaluate(lire('mjs-s-classe'))
      return isDeepStrictEqual(vu, ATTENDU_CLASSE) ? [] : [JSON.stringify(vu)]
    })
    assert.deepEqual(ecarts, [])
  })

  it('chromium : constantes du script, variables, choix multiples, {for}, double sens, variable typée, {if} ouvert plus tard', async function () {
    const B      = 'mjs-s-script'
    const ecarts = await parcourir('chromium', B, async (page) => {
      const dits: string[] = []
      const depart = await page.evaluate(lire(B))
      if (!isDeepStrictEqual(depart, DEPART)) dits.push('départ ' + JSON.stringify(depart))
      await page.evaluate(choisir(B, 'u', 2))
      await page.evaluate(choisir(B, 'd', 0))
      await page.waitForTimeout(200)
      await page.evaluate(ecouter(B))
      await page.evaluate(cliquer(B, 'echange'))
      await page.waitForTimeout(300)
      // les quatre valeurs d'option changées (`a` et `b` de `v` et de `u`), rien d'autre : rechoisir n'écrit aucun attribut
      const ecrits = await page.evaluate('window.__attrs')
      if (ecrits.join() !== 'option.value,option.value,option.value,option.value') dits.push('écritures ' + ecrits.join())
      await page.evaluate(cliquer(B, 'ouvre'))
      await page.waitForTimeout(300)
      const fin = await page.evaluate(lire(B))
      if (!isDeepStrictEqual(fin, FIN)) dits.push('fin ' + JSON.stringify(fin))
      return dits
    })
    assert.deepEqual(ecarts, [])
  })

  it('chromium : options sans value au texte calculé, au premier affichage puis quand un texte prend la valeur de la liste', async function () {
    const B      = 'mjs-s-texte'
    const ecarts = await parcourir('chromium', B, async (page) => {
      const dits: string[] = []
      const depart = await page.evaluate(lire(B))
      if (!isDeepStrictEqual(depart, TEXTE_DEPART)) dits.push('départ ' + JSON.stringify(depart))
      await page.evaluate(cliquer(B, 'change'))
      await page.waitForTimeout(300)
      const fin = await page.evaluate(lire(B))
      if (!isDeepStrictEqual(fin, TEXTE_FIN)) dits.push('fin ' + JSON.stringify(fin))
      return dits
    })
    assert.deepEqual(ecarts, [])
  })

  it('rendu du serveur : le HTML d\'une liste liée à un nombre montre son option, pour chaque mode de reprise', () => {
    const ecarts: string[] = []
    for (const variante of variantes('ssr')) {
      const html = cibles.ssr!.document('mjs-s-classe', variante)
      for (const [nom, attendu] of [['r1', '1'], ['r0', '0'], ['i1', '1'], ['i0', '0'], ['g1', '1'], ['g0', '0']]) {
        const vu = affichee(html, nom)
        if (vu !== attendu) ecarts.push(`${variante} ${nom} ${vu}`)
      }
    }
    assert.deepEqual(ecarts, [])
  })
})
