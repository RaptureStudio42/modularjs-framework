// Les effets du catalogue dans Chromium réel, sous « réduire les animations » : chaque règle rangée dans un bloc
// `@media (prefers-reduced-motion: reduce)` gagne, sur chaque élément qu'elle vise. Une règle d'arrêt moins précise
// que la règle d'animation de l'effet perd sans bruit (le raccourci `animation:` remet `animation-play-state` à
// `running`) : l'effet continue de bouger. La page pose chaque effet avec ses réglages par défaut, puis chaque autre
// valeur de son réglage principal quand c'est une liste de mots ; chaque propriété déclarée d'une règle d'arrêt doit
// valoir, une fois calculée sur l'élément visé (pseudo-élément compris), ce qu'elle vaut sur une sonde : un élément
// neuf du même type, dans la même racine, qui reçoit cette seule déclaration en style direct. Une déclaration qui
// dépend du contexte (`var(…)`, `%`, `em`…) n'est pas comparée : elle est comptée à part. Les règles qui ne visent
// aucun élément de la page (un effet au survol, au clic) ne sont pas comparées non plus.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { EFFECTS } from '../src/effects/catalog.js'

async function chromiumPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

// les effets qui ne se posent pas dans cette page, avec la raison
const SANS_ESSAI: Record<string, string> = {
  cursors:   'prend sa connexion dans @sock : il exige un composant qui pose une socket',
  follow:    'prend sa connexion dans @sock : il exige un composant qui pose une socket',
  heatmap:   'prend sa connexion dans @sock : il exige un composant qui pose une socket',
  travel:    'exige sa clé (celle qui apparie la balise d\'une page à celle de l\'autre)',
  shared:    'exige sa clé (celle qui apparie la balise d\'une page à celle de l\'autre)',
  crossfade: 'se pose sur le cycle de vie d\'une balise (:transition, :in, :out), jamais directement'
}

// chaque effet avec ses réglages par défaut, puis chaque autre valeur de son réglage principal quand c'est une liste de mots
const POSES: Array<{ effet: string, nom: string, ecrit: string }> = []
for (const [nom, spec] of Object.entries(EFFECTS)) {
  if (SANS_ESSAI[nom]) continue
  POSES.push({ effet: nom, nom, ecrit: '*' + nom })
  const main    = spec.settings[spec.main]
  const valeurs = main && /^'[^']*'( \| '[^']*')*$/.test(main.rule) ? main.rule.split(' | ').map((v) => v.slice(1, -1)) : []
  for (const v of valeurs) if (v !== main.dflt) POSES.push({ effet: nom, nom: `${nom}(${v})`, ecrit: `*${nom}(${v})` })
}

const STYLE  = '<style>\n.x\n  display: block\n  width: 240px\n  height: 140px\n</style>\n'
const source = (p: { effet: string, ecrit: string }) => (EFFECTS[p.effet].field ? `<input class="x" aria-label="Essai" value="Texte d'essai" ${p.ecrit}>` : `<div class="x" ${p.ecrit}>Texte d'essai</div>`) + '\n' + STYLE

