// Un objet de l'état tenu par deux composants se note PAR OBJET. Le second composant qui range un objet qu'un autre a rangé avant lui
// — encore dans la page ou non — marque cet objet, et lui seul : ses écritures profondes font avancer son époque, que compare le
// composant à qui l'objet est redonné ; celles des autres objets de la page n'en font avancer aucune.
// La précision gardée : après « poser, retirer, reposer » sur les mêmes données, après une liste puis le détail d'une de ses lignes,
// après une sortie animée pendant laquelle un autre composant range l'objet, cinq écritures profondes d'un AUTRE objet ne font avancer
// aucune époque, et cinq écritures de l'objet marqué font avancer la sienne seule.
// La justesse gardée : le composant sorti de la page qui écrit encore l'objet (requête finie après son départ, page gardée par le
// routeur, composant détaché puis rattaché) fait suivre celui qui l'a rangé après lui : aussitôt avec l'enveloppe (le défaut), comme
// tout composant qui tient le même objet, et sous `proxy: false` dès que l'objet lui est redonné ; revenu, il ne rejoue aucun reffet
// de plus ; sa valeur dérivée précise, relue hors de la page, suit ce que l'autre a écrit, et ses autres valeurs précises gardent leur
// précision ; deux composants posés qui tiennent le même objet suivent chacun l'écriture de l'autre (aussitôt avec l'enveloppe) ; le
// magasin qui écrit un objet prévient le premier composant qui le tient, dans la page ou revenu.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const etat   = (ecrire: string): string => `<script>\n$d = { label: '', meta: { n: 0 } }\n@poser = (o) -> $d = o\n@ecrire = (v) -> ${ecrire}\n</script>\n`
const PAGE   = '<script>\n$d = window.__o\n@poser = (o) -> $d = o\n@ecrire = (v) -> $d.label = v\n</script>\n<p class="t">{$d.label}</p>\n'
// `$titre` et `$t2` sont des valeurs précises : elles suivent leurs sources, sans se refaire à chaque écriture du composant
const PRECIS = '<script>\n$d = { label: \'\', meta: { n: 0 } }\n$k = { v: 1 }\n$y = 0\n$titre = [$d.label, $d.meta.n].join(\'-\')\n$t2 = [$k.v, \'k\'].join(\'?\')\n@poser = (o) -> $d = o\n@poserk = (o) -> $k = o\n@ecrire = (v) -> $d.label = v\n@bouger = -> $y++\n@lire = -> $titre\n@lire2 = -> $t2\n</script>\n<p class="t">{$y}</p>\n'
const NUS: Record<string, string> = {
  'c-plat.mjs':     etat('$d.label = v') + '<p class="t">{$d.label}</p>\n',
  'c-imbrique.mjs': etat('$d.meta.n = v') + '<p class="t">{$d.label} {$d.meta.n}</p>\n'
}
const SOURCES: Record<string, Record<string, string>> = {
  // ni prop ni valeur dérivée : le cœur de production le plus court
  nus:  NUS,
  tout: {
    ...NUS,
    'c-liste.mjs':    '<script>\n$l = []\n$conf = { n: 0 }\n@poser = (l) -> $l = l\n@ecrire = (i, v) -> $l[i].label = v\n@regler = (v) -> $conf.n = v\n</script>\n<ul>{for r in $l by id}<li><@c-ligne item={r}></@c-ligne></li>{end}</ul>\n<p class="t">{$l.length} {$conf.n}</p>\n',
    'c-ligne.mjs':    '<p class="t">{$item ? $item.label : \'-\'}</p>\n',
    'c-effet.mjs':    '<script>\n$d = { label: \'\' }\n$c = { n: 0 }\nµeffect -> window.__seenMark.push(\'d:\' + $d.label)\nµeffect -> window.__seenMark.push(\'c:\' + $c.n)\n@poser = (o) -> $d = o\n@poserc = (o) -> $c = o\n</script>\n<p class="t">{$d.label}</p>\n',
    'c-requete.mjs':  '<script>\n$d = { label: \'\' }\n@poser = (o) -> $d = o\n@charger = -> window.__requete().then((v) => $d.label = v)\n</script>\n<p class="t">{$d.label}</p>\n',
    'c-sortie.mjs':   '<script>\n$l = []\n$a = true\n$conf = { n: 0 }\n@poser = (o) -> $l = [o]\n@sortir = -> $a = false\n@regler = (v) -> $conf.n = v\n</script>\n{if $a}<div :out=*fade(duration: 300ms)><@c-ligne item={$l[0]}></@c-ligne></div>{end}\n<p class="t">{$l.length} {$conf.n}</p>\n',
    'c-precis.mjs':   PRECIS,
    'app.page.mjs':   '<routes target="v">\n  /      un-page\n  /deux  deux-page\n  /trois  trois-page\n</routes>\n\n<@view v>\n',
    'un-page.mjs':    PAGE,
    'deux-page.mjs':  PAGE,
    'trois-page.mjs': '<p class="t">trois</p>\n'
  },
  // un magasin dont aucune unité ne range un objet dans une variable `$` : le cœur sans le carnet des objets gardés
  magasin: {
    'm-nu.mjs':   '<script>\n  $$vn = window.__magasin\n  @ecrire = (i, v) -> $$vn[i].label = v\n</script>\n<p class="t">{$$vn[0].label}</p>\n',
    'c-plat.mjs': NUS['c-plat.mjs']
  }
}

