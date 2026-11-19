// Une liste de l'état donnée à une fonction qui la change (`pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`, `copyWithin`,
// `push`, `length = 1`) : l'écran suit, le composant ne tombe pas, la méthode rend ce que rend JavaScript. Défaut garanti absent : avec
// `push` l'écran suivait, avec `pop` le composant tombait (erreur « Cannot read properties of undefined ») — la liste était redessinée au
// milieu de l'écriture faite par la méthode, élément déjà retiré et longueur pas encore réduite. Même scène depuis un gestionnaire du
// composant (`@click` qui passe `$rows` à une fonction), pour une liste rangée dans un objet (`$o.liste`), pour une liste tenue par un
// enfant (prop) et pour une liste d'un état partagé (`µ.state`) ; en développement, en production, et avec `"proxy": false` (là, la donnée
// change et l'écran suit après `µrefresh`)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { createHarness } from '../src/testing/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const HOTE = `<script lang="js">
  function oter(l) { l.pop(); }
  const st = µ.state({rows: [{id: 1, label: 'a'}, {id: 2, label: 'b'}, {id: 3, label: 'c'}, {id: 4, label: 'd'}]});
  $rows = [{id: 1, label: 'a'}, {id: 2, label: 'b'}, {id: 3, label: 'c'}, {id: 4, label: 'd'}];
  $o    = {liste: [{id: 1, label: 'a'}, {id: 2, label: 'b'}, {id: 3, label: 'c'}, {id: 4, label: 'd'}]};
  @muter      = function(f) { return f($rows); };
  @muterO     = function(f) { return f($o.liste); };
  @muterS     = function(f) { return f(st.rows); };
  @rafraichir = function() { µrefresh($rows); µrefresh($o); };
  @clic       = function() { oter($rows); };
</script>
<ul class="k">{for r in $rows by id}<li>{r.label}</li>{end}</ul>
<ul class="u">{for r in $rows}<li>{r.label}</li>{end}</ul>
<p class="n">{$rows.length}</p>
<ul class="o">{for r in $o.liste}<li>{r.label}</li>{end}</ul>
<ul class="s">{for r in st.rows}<li>{r.label}</li>{end}</ul>
<button @click=@clic>x</button>
<@tst-lcf-enfant rows={$rows}></@tst-lcf-enfant>
`

const ENFANT = `<script lang="js">
  $rows = [];
