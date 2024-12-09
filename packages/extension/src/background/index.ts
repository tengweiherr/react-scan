import browser from 'webextension-polyfill';
import { STORAGE_KEY } from '../utils/constants';
import { isInternalUrl } from '../utils/helpers';
import { updateBadge } from './update-badge';

const isFirefox = browser.runtime.getURL('').startsWith('moz-extension://');
const browserAction = browser.action || browser.browserAction;

const isContentScriptInjected = async (tabId: number): Promise<boolean> => {
  try {
    await browser.tabs.sendMessage(tabId, { type: 'react-scan:ping' });
    return true;
  } catch {
    return false;
  }
};

const injectContentScript = async (tabId: number) => {
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab.url || isInternalUrl(tab.url)) {
      return;
    }

    if (isFirefox) {
      await browser.tabs.executeScript(tabId, {
        file: '/src/inject/index.js',
        runAt: 'document_start',
        allFrames: true
      });

      await browser.tabs.executeScript(tabId, {
        file: '/src/content/index.js',
        runAt: 'document_start',
        allFrames: true,
        matchAboutBlank: true
      });
    } else {
      await browser.scripting.executeScript({
        target: {
          tabId,
          allFrames: false
        },
        files: ['/src/content/index.js']
      });
    }
  } catch {
    // Silent fail
  }
};

// Firefox CSP handling
let cspListener: ((details: browser.WebRequest.OnHeadersReceivedDetailsType) => browser.WebRequest.BlockingResponse) | undefined;

const handleFirefoxCSP = (enable: boolean) => {
  if (enable) {
    cspListener = (details) => {
      const headers = details.responseHeaders || [];
      return {
        responseHeaders: headers.filter((header) =>
          header.name.toLowerCase() !== 'content-security-policy'
        )
      };
    };

    browser.webRequest.onHeadersReceived.addListener(
      cspListener,
      { urls: ["<all_urls>"], types: ["main_frame", "script"] },
      ["blocking", "responseHeaders"]
    );
  } else if (cspListener) {
    browser.webRequest.onHeadersReceived.removeListener(cspListener);
    cspListener = undefined;
  }
};

// Chrome CSP handling
const handleChromeCSP = async (enable: boolean) => {
  await browser.declarativeNetRequest.updateEnabledRulesets({
    [enable ? 'enableRulesetIds' : 'disableRulesetIds']: ['react_scan_csp_rules'],
  });
};

// Common CSP handling
const handleCSP = async (enable: boolean) => {
  isFirefox ? handleFirefoxCSP(enable) : await handleChromeCSP(enable);
};

const changeCSPRules = async (domain: string, isEnabled: boolean, tabId?: number) => {
  let currentDomains = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};

  if (isEnabled) {
    await handleCSP(true);
    currentDomains[domain] = true;
  } else {
    await handleCSP(false);
    const { [domain]: _, ...rest } = currentDomains;
    currentDomains = rest;
  }

  await browser.storage.local.set({ [STORAGE_KEY]: currentDomains });
  await updateBadge(isEnabled);

  if (tabId) {
    try {
      await browser.tabs.reload(tabId);
    } catch {
      // Silent fail if tab doesn't exist anymore
    }
  }
};

// Handle extension icon click
browserAction.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || isInternalUrl(tab.url)) {
    return;
  }

  const checkReactVersion = async (tabId: number) => {
    try {
      const isLoaded = await isContentScriptInjected(tabId);
      if (!isLoaded) {
        await injectContentScript(tabId);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      return new Promise<{ isReactDetected: boolean; version: string }>((resolve) => {
        const timeoutId = setTimeout(() => {
          resolve({ isReactDetected: false, version: 'Not Found' });
        }, 1000);

        browser.tabs.sendMessage(tabId, {
          type: 'react-scan:check-version'
        }).then((response: { isReactDetected: boolean; version: string } | undefined) => {
          clearTimeout(timeoutId);

          if (response && typeof response === 'object') {
            resolve(response);
          } else {
            resolve({ isReactDetected: false, version: 'Not Found' });
          }
        }).catch(() => {
          clearTimeout(timeoutId);
          resolve({ isReactDetected: false, version: 'Not Found' });
        });
      });
    } catch (error) {
      console.error('Error checking React version:', error);
      return { isReactDetected: false, version: 'Not Found' };
    }
  };

  try {
    const response = await checkReactVersion(tab.id);

    const domain = new URL(tab.url).origin;
    const currentDomains = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
    const isEnabled = domain in currentDomains && currentDomains[domain] === true;

    if (!response?.isReactDetected) {
      if (isEnabled) {
        await changeCSPRules(domain, false, tab.id);
      }
      return;
    }

    await changeCSPRules(domain, !isEnabled, tab.id);
  } catch (error) {
    console.error('Click handler error:', error);
  }
});

// Handle CSP rules changes
browser.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'react-scan:csp-rules-changed') {
    await changeCSPRules(message.data.domain, message.data.enabled);
  }

  if (message.type === 'react-scan:is-csp-rules-enabled') {
    const currentDomains = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
    const isEnabled = message.data.domain in currentDomains && currentDomains[message.data.domain] === true;
    return { enabled: isEnabled };
  }
});

const handleTabCSPRules = async (tab: browser.Tabs.Tab) => {
  if (!tab.id || !tab.url || isInternalUrl(tab.url)) {
    return;
  }

  const domain = new URL(tab.url).origin;
  const currentDomains = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
  const isEnabled = domain in currentDomains && currentDomains[domain] === true;

  // Only inject content script if CSP rules are enabled
  if (isEnabled) {
    const isLoaded = await isContentScriptInjected(tab.id);
    if (!isLoaded) {
      await injectContentScript(tab.id);
    }
  }

  // Always update badge
  await updateBadge(isEnabled);
};

// Listen for tab updates - only handle complete state
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    await handleTabCSPRules(tab);
  }
});

// Listen for tab activation
browser.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await browser.tabs.get(tabId);
  await handleTabCSPRules(tab);
});

// Listen for window focus
browser.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId !== browser.windows.WINDOW_ID_NONE) {
    const [tab] = await browser.tabs.query({ active: true, windowId });
    if (tab) {
      await handleTabCSPRules(tab);
    }
  }
});
