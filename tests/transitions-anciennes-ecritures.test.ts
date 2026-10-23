// L'ancienne écriture d'une transition (`@in.fly={…}`, `@in.zoom`) est refusée avec la nouvelle, et la
// nouvelle COMPILE et JOUE : chaque écriture que le message propose est essayée telle quelle.
//   · les quatre animations retirées (zoom, zoomOut, elastic_fly, elastic_scale) n'ont pas d'effet du même
//     nom — `@in=*zoom` est refusé, `@in=*elastic_fly` ne joue rien : le message donne l'effet qui les remplace ;
//   · un modificateur écrit (`@in.fly.shared`) reste sur la directive proposée, le message ne propose pas
//     `.global` à sa place ;
//   · le réglage donné en exemple est un réglage que l'effet a (la vitesse de `*typewriter`) ;
//   · un effet écrit entre guillemets (`@in.global="*fly"`) garde son modificateur dans la proposition.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ENTETE = '<script>\n$vu = false\n</script>\n'

/** le message d'erreur de la compilation d'un composant, ou '' quand elle réussit ; les avertissements à part */
async function compiler(corps: string): Promise<{ message: string, avertissements: string[] }> {
  const avertissements: string[] = []
  const warn = console.warn
  console.warn = (...args: any[]) => { avertissements.push(args.join(' ')) }
  let message = ''
  try {
    await transpile(ENTETE + corps + '\n', { moduleName: 'card' } as any)
  }
  catch (e: any) {
    message = String(e.message)
  }
  finally {
    console.warn = warn
  }
  return { message, avertissements: avertissements.filter((a) => !a.includes('lint.a11y')) }
}

/** les écritures `@in=*fly(…)` qu'un message propose */
const propositions = (message: string): string[] => [...new Set(message.match(/@(?:in|out|transition)(?:\.(?:global|shared))*=\*[A-Za-z_]+(?:\([^)]*\))?/g) ?? [])]

const balise = (ecriture: string) => `{if $vu}<p class="x" ${ecriture}>texte</p>{end}`

// (écriture d'avant, ce que le message doit proposer, ce qu'il ne doit pas dire)
const CAS: Array<[string, RegExp, RegExp | null]> = [
  ['@in.zoom',                       /écrivez @in=\*scale\(start: 0\.55\)/,                    /@in=\*zoom/],
  ['@in.zoomOut',                    /écrivez @in=\*scale\(start: 1\.45\)/,                    /@in=\*zoomOut/],
  ['@in.elastic_fly',                /écrivez @in=\*fly\([^)]*easing: elastic-out\)/,          /@in=\*elastic_fly/],
  ['@in.elastic_scale',              /écrivez @in=\*scale\(easing: elastic-out\)/,             /@in=\*elastic_scale/],
  ['@out.zoom={ duration: 300 }',    /écrivez @out=\*scale\(start: 0\.55\)/,                   /@out=\*zoom/],
  ['@in.zoom.shared',                /écrivez @in\.shared=\*scale\(start: 0\.55\)/,            /\.global/],
  ['@in.fly.shared={ y: 200 }',      /écrivez @in\.shared=\*fly/,                              /\.global/],
  ['@transition.fade.global',        /écrivez @transition\.global=\*fade/,                     null],
  ['@in.fly={ y: 200 }',             /écrivez @in=\*fly, [^;]*@in=\*fly\(duration: 400ms\)\) ; [^.]*@in\.global=\*fly/, null],
  ['@in.typewriter={ speed: 100 }',  /écrivez @in=\*typewriter, [^;]*@in=\*typewriter\(speed: 30\)/, /duration/],
  ['@out.fade',                      /écrivez @out=\*fade/,                                    null],
  ['@in.global="*fly"',              /sans guillemets — @in\.global=\*fly\./,                 /sans guillemets — @in=\*fly/],
  ['@out.shared=\'*fade\'',          /sans guillemets — @out\.shared=\*fade\./,                /sans guillemets — @out=\*fade/]
]

