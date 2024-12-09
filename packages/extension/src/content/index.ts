import styles from '../assets/css/styles.css?inline';
import { BroadcastSchema } from '../types/messages';
import { loadCss, broadcast } from '../utils/helpers';

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const result = BroadcastSchema.safeParse(message);

  if (result.success) {
    const data = result.data;

    if (data.type === 'react-scan:ping') {
      sendResponse(true);
      return false;
    }

    if (data.type === 'react-scan:check-version') {
      broadcast.onmessage = (type, msgData) => {
        if (type === 'react-scan:update') {
          const response = {
            isReactDetected: !['Unknown', 'Not Found'].includes(msgData.reactVersion),
            version: msgData.reactVersion
          };
          sendResponse(response);
        }
      };

      // Send the check message
      broadcast.postMessage('react-scan:check-version', {});

      return true; // Keep the message channel open
    }

    if (data.type === 'react-scan:csp-rules-changed') {
      window.location.reload();
    }
  }
  return true;
});

const getCSPRulesState = async () => chrome.runtime.sendMessage({
  type: 'react-scan:is-csp-rules-enabled',
  data: {
    domain: window.location.origin,
  },
}).then((cspRulesEnabled) => {
  broadcast.postMessage('react-scan:is-csp-rules-enabled', cspRulesEnabled);
  return cspRulesEnabled.enabled;
});

const init = (() => {
  let isInitialized = false;

  return async () => {
    if (isInitialized) {
      return;
    }

    isInitialized = true;

    loadCss(styles);

    const EXTENSION_ON_SVG = `
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-power"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/></svg>
    `;

    const el = document.createElement('button');
    el.classList.add('react-scan-extension-button', 'react-scan-default-font');
    el.innerHTML = EXTENSION_ON_SVG;

    el.onclick = async () => {
      const isCSPRulesEnabled = await getCSPRulesState();
      const toolbarContent = document.getElementById('react-scan-toolbar-content');

      // window.dispatchEvent(
      //   new CustomEvent('react-scan:state-change', {
      //     detail: { enabled: isCSPRulesEnabled }
      //   })
      // );

      // broadcast.postMessage('react-scan:state-change', { enabled: isCSPRulesEnabled });

      if (isCSPRulesEnabled) {
        // send message to the extension to disable the rules
        await chrome.runtime.sendMessage({
          type: 'react-scan:csp-rules-changed',
          data: {
            enabled: false,
            domain: window.location.origin,
          },
        });
      } else {
        // send message to the extension to enable the rules
        await chrome.runtime.sendMessage({
          type: 'react-scan:csp-rules-changed',
          data: {
            enabled: true,
            domain: window.location.origin,
          },
        });

        window.location.reload();
      }

      await new Promise((resolve) => {
        if (toolbarContent) {
          toolbarContent.style.opacity = isCSPRulesEnabled ? '0' : '1';
          toolbarContent.style.pointerEvents = isCSPRulesEnabled ? 'none' : 'auto';
        }

        setTimeout(resolve, 400);
      });
    };

    const isCSPRulesEnabled = await getCSPRulesState();
    if (isCSPRulesEnabled) {
      setTimeout(() => {
        const toolbar = document.getElementById('react-scan-toolbar');
        if (toolbar) {
          toolbar.appendChild(el);
          toolbar.style.opacity = '1';
        }
      }, 400);
    } else {
      document.documentElement.appendChild(el);
    }
  };
})();

broadcast.onmessage = (type, data) => {
  if (type === 'react-scan:update') {
    if (!['Unknown', 'Not Found'].includes(data.reactVersion)) {
      void init();
    }
  }
};
