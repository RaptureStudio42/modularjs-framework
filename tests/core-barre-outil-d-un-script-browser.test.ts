// Barre d'outils de l'éditeur riche du cœur (<@@toolbar>), dans Chromium, Firefox et WebKit réels, en construction de développement ET de production :
// un outil qu'aucune barre des pages ne nomme n'est pas envoyé (la construction l'ôte, en développement comme en production), et un script qui le
// donne ensuite à une barre ne l'a pas.
// - développement : un avertissement le dit, une fois par outil, au vouvoiement, dans la langue de la page (français, anglais), par le `toolbar`
//   d'un éditeur comme par le `tools` d'une barre seule ; il ne dit pas que l'outil n'existe pas ;
// - un nom qui n'est pas un outil (une faute de frappe) garde son message : l'outil n'existe pas, suivi de la liste des outils connus ;
// - production : les mêmes gestes ne disent rien, et le texte de l'avertissement n'est dans aucun fichier envoyé.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { BUILDS, MOTEURS, construire, ouvrir, type Page, type Session } from './helpers/editeur-riche.js'

// les barres de la page : celle de chaque éditeur, et une barre seule ; aucune ne nomme link, check, undo ni redo
const AIDES_BARRE = `
window.__H = () => document.querySelector('mjs-hote')._shadow
window.__el = (c) => __H().querySelector('.' + c)
window.__barre = (c) => { const e = __el(c); return e.localName === 'mjs-core-toolbar' ? e : e._shadow.querySelector('mjs-core-toolbar') }
window.__outils = (c) => [...__barre(c)._shadow.querySelectorAll('button')].map((b) => b.dataset.tool)
`

const PAGE: Page = {
  cle:     'barre-outil-script',
  attente: `(() => {
  const h = document.querySelector('mjs-hote')
  const r = h && h._shadow
  const barre = (e) => e && (e.localName === 'mjs-core-toolbar' ? e : e._shadow && e._shadow.querySelector('mjs-core-toolbar'))
  const pret = (c) => { const b = barre(r && r.querySelector('.' + c)); return !!(b && b._shadow && b._shadow.querySelector('button')) }
  return ['e1', 'e2', 't1'].every(pret)
})()`,
  aides:   AIDES_BARRE,
  source:  `<script>
  $a = '<p>Un</p>'
  $b = '<p>Deux</p>'
</script>

<@@editor class="e1" name="a" toolbar="bold italic" value=!{$a}></@@editor>
<@@editor class="e2" name="b" toolbar="bold" value=!{$b}></@@editor>
<@@toolbar class="t1" tools="bold"></@@toolbar>
`,
}

const AVIS_FR  = (n: string) => `[ModularJS] <@@toolbar> : une barre reçoit l'outil « ${n} » d'un script, mais aucune page de l'application n'écrit cet outil — il n'est pas envoyé, ni en développement ni en production. Écrivez « ${n} » dans la liste d'outils d'une barre de votre page (l'attribut toolbar d'un éditeur, ou tools d'une barre) plutôt que de le poser par un script.`
const AVIS_EN  = (n: string) => `[ModularJS] <@@toolbar>: a toolbar gets the tool "${n}" from a script, but no page of the application writes that tool — it is not shipped, neither in development nor in production. Write "${n}" in the tool list of a toolbar in your page (the toolbar attribute of an editor, or tools of a toolbar) instead of setting it from a script.`
const INCONNU  = (n: string) => `[ModularJS] <@@toolbar> : l'outil « ${n} » n'existe pas, il est ignoré — outils connus : h2 h3 quote bold italic underline strike color ul ol check link undo redo clear.`
const TEXTES   = ['une barre reçoit l\'outil', 'a toolbar gets the tool', 'toolbarToolScript']

