// Éditeur de texte riche du cœur allégé, dans Chromium, Firefox et WebKit réels, en construction de développement ET de production :
// ce que le build retire (le mode « répondre » d'une page qui ne l'écrit pas, le lien et les cases à fabriquer d'une barre qui ne les montre pas)
// ne retire jamais ce qui sert encore, et ce qu'il garde marche dans le code réduit.
// - une barre `toolbar="bold italic"` n'a que ces deux boutons, et une liste à cocher DÉJÀ dans la valeur s'affiche et se coche (clic dans la
//   marge, Ctrl+Entrée) sans l'outil `check` ; le mode « répondre » coche aussi avec une barre restreinte ;
// - les outils que la page nomme marchent dans le code réduit : le lien (ligne d'adresse, Entrée) et la fabrication d'une liste à cocher ;
// - le raccourci du lien (Ctrl+K) et celui des cases (Ctrl+Maj+9) n'agissent que si la barre de CET éditeur montre l'outil (la sienne, ou la
//   `<@@toolbar for>` qui le vise), la même règle en développement et en production, que le code de l'outil soit là ou non ;
// - un grand texte (plus de 20 Ko de HTML) attend une courte pause de frappe avant de reconstruire son HTML propre : une rafale de touches ne
//   donne qu'un `input`, `blur` le fait partir tout de suite, un petit texte garde un `input` par touche.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { AIDES, BUILDS, MOTEURS, ouvrir, type Page, type Session } from './helpers/editeur-riche.js'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

const PRET = (classes: string[]) => `(() => {
  const h = document.querySelector('mjs-hote')
  const ok = (c) => { const e = h && h._shadow && h._shadow.querySelector('.' + c); return !!(e && e._shadow && e._shadow.querySelector('.surface')) }
  return ${JSON.stringify(classes)}.every(ok)
})()`

// restreinte : aucun outil de lien ni de cases dans l'application ; r1 porte une liste à cocher dans sa valeur, r2 est en mode « répondre »
const RESTREINTE: Page = {
  cle:    'allege-restreinte',
  attente: PRET(['r1', 'r2', 'r3', 'r4']),
  aides:  AIDES,
  source: `<script>
  $liste  = '<ul data-checklist><li data-checked>Fait</li><li>À faire</li></ul>'
  $modele = '<ul data-checklist><li>Un</li><li>Deux</li></ul>'
  $coches = [1]
  $gros   = ''
  $petit  = '<p>Un texte</p>'

  @noter3 = (e)->
    window.__evts3.push(e.type + ':' + (e.data ?? '').length)
    window.__last3 = e.data

  @noter4 = (e)->
    window.__evts4.push(e.type)

  µmount ->
    window.__evts3 = []
    window.__evts4 = []
    window.__poser = (nom, v)->
      if nom == 'gros' then $gros = v
      else if nom == 'petit' then $petit = v
    window.__etat = -> { liste: $liste, coches: $coches, gros: $gros, petit: $petit }
</script>

<form class="f" @noUJS>
  <@@editor class="r1" name="liste" toolbar="bold italic" value=!{$liste}></@@editor>
  <@@editor class="r2" name="reps[]" answer toolbar="bold" value={$modele} checked=!{$coches}></@@editor>
  <@@editor class="r3" name="gros" toolbar="none" value=!{$gros} @input={@noter3(e)} @change={@noter3(e)}></@@editor>
  <@@editor class="r4" name="petit" toolbar="bold" value=!{$petit} @input={@noter4(e)}></@@editor>
</form>
`,
}

