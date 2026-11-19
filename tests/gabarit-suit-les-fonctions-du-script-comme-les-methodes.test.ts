// Une expression du gabarit qui appelle une méthode (`{@rl().dom}`) suit les variables `$` que lit la méthode ; la même
// expression qui appelait une fonction du `<script>` par son nom (`{rl().dom}`) ne suivait rien : le texte était rendu une
// fois, puis restait figé sans un mot (le libellé de repli restait à l'écran quand la réponse arrivait). Une fonction écrite
// sur place et affectée une seule fois au premier niveau du `<script>` compte maintenant ses lectures comme une méthode, à
// toutes les places du gabarit, par le même point fixe (fonction → fonction, fonction → méthode, méthode → fonction) ; un
// nom que le gabarit met en portée masque la fonction homonyme ; un nom du `<script>` que la construction ne sait pas lire
// (fonction affectée deux fois, valeur rendue par un appel) est signalé à la construction au lieu de figer le texte en silence.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// la carte `_mjs_effectsByVar` du JS émis, et les variables qui relancent les blocs `{if}`, `{for}`, `{key}`
function carte(output: string): string {
  const m = output.match(/_mjs_effectsByVar\s*=\s*(\{[^;]*\})/)
  assert.ok(m, `_mjs_effectsByVar introuvable dans le JS émis :\n${output}`)
  return m![1]
}

function blocs(output: string): string {
  return (output.match(/_mjs_renderStructVars\s*=\s*([^;]*);/) ?? ['', ''])[1]
}

async function construire(src: string, nom: string): Promise<{ output: string; avertissements: string[] }> {
  const avertissements: string[] = []
  const warn = console.warn
  console.warn = (...a: any[]) => { avertissements.push(String(a[0])) }
  try {
    const { output } = await transpile(src, { moduleName: nom })
    return { output, avertissements }
  }
  finally {
    console.warn = warn
  }
}

const SCRIPT_N = '<script>\n$n = 1\nf = -> $n\n</script>\n'

