// clé calculée à la racine de l'état (`$[c.nom].x`) et du magasin (`µ.store[k].x`), venue de données : deux composants courts, le
// scénario joué dans la page (happy-dom ou vrai navigateur) et ce qu'il doit rendre

// gestionnaire générique d'un formulaire : la clé est une expression (`c.nom`), la valeur vient du dehors
export const COMPOSANT_ETAT = `<script lang="js">
$fiche = { valeur: '', n: 0 };
this.poser = function(c, v) { $[c.nom].valeur = v; };
this.retirer = function(c) { delete $[c.nom].valeur; };
this.plusUn = function(c) { $[c.nom].n++; };
this.ajouter = function(c, v) { $[c.nom].n += v; };
this.lire = function() { return JSON.stringify($fiche); };
</script>
<p>{$fiche.valeur}-{$fiche.n}</p>
`

// la forme que la page des magasins conseille pour une clé calculée : `µ.store[k]`
export const COMPOSANT_MAGASIN = `<script lang="js">
$$fiche = { valeur: '', n: 0 };
this.poser = function(k, v) { µ.store[k].valeur = v; };
this.retirer = function(k) { delete µ.store[k].valeur; };
this.plusUn = function(k) { µ.store[k].n++; };
this.ajouter = function(k, v) { µ.store[k].n += v; };
this.lire = function() { return JSON.stringify($$fiche); };
</script>
<p>{$$fiche.valeur}-{$$fiche.n}</p>
`

// l'argument qui porte la clé, écrit dans le scénario
export const CLE_ETAT    = (nom: string) => `{ nom: '${nom}' }`
export const CLE_MAGASIN = (nom: string) => `'${nom}'`

// les quatre formes par la clé `__proto__`, chacune relevée puis effacée (la suivante part d'un prototype propre), puis les mêmes par
// une clé juste ; rend en JSON ce que chaque forme a laissé dans Object.prototype (`garde` : le témoin posé avant `delete` y est
// resté) et la fiche écrite par la clé juste
export const scenario = (balise: string, cle: (nom: string) => string) => `(() => {
  const e    = document.querySelector('${balise}')
  const P    = Object.prototype
  const pose = (nom) => { const a = P.hasOwnProperty(nom); Reflect.deleteProperty(P, nom); return a }
  e.poser(${cle('__proto__')}, 'pollue')
  const egal = pose('valeur')
  e.plusUn(${cle('__proto__')})
  const plusUn = pose('n')
  e.ajouter(${cle('__proto__')}, 2)
  const ajoute = pose('n')
  P.valeur = 'temoin'
  e.retirer(${cle('__proto__')})
  const garde = pose('valeur')
  e.poser(${cle('fiche')}, 'ok')
  e.plusUn(${cle('fiche')})
  e.ajouter(${cle('fiche')}, 2)
  return JSON.stringify({ egal, plusUn, ajoute, garde, fiche: e.lire() })
})()`

// le texte rendu par le composant
export const ecran = (balise: string) => `document.querySelector('${balise}')._shadow.querySelector('p').textContent`

export const ATTENDU = { egal: false, plusUn: false, ajoute: false, garde: true, fiche: '{"valeur":"ok","n":3}' }
