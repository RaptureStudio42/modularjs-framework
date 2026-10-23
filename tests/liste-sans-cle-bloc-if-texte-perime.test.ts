// Un `{for}` SANS clé dont chaque ligne est un `{if}` (icône ou texte, l'aperçu d'un texte à
// icônes) n'affiche plus un vieux morceau de texte quand la liste change. Les éléments sont des
// objets neufs à chaque frappe : chaque ligne part et une ligne recyclée la remplace. La réserve de
// recyclage gardait la liste des nœuds de la ligne prise à sa CRÉATION ; après une bascule de son
// `{if}`, ce relevé était périmé — la ligne recyclée remettait à l'écran l'ancien nœud de texte
// (« ◊ Bon Bonne nuit » au lieu de « ◊◊ Bonne nuit » après la frappe, puis une icône posée au
// début), ou gardait son icône fantôme au lieu du texte neuf. Couvre les deux chemins de retrait :
// la liste qui occupe tout son parent (retrait groupé) et celle qui a un voisin (retrait ligne à
// ligne), avec un composant ou une simple balise dans la branche.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// une icône s'écrit [[i:nom]] dans le texte ; le découpage rend des objets neufs à chaque appel
const GLYPHS = `export function glyphParts(text)
{
  const source = text == null ? '' : String(text);
  const parts  = [];
  const re     = /\\[\\[i:([a-z-]+)\\]\\]/g;
  let last     = 0;
  let m;
  while((m = re.exec(source))) {
    if(m.index > last) parts.push({ text: source.slice(last, m.index) });
    parts.push({ icon: m[1] });
    last = m.index + m[0].length;
  }
  if(last < source.length) parts.push({ text: source.slice(last) });
  return parts;
}
`

const GLYPH = `<script>
  $src = ''
</script>

<i class="face">{$src}</i>
`

const PREVIEW = `<script>
  $draft = ''
</script>

<div class="preview"><@glyph-text text={$draft}></div>
`

const texteIcones = (gabarit: string) => `@import glyphParts 'shared/glyphs.js'

<script>
  $text = ''
</script>

${gabarit}
`

const VARIANTES: Record<string, string> = {
  'liste seule dans son parent, composant dans la branche': `{for p in glyphParts($text)}{if p.icon}<@glyph class="gl" src={p.icon}>{else}{p.text}{end}{end}`,
  'liste seule dans son parent, balise dans la branche': `{for p in glyphParts($text)}{if p.icon}<b class="ic">◊</b>{else}{p.text}{end}{end}`,
  'liste avec un voisin, balise dans la branche': `<b class="lead">›</b>{for p in glyphParts($text)}{if p.icon}<b class="ic">◊</b>{else}{p.text}{end}{end}`,
  'liste avec un voisin, composant dans la branche': `<b class="lead">›</b>{for p in glyphParts($text)}{if p.icon}<@glyph class="gl" src={p.icon}>{else}{p.text}{end}{end}`
}

// ce que l'aperçu doit montrer : une icône = « ◊ », le reste tel quel
function attendu(texte: string): string {
  return texte.replace(/\[\[i:[a-z-]+\]\]/g, '◊')
}

// la frappe d'un message : une icône, « Bonne nuit » tapé lettre à lettre, une icône posée au
// début, puis quelques formes qui font basculer les lignes entre icône et texte
function frappe(): string[] {
  const out = ['[[i:coeur]]']
  let t = '[[i:coeur]]'
  for (const ch of ' Bonne nuit') {
    t += ch
    out.push(t)
  }
  out.push('[[i:rose]][[i:coeur]] Bonne nuit', 'Bonne [[i:rose]] nuit', '[[i:a]]x[[i:b]]y[[i:c]]', 'x[[i:a]]y[[i:b]]z', '[[i:a]][[i:b]][[i:c]]', 'abc', '[[i:a]]', '')
  return out
}

// une ligne d'icône reprise pour un texte, la liste vidée d'un coup, puis un texte de nouveau :
// la ligne recyclée doit montrer ce texte, pas l'icône qu'elle portait à sa création
const VIDEE = ['A', '[[i:b]]', 'C', 'D', '', 'E']

// compile l'aperçu avec ce gabarit de texte à icônes, joue les saisies, rend les écarts à l'écran
async function ecartsA(gabarit: string, suite: string[]): Promise<string[]> {
  const root   = mjsTmp('liste-sans-cle-if')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(join(srcDir, 'shared'), { recursive: true })
  writeFileSync(join(srcDir, 'shared', 'glyphs.js'), GLYPHS)
  writeFileSync(join(srcDir, 'glyph.mjs'), GLYPH)
  writeFileSync(join(srcDir, 'glyph-text.mjs'), texteIcones(gabarit))
  writeFileSync(join(srcDir, 'draft-preview.mjs'), PREVIEW)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang   = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code   = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/' })
  try {
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-draft-preview></mjs-draft-preview>'
    const page = window.document.querySelector('mjs-draft-preview')
    await attendre(() => !!page._shadow?.querySelector('mjs-glyph-text')?._shadow)
    const rendu = (): string => {
      const lire = (n: any): string => {
        if (n.nodeType === 3) return n.textContent
        if (n.nodeType !== 1 || n.localName === 'style' || n.classList?.contains('lead')) return ''
        if (n.localName === 'mjs-glyph') return '◊'
        return Array.from(n._shadow ? n._shadow.childNodes : n.childNodes).map(lire).join('')
      }
      return lire(page._shadow.querySelector('.preview'))
    }
    const ecarts: string[] = []
    for (const texte of suite) {
      window.eval(`document.querySelector('mjs-draft-preview')._set('draft', ${JSON.stringify(texte)})`)
      await pause(15)
      if (rendu() !== attendu(texte)) ecarts.push(`${JSON.stringify(texte)} → ${JSON.stringify(rendu())} au lieu de ${JSON.stringify(attendu(texte))}`)
    }
    return ecarts
  }
  finally {
    window.close()
  }
}

describe('{for} sans clé contenant un {if} : aucun morceau de texte périmé quand la liste change', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const [nom, gabarit] of Object.entries(VARIANTES)) {
    it(`frappe d'un message — ${nom}`, async () => {
      const ecarts = await ecartsA(gabarit, frappe())
      assert.deepEqual(ecarts, [], ecarts.join('\n'))
    })
  }

  for (const nom of ['liste seule dans son parent, balise dans la branche', 'liste avec un voisin, balise dans la branche']) {
    it(`liste vidée d'un coup puis remplie — ${nom}`, async () => {
      const ecarts = await ecartsA(VARIANTES[nom], VIDEE)
      assert.deepEqual(ecarts, [], ecarts.join('\n'))
    })
  }
})
