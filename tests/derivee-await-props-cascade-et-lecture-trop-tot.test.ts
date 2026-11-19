// une valeur dérivée qui attend s'affiche tout de suite et vaut undefined jusqu'à sa première réponse. Son premier appel part une
// fois les props du composant reçues (`$fiche = await charger($id)` ne demande jamais `fiche-undefined`) ; une valeur qui attend et
// cite une autre valeur qui attend (`$b = await g($a)`) n'appelle qu'à l'arrivée de celle-ci, et ne se refait que quand ce qu'elle
// cite change ; une lecture faite trop tôt (`{$resultats.length}`, `$nb = $resultats.length`, un µeffect) ne tue pas le composant :
// en développement un message dit quoi écrire, et l'écran se fait à la réponse.
// Méthode : le vrai Bundler (développement), happy-dom, un faux `fetch` qui ne répond que sur ordre du test

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monter, demandes, repondre, ecran, texte, pause } from './helpers/derivee-await-banc.js'

const PORTE = `<script>
  $id      = 1
  @suivant = -> $id++
</script>
<@fiche class="p" id={$id}></@fiche>
<@fiche class="fixe" id={7}></@fiche>
`
const FICHE = `<script>
  charger = (id) -> fetch("/api/fiche-#{id}").then((r) -> r.json())
  $fiche  = await charger($id)
</script>
<i>{$fiche and $fiche.nom}</i>
`
const CASCADE = `<script>
  $q        = 'x'
  $autre    = 0
  $terme    = $q.trim()
  f         = (q) -> fetch("/api/a-#{q}").then((r) -> r.json())
  g         = (a) -> fetch("/api/b-#{a and a.v}").then((r) -> r.json())
  $a        = await f($terme)
  $b        = await g($a)
  @chercher = (q) -> $q = q
  @toucher  = -> $autre++
</script>
<i>{$a and $a.v}|{$b and $b.v}|{µpending($b)}</i>
`
const RECHERCHE = 'rechercher = (q) -> fetch("/api/s-#{q}").then((r) -> r.json())'
const TROP_TOT: Record<string, string> = {
  'nu-gabarit.mjs': `<script>\n  $q = ''\n  ${RECHERCHE}\n  $resultats = await rechercher($q)\n</script>\n<p class="a">avant</p><i class="n">{$resultats.length}</i>\n`,
  'nu-derivee.mjs': `<script>\n  $q = ''\n  ${RECHERCHE}\n  $resultats = await rechercher($q)\n  $nb = $resultats.length\n</script>\n<p class="a">avant</p><i class="n">{$nb}</i>\n`,
  'nu-effet.mjs': `<script>\n  $q = ''\n  ${RECHERCHE}\n  $resultats = await rechercher($q)\n  $vu = -1\n  µeffect -> $vu = $resultats.length\n</script>\n<p class="a">avant</p><i class="n">{$vu}</i>\n`,
}

