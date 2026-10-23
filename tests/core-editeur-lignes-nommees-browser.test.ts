// Éditeur de texte riche du cœur (<@@editor>) : le nom caché de chaque ligne à cocher (`data-key`), dans Chromium, Firefox et WebKit réels, en construction de
// développement ET de production. Le mode « répondre » retient les cases cochées par le NOM de leur ligne : la coche reste sur sa ligne quand l'auteur modifie la liste.
// - l'éditeur de l'auteur, aux vrais gestes (Entrée, frappe, collage, outil des cases), donne un nom neuf à toute ligne qui n'en a pas (ligne créée, texte ancien) et
//   renomme tout doublon (Entrée au milieu d'une ligne : la première garde son nom ; Entrée au début d'une ligne : la ligne qui a du texte garde le sien ; ligne
//   collée) ; la variable liée et le champ du formulaire portent ces noms ;
// - mode « répondre » : `checked` est la liste des noms cochés, un clic ou Espace annonce `change` avec les noms, le formulaire envoie le nom de chaque ligne cochée, la
//   remise à zéro rend les noms de départ, un nom inconnu est ignoré ; l'auteur qui ajoute une ligne en haut, en retire une ou en déplace une ne déplace aucune coche ;
// - repli : une ligne sans nom se désigne par sa position, comme avant ;
// - le code est celui qui part en production : une page qui n'écrit que `answer` (aucun outil des cases) résout les noms et son éditeur d'auteur les garde, une page sans
//   `answer` (outil des cases seul) nomme les lignes.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { AIDES, BUILDS, MOTEURS, ouvrir, type Page, type Session } from './helpers/editeur-riche.js'

const TEXTE = '<p>Cochez</p><ul data-checklist><li data-key="aa11">Un</li><li data-key="bb22">Deux<ul data-checklist><li data-key="cc33">Deux-un</li></ul></li><li data-key="dd44">Trois</li></ul>'

const PRET = (classes: string[]) => `(() => {
  const h = document.querySelector('mjs-hote')
  const ok = (c) => { const e = h && h._shadow && h._shadow.querySelector('.' + c); return !!(e && e._shadow && e._shadow.querySelector('.surface')) }
  return ${JSON.stringify(classes)}.every(ok)
})()`

// les lignes à cocher de la surface de l'auteur avec leur nom caché : « texte propre:nom »
const AIDES_NOMS = AIDES + `
window.__cles = (html) => [...html.matchAll(/data-key="([^"]*)"/g)].map((m) => m[1])
window.__lis = (c) => [...__sf(c).querySelectorAll('ul[data-checklist] > li')]
window.__propre = (li) => [...li.childNodes].filter((n) => !(n.nodeType === 1 && /^(ul|ol)$/i.test(n.localName))).map((n) => n.textContent).join('')
window.__noms = (c) => __lis(c).map((li) => __propre(li) + ':' + (li.getAttribute('data-key') ?? '-')).join(' | ')
window.__cle = (c, texte) => { const li = __lis(c).find((x) => __propre(x) === texte); return li ? li.getAttribute('data-key') : undefined }
window.__valeur = (c) => __hid(c).value
`

