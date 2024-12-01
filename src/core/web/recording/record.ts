import { record } from 'rrweb';
import { eventWithTime, RecordPlugin } from '@rrweb/types';
import { scan } from '../..';
import { getNearestHostFiber } from '../../instrumentation/fiber';
import { Fiber } from 'react-reconciler';
import { getOutline, PendingOutline } from '../outline';
import { Render } from '../../instrumentation';
type SerializedOutline = Omit<PendingOutline, 'domNode'>;

export type EventData = {
  tag: 'react-scan';
  payload: {
    nodeId: number;
    outline: SerializedOutline;
  };
  plugin: 'react-scan-plugin';
};

const events: Array<eventWithTime> = [];
export const getEvents = () => events;
export const scanWithRecord = () => {
  const recordPlugin = (): RecordPlugin => {
    return {
      options: {},
      name: 'react-scan-plugin',
      observer(cb) {
        const onRecordRender = (fiber: Fiber, render: Render) => {
          console.log('record render', render);

          const stateNode = getNearestHostFiber(fiber)?.stateNode;
          if (!stateNode) {
            return;
          }
          console.log('state node we got', stateNode);

          const rrwebId = record.mirror.getId(stateNode);
          if (rrwebId === -1) {
            // whats the case this happens?
            return;
          }
          console.log('rrwebid', rrwebId);

          const outline = getOutline(fiber, render);
          if (!outline) {
            return;
          }
          const data: EventData = {
            tag: 'react-scan',
            plugin: 'react-scan-plugin', // i dont think this is needed, doing it for types
            payload: {
              nodeId: rrwebId,
              outline: {
                rect: outline.rect,
                renders: outline.renders,
              },
            },
          };

          cb({
            data,
          });
        };
        scan({
          onRender: (fiber, render) => {
            onRecordRender(fiber, render);
          },
        });

        return () => {};
      },
    };
  };

  record({
    emit: (event) => {
      events.push(event);
    },
    plugins: [recordPlugin()],
  });
};

export const flush = async () => {
  try {
    await fetch('http://localhost:3000/api/rrweb', {
      method: 'POST',
      body: JSON.stringify(events),
      mode: 'no-cors',
      // http2 streaming if we want
    });

    console.log('sent events');
  } catch {}
};

// setInterval(async () => {
//   console.log('sending', events);

// }, 5000);
