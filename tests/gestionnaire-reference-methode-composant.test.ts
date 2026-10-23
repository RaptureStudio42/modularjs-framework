// `@click=nom` (ou `@click={nom}`) appelle la fonction `nom` du <script> au clic. Le défaut : quand
// `nom` n'est pas une fonction du <script> mais une méthode du composant (`@nom = ->`), rien ne se
// passait au clic, et le build ne disait rien (le nom nu n'existe pas : « nom is not defined »,
// seulement en console, au clic). Le build prévient désormais (lint.events, sans bloquer) et dit
// quoi écrire, sur une balise comme sur <@window>/<@document> ; une fonction du <script> citée nue,
// elle, marche comme avant, sans un mot.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

async function avertissements(src: string, moduleName = 'formulaire'): Promise<string[]> {
  const orig = console.warn
  const vus: string[] = []
  console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
  try { await transpile(src, { moduleName }) } finally { console.warn = orig }
  return vus.filter(m => m.includes('[lint.events]'))
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('gestionnaire — un nom cité nu', function () {
  this.timeout(60000)

  it('une fonction du <script> citée nue (`@click=ajoute`, `@click={ajoute}`) : appelée au clic', async () => {
    const root   = mjsTmp('gestionnaire-reference-fonction')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'compte.mjs'), '<script>\n$n = 0\najoute = -> $n++\n</script>\n<button class="a" @click=ajoute>a</button>\n<button class="b" @click={ajoute}>b</button>\n<p class="r">{$n}</p>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang   = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code   = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const window: any = new Window({ url: 'http://localhost/' })
    try {
      window.eval(`${code}\nglobalThis.µ = µ;`)
      window.document.body.innerHTML = '<mjs-compte></mjs-compte>'
      const comp = window.document.querySelector('mjs-compte')
      await attendre(() => comp._shadow?.querySelector('.r')?.textContent === '0')
      comp._shadow.querySelector('.a').click()
      comp._shadow.querySelector('.b').click()
      await attendre(() => comp._shadow.querySelector('.r').textContent === '2')
      assert.equal(comp._shadow.querySelector('.r').textContent, '2')
    }
    finally {
      window.close()
      await terminateSharedWorkerPool()
    }
  })

  it('une méthode du composant (`@valider = ->`) citée nue : un avertissement par nom, avec l\'écriture juste', async () => {
    const methode = '<script>\n$n = 0\n@valider = -> $n++\n</script>\n'
    for (const bouton of ['<button @click=valider>ok</button>', '<button @click={valider}>ok</button>', '<button @click={valider(1)}>ok</button>']) {
      const vus = await avertissements(methode + bouton + '\n')
      assert.equal(vus.length, 1, bouton)
      assert.match(vus[0], /valider[\s\S]*@valider/)
    }
    assert.equal((await avertissements(methode + '<button @click=valider>a</button>\n<button @click={valider()}>b</button>\n')).length, 1, 'un seul par nom')
  })

  it('même avertissement sur <@window>/<@document> : `@keydown=touche` quand `touche` est la méthode `@touche`', async () => {
    const methode = '<script>\n$n = 0\n@touche = -> $n++\n</script>\n'
    assert.match((await avertissements(methode + '<@window @keydown=touche>\n<p>x</p>\n', 'clavier')).join('\n'), /touche[\s\S]*@touche/)
    assert.match((await avertissements(methode + '<@document @click={touche()}>\n<p>x</p>\n', 'clavier')).join('\n'), /touche[\s\S]*@touche/)
    assert.deepEqual(await avertissements(methode + '<@window @keydown=@touche>\n<p>x</p>\n', 'clavier'), [])
    assert.deepEqual(await avertissements('<script>\n$n = 0\ntouche = -> $n++\n</script>\n<@window @keydown=touche>\n<p>x</p>\n', 'clavier'), [])
  })

  it('pas de fausse alerte : `@valider` cité avec son `@`, un homonyme déclaré dans le <script> ou le gestionnaire', async () => {
    const methode = '<script>\n$n = 0\n@valider = -> $n++\n</script>\n'
    assert.deepEqual(await avertissements(methode + '<button @click={@valider()}>ok</button>\n<button @click=@valider>ok</button>\n'), [])
    assert.deepEqual(await avertissements('<script>\n$n = 0\n@valider = -> $n++\nvalider = -> $n--\n</script>\n<button @click=valider>ok</button>\n'), [])
    assert.deepEqual(await avertissements(methode + '<button @click={(valider) -> valider}>ok</button>\n<button @click={o = { valider: 1 }; o.valider}>ok</button>\n'), [])
  })
})
