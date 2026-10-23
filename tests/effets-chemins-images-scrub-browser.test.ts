// *scrub avec le chemin des images seul, de bout en bout : le build range chaque fichier local de `images` sous une empreinte
// (comme µimage('…')), l'effet charge l'adresse de l'objet que le build en tire, et dans Chromium et Firefox réels la suite s'affiche,
// dans un <canvas> comme dans une <img>, et avance avec le défilement. Une adresse complète et une adresse data: de la même liste
// restent telles quelles. Un fichier absent fait échouer le build en nommant le chemin et l'effet.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// cinq images WebP sans perte de 16 × 9, une couleur chacune : trois dans les sources (a, b, c), une servie à une adresse complète, une en data:
const WEBP: Record<string, string> = {
  rouge: 'UklGRhwAAABXRUJQVlA4TA8AAAAvDwACAAcQ/Y/+ByKi/wEA',
  vert:  'UklGRhwAAABXRUJQVlA4TA8AAAAvDwACAAdQ5Ij+ByKi/wEA',
  bleu:  'UklGRhwAAABXRUJQVlA4TA8AAAAvDwACAAcQ0f/+ByKi/wEA',
  jaune: 'UklGRhwAAABXRUJQVlA4TBAAAAAvDwACAAfQ//5H/wMR0f8A',
  cyan:  'UklGRhwAAABXRUJQVlA4TBAAAAAvDwACAAfQ/+h//wMR0f8A'
}
const COULEURS: Record<string, number[]> = { rouge: [255, 0, 0], vert: [0, 200, 0], bleu: [0, 0, 255], jaune: [255, 255, 0], cyan: [0, 255, 255] }
const EXTERNE = 'http://t.test/externe.webp'
const DATA    = 'data:image/webp;base64,' + WEBP.cyan
const ADRESSE = /^\/[\w/-]*([abc])-[0-9a-f]{8}\.webp$/

// la scène : une section de 1 500 px dans une boîte de 300 px qui défile, la balise collante (une course de 1 200 px)
const SCENE = '\n.scene\n  height: 300px\n  overflow: auto\n.longue\n  height: 1500px\n.cible\n  position: sticky\n  top: 0\n  display: block\n  width: 100%\n  height: 300px\n'
const scene = (balise: string) => `<div class="scene"><section class="longue">${balise}</section></div>\n<style>${SCENE}</style>\n`

const SOURCES: Record<string, string> = {
  'scrub-chemins.mjs': scene('<canvas class="cible" *scrub(images: [\'a.webp\', \'b.webp\', \'c.webp\'], smooth: 0)></canvas>'),
  'scrub-mixte.mjs':   scene(`<canvas class="cible" *scrub(images: ['a.webp', '${EXTERNE}', '${DATA}'], smooth: 0)></canvas>`),
  'scrub-img.mjs':     scene('<img class="cible" alt="essai" *scrub(images: [a.webp, b.webp, c.webp], smooth: 0)>')
}

// un projet : les trois images posées dans les sources, les composants écrits, le build ; rend le code publié, le script d'une page et les erreurs
async function construire(nom: string, composants: Record<string, string>) {
  const root   = mjsTmp(nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [fichier, couleur] of [['a.webp', 'rouge'], ['b.webp', 'vert'], ['c.webp', 'bleu']]) writeFileSync(join(srcDir, fichier), Buffer.from(WEBP[couleur], 'base64'))
  for (const [fichier, texte] of Object.entries(composants)) writeFileSync(join(srcDir, fichier), texte)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  const rang     = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const fichiers = existsSync(outDir) ? readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)) : []
  const textes   = fichiers.map((f) => readFileSync(join(outDir, f), 'utf-8'))
  return {
    outDir:  outDir,
    code:    textes.join('\n'),
    script:  textes.map((t) => stripEsm(t)).join('\n') + '\nglobalThis.µ = µ;',
    erreurs: stats.errors.map((e: any) => String(e.message))
  }
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

// relit une valeur jusqu'à ce qu'elle vérifie `bon`, ou que le délai passe : rend la dernière lue
async function attend<T>(lire: () => Promise<T>, bon: (v: T) => boolean, ms = 5000): Promise<T> {
  const fin = Date.now() + ms
  let v = await lire()
  while (!bon(v) && Date.now() < fin) {
    await attendre(50)
    v = await lire()
  }
  return v
}

// les listes d'images de tous les *scrub du code publié, chacune lue comme du JSON
const listes = (code: string): string[][] => [...code.matchAll(/"scrub", \{"images":(\[[^\n]*?\])[,}]/g)].map((m) => JSON.parse(m[1]))

