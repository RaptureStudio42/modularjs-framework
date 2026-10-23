// Ce que renvoie le gestionnaire d'un `@click` est ignoré : `return false` n'annule PAS l'action par défaut
// (lien suivi, formulaire envoyé). Pour l'annuler : `@click.prevent` ou `e.preventDefault()`.
// Lien externe, formulaire et case à cocher (là où MJS ne gère pas déjà le clic). Chaque cas monte son
// propre harnais : aucune fenêtre réutilisée après un clic. L'événement est dispatché à la main pour lire
// `defaultPrevented` sur lui-même.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const PAGE = [
  '<script>',
  '$n = 0',
  '</script>',
  '<a class="faux" href="https://exemple.test/x" @click={$n++; false}>faux</a>',
  '<a class="prevent" href="https://exemple.test/x" @click.prevent={$n++}>prevent</a>',
  '<a class="manuel" href="https://exemple.test/x" @click={e.preventDefault(); $n++}>manuel</a>',
  '<form class="form-faux" action="https://exemple.test/x" @submit={$n++; false}><button>ok</button></form>',
  '<form class="form-prevent" action="https://exemple.test/x" @submit.prevent={$n++}><button>ok</button></form>',
  '<input class="case-faux" type="checkbox" @click={$n++; false}>',
  '<input class="case-prevent" type="checkbox" @click.prevent={$n++}>',
  '<p class="n">{$n}</p>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('clic-retour-faux')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'tst-crf-page.mjs'), PAGE)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('@click et @submit — la valeur renvoyée par le gestionnaire est ignorée', function () {
  this.timeout(60000)

  // un harnais NEUF par cas ; `genre` : clic sur un lien ou une case, envoi d'un formulaire
  async function agir(classe: string, genre: 'clic' | 'envoi'): Promise<{ annule: boolean, n: string, coche: boolean }> {
    const app = await createHarness({ root: projetTemporaire() })
    try {
      const c   = await app.mount('tst-crf-page')
      const cible = c.find(`.${classe}`)
      const evt = genre === 'clic'
        ? new app.window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true })
        : new app.window.Event('submit', { bubbles: true, cancelable: true, composed: true })
      cible.dispatchEvent(evt)
      await c.tick()
      const r = { annule: evt.defaultPrevented, n: c.text('.n'), coche: cible.checked === true }
      c.destroy()
      return r
    }
    finally { await app.destroy() }
  }

  it('lien : le gestionnaire qui renvoie false s\'exécute, mais l\'action par défaut n\'est pas annulée', async () => {
    assert.deepEqual(await agir('faux', 'clic'), { annule: false, n: '1', coche: false })
  })

  it('lien : @click.prevent annule l\'action par défaut', async () => {
    assert.deepEqual(await agir('prevent', 'clic'), { annule: true, n: '1', coche: false })
  })

  it('lien : e.preventDefault() dans le gestionnaire l\'annule aussi', async () => {
    assert.deepEqual(await agir('manuel', 'clic'), { annule: true, n: '1', coche: false })
  })

  it('formulaire : @submit qui renvoie false n\'empêche pas l\'envoi', async () => {
    assert.deepEqual(await agir('form-faux', 'envoi'), { annule: false, n: '1', coche: false })
  })

  it('formulaire : @submit.prevent annule l\'envoi', async () => {
    assert.deepEqual(await agir('form-prevent', 'envoi'), { annule: true, n: '1', coche: false })
  })

  it('case à cocher : @click qui renvoie false, la case se coche quand même', async () => {
    assert.deepEqual(await agir('case-faux', 'clic'), { annule: false, n: '1', coche: true })
  })

  it('case à cocher : @click.prevent, la case ne se coche pas', async () => {
    assert.deepEqual(await agir('case-prevent', 'clic'), { annule: true, n: '1', coche: false })
  })
})
