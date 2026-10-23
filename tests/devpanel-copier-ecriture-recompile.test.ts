// mjs_devpanel — « copier l'écriture » : la ligne qui part dans le presse-papiers se recompile, telle quelle, en
// les mêmes réglages que celle de la page. Trois écritures la cassaient : un réglage principal qui ressemble à
// `mot:` (une adresse `wss://…`, un texte `Attention : …`), écrit sans son nom, était lu comme le nom d'un réglage ;
// les clés internes `_…` (la variable que le compilateur donne à *gauge et à *guard) fuyaient dans la ligne ;
// une apostrophe protégée par `\'` — que le lecteur des réglages ne sait pas lire — se recompilait en `l\'`.
//
// Pipeline RÉEL (Bundler → cœur de développement + composants compilés, montés dans happy-dom), comme devpanel-effets.test.ts ;
// la ligne copiée est recompilée par le vrai lecteur des réglages (parseEffect).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { parseEffect } from '../src/effects/catalog.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const FICHIERS: Record<string, string> = {
  'dpcopie-direct.mjs': "<div class=\"f\" *follow(server: 'wss://x.fr/ws')>z</div>",
  'dpcopie-jauge.mjs':  '<script>\n$v = 5\n</script>\n<b class="j" *gauge(min: 0, max: 10)>{$v}</b>',
  'dpcopie-garde.mjs':  "<script>\n$age = 30\n</script>\n<input class=\"g\" value=!{$age} *guard(text: 'Attention : fragile')>",
  'dpcopie-delta.mjs':  '<script>\n$n = 5\n</script>\n<b class="d" *delta(prefix: "l\'")>{$n}</b>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

// `*nom(réglages)` relu comme le compilateur le lit : les réglages fixes, et les variables qu'il tient
function relire(ligne: string) {
  const m = /^\*([A-Za-z][\w-]*)(?:\(([\s\S]*)\))?$/.exec(ligne)
  assert.ok(m, `une écriture d'effet attendue, reçu : ${ligne}`)
  return parseEffect(m![1], m![2] ?? '')
}

describe('mjs_devpanel — « copier l\'écriture » se recompile', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('devpanel-copier')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, source] of Object.entries(FICHIERS)) writeFileSync(join(srcDir, f), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const lire  = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    window = new Window({ url: 'http://localhost/' })
    // une connexion qui ne s'ouvre jamais : *follow(server: …) ne doit rien joindre sur le réseau
    window.WebSocket = class { readyState = 0; send() {} close() {}; addEventListener() {}; removeEventListener() {} }
    window.eval(`${lire(files.find((f) => /^mjs_core-/.test(f))!)}\nglobalThis.µ = µ;`)
    for (const f of files.filter((f) => /^mjs_fx_[a-z_]+-[0-9a-z]{5}\.js$/.test(f))) window.eval(lire(f))
    for (const nom of Object.keys(FICHIERS).map((f) => f.replace(/\.mjs$/, ''))) {
      window.eval(lire(files.find((f) => new RegExp(`^${nom}-[0-9a-z]{5}\\.js$`).test(f))!))
    }
  })

  afterEach(() => {
    if (window?.µ?.console) window.µ.console(false)
    if (window) window.document.body.innerHTML = ''
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  const racine = () => window.document.querySelector('[data-mjs-devpanel]')?.shadowRoot
  const clic   = (el: any) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const bloc   = (effet: string) => Array.from(racine().querySelectorAll('.detail .fx') as ArrayLike<any>).find((b: any) => b.querySelector('.fx-nom')?.textContent === '*' + effet)

  // le composant monté, le panneau sur son onglet Effets, le bouton « copier l'écriture » de l'effet cliqué : ce qui est copié
  async function copier(tag: string, sel: string, effet: string): Promise<string> {
    const copies: string[] = []
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: (t: string) => { copies.push(t); return Promise.resolve() } }, configurable: true })
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow && !!comp._shadow.querySelector(sel))
    await new Promise((r) => setTimeout(r, 20))
    window.µ.console(tag)
    clic(racine().querySelector('.onglet[data-onglet="effets"]'))
    const b = bloc(effet)
    assert.ok(b, 'l\'effet *' + effet + ' attendu dans l\'onglet : ' + racine().querySelector('.detail').textContent)
    clic(b.querySelector('[data-action="fx-copier"]'))
    await attendre(() => copies.length > 0)
    assert.equal(copies.length, 1, 'une seule copie')
    return copies[0]
  }

  it('un réglage nommé qui ressemble à `mot:` (une adresse wss://…) : entre guillemets, comme dans le code ; la ligne se recompile à l\'identique', async () => {
    const copie = await copier('mjs-dpcopie-direct', '.f', 'follow')
    assert.equal(copie, "*follow(server: 'wss://x.fr/ws')")
    assert.deepEqual(relire(copie).fixed, { server: 'wss://x.fr/ws' })
  })

  it('un réglage principal qui ressemble à `mot:` (un texte « Attention : … ») : écrit avec son nom et entre guillemets, jamais lu comme le nom d\'un réglage', async () => {
    const copie = await copier('mjs-dpcopie-garde', '.g', 'guard')
    assert.match(copie, /^\*guard\(text: 'Attention : fragile'(, [^)]*)?\)$/, copie)
    assert.equal(relire(copie).fixed.text, 'Attention : fragile')
  })

  it('la variable que le compilateur lit (`_bind`, de *gauge et de *guard) ne fuit pas dans la ligne copiée', async () => {
    const jauge = await copier('mjs-dpcopie-jauge', '.j', 'gauge')
    assert.equal(jauge, '*gauge(min: 0, max: 10)')
    assert.deepEqual(relire(jauge).fixed, { min: 0, max: 10 })
    const garde = await copier('mjs-dpcopie-garde', '.g', 'guard')
    assert.doesNotMatch(garde, /_/, 'aucune clé interne : ' + garde)
  })

  it('une apostrophe : la valeur passe entre guillemets doubles ; elle se recompile sans antislash', async () => {
    const copie = await copier('mjs-dpcopie-delta', '.d', 'delta')
    assert.match(copie, /^\*delta\(prefix: "l'"(, [^)]*)?\)$/, copie)
    assert.equal(relire(copie).fixed.prefix, 'l\'')
  })
})