// complète : l'outil des cases et le mode « répondre » dans la même page ; a1 à a3 sont des éditeurs d'auteur, r1 et r2 des éditeurs « répondre »
const COMPLETE: Page = {
  cle:     'lignes-nommees-complete',
  attente: PRET(['a1', 'a2', 'a3', 'a4', 'r1', 'r2']),
  aides:   AIDES_NOMS,
  source:  `<script>
  $texte  = '${TEXTE}'
  $ancien = '<ul data-checklist><li>Pomme</li><li>Poire</li></ul>'
  $debut  = '<p>Premier</p>'
  $fixe   = '<ul data-checklist><li>Pomme</li><li>Poire</li><li>Prune</li></ul>'
  $mixte  = '<ul data-checklist><li>A</li><li data-key="cc33">B</li><li>C</li></ul>'
  $restreint = '<ul data-checklist><li data-key="aa11">A</li><li>B</li></ul>'
  $coches = ['bb22']
  $cfixe  = [1]
  $reps   = []

  @noter = (e)->
    $reps = [...$reps, e.type + ':' + JSON.stringify(e.data)]

  µmount ->
    window.__poser = (nom, v)->
      if nom == 'texte' then $texte = v
      else if nom == 'coches' then $coches = v
      else if nom == 'cfixe' then $cfixe = v
      else if nom == 'fixe' then $fixe = v
    window.__etat = -> { texte: $texte, ancien: $ancien, debut: $debut, coches: $coches, cfixe: $cfixe }
</script>

<form class="f" @noUJS>
  <@@editor class="a1" name="modele" value=!{$texte}></@@editor>
  <@@editor class="a2" name="ancien" value=!{$ancien}></@@editor>
  <@@editor class="a3" name="debut" value=!{$debut}></@@editor>
  <@@editor class="a4" name="restreint" toolbar="bold italic" value=!{$restreint}></@@editor>
  <@@editor class="r1" name="reps[]" answer value={$texte} checked=!{$coches} @change={@noter(e)} @input={@noter(e)}></@@editor>
  <@@editor class="r2" name="fixe[]" answer value={$fixe} checked=!{$cfixe}></@@editor>
  <button type="reset" class="rz">reset</button>
</form>
<pre class="evr">{$reps.join(',')}</pre>
`,
}

// « répondre » seul : aucun outil des cases dans l'application (l'éditeur d'auteur a une barre « gras italique »)
const REPONDRE: Page = {
  cle:     'lignes-nommees-repondre',
  attente: PRET(['a1', 'r1']),
  aides:   AIDES_NOMS,
  source:  `<script>
  $texte  = '${TEXTE}'
  $coches = ['bb22']

  µmount ->
    window.__etat = -> { texte: $texte, coches: $coches }
</script>

<form class="f" @noUJS>
  <@@editor class="a1" name="modele" toolbar="bold italic" value=!{$texte}></@@editor>
  <@@editor class="r1" name="reps[]" answer value={$texte} checked=!{$coches}></@@editor>
</form>
`,
}

// outil des cases seul : aucune page n'écrit `answer`
const SAISIE: Page = {
  cle:     'lignes-nommees-saisie',
  attente: PRET(['a1']),
  aides:   AIDES_NOMS,
  source:  `<script>
  $texte = '<p>Premier</p><ul data-checklist><li>Pomme</li><li>Poire</li></ul>'

  µmount ->
    window.__etat = -> { texte: $texte }
</script>

<form class="f" @noUJS>
  <@@editor class="a1" name="modele" value=!{$texte}></@@editor>
</form>
`,
}

const FORME = /^[a-z][a-z0-9]{3}$/

