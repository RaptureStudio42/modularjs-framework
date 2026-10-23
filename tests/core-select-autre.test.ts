// <@@select other> : une réponse libre « Autre… ». Avec `other`, la dernière ligne de la liste est « Autre… » : la choisir met
// un champ de saisie à sa place, et ce qu'on y valide devient la valeur (choix simple) ou une ligne cochée de plus (multiple).
// Les réponses libres ne sont pas un état à part : elles se déduisent de `value` et des options (toute valeur qui n'est celle
// d'aucune option), si bien qu'une valeur posée par la page, une saisie ou un `form.reset()` donnent le même affichage.
// Ce fichier prouve ce qui se voit sans navigateur (bundler réel + happy-dom, même harnais que core-select-annonce-changement) :
// la ligne, le champ, ses touches, la validation, le choix simple et multiple, les valeurs posées par la page, les champs cachés
// du formulaire, l'événement `other`, le clavier, la recherche, la jauge de largeur, les rôles ARIA, `form.reset()`, les formes de
// l'attribut, les libellés dans les deux langues, les groupes (<@@optgroup>) et les icônes, les textes surchargés par le dictionnaire du
// projet. Le rendu (filet, focus réel, frappe) est dans core-select-autre-browser.test.ts, la place du panneau dans la fenêtre dans
// core-select-autre-place-browser.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { attendre, pause } from './helpers/coeur-monter.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'

const PAYS = '<@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option><@@option value="us">États-Unis</@@option>'
const LAIT = '<@@option value="lait">Lait</@@option><@@option value="oeuf">Oeuf</@@option><@@option value="noix">Noix</@@option>'
const NOMBRES = '<@@option value={18}>Dix-huit</@@option><@@option value="fr">France</@@option>'
const GROUPES = '<@@optgroup label="Europe"><@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option></@@optgroup><@@optgroup label="Amérique"><@@option value="us">États-Unis</@@option><@@option value="ca">Canada</@@option></@@optgroup>'
const ICONES = '<@@option value="a" icon="★">Étoile</@@option><@@option value="b" icon={{ src: \'data:image/gif;base64,R0lGODlhAQABAAAAACw=\' }}>Image</@@option><@@option value="c">Rien</@@option>'
// 41 lettres et un émoji : 43 unités UTF-16, une de plus que le maximum de 42
const LONG = 'a'.repeat(41) + '😀'

const HOTE = `<script>
  $lie     = 'fr'
  $reponse = 'rien'

  @onAutre = (e)->
    $reponse = JSON.stringify(e.data)
</script>

<div id="simple"><@@select name="g1" other>${PAYS}</@@select></div>
<div id="simple2"><@@select name="g2" other>${PAYS}</@@select></div>
<div id="simple3"><@@select name="g3" other>${PAYS}</@@select></div>
<div id="simple4"><@@select name="g4" other>${PAYS}</@@select></div>
<div id="simple5"><@@select name="g5" other>${PAYS}</@@select></div>
<div id="simple6"><@@select name="g6" other>${PAYS}</@@select></div>
<div id="simple7"><@@select name="g7" other>${PAYS}</@@select></div>
<div id="simple8"><@@select name="g8" other>${PAYS}</@@select></div>
<div id="multi"><@@select name="m1[]" multiple other="42">${LAIT}</@@select></div>
<div id="multi2"><@@select name="m2[]" multiple other>${LAIT}</@@select></div>
<div id="multi3"><@@select name="m3[]" multiple other>${LAIT}</@@select></div>
<div id="multi4"><@@select name="m4[]" multiple other>${LAIT}</@@select></div>
<div id="multi6"><@@select name="m6[]" multiple other>${LAIT}</@@select></div>
<div id="nom-simple"><@@select name="groupe" other>${PAYS}</@@select></div>
<div id="nom-multi"><@@select name="allergies[]" multiple other>${LAIT}</@@select></div>
<div id="recherche"><@@select name="rech" search other>${PAYS}</@@select></div>
<div id="recherche-m"><@@select name="rechm[]" search multiple other value={['Zed', 'Yo']}>${PAYS}</@@select></div>
<div id="sans-option"><@@select name="vide" other></@@select></div>
<div id="court"><@@select name="court" other="5">${PAYS}</@@select></div>
<div id="profil"><@@select name="profil[groupe]" other>${PAYS}</@@select></div>
<div id="profil-multi"><@@select name="profil[allergies][]" multiple other>${LAIT}</@@select></div>
<div id="sans-nom"><@@select other>${PAYS}</@@select></div>
<div id="sans-nom-multi"><@@select multiple other>${LAIT}</@@select></div>
<div id="pose"><@@select name="pose" other value="Zed">${PAYS}</@@select></div>
<div id="pose-multi"><@@select name="posem[]" multiple other value={['fr', 'Zed', 'Yo']}>${PAYS}</@@select></div>
<div id="pose-lie"><@@select name="posel" other value=!{$lie}>${PAYS}</@@select></div>
<div id="pose-vide"><@@select name="posev" other value="">${PAYS}</@@select></div>
<div id="pose-null"><@@select name="posen" other value={null}>${PAYS}</@@select></div>
<div id="pose-multi-vide"><@@select name="posemv[]" multiple other value={['', null, 'fr']}>${PAYS}</@@select></div>
<div id="sans-other"><@@select name="so" value="Zed">${PAYS}</@@select></div>
<div id="sans-other-multi"><@@select name="som[]" multiple value={['fr', 'Zed']}>${PAYS}</@@select></div>
<div id="evenement"><@@select name="ev" other @other={@onAutre(e)}>${PAYS}</@@select></div>
<div id="clavier"><@@select name="cl[]" multiple other value={['Zed', 'Yo']}>${PAYS}</@@select></div>
<div id="clavier2"><@@select name="cl2" other>${PAYS}</@@select></div>
<form id="f-donnees" @noUJS><@@select name="fd" other>${PAYS}</@@select></form>
<form id="f-simple" @noUJS><@@select name="fs" other value="fr">${PAYS}</@@select></form>
<form id="f-multi" @noUJS><@@select name="fm[]" multiple other value={['fr', 'Zed']}>${PAYS}</@@select></form>
<form id="f-libre" @noUJS><@@select name="fl" other value="Zed">${PAYS}</@@select></form>
<div id="a-defaut"><@@select name="a1" other>${PAYS}</@@select></div>
<div id="a-42"><@@select name="a2" other="42">${PAYS}</@@select></div>
<div id="a-nombre"><@@select name="a3" other={42}>${PAYS}</@@select></div>
<div id="a-un"><@@select name="a4" other="1">${PAYS}</@@select></div>
<div id="a-abc"><@@select name="a5" other="abc">${PAYS}</@@select></div>
<div id="a-zero"><@@select name="a6" other="0">${PAYS}</@@select></div>
<div id="a-moins"><@@select name="a7" other="-3">${PAYS}</@@select></div>
<div id="a-decimal"><@@select name="a8" other="42.5">${PAYS}</@@select></div>
<div id="a-faux"><@@select name="a9" other={false}>${PAYS}</@@select></div>
<div id="a-absent"><@@select name="a10">${PAYS}</@@select></div>
<div id="libelles"><@@select name="lib" other other-label="Autre pays" other-placeholder="Lequel ?">${PAYS}</@@select></div>
<div id="points"><@@select name="pts" other other-label="Autre réponse ...">${PAYS}</@@select></div>
<div id="pre"><@@select name="pre" other="42" value="${LONG}">${PAYS}</@@select></div>
<div id="coupe"><@@select name="coupe" other="42">${PAYS}</@@select></div>
<div id="variante"><@@select name="var" other value="Eric">${PAYS}</@@select></div>
<div id="nombre"><@@select name="nb" other>${NOMBRES}</@@select></div>
<div id="nombre-m"><@@select name="nbm[]" multiple other>${NOMBRES}</@@select></div>
<div id="blancs"><@@select name="bl" other value={'   '}>${PAYS}</@@select></div>
<div id="blancs-m"><@@select name="blm[]" multiple other value={['  ', 'fr']}>${PAYS}</@@select></div>
<div id="groupes"><@@select name="gr" other>${GROUPES}</@@select></div>
<div id="groupes-m"><@@select name="grm[]" multiple other value={['Zed']}>${GROUPES}</@@select></div>
<div id="icones"><@@select name="ic" other>${ICONES}</@@select></div>
<button id="en" @click={µlang = 'en'}>en</button>
<p class="echo">{$reponse}</p>
`

