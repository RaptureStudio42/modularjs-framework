// Une appli servie sous la politique de sécurité la plus stricte, `Content-Security-Policy: require-trusted-types-for 'script'`
// (toute écriture de HTML brut refusée par le navigateur, sauf une valeur de confiance), se monte et vit sans un seul refus :
// gabarits, composant en ombre, `{if}`, `{for}`, `{await}`, un effet à filtre SVG (`*filter(duotone)`), la bulle de `@title`,
// la modale, l'éditeur riche et les icônes de sa barre, la navigation qui va chercher la page suivante et l'échange. Le HTML brut voulu par l'auteur
// (`{{…}}`, à la racine comme dans un `{for}`, `@html`) ne passe jamais par la politique du framework : sans politique de la page, il
// est refusé, le message dit quoi faire et le reste du composant s'affiche ; quand la page pose sa politique `default`, il
// passe par elle, de même qu'un `{{…}}` de `<@head>` ou de `<@failed>` et un repli `µfailed` qui rend une chaîne. L'éditeur colle,
// dépose et insère un lien ; le panneau de développement montre les onglets d'un composant ; la modale garde une valeur
// TrustedHTML de l'appli. Une page qui liste ses politiques (`trusted-types …`) sans les exiger se monte comme sans Trusted Types,
// et un seul message dit d'ajouter `mjs` à la liste ; sous l'en-tête strict, la même liste laisse le refus au navigateur.
// Chromium, Firefox et WebKit réels (les trois connaissent Trusted Types).

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, moteurPresent, compilerScript } from './helpers/navigateurs-compiles.js'

const ORIGINE = 'http://mjs.test'
const CSP     = "require-trusted-types-for 'script'"
// les refus du navigateur, tels que chaque moteur les écrit
const REFUS   = /Trusted|Sink type mismatch/i

const SOURCES: Record<string, string> = {
  'tst-tt-app.mjs': [
    '<script>',
    '$vu = true',
    "$liste = ['a', 'b', 'c']",
    "$p = Promise.resolve('fini')",
    "$texte = '<p>bonjour</p>'",
    "ouvrir = -> µ.modal.fire({ title: 'Titre', text: 'Corps', icon: 'success' })",
    '</script>',
    '<h1 class="gabarit">gabarit</h1>',
    '{if $vu}<p class="si">si</p>{end}',
    '<ul>{for x in $liste}<li class="ligne">{x}</li>{end}</ul>',
    '{await $p}<p class="attente">attente</p>{success v}<p class="await">{v}</p>{end}',
    '<div class="fx" *filter(duotone)>fx</div>',
    '<button class="titre" :title="Une bulle">t</button>',
    '<button class="modale" @click={ouvrir()}>m</button>',
    '<@@editor value=!{$texte}></@@editor>',
    '<a class="lien" href="/deux" :confirm="Aller ?">deux</a>',
    '<@tst-tt-ombre/>',
    '<@tst-tt-silhouette/>'
  ].join('\n') + '\n',
  // la silhouette d'un {await} qui attend : dessinée par le gabarit du framework
  'tst-tt-silhouette.mjs': '<script>\n$jamais = new Promise(-> null)\n</script>\n{await $jamais *skeleton}{success v}<p class="vu">{v.titre}</p>{end}\n',
  'tst-tt-ombre.mjs': '<p class="ombre">ombre</p>\n',
  'tst-tt-deux.mjs': '<script>\n$n = 2\n</script>\n<p class="deux">page {$n}</p>\n',
  'tst-tt-brut.mjs': [
    '<script>',
    '$h = \'<b class="gras">gras</b>\'',
    '$hs = [\'<i class="r">r</i>\']',
    '</script>',
    '<div class="brut">{{$h}}</div>',
    '<ul>{for x in $hs}<li>{{x}}</li>{end}</ul>',
    '<div class="lie" :html=!{$h}></div>',
    '<p class="apres">après</p>'
  ].join('\n') + '\n',
  // HTML d'auteur hors du gabarit : un {{…}} dans <@head>, dans le repli d'un <@failed>, un repli µfailed qui rend une chaîne
  'tst-tt-tete.mjs': '<script>\n$m = \'<meta name="tt-brut" content="b">\'\n</script>\n<@head><title>tete</title>{{$m}}</@head>\n<p class="tete">tete</p>\n',
  'tst-tt-casse.mjs': '<script>\n$x = null\n</script>\n<p>{$x.y}</p>\n',
  'tst-tt-repli.mjs': '<script>\n$r = \'<b class="rb">repli</b>\'\n</script>\n<@tst-tt-casse/>\n<@failed err reset>\n<div class="repli">{{$r}}</div>\n</@failed>\n',
  'tst-tt-chaine.mjs': '<script>\nµfailed (err, reset)->\n  \'<p class="chaine">repli en chaîne</p>\'\n</script>\n<@tst-tt-casse/>\n'
}

