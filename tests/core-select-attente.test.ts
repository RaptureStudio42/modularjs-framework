// <@@select> : le texte d'attente (« Choisir… »), grisé tant que rien n'est choisi.
// Ce fichier prouve ce qui se lit sans navigateur (bundler réel + happy-dom, même harnais que core-select-autre) : le libellé
// du bouton porte la classe `placeholder` exactement quand il montre le texte d'attente (rien de choisi, valeur inconnue, aucune
// option, choix multiple vide), la perd dès qu'une option ou une réponse libre est choisie et la retrouve quand le choix est
// retiré ; la règle de style lit la variable --mjs-select-placeholder sans jamais la déclarer (une déclaration sur :host masquerait
// toute valeur héritée d'un ancêtre ou d'un bloc <theme>) ; la règle atteint le CSS construit, en développement comme en production.
// La couleur calculée, la variable posée à tous les niveaux, les deux champs internes et le contraste sont dans
// core-select-attente-browser.test.ts (Chromium et Firefox).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { attendre, pause } from './helpers/coeur-monter.js'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PAYS = '<@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option><@@option value="us">États-Unis</@@option>'
const LAIT = '<@@option value="lait">Lait</@@option><@@option value="oeuf">Oeuf</@@option><@@option value="noix">Noix</@@option>'

// une liste dont une option s'appelle comme le texte d'attente : la choisir est un vrai choix, que le libellé affiché ne distingue pas du texte d'attente
const TOUS = '<@@option value="tous">Choisir…</@@option><@@option value="fr">France</@@option>'

const HOTE = `<script>
  $lie = 'fr'
</script>

<div id="vide"><@@select name="a">${PAYS}</@@select></div>
<div id="choisi"><@@select name="b" value="fr">${PAYS}</@@select></div>
<div id="inconnu"><@@select name="c" value="zz">${PAYS}</@@select></div>
<div id="perso"><@@select name="d" placeholder="Votre pays…">${PAYS}</@@select></div>
<div id="sans-option"><@@select name="e"></@@select></div>
<div id="multi"><@@select name="f[]" multiple>${LAIT}</@@select></div>
<div id="multi-choisi"><@@select name="g[]" multiple value={['lait', 'oeuf']}>${LAIT}</@@select></div>
<div id="multi-inconnu"><@@select name="h[]" multiple value={['zz']}>${LAIT}</@@select></div>
<div id="libre"><@@select name="i" other value="Zed">${PAYS}</@@select></div>
<div id="libre-multi"><@@select name="j[]" multiple other value={['Zed']}>${LAIT}</@@select></div>
<div id="autre-vide"><@@select name="k" other>${PAYS}</@@select></div>
<div id="desactive"><@@select name="n" disabled>${PAYS}</@@select></div>
<div id="a-choisir"><@@select name="p">${PAYS}</@@select></div>
<div id="a-cocher"><@@select name="q[]" multiple>${LAIT}</@@select></div>
<div id="lie"><@@select name="l" value=!{$lie}>${PAYS}</@@select></div>
<button id="vider" @click={$lie = null}>vider</button>
<button id="poser" @click={$lie = 'de'}>poser</button>
<form id="f" @noUJS><div id="dans-form"><@@select name="m">${PAYS}</@@select></div></form>
<div id="langue"><@@select name="o">${PAYS}</@@select></div>
<div id="meme-nom"><@@select name="r" value="tous">${TOUS}</@@select></div>
<div id="meme-nom-perso"><@@select name="s" placeholder="Tous" value="all"><@@option value="all">Tous</@@option><@@option value="fr">France</@@option></@@select></div>
<div id="meme-nom-multi"><@@select name="t[]" multiple value={['tous']}>${TOUS}</@@select></div>
<div id="meme-nom-a-choisir"><@@select name="u">${TOUS}</@@select></div>
<button id="en" @click={µlang = 'en'}>en</button>
`

// le harnais des modules cœur (un hôte compilé par le vrai Bundler, monté dans happy-dom), avec les libellés par défaut du
// manifeste : sans eux « Choisir… » serait vide
async function monter(source: string, prefixe: string): Promise<{ window: any; hote: any }> {
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
  window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
  const hote = window.document.querySelector('mjs-hote')
  await attendre(() => !!hote._shadow)
  await pause(120)
  return { window, hote }
}

// tout le code construit d'une appli qui écrit un <@@select> (les feuilles des modules sont dans les .js émis), concaténé
async function construire(env: 'dev' | 'prod'): Promise<string> {
  const root   = mjsTmp('core-select-attente-' + env)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), `<@@select name="a" search other>${PAYS}</@@select>`)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...(env === 'prod' ? { env: 'prod' } : {}) })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
}