// outils de la page, posés avant le cœur. Une époque avancée est une écriture de table faible : comptées pendant cinq écritures profondes
const OUTILS = `window.__sets = 0;
window.__seenMark   = [];
{ const f = WeakMap.prototype.set; WeakMap.prototype.set = function (...a) { window.__sets++; return f.apply(this, a) } }
window.__data    = Array.from({ length: 5 }, (_, i) => ({ id: i, label: 'x' + i, meta: { n: i } }));
window.__magasin = Array.from({ length: 3 }, (_, i) => ({ id: i, label: 'm' + i }));
window.__o       = { id: 1, label: 'a', meta: { n: 1 } };
window.__pause   = (ms = 150) => new Promise((f) => setTimeout(f, ms));
window.__ecran   = (e) => { const t = e && e._shadow && e._shadow.querySelector('.t'); return t ? t.textContent : null };
window.__pose    = (tag) => document.body.appendChild(document.createElement(tag));
window.__objet   = () => ({ id: 1, label: 'a', meta: { n: 1 } });
window.__lignes  = async (p, n) => { for (let i = 0; i < 100; i++) { const l = p._shadow.querySelectorAll('mjs-c-ligne'); if (l.length === n && (!n || (l[n - 1]._shadow && l[n - 1]._shadow.querySelector('.t')))) break; await window.__pause(50) } await window.__pause(200) };
window.__ligne   = (p, i) => window.__ecran(p._shadow.querySelectorAll('mjs-c-ligne')[i]);
window.__requete = () => new Promise((f) => setTimeout(() => f('frais'), 400));
window.__aller   = async (h) => { location.hash = h; await window.__pause(450) };
window.__epoques = async (ecrire, nom) => { ecrire(nom + 0); await window.__pause(); const s = window.__sets; for (let i = 1; i <= 5; i++) ecrire(nom + i); await window.__pause(); return window.__sets - s };`

