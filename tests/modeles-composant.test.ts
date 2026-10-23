// Les modèles d'un composant — `layout="x"` choisit un modèle ; trois étages, du plus léger au plus
// lourd : le style seul (`<style name="x">`, chargé s'il sert), un détail du HTML (`µlayout`, le
// modèle choisi, lu dans le gabarit et le script), toute la structure (un fichier à lui,
// `carte.compacte.mjs` à côté de `carte.mjs`). Un nom comparé à `µlayout` est un modèle connu du
// composant, comme un style nommé : écrit en dur ailleurs, il est vérifié au build ; choisi, il ne
// charge aucun fichier de style.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const HORLOGE = `<script>
  $n = 3
  @texte = -> if µlayout is 'timer' then 'minuteur' else 'horloge'
</script>

{if µlayout is 'timer'}<b class="t">{$n}</b>{else}<i class="h">H</i>{end}
<p class="nom">{µlayout}</p>
<p class="s">{@texte()}</p>

<style name="rouge">
  p
    color: red
</style>
`

const HOTE = `<script>
  $m = 'timer'
</script>

<@horloge class="a" layout="timer"></@horloge>
<@horloge class="b"></@horloge>
<@horloge class="c" layout={$m}></@horloge>
<button class="bascule" @click={$m = 'default'}>x</button>
`

async function construire(etiquette: string, fichiers: Record<string, string>) {
  const root   = mjsTmp('modeles-' + etiquette)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  return { root, outDir, stats, erreurs: stats.errors.map((e: any) => e.message).join('\n') }
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('les modèles d\'un composant : layout, µlayout', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('µlayout — le modèle choisi, dans le gabarit et le script', function () {
    let window: any
    let hote: any
    const requetes: string[] = []
    let sortie = ''
    const dans = (sel: string, sous: string) => hote._shadow.querySelector(sel)._shadow.querySelector(sous)

    before(async () => {
      const b = await construire('mu', { 'horloge.mjs': HORLOGE, 'hote.mjs': HOTE })
      assert.equal(b.erreurs, '')
      sortie = b.outDir
      const files = readdirSync(b.outDir).filter((f) => f.endsWith('.js'))
      const code  = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(b.outDir, f), 'utf-8'))).join('\n')
      window = new Window({ url: 'http://localhost/' })
      window.fetch = async (u: string) => { requetes.push(String(u)); return { ok: true, text: async () => 'p{color:red}' } }
      window.eval(`${code}\nglobalThis.µ = µ;`)
      window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
      hote = window.document.querySelector('mjs-hote')
      await attendre(() => !!hote._shadow?.querySelector('.c')?._shadow?.querySelector('.nom'))
      await new Promise((r) => setTimeout(r, 30))
    })

    after(() => { window?.close?.() })

    it('layout="timer" : la branche du modèle, son nom, et le script le lit', () => {
      assert.equal(dans('.a', '.t')?.textContent, '3')
      assertAbsent(dans('.a', '.h'))
      assert.equal(dans('.a', '.nom').textContent, 'timer')
      assert.equal(dans('.a', '.s').textContent, 'minuteur')
    })

    it('sans layout : « default »', () => {
      assert.ok(dans('.b', '.h'))
      assert.equal(dans('.b', '.nom').textContent, 'default')
      assert.equal(dans('.b', '.s').textContent, 'horloge')
    })

    it('layout={$m} : le modèle suit la variable du parent', async () => {
      assert.ok(dans('.c', '.t'), 'timer au départ')
      hote._shadow.querySelector('.bascule').click()
      await attendre(() => !!dans('.c', '.h'))
      assert.ok(dans('.c', '.h'), 'default après la bascule')
      assert.equal(dans('.c', '.nom').textContent, 'default')
    })

    it('un modèle du HTML seul ne charge aucun fichier de style ; le build n\'en écrit pas', () => {
      assert.deepEqual(requetes.filter((u) => /timer/.test(u)), [])
      assert.equal(existsSync(join(sortie, 'horloge.timer.css')), false)
      assert.equal(existsSync(join(sortie, 'horloge.rouge.css')), true, 'le style nommé, lui, a son fichier')
    })
  })

  it('un nom écrit en dur qui n\'est ni un style nommé ni comparé à µlayout : erreur au build, qui cite les modèles connus', async () => {
    const b = await construire('faute', { 'horloge.mjs': HORLOGE, 'hote.mjs': '<@horloge layout="timmer"></@horloge>\n' })
    assert.match(b.erreurs, /timmer/)
    assert.match(b.erreurs, /rouge, timer|timer, rouge/)
  })

  describe('un modèle dans son propre fichier : carte.compacte.mjs à côté de carte.mjs', function () {
    let window: any
    let hote: any
    let code = ''

    before(async () => {
      const b = await construire('fichier', {
        'carte.mjs':          '<article class="normale">{$titre}</article>\n',
        'carte.compacte.mjs': '<p class="compacte">{$titre}</p>\n',
        'hote.mjs':           '<@carte class="a" titre="A"></@carte>\n<@carte class="b" layout="compacte" titre="B"></@carte>\n<mjs-carte class="c" layout="compacte" titre="C"></mjs-carte>\n',
      })
      assert.equal(b.erreurs, '')
      const files = readdirSync(b.outDir).filter((f) => f.endsWith('.js'))
      code = files.filter((f) => f.startsWith('hote')).map((f) => readFileSync(join(b.outDir, f), 'utf-8')).join('\n')
      const tout = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(b.outDir, f), 'utf-8'))).join('\n')
      window = new Window({ url: 'http://localhost/' })
      window.eval(`${tout}\nglobalThis.µ = µ;`)
      window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
      hote = window.document.querySelector('mjs-hote')
      await attendre(() => !!hote._shadow?.querySelector('.c')?._shadow?.querySelector('.compacte'))
    })

    after(() => { window?.close?.() })

    it('layout="compacte" en dur : la balise devient celle du fichier du modèle', () => {
      assert.match(code, /mjs-carte--compacte/)
      assert.doesNotMatch(code, /layout="compacte"/)
      assert.equal(hote._shadow.querySelector('.b').localName, 'mjs-carte--compacte')
      assert.equal(hote._shadow.querySelector('.b')._shadow.querySelector('.compacte').textContent, 'B')
      assert.equal(hote._shadow.querySelector('.c').localName, 'mjs-carte--compacte', 'la balise écrite en entier aussi')
    })

    it('sans layout : le composant de base', () => {
      assert.equal(hote._shadow.querySelector('.a').localName, 'mjs-carte')
      assert.equal(hote._shadow.querySelector('.a')._shadow.querySelector('.normale').textContent, 'A')
    })
  })

  it('un modèle en fichier choisi par une variable : le compilateur écrit le {if} — la balise du modèle, sinon le composant de base, reposée quand la variable change', async () => {
    const b = await construire('dyn', {
      'carte.mjs':          '<p class="base">{$t}</p>\n',
      'carte.compacte.mjs': '<b class="compacte">{$t}</b>\n',
      'hote.mjs':           "<script>\n  $m = 'compacte'\n</script>\n<@carte class=\"x\" layout={$m} t=\"T\"></@carte>\n<button class=\"autre\" @click={$m = 'default'}>x</button>\n<button class=\"retour\" @click={$m = 'compacte'}>y</button>\n",
    })
    assert.equal(b.erreurs, '')
    const files = readdirSync(b.outDir).filter((f) => f.endsWith('.js'))
    const tout  = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(b.outDir, f), 'utf-8'))).join('\n')
    const window: any = new Window({ url: 'http://localhost/' })
    try {
      window.eval(`${tout}\nglobalThis.µ = µ;`)
      window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
      const hote = window.document.querySelector('mjs-hote')
      const x = () => hote._shadow?.querySelector('.x')
      await attendre(() => !!x()?._shadow?.querySelector('.compacte'))
      assert.equal(x().localName, 'mjs-carte--compacte')
      assert.equal(x()._shadow.querySelector('.compacte').textContent, 'T', 'les attributs passent au modèle')
      hote._shadow.querySelector('.autre').click()
      await attendre(() => x()?.localName === 'mjs-carte' && !!x()?._shadow?.querySelector('.base'))
      assert.equal(x().localName, 'mjs-carte', 'une autre valeur : le composant de base')
      assert.equal(x()._shadow.querySelector('.base').textContent, 'T')
      hote._shadow.querySelector('.retour').click()
      await attendre(() => x()?.localName === 'mjs-carte--compacte')
      assert.equal(x().localName, 'mjs-carte--compacte', 'et retour')
    }
    finally {
      window.close()
    }
  })

  it('un modèle en fichier : erreurs claires (composant de base absent, nommé « default », homonyme d\'un style nommé)', async () => {
    const seul = await construire('seul', { 'fiche.compacte.mjs': '<b>x</b>\n' })
    assert.match(seul.erreurs, /fiche\.compacte\.mjs/)
    assert.match(seul.erreurs, /fiche\.mjs/)
    const defaut = await construire('defaut', { 'carte.mjs': '<p>x</p>\n', 'carte.default.mjs': '<b>x</b>\n' })
    assert.match(defaut.erreurs, /default/)
    const double = await construire('double', { 'carte.mjs': '<p>x</p>\n<style name="compacte">\n  p\n    color: red\n</style>\n', 'carte.compacte.mjs': '<b>x</b>\n', 'hote.mjs': '<@carte layout="compacte"></@carte>\n' })
    assert.match(double.erreurs, /compacte/)
    assert.match(double.erreurs, /style name="compacte"|<style name/)
  })

  it('un modèle ne s\'appelle jamais « default » : c\'est le composant lui-même, celui de {? default} — ni en fichier, ni en style nommé', async () => {
    const style = await construire('style-defaut', { 'carte.mjs': '<p>x</p>\n<style name="default">\n  p\n    color: red\n</style>\n' })
    assert.match(style.erreurs, /<style name="default">/)
    assert.match(style.erreurs, /\{\? default\}/)
    const fichier = await construire('fichier-defaut', { 'carte.mjs': '<p>x</p>\n', 'carte.default.mjs': '<b>x</b>\n' })
    assert.match(fichier.erreurs, /carte\.default\.mjs/)
    assert.match(fichier.erreurs, /\{\? default\}/)
  })

  describe('{? nom} — un détail du HTML propre à un modèle, écrit court', function () {
    const MONTRE = `<script>
  $n = 3