for (const build of BUILDS) for (const nom of MOTEURS) describe(`éditeur riche, noms cachés des lignes à cocher (${build}, ${nom} réel)`, function () {
  this.timeout(240000)
  let complete: Session | null = null
  let repondre: Session | null = null
  let saisie: Session | null = null
  let s: Session | null = null
  let bilan: string[] = []

  const E     = (expr: string): Promise<any> => s!.page.evaluate(expr)
  const pause = (ms = 150) => s!.page.waitForTimeout(ms)
  const check = (nomEssai: string, ok: any, detail: any = '') => { if (!ok) bilan.push(`${nomEssai} — ${String(detail).slice(0, 500)}`) }
  const fin   = () => assert.deepEqual(bilan, [], 'essais en échec')

  const etats   = (c: string): Promise<string> => E(`__etats('${c}')`)
  const champs  = (c: string): Promise<string[]> => E(`__champs('${c}')`)
  const noms    = (c: string): Promise<string> => E(`__noms('${c}')`)
  const valeur  = (c: string): Promise<string> => E(`__valeur('${c}')`)
  const cles    = (html: string): string[] => Array.from(html.matchAll(/data-key="([^"]*)"/g)).map((m) => m[1])
  const coches  = (nomVar = 'coches'): Promise<string> => E(`JSON.stringify(__etat().${nomVar})`)
  const journal = (): Promise<string> => E(`__H().querySelector('.evr').textContent`)
  const unique  = (k: string[]) => new Set(k).size === k.length && k.every((x) => FORME.test(x))

  async function cocher(c: string, i: number) {
    const p = await E(`__coche('${c}', ${i})`)
    await s!.page.mouse.click(p.x, p.y)
    await pause()
  }

  async function clicBouton(c: string, outil: string) {
    const p = await E(`__center(__btn('${c}', '${outil}'))`)
    await s!.page.mouse.click(p.x, p.y)
    await pause()
  }

  // rend l'auteur à son texte de départ et les cases à leur départ
  async function remettre() {
    await E(`window.__poser('texte', ${JSON.stringify(TEXTE)})`)
    await E(`window.__poser('coches', ['bb22'])`)
    await pause(250)
  }

  before(async () => {
    complete = await ouvrir(nom, build, COMPLETE)
    repondre = await ouvrir(nom, build, REPONDRE)
    saisie   = await ouvrir(nom, build, SAISIE)
  })

  after(async () => {
    for (const x of [complete, repondre, saisie]) if (x) await x.fermer()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () {
    const t = this.currentTest?.title ?? ''
    s = t.startsWith('« répondre » seul') ? repondre : t.startsWith('outil des cases seul') ? saisie : complete
    if (!s) { this.skip(); return }
    bilan = []
  })

  afterEach(() => {
    if (s) assert.deepEqual(s.logs, [], 'la console reste vide')
  })

  it('le texte de l\'auteur garde ses noms : surface, champ du formulaire et variable liée', async function () {
    check('la surface de l\'auteur porte les noms', (await noms('a1')) === 'Un:aa11 | Deux:bb22 | Deux-un:cc33 | Trois:dd44', await noms('a1'))
    check('le champ du formulaire de l\'auteur aussi', JSON.stringify(cles(await valeur('a1'))) === JSON.stringify(['aa11', 'bb22', 'cc33', 'dd44']), await valeur('a1'))
    check('le mode « répondre » ne montre aucun nom', !/aa11|bb22|cc33|dd44/.test(await E(`__sf('r1').textContent`)))
    fin()
  })

  it('mode « répondre » : les cases se désignent par nom, un clic annonce change avec les noms, le formulaire les envoie, la remise à zéro les rend', async function () {
    await remettre()
    check('la case de checked est dessinée cochée', (await etats('r1')) === 'false,true,false,false', await etats('r1'))
    check('un champ, le nom de la ligne', JSON.stringify(await champs('r1')) === JSON.stringify(['reps[]=bb22']), JSON.stringify(await champs('r1')))
    await cocher('r1', 0)
    check('le clic coche Un', (await etats('r1')) === 'true,true,false,false', await etats('r1'))
    check('la variable liée porte les noms dans l\'ordre du texte', (await coches()) === '["aa11","bb22"]', await coches())
    check('change annonce les noms', (await journal()) === 'change:["aa11","bb22"]', await journal())
    check('un champ par ligne cochée, de valeur le nom', JSON.stringify(await champs('r1')) === JSON.stringify(['reps[]=aa11', 'reps[]=bb22']), JSON.stringify(await champs('r1')))
    check('FormData envoie les noms', JSON.stringify(await E(`new FormData(__H().querySelector('.f')).getAll('reps[]')`)) === JSON.stringify(['aa11', 'bb22']))
    await E(`__lignes('r1')[3].focus()`)
    await s!.page.keyboard.press('Space')
    await pause()
    check('Espace coche Trois', (await coches()) === '["aa11","bb22","dd44"]', await coches())
    const avant = await journal()
    await E(`__H().querySelector('.f').reset()`)
    await pause(400)
    check('la remise à zéro rend le nom de départ', (await coches()) === '["bb22"]' && (await etats('r1')) === 'false,true,false,false', `${await coches()} ${await etats('r1')}`)
    check('un seul champ, le nom de départ', JSON.stringify(await champs('r1')) === JSON.stringify(['reps[]=bb22']), JSON.stringify(await champs('r1')))
    check('la remise à zéro n\'annonce pas de change', (await journal()) === avant, await journal())
    fin()
  })

  it('un nom inconnu du texte est ignoré, et le repli par position joue pour une ligne sans nom', async function () {
    await remettre()
    await E(`window.__poser('coches', ['zzzz', 'bb22', 'x', 99, null, 'AB12'])`)
    await pause(200)
    check('seul bb22 est une ligne du texte', (await etats('r1')) === 'false,true,false,false' && JSON.stringify(await champs('r1')) === JSON.stringify(['reps[]=bb22']), `${await etats('r1')} ${JSON.stringify(await champs('r1'))}`)
    check('un texte sans aucun nom : les positions comme avant', (await etats('r2')) === 'false,true,false' && JSON.stringify(await champs('r2')) === JSON.stringify(['fixe[]=1']), `${await etats('r2')} ${JSON.stringify(await champs('r2'))}`)
    await cocher('r2', 2)
    check('un geste annonce les positions et les champs aussi', (await coches('cfixe')) === '[1,2]' && JSON.stringify(await champs('r2')) === JSON.stringify(['fixe[]=1', 'fixe[]=2']), `${await coches('cfixe')} ${JSON.stringify(await champs('r2'))}`)
    await E(`window.__poser('fixe', '<ul data-checklist><li>Pomme</li><li data-key="cc33">Poire</li><li>Prune</li></ul>')`)
    await E(`window.__poser('cfixe', [2, 'cc33'])`)
    await pause(250)
    check('un texte qui mêle lignes nommées et sans nom : Prune est la position 2, Poire a son nom', (await etats('r2')) === 'false,true,true', await etats('r2'))
    await E(`window.__poser('fixe', '<ul data-checklist><li>Pomme</li><li>Poire</li><li>Prune</li></ul>')`)
    await E(`window.__poser('cfixe', [1])`)
    await pause(250)
    fin()
  })

  it('la coche reste sur sa ligne : l\'auteur ajoute une ligne en haut (Entrée au début de Un), en efface une, la déplace', async function () {
    await remettre()
    await E(`__caret('a1', 'Un', 0)`)
    await s!.page.keyboard.press('Enter')
    await s!.page.keyboard.press('ArrowUp')
    await s!.page.keyboard.type('Zéro')
    await pause(250)
    const k = cles(await valeur('a1'))
    check('l\'auteur a cinq lignes, des noms de la bonne forme, tous différents', k.length === 5 && unique(k), (await valeur('a1')) + ' ' + (await noms('a1')))
    check('Un, qui a du texte, garde son nom (Entrée au début d\'une ligne)', (await E(`__cle('a1', 'Un')`)) === 'aa11', await noms('a1'))
    check('Deux, Deux-un et Trois gardent le leur', (await E(`[__cle('a1', 'Deux'), __cle('a1', 'Deux-un'), __cle('a1', 'Trois')].join()`)) === 'bb22,cc33,dd44', await noms('a1'))
    check('Zéro reçoit un nom neuf', !!(await E(`__cle('a1', 'Zéro')`)) && !['aa11', 'bb22', 'cc33', 'dd44'].includes(await E(`__cle('a1', 'Zéro')`)), await noms('a1'))
    check('le mode « répondre » reçoit le texte : cinq cases, la coche est restée sur Deux (troisième ligne)', (await etats('r1')) === 'false,false,true,false,false', await etats('r1'))
    check('la variable des cases n\'a pas bougé', (await coches()) === '["bb22"]', await coches())
    check('un seul champ, le nom', JSON.stringify(await champs('r1')) === JSON.stringify(['reps[]=bb22']), JSON.stringify(await champs('r1')))
    // effacer le texte d'une ligne : elle sort du texte, la coche de Deux reste sur Deux
    await E(`__caret('a1', 'Zéro')`)
    for (let i = 0; i < 4; i++) await s!.page.keyboard.press('Backspace')
    await pause(250)
    check('Zéro effacée : quatre lignes dans le mode « répondre », Deux est la deuxième', (await etats('r1')) === 'false,true,false,false', `${await etats('r1')} ${await noms('a1')}`)
    // déplacer des lignes : le texte de l'auteur arrive avec les mêmes noms dans un autre ordre
    const SOUS = '<ul data-checklist><li data-key="cc33">Deux-un</li></ul>'
    await E(`window.__poser('texte', ${JSON.stringify('<ul data-checklist><li data-key="dd44">Trois</li><li data-key="bb22">Deux' + SOUS + '</li><li data-key="aa11">Un</li></ul>')})`)
    await pause(250)
    check('lignes déplacées : Deux est la deuxième et reste cochée', (await etats('r1')) === 'false,true,false,false', await etats('r1'))
    await E(`window.__poser('texte', ${JSON.stringify('<ul data-checklist><li data-key="aa11">Un</li><li data-key="dd44">Trois</li><li data-key="bb22">Deux' + SOUS + '</li></ul>')})`)
    await pause(250)
    check('Deux descend en troisième position et reste cochée', (await etats('r1')) === 'false,false,true,false', await etats('r1'))
    await remettre()
    check('le texte d\'origine rend les cases d\'origine', (await etats('r1')) === 'false,true,false,false', await etats('r1'))
    fin()
  })

  it('Entrée au milieu d\'une ligne : la première moitié garde le nom, la nouvelle ligne en reçoit un neuf', async function () {
    await remettre()
    await E(`__caret('a1', 'Trois', 3)`)
    await s!.page.keyboard.press('Enter')
    await pause(250)
    const k = cles(await valeur('a1'))
    check('cinq lignes, des noms de la bonne forme, tous différents', k.length === 5 && unique(k), `${await valeur('a1')} ${await noms('a1')}`)
    check('Tro garde dd44', (await E(`__cle('a1', 'Tro')`)) === 'dd44', await noms('a1'))
    check('« is » reçoit un nom neuf', !!(await E(`__cle('a1', 'is')`)) && (await E(`__cle('a1', 'is')`)) !== 'dd44', await noms('a1'))
    check('le champ du formulaire et la variable liée portent les mêmes noms', JSON.stringify(cles(await E(`__etat().texte`))) === JSON.stringify(k), await E(`__etat().texte`))
    await remettre()
    fin()
  })

  it('un texte ancien, sans noms : le premier geste donne un nom neuf à chaque ligne', async function () {
    check('avant tout geste, rien n\'est nommé', (await noms('a2')) === 'Pomme:- | Poire:-', await noms('a2'))
    await E(`__caret('a2', 'Poire')`)
    await s!.page.keyboard.type('s')
    await pause(250)
    const k = cles(await valeur('a2'))
    check('les deux lignes ont un nom de la bonne forme, différents', k.length === 2 && unique(k), `${await valeur('a2')} ${await noms('a2')}`)
    check('le texte est celui que l\'auteur a tapé', (await valeur('a2')).replace(/ data-key="[^"]*"/g, '') === '<ul data-checklist><li>Pomme</li><li>Poires</li></ul>', await valeur('a2'))
    check('la variable liée porte les mêmes noms', JSON.stringify(cles(await E(`__etat().ancien`))) === JSON.stringify(k), await E(`__etat().ancien`))
    fin()
  })

  it('une barre sans l\'outil des cases : aucun nom créé (développement comme production), ceux du texte gardés', async function () {
    check('au départ', (await noms('a4')) === 'A:aa11 | B:-', await noms('a4'))
    await E(`__caret('a4', 'B')`)
    await s!.page.keyboard.press('Enter')
    await s!.page.keyboard.type('C')
    await pause(250)
    const v = await valeur('a4')
    check('A garde son nom, B et C n\'en reçoivent pas', JSON.stringify(cles(v)) === JSON.stringify(['aa11']) && v.includes('>B<') && v.includes('>C<'), `${v} ${await noms('a4')}`)
    fin()
  })

  it('l\'outil des cases : les lignes créées à la volée reçoivent chacune un nom', async function () {
    await E(`__caret('a3', 'Premier')`)
    await clicBouton('a3', 'check')
    await E(`__caret('a3', 'Premier')`)
    await s!.page.keyboard.press('Enter')
    await s!.page.keyboard.type('Deuxième')
    await s!.page.keyboard.press('Enter')
    await s!.page.keyboard.type('Troisième')
    await pause(250)
    const k = cles(await valeur('a3'))
    check('trois lignes, trois noms de la bonne forme, tous différents', k.length === 3 && unique(k), `${await valeur('a3')} ${await noms('a3')}`)
    check('la variable liée aussi', JSON.stringify(cles(await E(`__etat().debut`))) === JSON.stringify(k), await E(`__etat().debut`))
    check('chaque ligne a le nom de sa propre ligne (surface = texte)', JSON.stringify(cles(await E(`__sf('a3').innerHTML`))) === JSON.stringify(k), await noms('a3'))
    fin()
  })

  it('collage : les lignes collées qui portent le nom d\'une ligne déjà là sont renommées, un nom libre est gardé, aucun doublon', async function () {
    await remettre()
    await E(`__caret('a1', 'Trois')`)
    await E(`__coller('a1', '<ul data-checklist><li data-key="bb22">Deux bis</li><li data-key="dd44">Trois bis</li><li data-key="ee55">Cinq</li></ul>')`)
    await pause(300)
    const v = await valeur('a1')
    const k = cles(v)
    check('aucun doublon, tous de la bonne forme', unique(k), `${v} ${await noms('a1')}`)
    check('Un, Deux et Deux-un gardent leur nom (la ligne du haut garde le sien)', (await E(`[__cle('a1', 'Un'), __cle('a1', 'Deux'), __cle('a1', 'Deux-un')].join()`)) === 'aa11,bb22,cc33', await noms('a1'))
    check('le nom libre ee55 est gardé', k.includes('ee55'), v)
    check('la surface et le texte portent les mêmes noms', JSON.stringify(cles(await E(`__sf('a1').innerHTML`))) === JSON.stringify(k), await noms('a1'))
    await remettre()
    fin()
  })

  it('« répondre » seul : les noms jouent dans le code réduit, et l\'éditeur de l\'auteur sans outil des cases garde les noms du texte', async function () {
    check('la case de checked est dessinée cochée par son nom', (await etats('r1')) === 'false,true,false,false', await etats('r1'))
    await cocher('r1', 3)
    check('un clic coche Trois par son nom', (await coches()) === '["bb22","dd44"]' && JSON.stringify(await champs('r1')) === JSON.stringify(['reps[]=bb22', 'reps[]=dd44']), `${await coches()} ${JSON.stringify(await champs('r1'))}`)
    await E(`__caret('a1', 'Cochez')`)
    await s!.page.keyboard.type(' bien')
    await pause(250)
    const v = await valeur('a1')
    check('l\'auteur a tapé dans le paragraphe : les noms des lignes sont toujours dans le texte', JSON.stringify(cles(v)) === JSON.stringify(['aa11', 'bb22', 'cc33', 'dd44']) && v.includes('Cochez bien'), v)
    check('les cases suivent le texte', (await etats('r1')) === 'false,true,false,true', await etats('r1'))
    fin()
  })

  it('outil des cases seul (aucune page n\'écrit answer) : l\'éditeur de l\'auteur nomme les lignes', async function () {
    check('avant tout geste, rien n\'est nommé', (await noms('a1')) === 'Pomme:- | Poire:-', await noms('a1'))
    await E(`__caret('a1', 'Pomme')`)
    await s!.page.keyboard.press('Enter')
    await s!.page.keyboard.type('Prune')
    await pause(250)
    const k = cles(await valeur('a1'))
    check('trois lignes, trois noms de la bonne forme, tous différents', k.length === 3 && unique(k), `${await valeur('a1')} ${await noms('a1')}`)
    fin()
  })
})