describe('gabarit : une fonction du <script> appelée par son nom suit ce qu\'elle lit, comme une méthode', () => {

  it('interpolation : {rl().dom} suit $labels comme {@rl().dom} (libellé de repli, puis réponse du serveur)', async () => {
    const corps    = "$labels = null\nRL = -> $labels?.me or { dom: µt('roles_fallback.dom'), sub: µt('roles_fallback.sub') }\nµawake -> µajax.get('/app/invite_link', ((res) -> $labels = res?.labels or null), (-> null))\n"
    const locale   = await construire(`<script>\n${corps.replace('RL', 'rl')}</script>\n<div class="t">{rl().dom}</div>`, 'fonction-locale-labels')
    const methode  = await construire(`<script>\n${corps.replace('RL', '@rl')}</script>\n<div class="t">{@rl().dom}</div>`, 'fonction-methode-labels')
    assert.match(carte(locale.output), /"labels"/)
    assert.equal(carte(locale.output), carte(methode.output))
  })

  it('valeur d\'attribut, liée ou dans un texte, et :class', async () => {
    assert.match(carte((await construire(`${SCRIPT_N}<p title={f()}>x</p>`, 'fonction-attribut')).output), /"n"/)
    assert.match(carte((await construire(`${SCRIPT_N}<p title="n {f()}">x</p>`, 'fonction-attribut-texte')).output), /"n"/)
    assert.match(carte((await construire(`${SCRIPT_N}<p :class{f() > 2}="haut">x</p>`, 'fonction-class')).output), /"n"/)
  })

  it('{if}, {for} et {key} : le bloc se relance quand la fonction lit une autre valeur', async () => {
    assert.match(blocs((await construire(`${SCRIPT_N}{if f() > 2}<p>haut</p>{end}`, 'fonction-if')).output), /"n"/)
    assert.match(blocs((await construire('<script>\n$liste = [1, 2]\nf = -> $liste\n</script>\n{for x in f()}<p>{x}</p>{end}', 'fonction-for')).output), /"liste"/)
    assert.match(blocs((await construire(`${SCRIPT_N}{key f()}<p>x</p>{end}`, 'fonction-key')).output), /"n"/)
  })

  it('prop d\'un enfant : <@nested answer={f()}>', async () => {
    assert.match(carte((await construire(`${SCRIPT_N}<@nested answer={f()}>`, 'fonction-prop')).output), /"n"/)
  })

  it('point fixe : fonction → fonction, fonction → méthode, méthode → fonction', async () => {
    assert.match(carte((await construire('<script>\n$n = 1\ng = -> $n\nf = -> g() + 1\n</script>\n<p>{f()}</p>', 'fonction-vers-fonction')).output), /"n"/)
    assert.match(carte((await construire('<script>\n$n = 1\n@m = -> $n\nf = -> @@m() + 1\n</script>\n<p>{f()}</p>', 'fonction-vers-methode')).output), /"n"/)
    assert.match(carte((await construire('<script>\n$n = 1\ng = -> $n\n@m = -> g() + 1\n</script>\n<p>{@m()}</p>', 'methode-vers-fonction')).output), /"n"/)
  })

  it('fonction passée en valeur : {$liste.map(fmt)} suit aussi ce que lit fmt', async () => {
    const { output } = await construire("<script>\n$liste = [1, 2]\n$suffixe = 'x'\nfmt = (v) -> v + $suffixe\n</script>\n<p>{$liste.map(fmt).join(',')}</p>", 'fonction-en-valeur')
    assert.match(carte(output), /"liste"/)
    assert.match(carte(output), /"suffixe"/)
  })

  it('homonymes : variable d\'un {for}, {const}, paramètre d\'une fonction de l\'expression masquent la fonction du <script>', async () => {
    const pour   = await construire('<script>\n$n = 1\n$fns = []\nf = -> $n\n</script>\n{for f in $fns}<p>{f()}</p>{end}', 'homonyme-for')
    const constante = await construire('<script>\n$n = 1\nf = -> $n\n</script>\n{for x in [1]}{const f = x + 1}<p>{f}</p>{end}', 'homonyme-const')
    const param  = await construire('<script>\n$n = 1\n$liste = [1]\nf = -> $n\n</script>\n<p>{$liste.map((f) -> f).join(\',\')}</p>', 'homonyme-param')
    for (const { output } of [pour, constante, param]) {
      assert.doesNotMatch(carte(output), /"n"/)
      assert.doesNotMatch(blocs(output), /"n"/)
    }
    // hors du bloc, le même nom redevient la fonction du <script>
    const dehors = await construire('<script>\n$n = 1\n$fns = []\nf = -> $n\n</script>\n{for f in $fns}<p>{f()}</p>{end}<p>{f()}</p>', 'homonyme-for-dehors')
    assert.match(carte(dehors.output), /"n"/)
  })

  it('formes : f := ->, f := =>, function f (JavaScript), f = -> (CoffeeScript), déclarée à undefined puis affectée', async () => {
    const sources = ['<script lang="js">\nlet f = undefined\n$n = 1\nf = function() { return $n }\n</script>\n<p>{f()}</p>', '<script>\n$n = 1\nf := -> $n\n</script>\n<p>{f()}</p>', '<script>\n$n = 1\nf := => $n\n</script>\n<p>{f()}</p>', '<script lang="js">\n$n = 1\nfunction f() { return $n }\n</script>\n<p>{f()}</p>', '<script lang="coffee">\n$n = 1\nf = -> $n\n</script>\n<p>{f()}</p>']
    for (const [i, src] of sources.entries()) assert.match(carte((await construire(src, `fonction-forme-${i}`)).output), /"n"/, src)
  })

  it('magasin, langue et traduction : $$panier.n, µlang, µt', async () => {
    assert.match(carte((await construire('<script>\nf = -> $$panier.n\n</script>\n<p>{f()}</p>', 'fonction-magasin')).output), /"\$\$panier"/)
    assert.match(carte((await construire('<script>\nf = -> µlang\n</script>\n<p>{f()}</p>', 'fonction-langue')).output), /"\$\$__mjsLang"/)
    // µt : le composant s'inscrit au changement de langue, qui relance tous ses effets, comme pour une méthode
    assert.match((await construire("<script>\nf = -> µt('x')\n</script>\n<p>{f()}</p>", 'fonction-traduction')).output, /_mjs_i18n = \[/)
  })

  it('affectée deux fois au premier niveau, ou valeur rendue par un appel : signalée à la construction, jamais en silence', async () => {
    const deuxFois = await construire('<script>\n$n = 1\n$m = 2\nf = -> $n\nf = -> $m\n</script>\n<p>{f()}</p>', 'fonction-deux-fois')
    const fabriquee = await construire('<script>\n$n = 1\nfabrique = -> (-> $n)\nf = fabrique()\n</script>\n<p>{f()}</p>', 'fonction-fabriquee')
    for (const { avertissements } of [deuxFois, fabriquee]) {
      assert.equal(avertissements.filter((a) => a.includes('« f() »') && a.includes('ne sait pas lire')).length, 1, avertissements.join('\n'))
    }
    assert.doesNotMatch(carte(deuxFois.output), /"[nm]"/)
  })

  it('qui écrit l\'état : même carte qu\'une méthode qui écrit, aucun avertissement à la construction', async () => {
    const corps   = 'NOM = ->\n  $n = $n + 1\n  $n\n'
    const locale  = await construire(`<script>\n$n = 1\n${corps.replace('NOM', 'f')}</script>\n<p>{f()}</p>`, 'ecrit-locale')
    const methode = await construire(`<script>\n$n = 1\n${corps.replace('NOM', '@f')}</script>\n<p>{@f()}</p>`, 'ecrit-methode')
    assert.equal(carte(locale.output), carte(methode.output))
    assert.match(carte(locale.output), /"n"/)
    assert.deepEqual(locale.avertissements, methode.avertissements)
  })
})

describe('gabarit : une fonction qui écrit l\'état qu\'elle lit, au rendu, se comporte comme la méthode', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('la fonction et la méthode tournent le même nombre de fois et affichent la même valeur', async () => {
    const root   = mjsTmp('fonction-qui-ecrit')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    const corps = 'NOM = ->\n  globalThis.__tours.CLE++\n  $n = $n + 1 if $n < 5\n  $n\n'
    writeFileSync(join(srcDir, 'ecrit-locale.mjs'), `<script>\n$n = 1\n${corps.replace('NOM', 'f').replace('CLE', 'locale')}</script>\n<p>{f()}</p>\n`)
    writeFileSync(join(srcDir, 'ecrit-methode.mjs'), `<script>\n$n = 1\n${corps.replace('NOM', '@f').replace('CLE', 'methode')}</script>\n<p>{@f()}</p>\n`)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`globalThis.__tours = { locale: 0, methode: 0 };\n${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-ecrit-locale></mjs-ecrit-locale><mjs-ecrit-methode></mjs-ecrit-methode>'
    const texte = (tag: string) => { const el = window.document.querySelector(tag); return ((el._shadow ?? el).textContent ?? '').trim() }
    const fin = Date.now() + 3000
    while (Date.now() < fin && (texte('mjs-ecrit-locale') !== '5' || texte('mjs-ecrit-methode') !== '5')) await new Promise((r) => setTimeout(r, 10))
    await new Promise((r) => setTimeout(r, 100))
    const tours = window.eval('globalThis.__tours')
    // l'écriture relance l'expression qui l'a faite, jusqu'à ce que la valeur ne change plus (5) : sans le suivi, la fonction
    // s'arrêtait au premier tour et laissait « 2 » à l'écran, la méthode allait jusqu'à « 5 »
    assert.equal(texte('mjs-ecrit-locale'), texte('mjs-ecrit-methode'))
    assert.equal(texte('mjs-ecrit-locale'), '5')
    assert.equal(tours.locale, tours.methode)
    window.close()
  })
})
