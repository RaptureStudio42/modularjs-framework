// *hologram livre les images de ses motifs : en production, le build copie dans la sortie de l'appli, sous empreinte comme les
// autres assets, les seules images des styles de carte que ses pages écrivent (tous les styles quand le build ne sait pas lire le
// style : une variable, un effet choisi par une variable, `runtime: ['fx_hologram']`) ; aucune sans `*hologram` ni avec un style
// simple. En développement, le fichier de l'effet part en entier : les onze images sont copiées. La feuille lit
// `var(--mjs-hologram-pattern-<nom>, url(<l'image livrée>))` : une image que le thème donne passe avant.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler } from '../src/bundler/index.js'
import { selectHologramStyles } from '../src/bundler/hologram-styles.js'
import { HOLOGRAM_MOTIFS, hologramMotifsOf } from '../src/bundler/hologram-motifs.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const DOSSIER = new URL('../src/assets/hologram/', import.meta.url)
const SOURCE  = readFileSync(new URL('../src/runtime/mjs_fx_hologram.ts', import.meta.url), 'utf-8')
const NOMS    = ['sparkles', 'grain', 'sky-far', 'sky-mid', 'sky-near', 'ripples', 'ripples-mask', 'waves', 'discs', 'maze', 'weave']
const PIXEL   = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const trier = (liste: string[]) => [...new Set(liste)].sort()

// l'image du framework d'un motif (son nom, et l'extension qu'elle porte)
const livree = (nom: string) => readdirSync(DOSSIER).filter((f) => f.slice(0, f.lastIndexOf('.')) === nom)

// le précache de la sortie : les adresses publiques de tout ce que le build a émis
const precache = (outDir: string): string[] => JSON.parse(readFileSync(join(outDir, 'mjs-precache.json'), 'utf-8')).assets

// la table des images que le fichier de l'effet porte (motif -> adresse), lue dans son texte
function tableDe(outDir: string): Record<string, string> {
  const table: Record<string, string> = {}
  const effet = readdirSync(outDir).find((f) => f.startsWith('mjs_fx_hologram-') && f.endsWith('.js'))
  if (effet) for (const m of readFileSync(join(outDir, effet), 'utf-8').matchAll(/"([a-z-]+)":"([^"]*mjs_hologram_[^"]+)"/g)) table[m[1]] = m[2]
  return table
}

// un projet à un style de carte, avec un dossier d'images à lui (copie de celles du paquet) : une image peut changer entre deux builds ;
// `bundler()` rend un Bundler neuf sur ce projet
function projetAvecImages(nom: string) {
  const root   = mjsTmp('motifs-livres-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  const images = join(root, 'images')
  mkdirSync(srcDir, { recursive: true })
  mkdirSync(images, { recursive: true })
  writeFileSync(join(srcDir, 'carte.mjs'), '<div class="a" *hologram(night-sky)>x</div>')
  for (const f of readdirSync(DOSSIER)) writeFileSync(join(images, f), readFileSync(new URL(f, DOSSIER)))
  const bundler = (): any => {
    const b: any = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'prod' } as any)
    b.hologramImagesDir = images
    return b
  }
  return { outDir, images, bundler }
}

