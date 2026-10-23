// Les gestionnaires routés (`@click`…) d'un événement qui remonte jouent à la remontée, comme un écouteur posé
// sur la balise. Défaut garanti absent : le routeur écoutait en capture sur la racine du composant, avant les
// écouteurs de la cible — un `stopPropagation()` posé par un écouteur natif d'un descendant (bibliothèque,
// `@attach`) n'empêchait pas le `@click` de l'ancêtre, et `@click.stop` sur l'ancêtre privait l'écouteur natif du
// descendant cliqué de son clic.
// Gardes : un événement qui ne remonte pas (`focus`, événement maison sans remontée) reste routé ; `µon` joue
// toujours après les gestionnaires du gabarit, et `.stop` l'arrête toujours ; `.self`, `.once`, `.prevent`
// gardent leur effet.
// Exception figée : `submit` reste routé à la capture — un `@submit.prevent` retient toujours l'envoi, même quand un
// écouteur natif de la page coupe l'événement sur le formulaire.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const MENU = [
  '<script>',
  '$n = 0',
  '$m = 0',
  '$p = 0',
  '$f = 0',
  '$u = 0',
  '$o = 0',
  '$s1 = 0',
  '$o1 = 0',
  '$p1 = 0',
  '$ordre = []',
  '$s2 = 0',
  "µon 'click', '.in3', ->",
  "  $ordre.push('µon')",
  "µon 'click', '.st', ->",
  '  $u++',
  '</script>',
  '<div class="outer" @click={$n++}><button class="in">x</button></div>',
  '<div class="outer2" @click.stop={$m++}><button class="in2">y</button></div>',
  '<div class="nb" @ping={$p++}><span class="sp">z</span></div>',
  '<input class="f" @focus={$f++}>',
  "<button class=\"in3\" @click={$ordre.push('gabarit')}>o</button>",
  '<button class="st" @click.stop={$o++}>s</button>',
  '<div class="slf" @click.self={$s1++}><b class="slf-in">b</b></div>',
  '<button class="once" @click.once={$o1++}>1</button>',
  '<button class="prev" @click.prevent={$p1++}>p</button>',
  '<form class="fo" @submit.prevent={$s2++}><input name="q"></form>',
].join('\n')

function projetTemporaire(): string {
  const root   = mjsTmp('routage-remontee')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'rr-menu.mjs'), MENU)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('routage des événements — phase de remontée pour un événement qui remonte', function () {
  this.timeout(60000)

  let app: any

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('un `stopPropagation()` natif posé sur un descendant arrête le `@click` de l\'ancêtre', async () => {
    const c = await app.mount('rr-menu')
    try {
      const ordre: string[] = []
      c.find('.in').addEventListener('click', (e: any) => { ordre.push('bouton'); e.stopPropagation() })
      await c.click('.in')
      assert.deepEqual(ordre, ['bouton'], 'l\'écouteur natif du bouton a joué')
      assert.equal(c.state.n, 0, 'le @click de l\'ancêtre ne joue pas : la propagation est arrêtée')
    } finally {
      c.destroy()
    }
  })

  it('`@click.stop` sur l\'ancêtre ne prive pas l\'écouteur natif du descendant cliqué', async () => {
    const c = await app.mount('rr-menu')
    try {
      let recu = 0
      c.find('.in2').addEventListener('click', () => { recu++ })
      await c.click('.in2')
      assert.equal(recu, 1, 'l\'écouteur natif du bouton reçoit son clic')
      assert.equal(c.state.m, 1, 'le gestionnaire de l\'ancêtre joue')
    } finally {
      c.destroy()
    }
  })

  it('garde : un événement qui ne remonte pas reste routé (`focus`, événement maison sans remontée), et celui qui remonte aussi', async () => {
    const c = await app.mount('rr-menu')
    try {
      c.find('.f').dispatchEvent(new app.window.FocusEvent('focus', { bubbles: false }))
      await c.tick()
      assert.equal(c.state.f, 1, '@focus')
      c.find('.sp').dispatchEvent(new app.window.Event('ping', { bubbles: false }))
      await c.tick()
      assert.equal(c.state.p, 1, 'événement maison sans remontée, gestionnaire sur un ancêtre')
      c.find('.sp').dispatchEvent(new app.window.Event('ping', { bubbles: true }))
      await c.tick()
      assert.equal(c.state.p, 2, 'le même, avec remontée')
    } finally {
      c.destroy()
    }
  })

  it('garde : `µon` joue après le gestionnaire du gabarit, et `.stop` l\'arrête', async () => {
    const c = await app.mount('rr-menu')
    try {
      await c.click('.in3')
      assert.deepEqual([...c.state.ordre], ['gabarit', 'µon'])
      await c.click('.st')
      assert.equal(c.state.o, 1, 'le gestionnaire `.stop` joue')
      assert.equal(c.state.u, 0, 'le µon de la même balise ne joue pas après `.stop`')
    } finally {
      c.destroy()
    }
  })

  it('garde : `.self`, `.once` et `.prevent` gardent leur effet', async () => {
    const c = await app.mount('rr-menu')
    try {
      await c.click('.slf-in')
      assert.equal(c.state.s1, 0, '.self : un clic sur un descendant ne compte pas')
      await c.click('.slf')
      assert.equal(c.state.s1, 1, '.self : un clic sur la balise compte')
      await c.click('.once')
      await c.click('.once')
      assert.equal(c.state.o1, 1, '.once : une seule fois')
      const ev = new app.window.MouseEvent('click', { bubbles: true, composed: true, cancelable: true })
      c.find('.prev').dispatchEvent(ev)
      await c.tick()
      assert.equal(c.state.p1, 1, '.prevent : le gestionnaire joue')
      assert.equal(ev.defaultPrevented, true, '.prevent : action par défaut empêchée')
    } finally {
      c.destroy()
    }
  })

  it('exception : `submit` reste routé à la capture — un écouteur natif qui coupe l\'envoi sur le formulaire n\'empêche ni le `@submit` ni son `.prevent`', async () => {
    const c = await app.mount('rr-menu')
    try {
      c.find('.fo').addEventListener('submit', (e: any) => e.stopPropagation())
      const ev = new app.window.Event('submit', { bubbles: true, cancelable: true })
      c.find('.fo').dispatchEvent(ev)
      await c.tick()
      assert.equal(c.state.s2, 1, 'le gestionnaire `@submit` du composant joue')
      assert.equal(ev.defaultPrevented, true, 'un envoi retenu par `.prevent` ne part jamais')
    } finally {
      c.destroy()
    }
  })
})
