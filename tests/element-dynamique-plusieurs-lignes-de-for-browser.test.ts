// `<@element $tag>` dans les lignes d'un `{for}` : chaque ligne a son repère, et chaque ligne prend la balise — au premier rendu, quand
// `$tag` change, quand une ligne s'ajoute, quand une ligne part ou se déplace (la balise neuve part et se déplace avec sa ligne), quand
// `$tag` devient vide (balises masquées) puis revient, quand le `{if}` qui tient la liste se referme puis se rouvre. Navigateurs
// réels (Chromium, Firefox, WebKit), en développement, en production et après un rendu serveur repris dans ses quatre modes
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves, variantes } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  'lignes-el.mjs': `<script>
$tag   = 'section'
$items = [1, 2]
</script>
{for x in $items}<@element $tag data-t="el">{x}</@element>{end}
<button class="changer" @click={$tag = 'article'}>c</button>
<button class="ajouter" @click={$items = [...$items, 3]}>a</button>
<button class="retirer" @click={$items = $items.slice(1)}>r</button>
<button class="vider" @click={$tag = ''}>v</button>
<button class="remettre" @click={$tag = 'aside'}>m</button>
`,
  'lignes-cle-el.mjs': `<script>
$tag  = 'section'
$rows = [{ id: 1 }, { id: 2 }]
</script>
{for r in $rows by id}<@element $tag data-t="el">{r.id}</@element>{end}
<button class="changer" @click={$tag = 'article'}>c</button>
<button class="ajouter" @click={$rows = [...$rows, { id: 3 }]}>a</button>
<button class="retirer" @click={$rows = $rows.slice(1)}>r</button>
<button class="inverser" @click={$rows = $rows.slice().reverse()}>i</button>
`,
  'lignes-si-el.mjs': `<script>
$tag   = 'section'
$vis   = true
$items = [1, 2]
</script>
{if $vis}{for x in $items}<@element $tag data-t="el">{x}</@element>{end}{end}
<button class="changer" @click={$tag = 'article'}>c</button>
<button class="ajouter" @click={$items = [...$items, 3]}>a</button>
<button class="basculer" @click={$vis = !$vis}>b</button>
`,
  'lignes-liees-el.mjs': `<script>
$tag  = 'section'
$sel  = 0
$rows = [{ id: 1, v: 'a' }, { id: 2, v: 'b' }, { id: 3, v: 'c' }]
</script>
{for r in $rows by id}<@element $tag data-t="el" title={r.v} @click={$sel = r.id}>{r.id}</@element>{end}
<p data-t="el">{$sel}</p>
<button class="changer" @click={$tag = 'article'}>c</button>
<button class="ecrire" @click={$rows[1].v = 'z'}>e</button>
<button class="inverser" @click={$rows = $rows.slice().reverse()}>i</button>
<button class="retirer" @click={$rows = $rows.slice(1)}>r</button>
<button class="ajouter" @click={$rows = [...$rows, { id: 4, v: 'd' }]}>a</button>
`
}

// les balises des repères de l'ombre, dans l'ordre, avec leur texte (« /masqué » : masquée par la garde d'une balise vide)
const LIRE = (hote: string) => `(() => {
  const sh = document.querySelector('${hote}')._shadow
  return Array.from(sh.querySelectorAll('[data-t="el"]')).map((n) => n.localName + ':' + n.textContent + (n.title ? '@' + n.title : '') + (n.style.display === 'none' ? '/masqué' : '')).join(',')
})()`

// par hôte : le bouton cliqué (aucun au premier rendu), puis les lignes attendues ; liste sans clé (la dernière ligne part, puis revient
// quand $tag a changé entre-temps), liste à clé
// (la première ligne part, les lignes s'inversent), liste dans un `{if}` refermé puis rouvert
const SCENES: Record<string, [string | null, string][]> = {
  'mjs-lignes-el': [
    [null, 'section:1,section:2'],
    ['.changer', 'article:1,article:2'],
    ['.ajouter', 'article:1,article:2,article:3'],
    ['.retirer', 'article:2,article:3'],
    ['.vider', 'article:2/masqué,article:3/masqué'],
    ['.remettre', 'aside:2,aside:3'],
    ['.ajouter', 'aside:2,aside:3,aside:3'],
  ],
  'mjs-lignes-cle-el': [
    [null, 'section:1,section:2'],
    ['.changer', 'article:1,article:2'],
    ['.ajouter', 'article:1,article:2,article:3'],
    ['.retirer', 'article:2,article:3'],
    ['.inverser', 'article:3,article:2'],
  ],
  'mjs-lignes-si-el': [
    [null, 'section:1,section:2'],
    ['.changer', 'article:1,article:2'],
    ['.ajouter', 'article:1,article:2,article:3'],
    ['.basculer', ''],
    ['.basculer', 'article:1,article:2,article:3'],
  ],
  // liste à clé dont la balise porte une liaison (`title`) et un gestionnaire : la liaison écrit sur la balise neuve, le clic agit sur sa
  // propre ligne, après un changement de balise, une écriture, une inversion, une ligne retirée puis une ligne neuve
  'mjs-lignes-liees-el': [
    [null, 'section:1@a,section:2@b,section:3@c,p:0'],
    ['.changer', 'article:1@a,article:2@b,article:3@c,p:0'],
    ['.ecrire', 'article:1@a,article:2@z,article:3@c,p:0'],
    ['[title="z"]', 'article:1@a,article:2@z,article:3@c,p:2'],
    ['.inverser', 'article:3@c,article:2@z,article:1@a,p:2'],
    ['[title="c"]', 'article:3@c,article:2@z,article:1@a,p:3'],
    ['.retirer', 'article:2@z,article:1@a,p:3'],
    ['.ajouter', 'article:2@z,article:1@a,article:4@d,p:3'],
    ['[title="d"]', 'article:2@z,article:1@a,article:4@d,p:4'],
  ],
}
const HOTES = Object.keys(SCENES)

const NAVIGATEURS = ['chromium', 'firefox', 'webkit'] as const
const MODES: Mode[] = ['dev-parents-avant', 'bundle', 'ssr']
const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, HOTES))
  return cibles.get(mode)!
}

for (const nav of NAVIGATEURS) describe(`<@element $tag> dans plusieurs lignes d'un {for} : chaque ligne prend la balise (${nav} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) { console.log(`  ℹ️  ${nav} non installé, test sauté. Activer : \`npx playwright install ${nav}\``); return }
    browser = await playwright[nav].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const hote of HOTES) for (const mode of MODES) for (const variante of variantes(mode)) it(`${hote.slice(4)}, ${mode}${variante ? ' ' + variante : ''} : chaque ligne suit $tag`, async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible(mode), hote, variante)
    try {
      const vus: string[] = []
      for (const [clic, attendu] of SCENES[hote]) {
        if (clic) await o.page.evaluate(`document.querySelector('${hote}')._shadow.querySelector('${clic}')?.click()`)
        await o.page.waitForFunction(`(() => { try { return ${LIRE(hote)} === ${JSON.stringify(attendu)} } catch (e) { return false } })()`, null, { timeout: 3000 }).catch(() => {})
        vus.push(await o.page.evaluate(`(() => { try { return ${LIRE(hote)} } catch (e) { return '?' } })()`))
      }
      assert.deepEqual(vus, SCENES[hote].map((e) => e[1]), 'les balises des lignes, étape par étape')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })
})