// un build RÉEL (production par défaut : c'est là que les images sont triées) ; rend les images copiées (nom du motif -> fichier de
// la sortie), la feuille de l'effet et le dossier de sortie
async function construire(nom: string, fichiers: Record<string, string>, conf: any = {}) {
  const root   = mjsTmp('motifs-livres-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, f), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'prod', ...conf } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  const sorties = readdirSync(outDir)
  const images: Record<string, string> = {}
  for (const f of sorties) {
    const m = /^mjs_hologram_([a-z-]+)-[0-9a-z]{5}\.(?:png|webp|jpg)$/.exec(f)
    if (m) images[m[1]] = f
  }
  const noms = sorties.filter((f) => f.endsWith('.js'))
  const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code = [...noms].sort((a, b) => rang(a) - rang(b)).map((f) => readFileSync(join(outDir, f), 'utf-8'))
  try { code.push(readFileSync(join(root, 'bundle.js'), 'utf-8')) }
  catch { }
  const texte = code.join('\n')
  // la feuille de l'effet : son fichier (construction découpée, développement : les noms de propriété de la production sont raccourcis)
  // chargé seul dans une fenêtre, avec un faux cœur
  const feuille = (): string => {
    const effet = noms.find((f) => f.startsWith('mjs_fx_hologram-'))
    assert.ok(effet, 'le fichier de l\'effet est là (construction découpée)')
    const window: any = new Window({ url: 'http://localhost/' })
    window.eval(`var µ = { _mjs_fxDefs: {} };\n${stripEsm(readFileSync(join(outDir, effet as string), 'utf-8'), { bridgeCore: true })}\nglobalThis.µ = µ;`)
    const css = window.µ._mjs_fxDefs.hologram.css
    window.close?.()
    return css
  }
  return { images, feuille, table: tableDe(outDir), outDir, sorties, texte, stats }
}

// les motifs que la feuille lit, avec l'adresse de repli qu'elle leur donne ('none' : aucune image livrée)
function replis(css: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of css.matchAll(/var\(--mjs-hologram-pattern-([a-z-]+),(none|url\("[^"]*"\))\)/g)) out[m[1]] = m[2]
  return out
}

describe('*hologram livre les images de ses motifs', function () {
  this.timeout(120000)

  it('le framework porte les onze images, sous le nom des motifs', () => {
    for (const nom of NOMS) assert.equal(livree(nom).length, 1, nom + ' : une image livrée')
    assert.equal(readdirSync(DOSSIER).length, NOMS.length, 'et aucune autre')
    assert.deepEqual([...HOLOGRAM_MOTIFS].sort(), trier(NOMS), 'la liste du build (développement : tous) est celle du dossier')
  })

  it('une appli à un style (cosmos) : seules les trois images du ciel sont copiées, et le fichier de l\'effet les écrit', async () => {
    const b = await construire('cosmos', { 'carte.mjs': '<div class="a" *hologram(night-sky)>x</div>' })
    assert.deepEqual(Object.keys(b.images).sort(), ['sky-far', 'sky-mid', 'sky-near'])
    assert.deepEqual(Object.keys(b.table).sort(), ['sky-far', 'sky-mid', 'sky-near'], 'la table du fichier de l\'effet')
    for (const [nom, fichier] of Object.entries(b.images)) {
      assert.ok(readFileSync(join(b.outDir, fichier)).equals(readFileSync(new URL(livree(nom)[0], DOSSIER))), nom + ' : l\'image livrée, octet pour octet')
      assert.ok(fichier.endsWith(livree(nom)[0].slice(livree(nom)[0].lastIndexOf('.'))), nom + ' : son extension')
      assert.ok(b.table[nom].endsWith('/' + fichier), nom + ' : la table donne l\'adresse de la copie, ' + b.table[nom])
    }
  })

  it('la feuille lit chaque image livrée après la variable du thème', async () => {
    const b  = await construire('feuille', { 'carte.mjs': '<div class="a" *hologram(night-sky)>x</div>' }, { env: 'dev' })
    const lu = replis(b.feuille())
    for (const nom of ['sky-far', 'sky-mid', 'sky-near']) assert.ok(lu[nom] && lu[nom].startsWith('url("') && lu[nom].includes(b.images[nom]), nom + ' : ' + lu[nom])
  })

  it('chaque style connaît ses motifs : la production copie exactement ceux que sa section lit', async () => {
    const glint = await construire('glint', { 'carte.mjs': '<div class="a" *hologram(glint)>x</div>' })
    const lus   = hologramMotifsOf(selectHologramStyles(SOURCE, new Set(['glint'])))
    assert.ok(lus.includes('sparkles') && !lus.includes('sky-far'), 'glint lit les paillettes, pas le ciel : ' + lus.join(' '))
    assert.deepEqual(Object.keys(glint.images).sort(), lus, 'glint')
    const deux = await construire('deux', { 'a.mjs': '<div class="a" *hologram(night-sky)>x</div>', 'b.mjs': '<div class="b" *hologram(glint)>y</div>' })
    assert.deepEqual(Object.keys(deux.images).sort(), hologramMotifsOf(selectHologramStyles(SOURCE, new Set(['night-sky', 'glint']))), 'deux pages, deux styles : les images des deux')
    for (const nom of ['sky-far', 'sky-mid', 'sky-near', 'sparkles']) assert.ok(deux.images[nom], nom)
  })

  it('une appli sans *hologram : aucune image, aucun repère dans le code', async () => {
    const b = await construire('sans', { 'carte.mjs': '<div class="a">x</div>' })
    assert.deepEqual(b.images, {})
    assert.equal(b.texte.includes('mjs_hologram_'), false)
    assert.equal(b.sorties.some((f) => /^mjs_hologram_/.test(f)), false)
  })

  it('un style simple (gold) : aucune image', async () => {
    const b = await construire('simple', { 'carte.mjs': '<div class="a" *hologram(gold)>x</div>' })
    assert.deepEqual(b.images, {})
  })

  it('un style donné par une variable : les onze images', async () => {
    const b = await construire('variable', { 'carte.mjs': '<script>\n$s = \'curtain\'\n</script>\n<div class="a" *hologram(style: $s)>x</div>' })
    assert.deepEqual(Object.keys(b.images).sort(), trier(NOMS))
  })

  it('un effet choisi par une variable, ou demandé au cœur (`runtime: [\'fx_hologram\']`) : les onze images', async () => {
    const choisi = await construire('choisi', { 'carte.mjs': '<div class="a" *hologram(night-sky)>x</div>', 'choix.mjs': '<script>\n$fx = \'none\'\n</script>\n<span *delta(fx: $fx)>x</span>' })
    assert.deepEqual(Object.keys(choisi.images).sort(), trier(NOMS))
    const force = await construire('force', { 'carte.mjs': '<p>x</p>' }, { runtime: ['fx_hologram'] })
    assert.deepEqual(Object.keys(force.images).sort(), trier(NOMS))
  })

  it('en fichier unique, ou découpé, en production : la même règle', async () => {
    for (const conf of [{ js: 'bundle' }, { js: 'split' }]) {
      const b = await construire('regle', { 'carte.mjs': '<div class="a" *hologram(night-sky)>x</div>' }, conf)
      assert.deepEqual(Object.keys(b.images).sort(), ['sky-far', 'sky-mid', 'sky-near'], JSON.stringify(conf))
    }
  })

  it('en développement : les onze images, quel que soit le style écrit ; en production : celles des styles écrits', async () => {
    const cosmos = { 'carte.mjs': '<div class="a" *hologram(night-sky)>x</div>' }
    const simple = { 'carte.mjs': '<div class="a" *hologram(gold)>x</div>' }
    assert.deepEqual(Object.keys((await construire('dev-cosmos', cosmos, { env: 'dev' })).images).sort(), trier(NOMS), 'dev, un style de carte : toutes')
    assert.deepEqual(Object.keys((await construire('dev-simple', simple, { env: 'dev' })).images).sort(), trier(NOMS), 'dev, un style simple : toutes (le fichier part en entier)')
    assert.deepEqual(Object.keys((await construire('dev-bundle', cosmos, { env: 'dev', js: 'bundle' })).images).sort(), trier(NOMS), 'dev, fichier unique : toutes')
    assert.deepEqual(Object.keys((await construire('dev-sans', { 'carte.mjs': '<div class="a">x</div>' }, { env: 'dev' })).images), [], 'dev, sans *hologram : aucune')
    assert.deepEqual(Object.keys((await construire('prod-cosmos', cosmos, { env: 'prod' })).images).sort(), ['sky-far', 'sky-mid', 'sky-near'], 'prod, un style de carte : ses images')
    assert.deepEqual(Object.keys((await construire('prod-simple', simple, { env: 'prod' })).images), [], 'prod, un style simple : aucune')
  })

  it('un dossier d\'images absent : une erreur de build nommée, en développement comme en production (jamais des images manquantes en silence)', async () => {
    for (const env of ['dev', 'prod']) {
      const root   = mjsTmp('motifs-livres-absent-' + env)
      const srcDir = join(root, 'src')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'carte.mjs'), '<div class="a" *hologram(night-sky)>x</div>')
      const bundler: any = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), env } as any)
      bundler.hologramImagesDir = join(root, 'vide')
      let messages: string[] = []
      try { messages = (await bundler.compile()).errors.map((e: any) => String(e.message ?? e)) }
      catch (e: any) { messages = [String(e.message ?? e)] }
      await bundler.close()
      assert.ok(messages.some((m) => m.includes('introuvable') && m.includes('*hologram') && m.includes(join(root, 'vide'))), env + ' : ' + messages.join(' | ').slice(0, 300))
    }
  })

  it('un second build change rien : mêmes images, mêmes noms, pas de reste', async () => {
    const un   = await construire('stable', { 'carte.mjs': '<div class="a" *hologram(night-sky)>x</div>' })
    const deux = await construire('stable', { 'carte.mjs': '<div class="a" *hologram(night-sky)>x</div>' })
    assert.deepEqual(deux.images, un.images)
    assert.equal(readdirSync(deux.outDir).filter((f) => /^mjs_hologram_/.test(f)).length, 3)
  })

  it('chaque image est publiée sous le préfixe public de la sortie : l\'adresse que la table écrit en est faite, jamais un nom nu', async () => {
    const carte = { 'carte.mjs': '<div class="a" *hologram(night-sky)>x</div>' }
    // le préfixe tiré du dossier de sortie (`out`), un préfixe donné, une adresse absolue (un CDN)
    const cas: Array<[Record<string, string>, string]> = [[{}, '/out'], [{ urlPrefix: '/assets/site' }, '/assets/site'], [{ urlPrefix: 'https://cdn.example.test/m' }, 'https://cdn.example.test/m']]
    for (const [conf, prefixe] of cas) {
      const b = await construire('prefixe', carte, conf)
      assert.deepEqual(Object.keys(b.table).sort(), ['sky-far', 'sky-mid', 'sky-near'], prefixe)
      for (const [nom, fichier] of Object.entries(b.images)) assert.equal(b.table[nom], prefixe + '/' + fichier, prefixe + ' : ' + nom)
    }
  })

  it('les images copiées sont au précache, à leur adresse publique, comme tout asset émis ; sans *hologram, aucune', async () => {
    const b = await construire('precache', { 'carte.mjs': '<div class="a" *hologram(night-sky)>x</div>' }, { urlPrefix: '/assets/site' })
    assert.deepEqual(precache(b.outDir).filter((a) => a.includes('mjs_hologram_')), Object.values(b.images).map((f) => '/assets/site/' + f).sort(), 'les trois images du ciel, et elles seules')
    const sans = await construire('precache-sans', { 'carte.mjs': '<div class="a">x</div>' }, { urlPrefix: '/assets/site' })
    assert.deepEqual(precache(sans.outDir).filter((a) => a.includes('mjs_hologram_')), [], 'sans *hologram : aucune image au précache')
  })

  it('le résumé de fin de build compte les images copiées : une ligne par image (nom sans empreinte, adresse publique, octets du fichier), et le total les contient', async () => {
    const b = await construire('resume', { 'carte.mjs': '<div class="a" *hologram(night-sky)>x</div>' }, { urlPrefix: '/assets/site' })
    const lignes = b.stats.sizes.filter((s: any) => s.name.startsWith('mjs_hologram_'))
    assert.deepEqual(lignes.map((s: any) => s.name).sort(), ['mjs_hologram_sky-far.png', 'mjs_hologram_sky-mid.png', 'mjs_hologram_sky-near.png'])
    for (const [nom, fichier] of Object.entries(b.images)) {
      const ligne = lignes.find((s: any) => s.name === 'mjs_hologram_' + nom + '.png')
      assert.equal(ligne.path, '/assets/site/' + fichier, nom + ' : son adresse publique')
      assert.equal(ligne.bytes, statSync(join(b.outDir, fichier)).size, nom + ' : la taille du fichier copié')
    }
    const js     = readdirSync(b.outDir).filter((f) => f.endsWith('.js')).reduce((somme, f) => somme + statSync(join(b.outDir, f)).size, 0)
    const images = Object.values(b.images).reduce((somme, f) => somme + statSync(join(b.outDir, f)).size, 0)
    assert.equal(b.stats.sizes.reduce((somme: number, s: any) => somme + s.bytes, 0), js + images, 'le total est celui des fichiers JS et des images émis')
    const sans = await construire('resume-sans', { 'carte.mjs': '<div class="a">x</div>' }, { urlPrefix: '/assets/site' })
    assert.deepEqual(sans.stats.sizes.filter((s: any) => s.name.startsWith('mjs_hologram_')), [], 'sans *hologram : aucune image dans le résumé')
  })

  it('une image du paquet qui change est republiée sous sa nouvelle empreinte : l\'ancienne copie part, la table, le précache et la liste des fichiers publiés suivent', async () => {
    const pixel = Buffer.from(PIXEL.split(',')[1], 'base64')
    for (const reprise of ['la même instance', 'une instance neuve']) {
      const projet   = projetAvecImages('change')
      const source   = join(projet.images, 'sky-far.png')
      const copies   = () => readdirSync(projet.outDir).filter((f) => /^mjs_hologram_sky-far-[0-9a-z]{5}\.png$/.test(f))
      const voisines = () => readdirSync(projet.outDir).filter((f) => /^mjs_hologram_/.test(f) && !f.includes('sky-far')).sort()
      let bundler    = projet.bundler()
      try {
        assert.deepEqual((await bundler.compile()).errors.map((e: any) => e.message), [], reprise)
        const avant  = copies()
        const autres = voisines()
        assert.equal(avant.length, 1, reprise + ' : une copie du ciel lointain, ' + avant.join(' '))
        assert.equal(bundler.publishedAssets.get(source)?.name, avant[0], reprise + ' : la table des fichiers publiés connaît la copie de cette source')
        writeFileSync(source, pixel)
        if (reprise === 'une instance neuve') {
          await bundler.close()
          bundler = projet.bundler()
        }
        assert.deepEqual((await bundler.compile()).errors.map((e: any) => e.message), [], reprise)
        const apres = copies()
        assert.equal(apres.length, 1, reprise + ' : une seule copie du ciel lointain, l\'ancienne est partie : ' + apres.join(' '))
        assert.notEqual(apres[0], avant[0], reprise + ' : l\'empreinte a changé avec l\'image')
        assert.ok(readFileSync(join(projet.outDir, apres[0])).equals(pixel), reprise + ' : la copie est la nouvelle image')
        assert.deepEqual(voisines(), autres, reprise + ' : les autres images du ciel ne bougent pas')
        assert.equal(tableDe(projet.outDir)['sky-far'], '/out/' + apres[0], reprise + ' : la table du fichier de l\'effet désigne la nouvelle copie')
        assert.equal(bundler.publishedAssets.get(source)?.name, apres[0], reprise + ' : la table des fichiers publiés ne garde que la nouvelle copie de cette source')
        const liste = precache(projet.outDir)
        assert.ok(liste.includes('/out/' + apres[0]), reprise + ' : la nouvelle copie est au précache')
        assert.equal(liste.includes('/out/' + avant[0]), false, reprise + ' : l\'ancienne n\'y est plus')
      }
      finally {
        await bundler.close()
      }
    }
  })

  describe('dans Chromium : le thème passe avant l\'image livrée', function () {
    let browser: any = null
    let page: any    = null

    before(async function () {
      try {
        const { chromium } = await import('playwright')
        if (!existsSync(chromium.executablePath())) { this.skip(); return }
        browser = await chromium.launch({ args: ['--no-sandbox'] })
      }
      catch { this.skip(); return }
      page = await browser.newPage()
    })

    after(async () => { if (browser) await browser.close() })

    it('sans thème, la couche du ciel lointain est l\'image livrée ; avec l\'image du thème, c\'est celle du thème', async function () {
      const b = await construire('chromium', { 'carte.mjs': '<div class="a" *hologram(night-sky)>x</div>' }, { env: 'dev' })
      await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
      const lu = await page.evaluate(([css, pixel]: [string, string]) => {
        const style = document.createElement('style')
        style.textContent = css
        document.head.appendChild(style)
        const site = document.createElement('div')
        site.innerHTML = '<span mjs-fx-layer="hologram" mjs-fx-hologram-card mjs-fx-hologram-style="night-sky" mjs-fx-hologram-nu mjs-fx-hologram-open><b></b><i></i></span>'
        document.body.appendChild(site)
        const fond = () => getComputedStyle(site.querySelector('i') as Element).backgroundImage
        const sans = fond()
        site.style.setProperty('--mjs-hologram-pattern-sky-far', `url("${pixel}")`)
        return { sans, avec: fond() }
      }, [b.feuille(), PIXEL])
      assert.ok(lu.sans.includes(b.images['sky-far']), 'sans thème : ' + lu.sans.slice(0, 160))
      assert.ok(lu.avec.includes('data:image/png'), 'avec le thème : ' + lu.avec.slice(0, 160))
      assert.equal(lu.avec.includes(b.images['sky-far']), false, 'l\'image livrée ne passe pas avant le thème')
    })

    it('l\'image que la feuille désigne se charge à son vrai chemin, sous le préfixe public de la sortie, et nulle part ailleurs', async function () {
      const prefixe = '/assets/site'
      const b       = await construire('chemin-reel', { 'carte.mjs': '<div class="a" *hologram(night-sky)>x</div>' }, { env: 'dev', urlPrefix: prefixe })
      const servis: string[]  = []
      const manques: string[] = []
      const contexte          = await browser.newContext()
      try {
        const onglet = await contexte.newPage()
        // le site ne répond qu'à la page et aux images que la construction a copiées, à l'adresse exacte (préfixe compris) ; tout le reste : 404
        await onglet.route('http://t.test/**', (route: any) => {
          const chemin  = new URL(route.request().url()).pathname
          const fichier = chemin.startsWith(prefixe + '/') ? chemin.slice(prefixe.length + 1) : ''
          if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>' })
          if (/^mjs_hologram_[a-z-]+-[0-9a-z]{5}\.png$/.test(fichier) && existsSync(join(b.outDir, fichier))) {
            servis.push(chemin)
            return route.fulfill({ contentType: 'image/png', body: readFileSync(join(b.outDir, fichier)) })
          }
          manques.push(chemin)
          return route.fulfill({ status: 404, body: '' })
        })
        await onglet.goto('http://t.test/')
        const lu = await onglet.evaluate(async (css: string) => {
          const style = document.createElement('style')
          style.textContent = css
          document.head.appendChild(style)
          const site = document.createElement('div')
          site.innerHTML = '<span mjs-fx-layer="hologram" mjs-fx-hologram-card mjs-fx-hologram-style="night-sky" mjs-fx-hologram-nu mjs-fx-hologram-open><b></b><i></i></span>'
          document.body.appendChild(site)
          const fond = getComputedStyle(site.querySelector('i') as Element).backgroundImage
          const url  = /url\("([^"]*mjs_hologram_sky-far-[^"]+)"\)/.exec(fond)?.[1] ?? null
          if (!url) return { fond, url, largeur: 0 }
          // la couche demande cette adresse : l'image se décode, ou la page n'a rien reçu
          const largeur = await new Promise<number>((fin) => {
            const image = new Image()
            image.onload  = () => fin(image.naturalWidth)
            image.onerror = () => fin(0)
            image.src     = url
          })
          return { fond, url, largeur }
        }, b.feuille())
        assert.ok(lu.url, 'la couche du ciel lointain lit l\'image livrée : ' + lu.fond.slice(0, 160))
        assert.equal(new URL(lu.url as string).pathname, prefixe + '/' + b.images['sky-far'], 'l\'adresse est faite du préfixe public de la sortie')
        assert.deepEqual(manques, [], 'rien n\'a été demandé hors du préfixe')
        assert.ok(servis.includes(prefixe + '/' + b.images['sky-far']), 'l\'image a été servie à son vrai chemin : ' + servis.join(' '))
        assert.equal(lu.largeur, readFileSync(join(b.outDir, b.images['sky-far'])).readUInt32BE(16), 'l\'image se décode : sa largeur est celle du fichier copié')
      }
      finally {
        await contexte.close()
      }
    })
  })
})

