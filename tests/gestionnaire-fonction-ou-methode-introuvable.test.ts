// `@click=nom` appelle la fonction `nom` que le <script> déclare (locale, constante, importée) ; `@click=@nom` appelle la
// méthode `@nom` du composant ; même règle pour tous les événements. Sans `@` à droite du `=`, aucune méthode n'est cherchée.
// Un nom que rien ne fournit faisait un bouton mort, sans un mot à la construction (« nom is not defined » en console, au
// clic) : la construction le refuse, ligne nommée, et propose `@click=@nom` quand le composant a une méthode de ce nom.
// Les noms que le gabarit fournit ({for}, {success}, {error}, <@failed err reset>), les fonctions du navigateur (`alert`),
// une prop (`$rappel`) et une méthode de la balise (`@focus`) passent sans un mot.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { transpile } from '../src/transpiler/index.js'
import { getMessagesLang, setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SCRIPT = '<script>\n$n = 0\n</script>\n'

// le message de l'erreur de construction, '' quand la construction passe
async function refus(src: string, moduleName = 'boutons'): Promise<string> {
  try {
    await transpile(src, { moduleName })
  }
  catch (err: any) {
    return String(err?.message ?? err)
  }
  return ''
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('gestionnaire — `@click=nom` (fonction) et `@click=@nom` (méthode)', function () {
  this.timeout(60000)

  it('les deux formes marchent : fonction locale, constante, méthode, dans un {for}, avec .stop et .once, sur @input, @change et @keydown', async () => {
    const root   = mjsTmp('gestionnaire-fonction-ou-methode')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'boutons.mjs'), '<script>\n$n = 0\n$items = [1, 2]\najoute = -> $n++\ndouble := -> $n += 10\n@methode = -> $n += 100\n</script>\n<button class="a" @click=ajoute>a</button>\n<button class="c" @click=double>c</button>\n<button class="m" @click=@methode>m</button>\n{for x in $items}<button class="f" @click.stop=@methode>{x}</button>{end}\n<button class="o" @click.once=ajoute>o</button>\n<input class="i" @input=ajoute @change=@methode @keydown=double>\n<p class="r">{$n}</p>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const window: any = new Window({ url: 'http://localhost/' })
    try {
      window.eval(`${code}\nglobalThis.µ = µ;`)
      window.document.body.innerHTML = '<mjs-boutons></mjs-boutons>'
      const comp = window.document.querySelector('mjs-boutons')
      await attendre(() => comp._shadow?.querySelector('.r')?.textContent === '0')
      const ombre = comp._shadow
      const r     = () => ombre.querySelector('.r').textContent
      for (const classe of ['a', 'c', 'm', 'f', 'o', 'o']) ombre.querySelector(`.${classe}`).click()
      await attendre(() => r() === '212')
      assert.equal(r(), '212', 'clics : 1 + 10 + 100 + 100 + 1 (.once : un seul appel)')
      const champ = ombre.querySelector('.i')
      champ.dispatchEvent(new window.Event('input', { bubbles: true, composed: true }))
      champ.dispatchEvent(new window.Event('change', { bubbles: true, composed: true }))
      champ.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, composed: true, key: 'a' }))
      await attendre(() => r() === '323')
      assert.equal(r(), '323', '@input, @change, @keydown')
    }
    finally {
      window.close()
      await terminateSharedWorkerPool()
    }
  })

  it('refus à la construction : `@click=nom` quand ni le <script>, ni un import, ni le gabarit ne fournit `nom`, ligne nommée', async () => {
    const msg = await refus(SCRIPT + '<button @click=inconnu>x</button>\n')
    assert.match(msg, /boutons\.mjs/)
    assert.match(msg, /ligne 4/)
    assert.match(msg, /« inconnu »/)
  })

  it('refus : `@click=nom` quand `nom` est une méthode du composant — le message propose `@click=@nom`', async () => {
    const msg = await refus('<script>\n$n = 0\n@valider = -> $n++\n</script>\n<button @click=valider>ok</button>\n')
    assert.match(msg, /ligne 5/)
    assert.match(msg, /@click=@valider/)
  })

  it('refus : `@click=@nom` quand le composant n\'a aucune méthode `@nom` — le message propose `@click=nom` quand la fonction existe', async () => {
    assert.match(await refus(SCRIPT + '<button @click=@absente>ok</button>\n'), /ligne 4[\s\S]*« @absente »/)
    const msg = await refus('<script>\n$n = 0\nvalider = -> $n++\n</script>\n<button @click=@valider>ok</button>\n')
    assert.match(msg, /ligne 5/)
    assert.match(msg, /@click=valider/)
  })

  it('même règle pour tous les événements, avec ou sans modificateurs, dans un {for}', async () => {
    assert.match(await refus(SCRIPT + '<input @input=inconnu>\n'), /« inconnu »/)
    assert.match(await refus(SCRIPT + '<input @change.stop=inconnu>\n'), /« inconnu »/)
    assert.match(await refus(SCRIPT + '<input @keydown.once=@absente>\n'), /« @absente »/)
    assert.match(await refus(SCRIPT + '{for x in [1]}<button @click.stop=@absente>{x}</button>{end}\n'), /« @absente »/)
  })

  it('le message existe en anglais', async () => {
    const avant = getMessagesLang()
    setMessagesLang('en')
    try {
      const msg = await refus(SCRIPT + '<button @click=inconnu>x</button>\n')
      assert.match(msg, /line 4/)
      assert.match(msg, /"inconnu"/)
      assert.match(await refus('<script>\n$n = 0\n@valider = -> $n++\n</script>\n<button @click=valider>ok</button>\n'), /@click=@valider/)
      assert.match(await refus(SCRIPT + '<button @click=@absente>ok</button>\n'), /"@absente"/)
    }
    finally {
      setMessagesLang(avant)
    }
  })

  it('aucun faux refus : fonction locale, constante, importée, du <script module>, du navigateur, prop, méthode, méthode de la balise', async () => {
    const sources = [
      '<script>\najoute = -> 1\n</script>\n<button @click=ajoute>x</button>\n',
      '<script>\ndouble := -> 2\n</script>\n<button @click=double>x</button>\n',
      '@import envoyer \'./outils.js\'\n<script>\n$n = 0\n</script>\n<button @click=envoyer>x</button>\n',
      '<script module>\npartage = -> 1\n</script>\n<script>\n$n = 0\n</script>\n<button @click=partage>x</button>\n',
      SCRIPT + '<button @click=alert>x</button>\n<button @click=print>y</button>\n',
      '<script>\n$rappel = null\n</script>\n<button @click=$rappel>x</button>\n',
      '<script>\n@valider = -> 1\n</script>\n<button @click=@valider>x</button>\n',
      '<script>\nµmount ->\n  @fermer = -> 1\n</script>\n<button @click=@fermer>x</button>\n',
      SCRIPT + '<button @click=@focus>x</button>\n<button @click=@remove>y</button>\n',
    ]
    for (const src of sources) assert.equal(await refus(src), '', src)
  })

  it('aucun faux refus : noms fournis par le gabarit — {for}, {success}, {error}, <@failed err reset>', async () => {
    const sources = [
      '<script>\n$fonctions = []\n</script>\n{for f in $fonctions}<button @click=f>x</button>{end}\n',
      '<script>\n$fonctions = []\n</script>\n{for i, f in $fonctions}<button @click=f>{i}</button>{end}\n',
      '<script>\n$p = null\n</script>\n{await $p}<p>…</p>{success rappel}<button @click=rappel>x</button>{error retenter}<button @click=retenter>y</button>{end}\n',
      SCRIPT + '<@failed err reset>\n<p>{err.message}</p>\n<button @click=reset>Réinitialiser</button>\n</@failed>\n<p>{$n}</p>\n',
    ]
    for (const src of sources) assert.equal(await refus(src), '', src)
  })
})
