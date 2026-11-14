// `{ µt 'clé' }` et `{ µt 'k', n: 3 }` écrits sans parenthèses, rendus dans une page réelle construite pour la production : le texte,
// l'attribut `title`, les formes objet `@title={ text: µt 'k' }` et `@confirm={ text: µt 'k', ok: 'Oui' }` montrent la langue de la
// page, puis la nouvelle après `µlang = 'en'`. Chromium, Firefox et WebKit, un à la fois.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'

const COMPOSANT = [
  "<p class=\"a\">{ µt 'salut' }</p>",
  "<p class=\"b\">{ µt 'niveau', n: 3 }</p>",
  "<p class=\"c\" title=\"{ µt 'salut' }\">c</p>",
  "<span class=\"ti\" :title={ text: µt 'salut' }>t</span>",
  "<button class=\"co\" :confirm={ text: µt 'salut', ok: 'Oui' }>o</button>",
  "<button class=\"en\" @click={µlang = 'en'}>en</button>",
].join('\n') + '\n'

// texte, texte à paramètre, `title`, `mjs-title`, puis le texte et le bouton de `mjs-confirm`
const LIRE = `(() => {
  const sh = document.querySelector('mjs-p-t')?._shadow
  if (!sh || !sh.querySelector('.co')) return ''
  const co = JSON.parse(sh.querySelector('.co').getAttribute('mjs-confirm') || '{}')
  return [sh.querySelector('.a').textContent, sh.querySelector('.b').textContent, sh.querySelector('.c').getAttribute('title'), sh.querySelector('.ti').getAttribute('mjs-title'), co.text, co.ok].join('|')
})()`

describe('µt sans parenthèses : affichage et changement de langue (navigateurs réels)', function () {
  this.timeout(120000)
  let outDir = ''

  before(async () => {
    const root   = mjsTmp('traduction-nue')
    const srcDir = join(root, 'src')
    outDir       = join(root, 'out')
    mkdirSync(join(srcDir, 'i18n'), { recursive: true })
    writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'salut: Bonjour\nniveau: Niveau %{n}\n')
    writeFileSync(join(srcDir, 'i18n', 'en.json'), JSON.stringify({ salut: 'Hello', niveau: 'Level %{n}' }))
    writeFileSync(join(srcDir, 'p-t.mjs'), COMPOSANT)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env: 'prod', js: 'bundle', urlPrefix: '/out', i18n: { default: 'fr' } } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const nom of MOTEURS) it(`${nom} : fr au départ, en après µlang = 'en'`, async function () {
    if (!(await moteurPresent(nom))) { this.skip(); return }
    const playwright: any = await import('playwright')
    const browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    try {
      const page = await browser.newPage()
      const erreurs: string[] = []
      page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e).slice(0, 200)))
      await page.route('http://mjs.test/**', (route: any) => {
        const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
        if (chemin === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-p-t></mjs-p-t><script type="module" src="/out/bundle.js"></script></body></html>' })
        const fichier = join(outDir, normalize(chemin.replace(/^\/out\//, '')))
        if (chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/json', body: readFileSync(fichier) })
        return route.fulfill({ status: 404, body: '' })
      })
      await page.goto('http://mjs.test/', { waitUntil: 'load' })
      const fr = 'Bonjour|Niveau 3|Bonjour|Bonjour|Bonjour|Oui'
      await page.waitForFunction(`${LIRE} === '${fr}'`, null, { timeout: 15000 }).catch(() => {})
      assert.equal(await page.evaluate(LIRE), fr, 'langue de la page')
      await page.evaluate(`document.querySelector('mjs-p-t')._shadow.querySelector('.en').click()`)
      const en = 'Hello|Level 3|Hello|Hello|Hello|Oui'
      await page.waitForFunction(`${LIRE} === '${en}'`, null, { timeout: 8000 }).catch(() => {})
      assert.equal(await page.evaluate(LIRE), en, 'après µlang = en')
      assert.deepEqual(erreurs, [])
    }
    finally {
      await browser.close()
    }
  })
})
