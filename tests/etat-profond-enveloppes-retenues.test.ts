// lectures et écritures profondes de l'état d'un composant dans une boucle chaude. Une enveloppe garde la même cible
// toute sa vie : relire `$o.a.b.c` rend les enveloppes déjà faites, sans repasser par le carnet du composant à chaque
// niveau ; écrire `$o.a.b.c = i` ou `$l.push(i)` ne déballe la racine qu'une fois par tour. Et rien ne change pour les
// lieux d'un même objet : un objet atteint par deux variables, rangé dans deux listes, ou dont la variable change de
// valeur dans le tour, est écrit et redessiné partout comme avant ; un objet marqué µraw après coup se rend brut

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, attendre } from './helpers/coeur-monter.js'

const HOTE = `<script lang="js">
  $o = {a: {b: {c: 0}}};
  $p = null;
  $l = [];
  $x = {n: 1};
  $r = {k: {v: 1}};
  $la = [];
  $lb = [];
  @lire = function(n) { let s = 0; for (let i = 0; i < n; i++) { s += $o.a.b.c; } return s; };
  @ecrire = function(n) { for (let i = 0; i < n; i++) { $o.a.b.c = i; } };
  @pousser = function(n) { for (let i = 0; i < n; i++) { $l.push(i); } };
  @lierP = function() { $p = $o; };
  @regler = function(f) { f($o.a); };
  @remplacer = function() { $x.n = 2; const avant = $x; $x = {n: 10}; $x.n = 11; return avant; };
  @lireR = function() { return $r.k; };
  @poserListes = function(obj) { $la = [obj]; $lb = [obj]; };
  @ecrireLa = function(v) { $la[0].label = v; };
</script>
<p class="c">{$o.a.b.c}</p><p class="p">{$p ? $p.a.b.c : '-'}</p><p class="x">{$x.n}</p><p class="l">{$l.length}</p>
<ul class="la">{for it in $la}<li>{it.label}</li>{end}</ul><ul class="lb">{for it in $lb}<li>{it.label}</li>{end}</ul>
`

describe('état profond : enveloppes retenues en lecture et en écriture, lieux d\'un même objet inchangés', function () {
  this.timeout(60000)

  let window: any, hote: any, erreurs: string[]
  const texte = (sel: string) => hote._shadow.querySelector(sel).textContent
  const textes = (sel: string) => Array.from(hote._shadow.querySelectorAll(sel)).map((n: any) => n.textContent).join(',')

  before(async () => {
    ({ window, hote, erreurs } = await monterHote(HOTE, 'etat-profond-retenu'))
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('1 000 lectures de $o.a.b.c dans une boucle n\'enveloppent plus chaque niveau à chaque lecture', () => {
    const proto = window.µ.Element.prototype
    const avant = proto._mjs_wrapDeep
    let appels = 0
    proto._mjs_wrapDeep = function(...a: any[]) { appels++; return avant.apply(this, a) }
    try {
      assert.equal(hote.lire(1000), 0)
    }
    finally {
      proto._mjs_wrapDeep = avant
    }
    assert.ok(appels <= 2, `enveloppes demandées pendant 1 000 lectures : ${appels}`)
  })

  it('1 000 écritures $o.a.b.c = i, puis 1 000 $l.push(i), ne déballent la racine qu\'une fois par boucle', async () => {
    const µ = window.µ
    const avant = µ._mjs_toRaw
    let ecriture = 0, ajout = 0, compte = 0
    // seuls comptent les déballages de la racine écrite : la vue redessinée pendant la boucle relit ses objets par leurs
    // enveloppes, une fois par conteneur et par tour, ce qui ne déballe pas la racine
    let racine: any = null
    µ._mjs_toRaw = function(o: any) { if (o === racine) compte++; return avant(o) }
    try {
      racine = hote._state.o
      hote.ecrire(1000)
      ecriture = compte
      await attendre(() => texte('.c') === '999')
      compte = 0
      racine = hote._state.l
      hote.pousser(1000)
      ajout = compte
    }
    finally {
      µ._mjs_toRaw = avant
    }
    assert.ok(ecriture <= 2, `déballages pendant 1 000 écritures : ${ecriture}`)
    assert.ok(ajout <= 2, `déballages pendant 1 000 ajouts : ${ajout}`)
    await attendre(() => texte('.l') === '1000')
    assert.equal(texte('.c'), '999')
    assert.equal(texte('.l'), '1000')
    assert.equal(hote._state.l.length, 1000)
  })

  it('un sous-objet relu après qu\'une seconde variable a reçu son conteneur prévient les deux variables', async () => {
    hote.lierP()
    await attendre(() => texte('.p') === '999')
    assert.equal(texte('.p'), '999')
    // écriture par une enveloppe échappée (fonction reçue) : toutes les variables qui atteignent l'objet sont prévenues
    hote.regler((a: any) => { a.b.c = 7 })
    await attendre(() => texte('.c') === '7' && texte('.p') === '7')
    assert.equal(texte('.c'), '7')
    assert.equal(texte('.p'), '7')
    // écriture compilée en boucle : idem
    hote.ecrire(5)
    await attendre(() => texte('.c') === '4' && texte('.p') === '4')
    assert.equal(texte('.c'), '4')
    assert.equal(texte('.p'), '4')
  })

  it('la variable qui change de valeur dans le tour : l\'écriture suivante va au nouvel objet', async () => {
    const µ = window.µ
    const ancien = µ._mjs_toRaw(hote.remplacer())
    assert.equal(ancien.n, 2)
    assert.equal(µ._mjs_toRaw(hote._state.x).n, 11)
    assert.ok(µ._mjs_toRaw(hote._state.x) !== ancien, 'la variable tient un nouvel objet')
    await attendre(() => texte('.x') === '11')
    assert.equal(texte('.x'), '11')
  })

  it('un objet rangé dans deux listes, écrit par l\'une, est redessiné dans les deux', async () => {
    hote.poserListes({ label: 'a' })
    await attendre(() => textes('.la li') === 'a' && textes('.lb li') === 'a')
    assert.equal(textes('.la li') + '|' + textes('.lb li'), 'a|a')
    hote.ecrireLa('z')
    await attendre(() => textes('.la li') === 'z' && textes('.lb li') === 'z')
    assert.equal(textes('.la li') + '|' + textes('.lb li'), 'z|z')
  })

  it('un sous-objet marqué µraw après sa première lecture se rend brut', () => {
    const µ = window.µ
    const env = hote.lireR()
    const brut = µ._mjs_toRaw(env)
    assert.ok(env !== brut, 'enveloppé avant la marque')
    assert.ok(hote.lireR() === env, 'même enveloppe à la relecture')
    µ._mjs_rawSet.add(brut)
    assert.ok(hote.lireR() === brut, 'rendu brut après la marque')
    assert.equal(erreurs.length, 0, erreurs.join('\n'))
  })
})
