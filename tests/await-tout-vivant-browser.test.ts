// tout ce qu'une branche `{await}` affiche suit ses variables, comme à la racine : le texte `{…}` et le HTML brut `{{…}}`, l'attribut simple `title={…}`, la chaîne
// à accolades `class="carte {$ton}"`, la prop d'un composant enfant `<@c-carte item={$x}>`, dans l'attente, `{success}` et `{error}`, avec la valeur de la branche et
// un `{const}` lus à côté de la variable, et sous un `{for}` de la branche. Chaque cas a son témoin à la racine (la même écriture hors de `{await}`) ou une valeur
// attendue écrite à la main : un témoin faux arrête le cas aussitôt, c'est le test qui est à revoir.
// La promesse est tenue par le test (`finir()`, `echouer()`), pour que la branche d'attente existe avant l'arrivée ; elle est remplacée, rejetée, retirée, et la
// variable change à chaque étape : aucune erreur, aucun bandeau `mjs-fatal-error`, et le texte d'une branche qui n'est plus affichée ne déborde pas sur celui d'une autre
// (le pool de nœuds texte réattribue les nœuds d'une branche détruite).
// Les trois modes (développement, production en fichiers séparés, production en un seul fichier) en navigateur réel, puis la reprise d'une page rendue par le serveur
// (`markers`, `positional`, `diff`, `replace`) ; une interpolation qui ne lit que la valeur de la branche n'émet aucun effet (lecture du code émis).

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { VARIANTES, construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

// la promesse du composant, ses gestes ; chaque source y ajoute ses variables, ses méthodes et son gabarit
const PROMESSE = (resolu: string) => `  fin = null
  ko  = null

  armer    = (res, rej) ->
    fin = res
    ko  = rej
  nouvelle = -> new Promise(armer)
  $p       = nouvelle()

  @finir    = -> fin(${resolu})
  @echouer  = -> ko(new Error('non'))
  @relancer = -> $p = nouvelle()
  @retirer  = -> $p = null
`

const SOURCES: Record<string, string> = {
  // le texte `{…}` et le HTML brut `{{…}}` : dans l'attente, dans `{success}` (avec la valeur de la branche), dans `{error}`
  'tv-texte.mjs': `<script>
  $suffixe = '!'
  $brut    = '<i>a</i>'

${PROMESSE("{ titre: 'T' }")}
  @suffixer = (s) -> $suffixe = s
  @griffer  = (h) -> $brut = h
</script>
<u class="hors">{'T' + $suffixe}</u><u class="hors-erreur">{'non' + $suffixe}</u><u class="hors-brut">{{$brut}}</u>
{await $p}
  <i class="att">attente{$suffixe}</i>
{success v}
  <b class="dans">{v.titre + $suffixe}</b><s class="brut">{{$brut}}</s>
{error err}
  <b class="dans">{err.message + $suffixe}</b>
{end}
`,
  // l'attribut simple (avec le filtre de sécurité des adresses) et la chaîne à accolades : dans l'attente, `{success}`, `{error}`
  'tv-attr.mjs': `<script>
  $suffixe = 'a'
  $ton     = 'clair'
  $url     = 'https://ok.test/'

${PROMESSE("{ nom: 'N' }")}
  @suffixer = (s) -> $suffixe = s
  @teinter  = (t) -> $ton = t
  @adresser = (u) -> $url = u
</script>
<u class="hors">h</u>
{await $p}
  <a class="att" title={$suffixe} data-t="x {$ton}" href={$url}>att</a><em class="chaine {$ton}">att</em>
{success v}
  <a class="dans" title={v.nom + $suffixe} data-t="x {$ton} {v.nom}" href={$url}>ok</a><em class="chaine {$ton}">ok</em>
{error err}
  <a class="dans" title={err.message + $suffixe} data-t="x {$ton}" href={$url}>ko</a><em class="chaine {$ton}">ko</em>
{end}
`,
  // les attributs d'un dessin : la casse de `viewBox` et l'espace de noms de `xlink:href` restent ceux du gabarit
  'tv-svg.mjs': `<script>
  $vb     = '0 0 10 10'
  $ref    = '#a'
  $rayon  = 3

${PROMESSE('{ n: 1 }')}
  @cadrer = (v) -> $vb = v
  @pointer = (r) -> $ref = r
  @grossir = (r) -> $rayon = r
</script>
<u class="hors">h</u>
{await $p}
  <i class="att">attente</i>
{success v}
  <svg class="dessin" viewBox={$vb} width="40" height="40"><use class="u" xlink:href={$ref}></use><circle class="c" r={$rayon} cx="5" cy="5"></circle></svg>
{end}
`,
  // la prop d'un composant enfant, et un `data-*` posé sur sa balise : dans l'attente, `{success}`, `{error}`
  'tv-prop.mjs': `<script>
  $obj = 'a'

${PROMESSE("{ nom: 'N' }")}
  @peindre = (o) -> $obj = o
</script>
<u class="hors">h</u>
{await $p}
  <@c-carte class="att" item={$obj} data-k={$obj}></@c-carte>
{success v}
  <@c-carte class="dans" item={v.nom + $obj} data-k={$obj}></@c-carte>
{error err}
  <@c-carte class="dans" item={err.message + $obj} data-k={$obj}></@c-carte>
{end}
`,
  'c-carte.mjs': `<script>
  $item = null
</script>
<p class="vu">{$item}</p>
`,
  // sous un `{for}` de la branche : les lignes (texte, attribut, prop) et un texte à côté de la liste suivent la variable
  'tv-pour.mjs': `<script>
  $suffixe = '!'

${PROMESSE("{ items: ['a', 'b'] }")}
  @suffixer = (s) -> $suffixe = s
</script>
<u class="hors">{$suffixe}</u>
{await $p}
  <i class="att">attente</i>
{success v}
  <p class="dehors">{$suffixe}</p>
  <ul class="liste">{for x in v.items}<li title={x + $suffixe}>{x}{$suffixe}</li>{end}</ul>
  <div class="enfants">{for x in v.items}<@c-carte class="ligne" item={x + $suffixe}></@c-carte>{end}</div>
{end}
`,
  // un `{const}` de la branche qui lit une variable : le texte le relit ; un texte qui ne lit que la valeur de la branche reste ce qu'il est
  'tv-const.mjs': `<script>
  $obj = { x: 1 }

${PROMESSE('{ n: 10 }')}
  @remplacer = (o) -> $obj = o
</script>
<u class="hors">h</u>
{await $p}
  <i class="att">attente</i>
{success v}
  {const c = $obj}
  {const d = c.x + v.n}
  <b class="dans">{c.x}/{d}</b><b class="val">{v.n}</b>
{end}
`,
  // l'attente lit $b, `{success v}` lit $a : après le règlement, le nœud texte de l'attente peut être réattribué à `{success}` par le pool de nœuds texte,
  // et un changement de $b ne doit pas l'écraser
  'tv-pool.mjs': `<script>
  $a = 'a1'
  $b = 'b1'

${PROMESSE("{ titre: 'T' }")}
  @changerA = (x) -> $a = x
  @changerB = (x) -> $b = x
</script>
<u class="hors">h</u>
{await $p}
  <i class="att">attente {$b}</i>
{success v}
  <b class="dans">{v.titre} {$a}</b>
{end}
`,
  // un texte dans un `{if}` et dans un `{key}` de la branche : il suit sa variable (le bloc, lui, choisit son contenu une fois, à l'affichage de la branche)
  'tv-si.mjs': `<script>
  $suffixe = '!'

${PROMESSE('{ ok: true, n: 1 }')}
  @suffixer = (s) -> $suffixe = s
</script>
<u class="hors">{$suffixe}</u>
{await $p}
  <i class="att">attente</i>
{success v}
  {if v.ok}<b class="dans">{v.n}{$suffixe}</b>{end}
  {key v.n}<s class="cle" title={$suffixe}>{$suffixe}</s>{end}
{end}
`,
  // la même chose avec des branches sans nom : l'attente lit $b, `{success}` lit $a
  'tv-pool-sans-nom.mjs': `<script>
  $a = 'a1'
  $b = 'b1'

${PROMESSE("{ titre: 'T' }")}
  @changerA = (x) -> $a = x
  @changerB = (x) -> $b = x
</script>
<u class="hors">h</u>
{await $p}
  <i class="att">attente {$b}</i>
{success}
  <b class="dans">ok {$a}</b>
{error}
  <b class="dans">ko {$a}</b>
{end}
`,
  // `{if}` / `{elsif}` / `{else}` et `{key}` dans l'attente, `{success v}` et `{error err}`, qui lisent une variable du dehors, la valeur de la branche ou un `{const}` :
  // le bloc choisit son contenu quand la variable change, un bloc dans un bloc aussi ; `c.x > 3` lit le `{const}`, donc `$obj`
  'tv-bloc.mjs': `<script>
  $mode = 'a'
  $cle  = 1
  $drap = true
  $obj  = { x: 1 }

${PROMESSE('{ n: 10, ok: true }')}
  @regler    = (m) -> $mode = m
  @cler      = (k) -> $cle = k
  @baisser   = (d) -> $drap = d
  @remplacer = (o) -> $obj = o
</script>
<u class="hors">{$mode}</u>
{await $p}
  {if $mode is 'a'}<i class="att">attente A</i>{else}<i class="att">attente {$mode}</i>{end}
{success v}
  {const c = $obj}
  {if $mode is 'a'}<b class="m">A{v.n}</b>{elsif $mode is 'b'}<b class="m">B{c.x}</b>{else}<b class="m">C</b>{end}
  {key $cle}<s class="cle">k{$cle}</s>{end}
  {if $drap}<div class="ext">{if v.ok and $mode is 'a'}<em class="int">in{$mode}</em>{else}<em class="int">out{c.x}</em>{end}</div>{end}
  {if c.x > 3}<p class="gros">gros{c.x}</p>{end}
{error err}
  {if $mode is 'a'}<b class="m">erreur A {err.message}</b>{else}<b class="m">erreur {$mode}</b>{end}
{end}
`,
  // l'attente, `{success}` et `{error}` sans nom : une classe, une attache et un événement qui lisent $ton ; ce que fait une branche qui n'est plus affichée est lu sur
  // le nœud qu'elle a laissé (la page le garde dans `window.__vieux`) et sur le journal (`window.__j`, `window.__emis`)
  'tv-garde.mjs': `<script>
  $ton = 'clair'
  window.__j    = []
  window.__emis = []
  marque = (qui, th) -> (n) ->
    window.__j.push('pose ' + qui + ' ' + th)
    ->
      window.__j.push('defait ' + qui + ' ' + th)

${PROMESSE("{ n: 1 }")}
  @teinter = (t) -> $ton = t
</script>
<u class="hors">{$ton}</u>
{await $p}
  <i class="att" @class{$ton is 'sombre'}="sombre" @attach={marque('att', $ton)} @emit.att={$ton}>attente</i>
{success}
  <b class="dans" @class{$ton is 'sombre'}="sombre" @attach={marque('dans', $ton)} @emit.dans={$ton}>ok</b>
{error}
  <b class="dans" @class{$ton is 'sombre'}="sombre" @attach={marque('dans', $ton)} @emit.dans={$ton}>ko</b>
{end}
`,
  // `null` et `undefined` ne s'écrivent pas dans un texte `{…}`, comme à la racine : une variable, la valeur de la branche, un `{const}` ; `0` et `false` s'écrivent
  'tv-nul.mjs': `<script>
  $v = null

${PROMESSE('{ vide: null, absent: undefined, zero: 0, faux: false }')}
  @definir = (x) -> $v = x
</script>
<u class="hors">[{$v}]</u>
{await $p}
  <i class="att">[{$v}]</i>
{success d}
  {const k = d.absent}
  <b class="nul">[{$v}]</b><b class="seul">[{d.vide}]</b><b class="indef">[{d.absent}]</b><b class="zero">[{d.zero}]</b><b class="faux">[{d.faux}]</b><b class="tout">[{d.vide}{$v}]</b><b class="cst">[{k}]</b>
{error err}
  <b class="err">[{err.cause}]</b>
{end}
`,
  // un `@attach` et un `@emit` dans un `{if}` de `{success v}` : à l'arrivée de la promesse le rendu complet les pose, un changement de choix n'a pas de rendu complet derrière lui
  'tv-bloc-liaisons.mjs': `<script>
  $mode = 'a'
  $ton  = 'clair'
  window.__j    = []
  window.__emis = []
  marque = (qui, th) -> (n) ->
    window.__j.push('pose ' + qui + ' ' + th)
    ->
      window.__j.push('defait ' + qui + ' ' + th)

${PROMESSE('{ n: 1 }')}
  @regler  = (m) -> $mode = m
  @teinter = (t) -> $ton = t
</script>
<u class="hors">{$mode}</u>
{await $p}
  <i class="att">attente</i>
{success v}
  {if $mode is 'a'}<b class="a" @attach={marque('a', $ton)} @emit.vu={$ton}>A{v.n}</b>{else}<b class="b">B</b>{end}
{end}
`
}
const BALISES = Object.keys(SOURCES).filter((f) => f.startsWith('tv-')).map((f) => 'mjs-' + f.replace('.mjs', ''))

const cibles = new Map<Mode, Promise<Cible>>()
const cible  = (mode: Mode) => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, BALISES))
  return cibles.get(mode)!
}

