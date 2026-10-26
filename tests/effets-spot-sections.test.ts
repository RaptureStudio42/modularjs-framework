// Les étiquettes `// @@` de mjs_fx_spotlight.ts, une par une : ce que commandent les réglages neufs de `*spotlight` (`where: veil` : le voile percé ;
// `smooth` : le retard du suivi ; le mot d'un mode écrit à la place d'une couleur : l'avertissement) ne part dans une application de production que si
// une page les écrit, de même que le code propre à deux valeurs que la V3 connaissait (`on: always` : le retour de la lumière au centre ; `where: fill` : la règle
// d'un halo seul sans animation Web) et la variable du bord (`soft`, qui n'a de sens qu'avec le voile mais que le cœur pose aussi sur la balise). Une application qui écrit
// `*spotlight` avec les autres réglages de la V3 (`color`, `where` à `both` ou `border`, `size`, `fill`, `width`, `on` à `hover`, `radius`) reçoit le halo et le liseré, et rien
// du voile ni du retard, ni les outils du cœur qu'ils appellent.
//
// Trois gardes sur des builds réels de production (une page par réglage, code lisible) : les jetons des étiquettes du fichier sont exactement ceux
// des pages ; chaque section marquée porte au moins un témoin ; chaque témoin est embarqué par ses pages et par elles seules. Puis les outils du cœur
// (aucun ne part sans servir), et le fichier seul sur TOUTES les combinaisons des réglages neufs : du JavaScript valide, sans variable inconnue (une
// section qui réclame ce qu'une autre ne déclare pas) ni variable déclarée et jamais lue (un reste qu'aucun réglage n'utilise plus).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as acorn from 'acorn'
import { Linter } from 'eslint'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { FX_TOOL_KEYS } from '../src/bundler/fx-tools.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'
import { selectFxSections } from '../src/bundler/fx-sections.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const compte = (texte: string, motif: string) => texte.split(motif).length - 1

// la grammaire des marques, la même que celle du filtre (bundler/fx-sections.ts)
const LABEL = '[A-Za-z0-9 ._=,*-]+'
const BLOC  = new RegExp('^\\s*// @@(?: (' + LABEL + '))?\\s*$')
const FIN   = new RegExp('^(.*\\S)\\s+// @@ (' + LABEL + ')$')

type Unite = { jetons: string[], propres: string[], ligne: number }

// les sections marquées du fichier : leurs jetons et leurs lignes propres (sans celles des sections emboîtées)
function unites(src: string): Unite[] {
  const sortie: Unite[] = []
  const pile: Unite[]   = []
  src.split('\n').forEach((texte, i) => {
    const b = BLOC.exec(texte)
    if (b) {
      if (b[1]) {
        const u = { jetons: b[1].split(' '), propres: [], ligne: i + 1 }
        pile.push(u)
        sortie.push(u)
      }
      else pile.pop()
      return
    }
    const l = FIN.exec(texte)
    if (l) sortie.push({ jetons: l[2].split(' '), propres: [l[1]], ligne: i + 1 })
    else if (pile.length > 0) pile[pile.length - 1].propres.push(texte)
  })
  return sortie
}

type Sortie = { tout: string, spot: string, coeur: string }
type Page   = { balise: string, jetons: string[], outils: string[] }
type Temoin = { texte: string, pages: string[], n?: Record<string, number> }

const REF = 'rien'

// les jetons que le fichier porte, et les outils du cœur (ordre de la table) que le fichier trié appelle encore
const VOILE  = 'where=veil'
const RETARD = 'smooth'
const MOT    = 'color=both,fill,border,veil'
const BORD   = 'soft'
const TOUJOURS = 'on=always'
const REMPLIR  = 'where=fill'
const RETARD_VAR = 'smooth=*'
const RAYON_VAR  = 'radius=*'
const ORIGINE = 'origin'
const PORTEE  = 'glow'
const ECLAT   = 'every'
const ECLAT_VAR = 'every=*'
const BASE   = ['fx_toolbox']
const VEIL   = ['fx_toolroots', 'fx_toolbox', 'fx_toolwatch']
const SMOOTH = ['fx_toolbox', 'fx_toollag', 'fx_toolsmooth']
const TOUT   = ['fx_toolroots', 'fx_toolbox', 'fx_toolwatch', 'fx_toollag', 'fx_toolsmooth']

