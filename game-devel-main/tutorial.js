(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const dialog=$('tutorial-dialog'),scene=$('tutorial-scene');
  function stop(){scene.classList.remove('is-playing')}
  function replay(){
    if(!dialog.open)return;
    stop();
    // Restart every track on the same frame, including after a quick close/open.
    void scene.getBoundingClientRect();
    scene.classList.add('is-playing');
  }
  function open(){
    if(window.mazeOnline?.active())return;
    if(!dialog.open)dialog.showModal();
    replay();
  }
  function close(){stop();if(dialog.open)dialog.close()}
  $('tutorial-button').addEventListener('click',open);
  $('tutorial-replay').addEventListener('click',replay);
  $('tutorial-close').addEventListener('click',close);
  dialog.addEventListener('close',stop);
  dialog.addEventListener('cancel',stop);
  dialog.addEventListener('click',event=>{if(event.target===dialog)close()});
})();