</script>

{? timer}
  <b class="t">{$n}</b>
{? chrono, minuteur}
  <b class="c">C</b>
{? default}
  <i class="h">H</i>
{else}
  <span class="autre">?</span>
{end}
{if $n > 1}
  {? timer}<u class="u">u</u>{end}
{end}

<style name="rouge">
  span
    color: red
</style>
`
    let window: any
    let hote: any
    const dans = (sel: string, sous: string) => hote._shadow.querySelector(sel)._shadow.querySelector(sous)

    before(async () => {
      const b = await construire('court', { 'montre.mjs': MONTRE, 'hote.mjs': '<@montre class="a" layout="timer"></@montre>\n<@montre class="b" layout="minuteur"></@montre>\n<@montre class="d"></@montre>\n<@montre class="r" layout="rouge"></@montre>\n' })
      assert.equal(b.erreurs, '')
      const files = readdirSync(b.outDir).filter((f) => f.endsWith('.js'))
      const tout  = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(b.outDir, f), 'utf-8'))).join('\n')
      window = new Window({ url: 'http://localhost/' })
      window.fetch = async () => ({ ok: true, text: async () => 'span{color:red}' })
      window.eval(`${tout}\nglobalThis.µ = µ;`)
      window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
      hote = window.document.querySelector('mjs-hote')
      await attendre(() => !!hote._shadow?.querySelector('.r')?._shadow?.querySelector('.autre'))
    })

    after(() => { window?.close?.() })

    it('{? timer} : la branche du modèle ; un {? …} dans un autre bloc en ouvre un nouveau', () => {
      assert.equal(dans('.a', '.t')?.textContent, '3')
      assert.ok(dans('.a', '.u'), 'le bloc imbriqué dans un {if}')
      assertAbsent(dans('.a', '.h'))
    })

    it('{? chrono, minuteur} : plusieurs modèles ; {? default} : sans layout ; {else} : les autres', () => {
      assert.ok(dans('.b', '.c'))
      assert.ok(dans('.d', '.h'))
      assertAbsent(dans('.d', '.u'))
      assert.ok(dans('.r', '.autre'), 'un style nommé, qui n\'a pas de branche à lui')
    })

    it('les noms sont des modèles connus du composant : un nom écrit en dur ailleurs est vérifié au build ; un nom mal formé est refusé', async () => {
      const faute = await construire('court-faute', { 'montre.mjs': MONTRE, 'hote.mjs': '<@montre layout="timr"></@montre>\n' })
      assert.match(faute.erreurs, /timr/)
      assert.match(faute.erreurs, /chrono/)
      const mal = await construire('court-mal', { 'z.mjs': '{? 12}<b>x</b>{end}\n' })
      assert.match(mal.erreurs, /\{\? 12\}/)
    })
  })

  it('µlayout se lit, il ne s\'écrit pas ; et il ne cohabite pas avec une variable $layout du composant', async () => {
    const ecrit = await construire('ecrit', { 'x.mjs': "<script>\n  @f = -> µlayout = 'a'\n</script>\n<p>{µlayout}</p>\n" })
    assert.match(ecrit.erreurs, /µlayout/)
    const homonyme = await construire('homonyme', { 'y.mjs': "<script>\n  $layout = 'liste'\n</script>\n<p>{µlayout} {$layout}</p>\n" })
    assert.match(homonyme.erreurs, /µlayout/)
  })
})