// chaque page n'écrit que ce qu'elle nomme ; `soft` écrit sans le voile ne fait partir que sa variable
const PAGES: Record<string, Page> = {
  [REF]:          { balise: '*spotlight', jetons: [], outils: BASE },
  v3:             { balise: '*spotlight(color: #0ff, where: border, size: 240, fill: .4, width: 3, on: always)', jetons: [TOUJOURS], outils: BASE },
  v3couleur:      { balise: '*spotlight(#0ff)', jetons: [], outils: BASE },
  v3halo:         { balise: '*spotlight(where: fill, fill: .5, size: 300, radius: 12)', jetons: [REMPLIR], outils: BASE },
  v3deux:         { balise: '*spotlight(where: both, on: hover)', jetons: [], outils: BASE },
  voile:          { balise: '*spotlight(where: veil)', jetons: [VOILE], outils: VEIL },
  voilesoft:      { balise: '*spotlight(where: veil, soft: 80)', jetons: [VOILE, BORD], outils: VEIL },
  voiletoujours:  { balise: '*spotlight(where: veil, on: always)', jetons: [VOILE, TOUJOURS], outils: VEIL },
  retard:         { balise: '*spotlight(smooth: .15)', jetons: [RETARD], outils: SMOOTH },
  toujoursretard: { balise: '*spotlight(on: always, smooth: .15)', jetons: [RETARD, TOUJOURS], outils: SMOOTH },
  voileretard:    { balise: '*spotlight(where: veil, smooth: .15)', jetons: [VOILE, RETARD], outils: TOUT },
  soft:           { balise: '*spotlight(soft: 80)', jetons: [BORD], outils: BASE },
  softvar:        { balise: '*spotlight(soft: $f)', jetons: [BORD], outils: BASE },
  toujours:       { balise: '*spotlight(on: always)', jetons: [TOUJOURS], outils: BASE },
  toujoursvar:    { balise: '*spotlight(on: $o)', jetons: [TOUJOURS], outils: BASE },
  remplir:        { balise: '*spotlight(where: fill)', jetons: [REMPLIR], outils: BASE },
  mot:            { balise: '*spotlight(veil)', jetons: [MOT], outils: BASE },
  retardvar:      { balise: '*spotlight(smooth: $m)', jetons: [RETARD, RETARD_VAR], outils: SMOOTH },
  rayonvar:       { balise: '*spotlight(radius: $r)', jetons: [RAYON_VAR], outils: BASE },
  voilevar:       { balise: '*spotlight(where: veil, smooth: $m)', jetons: [VOILE, RETARD, RETARD_VAR], outils: TOUT },
  origine:        { balise: '*spotlight(origin: bottom-left)', jetons: [ORIGINE], outils: BASE },
  coin:           { balise: '*spotlight(origin: bottom-left, on: always)', jetons: [ORIGINE, TOUJOURS], outils: BASE },
  coineclat:      { balise: '*spotlight(origin: 20% 80%, every: 2s)', jetons: [ORIGINE, ECLAT], outils: BASE },
  portee:         { balise: '*spotlight(glow: 120)', jetons: [PORTEE], outils: BASE },
  eclat:          { balise: '*spotlight(every: 2s)', jetons: [ECLAT], outils: BASE },
  eclatvar:       { balise: '*spotlight(every: $e)', jetons: [ECLAT, ECLAT_VAR], outils: BASE },
  coineclatvar:   { balise: '*spotlight(origin: bottom-left, every: $e)', jetons: [ORIGINE, ECLAT, ECLAT_VAR], outils: BASE },
  tout:           { balise: '*spotlight(where: veil, soft: 80, smooth: .15, on: always, color: #08f, size: 200, fill: .9)', jetons: [VOILE, BORD, RETARD, TOUJOURS], outils: TOUT }
}

// les pages qui demandent le voile, le retard, l'un ou l'autre, le bord, la lumière toujours allumée, le halo seul, l'avertissement
const AVEC_VOILE  = ['voile', 'voilesoft', 'voiletoujours', 'voileretard', 'voilevar', 'tout']
const AVEC_RETARD = ['retard', 'toujoursretard', 'voileretard', 'retardvar', 'voilevar', 'tout']
const AVEC_L_UN   = ['voile', 'voilesoft', 'voiletoujours', 'retard', 'toujoursretard', 'voileretard', 'retardvar', 'voilevar', 'tout']
const AVEC_BORD   = [...AVEC_VOILE, 'soft', 'softvar']
const AVEC_TOUJOURS = ['v3', 'voiletoujours', 'toujoursretard', 'toujours', 'toujoursvar', 'coin', 'tout']
const AVEC_REMPLIR  = ['v3halo', 'remplir']
const TOUJOURS_VOILE  = ['voiletoujours', 'tout']
const TOUJOURS_RETARD = ['toujoursretard', 'tout']
// le suivi sur place (`set`) : un retard, un arrondi ou un éclat tenu par une variable
const AVEC_SUIVI  = ['retardvar', 'rayonvar', 'voilevar', 'eclatvar', 'coineclatvar']
const AVEC_RETARD_VAR = ['retardvar', 'voilevar']
const AVEC_MOT    = ['mot']
const AVEC_ORIGINE = ['origine', 'coin', 'coineclat', 'coineclatvar']
const AVEC_PORTEE  = ['portee']
const AVEC_ECLAT   = ['eclat', 'coineclat', 'eclatvar', 'coineclatvar']
const AVEC_ECLAT_VAR = ['eclatvar', 'coineclatvar']

const DEUX  = Object.fromEntries(AVEC_VOILE.map((p) => [p, 2]))
// des comptes qui dépendent des chemins que la page embarque : le chemin simple seul (ni voile ni retard), ou aussi celui du point visé
const CHEMINS = (simple: number, complet: number) => Object.fromEntries(AVEC_TOUJOURS.map((p) => [p, AVEC_L_UN.includes(p) ? complet : simple]))

