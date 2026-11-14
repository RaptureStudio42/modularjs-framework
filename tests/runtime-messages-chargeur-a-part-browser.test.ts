// moteurs exigés : tous
// Navigateurs réels, production minifiée : le chargeur des messages de la console vit dans son propre fichier
// (`mjs_msg-<empreinte>.js`). Une page sans message ne demande rien ; au premier message écrit (erreur, avertissement,
// journal) ou à la première erreur non attrapée, le chargeur part, puis le fichier de la langue, et le texte complet suit
// le texte court, au même niveau. Plusieurs messages écrits pendant l'import sont tous rendus ; un changement de langue
// demande l'autre fichier ; un chargeur introuvable laisse le texte court sans rien faire tomber, et le message écrit 30 s
// après l'échec le redemande, sous une adresse neuve. Deux constructions :
// fichier unique (celle de l'appli du banc) et fichiers séparés avec `csp: true`, servie sous une politique stricte
// (`script-src 'self'`, Trusted Types exigés), puis sous une politique à nonce et 'strict-dynamic'. Sous un nonce seul (ni 'self'
// ni 'strict-dynamic'), le fichier unique : l'import du chargeur hérite du nonce du module qui l'appelle (Chromium, Firefox et
// WebKit le font) ; un navigateur qui le refuserait laisse le texte court, sans rien faire tomber.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { RUNTIME_LABELS } from '../src/runtime-labels.js'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'
import { mjsTmp } from './helpers/tmp.js'

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' }
const CSP_STRICTE = 'default-src \'self\'; script-src \'self\'; style-src \'self\'; require-trusted-types-for \'script\''
const CSP_NONCE   = 'default-src \'self\'; script-src \'nonce-m5g3r4\' \'strict-dynamic\'; style-src \'self\''
const CSP_SEUL    = 'default-src \'self\'; script-src \'nonce-m5g3r4\'; style-src \'self\' \'unsafe-inline\''

const court   = (vars: Record<string, string>) => '[ModularJS] initReadOnly ' + JSON.stringify(vars)
const complet = (lang: 'fr' | 'en', vars: Record<string, string>) => '[ModularJS] ' + RUNTIME_LABELS[lang].err.initReadOnly.replace(/\{(\w+)\}/g, (_: string, n: string) => vars[n])