describe('<@@select> — le texte d\'attente est grisé (happy-dom, bundler réel)', function () {
  this.timeout(180000)

  let window: any = null
  let hote: any   = null

  const sel       = (id: string) => hote._shadow.querySelector(`#${id} mjs-core-select`)
  const coque     = (id: string) => sel(id)._shadow
  const bouton    = (id: string) => coque(id).querySelector('.select-btn')
  const etiquette = (id: string) => coque(id).querySelector('.select-label')
  const grise     = (id: string) => etiquette(id).classList.contains('placeholder')
  const texte     = (id: string) => etiquette(id).textContent.trim()
  const lignes    = (id: string) => [...coque(id).querySelectorAll('.select-option')]
  const clic      = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))

  async function ouvrir(id: string) {
    if (!sel(id)._state.open) { clic(bouton(id)); await pause(30) }
  }

  // clique la ligne de la liste qui porte ce libellé ; en choix simple la liste se referme d'elle-même
  async function choisir(id: string, libelle: string) {
    await ouvrir(id)
    clic(lignes(id).find((l: any) => l.querySelector('.select-option-label').textContent.trim() === libelle))
    await pause(40)
  }

  async function fermerTout() {
    for (const s of hote._shadow.querySelectorAll('mjs-core-select')) {
      if (!s._state.open) continue
      s._shadow.querySelector('.select').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, composed: true }))
    }
    await pause(30)
  }

  before(async () => {
    const monte = await monter(HOTE, 'core-select-attente')
    window = monte.window
    hote   = monte.hote
    await pause(300)
  })

  afterEach(fermerTout)

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  describe('1 · quand le libellé est grisé', () => {
    it('rien de choisi : le libellé montre « Choisir… » et porte la classe placeholder', () => {
      assert.equal(texte('vide'), 'Choisir…')
      assert.equal(grise('vide'), true)
    })

    it('un texte d\'attente de l\'auteur (placeholder="…") est grisé de la même façon', () => {
      assert.equal(texte('perso'), 'Votre pays…')
      assert.equal(grise('perso'), true)
    })

    it('aucune option : le texte d\'attente reste grisé', () => {
      assert.equal(texte('sans-option'), 'Choisir…')
      assert.equal(grise('sans-option'), true)
    })

    it('une valeur qui n\'est celle d\'aucune option ne choisit rien : le texte d\'attente, grisé (sans other)', () => {
      assert.equal(texte('inconnu'), 'Choisir…')
      assert.equal(grise('inconnu'), true)
    })

    it('choix multiple vide : grisé', () => {
      assert.equal(texte('multi'), 'Choisir…')
      assert.equal(grise('multi'), true)
    })

    it('choix multiple dont la seule valeur n\'est celle d\'aucune option : grisé', () => {
      assert.equal(texte('multi-inconnu'), 'Choisir…')
      assert.equal(grise('multi-inconnu'), true)
    })

    it('avec other, tant qu\'aucune réponse libre n\'est donnée : grisé', () => {
      assert.equal(texte('autre-vide'), 'Choisir…')
      assert.equal(grise('autre-vide'), true)
    })

    it('l\'attribut disabled, que le module ne lit pas, ne change rien : le texte d\'attente reste grisé', () => {
      assert.equal(texte('desactive'), 'Choisir…')
      assert.equal(grise('desactive'), true)
    })
  })

  describe('2 · quand le libellé garde la couleur normale', () => {
    it('une option choisie : son libellé, sans la classe', () => {
      assert.equal(texte('choisi'), 'France')
      assert.equal(grise('choisi'), false)
    })

    it('plusieurs options cochées : leurs libellés, sans la classe', () => {
      assert.equal(texte('multi-choisi'), 'Lait, Oeuf')
      assert.equal(grise('multi-choisi'), false)
    })

    it('une réponse libre donnée (choix simple) : son texte, sans la classe', () => {
      assert.equal(texte('libre'), 'Zed')
      assert.equal(grise('libre'), false)
    })

    it('une réponse libre donnée (choix multiple) : son texte, sans la classe', () => {
      assert.equal(texte('libre-multi'), 'Zed')
      assert.equal(grise('libre-multi'), false)
    })

    it('une option dont le libellé est celui du texte d\'attente (« Choisir… »), choisie : un vrai choix, sans la classe', () => {
      assert.equal(texte('meme-nom'), 'Choisir…')
      assert.equal(grise('meme-nom'), false)
    })

    it('un texte d\'attente de l\'auteur repris par une option (placeholder="Tous", option « Tous » choisie) : sans la classe', () => {
      assert.equal(texte('meme-nom-perso'), 'Tous')
      assert.equal(grise('meme-nom-perso'), false)
    })

    it('choix multiple coché sur une option qui porte le libellé du texte d\'attente : sans la classe', () => {
      assert.equal(texte('meme-nom-multi'), 'Choisir…')
      assert.equal(grise('meme-nom-multi'), false)
    })
  })

  describe('3 · le choix qui vient et qui part', () => {
    it('choix simple : choisir une option retire la classe', async () => {
      assert.equal(grise('a-choisir'), true, 'au départ')
      await choisir('a-choisir', 'Allemagne')
      assert.equal(texte('a-choisir'), 'Allemagne')
      assert.equal(grise('a-choisir'), false, 'une option choisie')
    })

    it('choisir l\'option qui porte le libellé du texte d\'attente : le libellé ne change pas, mais ce n\'est plus l\'attente — la classe part, et revient quand le choix est retiré', async () => {
      assert.equal(texte('meme-nom-a-choisir'), 'Choisir…')
      assert.equal(grise('meme-nom-a-choisir'), true, 'au départ, rien n\'est choisi')
      await choisir('meme-nom-a-choisir', 'Choisir…')
      assert.equal(texte('meme-nom-a-choisir'), 'Choisir…', 'le libellé de l\'option choisie')
      assert.equal(grise('meme-nom-a-choisir'), false, 'une option choisie, même nommée comme l\'attente')
      await choisir('meme-nom-a-choisir', 'France')
      assert.equal(texte('meme-nom-a-choisir'), 'France')
      assert.equal(grise('meme-nom-a-choisir'), false)
    })

    it('choix simple dans un formulaire : choisir puis form.reset() ramène le texte d\'attente grisé', async () => {
      assert.equal(grise('dans-form'), true, 'au départ')
      await choisir('dans-form', 'France')
      assert.equal(texte('dans-form'), 'France')
      assert.equal(grise('dans-form'), false, 'une option choisie')
      hote._shadow.querySelector('#f').reset()
      await pause(60)
      assert.equal(texte('dans-form'), 'Choisir…', 'le formulaire remis à zéro')
      assert.equal(grise('dans-form'), true, 'retour au texte d\'attente')
    })

    it('choix multiple : cocher retire la classe, décocher le dernier choix la rend', async () => {
      assert.equal(grise('a-cocher'), true, 'au départ')
      await choisir('a-cocher', 'Lait')
      assert.equal(texte('a-cocher'), 'Lait')
      assert.equal(grise('a-cocher'), false, 'une option cochée')
      await choisir('a-cocher', 'Oeuf')
      assert.equal(texte('a-cocher'), 'Lait, Oeuf')
      assert.equal(grise('a-cocher'), false, 'deux options cochées')
      await choisir('a-cocher', 'Lait')
      assert.equal(grise('a-cocher'), false, 'il en reste une')
      await choisir('a-cocher', 'Oeuf')
      assert.equal(texte('a-cocher'), 'Choisir…', 'plus rien de coché')
      assert.equal(grise('a-cocher'), true, 'retour au texte d\'attente')
    })

    it('valeur posée puis retirée par la page (value=!{…}) : la classe va et vient avec la valeur', async () => {
      assert.equal(grise('lie'), false, 'valeur posée au départ')
      clic(hote._shadow.querySelector('#vider'))
      await pause(60)
      assert.equal(texte('lie'), 'Choisir…')
      assert.equal(grise('lie'), true, 'valeur retirée')
      clic(hote._shadow.querySelector('#poser'))
      await pause(60)
      assert.equal(texte('lie'), 'Allemagne')
      assert.equal(grise('lie'), false, 'valeur reposée')
    })

    it('le texte d\'attente change de langue en restant grisé', async () => {
      assert.equal(texte('langue'), 'Choisir…')
      clic(hote._shadow.querySelector('#en'))
      await pause(80)
      assert.equal(texte('langue'), 'Choose…')
      assert.equal(grise('langue'), true)
    })
  })

  describe('4 · la règle de style', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'core-modules', 'select.mjs'), 'utf-8')

    it('la couleur se lit par var(--mjs-select-placeholder, <le texte de la liste à 62 %>)', () => {
      assert.match(source, /color: var\(--mjs-select-placeholder, color-mix\(in srgb, currentColor 62%, transparent\)\)/)
    })

    it('le module ne déclare jamais la variable : lue seulement, elle vient de l\'ancêtre, de <theme>, de :root ou de la balise', () => {
      assert.doesNotMatch(source, /^\s*--mjs-select-placeholder\s*:/m)
    })

    it(':host ne déclare aucune variable (une déclaration sur :host masque toute valeur héritée d\'un ancêtre)', () => {
      const style = source.slice(source.indexOf('<style'))
      const bloc  = style.match(/^ {2}:host\n((?: {4}.*\n)+)/m)
      assert.ok(bloc, 'le bloc :host est là')
      assert.doesNotMatch(bloc![1], /--mjs-/)
    })

    it('la règle vise le libellé grisé et l\'invite des deux champs internes (la recherche, la réponse libre)', () => {
      const avant     = source.slice(0, source.indexOf('color: var(--mjs-select-placeholder')).split('\n')
      const selecteur = avant[avant.length - 2]
      assert.match(selecteur, /\.select-label\.placeholder/)
      assert.match(selecteur, /\.select-search::placeholder/)
      assert.match(selecteur, /\.select-other-input::placeholder/)
    })

    for (const env of ['dev', 'prod'] as const) {
      it(`le code construit (${env}) porte la lecture de la variable et les deux ::placeholder`, async () => {
        const code = await construire(env)
        assert.match(code, /--mjs-select-placeholder/)
        assert.match(code, /color-mix\(in srgb, ?currentColor 62%, ?transparent\)/)
        assert.match(code, /\.select-search::placeholder/)
        assert.match(code, /\.select-other-input::placeholder/)
        assert.doesNotMatch(code, /--mjs-select-placeholder ?:/)
      })
    }
  })
})
