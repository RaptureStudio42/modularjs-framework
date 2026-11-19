// deux bascules `:class{…}` d'une même balise dont les classes ne diffèrent que par un signe (`is-on`, `is_on`) ont chacune leur garde :
// les deux classes sont posées au montage, puis chacune part avec sa condition — vraie construction
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const fichiers: Record<string, string> = {
  'b-signe.mjs': `<p class="p" :class{$a}="is-on" :class{$b}="is_on">t</p><button class="b" @click={-> $a = false}>a</button><button class="b2" @click={-> $b = false}>b</button>\n<script>\n  $a = true\n  $b = true\n</script>\n`,
  'b-signe-ligne.mjs': `<ul>{for t in $l by id}<li class="r" :class{t.a}="md:x" :class{t.b}="md-x">{t.id}</li>{end}</ul><button class="b" @click={-> $l = [{ id: 1, a: false, b: true }]}>a</button>\n<script>\n  $l = [{ id: 1, a: true, b: true }]\n</script>\n`
}

describe('bascules de classes qui ne diffèrent que par un signe : une garde chacune', function () {
  this.timeout(200000)
  let app: any
  before(async () => {
    const root = mjsTmp('bascules-gardes-signe')
    mkdirSync(join(root, 'src'), { recursive: true })
    for (const [nom, texte] of Object.entries(fichiers)) writeFileSync(join(root, 'src', nom), texte)
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    app = await createHarness({ root })
  })
  after(async () => { if (app) await app.destroy() })

  it('à la racine, « is-on » et « is_on » toutes deux vraies : les deux classes au montage, puis chacune part avec sa condition', async () => {
    const c = await app.mount('b-signe')
    try {
      await c.tick()
      const lu = [c.find('.p').className]
      await c.click('.b')
      await c.tick()
      lu.push(c.find('.p').className)
      await c.click('.b2')
      await c.tick()
      lu.push(c.find('.p').className)
      assert.deepEqual(lu, ['p is-on is_on', 'p is_on', 'p'])
    }
    finally { c.destroy() }
  })

  it('dans un {for}, « md:x » et « md-x » toutes deux vraies : les deux classes au montage, puis « md:x » part seule', async () => {
    const c = await app.mount('b-signe-ligne')
    try {
      await c.tick()
      const lu = [[...c.find('.r').classList].sort().join(' ')]
      await c.click('.b')
      await c.tick()
      lu.push([...c.find('.r').classList].sort().join(' '))
      assert.deepEqual(lu, ['md-x md:x r', 'md-x r'])
    }
    finally { c.destroy() }
  })
})