// ce que lit une expression sur une balise du composant (`n` est la balise : `n.textContent`, `n.getAttribute('title')`…), ou `absente` quand elle n'est pas dans la page
const lu = (page: any, balise: string, sel: string, expr: string): Promise<string> => page.evaluate(`(() => {
  const n = document.querySelector('${balise}')._shadow.querySelector('${sel}')
  return n ? String(${expr}) : 'absente'
})()`)

// le composant a survécu : un plantage vide son ombre, lui pose la classe `mjs-error` et y met un bandeau `mjs-fatal-error`
const vivant = (page: any, balise: string): Promise<boolean> => page.evaluate(`(() => {
  const h = document.querySelector('${balise}')
  return !h.classList.contains('mjs-error') && !h._shadow.querySelector('.mjs-fatal-error') && !!h._shadow.querySelector('.hors, .temoin')
})()`)

// le composant est prêt quand son témoin est dans l'ombre
const pret = async (page: any, balise: string) => {
  await page.waitForFunction(`!!document.querySelector('${balise}')?._shadow?.querySelector('.hors, .temoin')`, null, { timeout: 10000 })
  await page.waitForTimeout(150)
}

// un ou plusieurs appels sur le composant, puis le temps de la mise à jour ; la méthode rend parfois une promesse (`relancer()` rend celle qu'elle pose) et `evaluate`
// l'attendrait : rien n'est rendu à la page
const regler = async (page: any, balise: string, appels: string | string[]) => {
  const liste = Array.isArray(appels) ? appels : [appels]
  await page.evaluate(`(() => { const h = document.querySelector('${balise}'); ${liste.map((a) => `h.${a};`).join(' ')} return null })()`)
  await page.waitForTimeout(200)
}

