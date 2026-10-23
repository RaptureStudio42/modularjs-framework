<script>
  @sock = µsocket(decodeURIComponent(location.hash.slice(1)))
</script>

<section class="zone" *cursors(room: 'banc')>
  <h1>Compte rendu</h1>
  <p id="texte" class="texte">Points validés : le calendrier de livraison, le budget du trimestre.</p>
  <input id="champ" class="champ" value="">
</section>

<style>
  .zone
    display: block
    padding: 20px
  .texte
    font: 20px sans-serif
  .champ
    width: 300px
    font: 16px monospace
</style>
