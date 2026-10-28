// L'ancienne écriture d'une transition (`@in.fly={…}`, `@in.zoom`) est refusée avec la nouvelle, et la
// nouvelle COMPILE et JOUE : chaque écriture que le message propose est essayée telle quelle.
//   · les quatre animations retirées (zoom, zoomOut, elastic_fly, elastic_scale) n'ont pas d'effet du même
//     nom — `@in=*zoom` est refusé, `@in=*elastic_fly` ne joue rien : le message donne l'effet qui les remplace ;
//   · un modificateur écrit (`@in.fly.shared`) reste sur la directive proposée, le message ne propose pas
//     `.global` à sa place ;
//   · le réglage donné en exemple, quand aucun n'est écrit, est un réglage que l'effet a ;
//   · un effet écrit entre guillemets (`@in.global="*fly"`) garde son modificateur dans la proposition ;
//   · les réglages écrits passent dans la proposition, convertis (`{ y: 22, duration: 220 }` →
//     `*fly(up, distance: 22, duration: 220ms)`), pour chaque animation et chaque réglage qu'elle lisait ;
//   · un réglage calculé n'est jamais proposé entre accolades : le message conseille une variable `$…` ;
//   · toutes les anciennes écritures d'un composant, et de chaque composant du projet, dans une seule construction.

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

