// au navigateur réel (Chromium, Firefox, WebKit), en développement et en production : l'image et le son choisis par un nom calculé
// (`µasset "…#{x}…"`) se chargent sous leur adresse à empreinte et suivent la variable quand elle change ; un nom absent de la table
// laisse l'adresse vide (avertie en développement), sans erreur de page. Les modules publiés sont servis tels quels, chargés par le
// navigateur comme en vrai (import du cœur compris, minifié en production)

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, moteurPresent, type Moteur } from './helpers/navigateurs-compiles.js'
import { mjsTmp } from './helpers/tmp.js'

const SVG = (w: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="10"></svg>`

// un son WAV de `octets` échantillons muets (PCM 8 bits, 8 kHz, mono) : lu par les trois moteurs
function wav(octets: number): Buffer {
  const b = Buffer.alloc(44 + octets, 128)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + octets, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(8000, 24)
  b.writeUInt32LE(8000, 28)
  b.writeUInt16LE(1, 32)
  b.writeUInt16LE(8, 34)
  b.write('data', 36)
  b.writeUInt32LE(octets, 40)
  return b
}

const JEU = `<script>
$n = 1
$skin = 'bois'
avancer = -> $n = 2
habiller = -> $skin = 'marbre'
perdre = -> $n = 9
</script>
<audio src={µasset "sounds/pick-#{$n}.wav"} preload="none"></audio>
<img src={µasset "images/habillage/#{$skin}/corner.svg"} alt="coin">
<button class="b1" @click={avancer()}>1</button><button class="b2" @click={habiller()}>2</button><button class="b3" @click={perdre()}>3</button>
`

// construit l'appli (une fois par environnement) : le dossier publié et le module du composant
const construites = new Map<string, Promise<{ outDir: string, module: string }>>()
function construire(env: string): Promise<{ outDir: string, module: string }> {
  if (!construites.has(env)) construites.set(env, (async () => {
    const root   = mjsTmp(`asset-calc-nav-${env}`)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    for (const dossier of ['sounds', 'images/habillage/bois', 'images/habillage/marbre']) mkdirSync(join(srcDir, dossier), { recursive: true })
    writeFileSync(join(srcDir, 'sounds/pick-1.wav'), wav(100))
    writeFileSync(join(srcDir, 'sounds/pick-2.wav'), wav(200))
    writeFileSync(join(srcDir, 'images/habillage/bois/corner.svg'), SVG(20))
    writeFileSync(join(srcDir, 'images/habillage/marbre/corner.svg'), SVG(30))
    writeFileSync(join(srcDir, 'jeu.mjs'), JEU)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), urlPrefix: '/mjs', a11y: false, env } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const module = readdirSync(outDir).find((f) => /^jeu-[0-9a-z]+\.js$/.test(f))
    assert.ok(module, readdirSync(outDir).join(', '))
    return { outDir, module: module! }
  })())
  return construites.get(env)!
}

const TYPES: Record<string, string> = { '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' }

// la page à `http://mjs.test/`, les fichiers publiés servis sous `/mjs/`, le module du composant chargé par le navigateur
async function ouvrir(nom: Moteur, outDir: string, module: string) {
  const playwright: any = await import('playwright')
  const browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  const page    = await browser.newPage()
  const erreurs: string[] = []
  const avis: string[]    = []
  page.on('pageerror', (e: any) => erreurs.push(String(e)))
  page.on('console', (m: any) => { if (m.type() === 'warning') avis.push(m.text()) })
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-jeu></mjs-jeu><script type="module" src="/mjs/${module}"></script></body></html>`
  await page.route('http://mjs.test/**', (route: any) => {
    const chemin = new URL(route.request().url()).pathname
    if (!chemin.startsWith('/mjs/')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
    const fichier = join(outDir, chemin.slice(5))
    if (!existsSync(fichier)) return route.fulfill({ status: 404, body: '' })
    return route.fulfill({ status: 200, contentType: TYPES[chemin.slice(chemin.lastIndexOf('.'))] ?? 'application/octet-stream', body: readFileSync(fichier) })
  })
  await page.goto('http://mjs.test/')
  return { browser, page, erreurs, avis }
}

// dans l'ombre du composant : l'attribut `src` du son, et l'image (adresse, largeur une fois chargée)
const LIRE = `(() => {
  const h = document.querySelector('mjs-jeu'); const r = h && (h._shadow || h.shadowRoot || h)
  const a = r && r.querySelector('audio'); const i = r && r.querySelector('img')
  return { son: a ? a.getAttribute('src') : null, image: i ? i.getAttribute('src') : null, largeur: i && i.complete ? i.naturalWidth : 0 }
})()`

describe('µasset au nom calculé — une image et un son au navigateur réel', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const env of ['dev', 'prod']) {
    for (const moteur of MOTEURS) {
      it(`${env}, ${moteur} : adresses à empreinte chargées, suivies au changement, nom absent vide`, async function () {
        if (!(await moteurPresent(moteur))) this.skip()
        const { outDir, module } = await construire(env)
        const { browser, page, erreurs, avis } = await ouvrir(moteur, outDir, module)
        try {
          const attendre = (cond: string) => page.waitForFunction(`(() => { const e = ${LIRE}; return ${cond} })()`, null, { timeout: 10000 })
          const cliquer  = (sel: string) => page.evaluate(`(() => { const h = document.querySelector('mjs-jeu'); (h._shadow || h.shadowRoot || h).querySelector('${sel}').click() })()`)
          await attendre(`/^\\/mjs\\/pick-1-[0-9a-f]{8}\\.wav$/.test(e.son) && /^\\/mjs\\/corner-[0-9a-f]{8}\\.svg$/.test(e.image) && e.largeur === 20`)
          const premier = await page.evaluate(LIRE)
          const octets  = await page.evaluate(`fetch(${JSON.stringify(premier.son)}).then(r => r.arrayBuffer()).then(b => b.byteLength)`)
          assert.equal(octets, 144)
          await cliquer('.b2')
          await attendre('e.largeur === 30')
          assert.notEqual((await page.evaluate(LIRE)).image, premier.image)
          await cliquer('.b1')
          await attendre(`/^\\/mjs\\/pick-2-[0-9a-f]{8}\\.wav$/.test(e.son)`)
          await cliquer('.b3')
          await attendre(`e.son === ''`)
          const averti = avis.some(m => m.includes('sounds/pick-9.wav'))
          assert.equal(averti, env === 'dev', `avertissement ${env === 'dev' ? 'attendu' : 'inattendu'}, relevé : ${avis.join(' | ')}`)
          assert.deepEqual(erreurs, [])
        }
        finally {
          await browser.close()
        }
      })
    }
  }
})
