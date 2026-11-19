// `:group` dans un {for} dont le groupe suit la ligne (`:group=!{q.rep}`) : le `name` de l'auteur n'est gardé que si une de ses expressions,
// entre accolades, lit la variable de ligne que lit le groupe (`r-{q.id}`, `reponse[{q.id}]`) — il part alors tel quel avec le formulaire.
// Le texte fixe ne compte pas (`q-{$suf}` dans une boucle `for q`), ni la variable d'une autre boucle (`r-{g.id}` d'une boucle intérieure) :
// remplacé par un nom propre à chaque ligne, cocher « oui » sur la seconde ligne ne décoche pas « oui » sur la première, dans Chromium et
// dans Firefox — vraie construction (production, un seul fichier), mode strict
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const script  = `\n<script>\n  $suf = 'a'\n  $qs = [{ id: 7, rep: '', opts: [{ id: 1, v: 'oui' }, { id: 2, v: 'non' }] }, { id: 9, rep: '', opts: [{ id: 1, v: 'oui' }, { id: 2, v: 'non' }] }]\n</script>\n`
const simple  = (nom: string) => `<form class="f">{for q in $qs by id}<p><input aria-label="oui" type="radio" name="${nom}" :group=!{q.rep} value="oui"><input aria-label="non" type="radio" name="${nom}" :group=!{q.rep} value="non"></p>{end}</form>` + script
const FICHIERS: Record<string, string> = {
  'g-suf':     simple('q-{$suf}'),
  'g-imbr':    `<form class="f">{for q in $qs by id}<p>{for g in q.opts by id}<input aria-label={g.v} type="radio" name="r-{g.id}" :group=!{q.rep} value={g.v}>{end}</p>{end}</form>` + script,
  'g-ligne':   simple('r-{q.id}'),
  'g-reponse': simple('reponse[{q.id}]')
}

describe('`:group` dans un {for} : le name de l\'auteur gardé seulement quand une de ses expressions lit la ligne du groupe', function () {
  this.timeout(200000)
  let code: string

  before(async () => {
    const root = mjsTmp('groupe-name-expression')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(src, { recursive: true })
    for (const [nom, texte] of Object.entries(FICHIERS)) writeFileSync(join(src, nom + '.mjs'), texte)
    const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle', minify: false } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    code = '"use strict";\n' + readFileSync(join(out, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const moteur of ['chromium', 'firefox'] as const) {
    it(`${moteur} : « oui » sur la première ligne puis sur la seconde — cases, état et formulaire`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) this.skip()
      const navigateur = await playwright[moteur].launch()
      try {
        const page = await navigateur.newPage()
        await page.setContent('<!doctype html><html><head></head><body></body></html>')
        await page.addScriptTag({ content: code })
        const vus = await page.evaluate(async (noms: string[]) => {
          document.body.innerHTML = noms.map((n) => `<mjs-${n}></mjs-${n}>`).join('')
          const ombre = (n: string) => { const h: any = document.querySelector('mjs-' + n); return h._shadow || h.shadowRoot || h }
          for (let i = 0; i < 100 && noms.some((n) => ombre(n).querySelectorAll('input').length < 4); i++) await new Promise((r) => setTimeout(r, 20))
          const sortie: Record<string, unknown> = {}
          for (const n of noms) {
            const cases = [...ombre(n).querySelectorAll('input')] as HTMLInputElement[]
            cases[0].click()
            await new Promise((r) => setTimeout(r, 50))
            cases[2].click()
            await new Promise((r) => setTimeout(r, 80))
            const hote: any = document.querySelector('mjs-' + n)
            const envoi = [...new FormData(ombre(n).querySelector('form')) as any].map(([k, v]: [string, string]) => (/^mjs-grp-/.test(k) ? 'propre' : k) + '=' + v)
            sortie[n] = { cases: cases.map((c) => c.checked), etat: [...hote._state.qs].map((q: any) => String(q.rep)), envoi }
          }
          return sortie
        }, Object.keys(FICHIERS))
        await page.close()
        const independantes = { cases: [true, false, true, false], etat: ['oui', 'oui'], envoi: ['propre=oui', 'propre=oui'] }
        assert.deepEqual(vus, {
          'g-suf':     independantes,
          'g-imbr':    independantes,
          'g-ligne':   { cases: [true, false, true, false], etat: ['oui', 'oui'], envoi: ['r-7=oui', 'r-9=oui'] },
          'g-reponse': { cases: [true, false, true, false], etat: ['oui', 'oui'], envoi: ['reponse[7]=oui', 'reponse[9]=oui'] }
        })
      }
      finally { await navigateur.close() }
    })
  }
})
