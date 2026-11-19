// Un SVG copié tel quel est servi depuis l'origine du site : le filtre qui refuse un SVG porteur de script le lit comme le
// navigateur. Trois écritures passaient le filtre et jouaient leur script dans Chromium, Firefox et WebKit : le fichier en
// UTF-16 (un octet nul suit chaque lettre du texte lu en UTF-8, aucun motif ne s'y lit), un préfixe d'espace de noms hors
// ASCII (`<é:script>`), une feuille XSLT qui fabrique la balise par un nom calculé. Vraie construction, en développement et
// en production : le SVG est refusé et n'est pas copié ; les SVG honnêtes passent toujours, y compris dans un codage d'un
// octet compatible avec l'ASCII (ISO-8859-x, windows-125x), où `<script` s'écrit avec les mêmes octets. Un codage refusé
// donne le bon remède : enregistrer le fichier en UTF-8.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

const NS     = 'http://www.w3.org/2000/svg'
const XSL    = 'http://www.w3.org/1999/XSL/Transform'
const JOUE   = 'document.documentElement.setAttribute("data-joue","1")'
const SCRIPT = `<svg xmlns="${NS}"><script>${JOUE}</script></svg>`
const RECT   = `<svg xmlns="${NS}"><desc>écrit en français</desc><rect width="1" height="1"/></svg>`

const refuses: Record<string, string | Buffer> = {
  'UTF-16LE avec marque':          Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(SCRIPT, 'utf16le')]),
  'UTF-16BE avec marque':          Buffer.concat([Buffer.from([0xFE, 0xFF]), Buffer.from(SCRIPT, 'utf16le').swap16()]),
  'UTF-16LE sans marque, déclaré': Buffer.from('<?xml version="1.0" encoding="UTF-16"?>' + SCRIPT, 'utf16le'),
  'UTF-16LE sans marque ni déclaration': Buffer.from(SCRIPT, 'utf16le'),
  'codage déclaré que le filtre ne lit pas (UTF-7)': `<?xml version="1.0" encoding="UTF-7"?><svg xmlns="${NS}"><rect width="1" height="1"/></svg>`,
  'codage déclaré à plusieurs octets (ISO-2022-JP)': `<?xml version="1.0" encoding="ISO-2022-JP"?><svg xmlns="${NS}"><rect width="1" height="1"/></svg>`,
  'codage déclaré EBCDIC (IBM037)': `<?xml version="1.0" encoding="IBM037"?><svg xmlns="${NS}"><rect width="1" height="1"/></svg>`,
  'préfixe accentué sur script':   `<svg xmlns="${NS}" xmlns:é="${NS}"><é:script>${JOUE}</é:script></svg>`,
  'préfixe accentué sur foreignObject': `<svg xmlns="${NS}" xmlns:é="${NS}"><é:foreignObject width="9" height="9"><p xmlns="http://www.w3.org/1999/xhtml">x</p></é:foreignObject></svg>`,
  'préfixe accentué sur iframe':   `<svg xmlns="${NS}" xmlns:é="http://www.w3.org/1999/xhtml"><é:iframe src="https://ailleurs.test"></é:iframe></svg>`,
  'feuille XSLT dans le fichier (href="#f")': `<?xml version="1.0"?><?xml-stylesheet type="text/xsl" href="#f"?><svg xmlns="${NS}"><xsl:stylesheet id="f" version="1.0" xmlns:xsl="${XSL}"><xsl:template match="/"><svg xmlns="${NS}"><xsl:element name="{concat('scr','ipt')}" namespace="${NS}">${JOUE}</xsl:element></svg></xsl:template></xsl:stylesheet></svg>`,
  'le fichier est sa propre feuille XSLT (href="?")': `<?xml version="1.0"?><?xml-stylesheet type="text/xsl" href="?"?><svg xsl:version="1.0" xmlns:xsl="${XSL}" xmlns="${NS}"><xsl:element name="{concat('scr','ipt')}" namespace="${NS}">${JOUE}</xsl:element></svg>`,
  'feuille XSLT d\'un autre fichier': `<?xml version="1.0"?><?xml-stylesheet href="autre.xsl" type="text/xsl"?><svg xmlns="${NS}"><rect width="1" height="1"/></svg>`,
}

