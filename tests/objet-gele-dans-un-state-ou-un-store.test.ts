// Un objet gelé (`Object.freeze`) rangé dans un `µ.state` ou un `µ.Store` se lit tel quel, comme dans l'état d'un
// composant : JavaScript exige qu'une propriété figée — propre, ni modifiable ni configurable — rende sa propre valeur
// à une lecture par un Proxy. Défaut garanti absent : lire un sous-objet d'un objet gelé rangé dans un `µ.state` ou un
// `µ.Store` levait « 'get' on proxy: property … is a read-only and non-configurable data property ». Même règle pour
// la propriété figée d'un objet scellé ou fermé aux ajouts. La garde ne coûte rien à la lecture d'un champ simple :
// elle n'est faite que quand la valeur lue est un objet ou une fonction.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const GEL = `<script lang="js">
  $p = {n: 1, s: 'x'};
  $q = null;
  $s = null;
  @etat = function() {
    const st = µ.state({g: Object.freeze({inner: {a: 1}, list: [{n: 2}], f() { return 3; }})});
    return st.g.inner.a + st.g.list[0].n + st.g.f();
  };
  @etatListe = function() {
    const st = µ.state({l: Object.freeze([Object.freeze({n: 4})])});
    return st.l[0].n;
  };
  @magasin = function() {
    const s = new µ.Store({g: Object.freeze({inner: {a: 5}, f() { return 1; }})});
    return s.data.g.inner.a + s.data.g.f();
  };
  @ferme = function() {
    $q = Object.preventExtensions(Object.create(null, {cfg: {value: {v: 7}}}));
    return $q.cfg.v;
  };
  @scelle = function() {
    const o = Object.seal({meta: {v: 1}, n: 2});
    Object.defineProperty(o, 'meta', {writable: false});
    $s = o;
    return $s.meta.v + $s.n;
  };
  @compter = function(e) {
    const f = Object.isExtensible;
    let n = 0, t = 0;
    Object.isExtensible = function(o) { n++; return f(o); };
    try {
      for (let i = 0; i < 100; i++) t += e.n + e.s.length;
    }
    finally {
      Object.isExtensible = f;
    }
    return [n, t];
  };
</script>
<p>{$p.n}</p>
`

describe('objet gelé — lu tel quel dans un µ.state et un µ.Store, garde payée seulement par un objet lu', function () {
  this.timeout(60000)
  let app: any

  before(async () => {
    const root = mjsTmp('gele-state-store')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'tst-ogs-gel.mjs'), GEL)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
    app = await createHarness({ root })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('µ.state : un objet gelé et une liste gelée se lisent, sous-objets et méthodes compris', async () => {
    const c = await app.mount('tst-ogs-gel')
    try {
      assert.equal(c.el.etat(), 6)
      assert.equal(c.el.etatListe(), 4)
    }
    finally {
      c.destroy()
    }
  })

  it('µ.Store : un objet gelé se lit, sous-objet et méthode compris', async () => {
    const c = await app.mount('tst-ogs-gel')
    try {
      assert.equal(c.el.magasin(), 6)
    }
    finally {
      c.destroy()
    }
  })

  it('propriété figée d\'un objet fermé aux ajouts ou scellé : lue telle quelle', async () => {
    const c = await app.mount('tst-ogs-gel')
    try {
      assert.equal(c.el.ferme(), 7)
      assert.equal(c.el.scelle(), 3)
    }
    finally {
      c.destroy()
    }
  })

  it('la lecture d\'un champ simple par l\'enveloppe ne paie pas la garde', async () => {
    const c = await app.mount('tst-ogs-gel')
    try {
      const [n, t] = c.el.compter(c.el._state.p)
      assert.equal(t, 200)
      assert.equal(n, 0, 'tests de la garde : ' + n)
    }
    finally {
      c.destroy()
    }
  })
})
