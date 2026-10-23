// Un modèle en fichier d'un composant appelé par son alias court — `doc/doc-carte.mjs` s'écrit
// `<@carte>` ; son modèle `doc/doc-carte.compacte.mjs` doit être choisi par `<@carte layout="compacte">`
// comme par `<@doc-carte layout="compacte">`. Un alias que deux composants se disputent, ou qu'un vrai
// composant porte déjà comme nom, ne reçoit pas les modèles de l'autre.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function construire(etiquette: string, fichiers: Record<string, string>) {
  const root   = mjsTmp('modeles-alias-' + etiquette)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  for (const [nom, src] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(srcDir, nom)), { recursive: true })
    writeFileSync(join(srcDir, nom), src)
  }
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  const files   = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const lire    = (debut: string) => files.filter((f) => f.startsWith(debut + '-')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  return { outDir, files, lire, erreurs: stats.errors.map((e: any) => e.message).join('\n') }
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('un modèle en fichier, sous l\'alias court de son composant', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('doc/doc-carte.compacte.mjs, choisi par <@carte layout="compacte">', function () {
    let window: any
    let page: any
    let code = ''

    before(async () => {
      const b = await construire('ok', {
        'doc/doc-carte.mjs':          '<article class="normale">{$titre}</article>\n',
        'doc/doc-carte.compacte.mjs': '<p class="compacte">{$titre}</p>\n',
        'doc/doc-page.mjs':           '<@carte class="a" titre="A"></@carte>\n<@carte class="b" layout="compacte" titre="B"></@carte>\n<@doc-carte class="c" layout="compacte" titre="C"></@doc-carte>\n',
      })
      assert.equal(b.erreurs, '')
      code = b.lire('doc-page')
      const tout = [...b.files.filter((f) => f.startsWith('mjs_')), ...b.files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(b.outDir, f), 'utf-8'))).join('\n')
      window = new Window({ url: 'http://localhost/' })
      window.eval(`${tout}\nglobalThis.µ = µ;`)
      window.document.body.innerHTML = '<mjs-doc-page></mjs-doc-page>'
      page = window.document.querySelector('mjs-doc-page')
      await attendre(() => !!page._shadow?.querySelector('.b')?._shadow?.querySelector('.compacte') && !!page._shadow?.querySelector('.c')?._shadow?.querySelector('.compacte'))
    })

    after(() => { window?.close?.() })

    it('par l\'alias court : la balise devient celle du modèle, qui s\'affiche', () => {
      assert.doesNotMatch(code, /layout="compacte"/)
      const b = page._shadow.querySelector('.b')
      assert.equal(b.localName, 'mjs-carte--compacte')
      assert.equal(b._shadow.querySelector('.compacte')?.textContent, 'B')
    })

    it('par le nom complet, comme avant ; sans layout, le composant de base', () => {
      assert.equal(page._shadow.querySelector('.c').localName, 'mjs-doc-carte--compacte')
      const a = page._shadow.querySelector('.a')
      assert.equal(a.localName, 'mjs-carte')
      assert.equal(a._shadow.querySelector('.normale')?.textContent, 'A')
    })
  })

  it('un vrai composant carte.mjs garde son nom : les modèles de doc-carte ne passent pas sur lui', async () => {
    const b = await construire('vrai', {
      'carte.mjs':                  '<article class="vraie">{$titre}</article>\n',
      'doc/doc-carte.mjs':          '<article class="normale">{$titre}</article>\n',
      'doc/doc-carte.compacte.mjs': '<p class="compacte">{$titre}</p>\n',
      'hote.mjs':                   '<@carte layout="compacte" titre="X"></@carte>\n',
    })
    assert.doesNotMatch(b.lire('hote'), /mjs-carte--compacte/)
  })

  it('un modèle à la fois fichier et style nommé : la faute se dit une fois, sous le vrai nom du composant', async () => {
    const b = await construire('double', {
      'doc/doc-carte.mjs':          '<article class="normale">{$titre}</article>\n<style name="compacte">\n  article\n    color: red\n</style>\n',
      'doc/doc-carte.compacte.mjs': '<p class="compacte">{$titre}</p>\n',
      'hote.mjs':                   '<@carte titre="X"></@carte>\n',
    })
    const lignes = b.erreurs.split('\n').filter((l) => /est à la fois un fichier/.test(l))
    assert.equal(lignes.length, 1, b.erreurs)
    assert.match(lignes[0], /doc-carte\.compacte\.mjs/)
  })

  it('un alias que deux composants se disputent : aucun modèle publié sous lui', async () => {
    const b = await construire('ambigu', {
      'doc/doc-carte.mjs':          '<article class="normale">{$titre}</article>\n',
      'doc/doc-carte.compacte.mjs': '<p class="compacte">{$titre}</p>\n',
      'tuto/tuto-carte.mjs':        '<article class="tuto">{$titre}</article>\n',
      'hote.mjs':                   '<@doc-carte layout="compacte" titre="X"></@doc-carte>\n<@carte layout="compacte" titre="Y"></@carte>\n',
    })
    assert.doesNotMatch(b.lire('hote'), /mjs-carte--compacte/)
  })
})