const honnetes: Record<string, string | Buffer> = {
  'use interne':                 `<svg xmlns="${NS}"><defs><rect id="r" width="1" height="1"/></defs><use href="#r"/></svg>`,
  'image en data:image/png':     `<svg xmlns="${NS}"><image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/></svg>`,
  'préfixe accentué sur rect':   `<svg xmlns="${NS}" xmlns:é="${NS}"><é:rect width="1" height="1"/></svg>`,
  'feuille CSS (xml-stylesheet text/css)': `<?xml version="1.0"?><?xml-stylesheet type="text/css" href="a.css"?><svg xmlns="${NS}"><rect width="1" height="1"/></svg>`,
  'déclaré UTF-8':               `<?xml version="1.0" encoding="UTF-8"?>${RECT}`,
  'déclaré ISO-8859-1':          Buffer.from(`<?xml version="1.0" encoding="ISO-8859-1"?>${RECT}`, 'latin1'),
  'déclaré ISO-8859-15':         Buffer.from(`<?xml version="1.0" encoding="ISO-8859-15"?>${RECT}`, 'latin1'),
  'déclaré windows-1250':        Buffer.from(`<?xml version="1.0" encoding="windows-1250"?>${RECT}`, 'latin1'),
  'marque UTF-8 et style':       Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(`<svg xmlns="${NS}"><style>rect { fill: red }</style><rect width="1" height="1"/></svg>`, 'utf-8')]),
}

async function construire(nom: string, svg: string | Buffer, env: 'dev' | 'prod'): Promise<{ erreurs: string[], copies: string[] }> {
  const root = mjsTmp('svg-mur-' + env)
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'logo.svg'), svg)
  writeFileSync(join(src, 'page.mjs'), '<img alt="" src="µasset(\'logo.svg\')">\n')
  const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env })
  const s = await b.compile()
  await b.close()
  return { erreurs: s.errors.map(e => e.message), copies: existsSync(out) ? readdirSync(out).filter(n => n.endsWith('.svg')) : [] }
}

function refus(contenu: string | Buffer): string {
  const b: any = new Bundler({ sourceDir: mjsTmp('svg-codage-src'), outputDir: mjsTmp('svg-codage-out') })
  try {
    b.assertSafeSvg(Buffer.from(contenu).toString('utf-8'), 'logo.svg')
    return ''
  }
  catch (e: any) {
    return e.message
  }
}

describe('filtre des SVG : UTF-16, préfixe accentué, feuille XSLT (vraie construction)', function () {
  this.timeout(280000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const env of ['dev', 'prod'] as const) {
    for (const [nom, svg] of Object.entries(refuses)) {
      it(`${env} : ${nom} — refusé, rien de copié`, async () => {
        const r = await construire(nom, svg, env)
        assert.deepEqual(r.copies, [], 'le SVG ne doit pas être copié dans la sortie')
        assert.ok(r.erreurs.some(e => /SVG refusé/.test(e) && /logo\.svg/.test(e)), 'la construction doit refuser le SVG en le nommant : ' + r.erreurs.join(' | '))
      })
    }
    for (const [nom, svg] of Object.entries(honnetes)) {
      it(`${env} : SVG honnête (${nom}) — copié, sans erreur`, async () => {
        const r = await construire(nom, svg, env)
        assert.deepEqual(r.erreurs, [])
        assert.equal(r.copies.length, 1)
      })
    }
  }

  it('un codage refusé dit d\'enregistrer le fichier en UTF-8, en français et en anglais', () => {
    try {
      for (const [lang, fin, ancien] of [['fr', /enregistrez-le en UTF-8\.$/, /Retirez ce contenu/], ['en', /save it as UTF-8\.$/, /Remove this content/]] as const) {
        setMessagesLang(lang)
        for (const nom of ['UTF-16LE avec marque', 'codage déclaré que le filtre ne lit pas (UTF-7)']) {
          const m = refus(refuses[nom])
          assert.match(m, /logo\.svg/, `${lang} ${nom} : ${m}`)
          assert.match(m, fin, `${lang} ${nom} : ${m}`)
          assert.doesNotMatch(m, ancien, `${lang} ${nom} : ${m}`)
        }
      }
    }
    finally {
      setMessagesLang('fr')
    }
  })
})