// note un écart, sans arrêter le cas : tous les écarts d'un cas sont rendus ensemble
const verifier = (ecarts: string[], quoi: string, lue: unknown, attendu: unknown) => {
  if (lue !== attendu) ecarts.push(`${quoi} : attendu ${JSON.stringify(attendu)}, lu ${JSON.stringify(lue)}`)
}

// une lecture attendue : [sélecteur, expression, valeur, témoin] ; un témoin (la même écriture hors de {await}) faux arrête le cas
type Lecture = [string, string, string, boolean?]
type Etape   = [string, string | string[] | null, Lecture[]]

async function suivre(page: any, balise: string, etapes: Etape[], ecarts: string[]) {
  for (const [nom, appels, lectures] of etapes) {
    if (appels) await regler(page, balise, appels)
    verifier(ecarts, `composant vivant, ${nom}`, await vivant(page, balise), true)
    for (const [sel, expr, attendu, temoin] of lectures) {
      const lue = await lu(page, balise, sel, expr)
      if (temoin) assert.equal(lue, attendu, `le témoin ${sel} est faux (${nom}) : le test lui-même est à revoir`)
      else verifier(ecarts, `${sel}, ${nom}`, lue, attendu)
    }
  }
}

const TXT = 'n.textContent'
const ABS = 'absente'

// garde la balise `sel` du composant dans `window.__vieux` : lue après qu'une branche l'a retirée de la page, elle dit ce que cette branche a encore écrit dessus
const retenir = (page: any, balise: string, sel: string): Promise<null> => page.evaluate(`(() => { window.__vieux = document.querySelector('${balise}')._shadow.querySelector('${sel}'); return null })()`)
const vieux   = (page: any, expr: string): Promise<string> => page.evaluate(`(() => { const n = window.__vieux; return n ? String(${expr}) : 'absente' })()`)