/** le message d'erreur de la compilation d'un composant écrit en entier (son `<script>` compris) */
async function compilerTexte(texte: string): Promise<{ message: string, avertissements: string[] }> {
  const avertissements: string[] = []
  const warn = console.warn
  console.warn = (...args: any[]) => { avertissements.push(args.join(' ')) }
  let message = ''
  try {
    await transpile(texte, { moduleName: 'card' } as any)
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
  ['@out.zoom={ duration: 300 }',    /écrivez @out=\*scale\(start: 0\.55, duration: 300ms\)/,  /@out=\*zoom/],
  ['@in.zoom.shared',                /écrivez @in\.shared=\*scale\(start: 0\.55\)/,            /\.global/],
  ['@in.fly.shared={ y: 200 }',      /écrivez @in\.shared=\*fly\(up, distance: 200\)/,        /\.global/],
  ['@transition.fade.global',        /écrivez @transition\.global=\*fade/,                     null],
  ['@in.fly',                        /écrivez @in=\*fly, [^;]*@in=\*fly\(duration: 400ms\)\) ; [^.]*@in\.global=\*fly/, null],
  ['@in.fly={ y: 200 }',             /écrivez @in=\*fly\(up, distance: 200\) ; [^.]*@in\.global=\*fly/, /duration: 400ms/],
  ['@in.typewriter',                 /écrivez @in=\*typewriter, [^;]*@in=\*typewriter\(speed: 30\)/, /duration/],
  ['@in.typewriter={ speed: 100 }',  /écrivez @in=\*typewriter\(speed: 100\)/,               /speed: 30/],
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

  // chaque animation d'avant, avec les réglages qu'elle lisait : (écriture d'avant, écriture proposée)
  const FORMES: Array<[string, string]> = [
    ['@in.fly={ y: 22, duration: 220 }',                                   '@in=*fly(up, distance: 22, duration: 220ms)'],
    ['@in.fly={ y: 200, duration: 2000 }',                                 '@in=*fly(up, distance: 200, duration: 2s)'],
    ['@out.fly={ y: -30, opacity: 0.5 }',                                  '@out=*fly(down, distance: 30, opacity: 0.5)'],
    ['@in.fly={ x: 100 }',                                                 '@in=*fly(left, distance: 100)'],
    ['@in.fly={ x: \'-50%\' }',                                            '@in=*fly(right, distance: 50%)'],
    ['@in.fly={ x: 100, y: 100 }',                                         '@in=*fly(up-left, distance: 141.42)'],
    ['@in.fly={ x: -30, y: 40, delay: 50 }',                               '@in=*fly(direction: 36.87, distance: 50, delay: 50ms)'],
    ['@in.fly={{y: 20}}',                                                  '@in=*fly(up, distance: 20)'],
    ['@transition.fly.global={y: -10}',                                    '@transition.global=*fly(down, distance: 10)'],
    ['@transition.fade={ duration: 1500, delay: 100, easing: \'cubicOut\' }', '@transition=*fade(duration: 1500ms, delay: 100ms, easing: cubic-out)'],
    ['@in.fade={ easing: µ.easing.quadInOut }',                            '@in=*fade(easing: quad-in-out)'],
    ['@out.fade={ easing: \'ease-in\' }',                                  '@out=*fade(easing: ease-in)'],
    ['@transition.slide={ axis: \'x\', duration: 300 }',                   '@transition=*slide(x, duration: 300ms)'],
    ['@in.scale={ start: 0.5, opacity: 0.2 }',                             '@in=*scale(start: 0.5, opacity: 0.2)'],
    ['@out.blur={ amount: 10, opacity: 0.3 }',                             '@out=*blur(amount: 10, opacity: 0.3)'],
    ['@in.draw={ speed: 0.5 }',                                            '@in=*draw(speed: 500)'],
    ['@in.draw={ duration: 1200, easing: \'linear\' }',                    '@in=*draw(duration: 1200ms, easing: linear)'],
    ['@in.typewriter={speed: 10}',                                         '@in=*typewriter(speed: 10)'],
    ['@in.iris={ duration: 500 }',                                         '@in=*iris(duration: 500ms)'],
    ['@in.volet={ dir: \'down\' }',                                        '@in=*volet(down)'],
    ['@in.reveal={ direction: \'left\', duration: 400 }',                  '@in=*reveal(left, duration: 400ms)'],
    ['@out.swipe={ dir: \'left\' }',                                       '@out=*swipe(left)'],
    ['@in.flip={ dir: \'right\' }',                                        '@in=*flip(right)'],
    ['@in.cube={ dir: \'up\' }',                                           '@in=*cube(up)'],
    ['@out.turn={ dir: \'down\' }',                                        '@out=*turn(down)'],
    ['@transition.bars={ dir: \'up\', duration: 900 }',                    '@transition=*bars(up, duration: 900ms)'],
    ['@in.bars={ count: 12 }',                                             '@in=*bars(count: 12)'],
    ['@in.blocks={ cols: 8, rows: 3 }',                                    '@in=*blocks(cols: 8, rows: 3)'],
    ['@in.zoom={ start: 0.3 }',                                            '@in=*scale(start: 0.3)'],
    ['@in.zoomOut={ opacity: 0.5, duration: 450 }',                        '@in=*scale(start: 1.45, opacity: 0.5, duration: 450ms)'],
    ['@in.elastic_fly={ y: 80 }',                                          '@in=*fly(up, easing: elastic-out, distance: 80)'],
    ['@in.elastic_scale={ start: 0.2, duration: 1200 }',                   '@in=*scale(easing: elastic-out, start: 0.2, duration: 1200ms)']
  ]

  for (const [ancienne, proposee] of FORMES) {
    it(`${ancienne} : écrivez ${proposee}`, async () => {
      const { message } = await compiler(balise(ancienne))
      assert.ok(message.includes(`écrivez ${proposee}`), message)
    })
  }

  it('chaque écriture proposée avec ses réglages compile, sans erreur ni avertissement', async () => {
    for (const [, proposee] of FORMES) {
      const { message, avertissements } = await compiler(balise(proposee))
      assert.equal(message, '', `${proposee} : refusée — ${message}`)
      assert.deepEqual(avertissements, [], `${proposee} : compile avec des avertissements`)
    }
  })

  it('un réglage que l\'animation ne lisait pas, ou sans équivalent (steps), est dit retiré', async () => {
    const { message } = await compiler(balise('@in.fade={ steps: 30, duration: 200, y: 4 }'))
    assert.ok(message.includes('écrivez @in=*fade(duration: 200ms)'), message)
    assert.match(message, /steps, y : aucun équivalent, retirés/, message)
    const typewriter = await compiler(balise('@in.typewriter={ speed: 20, easing: \'linear\' }'))
    assert.ok(typewriter.message.includes('écrivez @in=*typewriter(speed: 20)'), typewriter.message)
    assert.match(typewriter.message, /easing : aucun équivalent, retiré(?!s)/, typewriter.message)
  })

  describe('un réglage calculé : une variable $…, jamais d\'accolades', function () {
    const VARS = '<script>\n$vu = false\n$h = 80\n$d = 100\n$hauteur = 40\n$distance = 40\n$duration = 200\n</script>\n'
    const compilerAvec = (corps: string) => compilerTexte(VARS + corps + '\n')

    it('@in.fly={ y: $h / 2, duration: 220 } : distance: $distance, et $distance = $h / 2 dans le <script>', async () => {
      const { message } = await compilerAvec(balise('@in.fly={ y: $h / 2, duration: 220 }'))
      assert.ok(message.includes('écrivez @in=*fly(up, distance: $distance, duration: 220ms)'), message)
      assert.ok(message.includes('$distance = $h / 2'), message)
      assert.match(message, /<script>/, message)
      assert.doesNotMatch(message.split('écrivez ')[1] ?? '', /^[^ ]*\{/, message)
    })

    it('une variable seule s\'écrit telle quelle', async () => {
      const { message } = await compilerAvec(balise('@in.fly={ y: $hauteur, easing: $courbe }'))
      assert.ok(message.includes('écrivez @in=*fly(up, distance: $hauteur, easing: $courbe)'), message)
      assert.doesNotMatch(message, /se calcule/, message)
    })

    it('@out.fade={ duration: $d * 2 } : duration: $duration, et $duration = $d * 2', async () => {
      const { message } = await compilerAvec(balise('@out.fade={ duration: $d * 2 }'))
      assert.ok(message.includes('écrivez @out=*fade(duration: $duration)'), message)
      assert.ok(message.includes('$duration = $d * 2'), message)
    })

    it('@in.fly={$reglages} : tout l\'objet se calcule — un réglage à la fois, en variable', async () => {
      const { message } = await compilerAvec(balise('@in.fly={$reglages}'))
      assert.ok(message.includes('écrivez @in=*fly'), message)
      assert.match(message, /ses réglages se calculent \(\$reglages\)/, message)
      assert.match(message, /\*fly\(duration: \$duration\)/, message)
    })

    it('x et y calculés ensemble : une direction et une distance à écrire', async () => {
      const { message } = await compilerAvec(balise('@in.fly={ x: $d, y: $h }'))
      assert.match(message, /x et y se calculent \(\$d, \$h\)/, message)
    })

    it('les propositions à variable compilent', async () => {
      for (const ecriture of ['@in=*fly(up, distance: $distance, duration: 220ms)', '@in=*fly(up, distance: $hauteur)', '@out=*fade(duration: $duration)']) {
        const { message, avertissements } = await compilerAvec(balise(ecriture))
        assert.equal(message, '', `${ecriture} : refusée — ${message}`)
        assert.deepEqual(avertissements, [], `${ecriture} : compile avec des avertissements`)
      }
    })
  })

  describe('toutes les anciennes écritures dans une seule construction', function () {
    it('un composant : une seule erreur, chaque écriture avec sa ligne et sa proposition', async () => {
      const corps = [
        '{if $vu}',
        '<p class="x" @in.fly={ y: 22, duration: 220 } @out.fade>a</p>',
        '<div>',
        '  <span @transition.zoom>b</span>',
        '</div>',
        '{end}'
      ].join('\n')
      const { message } = await compiler(corps)
      assert.match(message, /\[ModularJS\] 3 transitions de ce composant/, message)
      assert.ok(message.includes('ligne 5 : @in.fly={ y: 22, duration: 220 } → @in=*fly(up, distance: 22, duration: 220ms)'), message)
      assert.ok(message.includes('ligne 5 : @out.fade → @out=*fade'), message)
      assert.ok(message.includes('ligne 7 : @transition.zoom → @transition=*scale(start: 0.55) ; zoom n\'existe plus'), message)
    })

    it('le projet : chaque composant donne toutes les siennes, en une construction', async () => {
      const root   = mjsTmp('transitions-anciennes-projet')
      const srcDir = join(root, 'src')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'tp-un.mjs'), ENTETE + '{if $vu}<p @in.fly={ y: 10 }>a</p><p @out.fade={ duration: 300 }>b</p>{end}\n')
      writeFileSync(join(srcDir, 'tp-deux.mjs'), ENTETE + '{if $vu}<p @in.slide>a</p><p @out.blur={ amount: 3 }>b</p>{end}\n')
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      const tout = stats.errors.map((e: any) => String(e.message)).join('\n')
      for (const proposee of ['@in=*fly(up, distance: 10)', '@out=*fade(duration: 300ms)', '@in=*slide', '@out=*blur(amount: 3)']) assert.ok(tout.includes(proposee), `${proposee} absente :\n${tout}`)
      assert.equal(stats.errors.length, 2, tout)
    })
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
    const reglee = await compiler(balise('@in.fly={ y: 22, duration: 220 }'))
    assert.ok(reglee.message.includes('write @in=*fly(up, distance: 22, duration: 220ms)'), reglee.message)
    const calcul = await compiler(balise('@in.fly={ y: $h / 2 }'))
    assert.ok(calcul.message.includes('$distance = $h / 2'), calcul.message)
    assert.match(calcul.message, /distance is computed/, calcul.message)
    const plusieurs = await compiler('{if $vu}<p @in.fly={ y: 22 } @out.fade>a</p>{end}')
    assert.match(plusieurs.message, /\[ModularJS\] 2 transitions of this component/, plusieurs.message)
    assert.ok(plusieurs.message.includes('line 4: @out.fade → @out=*fade'), plusieurs.message)
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
