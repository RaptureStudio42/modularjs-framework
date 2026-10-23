// Une plage de Civet (`[1..$n]`) lue dans un attribut suit ses variables, comme dans un texte : la vue
// se remet à jour quand `$n` change. Trois écritures la perdaient — la valeur d'un `@style.x={…}` ou
// d'une propriété CSS `--v={…}` (le contenu passait au compilateur AVEC ses accolades, qu'il lisait
// comme un objet : « dépendances non analysables », vue figée), et un attribut texte à raccourci
// `$var` comme `title="$min..$max"` (les `..` du texte étaient pris pour une plage, le texte entier
// compilé comme du code) ; de même pour les points de suspension qui suivent une variable
// (`title="$n..."`) et l'apostrophe d'une phrase (`title="l'exemple $min"`). Un `$` qui suit `..` ou `...` est
// une variable, du texte avant ou après les accolades (`title="{$min}..$max"`, `title="Chargement...$n"`) ; un `$`
// après un seul point (`title="v1.$n"`) reste du texte.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function monter(prefixe: string, fichiers: Record<string, string>) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang   = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code   = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${code}\nglobalThis.µ = µ;`)
  return window
}

const ENTETE = `<script>
  $n   = 3
  $min = 1
  $max = 5
</script>
`

const PAGE = ENTETE + `<b class="s" @style.width={[1..$n].length * 10 + 'px'}>x</b>
<b class="m" @style.width="{[1..$n].length * 10}px">x</b>
<b class="v" --w={[1..$n].length * 10 + 'px'}>x</b>
<b class="vm" --w="{[1..$n].length * 10}px">x</b>
<b class="t" title="$min..$max">x</b>
<input class="p" aria-label="p" placeholder="$min..$max">
<b class="x" title="$min..{[1..$max].length}">x</b>
<b class="y" title="{$min}..$max">x</b>
<b class="z" title="{$min}...$max">x</b>
<b class="ch" title="Chargement...$n">x</b>
<b class="ch2" title="Chargement..$n">x</b>
<button class="n" @click={$n = 7}>n</button>
<button class="b" @click={$max = 9}>b</button>
`

// chaque écriture seule : (nom, balise, variables que la vue doit suivre)
const ECRITURES: [string, string, string[]][] = [
  ['@style.x={[1..$n]…}',           '<b @style.width={[1..$n].length * 10 + \'px\'}>x</b>',         ['n']],
  ['@style.x="{[1..$n]…}px"',       '<b @style.width="{[1..$n].length * 10}px">x</b>',              ['n']],
  ['--v={[1..$n]…}',                '<b --w={[1..$n].length * 10 + \'px\'}>x</b>',                  ['n']],
  ['--v="{[1..$n]…}px"',            '<b --w="{[1..$n].length * 10}px">x</b>',                       ['n']],
  ['@style.x={[$min..$max]…}',      '<b @style.width={[$min..$max].length * 10 + \'px\'}>x</b>',    ['min', 'max']],
  ['title="$min..$max"',            '<b title="$min..$max">x</b>',                                  ['min', 'max']],
  ['placeholder="$min..$max"',      '<input aria-label="p" placeholder="$min..$max">',              ['min', 'max']],
  ['title="$n..."',                 '<b title="$n...">x</b>',                                       ['n']],
  ['title="$min..{[1..$max]…}"',    '<b title="$min..{[1..$max].length}">x</b>',                    ['min', 'max']],
  ['title="{[1..$n]…+ $min}"',      '<b title="{[1..$n].length + $min}">x</b>',                     ['n', 'min']],
  ['title="{$min}..{$max}"',        '<b title="{$min}..{$max}">x</b>',                              ['min', 'max']],
  ['title="{$min}..$max"',          '<b title="{$min}..$max">x</b>',                                ['min', 'max']],
  ['title="{$min}...$max"',         '<b title="{$min}...$max">x</b>',                               ['min', 'max']],
  ['title="Chargement...$n"',       '<b title="Chargement...$n">x</b>',                             ['n']],
  ['title="Chargement..$n"',        '<b title="Chargement..$n">x</b>',                              ['n']],
  ['placeholder="Chargement...$n"', '<input aria-label="p" placeholder="Chargement...$n">',        ['n']],
  ['title="l\'exemple $min"',       '<b title="l\'exemple $min">x</b>',                             ['min']],
  ['title="#$min" (déjà juste)',    '<b title="#$min">x</b>',                                       ['min']],
  ['title="$$s" (déjà juste)',      '<b title="$$s">x</b>',                                         ['$$s']]
]

