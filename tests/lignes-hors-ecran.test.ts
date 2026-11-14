// `@offscreen` sur la balise d'une ligne : hors de l'écran, la ligne n'est ni mise en page ni peinte (`content-visibility: auto`), et la place
// réservée (`contain-intrinsic-size: auto …`, 24px sans valeur) compte pour chaque ligne pas encore vue. À la construction : un attribut fixe sur
// la balise, une règle par taille dans le style de base du composant, rien du tout pour un composant qui ne l'écrit pas, et jamais l'écoute d'un
// événement « offscreen ». Refusé sur une balise de tableau, dont le navigateur ne saute jamais la mise en page, sur un `<li>`, dont le numéro
// ou la puce, peint hors de la balise, serait rogné, et sur une valeur qui n'est pas une longueur fixe. Rendu serveur : l'attribut et la règle
// sont dans le HTML

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const liste = (ligne: string, parent = 'div') => `<script lang="coffee">\n$rows = [{ id: 1, n: 'a' }, { id: 2, n: 'b' }]\n$h = 40\n</script>\n\n<${parent}>\n  {for r in $rows by id}\n    ${ligne}\n  {end}\n</${parent}>\n`

const regle = (taille: string) => `[mjs-offscreen="${taille}"]{content-visibility:auto;contain-intrinsic-size:auto ${taille}}`

