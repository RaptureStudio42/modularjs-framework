// une minuterie rangée en dernière ligne d'un reffet n'est pas son nettoyage : les deux endroits qui comptaient sur l'annulation rangent leur main
// d'arrêt et la rendent (`couper = µafter …` puis `-> couper()`), vérifié dans Chromium, Firefox et WebKit réels, en construction de développement
// et de production :
// - l'éditeur riche du cœur n'émet `mjs-editor-state` qu'une fois pour une rafale de bascules de son mode d'édition (lecture seule posée puis ôtée,
//   un passage du reffet par bascule) ;
// - le message qui s'efface tout seul, tel que l'écrit `docs/03-reactivite.md` (délai ramené de 3000 à 300 ms) : un second message posé avant la fin
//   du délai du premier reste affiché son délai entier, la minuterie du premier ne l'efface pas

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { AIDES, BUILDS, MOTEURS, ouvrir, type Page, type Session } from './helpers/editeur-riche.js'

// l'exemple du message qui s'efface, pris tel quel dans la documentation (corps de son `<script>`)
const DOC     = readFileSync(new URL('../docs/03-reactivite.md', import.meta.url), 'utf-8')
const BLOC    = DOC.split('```html').map((b) => b.split('```')[0]).find((b) => b.includes('if $$toast')) ?? ''
const EXEMPLE = BLOC.split('\n').filter((l) => l.startsWith('  ')).join('\n')
const RAPIDE  = EXEMPLE.replace('µafter 3000,', 'µafter 300,')

const PAGE: Page = {
  cle:     'minuteries-nettoyage-explicite',
  attente: `(() => {
  const h = document.querySelector('mjs-hote')
  const e = h && h._shadow && h._shadow.querySelector('.g')
  return !!(e && e._shadow && e._shadow.querySelector('.surface'))
})()`,
  aides:   AIDES,
  source:  `<script>
  µmount ->
    window.__toast = (v)-> $$toast = v

${RAPIDE}
</script>

<@@editor class="g" name="g" toolbar="bold"></@@editor>
<p class="p">{$$toast}</p>
`,
}

for (const build of BUILDS) for (const nom of MOTEURS) describe(`minuteries en dernière ligne d'un reffet, nettoyage écrit (${build}, ${nom} réel)`, function () {
  this.timeout(240000)
  let s: Session | null = null

  const E = (expr: string): Promise<any> => s!.page.evaluate(expr)

  before(async function () {
    s = await ouvrir(nom, build, PAGE)
    if (!s) this.skip()
  })

  after(async () => {
    const logs = s ? s.logs : []
    if (s) await s.fermer()
    s = null
    await terminateSharedWorkerPool()
    assert.deepEqual(logs, [], 'la console reste vide')
  })

  it('l\'exemple de la documentation est trouvé, délai ramené à 300 ms', () => {
    assert.ok(RAPIDE.includes('if $$toast') && RAPIDE.includes('µafter 300,'), 'exemple trouvé dans docs/03-reactivite.md')
  })

  it('l\'éditeur du cœur n\'émet son état qu\'une fois pour une rafale de bascules de la lecture seule', async () => {
    const n = await E(`(async () => {
      const ed = __ed('g')
      await new Promise((ok) => setTimeout(ok, 100))
      let n = 0
      ed.addEventListener('mjs-editor-state', () => n++)
      for (let i = 0; i < 4; i++) {
        ed.toggleAttribute('readonly')
        for (let k = 0; k < 5; k++) await Promise.resolve()
      }
      await new Promise((ok) => setTimeout(ok, 100))
      return n
    })()`)
    assert.equal(n, 1, 'un seul mjs-editor-state pour quatre bascules')
  })

  it('le message qui s\'efface : un second message posé avant la fin du délai du premier garde son délai entier', async () => {
    const r = await E(`(async () => {
      const texte = () => __H().querySelector('.p').textContent
      const dort  = (ms) => new Promise((ok) => setTimeout(ok, ms))
      window.__toast('un')
      await dort(150)
      window.__toast('deux')
      await dort(200)
      const milieu = texte()
      await dort(300)
      return { milieu, fin: texte() }
    })()`)
    assert.deepEqual(r, { milieu: 'deux', fin: '' }, 'le second message reste affiché après la fin du délai du premier, puis s\'efface')
  })
})
