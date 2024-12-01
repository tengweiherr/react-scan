import { record } from 'rrweb';
import { eventWithTime, RecordPlugin } from '@rrweb/types';
import { ReactScanInternals, scan } from '../..';
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
          // console.log('record render', render);
          // super hacky stuff, remember to change back later:
          // - we make the user canvas 0px cause im lazy
          // - we make the toolbar 0px cause im lazy
          ReactScanInternals.isPaused = false;

          const stateNode = getNearestHostFiber(fiber)?.stateNode;
          if (!stateNode) {
            return;
          }
          // console.log('state node we got', stateNode);

          const rrwebId = record.mirror.getId(stateNode);
          if (rrwebId === -1) {
            // whats the case this happens?
            return;
          }
          // console.log('rrwebid', rrwebId);

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
                renders: outline.renders.map((render) => {
                  const { changes, ...rest } = render;
                  return {
                    ...rest,
                    changes:
                      changes?.map((change) => ({
                        name: change.name,
                        unstable: change.unstable,
                        prevValue: null, // dont send this over can this might be a shit ton of data, i dont think it breaks the ui
                        nextValue: null,
                      })) || [],
                  };
                }),
              },
            },
          };
          // console.log('da data', data);
          try {
            JSON.stringify(data);
          } catch {
            console.log('the data when err', data);
          }

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
    console.log('flsuhing');

    // await fetch('http://localhost:3000/api/rrweb', {
    //   method: 'POST',
    //   body: JSON.stringify(events),
    //   mode: 'no-cors',
    //   // http2 streaming if we want
    // });
    console.log(JSON.stringify(events));

    console.log('sent events');
  } catch (e) {
    console.log('unluck', e);
  }
};

// setInterval(async () => {
//   console.log('sending', events);

// }, 5000);