describe('chargeur des messages à part — navigateurs réels, production minifiée', function () {
  this.timeout(300000)

  let server: Server | null = null
  let origin = ''
  const requetes: string[] = []
  const reglage = { retard: 0, absent: false }
  const nomCourt: Record<string, string> = {}

  async function construire(cle: 'a' | 'b', dist: string, opts: Record<string, any>) {
    const srcDir = join(dist, '..', 'src-' + cle)
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'sain.mjs'), '<p id="sain">tout va bien</p>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(dist, 'assets'), manifestPath: join(dist, 'assets', 'bundle.js'), urlPrefix: '/' + cle + '/assets', runtime: 'core', env: 'prod', forceMinify: true, logLevel: 'log', ...opts } as any)
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const fichiers = readdirSync(join(dist, 'assets'))
    assert.equal(fichiers.filter((f) => /^mjs_msg-[0-9a-z]{5}\.js$/.test(f)).length, 1, fichiers.join(', '))
    nomCourt[cle] = JSON.parse(readFileSync(join(dist, 'assets', '.mangle-cache.json'), 'utf-8'))._mjs_msg || '_mjs_msg'
    return fichiers
  }

  before(async () => {
    const root = mjsTmp('chargeur-messages-navigateur')
    const distA = join(root, 'a')
    const distB = join(root, 'b')
    await construire('a', distA, { js: 'bundle' })
    const fichiersB = await construire('b', distB, { js: 'split', css: 'split', csp: true })
    const coeur = fichiersB.find((f) => /^mjs_core-.*\.js$/.test(f))!
    const page = (lang: string, corps: string, nonce = '') => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><script type="module"${nonce} src="assets/bundle.js"></script><script type="module"${nonce} src="essai.js"></script></head><body>${corps}</body></html>`
    writeFileSync(join(distA, 'essai.js'), 'import { µ } from \'./assets/bundle.js\'\nwindow.µ = µ\n')
    writeFileSync(join(distB, 'essai.js'), `import { µ } from './assets/${coeur}'\nwindow.µ = µ\n`)
    for (const dist of [distA, distB]) {
      writeFileSync(join(dist, 'vide.html'), page('fr', '<mjs-sain></mjs-sain>').replace('<script type="module" src="essai.js"></script>', ''))
      writeFileSync(join(dist, 'fr.html'), page('fr', '<mjs-sain></mjs-sain>'))
      writeFileSync(join(dist, 'en.html'), page('en', '<mjs-sain></mjs-sain>'))
    }
    writeFileSync(join(distB, 'nonce.html'), page('fr', '<mjs-sain></mjs-sain>', ' nonce="m5g3r4"'))
    writeFileSync(join(distA, 'nonce-seul.html'), page('fr', '<mjs-sain></mjs-sain>', ' nonce="m5g3r4"'))

    server = createServer((req, res) => {
      const url = (req.url ?? '').split('?')[0]
      requetes.push(url)
      const m = /^\/(a|b)\/(.+)$/.exec(url)
      const fichier = m ? join(m[1] === 'a' ? distA : distB, m[2]) : ''
      if (!fichier || !existsSync(fichier) || (reglage.absent && url.includes('/mjs_msg-'))) { res.writeHead(404); res.end('introuvable'); return }
      const entetes: Record<string, string> = { 'content-type': TYPES[extname(fichier)] ?? 'application/octet-stream' }
      if (m![1] === 'b' && url.endsWith('.html')) entetes['content-security-policy'] = url.endsWith('/nonce.html') ? CSP_NONCE : CSP_STRICTE
      if (url === '/a/nonce-seul.html') entetes['content-security-policy'] = CSP_SEUL
      const envoyer = () => { res.writeHead(200, entetes); res.end(readFileSync(fichier)) }
      if (reglage.retard && url.includes('/mjs_msg-')) setTimeout(envoyer, reglage.retard)
      else envoyer()
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()))
    origin = 'http://127.0.0.1:' + (server!.address() as any).port
  })

  after(async () => {
    if (server) await new Promise((resolve) => server!.close(() => resolve(null)))
    await terminateSharedWorkerPool()
  })

  for (const nom of MOTEURS) {
    describe(nom, function () {
      let browser: any = null

      before(async function () {
        if (!(await moteurPresent(nom))) {
          console.log('  ℹ️  ' + nom + ' non installé, test sauté. Activer : `npx playwright install ' + nom + '`')
          this.skip()
        }
        const playwright: any = await import('playwright')
        browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      })

      after(async () => {
        if (browser) await browser.close()
      })

      // une page neuve ; `console` : [niveau, texte] de chaque écriture ; `erreurs` : exceptions de la page
      async function ouvrir(chemin: string) {
        requetes.length = 0
        const page = await browser.newPage()
        const sortie: Array<[string, string]> = []
        const erreurs: string[] = []
        page.on('console', (m: any) => sortie.push([m.type(), m.text()]))
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.goto(origin + chemin)
        const fin = Date.now() + 15000
        while (chemin.includes('vide') ? false : !(await page.evaluate(() => !!(window as any).µ))) {
          if (Date.now() > fin) throw new Error('µ jamais exposé par essai.js : ' + JSON.stringify(sortie))
          await page.waitForTimeout(50)
        }
        return { page, sortie, erreurs }
      }

      // attend qu'une écriture de la console contienne `texte` (relu d'ici : la page n'évalue aucun texte sous la politique stricte)
      async function attendreTexte(page: any, sortie: Array<[string, string]>, texte: string): Promise<void> {
        const fin = Date.now() + 15000
        while (!sortie.some(([, t]) => t.includes(texte))) {
          if (Date.now() > fin) throw new Error(`texte jamais écrit : ${texte}\n${sortie.map((l) => l.join(' ')).join('\n')}`)
          await page.waitForTimeout(50)
        }
      }

      const fichiers = () => requetes.filter((u) => /mjs_msg-|mjs_err-/.test(u))
      // l'appli est toujours là : son composant défini, et µ rend encore un message (texte court, faute de chargeur)
      const vivante = (page: any, m: string) => page.evaluate(([m]: any) => !!customElements.get('mjs-sain') && (window as any).µ[m]('initReadOnly', { tag: 'apres', prop: 'p' }), [m])

      it('page sans message : ni le chargeur ni le fichier de la langue ne sont demandés', async () => {
        const { page } = await ouvrir('/a/vide.html')
        await page.evaluate(() => (window as any).__mjsBundleReady)
        await page.waitForTimeout(800)
        assert.deepEqual(fichiers(), [])
        await page.close()
      })

      for (const [niveau, appel] of [['error', 'error'], ['warning', 'warn'], ['log', 'log']] as const) {
        it(`premier message écrit (µ.${appel}) : texte court, puis le chargeur, le fichier fr et le texte complet, au même niveau`, async () => {
          const { page, sortie, erreurs } = await ouvrir('/a/fr.html')
          const vars = { tag: 'x-' + appel, prop: 'p' }
          await page.evaluate(([f, m, v]: any) => (window as any).µ[f]((window as any).µ[m]('initReadOnly', v)), [appel, nomCourt.a, vars])
          await attendreTexte(page, sortie, complet('fr', vars))
          const ecrits = sortie.filter(([, t]) => t.startsWith('[ModularJS] '))
          assert.deepEqual(ecrits, [[niveau, court(vars)], [niveau, complet('fr', vars)]])
          assert.equal(fichiers().length, 2, fichiers().join(', '))
          assert.match(fichiers()[0], /^\/a\/assets\/mjs_msg-[0-9a-z]{5}\.js$/)
          assert.match(fichiers()[1], /^\/a\/assets\/mjs_err-fr-[0-9a-z]{5}\.json$/)
          assert.deepEqual(erreurs, [])
          await page.close()
        })
      }

      it('plusieurs messages écrits avant l\'arrivée du chargeur : tous rendus, un chargeur, un fichier', async () => {
        reglage.retard = 600
        try {
          const { page, sortie, erreurs } = await ouvrir('/a/fr.html')
          const v = ['a', 'b', 'c', 'd'].map((t) => ({ tag: t, prop: 'p' }))
          await page.evaluate(([m, v]: any) => {
            const µ = (window as any).µ
            µ.error(µ[m]('initReadOnly', v[0]))
            µ.warn(µ[m]('initReadOnly', v[1]))
            µ.log(µ[m]('initReadOnly', v[2]))
          }, [nomCourt.a, v])
          await page.waitForTimeout(150)
          await page.evaluate(([m, v]: any) => (window as any).µ.error((window as any).µ[m]('initReadOnly', v[3])), [nomCourt.a, v])
          for (const x of v) await attendreTexte(page, sortie, complet('fr', x))
          await page.waitForTimeout(300)
          for (const [i, niveau] of ['error', 'warning', 'log', 'error'].entries()) {
            assert.deepEqual(sortie.filter(([, t]) => t === complet('fr', v[i])), [[niveau, complet('fr', v[i])]])
          }
          assert.deepEqual(fichiers().map((u) => u.replace(/-[0-9a-z]{5}\./, '.')), ['/a/assets/mjs_msg.js', '/a/assets/mjs_err-fr.json'])
          assert.deepEqual(erreurs, [])
          await page.close()
        }
        finally { reglage.retard = 0 }
      })

      it('changement de langue : le fichier fr, puis le fichier en, un seul chargeur', async () => {
        const { page, sortie } = await ouvrir('/a/fr.html')
        const v1 = { tag: 'l1', prop: 'p' }
        const v2 = { tag: 'l2', prop: 'p' }
        await page.evaluate(([m, v]: any) => (window as any).µ.error((window as any).µ[m]('initReadOnly', v)), [nomCourt.a, v1])
        await attendreTexte(page, sortie, complet('fr', v1))
        await page.evaluate(() => { document.documentElement.lang = 'en' })
        await page.evaluate(([m, v]: any) => (window as any).µ.error((window as any).µ[m]('initReadOnly', v)), [nomCourt.a, v2])
        await attendreTexte(page, sortie, complet('en', v2))
        assert.deepEqual(fichiers().map((u) => u.replace(/-[0-9a-z]{5}\./, '.')), ['/a/assets/mjs_msg.js', '/a/assets/mjs_err-fr.json', '/a/assets/mjs_err-en.json'])
        await page.close()
      })

      it('erreur non attrapée qui porte un texte court : chargeur, fichier en, texte complet en erreur', async () => {
        const { page, sortie } = await ouvrir('/a/en.html')
        const vars = { tag: 'leve', prop: 'p' }
        await page.evaluate(([m, v]: any) => { setTimeout(() => { throw new Error((window as any).µ[m]('initReadOnly', v)) }) }, [nomCourt.a, vars])
        await attendreTexte(page, sortie, complet('en', vars))
        assert.ok(sortie.some(([n, t]) => n === 'error' && t === complet('en', vars)), JSON.stringify(sortie))
        assert.deepEqual(fichiers().map((u) => u.replace(/-[0-9a-z]{5}\./, '.')), ['/a/assets/mjs_msg.js', '/a/assets/mjs_err-en.json'])
        await page.close()
      })

      it('chargeur introuvable (404) : le texte court reste, rien ne tombe, aucun fichier de langue', async () => {
        reglage.absent = true
        try {
          const { page, sortie, erreurs } = await ouvrir('/a/fr.html')
          const vars = { tag: 'absent', prop: 'p' }
          await page.evaluate(([m, v]: any) => (window as any).µ.error((window as any).µ[m]('initReadOnly', v)), [nomCourt.a, vars])
          await page.waitForTimeout(1200)
          assert.deepEqual(sortie.filter(([, t]) => t.startsWith('[ModularJS] ')), [['error', court(vars)]])
          assert.deepEqual(fichiers().map((u) => u.replace(/-[0-9a-z]{5}\./, '.')), ['/a/assets/mjs_msg.js'])
          assert.deepEqual(erreurs, [])
          assert.equal(await vivante(page, nomCourt.a), court({ tag: 'apres', prop: 'p' }))
          await page.close()
        }
        finally { reglage.absent = false }
      })

      // un import() refusé le reste pour toute la page, à la même adresse (table des modules du document) : sans une adresse
      // neuve, le nouvel essai ne partirait jamais sur le réseau et les messages resteraient courts jusqu'au rechargement
      it('chargeur introuvable, puis revenu : 30 s après l\'échec, le message suivant le redemande et s\'écrit en entier', async () => {
        reglage.absent = true
        try {
          const { page, sortie, erreurs } = await ouvrir('/a/fr.html')
          const v1 = { tag: 'coupe', prop: 'p' }
          const v2 = { tag: 'revenu', prop: 'p' }
          await page.evaluate(([m, v]: any) => (window as any).µ.error((window as any).µ[m]('initReadOnly', v)), [nomCourt.a, v1])
          await page.waitForTimeout(1200)
          reglage.absent = false
          // l'horloge de la page avance de 31 s : le délai qui suit un échec est passé
          await page.evaluate(() => { const vrai = Date.now; Date.now = () => vrai() + 31000 })
          await page.evaluate(([m, v]: any) => (window as any).µ.error((window as any).µ[m]('initReadOnly', v)), [nomCourt.a, v2])
          await attendreTexte(page, sortie, complet('fr', v2))
          assert.deepEqual(sortie.filter(([, t]) => t.startsWith('[ModularJS] ')), [['error', court(v1)], ['error', court(v2)], ['error', complet('fr', v2)]])
          assert.deepEqual(fichiers().map((u) => u.replace(/-[0-9a-z]{5}\./, '.')), ['/a/assets/mjs_msg.js', '/a/assets/mjs_msg.js', '/a/assets/mjs_err-fr.json'])
          assert.deepEqual(erreurs, [])
          await page.close()
        }
        finally { reglage.absent = false }
      })

      it('politique à nonce seul, fichier unique : l\'appli marche ; le chargeur passe ou il est refusé, le texte court reste, rien ne tombe', async () => {
        const { page, sortie, erreurs } = await ouvrir('/a/nonce-seul.html')
        const vars = { tag: 'nonce', prop: 'p' }
        await page.evaluate(([m, v]: any) => (window as any).µ.error((window as any).µ[m]('initReadOnly', v)), [nomCourt.a, vars])
        await page.waitForTimeout(1500)
        const ecrits = sortie.filter(([, t]) => t.startsWith('[ModularJS] '))
        const charge  = ecrits.some(([, t]) => t === complet('fr', vars))
        assert.deepEqual(ecrits[0], ['error', court(vars)])
        if (!charge) assert.ok(sortie.some(([, t]) => /mjs_msg-/.test(t)), 'le refus du chargeur est dit par le navigateur : ' + JSON.stringify(sortie))
        console.log('      ' + nom + ' : chargeur ' + (charge ? 'chargé (nonce étendu à l\'import)' : 'refusé, texte court gardé'))
        assert.deepEqual(erreurs, [])
        assert.ok(await vivante(page, nomCourt.a))
        await page.close()
      })

      for (const [chemin, quoi] of [['/b/fr.html', 'politique stricte (script-src \'self\', Trusted Types exigés), fichiers séparés, csp: true'], ['/b/nonce.html', 'politique à nonce et \'strict-dynamic\', sans \'self\'']] as const) {
        it(`${quoi} : le chargeur se charge et le texte complet s'écrit, sans refus`, async () => {
          const { page, sortie, erreurs } = await ouvrir(chemin)
          const vars = { tag: 'csp', prop: 'p' }
          await page.evaluate(([m, v]: any) => (window as any).µ.error((window as any).µ[m]('initReadOnly', v)), [nomCourt.b, vars])
          await attendreTexte(page, sortie, complet('fr', vars))
          assert.deepEqual(fichiers().map((u) => u.replace(/-[0-9a-z]{5}\./, '.')), ['/b/assets/mjs_msg.js', '/b/assets/mjs_err-fr.json'])
          assert.deepEqual(sortie.filter(([, t]) => /Content.Security.Policy|Refused to|TrustedScript/i.test(t)), [])
          assert.deepEqual(erreurs, [])
          await page.close()
        })
      }
    })
  }
})
