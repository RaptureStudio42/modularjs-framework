<vars>
  $age  int 18..120
</vars>

<script>
  $profil = new Promise((ok) -> null)
  $cours = 100
  $age = 30
</script>

<section class="cas">
  <div class="scene">
    <p id="compte-tiret" class="nombre" *count(0s, on: load, separator: "-")>12480</p>
  </div>
  <div class="scene">
    <p id="compte-suffixe" class="nombre" *count(0s, on: load, separator: ".", suffix: " €")>12480</p>
  </div>
  <p id="phrase" class="phrase">Plus de <span id="compte-ligne" *count(0s, on: load, separator: "-", suffix: " €")>12480</span> clients</p>

  <p id="poussiere" class="poussiere" *dissolve(on: load, delay: 0s, duration: 3s)>Poussière</p>

  <h2 class="mots-cadre"><span id="cadre" *cycle.frame([Coder.], delay: 0s)>Youtuber.</span> <span id="creux" *cycle.frame([Coder.], delay: 0s, outside: hollow)>Youtuber.</span> <span id="plein" *cycle.frame([Coder.], delay: 0s, outside: visible)>Youtuber.</span></h2>

  <div class="rangee">
    <@@menu id="rond"><a>⌂</a><a>☺</a><a>⚙</a><a>✉</a><a>▶</a><a>✎</a><a>♥</a><a>★</a></@@menu>
    <@@menu id="tiroir" layout="drawer"><a icon="☺">Profil</a><a icon="▶">Vidéos</a><a><b>€</b>Revenus</a></@@menu>
    <@@tabs id="courbe" layout="curve"><a value="home" icon="⌂">Accueil</a><a value="profil" icon="☺">Profil</a></@@tabs>
  </div>

  <div class="espace"></div>
  <p id="mots-zone" class="mots" *stagger(fade, unit: word, on: scroll, zone: 60% 40%)>un deux trois quatre</p>
  <div class="espace"></div>
  <p id="mots-defaut" class="mots" *stagger(fade, unit: word, on: scroll)>cinq six sept huit</p>
  <div class="espace"></div>
  <section id="lecture" class="lecture">
    <p id="lu" class="lu" *stagger(fade, unit: word, on: scroll, opacity: .2)>un deux trois quatre</p>
  </section>
  <div class="espace"></div>
  <button id="bascule-theme" class="bascule" @click={µtheme = if µtheme is 'dark' then 'light' else 'dark'}>🌙</button>
  <div id="attente" class="attente">{await $profil *skeleton}{success p}<h3 class="nom">{p.nom}</h3><p class="bio">{p.bio}</p>{end}</div>
  <div id="centre-grille" class="centre-grille" *rainbow>Centre</div>
  <div id="centre-flex" class="centre-flex" *count(0s, on: load)>4200</div>
  <button id="centre-bouton" class="centre-bouton" *stagger(on: hover)>Bouton</button>
  <table><tr><td id="centre-case" class="centre-case" *wave>Eau</td></tr></table>
  <p id="centre-coupe" class="centre-grille" *split(on: always)>Coupe</p>
  <div id="liquide" class="liquide" *goo(merge)><span class="goutte g1"></span><span class="goutte g2"></span></div>
  <p class="cours"><span id="delta-fx" *delta(fx: *scramble(10))>{$cours}</span> <button id="delta-plus" @click={$cours = $cours + 11}>+</button></p>
  <p><span id="jauge" class="jauge" *gauge(duration: 0s)>42</span></p>
  <div class="gardes"><input id="garde" aria-label="âge" value=!{$age} *guard> <input id="garde-natif" type="number" min="1" max="5" value="3" aria-label="note" *guard></div>
  <section id="hors" class="hors" *offline(delay: 0s)><p>notes</p></section>
</section>

<style>
  .cas
    display: block
    padding: 20px
  .scene
    display: grid
    place-items: center
    margin: 10px 0
  .nombre
    margin: 0
    font: 800 42px monospace
  .phrase
    font: 20px sans-serif
  .poussiere
    display: inline-block
    margin: 10px 0
    font: 900 40px sans-serif
    color: #e11d48
  .rangee
    display: flex
    align-items: center
    gap: 60px
    color: #111
  .mots
    margin: 0
    font: 700 24px sans-serif
  .espace
    height: 600px
  .attente
    width: 400px
    color: #e6edf3
  .mots-cadre
    margin: 10px 0
    font: 600 40px sans-serif
  .lecture
    height: 1440px
  .lu
    position: sticky
    top: 0
    margin: 0
    font: 700 24px sans-serif
  .centre-grille
    display: grid
    place-items: center
    width: 420px
    height: 140px
    margin: 10px 0
    font: 700 40px sans-serif
  .centre-flex
    display: flex
    justify-content: center
    align-items: center
    width: 420px
    height: 140px
    font: 800 40px monospace
  .centre-bouton
    width: 300px
    height: 90px
    font: 700 28px sans-serif
  .centre-case
    width: 300px
    height: 120px
    text-align: center
    font: 800 40px sans-serif
  .liquide
    position: relative
    width: 300px
    height: 160px
    margin: 20px 0
  .goutte
    position: absolute
    top: 40px
    width: 80px
    height: 80px
    border-radius: 50%
    background: #e11d48
  .g1
    left: 40px
  .g2
    left: 160px
  .jauge
    display: inline-block
    width: 200px
    padding: 4px 10px
    font: 700 28px monospace
  .gardes
    position: relative
    height: 120px
  .hors
    height: 200px
    background: #f6f8fa
    color: #24292f
</style>
