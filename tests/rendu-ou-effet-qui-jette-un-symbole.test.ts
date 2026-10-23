// Un rendu ou un reffet qui jette n'importe quelle valeur (un Symbol, un objet sans prototype) affiche le panneau
// d'erreur, sans seconde exception. Défaut garanti absent : le texte du panneau se formait par un gabarit de chaîne,
// qui lève sur un Symbol — ombre vide, exception non rattrapée ; jetée par un reffet, cette seconde exception laissait
// posé pour toute la page le marqueur de l'effet en cours, et plus aucun reffet qui écrit une clé du store ne se
// relançait sur une écriture faite par un bouton (un bornage `$$v = 10 if $$v > 10` laissait passer 50).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SOURCES: Record<string, string> = {
  'tst-sym-rendu.mjs': "<script>\nboum = -> throw Symbol('s')\n</script>\n<p>{boum()}</p>\n",
  'tst-sym-nu.mjs': '<script>\nboum = -> throw Object.create(null)\n</script>\n<p>{boum()}</p>\n',
  'tst-sym-effet.mjs': "<script>\nwindow.__mu = µ\n$x = 0\nµeffect ->\n  throw Symbol('e') if $x > 0\n</script>\n<button class=\"b\" @click={$x++}>{$x}</button>\n",
  'tst-sym-borne.mjs': '<script>\n$$v = 5\nµeffect ->\n  $$v = 10 if $$v > 10\nmet = -> $$v = 50\n</script>\n<p class="v">{$$v}</p><button class="m" @click={met()}>m</button>\n',
}

function projetTemporaire(): string {
  const root   = mjsTmp('jette-symbole')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('rendu ou reffet qui jette un Symbol ou un objet sans prototype', function () {
  this.timeout(60000)
  let app: any
  let erreurs: string[] = []

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
    const texte = (x: any) => { try { return String(x?.message ?? x) } catch { return typeof x } }
    app.window.console.error = (...a: any[]) => { erreurs.push(a.map(texte).join(' ')) }
    app.window.addEventListener('error', (e: any) => erreurs.push('non rattrapée : ' + texte(e.error ?? e.message)))
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('le panneau d\'erreur s\'affiche, avec le texte de la valeur jetée', async () => {
    const d = app.window.document
    erreurs = []
    d.body.innerHTML = '<mjs-tst-sym-rendu></mjs-tst-sym-rendu><mjs-tst-sym-nu></mjs-tst-sym-nu>'
    await pause(120)
    assert.equal(d.querySelector('mjs-tst-sym-rendu')._shadow.querySelector('.mjs-fatal-error')?.textContent, 'Fatal Error: Symbol(s)')
    assert.equal(d.querySelector('mjs-tst-sym-nu')._shadow.querySelector('.mjs-fatal-error')?.textContent, 'Fatal Error')
    assert.deepEqual(erreurs.filter((m) => /non rattrapée|Cannot convert/.test(m)), [], 'aucune seconde exception')
    d.body.innerHTML = ''
  })

  it('un reffet qui jette un Symbol ne bloque pas les reffets des autres composants', async () => {
    const d = app.window.document
    d.body.innerHTML = '<mjs-tst-sym-effet></mjs-tst-sym-effet><mjs-tst-sym-borne></mjs-tst-sym-borne>'
    await pause(120)
    const borne = d.querySelector('mjs-tst-sym-borne')._shadow
    borne.querySelector('.m').click(); await pause(60)
    assert.equal(borne.querySelector('.v').textContent, '10')
    d.querySelector('mjs-tst-sym-effet')._shadow.querySelector('.b').click(); await pause(60)
    assert.equal(app.window.__mu._mjs_effRun ?? null, null, 'plus aucun effet marqué « en cours »')
    borne.querySelector('.m').click(); await pause(60)
    assert.equal(borne.querySelector('.v').textContent, '10', 'le bornage joue encore')
    d.body.innerHTML = ''
  })
})