</script>
<ul class="e">{for r in $rows}<li>{r.label}</li>{end}</ul>
`

// geste, ce que la méthode doit rendre (lu par la 3e colonne), écran attendu, liste à clé comparée (copyWithin y met deux fois la même clé)
const GESTES: [string, (x: any[]) => any, (r: any, x: any[]) => any, any, string, boolean][] = [
  ['pop', (x) => x.pop(), (r) => r.label, 'd', 'a b c', true],
  ['shift', (x) => x.shift(), (r) => r.label, 'a', 'b c d', true],
  ['unshift', (x) => x.unshift({id: 0, label: 'z'}), (r) => r, 5, 'z a b c d', true],
  ['push', (x) => x.push({id: 5, label: 'e'}), (r) => r, 5, 'a b c d e', true],
  ['splice', (x) => x.splice(1, 2), (r) => r.map((e: any) => e.label).join(' '), 'b c', 'a d', true],
  ['sort', (x) => x.sort((p: any, s: any) => s.id - p.id), (r, x) => r === x, true, 'd c b a', true],
  ['reverse', (x) => x.reverse(), (r, x) => r === x, true, 'd c b a', true],
  ['fill', (x) => x.fill({id: 9, label: 'z'}, 3), (r, x) => r === x, true, 'a b c z', true],
  ['copyWithin', (x) => x.copyWithin(3, 0, 1), (r, x) => r === x, true, 'a b c a', false],
  ['length = 1', (x) => { x.length = 1 }, (r) => r, undefined, 'a', true]
]

const MODES = ['développement', 'production', 'proxy: false']

const SOURCES = (root: string, reglage: any) => {
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'tst-lcf-hote.mjs'), HOTE)
  writeFileSync(join(root, 'src', 'tst-lcf-enfant.mjs'), ENFANT)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', ...reglage }))
}

// production : construite comme une appli publiée (un paquet), jouée dans une fenêtre neuve
async function production(ecrire = (r: string) => SOURCES(r, {}), pret = (el: any) => { const e = (el._shadow ?? el).querySelector('mjs-tst-lcf-enfant'); return e && (e._shadow ?? e).querySelector('ul.e > li') }): Promise<any> {
  const root = mjsTmp('liste-changee-par-une-fonction-prod'), srcDir = join(root, 'src'), outDir = join(root, 'out')
  ecrire(root)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [], 'la construction passe')
  const code = readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(code)
  return {
    window,
    mount: async (tag: string) => {
      window.document.body.innerHTML = `<mjs-${tag}></mjs-${tag}>`
      const el   = window.document.querySelector(`mjs-${tag}`)
      for (let i = 0; i < 300 && !pret(el); i++) await new Promise((r) => setTimeout(r, 10))
      return { el, destroy: () => el.remove() }
    },
    destroy: async () => { await window.happyDOM.close() }
  }
}

for (const mode of MODES) {
  describe(`état réactif — une liste changée par une fonction qui la reçoit (${mode})`, function () {
    this.timeout(60000)
    const sans = mode === 'proxy: false'
    let app: any
    let erreurs: string[]

    before(async () => {
      if (mode === 'production') {
        app = await production()
        return
      }
      const root = mjsTmp('liste-changee-par-une-fonction')
      SOURCES(root, sans ? { proxy: false } : {})
      app = await createHarness({ root })
    })

    after(async () => {
      if (app) await app.destroy()
      await terminateSharedWorkerPool()
    })

    const racine = (n: any) => n._shadow ?? n
    const lis    = (n: any, s: string) => Array.from(racine(n).querySelectorAll(s)).map((x: any) => x.textContent).join(' ')
    const vue    = (c: any) => [lis(c.el, 'ul.k > li'), lis(c.el, 'ul.u > li'), lis(c.el, 'p.n')]
    const enfant = (c: any) => lis(racine(c.el).querySelector('mjs-tst-lcf-enfant'), 'ul.e > li')

    const jouer = async (c: any, geste: () => any) => {
      erreurs = []
      const w = app.window
      const garde = w.console.error
      const capte = (e: any) => erreurs.push(String(e.error?.stack || e.message))
      w.console.error = (...a: any[]) => erreurs.push(a.map((x) => String(x?.stack || x)).join(' '))
      w.addEventListener('error', capte)
      try {
        geste()
        await new Promise((r) => setTimeout(r, 0))
        if (sans) {
          c.el.rafraichir()
          await new Promise((r) => setTimeout(r, 0))
        }
        await new Promise((r) => setTimeout(r, 0))
      }
      finally {
        w.console.error = garde
        w.removeEventListener('error', capte)
      }
    }

    for (const [nom, f, rendu, attenduRendu, attendu, cle] of GESTES) {
      it(`${nom} : l'écran suit, le composant ne tombe pas, la méthode rend ce que rend JavaScript`, async () => {
        const c = await app.mount('tst-lcf-hote')
        try {
          let lu: any
          await jouer(c, () => c.el.muter((x: any[]) => { lu = rendu(f(x), x) }))
          assert.deepEqual(erreurs, [])
          assert.deepEqual(lu, attenduRendu, 'valeur rendue par la méthode')
          const v = vue(c)
          assert.deepEqual(cle ? v : v.slice(1), (cle ? [attendu] : []).concat([attendu, String(attendu.split(' ').length)]))
          // la liste tenue par l'enfant (prop) : sans enveloppe, la prop garde la même liste, l'enfant n'est pas prévenu (limite écrite)
          if (!sans) assert.equal(enfant(c), attendu, 'l\'enfant suit')
        }
        finally {
          c.destroy()
        }
      })

      it(`${nom} sur une liste rangée dans un objet (\`$o.liste\`) : l'écran suit`, async () => {
        const c = await app.mount('tst-lcf-hote')
        try {
          let lu: any
          await jouer(c, () => c.el.muterO((x: any[]) => { lu = rendu(f(x), x) }))
          assert.deepEqual(erreurs, [])
          assert.deepEqual(lu, attenduRendu, 'valeur rendue par la méthode')
          assert.equal(lis(c.el, 'ul.o > li'), attendu)
        }
        finally {
          c.destroy()
        }
      })

      // état partagé : une liste de `µ.state` passe par la même enveloppe ; sans enveloppe, hors de ce réglage
      if (!sans) {
        it(`${nom} sur une liste d'un état partagé (\`µ.state\`) : l'écran suit`, async () => {
          const c = await app.mount('tst-lcf-hote')
          try {
            let lu: any
            await jouer(c, () => c.el.muterS((x: any[]) => { lu = rendu(f(x), x) }))
            assert.deepEqual(erreurs, [])
            assert.deepEqual(lu, attenduRendu, 'valeur rendue par la méthode')
            assert.equal(lis(c.el, 'ul.s > li'), attendu)
          }
          finally {
            c.destroy()
          }
        })
      }
    }

    it('@click qui passe la liste à une fonction qui fait pop : l\'écran suit', async () => {
      const c = await app.mount('tst-lcf-hote')
      try {
        await jouer(c, () => racine(c.el).querySelector('button').click())
        assert.deepEqual(erreurs, [])
        assert.deepEqual(vue(c), ['a b c', 'a b c', '3'])
        if (!sans) assert.equal(enfant(c), 'a b c', 'l\'enfant suit')
      }
      finally {
        c.destroy()
      }
    })
  })
}