const NBSP = String.fromCharCode(0xa0)

// le harnais des modules cœur (un hôte compilé par le vrai Bundler, monté dans happy-dom), avec en plus les libellés par défaut du
// manifeste : sans eux « Choisir… », « Autre… » et les autres textes du module seraient vides
// `avant` (facultatif) s'exécute dans la fenêtre une fois le moteur chargé, avant que l'hôte existe : un dictionnaire de projet s'y pose
async function monter(source: string, prefixe: string, avant?: (window: any) => void): Promise<{ window: any; hote: any }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const code  = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(`${code}\nglobalThis.µ = µ;`)
  window.eval(libellesDuManifeste(join(root, 'bundle.js')))
  avant?.(window)
  window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
  const hote = window.document.querySelector('mjs-hote')
  await attendre(() => !!hote._shadow)
  await pause(120)
  return { window, hote }
}

describe('<@@select other> — réponse libre « Autre… » (happy-dom, bundler réel)', function () {
  this.timeout(180000)

  let window: any = null
  let hote: any   = null
  const journaux: Record<string, Array<[string, any]>> = {}

  const sel      = (id: string) => hote._shadow.querySelector(`#${id} mjs-core-select`)
  const coque    = (id: string) => sel(id)._shadow
  const bouton   = (id: string) => coque(id).querySelector('.select-btn')
  const cadre    = (id: string) => coque(id).querySelector('.select')
  const panneau  = (id: string) => coque(id).querySelector('.select-panel')
  const liste    = (id: string) => coque(id).querySelector('.select-panel [role=listbox]')
  const lignes   = (id: string) => [...coque(id).querySelectorAll('.select-option')]
  const autre    = (id: string) => coque(id).querySelector('.select-other')
  const champ    = (id: string) => coque(id).querySelector('.select-other-input')
  const recherche = (id: string) => coque(id).querySelector('.select-search')
  const libelle  = (el: any) => el.querySelector('.select-option-label').textContent
  const libelles = (id: string) => lignes(id).map(libelle)
  const actives  = (id: string) => lignes(id).filter((l: any) => l.classList.contains('active')).map(libelle)
  const coches   = (id: string) => lignes(id).filter((l: any) => l.getAttribute('aria-selected') === 'true').map(libelle)
  const cache    = (id: string) => [...sel(id).querySelectorAll('input[type="hidden"]')].map((i: any) => [i.name, i.value])
  const clic     = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))

  function touche(el: any, k: string): any {
    const e = new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, composed: true })
    el.dispatchEvent(e)
    return e
  }

  // change et other reçus par le parent, dans l'ordre : [type, e.data]
  function ecouter(id: string): Array<[string, any]> {
    if (journaux[id]) return journaux[id]
    const j: Array<[string, any]> = journaux[id] = []
    const zone = hote._shadow.querySelector(`#${id}`)
    for (const type of ['change', 'other']) zone.addEventListener(type, (e: any) => j.push([type, Array.isArray(e.data) ? Array.from(e.data) : e.data]))
    return j
  }

  async function ouvrir(id: string) {
    if (!sel(id)._state.open) { clic(bouton(id)); await pause(30) }
  }

  async function ouvrirChamp(id: string) {
    await ouvrir(id)
    clic(autre(id))
    await pause(40)
  }

  async function ecrire(id: string, texte: string) {
    const c = champ(id)
    c.value = texte
    c.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true, composed: true }))
    await pause(30)
  }

  async function valider(id: string, texte: string) {
    await ecrire(id, texte)
    touche(champ(id), 'Enter')
    await pause(40)
  }

  async function chercher(id: string, texte: string) {
    const r = recherche(id)
    r.value = texte
    r.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true, composed: true }))
    await pause(30)
  }

  // un test qui échoue en cours de route ne laisse pas un panneau ouvert derrière lui
  async function fermerTout() {
    for (const s of hote._shadow.querySelectorAll('mjs-core-select')) {
      if (!s._state.open) continue
      const c = s._shadow.querySelector('.select-other-input')
      if (c) touche(c, 'Escape')
      touche(s._shadow.querySelector('.select'), 'Escape')
    }
    await pause(30)
  }

  before(async () => {
    const monte = await monter(HOTE, 'core-select-autre')
    window = monte.window
    hote   = monte.hote
    await pause(300)
  })

  afterEach(fermerTout)

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  describe('1 · la ligne « Autre… »', () => {
    it('avec other, la DERNIÈRE ligne de la liste est « Autre… », et elle est la seule', async () => {
      await ouvrir('simple')
      const l = lignes('simple')
      assert.deepEqual(libelles('simple'), ['France', 'Allemagne', 'États-Unis', 'Autre…'])
      assert.equal(l.at(-1).classList.contains('select-other'), true)
      assert.equal(l.filter((x: any) => x.classList.contains('select-other')).length, 1)
      assert.equal(l.at(-1).getAttribute('role'), 'option')
    })

    it('sans other : aucune ligne « Autre… »', async () => {
      await ouvrir('a-absent')
      assert.deepEqual(libelles('a-absent'), ['France', 'Allemagne', 'États-Unis'])
      assertAbsent(autre('a-absent'))
    })

    it('la ligne reste quand la recherche ne trouve rien : le message « Aucun résultat » puis la ligne', async () => {
      await ouvrir('recherche')
      await chercher('recherche', 'zzzz')
      const ordre = [...panneau('recherche').querySelectorAll('.select-empty, .select-other')].map((e: any) => e.className.split(' ').find((c: string) => c === 'select-empty' || c === 'select-other'))
      assert.deepEqual(ordre, ['select-empty', 'select-other'])
      assert.equal(coque('recherche').querySelector('.select-empty').textContent, 'Aucun résultat')
      assert.deepEqual(libelles('recherche'), ['Autre…'])
    })

    it('la ligne n\'est jamais filtrée : une recherche qui trouve une option la laisse en dernier', async () => {
      await ouvrir('recherche')
      await chercher('recherche', 'allema')
      assert.deepEqual(libelles('recherche'), ['Allemagne', 'Autre…'])
    })

    it('même sans aucune option : la ligne est là, seule dans la liste', async () => {
      await ouvrir('sans-option')
      assert.deepEqual(libelles('sans-option'), ['Autre…'])
      assert.equal(coque('sans-option').querySelector('.select-empty').textContent, 'Aucun résultat')
    })
  })

  describe('2 · le champ de saisie', () => {
    it('choisir « Autre… » (clic) met un champ à sa place : il prend le focus, porte maxlength, l\'invite, le bouton ✔, l\'indice et le compteur', async () => {
      await ouvrirChamp('simple')
      const c = champ('simple')
      assert.ok(c, 'le champ est là')
      assertAbsent(autre('simple'), 'la ligne « Autre… » a laissé sa place')
      assert.equal(c.getAttribute('maxlength'), '80')
      assert.equal(c.getAttribute('placeholder'), 'Précisez')
      assert.ok(coque('simple').activeElement === c, 'le focus est dans le champ')
      const ok = coque('simple').querySelector('.select-other-ok')
      assert.equal(ok.textContent.trim(), '✔')
      assert.equal(ok.getAttribute('aria-label'), 'Valider')
      assert.equal(coque('simple').querySelector('.select-other-hint').textContent.trim(), 'Entrée pour valider · Échap pour revenir')
      assert.equal(coque('simple').querySelector('.select-other-count').textContent.trim(), '0 / 80')
      assert.equal(sel('simple')._state.open, true, 'le panneau reste ouvert')
    })

    it('le compteur suit la saisie', async () => {
      await ouvrirChamp('simple')
      await ecrire('simple', 'abc')
      assert.equal(coque('simple').querySelector('.select-other-count').textContent.trim(), '3 / 80')
    })

    it('Entrée sur « Autre… » (la ligne active) ouvre le champ aussi', async () => {
      await ouvrir('simple')
      for (let i = 0; i < 3; i++) touche(cadre('simple'), 'ArrowDown')
      await pause(30)
      assert.deepEqual(actives('simple'), ['Autre…'])
      touche(cadre('simple'), 'Enter')
      await pause(40)
      assert.ok(champ('simple'))
      assert.ok(coque('simple').activeElement === champ('simple'))
    })

    it('ouvrir le champ n\'annonce rien : ni change ni other', async () => {
      const j = ecouter('simple2')
      await ouvrirChamp('simple2')
      assert.deepEqual(j, [])
      assert.equal(sel('simple2')._state.value ?? null, null)
    })
  })

  describe('3 · les touches dans le champ', () => {
    it('Entrée valide', async () => {
      await ouvrirChamp('simple3')
      await ecrire('simple3', 'Zed')
      const e = touche(champ('simple3'), 'Enter')
      await pause(40)
      assert.equal(e.defaultPrevented, true)
      assert.equal(sel('simple3')._state.value, 'Zed')
    })

    it('Échap revient à la liste : champ refermé, rien n\'a changé, « Autre… » est la ligne active, le focus retourne au bouton', async () => {
      const j = ecouter('simple4')
      await ouvrirChamp('simple4')
      await ecrire('simple4', 'brouillon')
      touche(champ('simple4'), 'Escape')
      await pause(40)
      assertAbsent(champ('simple4'), 'le champ est refermé')
      assert.equal(sel('simple4')._state.open, true, 'le panneau reste ouvert')
      assert.equal(sel('simple4')._state.value ?? null, null, 'rien n\'a changé')
      assert.deepEqual(j, [])
      assert.deepEqual(libelles('simple4'), ['France', 'Allemagne', 'États-Unis', 'Autre…'])
      assert.deepEqual(actives('simple4'), ['Autre…'])
      assert.equal(bouton('simple4').getAttribute('aria-activedescendant'), autre('simple4').id)
      assert.ok(coque('simple4').activeElement === bouton('simple4'), 'le focus retourne au bouton')
    })

    it('avec une recherche, le focus retourne au champ de recherche', async () => {
      await ouvrir('recherche')
      await pause(30)
      clic(autre('recherche'))
      await pause(40)
      assert.ok(coque('recherche').activeElement === champ('recherche'))
      touche(champ('recherche'), 'Escape')
      await pause(40)
      assertAbsent(champ('recherche'))
      assert.ok(coque('recherche').activeElement === recherche('recherche'), 'le focus retourne au champ de recherche')
      assert.deepEqual(actives('recherche'), ['Autre…'])
    })

    it('les flèches, Début, Fin et Espace n\'agissent que sur le texte : le champ reste, la ligne active ne bouge pas, la touche n\'est pas retenue', async () => {
      await ouvrirChamp('simple5')
      await ecrire('simple5', 'ab')
      const avant = sel('simple5')._state.activeIndex
      for (const k of ['ArrowDown', 'ArrowUp', 'Home', 'End', ' ', 'a', 'ArrowLeft']) {
        const e = touche(champ('simple5'), k)
        assert.equal(e.defaultPrevented, false, `« ${k} » : le navigateur la traite (déplace le curseur ou écrit)`)
      }
      await pause(30)
      assert.ok(champ('simple5'), 'le champ est toujours là')
      assert.equal(sel('simple5')._state.activeIndex, avant, 'la ligne active n\'a pas bougé')
      assert.equal(sel('simple5')._state.open, true)
      assert.equal(champ('simple5').value, 'ab')
    })

    it('Entrée pendant une composition de texte (méthode de saisie) ne valide pas', async () => {
      await ouvrirChamp('simple5')
      await ecrire('simple5', 'abc')
      const e = new window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true, composed: true })
      champ('simple5').dispatchEvent(e)
      await pause(40)
      assert.equal(e.defaultPrevented, false)
      assert.ok(champ('simple5'), 'le champ est toujours là')
      assert.equal(sel('simple5')._state.value ?? null, null)
    })

    it('Entrée juste après la fin de composition (séquence de Safari : isComposing faux, keyCode 229) ne valide pas non plus', async () => {
      await ouvrirChamp('simple5')
      await ecrire('simple5', 'abc')
      const e = new window.KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: false, bubbles: true, cancelable: true, composed: true })
      assert.equal(e.keyCode, 229, 'le harnais pose bien le keyCode')
      assert.equal(e.isComposing, false)
      champ('simple5').dispatchEvent(e)
      await pause(40)
      assert.equal(e.defaultPrevented, false)
      assert.ok(champ('simple5'), 'le champ est toujours là')
      assert.equal(sel('simple5')._state.value ?? null, null)
    })

    it('le bouton ✔ valide comme Entrée', async () => {
      await ouvrirChamp('simple6')
      await ecrire('simple6', 'Zed')
      clic(coque('simple6').querySelector('.select-other-ok'))
      await pause(40)
      assert.equal(sel('simple6')._state.value, 'Zed')
      assert.equal(sel('simple6')._state.open, false)
    })

    it('un clic dans le champ ne ferme pas le panneau', async () => {
      await ouvrirChamp('simple7')
      clic(champ('simple7'))
      await pause(30)
      assert.ok(champ('simple7'))
      assert.equal(sel('simple7')._state.open, true)
    })

    it('fermer le panneau (clic dehors) referme le champ : la réouverture montre la liste', async () => {
      await ouvrirChamp('simple8')
      await ecrire('simple8', 'brouillon')
      clic(window.document.body)
      await pause(40)
      assert.equal(sel('simple8')._state.open, false)
      await ouvrir('simple8')
      assertAbsent(champ('simple8'))
      assert.ok(autre('simple8'))
    })
  })

  describe('4 · la validation', () => {
    it('un texte vide ou fait de blancs : rien ne se passe (le champ reste, aucun change)', async () => {
      const j = ecouter('court')
      await ouvrirChamp('court')
      await valider('court', '')
      await valider('court', '   ')
      assert.ok(champ('court'), 'le champ reste')
      assert.equal(sel('court')._state.value ?? null, null)
      assert.deepEqual(j, [])
    })

    it('le texte est rogné puis coupé au maximum (other="5")', async () => {
      await ouvrirChamp('court')
      await valider('court', '   abcdefgh  ')
      assert.equal(sel('court')._state.value, 'abcde')
    })

    it('égal au libellé d\'une option (accents et casse ignorés) : c\'est l\'option qui est choisie, avec SA valeur', async () => {
      const j = ecouter('simple2')
      await ouvrirChamp('simple2')
      await valider('simple2', '  etats-UNIS ')
      assert.equal(sel('simple2')._state.value, 'us')
      assert.equal(bouton('simple2').textContent.trim(), 'États-Unis')
      assert.deepEqual(cache('simple2'), [['g2', 'us']])
      assert.deepEqual(j, [['change', 'us']], 'un change, pas de other : ce n\'est pas une réponse libre')
      await ouvrir('simple2')
      assert.deepEqual(libelles('simple2'), ['France', 'Allemagne', 'États-Unis', 'Autre…'], 'la ligne ne montre pas « Autre : … »')
    })

    it('égal à la forme texte de la VALEUR d\'une option (« 18 » pour l\'option {18} « Dix-huit ») : c\'est l\'option qui est choisie, avec SA valeur, le nombre', async () => {
      const j = ecouter('nombre')
      await ouvrirChamp('nombre')
      await valider('nombre', ' 18 ')
      assert.strictEqual(sel('nombre')._state.value, 18)
      assert.equal(bouton('nombre').textContent.trim(), 'Dix-huit')
      assert.deepEqual(cache('nombre'), [['nb', '18']])
      assert.deepStrictEqual(j, [['change', 18]], 'un change avec le nombre, pas de other')
      await ouvrir('nombre')
      assert.deepEqual(libelles('nombre'), ['Dix-huit', 'France', 'Autre…'], 'la ligne ne montre pas « Autre : … »')
    })

    it('une réponse préremplie par la page, plus longue que le maximum et non modifiée : Entrée ne change rien (ni coupe, ni change, ni other)', async () => {
      const j = ecouter('pre')
      assert.equal(sel('pre')._state.value, LONG)
      await ouvrirChamp('pre')
      assert.equal(champ('pre').value, LONG, 'le champ reprend la réponse telle quelle')
      touche(champ('pre'), 'Enter')
      await pause(40)
      assert.equal(sel('pre')._state.value, LONG, 'ni coupée ni rognée')
      assert.equal(sel('pre')._state.value.isWellFormed(), true)
      assert.deepEqual(j, [], 'ni change ni other')
      assert.equal(sel('pre')._state.open, false, 'le panneau se ferme comme après toute validation')
    })

    it('choix simple : retaper la réponse donnée avec d\'autres accents ou une autre casse la remplace — elle n\'est pas une option de la liste', async () => {
      const j = ecouter('variante')
      await ouvrirChamp('variante')
      assert.equal(champ('variante').value, 'Eric', 'le champ reprend la réponse donnée')
      await valider('variante', 'Éric')
      assert.equal(sel('variante')._state.value, 'Éric')
      assert.equal(bouton('variante').textContent.trim(), 'Éric')
      assert.deepEqual(j, [['change', 'Éric'], ['other', 'Éric']])
      assert.deepEqual(cache('variante'), [['var_other', 'Éric']])
    })

    it('une coupe au maximum tombe sur une frontière de caractère : jamais une moitié d\'émoji', async () => {
      await ouvrirChamp('coupe')
      await valider('coupe', 'a'.repeat(41) + '😀😀')
      const v = sel('coupe')._state.value
      assert.equal(v, 'a'.repeat(41), 'l\'émoji qui ne tient pas en entier est laissé')
      assert.equal(v.isWellFormed(), true)
    })
  })

  describe('5 · le choix simple', () => {
    it('la réponse libre devient value, le panneau se ferme, le focus revient au bouton, le bouton montre le texte', async () => {
      await ouvrirChamp('simple')
      await valider('simple', 'Zed')
      assert.equal(sel('simple')._state.value, 'Zed')
      assert.equal(sel('simple')._state.open, false)
      assert.ok(coque('simple').activeElement === bouton('simple'))
      assert.equal(bouton('simple').textContent.trim(), 'Zed')
    })

    it('change part une seule fois (e.data = le texte), remonte, et pas une deuxième fois pour le même texte', async () => {
      const j = ecouter('simple')
      const avant = j.length
      let remonte = false
      hote._shadow.addEventListener('change', (e: any) => { if (e.data === 'Yo') remonte = e.bubbles && e.composed })
      await ouvrirChamp('simple')
      await valider('simple', 'Yo')
      assert.deepEqual(j.slice(avant), [['change', 'Yo'], ['other', 'Yo']])
      assert.equal(remonte, true, 'change remonte et traverse les ombres, comme un change d\'option')
      await ouvrir('simple')
      clic(autre('simple'))
      await pause(40)
      await valider('simple', 'Yo')
      assert.deepEqual(j.slice(avant), [['change', 'Yo'], ['other', 'Yo']], 'le même texte : rien de plus')
      assert.equal(sel('simple')._state.open, false, 'le panneau se ferme quand même')
    })

    it('à la réouverture la dernière ligne montre « Autre : le texte » (espace insécable), sélectionnée, et c\'est la ligne active', async () => {
      await ouvrir('simple')
      assert.deepEqual(libelles('simple'), ['France', 'Allemagne', 'États-Unis', `Autre${NBSP}: Yo`])
      assert.equal(autre('simple').getAttribute('aria-selected'), 'true')
      assert.equal(autre('simple').classList.contains('selected'), true)
      assert.deepEqual(actives('simple'), [`Autre${NBSP}: Yo`])
      assert.deepEqual(coches('simple'), [`Autre${NBSP}: Yo`], 'seule cette ligne est sélectionnée')
      assert.equal(bouton('simple').getAttribute('aria-activedescendant'), autre('simple').id)
    })

    it('choisir cette ligne rouvre le champ prérempli', async () => {
      await ouvrirChamp('simple')
      assert.equal(champ('simple').value, 'Yo')
      assert.equal(coque('simple').querySelector('.select-other-count').textContent.trim(), '2 / 80')
    })

    it('choisir une option remplace la réponse libre : plus de « Autre : … », change puis other (null)', async () => {
      const j = ecouter('simple')
      const avant = j.length
      await ouvrirChamp('simple')
      touche(champ('simple'), 'Escape')
      await pause(30)
      clic(lignes('simple')[1])
      await pause(40)
      assert.equal(sel('simple')._state.value, 'de')
      assert.deepEqual(j.slice(avant), [['change', 'de'], ['other', null]])
      assert.equal(bouton('simple').textContent.trim(), 'Allemagne')
      await ouvrir('simple')
      assert.deepEqual(libelles('simple'), ['France', 'Allemagne', 'États-Unis', 'Autre…'])
      assert.equal(autre('simple').getAttribute('aria-selected'), 'false')
    })
  })

  describe('6 · le choix multiple', () => {
    it('chaque réponse libre validée est une ligne cochée, après les options et avant « Autre… » ; value les porte ; le champ se vide et RESTE ouvert', async () => {
      await ouvrirChamp('multi')
      await valider('multi', 'Kiwi')
      assert.deepEqual(Array.from(sel('multi')._state.value), ['Kiwi'])
      assert.ok(champ('multi'), 'le champ reste ouvert pour la suivante')
      assert.equal(champ('multi').value, '', 'et il est vide')
      assert.equal(sel('multi')._state.open, true)
      await valider('multi', 'Mangue')
      assert.deepEqual(Array.from(sel('multi')._state.value), ['Kiwi', 'Mangue'])
      touche(champ('multi'), 'Escape')
      await pause(40)
      assert.deepEqual(libelles('multi'), ['Lait', 'Oeuf', 'Noix', 'Kiwi', 'Mangue', 'Autre…'])
      assert.deepEqual(coches('multi'), ['Kiwi', 'Mangue'], 'les réponses libres sont cochées, pas « Autre… »')
      assert.equal(bouton('multi').textContent.trim(), 'Kiwi, Mangue')
      const coche = lignes('multi')[3].querySelector('.select-check')
      assert.equal(coche.textContent, '✔')
    })

    it('un texte déjà donné (accents et casse ignorés) n\'est pas ajouté deux fois ; le champ se vide', async () => {
      const j = ecouter('multi')
      const avant = j.length
      await ouvrirChamp('multi')
      await valider('multi', 'kiwi')
      await valider('multi', ' KIWI ')
      assert.deepEqual(Array.from(sel('multi')._state.value), ['Kiwi', 'Mangue'])
      assert.deepEqual(j.slice(avant), [], 'rien n\'a changé')
      assert.equal(champ('multi').value, '')
      touche(champ('multi'), 'Escape')
      await pause(30)
    })

    it('cliquer une ligne cochée la retire du tableau et de la liste ; change et other partent (copies)', async () => {
      const j = ecouter('multi')
      const avant = j.length
      await ouvrir('multi')
      clic(lignes('multi')[3])
      await pause(40)
      assert.deepEqual(Array.from(sel('multi')._state.value), ['Mangue'])
      assert.deepEqual(libelles('multi'), ['Lait', 'Oeuf', 'Noix', 'Mangue', 'Autre…'])
      assert.deepEqual(j.slice(avant), [['change', ['Mangue']], ['other', ['Mangue']]])
    })

    it('Entrée sur une réponse libre (ligne active) la retire aussi ; other part avec un tableau vide', async () => {
      const j = ecouter('multi')
      const avant = j.length
      await ouvrir('multi')
      touche(cadre('multi'), 'End')
      touche(cadre('multi'), 'ArrowUp')
      await pause(30)
      assert.deepEqual(actives('multi'), ['Mangue'])
      touche(cadre('multi'), 'Enter')
      await pause(40)
      assert.deepEqual(Array.from(sel('multi')._state.value), [])
      assert.deepEqual(j.slice(avant), [['change', []], ['other', []]])
      assert.equal(sel('multi')._state.open, true, 'le panneau reste ouvert')
    })

    it('cocher une option ne touche pas aux réponses libres : change seul, sans other', async () => {
      const j = ecouter('multi2')
      await ouvrirChamp('multi2')
      await valider('multi2', 'Kiwi')
      touche(champ('multi2'), 'Escape')
      await pause(30)
      j.length = 0
      clic(lignes('multi2')[0])
      await pause(40)
      assert.deepEqual(Array.from(sel('multi2')._state.value), ['Kiwi', 'lait'])
      assert.deepEqual(j, [['change', ['Kiwi', 'lait']]])
    })

    it('e.data de change est une copie : la modifier ne touche pas le choix', async () => {
      let recu: any = null
      hote._shadow.querySelector('#multi3').addEventListener('change', (e: any) => { recu = e.data })
      await ouvrirChamp('multi3')
      await valider('multi3', 'Kiwi')
      recu.push('intrus')
      assert.deepEqual(Array.from(sel('multi3')._state.value), ['Kiwi'])
    })

    it('un texte égal à la forme texte de la VALEUR d\'une option (« 18 » pour {18}) la coche avec SA valeur, le nombre ; déjà cochée, elle reste cochée', async () => {
      const j = ecouter('nombre-m')
      await ouvrirChamp('nombre-m')
      await valider('nombre-m', '18')
      assert.deepStrictEqual(Array.from(sel('nombre-m')._state.value), [18])
      assert.deepEqual(coches('nombre-m'), ['Dix-huit'])
      assert.equal(champ('nombre-m').value, '', 'le champ se vide')
      await valider('nombre-m', ' 18 ')
      assert.deepStrictEqual(Array.from(sel('nombre-m')._state.value), [18], 'toujours cochée')
      assert.deepEqual(coches('nombre-m'), ['Dix-huit'])
      assert.deepStrictEqual(j, [['change', [18]]], 'un seul change, pas de other')
    })

    it('un texte égal au libellé d\'une option coche cette option (une seule fois) : le champ reste ouvert, vide ; déjà cochée, rien ne change', async () => {
      const j = ecouter('multi4')
      await ouvrirChamp('multi4')
      await valider('multi4', 'OEUF')
      assert.deepEqual(Array.from(sel('multi4')._state.value), ['oeuf'])
      assert.ok(champ('multi4'))
      assert.equal(champ('multi4').value, '')
      await valider('multi4', 'oeuf')
      assert.deepEqual(Array.from(sel('multi4')._state.value), ['oeuf'], 'déjà cochée : elle le reste')
      assert.deepEqual(j, [['change', ['oeuf']]], 'un seul change, jamais de other')
    })
  })

  describe('7 · les réponses libres se déduisent de value', () => {
    it('value="Zed" posée par la page : le bouton dit Zed, la dernière ligne « Autre : Zed » est sélectionnée et active', async () => {
      assert.equal(bouton('pose').textContent.trim(), 'Zed')
      await ouvrir('pose')
      assert.deepEqual(libelles('pose'), ['France', 'Allemagne', 'États-Unis', `Autre${NBSP}: Zed`])
      assert.deepEqual(coches('pose'), [`Autre${NBSP}: Zed`])
      assert.deepEqual(actives('pose'), [`Autre${NBSP}: Zed`])
    })

    it('multiple, value={[\'fr\', \'Zed\', \'Yo\']} : France cochée, deux lignes cochées pour les réponses libres, le bouton les joint', async () => {
      assert.equal(bouton('pose-multi').textContent.trim(), 'France, Zed, Yo')
      await ouvrir('pose-multi')
      assert.deepEqual(libelles('pose-multi'), ['France', 'Allemagne', 'États-Unis', 'Zed', 'Yo', 'Autre…'])
      assert.deepEqual(coches('pose-multi'), ['France', 'Zed', 'Yo'])
    })

    it('une valeur liée (value=!{…}) que la page change ensuite : l\'affichage suit, sans change ni other', async () => {
      const j = ecouter('pose-lie')
      assert.equal(bouton('pose-lie').textContent.trim(), 'France')
      hote._set('lie', 'Qux')
      await pause(60)
      assert.equal(bouton('pose-lie').textContent.trim(), 'Qux')
      await ouvrir('pose-lie')
      assert.deepEqual(coches('pose-lie'), [`Autre${NBSP}: Qux`])
      hote._set('lie', 'de')
      await pause(60)
      assert.equal(bouton('pose-lie').textContent.trim(), 'Allemagne')
      assert.deepEqual(coches('pose-lie'), ['Allemagne'])
      assert.deepEqual(j, [], 'rien n\'est annoncé quand la page pose elle-même la valeur')
    })

    it('un texte fait de blancs posé par la page n\'est pas une réponse libre (comme \'\') : le bouton dit « Choisir… », pas de ligne « Autre : … », pas de champ <nom>_other', async () => {
      assert.equal(bouton('blancs').textContent.trim(), 'Choisir…')
      assert.deepEqual(cache('blancs').filter(([n]: any) => n === 'bl_other'), [])
      await ouvrir('blancs')
      assert.deepEqual(libelles('blancs'), ['France', 'Allemagne', 'États-Unis', 'Autre…'])
      await fermerTout()
      assert.equal(bouton('blancs-m').textContent.trim(), 'France', 'seule l\'option est montrée')
      assert.deepEqual(cache('blancs-m').filter(([n]: any) => n === 'blm_other[]'), [])
      await ouvrir('blancs-m')
      assert.deepEqual(libelles('blancs-m'), ['France', 'Allemagne', 'États-Unis', 'Autre…'])
    })

    it('null, undefined et "" ne sont jamais une réponse libre', async () => {
      assert.equal(bouton('pose-vide').textContent.trim(), 'Choisir…')
      assert.equal(bouton('pose-null').textContent.trim(), 'Choisir…')
      assert.equal(bouton('pose-multi-vide').textContent.trim(), 'France')
      await ouvrir('pose-multi-vide')
      assert.deepEqual(libelles('pose-multi-vide'), ['France', 'Allemagne', 'États-Unis', 'Autre…'])
      assert.deepEqual(coches('pose-multi-vide'), ['France'])
      await fermerTout()
      await ouvrir('pose-vide')
      assert.deepEqual(coches('pose-vide'), [])
      assert.equal(autre('pose-vide').getAttribute('aria-selected'), 'false')
      assert.deepEqual(cache('pose-null'), [])
    })

    it('sans other : une valeur inconnue ne choisit rien (le bouton dit « Choisir… »), pas de ligne de plus, et elle ne part pas avec le formulaire, comme avec un <select> natif', async () => {
      assert.equal(bouton('sans-other').textContent.trim(), 'Choisir…')
      await ouvrir('sans-other')
      assert.deepEqual(libelles('sans-other'), ['France', 'Allemagne', 'États-Unis'])
      assert.deepEqual(coches('sans-other'), [])
      assert.deepEqual(cache('sans-other'), [])
      assert.equal(bouton('sans-other-multi').textContent.trim(), 'France')
      assert.deepEqual(cache('sans-other-multi'), [['som[]', 'fr']])
    })
  })

  describe('8 · les champs cachés du formulaire', () => {
    it('groupe → groupe_other : l\'option garde le champ nommé name, la réponse libre part dans <nom>_other', async () => {
      await ouvrirChamp('nom-simple')
      clic(lignes('nom-simple')[0])
      await pause(40)
      assert.deepEqual(cache('nom-simple'), [['groupe', 'fr']])
      await ouvrirChamp('nom-simple')
      await valider('nom-simple', 'Zed')
      assert.deepEqual(cache('nom-simple'), [['groupe_other', 'Zed']], 'la réponse libre ne se mêle pas au champ des options')
    })

    it('allergies[] → allergies_other[] : un champ par option cochée, un par réponse libre', async () => {
      await ouvrirChamp('nom-multi')
      clic(lignes('nom-multi')[0])
      await pause(30)
      await valider('nom-multi', 'Kiwi')
      await valider('nom-multi', 'Mangue')
      const tout = cache('nom-multi')
      assert.deepEqual(tout.filter(([n]) => n === 'allergies[]'), [['allergies[]', 'lait']])
      assert.deepEqual(tout.filter(([n]) => n === 'allergies_other[]'), [['allergies_other[]', 'Kiwi'], ['allergies_other[]', 'Mangue']])
      assert.equal(tout.length, 3)
    })

    it('profil[groupe] → profil[groupe_other]', async () => {
      await ouvrirChamp('profil')
      await valider('profil', 'Zed')
      assert.deepEqual(cache('profil'), [['profil[groupe_other]', 'Zed']])
    })

    it('profil[allergies][] → profil[allergies_other][]', async () => {
      await ouvrirChamp('profil-multi')
      await valider('profil-multi', 'Kiwi')
      assert.deepEqual(cache('profil-multi'), [['profil[allergies_other][]', 'Kiwi']])
    })

    it('sans name : aucun champ caché, ni pour les options ni pour les réponses libres', async () => {
      await ouvrirChamp('sans-nom')
      await valider('sans-nom', 'Zed')
      assert.deepEqual(cache('sans-nom'), [])
      await ouvrirChamp('sans-nom-multi')
      await valider('sans-nom-multi', 'Kiwi')
      assert.deepEqual(cache('sans-nom-multi'), [])
    })

    it('les champs cachés ne sont posés qu\'une fois : les poser dans la balise relit les options, ce qui ne doit pas les refaire sans fin', async () => {
      const hote = sel('profil')
      const pose = hote.appendChild.bind(hote)
      let poses = 0
      hote.appendChild = (n: any) => { poses++; return pose(n) }
      await ouvrirChamp('profil')
      await valider('profil', 'Calme')
      await pause(500)
      delete hote.appendChild
      assert.equal(poses, 1, 'un champ posé pour la réponse validée, puis plus rien au repos')
      assert.deepEqual(cache('profil'), [['profil[groupe_other]', 'Calme']])
    })

    it('un formulaire réel les ramasse : new FormData(form)', async () => {
      const form = hote._shadow.querySelector('#f-donnees')
      const fs   = form.querySelector('mjs-core-select')
      clic(fs._shadow.querySelector('.select-btn'))
      await pause(30)
      clic(fs._shadow.querySelector('.select-other'))
      await pause(40)
      const c = fs._shadow.querySelector('.select-other-input')
      c.value = 'Zed'
      c.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true, composed: true }))
      await pause(30)
      touche(c, 'Enter')
      await pause(40)
      const fd = new window.FormData(form)
      assert.equal(fd.get('fd_other'), 'Zed')
      assert.equal(fd.get('fd'), null)
    })
  })

  describe('9 · l\'événement other', () => {
    it('saisie validée, ligne décochée, option qui la remplace : other part après change, avec le texte, le tableau ou null', async () => {
      const j = ecouter('evenement')
      await ouvrirChamp('evenement')
      await valider('evenement', 'Zed')
      await ouvrir('evenement')
      clic(lignes('evenement')[0])
      await pause(40)
      assert.deepEqual(j, [['change', 'Zed'], ['other', 'Zed'], ['change', 'fr'], ['other', null]])
    })

    it('le parent l\'écoute comme tout évènement : @other={…}, e.data', async () => {
      await ouvrirChamp('evenement')
      await valider('evenement', 'Yo')
      assert.equal(hote._shadow.querySelector('.echo').textContent, '"Yo"')
    })

    it('multiple : ajout, retrait d\'une réponse libre', async () => {
      const j = ecouter('multi6')
      await ouvrirChamp('multi6')
      await valider('multi6', 'Kiwi')
      touche(champ('multi6'), 'Escape')
      await pause(30)
      clic(lignes('multi6').find((l: any) => libelle(l) === 'Kiwi'))
      await pause(40)
      assert.deepEqual(j, [['change', ['Kiwi']], ['other', ['Kiwi']], ['change', []], ['other', []]])
    })

    it('jamais quand la page pose elle-même la valeur', async () => {
      const j = ecouter('pose-lie')
      const avant = j.length
      hote._set('lie', 'Sss')
      await pause(60)
      hote._set('lie', 'us')
      await pause(60)
      assert.equal(bouton('pose-lie').textContent.trim(), 'États-Unis')
      assert.equal(j.length, avant, 'ni change ni other')
    })
  })

  describe('10 · le clavier de bout en bout, aria-activedescendant, la recherche', () => {
    const actifId = (id: string) => bouton(id).getAttribute('aria-activedescendant')
    const idDeLaLigneActive = (id: string) => lignes(id).find((l: any) => l.classList.contains('active'))?.id

    it('sans souris : ouvrir, parcourir jusqu\'à « Autre… », écrire, valider', async () => {
      touche(cadre('clavier2'), 'ArrowDown')
      await pause(30)
      assert.equal(sel('clavier2')._state.open, true)
      assert.equal(actifId('clavier2'), idDeLaLigneActive('clavier2'))
      for (let i = 0; i < 4; i++) touche(cadre('clavier2'), 'ArrowDown')
      await pause(30)
      assert.deepEqual(actives('clavier2'), ['Autre…'], 'les flèches ne vont pas plus loin que la dernière ligne')
      assert.equal(actifId('clavier2'), autre('clavier2').id)
      touche(cadre('clavier2'), 'Enter')
      await pause(40)
      assert.ok(coque('clavier2').activeElement === champ('clavier2'))
      assert.equal(actifId('clavier2') ?? null, null, 'le champ est hors de la liste : plus de ligne active annoncée')
      await valider('clavier2', 'Zed')
      assert.equal(sel('clavier2')._state.value, 'Zed')
      assert.equal(sel('clavier2')._state.open, false)
    })

    it('les flèches parcourent les options, puis les réponses libres, puis « Autre… » ; Début et Fin vont aux deux bouts ; aria-activedescendant suit', async () => {
      await ouvrir('clavier')
      assert.deepEqual(libelles('clavier'), ['France', 'Allemagne', 'États-Unis', 'Zed', 'Yo', 'Autre…'])
      touche(cadre('clavier'), 'Home')
      const vus: string[] = []
      for (let i = 0; i < 5; i++) {
        await pause(20)
        vus.push(actives('clavier')[0])
        assert.equal(actifId('clavier'), idDeLaLigneActive('clavier'))
        touche(cadre('clavier'), 'ArrowDown')
      }
      await pause(20)
      vus.push(actives('clavier')[0])
      assert.deepEqual(vus, ['France', 'Allemagne', 'États-Unis', 'Zed', 'Yo', 'Autre…'])
      touche(cadre('clavier'), 'Home')
      await pause(20)
      assert.deepEqual(actives('clavier'), ['France'])
      touche(cadre('clavier'), 'End')
      await pause(20)
      assert.deepEqual(actives('clavier'), ['Autre…'])
      assert.equal(actifId('clavier'), autre('clavier').id)
      touche(cadre('clavier'), 'ArrowUp')
      await pause(20)
      assert.deepEqual(actives('clavier'), ['Yo'])
    })

    it('avec search, les réponses libres passent par le même filtre que les options (leur texte) ; « Autre… » n\'est jamais filtrée', async () => {
      await ouvrir('recherche-m')
      assert.deepEqual(libelles('recherche-m'), ['France', 'Allemagne', 'États-Unis', 'Zed', 'Yo', 'Autre…'])
      await chercher('recherche-m', 'zed')
      assert.deepEqual(libelles('recherche-m'), ['Zed', 'Autre…'])
      assertAbsent(coque('recherche-m').querySelector('.select-empty'), 'une réponse libre a été trouvée')
      assert.deepEqual(actives('recherche-m'), ['Zed'], 'la première ligne trouvée est active')
      await chercher('recherche-m', 'fr')
      assert.deepEqual(libelles('recherche-m'), ['France', 'Autre…'])
      await chercher('recherche-m', 'qqqq')
      assert.deepEqual(libelles('recherche-m'), ['Autre…'])
      assert.equal(coque('recherche-m').querySelector('.select-empty').textContent, 'Aucun résultat')
      assert.deepEqual(actives('recherche-m'), ['Autre…'], '« Autre… » est la seule ligne : elle est active')
      await chercher('recherche-m', '')
      assert.equal(libelles('recherche-m').length, 6)
    })

    it('rien n\'est trouvé : Entrée, avec « Autre… » pour seule ligne, ouvre le champ', async () => {
      await ouvrir('recherche')
      await chercher('recherche', 'qqqq')
      touche(cadre('recherche'), 'Enter')
      await pause(40)
      assert.ok(champ('recherche'))
    })
  })

  describe('11 · la jauge de largeur', () => {
    const jauge = (id: string) => [...coque(id).querySelectorAll('.select-sizer > span')].map((s: any) => s.textContent.trim())

    it('elle compte le libellé de la ligne « Autre… »', () => {
      assert.deepEqual(jauge('simple'), ['Choisir…', 'France', 'Allemagne', 'États-Unis', 'Autre…'])
      assert.deepEqual(jauge('libelles'), ['Choisir…', 'France', 'Allemagne', 'États-Unis', 'Autre pays'])
    })

    it('sans other, la jauge ne change pas', () => {
      assert.deepEqual(jauge('a-absent'), ['Choisir…', 'France', 'Allemagne', 'États-Unis'])
    })

    it('elle ne compte pas les réponses libres (le bouton les coupe par des points de suspension)', () => {
      assert.deepEqual(jauge('pose-multi'), ['Choisir…', 'France', 'Allemagne', 'États-Unis', 'Autre…'])
      assert.deepEqual(jauge('pose'), ['Choisir…', 'France', 'Allemagne', 'États-Unis', 'Autre…'])
    })
  })

  describe('12 · lecteur d\'écran', () => {
    it('« Autre… » et les réponses libres sont des role="option", aria-selected juste', async () => {
      await ouvrir('pose-multi')
      for (const l of lignes('pose-multi')) assert.equal(l.getAttribute('role'), 'option')
      const etat = Object.fromEntries(lignes('pose-multi').map((l: any) => [libelle(l), l.getAttribute('aria-selected')]))
      assert.deepEqual(etat, { France: 'true', Allemagne: 'false', 'États-Unis': 'false', Zed: 'true', Yo: 'true', 'Autre…': 'false' })
      const ids = lignes('pose-multi').map((l: any) => l.id)
      assert.equal(new Set(ids).size, ids.length, 'chaque ligne a son identifiant')
      assert.ok(ids.every((i: string) => i), 'et tous existent')
    })

    it('en choix simple, « Autre : Zed » est la seule ligne sélectionnée', async () => {
      await ouvrir('pose')
      assert.equal(liste('pose').getAttribute('aria-multiselectable'), 'false')
      assert.deepEqual(coches('pose'), [`Autre${NBSP}: Zed`])
    })

    it('le champ : aria-label = son texte d\'invite, aria-describedby = l\'indice ; le compteur est visible, sans annonce à chaque frappe', async () => {
      await ouvrirChamp('libelles')
      const c = champ('libelles')
      assert.equal(c.getAttribute('aria-label'), 'Lequel ?')
      assert.equal(c.getAttribute('placeholder'), 'Lequel ?')
      const indice = coque('libelles').querySelector('#' + c.getAttribute('aria-describedby'))
      assert.ok(indice, 'l\'indice décrit le champ')
      assert.equal(indice.textContent.trim(), 'Entrée pour valider · Échap pour revenir')
      const compteur = coque('libelles').querySelector('.select-other-count')
      assert.equal(compteur.getAttribute('aria-hidden'), null, 'le compteur est visible pour le lecteur aussi')
      for (let n = compteur; n && n !== panneau('libelles'); n = n.parentElement) assert.equal(n.getAttribute('aria-live'), null, 'aucune annonce à chaque frappe')
    })

    it('parts de style : other (la ligne « Autre… ») et other-input (le champ)', async () => {
      await ouvrir('simple2')
      assert.ok(autre('simple2').getAttribute('part').split(' ').includes('other'))
      assert.ok(autre('simple2').getAttribute('part').split(' ').includes('option'), 'c\'est aussi une ligne de la liste')
      clic(autre('simple2'))
      await pause(40)
      assert.equal(champ('simple2').getAttribute('part'), 'other-input')
    })
  })

  describe('13 · form.reset()', () => {
    const pasDe = (j: Array<[string, any]>) => assert.deepEqual(j, [], 'aucun change ni other : le formulaire dit lui-même son reset')

    it('choix simple : la réponse libre donnée est oubliée, la valeur de départ revient', async () => {
      const j = ecouter('f-simple')
      const fs = hote._shadow.querySelector('#f-simple mjs-core-select')
      clic(fs._shadow.querySelector('.select-btn'))
      await pause(30)
      clic(fs._shadow.querySelector('.select-other'))
      await pause(40)
      const c = fs._shadow.querySelector('.select-other-input')
      c.value = 'Yo'
      c.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true, composed: true }))
      await pause(30)
      touche(c, 'Enter')
      await pause(40)
      assert.equal(fs._state.value, 'Yo')
      j.length = 0
      hote._shadow.querySelector('#f-simple').reset()
      await pause(80)
      assert.equal(fs._state.value, 'fr')
      assert.equal(fs._shadow.querySelector('.select-btn').textContent.trim(), 'France')
      assert.deepEqual([...fs.querySelectorAll('input[type="hidden"]')].map((i: any) => [i.name, i.value]), [['fs', 'fr']])
      pasDe(j)
    })

    it('choix simple parti d\'une réponse libre : elle revient, avec sa ligne « Autre : … »', async () => {
      const j = ecouter('f-libre')
      const fl = hote._shadow.querySelector('#f-libre mjs-core-select')
      assert.equal(fl._shadow.querySelector('.select-btn').textContent.trim(), 'Zed')
      clic(fl._shadow.querySelector('.select-btn'))
      await pause(30)
      clic(fl._shadow.querySelectorAll('.select-option')[1])
      await pause(40)
      assert.equal(fl._state.value, 'de')
      j.length = 0
      hote._shadow.querySelector('#f-libre').reset()
      await pause(80)
      assert.equal(fl._state.value, 'Zed')
      assert.equal(fl._shadow.querySelector('.select-btn').textContent.trim(), 'Zed')
      assert.deepEqual([...fl.querySelectorAll('input[type="hidden"]')].map((i: any) => [i.name, i.value]), [['fl_other', 'Zed']])
      clic(fl._shadow.querySelector('.select-btn'))
      await pause(30)
      assert.equal(fl._shadow.querySelector('.select-other .select-option-label').textContent, `Autre${NBSP}: Zed`)
      pasDe(j)
    })

    it('multiple : les réponses libres de départ reviennent, celles qu\'on a ajoutées partent', async () => {
      const j = ecouter('f-multi')
      const fm = hote._shadow.querySelector('#f-multi mjs-core-select')
      clic(fm._shadow.querySelector('.select-btn'))
      await pause(30)
      clic(fm._shadow.querySelector('.select-other'))
      await pause(40)
      const c = fm._shadow.querySelector('.select-other-input')
      c.value = 'Yo'
      c.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true, composed: true }))
      await pause(30)
      touche(c, 'Enter')
      await pause(40)
      touche(c, 'Escape')
      await pause(30)
      const zed = [...fm._shadow.querySelectorAll('.select-option')].find((l: any) => l.textContent.includes('Zed'))
      clic(zed)
      await pause(40)
      assert.deepEqual(Array.from(fm._state.value), ['fr', 'Yo'])
      j.length = 0
      hote._shadow.querySelector('#f-multi').reset()
      await pause(80)
      assert.deepEqual(Array.from(fm._state.value), ['fr', 'Zed'])
      assert.deepEqual([...fm.querySelectorAll('input[type="hidden"]')].map((i: any) => [i.name, i.value]), [['fm[]', 'fr'], ['fm_other[]', 'Zed']])
      pasDe(j)
    })
  })

  describe('14 · avec des groupes (<@@optgroup>) et des icônes', () => {
    const indices = (id: string) => lignes(id).map((l: any) => l.id.split('-opt-')[1])

    it('groupes : « Autre… » est la dernière ligne, hors de tout groupe ; les indices et aria-activedescendant se suivent d\'un groupe à l\'autre', async () => {
      await ouvrir('groupes')
      assert.deepEqual(libelles('groupes'), ['France', 'Allemagne', 'États-Unis', 'Canada', 'Autre…'])
      assert.deepEqual([...coque('groupes').querySelectorAll('.select-group-label')].map((e: any) => e.textContent.trim()), ['Europe', 'Amérique'])
      assert.ok(autre('groupes').closest('.select-group') === null, '« Autre… » n\'est dans aucun groupe')
      assert.ok(liste('groupes').lastElementChild === autre('groupes'), 'elle ferme la liste')
      assert.deepEqual(indices('groupes'), ['0', '1', '2', '3', '4'])
      for (let i = 0; i < 4; i++) touche(cadre('groupes'), 'ArrowDown')
      await pause(30)
      assert.deepEqual(actives('groupes'), ['Autre…'], 'quatre flèches traversent les deux groupes')
      assert.equal(bouton('groupes').getAttribute('aria-activedescendant'), autre('groupes').id)
      touche(cadre('groupes'), 'Home')
      await pause(30)
      assert.deepEqual(actives('groupes'), ['France'])
      touche(cadre('groupes'), 'End')
      await pause(30)
      assert.deepEqual(actives('groupes'), ['Autre…'])
    })

    it('groupes : un texte égal au libellé d\'une option d\'un groupe choisit cette option', async () => {
      const j = ecouter('groupes')
      await ouvrirChamp('groupes')
      await valider('groupes', 'canada')
      assert.equal(sel('groupes')._state.value, 'ca')
      assert.equal(bouton('groupes').textContent.trim(), 'Canada')
      assert.deepEqual(j, [['change', 'ca']])
    })

    it('groupes, multiple : une réponse libre forme une section à part, après les groupes et avant « Autre… », cochée ; les indices restent continus', async () => {
      await ouvrir('groupes-m')
      assert.deepEqual(libelles('groupes-m'), ['France', 'Allemagne', 'États-Unis', 'Canada', 'Zed', 'Autre…'])
      assert.deepEqual(coches('groupes-m'), ['Zed'])
      const zed = lignes('groupes-m')[4]
      assert.ok(zed.closest('.select-group') === null, 'la réponse libre n\'est dans aucun groupe')
      assert.equal(coque('groupes-m').querySelectorAll('.select-section').length, 3, 'deux groupes et la section des réponses libres')
      assert.deepEqual(indices('groupes-m'), ['0', '1', '2', '3', '4', '5'])
      touche(cadre('groupes-m'), 'End')
      await pause(30)
      assert.deepEqual(actives('groupes-m'), ['Autre…'])
      touche(cadre('groupes-m'), 'ArrowUp')
      await pause(30)
      assert.deepEqual(actives('groupes-m'), ['Zed'])
    })

    it('icônes : l\'icône de l\'option choisie est au bouton ; elle disparaît quand une réponse libre est choisie ; la ligne « Autre… » n\'en a pas', async () => {
      await ouvrir('icones')
      assert.equal(autre('icones').querySelector('.select-icon') === null, true, '« Autre… » sans icône')
      clic(lignes('icones')[0])
      await pause(40)
      assert.equal(bouton('icones').querySelector('.select-icon').textContent.trim(), '★')
      await ouvrirChamp('icones')
      await valider('icones', 'Zed')
      assert.equal(bouton('icones').textContent.trim(), 'Zed')
      assert.ok(bouton('icones').querySelector('.select-icon') === null, 'plus d\'icône : la réponse libre n\'en a pas')
      await ouvrir('icones')
      assert.equal(libelles('icones').at(-1), `Autre${NBSP}: Zed`)
      assert.ok(autre('icones').querySelector('.select-icon') === null)
      assert.equal(lignes('icones')[0].querySelector('.select-icon').textContent.trim(), '★', 'les options gardent leur icône')
    })
  })

  describe('15 · les formes de l\'attribut et les libellés', () => {
    async function maximum(id: string): Promise<string | null> {
      await ouvrir(id)
      if (!autre(id)) return null
      clic(autre(id))
      await pause(40)
      return champ(id).getAttribute('maxlength')
    }

    it('other seul : 80 au plus', async () => { assert.equal(await maximum('a-defaut'), '80') })
    it('other="42" : 42', async () => { assert.equal(await maximum('a-42'), '42') })
    it('other={42} : 42', async () => { assert.equal(await maximum('a-nombre'), '42') })
    it('other="1" : 1, le plus petit maximum', async () => { assert.equal(await maximum('a-un'), '1') })
    it('other="abc" : 80', async () => { assert.equal(await maximum('a-abc'), '80') })
    it('other="0" : 80', async () => { assert.equal(await maximum('a-zero'), '80') })
    it('other="-3" : 80', async () => { assert.equal(await maximum('a-moins'), '80') })
    it('other="42.5" : 80 (pas un entier)', async () => { assert.equal(await maximum('a-decimal'), '80') })
    it('other={false} : pas de réponse libre', async () => { assert.equal(await maximum('a-faux'), null) })
    it('sans other : pas de réponse libre', async () => { assert.equal(await maximum('a-absent'), null) })

    it('le compteur dit le maximum posé : « 0 / 42 »', async () => {
      await ouvrirChamp('a-42')
      assert.equal(coque('a-42').querySelector('.select-other-count').textContent.trim(), '0 / 42')
    })

    it('other-label et other-placeholder remplacent les textes par défaut', async () => {
      await ouvrir('libelles')
      assert.equal(libelles('libelles').at(-1), 'Autre pays')
      clic(autre('libelles'))
      await pause(40)
      assert.equal(champ('libelles').getAttribute('placeholder'), 'Lequel ?')
      await valider('libelles', 'Zed')
      await ouvrir('libelles')
      assert.equal(libelles('libelles').at(-1), `Autre pays${NBSP}: Zed`)
    })

    it('le libellé de la ligne choisie perd ses points de suspension finaux (… ou ...)', async () => {
      await ouvrirChamp('points')
      await valider('points', 'Zed')
      await ouvrir('points')
      assert.equal(libelles('points').at(-1), `Autre réponse${NBSP}: Zed`)
      await fermerTout()
      await ouvrirChamp('simple5')
      await valider('simple5', 'Zed')
      await ouvrir('simple5')
      assert.equal(libelles('simple5').at(-1), `Autre${NBSP}: Zed`)
    })

    it('la page en anglais : les cinq libellés suivent la langue', async () => {
      clic(hote._shadow.querySelector('#en'))
      await pause(80)
      await ouvrir('simple7')
      assert.equal(libelles('simple7').at(-1), 'Other…')
      clic(autre('simple7'))
      await pause(40)
      const c = champ('simple7')
      assert.equal(c.getAttribute('placeholder'), 'Please specify')
      assert.equal(c.getAttribute('aria-label'), 'Please specify')
      assert.equal(coque('simple7').querySelector('.select-other-hint').textContent.trim(), 'Enter to confirm · Esc to go back')
      assert.equal(coque('simple7').querySelector('.select-other-ok').getAttribute('aria-label'), 'Confirm')
      await valider('simple7', 'Zed')
      await ouvrir('simple7')
      assert.equal(libelles('simple7').at(-1), 'Other: Zed', 'le séparateur anglais : deux-points collé, une espace')
    })
  })
})