// `jeux` : les jeux de sources où la scène se joue ; `enveloppe` : scène propre aux bâtis qui ont l'enveloppe (sous `proxy: false`, toute
// valeur dérivée qui lit un objet est à l'horloge) ; `avecEnveloppe` : ce que montre la scène avec l'enveloppe, où les autres composants qui
// tiennent l'objet suivent aussitôt l'écriture (`attendu` vaut alors sous `proxy: false`)
type Scene = { nom: string, jeux: string[], tag: string, code: string, attendu: unknown, enveloppe?: boolean, avecEnveloppe?: unknown }
const DEBUT = 'const o = __objet(), k = { v: 1 }, a = __pose(\'mjs-c-precis\'), b = __pose(\'mjs-c-precis\'); await __pause(200); a.poser(o); a.poserk(k); await __pause(200); const depart = a.lire(), depart2 = a.lire2();'
const SCENES: Scene[] = [
  // --- la précision gardée : époques avancées par cinq écritures profondes ---
  { nom: 'poser, retirer, reposer, objet à plat : cinq écritures d\'un autre objet, puis de l\'objet marqué', jeux: ['tout', 'nus'], tag: 'mjs-c-plat', attendu: { autres: 0, marque: 5, ecrans: ['b5', 'c5'] }, code: `
    const o = __objet(), autre = __objet(), a = __pose('mjs-c-plat'); await __pause(200); a.poser(o); await __pause(200); a.remove(); await __pause(200);
    const b = __pose('mjs-c-plat'), c = __pose('mjs-c-plat'); await __pause(200); b.poser(o); c.poser(autre); await __pause(200);
    const autres = await __epoques((v) => c.ecrire(v), 'c'), marque = await __epoques((v) => b.ecrire(v), 'b');
    return { autres, marque, ecrans: [__ecran(b), __ecran(c)] }` },
  { nom: 'poser, retirer, reposer, objet imbriqué : cinq écritures d\'un autre objet, puis de l\'objet marqué', jeux: ['tout', 'nus'], tag: 'mjs-c-imbrique', attendu: { autres: 0, marque: 5, ecrans: ['a b5', 'a c5'] }, code: `
    const o = __objet(), autre = __objet(), a = __pose('mjs-c-imbrique'); await __pause(200); a.poser(o); await __pause(200); a.remove(); await __pause(200);
    const b = __pose('mjs-c-imbrique'), c = __pose('mjs-c-imbrique'); await __pause(200); b.poser(o); c.poser(autre); await __pause(200);
    const autres = await __epoques((v) => c.ecrire(v), 'c'), marque = await __epoques((v) => b.ecrire(v), 'b');
    return { autres, marque, ecrans: [__ecran(b), __ecran(c)] }` },
  { nom: 'liste puis détail d\'une de ses lignes : cinq écritures d\'un autre objet de la liste, puis de la ligne marquée', jeux: ['tout'], tag: 'mjs-c-plat', attendu: { autres: 0, marque: 5, ligne: 'd5', liste: '5 n5' }, code: `
    const data = __data, l = __pose('mjs-c-liste'); await __pause(200); l.poser(data); await __lignes(l, 5);
    const d = __pose('mjs-c-plat'); await __pause(200); d.poser(data[3]); await __pause(200);
    const autres = await __epoques((v) => l.regler(v), 'n'), marque = await __epoques((v) => d.ecrire(v), 'd');
    l.poser([...data]); await __pause(400);
    return { autres, marque, ligne: __ligne(l, 3), liste: __ecran(l) }` },
  { nom: 'sortie animée, l\'objet rangé par un autre pendant qu\'elle dure : cinq écritures d\'un autre objet, puis de l\'objet marqué', jeux: ['tout'], tag: 'mjs-c-plat', attendu: { avant: 'a', pendant: true, sorti: true, autres: 0, marque: 5, ecrans: ['1 n5', 'd5'] }, code: `
    const o = __objet(), s = __pose('mjs-c-sortie'); await __pause(200); s.poser(o); await __pause(300);
    const avant = __ecran(s._shadow.querySelector('mjs-c-ligne')); s.sortir(); await __pause(60);
    const d = __pose('mjs-c-plat'); await __pause(60); const pendant = !!s._shadow.querySelector('mjs-c-ligne'); d.poser(o); await __pause(800);
    const sorti = !s._shadow.querySelector('mjs-c-ligne'), autres = await __epoques((v) => s.regler(v), 'n'), marque = await __epoques((v) => d.ecrire(v), 'd');
    return { avant, pendant, sorti, autres, marque, ecrans: [__ecran(s), __ecran(d)] }` },
  // --- le composant sorti de la page qui écrit encore ---
  { nom: 'a range o puis sort ; b range o ; a écrit hors de la page ; o redonné à b', jeux: ['tout', 'nus'], tag: 'mjs-c-plat', attendu: { aussitot: 'a', redonne: 'frais', brut: 'frais' }, avecEnveloppe: { aussitot: 'frais', redonne: 'frais', brut: 'frais' }, code: `
    const o = __objet(), a = __pose('mjs-c-plat'); await __pause(200); a.poser(o); await __pause(200); a.remove(); await __pause(200);
    const b = __pose('mjs-c-plat'); await __pause(200); b.poser(o); await __pause(200);
    a.ecrire('frais'); await __pause(200); const aussitot = __ecran(b); b.poser(o); await __pause(200);
    return { aussitot, redonne: __ecran(b), brut: o.label }` },
  { nom: 'détail sorti puis liste : le détail écrit hors de la page ; le parent redonne les lignes, puis écrit la ligne', jeux: ['tout'], tag: 'mjs-c-plat', attendu: { aussitot: 'x3', redonne: 'frais', apresEcritureDuParent: 'parent', brut: 'parent' }, avecEnveloppe: { aussitot: 'frais', redonne: 'frais', apresEcritureDuParent: 'parent', brut: 'parent' }, code: `
    const data = __data, a = __pose('mjs-c-plat'); await __pause(200); a.poser(data[3]); await __pause(200); a.remove(); await __pause(200);
    const l = __pose('mjs-c-liste'); await __pause(200); l.poser(data); await __lignes(l, 5);
    a.ecrire('frais'); await __pause(200); const aussitot = __ligne(l, 3); l.poser([...data]); await __pause(400);
    const redonne = __ligne(l, 3); l.ecrire(3, 'parent'); await __pause(300);
    return { aussitot, redonne, apresEcritureDuParent: __ligne(l, 3), brut: data[3].label }` },
  { nom: 'liste sortie puis détail : la liste écrit une ligne hors de la page ; la ligne redonnée au détail', jeux: ['tout'], tag: 'mjs-c-plat', attendu: { aussitot: 'x3', redonne: 'frais', brut: 'frais' }, avecEnveloppe: { aussitot: 'frais', redonne: 'frais', brut: 'frais' }, code: `
    const data = __data, l = __pose('mjs-c-liste'); await __pause(200); l.poser(data); await __lignes(l, 5); l.remove(); await __pause(200);
    const b = __pose('mjs-c-plat'); await __pause(200); b.poser(data[3]); await __pause(200);
    l.ecrire(3, 'frais'); await __pause(200); const aussitot = __ecran(b); b.poser(data[3]); await __pause(200);
    return { aussitot, redonne: __ecran(b), brut: data[3].label }` },
  { nom: 'page gardée par le routeur : elle écrit hors de la page l\'objet que tient la page suivante, puis revient', jeux: ['tout'], tag: 'mjs-app', attendu: { dehors: true, aussitot: 'a', redonne: 'frais', retour: { memePage: true, ecran: 'de-b' }, brut: 'de-b' }, avecEnveloppe: { dehors: true, aussitot: 'frais', redonne: 'frais', retour: { memePage: true, ecran: 'de-b' }, brut: 'de-b' }, code: `
    await __pause(400); const a = p._shadow.querySelector('mjs-un-page'); if (!a) return 'page / absente';
    await __aller('#/trois'); const dehors = !a.isConnected; await __aller('#/deux');
    const b = p._shadow.querySelector('mjs-deux-page'); if (!b) return 'page /deux absente';
    a.ecrire('frais'); await __pause(250); const aussitot = __ecran(b); b.poser(__o); await __pause(250); const redonne = __ecran(b);
    b.ecrire('de-b'); await __pause(200); await __aller('#/');
    const a2 = p._shadow.querySelector('mjs-un-page');
    return { dehors, aussitot, redonne, retour: { memePage: a2 === a, ecran: __ecran(a2) }, brut: __o.label }` },
  { nom: 'détaché puis rattaché : a écrit hors de la page, revient, écrit encore ; o redonné à b chaque fois', jeux: ['tout', 'nus'], tag: 'mjs-c-plat', attendu: { retour: { ecranA: 'frais', ecranB: 'a' }, redonne: 'frais', apresRetour: 'apres', brut: 'apres' }, avecEnveloppe: { retour: { ecranA: 'frais', ecranB: 'frais' }, redonne: 'frais', apresRetour: 'apres', brut: 'apres' }, code: `
    const o = __objet(), a = __pose('mjs-c-plat'); await __pause(200); a.poser(o); await __pause(200); a.remove(); await __pause(200);
    const b = __pose('mjs-c-plat'); await __pause(200); b.poser(o); await __pause(200);
    a.ecrire('frais'); await __pause(200); document.body.appendChild(a); await __pause(250);
    const retour = { ecranA: __ecran(a), ecranB: __ecran(b) }; b.poser(o); await __pause(200); const redonne = __ecran(b);
    a.ecrire('apres'); await __pause(200); b.poser(o); await __pause(200);
    return { retour, redonne, apresRetour: __ecran(b), brut: o.label }` },
  { nom: 'reffets du composant revenu, que personne n\'a écrit entre-temps : aucun de plus quand ses objets lui sont redonnés', jeux: ['tout'], tag: 'mjs-c-plat', attendu: { auRetour: ['d:a', 'c:5'], oRedonne: [], cRedonne: [] }, code: `
    const o = __objet(), c = { n: 5 }, a = __pose('mjs-c-effet'); await __pause(200); a.poser(o); a.poserc(c); await __pause(200); a.remove(); await __pause(200);
    const b = __pose('mjs-c-plat'); await __pause(200); b.poser(o); await __pause(200); const n0 = __seenMark.length;
    document.body.appendChild(a); await __pause(250); const n1 = __seenMark.length; a.poser(o); await __pause(200); const n2 = __seenMark.length; a.poserc(c); await __pause(200);
    return { auRetour: __seenMark.slice(n0, n1), oRedonne: __seenMark.slice(n1, n2), cRedonne: __seenMark.slice(n2) }` },
  { nom: 'requête finie après le départ : a lance, sort ; b range o ; la réponse arrive ; o redonné à b', jeux: ['tout'], tag: 'mjs-c-requete', attendu: { aussitot: 'a', redonne: 'frais', brut: 'frais' }, avecEnveloppe: { aussitot: 'frais', redonne: 'frais', brut: 'frais' }, code: `
    const o = __objet(), a = __pose('mjs-c-requete'); await __pause(200); a.poser(o); await __pause(200); a.charger(); a.remove(); await __pause(100);
    const b = __pose('mjs-c-requete'); await __pause(100); b.poser(o); await __pause(700);
    const aussitot = __ecran(b); b.poser(o); await __pause(200);
    return { aussitot, redonne: __ecran(b), brut: o.label }` },
  { nom: 'deux composants posés tiennent le même objet : chacun suit l\'écriture de l\'autre, aussitôt avec l\'enveloppe, quand l\'objet lui est redonné sous proxy: false', jeux: ['tout', 'nus'], tag: 'mjs-c-plat', attendu: { aussitot: 'a', deA: 'de-a', deB: 'de-b' }, avecEnveloppe: { aussitot: 'de-a', deA: 'de-a', deB: 'de-b' }, code: `
    const o = __objet(), a = __pose('mjs-c-plat'), b = __pose('mjs-c-plat'); await __pause(200); a.poser(o); b.poser(o); await __pause(200);
    a.ecrire('de-a'); await __pause(200); const aussitot = __ecran(b); b.poser(o); await __pause(200); const deA = __ecran(b);
    b.ecrire('de-b'); await __pause(200); a.poser(o); await __pause(200);
    return { aussitot, deA, deB: __ecran(a) }` },
  // --- les valeurs précises du premier détenteur ---
  { nom: 'valeur précise du composant sorti, relue hors de la page : b range o et l\'écrit, a écrit une autre variable puis relit', jeux: ['tout'], tag: 'mjs-c-precis', enveloppe: true, attendu: { depart: 'a-1', autre: 'z-1', dehors: 'z-1' }, code: `
    ${DEBUT} a.remove(); await __pause(200); b.poser(o); await __pause(200); b.ecrire('z'); await __pause(200); a.bouger(); await __pause(200);
    return { depart, autre: b.lire(), dehors: a.lire() }` },
  { nom: 'valeur précise du composant revenu : b écrit après son retour, a écrit une autre variable puis relit', jeux: ['tout'], tag: 'mjs-c-precis', enveloppe: true, attendu: { depart: 'a-1', auRetour: 'a-1', autre: 'z-1', relue: 'z-1' }, code: `
    ${DEBUT} a.remove(); await __pause(200); b.poser(o); await __pause(200); document.body.appendChild(a); await __pause(250); const auRetour = a.lire();
    b.ecrire('z'); await __pause(200); a.bouger(); await __pause(200);
    return { depart, auRetour, autre: b.lire(), relue: a.lire() }` },
  { nom: 'une AUTRE valeur précise du composant revenu garde sa précision : son objet changé hors de MJS ne la refait pas', jeux: ['tout'], tag: 'mjs-c-precis', enveloppe: true, attendu: { depart2: '1?k', t2: '1?k' }, code: `
    ${DEBUT} a.remove(); await __pause(200); b.poser(o); await __pause(200); document.body.appendChild(a); await __pause(250);
    k.v = 9; a.bouger(); await __pause(200);
    return { depart2, t2: a.lire2() }` },
  // --- le magasin sans carnet prévient le premier détenteur ---
  { nom: 'magasin, détenteur dans la page : le magasin écrit l\'objet', jeux: ['magasin'], tag: 'mjs-m-nu', attendu: { racine: 'z', detenteur: 'z' }, code: `
    const s = __pose('mjs-c-plat'); await __pause(200); s.poser(__magasin[0]); await __pause(200); p.ecrire(0, 'z'); await __pause(250);
    return { racine: __ecran(p), detenteur: __ecran(s) }` },
  { nom: 'magasin, détenteur sorti puis revenu : le magasin écrit l\'objet pendant son absence', jeux: ['magasin'], tag: 'mjs-m-nu', attendu: { auRetour: 'z', redonne: 'z' }, code: `
    const s = __pose('mjs-c-plat'); await __pause(200); s.poser(__magasin[0]); await __pause(200); s.remove(); await __pause(200); p.ecrire(0, 'z'); await __pause(250);
    document.body.appendChild(s); await __pause(250); const auRetour = __ecran(s); s.poser(__magasin[0]); await __pause(200);
    return { auRetour, redonne: __ecran(s) }` }
]