// une méthode qui ne change pas la liste ne prévient personne : un tri sur place relu à chaque rendu (dans le gabarit, compilé ou par une
// fonction, dans un µeffect) ne tourne pas sans fin, `pop` d'une liste vide et `splice(0, 0)` ne redessinent rien ; une ligne retirée
// par `pop`, `shift`, `splice` sort enveloppée : écrite ensuite par ce nom, elle prévient l'enfant qui la tient ; une liste typée refuse
// un `push` d'un mauvais type venu d'une fonction ; une liste d'un `µ.Store` changée par une fonction change en entier
const TRIER = 'function trier(x) { window.__n.tri++; if (window.__n.tri > 1000) return x; return x.sort((a, b) => a.n - b.n); }'
const ROWS  = '[{id: 1, n: 3}, {id: 2, n: 1}, {id: 3, n: 2}, {id: 4, n: 0}]'
const AUTRES: Record<string, string> = {
  'tst-lcf-gab': `<script lang="js">\n  ${TRIER}\n  $rows = ${ROWS};\n</script>\n<ul class="k">{for r in trier($rows) by id}<li>{r.n}</li>{end}</ul>\n`,
  'tst-lcf-cmp': `<script lang="js">\n  function cmp(a, b) { window.__n.cmp++; if (window.__n.cmp > 3000) throw new Error('plafond'); return a.n - b.n; }\n  $rows = ${ROWS};\n</script>\n<ul class="k">{for r in $rows.sort(cmp) by id}<li>{r.n}</li>{end}</ul>\n`,
  'tst-lcf-eff': `<script lang="js">\n  ${TRIER}\n  $rows = ${ROWS};\n  µeffect(() => { window.__n.eff++; trier($rows); });\n</script>\n<ul class="k">{for r in $rows by id}<li>{r.n}</li>{end}</ul>\n`,
  'tst-lcf-rien': `<script lang="js">\n  function voir(x) { window.__n.vu++; return x; }\n  $vide = [];\n  $rows = [{id: 1, n: 3}, {id: 2, n: 1}];\n  @oter = function() { (function(x) { return x.pop(); })($vide); };\n  @rien = function() { (function(x) { return x.splice(0, 0); })($rows); };\n</script>\n<ul class="v">{for r in voir($vide) by id}<li>{r.n}</li>{end}</ul>\n<ul class="w">{for r in voir($rows) by id}<li>{r.n}</li>{end}</ul>\n`,
  'tst-lcf-ligne': `<script lang="js">\n  $item = {};\n</script>\n<span>{$item.id}:{$item.n}</span>\n`,
  'tst-lcf-lignes': `<script lang="js">\n  $rows = [{id: 1, n: 10}, {id: 2, n: 20}, {id: 3, n: 30}, {id: 4, n: 40}];\n  @muter = function(f) { return f($rows); };\n</script>\n<ul class="e">{for r in $rows by id}<li><@tst-lcf-ligne item={r}></@tst-lcf-ligne></li>{end}</ul>\n`,
  'tst-lcf-type': `<vars>\n  $nums int[]\n</vars>\n<script lang="js">\n  $nums = [1, 2];\n  @muter = function(f) { return f($nums); };\n</script>\n<ul class="t">{for r in $nums}<li>{r}</li>{end}</ul>\n`,
  'tst-lcf-store': `<script lang="js">\n  class Panier extends µ.Store { constructor() { super({rows: [{id: 1, n: 3}, {id: 2, n: 1}, {id: 3, n: 2}]}); } }\n  const p = new Panier();\n  @muter = function(f) { return f(p.data.rows); };\n</script>\n<ul class="s">{for r in p.data.rows by id}<li>{r.n}</li>{end}</ul>\n`
}
const SOURCES2 = (root: string) => {
  mkdirSync(join(root, 'src'), { recursive: true })
  for (const nom of Object.keys(AUTRES)) writeFileSync(join(root, 'src', `${nom}.mjs`), AUTRES[nom])
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }))
}
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))
const racine2  = (n: any) => n._shadow ?? n
const lignes   = (el: any, s: string) => Array.from(racine2(el).querySelectorAll(s)).map((li: any) => { const e = li.firstElementChild; return String(e && /^MJS-/.test(e.tagName) ? racine2(e).textContent : li.textContent).trim() }).join(' ')

