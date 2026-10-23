// mjs_fx_fluid — `*fluid` : une encre colorée qui tourbillonne sous la souris, au fond de la balise,
// sous son contenu (une toile, dans le composant si la balise en est un). Un petit moteur de fluide en
// WebGL, écrit pour l'occasion : une grille de vitesses qu'on transporte par elle-même, qu'on rend
// presque sans divergence par quelques passes de pression, et une encre que ces vitesses emportent.
// La matière ne se tasse ni ne se creuse de plus de quelques pour cent : l'encre, sans effacement, garde
// de 97,7 à 98,9 % de sa masse en deux secondes de calme à `detail` 16, 32, 64 et 128 (45 à 62 % sans la
// projection) ; mais la divergence qui reste après la projection vaut 31 % de celle d'avant à `detail`
// 16, 18 % à 32, 25 % à 64 et 49 % à 128 (contre 27, 11, 5 et 15 % en résolvant la pression à fond :
// le laplacien à cinq points de la pression et les différences centrées à une case de part et d'autre
// ne se composent pas exactement, et au-delà de 64 le plafond de 24 allers-retours ne suffit plus).
// Chaque geste ajoute une tache de vitesse et dépose une dose d'encre : une couleur en lumière et une exposition qui s'ajoute (jusqu'à 6) et
// s'efface comme l'encre. La couleur de la dose recouvre celle en place (une couleur sombre reste sombre, aucune n'est plus claire que
// demandée, brasser longtemps ne blanchit pas) ; sans couleurs imposées la teinte est vive et glisse le long du trait.
// La dose suit la longueur du geste : un trait deux fois plus long dépose deux fois plus d'encre, quel que soit le nombre d'évènements.
// L'affichage suit l'exposition de près : l'encre garde sa couleur pleine tant que l'exposition dépasse FULL puis s'éteint avec elle (une
// seconde après un balayage il reste environ 7 % de la lumière de la fin du geste). Le halo est de la lumière ajoutée à celle de l'encre : un
// voile serré autour d'elle, qui retombe avec elle.
// Les tourbillons sont resserrés, l'encre s'efface, le mouvement se calme. WebGL2,
// sinon WebGL1 avec les textures demi-flottantes ; sans l'un ni l'autre, l'effet ne pose rien et prévient une fois.
// Réglages : colors (principal : les encres, `[#ff3d81, #3dc8ff]` ; sans elles, une teinte vive tirée au
// hasard à chaque geste qui reprend après une pause de 0,3 s, puis glissant le long du trait ; une couleur écrite avec var(…) est lue
// dans la portée de la balise, une qui ne se résout pas est écartée avec un avertissement), where (box :
// le fluide remplit la balise ; text : il ne se voit qu'à travers les lettres du texte de la balise, qui
// reste du vrai texte, sélectionnable et lu à l'écran ; les lettres gardent la couleur de leur élément, transparence comprise, et l'encre coule dedans — sur un composant, son texte n'étant pas dans la
// balise, text ne s'applique pas : le fluide s'y pose en box et un avertissement le dit ; box), auto (le fluide bouge tout seul : des gestes au
// hasard, deux par seconde environ, de 200 à 300 px, que la souris interrompt ; non), size (la taille
// d'une tache d'encre, en % de la surface de la balise ; 0.5), strength (la force d'un geste ; 1000),
// fade (la vitesse à laquelle l'encre s'efface, par seconde ; 2 ; avec 0 l'encre ne s'efface plus, mais la
// boucle s'arrête quand même une fois le mouvement calmé, délai tiré de `friction` : elle reste affichée,
// figée), friction (la vitesse à laquelle le mouvement se calme, en part de la vitesse perdue par seconde ; 1 ;
// à 0 le frottement propre disparaît, mais le transport de l'eau perd encore environ 40 % de la vitesse
// par seconde : l'eau ne tourne pas sans fin), curl (les tourbillons ; 4 ; un remous se resserre vers son cœur, de plus en plus vite
// quand curl croît, avec des rendements décroissants sur 0 à 50 : plus il est fort, plus les tourbillons sont compacts et durent ; le
// champ reste lisse sur toute la plage et, sans geste, le mouvement décroît toujours, au frottement par défaut ; à friction 0 le renfort ne s'applique pas et curl ne fait plus rien), glow (le halo des zones vives, jusqu'à un voile sur toute la balise ; 0 : aucune passe ; 0.5), rays (les rayons de lumière qui partent de l'encre,
// 0 : aucune passe ; 0.6), detail (la finesse du mouvement : le côté court de la grille des vitesses ;
// 32), quality (la finesse de l'encre : le côté court de la grille de l'encre ; 512), resolution (le plafond de la densité de pixels de la
// toile, de 0.5 à 4 : sur un écran très fin elle ne dépasse pas cette fois la taille CSS ; 1.5), background (le
// fond de la toile ; une couleur CSS, transparence comprise (`rgba(0, 0, 0, .5)`, `#0008`, `var(--x)`) : en box tout ce que le CSS accepte comme fond (une image, un dégradé), en `where: text` une couleur seule, que le navigateur
// résout dans le contexte de la balise (`currentColor` est la couleur du texte de la balise, `light-dark()` suit son schéma de couleurs, `color-mix()` et `var()` se lisent comme en CSS) ; non écrit : aucun, la toile est transparente et laisse voir le fond de la balise, seule l'encre
// se dessine, avant tout geste comme une fois l'encre effacée, et en `where: text` les lettres gardent la couleur de leur élément ; écrit, en box il colore la toile, par-dessus le fond de la balise (son image comprise),
// sous l'encre et sous le contenu ; en `where: text` la toile n'a pas de fond : il remplit les lettres à la place de la couleur du texte (toutes, transparence comprise ; l'encre coule par-dessus, dans les lettres) ; un texte que
// le CSS refuse vaut « rien d'écrit » (en box la toile reste transparente, en texte les lettres gardent la couleur du texte ; en texte un dégradé ou une image aussi), avec un avertissement au développement, une fois par balise et par valeur), on (hover : la souris brasse dès
// qu'elle bouge ; click : seulement bouton enfoncé ou doigt posé ; hover).
// Rien ne tourne au repos : la boucle (une seule) s'arrête d'elle-même quand l'encre est effacée
// (délai tiré de `fade`, sans relire la toile) et repart au premier geste, sur une eau remise au repos ;
// elle s'arrête aussi hors écran et dans un onglet caché ; `auto` ne tourne qu'à l'écran. La dernière image d'une série est redessinée une fois,
// seule (une passe), à l'image suivante : certains WebKit montrent une image WebGL (sans antialias ni tampon conservé) avec une image de retard, et le texte
// posé ou les taches figées resteraient sans cela invisibles. Hors écran, aucune
// image n'est demandée, quoi qu'il arrive (la balise change de taille, la fenêtre aussi, un réglage change, la
// souris quitte la balise) : l'image due est refaite au retour à l'écran, taille relue. Le contexte
// WebGL n'est créé qu'au premier besoin (premier geste ; la balise vue à l'écran pour `where: text`,
// `auto` ou « réduire les animations »), rendu au retrait ; une perte de contexte arrête l'effet
// proprement, qui reprend au retour du contexte. Une balise qui n'obtient pas de contexte (le navigateur
// en limite le nombre par page, une quinzaine) reste comme sans effet — son fond et son texte d'origine,
// sans toile — avec un avertissement, et retente à son prochain réveil (entrée de la souris, retour à
// l'écran, départ de `auto`). La boîte de la balise se lit à l'entrée de la souris et se relit après un
// changement de taille, un redimensionnement de la fenêtre ou un défilement : jamais à chaque
// mouvement. Les textures ne dépendent pas de la taille de la balise (de sa forme, à la pose) ; la toile
// suit la balise (densité d'écran bornée par `resolution`). `where: text` : les lettres sont dessinées dans une
// texture de masque (police et couleur calculées de chaque élément qui porte du texte, une boîte par mot lue par les rectangles du texte), que l'affichage lit : au repos les lettres ont la couleur du
// texte (transparence comprise), l'encre les recouvre selon son opacité (une couleur de texte translucide atténue d'autant l'encre) ; un `background` écrit remplit les lettres à la place de cette couleur (le masque n'est plus que leur couverture, et la couleur du texte n'est plus suivie). Le masque est refait à chaque changement de taille, de
// texte ou de police, et à chaque réveil dont la typographie ou la couleur du texte (police, graisse, taille, interlettre, alignement,
// hauteur de ligne, casse, sens, couleur) a changé sans que la boîte bouge ; la couleur est suivie aussi au repos : à la bascule du thème
// (tout attribut de <html> ou de <body> : `data-mjs-theme`, `data-theme`, `class`, `style`…, un seul guetteur pour toutes les balises, dont les relectures sont regroupées : une au plus toutes les 150 ms, la dernière jamais perdue ; il lit aussi la fin d'une transition de `color` de la page), au changement de `class` ou de
// `style` de la balise ou d'un descendant, à la bascule du schéma de couleurs du système, et image par image pendant une transition de `color`
// de la balise ou d'un descendant (hors écran rien : l'image due est refaite au retour). Un changement de typographie qui arrive pendant que la boucle
// tourne attend le réveil suivant ; un ancêtre intermédiaire qui change de classe ou de style sans transition aussi, et la couleur d'une transition posée sur un ancêtre n'est lue qu'à sa fin ; pas les pseudo-éléments. « Réduire les
// animations » : aucun mouvement, quelques taches posées une fois, figées (la couleur du texte reste suivie, mais lue seulement à la fin d'une transition).
// Effet lourd : suivi par les effets économes (la grille de l'encre au tiers, ni halo ni rayons).
// Sections marquées (`// @@ where=text`, filtrées par le build, bundler/fx-sections.ts) : tout ce qui ne sert qu'au mode texte (le masque des lettres, la signature de la typographie, le guetteur du thème, la lecture
// du fond écrit, la branche du programme d'affichage, le suivi des transitions de couleur) ne part en production que si une page écrit `where: text` ou un `where` que le build ne sait pas lire ; en développement tout est gardé.
// Limites du mode texte : un texte à dégradé (lettres transparentes sur un fond découpé) n'est pas repris ; un `-webkit-text-fill-color`, une `opacity`, une ombre ou un contour propres à un élément du titre non plus ; le soulignement
// d'un lien est perdu ; à la densité 2 les bords des lettres sont plus doux (la toile est plafonnée par `resolution`), l'écriture de droite à gauche décale les lettres d'environ 1 px dans Firefox, la seconde ligne d'un titre est décalée
// d'environ 1 px, le moteur de Safari décale les arêtes verticales d'un demi-pixel.