// cherche dans la page et dans toutes les ombres (ouvertes, ou gardées par le composant dans `_shadow`)
const PROFOND = `
  window.__profond = (sel, filtre) => {
    const file = [document]
    while (file.length) {
      const r = file.shift()
      for (const el of r.querySelectorAll(sel)) if (!filtre || filtre(el)) return el
      for (const el of r.querySelectorAll('*')) {
        if (el._shadow && el._shadow !== el && !file.includes(el._shadow)) file.push(el._shadow)
        if (el.shadowRoot && !file.includes(el.shadowRoot)) file.push(el.shadowRoot)
      }
    }
    return null
  }
`

// une politique `default` posée par l'appli : elle assainit (ici, retire les balises script) et laisse passer le reste
const POLITIQUE_APPLI = `<script>trustedTypes.createPolicy('default', { createHTML: (s) => s.replace(/<\\/?script[^>]*>/gi, '') })</script>`

// en-têtes propres à une adresse : une liste de politiques sans `require-trusted-types-for`, puis la même sous l'en-tête strict
const CSP_DE: Record<string, string> = {
  '/liste': 'trusted-types app',
  '/none': "trusted-types 'none'",
  '/strict-liste': CSP + '; trusted-types app'
}

// le message du framework qui dit d'ajouter `mjs` à la liste des politiques
const AJOUTEZ_MJS = (m: string): boolean => m.includes('[ModularJS]') && m.includes('trusted-types') && m.includes('Ajoutez « mjs »')

// le curseur au bout de la surface de l'éditeur, puis un événement `type` porteur d'un transfert de données (`champ` : clipboardData
// ou dataTransfer), lancé sur la surface ; Firefox ne prend pas ce transfert du constructeur, il est posé sur l'événement
const LANCER = `
  window.__lancer = (type, champ, html, texte) => {
    const s = window.__profond('[contenteditable]', (el) => el.textContent.includes('bonjour'))
    const dt = new DataTransfer()
    dt.setData('text/html', html)
    dt.setData('text/plain', texte)
    const b = s.getBoundingClientRect()
    const init = { bubbles: true, cancelable: true, composed: true, clientX: b.right - 2, clientY: b.bottom - 2 }
    const ev = type === 'paste' ? new ClipboardEvent(type, init) : (typeof DragEvent === 'function' ? new DragEvent(type, init) : new MouseEvent(type, init))
    Object.defineProperty(ev, champ, { value: dt })
    s.dispatchEvent(ev)
  }
`

