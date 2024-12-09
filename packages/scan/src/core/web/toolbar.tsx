import { useEffect, useRef, useState } from 'preact/hooks';
import { signal, useSignalEffect, type Signal } from '@preact/signals';
import { render } from 'preact';
import { ReactScanInternals, setOptions, Store } from '../../index';
import { throttle } from './utils';
import { MONO_FONT } from './outline';
import {
  INSPECT_TOGGLE_ID,
  type States,
} from './inspect-element/inspect-state-machine';
import { getNearestFiberFromElement } from './inspect-element/utils';

const isSoundOnSignal = signal(false);

// Sizing and positioning signals
const toolbarX = signal(
  parseInt(
    typeof window !== 'undefined'
      ? (localStorage.getItem('react-scan-toolbar-x') ??
          String(window.innerWidth - 400))
      : '0',
  ),
);
const toolbarY = signal(
  parseInt(
    typeof window !== 'undefined'
      ? (localStorage.getItem('react-scan-toolbar-y') ??
          String(window.innerHeight - 500))
      : '0',
  ),
);
const isDragging = signal(false);
const isResizing = signal(false);

// Separate references for resizing and dragging
const initialWidthRef = { current: 0 }; // Used only for resizing
const initialMouseXRef = { current: 0 }; // Used only for resizing

// Drag references
const dragInitialXOffsetRef = { current: 0 };
const dragInitialYOffsetRef = { current: 0 };

const defaultWidth = 360;
const persistSizeToLocalStorage = throttle((width: number) => {
  localStorage.setItem('react-scan-toolbar-width', String(width));
}, 100);

export const restoreSizeFromLocalStorage = (): number => {
  const width = localStorage.getItem('react-scan-toolbar-width');
  return width ? parseInt(width, 10) : defaultWidth;
};

const PlaySVG = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
    <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
    <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
    <path d="m2 2 20 20" />
  </svg>
);

const PauseSVG = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const InspectingSVG = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033z" />
    <path d="M5 3a2 2 0 0 0-2 2" />
    <path d="M19 3a2 2 0 0 1 2 2" />
    <path d="M5 21a2 2 0 0 1-2-2" />
    <path d="M9 3h1" />
    <path d="M9 21h2" />
    <path d="M14 3h1" />
    <path d="M3 9v1" />
    <path d="M21 9v2" />
    <path d="M3 14v1" />
  </svg>
);

const FocusingSVG = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033z" />
    <path d="M21 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
  </svg>
);

const NextSVG = (
  <svg
    class="nav-button"
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M6 9h6V5l7 7-7 7v-4H6V9z" />
  </svg>
);

const PreviousSVG = (
  <svg
    class="nav-button"
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M18 15h-6v4l-7-7 7-7v4h6v6z" />
  </svg>
);

const SoundOnSVG = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
    <path d="M16 9a5 5 0 0 1 0 6" />
    <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
  </svg>
);

const SoundOffSVG = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
    <line x1="22" x2="16" y1="9" y2="15" />
    <line x1="16" x2="22" y1="9" y2="15" />
  </svg>
);

const EDGE_PADDING = 15;
const ANIMATION_DURATION = 300; // ms

const persistPositionToLocalStorage = throttle((x: number, y: number) => {
  localStorage.setItem('react-scan-toolbar-x', String(x));
  localStorage.setItem('react-scan-toolbar-y', String(y));
}, 100);

// Update props interface to make isPaused optional
interface ToolbarProps {
  inspectState: Signal<States>;
  isPaused: Signal<boolean>;
  isSoundOn: Signal<boolean>;
  x: Signal<number>;
  y: Signal<number>;
  isDragging: Signal<boolean>;
  isResizing: Signal<boolean>;
}