// nommée : la page nomme le lien et les cases, le build les garde ; x1 à x4 : des barres posées ailleurs, chaque éditeur n'a que les outils de la barre qui le
// vise (x3 n'en a aucune, x4 cumule la sienne et une séparée)
const NOMMEE: Page = {
  cle:    'allege-nommee',
  attente: PRET(['n1', 'n2', 'x1', 'x2', 'x3', 'x4']),
  aides:  AIDES,
  source: `<script>
  $a = '<p>Texte à lier</p>'
  $b = '<p>Une ligne</p>'
  $c = '<p>Texte un</p>'
  $d = '<p>Texte deux</p>'
  $e = '<p>Texte trois</p>'
  $f = '<p>Texte quatre</p>'

  µmount ->
    window.__etat = -> { a: $a, b: $b }
</script>

<form class="f" @noUJS>
  <@@editor class="n1" name="a" toolbar="bold link" value=!{$a}></@@editor>
  <@@editor class="n2" name="b" toolbar="check" value=!{$b}></@@editor>
  <@@toolbar class="t1" for="x1" tools="bold link"></@@toolbar>
  <@@editor id="x1" class="x1" name="c" toolbar="none" value=!{$c}></@@editor>
  <@@toolbar class="t2" for="x2" tools="bold"></@@toolbar>
  <@@editor id="x2" class="x2" name="d" toolbar="none" value=!{$d}></@@editor>
  <@@editor id="x3" class="x3" name="e" toolbar="none" value=!{$e}></@@editor>
  <@@toolbar class="t4" for="x4" tools="check"></@@toolbar>
  <@@editor id="x4" class="x4" name="f" toolbar="bold" value=!{$f}></@@editor>
</form>
`,
}

const GROS = '<p>Paragraphe de texte avec <b>gras</b> et <a href="https://exemple.fr/page">lien</a>, assez long pour peser.</p>'.repeat(2600)

