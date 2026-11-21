// Une attache qui écrit, pendant sa partie synchrone, une variable qu'elle lit (`$size = 10 if $size isnt 10`) est rejouée dans son
// propre passage : le passage imbriqué pose son nettoyage sur la balise avant que le passage qui l'englobe ait fini. Le défaut : le
// passage englobant écrasait ce nettoyage par le sien, celui du passage imbriqué n'était plus appelé qu'à la destruction du composant
// (un observateur de taille, un écouteur de défilement restaient branchés sur une balise retirée). Les deux nettoyages sont gardés,
// enchaînés (l'imbriqué, puis l'englobant), et tournent au passage suivant ou au retrait de la balise : chaque pose a son nettoyage,
// rien n'attend la destruction du composant. Une minuterie posée avant l'écriture tourne jusqu'au nettoyage de sa pose, jamais
// après le retrait de la balise. Une attache qui lit et écrit la même variable (`$n += 1`) garde ses passages (la garde des 10 000
// rendus d'une rafale coupe la boucle) et a, elle aussi, chaque pose nettoyée. Forme méthode et forme fonction du `<script>`, en
// développement comme en production ; l'aide du cœur qui garde ces nettoyages n'entre au cœur qu'avec une attache
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// attache (méthode `@watch` ou fonction `watch`) qui note chacun de ses passages et le nettoyage de chacun ; elle écrit `$size`, qu'elle
// lit, au premier passage seulement ; `minuterie` : une minuterie posée avant l'écriture compte ses tours, passage par passage
const J        = 'globalThis.__j.push'
const regarder = (nom: string, minuterie: boolean) => `${nom} = (n) ->\n  id = ++globalThis.__k\n  ${J}('pose ' + id)\n${minuterie ? '  µevery 20, immediate: false, -> globalThis.__t[id] = (globalThis.__t[id] or 0) + 1\n' : ''}  $size = 10 if $size isnt 10\n  -> ${J}('net ' + id)\n`
const boucle   = (nom: string) => `${nom} = (n) ->\n  ${J}('pose')\n  $n += 1\n  -> ${J}('net')\n`

const SOURCES: Record<string, string> = {
  'imbrique-methode': `<script>\n$show = true\n$size = 0\n${regarder('@watch', false)}@hide = -> $show = false\n</script>\n{if $show}<div :attach={@watch(_node)}>w</div>{end}\n`,
  'imbrique-fonction': `<script>\n$show = true\n$size = 0\n${regarder('watch', false)}@hide = -> $show = false\n</script>\n{if $show}<div :attach={watch(_node)}>w</div>{end}\n`,
  // la balise apparaît après le montage : aucun rendu complet ne rejoue l'attache derrière ses deux passages
  'minuterie-methode': `<script>\n$show = false\n$size = 0\n${regarder('@watch', true)}@open = -> $show = true\n@hide = -> $show = false\n</script>\n{if $show}<div :attach={@watch(_node)}>w</div>{end}\n`,
  'minuterie-fonction': `<script>\n$show = false\n$size = 0\n${regarder('watch', true)}@open = -> $show = true\n@hide = -> $show = false\n</script>\n{if $show}<div :attach={watch(_node)}>w</div>{end}\n`,
  'boucle-methode': `<script>\n$show = true\n$n = 0\n${boucle('@f')}@hide = -> $show = false\n</script>\n{if $show}<div :attach={@f(_node)}>{$n}</div>{end}\n`,
  'boucle-fonction': `<script>\n$show = true\n$n = 0\n${boucle('f')}@hide = -> $show = false\n</script>\n{if $show}<div :attach={f(_node)}>{$n}</div>{end}\n`
}

// des crochets de destruction (`:this=!`) sans aucune attache
const SANS_ATTACHE: Record<string, string> = {
  'sans-attache': `<script>\nbox = null\n</script>\n<div :this=!{box}>b</div>\n`
}

// `lisible` : production sans le raccourcissement des noms, pour lire le cœur
async function bundle(mode: 'dev' | 'prod', sources: Record<string, string>, nom: string, lisible = false): Promise<string> {
  const root   = mjsTmp(`attache-passage-imbrique-${nom}-${mode}`)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [composant, source] of Object.entries(sources)) writeFileSync(join(srcDir, `${composant}.mjs`), source)
  const opts: any = mode === 'prod' ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle', ...(lisible ? { minify: false } : {}) } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
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

// attend que le journal ne bouge plus
async function calme(window: any) {
  let taille = -1
  while (window.__j.length !== taille) {
    taille = window.__j.length
    await pause(60)
  }
}

// monte le composant dans une page neuve
async function monter(code: string, nom: string): Promise<{ window: any; el: any; erreurs: string[] }> {
  const window: any = new Window({ url: 'http://localhost/' })
  const erreurs: string[] = []
  window.addEventListener('error', (e: any) => erreurs.push(String(e.message ?? e.error)))
  window.console.error = (...a: any[]) => erreurs.push(String(a[0]))
  window.console.warn = () => {}
  window.__j = []
  window.__k = 0
  window.__t = {}
  window.eval(code)
  window.document.body.innerHTML = `<mjs-${nom}></mjs-${nom}>`
  const el = window.document.querySelector(`mjs-${nom}`)
  await pause(100)
  await calme(window)
  return { window, el, erreurs }
}