describe('*scrub(images: [chemins seuls]) — le build résout, l\'effet affiche', function () {
  this.timeout(240000)
  let projet: Awaited<ReturnType<typeof construire>>

  before(async () => {
    projet = await construire('effets-chemins-images-scrub', SOURCES)
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('le projet se construit sans erreur', () => {
    assert.deepEqual(projet.erreurs, [])
  })

  it('les trois fichiers de la liste sont publiés sous une empreinte : chaque élément porte une adresse à empreinte, pas le chemin écrit', () => {
    const locale = listes(projet.code).find((l) => l.length === 3 && !l.includes(EXTERNE))
    assert.ok(locale, `la liste n'est pas dans le code publié : ${projet.code.match(/"scrub", [^\n]{0,200}/)}`)
    assert.deepEqual(locale!.map((e) => ADRESSE.exec(e)?.[1]), ['a', 'b', 'c'], locale!.join(' | '))
  })

  it('une adresse complète et une adresse data: de la liste restent telles quelles, à côté d\'un chemin local résolu', () => {
    const mixte = listes(projet.code).find((l) => l.includes(EXTERNE))
    assert.ok(mixte, `la liste n'est pas dans le code publié : ${projet.code.match(/"scrub", [^\n]{0,200}/)}`)
    assert.equal(ADRESSE.exec(mixte![0])?.[1], 'a', mixte![0])
    assert.equal(mixte![1], EXTERNE)
    assert.equal(mixte![2], DATA)
  })

  for (const nom of ['chromium', 'firefox'] as const) describe(nom, function () {
    let present = false
    let browser: any = null

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const playwright = await import('playwright')
      browser = await playwright[nom].launch()
    })

    after(async () => { if (browser) await browser.close() })

    // la page d'un composant à une vraie adresse : les images publiées par le build sont servies par la page elle-même, l'adresse complète aussi
    async function avec<T>(tag: string, fn: (page: any) => Promise<T>): Promise<T> {
      const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
      try {
        await page.route('http://t.test/**', (route: any) => {
          const chemin = new URL(route.request().url()).pathname
          if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${projet.script}</script></body></html>` })
          if (chemin === '/externe.webp') return route.fulfill({ contentType: 'image/webp', body: Buffer.from(WEBP.jaune, 'base64') })
          const fichier = join(projet.outDir, basename(chemin))
          if (!existsSync(fichier)) return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'image/webp', body: readFileSync(fichier) })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('[mjs-fx]'), tag)
        return await fn(page)
      }
      finally {
        await page.close()
      }
    }

    const defile = (page: any, tag: string, y: number) => page.evaluate(([t, v]: [string, number]) => { (document.querySelector(t) as any)._shadow.querySelector('.scene').scrollTop = v }, [tag, y])
    // la couleur au milieu de la toile : le nom de celle des cinq qui s'en approche, 'rien' si rien n'est dessiné
    const couleur = async (page: any, tag: string): Promise<string> => {
      const px: number[] = await page.evaluate((t: string) => {
        const cv = (document.querySelector(t) as any)._shadow.querySelector('canvas')
        return Array.from(cv.getContext('2d').getImageData(Math.round(cv.width / 2), Math.round(cv.height / 2), 1, 1).data as ArrayLike<number>)
      }, tag)
      if (px[3] === 0) return 'rien'
      const proche = Object.entries(COULEURS).find(([, c]) => c.every((v, i) => Math.abs(v - px[i]) < 40))
      return proche ? proche[0] : `autre ${px.join(',')}`
    }
    // l'adresse que la balise <img> montre
    const adresse = (page: any, tag: string): Promise<string> => page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('img').getAttribute('src') || '', tag)

    it('canvas : la suite des trois chemins s\'affiche et avance avec le défilement (début, milieu, fin, retour)', async function () {
      if (!present) return this.skip()
      await avec('mjs-scrub-chemins', async (page) => {
        for (const [p, attendu] of [[0, 'rouge'], [0.5, 'vert'], [1, 'bleu'], [0, 'rouge']] as Array<[number, string]>) {
          await defile(page, 'mjs-scrub-chemins', p * 1200)
          const c = await attend(() => couleur(page, 'mjs-scrub-chemins'), (v: string) => v === attendu)
          assert.equal(c, attendu, `p = ${p}`)
        }
      })
    })

    it('canvas : un chemin local, une adresse complète et une adresse data: dans la même liste s\'affichent tous les trois', async function () {
      if (!present) return this.skip()
      await avec('mjs-scrub-mixte', async (page) => {
        for (const [p, attendu] of [[0, 'rouge'], [0.5, 'jaune'], [1, 'cyan']] as Array<[number, string]>) {
          await defile(page, 'mjs-scrub-mixte', p * 1200)
          const c = await attend(() => couleur(page, 'mjs-scrub-mixte'), (v: string) => v === attendu)
          assert.equal(c, attendu, `p = ${p}`)
        }
      })
    })

    it('<img> : son src prend l\'adresse à empreinte de chaque image, au fil du défilement (des mots sans guillemets dans la liste)', async function () {
      if (!present) return this.skip()
      await avec('mjs-scrub-img', async (page) => {
        for (const [p, attendu] of [[0, 'a'], [0.5, 'b'], [1, 'c']] as Array<[number, string]>) {
          await defile(page, 'mjs-scrub-img', p * 1200)
          const src = await attend(() => adresse(page, 'mjs-scrub-img'), (v: string) => new RegExp(`/${attendu}-[0-9a-f]{8}\\.webp$`).test(v))
          assert.match(src, new RegExp(`^http://t\\.test/[\\w/-]*${attendu}-[0-9a-f]{8}\\.webp$`), `p = ${p}`)
        }
      })
    })
  })
})

describe('*scrub(images) — un fichier absent : une erreur de build qui le nomme', function () {
  this.timeout(180000)
  let erreurs: string[] = []

  before(async () => {
    ({ erreurs } = await construire('effets-chemins-images-scrub-absent', {
      'scrub-bon.mjs':    scene('<canvas class="cible" *scrub(images: [\'a.webp\', \'b.webp\'])></canvas>'),
      'scrub-absent.mjs': scene('<canvas class="cible" *scrub(images: [\'a.webp\', \'absente.webp\', \'c.webp\'])></canvas>')
    }))
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('l\'erreur nomme le fichier absent et l\'effet', () => {
    assert.ok(erreurs.some((m) => /absente\.webp/.test(m) && /\*scrub/.test(m)), erreurs.join('\n'))
  })

  it('le composant dont tous les fichiers existent ne produit aucune erreur', () => {
    assert.ok(!erreurs.some((m) => /scrub-bon/.test(m)), erreurs.join('\n'))
  })
})