describe('dérivée qui attend — affichée tout de suite, appelée après les props, cascade, lecture trop tôt', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le premier appel part après les props : une demande par enfant, jamais « fiche-undefined »', async () => {
    const w  = await monter('await-props', { 'porte.mjs': PORTE, 'fiche.mjs': FICHE }, '<mjs-porte></mjs-porte>')
    const el = w.document.querySelector('mjs-porte')
    assert.deepEqual(demandes(w).sort(), ['/api/fiche-1', '/api/fiche-7'], 'une demande par enfant, avec sa prop')
    await repondre(w, '/api/fiche-1', { nom: 'Un' })
    await repondre(w, '/api/fiche-7', { nom: 'Sept' })
    assert.equal(ecran(el._shadow.querySelector('mjs-fiche.p')), '<i>Un</i>')
    assert.equal(ecran(el._shadow.querySelector('mjs-fiche.fixe')), '<i>Sept</i>')
    const n = w.__req.length
    el.suivant()
    await pause(80)
    assert.deepEqual(demandes(w, n), ['/api/fiche-2'], 'la prop change : une demande, la bonne')
    assert.deepEqual([...w.__avis], [], 'aucun avertissement')
    w.close()
  })

  it('cascade : $b attend l\'arrivée de $a, puis ne se refait que quand $a change', async () => {
    const w  = await monter('await-cascade', { 'cascade.mjs': CASCADE }, '<mjs-cascade></mjs-cascade>')
    const el = w.document.querySelector('mjs-cascade')
    assert.deepEqual(demandes(w), ['/api/a-x'], 'au départ, seule $a demande : jamais « b-undefined »')
    assert.equal(ecran(el), '<i>||true</i>', '$b est en attente')
    await repondre(w, '/api/a-x', { v: 1 })
    assert.deepEqual(demandes(w, 1), ['/api/b-1'], '$a arrivée : $b demande avec sa valeur')
    await repondre(w, '/api/b-1', { v: 10 })
    assert.equal(ecran(el), '<i>1|10|false</i>')
    el.toucher()
    await pause(60)
    assert.equal(w.__req.length, 2, 'une écriture sans rapport ne rappelle rien')
    el.chercher('y')
    await pause(60)
    assert.deepEqual(demandes(w, 2), ['/api/a-y'], '$q change : $a demande, $b attend la réponse de $a')
    await repondre(w, '/api/a-y', { v: 2 })
    assert.deepEqual(demandes(w, 3), ['/api/b-2'], 'la nouvelle valeur de $a : $b demande une fois')
    await repondre(w, '/api/b-2', { v: 20 })
    assert.equal(ecran(el), '<i>2|20|false</i>')
    assert.deepEqual([...w.__avis], [], 'aucun avertissement')
    w.close()
  })

  for (const nom of Object.keys(TROP_TOT)) {
    it('lecture trop tôt (' + nom + ') : le composant vit, un message dit quoi écrire, l\'écran se fait à la réponse', async () => {
      const balise = 'mjs-' + nom.replace('.mjs', '')
      const w      = await monter('await-trop-tot', TROP_TOT, '<' + balise + '></' + balise + '>')
      const el     = w.document.querySelector(balise)
      assert.ok(!el._shadow.querySelector('.mjs-fatal-error'), 'aucun « Fatal Error » — ' + ecran(el))
      assert.ok(!el._mjs_has_crashed, 'le composant n\'est pas mort')
      assert.deepEqual([...w.__erreurs], [], 'aucun plantage intercepté')
      assert.equal(w.__avis.length, 1, 'un message — ' + w.__avis.join(' | '))
      assert.match(w.__avis[0], /\$resultats/)
      assert.match(w.__avis[0], /\(\$resultats or \[\]\)\.length/)
      assert.match(w.__avis[0], /µpending\(\$resultats\)/)
      await repondre(w, '/api/s-', [{ id: 1 }, { id: 2 }])
      assert.equal(texte(el, '.a'), 'avant')
      assert.equal(texte(el, '.n'), '2', 'la réponse arrivée, l\'écran se fait — ' + ecran(el))
      assert.equal(w.__avis.length, 1, 'le message n\'est dit qu\'une fois')
      w.close()
    })
  }
  for (const attend of ['en vol', 'en échec'] as const) {
    it('une erreur de type sans rapport avec la valeur qui attend (' + attend + ') suit son chemin : le plantage est dit', async () => {
      const src = `<script>\n  $n = 0\n  $q = ''\n  ${RECHERCHE}\n  $resultats = await rechercher($q)\n  µeffect -> window.__rien.boum if $n > 0\n  @casser = -> $n++\n</script>\n<i class="n">{$n}</i>\n`
      const w   = await monter('await-sans-rapport', { 'casse.mjs': src }, '<mjs-casse></mjs-casse>')
      const el  = w.document.querySelector('mjs-casse')
      if (attend === 'en échec') await repondre(w, '/api/s-', 'panne', true)
      el.casser()
      await pause(120)
      assert.equal([...w.__erreurs].filter((x: string) => /Crash intercepted/.test(x)).length, 1, 'le plantage est dit — ' + [...w.__erreurs].join(' | '))
      assert.ok(![...w.__avis].some((a: string) => /première réponse/.test(a)), 'aucun message sur $resultats — ' + [...w.__avis].join(' | '))
      w.close()
    })
  }

  it('après l\'échec de la première demande, la lecture trop tôt ne plante toujours pas et l\'erreur se lit ; une erreur sans rapport, si', async () => {
    const src = `<script>\n  $n = 0\n  $q = ''\n  ${RECHERCHE}\n  $resultats = await rechercher($q)\n  verif = (n) -> (if n > 0 then window.__rien.boum else n)\n  @inc = -> $n++\n  µfailed (err, reset)->\n    "<p class='repli'>repli</p>"\n</script>\n<b class="err">{µfailed($resultats)?.message}</b><i class="n">{$resultats.length}</i><s>{verif($n)}</s>\n`
    const w  = await monter('await-echec-frontiere', { 'front.mjs': src }, '<mjs-front></mjs-front>')
    const el = w.document.querySelector('mjs-front')
    await repondre(w, '/api/s-', 'panne', true)
    assert.ok(!el._shadow.querySelector('.repli') && !el._shadow.querySelector('.mjs-fatal-error'), 'la lecture trop tôt ne plante pas — ' + ecran(el))
    assert.equal(texte(el, '.err'), 'panne', 'l\'erreur de la première demande se lit')
    el.inc()
    await pause(120)
    assert.ok(!!el._shadow.querySelector('.repli'), 'une erreur sans rapport suit son chemin : la frontière la prend — ' + ecran(el))
    w.close()
  })
  // décomposition, boucle, compréhension et étalement : des lectures directes, protégées comme `$r.length`
  const TROUS  = "$q = ''\n  f = (q) -> fetch('/api/t-' + q).then((r) -> r.json())\n  double = (v) -> v * 2\n  $r = await f($q)"
  const FORMES: Record<string, [string, string, string]> = {
    'gabarit': [`<script>\n  ${TROUS}\n</script>\n<i class="v">{[...$r].join(',')}</i>\n`, '', '1,2'],
    'derivee': [`<script>\n  ${TROUS}\n  $vu = [...(v for v in $r), ...(v for v in $r.map(double))].join(',')\n</script>\n<i class="v">{$vu}</i>\n`, '', '1,2,2,4'],
    'effet': [`<script>\n  ${TROUS}\n  $vu = ''\n  µeffect ->\n    {length} = $r\n    $vu = [...$r, ...(v for v in $r.map(double))].join(',') + ':' + (if length then 'oui' else 'non')\n</script>\n<i class="v">{$vu}</i>\n`, ':non', '1,2,2,4:oui'],
    'methode': [`<script>\n  ${TROUS}\n  @lire = ->\n    {length} = $r\n    [...$r, ...(v for v in $r), ...(v for v in $r.map(double))].join(',') + ':' + (if length then 'oui' else 'non')\n</script>\n<i class="v">{($r or []).length}</i>\n`, ':non', '1,2,1,2,2,4:oui'],
  }
  for (const [lieu, [src, avant, apres]] of Object.entries(FORMES)) {
    it('décomposition, boucle et étalement avant la réponse (' + lieu + ') : le composant vit, la valeur se lit vide, puis juste', async () => {
      const tag = 'trou-' + lieu
      const w   = await monter('await-trou-' + lieu, { [tag + '.mjs']: src }, '<mjs-' + tag + '></mjs-' + tag + '>')
      const el  = w.document.querySelector('mjs-' + tag)
      const lu  = () => lieu === 'methode' ? el.lire() : texte(el, '.v')
      assert.ok(!el._shadow.querySelector('.mjs-fatal-error'), 'aucun « Fatal Error » — ' + ecran(el))
      assert.equal(lu(), avant, 'avant la réponse')
      await repondre(w, '/api/t-', [1, 2])
      assert.equal(lu(), apres, 'après la réponse')
      assert.deepEqual([...w.__erreurs], [], 'aucun plantage intercepté')
      w.close()
    })
  }
})