// ce qui part avec chaque réglage, et avec lui seul
const TEMOINS: Temoin[] = [
  // le voile : sa feuille (les règles du calque, du disque, de l'effacement du halo), son calque et sa vie, l'écoute de l'entourage, la page entière
  { texte: '[mjs-fx-spot-where="veil"]::before',                                              pages: AVEC_VOILE },
  { texte: '[mjs-fx-layer="spotlight"]{position:absolute;inset:0;',                           pages: AVEC_VOILE },
  { texte: '[mjs-fx-layer="spotlight"][mjs-fx-veil-on]{opacity:1;',                           pages: AVEC_VOILE },
  { texte: '[mjs-fx-layer="spotlight"][mjs-fx-veil-doc]{position:fixed}',                     pages: AVEC_VOILE },
  { texte: '[mjs-fx-lamp="veil"]>span{width:calc(',                                           pages: AVEC_VOILE },
  { texte: ',[mjs-fx-layer="spotlight"],[mjs-fx-layer="spotlight"][mjs-fx-veil-on]',          pages: AVEC_VOILE },
  { texte: "s.where === 'veil'",                                                              pages: AVEC_VOILE },
  { texte: 'veil && el === document.documentElement',                                         pages: AVEC_VOILE },
  { texte: "µ._mjs_fxInner(el)",                                                              pages: AVEC_VOILE },
  { texte: "µ._mjs_fxAdopt(root, 'spotlight');",                                              pages: AVEC_VOILE },
  { texte: 'var born = function() {',                                                         pages: AVEC_VOILE },
  { texte: 'var drop = function() {',                                                         pages: AVEC_VOILE },
  { texte: "layer.setAttribute('mjs-fx-lamp', 'veil');",                                      pages: AVEC_VOILE },
  { texte: "layer.style.setProperty('--mjs-fx-veil-r',",                                      pages: AVEC_VOILE },
  { texte: 'var stale = function() {',                                                        pages: AVEC_VOILE },
  { texte: 'var watch = function() {',                                                        pages: AVEC_VOILE },
  { texte: 'seeing = µ._mjs_fxWatch(el, stale);',                                             pages: AVEC_VOILE },
  { texte: 'var unwatch = function() {',                                                      pages: AVEC_VOILE },
  { texte: "layer.firstChild.style.setProperty('translate', at);",                            pages: AVEC_VOILE },
  // le voile : les lignes isolées de la pose, du suivi et du retrait (chacune est une ligne marquée)
  { texte: 'page ? function() {} :',                                                        pages: AVEC_VOILE },
  { texte: 'halo  = rim = false;',                                                          pages: AVEC_VOILE },
  { texte: "shown = 'veil';",                                                               pages: AVEC_VOILE },
  { texte: 'var lamps',                                                                     pages: AVEC_VOILE },
  { texte: 'var seeing',                                                                    pages: AVEC_VOILE },
  { texte: 'var cx ',                                                                       pages: AVEC_VOILE },
  { texte: 'var cy ',                                                                       pages: AVEC_VOILE },
  // le centre relu avec la taille de la fenêtre (`size` et la branche « page » d'`aim`) : deux fois dans chaque page du voile
  { texte: 'cx = wd / 2;',                                                                  pages: AVEC_VOILE, n: Object.fromEntries(AVEC_VOILE.map((p) => [p, 2])) },
  { texte: 'cy = ht / 2;',                                                                  pages: AVEC_VOILE, n: Object.fromEntries(AVEC_VOILE.map((p) => [p, 2])) },
  { texte: 'wd = document.documentElement.clientWidth;',                                    pages: AVEC_VOILE },
  { texte: 'ht = document.documentElement.clientHeight;',                                   pages: AVEC_VOILE },
  { texte: 'cx    = wd / 2;',                                                               pages: AVEC_VOILE },
  { texte: 'tx = inside ? tx : cx;',                                                  pages: AVEC_VOILE },
  { texte: 'ty = inside ? ty : cy;',                                                  pages: AVEC_VOILE },
  { texte: 'cy    = ht / 2;',                                                               pages: AVEC_VOILE },
  { texte: 'if (veil) nodes = lamps;',                                                      pages: AVEC_VOILE },
  { texte: "if (veil) name = 'mjs-fx-veil-on';",                                            pages: AVEC_VOILE },
  { texte: 'if (page) node = document.documentElement;',                                    pages: AVEC_VOILE },
  { texte: 'born();',                                                                       pages: AVEC_VOILE, n: { ...Object.fromEntries(AVEC_VOILE.map((p) => [p, 1])), ...Object.fromEntries(TOUJOURS_VOILE.map((p) => [p, 2])) } },
  { texte: 'unwatch();',                                                                    pages: AVEC_VOILE, n: DEUX },
  { texte: '      watch();',                                                                pages: AVEC_VOILE },
  { texte: 'if (veil) rest();',                                                             pages: AVEC_VOILE },
  { texte: 'drop();',                                                                       pages: AVEC_VOILE },
  { texte: '? drop() : void (gone = setTimeout(drop, 400));',                               pages: AVEC_VOILE },
  { texte: 'if (veil) opts = { passive: true };',                                           pages: AVEC_VOILE },
  { texte: 'if (page) {',                                                                   pages: AVEC_VOILE },
  { texte: 'if (veil) {',                                                                   pages: AVEC_VOILE, n: { ...Object.fromEntries(AVEC_VOILE.map((p) => [p, 3])), ...Object.fromEntries(TOUJOURS_VOILE.map((p) => [p, 5])) } },
  { texte: 'if (!veil) {',                                                                  pages: AVEC_VOILE },
  { texte: 'if (veil && box) return;',                                                      pages: AVEC_VOILE },
  { texte: 'if (veil) return false;',                                                       pages: AVEC_VOILE },
  { texte: 'var fresh = veil && !lamps.length;',                                            pages: AVEC_VOILE },
  // le bord du voile : sa variable est posée par le cœur (et suivie sur place) dès que `soft` est écrit, avec ou sans le voile
  { texte: "soft: 'px'",                                                                      pages: AVEC_BORD },
  // le retard : la lecture du réglage, la boucle d'images et son arrêt, le suivi sur place
  { texte: 'var frame ',                                                                    pages: AVEC_RETARD },
  { texte: 'var last ',                                                                     pages: AVEC_RETARD },
  { texte: 'flow ? el.offsetWidth :',                                                       pages: AVEC_RETARD },
  { texte: 'flow ? el.offsetHeight :',                                                      pages: AVEC_RETARD },
  { texte: 'stop();',                                                                       pages: AVEC_RETARD, n: Object.fromEntries(AVEC_RETARD.map((p) => [p, 3])) },
  { texte: 'if (smooth < 1) return false;',                                                 pages: AVEC_RETARD },
  { texte: "if (smooth >= 1 || typeof requestAnimationFrame !== 'function') {",             pages: AVEC_RETARD },
  { texte: 'if (smooth < 1) {',                                                             pages: AVEC_RETARD },
  { texte: 'else if (gx !== tx || gy !== ty) {',                                            pages: AVEC_RETARD },
  // le chemin du voile ET du retard : les lignes isolées
  { texte: 'var box ',                                                                      pages: AVEC_L_UN },
  { texte: 'var tx ',                                                                       pages: AVEC_L_UN },
  { texte: 'var ty ',                                                                       pages: AVEC_L_UN },
  { texte: 'aim(e);',                                                                       pages: AVEC_L_UN, n: Object.fromEntries(AVEC_L_UN.map((p) => [p, 2])) },
  { texte: 'move = function(e) {',                                                          pages: AVEC_L_UN },
  { texte: 'if (plain()) {',                                                                pages: AVEC_L_UN, n: Object.fromEntries(AVEC_L_UN.map((p) => [p, 2])) },
  { texte: 'if (plain()) return trace(e);',                                                 pages: AVEC_L_UN },
  { texte: 'if (!inside) return;',                                                          pages: AVEC_L_UN },
  { texte: 'µ._mjs_fxLagSetting(s.smooth, 1)',                                                pages: AVEC_RETARD },
  { texte: 'var tick = function(now) {',                                                      pages: AVEC_RETARD },
  { texte: 'µ._mjs_fxLag(smooth, now, last)',                                                 pages: AVEC_RETARD },
  { texte: 'var stop = function() {',                                                         pages: AVEC_RETARD },
  { texte: 'frame = requestAnimationFrame(tick);',                                            pages: AVEC_RETARD, n: Object.fromEntries(AVEC_RETARD.map((p) => [p, 2])) },
  // le suivi sur place (`set`), seulement quand le retard ou l'arrondi est tenu par une variable : le retard ramené entre 0.01 et 1, l'arrondi du halo relu
  { texte: 'off.set = function(k, v) {',                                                      pages: AVEC_SUIVI },
  { texte: "if (k === 'smooth') {",                                                           pages: AVEC_RETARD_VAR },
  { texte: 'µ._mjs_fxLagSetting(v, 1)',                                                       pages: AVEC_RETARD_VAR },
  { texte: "if (k === 'radius' && halo) {",                                                   pages: ['rayonvar'] },
  { texte: "return k === 'color' || k === 'size' || k === 'fill' || k === 'width' || k === 'radius';", pages: AVEC_SUIVI },
  { texte: "if (k === 'soft') return true;",                                                  pages: ['voilevar'] },
  // le chemin du voile ET du retard : la lumière suit un point visé, relu à l'entrée de la souris
  { texte: 'var plain = function() {',                                                        pages: AVEC_L_UN },
  { texte: 'var measure = function() {',                                                      pages: AVEC_L_UN },
  { texte: 'var aim = function(e) {',                                                         pages: AVEC_L_UN },
  { texte: 'var go = function() {',                                                           pages: AVEC_L_UN },
  { texte: 'box.bl = el.clientLeft;',                                                         pages: AVEC_L_UN },
  // `on: always` : la lumière toujours allumée revient au centre à la sortie (son état, son retour, son calque de voile et l'observateur de sa taille)
  { texte: "s.on === 'always'",                                                               pages: AVEC_TOUJOURS },
  { texte: 'var home ',                                                                       pages: AVEC_TOUJOURS },
  { texte: 'if (home) {',                                                                     pages: AVEC_TOUJOURS },
  { texte: 'home   = false;',                                                                 pages: AVEC_TOUJOURS, n: CHEMINS(1, 2) },
  { texte: 'home = true;',                                                                    pages: AVEC_TOUJOURS, n: { ...CHEMINS(1, 2), toujoursretard: 3, tout: 3 } },
  { texte: 'if (always) {',                                                                   pages: AVEC_TOUJOURS, n: { v3: 2, toujours: 2, toujoursvar: 2, coin: 2, voiletoujours: 3, toujoursretard: 4, tout: 4 } },
  { texte: 'var ro ',                                                                         pages: TOUJOURS_VOILE },
  { texte: 'ro = new ResizeObserver(size);',                                                  pages: TOUJOURS_VOILE },
  { texte: 'if (ro) ro.disconnect();',                                                        pages: TOUJOURS_VOILE },
  { texte: 'page ? document.documentElement :',                                               pages: TOUJOURS_VOILE },
  { texte: "layer.firstChild.style.removeProperty('translate');",                             pages: TOUJOURS_VOILE },
  // `on: always` avec un retard : d'où part la lumière la première fois, et son retour au centre qui glisse
  { texte: 'var known ',                                                                      pages: TOUJOURS_RETARD },
  { texte: 'known = true;',                                                                   pages: TOUJOURS_RETARD, n: Object.fromEntries(TOUJOURS_RETARD.map((p) => [p, 2])) },
  { texte: 'if (smooth < 1 && !known) {',                                                     pages: TOUJOURS_RETARD },
  { texte: 'known = false;',                                                                  pages: TOUJOURS_RETARD, n: Object.fromEntries(TOUJOURS_RETARD.map((p) => [p, 3])) },
  { texte: 'gx = wd / 2;',                                                                    pages: TOUJOURS_RETARD },
  { texte: 'else if (home) paint();',                                                         pages: TOUJOURS_RETARD },
  // `on: always` avec un retard : à la sortie la lumière glisse jusqu'au centre, elle n'est « chez elle » qu'à son arrivée
  { texte: '(gx !== tx || gy !== ty)) home = false;',                                        pages: TOUJOURS_RETARD },
  { texte: 'if (home) rest();',                                                               pages: ['voiletoujours', 'toujoursretard', 'tout'] },
  { texte: 'if (!inside) {',                                                                  pages: TOUJOURS_RETARD },
  { texte: 'tx   = wd / 2;',                                                                  pages: ['voiletoujours', 'toujoursretard', 'tout'] },
  // `where: fill` : le liseré caché, et la règle d'un halo seul que le navigateur ne sait pas animer
  { texte: '[mjs-fx-spot-where="fill"]::before{display:none}',                                 pages: AVEC_REMPLIR },
  { texte: '[mjs-fx-spot-where="none"]::before',                                              pages: AVEC_REMPLIR },
  // `origin` : la lumière tenue en un point, sans la souris
  { texte: 'µ._mjs_fxPoint(s.origin, null)',                                                  pages: AVEC_ORIGINE },
  // `glow` : la variable de la portée du halo (la feuille la lit, qu'elle soit posée ou non)
  { texte: "glow: 'px'",                                                                      pages: AVEC_PORTEE },
  // `on: always` : l'éclat de la lumière toujours allumée calé sur l'horloge commune des effets qui se répètent
  { texte: "a.animationName === 'mjs-fx-spot-flash'",                                         pages: AVEC_TOUJOURS },
  { texte: "addEventListener(el, 'animationstart', beat)",                                    pages: AVEC_TOUJOURS },
  { texte: "removeEventListener(el, 'animationstart', beat)",                                 pages: AVEC_TOUJOURS, n: { coin: 2 } },
  // `every` écrit : l'éclat — sa variable, son attribut posé puis retiré (deux fois avec `origin` : le retrait de la lumière tenue en un point) ;
  // sa règle part toujours (la variable de thème `$$spotlight-every` l'allume aussi, même posée dans une feuille que la construction ne lit pas ; `$$mjs-fx-every` ne l'allume pas)
  { texte: "every: ''",                                                                       pages: AVEC_ECLAT },
  { texte: "setAttribute(el, 'mjs-fx-spot-every'",                                            pages: AVEC_ECLAT },
  { texte: "removeAttribute(el, 'mjs-fx-spot-every')",                                        pages: AVEC_ECLAT, n: { coineclat: 2, coineclatvar: 2 } },
  // l'éclat tenu par une variable : sa marque suit sur place (`set`), et aussi sur la lumière tenue en un point
  { texte: "if (k === 'every') {",                                                            pages: AVEC_ECLAT_VAR },
  { texte: "µ._mjs_dom[v ? 'setAttribute' : 'removeAttribute'](el, 'mjs-fx-spot-every', '');", pages: AVEC_ECLAT_VAR, n: { coineclatvar: 2 } },
  { texte: 'back.set = function(k, v) {',                                                     pages: ['coineclatvar'] },
  { texte: "if (k !== 'every') return false;",                                                pages: ['coineclatvar'] },
  // l'avertissement : « *spotlight(veil) » est lu comme une couleur
  { texte: "µ._mjs_msg('spotlightWhere'",                                                     pages: AVEC_MOT }
]