type Bati = { nom: string, prod: boolean, proxy: boolean, jeux: string[] }
const BATIS: Bati[] = [
  { nom: 'développement, enveloppe', prod: false, proxy: true,  jeux: ['tout', 'magasin'] },
  { nom: 'production, enveloppe',    prod: true,  proxy: true,  jeux: ['tout', 'nus', 'magasin'] },
  { nom: 'production, proxy: false', prod: true,  proxy: false, jeux: ['tout', 'nus'] }
]

async function construire(b: Bati, jeu: string): Promise<Map<string, Buffer>> {
  const root = mjsTmp('marque')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  for (const [nom, code] of Object.entries(SOURCES[jeu])) writeFileSync(join(src, nom), code)
  const options: any = { sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', js: b.prod ? 'bundle' : 'split', env: b.prod ? 'prod' : 'dev' }
  if (!b.proxy) options.proxy = false
  const bundler = new Bundler(options)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const fichiers = new Map<string, Buffer>()
  for (const n of readdirSync(out)) if (/\.(js|json)$/.test(n)) fichiers.set(n, readFileSync(join(out, n)))
  return fichiers
}

describe('objet tenu par deux composants : marqué par objet, les autres écritures de la page gardent leur précision (Chromium)', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const b of BATIS) {
    it(b.nom, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright.chromium.executablePath())) return this.skip()
      const navigateur = await playwright.chromium.launch({ args: ['--no-proxy-server'] })
      const ecarts: string[] = []
      const releve: string[] = []
      try {
        for (const jeu of b.jeux) {
          const fichiers = await construire(b, jeu)
          for (const sc of SCENES) {
            if (!sc.jeux.includes(jeu) || (sc.enveloppe && !b.proxy)) continue
            const page = await navigateur.newPage()
            const erreurs: string[] = []
            let vu: unknown
            page.on('pageerror', (e: any) => erreurs.push(String(e && e.message || e).slice(0, 200)))
            try {
              await page.addInitScript(OUTILS)
              await page.route('http://marque.test/**', async (route: any) => {
                const chemin = new URL(route.request().url()).pathname
                if (!chemin.startsWith('/out/')) return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><body><${sc.tag} id="premier"></${sc.tag}><script type="module" src="/out/bundle.js"></script></body>` })
                const corps = fichiers.get(chemin.slice(5))
                return route.fulfill(corps ? { status: 200, contentType: chemin.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps } : { status: 404, body: '' })
              })
              await page.goto('http://marque.test/page')
              await page.waitForFunction('(() => { const e = document.getElementById("premier"); return !!e && !!e._shadow })()', null, { timeout: 30000 })
              await page.waitForTimeout(300)
              vu = await page.evaluate(`(async () => { const p = document.getElementById('premier'); ${sc.code} })()`)
            }
            catch (e: any) {
              vu = 'scène en échec : ' + String(e && e.message || e).slice(0, 300)
            }
            finally {
              await page.close()
            }
            const attendu = b.proxy && sc.avecEnveloppe !== undefined ? sc.avecEnveloppe : sc.attendu
            releve.push(`${jeu} · ${sc.nom} ${JSON.stringify(vu)}`)
            if (JSON.stringify(vu) !== JSON.stringify(attendu)) ecarts.push(`${jeu} · ${sc.nom} : ${JSON.stringify(vu)}, attendu ${JSON.stringify(attendu)}`)
            if (erreurs.length) ecarts.push(`${jeu} · ${sc.nom} : erreur dans la page — ${erreurs[0]}`)
          }
        }
      }
      finally {
        await navigateur.close()
      }
      if (process.env.MJS_MARQUE_RELEVE) for (const l of releve) console.log(`MARQUE§ ${b.nom} · ${l}`)
      assert.deepEqual(ecarts, [])
    })
  }
})