for (const build of BUILDS) for (const nom of MOTEURS) describe(`éditeur riche allégé (${build}, ${nom} réel)`, function () {
  this.timeout(240000)
  let restreinte: Session | null = null
  let nommee: Session | null = null
  let s: Session | null = null
  let bilan: string[] = []

  const E     = (expr: string): Promise<any> => s!.page.evaluate(expr)
  const pause = (ms = 150) => s!.page.waitForTimeout(ms)
  const check = (nomEssai: string, ok: any, detail: any = '') => { if (!ok) bilan.push(`${nomEssai} — ${String(detail).slice(0, 400)}`) }
  const fin   = () => assert.deepEqual(bilan, [], 'essais en échec')

  const cases = (c: string): Promise<string> => E(`[...__sf('${c}').querySelectorAll('ul[data-checklist] > li')].map((li) => li.hasAttribute('data-checked') ? 'x' : '-').join('')`)
  const boutons = (c: string): Promise<string[]> => E(`[...__bar('${c}')._shadow.querySelectorAll('button')].map((b) => b.dataset.tool)`)
  const lien    = (c: string): Promise<boolean> => E(`!!__ed('${c}')._shadow.querySelector('.link')`)
  const listes  = (c: string): Promise<number> => E(`__sf('${c}').querySelectorAll('ul').length`)

  async function clicBouton(c: string, outil: string) {
    const p = await E(`__center(__btn('${c}', '${outil}'))`)
    await s!.page.mouse.click(p.x, p.y)
    await pause()
  }

  before(async () => {
    restreinte = await ouvrir(nom, build, RESTREINTE)
    nommee = await ouvrir(nom, build, NOMMEE)
  })

  after(async () => {
    if (restreinte) await restreinte.fermer()
    if (nommee) await nommee.fermer()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () {
    s = this.currentTest?.title.startsWith('nommée') || this.currentTest?.title.startsWith('barres') ? nommee : restreinte
    if (!s) { this.skip(); return }
    bilan = []
  })

  afterEach(() => {
    if (s) assert.deepEqual(s.logs, [], 'la console reste vide')
  })

  it('une barre restreinte n\'a que ses boutons, et une liste à cocher de la valeur s\'affiche et se coche sans l\'outil check', async function () {
    check('deux boutons seulement', JSON.stringify(await boutons('r1')) === JSON.stringify(['bold', 'italic']), JSON.stringify(await boutons('r1')))
    check('la liste est dessinée, la première ligne cochée', (await cases('r1')) === 'x-', await cases('r1'))
    const p = await E(`(() => { const li = __sf('r1').querySelectorAll('ul[data-checklist] > li')[1]; li.scrollIntoView({ block: 'center' }); const r = li.getBoundingClientRect(); return { x: r.left + 6, y: r.top + 12 } })()`)
    await s!.page.mouse.click(p.x, p.y)
    await pause()
    check('un clic dans la marge coche la ligne', (await cases('r1')) === 'xx', await cases('r1'))
    check('la variable liée porte la case cochée', (await E(`__etat().liste`)).includes('<li data-checked>À faire</li>'), await E(`__etat().liste`))
    await E(`__caret('r1', 'Fait', 2)`)
    await s!.page.keyboard.press(MOD + '+Enter')
    await pause()
    check('Ctrl+Entrée décoche la ligne du curseur', (await cases('r1')) === '-x', await cases('r1'))
    await E(`__caret('r1', 'À faire', 7)`)
    await s!.page.keyboard.press('Enter')
    await s!.page.keyboard.type('Nouvelle')
    await pause()
    check('Entrée crée une ligne décochée', (await cases('r1')) === '-x-', await cases('r1'))
    fin()
  })

  it('le mode « répondre » coche avec une barre restreinte (clic, Espace) et annonce les positions', async function () {
    check('deux lignes à cocher, la seconde cochée', (await E(`__etats('r2')`)) === 'false,true', await E(`__etats('r2')`))
    const p = await E(`__coche('r2', 0)`)
    await s!.page.mouse.click(p.x, p.y)
    await pause()
    check('le clic coche la première', (await E(`JSON.stringify(__etat().coches)`)) === '[0,1]', await E(`JSON.stringify(__etat().coches)`))
    await E(`__lignes('r2')[1].focus()`)
    await s!.page.keyboard.press(' ')
    await pause()
    check('Espace décoche la seconde', (await E(`JSON.stringify(__etat().coches)`)) === '[0]', await E(`JSON.stringify(__etat().coches)`))
    check('un champ par case cochée', JSON.stringify(await E(`__champs('r2')`)) === JSON.stringify(['reps[]=0']), JSON.stringify(await E(`__champs('r2')`)))
    fin()
  })

  it('les raccourcis d\'un outil que la barre de l\'éditeur ne montre pas n\'agissent pas (Ctrl+K, Ctrl+Maj+9), en développement comme en production', async function () {
    for (const [c, mot] of [['r4', 'texte'], ['r1', 'Fait'], ['r3', 'a']]) {
      const avant = await E(`__sf('${c}').innerHTML`)
      await E(`__caret('${c}', '${mot}', 1)`)
      await s!.page.keyboard.press(MOD + '+k')
      await pause()
      const ouvert = await lien(c)
      check(`${c} : Ctrl+K n'ouvre pas la ligne du lien`, ouvert === false)
      if (ouvert) { await s!.page.keyboard.press('Escape'); await pause() }
      await E(`__caret('${c}', '${mot}', 1)`)
      await s!.page.keyboard.press(MOD + '+Shift+9')
      await pause()
      check(`${c} : Ctrl+Maj+9 ne touche pas au texte`, (await E(`__sf('${c}').innerHTML`)) === avant, await E(`__sf('${c}').innerHTML`))
    }
    await E(`__selText('r4', 'texte')`)
    await s!.page.keyboard.press(MOD + '+b')
    await pause()
    check('les raccourcis des outils gardés marchent toujours (Ctrl+B)', (await E(`__etat().petit`)).includes('<strong>texte</strong>'), await E(`__etat().petit`))
    fin()
  })

  it('un petit texte garde un input par touche, sans attendre', async function () {
    await E(`window.__evts4.length = 0`)
    await E(`__caret('r4', 'Un', 2)`)
    await s!.page.keyboard.type('abc')
    await pause(60)
    check('trois touches, trois input', (await E(`window.__evts4.join(',')`)) === 'input,input,input', await E(`window.__evts4.join(',')`))
    check('la variable liée est à jour', (await E(`__etat().petit`)).includes('Unabc'), await E(`__etat().petit`))
    fin()
  })

  it('un grand texte attend une pause : une rafale de touches ne donne qu\'un input, blur le fait partir tout de suite', async function () {
    await E(`window.__poser('gros', ${JSON.stringify(GROS)})`)
    await pause(1500)
    check('le grand texte est posé', (await E(`__etat().gros.length`)) > 200000, await E(`__etat().gros.length`))
    await E(`window.__evts3.length = 0`)
    await E(`__caret('r3', 'Paragraphe', 4)`)
    const touches = 'abcdefghij'
    await s!.page.keyboard.type(touches)
    await pause(700)
    const evts: string[] = await E(`window.__evts3`)
    check('moins d\'input que de touches', evts.length >= 1 && evts.length < touches.length, JSON.stringify(evts))
    check('le dernier input porte tout le HTML propre, touches comprises', (await E(`window.__last3`)).includes('Paraabcdefghijgraphe'), (await E(`window.__last3`)).slice(0, 80))
    check('la variable liée est à jour après la pause', (await E(`__etat().gros`)).includes('Paraabcdefghijgraphe'))
    check('le champ du formulaire aussi', (await E(`__champs('r3')`)).length === 1 && (await E(`__champs('r3')[0]`)).includes('Paraabcdefghijgraphe'.slice(0, 20)))

    await E(`window.__evts3.length = 0`)
    await E(`__caret('r3', 'Paraabcdefghijgraphe', 3)`)
    await s!.page.keyboard.type('Z')
    await E(`__sf('r3').blur()`)
    await pause(40)
    const apres: string[] = await E(`window.__evts3`)
    check('blur reconstruit tout de suite : un input puis un change', apres.length === 2 && apres[0].startsWith('input:') && apres[1].startsWith('change:'), JSON.stringify(apres))
    check('la valeur contient la dernière touche', (await E(`__etat().gros`)).includes('ParZ'), '')
    fin()
  })

  it('nommée : le lien marche dans le code réduit (bouton, adresse, Entrée)', async function () {
    check('deux boutons : gras et lien', JSON.stringify(await boutons('n1')) === JSON.stringify(['bold', 'link']), JSON.stringify(await boutons('n1')))
    await E(`__selText('n1', 'à lier')`)
    await clicBouton('n1', 'link')
    check('la ligne d\'adresse s\'ouvre', (await E(`!!__ed('n1')._shadow.querySelector('.link-url')`)) === true)
    await s!.page.keyboard.type('exemple.fr/page')
    await s!.page.keyboard.press('Enter')
    await pause()
    check('le lien est posé en https', (await E(`__etat().a`)).includes('<a href="https://exemple.fr/page">à lier</a>'), await E(`__etat().a`))
    await E(`__selText('n1', 'Texte')`)
    await s!.page.keyboard.press(MOD + '+k')
    await pause()
    check('Ctrl+K ouvre la ligne, Échap la ferme', (await E(`!!__ed('n1')._shadow.querySelector('.link-url')`)) === true)
    await s!.page.keyboard.press('Escape')
    await pause()
    check('Échap ferme', (await E(`!!__ed('n1')._shadow.querySelector('.link-url')`)) === false)
    fin()
  })

  it('nommée : le bouton des cases fabrique une liste à cocher qui se coche', async function () {
    check('un seul bouton : cases', JSON.stringify(await boutons('n2')) === JSON.stringify(['check']), JSON.stringify(await boutons('n2')))
    await E(`__caret('n2', 'ligne', 5)`)
    await clicBouton('n2', 'check')
    check('une liste à cocher est fabriquée', (await cases('n2')) === '-', await cases('n2'))
    const p = await E(`(() => { const li = __sf('n2').querySelector('ul[data-checklist] > li'); li.scrollIntoView({ block: 'center' }); const r = li.getBoundingClientRect(); return { x: r.left + 6, y: r.top + 12 } })()`)
    await s!.page.mouse.click(p.x, p.y)
    await pause()
    check('elle se coche', (await cases('n2')) === 'x', await cases('n2'))
    check('la valeur le dit, la ligne a son nom', /<ul data-checklist><li data-key="[a-z][a-z0-9]{3}" data-checked>Une ligne<\/li><\/ul>/.test(await E(`__etat().b`)), await E(`__etat().b`))
    await clicBouton('n2', 'check')
    check('le bouton la retire', (await E(`__sf('n2').querySelectorAll('ul').length`)) === 0, await E(`__sf('n2').innerHTML`))
    fin()
  })

  it('nommée : chaque éditeur n\'a que le raccourci de son outil (Ctrl+K sur le lien, Ctrl+Maj+9 sur les cases)', async function () {
    await E(`__caret('n2', 'ligne', 2)`)
    await s!.page.keyboard.press(MOD + '+k')
    await pause()
    check('n2 (cases seules) : Ctrl+K n\'ouvre pas la ligne du lien, bien que le lien soit dans l\'appli', (await lien('n2')) === false)
    await E(`__caret('n1', 'Texte', 2)`)
    await s!.page.keyboard.press(MOD + '+Shift+9')
    await pause()
    check('n1 (gras et lien) : Ctrl+Maj+9 ne fabrique pas de liste, bien que les cases soient dans l\'appli', (await listes('n1')) === 0, await E(`__sf('n1').innerHTML`))
    await E(`__caret('n2', 'ligne', 2)`)
    await s!.page.keyboard.press(MOD + '+Shift+9')
    await pause()
    check('n2 (cases) : Ctrl+Maj+9 fabrique la liste à cocher', (await cases('n2')) === '-', await E(`__sf('n2').innerHTML`))
    await s!.page.keyboard.press(MOD + '+Shift+9')
    await pause()
    check('Ctrl+Maj+9 la retire', (await listes('n2')) === 0, await E(`__sf('n2').innerHTML`))
    fin()
  })

  it('barres : la barre posée ailleurs compte pour l\'éditeur qu\'elle vise, et pour lui seul', async function () {
    // x1 : barre séparée « gras lien » ; x2 : « gras » ; x3 : aucune barre ; x4 : sa barre « gras » et une séparée « cases »
    const essai = async (c: string, mot: string) => {
      await E(`__caret('${c}', '${mot}', 2)`)
      await s!.page.keyboard.press(MOD + '+k')
      await pause()
      const ouvert = await lien(c)
      if (ouvert) { await s!.page.keyboard.press('Escape'); await pause() }
      await E(`__caret('${c}', '${mot}', 2)`)
      await s!.page.keyboard.press(MOD + '+Shift+9')
      await pause()
      const fait = (await listes(c)) > 0
      if (fait) { await s!.page.keyboard.press(MOD + '+Shift+9'); await pause() }
      return { lien: ouvert, cases: fait }
    }
    const x1 = await essai('x1', 'Texte')
    const x2 = await essai('x2', 'Texte')
    const x3 = await essai('x3', 'Texte')
    const x4 = await essai('x4', 'Texte')
    check('x1 (barre séparée gras lien) : Ctrl+K agit, Ctrl+Maj+9 non', x1.lien === true && x1.cases === false, JSON.stringify(x1))
    check('x2 (barre séparée gras) : ni l\'un ni l\'autre', x2.lien === false && x2.cases === false, JSON.stringify(x2))
    check('x3 (aucune barre) : ni l\'un ni l\'autre', x3.lien === false && x3.cases === false, JSON.stringify(x3))
    check('x4 (sa barre gras, une séparée cases) : Ctrl+Maj+9 agit, Ctrl+K non', x4.lien === false && x4.cases === true, JSON.stringify(x4))
    fin()
  })
})
