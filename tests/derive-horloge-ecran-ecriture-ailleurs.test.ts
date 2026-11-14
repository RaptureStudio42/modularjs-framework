// Valeur dérivée à l'horloge montrée par l'écran : refaite à sa lecture après toute écriture du composant, elle est juste quand on
// la relit ; l'écran la suit aussi après une écriture faite par une autre variable (fonction rangée dans une `Map` ou un `Set`,
// accesseur, objet gelé, champ posé sur une `Map`, objet d'une `Map` ou d'un `Set` sans enveloppe), et après `µrefresh` puis une
// seconde écriture sans lui. Un composant dont les valeurs dérivées sont précises n'en paie rien. L'écriture elle-même : un calcul
// refait qui lève ne l'arrête pas (son erreur va au rendu), une `Date`, une `URL` ou une expression régulière ne font rien refaire,
// une écriture de champ reste servie champ par champ. happy-dom, développement et production, enveloppe et réglage `proxy: false` ;
// les trois moteurs : derive-horloge-ecran-ecriture-ailleurs-browser.test.ts.

import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { CAS, PAGE, SCENARIO, MODES, ECRITURES, SCENARIO_ECRITURES, construire, coutsVus, ecarts, frappesAttendues, frappesVues } from './helpers/horloge-ecran.js'

const PRECISE = `<script>
$o = {a: 1}
$v = [$o.a].join('')
@w1 = -> $o.a = 2
</script>
<p class="v">{$v}</p>
`

// valeur à l'horloge qui ne lit rien que MJS ne suive pas (une fonction de la page, une variable simple) : une écriture profonde sans
// rapport (une frappe dans un champ d'objet) ne la refait pas — une requête ou les lignes d'un `{for}` ne repartent pas à chaque frappe
const SANS_RAPPORT = `<script>
$id = 1
$form = {q: ''}
$label = window.formater($id)
@taper = (x) -> $form.q = x
</script>
<p class="v">{$label}</p><p class="q">{$form.q}</p>
`

async function jouer(code: string, scenario: string): Promise<any> {
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  try {
    window.eval(PAGE)
    window.eval(code)
    return JSON.parse(JSON.stringify(await window.eval(scenario)))
  }
  finally {
    await window.happyDOM.close()
  }
}

