// le banc des réponses du serveur aux formulaires d'une page, au navigateur réel : chaque cas, un composant (et ceux qu'il monte) seul dans
// sa page, servi avec la navigation (ujs, ajax, vault). Un envoi dont le corps porte `okok` réussit (`method: 'none'`, `errors: null`), un
// autre est refusé (422, les erreurs que le cas donne pour l'adresse du formulaire) ; `lent` fait attendre sa réponse 1,5 s. Deux liens
// répondent `method: 'none'` : `/lien-null` avec `errors: null`, `/lien-autre` avec une clé `autre` neuve (1 au premier clic d'une page,
// puis 2…). Le relevé d'un cas, une ligne par étape : ce que montre chaque <@@field> (son marquage `mjs-field`, son message), le texte de
// `#ex` (l'objet formulaire), les passages comptés des µeffect (`window.__compte`), ou la valeur que chaque µeffect a lue à son dernier
// passage (`window.__seenMark`, prise en texte pendant le passage : un µeffect resté sur une valeur périmée s'y voit). Chaque moteur, en développement puis en production en un seul fichier minifié (le
// build d'un mode n'est fait qu'au premier test qui le demande) ; les écarts de tous les cas sont rendus ensemble

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../../src/bundler/index.js'
import { mjsTmp } from './tmp.js'
import { MOTEURS, moteurPresent } from './navigateurs-compiles.js'

export interface Gestes {
  voir: (etape: string) => Promise<void>
  compter: (etape: string) => Promise<void>
  vus: (etape: string) => Promise<void>
  noter: (cle: string) => Promise<void>
  ecart: (etape: string, cle: string) => Promise<void>
  remplir: (id: string, valeur: string) => Promise<void>
  cliquer: (id: string) => Promise<void>
  cliquerSeul: (id: string) => Promise<void>
  envoyer: (formulaire: string) => Promise<void>
  lien: (id: string, fin?: string) => Promise<void>
  attendreEnvoi: () => Promise<unknown>
  attendre: (ms: number) => Promise<void>
  appli: (sorte: 'sac' | 'cle', valeur: unknown) => Promise<void>
}

export interface Cas {
  titre: string
  sources: Record<string, string>
  champs: string[]
  objet?: boolean
  refus: Record<string, Record<string, string>>
  attendu: string[]
  jouer: (h: Gestes) => Promise<void>
}

const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' }

// les outils de la page : les passages comptés, la dernière valeur lue par chaque µeffect, un élément cherché à travers les ombres, ce que montre le <@@field> qui enveloppe un champ,
// le texte de `#ex`
const OUTILS = `
  window.__n = {}; window.__compte = (k) => { window.__n[k] = (window.__n[k] || 0) + 1 }
  window.__v = {}; window.__seenMark = (k, v) => { window.__v[k] = v === undefined ? 'undefined' : JSON.stringify(v) }
  window.__deep = (sel) => { const pile = [document]; while (pile.length) { const r = pile.shift(); const e = r.querySelector(sel); if (e) return e; for (const x of r.querySelectorAll('*')) { const s = x._shadow || x.shadowRoot; if (s) pile.push(s) } } return null }
  window.__champ = (id) => { const c = window.__deep('#' + id); if (!c) return null; const w = c.parentNode; const sh = w && (w._shadow || w.shadowRoot); const er = sh && sh.querySelector('.error'); return [c.getAttribute('mjs-field'), er ? er.textContent.trim() : ''] }
  window.__ex = () => { const p = window.__deep('#ex'); try { return p ? JSON.parse(p.textContent) : null } catch { return 'illisible' } }
`

async function construire(prefixe: string, cas: Cas[], mode: string): Promise<string> {
  const root = mjsTmp(prefixe + '-' + mode)
  const src  = join(root, 'src')
  const out  = join(root, 'dist')
  mkdirSync(src, { recursive: true })
  cas.forEach((c, i) => {
    for (const [fichier, contenu] of Object.entries(c.sources)) writeFileSync(join(src, fichier), contenu)
    const n = Object.keys(c.sources)[0].replace('.mjs', '')
    writeFileSync(join(src, 'p' + i + '.mjs'), '<@' + n + '></@' + n + '>\n')
  })
  const prod    = mode === 'production' ? { forceMinify: true, minimalRuntime: true, js: 'bundle', env: 'prod' } : {}
  const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/modularjs', runtime: ['ujs', 'ajax', 'vault'], ...prod } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return out
}

