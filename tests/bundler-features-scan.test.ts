// scanCompiledFeatures() (src/bundler/features.ts) — remplace le balayage textuel
// scanRuntimeFeatures() : chaque clé est désormais lue dans le CODE COMPILÉ (sortie NON
// minifiée de transpile()), jamais dans le texte source. Une fixture par clé, compilée
// directement via transpile() (pas de Bundler complet ici — la preuve boîte-noire sur le
// vrai mjs_core-*.js émis vit dans tests/bundler-core-after-components.test.ts).
//
// Chaque marqueur a été PROUVÉ empiriquement (sonde transpile() directe) avant d'écrire
// features.ts, pas déduit du seul texte du générateur — un cas a corrigé la conception :
// la balise `<@failed>` compile en `this._mjs_fallback = (err, reset) => {`, jamais
// `_mjs_hook('failed'` (réservé à la rune nue `µfailed (err, reset)->`).

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { scanCompiledFeatures, SCAN_KEYS, FX_KEYS } from '../src/bundler/features.js'
import { DETECTED_CORE_MODULES } from '../src/bundler/config.js'
import { mjsTmp } from './helpers/tmp.js'

async function scanOf(src: string, moduleName: string, baseDir?: string): Promise<Set<string>> {
  const { output, data } = await transpile(src, { moduleName, baseDir })
  return scanCompiledFeatures(output, data)
}

// état commun des fixtures d'interpolation brute `{{…}}`
const RAW_STATE = "<script>\n$h = '<b>x</b>'\n$ok = true\n$k = 1\n$items = [1, 2]\n$p = Promise.resolve('<i>r</i>')\n</script>\n"

