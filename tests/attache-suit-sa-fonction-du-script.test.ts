// Une attache `:attach={f(_node)}` qui appelle une fonction du `<script>` suit ce que lit cette fonction comme la forme méthode
// `:attach={@f(_node)}` suit sa méthode : écrire une variable que lit son corps la rejoue, après le nettoyage rendu par le passage
// d'avant. Le défaut, vu dans une appli réelle : un verrou dont la fonction `publish` lit `$locked` restait sur son premier passage
// quand `$locked` changeait, bloc toujours affiché, alors que la méthode `@publish` était rejouée. Comme pour une méthode, la
// fonction compte son corps et les méthodes qu'elle appelle, pas les fonctions du `<script>` qu'elle appelle ou passe en valeur (un
// écouteur), et une méthode ne compte pas les fonctions du `<script>` qu'elle appelle ; ce qu'écrit la fonction n'est pas une
// lecture ; une fonction que la construction ne sait pas lire est signalée une fois, d'un texte juste pour une attache ;
// `:attach.once` garde un seul passage. À la racine, dans une ligne de `{for}`, dans une branche `{await}`, en développement comme
// en production. Une fonction qui lit et écrit la même variable (`$n += 1`) fait comme la méthode : elle se relance sur sa propre
// écriture jusqu'à la garde des 10 000 rendus d'une rafale, qui coupe la boucle et le dit en développement

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { setMessagesLang } from '../src/messages/index.js'
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

// fonction (ou méthode, `@f`) d'attache qui note chaque passage, avec ce qu'elle lit, et rend son nettoyage
const J       = 'globalThis.__j.push'
const attache = (nom: string, lecture: string) => `${nom} = (n) ->\n  ${J}('pose ' + ${lecture})\n  -> ${J}('net')\n`

const SOURCES: Record<string, string> = {
  'suit-fonction': `<script>\n$x = 0\n${attache('f', '$x')}@bump = -> $x++\n</script>\n<div :attach={f(_node)}>a</div>\n`,
  'suit-methode': `<script>\n$x = 0\n${attache('@f', '$x')}@bump = -> $x++\n</script>\n<div :attach={@f(_node)}>a</div>\n`,
  // un verrou réduit : le bloc reste affiché pendant que `$asking` est vrai, puis `$locked` devient vrai
  'verrou-fonction': `<script>\n$asking = true\n$locked = false\n$bioAsked = false\n${attache('publish', "$locked + ' ' + $bioAsked")}@lock = -> $locked = true\n</script>\n{if $asking}<div class="pin" :attach={publish(_node)}>p</div>{end}\n`,
  'verrou-methode': `<script>\n$asking = true\n$locked = false\n$bioAsked = false\n${attache('@publish', "$locked + ' ' + $bioAsked")}@lock = -> $locked = true\n</script>\n{if $asking}<div class="pin" :attach={@publish(_node)}>p</div>{end}\n`,
  'relais-fonction-fonction': `<script>\n$y = 0\ng = -> $y\n${attache('f', 'g()')}@bump = -> $y++\n</script>\n<div :attach={f(_node)}>c</div>\n`,
  'relais-fonction-methode': `<script>\n$z = 0\n@m = -> $z\n${attache('f', '@@m()')}@bump = -> $z++\n</script>\n<div :attach={f(_node)}>c</div>\n`,
  'relais-methode-fonction': `<script>\n$w = 0\nh = -> $w\n${attache('@m', 'h()')}@bump = -> $w++\n</script>\n<div :attach={@m(_node)}>c</div>\n`,
  // la fonction passe un écouteur, fonction du <script> qui lit `$v`
  'valeur': `<script>\n$v = 0\nclic = -> $v\nf = (n) ->\n  ${J}('pose')\n  n.addEventListener('click', clic)\n  -> ${J}('net')\n@bump = -> $v++\n</script>\n<div :attach={f(_node)}>c</div>\n`,
  'ecrit': `<script>\n$$ui = { locked: false }\n$ready = false\nf = (n) ->\n  ${J}('pose')\n  $$ui.locked = true\n  $ready = true\n  -> ${J}('net')\n</script>\n<div :attach={f(_node)}>{$ready}{if $$ui.locked}L{end}</div>\n`,
  'une-fois': `<script>\n$x = 0\n${attache('f', '$x')}@bump = -> $x++\n</script>\n<div :attach.once={f(_node)}>{$x}</div>\n`,
  'ligne': `<script>\n$x = 0\n$rows = ['r']\n${attache('f', '$x')}@bump = -> $x++\n</script>\n<ul>{for r in $rows}<li :attach={f(_node)}>{r}</li>{end}</ul>\n`,
  'boucle-fonction': `<script>\n$n = 0\nf = (n) ->\n  ${J}('pose')\n  $n += 1\n  -> ${J}('net')\n</script>\n<div :attach={f(_node)}>{$n}</div>\n`,
  'boucle-methode': `<script>\n$n = 0\n@f = (n) ->\n  ${J}('pose')\n  $n += 1\n  -> ${J}('net')\n</script>\n<div :attach={@f(_node)}>{$n}</div>\n`,
  'branche': `<script>\n$x = 0\n$p = Promise.resolve('v')\n${attache('f', '$x')}@bump = -> $x++\n</script>\n{await $p}<i>attente</i>{success v}<b :attach={f(_node)}>{v}</b>{end}\n`
}