// la doc d'*hologram : l'auteur des images de motif livrées (son nom, le lien de son dépôt), et la gravure d'une carte par un exemple
// qui ne cite aucune carte à jouer
describe('*hologram — la doc : le crédit des images de motif et la gravure', () => {
  const DOC     = readFileSync(new URL('../docs/38-effets.md', import.meta.url), 'utf-8')
  const lignes  = DOC.split('\n')
  const puce    = (debut: string) => lignes.findIndex((l) => l.startsWith(debut))
  const CARTES  = lignes.filter((l) => l.includes('`*hologram`')).join('\n') + '\n' + lignes.slice(puce('- `*hologram`, la gravure'), puce('- `*flipcard`')).join('\n')

  it('les images de motif livrées : la doc nomme leur auteur et donne le lien de son dépôt', () => {
    const i = puce('- `*hologram`, les images de motif')
    assert.ok(i >= 0, 'la ligne du crédit manque')
    assert.match(lignes[i], /Simon Goellner \(simeydotme\)/)
    assert.match(lignes[i], /\]\(https:\/\/github\.com\/simeydotme\/pokemon-cards-css\)/)
  })

  it('la gravure : une phrase qui dit ce qu\'elle fait, et le même style, la même fenêtre, avec et sans `image`', () => {
    const i = puce('- `*hologram`, la gravure')
    assert.ok(i >= 0, 'la puce de la gravure manque')
    assert.match(lignes[i], /aucun dessin ne brille/)
    assert.match(lignes[i], /les traits de la gravure brillent/)
    const bloc = lignes.slice(i + 1, i + 8)
    const [debut, fin] = [bloc.findIndex((l) => /^\s*```html$/.test(l)), bloc.findIndex((l, n) => n > 0 && /^\s*```$/.test(l))]
    assert.ok(debut >= 0 && fin > debut, 'l\'exemple de code manque')
    const [sans, avec] = bloc.slice(debut + 1, fin)
    const zone = /zone: (inset\([^)]*\))/
    assert.ok(sans.includes('*hologram(frame, zone:') && !sans.includes('image:'), 'la carte sans gravure')
    assert.ok(avec.includes('*hologram(frame, image: \'gravure.webp\', zone:'), 'la carte avec sa gravure')
    assert.equal(zone.exec(sans)![1], zone.exec(avec)![1], 'la même fenêtre')
  })

  it('la doc d\'*hologram ne cite aucune carte à jouer, hors le nom du dépôt de l\'auteur', () => {
    assert.doesNotMatch(CARTES.replace(/pokemon-cards-css/g, ''), /pok[eé]mon/i)
  })
})
