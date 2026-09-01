/*
 * Captura o convite de instalação do navegador.
 *
 * O evento `beforeinstallprompt` é disparado UMA vez, possivelmente antes de o
 * React montar, e não há como recriá-lo depois. Prevenir o padrão e guardá-lo
 * aqui é o que permite ao botão "Instalar" ter o que chamar mais tarde.
 *
 * Fica num arquivo separado, e não embutido no index.html, porque a política de
 * segurança do app é `script-src 'self'`: um script inline seria bloqueado sem
 * qualquer erro visível na tela — o botão simplesmente nunca apareceria.
 */
window.addEventListener('beforeinstallprompt', function (event) {
  event.preventDefault();
  window.__installPrompt = event;
});
