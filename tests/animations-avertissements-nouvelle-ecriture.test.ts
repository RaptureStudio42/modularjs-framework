// Les avertissements des animations de transition nomment l'effet dans son écriture actuelle (`*bars`,
// posé par `@in=*bars`, `@out=*bars`, `@transition=*bars` ou directement), jamais l'écriture retirée
// `@transition.bars` — que le build refuse désormais. Tous portent le préfixe [ModularJS].

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ANIM_DIR  = join(__dirname, '..', 'src', 'runtime', 'animations')

function loadFactory(name: string, µMock: any) {
  const src = readFileSync(join(ANIM_DIR, `${name}.ts`), 'utf-8')
  return new Function('µ', 'return (' + src.trim().replace(/;\s*$/, '') + ')')(µMock)
}

function makeµ() {
  const warns: string[] = []
  const µMock = {
    warn: function (m: any) { warns.push(String(m)) },
    easing: {
      resolve: function (e: any) { return typeof e === 'function' ? e : function (t: number) { return t } },
      linear: function (t: number) { return t },
      cubicIn: function (t: number) { return t * t * t },
      cubicOut: function (t: number) { return 1 - Math.pow(1 - t, 3) },
      cubicInOut: function (t: number) { return t },
    },
    _mjs_fixPosition: function () {},
  }
  return { µMock, warns }
}

describe('animations : avertissements dans l\'écriture actuelle des effets', function () {
  let win: any
  let avant: any

  beforeEach(() => {
    const g: any = globalThis
    avant = { window: g.window, document: g.document }
    win = new Window({ url: 'http://localhost/' })
    g.window   = win
    g.document = win.document
  })

  afterEach(() => {
    const g: any = globalThis
    g.window   = avant.window
    g.document = avant.document
    win.close()
  })

  for (const [nom, repli] of [['bars', 'down'], ['volet', 'down'], ['turn', 'left'], ['reveal', 'up'], ['cube', 'left'], ['flip', 'left']]) {
    it(`*${nom} : direction invalide — le message nomme *${nom}`, () => {
      const { µMock, warns } = makeµ()
      loadFactory(nom, µMock)({ dir: 'diagonal' })
      assert.deepEqual(warns, [`[ModularJS] *${nom} : direction invalide 'diagonal' — repli '${repli}'.`])
    })
  }

  it('*draw sur une balise qui n\'est pas un tracé SVG : le message nomme *draw', () => {
    const { µMock, warns } = makeµ()
    loadFactory('draw', µMock)({}).intro(win.document.createElement('div'))
    assert.deepEqual(warns, ['[ModularJS] *draw ne s\'applique qu\'à un tracé SVG.'])
  })
})
