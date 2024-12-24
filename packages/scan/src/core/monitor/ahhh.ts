(() => {
  let observer;
  let changes = false;
  let prevPath = location.href;
 
  function handleMutation(mutations) {
    for (const mutation of mutations) {
      if (
        mutation.type === 'attributes' ||
        mutation.type === 'childList' ||
        mutation.type === 'characterData' ||
        mutation.target.nodeType === Node.TEXT_NODE
      ) {
        changes = true;
        break;
      }
    }
 }
 const wahooooooooooo = () => {
  console.log('micro');
  
 }
 
  function handleFirstRaf() {
    const rafTime = performance.now();
    requestAnimationFrame(() => handleSecondRaf(rafTime));
  }
 
  function handleSecondRaf(rafTime) {
    const endTime = performance.now();
    queueMicrotask(wahooooooooooo)
    observer.disconnect();
 
    if (changes || location.href !== prevPath) {
      prevPath = location.href;
      console.log(
        `%cInteraction Timing:\n` +
        `%cTotal: ${(endTime - startTime).toFixed(1)}ms\n` + 
        `Time to RAF: ${(rafTime - startTime).toFixed(1)}ms\n` + 
        `Paint time: ${(endTime - rafTime).toFixed(1)}ms`,
        'color: #7a68e8; font-weight: bold; font-size: 12px',
        'color: #666; font-size: 11px'
      );
    } else {
      console.log('No DOM changes or route changes detected during interaction');
    }
  }
 
  let startTime;
  function trackInteraction(e) {
    startTime = performance.now();
    changes = false;
 
    observer = new MutationObserver(handleMutation);
 
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: true,
      attributeOldValue: true
    });
 
    requestAnimationFrame(handleFirstRaf);
  }
 
  document.addEventListener('pointerup', trackInteraction);
  console.log('Interaction timer active - click anywhere');
 })();