// ----- les trois modes, Chromium puis Firefox quand il est installé
for (const moteur of ['chromium', 'firefox'] as const) for (const mode of ['dev-parents-avant', 'split', 'bundle'] as const) describe(`le contenu d'une branche {await} suit ses variables (${mode}, ${moteur} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[moteur].executablePath())
    if (!present) { console.log(`  ℹ️  ${moteur} non installé, test du contenu vivant des branches sauté. Activer : \`npx playwright install ${moteur}\``); return }
    browser = await playwright[moteur].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  // ouvre le composant, joue le scénario, puis exige qu'aucun écart n'ait été noté et qu'aucune erreur n'ait été dite par la page
  const jouer = async (balise: string, scenario: (page: any, ecarts: string[]) => Promise<void>) => {
    const o      = await charger(browser, await cible(mode), balise)
    const ecarts = [] as string[]
    try {
      await pret(o.page, balise)
      await scenario(o.page, ecarts)
      assert.deepEqual([...ecarts, ...graves(o).map((g) => `erreur de la page : ${g}`)], [])
    } finally {
      await o.fermer()
    }
  }

  it('les composants se compilent', async function () {
    if (!present) { this.skip(); return }
    await cible(mode)
  })

  it('texte {…} et HTML brut {{…}} : l\'attente, {success} (avec la valeur de la branche) et {error} suivent la variable, la promesse remplacée, rejetée, retirée', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-tv-texte'
    await jouer(B, async (page, ecarts) => {
      await suivre(page, B, [
        ['avant l\'arrivée',            null,                       [['.att', TXT, 'attente!'], ['.dans', TXT, ABS], ['.hors', TXT, 'T!', true]]],
        ['attente, $suffixe = ?',       'suffixer(\'?\')',          [['.att', TXT, 'attente?'], ['.hors', TXT, 'T?', true]]],
        ['arrivée de la promesse',      'finir()',                  [['.att', TXT, ABS], ['.dans', TXT, 'T?'], ['.brut', 'n.firstElementChild.innerHTML', '<i>a</i>']]],
        ['{success}, $suffixe = #',     'suffixer(\'#\')',          [['.dans', TXT, 'T#'], ['.hors', TXT, 'T#', true]]],
        ['{success}, HTML brut changé', 'griffer(\'<b>x</b>\')',    [['.brut', 'n.firstElementChild.innerHTML', '<b>x</b>'], ['.hors-brut', 'n.firstElementChild.innerHTML', '<b>x</b>', true]]],
        ['promesse remplacée',          'relancer()',               [['.dans', TXT, ABS], ['.att', TXT, 'attente#']]],
        ['attente, $suffixe = -',       'suffixer(\'-\')',          [['.att', TXT, 'attente-'], ['.dans', TXT, ABS]]],
        ['promesse rejetée',            'echouer()',                [['.att', TXT, ABS], ['.dans', TXT, 'non-'], ['.hors-erreur', TXT, 'non-', true]]],
        ['{error}, $suffixe = +',       'suffixer(\'+\')',          [['.dans', TXT, 'non+'], ['.hors-erreur', TXT, 'non+', true]]],
        ['promesse retirée',            'retirer()',                [['.dans', TXT, ABS], ['.att', TXT, ABS]]],
        ['rien d\'affiché, $suffixe = =', 'suffixer(\'=\')',        [['.dans', TXT, ABS], ['.att', TXT, ABS], ['.hors', TXT, 'T=', true]]],
        ['promesse rendue',             'relancer()',               [['.att', TXT, 'attente=']]],
        ['réglée',                      'finir()',                  [['.dans', TXT, 'T='], ['.att', TXT, ABS]]]
      ], ecarts)
    })
  })

  it('attribut simple et chaîne à accolades : l\'attente, {success} et {error} suivent la variable, le filtre des adresses reste en place', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-tv-attr'
    const TITRE = 'n.getAttribute(\'title\')'
    const DATA  = 'n.getAttribute(\'data-t\')'
    const HREF  = 'n.getAttribute(\'href\')'
    await jouer(B, async (page, ecarts) => {
      await suivre(page, B, [
        ['avant l\'arrivée',            null,                                [['a.att', TITRE, 'a'], ['a.att', DATA, 'x clair'], ['a.att', HREF, 'https://ok.test/'], ['em.chaine', 'n.className', 'chaine clair']]],
        ['attente, variables changées', ['suffixer(\'b\')', 'teinter(\'sombre\')', 'adresser(\'https://deux.test/\')'], [['a.att', TITRE, 'b'], ['a.att', DATA, 'x sombre'], ['a.att', HREF, 'https://deux.test/'], ['em.chaine', 'n.className', 'chaine sombre']]],
        ['arrivée de la promesse',      'finir()',                           [['a.att', TITRE, ABS], ['a.dans', TITRE, 'Nb'], ['a.dans', DATA, 'x sombre N'], ['a.dans', HREF, 'https://deux.test/'], ['em.chaine', 'n.className', 'chaine sombre']]],
        ['{success}, variables changées', ['suffixer(\'c\')', 'teinter(\'clair\')'], [['a.dans', TITRE, 'Nc'], ['a.dans', DATA, 'x clair N'], ['em.chaine', 'n.className', 'chaine clair']]],
        ['{success}, adresse changée',  'adresser(\'https://trois.test/\')', [['a.dans', HREF, 'https://trois.test/']]],
        ['{success}, adresse dangereuse', 'adresser(\'javascript:alert(1)\')', [['a.dans', HREF, 'https://trois.test/']]],
        ['{success}, adresse retirée',  'adresser(null)',                    [['a.dans', HREF, 'null']]],
        ['{success}, adresse rendue',   'adresser(\'https://ok.test/\')',    [['a.dans', HREF, 'https://ok.test/']]],
        ['promesse remplacée, variables changées', ['relancer()', 'teinter(\'nuit\')', 'suffixer(\'d\')'], [['a.dans', TITRE, ABS], ['a.att', TITRE, 'd'], ['a.att', DATA, 'x nuit'], ['em.chaine', 'n.className', 'chaine nuit']]],
        ['promesse rejetée',            'echouer()',                         [['a.att', TITRE, ABS], ['a.dans', TITRE, 'nond'], ['a.dans', DATA, 'x nuit'], ['em.chaine', 'n.className', 'chaine nuit']]],
        ['{error}, variables changées', ['teinter(\'jour\')', 'suffixer(\'e\')'], [['a.dans', TITRE, 'none'], ['a.dans', DATA, 'x jour'], ['em.chaine', 'n.className', 'chaine jour']]],
        ['promesse retirée, variables changées', ['retirer()', 'teinter(\'z\')', 'suffixer(\'y\')'], [['a.dans', TITRE, ABS], ['a.att', TITRE, ABS]]]
      ], ecarts)
    })
  })

  it('dessin dans {success} : viewBox garde sa casse, xlink:href son espace de noms, l\'attribut change sans doublon', async function () {
    if (!present) { this.skip(); return }
    const B   = 'mjs-tv-svg'
    const XL  = 'http://www.w3.org/1999/xlink'
    const VB  = 'n.getAttribute(\'viewBox\')'
    const NVB = 'Array.from(n.attributes).filter((a) => a.name.toLowerCase() === \'viewbox\').length'
    const REF = `n.getAttributeNS('${XL}', 'href')`
    const NRF = 'Array.from(n.attributes).filter((a) => a.localName === \'href\').length'
    await jouer(B, async (page, ecarts) => {
      await suivre(page, B, [
        ['arrivée de la promesse',   'finir()',                               [['svg.dessin', VB, '0 0 10 10'], ['svg.dessin', NVB, '1'], ['use.u', REF, '#a'], ['use.u', NRF, '1'], ['circle.c', 'n.getAttribute(\'r\')', '3']]],
        ['variables changées',       ['cadrer(\'0 0 20 20\')', 'pointer(\'#b\')', 'grossir(4)'], [['svg.dessin', VB, '0 0 20 20'], ['svg.dessin', NVB, '1'], ['use.u', REF, '#b'], ['use.u', NRF, '1'], ['circle.c', 'n.getAttribute(\'r\')', '4']]],
        ['adresse retirée',          'pointer(null)',                         [['use.u', REF, 'null'], ['use.u', NRF, '0']]],
        ['adresse rendue',           'pointer(\'#c\')',                       [['use.u', REF, '#c'], ['use.u', NRF, '1']]],
        ['promesse remplacée, puis variables changées', ['relancer()', 'cadrer(\'0 0 5 5\')', 'pointer(\'#d\')'], [['svg.dessin', VB, ABS]]],
        ['réglée',                   'finir()',                               [['svg.dessin', VB, '0 0 5 5'], ['use.u', REF, '#d'], ['svg.dessin', NVB, '1']]]
      ], ecarts)
    })
  })

  it('prop d\'un composant enfant : l\'attente, {success} et {error} suivent la variable (la prop et le data-* de la balise)', async function () {
    if (!present) { this.skip(); return }
    const B   = 'mjs-tv-prop'
    const VU  = 'n._shadow.querySelector(\'.vu\').textContent'
    const DK  = 'n.getAttribute(\'data-k\')'
    await jouer(B, async (page, ecarts) => {
      await suivre(page, B, [
        ['avant l\'arrivée',         null,                [['mjs-c-carte.att', VU, 'a'], ['mjs-c-carte.att', DK, 'a'], ['mjs-c-carte.dans', VU, ABS]]],
        ['attente, $obj = b',        'peindre(\'b\')',    [['mjs-c-carte.att', VU, 'b'], ['mjs-c-carte.att', DK, 'b']]],
        ['arrivée de la promesse',   'finir()',           [['mjs-c-carte.att', VU, ABS], ['mjs-c-carte.dans', VU, 'Nb'], ['mjs-c-carte.dans', DK, 'b']]],
        ['{success}, $obj = c',      'peindre(\'c\')',    [['mjs-c-carte.dans', VU, 'Nc'], ['mjs-c-carte.dans', DK, 'c']]],
        ['promesse remplacée, $obj = d', ['relancer()', 'peindre(\'d\')'], [['mjs-c-carte.dans', VU, ABS], ['mjs-c-carte.att', VU, 'd'], ['mjs-c-carte.att', DK, 'd']]],
        ['promesse rejetée',         'echouer()',         [['mjs-c-carte.att', VU, ABS], ['mjs-c-carte.dans', VU, 'nond'], ['mjs-c-carte.dans', DK, 'd']]],
        ['{error}, $obj = e',        'peindre(\'e\')',    [['mjs-c-carte.dans', VU, 'none'], ['mjs-c-carte.dans', DK, 'e']]],
        ['promesse retirée, $obj = f', ['retirer()', 'peindre(\'f\')'], [['mjs-c-carte.dans', VU, ABS], ['mjs-c-carte.att', VU, ABS]]]
      ], ecarts)
    })
  })

  it('sous un {for} de la branche : les lignes (texte, attribut, prop) et le texte à côté de la liste suivent la variable', async function () {
    if (!present) { this.skip(); return }
    const B      = 'mjs-tv-pour'
    const LIGNES = '[...n.querySelectorAll(\'li\')].map((x) => x.textContent).join(\',\')'
    const TITRES = '[...n.querySelectorAll(\'li\')].map((x) => x.getAttribute(\'title\')).join(\',\')'
    const PROPS  = '[...n.querySelectorAll(\'mjs-c-carte.ligne\')].map((x) => x._shadow.querySelector(\'.vu\').textContent).join(\',\')'
    await jouer(B, async (page, ecarts) => {
      await suivre(page, B, [
        ['arrivée de la promesse',   'finir()',                 [['.dehors', TXT, '!'], ['.liste', LIGNES, 'a!,b!'], ['.liste', TITRES, 'a!,b!'], ['.enfants', PROPS, 'a!,b!']]],
        ['$suffixe = ?',             'suffixer(\'?\')',         [['.hors', TXT, '?', true], ['.dehors', TXT, '?'], ['.liste', LIGNES, 'a?,b?'], ['.liste', TITRES, 'a?,b?'], ['.enfants', PROPS, 'a?,b?']]],
        ['promesse remplacée, $suffixe = #', ['relancer()', 'suffixer(\'#\')'], [['.dehors', TXT, ABS]]],
        ['réglée',                   'finir()',                 [['.dehors', TXT, '#'], ['.liste', LIGNES, 'a#,b#'], ['.liste', TITRES, 'a#,b#'], ['.enfants', PROPS, 'a#,b#']]]
      ], ecarts)
    })
  })

  it('{const} de la branche qui lit une variable : le texte relit le {const}, le texte qui ne lit que la valeur de la branche ne bouge pas', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-tv-const'
    await jouer(B, async (page, ecarts) => {
      await suivre(page, B, [
        ['arrivée de la promesse',   'finir()',                    [['.dans', TXT, '1/11'], ['.val', TXT, '10']]],
        ['$obj remplacé',            'remplacer({ x: 5 })',        [['.dans', TXT, '5/15'], ['.val', TXT, '10']]],
        ['$obj remplacé encore',     'remplacer({ x: 7 })',        [['.dans', TXT, '7/17'], ['.val', TXT, '10']]],
        ['promesse remplacée, $obj remplacé', ['relancer()', 'remplacer({ x: 8 })'], [['.dans', TXT, ABS]]],
        ['réglée',                   'finir()',                    [['.dans', TXT, '8/18'], ['.val', TXT, '10']]]
      ], ecarts)
    })
  })

  it('texte et attribut dans un {if} et un {key} de la branche : ils suivent la variable, la promesse remplacée puis réglée les refait', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-tv-si'
    await jouer(B, async (page, ecarts) => {
      await suivre(page, B, [
        ['arrivée de la promesse',   'finir()',                [['.dans', TXT, '1!'], ['.cle', TXT, '!'], ['.cle', 'n.getAttribute(\'title\')', '!']]],
        ['$suffixe = ?',             'suffixer(\'?\')',        [['.dans', TXT, '1?'], ['.cle', TXT, '?'], ['.cle', 'n.getAttribute(\'title\')', '?'], ['.hors', TXT, '?', true]]],
        ['promesse remplacée, $suffixe = #', ['relancer()', 'suffixer(\'#\')'], [['.dans', TXT, ABS], ['.cle', TXT, ABS]]],
        ['réglée',                   'finir()',                [['.dans', TXT, '1#'], ['.cle', TXT, '#']]],
        ['$suffixe = -',             'suffixer(\'-\')',        [['.dans', TXT, '1-'], ['.cle', TXT, '-'], ['.cle', 'n.getAttribute(\'title\')', '-']]]
      ], ecarts)
    })
  })

  it('le texte de l\'attente ne déborde pas sur celui de {success} quand le pool de nœuds texte réattribue ses nœuds', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-tv-pool'
    await jouer(B, async (page, ecarts) => {
      await suivre(page, B, [
        ['avant l\'arrivée',         null,                   [['.att', TXT, 'attente b1']]],
        ['arrivée de la promesse',   'finir()',              [['.att', TXT, ABS], ['.dans', TXT, 'T a1']]],
        ['$a = a2',                  'changerA(\'a2\')',     [['.dans', TXT, 'T a2']]],
        ['$b = b2 (lu par l\'attente seule)', 'changerB(\'b2\')', [['.dans', TXT, 'T a2']]],
        ['$b = b3, encore',          'changerB(\'b3\')',     [['.dans', TXT, 'T a2']]],
        ['promesse remplacée',       'relancer()',           [['.dans', TXT, ABS], ['.att', TXT, 'attente b3']]],
        ['$a = a3 (lu par {success} seule)', 'changerA(\'a3\')', [['.att', TXT, 'attente b3']]],
        ['réglée',                   'finir()',              [['.dans', TXT, 'T a3'], ['.att', TXT, ABS]]]
      ], ecarts)
    })
  })

  it('branches sans nom : le texte de {success} ne déborde pas sur celui de l\'attente quand la promesse est remplacée', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-tv-pool-sans-nom'
    await jouer(B, async (page, ecarts) => {
      await suivre(page, B, [
        ['arrivée de la promesse',   'finir()',              [['.dans', TXT, 'ok a1']]],
        ['$a = a2',                  'changerA(\'a2\')',     [['.dans', TXT, 'ok a2']]],
        ['promesse remplacée',       'relancer()',           [['.dans', TXT, ABS], ['.att', TXT, 'attente b1']]],
        ['$a = a3 (lu par {success} seule)', 'changerA(\'a3\')', [['.att', TXT, 'attente b1']]],
        ['$b = b2',                  'changerB(\'b2\')',     [['.att', TXT, 'attente b2']]],
        ['promesse rejetée',         'echouer()',            [['.att', TXT, ABS], ['.dans', TXT, 'ko a3']]],
        ['$a = a4 (lu par {error})', 'changerA(\'a4\')',     [['.dans', TXT, 'ko a4']]],
        ['promesse remplacée',       'relancer()',           [['.dans', TXT, ABS], ['.att', TXT, 'attente b2']]],
        ['$a = a5',                  'changerA(\'a5\')',     [['.att', TXT, 'attente b2']]]
      ], ecarts)
    })
  })

  it('{if} / {elsif} / {else} et {key} de l\'attente, de {success} et de {error} : le bloc suit sa variable (du dehors, {const} lu), un bloc dans un bloc aussi, la promesse remplacée, rejetée, retirée', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-tv-bloc'
    await jouer(B, async (page, ecarts) => {
      await suivre(page, B, [
        ['avant l\'arrivée',              null,                               [['.att', TXT, 'attente A'], ['.m', TXT, ABS], ['.hors', TXT, 'a', true]]],
        ['attente, $mode = b',            'regler(\'b\')',                    [['.att', TXT, 'attente b'], ['.hors', TXT, 'b', true]]],
        ['attente, $mode = a',            'regler(\'a\')',                    [['.att', TXT, 'attente A']]],
        ['arrivée de la promesse',        'finir()',                          [['.att', TXT, ABS], ['.m', TXT, 'A10'], ['.cle', TXT, 'k1'], ['.int', TXT, 'ina'], ['.ext', TXT, 'ina'], ['.gros', TXT, ABS]]],
        ['{success}, $mode = b',          'regler(\'b\')',                    [['.m', TXT, 'B1'], ['.int', TXT, 'out1'], ['.ext', TXT, 'out1'], ['.hors', TXT, 'b', true]]],
        ['$obj remplacé (x = 5)',         'remplacer({ x: 5 })',              [['.m', TXT, 'B5'], ['.int', TXT, 'out5'], ['.gros', TXT, 'gros5']]],
        ['{success}, $mode = z',          'regler(\'z\')',                    [['.m', TXT, 'C'], ['.int', TXT, 'out5']]],
        ['{success}, $mode = a',          'regler(\'a\')',                    [['.m', TXT, 'A10'], ['.int', TXT, 'ina']]],
        ['clé changée',                   'cler(2)',                          [['.cle', TXT, 'k2']]],
        ['clé changée encore',            'cler(3)',                          [['.cle', TXT, 'k3']]],
        ['$obj remplacé (x = 1)',         'remplacer({ x: 1 })',              [['.gros', TXT, ABS], ['.int', TXT, 'ina']]],
        ['$drap = false',                 'baisser(false)',                   [['.ext', TXT, ABS], ['.int', TXT, ABS]]],
        ['$drap = true',                  'baisser(true)',                    [['.ext', TXT, 'ina']]],
        ['promesse remplacée, $mode = b', ['relancer()', 'regler(\'b\')'],    [['.m', TXT, ABS], ['.att', TXT, 'attente b']]],
        ['attente, $mode = a',            'regler(\'a\')',                    [['.att', TXT, 'attente A']]],
        ['réglée',                        'finir()',                          [['.att', TXT, ABS], ['.m', TXT, 'A10'], ['.cle', TXT, 'k3'], ['.ext', TXT, 'ina']]],
        ['promesse remplacée',            'relancer()',                       [['.m', TXT, ABS], ['.att', TXT, 'attente A']]],
        ['promesse rejetée',              'echouer()',                        [['.m', TXT, 'erreur A non'], ['.cle', TXT, ABS], ['.att', TXT, ABS]]],
        ['{error}, $mode = c',            'regler(\'c\')',                    [['.m', TXT, 'erreur c']]],
        ['promesse retirée, $mode = a',   ['retirer()', 'regler(\'a\')'],     [['.m', TXT, ABS], ['.att', TXT, ABS]]],
        ['promesse rendue',               'relancer()',                       [['.att', TXT, 'attente A']]],
        ['réglée encore',                 'finir()',                          [['.m', TXT, 'A10'], ['.cle', TXT, 'k3']]]
      ], ecarts)
    })
  })

  it('l\'attente et les branches sans nom : @class, @attach et @emit ne touchent plus une branche retirée (aucune écriture, aucun appel, aucun événement)', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-tv-garde'
    // les événements partis depuis la dernière lecture, triés
    const emis    = async (page: any) => ((await page.evaluate('window.__emis.splice(0)')) as string[]).sort().join(',')
    const appels  = (page: any, qui: string): Promise<number> => page.evaluate(`window.__j.filter((e) => e.split(' ')[1] === '${qui}').length`)
    const classe  = 'n.className'
    await jouer(B, async (page, ecarts) => {
      await page.evaluate(`(() => { const h = document.querySelector('${B}'); for (const nom of ['att', 'dans']) h.addEventListener(nom, (e) => window.__emis.push(nom + ':' + e.data)); window.__emis.length = 0; return null })()`)
      await retenir(page, B, '.att')
      await suivre(page, B, [['attente, $ton = sombre', 'teinter(\'sombre\')', [['.att', classe, 'att sombre'], ['.hors', TXT, 'sombre', true]]]], ecarts)
      verifier(ecarts, 'événements, attente, $ton = sombre', await emis(page), 'att:sombre')
      await suivre(page, B, [['arrivée de la promesse', 'finir()', [['.att', TXT, ABS], ['.dans', classe, 'dans sombre']]]], ecarts)
      verifier(ecarts, 'événements, arrivée de la promesse', await emis(page), 'dans:sombre')
      const attente = await appels(page, 'att')
      await suivre(page, B, [['{success}, $ton = clair', 'teinter(\'clair\')', [['.dans', classe, 'dans'], ['.hors', TXT, 'clair', true]]]], ecarts)
      verifier(ecarts, 'événements, {success}, $ton = clair', await emis(page), 'dans:clair')
      verifier(ecarts, 'attente retirée, classe', await vieux(page, classe), 'att sombre')
      verifier(ecarts, 'attente retirée, appels de l\'attache', await appels(page, 'att'), attente)

      await retenir(page, B, '.dans')
      await suivre(page, B, [['promesse remplacée', 'relancer()', [['.dans', TXT, ABS], ['.att', classe, 'att']]]], ecarts)
      await emis(page)
      const succes = await appels(page, 'dans')
      await suivre(page, B, [['attente, $ton = sombre (2)', 'teinter(\'sombre\')', [['.att', classe, 'att sombre']]]], ecarts)
      verifier(ecarts, 'événements, attente, $ton = sombre (2)', await emis(page), 'att:sombre')
      verifier(ecarts, '{success} retirée, classe', await vieux(page, classe), 'dans')
      verifier(ecarts, '{success} retirée, appels de l\'attache', await appels(page, 'dans'), succes)

      await retenir(page, B, '.att')
      await suivre(page, B, [['promesse rejetée', 'echouer()', [['.att', TXT, ABS], ['.dans', classe, 'dans sombre']]]], ecarts)
      verifier(ecarts, 'événements, promesse rejetée', await emis(page), 'dans:sombre')
      const attente2 = await appels(page, 'att')
      await suivre(page, B, [['{error}, $ton = clair', 'teinter(\'clair\')', [['.dans', classe, 'dans']]]], ecarts)
      verifier(ecarts, 'événements, {error}, $ton = clair', await emis(page), 'dans:clair')
      verifier(ecarts, 'attente retirée (2), classe', await vieux(page, classe), 'att sombre')
      verifier(ecarts, 'attente retirée (2), appels de l\'attache', await appels(page, 'att'), attente2)
    })
  })

  it('null et undefined ne s\'écrivent pas dans un texte de branche, comme à la racine : variable, valeur de la branche, {const} ; 0 et false s\'écrivent', async function () {
    if (!present) { this.skip(); return }
    const B = 'mjs-tv-nul'
    await jouer(B, async (page, ecarts) => {
      await suivre(page, B, [
        ['avant l\'arrivée',          null,                  [['.att', TXT, '[]'], ['.hors', TXT, '[]', true]]],
        ['attente, $v = x',           'definir(\'x\')',      [['.att', TXT, '[x]'], ['.hors', TXT, '[x]', true]]],
        ['attente, $v = null',        'definir(null)',       [['.att', TXT, '[]'], ['.hors', TXT, '[]', true]]],
        ['arrivée de la promesse',    'finir()',             [['.nul', TXT, '[]'], ['.seul', TXT, '[]'], ['.indef', TXT, '[]'], ['.zero', TXT, '[0]'], ['.faux', TXT, '[false]'], ['.tout', TXT, '[]'], ['.cst', TXT, '[]']]],
        ['{success}, $v = y',         'definir(\'y\')',      [['.nul', TXT, '[y]'], ['.tout', TXT, '[y]'], ['.hors', TXT, '[y]', true]]],
        ['{success}, $v = undefined', 'definir(undefined)',  [['.nul', TXT, '[]'], ['.tout', TXT, '[]'], ['.hors', TXT, '[]', true]]],
        ['promesse remplacée',        'relancer()',          [['.nul', TXT, ABS], ['.att', TXT, '[]']]],
        ['promesse rejetée',          'echouer()',           [['.att', TXT, ABS], ['.err', TXT, '[]']]]
      ], ecarts)
    })
  })

  it('@attach et @emit dans un {if} de {success v} : le contenu né d\'un changement de choix reçoit son attache (une pose) et annonce sa valeur', async function () {
    if (!present) { this.skip(); return }
    const B       = 'mjs-tv-bloc-liaisons'
    const journal = (page: any): Promise<string> => page.evaluate('window.__j.join(\',\')')
    const emis    = async (page: any) => ((await page.evaluate('window.__emis.splice(0)')) as string[]).join(',')
    await jouer(B, async (page, ecarts) => {
      await page.evaluate(`(() => { document.querySelector('${B}').addEventListener('vu', (e) => window.__emis.push('vu:' + e.data)); return null })()`)
      await suivre(page, B, [['arrivée de la promesse', 'finir()', [['.a', TXT, 'A1'], ['.hors', TXT, 'a', true]]]], ecarts)
      verifier(ecarts, 'arrivée, attache', await journal(page), 'pose a clair')
      verifier(ecarts, 'arrivée, événements', await emis(page), 'vu:clair')
      await suivre(page, B, [['$mode = b', 'regler(\'b\')', [['.a', TXT, ABS], ['.b', TXT, 'B']]]], ecarts)
      verifier(ecarts, '$mode = b, attache', await journal(page), 'pose a clair,defait a clair')
      verifier(ecarts, '$mode = b, événements', await emis(page), '')
      await suivre(page, B, [['$mode = a', 'regler(\'a\')', [['.a', TXT, 'A1'], ['.b', TXT, ABS]]]], ecarts)
      verifier(ecarts, '$mode = a, attache', await journal(page), 'pose a clair,defait a clair,pose a clair')
      verifier(ecarts, '$mode = a, événements', await emis(page), 'vu:clair')
      await suivre(page, B, [['$ton = sombre', 'teinter(\'sombre\')', [['.a', TXT, 'A1']]]], ecarts)
      verifier(ecarts, '$ton = sombre, attache', await journal(page), 'pose a clair,defait a clair,pose a clair,defait a clair,pose a sombre')
      verifier(ecarts, '$ton = sombre, événements', await emis(page), 'vu:sombre')
    })
  })
})