describe('attache : une fonction du <script> appelée est suivie comme une méthode (construction)', () => {

  it('la fonction appelée par l\'attache est suivie, comme la méthode', async () => {
    const locale  = await construire(SOURCES['suit-fonction'], 'suit-fonction')
    const methode = await construire(SOURCES['suit-methode'], 'suit-methode')
    assert.match(carte(locale.output), /"x"/)
    assert.equal(carte(locale.output), carte(methode.output))
  })

  it('comme une méthode : la méthode qu\'appelle la fonction est suivie, pas une fonction du <script> qu\'elle appelle ou passe en valeur, ni celle qu\'appelle une méthode', async () => {
    assert.match(carte((await construire(SOURCES['relais-fonction-methode'], 'relais-fonction-methode')).output), /"z"/)
    assert.doesNotMatch(carte((await construire(SOURCES['relais-fonction-fonction'], 'relais-fonction-fonction')).output), /"y"/)
    assert.doesNotMatch(carte((await construire(SOURCES['valeur'], 'valeur')).output), /"v"/)
    assert.doesNotMatch(carte((await construire(SOURCES['relais-methode-fonction'], 'relais-methode-fonction')).output), /"w"/)
    // passée seulement en valeur par l'expression de l'attache : pas suivie, comme une méthode passée en valeur
    const enValeur = '<script>\n$v = 0\nclic = -> $v\n@brancher = (n, h) -> n.addEventListener(\'click\', h)\nbrancherF = (n, h) -> n.addEventListener(\'click\', h)\n</script>\n<div :attach={@brancher(_node, clic)}>a</div>\n<div :attach={brancherF(_node, clic)}>b</div>\n'
    assert.doesNotMatch(carte((await construire(enValeur, 'valeur-dans-l-expression')).output), /"v"/)
  })

  it('ce qu\'écrit la fonction n\'est pas une lecture : ni $ready ni $$ui suivis par l\'attache', async () => {
    const { output } = await construire('<script>\n$$ui = { locked: false }\n$ready = false\nf = (n) ->\n  $$ui.locked = true\n  $ready = true\n  null\n</script>\n<div :attach={f(_node)}>a</div>', 'ecrit-seul')
    assert.doesNotMatch(output.match(/_mjs_effectsByVar\s*=\s*(\{[^;]*\})/)?.[1] ?? '', /"ready"|"\$\$ui"/)
  })

  it(':attach.once : aucune variable suivie', async () => {
    const { output } = await construire(`<script>\n$x = 0\n${attache('f', '$x')}</script>\n<div :attach.once={f(_node)}>a</div>`, 'une-fois-seule')
    assert.doesNotMatch(output.match(/_mjs_effectsByVar\s*=\s*(\{[^;]*\})/)?.[1] ?? '', /"x"/)
  })

  it('ligne de {for} et branche {await} : la fonction est suivie', async () => {
    assert.match(blocs((await construire(SOURCES['ligne'], 'ligne')).output), /"x"/)
    assert.match(carte((await construire(SOURCES['branche'], 'branche')).output), /"x"/)
  })

  it('fonction que la construction ne sait pas lire : dite une fois, d\'un texte juste pour une attache, en français et en anglais', async () => {
    const src   = '<script>\n$n = 1\n$m = 2\nf = (n) -> n.dataset.v = $n\nf = (n) -> n.dataset.v = $m\n</script>\n<div :attach={f(_node)}>a</div>\n<div :attach={f(_node)}>b</div>'
    const dites = (avertissements: string[]) => avertissements.filter((a) => a.includes('« f »') || a.includes('"f"'))
    const fr    = dites((await construire(src, 'illisible-fr')).avertissements)
    let en: string[] = []
    setMessagesLang('en')
    try {
      en = dites((await construire(src, 'illisible-en')).avertissements)
    }
    finally {
      setMessagesLang('fr')
    }
    assert.equal(fr.length, 1, fr.join('\n'))
    assert.equal(en.length, 1, en.join('\n'))
    assert.match(fr[0], /« f\(_node\) ».* appelle « f », que la construction ne sait pas lire/)
    assert.match(en[0], /"f\(_node\)".* calls "f", which the build cannot read/)
    // une attache n'a pas de texte : l'avertissement dit ce qui vaut aussi pour elle
    assert.doesNotMatch(fr[0], /son texte/)
    assert.doesNotMatch(en[0], /its text/)
  })
})