describe('<@@select other> — les textes de la réponse libre surchargés par le dictionnaire du projet (happy-dom, bundler réel)', function () {
  this.timeout(180000)

  let window: any = null
  let hote: any   = null

  const coque   = () => hote._shadow.querySelector('mjs-core-select')._shadow
  const clic    = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
  const libelles = () => [...coque().querySelectorAll('.select-option')].map((l: any) => l.querySelector('.select-option-label').textContent)

  before(async () => {
    const dico: Record<string, string> = {
      'mjs.core.selectOther':            'Un autre pays…',
      'mjs.core.selectOtherPlaceholder': 'Lequel ?',
      'mjs.core.selectOtherHint':        'Entrée : valider',
      'mjs.core.selectOtherOk':          'Confirmer',
      'mjs.core.selectOtherSep':         ' = '
    }
    const monte = await monter(`<@@select name="d" other>${PAYS}</@@select>`, 'core-select-autre-dictionnaire', (w: any) => { w.µ._mjs_i18nLookup = (cle: string) => dico[cle] })
    window = monte.window
    hote   = monte.hote
    await pause(300)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('les cinq textes viennent du dictionnaire du projet (mjs.core.selectOther…), avant ceux du framework', async () => {
    clic(coque().querySelector('.select-btn'))
    await pause(40)
    assert.equal(libelles().at(-1), 'Un autre pays…', 'la ligne')
    clic(coque().querySelector('.select-other'))
    await pause(40)
    const c = coque().querySelector('.select-other-input')
    assert.equal(c.getAttribute('placeholder'), 'Lequel ?')
    assert.equal(c.getAttribute('aria-label'), 'Lequel ?')
    assert.equal(coque().querySelector('.select-other-hint').textContent.trim(), 'Entrée : valider')
    assert.equal(coque().querySelector('.select-other-ok').getAttribute('aria-label'), 'Confirmer')
    c.value = 'Zed'
    c.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true, composed: true }))
    await pause(30)
    c.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, composed: true }))
    await pause(40)
    clic(coque().querySelector('.select-btn'))
    await pause(40)
    assert.equal(libelles().at(-1), 'Un autre pays = Zed', 'le séparateur du dictionnaire, les points de suspension du libellé retirés')
  })
})