describe('plage de Civet et points de suspension dans un attribut : la vue suit les variables', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const [nom, balise, suivies] of ECRITURES) {
    it(`${nom} : la compilation suit ${suivies.map((v) => v.startsWith('$') ? v : '$' + v).join(', ')} et n'avertit de rien`, async () => {
      const avertissements: string[] = []
      const warn = console.warn
      console.warn = (...args: any[]) => { avertissements.push(args.join(' ')) }
      let output = ''
      try {
        output = (await transpile(ENTETE + balise + '\n', { moduleName: 'card' } as any)).output
      }
      finally {
        console.warn = warn
      }
      const analyse = avertissements.filter((a) => a.includes('non analysables'))
      assert.deepEqual(analyse, [], 'aucun avertissement « dépendances non analysables »')
      const abonnees = output.match(/_mjs_effectsByVar = (\{[^\n]*\})/)?.[1] ?? ''
      for (const v of suivies) assert.ok(abonnees.includes(`"${v}"`), `${v.startsWith('$') ? v : '$' + v} suivie : ${abonnees || '(aucune variable suivie)'}`)
    })
  }

  // `$` après un seul point : du texte (« v1.$n », un nom de fichier) ; rien n'y est suivi
  for (const texte of ['v1.$n', '.$n']) {
    it(`title="${texte}" : un $ après un seul point reste du texte, aucune variable suivie`, async () => {
      const { output } = await transpile(ENTETE + `<b title="${texte}">x</b>\n`, { moduleName: 'card' } as any)
      assert.equal(output.match(/_mjs_effectsByVar = (\{[^\n]*\})/)?.[1], '{}', 'aucune variable suivie')
      assert.ok(output.includes(`title='${texte}'`), 'le texte reste écrit tel quel dans la balise')
    })
  }

  it('title="v1.$n et $n" : le $ isolé est suivi, celui du point reste du texte', async () => {
    const { output } = await transpile(ENTETE + '<b title="v1.$n et $n">x</b>\n', { moduleName: 'card' } as any)
    assert.ok((output.match(/_mjs_effectsByVar = (\{[^\n]*\})/)?.[1] ?? '').includes('"n"'), '$n suivie')
    assert.ok(output.includes('`v1.$n et ${$.n}`'), 'seul le deuxième $n est une variable')
  })

  it('la vue se remet à jour quand $n, $min ou $max change', async () => {
    const window = await monter('plage-suivie', { 'demo-plage.mjs': PAGE })
    try {
      window.document.body.innerHTML = '<mjs-demo-plage></mjs-demo-plage>'
      const c = window.document.querySelector('mjs-demo-plage')
      await attendre(() => !!c._shadow?.querySelector('.s'))
      await pause(40)
      const lire = (cls: string) => c._shadow.querySelector('.' + cls)
      const v = (cls: string) => lire(cls).style.getPropertyValue('--w')
      assert.equal(lire('s').style.width, '30px', 'montage : @style.x')
      assert.equal(lire('m').style.width, '30px', 'montage : @style.x en texte')
      assert.equal(v('v'), '30px', 'montage : --v')
      assert.equal(v('vm'), '30px', 'montage : --v en texte')
      assert.equal(lire('t').getAttribute('title'), '1..5', 'montage : title="$min..$max"')
      assert.equal(lire('p').getAttribute('placeholder'), '1..5', 'montage : placeholder')
      assert.equal(lire('x').getAttribute('title'), '1..5', 'montage : texte mêlé d\'une plage')
      assert.equal(lire('y').getAttribute('title'), '1..5', 'montage : accolades puis raccourci')
      assert.equal(lire('z').getAttribute('title'), '1...5', 'montage : accolades, trois points, raccourci')
      assert.equal(lire('ch').getAttribute('title'), 'Chargement...3', 'montage : trois points avant le raccourci')
      assert.equal(lire('ch2').getAttribute('title'), 'Chargement..3', 'montage : deux points avant le raccourci')
      lire('n').click()
      await pause(60)
      assert.equal(lire('s').style.width, '70px', '$n change : @style.x suit')
      assert.equal(lire('m').style.width, '70px', '$n change : @style.x en texte suit')
      assert.equal(v('v'), '70px', '$n change : --v suit')
      assert.equal(v('vm'), '70px', '$n change : --v en texte suit')
      assert.equal(lire('ch').getAttribute('title'), 'Chargement...7', '$n change : trois points avant le raccourci suit')
      assert.equal(lire('ch2').getAttribute('title'), 'Chargement..7', '$n change : deux points avant le raccourci suit')
      lire('b').click()
      await pause(60)
      assert.equal(lire('t').getAttribute('title'), '1..9', '$max change : title="$min..$max" suit')
      assert.equal(lire('p').getAttribute('placeholder'), '1..9', '$max change : placeholder suit')
      assert.equal(lire('x').getAttribute('title'), '1..9', '$max change : texte mêlé d\'une plage suit')
      assert.equal(lire('y').getAttribute('title'), '1..9', '$max change : accolades puis raccourci suit')
      assert.equal(lire('z').getAttribute('title'), '1...9', '$max change : accolades, trois points, raccourci suit')
    }
    finally {
      window.close()
    }
  })
})
