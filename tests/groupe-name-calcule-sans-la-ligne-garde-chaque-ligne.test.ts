// `:group` dans un {for} dont le groupe suit la ligne, avec un `name` calculé qui ne lit pas la ligne (`name="r-{$suffixe}"`, `name={'rep'}`) :
// ce texte est le même sur toutes les lignes, comme un `name` fixe — chaque ligne garde son groupe, cocher « non » sur la seconde ne
// décoche pas « oui » sur la première, les cases suivent l'état. Un `name` qui lit la ligne (`r-{q.id}`) reste celui de l'auteur et part
// avec le formulaire. Vraie construction (production, un seul fichier), mode strict

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ligne = (nom: string) => `<form class="f" action="/envoi" method="post">{for q in $qs by id}<p><input aria-label="oui" class="o" type="radio" name=${nom} :group=!{q.rep} value="oui"><input aria-label="non" class="n" type="radio" name=${nom} :group=!{q.rep} value="non"></p>{end}</form>\n<script>\n  $suffixe = 'a'\n  $qs = [{ id: 7, rep: '' }, { id: 9, rep: '' }]\n</script>\n`
const fichiers: Record<string, string> = { 'g-suffixe': ligne('"r-{$suffixe}"'), 'g-constant': ligne("{'rep'}"), 'g-ligne': ligne('"r-{q.id}"') }

describe('`:group` dans un {for}, `name` calculé sans la ligne : chaque ligne garde son groupe, comme avec un `name` fixe', function () {
  this.timeout(120000)
  let window: any

  before(async () => {
    const root = mjsTmp('groupe-name-calcule')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(src, { recursive: true })
    for (const [nom, texte] of Object.entries(fichiers)) writeFileSync(join(src, nom + '.mjs'), texte)
    const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle', minify: false } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    const code = '"use strict";\n' + readFileSync(join(out, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
    window = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
    window.eval(code)
    window.document.body.innerHTML = Object.keys(fichiers).map((n) => `<mjs-${n}></mjs-${n}>`).join('')
    await new Promise((r) => setTimeout(r, 300))
  })

  after(async () => {
    await window?.happyDOM.close()
    await terminateSharedWorkerPool()
  })

  // « oui » sur la première ligne, puis « non » sur la seconde : les cases cochées, l'état, ce que le formulaire envoie
  const jouer = async (nom: string) => {
    const e = window.document.querySelector('mjs-' + nom)
    const r = e._shadow
    r.querySelectorAll('input.o')[0].click()
    await new Promise((f) => setTimeout(f, 50))
    r.querySelectorAll('input.n')[1].click()
    await new Promise((f) => setTimeout(f, 80))
    const cases = [...r.querySelectorAll('input')].map((i: any) => i.checked)
    return { cases, etat: [...e._state.qs].map((q: any) => String(q.rep)), envoi: [...new window.FormData(r.querySelector('form')).entries()].length }
  }

  it('name="r-{$suffixe}" et name={\'rep\'} : les deux lignes restent cochées, comme l\'état, et le formulaire envoie les deux réponses', async () => {
    for (const nom of ['g-suffixe', 'g-constant']) assert.deepEqual(await jouer(nom), { cases: [true, false, false, true], etat: ['oui', 'non'], envoi: 2 }, nom)
  })

  it('témoin : name="r-{q.id}" reste celui de l\'auteur, et le formulaire envoie r-7 et r-9', async () => {
    await jouer('g-ligne')
    const r = window.document.querySelector('mjs-g-ligne')._shadow
    assert.deepEqual([...new window.FormData(r.querySelector('form')).entries()], [['r-7', 'oui'], ['r-9', 'non']])
  })
})