// ----- le code émis : une interpolation qui ne lit que la valeur de la branche (ou des constantes) n'émet aucun effet
describe('code émis : le contenu d\'une branche {await} qui ne lit aucune variable ne reçoit aucun effet', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const emis = async (gabarit: string) => (await transpile(`<script>\n  $p = Promise.resolve({ titre: 'T' })\n  $suffixe = '!'\n  $obj = { x: 1 }\n</script>\n${gabarit}\n`, { moduleName: 'tv-emis' })).output

  it('texte, attribut, chaîne à accolades, prop et HTML brut qui ne lisent que la valeur de la branche : aucun effet, rien de plus dans le code', async () => {
    const code = await emis('{await $p}\n{success v}\n<b title={v.titre} class="a {v.titre}">{v.titre}</b><s>{{v.titre}}</s><mjs-carte item={v.titre}></mjs-carte>\n{end}')
    assert.match(code, /const _mjs_eff = \[\];/, 'aucun effet enregistré')
    assert.ok(!code.includes('_mjs_getTextNode'), 'aucun nœud texte repéré')
    assert.ok(!/this\._mjs_nodes\.[a-z]\d/.test(code), 'aucune lecture de nœud par un effet')
  })

  it('un {const} qui ne lit aucune variable ne fait pas d\'effet non plus', async () => {
    const code = await emis('{await $p}\n{success v}\n{const k = v.titre + 1}\n<b title={k}>{k}</b>\n{end}')
    assert.match(code, /const _mjs_eff = \[\];/, 'aucun effet enregistré')
  })

  it('texte et attribut qui lisent une variable : un effet de racine gardé par la branche affichée, avec la valeur de la branche recréée', async () => {
    const code = await emis('{await $p}\n{success v}\n<b title={v.titre + $suffixe}>{v.titre + $suffixe}</b>\n{end}')
    assert.match(code, /this\._mjs_nodes\.t\d+; if\(_mjs_node && _mjsThis\._mjs_awaitLastRender\?\.get\('await\d+'\) === 'success'\)/, 'effet du texte gardé')
    assert.match(code, /this\._mjs_nodes\.a\d+; if\(_mjs_node && _mjsThis\._mjs_awaitLastRender\?\.get\('await\d+'\) === 'success'\)/, 'effet de l\'attribut gardé')
    assert.match(code, /_mjsThis\._mjs_awaitStates\?\.get\('await\d+'\)\?\.data/, 'valeur de la branche recréée')
  })

  it('un {const} qui lit une variable est recréé par l\'effet du texte, qui suit aussi cette variable', async () => {
    const code = await emis('{await $p}\n{success v}\n{const c = $obj}\n<b>{c.x}</b>\n{end}')
    assert.match(code, /"obj": \[/, 'l\'effet est indexé sur la variable du {const}')
    assert.match(code, /const _mjs_cst_\d+ = /, '{const} recréé')
  })

  it('texte lu dans une balise de texte brut (textarea) : reste calculé une fois, jamais de marqueur écrit dans le champ', async () => {
    const code = await emis('{await $p}\n{success v}\n<label>a<textarea>{$suffixe}</textarea></label>\n{end}')
    assert.ok(!code.includes('mjs/marker'), 'aucun marqueur dans le code émis')
    assert.match(code, /createTextNode\(`\$\{\(\$\.suffixe\) \?\? ''\}`\)/, 'texte posé à la construction, null et undefined vides')
  })

  it('{if} et {key} qui ne lisent que la valeur de la branche, ou un {const} qui n\'en lit pas d\'autre : aucun effet, le choix se fait une fois, à l\'affichage de la branche', async () => {
    const code = await emis('{await $p}\n{success v}\n{const k = v.titre}\n{if v.titre}<b>{k}</b>{else}<i>x</i>{end}\n{key k}<s>{v.titre}</s>{end}\n{end}')
    assert.match(code, /const _mjs_eff = \[\];/, 'aucun effet enregistré')
  })

  it('{if} et {key} qui lisent une variable : un effet de racine gardé par la branche affichée, qui recrée la valeur de la branche et fusionne les nœuds reconstruits dans le composant', async () => {
    const code = await emis('{await $p}\n{success v}\n{if $suffixe is \'!\'}<b>{v.titre}</b>{else}<i>x</i>{end}\n{key $suffixe}<s>{v.titre}</s>{end}\n{end}')
    assert.equal(code.split('this._mjs_updItemIf(').length - 1, 4, 'chaque bloc : une fois à la construction de la branche, une fois par son effet')
    assert.match(code, /const __nodes = this\._mjs_nodes;/, 'les nœuds reconstruits rejoignent ceux du composant')
    assert.match(code, /if \(_mjs_ifStart && _mjs_ifEnd && _mjsThis\._mjs_awaitLastRender\?\.get\('await\d+'\) === 'success'\)/, 'effet du {if} gardé par la branche affichée')
    assert.match(code, /_mjsThis\._mjs_awaitStates\?\.get\('await\d+'\)\?\.data/, 'valeur de la branche recréée')
  })

  it('l\'attente et une branche sans nom : la liaison qui lit une variable est gardée par la branche affichée, comme celle d\'une branche nommée', async () => {
    const code = await emis('{await $p}\n<b title={$suffixe}>a</b>\n{success}\n<b title={$suffixe}>b</b>\n{end}')
    assert.match(code, /this\._mjs_nodes\.a\d+; if\(_mjs_node && _mjsThis\._mjs_awaitLastRender\?\.get\('await\d+'\) === 'pending'\)/, 'attente gardée')
    assert.match(code, /this\._mjs_nodes\.a\d+; if\(_mjs_node && _mjsThis\._mjs_awaitLastRender\?\.get\('await\d+'\) === 'success'\)/, 'branche sans nom gardée')
  })
})