describe('anciennes transitions : le message propose une écriture qui compile et qui joue', function () {
  this.timeout(60000)

  afterEach(() => setMessagesLang('fr'))

  for (const [ancienne, attendu, interdit] of CAS) {
    it(`${ancienne} : le message propose la bonne écriture`, async () => {
      const { message } = await compiler(balise(ancienne))
      assert.ok(message, `refusé à la compilation (${ancienne})`)
      assert.match(message, attendu, message)
      if (interdit) assert.doesNotMatch(message, interdit, message)
    })
  }

  it('chaque écriture proposée compile, sans erreur ni avertissement', async () => {
    const vues = new Set<string>()
    for (const [ancienne] of CAS) {
      const { message } = await compiler(balise(ancienne))
      for (const ecriture of propositions(message)) vues.add(ecriture)
    }
    assert.ok(vues.size >= 12, `de quoi essayer (${[...vues].join(' | ')})`)
    for (const ecriture of vues) {
      const { message, avertissements } = await compiler(balise(ecriture))
      assert.equal(message, '', `${ecriture} : refusée — ${message}`)
      assert.deepEqual(avertissements, [], `${ecriture} : compile avec des avertissements`)
    }
  })

  it('en anglais aussi : l\'effet qui remplace une animation retirée, le modificateur gardé', async () => {
    setMessagesLang('en')
    const zoom = await compiler(balise('@in.zoom'))
    assert.match(zoom.message, /write @in=\*scale\(start: 0\.55\)/, zoom.message)
    const partage = await compiler(balise('@in.fly.shared={ y: 200 }'))
    assert.match(partage.message, /write @in\.shared=\*fly/, partage.message)
    assert.doesNotMatch(partage.message, /\.global/, partage.message)
    const guillemets = await compiler(balise('@in.global="*fly"'))
    assert.match(guillemets.message, /without quotes — @in\.global=\*fly\./, guillemets.message)
  })

  describe('les remplaçantes jouent (happy-dom, un faux animate)', function () {
    let window: any
    let animateAvant: any
    const anims: any[] = []
    const REMPLACANTES: Record<string, string> = {
      zoom:          '@in=*scale(start: 0.55)',
      zoomOut:       '@in=*scale(start: 1.45)',
      elastic_fly:   '@in=*fly(up, easing: elastic-out)',
      elastic_scale: '@in=*scale(easing: elastic-out)'
    }

    before(async () => {
      const root   = mjsTmp('transitions-anciennes')
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      for (const [nom, ecriture] of Object.entries(REMPLACANTES)) writeFileSync(join(srcDir, `ta-${nom.replace('_', '-').toLowerCase()}.mjs`), ENTETE + balise(ecriture) + '\n')
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
      window = new Window({ url: 'http://localhost/' })
      // la classe Element est partagée par toutes les fenêtres : le vrai animate (aucun sous happy-dom) est rendu après les tests
      animateAvant = window.Element.prototype.animate
      window.Element.prototype.animate = function (keyframes: any, opts: any) {
        let fin: any
        const a: any = {
          el: this, keyframes, opts, paused: false, currentTime: 0, playState: 'running',
          finished: new Promise((r) => { fin = r }),
          effect: { getComputedTiming: () => ({ progress: a.done ? 1 : 0 }) },
          cancel() { a.cancelled = true; fin(a) },
          pause() { a.paused = true; a.playState = 'paused' },
          play() { a.paused = false },
          finish() { a.done = true; fin(a) }
        }
        anims.push(a)
        setTimeout(() => { if (!a.paused && !a.cancelled) { a.done = true; fin(a) } }, 5)
        return a
      }
      window.eval(`${code}\nglobalThis.µ = µ;`)
    })

    after(async () => {
      if (animateAvant === undefined) delete window?.Element?.prototype?.animate
      else if (window) window.Element.prototype.animate = animateAvant
      window?.close?.()
      await terminateSharedWorkerPool()
    })

    for (const [nom, ecriture] of Object.entries(REMPLACANTES)) {
      it(`${ecriture} (ex-${nom}) : la balise entre en jouant une animation`, async () => {
        const tag = `mjs-ta-${nom.replace('_', '-').toLowerCase()}`
        window.document.body.innerHTML = `<${tag}></${tag}>`
        const comp = window.document.querySelector(tag)
        const fin  = Date.now() + 3000
        while (!comp._shadow && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
        await new Promise((r) => setTimeout(r, 20))
        comp._set('vu', true)
        const jouee = () => anims.filter((a) => a.el === comp._shadow.querySelector('.x') && a.keyframes.length > 2)
        const fin2  = Date.now() + 3000
        while (jouee().length === 0 && Date.now() < fin2) await new Promise((r) => setTimeout(r, 10))
        assert.ok(jouee().length > 0, 'une animation d\'entrée a été lancée')
      })
    }
  })
})
