// une classe calculée par la sélection d'une ligne de {for} (`class={t.id is $sel ? 'sel' : ''}`) ne retire pas la classe entière quand la
// sélection quitte la ligne : la classe d'une bascule `:class{…}` ou d'un étalement de la même balise reste — même rendu que la même valeur
// écrite entre parenthèses, que le compilateur ne reconnaît pas comme un filtre — vraie construction
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const script = `<button class="b" @click={-> $sel = 2}>b</button>\n<script>\n  $l = [{ id: 1, done: true }, { id: 2, done: true }]\n  $sel = 1\n  $o = { class: 'part' }\n</script>\n`
const fichiers: Record<string, string> = {
  'c-bascule.mjs': `<ul>{for t in $l by id}<li data-r class={t.id is $sel ? 'sel' : ''} :class{t.done}="done">{t.id}</li>{end}</ul>` + script,
  'c-bascule-temoin.mjs': `<ul>{for t in $l by id}<li data-r class={(t.id is $sel) ? 'sel' : ''} :class{t.done}="done">{t.id}</li>{end}</ul>` + script,
  'c-etale.mjs': `<ul>{for t in $l by id}<li data-r class={t.id is $sel ? 'sel' : ''} {...$o}>{t.id}</li>{end}</ul>` + script,
  'c-etale-temoin.mjs': `<ul>{for t in $l by id}<li data-r class={(t.id is $sel) ? 'sel' : ''} {...$o}>{t.id}</li>{end}</ul>` + script
}

describe('classe filtrée d\'une ligne de {for} : les classes d\'une bascule ou d\'un étalement restent', function () {
  this.timeout(200000)
  let app: any
  before(async () => {
    const root = mjsTmp('classe-filtree-bascules')
    mkdirSync(join(root, 'src'), { recursive: true })
    for (const [nom, texte] of Object.entries(fichiers)) writeFileSync(join(root, 'src', nom), texte)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    app = await createHarness({ root })
  })
  after(async () => { if (app) await app.destroy() })

  // classes de chaque ligne (triées), au montage puis après que la sélection passe à la ligne 2
  const classes = async (nom: string): Promise<string[][]> => {
    const c = await app.mount(nom)
    try {
      await c.tick()
      const lire = () => c.findAll('[data-r]').map((li: any) => [...li.classList].sort().join(' '))
      const montage = lire()
      await c.click('.b')
      await c.tick()
      return [montage, lire()]
    }
    finally { c.destroy() }
  }

  it('bascule :class{t.done}="done" : « done » reste sur la ligne que la sélection quitte, comme le témoin', async () => {
    const lu = await classes('c-bascule')
    assert.deepEqual(lu, [['done sel', 'done'], ['done', 'done sel']])
    assert.deepEqual(lu, await classes('c-bascule-temoin'))
  })

  it('étalement {...$o} qui pose « part » : « part » reste sur la ligne que la sélection quitte, comme le témoin', async () => {
    const lu = await classes('c-etale')
    assert.deepEqual(lu, [['part sel', 'part'], ['part', 'part sel']])
    assert.deepEqual(lu, await classes('c-etale-temoin'))
  })
})