// ----- la reprise d'une page rendue par le serveur : la branche `{success}` écrite par le serveur, la promesse du navigateur pas encore réglée
const SOURCES_SSR: Record<string, string> = {
  'tv-ssr.mjs': `<script>
  $suffixe = '!'
  $ton     = 'clair'
  $brut    = '<i>a</i>'
  $p       = Promise.resolve({ titre: 'T' })
  fin      = null

  @suffixer = (s) -> $suffixe = s
  @teinter  = (t) -> $ton = t
  @griffer  = (h) -> $brut = h
  @attendre = -> $p = new Promise((res) -> fin = res)
  @finir    = -> fin({ titre: 'U' })
</script>
{await $p}
  <i class="att" title={$suffixe}>attente{$suffixe}</i>
{success v}
  <b class="dans" title={v.titre + $suffixe} data-t="x {$ton}">{v.titre + $suffixe}</b><s class="brut">{{$brut}}</s><@c-carte class="enf" item={v.titre + $suffixe}></@c-carte>
{end}
<u class="temoin">témoin</u>
`,
  // un `{if}` / `{elsif}` / `{else}` et un `{key}` dans la branche que le serveur a écrite : après la reprise ils suivent leur variable
  'tv-ssr-bloc.mjs': `<script>
  $mode = 'a'
  $cle  = 1
  $p    = Promise.resolve({ n: 10 })
  fin   = null

  @regler   = (m) -> $mode = m
  @cler     = (k) -> $cle = k
  @attendre = -> $p = new Promise((res) -> fin = res)
  @finir    = -> fin({ n: 20 })
</script>
{await $p}
  <i class="att">attente {$mode}</i>
{success v}
  {if $mode is 'a'}<b class="si">A{v.n}</b>{elsif $mode is 'b'}<b class="si">B{v.n}</b>{else}<b class="si">C</b>{end}
  {key $cle}<s class="cle">k{$cle}</s>{end}
{end}
<u class="temoin">témoin</u>
`,
  'c-carte.mjs': SOURCES['c-carte.mjs']
}
const BALISES_SSR = ['mjs-tv-ssr', 'mjs-tv-ssr-bloc']