describe('valeur dérivée à l\'horloge : l\'écran suit la valeur relue après une écriture faite ailleurs (happy-dom)', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const mode of MODES) {
    describe(mode, function () {
      let construit: { code: string, sortie: string }, ecritures: any
      before(async () => { construit = await construire(mode, { ...ECRITURES, 'horloge-precise': PRECISE, 'horloge-sans-rapport': SANS_RAPPORT }) })
      const lesEcritures = async () => ecritures ??= await jouer(construit.code, SCENARIO_ECRITURES)

      // le cas du champ montré passe par la mise à jour fine, la boucle par la file des boucles : sinon ils ne prouvent rien
      if (mode === 'enveloppe développement') it('le champ montré a sa table fine, la boucle est enveloppée', () => {
        assert.match(construit.sortie, /_mjs_fine\s*=/)
        assert.match(construit.sortie, /µ\._mjs_lq\+\+/)
        assert.equal(CAS.length, 27)
      })

      it('écran = valeur relue après chaque écriture, µrefresh compris', async () => {
        assert.deepEqual(ecarts(await jouer(construit.code, SCENARIO)), [])
      })

      it('trois écritures profondes sans rapport ne refont pas une valeur qui ne lit rien de caché', async () => {
        const r = await jouer(construit.code, `(async () => {
          window.calculs = 0
          window.formater = (p) => { window.calculs += 1; return p + ' €' }
          const el = document.body.appendChild(document.createElement('mjs-horloge-sans-rapport'))
          const fin = Date.now() + 4000
          while (!el._shadow?.querySelector('.v') && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
          await new Promise((r) => setTimeout(r, 100))
          const avant = window.calculs
          for (const x of ['a', 'b', 'c']) el.taper(x)
          await new Promise((r) => setTimeout(r, 60))
          return { calculs: window.calculs - avant, q: el._shadow.querySelector('.q').textContent, v: el._shadow.querySelector('.v').textContent }
        })()`)
        assert.deepEqual(r, { calculs: 0, q: 'c', v: '1 €' })
      })

      // la valeur refaite après l'écriture lève : le gestionnaire va au bout, l'erreur passe par le rendu, comme quand l'écriture
      // ordinaire d'une variable qu'elle lit en toutes lettres la fait lever
      it('un calcul refait qui lève n\'arrête pas l\'écriture : son erreur va au rendu, comme pour une écriture ordinaire', async () => {
        const r = await lesEcritures(), o = r.leve['leve-ordinaire']
        assert.deepEqual({ err: o.err, apres: o.apres }, { err: null, apres: 1 })
        // production : le champ interne du composant tombé est renommé, la comparaison avec l'écriture ordinaire suffit
        if (!mode.endsWith('production')) assert.equal(o.crash, true)
        assert.deepEqual(r.leve['leve-cache'], o)
      })

      // une `Date`, une `URL`, une expression régulière : MJS suit leurs changements, ou ce sont des objets du navigateur qu'il ne suit
      // nulle part ; rien n'y cache la lecture d'un autre objet du composant — une frappe sans rapport ne refait pas la requête
      it('une Date, une URL, une expression régulière ne font pas refaire une valeur à l\'horloge à chaque frappe sans rapport', async () => {
        const r = await lesEcritures()
        for (const nom of ['date', 'url', 'regexp']) assert.deepEqual({ nom, ...r.frappe[nom] }, { nom, requetes: 0, ecranGarde: true, q: 'b' })
      })

      // un objet du navigateur au nom voisin d'une collection (`DOMStringMap`, `NamedNodeMap`) n'en est pas une. Sous l'enveloppe, une
      // `Map`, un `Set`, un `WeakSet` dont elle suit toutes les entrées ne font rien refaire ; restent à risque la collection qui range
      // une fonction, l'instance d'une classe, un objet gelé ou une collection qui en range, celle qui porte un champ, la sous-classe, la
      // collection brute (`µraw`), la `WeakMap` (elle ne se parcourt pas), et toute collection avec le réglage `proxy: false`. happy-dom :
      // `dataset` et `attributes` y sont des objets de happy-dom, pas ceux d'un navigateur — vérifiés dans les trois moteurs
      it('une collection dont l\'enveloppe suit toutes les entrées ne fait pas refaire une valeur à l\'horloge à chaque frappe sans rapport', async () => {
        const r = await lesEcritures(), vu = frappesVues(r), attendu = frappesAttendues(mode)
        for (const nom of ['dataset', 'attributs']) { delete vu[nom]; delete attendu[nom] }
        assert.deepEqual(vu, attendu)
      })

      // le chemin fin n'est pas refusé au composant qui montre une valeur à l'horloge : comme sans elle, une ligne relue sur 50, une
      // liaison sur 5 ; la valeur qui lit la ligne écrite (accesseur d'une classe) se redessine. `"derived": "clock"` : la table fine
      // n'est pas posée pour ces composants (le compilateur), rien à comparer ; production : les champs internes comptés sont renommés,
      // l'écran seul se compare
      it('une écriture de champ reste servie champ par champ à côté d\'une valeur à l\'horloge : une ligne sur 50, une liaison sur 5', async function () {
        if (mode.startsWith('horloge')) return this.skip()
        const r = await lesEcritures(), { vu, attendu } = coutsVus(r, !mode.endsWith('production'))
        assert.deepEqual(vu, attendu)
        assert.equal(r.cout['fin-lue'].ecran, r.cout['fin-lue'].lu)
        assert.match(r.cout['fin-lue'].ecran, /l2xl4/)
      })

      // le coût : rien sur un composant dont les valeurs dérivées sont précises (l'enveloppe les garde précises ; sans elle, une
      // valeur qui lit un objet passe à l'horloge)
      if (mode === 'enveloppe développement') it('un composant aux valeurs précises garde la notification du prototype', async () => {
        const r = await jouer(construit.code, `(async () => {
          const el = document.body.appendChild(document.createElement('mjs-horloge-precise'))
          const fin = Date.now() + 4000
          while (!el._shadow?.querySelector('.v') && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
          el.w1()
          await new Promise((r) => setTimeout(r, 60))
          return { ecran: el._shadow.querySelector('.v').textContent, propre: Object.prototype.hasOwnProperty.call(el, '_mjs_notifyMutationAliased'), precise: Array.isArray(el._mjs_computeds.v._mjs_src) }
        })()`)
        assert.deepEqual(r, { ecran: '2', propre: false, precise: true })
      })
    })
  }
})