describe('scanCompiledFeatures() — un marqueur COMPILÉ par clé, jamais un motif source', function () {
  this.timeout(30000)

  it('{for x in xs} : "for" présent', async () => {
    const used = await scanOf('<script lang="coffee">\n@xs = [1,2,3]\n</script>\n{for x in @xs}<p>{x}</p>{end}\n', 'f1')
    assert.ok(used.has('for'))
  })

  it('{if} racine : "if" présent', async () => {
    const used = await scanOf('<script lang="coffee">\n@ok = true\n</script>\n{if @ok}<p>y</p>{end}\n', 'f2')
    assert.ok(used.has('if'))
  })

  it('{if} imbriqué dans {for} SANS aucun {if} racine : "if" quand même présent (compile en _mjs_updItemIf, pas _mjs_updIf)', async () => {
    const used = await scanOf('<script lang="coffee">\n@xs = [1,2,3]\n</script>\n{for x in @xs}{if x > 1}<p>{x}</p>{end}{end}\n', 'f3')
    assert.ok(used.has('if'), '{if} niché doit être vu même sans marqueur _mjs_updIf littéral')
  })

  it('{key} racine : "key" présent', async () => {
    const used = await scanOf('<script lang="coffee">\n@k = 1\n</script>\n{key @k}<p>y</p>{end}\n', 'f4')
    assert.ok(used.has('key'))
  })

  it('{await} : "await" présent', async () => {
    const used = await scanOf('<script>$p = Promise.resolve(1)</script>\n{await $p}chargement{success v}{v}{end}\n', 'f5')
    assert.ok(used.has('await'))
  })

  it('@transition=*fade sur un {if} : "destroy_hooks" présent', async () => {
    const used = await scanOf('<script lang="coffee">\n@ok = true\n</script>\n<p @transition=*fade @if=!{@ok}>y</p>\n', 'f6')
    assert.ok(used.has('destroy_hooks'))
  })

  it('composant sans transition/attach/flip : "destroy_hooks" ABSENT', async () => {
    const used = await scanOf('<p>y</p>\n', 'f7')
    assert.equal(used.has('destroy_hooks'), false)
  })

  it('§foo (getContext) : "context" présent', async () => {
    const used = await scanOf('<script lang="coffee">\n@x = §foo\n</script>\n<p>{@x}</p>\n', 'f8')
    assert.ok(used.has('context'))
  })

  it('§foo = 1 (setContext) : "context" présent', async () => {
    const used = await scanOf('<script lang="coffee">\n§foo = 1\n</script>\n<p>y</p>\n', 'f9')
    assert.ok(used.has('context'))
  })

  it('§§theme en LECTURE seule dans le template (contexte RÉACTIF) : "context" présent — marqueur DISTINCT (_mjs_getRCtx, pas _mjs_getContext)', async () => {
    const used = await scanOf('<p>{§§theme}</p>\n', 'f9b')
    assert.ok(used.has('context'), '§§ (réactif) compile en _mjs_getRCtx(, raté par le premier jet du marqueur qui ne cherchait que _mjs_getContext(')
  })

  it('§§theme = x en ÉCRITURE (contexte RÉACTIF) : "context" présent (_mjs_setRCtx)', async () => {
    const used = await scanOf('<script>\n§§theme = \'sombre\'\n</script>\n<p>x</p>\n', 'f9c')
    assert.ok(used.has('context'))
  })

  it('µmount -> : "lifecycle" présent', async () => {
    const used = await scanOf('<script lang="coffee">\nµmount ->\n  1\n</script>\n<p>y</p>\n', 'f10')
    assert.ok(used.has('lifecycle'))
  })

  it('<@head> : "lifecycle" et "head" présents, "effect" forcé (co-émis par la macro)', async () => {
    const used = await scanOf('<@head><meta name="x" content="1"></@head>\n<p>y</p>\n', 'f11')
    assert.ok(used.has('head'))
    assert.ok(used.has('effect'))
  })

  it('<@body @class{@actif}="vif"/> : "body" et "effect" présents', async () => {
    const used = await scanOf(['<script lang="coffee">', '@actif = true', '</script>', '<@body @class{@actif}="vif"/>', '<p>x</p>'].join('\n'), 'f12')
    assert.ok(used.has('body'))
    assert.ok(used.has('effect'))
  })

  it('<@element $tag> : "dynamic" et "effect" présents', async () => {
    const used = await scanOf(['<script lang="coffee">', '@tag = \'div\'', '</script>', '<@element $tag>x</@element>'].join('\n'), 'f13')
    assert.ok(used.has('dynamic'))
    assert.ok(used.has('effect'))
  })

  it('µemit(...) : "emit" présent', async () => {
    const used = await scanOf('<script lang="coffee">\n@go = ->\n  µemit(\'x\', 1)\n</script>\n<p>y</p>\n', 'f14')
    assert.ok(used.has('emit'))
  })

  it('@click.emit.x : "emit" présent', async () => {
    const used = await scanOf('<p @click.emit.x>y</p>\n', 'f15')
    assert.ok(used.has('emit'))
  })

  it('µon \'evt\', sel, fn : "on" présent', async () => {
    const used = await scanOf('<script lang="coffee">\nµon \'evt\', \'p\', ->\n  1\n</script>\n<p>y</p>\n', 'f16')
    assert.ok(used.has('on'))
  })

  it('@title="x" : "title" présent', async () => {
    const used = await scanOf('<p @title="x">y</p>\n', 'f17')
    assert.ok(used.has('title'))
  })

  it('µraw/µsnap : "rare_runes" présent, sans "inspect" ni "play"', async () => {
    const formes = [
      '<script lang="coffee">\n@go = ->\n  µraw($el)\n</script>\n<p>y</p>\n',
      '<script lang="coffee">\n$x =: 1 + 1\n</script>\n<p>{$x}</p>\n',
    ]
    for (const src of formes) {
      const used = await scanOf(src, 'f18')
      assert.ok(used.has('rare_runes'), src)
      assert.equal(used.has('inspect') || used.has('play'), false, src)
    }
  })

  it('µinspect : "inspect" présent ; µplay : "play" présent — chacun seul', async () => {
    const insp = await scanOf('<script lang="coffee">\nµinspect(\'x\')\n</script>\n<p>y</p>\n', 'f18i')
    assert.ok(insp.has('inspect'))
    assert.equal(insp.has('play') || insp.has('rare_runes'), false)
    const play = await scanOf('<script lang="coffee">\n@go = ->\n  µplay($el, \'x\')\n</script>\n<p>y</p>\n', 'f18p')
    assert.ok(play.has('play'))
    assert.equal(play.has('inspect') || play.has('rare_runes'), false)
  })

  it('µ.state(…) écrit : "state" présent ; composant sans : absent', async () => {
    const avec = await scanOf('<script lang="coffee">\n@o = µ.state({a: 1})\n</script>\n<p>y</p>\n', 'f18s')
    assert.ok(avec.has('state'))
    const sans = await scanOf('<p>y</p>\n', 'f18t')
    assert.equal(sans.has('state'), false)
  })

  it('champ lié dont la saisie peut être refusée : "refuse" présent ; type fixe autre, case à cocher, sans liaison : absent', async () => {
    const entete = '<script>\n$n = 0\n$t = \'number\'\n</script>\n'
    const cas: Array<[string, boolean]> = [
      ['<input type="number" value=!{$n}>', true],
      ['<input type="number" value.number=!{$n}>', true],
      ['<input type={$t} value=!{$n}>', true],
      ['<input type="text" value=!{$n}>', false],
      ['<input type="text" value.number=!{$n}>', false],
      ['<input value=!{$n}>', false],
      ['<input type="checkbox" checked=!{$n}>', false],
      ['<input type="number" value={$n}>', false],
      ['<p>y</p>', false]
    ]
    for (const [i, [gabarit, attendu]] of cas.entries()) {
      for (const templateLang of ['civet', 'js'] as const) {
        const { output, data } = await transpile(entete + gabarit + '\n', { moduleName: 'f18r' + i + templateLang, templateLang } as any)
        assert.equal(scanCompiledFeatures(output, data).has('refuse'), attendu, templateLang + ' : ' + gabarit)
      }
    }
  })

  it('composant qui reçoit du contenu glissé (une balise <slot> dans son gabarit) : "slot_events" présent, quel que soit le bloc qui la porte ; sans <slot> : absent', async () => {
    const cas: Array<[string, boolean]> = [
      ['<div @click={go()}><slot></slot></div>', true],
      ['<div @click={go()}><@slot title></@slot></div>', true],
      ['<script>$o = true</script>\n{if $o}<div @click={go()}><slot></slot></div>{end}', true],
      ['<script>$xs = [1]</script>\n{for x in $xs}<li @click={go()}><slot name="a"></slot>{x}</li>{end}', true],
      ['<script>$p = Promise.resolve(1)</script>\n{await $p}..{success v}<div @click={go()}><slot></slot></div>{end}', true],
      ['<script>$k = 1</script>\n{key $k}<div @click={go()}><slot></slot></div>{end}', true],
      ['<script>\nµmount ->\n  @_shadow.appendChild(document.createElement(\'slot\'))\n</script>\n<p>y</p>', true],
      ['<div @click={go()}>x</div>', false],
      ['<p slot="a">y</p>', false]
    ]
    for (const [i, [gabarit, attendu]] of cas.entries()) {
      const { output, data } = await transpile(gabarit + '\n', { moduleName: 'f18e' + i } as any)
      assert.equal(scanCompiledFeatures(output, data).has('slot_events'), attendu, gabarit)
    }
  })

  it('un gabarit qui écrit @pointerenter, @pointerleave, @mouseenter ou @mouseleave : "boundary" présent ; les autres événements (@click, @pointerover, @mouseover) : absent', async () => {
    const cas: Array<[string, boolean]> = [
      ['<div @pointerenter={go()}>x</div>', true],
      ['<div @pointerleave={go()}>x</div>', true],
      ['<div @mouseenter={go()}>x</div>', true],
      ['<script>$xs = [1]</script>\n{for x in $xs}<li @mouseleave={go()}>{x}</li>{end}', true],
      ['<div @click={go()}>x</div>', false],
      ['<div @pointerover={go()} @mouseover={go()}>x</div>', false]
    ]
    for (const [i, [gabarit, attendu]] of cas.entries()) {
      const { output, data } = await transpile(gabarit + '\n', { moduleName: 'f18s' + i } as any)
      assert.equal(scanCompiledFeatures(output, data).has('boundary'), attendu, gabarit)
    }
  })

  it('µ.elementAt(x, y) écrit : "element_at" présent ; composant sans : absent', async () => {
    const avec = await scanOf('<script lang="coffee">\n@go = (e) -> µ.elementAt(e.clientX, e.clientY)\n</script>\n<p>y</p>\n', 'f18a')
    assert.ok(avec.has('element_at'))
    const sans = await scanOf('<script lang="coffee">\n@go = (e) -> e.clientX\n</script>\n<p>y</p>\n', 'f18b')
    assert.equal(sans.has('element_at'), false)
  })

  it('µ[\'elementAt\'](x, y) ou { elementAt } = µ : "element_at" présent aussi', async () => {
    const crochets = await scanOf('<script lang="coffee">\n@go = (e) -> µ[\'elementAt\'](e.clientX, e.clientY)\n</script>\n<p>y</p>\n', 'f18c')
    assert.ok(crochets.has('element_at'))
    const extrait = await scanOf('<script lang="coffee">\n@go = (e) ->\n  { elementAt } = µ\n  elementAt(e.clientX, e.clientY)\n</script>\n<p>y</p>\n', 'f18d')
    assert.ok(extrait.has('element_at'))
  })

  it('new µStore({...}) : "store" présent', async () => {
    const used = await scanOf('<script lang="coffee">\n@box = new µStore({a: 1})\n</script>\n<p>{@box.data.a}</p>\n', 'f19')
    assert.ok(used.has('store'))
  })

  it('µinterpolate(0, 400) : "interpolate" présent', async () => {
    const used = await scanOf('<script lang="coffee">\n$p = µinterpolate(0, 400)\n</script>\n<p>{$p}</p>\n', 'f20')
    assert.ok(used.has('interpolate'))
  })

  it('new µTicker() : "ticker" présent', async () => {
    const used = await scanOf('<script lang="coffee">\n@t = new µTicker()\n</script>\n<p>y</p>\n', 'f21')
    assert.ok(used.has('ticker'))
  })

  it('µevery 1000, -> : "every" présent, "effect" ABSENT (aucun émetteur indirect)', async () => {
    const used = await scanOf('<script lang="coffee">\n@x = 1\nµevery 1000, -> @x++\n</script>\n<p>{$x}</p>\n', 'f22')
    assert.ok(used.has('every'))
    assert.equal(used.has('effect'), false)
  })

  it('une CHAÎNE littérale \'µ.Store\' dans le script (jamais un usage réel) : "store" ABSENT — faux positif texte corrigé', async () => {
    const used = await scanOf('<script lang="coffee">\n@doc = \'µ.Store\'\n</script>\n<p>{@doc}</p>\n', 'f23b')
    assert.equal(used.has('store'), false, 'une chaîne qui MENTIONNE µ.Store ne doit plus embarquer mjs_store.ts')
  })

  it('un commentaire HTML <!-- {for x in xs} --> (jamais un vrai bloc) : "for" ABSENT — faux positif texte corrigé', async () => {
    const used = await scanOf('<!-- {for x in xs} -->\n<p>y</p>\n', 'f23c')
    assert.equal(used.has('for'), false, 'un commentaire qui MENTIONNE {for} ne doit plus embarquer mjs_for.ts')
  })

  it('<@failed err reset>...</@failed> (balise) : "failed" présent', async () => {
    const used = await scanOf(['<p>{1/0}</p>', '<@failed err reset>', '<p>Erreur : {err.message}</p>', '</@failed>'].join('\n'), 'f23')
    assert.ok(used.has('failed'))
  })

  it('µfailed (err, reset)-> (rune nue) : "failed" présent', async () => {
    const used = await scanOf('<script lang="coffee">\nµfailed (err, reset) ->\n  1\n</script>\n<p>y</p>\n', 'f24')
    assert.ok(used.has('failed'))
  })

  it('<style name="x"> (variant déclaré) : "layout_variant" présent (data.layoutCss non vide)', async () => {
    const used = await scanOf(['<style name="banner">', '  :host', '    display: flex', '</style>', '<div>x</div>'].join('\n'), 'f25')
    assert.ok(used.has('layout_variant'))
  })

  it('layout="x" en dur, SANS aucune déclaration <style name> : "layout_variant" quand même présent (texte survit dans le HTML compilé)', async () => {
    const used = await scanOf('<p layout="bandeau">x</p>\n', 'f26')
    assert.ok(used.has('layout_variant'))
  })

  it('@persist $x (jamais le mot « effect » dans le source) : "effect" présent', async () => {
    const used = await scanOf(['<script>$x = 1</script>', '@persist $x', '<p>{$x}</p>'].join('\n'), 'f27')
    assert.ok(used.has('effect'))
  })

  it('composant qui ne pose RIEN : Set vide (aucun faux positif de base)', async () => {
    const used = await scanOf('<p>x</p>\n', 'f28')
    assert.equal(used.size, 0)
  })

  it('var(--mjs-fg) écrit en dur dans un <style> : "theme" présent', async () => {
    const used = await scanOf(['<style>', ':host', '  color: var(--mjs-fg)', '</style>', '<p>x</p>'].join('\n'), 'f30')
    assert.ok(used.has('theme'))
  })

  it('$$surface lu dans un <style> : "theme" présent ($$ se réécrit en var(--mjs-surface) AVANT la compilation JS)', async () => {
    const used = await scanOf(['<style>', ':host', '  background: $$surface', '</style>', '<p>x</p>'].join('\n'), 'f31')
    assert.ok(used.has('theme'))
  })

  it("µtheme = 'dark' (rune, forme documentée <button @click={...}>) : \"theme\" présent (__mjsTheme)", async () => {
    const used = await scanOf('<button @click={µtheme = \'dark\'}>x</button>\n', 'f32')
    assert.ok(used.has('theme'))
  })

  it('$$brand (nom hors des 8 variables canoniques du framework) : "theme" ABSENT — thème de PROJET, pas le thème clair/sombre embarqué', async () => {
    const used = await scanOf(['<style>', ':host', '  color: $$brand', '</style>', '<p>x</p>'].join('\n'), 'f33')
    assert.equal(used.has('theme'), false)
  })

  it('module de script SANS data (2e argument omis) : ne lève jamais, layout_variant lu sur le texte seul', async () => {
    const { output } = await transpile('<script lang="coffee">\n@go = ->\n  µplay($el, \'x\')\n</script>\n<p>y</p>\n', { moduleName: 'f29' })
    const used = scanCompiledFeatures(output)
    assert.ok(used.has('play'))
  })

  it('SCAN_KEYS liste exactement les 21 clés historiques + "theme" + "html" + "slots" + "deep"/"textpool"/"esc"/"for_nested"/"alias" + "types" + "fx" + "lang" + "state" + "inspect" + "play" + "refuse" + "slot_events" + "element_at" + "boundary" + "adopt_sheet" + "form_reset" + "form_associated" + "clone" + "chart"', () => {
    const attendues = ['title', 'store', 'interpolate', 'ticker', 'head', 'body', 'dynamic', 'failed', 'rare_runes', 'on', 'effect', 'every', 'for', 'if', 'key', 'await', 'emit', 'context', 'lifecycle', 'layout_variant', 'destroy_hooks', 'theme', 'html', 'slots', 'deep', 'textpool', 'esc', 'for_nested', 'alias', 'types', 'fx', 'lang', 'state', 'inspect', 'play', 'refuse', 'slot_events', 'element_at', 'boundary', 'adopt_sheet', 'form_reset', 'form_associated', 'clone', 'chart']
    assert.deepEqual([...SCAN_KEYS].sort(), [...attendues].sort())
  })

  it('composant porteur d\'un alias court : "alias" présent', async () => {
    const { output, data } = await transpile('<script>$x=1</script><p>{$x}</p>', { moduleName: 'doc-carte', aliasTag: 'mjs-carte' })
    assert.ok(scanCompiledFeatures(output, data).has('alias'))
  })

  it('module de saisie du cœur (appel de la remise à zéro du formulaire dans son montage) : "form_reset" présent ; sans cet appel : absent', async () => {
    const avec = await transpile('<script>\n$x = 1\nµmount ->\n  µ._mjs_formReset(@, (-> $x), (v)-> $x = v)\n</script>\n<p>{$x}</p>')
    assert.ok(scanCompiledFeatures(avec.output, avec.data).has('form_reset'))
    const sans = await transpile('<script>$x=1\nµmount ->\n  $x = 2\n</script><p>{$x}</p>')
    assert.equal(scanCompiledFeatures(sans.output, sans.data).has('form_reset'), false)
  })

  it('composant déclaré `@formAssociated` (le socle du formulaire, appelé avant l\'enregistrement de sa balise) : "form_associated" présent ; sans la directive : absent', async () => {
    const avec = await transpile('@formAssociated\n<script>\n$x = 1\n</script>\n<p>{$x}</p>')
    assert.ok(scanCompiledFeatures(avec.output, avec.data).has('form_associated'))
    const sans = await transpile('<script>\n$x = 1\n</script>\n<p>{$x}</p>')
    assert.equal(scanCompiledFeatures(sans.output, sans.data).has('form_associated'), false)
  })

  it('composant avec un <vars> : "types" présent — règles des variables ou des stores', async () => {
    assert.ok((await scanOf('<vars>\n$x int 0..9\n</vars>\n<script>$x=1</script><p>{$x}</p>', 'typee')).has('types'))
    assert.ok((await scanOf('<vars>\n$$x int 0..9\n</vars>\n<p>{$$x}</p>', 'typee-store')).has('types'))
    assert.equal((await scanOf('<script>$x=1</script><p>{$x}</p>', 'non-typee')).has('types'), false)
  })

  it('composant avec un effet : "fx" et la clé de CET effet seulement ("fx_neon"), jamais les autres', async () => {
    const used = await scanOf('<h1 *neon(#f0f)>x</h1>\n{if 1}<p *float>y</p>{end}', 'effets')
    assert.ok(used.has('fx'))
    assert.ok(used.has('fx_neon'))
    assert.ok(used.has('fx_float'))
    assert.equal(used.has('fx_glitch'), false)
    assert.equal(used.has('fx_transition'), false)
    assert.equal((await scanOf('<p>*neon</p>', 'texte-etoile')).has('fx'), false, 'un « *neon » dans le texte n\'est pas un effet')
  })

  it('une transition, posée ou sur le cycle de vie : "fx" et "fx_transition", une seule clé pour toutes ; un effet joué à l\'entrée : sa clé à lui', async () => {
    const pose = await scanOf('<p *fade(on: view)>x</p>', 'transition-posee')
    assert.ok(pose.has('fx') && pose.has('fx_transition'))
    assert.equal(pose.has('fx_fade'), false)
    const vie = await scanOf('<script>\n$v = true\n</script>\n{if $v}<p @in=*fly @out=*scramble>x</p>{end}', 'transition-vie')
    assert.ok(vie.has('fx') && vie.has('fx_transition') && vie.has('fx_scramble'))
  })

  it('chaque effet du catalogue est un module détecté (liste de config.ts) : un oubli n\'y tombe jamais en silence', () => {
    assert.ok(FX_KEYS.length >= 5)
    for (const k of ['fx', ...FX_KEYS]) assert.ok((DETECTED_CORE_MODULES as readonly string[]).includes(k), `${k} absent de DETECTED_CORE_MODULES`)
  })

  it('composant SANS alias court : "alias" absent — aucun appel émis', async () => {
    const used = await scanOf('<script>$x=1</script><p>{$x}</p>', 'carte')
    assert.equal(used.has('alias'), false)
  })

  it('<@slot> (défaut, nommé, indexé dans {for}) : "slots" présent', async () => {
    const formes = [
      '<div><@slot/></div>\n',
      '<header><@slot titre/></header>\n',
      '<script>\n$items = [1, 2]\n</script>\n<div>{for i, t in $items}<@slot {i}/>{end}</div>\n'
    ]
    for (const src of formes) {
      const used = await scanOf(src, 'f38')
      assert.ok(used.has('slots'), src)
    }
  })

  it('<@slot> apporté par un partiel <@include> : "slots" présent', async () => {
    const dir = mjsTmp('scan-slots-include')
    writeFileSync(join(dir, '_fente.mjs'), '<div><@slot/></div>\n')
    const used = await scanOf('<@include fente>\n', 'f39', dir)
    assert.ok(used.has('slots'))
  })

  it('sans <@slot> (un <slot> natif écrit à la main compris) : "slots" absent', async () => {
    for (const src of ['<p>x</p>\n', '<div><slot></slot></div>\n']) {
      const used = await scanOf(src, 'f40')
      assert.equal(used.has('slots'), false, src)
    }
  })

  // interpolation brute `{{…}}` : la méthode `_mjs_updHtml` n'est appelée QUE par le code émis au
  // niveau du composant (effet `this._mjs_updHtml('tN', …)`) — racine, {if}/{else}, {key}, contenu
  // de <@slot>, contenu passé à un enfant, partiel <@include>. Dans un {for}, la ligne écrit
  // `innerHTML` elle-même ; dans un {await}, la branche construit son nœud elle-même : aucune
  // des deux formes n'a besoin de la méthode.
  it('{{…}} à la racine, dans {if}/{else}, {key}, <@slot>, le contenu d\'un enfant : "html" présent', async () => {
    const formes = [
      RAW_STATE + '<p>{{$h}}</p>\n',
      RAW_STATE + '{if $ok}<p>{{$h}}</p>{end}\n',
      RAW_STATE + '{if not $ok}<p>n</p>{else}<p>{{$h}}</p>{end}\n',
      RAW_STATE + '{key $k}<p>{{$h}}</p>{end}\n',
      RAW_STATE + '<div><@slot>{{$h}}</@slot></div>\n',
      RAW_STATE + '<@carte>{{$h}}</@carte>\n'
    ]
    for (const src of formes) {
      const used = await scanOf(src, 'f34')
      assert.ok(used.has('html'), src)
    }
  })

  it('{{…}} apporté par un partiel <@include> : "html" présent', async () => {
    const dir = mjsTmp('scan-html-include')
    writeFileSync(join(dir, '_bloc.mjs'), '<div>{{$h}}</div>\n')
    const used = await scanOf(RAW_STATE + '<@include bloc>\n', 'f35', dir)
    assert.ok(used.has('html'))
  })

  it('{{…}} SEULEMENT dans {for} ou {await} (écriture en ligne, nœud construit par la branche) : "html" absent — aucun appel émis', async () => {
    const formes = [
      RAW_STATE + '{for it in $items}<p>{{$h}}</p>{end}\n',
      RAW_STATE + '{for it in $items}{if $ok}<p>{{it}}</p>{end}{end}\n',
      RAW_STATE + '{await $p}<p>{{$h}}</p>{success v}<p>{{v}}</p>{error err}<p>{{err.message}}</p>{end}\n'
    ]
    for (const src of formes) {
      const { output } = await transpile(src, { moduleName: 'f36' })
      assert.equal(/\._mjs_updHtml\(/.test(output), false, src)
      assert.equal(scanCompiledFeatures(output).has('html'), false, src)
    }
  })

  it('composant sans {{…}} : "html" absent', async () => {
    const used = await scanOf(RAW_STATE + '<p>{$h}</p>\n', 'f37')
    assert.equal(used.has('html'), false)
  })

})