(function() {
  var HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\nprecision highp sampler2D;\n#else\nprecision mediump float;\nprecision mediump sampler2D;\n#endif\n';
  // la pose du triangle qui couvre la cible, et la coordonnée du point passée au programme de points : les voisins
  // d'une case se lisent dans chaque programme de points, par un décalage d'une case (`uTexel`) autour du point
  var VERT = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = aPos * 0.5 + 0.5;',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');
  // la vitesse est en côtés courts de la grille par seconde (`uSide` : le côté d'une case dans cette unité) ; chaque
  // passe qui dérive ou qui ajoute des cases prend ses voisins par différences centrées
  // le tourbillon w = dv/dx - du/dy, en 1/s
  var F_SPIN = [
    'varying vec2 vUv;',
    'uniform sampler2D uVel;',
    'uniform vec2 uTexel;',
    'uniform float uSide;',
    'void main() {',
    '  vec2 ex = vec2(uTexel.x, 0.0);',
    '  vec2 ey = vec2(0.0, uTexel.y);',
    '  float dvdx = texture2D(uVel, vUv + ex).y - texture2D(uVel, vUv - ex).y;',
    '  float dudy = texture2D(uVel, vUv + ey).x - texture2D(uVel, vUv - ey).x;',
    '  gl_FragColor = vec4((dvdx - dudy) * 0.5 / uSide, 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');
  // le tourbillon adouci : w et |w| moyennés sur 3 × 3 cases (poids 1 2 1) ; le renfort lit cette version, pour ne pas voir le
  // bruit de la taille d'une case (le damier est entièrement effacé par cette moyenne)
  var F_SOFTEN = [
    'varying vec2 vUv;',
    'uniform sampler2D uSpin;',
    'uniform vec2 uTexel;',
    'void main() {',
    '  vec2 sum = vec2(0.0);',
    '  for (int j = -1; j <= 1; j++) {',
    '    for (int i = -1; i <= 1; i++) {',
    '      float k = (2.0 - abs(float(i))) * (2.0 - abs(float(j)));',
    '      float w = texture2D(uSpin, vUv + vec2(float(i), float(j)) * uTexel).x;',
    '      sum += k * vec2(w, abs(w));',
    '    }',
    '  }',
    '  gl_FragColor = vec4(sum / 16.0, 0.0, 1.0);',
    '}'
  ].join('\n');
  // le renfort des tourbillons : les remous que le calcul étale sont resserrés. `slope` = le gradient de |w| adouci (en 1/s par
  // case), qui pointe vers le cœur du remous ; `n` le normalise, mais avec une douceur (`uEase` × |w| du point) : près du cœur, là où
  // le gradient s'annule, `n` s'annule avec lui au lieu de changer de sens d'une case à l'autre, et le remous se pose au lieu de
  // vibrer. L'élan ajouté tourne dans le sens du tourbillon et vaut `uKick` × w : il déplace le tourbillon vers son cœur
  var F_BOOST = [
    'varying vec2 vUv;',
    'uniform sampler2D uVel;',
    'uniform sampler2D uSoft;',
    'uniform vec2 uTexel;',
    'uniform float uKick;',
    'uniform float uEase;',
    'uniform float uCap;',
    'float mag(float i, float j) {',
    '  return texture2D(uSoft, vUv + vec2(i, j) * uTexel).y;',
    '}',
    'void main() {',
    '  vec2 here = texture2D(uSoft, vUv).xy;',
    '  vec2 slope = 0.5 * vec2(mag(1.0, 0.0) - mag(-1.0, 0.0), mag(0.0, 1.0) - mag(0.0, -1.0));',
    '  vec2 n = slope / (length(slope) + uEase * here.y + 0.0001);',
    '  vec2 v = texture2D(uVel, vUv).xy;',
    '  gl_FragColor = vec4(clamp(v + uKick * here.x * vec2(n.y, -n.x), -uCap, uCap), 0.0, 1.0);',
    '}'
  ].join('\n');
  // la divergence d = du/dx + dv/dy, en 1/s. Les parois : le point courant sait qu'il est au bord de la grille par sa
  // place (première ou dernière case d'une ligne ou d'une colonne) ; la case voisine qui sortirait de la grille rend
  // alors la vitesse normale opposée à la sienne, la vitesse au bord est nulle et le fluide ne le traverse pas
  var F_SPREAD = [
    'varying vec2 vUv;',
    'uniform sampler2D uVel;',
    'uniform vec2 uTexel;',
    'uniform float uSide;',
    'void main() {',
    '  vec2 c = texture2D(uVel, vUv).xy;',
    '  float l = vUv.x < uTexel.x ? -c.x : texture2D(uVel, vUv - vec2(uTexel.x, 0.0)).x;',
    '  float r = vUv.x > 1.0 - uTexel.x ? -c.x : texture2D(uVel, vUv + vec2(uTexel.x, 0.0)).x;',
    '  float b = vUv.y < uTexel.y ? -c.y : texture2D(uVel, vUv - vec2(0.0, uTexel.y)).y;',
    '  float t = vUv.y > 1.0 - uTexel.y ? -c.y : texture2D(uVel, vUv + vec2(0.0, uTexel.y)).y;',
    '  gl_FragColor = vec4(((r - l) + (t - b)) * 0.5 / uSide, 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');
  // la pression : le laplacien de p vaut la divergence. Relaxation successive en damier : une passe met à jour les cases
  // d'une couleur (`uColor`), la suivante celles de l'autre, qui voient déjà le travail de la première ; chaque case
  // prend la moyenne de ses quatre voisines, corrigée de la divergence, et va `uOver` fois plus loin que cette moyenne.
  // Hors de la grille la pression est celle de la case du bord (la texture répète son bord) : aucune poussée au mur.
  // `uKeep` : la part de la pression de l'image précédente gardée comme point de départ (1 après la première passe)
  var F_RELAX = [
    'varying vec2 vUv;',
    'uniform sampler2D uPress;',
    'uniform sampler2D uSpread;',
    'uniform vec2 uTexel;',
    'uniform float uSide;',
    'uniform float uKeep;',
    'uniform float uOver;',
    'uniform float uColor;',
    'void main() {',
    '  float c = texture2D(uPress, vUv).x * uKeep;',
    '  vec2 cell = floor(vUv / uTexel);',
    '  if (abs(mod(cell.x + cell.y, 2.0) - uColor) > 0.5) gl_FragColor = vec4(c, 0.0, 0.0, 1.0);',
    '  else {',
    '    float s = texture2D(uPress, vUv + vec2(uTexel.x, 0.0)).x + texture2D(uPress, vUv - vec2(uTexel.x, 0.0)).x + texture2D(uPress, vUv + vec2(0.0, uTexel.y)).x + texture2D(uPress, vUv - vec2(0.0, uTexel.y)).x;',
    '    float mean = (s * uKeep - uSide * uSide * texture2D(uSpread, vUv).x) * 0.25;',
    '    gl_FragColor = vec4(c + uOver * (mean - c), 0.0, 0.0, 1.0);',
    '  }',
    '}'
  ].join('\n');
  // la projection : la vitesse perd le gradient de la pression (différences centrées sur deux cases), le champ n'a plus
  // de divergence ; bornée par `uCap` comme au transport
  var F_PROJECT = [
    'varying vec2 vUv;',
    'uniform sampler2D uVel;',
    'uniform sampler2D uPress;',
    'uniform vec2 uTexel;',
    'uniform float uSide;',
    'uniform float uCap;',
    'void main() {',
    '  float dpdx = texture2D(uPress, vUv + vec2(uTexel.x, 0.0)).x - texture2D(uPress, vUv - vec2(uTexel.x, 0.0)).x;',
    '  float dpdy = texture2D(uPress, vUv + vec2(0.0, uTexel.y)).x - texture2D(uPress, vUv - vec2(0.0, uTexel.y)).x;',
    '  gl_FragColor = vec4(clamp(texture2D(uVel, vUv).xy - vec2(dpdx, dpdy) * 0.5 / uSide, -uCap, uCap), 0.0, 1.0);',
    '}'
  ].join('\n');
  // le transport : la valeur d'un point vient de l'endroit d'où le fluide arrive. Le retour en arrière se fait en deux
  // demi-pas (le second avec la vitesse lue à mi-chemin), `uStep` = dt / l'étendue de la grille par axe ; la valeur est lue
  // avec l'interpolation de la texture, puis amortie de `uKeep` = exp(-k dt) et bornée par `uCap`
  var F_CARRY = [
    'varying vec2 vUv;',
    'uniform sampler2D uVel;',
    'uniform sampler2D uSrc;',
    'uniform vec2 uStep;',
    'uniform float uKeep;',
    'uniform float uCap;',
    'void main() {',
    '  vec2 mid = vUv - 0.5 * uStep * texture2D(uVel, vUv).xy;',
    '  vec2 from = vUv - uStep * texture2D(uVel, mid).xy;',
    '  vec4 s = texture2D(uSrc, from) * uKeep;',
    '  gl_FragColor = vec4(clamp(s.rgb, -uCap, uCap), clamp(s.a, 0.0, uCap));',
    '}'
  ].join('\n');
  // les gestes : jusqu'à 16 taches par passe, chacune une gaussienne exp(-r² / (2σ²)) autour du point `uAt` ; `uShape` =
  // 1 / (2σ²) pour chaque axe du repère de la balise (qui n'est pas carrée). Chaque tache porte `uAdd` : une couleur en lumière (xyz)
  // et sa dose (w). La vitesse (`uMix` = 0) reçoit l'apport tel quel, il s'ajoute. L'encre (`uMix` = 1) porte la couleur en lumière et
  // son exposition (a) : l'exposition s'ajoute (la dose, jusqu'à `uPeak`), et la couleur glisse vers celle de la tache à proportion de
  // la dose × `uCover` (au cœur, celle en place cède la place : une suite de taches atteint la couleur demandée sans la dépasser,
  // brasser longtemps ne blanchit pas, une couleur sombre reste sombre)
  var F_DROP = [
    'varying vec2 vUv;',
    'uniform sampler2D uSrc;',
    'uniform int uCount;',
    'uniform vec2 uAt[16];',
    'uniform vec4 uAdd[16];',
    'uniform vec2 uShape;',
    'uniform float uMix;',
    'uniform float uPeak;',
    'uniform float uCover;',
    'void main() {',
    '  vec4 q = texture2D(uSrc, vUv);',
    '  for (int i = 0; i < 16; i++) {',
    '    if (i >= uCount) break;',
    '    vec2 d = vUv - uAt[i];',
    '    float g = exp(-dot(d * d, uShape));',
    '    if (uMix > 0.5) {',
    '      float dose = uAdd[i].a * g;',
    '      vec3 old = q.a > 0.0001 ? q.rgb / q.a : uAdd[i].rgb;',
    '      float more = min(uPeak, q.a + dose);',
    '      float part = uCover > 0.0 ? min(1.0, dose * uCover) : dose / (q.a + dose + 0.0001);',
    '      q = vec4(mix(old, uAdd[i].rgb, part) * more, more);',
    '    }',
    '    else q.xyz += uAdd[i].rgb * g;',
    '  }',
    '  gl_FragColor = q;',
    '}'
  ].join('\n');
  // l'affichage : l'encre, pleine tant que son exposition dépasse `uFull` puis éteinte avec elle (le halo s'ajoute à sa lumière, les rayons à la
  // couleur affichée, la lumière étant la couleur au carré), rendue en alpha prémultiplié (en box le fond écrit est celui de la toile, en CSS ; sans lui celui de la balise se voit à travers, aucun calcul au repos) ; en texte, le masque porte la
  // couleur des lettres (texture prémultipliée, cf. loadMask) : l'encre, clippée à l'opacité des lettres, recouvre cette couleur selon la sienne ; avec un fond écrit (`uFill`) le masque n'est que la couverture des lettres : la couleur écrite les remplit à la place, l'encre la recouvrant selon son opacité
  var F_SHOW = [
    'varying vec2 vUv;',
    'uniform sampler2D uInk;',
    'uniform float uFull;',
    'uniform float uTail;',
    '#ifdef GLOW',
    'uniform sampler2D uGlow;',
    'uniform float uGlowAmt;',
    '#endif',
    '#ifdef RAYS',
    'uniform sampler2D uRays;',
    'uniform float uRaysAmt;',
    '#endif',
    // @@ where=text
    '#ifdef MASK',
    'uniform sampler2D uMask;',
    'uniform vec4 uBack;',
    'uniform float uFill;',
    '#endif',
    // @@
    'void main() {',
    '  vec4 lit = texture2D(uInk, vUv);',
    '  vec3 light = lit.rgb / max(uFull, lit.a) * pow(min(1.0, lit.a / uFull), uTail);',
    '#ifdef GLOW',
    '  light += texture2D(uGlow, vUv).rgb * uGlowAmt;',
    '#endif',
    '  vec3 ink = sqrt(light);',
    '#ifdef RAYS',
    '  ink += texture2D(uRays, vUv).rgb * uRaysAmt;',
    '#endif',
    '  float m = max(ink.r, max(ink.g, ink.b));',
    '  float a = min(m, 1.0);',
    '  ink *= 1.0 / max(1.0, m);',
    '  vec4 o = vec4(ink, a);',
    // @@ where=text
    '#ifdef MASK',
    '  vec4 pen = texture2D(uMask, vUv);',
    '  if (uFill > 0.5) o = vec4(ink + uBack.rgb * uBack.a * (1.0 - a), a + uBack.a * (1.0 - a)) * pen.a;',
    '  else o = vec4(ink * pen.a + pen.rgb * (1.0 - a), pen.a);',
    '#endif',
    // @@
    '  gl_FragColor = o;',
    '}'
  ].join('\n');
  // le seuil du halo : la lumière stockée de l'encre, moins `uKnee` sur sa composante la plus forte (rien en dessous : un filet pâle ne
  // fait pas de halo), la teinte gardée ; la lumière n'est pas bornée, un cœur surexposé nourrit un grand halo
  var F_CUT = [
    'varying vec2 vUv;',
    'uniform sampler2D uSrc;',
    'uniform float uKnee;',
    'void main() {',
    '  vec4 lit = texture2D(uSrc, vUv);',
    '  float m = max(lit.r, max(lit.g, lit.b));',
    '  gl_FragColor = vec4(lit.rgb * (max(m - uKnee, 0.0) / (m + 0.0001)), 1.0);',
    '}'
  ].join('\n');
  var F_DOWN = [
    'varying vec2 vUv;',
    'uniform sampler2D uSrc;',
    'uniform vec2 uTexel;',
    'void main() {',
    '  vec3 s = texture2D(uSrc, vUv + vec2(-uTexel.x, -uTexel.y)).rgb + texture2D(uSrc, vUv + vec2(uTexel.x, -uTexel.y)).rgb;',
    '  s += texture2D(uSrc, vUv + vec2(-uTexel.x, uTexel.y)).rgb + texture2D(uSrc, vUv + vec2(uTexel.x, uTexel.y)).rgb;',
    '  gl_FragColor = vec4(s * 0.25, 1.0);',
    '}'
  ].join('\n');
  var F_UP = [
    'varying vec2 vUv;',
    'uniform sampler2D uSrc;',
    'uniform vec2 uTexel;',
    'uniform float uWeight;',
    'void main() {',
    '  vec2 o = uTexel * 0.5;',
    '  vec3 s = texture2D(uSrc, vUv + vec2(-o.x, -o.y)).rgb + texture2D(uSrc, vUv + vec2(o.x, -o.y)).rgb;',
    '  s += texture2D(uSrc, vUv + vec2(-o.x, o.y)).rgb + texture2D(uSrc, vUv + vec2(o.x, o.y)).rgb;',
    '  gl_FragColor = vec4(s * 0.25 * uWeight, 1.0);',
    '}'
  ].join('\n');
  // les rayons : chaque point marche vers la source de lumière (le dernier geste) et additionne l'encre vive
  // qu'il croise, de moins en moins ; la lumière s'étire donc de la source, à travers l'encre, vers l'extérieur.
  // `vivid` = l'éclat d'une couleur, sa composante la plus forte
  var F_RAYS = [
    'varying vec2 vUv;',
    'uniform sampler2D uSrc;',
    'uniform vec2 uLight;',
    'float vivid(vec3 c) {',
    '  vec2 m = max(c.rg, c.bb);',
    '  return max(m.x, m.y);',
    '}',
    'void main() {',
    '  vec2 hop = (uLight - vUv) / 32.0;',
    '  vec2 at = vUv;',
    '  vec3 sum = vec3(0.0);',
    '  float weight = 1.0;',
    '  for (int i = 0; i < 32; i++) {',
    '    vec4 lit = texture2D(uSrc, at);',
    '    vec3 seen = sqrt(lit.rgb / max(1.0, lit.a));',
    '    sum += seen * weight * smoothstep(0.25, 0.9, vivid(seen));',
    '    at += hop;',
    '    weight *= 0.95;',
    '  }',
    '  gl_FragColor = vec4(sum / 32.0, 1.0);',
    '}'
  ].join('\n');

  // la force d'un geste : la vitesse communiquée (en côtés courts de la grille par seconde) vaut le déplacement du geste (en côtés
  // courts) × strength × GAIN. Le geste ajoute son déplacement : le total injecté par une passe de la souris ne dépend que de la taille de
  // la tache, pas de la vitesse de la souris. Réglée par la comparaison de captures avec l'allure visée (balayage, cercle,
  // trait rapide, trait lent, même geste à l'image près, à la fin du geste puis 0,5 s, 1 s et 3 s après) : à 1/140 la tache avance de 2 px en 0,2 s et de 8 px en
  // une seconde (balise de 360 × 220), le trait garde sa largeur d'un bout à l'autre et sa queue reste un ruban large et flou ; plus fort (1/80), l'eau étire
  // l'encre en un filet mince et enroulé, à 1/20 en rubans fins d'un bord à l'autre
  var GAIN = 1 / 140;
  // la dose d'encre d'une pièce de geste (au plus 0,4 rayon de tache), en exposition : elle croît avec la longueur de la pièce, pas avec la
  // cadence des évènements. Réglée sur les valeurs de référence, avec FULL, SHOW_TAIL et GAIN : à la fin d'un balayage de soixante images la lumière moyenne
  // est à 4 % près celle des valeurs de référence (0,167 contre 0,175), à +0,5 s 0,037 contre 0,033 et à +1 s 0,0115 contre 0,0121
  var INK_PIECE = 0.14;
  // la part de la couleur en place que recouvre une dose : dose × COVER (une dose d'une pièce recouvre la quasi-totalité de la couleur au
  // cœur d'une tache) ; réglée par le test des couleurs : trois tours d'une couleur sur trois tours d'une autre ne laissent qu'un cinquième de l'ancienne
  var COVER = 16;
  // l'encre garde sa couleur pleine tant que l'exposition dépasse FULL, puis s'éteint avec elle ; réglée avec INK_PIECE sur les
  // valeurs de référence (la lumière qui reste une demi-seconde puis une seconde après un balayage)
  var FULL = 1;
  // sous FULL, la lumière affichée d'une encre vaut (exposition / FULL) à cette puissance (la valeur affichée, sa racine, vaut alors l'exposition / FULL à la
  // puissance (1 + SHOW_TAIL) / 2) : 1 donne une valeur linéaire, qui s'éteint trop vite ; moins, l'encre pâle se voit un peu plus longtemps
  var SHOW_TAIL = 0.7;
  // l'exposition de crête de l'encre : elle monte jusqu'à EXPOSE au cœur d'un trait et s'efface comme l'encre ; elle fixe aussi la durée de la boucle
  var EXPOSE = 6;
  // la teinte vive d'un geste : tirée au hasard quand le geste reprend après HUE_HOLD secondes de temps simulé sans pièce, puis glissant de
  // HUE_FREE (de la roue) par pièce, le trait passe ainsi du rose au jaune en un balayage ; avec des couleurs imposées la teinte glisse le long de
  // la liste, du pas HUE_STEP par pièce de geste (un tour de la liste en quatre-vingts pièces)
  var HUE_HOLD = 0.3;
  var HUE_FREE = 0.006;
  var HUE_STEP = 0.0125;
  // l'encre ne dépasse jamais cette borne (garde du demi-flottant ; au-dessus de l'exposition de crête, que la composition des taches tient)
  var INK_MAX = 8;
  // la vitesse ne dépasse jamais cette borne, par composante, en côtés courts par seconde ; réglée en brassant à l'aveugle (deux cents
  // évènements en tous sens, force 5000, tourbillons à 50) : sans borne la vitesse dépasse 12, assez pour jeter l'encre d'un bord à
  // l'autre de la balise en trois images ; 6 laisse intact un balayage ordinaire (4,5 mesuré, au défaut) ; un brassage furieux (cent cinquante
  // évènements en tous sens) touche la borne sans la dépasser
  var V_MAX = 6;
  // le renfort des tourbillons : un remous se resserre vers son cœur à une vitesse de DRIFT_MAX × curl / (curl + DRIFT_HALF) cases par
  // seconde, de 0 à DRIFT_MAX (curl 2 : 6, curl 10 : 18, curl 50 : 30) : plus curl est fort, plus les tourbillons sont compacts et durent, avec
  // des rendements décroissants sur toute la plage 0 à 50 ; un pas déplace un remous de moins d'une demi-case. SOFT règle la douceur du
  // cœur (voir F_BOOST). Mesuré sur un trait de soixante pas, à friction 1 : sans geste le mouvement décroît toujours, à tout curl de 0 à 50
  // (monotone jusqu'à 10 s) ; 2,5 s après le geste il reste 4 % de la vitesse de fin de geste à curl 0, 7 % à curl 4, 9 % à curl 50 ; la
  // rugosité du champ de vitesse (énergie du laplacien à cinq points / énergie du champ ; le bruit de case vaut 4,5) reste sous 0,3 jusqu'à
  // +1 s, et monte à 0,74 à +2,5 s à curl 50 : des cœurs de deux cases, pas du grain
  var DRIFT_MAX  = 36;
  var DRIFT_HALF = 10;
  var SOFT       = 0.5;
  // la relaxation de la pression, mesurée sur un modèle de la passe (grilles de 16 à 64 cases, écart au calcul à fond) :
  // la sur-relaxation 1,7 est la plus rapide qui ne diverge pas avec peu de passes (1,85 diverge à 4 passes sur 32 cases) ;
  // la part gardée de l'image précédente 0,97 divise l'écart par deux par rapport à repartir de zéro (à 1, l'erreur s'accumule)
  var OVER   = 1.7;
  var MEMORY = 0.97;
  // le halo vit de la lumière que l'encre garde au-delà de GLOW_KNEE (la lumière stockée, non bornée : un cœur surexposé en donne beaucoup,
  // un filet pâle rien) ; cette lumière est réduite en GLOW_LEVELS niveaux (l'allure visée en compte cinq : un halo serré autour de l'encre), remontée
  // de poids GLOW_UP par niveau, intensité GLOW_GAIN × le réglage `glow`, et ajoutée à la lumière de l'affichage. Les rayons : RAYS_GAIN × le réglage
  // `rays`. Réglés contre les valeurs de référence (médiane de l'image : 17 contre 20 à la fin d'un balayage, 7 contre 7 à 0,2 s plus tard)
  var GLOW_LEVELS = 5;
  var GLOW_KNEE = 0.12;
  var GLOW_UP   = 1;
  var GLOW_GAIN = 0.07;
  var RAYS_GAIN = 3;
  // le temps simulé qu'il faut à l'encre pour s'éteindre : l'exposition de crête tombe sous 6e-5 après ln(EXPOSE / 6e-5) e-foldings de la
  // décroissance, bien après que l'affichage s'est éteint (marge voulue : 5,8 s à `fade: 2`) ; et à la vitesse pour tomber à 1/200 de ce qu'elle
  // était (plus rien ne bouge à l'écran)
  var LIFE = Math.log(EXPOSE / 6e-5);
  var CALM = Math.log(200);
  // les points de la toile : au plus ce nombre (une balise immense reste légère)
  var MAX_PIXELS = 4194304;
  var warned     = false;
  var problem    = '';
  var support    = null;
  // les avertissements dits une seule fois pour la page : `where: text` sur un composant, plus de contexte à donner, et chaque
  // couleur qui ne se résout pas
  var textless   = false; // @@ where=text
  var crowded    = false;
  var reproved   = Object.create(null);

  function warn() {
    if (warned) return;
    warned  = true;
    var msg = µ._mjs_msg('fluidNoGl', null, '*fluid : ce navigateur ne sait pas faire tourner le fluide (WebGL avec textures demi-flottantes requis), l\'effet n\'est pas posé.');
    if (problem) µ.warn(msg, problem);
    else µ.warn(msg);
  }

  // une balise sans contexte WebGL à lui donner : le navigateur en limite le nombre par page (une quinzaine)
  function warnCrowded() {
    if (crowded) return;
    crowded = true;
    µ.warn(µ._mjs_msg('fluidNoContext', null, '*fluid : le navigateur ne donne plus de contexte WebGL à cette balise (il en limite le nombre par page, une quinzaine) — elle reste sans effet et réessaiera à son prochain survol ou quand elle reviendra à l\'écran.'));
  }

  // une couleur qui ne se résout pas (variable absente, valeur qui n'est pas une couleur) : une couleur de `colors` (dite une fois pour la page) ou le
  // fond écrit (dit une fois par balise : `seen` est alors la table de la balise)
  function warnColor(raw, seen) {
    seen = seen || reproved;
    if (seen[raw]) return;
    seen[raw] = true;
    µ.warn(µ._mjs_msg('fluidColor', { color: raw }, '*fluid : la couleur « {color} » ne se résout pas (variable absente ou valeur qui n\'est pas une couleur), elle est ignorée.'));
  }

  // @@ where=text
  // `where: text` sur un composant : son texte est dans son intérieur, pas dans la balise
  function warnComponent() {
    if (textless) return;
    textless = true;
    µ.warn(µ._mjs_msg('fluidTextComponent', null, '*fluid : sur un composant, `where: text` ne s\'applique pas (son texte est dans son intérieur, pas dans la balise) — le fluide est posé en `box` et le texte reste tel quel.'));
  }
  // @@

  function lose(gl) {
    try {
      var x = gl.getExtension('WEBGL_lose_context');
      if (x) x.loseContext();
    }
    catch { }
  }

  // les extensions qui permettent de dessiner dans des textures demi-flottantes, activées sur `gl` (à refaire
  // quand un contexte perdu revient : ses extensions sont éteintes) ; rend { internal, type } ou null
  function exts(gl, kind) {
    if (kind === 2) {
      if (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')) return { internal: gl.RGBA16F, type: gl.HALF_FLOAT };
      return null;
    }
    var half = gl.getExtension('OES_texture_half_float');
    if (half && gl.getExtension('OES_texture_half_float_linear') && gl.getExtension('EXT_color_buffer_half_float')) return { internal: gl.RGBA, type: half.HALF_FLOAT_OES };
    return null;
  }

  // un contexte sur la toile `cv`, WebGL2 d'abord ; rend { gl, kind, internal, type } si le pilote sait dessiner
  // dans des textures demi-flottantes (un petit essai le prouve), sinon null (le contexte est rendu)
  function open(cv) {
    if (!cv || typeof cv.getContext !== 'function') return null;
    var opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false };
    var gl   = null;
    var kind = 2;
    try {
      gl = cv.getContext('webgl2', opts);
      if (!gl) {
        kind = 1;
        gl   = cv.getContext('webgl', opts) || cv.getContext('experimental-webgl', opts);
      }
    }
    catch {
      gl = null;
    }
    if (!gl) return null;
    var ex = exts(gl, kind);
    var ok = false;
    if (ex) {
      var t = gl.createTexture();
      var f = gl.createFramebuffer();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ex.internal, 4, 4, 0, gl.RGBA, ex.type, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(f);
      gl.deleteTexture(t);
    }
    if (!ok) {
      lose(gl);
      return null;
    }
    return { gl: gl, kind: kind, internal: ex.internal, type: ex.type };
  }

  // le navigateur sait-il faire tourner le fluide ? essayé une fois pour la page, sur une toile jetée
  function probe() {
    if (support !== null) return support;
    support = false;
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return support;
    var o = open(document.createElement('canvas'));
    if (o) {
      support = true;
      lose(o.gl);
    }
    return support;
  }

  // une couleur CSS quelconque (color-mix, transparent…) lue par le navigateur → [r, g, b, a] de 0 à 1 ; les variables, la toile
  // ne les lit pas (cf. substitute). `strict` : null pour un texte que la toile ne comprend pas — elle garde alors la couleur
  // d'avant, que le même texte écrit après deux couleurs de départ différentes trahit
  var scratch = null;
  function paint(str, strict) {
    if (!scratch) {
      var c    = document.createElement('canvas');
      c.width  = 1;
      c.height = 1;
      scratch  = c.getContext('2d', { willReadFrequently: true });
    }
    if (!scratch) return [0, 0, 0, 1];
    scratch.clearRect(0, 0, 1, 1);
    scratch.fillStyle = '#000';
    scratch.fillStyle = str;
    if (strict) {
      var before        = scratch.fillStyle;
      scratch.fillStyle = '#fff';
      scratch.fillStyle = str;
      if (before !== scratch.fillStyle) return null;
    }
    scratch.fillRect(0, 0, 1, 1);
    var d = scratch.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
  }

  // une teinte vive (saturation et valeur pleines) → [r, g, b]
  function hsv(h) {
    var i = Math.floor(h * 6);
    var f = h * 6 - i;
    var q = 1 - f;
    switch (i % 6) {
      case 0: return [1, f, 0];
      case 1: return [q, 1, 0];
      case 2: return [0, 1, f];
      case 3: return [0, q, 1];
      case 4: return [f, 0, 1];
    }
    return [1, 0, q];
  }

  // la grille d'une texture : le côté court vaut `side`, le long côté au plus quatre fois `side` (au-delà, la
  // grille perd en finesse mais garde ses cases carrées), jamais plus de `cap` cases ni de `max` d'un côté
  function grid(side, aspect, cap, max) {
    var a  = Math.max(aspect, 1 / aspect);
    var lo = side;
    var hi = side * a;
    if (hi > 4 * side) {
      lo = 4 * side / a;
      hi = 4 * side;
    }
    var k = Math.min(1, Math.sqrt(cap / (lo * hi)), max / hi);
    lo    = Math.max(4, Math.round(lo * k));
    hi    = Math.max(lo, Math.round(hi * k));
    return aspect >= 1 ? [hi, lo] : [lo, hi];
  }

  var num = function(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; };

  // les variables d'une couleur remplacées par leur valeur, lue dans la portée de l'hôte : le style calculé d'une balise témoin,
  // posée un instant dans l'hôte, rend la propriété personnalisée qu'elle porte avec ses variables résolues (vide si l'une manque).
  // Le témoin est un calque d'effet : les observateurs de texte ne le comptent pas
  function substitute(raw, host) {
    var w = document.createElement('span');
    w.setAttribute('mjs-fx-layer', 'fluid-probe');
    w.style.setProperty('--mjs-fluid-probe', raw);
    µ._mjs_dom.insertBefore(host, w, null);
    var v = getComputedStyle(w).getPropertyValue('--mjs-fluid-probe').trim();
    w.remove();
    return v;
  }

  // les encres : une liste de couleurs CSS → [[r, g, b]…], ou null (une teinte vive à chaque geste) ; une couleur qui ne se
  // résout pas est écartée, avec un avertissement
  function inks(list, host) {
    if (!list || !list.length) return null;
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var raw = String(list[i]);
      var str = /var\(/.test(raw) ? substitute(raw, host) : raw;
      var c   = str ? paint(str, true) : null;
      if (c) out.push(c);
      else warnColor(raw);
    }
    return out.length ? out : null;
  }

  // @@ where=text
  // le masque d'un texte : les lettres de la balise, chacune dans la couleur calculée de son élément (transparence comprise) sur transparent (`plain` : en blanc, la couverture seule, pour un fond écrit),
  // dessinées dans une toile 2D de `bw` × `bh` points qui couvre la boîte de remplissage de la balise. Chaque mot du texte est placé là où
  // le navigateur l'a mis (rectangles de son `Range`, un par ligne où il passe ; une grapheme à la fois s'il se
  // coupe), avec la police calculée de son élément ; la ligne de base est celle de la police, centrée dans le
  // rectangle. Les calques des effets (`mjs-fx-layer`) n'en sont pas
  µ._mjs_fxTextMask = function(el, bw, bh, plain) {
    var cv    = document.createElement('canvas');
    cv.width  = bw;
    cv.height = bh;
    var g     = cv.getContext('2d');
    var cw    = el.clientWidth;
    var ch    = el.clientHeight;
    if (!g || !cw || !ch || typeof document.createTreeWalker !== 'function') return cv;
    var box = µ._mjs_dom.getBoundingClientRect(el);
    // une balise mise à l'échelle par un ancêtre (transformation) : les rectangles du navigateur sont à l'écran
    var sx = el.offsetWidth ? box.width / el.offsetWidth : 1;
    var sy = el.offsetHeight ? box.height / el.offsetHeight : 1;
    var ox = box.left + el.clientLeft * sx;
    var oy = box.top + el.clientTop * sy;
    g.scale(bw / cw, bh / ch);
    g.textAlign    = 'left';
    g.textBaseline = 'alphabetic';
    var walk       = document.createTreeWalker(el, 4);
    var range      = document.createRange();
    var count      = 0;
    var node;
    while ((node = walk.nextNode()) && count < 6000) {
      var par  = node.parentNode;
      var skip = !par || par.nodeType !== 1 || !/\S/.test(node.data);
      for (var up = par; !skip && up && up !== el; up = up.parentNode) {
        if (up.nodeType === 1 && µ._mjs_dom.hasAttribute(up, 'mjs-fx-layer')) skip = true;
      }
      if (skip) continue;
      var cs = getComputedStyle(par);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      g.fillStyle = plain ? '#fff' : '#000';
      if (!plain) g.fillStyle = cs.color;
      g.font      = (/italic|oblique/.test(cs.fontStyle) ? 'italic ' : '') + (cs.fontVariantCaps === 'small-caps' ? 'small-caps ' : '') + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      if ('letterSpacing' in g) g.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
      g.direction = cs.direction === 'rtl' ? 'rtl' : 'ltr';
      var m       = g.measureText('Hg');
      var size    = parseFloat(cs.fontSize) || 16;
      var asc     = typeof m.fontBoundingBoxAscent === 'number' ? m.fontBoundingBoxAscent : size * 0.8;
      var desc    = typeof m.fontBoundingBoxDescent === 'number' ? m.fontBoundingBoxDescent : size * 0.2;
      var tt      = cs.textTransform;
      var put     = function(str, r) {
        var s = tt === 'uppercase' ? str.toUpperCase() : tt === 'lowercase' ? str.toLowerCase() : tt === 'capitalize' ? str.charAt(0).toUpperCase() + str.slice(1) : str;
        var h = (r.bottom - r.top) / sy;
        g.fillText(s, (r.left - ox) / sx, (r.top - oy) / sy + (h - asc - desc) / 2 + asc);
      };
      var re = /\S+/g;
      var w;
      while ((w = re.exec(node.data))) {
        count++;
        range.setStart(node, w.index);
        range.setEnd(node, w.index + w[0].length);
        var rects = range.getClientRects();
        if (rects.length === 1) put(w[0], rects[0]);
        else if (rects.length > 1) {
          // un mot coupé sur deux lignes : chaque caractère perçu à sa place
          var at = w.index;
          var gs = µ._mjs_fxGraphemes(w[0]);
          for (var k = 0; k < gs.length; k++) {
            range.setStart(node, at);
            range.setEnd(node, at + gs[k].length);
            var one = range.getClientRects();
            if (one.length > 0) put(gs[k], one[0]);
            at += gs[k].length;
          }
        }
      }
    }
    return cv;
  };

  // ce qui, dans le style calculé du texte, change la forme, la place ou la couleur des lettres, ou le fond qui les remplit, sans toucher à la boîte de la balise
  // (`color-scheme` : un fond écrit avec `light-dark()` change de couleur avec lui)
  var TYPO = ['font-family', 'font-style', 'font-weight', 'font-size', 'font-variant-caps', 'letter-spacing', 'word-spacing', 'text-align', 'line-height', 'text-transform', 'text-indent', 'white-space', 'direction', 'color', 'color-scheme', '--mjs-fluid-background'];

  // la signature de la typographie et de la couleur d'une balise : une chaîne qui change dès que l'une de ces propriétés change, pour la balise ou
  // pour l'un des éléments qui portent une part de son texte (les calques d'effets n'en sont pas)
  function signature(el) {
    var owners = [el];
    var walk   = document.createTreeWalker(el, 4);
    var node;
    while ((node = walk.nextNode()) && owners.length < 200) {
      var par = node.parentNode;
      var dup = !par || par.nodeType !== 1 || owners.indexOf(par) >= 0;
      for (var up = par; !dup && up && up !== el; up = up.parentNode) {
        if (up.nodeType === 1 && µ._mjs_dom.hasAttribute(up, 'mjs-fx-layer')) dup = true;
      }
      if (!dup) owners.push(par);
    }
    var sig = '';
    for (var i = 0; i < owners.length; i++) {
      var cs = getComputedStyle(owners[i]);
      for (var k = 0; k < TYPO.length; k++) sig += cs.getPropertyValue(TYPO[k]) + '|';
    }
    // le schéma de couleurs du système aussi (un `color-scheme` qui le suit ne change pas de valeur calculée quand le schéma change)
    return sig + (theme && theme.mq ? theme.mq.matches : '');
  }

  // une couleur CSS résolue par le navigateur dans le contexte de `host` : une balise témoin, posée un instant dans l'hôte, reçoit la couleur et rend sa couleur calculée,
  // si bien que `currentColor` est la couleur du texte de l'hôte, `light-dark()` suit son schéma de couleurs et `color-mix()` se mélange comme en CSS ; la toile 2D, qui n'a
  // ni texte ni schéma, ne fait plus que lire cette couleur toute résolue. Rend [r, g, b, a] de 0 à 1, ou null quand le CSS n'y voit pas une couleur (un dégradé, une image).
  // Le témoin est un calque d'effet que les observateurs de texte ne comptent pas ; son style est posé avant qu'il entre dans l'hôte, les observateurs d'attributs ne le voient pas
  function resolve(raw, host) {
    var w = document.createElement('span');
    w.setAttribute('mjs-fx-layer', 'fluid-probe');
    w.style.color = raw;
    if (!w.style.color) return null;
    µ._mjs_dom.insertBefore(host, w, null);
    var c = getComputedStyle(w).color;
    w.remove();
    return paint(c, true);
  }

  // le thème de la page, guetté une seule fois pour toutes les balises en texte : tout attribut de <html> et de <body> (`data-mjs-theme`, `data-theme`, `class`, `style` ; la page
  // choisit le sien), le schéma de couleurs du système, et la fin de toute transition de `color` de la page (un thème dont <body> fait glisser la couleur : la balise, qui en hérite,
  // n'a pas de transition à elle, et la couleur lue au moment de la bascule est encore celle de départ). Chaque balise est prévenue (elle relit la couleur de son texte, et ne
  // redessine que si elle a changé) ; les avis sont regroupés : le premier part aussitôt et ouvre une fenêtre de 150 ms, ce qui arrive pendant elle n'en fait qu'un, à sa
  // fermeture (le dernier changement n'est jamais perdu, et une variable de <html> réécrite à chaque image ne fait relire les balises que sept fois par seconde). Le guetteur
  // s'arrête avec la dernière balise
  var theme = null;
  function watchTheme(f) {
    if (!theme) {
      var subs  = [];
      var timer = 0;
      var due   = false;
      var tell  = function() {
        if (timer) {
          due = true;
          return;
        }
        var all = subs.slice();
        for (var i = 0; i < all.length; i++) all[i]();
        timer = setTimeout(shut, 150);
      };
      var shut = function() {
        timer = 0;
        if (!due) return;
        due = false;
        tell();
      };
      var done = function(e) { if (e.propertyName === 'color') tell(); };
      var opt  = { attributes: true };
      var mo   = typeof MutationObserver === 'function' ? new MutationObserver(tell) : null;
      var mq   = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
      if (mo) {
        mo.observe(document.documentElement, opt);
        if (document.body) mo.observe(document.body, opt);
      }
      if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', tell);
      document.addEventListener('transitionend', done, true);
      document.addEventListener('transitioncancel', done, true);
      theme = { subs: subs, mo: mo, mq: mq, tell: tell, done: done, stop: function() { clearTimeout(timer); } };
    }
    theme.subs.push(f);
    return function() {
      var t = theme;
      var i = t ? t.subs.indexOf(f) : -1;
      if (i < 0) return;
      t.subs.splice(i, 1);
      if (t.subs.length) return;
      t.stop();
      if (t.mo) t.mo.disconnect();
      if (t.mq && typeof t.mq.removeEventListener === 'function') t.mq.removeEventListener('change', t.tell);
      document.removeEventListener('transitionend', t.done, true);
      document.removeEventListener('transitioncancel', t.done, true);
      theme = null;
    };
  }
  // @@

  µ._mjs_fxDefs.fluid = {
    // décor posé dans la balise : remis quand un script la réécrit (mjs_fx_toolkeep.ts)
    decor: true,
    css: '[mjs-fx~="fluid"]{isolation:isolate}'
      + '[mjs-fx-layer="fluid"]{position:absolute;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;border-radius:inherit;background:var(--mjs-fluid-background)}'
      + '[mjs-fx-layer="fluid"][mjs-fx-fluid-mask]{background:none}' // @@ where=text
      + '[mjs-fx~="fluid"][mjs-fx-fluid-text]{-webkit-text-fill-color:transparent}' // @@ where=text
      + '@media (forced-colors:active){[mjs-fx-layer="fluid"]{display:none}'
      + '[mjs-fx~="fluid"][mjs-fx-fluid-text]{-webkit-text-fill-color:currentColor}' // @@ where=text
      + '}',
    vars: { background: '' },
    // effet lourd : suivi par les effets économes, et relancé (il compte la finesse de l'encre à la pose)
    heavy: true,
    liteRestart: true,
    setup: function(el, s) {
      if (!probe()) {
        warn();
        return function() {};
      }
      var host = µ._mjs_fxInner(el) || el;
      if (host !== el) µ._mjs_fxAdopt(host, 'fluid');
      var restore = µ._mjs_fxRelative(el);
      var inline  = µ._mjs_fxMovable(el);
      // le masque lit le texte de la balise : celui d'un composant est dans son intérieur, le masque ne le verrait pas et la
      // balise rendue transparente le cacherait ; le fluide s'y pose en `box`
      var text    = false;
      text        = s.where === 'text' && host === el; // @@ where=text
      if (s.where === 'text' && !text) warnComponent(); // @@ where=text
      var click   = s.on === 'click';
      var calm    = µ._mjs_fxCalm();
      var lite    = µ._mjs_fxLite === true;
      var detail  = num(s.detail, 32);
      var quality = lite ? Math.max(64, µ._mjs_fxCount(num(s.quality, 512))) : num(s.quality, 512);
      var cfg     = { size: num(s.size, 0.5), strength: num(s.strength, 1000), fade: num(s.fade, 2), friction: num(s.friction, 1), curl: num(s.curl, 4), glow: num(s.glow, 0.5), rays: num(s.rays, 0.6), resolution: Math.min(4, Math.max(0.5, num(s.resolution, 1.5))), auto: s.auto === true };
      var palette = inks(s.colors || µ._mjs_fxList(el, '--mjs-fluid-colors'), host);
      // le fond écrit, posé tel quel par la feuille de la toile (variable CSS) : un texte que le CSS refuse comme fond, ou une variable qui ne se résout pas, vaut
      // « rien d'écrit » (en box la toile reste transparente, en texte les lettres gardent la couleur du texte) et prévient, une fois par balise et par valeur, au développement seulement (le registre des composants
      // `µ.instances` n'existe pas en production)
      var told = Object.create(null);
      var vet  = function(v) {
        if (!µ.instances || v === undefined || v === null || v === '') return;
        if (typeof CSS !== 'object' || !CSS || typeof CSS.supports !== 'function') return;
        var raw = String(v);
        var str = /var\(/.test(raw) ? substitute(raw, host) : raw;
        if (!str || !CSS.supports(text ? 'color' : 'background', str)) warnColor(raw, told);
      };
      vet(s.background);
      // la toile : un calque d'effet, caché des lecteurs d'écran, qui ne montre que le fluide
      var layer = function() {
        var c = document.createElement('canvas');
        c.setAttribute('mjs-fx-layer', 'fluid');
        c.setAttribute('aria-hidden', 'true');
        if (text) c.setAttribute('mjs-fx-fluid-mask', ''); // @@ where=text
        return c;
      };
      var cv = layer();
      µ._mjs_dom.insertBefore(host, cv, host.firstChild);
      // elle est le premier enfant de l'hôte ; remise s'il en sort (l'auteur a remplacé le contenu de la balise : elle partait avec
      // l'ancien texte, qui restait transparent sur rien), sauf quand la balise n'a pas de contexte et reste sans effet
      var attach = function() {
        if (!starved && cv.parentNode !== host) µ._mjs_dom.insertBefore(host, cv, host.firstChild);
      };
      var undo = [];
      // `cap` : en phase de capture (un défilement ne remonte pas jusqu'à la racine qui l'écoute)
      var hear = function(ev, f, on, cap) {
        var n   = on || el;
        var opt = { passive: true, capture: cap === true };
        if (n === el) µ._mjs_dom.addEventListener(el, ev, f, opt);
        else n.addEventListener(ev, f, opt);
        undo.push(function() {
          if (n === el) µ._mjs_dom.removeEventListener(el, ev, f, opt);
          else n.removeEventListener(ev, f, opt);
        });
      };

      // ---- l'état
      // le contexte, ses programmes et les cibles de calcul : la vitesse, le tourbillon, la divergence, la pression, l'encre,
      // le halo, les rayons, le masque du texte
      var gl     = null;
      var fmt    = null;
      var P      = {};
      var vsh    = null;
      var vel    = null;
      var spin   = null;
      var soft   = null;
      var spread = null;
      var press  = null;
      var ink    = null;
      var glowT  = null;
      var raysT  = null;
      var maskT  = null; // @@ where=text
      // la grille des vitesses : le côté d'une case (en côtés courts de la grille), son étendue par axe (dans la même
      // unité), la taille d'une case en coordonnée de texture, le nombre d'allers-retours de la relaxation
      var edge   = 1;
      var span   = [1, 1];
      var cells  = [1, 1];
      var sweeps = 8;
      // la balise, ses gestes en attente et l'horloge simulée
      var W       = 0;
      var H       = 0;
      var queue   = [];
      var strokes = [];
      var clock   = 0;
      var until   = 0;
      var raf     = 0;
      var last    = 0;
      // la vie de l'effet
      var seen      = false;
      var onScreen  = true;
      var inside    = false;
      var pressed   = false;
      var lost      = false;
      var starved   = false;
      var dead      = false;
      var gone      = false;
      var settled   = false;
      var owed      = false;
      var echo      = false;
      var maskDirty = true; // @@ where=text
      var signed    = ''; // @@ where=text
      var backStale = true; // @@ where=text
      var fading    = [];
      var textOn    = 0; // @@ where=text
      var back      = null; // @@ where=text
      var light     = [0.5, 0.5];
      var prev      = null;
      var phase     = Math.random();
      var nextAuto  = 0;
      var recolor   = 0;
      // les taches en attente : multiplicateur de la surface de la tache (1, sauf pour l'image figée), puis les lots de
      // seize taches envoyés au programme des gestes (positions, vitesses communiquées, couleurs)
      var wide = 1;
      var at   = new Float32Array(32);
      var push = new Float32Array(64);
      var add  = new Float32Array(64);

      // ---- la durée du calme : le temps simulé qu'il faut pour que l'encre disparaisse (la décroissance est exp(-fade × t) :
      // sous 1/512 elle ne se voit plus, ln(2 × 512) / fade secondes) ; sans effacement (`fade: 0`), que le mouvement se
      // calme (ln(200) / friction) ; sans l'un ni l'autre, vingt secondes
      var delay = function() {
        var t = cfg.fade > 0 ? LIFE / cfg.fade : cfg.friction > 0 ? CALM / cfg.friction : 20;
        // au moins 0,6 s (un geste se voit toujours), au plus 60 s
        return Math.min(60, Math.max(0.6, t));
      };

      // ---- la mesure de la balise (à la pose, puis par ResizeObserver) et la taille de la toile
      var fit = function() {
        var w = el.clientWidth;
        var h = el.clientHeight;
        box   = null;
        if (!w || !h) return;
        W         = w;
        H         = h;
        var dpr   = Math.min(cfg.resolution, typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);
        var k     = Math.min(1, Math.sqrt(MAX_PIXELS / (W * H * dpr * dpr)));
        var bw    = Math.max(1, Math.round(W * dpr * k));
        var bh    = Math.max(1, Math.round(H * dpr * k));
        var moved = bw !== cv.width || bh !== cv.height;
        if (moved) {
          cv.width  = bw;
          cv.height = bh;
        }
        if (gl && !lost) {
          if (text) maskDirty = true; // @@ where=text
          if (moved || text) kick();
        }
      };

      // ---- WebGL
      var shader = function(type, src) {
        var sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return sh;
        problem = String(gl.getShaderInfoLog(sh) || 'shader').slice(0, 300);
        return null;
      };
      var link = function(frag, defs) {
        var fs = shader(gl.FRAGMENT_SHADER, HEAD + (defs || '') + frag);
        if (!fs || !vsh) return null;
        var p = gl.createProgram();
        gl.attachShader(p, vsh);
        gl.attachShader(p, fs);
        gl.bindAttribLocation(p, 0, 'aPos');
        gl.linkProgram(p);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
          problem = String(gl.getProgramInfoLog(p) || 'program').slice(0, 300);
          return null;
        }
        var u = {};
        var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (var i = 0; i < n; i++) {
          var info = gl.getActiveUniform(p, i);
          u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
        }
        return { p: p, u: u };
      };
      var texture = function(w, h) {
        var t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (w) gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, gl.RGBA, fmt.type, null);
        return t;
      };
      var target = function(w, h, alpha) {
        var t = texture(w, h);
        var f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, alpha === undefined ? 1 : alpha);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return { tex: t, fbo: f, w: w, h: h, tx: 1 / w, ty: 1 / h };
      };
      // deux cibles qu'on s'échange : `now` porte l'état présent et se lit, `next` reçoit le suivant ; `flip` les inverse
      var pair = function(w, h, alpha) {
        var o = { now: target(w, h, alpha), next: target(w, h, alpha) };
        o.flip = function() {
          var t  = o.now;
          o.now  = o.next;
          o.next = t;
        };
        return o;
      };
      var bind = function(p, name, unit, tex) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(p.u[name], unit);
      };
      var draw = function(t) {
        if (t) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
          gl.viewport(0, 0, t.w, t.h);
        }
        else {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, cv.width, cv.height);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      var use = function(p, tx, ty) {
        gl.useProgram(p.p);
        if (tx) gl.uniform2f(p.u.uTexel, tx, ty);
      };

      // les ressources : programmes du mouvement, textures des vitesses (petites) et de l'encre
      var build = function() {
        P         = {};
        glowT     = null;
        raysT     = null;
        maskT     = null; // @@ where=text
        vsh       = shader(gl.VERTEX_SHADER, VERT);
        P.spin    = link(F_SPIN);
        P.soften  = link(F_SOFTEN);
        P.boost   = link(F_BOOST);
        P.spread  = link(F_SPREAD);
        P.relax   = link(F_RELAX);
        P.project = link(F_PROJECT);
        P.carry   = link(F_CARRY);
        P.drop    = link(F_DROP);
        if (!P.spin || !P.soften || !P.boost || !P.spread || !P.relax || !P.project || !P.carry || !P.drop) return false;
        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 3, 3, -1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        var most = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;
        var vd   = grid(detail, W / H, 1048576, most);
        var dd   = grid(quality, W / H, MAX_PIXELS, most);
        vel      = pair(vd[0], vd[1]);
        spin     = target(vd[0], vd[1]);
        soft     = target(vd[0], vd[1]);
        spread   = target(vd[0], vd[1]);
        press    = pair(vd[0], vd[1]);
        ink      = pair(dd[0], dd[1], 0);
        cells    = [vel.now.tx, vel.now.ty];
        edge     = 1 / Math.min(vd[0], vd[1]);
        span     = [vd[0] * edge, vd[1] * edge];
        // la relaxation : un aller-retour (deux passes du damier) par quatre cases du côté court, de 4 à 24 ; mesuré sur le fluide entier
        // (un trait de soixante pas) : 16 cases → 4 allers-retours, 32 → 8, 64 → 16, 128 → 24 (le plafond) laissent 31, 18, 25 et 49 % de
        // la divergence d'avant la projection, contre 27, 11, 5 et 15 % en résolvant la pression à fond (la masse d'encre, elle, se garde à 98 %)
        sweeps = Math.min(24, Math.max(4, Math.round(Math.min(vd[0], vd[1]) / 4)));
        if (lite) sweeps = Math.max(3, sweeps >> 1);
        return true;
      };
      var glowOn = function() { return cfg.glow > 0 && !lite; };
      var raysOn = function() { return cfg.rays > 0 && !lite; };
      // le halo et les rayons ne coûtent rien tant qu'ils sont à zéro : leurs programmes et leurs textures
      // naissent à la première image qui les demande
      var needGlow = function() {
        if (glowT) return true;
        P.cut  = P.cut || link(F_CUT);
        P.down = P.down || link(F_DOWN);
        P.up   = P.up || link(F_UP);
        if (!P.cut || !P.down || !P.up) return false;
        var d = grid(256, W / H, 262144, 2048);
        glowT = [];
        for (var i = 0, w = d[0], h = d[1]; i < GLOW_LEVELS && Math.min(w, h) >= 2; i++, w = w >> 1, h = h >> 1) glowT.push(target(w, h));
        return glowT.length > 1;
      };
      var needRays = function() {
        if (raysT) return true;
        P.rays = P.rays || link(F_RAYS);
        if (!P.rays) return false;
        var d = grid(160, W / H, 65536, 1024);
        raysT = target(d[0], d[1]);
        return true;
      };
      var release = function() {
        if (!gl) return;
        cv.removeEventListener('webglcontextlost', onLost);
        cv.removeEventListener('webglcontextrestored', onBack);
        lose(gl);
        gl = null;
        P  = {};
      };
      var fail = function() {
        dead = true;
        release();
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-fluid-text'); // @@ where=text
        cv.remove();
        warn();
      };
      // sans contexte à donner (le navigateur en limite le nombre par page, une quinzaine) : la balise reste comme sans effet — son
      // fond et son texte d'origine —, prévenue une fois pour la page, jusqu'à son prochain réveil (cf. rouse)
      var starve = function() {
        starved = true;
        if (raf) cancelAnimationFrame(raf);
        raf  = 0;
        last = 0;
        // @@ where=text
        if (textOn) {
          textOn = 0;
          µ._mjs_dom.removeAttribute(el, 'mjs-fx-fluid-text');
        }
        // @@
        cv.remove();
        warnCrowded();
      };
      // un contexte que le navigateur n'a pas rendu : une toile neuve, qui demandera un contexte neuf
      var renew = function() {
        release();
        cv           = layer();
        lost         = false;
        queue.length = 0;
      };
      var make = function() {
        if (dead || gone) return false;
        if (gl) return !lost;
        if (starved) return false;
        attach();
        fit();
        if (!W || !H) return false;
        var o = open(cv);
        if (!o) {
          starve();
          return false;
        }
        gl  = o.gl;
        fmt = o;
        cv.addEventListener('webglcontextlost', onLost);
        cv.addEventListener('webglcontextrestored', onBack);
        if (!build()) {
          fail();
          return false;
        }
        return true;
      };
      // une perte de contexte : la boucle s'arrête, le vrai texte reparaît, la balise reste comme sans effet ; au retour du contexte,
      // tout est refait
      var onLost = function(e) {
        e.preventDefault();
        lost = true;
        starve();
      };
      var onBack = function() {
        lost         = false;
        starved      = false;
        queue.length = 0;
        var ex       = exts(gl, fmt.kind);
        attach();
        if (ex) {
          fmt.internal = ex.internal;
          fmt.type     = ex.type;
        }
        if (!ex || !build()) {
          fail();
          return;
        }
        maskDirty = true; // @@ where=text
        kick();
      };

      // ---- une image : on avance le fluide d'un pas, puis on l'affiche
      // l'eau au repos : la vitesse et la pression remises à zéro (l'encre est effacée, plus rien ne montre le courant qui
      // restait : un nouveau geste ne doit pas le réveiller)
      var rest = function() {
        settled = false;
        var all = [vel.now, vel.next, press.now, press.next];
        for (var i = 0; i < all.length; i++) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, all[i].fbo);
          gl.clearColor(0, 0, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
      };
      // un pas de `dt` secondes : les gestes en attente, le renfort des tourbillons, le transport de la vitesse, sa
      // projection (divergence, pression, gradient) puis le transport de l'encre par cette vitesse presque sans divergence
      var step = function(dt) {
        var tx = cells[0];
        var ty = cells[1];
        var p;
        if (queue.length) {
          var area  = cfg.size / 100 * wide;
          var shape = [W / (H * area), H / (W * area)];
          var force = cfg.strength * GAIN;
          while (queue.length) {
            var n = Math.min(16, queue.length);
            for (var i = 0; i < n; i++) {
              var q  = queue[i];
              var vx = q.dx * span[0] * force;
              var vy = q.dy * span[1] * force;
              var vk = Math.min(1, V_MAX / Math.max(1e-6, Math.sqrt(vx * vx + vy * vy)));
              at[2 * i]       = q.x;
              at[2 * i + 1]   = q.y;
              push[4 * i]     = vx * vk;
              push[4 * i + 1] = vy * vk;
              push[4 * i + 2] = 0;
              push[4 * i + 3] = 0;
              add[4 * i]      = q.c[0];
              add[4 * i + 1]  = q.c[1];
              add[4 * i + 2]  = q.c[2];
              add[4 * i + 3]  = q.a;
            }
            queue.splice(0, n);
            p = P.drop;
            use(p);
            gl.uniform1i(p.u.uCount, n);
            gl.uniform2fv(p.u.uAt, at);
            gl.uniform2f(p.u.uShape, shape[0], shape[1]);
            bind(p, 'uSrc', 0, vel.now.tex);
            gl.uniform4fv(p.u.uAdd, push);
            gl.uniform1f(p.u.uMix, 0);
            gl.uniform1f(p.u.uPeak, EXPOSE);
            gl.uniform1f(p.u.uCover, COVER);
            draw(vel.next);
            vel.flip();
            bind(p, 'uSrc', 0, ink.now.tex);
            gl.uniform4fv(p.u.uAdd, add);
            gl.uniform1f(p.u.uMix, 1);
            draw(ink.next);
            ink.flip();
          }
        }
        if (cfg.curl > 0 && cfg.friction > 0) {
          p = P.spin;
          use(p, tx, ty);
          gl.uniform1f(p.u.uSide, edge);
          bind(p, 'uVel', 0, vel.now.tex);
          draw(spin);
          p = P.soften;
          use(p, tx, ty);
          bind(p, 'uSpin', 0, spin.tex);
          draw(soft);
          p = P.boost;
          use(p, tx, ty);
          gl.uniform1f(p.u.uKick, 0.5 * edge * dt * DRIFT_MAX * cfg.curl / (cfg.curl + DRIFT_HALF));
          gl.uniform1f(p.u.uEase, SOFT);
          gl.uniform1f(p.u.uCap, V_MAX);
          bind(p, 'uVel', 0, vel.now.tex);
          bind(p, 'uSoft', 1, soft.tex);
          draw(vel.next);
          vel.flip();
        }
        p = P.carry;
        use(p);
        gl.uniform2f(p.u.uStep, dt / span[0], dt / span[1]);
        gl.uniform1f(p.u.uKeep, Math.exp(-cfg.friction * dt));
        gl.uniform1f(p.u.uCap, V_MAX);
        bind(p, 'uVel', 0, vel.now.tex);
        bind(p, 'uSrc', 1, vel.now.tex);
        draw(vel.next);
        vel.flip();
        p = P.spread;
        use(p, tx, ty);
        gl.uniform1f(p.u.uSide, edge);
        bind(p, 'uVel', 0, vel.now.tex);
        draw(spread);
        p = P.relax;
        use(p, tx, ty);
        gl.uniform1f(p.u.uSide, edge);
        gl.uniform1f(p.u.uOver, OVER);
        bind(p, 'uSpread', 1, spread.tex);
        for (var k = 0; k < 2 * sweeps; k++) {
          gl.uniform1f(p.u.uKeep, k ? 1 : MEMORY);
          gl.uniform1f(p.u.uColor, k & 1);
          bind(p, 'uPress', 0, press.now.tex);
          draw(press.next);
          press.flip();
        }
        p = P.project;
        use(p, tx, ty);
        gl.uniform1f(p.u.uSide, edge);
        gl.uniform1f(p.u.uCap, V_MAX);
        bind(p, 'uVel', 0, vel.now.tex);
        bind(p, 'uPress', 1, press.now.tex);
        draw(vel.next);
        vel.flip();
        p = P.carry;
        use(p);
        gl.uniform2f(p.u.uStep, dt / span[0], dt / span[1]);
        gl.uniform1f(p.u.uKeep, Math.exp(-cfg.fade * dt));
        gl.uniform1f(p.u.uCap, INK_MAX);
        bind(p, 'uVel', 0, vel.now.tex);
        bind(p, 'uSrc', 1, ink.now.tex);
        draw(ink.next);
        ink.flip();
      };
      // @@ where=text
      var loadMask = function() {
        maskDirty = false;
        var m     = µ._mjs_fxTextMask(el, cv.width, cv.height, back !== null);
        signed    = signature(el);
        if (!maskT) maskT = texture(0, 0);
        gl.bindTexture(gl.TEXTURE_2D, maskT);
        // la texture tirée d'une toile 2D est par défaut non prémultipliée (mesuré dans Chromium, Firefox et WebKit : rgba(255, 0, 0, 0.5) donne 255, 0, 0, 128) ;
        // prémultipliée à l'envoi (128, 0, 0, 128), c'est ce que l'affichage lit, et le bord d'une lettre y garde sa couleur exacte
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, m);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      };
      // @@
      var makeGlow = function() {
        var p = P.cut;
        use(p);
        bind(p, 'uSrc', 0, ink.now.tex);
        gl.uniform1f(p.u.uKnee, GLOW_KNEE);
        draw(glowT[0]);
        p = P.down;
        for (var i = 1; i < glowT.length; i++) {
          use(p, glowT[i - 1].tx, glowT[i - 1].ty);
          bind(p, 'uSrc', 0, glowT[i - 1].tex);
          draw(glowT[i]);
        }
        p = P.up;
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        for (var j = glowT.length - 2; j >= 0; j--) {
          use(p, glowT[j + 1].tx, glowT[j + 1].ty);
          bind(p, 'uSrc', 0, glowT[j + 1].tex);
          gl.uniform1f(p.u.uWeight, GLOW_UP);
          draw(glowT[j]);
        }
        gl.disable(gl.BLEND);
      };
      var beams = function() {
        var p = P.rays;
        use(p);
        bind(p, 'uSrc', 0, ink.now.tex);
        gl.uniform2f(p.u.uLight, light[0], light[1]);
        draw(raysT);
      };
      var show = function() {
        if (!gl || lost) return;
        // @@ where=text
        // le fond écrit (`--mjs-fluid-background`, relu à la pose, dans set et chaque fois que le masque est refait : la bascule du thème comprise) remplit les lettres à la place de la
        // couleur du texte ; un texte que le CSS refuse comme couleur vaut « rien d'écrit ». Écrit ou non, le masque n'est pas le même (la couverture seule, ou la couleur de chaque élément) : il est refait au passage
        if (text && (backStale || maskDirty)) {
          backStale = false;
          var raw   = µ._mjs_fxCss(el, '--mjs-fluid-background');
          var nb    = raw ? resolve(raw, el) : null;
          if ((nb !== null) !== (back !== null)) maskDirty = true;
          back      = nb;
        }
        if (text && maskDirty) loadMask();
        // @@
        var g = glowOn() && needGlow();
        var r = raysOn() && needRays();
        if (g) makeGlow();
        if (r) beams();
        var key = (g ? 'g' : '') + (r ? 'r' : '') + (text ? 'm' : '');
        var p   = P['show' + key] || (P['show' + key] = link(F_SHOW, (g ? '#define GLOW\n' : '') + (r ? '#define RAYS\n' : '') + (text ? '#define MASK\n' : '')));
        if (!p) {
          fail();
          return;
        }
        use(p);
        bind(p, 'uInk', 0, ink.now.tex);
        gl.uniform1f(p.u.uFull, FULL);
        gl.uniform1f(p.u.uTail, SHOW_TAIL);
        if (g) {
          bind(p, 'uGlow', 1, glowT[0].tex);
          gl.uniform1f(p.u.uGlowAmt, cfg.glow * GLOW_GAIN);
        }
        if (r) {
          bind(p, 'uRays', 2, raysT.tex);
          gl.uniform1f(p.u.uRaysAmt, cfg.rays * RAYS_GAIN);
        }
        // @@ where=text
        if (text) {
          var bk = back || [0, 0, 0, 0];
          bind(p, 'uMask', 3, maskT);
          gl.uniform4f(p.u.uBack, bk[0], bk[1], bk[2], bk[3]);
          gl.uniform1f(p.u.uFill, back ? 1 : 0);
        }
        // @@
        draw(null);
        // le texte ne devient transparent qu'une fois la première image du fluide posée, et à l'image qui suit (cf. frame)
        if (text && !textOn) textOn = 1; // @@ where=text
      };

      // ---- la boucle : une seule, qui s'arrête quand il n'y a plus rien à faire
      var auto = function(dt) {
        nextAuto -= dt;
        if (nextAuto <= 0) {
          nextAuto = 0.35 + Math.random() * 0.3;
          phase += 0.3 + Math.random() * 0.4;
          // un trait de 200 à 300 px, dans une direction au hasard, borné à la zone 5-95 % × 10-90 %
          var x0 = W * (0.05 + Math.random() * 0.9);
          var y0 = H * (0.1 + Math.random() * 0.8);
          var a  = Math.random() * 2 * Math.PI;
          var d  = 200 + Math.random() * 100;
          var x1 = Math.min(W * 0.95, Math.max(W * 0.05, x0 + Math.cos(a) * d));
          var y1 = Math.min(H * 0.9, Math.max(H * 0.1, y0 + Math.sin(a) * d));
          strokes.push({ x0: x0, y0: y0, x1: x1, y1: y1, t: 0, px: x0, py: y0 });
        }
        for (var i = strokes.length - 1; i >= 0; i--) {
          var k = strokes[i];
          k.t   = Math.min(1, k.t + dt / 0.5);
          var x = k.x0 + (k.x1 - k.x0) * k.t;
          var y = k.y0 + (k.y1 - k.y0) * k.t;
          gesture(x, y, x - k.px, y - k.py);
          k.px = x;
          k.py = y;
          if (k.t >= 1) strokes.splice(i, 1);
        }
      };
      var frame = function(now) {
        raf = 0;
        if (gone || lost || !gl) return;
        // @@ where=text
        // la première image est montrée avec celle-ci (certains WebKit montrent une image WebGL avec une image de retard) : le vrai texte lui laisse la place
        if (textOn === 1) {
          textOn = 2;
          µ._mjs_dom.setAttribute(el, 'mjs-fx-fluid-text', '');
        }
        // @@
        // l'image de rappel, demandée à la fin d'une série : la dernière image redessinée seule, en une passe
        if (echo) {
          echo = false;
          draw(null);
          return;
        }
        var dt    = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
        var drive = cfg.auto && !calm && !inside;
        last      = now;
        if (drive) auto(dt);
        if (clock < until || drive) {
          clock += dt;
          step(dt);
        }
        // @@ where=text
        // une transition de `color` en cours : la couleur du texte est relue à chaque image (le masque est refait quand elle a changé) ; une cible
        // retirée de la balise pendant sa transition n'enverra plus d'évènement, elle ne compte plus
        for (var t = fading.length - 1; t >= 0; t--) {
          if (!el.contains(fading[t])) fading.splice(t, 1);
        }
        if (fading.length && signature(el) !== signed) maskDirty = true;
        // @@
        show();
        if (clock < until || drive || fading.length) wake();
        else {
          last    = 0;
          settled = true;
          // certains WebKit montrent une image WebGL (sans antialias ni tampon conservé) avec une image de retard : la dernière d'une série,
          // ou la seule (le texte posé, les taches figées), ne se verrait pas. Elle est redessinée une fois, puis plus rien ne tourne
          echo = true;
          ask();
        }
      };
      var ask = function() {
        if (raf || !gl || lost || gone || typeof requestAnimationFrame !== 'function') return;
        // hors écran aucune image n'est demandée, quoi qu'il arrive (la balise change de taille, un réglage change, la souris la quitte, auto la
        // pousse à tracer) : l'image due est refaite au retour à l'écran (`look`)
        if (!onScreen) {
          owed = true;
          return;
        }
        owed = false;
        raf  = requestAnimationFrame(frame);
      };
      // une image due : une vraie image, jamais le simple rappel de la dernière
      var wake = function() {
        echo = false;
        ask();
      };
      // une image de plus (l'affichage seul quand il n'y a plus de mouvement) : la toile a changé de taille, le masque, le fond…
      var kick = wake;
      // un geste, en px de la boîte : `dx`, `dy` le chemin parcouru jusqu'au point (x, y). Il est découpé en pièces
      // d'au plus 0,4 rayon de tache (une traînée continue quelle que soit la cadence des évènements) ; la force de
      // chaque pièce suit sa longueur, l'encre aussi : une souris lente dépose peu, jamais d'amas
      var gesture = function(x, y, dx, dy) {
        if (!make()) return;
        if (settled) rest();
        var gap    = Math.max(1, 0.4 * Math.sqrt(cfg.size / 100 * W * H));
        var len    = Math.sqrt(dx * dx + dy * dy);
        var n      = Math.min(12, Math.max(1, Math.ceil(len / gap)));
        var amount = Math.min(1, len / n / gap);
        for (var j = 1; j <= n; j++) {
          if (!palette && clock >= recolor) phase = Math.random();
          else phase = (phase + (palette ? HUE_STEP : HUE_FREE)) % 1;
          recolor = clock + HUE_HOLD;
          var c = hsv(phase);
          if (palette) {
            var f = phase * palette.length;
            var i = Math.floor(f);
            var t = f - i;
            var a = palette[i % palette.length];
            var b = palette[(i + 1) % palette.length];
            c     = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
          }
          c = [c[0] * c[0], c[1] * c[1], c[2] * c[2]];
          var px = x - dx + dx * j / n;
          var py = y - dy + dy * j / n;
          queue.push({ x: px / W, y: 1 - py / H, dx: dx / n / W, dy: -dy / n / H, c: c, a: amount * INK_PIECE });
        }
        if (queue.length > 48) queue.splice(0, queue.length - 48);
        light = [x / W, 1 - y / H];
        until = clock + delay();
        wake();
      };
      // quelques taches posées une fois, figées (« réduire les animations ») : un court calcul, une seule image
      var still = function() {
        for (var i = 0; i < 6; i++) {
          var a = i * 2.4;
          var c = hsv((i * 0.17 + 0.05) % 1);
          if (palette) c = [palette[i % palette.length][0] ** 2, palette[i % palette.length][1] ** 2, palette[i % palette.length][2] ** 2];
          queue.push({ x: 0.15 + 0.7 * ((i * 0.618 + 0.1) % 1), y: 0.2 + 0.6 * ((i * 0.382 + 0.3) % 1), dx: Math.cos(a) * 0.03, dy: Math.sin(a) * 0.03, c: c, a: INK_PIECE * 6 });
        }
        wide = 5;
        for (var k = 0; k < 24; k++) step(1 / 60);
        wide = 1;
        kick();
      };

      // @@ where=text
      // ---- la typographie et la couleur du texte relues : changées sans que la boîte bouge (alignement, interlettre, couleur…), elles font refaire le masque
      var reread = function() {
        if (!text || !gl || lost || signature(el) === signed) return;
        maskDirty = true;
        kick();
      };
      // @@
      // ---- un réveil (entrée de la souris, retour à l'écran, départ de `auto`) : le texte est relu. Jamais par image : un changement de typographie qui
      // arrive pendant que la boucle tourne attend le réveil suivant (ou un changement de taille, de texte, de police) ; la couleur, elle, est suivie
      // aussi au repos (cf. recheck)
      var rouse = function() {
        reread(); // @@ where=text
        // une balise sans contexte retente sa chance ; un contexte perdu pour de bon est remplacé (toile neuve)
        if (!starved) return;
        starved = false;
        if (lost) renew();
        if (seen && onScreen) first();
      };

      // ---- le pointeur : la position dans la boîte de remplissage de la balise. La boîte est lue à l'entrée de la souris et relue
      // après un changement de taille, un redimensionnement de la fenêtre ou un défilement : jamais à chaque mouvement, jamais dans
      // la boucle
      var box     = null;
      var stale   = function() { box = null; };
      var measure = function() {
        var r = µ._mjs_dom.getBoundingClientRect(el);
        box   = { l: r.left, t: r.top, sx: el.offsetWidth ? r.width / el.offsetWidth : 1, sy: el.offsetHeight ? r.height / el.offsetHeight : 1, bl: el.clientLeft, bt: el.clientTop };
      };
      var local = function(e) {
        if (!box) measure();
        return { x: (e.clientX - box.l) / box.sx - box.bl, y: (e.clientY - box.t) / box.sy - box.bt };
      };
      var enter = function() {
        inside = true;
        prev   = null;
        phase += 0.3 + Math.random() * 0.4;
        measure();
        rouse();
      };
      var leave = function() {
        inside  = false;
        pressed = false;
        prev    = null;
        box     = null;
        if (cfg.auto && !calm) {
          rouse();
          wake();
        }
      };
      var down = function(e) {
        if (e.isPrimary === false || !W || !H) return;
        pressed = true;
        phase  += 0.3 + Math.random() * 0.4;
        prev    = local(e);
        // une goutte, même sans mouvement
        var drop = 0.4 * Math.sqrt(cfg.size / 100 * W * H);
        gesture(prev.x, prev.y, drop * Math.cos(phase * 40), drop * Math.sin(phase * 40));
      };
      var up = function() {
        pressed = false;
        prev    = null;
      };
      var move = function(e) {
        if (e.isPrimary === false || !W || !H || (click && !pressed)) return;
        var p = local(e);
        if (prev && (p.x !== prev.x || p.y !== prev.y)) gesture(p.x, p.y, p.x - prev.x, p.y - prev.y);
        prev = p;
      };

      // ---- la balise vue à l'écran, ses mesures, son texte, ses polices
      var first = function() {
        if (dead || gone) return;
        if (calm) {
          if (make()) still();
          return;
        }
        if (text || cfg.auto) {
          if (!make()) return;
          kick();
        }
        if (cfg.auto) wake();
      };
      var look = function(entries) {
        var e    = entries[entries.length - 1];
        onScreen = e.isIntersecting;
        if (!onScreen) {
          // une image demandée et pas encore faite reste due
          if (raf) {
            cancelAnimationFrame(raf);
            owed = true;
          }
          raf  = 0;
          last = 0;
          return;
        }
        rouse();
        if (!seen) {
          seen = true;
          first();
        }
        if (gl && (owed || clock < until || (cfg.auto && !calm && !inside))) wake();
      };
      // @@ where=text
      var redo = function() {
        if (gone || !text) return;
        attach();
        maskDirty = true;
        kick();
      };
      // ---- les lettres suivent la couleur du texte au repos, aussi en « réduire les animations » : la bascule du thème de la page, un changement de `class` ou de `style`
      // de la balise ou d'un de ses descendants, une transition de `color` de la balise ou d'un descendant (image par image jusqu'à sa fin ; en « réduire les animations »
      // lue seulement à la fin). Hors écran rien : le retour à l'écran relit tout (cf. rouse). Un ancêtre intermédiaire qui change sans transition n'est vu qu'au réveil suivant
      var recheck = function() { if (onScreen) reread(); };
      var tintRun = function(e) {
        if (e.propertyName !== 'color' || calm || back) return;
        fading.push(e.target);
        wake();
      };
      var tintEnd = function(e) {
        if (e.propertyName !== 'color') return;
        var i = fading.indexOf(e.target);
        if (i >= 0) fading.splice(i, 1);
        recheck();
      };
      var tinted  = text && typeof MutationObserver === 'function' ? new MutationObserver(recheck) : null;
      var unthem  = text ? watchTheme(recheck) : null;
      if (tinted) tinted.observe(el, { attributes: true, attributeFilter: ['class', 'style'], subtree: true });
      if (text) {
        hear('transitionrun', tintRun);
        hear('transitionend', tintEnd);
        hear('transitioncancel', tintEnd);
      }
      var fonts   = text && typeof document.fonts === 'object' && document.fonts ? document.fonts : null;
      var unwatch = text ? µ._mjs_fxOnText(el, redo) : null;
      // @@
      var io      = typeof IntersectionObserver === 'function' ? new IntersectionObserver(look, { rootMargin: '100px' }) : null;
      var ro      = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
      if (!calm) {
        hear('pointermove', move);
        hear('pointerenter', enter);
        hear('pointerleave', leave);
        if (click) {
          hear('pointerdown', down);
          hear('pointerup', up);
          hear('pointercancel', up);
        }
        // un défilement (de la page, d'un conteneur, d'un composant) déplace la boîte : un écouteur à chaque racine, de la balise
        // jusqu'au document
        for (var rt = µ._mjs_dom.getRootNode(el), depth = 0; rt && depth < 8; depth++) {
          hear('scroll', stale, rt, true);
          rt = rt.host ? µ._mjs_dom.getRootNode(rt.host) : null;
        }
        hear('resize', stale, window);
      }
      if (ro) ro.observe(el);
      // @@ where=text
      if (fonts) {
        if (fonts.ready && typeof fonts.ready.then === 'function') fonts.ready.then(redo);
        if (typeof fonts.addEventListener === 'function') fonts.addEventListener('loadingdone', redo);
      }
      if (text) hear('resize', redo, window);
      // @@
      fit();
      if (io) io.observe(el);
      else {
        seen = true;
        first();
      }

      var off = function() {
        gone = true;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        for (var u = undo.length - 1; u >= 0; u--) undo[u]();
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        // @@ where=text
        if (unwatch) unwatch();
        if (tinted) tinted.disconnect();
        if (unthem) unthem();
        if (fonts && typeof fonts.removeEventListener === 'function') fonts.removeEventListener('loadingdone', redo);
        // @@
        release();
        cv.remove();
        µ._mjs_dom.removeAttribute(el, 'mjs-fx-fluid-text'); // @@ where=text
        inline();
        restore();
      };
      // les réglages tenus par une variable, suivis sans reposer l'effet ; le fond suit par sa variable CSS (en box la cascade le montre, en text il est relu à l'image
      // qui suit) ; la grille des vitesses, celle de l'encre, le lieu et le déclencheur : l'effet repart
      off.set = function(k, v) {
        if (k === 'colors') palette = inks(v || µ._mjs_fxList(el, '--mjs-fluid-colors'), host);
        else if (k === 'size') cfg.size = num(v, 0.5);
        else if (k === 'strength') cfg.strength = num(v, 1000);
        else if (k === 'fade' || k === 'friction') {
          cfg[k] = num(v, k === 'fade' ? 2 : 1);
          if (clock < until) until = clock + delay();
        }
        else if (k === 'curl') cfg.curl = num(v, 4);
        else if (k === 'glow' || k === 'rays') {
          cfg[k] = num(v, k === 'glow' ? 0.5 : 0.6);
          kick();
        }
        else if (k === 'resolution') {
          cfg.resolution = Math.min(4, Math.max(0.5, num(v, 1.5)));
          fit();
        }
        else if (k === 'auto') {
          cfg.auto = v === true;
          if (cfg.auto && !calm && seen) {
            rouse();
            if (make()) wake();
          }
        }
        else if (k === 'background') {
          vet(v);
          backStale = true; // @@ where=text
          kick();
        }
        else return false;
      };
      return off;
    }
  };
})();