// Update component to unwrap signals
export const Toolbar = ({
  inspectState,
  isPaused,
  isSoundOn,
  x,
  y,
  isDragging,
  isResizing,
}: ToolbarProps) => {
  const [width, setWidth] = useState(restoreSizeFromLocalStorage);
  const propContainerRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const focusActive = inspectState.value.kind === 'focused';
  const isInspectActive = inspectState.value.kind === 'inspecting';

  useEffect(() => {
    localStorage.setItem('react-scan-paused', String(!isPaused?.value));
  }, [isPaused?.value]);

  const ensureToolbarInBounds = () => {
    if (!toolbarRef.current) return;
    const toolbarRect = toolbarRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Snap to nearest horizontal edge
    const distanceToLeft = toolbarRect.left;
    const distanceToRight = viewportWidth - toolbarRect.right;
    const newX =
      distanceToLeft <= distanceToRight
        ? EDGE_PADDING
        : viewportWidth - toolbarRect.width - EDGE_PADDING;

    // Snap to nearest vertical edge (optional)
    const distanceToTop = toolbarRect.top;
    const distanceToBottom = viewportHeight - toolbarRect.bottom;
    const newY =
      distanceToTop <= distanceToBottom
        ? EDGE_PADDING
        : viewportHeight - toolbarRect.height - EDGE_PADDING;

    x.value = newX;
    y.value = newY;
    persistPositionToLocalStorage(newX, newY);

    toolbarRef.current.style.transition = `transform ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    toolbarRef.current.style.transform = `translate(${newX}px, ${newY}px)`;
    setTimeout(() => {
      if (toolbarRef.current) {
        toolbarRef.current.style.transition = '';
      }
    }, ANIMATION_DURATION);
  };

  const handleViewportChange = throttle(() => {
    if (!isDragging.value && !isResizing.value) {
      ensureToolbarInBounds();
    }
  }, 100);

  useEffect(() => {
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange);
    };
  }, []);

  handleViewportChange();

  // Mouse events for resizing
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (isResizing.value) {
        const w =
          initialWidthRef.current - (e.clientX - initialMouseXRef.current);
        const newWidth = Math.max(360, w);
        setWidth(newWidth);
        persistSizeToLocalStorage(newWidth);
      }
    };

    const onMouseUp = () => {
      if (isDragging.value) {
        isDragging.value = false;
        ensureToolbarInBounds();
      }
      if (isResizing.value) {
        isResizing.value = false;
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging.value, isResizing.value]);

  const onToggleActive = () => {
    isPaused.value = !isPaused.value;
  };

  useEffect(() => {
    const currentState = Store.inspectState.value;

    if (currentState.kind === 'uninitialized') {
      Store.inspectState.value = {
        kind: 'inspect-off',
        propContainer: propContainerRef.current!,
      };
    }
  }, []);

  const onToggleInspect = () => {
    const currentState = Store.inspectState.value;
    switch (currentState.kind) {
      case 'inspecting':
        Store.inspectState.value = {
          kind: 'inspect-off',
          propContainer: currentState.propContainer,
        };
        break;
      case 'focused':
        Store.inspectState.value = {
          kind: 'inspect-off',
          propContainer: currentState.propContainer,
        };
        break;
      case 'inspect-off':
        Store.inspectState.value = {
          kind: 'inspecting',
          hoveredDomElement: null,
          propContainer: propContainerRef.current!,
        };
        break;
      case 'uninitialized':
        break;
    }
  };

  const onSoundToggle = () => {
    isSoundOnSignal.value = !isSoundOnSignal.value;
    setOptions({ playSound: isSoundOnSignal.value });
  };

  const onNextFocus = () => {
    const currentState = Store.inspectState.value;
    if (currentState.kind !== 'focused' || !currentState.focusedDomElement)
      return;

    const focusedDomElement = currentState.focusedDomElement;
    const allElements = Array.from(document.querySelectorAll('*')).filter(
      (el): el is HTMLElement => el instanceof HTMLElement,
    );
    const currentIndex = allElements.indexOf(focusedDomElement);
    if (currentIndex === -1) return;

    let nextElement: HTMLElement | null = null;
    let nextIndex = currentIndex + 1;
    const prevFiber = getNearestFiberFromElement(focusedDomElement);

    while (nextIndex < allElements.length) {
      const fiber = getNearestFiberFromElement(allElements[nextIndex]);
      if (fiber && fiber !== prevFiber) {
        nextElement = allElements[nextIndex];
        break;
      }
      nextIndex++;
    }

    if (nextElement) {
      Store.inspectState.value = {
        kind: 'focused',
        focusedDomElement: nextElement,
        propContainer: currentState.propContainer,
      };
    }
  };

  const onPreviousFocus = () => {
    const currentState = Store.inspectState.value;
    if (currentState.kind !== 'focused' || !currentState.focusedDomElement)
      return;

    const focusedDomElement = currentState.focusedDomElement;
    const allElements = Array.from(document.querySelectorAll('*')).filter(
      (el): el is HTMLElement => el instanceof HTMLElement,
    );
    const currentIndex = allElements.indexOf(focusedDomElement);
    if (currentIndex === -1) return;

    let prevElement: HTMLElement | null = null;
    let prevIndex = currentIndex - 1;
    const currentFiber = getNearestFiberFromElement(focusedDomElement);

    while (prevIndex >= 0) {
      const fiber = getNearestFiberFromElement(allElements[prevIndex]);
      if (fiber && fiber !== currentFiber) {
        prevElement = allElements[prevIndex];
        break;
      }
      prevIndex--;
    }

    if (prevElement) {
      Store.inspectState.value = {
        kind: 'focused',
        focusedDomElement: prevElement,
        propContainer: currentState.propContainer,
      };
    }
  };

  let inspectIcon = null;
  let inspectColor = '#999';

  if (isInspectActive) {
    inspectIcon = InspectingSVG;
    inspectColor = 'rgba(142, 97, 227, 1)';
  } else if (focusActive) {
    inspectIcon = FocusingSVG;
    inspectColor = 'rgba(142, 97, 227, 1)';
  } else {
    inspectIcon = InspectingSVG;
    inspectColor = '#999';
  }

  const propsMaxHeight = focusActive ? '450px' : '0';
  const propsContainerWidth = focusActive ? `${width}px` : '0';

  const showNavButtons = focusActive;

  const onMouseDownToolbar = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') ?? target === resizeHandleRef.current) {
      return;
    }
    isDragging.value = true;
    dragInitialXOffsetRef.current = e.clientX - x.value;
    dragInitialYOffsetRef.current = e.clientY - y.value;
    toolbarRef.current!.style.transition = 'none';
    e.preventDefault();
  };

  const onMouseDownResize = (e: MouseEvent) => {
    isResizing.value = true;
    initialWidthRef.current = propContainerRef.current!.offsetWidth;
    initialMouseXRef.current = e.clientX;
    e.preventDefault();
  };

  useEffect(() => {
    if (toolbarRef.current) {
      toolbarRef.current.style.transform = `translate(${x.value}px, ${y.value}px)`;
    }
  }, []);

  // Update toolbar position during drag
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (isDragging.value && toolbarRef.current) {
        const newX = e.clientX - dragInitialXOffsetRef.current;
        const newY = e.clientY - dragInitialYOffsetRef.current;
        x.value = newX;
        y.value = newY;
        toolbarRef.current.style.transform = `translate(${newX}px, ${newY}px)`;
        persistPositionToLocalStorage(newX, newY);
      }
    };
    const onMouseUp = () => {
      if (isDragging.value) {
        isDragging.value = false;
        ensureToolbarInBounds();
      }
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  useSignalEffect(() => {
    if (toolbarRef.current) {
      toolbarRef.current.style.transform = `translate(${x.value}px, ${y.value}px)`;
    }
  });

  useEffect(() => {
    if (toolbarRef.current) {
      const rect = toolbarRef.current.getBoundingClientRect();
      x.value = rect.left;
      y.value = rect.top;
    }
  }, []);

  useSignalEffect(() => {
    if (Store.inspectState.value.kind === 'focused') {
      ensureToolbarInBounds();
    }
  });

  useEffect(() => {
    if (!toolbarRef.current) return;

    const observer = new ResizeObserver(() => {
      ensureToolbarInBounds();
    });

    observer.observe(toolbarRef.current);

    return () => {
      observer.disconnect();
    };
  }, []);

  useSignalEffect(() => {
    if (Store.inspectState.value.kind === 'inspecting') {
      // Clear previous props
      if (propContainerRef.current) {
        propContainerRef.current.innerHTML = '';
      }
    }
  });

  return (
    <div
      id="react-scan-toolbar"
      ref={toolbarRef}
      style={{
        position: 'fixed',
        left: '0px',
        top: '0px',
        fontFamily: MONO_FONT,
        fontSize: '13px',
        background: 'transparent',
        userSelect: 'none',
        display: 'flex',
        flexDirection: 'column-reverse',
        alignItems: 'flex-end',
        pointerEvents: 'none',
        maxHeight: '450px',
        zIndex: '999999999',
      }}
    >
      <style>{/* Add your CSS rules if needed */}</style>
      <div
        id="react-scan-toolbar-content"
        style={{
          background: 'rgba(0, 0, 0, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
          display: 'flex',
          flexDirection: 'column-reverse',
          cursor: 'move',
          pointerEvents: 'auto',
          overflow: 'hidden',
          width: 'fit-content',
          minWidth: 'min-content',
          position: 'relative',
        }}
        onMouseDown={(e) => onMouseDownToolbar(e as any)}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: '36px',
            width: '100%',
          }}
        >
          <button
            id={INSPECT_TOGGLE_ID}
            onClick={onToggleInspect}
            style={{
              padding: '0 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              color: inspectColor,
              cursor: 'pointer',
              transition: 'all 150ms ease',
              height: '100%',
              minWidth: '36px',
              outline: 'none',
            }}
            title="Inspect element"
          >
            {inspectIcon}
          </button>
          <button
            id="react-scan-power"
            onClick={onToggleActive}
            style={{
              padding: '0 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              color: !isPaused.value ? '#fff' : '#999',
              cursor: 'pointer',
              transition: 'all 150ms ease',
              height: '100%',
              minWidth: '36px',
              outline: 'none',
            }}
            title={!isPaused.value ? 'Stop' : 'Start'}
          >
            {!isPaused.value ? PauseSVG : PlaySVG}
          </button>
          <button
            id="react-scan-sound-toggle"
            onClick={onSoundToggle}
            style={{
              padding: '0 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              color: isSoundOn.value ? '#fff' : '#999',
              cursor: 'pointer',
              transition: 'all 150ms ease',
              height: '100%',
              minWidth: '36px',
              outline: 'none',
            }}
            title={isSoundOn.value ? 'Sound On' : 'Sound Off'}
          >
            {isSoundOn.value ? SoundOnSVG : SoundOffSVG}
          </button>
          <div
            style={{
              padding: '0 12px',
              color: '#fff',
              borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              alignItems: 'center',
              height: '100%',
              flex: 1,
              justifyContent: 'space-evenly',
            }}
          >
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {showNavButtons && (
                <>
                  <button
                    id="react-scan-previous-focus"
                    onClick={onPreviousFocus}
                    style={{
                      padding: '4px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'none',
                      color: '#999',
                      cursor: 'pointer',
                      transition: 'all 150ms ease',
                      height: '26px',
                      outline: 'none',
                      border: 'none',
                      fontSize: '12px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {PreviousSVG}
                  </button>
                  <button
                    id="react-scan-next-focus"
                    onClick={onNextFocus}
                    style={{
                      padding: '4px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'none',
                      color: '#999',
                      cursor: 'pointer',
                      transition: 'all 150ms ease',
                      height: '26px',
                      outline: 'none',
                      border: 'none',
                      fontSize: '12px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {NextSVG}
                  </button>
                </>
              )}
              <span style={{ fontSize: '14px', fontWeight: 500 }}>
                react-scan
              </span>
            </div>
          </div>
        </div>
        <div
          id="react-scan-props"
          ref={propContainerRef}
          style={{
            pointerEvents: 'auto',
            background: '#000',
            color: '#fff',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            minWidth: '100%',
            width: propsContainerWidth,
            overflow: 'auto',
            maxHeight: propsMaxHeight,
            transition: 'max-height 500ms cubic-bezier(0, 0.95, 0.1, 1)',
          }}
        >
          {/* Inject props content here if needed */}
        </div>
        <div
          id="react-scan-resize-handle"
          ref={resizeHandleRef}
          onMouseDown={(e) => onMouseDownResize(e as any)}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '4px',
            cursor: 'ew-resize',
            display: focusActive ? 'block' : 'none',
          }}
        />
      </div>
    </div>
  );
};

export const createToolbar = () => {
  if (typeof window === 'undefined') {
    return {
      cleanup: () => {
        /**/
      },
    };
  }

  const existing = document.getElementById('react-scan-toolbar-root');
  if (existing) {
    existing.remove();
  }

  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.zIndex = '2147483647';
  container.id = 'react-scan-toolbar-root';
  document.documentElement.appendChild(container);

  const ToolbarWrapper = () => {
    return (
      <Toolbar
        inspectState={Store.inspectState}
        isPaused={ReactScanInternals.instrumentation?.isPaused!}
        isSoundOn={isSoundOnSignal}
        x={toolbarX}
        y={toolbarY}
        isDragging={isDragging}
        isResizing={isResizing}
      />
    );
  };

  render(<ToolbarWrapper />, container);

  const cleanup = () => {
    render(null, container);
    container.remove();
  };

  // eventually get rid of this shit
  const TRANSITION_MS = '150ms';
  const styleElement = document.createElement('style');
  styleElement.textContent = `
  #react-scan-toolbar {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    z-index: 999999999;
  }


  .react-scan-inspector {
    font-size: 13px;
    width: 360px;
    color: #fff;
    width: 100%;
  }

  .react-scan-header {
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    background: #000;
  }

  .react-scan-header-left {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .react-scan-header-right {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .react-scan-replay-button {
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 4px;
    color: #fff;
    cursor: pointer;
    transition: all ${TRANSITION_MS} ease;
    outline: none;
  }

  .react-scan-replay-button:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .react-scan-component-name {
    font-weight: 500;
    color: #fff;
  }

  .react-scan-metrics {
    color: #888;
    font-size: 12px;
  }

  .react-scan-content {
    padding: 12px;
    background: #000;
  }

  .react-scan-section {
    color: #888;
    margin-bottom: 16px;
    font-size: 12px;
  }

  .react-scan-section:last-child {
    margin-bottom: 0;
  }

  .react-scan-property {
    margin-left: 14px;
    margin-top: 8px;
    position: relative;
  }

  .react-scan-section > .react-scan-property:first-child {
    margin-top: 4px;
  }

  .react-scan-key {
    color: #fff;
  }

  .react-scan-warning {
    padding-right: 4px;
  }

  .react-scan-string {
    color: #9ECBFF;
  }

  .react-scan-number {
    color: #79C7FF;
  }

  .react-scan-boolean {
    color: #56B6C2;
  }

  .react-scan-input {
    background: #000;
    border: none;
    color: #fff;
  }

  .react-scan-object-key {
    color: #fff;
  }

  .react-scan-array {
    color: #fff;
  }

  .react-scan-expandable {
    display: flex;
    align-items: flex-start;
  }

  .react-scan-arrow {
    cursor: pointer;
    content: '▶';
    display: inline-block;
    font-size: 8px;
    margin: 5px 4px 0 0;
    transition: transform ${TRANSITION_MS} ease;
    width: 8px;
    flex-shrink: 0;
    color: #888;
  }

  .react-scan-expanded > .react-scan-arrow {
    transform: rotate(90deg);
  }

  .react-scan-property-content {
    flex: 1;
    min-width: 0;
  }

  .react-scan-hidden {
    display: none;
  }

  .react-scan-array-container {
    overflow-y: auto;
    margin-left: 14px;
    margin-top: 8px;
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    padding-left: 8px;
  }

  .react-scan-nested-object {
    margin-left: 14px;
    margin-top: 8px;
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    padding-left: 8px;
  }

  .react-scan-nested-object > .react-scan-property {
    margin-top: 8px;
  }

  .react-scan-nested-object > .react-scan-property:first-child {
    margin-top: 0;
  }

 .react-scan-preview-line {
  position: relative;
  padding: 3px 6px;
  border-radius: 4px;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  display: flex;
  align-items: center;
}
.react-scan-flash-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(142, 97, 227, 1);
  pointer-events: none;
  opacity: 0;
  z-index: 999999;
  mix-blend-mode: multiply;
  transition: opacity ${TRANSITION_MS} ease-in;
  border-radius: 4px;
}

.react-scan-flash-active {
  opacity: 0.4;
  transition: opacity 300ms ease-in-out;
}

  /* Hover states */
  #react-scan-toolbar button:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  #react-scan-toolbar button:active {
    background: rgba(255, 255, 255, 0.15);
  }

  /* Focus states */
  #react-scan-toolbar button:focus-visible {
    outline: 2px solid #0070F3;
    outline-offset: -2px;
  }

  /* Scrollbar styling */
  .react-scan-props::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  .react-scan-props::-webkit-scrollbar-track {
    background: transparent;
  }

  .react-scan-props::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
  }

  .react-scan-props::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }



  #react-scan-toolbar::-webkit-scrollbar {
	  width: 4px;
	  height: 4px;

	}

	#react-scan-toolbar::-webkit-scrollbar-track {
	  background: rgba(255, 255, 255, 0.1);
	  border-radius: 4px;
	}

	#react-scan-toolbar::-webkit-scrollbar-thumb {
	  background: rgba(255, 255, 255, 0.3);
	  border-radius: 4px;
	}

	#react-scan-toolbar::-webkit-scrollbar-thumb:hover {
	  background: rgba(255, 255, 255, 0.4);
	}

	/* For Firefox */
	#react-scan-toolbar * {
	  scrollbar-width: thin;
	  scrollbar-color: rgba(255, 255, 255, 0.3) rgba(255, 255, 255, 0.1);
	}

  .nav-button {
    opacity: var(--nav-opacity, 1);
  }
  `;

  document.head.appendChild(styleElement);

  return { cleanup };
};
