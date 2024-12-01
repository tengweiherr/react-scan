import { EventType, eventWithTime } from '@rrweb/types';
import { Replayer } from 'rrweb';
import { ReplayPlugin } from 'rrweb/typings/types';
import { EventData } from './record';
import { flushOutlines } from '../outline';
import { ReactScanInternals } from '../..';

// setInterval(() => {
//   console.log(ReactScanInternals.activeOutlines);
// }, 1000);
const previoussOutlines = new Map();

class ReactScanReplayPlugin implements ReplayPlugin {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private replayer: Replayer | null = null;

  handler(event: any, isSync: boolean, context: { replayer: Replayer }) {
    if (!this.replayer) {
      this.replayer = context.replayer;
    }

    if (
      event.type === EventType.Plugin &&
      event.data.plugin === 'react-scan-plugin'
    ) {
      const data = (event.data.payload as { data: EventData }).data;
      const nodeId = data.payload.nodeId;
      const node = this.replayer
        .getMirror()
        .getNode(nodeId) as HTMLElement | null;

      if (!node) {
        return;
      }

      if (!this.canvas) {
        this.initCanvas(this.replayer.iframe);
      }

      ReactScanInternals.scheduledOutlines.push({
        domNode: node,
        rect: node.getBoundingClientRect(),
        renders: data.payload.outline.renders,
      });
      // console.log('ACTIVE OUTLINES', rea);

      flushOutlines(this.ctx!, previoussOutlines);
    }
  }

  private initCanvas(iframe: HTMLIFrameElement) {
    this.canvas = document.createElement('canvas');
    const iframeRect = iframe.getBoundingClientRect();
    const dpi = window.devicePixelRatio || 1;

    let wrapper = iframe.parentElement;
    if (wrapper) {
      wrapper.style.position = 'relative';
    }

    this.canvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: ${iframeRect.width}px;
      height: ${iframeRect.height}px;
      pointer-events: none;
      z-index: 2147483647;
      background: transparent;
      opacity: 1 !important;
      visibility: visible !important;
      display: block !important;
    `;

    this.canvas.width = iframeRect.width * dpi;
    this.canvas.height = iframeRect.height * dpi;

    iframe.parentElement?.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    if (this.ctx) {
      this.ctx.scale(dpi, dpi);
    }
  }
}

export const createReplayer = (
  events: Array<eventWithTime>,
  root: HTMLElement,
) => {
  console.log('events', events);

  ReactScanInternals.isPaused = false;
  const replayer = new Replayer(events, {
    plugins: [new ReactScanReplayPlugin()],
    root, // or specify a different container
    mouseTail: false, // todo: add this back
  });

  replayer.play();
};

console.log('BROCONFIRMMOMENT');