describe('sécurité stricte : une appli sous require-trusted-types-for (navigateurs réels)', function () {
  this.timeout(240000)
  let script = ''

  before(async () => {
    script = await compilerScript('securite-stricte-tt', SOURCES)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  const document_ = (corps: string, avant = ''): string =>
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>tt</title></head><body>${corps}${avant}<script>${PROFOND}${LANCER}</script><script>${script}</script></body></html>`

  for (const nom of MOTEURS) {
    describe(nom, function () {
      let present = false
      let browser: any

      before(async () => {
        present = await moteurPresent(nom)
        if (!present) {
          console.log('  ℹ️  ' + nom + ' non installé, test sauté. Activer : `npx playwright install ' + nom + '`')
          return
        }
        const playwright: any = await import('playwright')
        browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      })

      after(async () => {
        if (browser) await browser.close()
      })

      // une page neuve sous l'en-tête strict (ou celui de `CSP_DE` pour son adresse) ; `messages` : erreurs de la page et de la console,
      // avertissements compris
      async function ouvrir(chemin: string): Promise<{ contexte: any, page: any, messages: string[] }> {
        const contexte = await browser.newContext()
        const messages: string[] = []
        await contexte.route('**/*', (route: any) => {
          const u = new URL(route.request().url())
          const appli = document_('<mjs-tst-tt-app mjs-light></mjs-tst-tt-app>')
          const auteur = '<mjs-tst-tt-tete mjs-light></mjs-tst-tt-tete><mjs-tst-tt-repli mjs-light></mjs-tst-tt-repli><mjs-tst-tt-chaine mjs-light></mjs-tst-tt-chaine>'
          const corps: Record<string, string> = {
            '/': appli,
            '/deux': '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>deux</title></head><body><mjs-tst-tt-deux></mjs-tst-tt-deux></body></html>',
            '/brut': document_('<mjs-tst-tt-brut mjs-light></mjs-tst-tt-brut>'),
            '/brut-politique': document_('<mjs-tst-tt-brut mjs-light></mjs-tst-tt-brut>', POLITIQUE_APPLI),
            '/auteur-politique': document_(auteur, POLITIQUE_APPLI),
            '/liste': appli,
            '/none': appli,
            '/strict-liste': appli
          }
          if (u.origin !== ORIGINE || !(u.pathname in corps)) return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP_DE[u.pathname] ?? CSP }, body: corps[u.pathname] })
        })
        const page = await contexte.newPage()
        page.on('pageerror', (e: any) => messages.push('pageerror: ' + String(e)))
        page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') messages.push(m.type() + ': ' + m.text()) })
        await page.goto(ORIGINE + chemin)
        return { contexte, page, messages }
      }

      // attend que `fn` soit vrai dans la page, relu d'ici : l'attente de Playwright relit un texte par `eval` dans la page, que
      // l'en-tête strict refuse lui aussi ; échoue en disant ce que la page a écrit dans sa console
      async function attendre(page: any, messages: string[], quoi: string, fn: () => unknown): Promise<void> {
        const fin = Date.now() + 15000
        while (Date.now() < fin) {
          if (await page.evaluate(fn).catch(() => false)) return
          await new Promise((r) => setTimeout(r, 100))
        }
        assert.fail(`${quoi} : jamais vu — console : ${messages.join(' | ').slice(0, 1500) || '(vide)'}`)
      }

      it('gabarits, ombre, {if}, {for}, {await}, *filter, @title, modale, éditeur et navigation : tout s\'affiche, aucun refus', async function () {
        if (!present) this.skip()
        const { contexte, page, messages } = await ouvrir('/')
        try {
          await attendre(page, messages, 'le gabarit', () => !!document.querySelector('mjs-tst-tt-app h1.gabarit'))
          await attendre(page, messages, 'le composant en ombre', () => !!(window as any).__profond('p.ombre'))
          await attendre(page, messages, '{if}', () => !!document.querySelector('mjs-tst-tt-app p.si'))
          await attendre(page, messages, '{for}', () => document.querySelectorAll('mjs-tst-tt-app li.ligne').length === 3)
          await attendre(page, messages, '{await}', () => document.querySelector('mjs-tst-tt-app p.await')?.textContent === 'fini')
          await attendre(page, messages, 'le filtre SVG de *filter', () => /url\(/.test(getComputedStyle(document.querySelector('mjs-tst-tt-app div.fx')).filter))
          await attendre(page, messages, 'l\'éditeur', () => !!(window as any).__profond('[contenteditable]', (el) => el.textContent.includes('bonjour')))
          await attendre(page, messages, 'les icônes de la barre de l\'éditeur', () => !!(window as any).__profond('.ico', (el) => !!el.firstElementChild))
          await attendre(page, messages, 'la silhouette du {await}', () => !!(window as any).__profond('[mjs-skel]'))
          await page.hover('mjs-tst-tt-app button.titre')
          await attendre(page, messages, 'la bulle de @title', () => !!(window as any).__profond('*', (el) => el.textContent === 'Une bulle' && el.tagName !== 'BUTTON'))
          await page.click('mjs-tst-tt-app button.modale')
          await attendre(page, messages, 'la modale', () => !!(window as any).__profond('[id^="mjs-modal-content-"]', (el) => el.textContent === 'Corps'))
          // la modale se ferme (Échap) : son fond ne couvre plus le lien
          await page.keyboard.press('Escape')
          // la navigation : la confirmation répond oui, la page suivante arrive par la navigation du framework et remplace le contenu
          await page.evaluate(() => {
            const w: any = window
            w.__meme = true
            w.µ.config.confirm = false
            w.confirm = () => true
          })
          await page.click('mjs-tst-tt-app a.lien', { timeout: 10000 })
          await attendre(page, messages, 'la page suivante', () => !!(window as any).__profond('p.deux', (el) => el.textContent === 'page 2'))
          assert.equal(await page.evaluate(() => (window as any).__meme === true), true, 'la page doit être échangée par le framework, pas rechargée')
          assert.deepEqual(messages.filter((m) => REFUS.test(m)), [], 'aucun refus Trusted Types')
        }
        finally {
          await contexte.close()
        }
      })

      it('{{…}} sans politique de la page : refusé, le message dit quoi faire, le reste du composant s\'affiche', async function () {
        if (!present) this.skip()
        const { contexte, page, messages } = await ouvrir('/brut')
        try {
          await attendre(page, messages, 'le reste du composant', () => !!document.querySelector('mjs-tst-tt-brut p.apres'))
          await page.waitForTimeout(300)
          assert.equal(await page.evaluate(() => document.querySelectorAll('mjs-tst-tt-brut b.gras, mjs-tst-tt-brut i.r').length), 0, 'le HTML brut ne doit pas être écrit')
          const clairs = messages.filter((m) => m.includes('[ModularJS]') && m.includes('Trusted Types') && m.includes("createPolicy('default'"))
          assert.equal(clairs.length >= 2, true, `un message clair par {{…}} refusé (racine et {for}) — console : ${messages.join(' | ').slice(0, 1500)}`)
          assert.deepEqual(messages.filter((m) => m.startsWith('pageerror')), [], 'aucune erreur non rattrapée')
        }
        finally {
          await contexte.close()
        }
      })

      it('{{…}} quand la page pose sa politique default : le HTML passe par elle', async function () {
        if (!present) this.skip()
        const { contexte, page, messages } = await ouvrir('/brut-politique')
        try {
          await attendre(page, messages, 'le HTML brut à la racine', () => !!document.querySelector('mjs-tst-tt-brut b.gras'))
          await attendre(page, messages, 'le HTML brut dans le {for}', () => !!document.querySelector('mjs-tst-tt-brut i.r'))
          await attendre(page, messages, 'le HTML brut de @html', () => !!document.querySelector('mjs-tst-tt-brut div.lie b.gras'))
          assert.deepEqual(messages.filter((m) => REFUS.test(m)), [], 'aucun refus Trusted Types')
        }
        finally {
          await contexte.close()
        }
      })

      it('{{…}} de <@head> et de <@failed>, repli µfailed en chaîne : avec la politique default de la page, ils passent par elle', async function () {
        if (!present) this.skip()
        const { contexte, page, messages } = await ouvrir('/auteur-politique')
        try {
          await attendre(page, messages, 'le {{…}} de <@head>', () => !!document.head.querySelector('meta[name="tt-brut"]'))
          await attendre(page, messages, 'le {{…}} du repli <@failed>', () => !!(window as any).__profond('.repli b.rb'))
          await attendre(page, messages, 'le repli µfailed en chaîne', () => !!(window as any).__profond('p.chaine'))
          assert.deepEqual(messages.filter((m) => REFUS.test(m)), [], 'aucun refus Trusted Types')
        }
        finally {
          await contexte.close()
        }
      })

      it('l\'éditeur : coller, déposer et insérer un lien passent, le HTML inséré est celui du nettoyeur', async function () {
        if (!present) this.skip()
        const { contexte, page, messages } = await ouvrir('/')
        try {
          await attendre(page, messages, 'l\'éditeur', () => !!(window as any).__profond('[contenteditable]', (el) => el.textContent.includes('bonjour')))
          const surface = await page.evaluateHandle(() => (window as any).__profond('[contenteditable]', (el) => el.textContent.includes('bonjour')))
          await surface.asElement().click()
          await page.keyboard.press('Control+End')
          // le collage : le nettoyeur garde le gras et retire l'image et son gestionnaire
          await page.evaluate(() => (window as any).__lancer('paste', 'clipboardData', '<p>colle <b>gras</b><img src="x" onerror="window.__pwn = 1"></p>', 'colle gras'))
          await attendre(page, messages, 'le texte collé', () => !!(window as any).__profond('[contenteditable] strong, [contenteditable] b', (el) => el.textContent === 'gras'))
          // le dépôt
          await page.evaluate(() => (window as any).__lancer('drop', 'dataTransfer', '<p>pose <i>ici</i></p>', 'pose ici'))
          await attendre(page, messages, 'le texte déposé', () => !!(window as any).__profond('[contenteditable] em, [contenteditable] i', (el) => el.textContent === 'ici'))
          // le lien : le raccourci ouvre le champ d'adresse, Entrée insère le lien au curseur
          await surface.asElement().click()
          await page.keyboard.press('Control+End')
          await page.keyboard.press('Control+k')
          await attendre(page, messages, 'le champ d\'adresse', () => !!(window as any).__profond('input.link-url'))
          await page.evaluate(() => (window as any).__profond('input.link-url').focus())
          await page.keyboard.type('exemple.fr')
          await page.keyboard.press('Enter')
          await attendre(page, messages, 'le lien inséré', () => !!(window as any).__profond('[contenteditable] a', (el) => el.getAttribute('href') === 'https://exemple.fr'))
          await page.waitForTimeout(300)
          assert.equal(await page.evaluate(() => !!(window as any).__profond('[contenteditable] img') || (window as any).__pwn === 1), false, 'l\'image collée et son gestionnaire ne doivent pas entrer')
          assert.deepEqual(messages.filter((m) => REFUS.test(m)), [], 'aucun refus Trusted Types')
          assert.deepEqual(messages.filter((m) => m.startsWith('pageerror')), [], 'aucune erreur non rattrapée')
        }
        finally {
          await contexte.close()
        }
      })

      it('le panneau de développement : choisir un composant montre ses onglets, sans refus', async function () {
        if (!present) this.skip()
        const { contexte, page, messages } = await ouvrir('/')
        try {
          await attendre(page, messages, 'le gabarit', () => !!document.querySelector('mjs-tst-tt-app h1.gabarit'))
          await page.keyboard.press('Control+Shift+Space')
          await attendre(page, messages, 'l\'arbre du panneau', () => !!(window as any).__profond('.arbre .ligne'))
          const ligne = await page.evaluateHandle(() => Array.from((window as any).__profond('.arbre').querySelectorAll('.ligne')).find((b: any) => /tst-tt-app/.test(b.textContent)))
          await ligne.asElement().click()
          await attendre(page, messages, 'les onglets du composant', () => !!(window as any).__profond('.onglet'))
          const onglets = await page.evaluate(() => (window as any).__profond('.onglet').parentNode.querySelectorAll('.onglet').length)
          for (let i = 0; i < onglets; i++) {
            await page.evaluate((n: number) => (window as any).__profond('.onglet').parentNode.querySelectorAll('.onglet')[n].click(), i)
            await page.waitForTimeout(100)
          }
          assert.equal(onglets > 1, true, 'plusieurs onglets')
          assert.deepEqual(messages.filter((m) => REFUS.test(m)), [], 'aucun refus Trusted Types')
          assert.deepEqual(messages.filter((m) => m.startsWith('pageerror')), [], 'aucune erreur non rattrapée')
        }
        finally {
          await contexte.close()
        }
      })

      it('la modale : une valeur TrustedHTML de l\'appli dans html s\'affiche telle quelle', async function () {
        if (!present) this.skip()
        const { contexte, page, messages } = await ouvrir('/')
        try {
          await attendre(page, messages, 'le gabarit', () => !!document.querySelector('mjs-tst-tt-app h1.gabarit'))
          await page.evaluate(() => {
            const w: any = window
            const politique = w.trustedTypes.createPolicy('appli', { createHTML: (s: string) => s })
            w.µ.modal.fire({ html: politique.createHTML('<b class="confiance">de confiance</b>') })
          })
          await attendre(page, messages, 'le HTML de confiance dans la modale', () => !!(window as any).__profond('[id^="mjs-modal-content-"] b.confiance'))
          assert.deepEqual(messages.filter((m) => REFUS.test(m)), [], 'aucun refus Trusted Types')
        }
        finally {
          await contexte.close()
        }
      })

      for (const [chemin, liste] of [['/liste', 'trusted-types app'], ['/none', "trusted-types 'none'"]]) {
        it(`une page qui liste ses politiques sans les exiger (${liste}) : elle se monte, un seul message dit d'ajouter mjs`, async function () {
          if (!present) this.skip()
          const { contexte, page, messages } = await ouvrir(chemin)
          try {
            await attendre(page, messages, 'le gabarit', () => !!document.querySelector('mjs-tst-tt-app h1.gabarit'))
            await attendre(page, messages, 'l\'éditeur', () => !!(window as any).__profond('[contenteditable]', (el) => el.textContent.includes('bonjour')))
            await page.waitForTimeout(300)
            assert.deepEqual(messages.filter((m) => m.startsWith('pageerror')), [], 'aucune erreur non rattrapée')
            assert.equal(messages.filter(AJOUTEZ_MJS).length, 1, `un seul message — console : ${messages.join(' | ').slice(0, 1500)}`)
          }
          finally {
            await contexte.close()
          }
        })
      }

      it('sous l\'en-tête strict, une liste sans mjs : le navigateur refuse, un seul message dit d\'ajouter mjs', async function () {
        if (!present) this.skip()
        const { contexte, page, messages } = await ouvrir('/strict-liste')
        try {
          const fin = Date.now() + 10000
          while (Date.now() < fin && !messages.some(AJOUTEZ_MJS)) await new Promise((r) => setTimeout(r, 100))
          await page.waitForTimeout(500)
          assert.equal(messages.filter(AJOUTEZ_MJS).length, 1, `un seul message — console : ${messages.join(' | ').slice(0, 1500)}`)
          assert.equal(messages.some((m) => REFUS.test(m) && !m.includes('[ModularJS]')), true, 'le refus du navigateur')
          assert.equal(await page.evaluate(() => !!document.querySelector('mjs-tst-tt-app h1.gabarit')), false, 'rien ne se monte')
        }
        finally {
          await contexte.close()
        }
      })
    })
  }
})