async function bundle(mode: 'dev' | 'prod'): Promise<string> {
  const root   = mjsTmp(`attache-suit-fonction-${mode}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, `${nom}.mjs`), source)
  const opts: any = mode === 'prod' ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [], 'la construction passe')
  if (mode === 'prod') return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function attendre(cond: () => boolean, ms = 1500) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await pause(10)
}

// monte le composant, joue ses gestes un à un (chacun attend un passage de plus) et rend le journal des passages et nettoyages
async function jouer(code: string, nom: string, gestes: string[] = [], attente = 1500): Promise<{ journal: string[]; texte: string; html: string; avertissements: string[] }> {
  const window: any = new Window({ url: 'http://localhost/' })
  try {
    const erreurs: string[] = []
    const avertissements: string[] = []
    window.addEventListener('error', (e: any) => erreurs.push(String(e.message ?? e.error)))
    window.console.warn = (...a: any[]) => avertissements.push(String(a[0]))
    window.__j = []
    window.eval(code)
    window.document.body.innerHTML = `<mjs-${nom}></mjs-${nom}>`
    const el = window.document.querySelector(`mjs-${nom}`)
    await attendre(() => window.__j.length > 0)
    await pause(100)
    for (const geste of gestes) {
      const avant = window.__j.length
      el[geste]()
      await attendre(() => window.__j.length > avant, attente)
      await pause(60)
    }
    assert.deepEqual(erreurs, [], 'aucune erreur')
    const racine = el._shadow ?? el
    return { journal: [...window.__j], texte: (racine.textContent ?? '').trim(), html: racine.innerHTML, avertissements }
  }
  finally {
    await window.happyDOM.close()
  }
}

describe('attache : une fonction du <script> appelée est suivie comme une méthode (rendu)', function () {
  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev', 'prod'] as const) describe(mode === 'dev' ? 'développement' : 'production', function () {
    this.timeout(120000)

    let code = ''

    before(async () => {
      code = await bundle(mode)
    })

    it('écrire $x rejoue l\'attache après le nettoyage du passage d\'avant, comme la méthode', async () => {
      const locale  = await jouer(code, 'suit-fonction', ['bump', 'bump'])
      const methode = await jouer(code, 'suit-methode', ['bump', 'bump'])
      assert.deepEqual(locale.journal.slice(-4), ['net', 'pose 1', 'net', 'pose 2'], locale.journal.join(', '))
      assert.deepEqual(locale.journal, methode.journal)
    })

    it('le verrou : bloc toujours affiché, $locked change, la fonction publish est rejouée comme la méthode', async () => {
      const locale  = await jouer(code, 'verrou-fonction', ['lock'])
      const methode = await jouer(code, 'verrou-methode', ['lock'])
      assert.deepEqual(locale.journal.slice(-2), ['net', 'pose true false'], locale.journal.join(', '))
      assert.ok(locale.html.includes('class="pin"'), `le bloc reste affiché : ${locale.html}`)
      assert.deepEqual(locale.journal, methode.journal)
    })

    it('comme une méthode : rejouée par la méthode qu\'appelle la fonction, pas par une fonction du <script> qu\'elle appelle ou passe en valeur, ni par celle qu\'appelle une méthode', async () => {
      const suivie = await jouer(code, 'relais-fonction-methode', ['bump'])
      assert.deepEqual(suivie.journal.slice(-2), ['net', 'pose 1'], suivie.journal.join(', '))
      for (const nom of ['relais-fonction-fonction', 'valeur', 'relais-methode-fonction']) {
        const { journal } = await jouer(code, nom, ['bump'], 300)
        assert.deepEqual(journal, [nom === 'valeur' ? 'pose' : 'pose 0'], `${nom} : ${journal.join(', ')}`)
      }
    })

    it('ce qu\'elle écrit ($$ui.locked, $ready) ne la rejoue pas', async () => {
      const { journal, texte } = await jouer(code, 'ecrit')
      await pause(100)
      assert.deepEqual(journal, ['pose'])
      assert.equal(texte, 'trueL')
    })

    it(':attach.once n\'est jamais rejouée, le gabarit se redessine', async () => {
      const window: any = new Window({ url: 'http://localhost/' })
      try {
        window.__j = []
        window.eval(code)
        window.document.body.innerHTML = '<mjs-une-fois></mjs-une-fois>'
        const el = window.document.querySelector('mjs-une-fois')
        await attendre(() => window.__j.length > 0)
        el.bump()
        el.bump()
        await attendre(() => ((el._shadow ?? el).textContent ?? '').trim() === '2')
        await pause(100)
        assert.equal(((el._shadow ?? el).textContent ?? '').trim(), '2')
        assert.deepEqual([...window.__j], ['pose 0'])
      }
      finally {
        await window.happyDOM.close()
      }
    })

    it('lecture et écriture de la même variable ($n += 1) : la fonction fait comme la méthode, la garde des 10 000 rendus coupe la boucle', async () => {
      const locale  = await jouer(code, 'boucle-fonction')
      const methode = await jouer(code, 'boucle-methode')
      const poses   = (journal: string[]) => journal.filter((e) => e === 'pose').length
      assert.equal(poses(locale.journal), poses(methode.journal))
      assert.equal(locale.texte, methode.texte)
      assert.ok(poses(locale.journal) > 10000 && poses(locale.journal) < 30000, `${poses(locale.journal)} passages`)
      if (mode === 'dev') assert.equal(locale.avertissements.filter((a) => a.includes('<mjs-boucle-fonction>') && /10\s000/.test(a)).length, 1, locale.avertissements.join('\n'))
    })

    it('ligne de {for} et branche {await} : rejouée quand $x change', async () => {
      for (const nom of ['ligne', 'branche']) {
        const { journal } = await jouer(code, nom, ['bump'])
        assert.deepEqual(journal.slice(-2), ['net', 'pose 1'], `${nom} : ${journal.join(', ')}`)
      }
    })
  })
})
