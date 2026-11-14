// composants, scénario et valeurs attendues partagés par derive-precise-classe-prototype-map-set-donnee-ecrite-par-mjs (happy-dom)
// et derive-precise-classe-prototype-map-set-ecran-browser (Chromium, Firefox, WebKit)
// clé d'une `Map`, élément d'un `Set` rangés sous l'enveloppe d'une AUTRE famille (composant parent, `µ.state`, `µ.Store`, magasin
// `$$`), copie `$m = new Map($m)`, `add` d'un objet que le `Set` tient déjà sous l'autre forme : `get`, `has`, `delete`, `set`, `add`
// retrouvent l'entrée quelle que soit la forme rangée, une seule entrée, `size` juste ; une clé d'une autre famille qui n'est pas passée
// par une affectation (`Map` rangée dans un objet) sort telle quelle, et la valeur précise qui la lit doute (horloge)
const IG = (m: string) => `[...${m}.keys()].map((k) -> String(${m}.get(k)) + (if ${m}.has(k) then 'o' else 'n')).join(',')`
const SUPPR = (m: string) => `@suppr = ->\n  k = [...${m}.keys()][0]\n  r = ${m}.delete(k)\n  String(r) + '/' + String(${m}.size)`
export const FAMILLES: Record<string, string> = {
  'fam-comp': `<script>\n$rows = [{nom: 'a'}, {nom: 'bb'}]\n$m = new Map([[$rows[0], 1], [$rows[1], 2]])\n$v = ${IG('$m')}\n@direct = -> ${IG('$m')}\n${SUPPR('$m')}\n</script>\n<p class="v">{$v}</p>\n`,
  'fam-comp2': `<script>\n$rows = [{nom: 'a'}, {nom: 'bb'}]\n$m = null\n@remplir = -> $m = new Map([[$rows[0], 1], [$rows[1], 2]])\n$v = (if $m then (${IG('$m')}) else '-')\n@direct = -> ${IG('$m')}\n${SUPPR('$m')}\n</script>\n<p class="v">{$v}</p>\n`,
  'fam-parent': `<script>\n$rows = [{nom: 'a'}, {nom: 'bb'}]\n$m = new Map([[$rows[0], 1], [$rows[1], 2]])\n</script>\n<p class="v">{$m.size}</p><@fam-enfant m={$m}></@fam-enfant>\n`,
  'fam-parent2': `<script>\n$rows = [{nom: 'a'}, {nom: 'bb'}]\n$m = null\n@remplir = -> $m = new Map([[$rows[0], 1], [$rows[1], 2]])\n</script>\n<p class="v">{if $m}{$m.size}{end}</p><@fam-enfant m={$m}></@fam-enfant>\n`,
  'fam-parent3': `<script>\n$rows = [{n: 1}, {n: 2}]\n$counts = new Map($rows.map((r) -> [r, r.n * 10]))\n</script>\n<p class="v">{$counts.size}</p><@fam-enfant3 rows={$rows} counts={$counts}></@fam-enfant3>\n`,
  'fam-enfant': `<script>\n$m = null\n$v = (if $m then (${IG('$m')}) else '-')\n@direct = -> ${IG('$m')}\n${SUPPR('$m')}\n</script>\n<p class="v">{$v}</p>\n`,
  'fam-enfant3': `<script>\n$rows = null\n$counts = null\n$v = (if $rows and $counts then $rows.map((r) -> String($counts.get(r))).join(',') else '-')\n@direct = -> ${IG('$counts')}\n@suppr = -> '-'\n</script>\n<p class="v">{$v}</p>\n`,
  'fam-state': `<script>\nst = µ.state({rows: [{nom: 'a'}, {nom: 'bb'}], m: null})\nst.m = new Map([[st.rows[0], 1], [st.rows[1], 2]])\n@direct = -> ${IG('st.m')}\n${SUPPR('st.m')}\n</script>\n<p class="v">-</p>\n`,
  'fam-store': `<script>\ns = new µ.Store({rows: [{nom: 'a'}, {nom: 'bb'}], m: null}).data\ns.m = new Map([[s.rows[0], 1], [s.rows[1], 2]])\n@direct = -> ${IG('s.m')}\n${SUPPR('s.m')}\n</script>\n<p class="v">-</p>\n`,
  'fam-dollar': `<script>\n$$frows = [{nom: 'a'}, {nom: 'bb'}]\n$$fm = new Map([[$$frows[0], 1], [$$frows[1], 2]])\n@direct = -> ${IG('$$fm')}\n${SUPPR('$$fm')}\n</script>\n<p class="v">-</p>\n`,
  'fam-mixte': `<script>\n$$xrows = [{nom: 'a'}, {nom: 'bb'}]\n$m = new Map([[$$xrows[0], 1], [$$xrows[1], 2]])\n$v = ${IG('$m')}\n@direct = -> ${IG('$m')}\n${SUPPR('$m')}\n</script>\n<p class="v">{$v}</p>\n`,
  'fam-mixte2': `<script>\n$rows = [{nom: 'a'}, {nom: 'bb'}]\n$$ym = new Map([[$rows[0], 1], [$rows[1], 2]])\n@direct = -> ${IG('$$ym')}\n${SUPPR('$$ym')}\n</script>\n<p class="v">-</p>\n`,
  'fam-niche': `<script>\nzr = µ.state({rows: [{nom: 'a'}, {nom: 'bb'}]}).rows\n$o = {m: new Map([[zr[0], 1], [zr[1], 2]])}\n$v = ${IG('$o.m')}\n@direct = -> ${IG('$o.m')}\n${SUPPR('$o.m')}\n</script>\n<p class="v">{$v}</p>\n`,
  'fam-copie': `<script>\nr0 = {nom: 'a'}\n$rows = [r0, {nom: 'bb'}]\n$m = new Map()\n@copier = ->\n  $m.set($rows[0], 1)\n  $m.set($rows[1], 2)\n  $m = new Map($m)\n$v = ${IG('$m')}\n@direct = -> ${IG('$m')}\n@brut = -> String($m.get(r0)) + '/' + String($m.has(r0))\n@brutSet = ->\n  $m.set(r0, 5)\n  String($m.size) + '/' + String($m.get($rows[0]))\n@brutDel = -> String($m.delete(r0)) + '/' + String($m.size)\n${SUPPR('$m')}\n</script>\n<p class="v">{$v}</p>\n`,
  'fam-set': `<script>\n$rows = [{nom: 'a'}, {nom: 'bb'}]\n$s = null\n@remplir = -> $s = new Set([$rows[0]])\n@direct = ->\n  $s.add($rows[0])\n  String($s.size) + '/' + [...$s].map((x) -> x.nom).join(',')\n@suppr = ->\n  r = $s.delete($rows[0])\n  String(r) + '/' + String($s.size)\n</script>\n<p class="v">-</p>\n`,
  'fam-set-niche': `<script>\n$rows = [{nom: 'a'}]\nr = $rows\n$o = {s: new Set([r[0]])}\n@direct = ->\n  $o.s.add($rows[0])\n  String($o.s.size)\n@suppr = -> String($o.s.delete($rows[0])) + '/' + String($o.s.size)\n</script>\n<p class="v">-</p>\n`,
  'fam-set-store': `<script>\ns = new µ.Store({rows: [{nom: 'a'}], e: null}).data\ns.e = new Set([s.rows[0]])\n@direct = ->\n  s.e.add(s.rows[0])\n  String(s.e.size)\n@suppr = -> String(s.e.delete(s.rows[0])) + '/' + String(s.e.size)\n</script>\n<p class="v">-</p>\n`
}
export const RACINES = ['fam-comp', 'fam-comp2', 'fam-parent', 'fam-parent2', 'fam-parent3', 'fam-state', 'fam-store', 'fam-dollar', 'fam-mixte', 'fam-mixte2', 'fam-niche', 'fam-copie', 'fam-set', 'fam-set-niche', 'fam-set-store']
export const SCENARIO_FAMILLES = `(async () => {
  const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))
  const attendre = async (f) => { const fin = Date.now() + 4000; while (!f() && Date.now() < fin) await pause(10) }
  const essai = (f) => { try { return String(f()) } catch (e) { return 'ERREUR ' + e.message } }
  const ecran = (el) => el._shadow.querySelector('.v').textContent
  const classe = (el) => { const v = el._mjs_computeds?.v; return v ? (v._mjs_src === null ? 'H' : Array.isArray(v._mjs_src) ? 'P' : 'C') : '-' }
  const fam = {}
  for (const n of ${JSON.stringify(RACINES)}) fam[n] = document.body.appendChild(document.createElement('mjs-' + n))
  for (const n in fam) await attendre(() => fam[n]._shadow?.querySelector('.v'))
  await pause(100)
  fam['fam-copie'].copier(); fam['fam-parent2'].remplir(); fam['fam-comp2'].remplir(); fam['fam-set'].remplir()
  await pause(100)
  fam['fam-enfant'] = fam['fam-parent']._shadow.querySelector('mjs-fam-enfant')
  fam['fam-enfant2'] = fam['fam-parent2']._shadow.querySelector('mjs-fam-enfant')
  fam['fam-enfant3'] = fam['fam-parent3']._shadow.querySelector('mjs-fam-enfant3')
  await attendre(() => ['fam-enfant', 'fam-enfant2', 'fam-enfant3'].every((n) => fam[n]?._shadow?.querySelector('.v')))
  await pause(60)
  const F = {}
  for (const n in fam) if (!n.startsWith('fam-parent')) F[n] = [essai(() => fam[n].direct()), ecran(fam[n])]
  F['fam-niche'].push(classe(fam['fam-niche']))
  F['fam-copie'].push(essai(() => fam['fam-copie'].brut()))
  for (const n in fam) if (!n.startsWith('fam-parent')) F[n].push(essai(() => fam[n].suppr()))
  fam['fam-copie'].copier()
  F['fam-copie'].push(essai(() => fam['fam-copie'].brutSet()))
  fam['fam-copie'].copier()
  F['fam-copie'].push(essai(() => fam['fam-copie'].brutDel()))
  return F
})()`
// [direct, écran, (classe de la valeur, fam-niche), (copie : get / has par l'objet brut), suppr, (copie : set puis delete par l'objet brut)]
const ATTENDU_FAMILLES: Record<string, string[]> = {
  'fam-comp': ['1o,2o', '1o,2o', 'true/2'],
  'fam-comp2': ['1o,2o', '1o,2o', 'true/1'],
  'fam-state': ['1o,2o', '-', 'true/1'],
  'fam-store': ['1o,2o', '-', 'true/1'],
  'fam-dollar': ['1o,2o', '-', 'true/1'],
  'fam-mixte': ['1o,2o', '1o,2o', 'true/2'],
  'fam-mixte2': ['1o,2o', '-', 'true/1'],
  'fam-niche': ['1o,2o', '1o,2o', 'H', 'true/1'],
  'fam-copie': ['1o,2o', '1o,2o', '1/true', 'true/1', '2/5', 'true/1'],
  'fam-set': ['1/a', '-', 'true/0'],
  'fam-set-niche': ['1', '-', 'true/0'],
  'fam-set-store': ['1', '-', 'true/0'],
  'fam-enfant': ['1o,2o', '1o,2o', 'true/1'],
  'fam-enfant2': ['1o,2o', '1o,2o', 'true/1'],
  'fam-enfant3': ['10o,20o', '10,20', '-']
}

// relevé du scénario rendu comparable, et ce qu'il doit valoir : la classe de la valeur de `fam-niche` ne se relève qu'avec l'enveloppe,
// en développement (sans enveloppe, la clé n'en a pas)
export function familles(F: Record<string, string[]>, prod: boolean, proxy: boolean): [Record<string, string[]>, Record<string, string[]>] {
  const garde = proxy && !prod
  if (!garde) F['fam-niche'].splice(2, 1)
  return [F, { ...ATTENDU_FAMILLES, 'fam-niche': garde ? ATTENDU_FAMILLES['fam-niche'] : ['1o,2o', '1o,2o', 'true/1'] }]
}