export function bancFormulaires(titre: string, prefixe: string, cas: Cas[]): void {
  const page: Record<string, string>                  = {}
  const refus: Record<string, Record<string, string>> = {}
  cas.forEach((c, i) => {
    for (const f of Object.keys(c.refus)) {
      page[f]  = 'mjs-p' + i
      refus[f] = c.refus[f]
    }
  })

  describe(titre, function () {
    this.timeout(300000)
    const dists: Record<string, string> = {}
    let server: Server | null = null
    let origin = ''
    let mode   = ''
    let autre  = 0

    before(async () => {
      server = createServer((req, res) => {
        const url  = new URL(req.url || '/', 'http://x')
        const f    = url.pathname.slice(1)
        const json = (code: number, o: object) => {
          res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'vary': 'X-MJS-Nav' })
          res.end(JSON.stringify(o))
        }
        const none = { method: 'none', module: null, props: { errors: null }, url: url.pathname, title: null }
        if (req.method === 'POST') {
          let corps = ''
          req.on('data', (d: Buffer) => { corps += d.toString() })
          req.on('end', () => {
            const repondre = () => corps.includes('okok') ? json(200, none) : json(422, { module: page[f], props: { errors: { ...refus[f] } }, url: url.pathname, title: null })
            if (corps.includes('lent')) setTimeout(repondre, 1500)
            else repondre()
          })
          return
        }
        if (f === 'lien-null') return json(200, none)
        if (f === 'lien-autre') return json(200, { method: 'none', module: null, props: { autre: ++autre }, url: url.pathname, title: null })
        if (/^p\d+$/.test(f)) {
          autre = 0
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'vary': 'X-MJS-Nav' })
          res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><script type="module" src="/modularjs/bundle.js"></script></head><body><mjs-${f}></mjs-${f}></body></html>`)
          return
        }
        const m       = /^\/modularjs\/(.+)$/.exec(url.pathname)
        const fichier = m ? join(dists[mode], normalize(decodeURIComponent(m[1])).replace(/^(\.\.[/\\])+/, '')) : ''
        if (!fichier || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end('introuvable'); return }
        res.writeHead(200, { 'content-type': TYPES[extname(fichier)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
        res.end(readFileSync(fichier))
      })
      await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
      origin = 'http://127.0.0.1:' + (server!.address() as any).port
    })

    after(async () => {
      if (server) await new Promise(resolve => server!.close(() => resolve(null)))
      await terminateSharedWorkerPool()
    })

    for (const nom of MOTEURS) {
      for (const m of ['developpement', 'production']) {
        it(`${nom}, ${m}`, async function () {
          if (!await moteurPresent(nom)) this.skip()
          dists[m] ??= await construire(prefixe, cas, m)
          mode = m
          const playwright: any = await import('playwright')
          const browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
          const ecarts: string[] = []
          try {
            for (const [i, c] of cas.entries()) {
              const lignes: string[]              = []
              const notes: Record<string, number> = {}
              const p = await browser.newPage()
              p.on('pageerror', (e: any) => lignes.push(`erreur de la page | ${String(e)}`))
              p.on('console', (x: any) => { if (x.type() === 'error' && !/Failed to load resource/.test(x.text())) lignes.push(`console | ${x.text()}`) })
              await p.addInitScript(OUTILS)
              await p.goto(origin + '/p' + i)
              try { await p.waitForFunction((x: string) => !!(window as any).__champ(x), c.champs[0], { timeout: 15000 }) }
              catch { lignes.push('montage manqué') }
              await p.waitForTimeout(400)
              const prise  = async (id: string) => (await p.evaluateHandle((x: string) => (window as any).__deep('#' + x), id)).asElement()
              const poste  = () => p.waitForResponse((r: any) => r.request().method() === 'POST', { timeout: 8000 })
              const compte = async (cle: string) => await p.evaluate((k: string) => (window as any).__n[k] || 0, cle) as number
              const h: Gestes = {
                voir: async (etape) => {
                  const etats = await p.evaluate((ids: string[]) => ids.map((id) => id + '=' + JSON.stringify((window as any).__champ(id))).join(' '), c.champs)
                  const ex    = c.objet ? ' ex=' + JSON.stringify(await p.evaluate(() => (window as any).__ex())) : ''
                  lignes.push(`${etape} | ${etats}${ex}`)
                },
                compter: async (etape) => { lignes.push(`${etape} | compteurs=${await p.evaluate(() => JSON.stringify((window as any).__n))}`) },
                vus: async (etape) => { lignes.push(`${etape} | ${await p.evaluate(() => Object.keys((window as any).__v).map((k) => k + '=' + (window as any).__v[k]).join(' '))}`) },
                noter: async (cle) => { notes[cle] = await compte(cle) },
                ecart: async (etape, cle) => { lignes.push(`${etape} | ${cle}=+${await compte(cle) - (notes[cle] ?? 0)}`) },
                remplir: async (id, valeur) => { await (await prise(id))!.fill(valeur, { force: true }) },
                cliquer: async (id) => {
                  await (await prise(id))!.click({ force: true, timeout: 5000 })
                  await p.waitForTimeout(300)
                },
                cliquerSeul: async (id) => { await (await prise(id))!.click({ force: true, timeout: 5000 }) },
                envoyer: async (formulaire) => {
                  const rep = poste()
                  await (await prise('b' + formulaire))!.click({ force: true, timeout: 5000 })
                  await rep
                  await p.waitForTimeout(500)
                },
                lien: async (id, fin = '/lien-null') => {
                  const rep = p.waitForResponse((r: any) => r.url().endsWith(fin), { timeout: 8000 })
                  await (await prise(id))!.click({ force: true, timeout: 5000 })
                  await rep
                  await p.waitForTimeout(500)
                },
                attendreEnvoi: () => poste(),
                attendre: (ms) => p.waitForTimeout(ms),
                appli: async (sorte, valeur) => {
                  await p.evaluate(([s, v]: any) => { if (s === 'sac') (window as any).__erreurs(v); else (window as any).__enPlace(v[0], v[1]) }, [sorte, valeur])
                  await p.waitForTimeout(300)
                }
              }
              try { await c.jouer(h) }
              catch (x: any) { lignes.push(`geste manqué | ${String(x && x.message || x).split('\n')[0]}`) }
              await p.close()
              if (JSON.stringify(lignes) !== JSON.stringify(c.attendu)) ecarts.push(`${c.titre}\n    attendu : ${JSON.stringify(c.attendu, null, 1)}\n    relevé  : ${JSON.stringify(lignes, null, 1)}`)
            }
          }
          finally {
            await browser.close()
          }
          if (ecarts.length) console.log(ecarts.join('\n'))
          assert.deepEqual(ecarts, [])
        })
      }
    }
  })
}
