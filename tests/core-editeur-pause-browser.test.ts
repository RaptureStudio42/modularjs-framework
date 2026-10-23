// Éditeur de texte riche du cœur, la pause des grands textes (plus de 20 Ko de HTML propre : la frappe attend 150 ms de calme avant de reconstruire
// tout le document) dans Chromium, Firefox et WebKit réels, en construction de développement ET de production. Tout ce qui lit ou quitte l'éditeur
// pendant cette pause voit le texte complet, jamais celui d'avant la rafale :
// - l'éditeur retiré de la page pendant la pause ne perd pas le texte tapé (Chromium envoie un `blur` au retrait, Firefox et WebKit non) ;
// - `new FormData(form)` et `form.submit()` (qui ne passent pas par l'événement `submit`) lisent le texte complet : l'entrée de l'éditeur est mise à
//   jour dans la liste des champs, celles des autres champs ne bougent pas, deux éditeurs du même nom se mettent chacun à jour ;
// - un collage ou un dépôt reconstruit tout de suite (WebKit annonce `insertText` pour la commande `insertHTML` de l'éditeur lui-même).

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { AIDES, BUILDS, MOTEURS, ouvrir, type Page, type Session } from './helpers/editeur-riche.js'

const PRET = (classes: string[]) => `(() => {
  const h = document.querySelector('mjs-hote')
  const ok = (c) => { const e = h && h._shadow && h._shadow.querySelector('.' + c); return !!(e && e._shadow && e._shadow.querySelector('.surface')) }
  return ${JSON.stringify(classes)}.every(ok)
})()`

// l'éditeur est dans un bloc `{if}` : la page peut le retirer pendant la pause
const DESTRUCTION: Page = {
  cle:     'pause-destruction',
  attente: PRET(['g']),
  aides:   AIDES,
  source:  `<script>
  $gros = ''
  $show = true

  µmount ->
    window.__poser  = (v)-> $gros = v
    window.__montre = (v)-> $show = v
    window.__etat   = -> { gros: $gros, show: $show }
</script>

<form class="f" @noUJS>
  {if $show}
    <@@editor class="g" name="g" toolbar="bold" value=!{$gros}></@@editor>
  {end}
  <input class="autre" type="text" aria-label="autre">
</form>
`,
}

// un formulaire qui s'envoie (GET) : un champ caché avant, un champ texte entre les deux éditeurs du même nom, un champ caché après
const FORMULAIRE: Page = {
  cle:     'pause-formulaire',
  attente: PRET(['g', 'd']),
  aides:   AIDES,
  source:  `<script>
  $gros = ''
  $deux = ''

  µmount ->
    window.__poser = (nom, v)->
      if nom == 'gros' then $gros = v
      else $deux = v
    window.__etat  = -> { gros: $gros, deux: $deux }
</script>

<form class="f" method="get" action="/envoi" @noUJS>
  <input type="hidden" name="avant" value="1">
  <@@editor class="g" name="notes[]" toolbar="bold" value=!{$gros}></@@editor>
  <input type="text" name="milieu" value="m" aria-label="milieu">
  <@@editor class="d" name="notes[]" toolbar="bold" value=!{$deux}></@@editor>
  <input type="hidden" name="apres" value="2">
  <button type="submit" class="ok">ok</button>
</form>
`,
}

const COLLAGE: Page = {
  cle:     'pause-collage',
  attente: PRET(['g']),
  aides:   AIDES,
  source:  `<script>
  $gros = ''

  @noter = (e)->
    window.__evts.push(e.type + ':' + (e.data ?? '').length)

  µmount ->
    window.__evts  = []
    window.__poser = (nom, v)-> $gros = v
    window.__etat  = -> { gros: $gros }
</script>

<form class="f" @noUJS>
  <@@editor class="g" name="g" toolbar="bold" value=!{$gros} @input={@noter(e)} @change={@noter(e)}></@@editor>
</form>
`,
}

const PARA = '<p>Paragraphe de texte avec <b>gras</b> et <a href="https://exemple.fr/page">lien</a>, assez long pour peser.</p>'
const GROS = PARA.repeat(220)