for (const build of BUILDS) for (const nom of MOTEURS) describe(`barre d'outils : un outil qu'un script donne et qu'aucune page ne nomme (${build}, ${nom} réel)`, function () {
  this.timeout(120000)
  let s: Session | null = null
  const dits: string[] = []

  const E      = (expr: string): Promise<any> => s!.page.evaluate(expr)
  const poser  = async (c: string, attr: string, v: string) => {
    await E(`__el(${JSON.stringify(c)}).setAttribute(${JSON.stringify(attr)}, ${JSON.stringify(v)})`)
    await s!.page.waitForTimeout(300)
  }
  const outils = (c: string): Promise<string[]> => E(`__outils(${JSON.stringify(c)})`)

  before(async () => {
    s = await ouvrir(nom, build, PAGE)
    // le texte entier de chaque message (la session n'en garde que le début)
    s?.page.on('console', (m: any) => { if (['error', 'warning'].includes(m.type())) dits.push(m.text()) })
  })

  after(async () => {
    if (s) await s.fermer()
    await terminateSharedWorkerPool()
  })

  beforeEach(function () {
    if (!s) this.skip()
  })

  it('au départ : la console est vide, chaque barre n\'a que les outils que la page nomme', async () => {
    assert.deepEqual(s!.logs, [])
    assert.deepEqual(await outils('e1'), ['bold', 'italic'])
    assert.deepEqual(await outils('e2'), ['bold'])
    assert.deepEqual(await outils('t1'), ['bold'])
  })

  if (build === 'dev') {
    it('un script donne link au toolbar d\'un éditeur : pas de bouton, un avertissement au vouvoiement, qui ne dit pas que l\'outil n\'existe pas', async () => {
      await poser('e1', 'toolbar', 'bold link')
      assert.deepEqual(await outils('e1'), ['bold'])
      assert.deepEqual(dits, [AVIS_FR('link')])
    })

    it('le même outil donné à un second éditeur : rien de plus, l\'avertissement part une fois par outil', async () => {
      await poser('e2', 'toolbar', 'link bold')
      assert.deepEqual(await outils('e2'), ['bold'])
      assert.deepEqual(dits, [AVIS_FR('link')])
    })

    it('un script donne check au tools d\'une barre seule : un avertissement pour check', async () => {
      await poser('t1', 'tools', 'bold check')
      assert.deepEqual(await outils('t1'), ['bold'])
      assert.deepEqual(dits.slice(1), [AVIS_FR('check')])
    })

    it('une faute de frappe garde son message : l\'outil n\'existe pas, et la liste des outils connus', async () => {
      await poser('e2', 'toolbar', 'bold lien')
      assert.deepEqual(await outils('e2'), ['bold'])
      assert.deepEqual(dits.slice(2), [INCONNU('lien')])
    })

    it('page en anglais : l\'avertissement sort en anglais', async () => {
      await E('document.documentElement.lang = \'en\'')
      await poser('e1', 'toolbar', 'bold undo')
      assert.deepEqual(await outils('e1'), ['bold'])
      assert.deepEqual(dits.slice(3), [AVIS_EN('undo')])
    })
  }
  else {
    it('les mêmes gestes ne disent rien', async () => {
      await poser('e1', 'toolbar', 'bold link')
      await poser('e2', 'toolbar', 'bold lien')
      await poser('t1', 'tools', 'bold check')
      await E('document.documentElement.lang = \'en\'')
      await poser('e2', 'toolbar', 'bold undo')
      assert.deepEqual(await outils('e1'), ['bold'])
      assert.deepEqual(await outils('t1'), ['bold'])
      assert.deepEqual(dits, [])
      assert.deepEqual(s!.logs, [])
    })

    it('aucun fichier envoyé ne porte le texte ni la clé de l\'avertissement', async () => {
      const fait = await construire('prod', PAGE.source, PAGE.cle)
      const vus: string[] = []
      for (const [f, contenu] of fait.fichiers) for (const t of TEXTES) if (contenu.toString('utf-8').includes(t)) vus.push(`${f} : ${t}`)
      assert.deepEqual(vus, [])
    })
  }
})
