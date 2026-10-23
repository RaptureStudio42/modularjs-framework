// le rappel d'un MutationObserver reçoit l'observateur pour `this` : `@x` y lit l'observateur (`@disconnect()` l'arrête),
// `@@x` lit le composant (`_mjsThis.x`, référence capturée à l'initialisation, insensible au site d'appel), comme dans
// toute fonction appelée nue
// composant compilé par le vrai Bundler et monté dans happy-dom (le moteur du rendu serveur), en développement comme
// en production minifiée : `@@_shadow` et une variable que le <script> pose (`@fois`) se lisent et s'écrivent sans rien
// lever ; `@disconnect()` arrête l'observateur qui l'appelle, pendant qu'un témoin voisin, qui ne se déconnecte pas,
// est rappelé à chaque ajout
// ResizeObserver et IntersectionObserver : cf. double-at-rappel-observateur-browser.test.ts

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// `lire` se déconnecte au deuxième rappel ; `noter` est le témoin
const SOURCE = [
  '<script>',
  '$n     = 0',
  '$vus   = 0',
  '$notes = 0',
  '@fois  = 0',
  'lire = ->',
  '  @@fois++',
  '  $vus = @@fois',
  '  $n   = @@_shadow.querySelectorAll(\'li\').length',
  '  @disconnect() if @@fois >= 2',
  'noter = ->',
  '  $notes++',
  '@ajouter = ->',
  '  @_shadow.querySelector(\'ul\').appendChild(document.createElement(\'li\'))',
  'µmount ->',
  '  ul = @_shadow.querySelector(\'ul\')',
  '  new MutationObserver(lire).observe(ul, { childList: true })',
  '  new MutationObserver(noter).observe(ul, { childList: true })',
  '</script>',
  '<ul></ul><button class="b" @click={@ajouter()}>+</button><p class="n">{$n}</p><p class="v">{$vus}</p><p class="t">{$notes}</p>',
  ''
].join('\n')

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

// le code que la fenêtre évalue : en développement les fichiers émis mis bout à bout, en production le fichier unique
// minifié, dont l'import du cœur sous un nom court devient une variable
async function construire(env: 'dev' | 'prod'): Promise<string> {
  const root   = mjsTmp('double-at-rappel-observateur-' + env)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'guetteur-main.mjs'), SOURCE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...(env === 'prod' ? { env: 'prod', js: 'bundle' } : {}) } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  if (env === 'prod') {
    const prod = readFileSync(join(root, 'bundle.js'), 'utf-8')
    assert.equal(prod.includes('_mjsThis'), false, 'le build de production est minifié : la référence au composant porte un nom court')
    return stripEsm(prod, { bridgeCore: true }) + '\nglobalThis.µ = µ;'
  }
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const dev   = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  assert.equal(dev.includes('_mjsThis'), true, 'le build de développement garde la référence au composant en clair')
  return dev
}

for (const env of ['dev', 'prod'] as const) {
  describe(`@@x dans le rappel d'un MutationObserver — composant monté dans happy-dom (build de ${env === 'prod' ? 'production' : 'développement'})`, function () {
    this.timeout(60000)
    let window: any
    const erreurs: string[] = []

    before(async () => {
      const code = await construire(env)
      window = new Window({ url: 'http://localhost/' })
      window.addEventListener('error', (e: any) => erreurs.push(String(e.error?.message ?? e.message)))
      window.console.error = (...a: unknown[]) => { erreurs.push(a.map(String).join(' ')) }
      window.eval(code)
    })

    after(async () => {
      window?.close?.()
      await terminateSharedWorkerPool()
    })

    it('un ajout dans la liste : le rappel lit @@_shadow et compte @@fois sur le composant, sans erreur ; @disconnect() l\'arrête, le témoin continue', async () => {
      window.document.body.innerHTML = '<mjs-guetteur-main></mjs-guetteur-main>'
      const comp = window.document.querySelector('mjs-guetteur-main')
      await attendre(() => comp._shadow?.querySelector('.b')?.textContent === '+')
      const texte   = (sel: string) => comp._shadow.querySelector(sel).textContent
      const ajouter = () => comp._shadow.querySelector('.b').dispatchEvent(new window.MouseEvent('click'))

      ajouter()
      await attendre(() => texte('.t') === '1')
      assert.equal(texte('.n'), '1', 'le rappel a compté la ligne ajoutée par @@_shadow')
      assert.equal(texte('.v'), '1', '@@fois est posé par le script, lu et écrit sur le composant')

      ajouter()
      await attendre(() => texte('.t') === '2')
      assert.equal(texte('.n'), '2', 'deuxième rappel : deux lignes')
      assert.equal(texte('.v'), '2')

      ajouter()
      await attendre(() => texte('.t') === '3')
      await new Promise((r) => setTimeout(r, 100))
      assert.equal(texte('.n'), '2', '@disconnect() a arrêté l\'observateur : plus aucun rappel, alors que la liste a trois lignes')
      assert.equal(texte('.v'), '2', '@@fois n\'a pas bougé depuis l\'arrêt')
      assert.equal(comp._shadow.querySelectorAll('li').length, 3)
      assert.deepEqual(erreurs, [])
    })
  })
}