for (const build of BUILDS) for (const nom of MOTEURS) describe(`éditeur riche : la pause des grands textes (${build}, ${nom} réel)`, function () {
  this.timeout(240000)
  let s: Session | null = null
  let bilan: string[]   = []

  const E     = (expr: string): Promise<any> => s!.page.evaluate(expr)
  const pause = (ms = 150) => s!.page.waitForTimeout(ms)
  const check = (nomEssai: string, ok: any, detail: any = '') => { if (!ok) bilan.push(`${nomEssai} — ${String(detail).slice(0, 400)}`) }
  const fin   = () => assert.deepEqual(bilan, [], 'essais en échec')

  // la page ouverte, le grand texte posé dans les éditeurs demandés (rendu fini avant toute frappe)
  async function page(p: Page, textes: Record<string, string> = {}) {
    s = await ouvrir(nom, build, p)
    if (!s) return false
    for (const [cle, texte] of Object.entries(textes)) await E(`window.__poser(${JSON.stringify(cle)}, ${JSON.stringify(texte)})`)
    if (Object.keys(textes).length) await pause(900)
    return true
  }

  beforeEach(() => { bilan = [] })

  afterEach(async () => {
    if (s) assert.deepEqual(s.logs, [], 'la console reste vide')
    if (s) await s.fermer()
    s = null
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  // l'éditeur retiré reconstruit avant de partir et émet son dernier `input` : une écoute posée sur la balise elle-même le reçoit dans les trois navigateurs.
  // La variable liée de la page qui retire l'éditeur, elle, passe par le gabarit de cette page, que la balise retirée n'atteint plus : seul Chromium la met à jour
  // (il envoie un `blur` au retrait, balise encore en place), Firefox et WebKit n'envoient rien — c'est la limite que dit la documentation de l'éditeur
  const retire = async (geste: string | (() => Promise<void>)) => {
    await E(`window.__poser(${JSON.stringify(GROS)})`)
    await pause(900)
    check('le grand texte est posé', (await E(`__etat().gros.length`)) > 20000, await E(`__etat().gros.length`))
    await E(`window.__direct = []; __ed('g').addEventListener('input', (e) => window.__direct.push(e.data))`)
    if (typeof geste === 'string') await E(geste)
    else await geste()
    await pause(700)
    const recus: string[] = await E(`window.__direct`)
    check('l\'éditeur est parti', (await E(`__ed('g') === null`)) === true)
    check('un input est parti avant le retrait, avec le texte complet', recus.length >= 1 && recus[recus.length - 1].includes('ParaZZZgraphe'), JSON.stringify(recus.map((t) => t.slice(0, 40))))
    if (nom === 'chromium') check('la variable liée a reçu le texte tapé', (await E(`__etat().gros`)).includes('ParaZZZgraphe'), (await E(`__etat().gros`)).slice(0, 60))
  }

  it('l\'éditeur retiré de la page pendant la pause reconstruit avant de partir', async function () {
    if (!(await page(DESTRUCTION))) { this.skip(); return }
    await retire(`(() => { __caret('g', 'Paragraphe', 4); document.execCommand('insertText', false, 'ZZZ'); window.__montre(false) })()`)
    fin()
  })

  it('l\'éditeur retiré juste après une vraie frappe reconstruit aussi avant de partir', async function () {
    if (!(await page(DESTRUCTION))) { this.skip(); return }
    await retire(async () => {
      await E(`__caret('g', 'Paragraphe', 4)`)
      await s!.page.keyboard.type('ZZZ')
      await E(`window.__montre(false)`)
    })
    fin()
  })

  it('new FormData(form) lu pendant la pause voit le texte complet, les autres champs et leur ordre ne bougent pas', async function () {
    if (!(await page(FORMULAIRE, { gros: GROS, deux: '<p>Petit</p>' }))) { this.skip(); return }
    const r = await E(`(() => {
      __caret('g', 'Paragraphe', 4)
      document.execCommand('insertText', false, 'ZZZ')
      const fd = new FormData(__H().querySelector('form'))
      return { notes: fd.getAll('notes[]'), cles: [...fd.keys()], autres: [fd.get('avant'), fd.get('milieu'), fd.get('apres')] }
    })()`)
    check('l\'entrée de l\'éditeur porte le texte tapé', r.notes[0]?.includes('ParaZZZgraphe'), String(r.notes[0]).slice(0, 60))
    check('l\'entrée de l\'autre éditeur est intacte', r.notes[1] === '<p>Petit</p>', JSON.stringify(r.notes[1]))
    check('les entrées gardent leur ordre', JSON.stringify(r.cles) === JSON.stringify(['avant', 'notes[]', 'milieu', 'notes[]', 'apres']), JSON.stringify(r.cles))
    check('les autres champs ne bougent pas', JSON.stringify(r.autres) === JSON.stringify(['1', 'm', '2']), JSON.stringify(r.autres))
    check('la variable liée est à jour', (await E(`__etat().gros`)).includes('ParaZZZgraphe'))
    fin()
  })

  it('deux éditeurs du même nom : chacun met à jour sa propre entrée, même quand leurs textes de départ sont identiques', async function () {
    if (!(await page(FORMULAIRE, { gros: GROS, deux: GROS }))) { this.skip(); return }
    // le second seul est en pause : l'entrée du premier reste celle de départ
    const seul = await E(`(() => {
      __caret('d', 'Paragraphe', 4)
      document.execCommand('insertText', false, 'YYY')
      const fd = new FormData(__H().querySelector('form'))
      return fd.getAll('notes[]')
    })()`)
    check('le premier garde son texte', !seul[0].includes('YYY') && seul[0].length > 20000, String(seul[0]).slice(0, 60))
    check('le second porte le texte tapé', seul[1].includes('ParaYYYgraphe'), String(seul[1]).slice(0, 60))
    await pause(400)
    // les deux sont en pause, avec le même texte de départ (celui du premier a déjà changé : ils diffèrent)
    await E(`window.__poser('gros', ${JSON.stringify(GROS)})`)
    await E(`window.__poser('deux', ${JSON.stringify(GROS)})`)
    await pause(900)
    const deux = await E(`(() => {
      __caret('g', 'Paragraphe', 4)
      document.execCommand('insertText', false, 'AAA')
      __caret('d', 'Paragraphe', 4)
      document.execCommand('insertText', false, 'BBB')
      const fd = new FormData(__H().querySelector('form'))
      return { notes: fd.getAll('notes[]'), cles: [...fd.keys()] }
    })()`)
    check('le premier porte son texte', deux.notes[0].includes('ParaAAAgraphe') && !deux.notes[0].includes('BBB'), String(deux.notes[0]).slice(0, 60))
    check('le second porte le sien', deux.notes[1].includes('ParaBBBgraphe') && !deux.notes[1].includes('AAA'), String(deux.notes[1]).slice(0, 60))
    check('les entrées gardent leur ordre', JSON.stringify(deux.cles) === JSON.stringify(['avant', 'notes[]', 'milieu', 'notes[]', 'apres']), JSON.stringify(deux.cles))
    fin()
  })

  it('form.submit() juste après la frappe envoie le texte complet (envoi réel), requestSubmit() et le bouton aussi', async function () {
    for (const [libelle, geste] of [['form.submit()', `__H().querySelector('form').submit()`], ['form.requestSubmit()', `__H().querySelector('form').requestSubmit()`], ['le bouton d\'envoi', `__H().querySelector('button.ok').click()`]]) {
      if (!(await page(FORMULAIRE, { gros: GROS }))) { this.skip(); return }
      const urls: string[] = []
      s!.page.on('request', (r: any) => { if (r.url().includes('/envoi')) urls.push(r.url()) })
      await E(`(() => { __caret('g', 'Paragraphe', 4); document.execCommand('insertText', false, 'ZZZ'); ${geste} })()`)
      await pause(1200)
      const q = new URL(urls[0] ?? 'http://localhost/vide').searchParams
      check(`${libelle} : une requête est partie`, urls.length >= 1, urls.length)
      check(`${libelle} : l'entrée de l'éditeur porte le texte tapé`, (q.getAll('notes[]')[0] ?? '').includes('ParaZZZgraphe'), (q.getAll('notes[]')[0] ?? '').slice(0, 60))
      check(`${libelle} : les autres champs sont partis`, q.get('avant') === '1' && q.get('milieu') === 'm' && q.get('apres') === '2', JSON.stringify([...q.keys()]))
      s!.logs.length = 0
      await s!.fermer()
      s = null
    }
    fin()
  })

  it('un collage dans un grand texte est reconstruit tout de suite, sans attendre la pause', async function () {
    if (!(await page(COLLAGE, { gros: GROS }))) { this.skip(); return }
    await E(`window.__evts.length = 0`)
    const r = await E(`(() => {
      __caret('g', 'Paragraphe', 4)
      __coller('g', '', 'collé')
      return { apres: window.__evts.slice(), contient: __sf('g').textContent.includes('collé') }
    })()`)
    check('le texte collé est dans la surface', r.contient === true)
    check('un input est déjà parti, au geste même', r.apres.length === 1 && r.apres[0].startsWith('input:'), JSON.stringify(r.apres))
    await pause(400)
    check('la variable liée porte le texte collé', (await E(`__etat().gros`)).includes('collé'))
    check('un seul input en tout', (await E(`window.__evts.length`)) === 1, await E(`window.__evts.join(',')`))
    fin()
  })
})
