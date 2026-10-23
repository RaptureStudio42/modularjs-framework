// « Réessayer » (`reset`) d'un `<@failed>` posé sur un composant d'une ligne de `{for}` (une carte d'une liste) remonte
// une carte neuve que la ligne ne connaît pas : elle revient sans la prop que la liste lui donnait et ne la suit plus.
// C'est une limite écrite dans la documentation des éléments spéciaux, avec son contournement, que ce test garantit :
// la frontière posée sur le composant qui contient le `{for}` reçoit l'erreur de la carte, et son `reset` remonte toute
// la liste, dont chaque carte retrouve sa prop et suit de nouveau la liste.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SOURCES: Record<string, string> = {
  'tst-flc-carte.mjs': [
    '<script>',
    '$item = null',
    '$boom = false',
    '</script>',
    '{if $boom}<i>{$item.nope.crash}</i>{end}',
    "<p class=\"n\">{$item ? $item.n : 'VIDE'}</p>",
    '<button class="boom" @click={$boom = true}>boom</button>',
  ].join('\n'),
  'tst-flc-liste.mjs': [
    '<script>',
    "$rows = [{id: 1, n: 'a'}, {id: 2, n: 'b'}]",
    "renomme = -> $rows = $rows.map((r) -> ({id: r.id, n: r.n + '!'}))",
    '</script>',
    '<div class="l">{for it in $rows by id}<mjs-tst-flc-carte item={it}></mjs-tst-flc-carte>{end}</div>',
    '<button class="ren" @click={renomme()}>r</button>',
    '<@failed err reset>',
    '  <button class="reset" @click={reset()}>reset</button>',
    '</@failed>',
  ].join('\n'),
  'tst-flc-page.mjs': '<mjs-tst-flc-liste></mjs-tst-flc-liste>\n',
}

function projet(): string {
  const root   = mjsTmp('failed-ligne-de-for')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('<@failed> — carte d\'une ligne de {for} : la frontière se pose sur la liste', function () {
  this.timeout(60000)
  let app: any

  before(async () => {
    app = await createHarness({ root: projet() })
    app.window.console.error = () => {}
  })

  after(async () => { if (app) await app.destroy() })

  it('l\'erreur d\'une carte remonte à la liste ; reset remonte la liste, ses cartes ont leur prop et la suivent', async () => {
    const p     = await app.mount('tst-flc-page')
    await pause(30)
    const liste = () => p.find('mjs-tst-flc-liste')
    const lire  = () => [...liste()._shadow.querySelectorAll('mjs-tst-flc-carte')].map((c: any) => c._shadow.querySelector('.n')?.textContent ?? '(repli)').join(',')
    const avant = liste()
    assert.equal(lire(), 'a,b')
    avant._shadow.querySelector('mjs-tst-flc-carte')._shadow.querySelector('.boom').click()
    await pause(30)
    const bouton = avant._shadow.querySelector('.reset')
    assert.equal(bouton !== null, true, 'le repli de la liste est affiché')
    bouton.click()
    await pause(40)
    assert.equal(liste() !== avant, true, 'une liste neuve')
    assert.equal(lire(), 'a,b', 'chaque carte a sa prop')
    liste()._shadow.querySelector('.ren').click()
    await pause(40)
    assert.equal(lire(), 'a!,b!', 'les cartes suivent la liste')
    p.destroy()
  })
})