describe('@offscreen : les lignes hors de l\'écran ne sont pas mises en page', function () {
  this.timeout(60000)
  afterEach(() => setMessagesLang('fr'))
  after(async () => { await terminateSharedWorkerPool() })

  for (const [ecrit, taille] of [[':offscreen', '24px'], [':offscreen=40', '40px'], [':offscreen="3rem"', '3rem'], [':offscreen=12.5', '12.5px']]) {
    it(`${ecrit} : attribut mjs-offscreen="${taille}" sur la ligne, une règle dans le style de base`, async () => {
      const { data, output } = await transpile(liste(`<div ${ecrit}>{r.n}</div>`), { moduleName: 'mjs-hors-ecran' })
      assert.ok(data.baseCss.includes(regle(taille)), `la règle de ${taille} : ${data.baseCss}`)
      assert.match(output, new RegExp(`mjs-offscreen=\\\\?['"]${taille.replace('.', '\\.')}`), 'l\'attribut posé sur la balise de la ligne')
      assert.equal(Object.keys(data.events ?? {}).includes('offscreen'), false, 'jamais l\'écoute d\'un événement « offscreen »')
    })
  }

  it('deux tailles : deux règles ; la même taille deux fois : une seule', async () => {
    const { data } = await transpile(liste('<div :offscreen=40>{r.n}<p :offscreen>x</p><p :offscreen=40>y</p></div>'), { moduleName: 'mjs-hors-ecran-deux' })
    assert.equal(data.baseCss.split('content-visibility:auto').length - 1, 2, data.baseCss)
    assert.ok(data.baseCss.includes(regle('40px')) && data.baseCss.includes(regle('24px')), data.baseCss)
  })

  it('un composant qui ne l\'écrit pas : ni attribut ni règle', async () => {
    const { data, output } = await transpile(liste('<div>{r.n}</div>'), { moduleName: 'mjs-sans-hors-ecran' })
    assert.equal(data.baseCss.includes('content-visibility'), false, data.baseCss)
    assert.equal(output.includes('mjs-offscreen'), false)
  })

  for (const balise of ['tr', 'td', 'tbody', 'table']) {
    it(`<${balise} @offscreen> : refus qui dit pourquoi et quoi écrire`, async () => {
      const ligne = balise === 'td' ? '<tr><td :offscreen>{r.n}</td></tr>' : balise === 'tbody' ? '<tbody :offscreen><tr><td>{r.n}</td></tr></tbody>' : balise === 'table' ? '<table :offscreen><tr><td>{r.n}</td></tr></table>' : '<tr :offscreen><td>{r.n}</td></tr>'
      await assert.rejects(() => transpile(liste(ligne, balise === 'table' ? 'div' : 'table'), { moduleName: 'mjs-hors-ecran-tableau' }), (e: any) => {
        assert.ok(e.message.includes(`« :offscreen » sur une balise <${balise}>`), e.message)
        assert.match(e.message, /ne saute jamais la mise en page/, 'la raison')
        assert.ok(e.message.includes('<div>'), 'la balise à écrire')
        assert.equal(e.message.includes('<li>'), false, 'jamais un <li>, refusé lui aussi')
        assert.match(e.message, /docs\/05-blocs\.md/)
        return true
      })
    })
  }

  for (const [parent, ecrit] of [['ol', ':offscreen'], ['ul', ':offscreen'], ['ol', ':offscreen=48']]) {
    it(`<${parent}> puis <li ${ecrit}> : refus, le numéro ou la puce serait rogné, avec la ligne à écrire`, async () => {
      await assert.rejects(() => transpile(liste(`<li ${ecrit}>{r.n}</li>`, parent), { moduleName: 'mjs-hors-ecran-li' }), (e: any) => {
        assert.ok(e.message.includes('« :offscreen » sur une balise <li>'), e.message)
        assert.match(e.message, /le numéro ou la puce d'un <li> hors de la balise/, 'la raison')
        assert.match(e.message, /à l'intérieur du <li>, la directive le rognerait encore sous Safari/, 'la balise intérieure ne suffit pas')
        assert.ok(e.message.includes('<div :offscreen>') && e.message.includes('({i + 1}.)'), 'la ligne et le numéro à écrire')
        assert.match(e.message, /docs\/05-blocs\.md/)
        return true
      })
    })
  }

  for (const ecrit of [':offscreen={$h}', ':offscreen=abc', ':offscreen=0', ':offscreen="10%"', ':offscreen="auto 40px"']) {
    it(`${ecrit} : refus qui donne les valeurs permises`, async () => {
      await assert.rejects(() => transpile(liste(`<div ${ecrit}>{r.n}</div>`), { moduleName: 'mjs-hors-ecran-valeur' }), (e: any) => {
        assert.match(e.message, /« :offscreen/, e.message)
        assert.ok(e.message.includes(':offscreen=40') && e.message.includes(':offscreen="3rem"'), 'les écritures permises')
        assert.match(e.message, /24px/, 'la taille réservée sans valeur')
        return true
      })
    })
  }

  it('en anglais', async () => {
    setMessagesLang('en')
    await assert.rejects(() => transpile(liste('<tr :offscreen><td>{r.n}</td></tr>', 'table'), { moduleName: 'mjs-hors-ecran-en' }), (e: any) => {
      assert.ok(e.message.includes('":offscreen" on a <tr> tag'), e.message)
      assert.match(e.message, /never skips the layout/)
      assert.equal(e.message.includes('<li>'), false)
      return true
    })
    await assert.rejects(() => transpile(liste('<li :offscreen>{r.n}</li>', 'ul'), { moduleName: 'mjs-hors-ecran-en' }), (e: any) => {
      assert.ok(e.message.includes('":offscreen" on a <li> tag'), e.message)
      assert.match(e.message, /number or bullet/)
      assert.ok(e.message.includes('<div :offscreen>') && e.message.includes('({i + 1}.)'))
      return true
    })
    await assert.rejects(() => transpile(liste('<div :offscreen=abc>{r.n}</div>'), { moduleName: 'mjs-hors-ecran-en' }), (e: any) => {
      assert.match(e.message, /":offscreen=abc"/, e.message)
      assert.match(e.message, /24px/)
      return true
    })
  })

  it('rendu serveur : chaque ligne porte l\'attribut, la feuille porte la règle', async () => {
    const root   = mjsTmp('ssr-hors-ecran')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'longuessr.mjs'), liste('<div :offscreen=30>{r.n}</div>'))
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir })
    try {
      const { html } = await renderer.renderToString('mjs-longuessr')
      assert.equal(html.split(/<div mjs-offscreen="30px"/).length - 1, 2, html)
      assert.ok(html.includes(regle('30px')), 'la règle dans le style rendu')
    }
    finally {
      await renderer.close()
    }
  })
})
