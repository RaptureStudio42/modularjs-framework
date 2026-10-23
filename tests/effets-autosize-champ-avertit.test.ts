// *autosize posé sur un champ (<textarea>, <input>) — l'effet suit le contenu d'une boîte, et ce qu'on tape dans un champ n'en change pas
// le contenu : il n'y fait rien. La console le dit, une fois par balise, dans la langue de la page, en développement seulement : la
// production ne porte ni le code ni le texte. L'effet reste posé tel quel, il ne suit pas la saisie.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'

const COMPOSANTS: Record<string, string> = {
  'aa-texte': '<textarea class="a" aria-label="message" *autosize></textarea>',
  'aa-champ': '<input class="a" aria-label="nom" *autosize>',
  'aa-boite': '<div class="a" *autosize><p>x</p></div>',
  'aa-deux':  '<textarea class="a" aria-label="message" *autosize(duration: 200ms)></textarea><input class="b" aria-label="nom" *autosize>'
}

const texte = (tag: string) => `[ModularJS] *autosize : sur un <${tag}>, l'effet ne fait rien — il fait glisser la taille d'une boîte quand son contenu change (une balise ajoutée, un bloc qui s'ouvre, une image qui arrive), et ce qu'on tape dans un champ n'en change pas le contenu. Posez *autosize sur la boîte dont le contenu change, par exemple celle qui entoure le champ et ses messages.`
const text  = (tag: string) => `[ModularJS] *autosize: on a <${tag}>, the effect does nothing — it smoothly resizes a box when its content changes (a tag added, a block that opens, an image that arrives), and typing in a field does not change its content. Place *autosize on the box whose content changes, for example the one around the field and its messages.`

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))

describe('effets — *autosize sur un champ, l\'avertissement du développement', function () {
  this.timeout(60000)
  const fenetres: any[] = []
  let code     = ''
  let libelles = ''

  before(async () => {
    const root   = mjsTmp('effets-autosize-champ-avertit')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    code     = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    libelles = libellesDuManifeste(join(root, 'bundle.js'))
  })

  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  // une page chargée comme le navigateur la lit (le cœur, l'effet, le composant, puis les libellés du manifeste) ; la console est espionnée
  function page(lang = '') {
    const window: any = new Window({ url: 'http://localhost/' })
    if (lang) window.document.documentElement.setAttribute('lang', lang)
    fenetres.push(window)
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.eval(libelles)
    window.requestAnimationFrame = () => 0
    window.cancelAnimationFrame  = () => {}
    const recus: Array<{ texte: string, balise: any }> = []
    window.µ.warn = (...a: any[]) => { recus.push({ texte: String(a[0]), balise: a[1] }) }
    return { window, recus }
  }

  async function monter(window: any, tag: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector('.a'))
    await pause(60)
    return comp
  }

  it('sur un <textarea> : la console le dit, une fois, avec la balise', async () => {
    const { window, recus } = page()
    const comp = await monter(window, 'mjs-aa-texte')
    assert.deepEqual(recus.map((r) => r.texte), [texte('textarea')])
    assert.ok(recus[0].balise === comp._shadow.querySelector('.a'), 'la balise fautive est donnée à la console')
  })

  it('sur un <input> : même avertissement, la balise nommée', async () => {
    const { window, recus } = page()
    await monter(window, 'mjs-aa-champ')
    assert.deepEqual(recus.map((r) => r.texte), [texte('input')])
  })

  it('sur une boîte (un <div>) : rien à dire', async () => {
    const { window, recus } = page()
    await monter(window, 'mjs-aa-boite')
    assert.deepEqual(recus.map((r) => r.texte), [])
  })

  it('deux champs : un avertissement chacun ; l\'effet reposé sur le même champ ne le redit pas', async () => {
    const { window, recus } = page()
    const comp = await monter(window, 'mjs-aa-deux')
    assert.deepEqual(recus.map((r) => r.texte), [texte('textarea'), texte('input')])
    assert.ok(recus[0].balise === comp._shadow.querySelector('.a'), 'le premier champ est donné à la console')
    assert.ok(recus[1].balise === comp._shadow.querySelector('.b'), 'le second champ est donné à la console')
    const ta = comp._shadow.querySelector('.a')
    ta._mjs_fxOff.autosize()
    window.µ._mjs_fx(null, ta, 'autosize', {})
    await pause(60)
    assert.equal(recus.length, 2, 'une fois par balise')
    assert.equal(typeof ta._mjs_fxOff.autosize, 'function', 'l\'effet est reposé, il n\'est pas refusé')
  })

  it('en anglais, la console parle anglais', async () => {
    const { window, recus } = page('en')
    await monter(window, 'mjs-aa-texte')
    assert.deepEqual(recus.map((r) => r.texte), [text('textarea')])
  })
})

// ---- développement et production ----

const AVIS   = 'autosizeField'
const TEXTES = ['l\'effet ne fait rien — il fait glisser la taille d\'une boîte', 'the effect does nothing — it smoothly resizes a box']

describe('effets — *autosize sur un champ, l\'avertissement du développement ne part pas en production', function () {
  this.timeout(600000)
  after(async () => { await terminateSharedWorkerPool() })

  // un build RÉEL : tout ce qu'il écrit (les .js, les catalogues de messages .json, le manifeste), le code lisible ou minifié
  async function construire(nom: string, source: string, env: 'dev' | 'prod', minify: boolean): Promise<string> {
    const root   = mjsTmp('autosize-avis-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'p.mjs'), source)
    const options: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify }
    if (env === 'prod') options.env = 'prod'
    const bundler = new Bundler(options)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js') || f.endsWith('.json')).map((f) => readFileSync(join(outDir, f), 'utf-8'))
    if (existsSync(join(root, 'bundle.js'))) fichiers.push(readFileSync(join(root, 'bundle.js'), 'utf-8'))
    return fichiers.join('\n')
  }

  for (const minify of [false, true]) {
    it(`production ${minify ? 'minifiée' : 'lisible'} : ni l'appel, ni la clé, ni le texte, en aucune langue`, async () => {
      const sortie = await construire(`prod-${minify}`, COMPOSANTS['aa-deux'], 'prod', minify)
      assert.match(sortie, /\.autosize\s*=\s*\{\s*setup\s*:/, 'témoin : l\'effet est bien dans la sortie (ses noms internes raccourcis une fois minifié)')
      assert.equal(sortie.includes(AVIS), false, 'la clé du message est du développement')
      for (const t of TEXTES) assert.equal(sortie.includes(t), false, `« ${t}… » est du développement : ni les .js, ni le manifeste, ni les catalogues de messages de la production ne le portent`)
    })
  }

  it('le développement envoie le fichier en entier : l\'appel et le texte, dans les deux langues', async () => {
    const sortie = await construire('dev', COMPOSANTS['aa-texte'], 'dev', false)
    assert.ok(sortie.includes('µ._mjs_msg(\'dev.' + AVIS + '\''), 'l\'appel')
    for (const t of TEXTES) assert.ok(sortie.includes(t), `développement : le texte « ${t}… » est au manifeste`)
  })
})