// ce que fait `*spotlight` sans rien écrire : la feuille du halo et du liseré, la pose, le suivi de la souris, le retrait
const RESTE = [
  'µ._mjs_fxDefs.spotlight = {',
  'radius: true,',
  '[mjs-fx~="spotlight"]{isolation:isolate}',
  '[mjs-fx~="spotlight"][mjs-fx-live]::after{',
  '[mjs-fx~="spotlight"]::before{content:""',
  '[mjs-fx~="spotlight"][mjs-fx-spot-on]::after{opacity:1}',
  'animation:mjs-fx-spot-flash var(--mjs-spotlight-every) ease-out infinite',
  '@keyframes mjs-fx-spot-flash',
  '@media (prefers-reduced-motion:reduce)',
  'var rounding = function() {',
  'var shine = function(x, y, soon) {',
  'if (soon && lamp) return void (beam = beam || requestAnimationFrame(flush));',
  'var flush = function() {',
  'var trace = function(e) {',
  'var arrive = function() {',
  'var enter = function(e) {',
  'var leave = function() {',
  'var off = function() {',
  "µ._mjs_dom.addEventListener(el, 'pointermove', move"
]

// les signaux de build des réglages neufs (features.ts : `<effet>_<réglage>:<valeur>`)
const SIGNAUX  = ['spotlight_where:veil', 'spotlight_smooth:0.15', 'spotlight_color:veil', 'spotlight_soft:80', 'spotlight_on:always', 'spotlight_where:fill']
const GLOBALES = ['µ', 'window', 'document', 'navigator', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'ResizeObserver', 'Element', 'Math', 'Array', 'Object', 'String', 'parseFloat']