// dans la page : chaque règle d'un bloc « réduire les animations », chaque élément qu'elle vise, chaque propriété déclarée
const COMPARER = (noms: Record<string, string>) => {
  const racines: Array<{ racine: any, effet: string }> = [{ racine: document, effet: 'document' }]
  const voir = (r: any, effet: string) => {
    for (const el of r.querySelectorAll('*')) {
      const sh = el.shadowRoot || el._shadow
      if (!sh || racines.some((x) => x.racine === sh)) continue
      const e = noms[el.localName] || effet
      racines.push({ racine: sh, effet: e })
      voir(sh, e)
    }
  }
  voir(document, 'document')
  const parcourir = (liste: any, calme: boolean, out: any[]) => {
    for (const r of liste) {
      if (r instanceof CSSMediaRule) parcourir(r.cssRules, calme || /prefers-reduced-motion:\s*reduce/.test(r.media.mediaText), out)
      else if (r instanceof CSSStyleRule) { if (calme) out.push(r) }
      else if (r.cssRules) parcourir(r.cssRules, calme, out)
    }
  }
  // la liste de sélecteurs coupée à ses virgules de premier niveau
  const morceaux = (s: string) => {
    const out: string[] = []
    let d   = 0
    let cur = ''
    for (const c of s) {
      if (c === '(' || c === '[') d++
      else if (c === ')' || c === ']') d--
      if (c === ',' && d === 0) { out.push(cur.trim()); cur = '' }
      else cur += c
    }
    if (cur.trim()) out.push(cur.trim())
    return out
  }
  const couper = (sel: string) => {
    const m = sel.match(/::?(before|after|first-line|first-letter|marker|placeholder|selection|backdrop|file-selector-button)$/)
    if (!m) return { base: sel, pseudo: '' }
    let base = sel.slice(0, m.index)
    if (base === '' || /[\s>+~]$/.test(base)) base += '*'
    return { base, pseudo: '::' + m[1] }
  }
  const relatif  = /var\(|%|\d(r?em|ex|ch|vw|vh|vmin|vmax)\b|inherit|currentcolor|env\(|attr\(/i
  // une règle qui n'anime rien (`transition-property` ou `animation-name` à `none`, comparés eux-mêmes) : ses autres réglages
  // de transition ou d'animation n'ont aucun effet visible, l'attente écrite sur l'élément par son effet par exemple
  const inerte   = (st: any, p: string) => (p.startsWith('transition-') && p !== 'transition-property' && st.getPropertyValue('transition-property') === 'none')
    || (p.startsWith('animation-') && p !== 'animation-name' && st.getPropertyValue('animation-name') === 'none')
  const echecs   = new Map<string, { effet: string, selecteur: string, propriete: string, attendu: string, obtenu: string, n: number }>()
  const comparees = new Set<string>()
  const contexte = new Set<string>()
  const inertes  = new Set<string>()
  const vides    = new Set<string>()
  const sondes   = new Map<string, string>()
  for (const { racine, effet } of racines) {
    const hote = racine === document ? document.body : racine
    for (const f of [...(racine.styleSheets || []), ...(racine.adoptedStyleSheets || [])]) {
      let liste: any
      try { liste = f.cssRules } catch { continue }
      const calmes: any[] = []
      parcourir(liste, false, calmes)
      for (const r of calmes) {
        let vise = false
        for (const sel of morceaux(r.selectorText)) {
          const { base, pseudo } = couper(sel)
          let els: any[] = []
          try { els = [...racine.querySelectorAll(base)] } catch { continue }
          for (const el of els) {
            vise = true
            for (let i = 0; i < r.style.length; i++) {
              const p = r.style[i]
              const v = r.style.getPropertyValue(p)
              if (inerte(r.style, p)) { inertes.add(effet + ' ' + sel + ' ' + p); continue }
              if (v === '' || relatif.test(v)) { contexte.add(effet + ' ' + sel + ' ' + p); continue }
              const tag = el.localName.includes('-') ? 'x-sonde' : el.localName
              const cle = effet + '|' + el.namespaceURI + '|' + tag + '|' + p + '|' + v
              let attendu = sondes.get(cle)
              if (attendu === undefined) {
                const sonde = document.createElementNS(el.namespaceURI, tag) as any
                sonde.style.setProperty(p, v)
                hote.appendChild(sonde)
                attendu = getComputedStyle(sonde).getPropertyValue(p)
                sonde.remove()
                sondes.set(cle, attendu)
              }
              const obtenu = getComputedStyle(el, pseudo || null).getPropertyValue(p)
              comparees.add(effet + ' ' + r.cssText)
              if (attendu === obtenu) continue
              // un échec par effet, sélecteur et propriété : la première valeur obtenue, le nombre d'éléments
              const k = [effet, sel, p, attendu].join('|')
              const e = echecs.get(k)
              if (e) e.n++
              else echecs.set(k, { effet, selecteur: sel, propriete: p, attendu, obtenu, n: 1 })
            }
          }
        }
        if (!vise) vides.add(effet + ' ' + r.cssText)
      }
    }
  }
  return { echecs: [...echecs.values()], comparees: [...comparees], contexte: contexte.size, inertes: inertes.size, vides: vides.size }
}

describe('effets du catalogue (Chromium réel) — sous « réduire les animations », les règles d\'arrêt gagnent', function () {
  this.timeout(280000)
  let script  = ''
  let present = false
  let browser: any = null
  const erreurs: string[] = []
  const posees: Array<{ effet: string, nom: string, tag: string }> = []

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('effets-mouvement-reduit-regles-gagnent-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    POSES.forEach((p, i) => writeFileSync(join(srcDir, `e${i}.mjs`), source(p)))
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    const enErreur = new Set<number>()
    for (const e of stats.errors as any[]) {
      const texte = [e.file, e.path, e.message].filter(Boolean).join(' ')
      const m     = texte.match(/\be(\d+)\.mjs\b/)
      if (m) enErreur.add(Number(m[1]))
      erreurs.push((m ? POSES[Number(m[1])].nom + ' : ' : '') + String(e.message).split('\n')[0])
    }
    POSES.forEach((p, i) => { if (!enErreur.has(i)) posees.push({ effet: p.effet, nom: p.nom, tag: `mjs-e${i}` }) })
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    const playwright = await import('playwright')
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('chaque effet hors de SANS_ESSAI se compile', function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(erreurs, [], erreurs.join('\n'))
  })

  it('chaque propriété d\'une règle d\'arrêt vaut, sur chaque élément visé, ce qu\'elle vaut en style direct', async function () {
    if (!present) { this.skip(); return }
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, reducedMotion: 'reduce' })
    const enPage: string[] = []
    page.on('pageerror', (e: any) => enPage.push(String(e.message).split('\n')[0]))
    try {
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body>${posees.map((p) => `<${p.tag}></${p.tag}>`).join('')}<script>${script}</script></body></html>` })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction((tags: string[]) => tags.every((t) => { const h = document.querySelector(t) as any; return !!(h && (h.shadowRoot || h._shadow)) }), posees.map((p) => p.tag))
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      const noms = Object.fromEntries(posees.map((p) => [p.tag, p.nom]))
      const r    = await page.evaluate(COMPARER, noms)
      const lignes = r.echecs.map((e: any) => `${e.effet} — ${e.selecteur} — ${e.propriete} : attendu ${e.attendu}, obtenu ${e.obtenu}${e.n > 1 ? ' (' + e.n + ' éléments)' : ''}`)
      const essayes = new Set(posees.map((p) => p.effet))
      const compares = [...new Set(r.comparees.map((c: string) => c.split(/[ (]/)[0]))].sort()
      console.log(`  ${essayes.size} effets essayés (${posees.length} poses), ${r.comparees.length} règles comparées, ${Object.keys(SANS_ESSAI).length} effets sans essai ; ${r.contexte} déclarations hors comparaison (contexte), ${r.inertes} sans effet (rien ne s'anime), ${r.vides} règles sans élément visé`)
      console.log(`  effets dont une règle d'arrêt vise un élément de la page (${compares.length}) : ${compares.join(', ')}`)
      if (enPage.length) console.log('  erreurs de la page :\n    ' + enPage.join('\n    '))
      assert.ok(r.comparees.length > 0, 'aucune règle comparée : le test tournerait à vide')
      assert.deepEqual(lignes, [], 'des règles d\'arrêt perdent sous « réduire les animations » :\n' + lignes.join('\n'))
    }
    finally {
      await page.close()
    }
  })
})