const ids = (journal: string[], quoi: string) => journal.filter((e) => e.startsWith(quoi + ' ')).map((e) => e.slice(quoi.length + 1)).sort()

describe('attache rejouée dans son propre passage : chaque pose a son nettoyage au retrait de la balise', function () {
  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev', 'prod'] as const) describe(mode === 'dev' ? 'développement' : 'production', function () {
    this.timeout(120000)

    let code = ''

    before(async () => {
      code = await bundle(mode, SOURCES, 'scenes')
    })

    for (const forme of ['methode', 'fonction']) {
      it(`${forme} : elle écrit $size qu'elle lit ; la balise retirée, chaque pose a eu son nettoyage, rien n'attend la destruction du composant`, async () => {
        const { window, el, erreurs } = await monter(code, `imbrique-${forme}`)
        try {
          const montage = [...window.__j]
          assert.deepEqual(montage.slice(0, 2), ['pose 1', 'pose 2'], `rejouée dans son propre passage : ${montage.join(', ')}`)
          el.hide()
          await calme(window)
          const journal = [...window.__j]
          assert.deepEqual(ids(journal, 'net'), ids(journal, 'pose'), journal.join(', '))
          el.remove()
          await pause(80)
          assert.deepEqual([...window.__j], journal, 'rien de plus à la destruction du composant')
          assert.deepEqual(erreurs, [])
        }
        finally {
          await window.happyDOM.close()
        }
      })

      it(`${forme} : une minuterie posée avant l'écriture tourne jusqu'au nettoyage de sa pose, aucune ne survit au retrait de la balise`, async () => {
        const { window, el, erreurs } = await monter(code, `minuterie-${forme}`)
        try {
          el.open()
          await calme(window)
          await pause(150)
          const a = { ...window.__t }
          await pause(150)
          const b       = { ...window.__t }
          const ouverte = [...window.__j]
          assert.deepEqual(ouverte.slice(0, 2), ['pose 1', 'pose 2'], `rejouée dans son propre passage : ${ouverte.join(', ')}`)
          const nettoyees = ids(ouverte, 'net')
          for (const id of ids(ouverte, 'pose')) {
            if (nettoyees.includes(id)) assert.equal(b[id], a[id], `pose ${id} nettoyée, sa minuterie arrêtée : ${JSON.stringify([a, b])} ; ${ouverte.join(', ')}`)
            else assert.ok((b[id] ?? 0) > (a[id] ?? 0), `pose ${id} pas encore nettoyée, sa minuterie tourne : ${JSON.stringify([a, b])} ; ${ouverte.join(', ')}`)
          }
          el.hide()
          await calme(window)
          await pause(60)
          const c = { ...window.__t }
          await pause(150)
          const d       = { ...window.__t }
          const journal = [...window.__j]
          assert.deepEqual(ids(journal, 'net'), ids(journal, 'pose'), journal.join(', '))
          assert.deepEqual(d, c, `aucune minuterie ne tourne après le retrait de la balise : ${JSON.stringify([c, d])} ; ${journal.join(', ')}`)
          el.remove()
          await pause(80)
          assert.deepEqual([...window.__j], journal, 'rien de plus à la destruction du composant')
          assert.deepEqual(erreurs, [])
        }
        finally {
          await window.happyDOM.close()
        }
      })
    }

    it('lecture et écriture de la même variable ($n += 1) : la garde coupe la boucle, la balise retirée, chaque pose a son nettoyage, la fonction comme la méthode', async () => {
      const passages: number[] = []
      for (const forme of ['methode', 'fonction']) {
        const { window, el, erreurs } = await monter(code, `boucle-${forme}`)
        try {
          el.hide()
          await calme(window)
          const journal = window.__j as string[]
          const poses   = journal.filter((e) => e === 'pose').length
          assert.ok(poses > 10000 && poses < 30000, `${forme} : ${poses} passages`)
          assert.equal(journal.filter((e) => e === 'net').length, poses, `${forme} : un nettoyage par pose`)
          assert.deepEqual(erreurs, [], 'aucune erreur, aucun débordement de pile')
          passages.push(poses)
        }
        finally {
          await window.happyDOM.close()
        }
      }
      assert.equal(passages[1], passages[0], 'la fonction fait autant de passages que la méthode')
    })

    if (mode === 'prod') it('l\'aide du cœur qui garde le nettoyage n\'entre qu\'avec une attache', async () => {
      const avec = await bundle('prod', { 'imbrique-fonction': SOURCES['imbrique-fonction'] }, 'avec', true)
      const sans = await bundle('prod', SANS_ATTACHE, 'sans', true)
      assert.match(avec, /_mjs_attKeep = function/)
      assert.match(sans, /_mjs_destroyWithHooks/, 'les crochets de destruction sont au cœur')
      assert.doesNotMatch(sans, /_mjs_attKeep/)
    })
  })
})