// les signaux d'une pose écrite, tels que le build les lit sur le code compilé
const signaux = async (source: string) => scanCompiledFeatures((await transpile(source, { moduleName: 'c' })).output)

describe('étiquettes `// @@` de mjs_fx_spotlight.ts — chaque réglage neuf embarque sa section et rien d\'autre', function () {
  this.timeout(600000)
  after(async () => { await terminateSharedWorkerPool() })

  const src = readFileSync(join(import.meta.dirname, '../src/runtime/mjs_fx_spotlight.ts'), 'utf-8')

  // un build RÉEL dont le code reste lisible (`minify: false`) ; `env: 'prod'` : le développement envoie le fichier en entier, le tri est celui de la production.
  // `tout` : tous les .js émis ; `spot` : le fichier de l'effet seul (`mjs_fx_spotlight-<empreinte>.js`) ; `coeur` : le reste (cœur et outils)
  async function construire(nom: string, source: string | Record<string, string>, env = 'prod', plus: Record<string, unknown> = {}): Promise<Sortie> {
    const root   = mjsTmp('spotlight-sections-' + nom)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [fichier, texte] of Object.entries(typeof source === 'string' ? { 'p.mjs': source } : source)) writeFileSync(join(srcDir, fichier), texte)
    const options: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...plus }
    if (env === 'prod') options.env = 'prod'
    const bundler = new Bundler(options)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    const fichiers = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const lire     = (liste: string[]) => liste.map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
    return { tout: lire(fichiers), spot: lire(fichiers.filter((f) => f.startsWith('mjs_fx_spotlight-'))), coeur: lire(fichiers.filter((f) => f.startsWith('mjs_core-'))) }
  }
  const appli = (balise: string) => `<script>\n$w = 'veil'\n$f = 20\n$m = .5\n$c = '#0ff'\n$r = 8\n$o = 'always'\n</script>\n<div class="a" ${balise}>Un cadre</div>`

  describe('les builds de production, une page par réglage', () => {
    const sorties: Record<string, Sortie> = {}

    before(async () => {
      for (const [nom, page] of Object.entries(PAGES)) sorties[nom] = await construire(nom, appli(page.balise))
    })

    it('les jetons des étiquettes du fichier sont exactement ceux des pages de la table', () => {
      const dansLeFichier = [...new Set(unites(src).flatMap((u) => u.jetons))].sort()
      const dansLaTable   = [...new Set(Object.values(PAGES).flatMap((p) => p.jetons))].sort()
      assert.deepEqual(dansLeFichier, dansLaTable)
    })

    it('chaque section marquée porte au moins un témoin sur ses lignes propres, et chaque témoin est dans une section', () => {
      const liste = unites(src)
      // une accolade fermante ou un `return;` seul suit son ouvrante marquée de la même étiquette : il n'a pas de témoin à part
      const banal = (x: Unite) => x.propres.every((l) => ['}', 'return;'].includes(l.trim()))
      for (const u of liste) if (!banal(u)) assert.ok(TEMOINS.some((t) => u.propres.join('\n').includes(t.texte)), `la section « ${u.jetons.join(' ')} » (ligne ${u.ligne}) n'a aucun témoin`)
      for (const t of TEMOINS) {
        assert.ok(liste.some((u) => u.propres.join('\n').includes(t.texte)), `le témoin « ${t.texte} » n'est dans aucune section marquée`)
        for (const p of t.pages) assert.ok(PAGES[p], `le témoin « ${t.texte} » cite la page ${p}, qui n'existe pas`)
      }
    })

    it('aucune marque ne sort, et chaque page porte les témoins de son réglage, et seulement eux', () => {
      for (const [nom, sortie] of Object.entries(sorties)) {
        assert.equal(sortie.tout.split('\n').some((l) => BLOC.test(l) || FIN.test(l)), false, `${nom} : une marque de section sort`)
        assert.ok(sortie.spot.includes('µ._mjs_fxDefs.spotlight = {'), `${nom} : le fichier de l'effet est à part`)
        for (const t of TEMOINS) {
          const delta = compte(sortie.spot, t.texte) - compte(sorties[REF].spot, t.texte)
          assert.equal(delta, t.pages.includes(nom) ? (t.n?.[nom] ?? 1) : 0, `page « ${nom} » (${PAGES[nom].balise}) : « ${t.texte} » ${t.pages.includes(nom) ? 'doit partir' : 'ne doit pas partir'}`)
        }
      }
    })

    it('`*spotlight` sans réglage neuf garde tout son halo et son liseré, sur toutes les pages : rien de ce qui sert au défaut n\'est dans une section', () => {
      for (const [nom, sortie] of Object.entries(sorties)) {
        for (const reste of RESTE) assert.ok(sortie.spot.includes(reste), `page « ${nom} » : « ${reste} » manque`)
      }
      const liste = unites(src)
      for (const reste of RESTE) assert.equal(liste.some((u) => u.propres.join('\n').includes(reste)), false, `« ${reste} » est dans une section`)
    })

    it('les réglages de la V3 qui ne touchent aucun morceau trié ne font rien partir : même fichier que `*spotlight` seul, à l\'octet', () => {
      for (const nom of ['v3couleur', 'v3deux']) assert.equal(sorties[nom].spot, sorties[REF].spot, nom)
    })

    it('`on: always` et `where: fill` n\'embarquent que leur morceau, rien du voile ni du retard ; sans eux, ce code n\'est pas dans le fichier', () => {
      for (const nom of ['v3', 'v3halo', 'toujours', 'remplir']) {
        assert.equal(sorties[nom].spot.includes('var born = function() {') || sorties[nom].spot.includes('var tick = function(now) {'), false, `${nom} : ni voile ni retard`)
      }
      for (const absent of ['var always', 'var home', 'home = true;', 'if (always) {', 'if (home) {', 'ResizeObserver(size)', 'mjs-fx-spot-where="none"']) {
        assert.equal(sorties[REF].spot.includes(absent), false, `sans réglage, « ${absent} » n'est pas embarqué`)
      }
      assert.ok(sorties.toujours.spot.includes('home = true;') && sorties.toujours.spot.includes('if (home) {'), 'on: always embarque le retour au centre')
      assert.equal(sorties.toujours.spot.includes('mjs-fx-spot-where="none"'), false, 'on: always n\'embarque pas la règle du halo seul')
      assert.ok(sorties.remplir.spot.includes('[mjs-fx-spot-where="none"]::before,[mjs-fx~="spotlight"][mjs-fx-spot-where="none"]::after{display:none}'), 'where: fill embarque la règle du halo seul sans animation Web')
      assert.equal(sorties.remplir.spot.includes('var home'), false, 'where: fill n\'embarque pas le retour au centre')
    })

    it('`soft` écrit sans le voile : sa variable part (le cœur la pose sur la balise et la suit sur place), rien d\'autre', () => {
      for (const nom of ['soft', 'softvar']) {
        assert.equal(sorties[nom].spot.split('\n').length - sorties[REF].spot.split('\n').length, 1, `${nom} : une ligne de plus`)
        assert.ok(sorties[nom].spot.includes("width: 'px',\n    soft: 'px'\n  },"), `${nom} : le bord est dans les variables de l'effet`)
        assert.equal(sorties[nom].spot.includes('var born = function() {'), false, `${nom} : rien du voile`)
      }
    })

    it('le mot d\'un mode écrit à la place d\'une couleur : l\'avertissement part, rien d\'autre', () => {
      const a = sorties.mot.spot.split('\n').length - sorties[REF].spot.split('\n').length
      assert.ok(a > 0 && a < 6, `${a} lignes de plus (l'avertissement seul)`)
      assert.ok(sorties.mot.spot.includes("µ._mjs_msg('spotlightWhere'"), 'l\'avertissement part')
      assert.equal(sorties[REF].spot.includes('spotlightWhere'), false, 'sans lui, pas d\'avertissement')
    })

    it('les outils du cœur suivent le fichier trié : aucun ne part sans servir', async () => {
      for (const [nom, page] of Object.entries(PAGES)) {
        const lus = [...sorties[nom].coeur.matchAll(/^\/\/ === mjs_(fx_tool[a-z]+)\.ts ===$/gm)].map((m) => m[1])
        assert.deepEqual(FX_TOOL_KEYS.filter((k) => lus.includes(k)), page.outils, `page « ${nom} » (${page.balise}) : les outils du cœur`)
      }
      const dev = await Promise.all([appli('*spotlight')].map((a) => construire('outils-dev', a, 'dev')))
      const lus = [...dev[0].coeur.matchAll(/^\/\/ === mjs_(fx_tool[a-z]+)\.ts ===$/gm)].map((m) => m[1])
      assert.deepEqual(FX_TOOL_KEYS.filter((k) => lus.includes(k)), TOUT, 'le développement envoie tous les outils de l\'effet')
    })

    it('un réglage tenu par une variable : toutes ses valeurs, et rien des autres réglages', async () => {
      const voile = await construire('variable-where', appli('*spotlight(where: $w)'))
      for (const t of TEMOINS.filter((x) => x.pages.includes('voile'))) assert.ok(voile.spot.includes(t.texte), `where tenu par une variable : « ${t.texte} » manque`)
      assert.ok(voile.spot.includes('[mjs-fx-spot-where="none"]::before'), 'where tenu par une variable peut valoir fill : la règle du halo seul part')
      assert.equal(voile.spot.includes('var home'), false, 'where n\'est pas on')
      assert.equal(voile.spot.includes('µ._mjs_fxLag('), false, 'le voile n\'est pas le retard')
      assert.equal(voile.spot.includes('spotlightWhere'), false, 'le voile n\'est pas l\'avertissement')
      const retard = await construire('variable-smooth', appli('*spotlight(smooth: $m)'))
      for (const t of TEMOINS.filter((x) => x.pages.includes('retardvar'))) assert.ok(retard.spot.includes(t.texte), `smooth tenu par une variable : « ${t.texte} » manque`)
      assert.equal(retard.spot.includes("k === 'radius' && halo"), false, 'le retard n\'est pas l\'arrondi')
      const rayon = await construire('variable-radius', appli('*spotlight(radius: $r)'))
      assert.ok(rayon.spot.includes("if (k === 'radius' && halo) {") && rayon.spot.includes('off.set = function(k, v) {'), 'un arrondi tenu par une variable est suivi sur place')
      assert.equal(rayon.spot.includes("k === 'smooth'") || rayon.spot.includes('var tick = function(now) {'), false, 'l\'arrondi n\'est pas le retard')
      const fixe = await construire('radius-fixe', appli('*spotlight(radius: 12, smooth: .3)'))
      assert.equal(fixe.spot.includes('off.set = function(k, v) {'), false, 'un retard et un arrondi écrits en dur ne bougent pas : rien à suivre')
      assert.equal(retard.spot.includes('var born = function() {'), false, 'le retard n\'est pas le voile')
      const bord = await construire('variable-soft', appli('*spotlight(soft: $f)'))
      assert.ok(bord.spot.includes("soft: 'px'"), 'un bord tenu par une variable est suivi sur place : sa variable part')
      assert.equal(bord.spot.includes('var born = function() {') || bord.spot.includes('var tick = function(now) {'), false, 'le bord n\'est ni le voile ni le retard')
      const allume = await construire('variable-on', appli('*spotlight(on: $o)'))
      for (const t of TEMOINS.filter((x) => x.pages.includes('toujours'))) assert.ok(allume.spot.includes(t.texte), `on tenu par une variable : « ${t.texte} » manque`)
      assert.equal(allume.spot.includes('var born = function() {') || allume.spot.includes('var tick = function(now) {'), false, 'la lumière toujours allumée n\'est ni le voile ni le retard')
      assert.equal(allume.spot.includes('mjs-fx-spot-where="none"'), false, 'on n\'est pas where')
      const couleur = await construire('variable-color', appli('*spotlight(color: $c)'))
      assert.ok(couleur.spot.includes("µ._mjs_msg('spotlightWhere'"), 'une couleur tenue par une variable peut valoir le mot d\'un mode : l\'avertissement part')
      assert.equal(couleur.spot.includes('var born = function() {') || couleur.spot.includes('var tick = function(now) {'), false, 'la couleur n\'est ni le voile ni le retard')
    })

    it('un effet réglé une fois dans un `*.effects.mjs` : ce qu\'il écrit part (le voile), et rien de plus', async () => {
      const projet = await construire('alias', { 'marque.effects.mjs': '<effects>\n  *lampe = *spotlight(where: veil, soft: 60)\n</effects>', 'p.mjs': '<div class="a" *lampe>x</div>' })
      assert.ok(projet.spot.includes('var born = function() {') && projet.spot.includes("soft: 'px'"))
      assert.equal(projet.spot.includes('var tick = function(now) {'), false, 'le retard n\'est pas écrit')
    })

    it('le voile posé sur la page entière (`<@document>`) embarque le voile, et rien du retard', async () => {
      const page = await construire('document', '<@document *spotlight(where: veil)>\n<p class="a">x</p>')
      assert.ok(page.spot.includes('veil && el === document.documentElement') && page.spot.includes('var born = function() {'))
      assert.equal(page.spot.includes('var tick = function(now) {'), false, 'le retard n\'est pas écrit')
    })

    it('la demande explicite du fichier (`runtime: [\'fx_spotlight\']`) garde tout, comme un effet choisi par une variable', async () => {
      const tout = await construire('demande', appli('*spotlight'), 'prod', { runtime: ['fx_spotlight'] })
      for (const t of TEMOINS) assert.ok(tout.tout.includes(t.texte), `demande explicite : « ${t.texte} » manque`)
    })

    it('le développement envoie le fichier en entier, sans une marque (le panneau allume n\'importe quel réglage)', async () => {
      const dev = await construire('developpement', appli('*spotlight'), 'dev')
      assert.equal(dev.tout.split('\n').some((l) => BLOC.test(l) || FIN.test(l)), false)
      for (const t of TEMOINS) assert.ok(dev.tout.includes(t.texte), `développement : « ${t.texte} »`)
    })
  })

  describe('le fichier seul, toutes les combinaisons de réglages écrits', () => {
    const linter = new Linter()
    const config: any = [{
      languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: Object.fromEntries(GLOBALES.map((n) => [n, 'readonly'])) },
      rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { vars: 'all', args: 'none', caughtErrors: 'none' }] }
    }]

    it(`les ${1 << SIGNAUX.length} combinaisons donnent du JavaScript valide, sans variable inconnue ni variable jamais lue`, () => {
      const mauvais: string[] = []
      for (let masque = 0; masque < 1 << SIGNAUX.length; masque++) {
        const ecrits = SIGNAUX.filter((_, i) => masque & (1 << i))
        const texte  = selectFxSections('mjs_fx_spotlight.ts', src, new Set(['use:spotlight', ...ecrits]), false)
        try {
          acorn.parse(texte, { ecmaVersion: 'latest' })
        }
        catch (e: any) {
          mauvais.push(`[${ecrits.join(' ')}] ${e.message}`)
          continue
        }
        for (const m of linter.verify(texte, config)) mauvais.push(`[${ecrits.join(' ')}] ${m.ruleId} : ${m.message}`)
      }
      assert.deepEqual(mauvais, [])
    })

    it('un réglage tenu par une variable (toutes ses valeurs) donne lui aussi du JavaScript valide', () => {
      const mauvais: string[] = []
      for (const ecrits of [['spotlight_where:*'], ['spotlight_smooth:*'], ['spotlight_color:*'], ['spotlight_radius:*'], ['spotlight_on:*'], ['spotlight_soft:*'], ['spotlight_smooth:*', 'spotlight_radius:*'], ['spotlight_on:*', 'spotlight_smooth:*'], ['spotlight_where:*', 'spotlight_smooth:*', 'spotlight_color:*', 'spotlight_radius:*', 'spotlight_on:*', 'spotlight_soft:*']]) {
        const texte = selectFxSections('mjs_fx_spotlight.ts', src, new Set(['use:spotlight', ...ecrits]), false)
        try {
          acorn.parse(texte, { ecmaVersion: 'latest' })
        }
        catch (e: any) {
          mauvais.push(`[${ecrits.join(' ')}] ${e.message}`)
          continue
        }
        for (const m of linter.verify(texte, config)) mauvais.push(`[${ecrits.join(' ')}] ${m.ruleId} : ${m.message}`)
      }
      assert.deepEqual(mauvais, [])
    })

    it('le fichier entier (développement, demande explicite) est lui aussi du JavaScript valide', () => {
      const texte = selectFxSections('mjs_fx_spotlight.ts', src, new Set(), true)
      acorn.parse(texte, { ecmaVersion: 'latest' })
      assert.deepEqual(linter.verify(texte, config).map((m) => `${m.ruleId} : ${m.message}`), [])
    })

    it('sans aucun réglage neuf, le fichier est bien plus court que le fichier entier', () => {
      const nu   = selectFxSections('mjs_fx_spotlight.ts', src, new Set(['use:spotlight']), false)
      const tout = selectFxSections('mjs_fx_spotlight.ts', src, new Set(), true)
      assert.ok(nu.length < tout.length * 0.7, `${nu.length} octets sans réglage, ${tout.length} avec tout`)
    })

    it('les signaux des réglages à section sont bien ceux que le build lit sur une pose écrite', async () => {
      assert.ok((await signaux('<div *spotlight(where: veil)>x</div>')).has('spotlight_where:veil'))
      assert.ok((await signaux('<div *spotlight(smooth: .15)>x</div>')).has('spotlight_smooth:0.15'))
      assert.ok((await signaux('<div *spotlight(veil)>x</div>')).has('spotlight_color:veil'))
      assert.ok((await signaux('<div *spotlight(soft: 80)>x</div>')).has('spotlight_soft:80'))
      assert.ok((await signaux('<div *spotlight(on: always)>x</div>')).has('spotlight_on:always'))
      assert.ok((await signaux('<div *spotlight(where: fill)>x</div>')).has('spotlight_where:fill'))
    })
  })
})
