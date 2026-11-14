// l'appli de production qui écrit des attributs calculés, une valeur de <select>, un champ, une case, une adresse, un texte de la racine,
// un attribut de ligne et une prop d'enfant garde leurs aides et les met à jour ; l'appli qui n'en écrit aucun (une liste de textes,
// une classe basculée, comme l'appli du banc) n'emporte plus ces aides (le filtre des attributs à risque, seul à écrire `srcdoc`, n'est
// plus dans son paquet) et marche de même. Production en un seul fichier, Chromium, Firefox et WebKit réels

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const AVEC: Record<string, string> = {
  'ac-avec.mjs': `<script>
  $t = 'a'
  $c = 'x'
  $s = 'b'
  $v = 'v1'
  $k = true
  $u = '/ok'
  $a = 1
  $l = [{ id: 1, n: 'a' }]

  @poser = ->
    $t = 'b'
    $c = 'y'
    $s = 'a'
    $v = 'v2'
    $k = false
    $u = 'javascript:alert(1)'
    $a = 2
    $l = [{ id: 2, n: 'z' }]
</script>
<p class="t" title={$t}>x</p>
<p class={$c}>c</p>
<select class="s" value={$s} aria-label="s"><option value="a">a</option><option value="b">b</option></select>
<input class="v" value={$v} aria-label="v">
<input class="k" type="checkbox" checked={$k} aria-label="k">
<a class="u" href={$u}>u</a>
<p class="a">{$a}</p>
<ul class="l">{for x in $l by id}<li title={x.n}>{x.n}</li>{end}</ul>
<mjs-ac-enfant val={$v}></mjs-ac-enfant>
<p class="pret">prêt</p>
`,
  'ac-enfant.mjs': `<script>
  $val = 'rien'
</script>
<p class="vu">{$val}</p>
`
}

const SANS: Record<string, string> = {
  'ac-sans.mjs': `<script>
  $l   = [{ id: 1, n: 'a' }, { id: 2, n: 'b' }]
  $sel = -1

  @poser   = (l) -> $l = l
  @choisir = (id) -> $sel = id
</script>
<ul class="l">{for x in $l by id}<li :class{$sel === x.id}="danger" title="t">{x.n}</li>{end}</ul>
<p class="pret">prêt</p>
`
}

const cibles = new Map<string, Promise<Cible>>()
const cible  = (nom: string, sources: Record<string, string>, balises: string[]) => {
  if (!cibles.has(nom)) cibles.set(nom, construire('bundle', sources, balises))
  return cibles.get(nom) as Promise<Cible>
}

// tout le JavaScript que la production a écrit
const paquet = (c: Cible): string => readdirSync(join(c.racine, 'out')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(c.racine, 'out', f), 'utf-8')).join('\n')

const pret = async (page: any, balise: string) => {
  await page.waitForFunction(`!!document.querySelector('${balise}')?._shadow?.querySelector('.pret')`, null, { timeout: 10000 })
  await page.waitForTimeout(100)
}

const regler = async (page: any, balise: string, appel: string) => {
  await page.evaluate(`(() => { document.querySelector('${balise}').${appel}; return null })()`)
  await page.waitForTimeout(150)
}

// ce que montre l'ombre du composant : attributs, valeurs et textes lus d'un coup
const lireAvec = (page: any): Promise<Record<string, unknown>> => page.evaluate(`(() => {
  const r = document.querySelector('mjs-ac-avec')._shadow
  const e = r.querySelector('mjs-ac-enfant')
  return {
    titre: r.querySelector('p.t').getAttribute('title'),
    classe: r.querySelectorAll('p')[1].getAttribute('class'),
    choix: r.querySelector('select.s').value,
    champ: r.querySelector('input.v').value,
    coche: r.querySelector('input.k').checked,
    adresse: r.querySelector('a.u').getAttribute('href'),
    texte: r.querySelector('p.a').textContent,
    lignes: Array.from(r.querySelectorAll('ul.l li')).map((n) => n.textContent + ':' + n.getAttribute('title')).join(','),
    enfant: e && e._shadow && e._shadow.querySelector('.vu') ? e._shadow.querySelector('.vu').textContent : null
  }
})()`)

const lignesSans = (page: any): Promise<string> => page.evaluate(`Array.from(document.querySelector('mjs-ac-sans')._shadow.querySelectorAll('ul.l li')).map((n) => n.textContent + (n.classList.contains('danger') ? '*' : '')).join(',')`)

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`aides jamais appelées hors du paquet de production (${moteur} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[moteur].executablePath())
    if (!present) { console.log(`  ℹ️  ${moteur} non installé, test des aides jamais appelées sauté. Activer : \`npx playwright install ${moteur}\``); return }
    browser = await playwright[moteur].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('l\'appli qui écrit des attributs calculés garde leurs aides et les met à jour, l\'adresse à risque refusée', async function () {
    if (!present) { this.skip(); return }
    const c = await cible('avec', AVEC, ['mjs-ac-avec'])
    assert.ok(paquet(c).includes('srcdoc'), 'le filtre des attributs à risque manque au paquet de l\'appli qui écrit des attributs calculés')
    const o = await charger(browser, c, 'mjs-ac-avec')
    try {
      await pret(o.page, 'mjs-ac-avec')
      assert.deepEqual(await lireAvec(o.page), { titre: 'a', classe: 'x', choix: 'b', champ: 'v1', coche: true, adresse: '/ok', texte: '1', lignes: 'a:a', enfant: 'v1' }, 'premier rendu')
      await regler(o.page, 'mjs-ac-avec', 'poser()')
      assert.deepEqual(await lireAvec(o.page), { titre: 'b', classe: 'y', choix: 'a', champ: 'v2', coche: false, adresse: '/ok', texte: '2', lignes: 'z:z', enfant: 'v2' }, 'après la mise à jour (l\'adresse `javascript:` refusée, la précédente reste)')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })

  it('l\'appli qui n\'écrit aucun attribut calculé n\'emporte plus leurs aides et marche de même', async function () {
    if (!present) { this.skip(); return }
    const c = await cible('sans', SANS, ['mjs-ac-sans'])
    assert.ok(!paquet(c).includes('srcdoc'), 'le filtre des attributs à risque est encore dans le paquet d\'une appli qui ne s\'en sert pas')
    const o = await charger(browser, c, 'mjs-ac-sans')
    try {
      await pret(o.page, 'mjs-ac-sans')
      assert.equal(await lignesSans(o.page), 'a,b', 'premier rendu')
      await regler(o.page, 'mjs-ac-sans', 'choisir(2)')
      assert.equal(await lignesSans(o.page), 'a,b*', 'la classe basculée')
      await regler(o.page, 'mjs-ac-sans', 'poser([{ id: 3, n: \'c\' }, { id: 2, n: \'b\' }, { id: 1, n: \'a\' }])')
      assert.equal(await lignesSans(o.page), 'c,b*,a', 'lignes ajoutées et déplacées')
      await regler(o.page, 'mjs-ac-sans', 'poser([])')
      assert.equal(await lignesSans(o.page), '', 'la liste se vide')
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally {
      await o.fermer()
    }
  })
})