for (const mode of ['développement', 'production']) {
  describe(`état réactif — une méthode de liste jouée par une fonction : rendus bornés, lignes enveloppées, types, magasin (${mode})`, function () {
    this.timeout(60000)
    let app: any
    let messages: string[]

    before(async () => {
      if (mode === 'production') {
        app = await production(SOURCES2, (el: any) => racine2(el).querySelector('ul'))
        return
      }
      const root = mjsTmp('liste-changee-par-une-fonction-2')
      SOURCES2(root)
      app = await createHarness({ root })
    })

    after(async () => {
      if (app) await app.destroy()
      await terminateSharedWorkerPool()
    })

    // monte, compte les appels (`window.__n`), joue un geste ; les messages d'erreur et d'avertissement sont relevés
    const scene = async (tag: string, geste?: (c: any) => void) => {
      const w = app.window
      w.__n = { tri: 0, cmp: 0, eff: 0, vu: 0 }
      messages = []
      const gE = w.console.error, gW = w.console.warn
      w.console.error = (...a: any[]) => messages.push(a.map(String).join(' '))
      w.console.warn  = (...a: any[]) => messages.push(a.map(String).join(' '))
      try {
        const c = await app.mount(tag)
        await attendre(200)
        const montage = { ...w.__n }
        w.__n = { tri: 0, cmp: 0, eff: 0, vu: 0 }
        if (geste) geste(c)
        await attendre(100)
        return { c, montage, geste: { ...w.__n } }
      }
      finally {
        w.console.error = gE
        w.console.warn  = gW
      }
    }

    it('tri sur place par une fonction dans le gabarit : deux appels au montage, comme la base, pas de rendu sans fin', async () => {
      const { c, montage } = await scene('tst-lcf-gab')
      assert.equal(montage.tri, 2)
      assert.equal(lignes(c.el, 'ul.k > li'), '0 1 2 3')
      c.destroy()
    })

    it('`$rows.sort(cmp)` dans le gabarit : neuf appels du comparateur au montage, comme la base', async () => {
      const { c, montage } = await scene('tst-lcf-cmp')
      assert.equal(montage.cmp, 9)
      assert.equal(lignes(c.el, 'ul.k > li'), '0 1 2 3')
      c.destroy()
    })

    it('tri sur place dans un µeffect : deux passages au montage, comme la base', async () => {
      const { c, montage } = await scene('tst-lcf-eff')
      assert.equal(montage.eff, 2)
      assert.equal(montage.tri, 2)
      c.destroy()
    })

    it('`pop` d\'une liste vide et `splice(0, 0)` par une fonction : aucun rendu', async () => {
      const a = await scene('tst-lcf-rien', (c) => c.el.oter())
      assert.equal(a.geste.vu, 0)
      a.c.destroy()
      const b = await scene('tst-lcf-rien', (c) => c.el.rien())
      assert.equal(b.geste.vu, 0)
      assert.equal(lignes(b.c.el, 'ul.w > li'), '3 1')
      b.c.destroy()
    })

    it('`o = x.shift()`, `o.n = 1`, `x.unshift(o)` : l\'enfant qui tient la ligne suit', async () => {
      const { c } = await scene('tst-lcf-lignes', (c) => c.el.muter((x: any[]) => { const o = x.shift(); o.n = 1; x.unshift(o) }))
      assert.equal(lignes(c.el, 'ul.e > li'), '1:1 2:20 3:30 4:40')
      c.destroy()
    })

    it('déplacement `x.splice(vers, 0, x.splice(de, 1)[0])` puis écriture dans la ligne déplacée : l\'enfant suit', async () => {
      const { c } = await scene('tst-lcf-lignes', (c) => c.el.muter((x: any[]) => { x.splice(2, 0, x.splice(0, 1)[0]); x[2].n = 11 }))
      assert.equal(lignes(c.el, 'ul.e > li'), '2:20 3:30 1:11 4:40')
      c.el.muter((x: any[]) => { const o = x.splice(0, 1)[0]; x.splice(2, 0, o); o.n = 8 })
      await attendre(100)
      assert.equal(lignes(c.el, 'ul.e > li'), '3:30 1:11 2:8 4:40')
      c.destroy()
    })

    // refusé comme la même méthode écrite dans le composant (`$nums.push('x')`), qui ne dit rien non plus : aucun message, liste intacte
    it('liste typée (`int[]`) : un `push` d\'un mauvais type venu d\'une fonction est refusé, la liste intacte, comme écrit dans le composant', async () => {
      const { c } = await scene('tst-lcf-type', (c) => c.el.muter((x: any[]) => x.push('x')))
      assert.deepEqual(messages, [])
      assert.equal(lignes(c.el, 'ul.t > li'), '1 2')
      assert.equal(c.el.muter((x: any[]) => x.join(',')), '1,2', 'liste intacte')
      c.destroy()
    })

    // le magasin range sa liste dans `.data`, comme le dit le chapitre 14 (`super({ rows: […] })`, lue par `p.data.rows`) : la méthode
    // change toute la liste, rend ce que rend JavaScript, rien ne tombe, et aucun avertissement ne part
    it('liste d\'un `µ.Store` changée par une fonction (`pop`, `sort`) : la donnée change en entier, rien ne tombe', async () => {
      const { c } = await scene('tst-lcf-store', (c) => c.el.muter((x: any[]) => x.pop()))
      assert.deepEqual(messages, [])
      assert.equal(c.el.muter((x: any[]) => x.map((r: any) => r.n).join(' ')), '3 1')
      assert.equal(c.el.muter((x: any[]) => x.sort((a: any, b: any) => a.n - b.n) === x), true)
      assert.equal(c.el.muter((x: any[]) => x.map((r: any) => r.n).join(' ')), '1 3')
      c.destroy()
    })
  })
}