let construitSsr: Promise<Cible> | null = null
const cibleSsr = (): Promise<Cible> => (construitSsr ??= construire('ssr', SOURCES_SSR, BALISES_SSR))

describe('le contenu d\'une branche {await} suit ses variables : rendu serveur puis reprise (Chromium réel)', function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test de la reprise des branches de {await} sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const variante of VARIANTES.ssr) {
    it(`reprise « ${variante} » : texte, attribut, chaîne, HTML brut et prop de {success} gardés puis suivis, le composant reste vivant`, async function () {
      if (!present) { this.skip(); return }
      const B       = 'mjs-tv-ssr'
      const c       = await cibleSsr()
      const ecarts  = [] as string[]
      const serveur = c.document(B, variante)
      const debut = serveur.indexOf('class="dans"')
      assert.match(serveur, /<b class="dans"[^>]*>(?:<!--[^>]*-->)*T!/, `le HTML du serveur porte la branche {success} (le repère du texte, en reprise « markers », précède sa valeur) : ${serveur.slice(Math.max(0, debut - 60), debut + 300)}`)
      const o = await charger(browser, c, B, variante)
      try {
        // un composant tombé à la reprise n'atteint jamais cet état : l'attente cède au bout de cinq secondes et la lecture montre ce qui reste
        await o.page.waitForFunction(`(() => { const h = document.querySelector('${B}'); return !!h && h._mjs_is_mounted === true && !!h._shadow && !!h._shadow.querySelector('.temoin') })()`, null, { timeout: 5000 }).catch(() => {})
        await o.page.waitForTimeout(300)
        const VU = 'n._shadow.querySelector(\'.vu\').textContent'
        await suivre(o.page, B, [
          ['après la reprise',      null,                                [['.dans', TXT, 'T!'], ['.dans', 'n.getAttribute(\'title\')', 'T!'], ['.dans', 'n.getAttribute(\'data-t\')', 'x clair'], ['.brut', 'n.firstElementChild.innerHTML', '<i>a</i>'], ['mjs-c-carte.enf', VU, 'T!']]],
          ['$suffixe = ?',          'suffixer(\'?\')',                   [['.dans', TXT, 'T?'], ['.dans', 'n.getAttribute(\'title\')', 'T?'], ['mjs-c-carte.enf', VU, 'T?']]],
          ['$ton = sombre',         'teinter(\'sombre\')',               [['.dans', 'n.getAttribute(\'data-t\')', 'x sombre']]],
          ['HTML brut changé',      'griffer(\'<b>x</b>\')',             [['.brut', 'n.firstElementChild.innerHTML', '<b>x</b>']]],
          ['promesse remplacée',    'attendre()',                        [['.dans', TXT, ABS], ['.att', TXT, 'attente?'], ['.att', 'n.getAttribute(\'title\')', '?']]],
          ['$suffixe = #',          'suffixer(\'#\')',                   [['.att', TXT, 'attente#'], ['.att', 'n.getAttribute(\'title\')', '#'], ['.dans', TXT, ABS]]],
          ['réglée',                'finir()',                           [['.dans', TXT, 'U#'], ['.dans', 'n.getAttribute(\'title\')', 'U#'], ['.att', TXT, ABS], ['mjs-c-carte.enf', VU, 'U#']]]
        ], ecarts)
        for (const g of graves(o)) ecarts.push(`la page a dit : ${g}`)
        assert.deepEqual(ecarts, [])
      } finally {
        await o.fermer()
      }
    })

    it(`reprise « ${variante} » : {if} / {elsif} / {else} et {key} de {success} suivent leur variable après la reprise, la promesse remplacée puis réglée les refait`, async function () {
      if (!present) { this.skip(); return }
      const B       = 'mjs-tv-ssr-bloc'
      const c       = await cibleSsr()
      const ecarts  = [] as string[]
      const serveur = c.document(B, variante)
      const debut   = serveur.indexOf('class="si"')
      assert.match(serveur, /<b class="si"[^>]*>(?:<!--[^>]*-->)*A10/, `le HTML du serveur porte le contenu du {if} de la branche {success} : ${serveur.slice(Math.max(0, debut - 60), debut + 300)}`)
      const o = await charger(browser, c, B, variante)
      try {
        await o.page.waitForFunction(`(() => { const h = document.querySelector('${B}'); return !!h && h._mjs_is_mounted === true && !!h._shadow && !!h._shadow.querySelector('.temoin') })()`, null, { timeout: 5000 }).catch(() => {})
        await o.page.waitForTimeout(300)
        await suivre(o.page, B, [
          ['après la reprise',      null,                   [['.si', TXT, 'A10'], ['.cle', TXT, 'k1']]],
          ['$mode = b',             'regler(\'b\')',        [['.si', TXT, 'B10']]],
          ['clé changée',           'cler(2)',              [['.cle', TXT, 'k2']]],
          ['$mode = z',             'regler(\'z\')',        [['.si', TXT, 'C']]],
          ['promesse remplacée',    'attendre()',           [['.si', TXT, ABS], ['.cle', TXT, ABS], ['.att', TXT, 'attente z']]],
          ['attente, $mode = a',    'regler(\'a\')',        [['.att', TXT, 'attente a']]],
          ['réglée',                'finir()',              [['.att', TXT, ABS], ['.si', TXT, 'A20'], ['.cle', TXT, 'k2']]],
          ['$mode = b',             'regler(\'b\')',        [['.si', TXT, 'B20']]]
        ], ecarts)
        for (const g of graves(o)) ecarts.push(`la page a dit : ${g}`)
        assert.deepEqual(ecarts, [])
      } finally {
        await o.fermer()
      }
    })
  }
})
